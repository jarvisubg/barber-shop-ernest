/* Barber Shop Ernest — motore prenotazioni.
   Nessuna dipendenza, nessun build step.

   Lo stesso file gira in due posti:

   - nel BROWSER (modo 'client'): tiene una copia dello stato in memoria per
     disegnare listino, calendario e slot liberi senza andare in rete a ogni
     click. Le SCRITTURE non toccano quella copia: vanno al server e tornano
     con lo stato aggiornato. Il browser non è mai la fonte di verità.
   - nel WORKER (modo 'server'): è la fonte di verità. Le stesse funzioni di
     dominio validano davvero la prenotazione prima di scriverla.

   Il motivo per cui è un file solo: orari, buffer, listino e limiti sono
   regole di business. Se vivessero in due copie, prima o poi divergerebbero e
   il cliente vedrebbe uno slot che il server rifiuta.

   Storia: fino al 2026-08-03 la persistenza era su localStorage. Funzionava
   solo finché chi prenotava e chi guardava l'agenda erano lo stesso browser —
   cioè mai, in produzione: le prenotazioni dei clienti non sono mai arrivate
   al negozio. Non reintrodurre localStorage come fonte di verità. */
(function (global, T, SEED) {
  'use strict';

  /* Cache di sola lettura dell'ultimo stato ricevuto dal server. Serve a una
     cosa sola: se in negozio salta la linea, l'agenda di oggi resta leggibile
     invece di mostrare una pagina vuota. Non ci si scrive mai sopra una
     prenotazione nuova. */
  var CACHE_KEY = 'ernest-cache-v1';

  /* Tetto assoluto, oltre l'orizzonte configurabile del gestionale: è la
     finestra di agenda che il Durable Object ricarica all'avvio (la usa
     server/stato.js). Una prenotazione più in là resterebbe su disco ma non
     verrebbe più letta: sparirebbe dall'agenda e il suo slot tornerebbe
     libero, in silenzio. Vale anche per quelle segnate a mano dal gestionale,
     che saltano il limite online. Meglio un rifiuto chiaro che un
     appuntamento che svanisce.
     Per alzarlo basta cambiare qui: cresce solo la quantità di prenotazioni
     tenute in memoria dal server. */
  var GIORNI_ARCHIVIO = 400;

  /* helper di data/ora e formato: vivono in tempo.js */
  var pad = T.pad, dayKey = T.dayKey, toMin = T.toMin, toHHMM = T.toHHMM, at = T.at,
      stamp = T.stamp, parse = T.parse, weekday = T.weekday, addDays = T.addDays,
      overlaps = T.overlaps, labelData = T.labelData, euro = T.euro,
      durataLabel = T.durataLabel, uid = T.uid, GIORNI = T.GIORNI, MESI = T.MESI;

  /* ---------------------------------------------------------------- store */

  var db = null;
  var cfg = {
    modo: 'client',      // 'client' nel browser, 'server' dentro il Worker
    api: '',             // base URL del Worker, in modo client
    token: null,         // token di sessione del gestionale
    persisti: null,      // callback di salvataggio, in modo server
    daCache: false       // true se lo stato mostrato viene dalla cache offline
  };

  function vuoto() {
    return {
      barbers: JSON.parse(JSON.stringify(SEED.BARBIERI)),
      services: JSON.parse(JSON.stringify(SEED.SERVIZI)),
      workingHours: SEED.orari(),
      timeOff: [],
      closures: [],
      bookings: [],
      /* Chi ha trovato tutto pieno e vuole essere chiamato se si libera un
         posto. Sta nella configurazione e non in chiavi per giorno come le
         prenotazioni: sono poche voci e si cancellano da sole quando la data
         passa.
         ponytail: se un giorno la lista diventasse lunga (centinaia di voci
         insieme) va spostata su chiavi proprie, perché così ogni iscrizione
         riscrive l'intero blocco di configurazione. */
      waitlist: [],
      settings: JSON.parse(JSON.stringify(SEED.SETTINGS)),
      schema: 4,
      listinoVersione: SEED.LISTINO_VERSIONE
    };
  }

  /* Le verifiche automatiche scrivono e cancellano prenotazioni finte usando le
     stesse funzioni di dominio. Senza questo interruttore finirebbero su disco:
     il ripristino in memoria da solo non le toglierebbe. */
  var salvataggioSospeso = false;

  function save() {
    if (salvataggioSospeso) return;
    if (cfg.modo === 'server') { if (cfg.persisti) cfg.persisti(db); return; }
    /* In modo client non si salva niente di autorevole: si aggiorna solo la
       copia di lettura per sopravvivere a un buco di rete. */
    scriviCache();
  }

  function scriviCache() {
    try {
      global.localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), db: db }));
    } catch (e) { /* modalità privata o quota piena: si resta in memoria */ }
  }

  function leggiCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var box = JSON.parse(raw);
      return box && box.db ? box.db : null;
    } catch (e) { return null; }
  }

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------------------------------------------------- disponibilità

     Fasce occupate per un barbiere in un giorno. Le prenotazioni esistenti
     vengono allargate di `buffer` minuti su entrambi i lati: così fra due
     appuntamenti resta sempre almeno il buffer, senza doppio conteggio.
     Ferie e chiusure sono blocchi netti, senza buffer. */
  /* I due interruttori servono a distinguere TRE situazioni che dall'esterno
     sembrano una sola ("non ci sono orari"), ma per il cliente sono diverse:

       nessun interruttore  → orari liberi davvero prenotabili
       senzaPrenotazioni    → il negozio lavora, ma è tutto preso: PIENO,
                              una disdetta può liberare un posto
       + senzaBlocchi       → resta solo l'orario di lavoro: se sparisce anche
                              quello il barbiere quel giorno non lavora mai
                              (domenica), altrimenti è una chiusura che finisce
                              (ferie, festività)

     Sul pieno e sulla chiusura temporanea la lista d'attesa ha senso; sul
     giorno in cui non si lavora mai non c'è niente da aspettare. */
  function busyRanges(barberId, key, opts) {
    opts = opts || {};
    var giornoIn = at(key, 0), giornoFin = at(key, 24 * 60);
    var buf = db.settings.buffer * 60000;
    var out = [];

    if (opts.senzaBlocchi) return out;

    if (!opts.senzaPrenotazioni) db.bookings.forEach(function (b) {
      if (b.stato === 'cancellata' || b.barberId !== barberId) return;
      var s = new Date(parse(b.inizio).getTime() - buf);
      var e = new Date(parse(b.fine).getTime() + buf);
      if (overlaps(s, e, giornoIn, giornoFin)) out.push([s, e]);
    });

    db.timeOff.forEach(function (t) {
      if (t.barberId !== barberId) return;
      var s = parse(t.inizio), e = parse(t.fine);
      if (overlaps(s, e, giornoIn, giornoFin)) out.push([s, e]);
    });

    db.closures.forEach(function (c) {
      var s = parse(c.inizio), e = parse(c.fine);
      if (overlaps(s, e, giornoIn, giornoFin)) out.push([s, e]);
    });

    return out;
  }

  /* Slot liberi. barberId null = "primo disponibile": unisce gli slot di tutti
     i barbieri attivi e assegna il primo libero per ordine di anzianità. */
  function slotsFor(key, barberId, durata, opts) {
    opts = opts || {};
    var now = new Date();
    var minStart = opts.ignoraAnticipo ? new Date(0)
      : new Date(now.getTime() + db.settings.anticipoMinimoMinuti * 60000);
    var wd = weekday(at(key, 0));
    var lista = barberId ? [byId(db.barbers, barberId)]
      : db.barbers.filter(function (b) { return b.attivo; })
        .sort(function (a, b) { return a.ordine - b.ordine; });
    var mappa = {};

    lista.forEach(function (b) {
      if (!b || (!b.attivo && !opts.includiInattivi)) return;
      var busy = busyRanges(b.id, key, {
        senzaPrenotazioni: opts.soloStruttura || opts.soloOrari,
        senzaBlocchi: opts.soloOrari
      });
      db.workingHours.forEach(function (f) {
        if (f.barberId !== b.id || f.giorno !== wd) return;
        var fi = toMin(f.inizio), ff = toMin(f.fine);
        for (var t = fi; t + durata <= ff; t += db.settings.slotGranularita) {
          var s = at(key, t), e = at(key, t + durata);
          if (s < minStart) continue;
          var libero = true;
          for (var i = 0; i < busy.length; i++) {
            if (overlaps(s, e, busy[i][0], busy[i][1])) { libero = false; break; }
          }
          if (!libero) continue;
          var ora = toHHMM(t);
          if (!mappa[ora]) mappa[ora] = b.id;
        }
      });
    });

    return Object.keys(mappa).sort().map(function (ora) {
      return { ora: ora, barberId: mappa[ora] };
    });
  }

  /* ------------------------------------------------------- regole listino */

  /* Risolve gli id senza guardare `attivo`: un servizio tolto dal listino resta
     leggibile sulle prenotazioni già prese, altrimenti il gestionale non
     riuscirebbe più nemmeno a spostarle. Il filtro su `attivo` vale solo su
     ciò che il cliente sceglie ex novo — lo applica creaPrenotazione. */
  /* `ids` arriva anche da fuori: /api/prenotazioni accetta qualunque JSON, e un
     corpo senza `serviziIds` faceva esplodere `.map` — il Worker rispondeva 500
     invece del solito rifiuto con motivo. Chi non manda servizi cade su
     validaSelezione, che dice "Seleziona almeno un servizio". */
  function servizi(ids) {
    return (Array.isArray(ids) ? ids : [])
      .map(function (id) { return byId(db.services, id); })
      .filter(function (s) { return !!s; });
  }

  function totali(ids) {
    var list = servizi(ids);
    return {
      durata: list.reduce(function (a, s) { return a + s.durata; }, 0),
      prezzo: list.reduce(function (a, s) { return a + s.prezzo; }, 0),
      servizi: list
    };
  }

  /* Stesse regole applicate dal widget e ri-applicate dal server prima di
     scrivere: il client non è una fonte affidabile. */
  function validaSelezione(ids) {
    var list = servizi(ids);
    if (!list.length) return 'Seleziona almeno un servizio.';

    var conta = { capelli: 0, barba: 0, combo: 0, extra: 0 };
    list.forEach(function (s) { conta[s.categoria]++; });

    if (conta.capelli > 1) return 'Puoi scegliere un solo servizio capelli.';
    if (conta.barba > 1) return 'Puoi scegliere un solo servizio barba.';
    if (conta.combo > 1) return 'Puoi scegliere un solo combo.';
    if (conta.combo && (conta.capelli || conta.barba)) {
      return 'Il combo include già taglio e barba: non aggiungere altri servizi capelli o barba.';
    }
    if (!conta.capelli && !conta.barba && !conta.combo) {
      return 'Aggiungi almeno un taglio o un servizio barba.';
    }
    return null;
  }

  /* ------------------------------------------------------------ telefono */

  function normalizzaTelefono(raw) {
    var t = String(raw || '').replace(/[\s.\-()]/g, '');
    if (t.indexOf('0039') === 0) t = '+39' + t.slice(4);
    else if (t.indexOf('+') !== 0) t = '+39' + t.replace(/^39(?=\d{9})/, '');
    return t;
  }

  function telefonoValido(raw) {
    return /^\+\d{9,14}$/.test(normalizzaTelefono(raw));
  }

  /* ------------------------------------------------------------ scrittura

     Da qui in giù sono le funzioni di dominio vere. Nel browser NON vengono
     chiamate per modificare i dati: le chiama il Worker. Restano esposte in
     API.locale perché il Worker e le verifiche automatiche le usano dirette. */

  function generaCodice() {
    for (var i = 0; i < 200; i++) {
      var c = 'ERN-' + String(Math.floor(1000 + Math.random() * 9000));
      var preso = db.bookings.some(function (b) { return b.codice === c; });
      if (!preso) return c;
    }
    return 'ERN-' + Date.now().toString().slice(-4);
  }

  function slotLibero(barberId, inizio, fine, ignoraId) {
    var buf = db.settings.buffer * 60000;
    var scontro = db.bookings.some(function (b) {
      if (b.stato === 'cancellata' || b.barberId !== barberId || b.id === ignoraId) return false;
      return overlaps(inizio, fine,
        new Date(parse(b.inizio).getTime() - buf),
        new Date(parse(b.fine).getTime() + buf));
    });
    if (scontro) return false;

    var bloccato = db.timeOff.some(function (t) {
      return t.barberId === barberId && overlaps(inizio, fine, parse(t.inizio), parse(t.fine));
    }) || db.closures.some(function (c) {
      return overlaps(inizio, fine, parse(c.inizio), parse(c.fine));
    });
    return !bloccato;
  }

  function dentroOrario(barberId, inizio, fine) {
    var key = dayKey(inizio);
    var wd = weekday(inizio);
    var i = inizio.getHours() * 60 + inizio.getMinutes();
    var f = i + Math.round((fine - inizio) / 60000);
    return db.workingHours.some(function (w) {
      return w.barberId === barberId && w.giorno === wd &&
        toMin(w.inizio) <= i && f <= toMin(w.fine) && key === dayKey(fine);
    });
  }

  /* Crea una prenotazione. Ricalcola SEMPRE durata e prezzo dal listino:
     i valori che arrivano dal client non vengono mai usati. */
  function creaPrenotazioneLocale(p) {
    var errore = validaSelezione(p.serviziIds);
    if (errore) return { ok: false, error: errore };

    var fuoriListino = servizi(p.serviziIds).filter(function (s) { return !s.attivo; })[0];
    if (fuoriListino) {
      return { ok: false, error: 'Il servizio "' + fuoriListino.nome + '" non è più disponibile.' };
    }

    if (!p.nome || !String(p.nome).trim()) return { ok: false, error: 'Inserisci il nome.' };
    if (!p.cognome || !String(p.cognome).trim()) return { ok: false, error: 'Inserisci il cognome.' };
    if (!telefonoValido(p.telefono)) return { ok: false, error: 'Numero di telefono non valido.' };
    if (p.origine !== 'manuale' && !p.consenso) {
      return { ok: false, error: 'Devi accettare il trattamento dei dati per prenotare.' };
    }

    var t = totali(p.serviziIds);

    /* `inizio` arriva dal client, e `parse` si fida: su un valore mancante o
       storto faceva esplodere `.split` e il Worker rispondeva 500 invece del
       solito rifiuto. Il secondo controllo serve perché la forma da sola non
       basta: "2026-13-45T10:00" passa la regex ma Date lo fa rotolare a
       febbraio, e il cliente resterebbe prenotato in un giorno che non ha mai
       scelto. */
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.inizio)) {
      return { ok: false, error: 'Data non valida.' };
    }
    var inizio = parse(p.inizio);
    if (dayKey(inizio) + 'T' + toHHMM(inizio.getHours() * 60 + inizio.getMinutes()) !== p.inizio) {
      return { ok: false, error: 'Data non valida.' };
    }
    var fine = new Date(inizio.getTime() + t.durata * 60000);
    var barberId = p.barberId;

    if (!barberId) {
      var s = slotsFor(dayKey(inizio), null, t.durata).filter(function (x) {
        return x.ora === toHHMM(inizio.getHours() * 60 + inizio.getMinutes());
      })[0];
      if (!s) return { ok: false, error: 'Questo orario è appena stato preso. Scegline un altro.' };
      barberId = s.barberId;
    }

    var barbiere = byId(db.barbers, barberId);
    if (!barbiere) return { ok: false, error: 'Barbiere non valido.' };

    if (!p.forza) {
      var tel = normalizzaTelefono(p.telefono);
      var attive = db.bookings.filter(function (b) {
        return b.stato === 'confermata' && b.telefono === tel && parse(b.inizio) > new Date();
      }).length;
      if (attive >= db.settings.maxPrenotazioniAttive) {
        return {
          ok: false,
          error: 'Hai già ' + attive + ' prenotazioni attive con questo numero. ' +
            'Per prenotarne un\'altra chiama il negozio.'
        };
      }
      if (inizio < new Date(Date.now() + db.settings.anticipoMinimoMinuti * 60000)) {
        return { ok: false, error: 'Questo orario è troppo vicino. Scegline uno più avanti o chiama il negozio.' };
      }
      if (dayKey(inizio) > dayKey(addDays(new Date(), GIORNI_ARCHIVIO))) {
        return {
          ok: false,
          error: 'Data troppo lontana: l\'agenda arriva a ' + GIORNI_ARCHIVIO +
            ' giorni da oggi.'
        };
      }
      /* Il limite vale solo online: al banco il negozio segna anche a sei mesi.
         Il confronto è fra giorni, non fra istanti: `addDays(now, 365)` porta
         con sé l'ora corrente, quindi alle 9 del mattino l'ultimo giorno
         dell'orizzonte era prenotabile solo prima delle 9 — mentre la striscia
         lo mostrava libero tutto il giorno. Il cliente sceglieva uno slot che
         il server rifiutava, e l'ora del rifiuto cambiava a seconda di quando
         guardava. */
      if (p.origine !== 'manuale' &&
          dayKey(inizio) > dayKey(addDays(new Date(), db.settings.giorniAvanti))) {
        return {
          ok: false,
          error: 'Si può prenotare al massimo ' + db.settings.giorniAvanti +
            ' giorni in anticipo. Per date più lontane chiama il negozio.'
        };
      }
      if (!dentroOrario(barberId, inizio, fine)) {
        return { ok: false, error: 'Fuori dagli orari di lavoro di ' + barbiere.nome + '.' };
      }
      if (!slotLibero(barberId, inizio, fine)) {
        return { ok: false, error: 'Questo orario è appena stato preso. Scegline un altro.' };
      }
    }

    var rec = {
      id: uid(),
      codice: generaCodice(),
      nome: String(p.nome).trim(),
      cognome: String(p.cognome).trim(),
      telefono: normalizzaTelefono(p.telefono),
      barberId: barberId,
      inizio: stamp(inizio),
      fine: stamp(fine),
      lunghezzaCapelli: p.lunghezzaCapelli || null,
      durata: t.durata,
      prezzo: t.prezzo,
      stato: 'confermata',
      note: p.note ? String(p.note).slice(0, 200) : '',
      origine: p.origine || 'online',
      consenso: !!p.consenso,
      servizi: t.servizi.map(function (s) {
        return { id: s.id, nome: s.nome, prezzo: s.prezzo, durata: s.durata };
      }),
      createdAt: stamp(new Date()),
      seed: !!p.seed
    };

    db.bookings.push(rec);
    save();
    return { ok: true, booking: rec };
  }

  /* Modifica dal gestionale. Conserva id e codice: il cliente ha già il suo
     riferimento, cambiarlo lo lascerebbe con un codice morto in mano. */
  function aggiornaPrenotazioneLocale(id, patch) {
    var b = byId(db.bookings, id);
    if (!b) return { ok: false, error: 'Prenotazione non trovata.' };

    var ids = patch.serviziIds || b.servizi.map(function (s) { return s.id; });
    var errore = validaSelezione(ids);
    if (errore) return { ok: false, error: errore };

    var t = totali(ids);
    var barberId = patch.barberId || b.barberId;
    var inizio = parse(patch.inizio || b.inizio);
    var fine = new Date(inizio.getTime() + t.durata * 60000);
    var barbiere = byId(db.barbers, barberId);
    if (!barbiere) return { ok: false, error: 'Barbiere non valido.' };

    if (!patch.forza) {
      if (!dentroOrario(barberId, inizio, fine)) {
        return { ok: false, error: 'Fuori dagli orari di lavoro di ' + barbiere.nome + '.' };
      }
      if (!slotLibero(barberId, inizio, fine, b.id)) {
        return { ok: false, error: 'Si sovrappone a un altro appuntamento.' };
      }
    }

    // validare prima di scrivere: uscire a metà lascerebbe il record modificato
    // in memoria mentre la finestra mostra l'errore e nulla viene salvato
    if (patch.telefono !== undefined && !telefonoValido(patch.telefono)) {
      return { ok: false, error: 'Numero di telefono non valido.' };
    }

    ['nome', 'cognome', 'note', 'lunghezzaCapelli'].forEach(function (k) {
      if (patch[k] !== undefined) b[k] = patch[k];
    });
    if (patch.telefono !== undefined) b.telefono = normalizzaTelefono(patch.telefono);
    b.barberId = barberId;
    b.inizio = stamp(inizio);
    b.fine = stamp(fine);
    b.durata = t.durata;
    b.prezzo = t.prezzo;
    b.servizi = t.servizi.map(function (s) {
      return { id: s.id, nome: s.nome, prezzo: s.prezzo, durata: s.durata };
    });
    save();
    return { ok: true, booking: b };
  }

  /* Cancellazione pubblica. Risposta identica per codice inesistente e telefono
     sbagliato: non si rivela quale dei due è errato. */
  function cancellaConCodiceLocale(codice, telefono) {
    var c = String(codice || '').trim().toUpperCase();
    var t = normalizzaTelefono(telefono);
    var b = db.bookings.filter(function (x) {
      return x.codice === c && x.telefono === t && x.stato === 'confermata';
    })[0];

    if (!b) return { ok: false, motivo: 'non_trovata' };

    var oreMancanti = (parse(b.inizio) - new Date()) / 3600000;
    if (oreMancanti < db.settings.finestraCancellazioneOre) {
      return { ok: false, motivo: 'troppo_tardi', booking: b, ore: db.settings.finestraCancellazioneOre };
    }

    b.stato = 'cancellata';
    save();
    return { ok: true, booking: b };
  }

  function cercaConCodiceLocale(codice, telefono) {
    var c = String(codice || '').trim().toUpperCase();
    var t = normalizzaTelefono(telefono);
    return db.bookings.filter(function (x) { return x.codice === c && x.telefono === t; })[0] || null;
  }

  /* ------------------------------------------------------ lista d'attesa */

  /* Iscrizione a una data piena. Non prenota niente e non tocca l'agenda: è
     solo un recapito che il negozio richiama se si libera un posto. Le stesse
     regole della prenotazione valgono anche qui — il client non è una fonte
     affidabile nemmeno per questo. */
  function iscriviListaAttesaLocale(p) {
    var errore = validaSelezione(p.serviziIds);
    if (errore) return { ok: false, error: errore };

    if (!p.nome || !String(p.nome).trim()) return { ok: false, error: 'Inserisci il nome.' };
    if (!p.cognome || !String(p.cognome).trim()) return { ok: false, error: 'Inserisci il cognome.' };
    if (!telefonoValido(p.telefono)) return { ok: false, error: 'Numero di telefono non valido.' };
    if (!p.consenso) {
      return { ok: false, error: 'Devi accettare il trattamento dei dati per essere richiamato.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dataKey)) return { ok: false, error: 'Data non valida.' };

    var oggiKey = dayKey(new Date());
    if (p.dataKey < oggiKey) return { ok: false, error: 'Quella data è già passata.' };
    if (p.dataKey > dayKey(addDays(new Date(), db.settings.giorniAvanti))) {
      return {
        ok: false,
        error: 'Si può prenotare al massimo ' + db.settings.giorniAvanti +
          ' giorni in anticipo. Per date più lontane chiama il negozio.'
      };
    }

    var barberId = p.barberId || null;
    if (barberId && !byId(db.barbers, barberId)) return { ok: false, error: 'Barbiere non valido.' };

    var tel = normalizzaTelefono(p.telefono);
    /* Riscriversi per la stessa data non crea un doppione: il negozio si
       ritroverebbe due volte lo stesso numero da chiamare. */
    var gia = db.waitlist.filter(function (w) {
      return w.telefono === tel && w.dataKey === p.dataKey && w.barberId === barberId;
    })[0];
    if (gia) return { ok: true, attesa: gia, giaIscritto: true };

    var attive = db.waitlist.filter(function (w) { return w.telefono === tel; }).length;
    if (attive >= db.settings.maxPrenotazioniAttive) {
      return {
        ok: false,
        error: 'Sei già in lista d\'attesa per ' + attive + ' date. ' +
          'Per aggiungerne altre chiama il negozio.'
      };
    }

    var t = totali(p.serviziIds);
    var rec = {
      id: uid(),
      dataKey: p.dataKey,
      barberId: barberId,
      serviziIds: p.serviziIds.slice(),
      servizi: t.servizi.map(function (s) { return { id: s.id, nome: s.nome }; }),
      durata: t.durata,
      nome: String(p.nome).trim(),
      cognome: String(p.cognome).trim(),
      telefono: tel,
      consenso: true,
      createdAt: stamp(new Date())
    };
    db.waitlist.push(rec);
    save();
    return { ok: true, attesa: rec };
  }

  function rimuoviListaAttesaLocale(id) {
    var prima = db.waitlist.length;
    db.waitlist = db.waitlist.filter(function (w) { return w.id !== id; });
    if (db.waitlist.length !== prima) save();
    return { ok: db.waitlist.length !== prima };
  }

  /* Chi aspetta per un certo giorno. Il barbiere conta solo se l'iscritto ne
     aveva chiesto uno preciso: chi ha scritto "primo disponibile" va avvisato
     qualunque poltrona si liberi. */
  function inAttesaPer(dataKey, barberId) {
    return db.waitlist.filter(function (w) {
      return w.dataKey === dataKey && (!w.barberId || !barberId || w.barberId === barberId);
    });
  }

  function upsertLocale(coll, rec) {
    var esistente = rec.id ? byId(db[coll], rec.id) : null;
    if (esistente) Object.keys(rec).forEach(function (k) { esistente[k] = rec[k]; });
    else { rec.id = rec.id || uid(); db[coll].push(rec); }
    save();
    return rec;
  }

  function rimuoviLocale(coll, id) {
    db[coll] = db[coll].filter(function (x) { return x.id !== id; });
    save();
  }

  function cambiaStatoLocale(id, stato) {
    var b = byId(db.bookings, id);
    if (b) { b.stato = stato; save(); }
    return b;
  }

  /* Dati dimostrativi: la ricetta sta in seed.js. Girano solo su richiesta
     esplicita — in produzione mai. Prima riempivano l'agenda del negozio di
     clienti inventati che occupavano slot veri. */
  function popolaDemo() {
    var creati = SEED.popola(API);
    save();
    return creati;
  }

  /* --------------------------------------------------- migrazioni schema */

  /* Applicate dal server sullo stato salvato, non da ogni browser. */
  function migra(stato) {
    Object.keys(SEED.SETTINGS).forEach(function (k) {
      if (stato.settings[k] === undefined) stato.settings[k] = SEED.SETTINGS[k];
    });
    /* Il buffer di default era 5 minuti. Applicato su entrambi i lati e
       arrotondato alla griglia da 15, un appuntamento da 30 minuti ne occupava
       75. Il ciclo qui sopra riempie solo le chiavi mancanti, non i valori. */
    if (!(stato.schema >= 2)) {
      if (stato.settings.buffer === 5) stato.settings.buffer = 0;
      stato.schema = 2;
    }
    /* L'orizzonte di prenotazione era 30 giorni. Si alza a un anno solo per chi
       aveva ancora il valore di partenza: se il negozio l'ha cambiato dal
       gestionale è una sua decisione. Legata allo schema e non al valore,
       perché altrimenti rigirerebbe a ogni riavvio e rovescerebbe una scelta
       fatta dopo — per questo stato.js salva subito dopo la migrazione. */
    if (!(stato.schema >= 3)) {
      if (stato.settings.giorniAvanti === 30) stato.settings.giorniAvanti = 365;
      stato.schema = 3;
    }
    /* Lista d'attesa introdotta dopo: uno stato salvato prima non ha il campo,
       e senza questo `push` su undefined esploderebbe alla prima iscrizione. */
    if (!(stato.schema >= 4)) {
      if (!stato.waitlist) stato.waitlist = [];
      stato.schema = 4;
    }
    if (!Array.isArray(stato.waitlist)) stato.waitlist = [];
    /* Un'attesa per una data passata non serve più a nessuno: si toglie qui,
       una volta per avvio, così la lista non cresce all'infinito. */
    var oggiKey = dayKey(new Date());
    stato.waitlist = stato.waitlist.filter(function (w) { return w.dataKey >= oggiKey; });
    /* Il listino vive dentro lo stato salvato, non viene riletto dal seed a
       ogni avvio: altrimenti il negozio non potrebbe mai cambiare un prezzo dal
       gestionale. Si aggiornano solo le voci nostre, riconosciute per id: i
       servizi aggiunti dal negozio non si toccano. */
    if (stato.listinoVersione !== SEED.LISTINO_VERSIONE) {
      SEED.SERVIZI.forEach(function (s) {
        var esistente = byId(stato.services, s.id);
        if (esistente) Object.keys(s).forEach(function (k) { esistente[k] = s[k]; });
        else stato.services.push(JSON.parse(JSON.stringify(s)));
      });
      stato.listinoVersione = SEED.LISTINO_VERSIONE;
    }
    /* La password non sta più nel bundle pubblico: è un secret del Worker.
       Se restasse qui, chiunque aprisse il sorgente della pagina entrerebbe
       nel gestionale. */
    delete stato.settings.adminPassword;
    return stato;
  }

  /* ------------------------------------------------------------ trasporto

     Solo in modo client. Ogni scrittura è una chiamata al Worker, che risponde
     con lo stato aggiornato: nessuna riconciliazione da fare a mano. */

  function Errore(messaggio, rete) {
    var e = new Error(messaggio);
    e.diRete = !!rete;
    return e;
  }

  function chiama(metodo, percorso, corpo) {
    if (!cfg.api) {
      return Promise.reject(Errore('Sistema di prenotazione non configurato.', true));
    }
    var opt = {
      method: metodo,
      headers: { 'Content-Type': 'application/json' }
    };
    if (cfg.token) opt.headers['Authorization'] = 'Bearer ' + cfg.token;
    if (corpo !== undefined) opt.body = JSON.stringify(corpo);

    return global.fetch(cfg.api + percorso, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (dati) {
        if (dati && dati.stato) { db = dati.stato; cfg.daCache = false; scriviCache(); }
        /* Un rifiuto del motore ("slot occupato", "telefono non valido") porta
           sempre un ok:false ed è un esito normale da mostrare in pagina.
           Tutto il resto — auth, rete, guasti — è un'eccezione. */
        if (!r.ok && dati.ok === undefined) {
          if (r.status === 401 && cfg.token) {
            cfg.token = null;
            throw Errore('Sessione scaduta: rientra nel gestionale.');
          }
          throw Errore(dati.error || 'Il server non risponde. Riprova fra un momento.',
            r.status >= 500);
        }
        return dati;
      });
    }, function () {
      throw Errore('Nessuna connessione. Controlla la rete e riprova.', true);
    });
  }

  /* ------------------------------------------------------------- avvio */

  /* Modo server: lo stato arriva dal Durable Object, che lo tiene su disco. */
  function avviaServer(stato, persisti) {
    cfg.modo = 'server';
    cfg.persisti = persisti;
    db = migra(stato || vuoto());
    return db;
  }

  /* Modo client: si chiede lo stato al server. Se la rete non c'è si riparte
     dall'ultima copia nota, marcata come tale perché la UI possa avvisare che
     i dati potrebbero non essere aggiornati. */
  function avviaClient(opzioni) {
    cfg.modo = 'client';
    cfg.api = (opzioni && opzioni.api) || '';
    cfg.token = (opzioni && opzioni.token) || null;

    return chiama('GET', '/api/stato').then(function () {
      return { ok: true, daCache: false };
    }, function (e) {
      /* La copia offline rimedia a un buco di rete, non a un rifiuto del
         server: con una sessione scaduta mostrerebbe un'agenda vecchia a chi
         non ha più il diritto di vederla. */
      var salvato = e.diRete ? leggiCache() : null;
      if (!salvato) { db = vuoto(); throw e; }
      db = salvato;
      cfg.daCache = true;
      return { ok: false, daCache: true, errore: e.message };
    });
  }

  function reset() {
    db = vuoto();
    save();
    return db;
  }

  function prenotazioniDel(key) {
    return db.bookings.filter(function (b) { return b.inizio.slice(0, 10) === key; })
      .sort(function (a, b) { return a.inizio.localeCompare(b.inizio); });
  }

  function prenotazioniFuture(barberId) {
    var ora = new Date();
    return db.bookings.filter(function (b) {
      return b.stato === 'confermata' && parse(b.inizio) > ora &&
        (!barberId || b.barberId === barberId);
    });
  }

  /* Testo ICS per "aggiungi al calendario". Pura per poter girare anche sul
     server (server/stato.js): un file scaricato dal browser con un trucco
     client-side (data:/blob: URI) dipende da comportamenti che Safari e
     Chrome cambiano da una versione all'altra — un URL vero con l'header
     Content-Type giusto è l'unica versione che ogni sistema riconosce. */
  function generaIcs(b) {
    function fmt(s) { return s.replace(/[-:]/g, '') + '00'; }
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber Shop Ernest//IT',
      'BEGIN:VEVENT',
      'UID:' + b.codice + '@barberernest',
      'DTSTAMP:' + fmt(stamp(new Date())),
      'DTSTART:' + fmt(b.inizio),
      'DTEND:' + fmt(b.fine),
      'SUMMARY:Barber Shop Ernest — ' + b.servizi.map(function (s) { return s.nome; }).join(', '),
      'LOCATION:Corso Giuseppe Mazzini 128\\, 48018 Faenza RA',
      'DESCRIPTION:Codice prenotazione ' + b.codice,
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
  }

  /* --------------------------------------------------------------- export */

  var API = {
    avviaClient: avviaClient,
    avviaServer: avviaServer,
    reset: reset,
    popolaDemo: popolaDemo,
    migra: migra,
    vuoto: vuoto,
    GIORNI_ARCHIVIO: GIORNI_ARCHIVIO,
    /* Salvataggio esplicito, per le modifiche che non passano da una funzione
       di dominio (le impostazioni si scrivono in blocco). Solo in modo server. */
    forzaSalvataggio: save,
    get db() { return db; },
    get daCache() { return cfg.daCache; },
    get autenticato() { return !!cfg.token; },
    byId: byId,

    // tempo
    pad: pad, dayKey: dayKey, toMin: toMin, toHHMM: toHHMM, at: at,
    stamp: stamp, parse: parse, weekday: weekday, addDays: addDays,
    overlaps: overlaps, labelData: labelData, euro: euro, durataLabel: durataLabel,
    GIORNI: GIORNI, MESI: MESI, uid: uid,

    // letture: sincrone, servono a disegnare la UI senza andare in rete
    slotsFor: slotsFor, totali: totali, servizi: servizi, validaSelezione: validaSelezione,
    inAttesaPer: inAttesaPer,
    slotLibero: slotLibero, dentroOrario: dentroOrario,
    normalizzaTelefono: normalizzaTelefono, telefonoValido: telefonoValido,
    prenotazioniDel: prenotazioniDel, prenotazioniFuture: prenotazioniFuture,
    generaIcs: generaIcs,

    /* Logica di dominio sincrona. La usa il Worker, che è l'unico autorizzato
       a scrivere, e le verifiche automatiche. Nel browser non va chiamata:
       modificherebbe solo la copia locale, che è esattamente il difetto per cui
       le prenotazioni non arrivavano al negozio. */
    locale: {
      creaPrenotazione: creaPrenotazioneLocale,
      aggiornaPrenotazione: aggiornaPrenotazioneLocale,
      cancellaConCodice: cancellaConCodiceLocale,
      cercaConCodice: cercaConCodiceLocale,
      iscriviListaAttesa: iscriviListaAttesaLocale,
      rimuoviListaAttesa: rimuoviListaAttesaLocale,
      upsert: upsertLocale,
      rimuovi: rimuoviLocale,
      cambiaStato: cambiaStatoLocale
    }
  };

  /* ------------------------------------------------- scritture (client) */

  /* Tutte ritornano una Promise e risolvono con la stessa forma di prima
     ({ ok, booking, error }), così i punti di chiamata cambiano solo di un
     .then invece di essere riscritti. */

  API.aggiorna = function () { return chiama('GET', '/api/stato'); };

  API.creaPrenotazione = function (p) {
    return chiama('POST', '/api/prenotazioni', p);
  };

  API.aggiornaPrenotazione = function (id, patch) {
    return chiama('PATCH', '/api/prenotazioni/' + encodeURIComponent(id), patch);
  };

  API.iscriviListaAttesa = function (p) {
    return chiama('POST', '/api/lista-attesa', p);
  };

  API.rimuoviListaAttesa = function (id) {
    return chiama('DELETE', '/api/lista-attesa/' + encodeURIComponent(id));
  };

  API.cancellaConCodice = function (codice, telefono) {
    return chiama('POST', '/api/disdetta', { codice: codice, telefono: telefono });
  };

  API.cercaConCodice = function (codice, telefono) {
    return chiama('POST', '/api/cerca', { codice: codice, telefono: telefono })
      .then(function (r) { return r.booking || null; });
  };

  API.cambiaStato = function (id, stato) {
    return chiama('PATCH', '/api/prenotazioni/' + encodeURIComponent(id) + '/stato', { stato: stato });
  };

  API.upsert = function (coll, rec) {
    return chiama('PUT', '/api/dati/' + encodeURIComponent(coll), rec);
  };

  API.rimuovi = function (coll, id) {
    return chiama('DELETE', '/api/dati/' + encodeURIComponent(coll) + '/' + encodeURIComponent(id));
  };

  /* Il gestionale salva le impostazioni in blocco (orari, telefono, limiti). */
  API.salvaImpostazioni = function (settings) {
    return chiama('PUT', '/api/impostazioni', settings);
  };

  API.login = function (password) {
    return chiama('POST', '/api/login', { password: password }).then(function (r) {
      if (!r.token) return r;
      cfg.token = r.token;
      /* Lo stato in memoria è ancora quello pubblico, caricato prima di
         autenticarsi: delle prenotazioni ha solo le fasce occupate, senza nomi.
         Va riletto con il token, o il gestionale mostra un'agenda mutilata. */
      return API.aggiorna().then(function () { return r; });
    });
  };

  API.usaToken = function (t) { cfg.token = t || null; };
  API.esci = function () { cfg.token = null; };

  /* Il titolare cambia la password da solo, dal gestionale: vecchia per
     verificarsi, nuova per sostituirla. Il server rilegge lo stato, ma qui
     non serve — cambiaPassword non tocca prenotazioni o impostazioni. */
  API.cambiaPassword = function (vecchia, nuova) {
    return chiama('POST', '/api/cambia-password', { vecchia: vecchia, nuova: nuova });
  };

  /* Esegue fn su un database vuoto e usa e getta: nessuna scrittura su disco,
     stato reale ripristinato in ogni caso. Lo usa selfcheck.js. */
  API.ambienteDiProva = function (fn) {
    var backup = JSON.stringify(db);
    var modoPrec = cfg.modo;
    salvataggioSospeso = true;
    cfg.modo = 'server';           // le funzioni locali non devono uscire in rete
    try {
      db = vuoto();
      return fn(db);
    } finally {
      db = JSON.parse(backup);
      cfg.modo = modoPrec;
      salvataggioSospeso = false;
    }
  };

  global.ErnestBooking = API;

  /* Niente avvio automatico: chi usa il motore decide quando e come.
     Nel browser l'avvio è asincrono perché lo stato arriva dalla rete. */

})(typeof window !== 'undefined' ? window : globalThis,
   (typeof window !== 'undefined' ? window : globalThis).ErnestTempo,
   (typeof window !== 'undefined' ? window : globalThis).ErnestSeed);

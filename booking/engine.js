/* Barber Shop Ernest — motore prenotazioni.
   Nessuna dipendenza, nessun build step. Persistenza su localStorage.
   ponytail: localStorage al posto di Supabase — demo apribile offline con doppio click.
   In produzione questo file diventa il layer RPC (get_available_slots / create_booking /
   cancel_booking) descritto in barber-ernest-booking-prompt.md: la firma delle funzioni
   pubbliche qui sotto è già quella, cambia solo il corpo. */
(function (global, T, SEED) {
  'use strict';

  var STORE_KEY = 'ernest-booking-v1';

  /* helper di data/ora e formato: vivono in tempo.js */
  var pad = T.pad, dayKey = T.dayKey, toMin = T.toMin, toHHMM = T.toHHMM, at = T.at,
      stamp = T.stamp, parse = T.parse, weekday = T.weekday, addDays = T.addDays,
      overlaps = T.overlaps, labelData = T.labelData, euro = T.euro,
      durataLabel = T.durataLabel, uid = T.uid, GIORNI = T.GIORNI, MESI = T.MESI;

  /* ---------------------------------------------------------------- store */

  var db = null;

  function vuoto() {
    return {
      barbers: JSON.parse(JSON.stringify(SEED.BARBIERI)),
      services: JSON.parse(JSON.stringify(SEED.SERVIZI)),
      workingHours: SEED.orari(),
      timeOff: [],
      closures: [],
      bookings: [],
      settings: JSON.parse(JSON.stringify(SEED.SETTINGS)),
      seedDay: null
    };
  }

  /* Le verifiche automatiche scrivono e cancellano prenotazioni finte usando le
     stesse funzioni di dominio. Senza questo interruttore finirebbero su disco:
     il ripristino in memoria da solo non le toglierebbe. */
  var salvataggioSospeso = false;

  function save() {
    if (salvataggioSospeso) return;
    try { global.localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
    catch (e) { /* modalità privata o quota piena: si resta in memoria */ }
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null;
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
  function busyRanges(barberId, key) {
    var giornoIn = at(key, 0), giornoFin = at(key, 24 * 60);
    var buf = db.settings.buffer * 60000;
    var out = [];

    db.bookings.forEach(function (b) {
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
      var busy = busyRanges(b.id, key);
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
  function servizi(ids) {
    return ids.map(function (id) { return byId(db.services, id); })
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

  /* Stesse regole applicate dal widget e ri-applicate qui prima di scrivere:
     il client non è una fonte affidabile. */
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

  /* ------------------------------------------------------------ scrittura */

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
  function creaPrenotazione(p) {
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
    var inizio = parse(p.inizio);
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
      // il limite vale solo online: al banco il negozio segna anche a sei mesi
      if (p.origine !== 'manuale' && inizio > addDays(new Date(), db.settings.giorniAvanti)) {
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
  function aggiornaPrenotazione(id, patch) {
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
  function cancellaConCodice(codice, telefono) {
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

  function cercaConCodice(codice, telefono) {
    var c = String(codice || '').trim().toUpperCase();
    var t = normalizzaTelefono(telefono);
    return db.bookings.filter(function (x) { return x.codice === c && x.telefono === t; })[0] || null;
  }

  /* Dati dimostrativi: la ricetta sta in seed.js, qui resta solo il salvataggio. */
  function popolaDemo() {
    var creati = SEED.popola(API);
    save();
    return creati;
  }

  function init() {
    db = load() || vuoto();
    // compatibilità in avanti se lo schema cresce
    Object.keys(SEED.SETTINGS).forEach(function (k) {
      if (db.settings[k] === undefined) db.settings[k] = SEED.SETTINGS[k];
    });
    /* Il buffer di default era 5 minuti. Applicato su entrambi i lati e
       arrotondato alla griglia da 15, un appuntamento da 30 minuti ne occupava
       75. Chi ha già i dati sul browser va portato al nuovo default una volta
       sola: il ciclo qui sopra riempie solo le chiavi mancanti. */
    if (db.schema !== 2) {
      if (db.settings.buffer === 5) db.settings.buffer = 0;
      db.schema = 2;
      save();
    }
    if (db.seedDay !== dayKey(new Date())) popolaDemo();
    return db;
  }

  function reset() {
    db = vuoto();
    popolaDemo();
    return db;
  }

  /* --------------------------------------------------------------- admin */

  function upsert(coll, rec) {
    var esistente = rec.id ? byId(db[coll], rec.id) : null;
    if (esistente) Object.keys(rec).forEach(function (k) { esistente[k] = rec[k]; });
    else { rec.id = rec.id || uid(); db[coll].push(rec); }
    save();
    return rec;
  }

  function rimuovi(coll, id) {
    db[coll] = db[coll].filter(function (x) { return x.id !== id; });
    save();
  }

  function cambiaStato(id, stato) {
    var b = byId(db.bookings, id);
    if (b) { b.stato = stato; save(); }
    return b;
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

  /* --------------------------------------------------------------- export */

  var API = {
    init: init,
    reset: reset,
    popolaDemo: popolaDemo,
    get db() { return db; },
    save: save,
    byId: byId,

    // tempo
    pad: pad, dayKey: dayKey, toMin: toMin, toHHMM: toHHMM, at: at,
    stamp: stamp, parse: parse, weekday: weekday, addDays: addDays,
    overlaps: overlaps, labelData: labelData, euro: euro, durataLabel: durataLabel,
    GIORNI: GIORNI, MESI: MESI, uid: uid,

    // dominio
    slotsFor: slotsFor, totali: totali, servizi: servizi, validaSelezione: validaSelezione,
    creaPrenotazione: creaPrenotazione, aggiornaPrenotazione: aggiornaPrenotazione,
    cancellaConCodice: cancellaConCodice,
    cercaConCodice: cercaConCodice, slotLibero: slotLibero, dentroOrario: dentroOrario,
    normalizzaTelefono: normalizzaTelefono, telefonoValido: telefonoValido,

    // admin
    upsert: upsert, rimuovi: rimuovi, cambiaStato: cambiaStato,
    prenotazioniDel: prenotazioniDel, prenotazioniFuture: prenotazioniFuture
  };

  /* Esegue fn su un database vuoto e usa e getta: nessuna scrittura su disco,
     stato reale ripristinato in ogni caso. Lo usa selfcheck.js. */
  API.ambienteDiProva = function (fn) {
    var backup = JSON.stringify(db);
    salvataggioSospeso = true;
    try {
      db = vuoto();
      return fn(db);
    } finally {
      db = JSON.parse(backup);
      salvataggioSospeso = false;
      save();
    }
  };

  global.ErnestBooking = API;
  init();

})(typeof window !== 'undefined' ? window : globalThis,
   (typeof window !== 'undefined' ? window : globalThis).ErnestTempo,
   (typeof window !== 'undefined' ? window : globalThis).ErnestSeed);

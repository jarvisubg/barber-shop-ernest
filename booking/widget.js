/* Barber Shop Ernest — flusso di prenotazione pubblico.
   Si aggancia ai bottoni [data-booking-trigger] già presenti nella pagina e
   monta il riquadro d'ingresso dentro #booking-root.

   Il flusso ricalca quello di Fresha: quattro passi con briciole cliccabili in
   cima e un carrello sempre visibile a lato. Su schermo stretto il carrello
   sparisce e resta la barra in basso con totale e "Continua". */
(function (global, E) {
  'use strict';
  if (!E) return;

  var STEPS = ['servizi', 'professionista', 'ora', 'conferma', 'fatto'];

  /* le briciole mostrano solo i passi navigabili: 'fatto' è la ricevuta */
  var CRUMBS = [
    ['servizi', 'Servizi'],
    ['professionista', 'Professionista'],
    ['ora', 'Ora'],
    ['conferma', 'Conferma']
  ];

  var TITOLI = {
    servizi: 'Seleziona uno o più servizi',
    professionista: 'Scegli il barbiere',
    ora: 'Seleziona data e ora',
    conferma: 'Conferma la prenotazione',
    fatto: 'Ci vediamo.'
  };

  var S = null;
  var overlay, elBody, elFoot, elCrumbs, elTitolo, elH, elCart;

  var CFG = global.ErnestConfig || {};
  /* Recapito di riserva: serve proprio quando lo stato del negozio non è
     arrivato, quindi non può venire da lì. */
  var TELEFONO = CFG.telefono || '+393280774789';
  var TELEFONO_LABEL = CFG.telefonoLabel || '328 077 4789';

  var statoPronto = false;
  var connessione = null;

  function nuovoStato() {
    return {
      vista: 'prenota',        // 'prenota' | 'gestisci'
      step: 0,
      catAttiva: 'tutti',      // 'tutti' = listino intero, evidenza in cima
      meseOffset: 0,           // mesi da oggi mostrati nella striscia dei giorni
      serviziIds: [],
      barberId: undefined,     // undefined = non scelto, null = primo disponibile
      dataKey: null,
      ora: null,
      barberAssegnato: null,
      nome: '', cognome: '', telefono: '', note: '', consenso: false,
      errore: null,
      booking: null
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function totali() { return E.totali(S.serviziIds); }

  function mesiDaOggi(key) {
    var d = E.at(key, 0), oggi = new Date();
    return (d.getFullYear() - oggi.getFullYear()) * 12 + (d.getMonth() - oggi.getMonth());
  }

  /* La lunghezza dei capelli non si chiede più: era un passo in più prima di
     vedere il listino. Resta come nota per il barbiere nel gestionale e la si
     deduce dai servizi scelti.
     ponytail: euristica sul nome — i servizi "lunghi" sono quelli con shampoo.
     Se il negozio adotta altre convenzioni il campo scivola su 'corti': in quel
     caso si mette un flag esplicito sul servizio, non si allarga l'euristica. */
  function lunghezzaDedotta() {
    var list = E.servizi(S.serviziIds);
    if (!list.length) return null;
    var taglio = list.some(function (s) {
      return s.categoria === 'capelli' || s.categoria === 'combo';
    });
    if (!taglio) return 'solo_barba';
    return list.some(function (s) { return /lungh/i.test(s.nome); }) ? 'lunghi' : 'corti';
  }

  /* le schermate dei singoli passi vivono in widget-viste.js */
  var VISTE = global.ErnestViste.crea({
    E: E, esc: esc, totali: totali, stato: function () { return S; }
  });

  /* --------------------------------------------------------------- shell */

  function costruisci() {
    overlay = el(
      '<div class="bk bk-overlay" role="dialog" aria-modal="true" aria-label="Prenotazione online">' +
        '<div class="bk-top">' +
          '<div class="bk-shell bk-top-row">' +
            '<button class="bk-icon-btn" type="button" data-act="indietro">← Indietro</button>' +
            '<span class="bk-top-title" data-el="titolo"></span>' +
            '<button class="bk-icon-btn" type="button" data-act="chiudi" aria-label="Chiudi">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="bk-body">' +
          '<div class="bk-shell bk-layout">' +
            '<div class="bk-main">' +
              '<nav class="bk-crumbs" data-el="crumbs" aria-label="Fasi della prenotazione"></nav>' +
              '<h2 class="bk-h" data-el="h"></h2>' +
              '<div class="bk-view" data-el="body"></div>' +
            '</div>' +
            '<aside class="bk-cart" data-el="cart" aria-label="Riepilogo"></aside>' +
          '</div>' +
        '</div>' +
        '<div class="bk-foot"><div class="bk-shell bk-foot-row" data-el="foot"></div></div>' +
      '</div>'
    );
    document.body.appendChild(overlay);
    elBody = overlay.querySelector('[data-el="body"]');
    elFoot = overlay.querySelector('[data-el="foot"]');
    elCrumbs = overlay.querySelector('[data-el="crumbs"]');
    elTitolo = overlay.querySelector('[data-el="titolo"]');
    elH = overlay.querySelector('[data-el="h"]');
    elCart = overlay.querySelector('[data-el="cart"]');

    overlay.addEventListener('click', onClick);
    overlay.addEventListener('input', onInput);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && overlay.dataset.open === 'true') chiudi();
    });
  }

  /* Lo stato (listino, orari, slot occupati) arriva dal server. Finché non è
     arrivato non si può disegnare niente di sensato: mostrare un listino a
     memoria e poi scoprire che l'orario non esiste è peggio di aspettare
     mezzo secondo. */
  function apri(vista) {
    S = nuovoStato();
    if (vista) S.vista = vista;
    overlay.dataset.open = 'true';
    document.body.classList.add('bk-locked');

    if (statoPronto) return render();

    mostraAttesa();
    connessione.then(function () {
      statoPronto = true;
      if (overlay.dataset.open === 'true') render();
    }, function (e) {
      if (overlay.dataset.open === 'true') mostraGuasto(e && e.message);
    });
  }

  function mostraAttesa() {
    elTitolo.textContent = 'Un momento…';
    elCrumbs.innerHTML = '';
    overlay.dataset.cart = 'false';
    elH.textContent = 'Carico gli orari disponibili.';
    elBody.innerHTML = '<p class="bk-sub">Sto controllando le disponibilità aggiornate del negozio.</p>';
    elFoot.innerHTML = '';
  }

  /* Se il server non risponde non si finge che la prenotazione sia possibile:
     il cliente riceve subito il numero del negozio. Un appuntamento preso e
     mai arrivato costa molto più di un flusso interrotto. */
  function mostraGuasto(messaggio) {
    var tel = TELEFONO, telLabel = TELEFONO_LABEL;
    elTitolo.textContent = 'Prenotazione non disponibile';
    elCrumbs.innerHTML = '';
    overlay.dataset.cart = 'false';
    elH.textContent = 'Chiamaci, facciamo prima.';
    elBody.innerHTML =
      '<p class="bk-error">' + esc(messaggio || 'Il sistema di prenotazione non risponde.') + '</p>' +
      '<p class="bk-sub">Non riesco a raggiungere l\'agenda del negozio, quindi non posso confermarti ' +
        'nessun orario. Chiamaci o scrivici: rispondiamo noi.</p>' +
      '<div class="bk-actions">' +
        '<a href="tel:' + tel + '">Chiama ' + esc(telLabel) + '</a>' +
        '<a href="https://wa.me/' + tel.replace('+', '') +
          '" target="_blank" rel="noopener">Scrivi su WhatsApp</a>' +
      '</div>';
    elFoot.innerHTML = '';
  }

  function chiudi() {
    overlay.dataset.open = 'false';
    document.body.classList.remove('bk-locked');
  }

  /* --------------------------------------------------------------- eventi */

  function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    // il riquadro esiste nel DOM anche da chiuso: senza uno stato non c'è
    // niente da comandare, e leggerlo lancerebbe un errore
    if (!S) return;
    var act = b.dataset.act;

    if (act === 'chiudi') return chiudi();
    if (act === 'indietro') return indietro();
    if (act === 'avanti') return avanti();
    if (act === 'gestisci') { S = nuovoStato(); S.vista = 'gestisci'; return render(); }
    if (act === 'prenota') { S = nuovoStato(); return render(); }

    if (act === 'crumb') return vaiAllo(Number(b.dataset.step));
    if (act === 'categoria') { S.catAttiva = b.dataset.cat; return render(); }

    if (act === 'servizio') {
      toggleServizio(b.dataset.id);
      return render();
    }

    if (act === 'barbiere') {
      S.barberId = b.dataset.id === 'auto' ? null : b.dataset.id;
      S.ora = null; S.barberAssegnato = null;
      S.step = STEPS.indexOf('ora');
      return render();
    }

    if (act === 'mese') {
      /* Cambiando mese la data scelta si azzera: la rimpiazza il primo giorno
         libero del mese guardato, altrimenti sotto la striscia resterebbero gli
         orari di un giorno non più visibile. */
      S.meseOffset += Number(b.dataset.delta);
      S.dataKey = null; S.ora = null;
      return render();
    }

    if (act === 'giorno') {
      S.dataKey = b.dataset.key;
      // un salto a una data lontana si porta dietro la striscia
      S.meseOffset = mesiDaOggi(b.dataset.key);
      S.ora = null;
      return render();
    }

    if (act === 'slot') {
      S.ora = b.dataset.ora;
      S.barberAssegnato = b.dataset.barber;
      return render();
    }

    if (act === 'conferma') return conferma();
    if (act === 'copia') return copiaCodice(b);
    if (act === 'ics') return scaricaIcs();
    if (act === 'cerca') return cercaPrenotazione();
    if (act === 'annulla-prenotazione') return annullaPrenotazione();
  }

  function onInput(ev) {
    var t = ev.target;
    if (!t.name) return;
    S[t.name] = t.type === 'checkbox' ? t.checked : t.value;
    // il pulsante vive in due posti — carrello su desktop, barra in basso su
    // mobile: riabilitarne uno solo lasciava il tasto spento dove si guarda
    if (t.name === 'consenso' || t.name === 'telefono' || t.name === 'nome' || t.name === 'cognome') {
      aggiornaCarrello();
      aggiornaPiede();
    }
  }

  function toggleServizio(id) {
    var s = E.byId(E.db.services, id);
    if (!s) return;
    var giaScelto = S.serviziIds.indexOf(id) !== -1;

    if (giaScelto) {
      S.serviziIds = S.serviziIds.filter(function (x) { return x !== id; });
    } else {
      // una sola voce per categoria fra capelli / barba / combo
      if (s.categoria !== 'extra') {
        S.serviziIds = S.serviziIds.filter(function (x) {
          var o = E.byId(E.db.services, x);
          if (!o) return false;
          if (s.categoria === 'combo') return o.categoria === 'extra';
          if (o.categoria === 'combo') return false;
          return o.categoria !== s.categoria;
        });
      }
      S.serviziIds.push(id);
    }
    // cambiare servizi cambia la durata: l'orario scelto potrebbe non entrarci più
    S.ora = null;
    S.errore = null;
  }

  /* --------------------------------------------------------- navigazione */

  function puoAvanzare() {
    switch (STEPS[S.step]) {
      case 'servizi': return !E.validaSelezione(S.serviziIds);
      case 'professionista': return S.barberId !== undefined;
      case 'ora': return !!(S.dataKey && S.ora);
      case 'conferma':
        return !!(String(S.nome).trim() && String(S.cognome).trim() &&
          E.telefonoValido(S.telefono) && S.consenso);
      default: return false;
    }
  }

  /* Una briciola è raggiungibile solo se tutti i passi prima sono completi:
     saltare a "Ora" senza servizi darebbe una griglia di orari senza durata. */
  function completo(step) {
    switch (STEPS[step]) {
      case 'servizi': return !E.validaSelezione(S.serviziIds);
      case 'professionista': return S.barberId !== undefined;
      case 'ora': return !!(S.dataKey && S.ora);
      default: return false;
    }
  }

  function raggiungibile(step) {
    if (step <= S.step) return true;
    for (var i = 0; i < step; i++) if (!completo(i)) return false;
    return true;
  }

  function vaiAllo(step) {
    if (!raggiungibile(step)) return;
    S.errore = null;
    S.step = step;
    render();
  }

  function avanti() {
    if (STEPS[S.step] === 'servizi') {
      var err = E.validaSelezione(S.serviziIds);
      if (err) { S.errore = err; return render(); }
    }
    if (STEPS[S.step] === 'conferma') return conferma();
    if (!puoAvanzare()) return;
    S.errore = null;
    S.step = Math.min(S.step + 1, STEPS.length - 1);
    render();
  }

  function indietro() {
    if (S.vista === 'gestisci') { S = nuovoStato(); return render(); }
    if (S.step === 0) return chiudi();
    S.errore = null;
    S.step -= 1;
    render();
  }

  /* ------------------------------------------------------------- render */

  function render() {
    if (S.vista === 'gestisci') return renderGestisci();

    var nome = STEPS[S.step];
    elTitolo.textContent = TITOLI[nome];
    elH.textContent = TITOLI[nome];
    elCrumbs.innerHTML = nome === 'fatto' ? '' : briciole();
    overlay.dataset.cart = nome === 'fatto' ? 'false' : 'true';

    elBody.innerHTML = VISTE[nome]();
    if (S.errore) elBody.insertAdjacentHTML('beforeend', '<p class="bk-error">' + esc(S.errore) + '</p>');
    elBody.closest('.bk-body').scrollTop = 0;
    aggiornaCarrello();
    aggiornaPiede();
  }

  function briciole() {
    return CRUMBS.map(function (c, i) {
      var stato = i === S.step ? 'attivo' : (raggiungibile(i) ? 'aperto' : 'chiuso');
      return '<button class="bk-crumb" type="button" data-act="crumb" data-step="' + i + '"' +
        ' data-stato="' + stato + '"' + (stato === 'chiuso' ? ' disabled' : '') +
        (i === S.step ? ' aria-current="step"' : '') + '>' + c[1] + '</button>';
    }).join('<span class="bk-crumb-sep" aria-hidden="true">›</span>');
  }

  /* Carrello sempre visibile: su Fresha è la colonna che dà sicurezza al
     cliente mentre naviga. Su schermo stretto lo nasconde il CSS e il totale
     resta nella barra in basso. */
  function aggiornaCarrello() {
    var t = totali();
    var righe = t.servizi.length
      ? t.servizi.map(function (s) {
          return '<div class="bk-cart-row">' +
            '<span class="bk-cart-name">' + esc(s.nome) + '</span>' +
            '<span class="bk-cart-price">' + E.euro(s.prezzo) + '</span>' +
            '<span class="bk-cart-dur">' + E.durataLabel(s.durata) + '</span>' +
          '</div>';
        }).join('')
      : '<p class="bk-cart-vuoto">Nessun servizio selezionato.</p>';

    var quando = '';
    if (S.dataKey && S.ora) {
      var barbiere = S.barberAssegnato ? E.byId(E.db.barbers, S.barberAssegnato) : null;
      quando = '<div class="bk-cart-quando">' +
        esc(E.labelData(E.at(S.dataKey, 0))) + ' · ore ' + esc(S.ora) +
        (barbiere ? '<br>con ' + esc(barbiere.nome) : '') + '</div>';
    }

    var etichetta = STEPS[S.step] === 'conferma' ? 'Conferma prenotazione' : 'Continua →';

    elCart.innerHTML =
      '<div class="bk-cart-head">' +
        '<img src="images/barber-ernest/shop-hero.webp" alt="" width="56" height="56" loading="lazy">' +
        '<div><b>Barber Shop Ernest</b>' +
        '<span>Corso Giuseppe Mazzini 128, Faenza</span></div>' +
      '</div>' +
      '<div class="bk-cart-items">' + righe + '</div>' +
      quando +
      '<div class="bk-cart-total"><span>Totale</span>' +
        '<b>' + (t.prezzo ? E.euro(t.prezzo) : '—') + '</b></div>' +
      (t.durata ? '<div class="bk-cart-dur-tot">Durata prevista ' + E.durataLabel(t.durata) + '</div>' : '') +
      '<button class="bk-cta bk-cart-cta" type="button" data-act="avanti"' +
        (puoAvanzare() ? '' : ' disabled') + '>' + etichetta + '</button>';
  }

  function aggiornaPiede() {
    var nome = STEPS[S.step];
    if (nome === 'fatto') { elFoot.innerHTML = ''; elFoot.parentElement.style.display = 'none'; return; }
    elFoot.parentElement.style.display = '';

    var t = totali();
    var righe = t.servizi.length
      ? t.servizi.length + (t.servizi.length === 1 ? ' servizio · ' : ' servizi · ') + E.durataLabel(t.durata)
      : 'Nessun servizio selezionato';

    var etichetta = nome === 'conferma' ? 'Conferma prenotazione' : 'Continua';

    elFoot.innerHTML =
      '<div class="bk-total">' +
        '<span class="bk-total-main">' + (t.prezzo ? E.euro(t.prezzo) : '—') + '</span>' +
        '<span class="bk-total-sub">' + esc(righe) + '</span>' +
      '</div>' +
      '<button class="bk-cta" type="button" data-act="avanti"' +
        (puoAvanzare() ? '' : ' disabled') + '>' + etichetta + '</button>';
  }

  function conferma() {
    if (!puoAvanzare()) return;
    var cta = overlay.querySelectorAll('.bk-cta[data-act="avanti"]');
    Array.prototype.forEach.call(cta, function (b) { b.disabled = true; b.textContent = 'Invio…'; });

    /* La prenotazione la scrive il server, che rivalida tutto: è lui a dire se
       lo slot è ancora libero. Il "Confermato" appare solo dopo la sua
       risposta — mai prima, o si torna al difetto per cui il cliente aveva un
       codice e il negozio non aveva niente. */
    E.creaPrenotazione({
      serviziIds: S.serviziIds,
      nome: S.nome, cognome: S.cognome, telefono: S.telefono,
      barberId: S.barberAssegnato || S.barberId || null,
      inizio: S.dataKey + 'T' + S.ora,
      lunghezzaCapelli: lunghezzaDedotta(),
      note: S.note,
      consenso: S.consenso,
      origine: 'online'
    }).then(function (res) {
      if (!res.ok) {
        S.errore = res.error;
        // se lo slot è saltato, si torna alla scelta dell'orario
        if (/orario/.test(res.error || '')) { S.ora = null; S.step = STEPS.indexOf('ora'); }
        return render();
      }

      S.booking = res.booking;
      S.errore = null;
      S.step = STEPS.indexOf('fatto');
      render();
    }, function (e) {
      /* Caduta di rete a metà conferma: non si può sapere se la prenotazione è
         passata o no. Dirlo, invece di far ritentare alla cieca e rischiare il
         doppione. */
      S.errore = e.diRete
        ? e.message + ' Se hai già toccato Conferma una volta, controlla con "Gestisci prenotazione" ' +
          'prima di riprovare, oppure chiamaci al ' + TELEFONO_LABEL + '.'
        : e.message;
      render();
    });
  }

  function copiaCodice(btn) {
    var testo = S.booking.codice;
    var fatto = function () { btn.textContent = 'Codice copiato ✓'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(testo).then(fatto, function () { btn.textContent = testo; });
    } else {
      btn.textContent = testo;
    }
  }

  function scaricaIcs() {
    var b = S.booking;
    function fmt(s) { return s.replace(/[-:]/g, '') + '00'; }
    var ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barber Shop Ernest//IT',
      'BEGIN:VEVENT',
      'UID:' + b.codice + '@barberernest',
      'DTSTAMP:' + fmt(E.stamp(new Date())),
      'DTSTART:' + fmt(b.inizio),
      'DTEND:' + fmt(b.fine),
      'SUMMARY:Barber Shop Ernest — ' + b.servizi.map(function (s) { return s.nome; }).join(', '),
      'LOCATION:Corso Giuseppe Mazzini 128\\, 48018 Faenza RA',
      'DESCRIPTION:Codice prenotazione ' + b.codice,
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');

    var a = document.createElement('a');
    a.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    a.download = 'ernest-' + b.codice + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ------------------------------------------------------- gestione/disdetta */

  function renderGestisci() {
    elTitolo.textContent = 'Gestisci prenotazione';
    elCrumbs.innerHTML = '';
    overlay.dataset.cart = 'false';
    elFoot.parentElement.style.display = 'none';
    elH.textContent = 'La tua prenotazione.';

    var esito = S.esitoGestione;
    var corpo;

    if (esito && esito.tipo === 'cancellata') {
      corpo = '<div class="bk-code"><b>Disdetta</b><small>Prenotazione ' + esito.codice + ' annullata</small></div>' +
        '<p class="bk-sub">L\'orario è tornato libero. Se cambi idea puoi prenotare di nuovo.</p>' +
        '<button class="bk-cta bk-cta-ghost" type="button" data-act="prenota">Prenota di nuovo</button>';
    } else if (esito && esito.tipo === 'guasto') {
      corpo = '<p class="bk-error">' + esc(esito.messaggio) + '</p>' +
        '<p class="bk-sub">Il tuo appuntamento resta valido: non è stato disdetto niente. ' +
        'Se devi annullare, chiamaci.</p>' +
        '<div class="bk-actions">' +
          '<a href="tel:' + TELEFONO + '">Chiama ' + esc(TELEFONO_LABEL) + '</a>' +
          '<a href="https://wa.me/' + TELEFONO.replace('+', '') +
            '" target="_blank" rel="noopener">Scrivi su WhatsApp</a>' +
        '</div>' +
        '<button class="bk-link" type="button" data-act="gestisci">Riprova</button>';
    } else if (esito && esito.tipo === 'troppo_tardi') {
      var tel = E.db.settings.telefono;
      corpo = '<p class="bk-error">Mancano meno di ' + esito.ore + ' ore al tuo appuntamento. ' +
        'Per disdire chiama direttamente il negozio.</p>' +
        '<div class="bk-actions">' +
          '<a href="tel:' + tel + '">Chiama ' + esc(E.db.settings.telefonoLabel) + '</a>' +
          '<a href="https://wa.me/' + tel.replace('+', '') + '?text=' +
            encodeURIComponent('Ciao, devo disdire la prenotazione ' + esito.codice + '.') +
            '" target="_blank" rel="noopener">Scrivi su WhatsApp</a>' +
        '</div>';
    } else {
      corpo = '<p class="bk-sub">Inserisci il codice che hai ricevuto e il numero usato per prenotare.</p>' +
        '<label class="bk-field"><span>Codice prenotazione</span>' +
          '<input name="codice" type="text" placeholder="ERN-0000" value="' + esc(S.codice || '') + '"></label>' +
        '<label class="bk-field"><span>Telefono</span>' +
          '<input name="telefono" type="tel" inputmode="tel" value="' + esc(S.telefono) + '"></label>' +
        (esito && esito.tipo === 'non_trovata'
          ? '<p class="bk-error">Nessuna prenotazione trovata con questi dati.</p>' : '') +
        (S.trovata ? schedaTrovata() : '') +
        '<button class="bk-cta" type="button" data-act="cerca" style="width:100%;margin-top:8px">Cerca prenotazione</button>' +
        '<button class="bk-link" type="button" data-act="prenota">Torna alla prenotazione</button>';
    }

    elBody.innerHTML = corpo;
    elBody.closest('.bk-body').scrollTop = 0;
  }

  function schedaTrovata() {
    var b = S.trovata;
    var barbiere = E.byId(E.db.barbers, b.barberId);
    if (b.stato !== 'confermata') {
      return '<div class="bk-empty">Questa prenotazione risulta ' +
        (b.stato === 'cancellata' ? 'già annullata' : b.stato) + '.</div>';
    }
    return '<dl class="bk-recap">' +
      '<div class="bk-recap-row"><dt>Quando</dt><dd>' + esc(E.labelData(E.parse(b.inizio))) +
        '<br>ore ' + b.inizio.slice(11) + '</dd></div>' +
      '<div class="bk-recap-row"><dt>Barbiere</dt><dd>' + esc(barbiere ? barbiere.nome : '—') + '</dd></div>' +
      '<div class="bk-recap-row"><dt>Servizi</dt><dd>' +
        b.servizi.map(function (s) { return esc(s.nome); }).join('<br>') + '</dd></div>' +
      '<div class="bk-recap-row bk-recap-total"><dt>Totale</dt><dd>' + E.euro(b.prezzo) + '</dd></div></dl>' +
      '<div class="bk-actions"><button type="button" data-act="annulla-prenotazione">Disdici appuntamento</button></div>';
  }

  function cercaPrenotazione() {
    E.cercaConCodice(S.codice, S.telefono).then(function (b) {
      S.trovata = b;
      S.esitoGestione = b ? null : { tipo: 'non_trovata' };
      renderGestisci();
    }, function (e) {
      S.trovata = null;
      S.esitoGestione = { tipo: 'guasto', messaggio: e.message };
      renderGestisci();
    });
  }

  function annullaPrenotazione() {
    E.cancellaConCodice(S.codice, S.telefono).then(function (res) {
      if (res.ok) {
        S.esitoGestione = { tipo: 'cancellata', codice: res.booking.codice };
      } else if (res.motivo === 'troppo_tardi') {
        S.esitoGestione = { tipo: 'troppo_tardi', ore: res.ore, codice: res.booking.codice };
      } else {
        S.esitoGestione = { tipo: 'non_trovata' };
      }
      S.trovata = null;
      renderGestisci();
    }, function (e) {
      /* Disdetta non riuscita: il cliente deve sapere che l'appuntamento è
         ancora in piedi, altrimenti semplicemente non si presenta. */
      S.esitoGestione = { tipo: 'guasto', messaggio: e.message };
      renderGestisci();
    });
  }

  /* ------------------------------------------------------------- innesto */

  function montaIngresso() {
    var root = document.getElementById('booking-root');
    if (!root) return;
    // la sezione ha già il suo "Prenota ora": qui serve solo la via d'uscita
    // per chi ha prenotato e deve spostare o disdire.
    root.innerHTML =
      '<div class="bk bk-inline">' +
        '<p>Hai già un appuntamento? Ti bastano il codice e il numero che hai usato.</p>' +
        '<button class="bk-cta bk-cta-ghost" type="button" data-booking-manage>Gestisci prenotazione</button>' +
      '</div>';
  }

  function avvia() {
    costruisci();
    montaIngresso();

    /* Si parte subito, senza aspettare un click: quando il cliente apre il
       riquadro lo stato è quasi sempre già lì.
       La copia in cache va bene per leggere, non per prenotare: se siamo
       offline la conferma fallirebbe comunque, meglio dirlo subito. */
    connessione = E.avviaClient({ api: CFG.api }).then(function (esito) {
      if (esito.daCache) throw new Error('Il sistema di prenotazione non risponde.');
      return esito;
    });
    connessione.then(function () { statoPronto = true; }, function () { /* gestito all'apertura */ });

    document.addEventListener('click', function (ev) {
      if (ev.target.closest('[data-booking-trigger]')) { ev.preventDefault(); apri('prenota'); }
      else if (ev.target.closest('[data-booking-manage]')) { ev.preventDefault(); apri('gestisci'); }
    });

    if (/[?&#]gestisci/.test(location.search + location.hash)) apri('gestisci');

    console.assert(document.querySelectorAll('[data-booking-trigger]').length >= 3,
      'Booking: mancano i pulsanti di apertura');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();

})(typeof window !== 'undefined' ? window : globalThis,
   (typeof window !== 'undefined' ? window : globalThis).ErnestBooking);

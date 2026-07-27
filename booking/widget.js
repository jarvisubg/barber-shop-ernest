/* Barber Shop Ernest — flusso di prenotazione pubblico.
   Si aggancia ai bottoni [data-booking-trigger] già presenti nella pagina e
   monta il riquadro d'ingresso dentro #booking-root. */
(function (global, E) {
  'use strict';
  if (!E) return;

  var STEPS = ['lunghezza', 'servizi', 'barbiere', 'quando', 'dati', 'riepilogo', 'fatto'];
  var TITOLI = {
    lunghezza: 'Come porti i capelli?',
    servizi: 'Cosa ti serve.',
    barbiere: 'Con chi.',
    quando: 'Quando.',
    dati: 'I tuoi dati.',
    riepilogo: 'Controlla e conferma.',
    fatto: 'Ci vediamo.'
  };

  var S = null;
  var overlay, elBody, elFoot, elStep, elBar;

  function nuovoStato() {
    return {
      vista: 'prenota',        // 'prenota' | 'gestisci'
      step: 0,
      lunghezza: null,
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
            '<span class="bk-step-label" data-el="step"></span>' +
            '<button class="bk-icon-btn" type="button" data-act="chiudi" aria-label="Chiudi">✕</button>' +
          '</div>' +
          '<div class="bk-progress"><span data-el="bar" style="width:0%"></span></div>' +
        '</div>' +
        '<div class="bk-body"><div class="bk-shell" data-el="body"></div></div>' +
        '<div class="bk-foot"><div class="bk-shell bk-foot-row" data-el="foot"></div></div>' +
      '</div>'
    );
    document.body.appendChild(overlay);
    elBody = overlay.querySelector('[data-el="body"]');
    elFoot = overlay.querySelector('[data-el="foot"]');
    elStep = overlay.querySelector('[data-el="step"]');
    elBar = overlay.querySelector('[data-el="bar"]');

    overlay.addEventListener('click', onClick);
    overlay.addEventListener('input', onInput);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && overlay.dataset.open === 'true') chiudi();
    });
  }

  function apri(vista) {
    S = nuovoStato();
    if (vista) S.vista = vista;
    overlay.dataset.open = 'true';
    document.body.classList.add('bk-locked');
    render();
  }

  function chiudi() {
    overlay.dataset.open = 'false';
    document.body.classList.remove('bk-locked');
  }

  /* --------------------------------------------------------------- eventi */

  function onClick(ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act;

    if (act === 'chiudi') return chiudi();
    if (act === 'indietro') return indietro();
    if (act === 'avanti') return avanti();
    if (act === 'gestisci') { S = nuovoStato(); S.vista = 'gestisci'; return render(); }
    if (act === 'prenota') { S = nuovoStato(); return render(); }

    if (act === 'lunghezza') {
      S.lunghezza = b.dataset.val;
      S.step = 1;
      return render();
    }

    if (act === 'servizio') {
      toggleServizio(b.dataset.id);
      return render();
    }

    if (act === 'barbiere') {
      S.barberId = b.dataset.id === 'auto' ? null : b.dataset.id;
      S.ora = null; S.barberAssegnato = null;
      S.step = 3;
      return render();
    }

    if (act === 'giorno') { S.dataKey = b.dataset.key; S.ora = null; return render(); }

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
    if (t.name === 'consenso' || t.name === 'telefono' || t.name === 'nome' || t.name === 'cognome') {
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
    S.ora = null;
    S.errore = null;
  }

  /* --------------------------------------------------------- navigazione */

  function puoAvanzare() {
    switch (STEPS[S.step]) {
      case 'lunghezza': return !!S.lunghezza;
      case 'servizi': return !E.validaSelezione(S.serviziIds);
      case 'barbiere': return S.barberId !== undefined;
      case 'quando': return !!(S.dataKey && S.ora);
      case 'dati':
        return !!(String(S.nome).trim() && String(S.cognome).trim() &&
          E.telefonoValido(S.telefono) && S.consenso);
      case 'riepilogo': return true;
      default: return false;
    }
  }

  function avanti() {
    if (STEPS[S.step] === 'servizi') {
      var err = E.validaSelezione(S.serviziIds);
      if (err) { S.errore = err; return render(); }
    }
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
    elStep.textContent = nome === 'fatto' ? 'Confermata'
      : 'Passo ' + (S.step + 1) + ' di ' + (STEPS.length - 1);
    elBar.style.width = ((S.step / (STEPS.length - 1)) * 100) + '%';

    elBody.innerHTML = '<h2 class="bk-h">' + TITOLI[nome] + '</h2>' + VISTE[nome]();
    if (S.errore) elBody.insertAdjacentHTML('beforeend', '<p class="bk-error">' + esc(S.errore) + '</p>');
    elBody.parentElement.scrollTop = 0;
    aggiornaPiede();
  }

  function aggiornaPiede() {
    var nome = STEPS[S.step];
    if (nome === 'fatto') { elFoot.innerHTML = ''; elFoot.parentElement.style.display = 'none'; return; }
    elFoot.parentElement.style.display = '';

    var t = totali();
    var righe = t.servizi.length
      ? t.servizi.length + (t.servizi.length === 1 ? ' servizio · ' : ' servizi · ') + E.durataLabel(t.durata)
      : 'Nessun servizio selezionato';

    var etichetta = nome === 'riepilogo' ? 'Conferma prenotazione' : 'Continua';
    var azione = nome === 'riepilogo' ? 'conferma' : 'avanti';

    elFoot.innerHTML =
      '<div class="bk-total">' +
        '<span class="bk-total-main">' + (t.prezzo ? E.euro(t.prezzo) : '—') + '</span>' +
        '<span class="bk-total-sub">' + esc(righe) + '</span>' +
      '</div>' +
      '<button class="bk-cta" type="button" data-act="' + azione + '"' +
        (puoAvanzare() ? '' : ' disabled') + '>' + etichetta + '</button>';
  }

  function conferma() {
    var cta = elFoot.querySelector('.bk-cta');
    if (cta) { cta.disabled = true; cta.textContent = 'Invio…'; }

    var res = E.creaPrenotazione({
      serviziIds: S.serviziIds,
      nome: S.nome, cognome: S.cognome, telefono: S.telefono,
      barberId: S.barberAssegnato || S.barberId || null,
      inizio: S.dataKey + 'T' + S.ora,
      lunghezzaCapelli: S.lunghezza,
      note: S.note,
      consenso: S.consenso,
      origine: 'online'
    });

    if (!res.ok) {
      S.errore = res.error;
      // se lo slot è saltato, si torna alla scelta dell'orario
      if (/orario/.test(res.error)) { S.ora = null; S.step = 3; }
      return render();
    }

    S.booking = res.booking;
    S.errore = null;
    S.step = STEPS.indexOf('fatto');
    render();
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
    elStep.textContent = 'Gestisci prenotazione';
    elBar.style.width = '0%';
    elFoot.parentElement.style.display = 'none';

    var esito = S.esitoGestione;
    var corpo;

    if (esito && esito.tipo === 'cancellata') {
      corpo = '<div class="bk-code"><b>Disdetta</b><small>Prenotazione ' + esito.codice + ' annullata</small></div>' +
        '<p class="bk-sub">L\'orario è tornato libero. Se cambi idea puoi prenotare di nuovo.</p>' +
        '<button class="bk-cta bk-cta-ghost" type="button" data-act="prenota">Prenota di nuovo</button>';
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

    elBody.innerHTML = '<h2 class="bk-h">La tua prenotazione.</h2>' + corpo;
    elBody.parentElement.scrollTop = 0;
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
    var b = E.cercaConCodice(S.codice, S.telefono);
    S.trovata = b;
    S.esitoGestione = b ? null : { tipo: 'non_trovata' };
    renderGestisci();
  }

  function annullaPrenotazione() {
    var res = E.cancellaConCodice(S.codice, S.telefono);
    if (res.ok) {
      S.esitoGestione = { tipo: 'cancellata', codice: res.booking.codice };
    } else if (res.motivo === 'troppo_tardi') {
      S.esitoGestione = { tipo: 'troppo_tardi', ore: res.ore, codice: res.booking.codice };
    } else {
      S.esitoGestione = { tipo: 'non_trovata' };
    }
    S.trovata = null;
    renderGestisci();
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

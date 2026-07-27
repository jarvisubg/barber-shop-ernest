/* Barber Shop Ernest — gestionale: nucleo, calendario e lista del giorno.
   Le schede anagrafiche e le finestre di prenotazione stanno nei moduli
   admin-anagrafiche.js e admin-prenotazioni.js, che si agganciano a
   ErnestAdmin. L'avvio è esplicito (ErnestAdmin.avvia) perché i moduli
   devono essersi registrati prima del primo render. */
(function (global, E) {
  'use strict';
  if (!E) return;

  var PPM = 1.5;                 // pixel per minuto nella vista giorno
  var V = { tab: 'calendario', dataKey: E.dayKey(new Date()), vista: 'giorno', filtro: '' };
  var A = global.ErnestAdmin = { E: E, V: V, viste: {} };

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function barbiere(id) { return E.byId(E.db.barbers, id); }
  function attivi() {
    return E.db.barbers.filter(function (b) { return b.attivo; })
      .sort(function (a, b) { return a.ordine - b.ordine; });
  }
  function visibili() {
    return attivi().filter(function (b) { return !V.filtro || b.id === V.filtro; });
  }

  A.$ = $; A.esc = esc; A.barbiere = barbiere; A.attivi = attivi;

  /* --------------------------------------------------------------- login */

  $('#login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pw = ev.target.pw.value;
    if (pw !== E.db.settings.adminPassword) { $('#login-err').hidden = false; return; }
    try { sessionStorage.setItem('ernest-admin', '1'); } catch (e) { /* ignore */ }
    entra();
  });

  function entra() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#oggi-info').textContent = E.labelData(new Date());
    render();
  }

  A.avvia = function () {
    try { if (sessionStorage.getItem('ernest-admin') === '1') entra(); } catch (e) { /* ignore */ }
  };

  /* --------------------------------------------------------------- tabs */

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      V.tab = t.dataset.tab;
      document.querySelectorAll('.tab').forEach(function (x) {
        x.setAttribute('aria-selected', String(x.dataset.tab === V.tab));
      });
      // selettore ancorato a #gest-main: nella demo unificata il gestionale
      // convive con il sito, che ha un <main> con le sue <section>
      document.querySelectorAll('#gest-main section').forEach(function (s) {
        s.hidden = s.id !== 'tab-' + V.tab;
      });
      render();
    });
  });

  $('#btn-reset').addEventListener('click', function () {
    if (!confirm('Ripristina i dati dimostrativi? Le prenotazioni create a mano andranno perse.')) return;
    E.reset();
    render();
  });

  function render() {
    var fn = A.viste[V.tab];
    if (fn) fn();
  }

  A.viste.calendario = renderCalendario;
  A.viste.lista = renderLista;
  A.render = render;

  /* ---------------------------------------------------------- calendario */

  function estremiGiorno(key) {
    var wd = E.weekday(E.at(key, 0));
    var da = 24 * 60, a = 0;
    E.db.workingHours.forEach(function (w) {
      if (w.giorno !== wd) return;
      da = Math.min(da, E.toMin(w.inizio));
      a = Math.max(a, E.toMin(w.fine));
    });
    // giorno di chiusura totale: si mostra comunque una finestra utile
    if (da >= a) { da = 9 * 60; a = 21 * 60; }
    return [da - 30, a + 30];
  }

  /* Il gestionale permette di forzare le sovrapposizioni (il barbiere che
     incastra un cliente di persona). Senza corsie affiancate i due blocchi si
     coprirebbero a vicenda. Le corsie si contano per grappolo di appuntamenti
     che si toccano, così una giornata normale resta a piena larghezza. */
  function inCorsie(pren) {
    var lista = pren.slice().sort(function (a, b) {
      return a.inizio.localeCompare(b.inizio) || a.fine.localeCompare(b.fine);
    });
    var out = [], grappolo = [], fineGrappolo = '';

    function chiudi() {
      if (!grappolo.length) return;
      var code = [];
      grappolo.forEach(function (x) {
        var i = 0;
        while (i < code.length && code[i] > x.b.inizio) i++;
        code[i] = x.b.fine;
        x.corsia = i;
      });
      grappolo.forEach(function (x) { x.corsie = code.length; });
      out = out.concat(grappolo);
      grappolo = [];
    }

    lista.forEach(function (b) {
      if (grappolo.length && b.inizio >= fineGrappolo) { chiudi(); fineGrappolo = ''; }
      grappolo.push({ b: b, corsia: 0, corsie: 1 });
      if (b.fine > fineGrappolo) fineGrappolo = b.fine;
    });
    chiudi();
    return out;
  }

  function bloccoEvento(x, dal) {
    var b = x.b;
    var i = E.parse(b.inizio), f = E.parse(b.fine);
    var min = i.getHours() * 60 + i.getMinutes();
    var dur = Math.round((f - i) / 60000);
    var col = (barbiere(b.barberId) || {}).colore || '#c9cdd0';
    var largh = 100 / x.corsie;
    return '<button class="ev" data-ev="' + b.id + '" data-stato="' + b.stato + '"' +
      ' style="top:' + ((min - dal) * PPM) + 'px;height:' + Math.max(dur * PPM - 2, 22) + 'px;' +
      'left:calc(' + (x.corsia * largh) + '% + 3px);width:calc(' + largh + '% - 6px);' +
      'border-color:' + esc(col) + '">' +
      '<b>' + b.inizio.slice(11) + ' · ' + esc(b.nome) + ' ' + esc(b.cognome.charAt(0)) + '.</b>' +
      '<small>' + esc(b.servizi.map(function (s) { return s.nome; }).join(' + ')) + '</small></button>';
  }

  function fasceLibereBarbiere(barberId, key, dal, al) {
    // aree NON lavorative: complemento delle fasce di working_hours, più ferie e chiusure
    var wd = E.weekday(E.at(key, 0));
    var fasce = E.db.workingHours.filter(function (w) {
      return w.barberId === barberId && w.giorno === wd;
    }).map(function (w) { return [E.toMin(w.inizio), E.toMin(w.fine)]; })
      .sort(function (a, b) { return a[0] - b[0]; });

    var out = [], cur = dal;
    fasce.forEach(function (f) {
      if (f[0] > cur) out.push([cur, f[0], 'chiuso']);
      cur = Math.max(cur, f[1]);
    });
    if (cur < al) out.push([cur, al, 'chiuso']);

    // ferie e chiusure possono durare più giorni: su quelli intermedi vanno
    // ritagliate all'intera giornata, non lette con gli orari del primo giorno
    function ritaglia(r, etichetta) {
      if (r.inizio.slice(0, 10) > key || r.fine.slice(0, 10) < key) return;
      out.push([
        r.inizio.slice(0, 10) === key ? E.toMin(r.inizio.slice(11)) : 0,
        r.fine.slice(0, 10) === key ? E.toMin(r.fine.slice(11)) : 24 * 60,
        etichetta
      ]);
    }

    E.db.timeOff.forEach(function (t) {
      if (t.barberId === barberId) ritaglia(t, t.motivo || 'Assente');
    });
    E.db.closures.forEach(function (c) { ritaglia(c, c.motivo || 'Chiuso'); });
    return out;
  }

  function renderCalendario() {
    var box = $('#tab-calendario');
    var d = E.at(V.dataKey, 0);

    var titolo = E.labelData(d);
    if (V.vista === 'settimana') {
      var lu = E.addDays(d, -(E.weekday(d) - 1)), sa = E.addDays(lu, 6);
      titolo = lu.getDate() + ' ' + E.MESI[lu.getMonth()] + ' – ' + sa.getDate() + ' ' + E.MESI[sa.getMonth()];
    }

    var testa =
      '<div class="cal-head">' +
        '<span class="cal-title">' + esc(titolo) + '</span>' +
        '<div class="stack">' +
          '<button class="btn btn-sm" data-nav="-1">‹ Prec</button>' +
          '<button class="btn btn-sm" data-nav="oggi">Oggi</button>' +
          '<button class="btn btn-sm" data-nav="1">Succ ›</button>' +
          '<input type="date" value="' + V.dataKey + '" data-nav="data" style="width:auto">' +
        '</div>' +
        '<div class="stack">' +
          '<select data-filtro style="width:auto"><option value="">Tutti i barbieri</option>' +
            attivi().map(function (b) {
              return '<option value="' + b.id + '"' + (V.filtro === b.id ? ' selected' : '') + '>' + esc(b.nome) + '</option>';
            }).join('') + '</select>' +
          '<button class="btn btn-sm' + (V.vista === 'giorno' ? ' btn-solid' : '') + '" data-vista="giorno">Giorno</button>' +
          '<button class="btn btn-sm' + (V.vista === 'settimana' ? ' btn-solid' : '') + '" data-vista="settimana">Settimana</button>' +
          '<button class="btn btn-sm btn-solid" data-nuova>+ Prenotazione</button>' +
        '</div>' +
      '</div>';

    box.innerHTML = testa + (V.vista === 'giorno' ? vistaGiorno() : vistaSettimana());
    collegaCalendario(box);
  }

  function vistaGiorno() {
    var key = V.dataKey;
    var est = estremiGiorno(key), dal = est[0], al = est[1];
    var altezza = (al - dal) * PPM;
    var lista = visibili();

    if (!lista.length) return '<div class="card muted">Nessun barbiere attivo.</div>';

    // le etichette sono in posizione assoluta: il padding del contenitore non le
    // sposta, quindi l'altezza dell'intestazione di colonna va sommata a mano
    var TESTA = 34;
    var ore = '';
    for (var m = Math.ceil(dal / 60) * 60; m <= al; m += 60) {
      ore += '<i style="top:' + ((m - dal) * PPM + TESTA) + 'px">' + E.toHHMM(m) + '</i>';
    }

    var colonne = lista.map(function (b) {
      // le cancellate escono dal calendario: occuperebbero spazio e si
      // sovrapporrebbero a quelle vive. Restano visibili nella lista del giorno.
      var pren = E.prenotazioniDel(key).filter(function (x) {
        return x.barberId === b.id && x.stato !== 'cancellata';
      });
      var off = fasceLibereBarbiere(b.id, key, dal, al).map(function (f) {
        var top = Math.max(f[0], dal), bot = Math.min(f[1], al);
        if (bot <= top) return '';
        return '<div class="off" style="top:' + ((top - dal) * PPM) + 'px;height:' +
          ((bot - top) * PPM) + 'px"><b>' + esc(f[2]) + '</b></div>';
      }).join('');

      var righe = '';
      for (var m2 = Math.ceil(dal / 30) * 30; m2 <= al; m2 += 30) {
        righe += '<div class="hour' + (m2 % 60 ? ' half' : '') + '" style="top:' + ((m2 - dal) * PPM) + 'px"></div>';
      }

      return '<div class="col">' +
        '<div class="col-head"><span class="dot" style="background:' + esc(b.colore) + '"></span>' + esc(b.nome) + '</div>' +
        '<div class="track" data-track="' + b.id + '" data-dal="' + dal + '" style="height:' + altezza + 'px">' +
        righe + off + inCorsie(pren).map(function (x) { return bloccoEvento(x, dal); }).join('') +
        '</div></div>';
    }).join('');

    return '<div class="cal">' +
      '<div class="gutter">' + ore + '</div>' +
      '<div class="cols" style="grid-template-columns:repeat(' + lista.length + ',minmax(0,1fr))">' +
        colonne + '</div></div>' +
      '<p class="muted" style="margin-top:10px;font-size:.82rem">Clicca su uno spazio libero per inserire una prenotazione, su un appuntamento per aprirlo.</p>';
  }

  function vistaSettimana() {
    var d = E.at(V.dataKey, 0);
    var lun = E.addDays(d, -(E.weekday(d) - 1));
    var giorni = '';
    for (var i = 0; i < 7; i++) {
      var g = E.addDays(lun, i);
      var key = E.dayKey(g);
      var pren = E.prenotazioniDel(key).filter(function (b) {
        return b.stato !== 'cancellata' && (!V.filtro || b.barberId === V.filtro);
      });
      giorni += '<div class="wday"><h4>' + E.GIORNI[E.weekday(g)].slice(0, 3) + ' ' + g.getDate() + '</h4>' +
        (pren.length ? pren.map(function (b) {
          var col = (barbiere(b.barberId) || {}).colore || '#c9cdd0';
          return '<button class="ev" data-ev="' + b.id + '" data-stato="' + b.stato + '" style="border-color:' + esc(col) + '">' +
            '<b>' + b.inizio.slice(11) + ' ' + esc(b.nome) + '</b>' +
            '<small>' + esc((barbiere(b.barberId) || {}).nome || '') + '</small></button>';
        }).join('') : '<span class="muted" style="font-size:.8rem">—</span>') + '</div>';
    }
    return '<div class="week">' + giorni + '</div>';
  }

  function collegaCalendario(box) {
    box.querySelectorAll('[data-nav]').forEach(function (b) {
      var ev = b.tagName === 'INPUT' ? 'change' : 'click';
      b.addEventListener(ev, function () {
        var v = b.dataset.nav;
        if (v === 'oggi') V.dataKey = E.dayKey(new Date());
        else if (v === 'data') V.dataKey = b.value;
        else V.dataKey = E.dayKey(E.addDays(E.at(V.dataKey, 0), V.vista === 'settimana' ? Number(v) * 7 : Number(v)));
        render();
      });
    });
    var sel = box.querySelector('[data-filtro]');
    if (sel) sel.addEventListener('change', function () { V.filtro = sel.value; render(); });
    box.querySelectorAll('[data-vista]').forEach(function (b) {
      b.addEventListener('click', function () { V.vista = b.dataset.vista; render(); });
    });
    var nuova = box.querySelector('[data-nuova]');
    if (nuova) nuova.addEventListener('click', function () { A.formPrenotazione(null, {}); });

    box.querySelectorAll('[data-ev]').forEach(function (b) {
      b.addEventListener('click', function () { A.dettaglio(b.dataset.ev); });
    });

    box.querySelectorAll('[data-track]').forEach(function (t) {
      t.addEventListener('click', function (ev) {
        if (ev.target.closest('.ev')) return;
        var y = ev.clientY - t.getBoundingClientRect().top;
        var dal = Number(t.dataset.dal);
        var gran = E.db.settings.slotGranularita;
        var min = Math.round((dal + y / PPM) / gran) * gran;
        A.formPrenotazione(null, { barberId: t.dataset.track, dataKey: V.dataKey, ora: E.toHHMM(min) });
      });
    });
  }

  /* -------------------------------------------------------- lista giorno */

  function renderLista() {
    var key = V.dataKey;
    var pren = E.prenotazioniDel(key).filter(function (b) { return !V.filtro || b.barberId === V.filtro; });
    var incasso = pren.filter(function (b) { return b.stato !== 'cancellata' && b.stato !== 'no_show'; })
      .reduce(function (a, b) { return a + b.prezzo; }, 0);

    $('#tab-lista').innerHTML =
      '<div class="cal-head">' +
        '<span class="cal-title">' + esc(E.labelData(E.at(key, 0))) + '</span>' +
        '<div class="stack">' +
          '<button class="btn btn-sm" data-nav="-1">‹</button>' +
          '<button class="btn btn-sm" data-nav="oggi">Oggi</button>' +
          '<button class="btn btn-sm" data-nav="1">›</button>' +
          '<input type="date" value="' + key + '" data-nav="data" style="width:auto">' +
        '</div>' +
        '<div><span class="muted" style="font-size:.7rem;letter-spacing:.14em;text-transform:uppercase">Previsto</span>' +
        '<div class="totale">' + E.euro(incasso) + '</div></div>' +
      '</div>' +
      (pren.length
        ? '<table><thead><tr><th>Ora</th><th>Cliente</th><th>Servizi</th><th>Barbiere</th><th>Tot.</th><th>Stato</th><th></th></tr></thead><tbody>' +
          pren.map(function (b) {
            return '<tr><td class="num">' + b.inizio.slice(11) + '<br><span class="muted" style="font-size:.72rem">' +
              E.durataLabel(b.durata) + '</span></td>' +
              '<td>' + esc(b.nome) + ' ' + esc(b.cognome) + '<br><a class="muted" href="tel:' + esc(b.telefono) + '">' + esc(b.telefono) + '</a>' +
              (b.note ? '<br><span class="muted">“' + esc(b.note) + '”</span>' : '') + '</td>' +
              '<td>' + esc(b.servizi.map(function (s) { return s.nome; }).join(', ')) +
              (b.lunghezzaCapelli ? '<br><span class="muted" style="font-size:.74rem">capelli: ' +
                ({ lunghi: 'lunghi', corti: 'corti', solo_barba: 'solo barba' })[b.lunghezzaCapelli] + '</span>' : '') + '</td>' +
              '<td>' + esc((barbiere(b.barberId) || {}).nome || '—') + '</td>' +
              '<td class="num">' + E.euro(b.prezzo) + '</td>' +
              '<td><span class="pill" data-s="' + b.stato + '">' + b.stato.replace('_', ' ') + '</span><br>' +
              '<span class="muted" style="font-size:.7rem">' + b.codice + '</span></td>' +
              '<td><div class="stack">' +
                '<a class="btn btn-sm" href="tel:' + esc(b.telefono) + '">Chiama</a>' +
                '<button class="btn btn-sm" data-ev="' + b.id + '">Apri</button>' +
              '</div></td></tr>';
          }).join('') + '</tbody></table>'
        : '<div class="card muted">Nessuna prenotazione in questa giornata.</div>');

    collegaCalendario($('#tab-lista'));
  }

  /* --------------------------------------------------------- modale base */

  function apriModale(html, onMount) {
    var m = $('#modal'), box = $('#modal-box');
    box.innerHTML = html;
    m.dataset.open = 'true';
    box.querySelectorAll('[data-chiudi]').forEach(function (b) {
      b.addEventListener('click', chiudiModale);
    });
    if (onMount) onMount(box);
  }
  function chiudiModale() { $('#modal').dataset.open = 'false'; }

  A.apriModale = apriModale; A.chiudiModale = chiudiModale;
  $('#modal').addEventListener('click', function (ev) { if (ev.target === $('#modal')) chiudiModale(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') chiudiModale(); });

})(typeof window !== 'undefined' ? window : globalThis,
   (typeof window !== 'undefined' ? window : globalThis).ErnestBooking);

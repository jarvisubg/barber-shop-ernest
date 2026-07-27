/* Barber Shop Ernest — gestionale: barbieri, orari, ferie, listino, chiusure e impostazioni.
   Si registra su ErnestAdmin, il namespace creato da admin.js. */
(function (global) {
  'use strict';
  var A = global.ErnestAdmin;
  var E = A.E, V = A.V, $ = A.$, esc = A.esc;
  var barbiere = A.barbiere, attivi = A.attivi;
  var apriModale = A.apriModale, chiudiModale = A.chiudiModale, render = A.render;

  A.viste.barbieri = renderBarbieri;
  A.viste.servizi = renderServizi;
  A.viste.chiusure = renderChiusure;
  A.viste.impostazioni = renderImpostazioni;

  /* ------------------------------------------------------------ barbieri */

  function renderBarbieri() {
    $('#tab-barbieri').innerHTML =
      '<div class="cal-head"><span class="cal-title">Barbieri</span>' +
      '<button class="btn btn-sm btn-solid" data-nuovo>+ Barbiere</button></div>' +
      E.db.barbers.slice().sort(function (a, b) { return a.ordine - b.ordine; }).map(function (b) {
        var wd = {};
        E.db.workingHours.filter(function (w) { return w.barberId === b.id; })
          .forEach(function (w) { (wd[w.giorno] = wd[w.giorno] || []).push(w.inizio + '–' + w.fine); });
        var orari = [1, 2, 3, 4, 5, 6, 7].map(function (g) {
          return '<tr><th style="width:110px">' + E.GIORNI[g] + '</th><td>' +
            (wd[g] ? wd[g].sort().join(' · ') : '<span class="muted">riposo</span>') + '</td></tr>';
        }).join('');
        var ferie = E.db.timeOff.filter(function (t) { return t.barberId === b.id; });
        var future = E.prenotazioniFuture(b.id).length;

        return '<div class="card">' +
          '<div class="row-between"><h3><span class="dot" style="display:inline-block;background:' + esc(b.colore) + '"></span> ' +
            esc(b.nome) + (b.attivo ? '' : ' <span class="pill">non attivo</span>') + '</h3>' +
          '<div class="stack">' +
            '<button class="btn btn-sm" data-edit="' + b.id + '">Modifica</button>' +
            '<button class="btn btn-sm" data-orari="' + b.id + '">Orari</button>' +
            '<button class="btn btn-sm" data-ferie="' + b.id + '">Ferie</button>' +
            '<button class="btn btn-sm btn-bad" data-del="' + b.id + '">Elimina</button>' +
          '</div></div>' +
          '<p class="muted" style="margin:6px 0 12px">' + esc(b.specialita || '') +
            ' · ' + future + ' appuntamenti futuri</p>' +
          '<table><tbody>' + orari + '</tbody></table>' +
          (ferie.length ? '<p class="muted" style="margin-top:10px">Assenze: ' +
            ferie.map(function (t) {
              return esc(t.inizio.replace('T', ' ') + ' → ' + t.fine.replace('T', ' ') + ' (' + (t.motivo || '—') + ')');
            }).join(' · ') + '</p>' : '') +
        '</div>';
      }).join('');

    var box = $('#tab-barbieri');
    box.querySelector('[data-nuovo]').addEventListener('click', function () { formBarbiere(null); });
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { formBarbiere(b.dataset.edit); });
    });
    box.querySelectorAll('[data-orari]').forEach(function (b) {
      b.addEventListener('click', function () { formOrari(b.dataset.orari); });
    });
    box.querySelectorAll('[data-ferie]').forEach(function (b) {
      b.addEventListener('click', function () { formFerie(b.dataset.ferie); });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = E.prenotazioniFuture(b.dataset.del).length;
        var msg = n ? 'Questo barbiere ha ' + n + ' appuntamenti futuri già presi.\n' +
          'Eliminandolo restano orfani: meglio disattivarlo dalla scheda.\nProcedere comunque?'
          : 'Eliminare questo barbiere?';
        if (!confirm(msg)) return;
        E.rimuovi('barbers', b.dataset.del);
        render();
      });
    });
  }

  function formBarbiere(id) {
    var b = id ? barbiere(id) : { nome: '', specialita: '', colore: '#c9cdd0', ordine: E.db.barbers.length + 1, attivo: true };
    apriModale(
      '<h2>' + (id ? 'Modifica barbiere' : 'Nuovo barbiere') + '</h2>' +
      '<label class="f"><span>Nome</span><input type="text" name="nome" value="' + esc(b.nome) + '"></label>' +
      '<label class="f"><span>Specialità</span><input type="text" name="spec" value="' + esc(b.specialita || '') + '"></label>' +
      '<div class="grid2">' +
        '<label class="f"><span>Colore calendario</span><input type="color" name="colore" value="' + esc(b.colore) + '" style="height:40px;padding:3px"></label>' +
        '<label class="f"><span>Ordine</span><input type="number" name="ordine" value="' + b.ordine + '" min="1"></label>' +
      '</div>' +
      '<label style="display:flex;gap:9px;align-items:center;margin-bottom:16px;cursor:pointer">' +
        '<input type="checkbox" name="attivo"' + (b.attivo ? ' checked' : '') + ' style="width:18px;height:18px;margin:0">' +
        '<span>Attivo (prenotabile online)</span></label>' +
      '<div class="stack"><button class="btn btn-solid" data-salva>Salva</button>' +
      '<button class="btn" data-chiudi>Annulla</button></div>',
      function (box) {
        box.querySelector('[data-salva]').addEventListener('click', function () {
          E.upsert('barbers', {
            id: id || undefined,
            nome: box.querySelector('[name=nome]').value.trim() || 'Senza nome',
            specialita: box.querySelector('[name=spec]').value.trim(),
            colore: box.querySelector('[name=colore]').value,
            ordine: Number(box.querySelector('[name=ordine]').value) || 1,
            attivo: box.querySelector('[name=attivo]').checked
          });
          chiudiModale();
          render();
        });
      }
    );
  }

  function formOrari(id) {
    var b = barbiere(id);

    function corpo() {
      return [1, 2, 3, 4, 5, 6, 7].map(function (g) {
        var fasce = E.db.workingHours.filter(function (w) { return w.barberId === id && w.giorno === g; })
          .sort(function (a, c) { return a.inizio.localeCompare(c.inizio); });
        return '<div style="border-bottom:1px solid var(--line);padding:10px 0">' +
          '<div class="row-between"><strong style="font-family:var(--display);letter-spacing:.1em;text-transform:uppercase;font-size:.78rem">' +
            E.GIORNI[g] + '</strong>' +
          '<button class="btn btn-sm" data-add="' + g + '">+ Fascia</button></div>' +
          (fasce.length ? fasce.map(function (f) {
            return '<div class="stack" style="margin-top:8px;align-items:center">' +
              '<input type="time" step="300" value="' + f.inizio + '" data-f="' + f.id + '" data-k="inizio" style="width:110px">' +
              '<span class="muted">→</span>' +
              '<input type="time" step="300" value="' + f.fine + '" data-f="' + f.id + '" data-k="fine" style="width:110px">' +
              '<button class="btn btn-sm btn-bad" data-rm="' + f.id + '">Togli</button></div>';
          }).join('') : '<p class="muted" style="margin:6px 0 0;font-size:.85rem">Riposo</p>') +
        '</div>';
      }).join('');
    }

    function monta(box) {
      box.querySelectorAll('[data-add]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          E.upsert('workingHours', { barberId: id, giorno: Number(btn.dataset.add), inizio: '09:00', fine: '13:00' });
          disegna();
        });
      });
      box.querySelectorAll('[data-rm]').forEach(function (btn) {
        btn.addEventListener('click', function () { E.rimuovi('workingHours', btn.dataset.rm); disegna(); });
      });
      box.querySelectorAll('[data-f]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var f = E.byId(E.db.workingHours, inp.dataset.f);
          if (!f) return;
          var nuovo = Object.assign({}, f);
          nuovo[inp.dataset.k] = inp.value;
          if (E.toMin(nuovo.fine) <= E.toMin(nuovo.inizio)) {
            alert('L\'orario di fine deve essere successivo a quello di inizio.');
            inp.value = f[inp.dataset.k];
            return;
          }
          f[inp.dataset.k] = inp.value;
          E.save();
        });
      });
      box.querySelector('[data-fine]').addEventListener('click', function () { chiudiModale(); render(); });
    }

    function disegna() {
      apriModale(
        '<h2>Orari — ' + esc(b.nome) + '</h2>' +
        '<p class="muted">Più fasce per giorno: è così che si esprime la pausa pranzo.</p>' +
        corpo() +
        '<div class="stack" style="margin-top:16px"><button class="btn btn-solid" data-fine>Fatto</button></div>',
        monta
      );
    }
    disegna();
  }

  function formFerie(id) {
    var b = barbiere(id);
    function corpo() {
      var ferie = E.db.timeOff.filter(function (t) { return t.barberId === id; })
        .sort(function (a, c) { return a.inizio.localeCompare(c.inizio); });
      return (ferie.length ? ferie.map(function (t) {
        return '<div class="row-between" style="border-bottom:1px solid var(--line);padding:9px 0">' +
          '<span>' + esc(t.inizio.replace('T', ' ')) + ' → ' + esc(t.fine.replace('T', ' ')) +
          '<br><span class="muted">' + esc(t.motivo || '—') + '</span></span>' +
          '<button class="btn btn-sm btn-bad" data-rm="' + t.id + '">Togli</button></div>';
      }).join('') : '<p class="muted">Nessuna assenza registrata.</p>');
    }

    function disegna() {
      apriModale(
        '<h2>Assenze — ' + esc(b.nome) + '</h2>' + corpo() +
        '<h3 style="margin:18px 0 10px;font-size:.8rem;letter-spacing:.14em">Aggiungi</h3>' +
        '<div class="grid2">' +
          '<label class="f"><span>Dal giorno</span><input type="date" name="d1" value="' + V.dataKey + '"></label>' +
          '<label class="f"><span>Ora</span><input type="time" step="300" name="t1" value="09:00"></label>' +
          '<label class="f"><span>Al giorno</span><input type="date" name="d2" value="' + V.dataKey + '"></label>' +
          '<label class="f"><span>Ora</span><input type="time" step="300" name="t2" value="21:00"></label>' +
        '</div>' +
        '<label class="f"><span>Motivo</span><input type="text" name="motivo" placeholder="Ferie, permesso, malattia"></label>' +
        '<div class="stack"><button class="btn btn-solid" data-add>Aggiungi</button>' +
        '<button class="btn" data-fine>Fatto</button></div>',
        function (box) {
          box.querySelectorAll('[data-rm]').forEach(function (btn) {
            btn.addEventListener('click', function () { E.rimuovi('timeOff', btn.dataset.rm); disegna(); });
          });
          box.querySelector('[data-add]').addEventListener('click', function () {
            var i = box.querySelector('[name=d1]').value + 'T' + box.querySelector('[name=t1]').value;
            var f = box.querySelector('[name=d2]').value + 'T' + box.querySelector('[name=t2]').value;
            if (!(f > i)) return alert('La fine deve essere successiva all\'inizio.');
            E.upsert('timeOff', { barberId: id, inizio: i, fine: f, motivo: box.querySelector('[name=motivo]').value });
            disegna();
          });
          box.querySelector('[data-fine]').addEventListener('click', function () { chiudiModale(); render(); });
        }
      );
    }
    disegna();
  }

  /* ------------------------------------------------------------- servizi */

  var CAT = { capelli: 'Capelli', barba: 'Barba', combo: 'Combo', extra: 'Extra' };

  function renderServizi() {
    $('#tab-servizi').innerHTML =
      '<div class="cal-head"><span class="cal-title">Listino</span>' +
      '<button class="btn btn-sm btn-solid" data-nuovo>+ Servizio</button></div>' +
      Object.keys(CAT).map(function (c) {
        var list = E.db.services.filter(function (s) { return s.categoria === c; })
          .sort(function (a, b) { return a.ordine - b.ordine; });
        if (!list.length) return '';
        return '<h3 style="margin:22px 0 8px;font-size:.8rem;letter-spacing:.16em;color:var(--steel)">' + CAT[c] + '</h3>' +
          '<table><tbody>' + list.map(function (s) {
            return '<tr><td><strong>' + esc(s.nome) + '</strong>' + (s.attivo ? '' : ' <span class="pill">off</span>') +
              '<br><span class="muted">' + esc(s.descrizione || '') + '</span></td>' +
              '<td class="num" style="width:90px">' + E.durataLabel(s.durata) + '</td>' +
              '<td class="num" style="width:110px">' + E.euro(s.prezzo) +
              (s.prezzoPieno ? '<br><span class="muted" style="font-size:.7rem;text-decoration:line-through">' +
                E.euro(s.prezzoPieno) + '</span>' : '') + '</td>' +
              '<td style="width:180px"><div class="stack">' +
                '<button class="btn btn-sm" data-edit="' + s.id + '">Modifica</button>' +
                '<button class="btn btn-sm btn-bad" data-del="' + s.id + '">Elimina</button>' +
              '</div></td></tr>';
          }).join('') + '</tbody></table>';
      }).join('');

    var box = $('#tab-servizi');
    box.querySelector('[data-nuovo]').addEventListener('click', function () { formServizio(null); });
    box.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function () { formServizio(b.dataset.edit); });
    });
    box.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Eliminare questo servizio? Le prenotazioni già prese non cambiano.')) return;
        E.rimuovi('services', b.dataset.del);
        render();
      });
    });
  }

  function formServizio(id) {
    var s = id ? E.byId(E.db.services, id)
      : { nome: '', descrizione: '', categoria: 'capelli', durata: 30, prezzo: 15, prezzoPieno: '', ordine: 9, attivo: true };
    apriModale(
      '<h2>' + (id ? 'Modifica servizio' : 'Nuovo servizio') + '</h2>' +
      '<label class="f"><span>Nome</span><input type="text" name="nome" value="' + esc(s.nome) + '"></label>' +
      '<label class="f"><span>Descrizione</span><input type="text" name="desc" value="' + esc(s.descrizione || '') + '"></label>' +
      '<div class="grid2">' +
        '<label class="f"><span>Categoria</span><select name="cat">' +
          Object.keys(CAT).map(function (c) {
            return '<option value="' + c + '"' + (s.categoria === c ? ' selected' : '') + '>' + CAT[c] + '</option>';
          }).join('') + '</select></label>' +
        '<label class="f"><span>Ordine</span><input type="number" name="ordine" value="' + s.ordine + '" min="1"></label>' +
        '<label class="f"><span>Durata (min)</span><input type="number" name="durata" value="' + s.durata + '" min="5" step="5"></label>' +
        '<label class="f"><span>Prezzo (€)</span><input type="number" name="prezzo" value="' + s.prezzo + '" min="0" step="0.5"></label>' +
      '</div>' +
      '<label class="f"><span>Prezzo pieno — solo combo, per il badge risparmio</span>' +
        '<input type="number" name="pieno" value="' + (s.prezzoPieno || '') + '" min="0" step="0.5"></label>' +
      '<label style="display:flex;gap:9px;align-items:center;margin-bottom:16px;cursor:pointer">' +
        '<input type="checkbox" name="attivo"' + (s.attivo ? ' checked' : '') + ' style="width:18px;height:18px;margin:0">' +
        '<span>Attivo (visibile online)</span></label>' +
      '<div class="stack"><button class="btn btn-solid" data-salva>Salva</button>' +
      '<button class="btn" data-chiudi>Annulla</button></div>',
      function (box) {
        box.querySelector('[data-salva]').addEventListener('click', function () {
          var pieno = Number(box.querySelector('[name=pieno]').value);
          E.upsert('services', {
            id: id || undefined,
            nome: box.querySelector('[name=nome]').value.trim() || 'Servizio',
            descrizione: box.querySelector('[name=desc]').value.trim(),
            categoria: box.querySelector('[name=cat]').value,
            durata: Math.max(5, Number(box.querySelector('[name=durata]').value) || 30),
            prezzo: Number(box.querySelector('[name=prezzo]').value) || 0,
            prezzoPieno: pieno > 0 ? pieno : undefined,
            ordine: Number(box.querySelector('[name=ordine]').value) || 1,
            attivo: box.querySelector('[name=attivo]').checked
          });
          chiudiModale();
          render();
        });
      }
    );
  }

  /* ------------------------------------------------------------ chiusure */

  function renderChiusure() {
    var list = E.db.closures.slice().sort(function (a, b) { return a.inizio.localeCompare(b.inizio); });
    $('#tab-chiusure').innerHTML =
      '<div class="cal-head"><span class="cal-title">Chiusure negozio</span></div>' +
      '<p class="muted">Valgono per tutti i barbieri e hanno la precedenza su qualsiasi orario.</p>' +
      (list.length ? '<table><tbody>' + list.map(function (c) {
        return '<tr><td>' + esc(c.inizio.replace('T', ' ')) + ' → ' + esc(c.fine.replace('T', ' ')) + '</td>' +
          '<td>' + esc(c.motivo || '—') + '</td>' +
          '<td style="width:110px"><button class="btn btn-sm btn-bad" data-rm="' + c.id + '">Togli</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="card muted">Nessuna chiusura programmata.</div>') +
      '<div class="card" style="margin-top:18px"><h3>Aggiungi chiusura</h3><div class="grid2">' +
        '<label class="f"><span>Dal</span><input type="date" name="d1" value="' + V.dataKey + '"></label>' +
        '<label class="f"><span>Al</span><input type="date" name="d2" value="' + V.dataKey + '"></label>' +
      '</div>' +
      '<label class="f"><span>Motivo</span><input type="text" name="motivo" placeholder="Festivo, ferie collettive"></label>' +
      '<button class="btn btn-solid" data-add>Aggiungi</button></div>';

    var box = $('#tab-chiusure');
    box.querySelectorAll('[data-rm]').forEach(function (b) {
      b.addEventListener('click', function () { E.rimuovi('closures', b.dataset.rm); render(); });
    });
    box.querySelector('[data-add]').addEventListener('click', function () {
      var d1 = box.querySelector('[name=d1]').value, d2 = box.querySelector('[name=d2]').value;
      if (!d1 || !d2 || d2 < d1) return alert('Intervallo di date non valido.');
      E.upsert('closures', {
        inizio: d1 + 'T00:00', fine: d2 + 'T23:59',
        motivo: box.querySelector('[name=motivo]').value
      });
      render();
    });
  }

  /* -------------------------------------------------------- impostazioni */

  var CAMPI = [
    ['slotGranularita', 'Griglia slot (minuti)', 'Ogni quanto parte un appuntamento'],
    ['buffer', 'Buffer fra appuntamenti (minuti)', 'Pausa minima obbligatoria fra un cliente e il successivo'],
    ['finestraCancellazioneOre', 'Finestra di disdetta (ore)', 'Sotto questa soglia il cliente deve chiamare'],
    ['anticipoMinimoMinuti', 'Anticipo minimo (minuti)', 'Quanto prima si può prenotare rispetto ad adesso'],
    ['giorniAvanti', 'Giorni prenotabili in avanti', ''],
    ['maxPrenotazioniAttive', 'Max prenotazioni attive per numero', 'Argine alle prenotazioni civetta']
  ];

  function renderImpostazioni() {
    $('#tab-impostazioni').innerHTML =
      '<div class="cal-head"><span class="cal-title">Impostazioni</span></div>' +
      '<div class="card">' + CAMPI.map(function (c) {
        return '<label class="f"><span>' + c[1] + '</span>' +
          '<input type="number" name="' + c[0] + '" value="' + E.db.settings[c[0]] + '" min="1">' +
          (c[2] ? '<span class="muted" style="font-size:.8rem;letter-spacing:0;text-transform:none">' + c[2] + '</span>' : '') +
          '</label>';
      }).join('') +
      '<label class="f"><span>Telefono negozio</span><input type="tel" name="telefonoLabel" value="' +
        esc(E.db.settings.telefonoLabel) + '"></label>' +
      '<button class="btn btn-solid" data-salva>Salva</button></div>' +
      '<div class="card"><h3>Verifiche automatiche</h3>' +
      '<p class="muted">Esegue i controlli di correttezza su disponibilità, buffer, ferie e disdette. ' +
      'Il risultato compare qui e nella console.</p>' +
      '<button class="btn" data-check>Esegui verifiche</button><div data-check-out style="margin-top:14px"></div></div>';

    var box = $('#tab-impostazioni');
    box.querySelector('[data-salva]').addEventListener('click', function () {
      CAMPI.forEach(function (c) {
        var v = Number(box.querySelector('[name=' + c[0] + ']').value);
        if (v > 0) E.db.settings[c[0]] = v;
      });
      E.db.settings.telefonoLabel = box.querySelector('[name=telefonoLabel]').value;
      E.save();
      render();
    });

    box.querySelector('[data-check]').addEventListener('click', function () {
      var r = E.selfCheck();
      box.querySelector('[data-check-out]').innerHTML =
        '<p class="totale" style="color:' + (r.falliti ? 'var(--bad)' : 'var(--good)') + '">' +
        (r.falliti ? r.falliti + ' su ' + r.totale + ' fallite' : r.totale + ' verifiche superate') + '</p>' +
        '<table><tbody>' + r.esiti.map(function (e) {
          return '<tr><td>' + (e.ok ? '✅' : '❌') + '</td><td>' + esc(e.nome) + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);

/* Barber Shop Ernest — gestionale: scheda appuntamento e inserimento manuale.
   Si registra su ErnestAdmin, il namespace creato da admin.js. */
(function (global) {
  'use strict';
  var A = global.ErnestAdmin;
  var E = A.E, V = A.V, $ = A.$, esc = A.esc;
  var barbiere = A.barbiere, attivi = A.attivi;
  var apriModale = A.apriModale, chiudiModale = A.chiudiModale, render = A.render;

  A.dettaglio = dettaglio;
  A.formPrenotazione = formPrenotazione;

  /* --------------------------------------------- prenotazione: dettaglio */

  function dettaglio(id) {
    var b = E.byId(E.db.bookings, id);
    if (!b) return;
    var barb = barbiere(b.barberId);

    apriModale(
      '<div class="row-between"><h2>' + esc(b.nome) + ' ' + esc(b.cognome) + '</h2>' +
      '<span class="pill" data-s="' + b.stato + '">' + b.stato.replace('_', ' ') + '</span></div>' +
      '<table><tbody>' +
        '<tr><th>Codice</th><td>' + b.codice + '</td></tr>' +
        '<tr><th>Quando</th><td>' + esc(E.labelData(E.parse(b.inizio))) + ' · ' + b.inizio.slice(11) + '–' + b.fine.slice(11) + '</td></tr>' +
        '<tr><th>Barbiere</th><td>' + esc(barb ? barb.nome : '—') + '</td></tr>' +
        '<tr><th>Servizi</th><td>' + esc(b.servizi.map(function (s) { return s.nome; }).join(', ')) + '</td></tr>' +
        '<tr><th>Totale</th><td>' + E.euro(b.prezzo) + ' · ' + E.durataLabel(b.durata) + '</td></tr>' +
        '<tr><th>Telefono</th><td><a href="tel:' + esc(b.telefono) + '">' + esc(b.telefono) + '</a></td></tr>' +
        (b.note ? '<tr><th>Note</th><td>' + esc(b.note) + '</td></tr>' : '') +
        '<tr><th>Origine</th><td>' + b.origine + '</td></tr>' +
      '</tbody></table>' +
      '<div class="stack" style="margin-top:16px">' +
        '<button class="btn" data-a="modifica">Modifica / sposta</button>' +
        '<button class="btn" data-a="completata">Completata</button>' +
        '<button class="btn" data-a="no_show">No show</button>' +
        '<button class="btn btn-bad" data-a="cancellata">Cancella</button>' +
        '<button class="btn" data-chiudi>Chiudi</button>' +
      '</div>',
      function (box) {
        box.querySelectorAll('[data-a]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var a = btn.dataset.a;
            if (a === 'modifica') { chiudiModale(); return formPrenotazione(b.id, {}); }
            if (a === 'cancellata' && !confirm('Cancellare la prenotazione ' + b.codice + '?')) return;
            E.cambiaStato(b.id, a);
            chiudiModale();
            render();
          });
        });
      }
    );
  }

  /* ------------------------------------------- prenotazione: form manuale */

  function formPrenotazione(id, pre) {
    var b = id ? E.byId(E.db.bookings, id) : null;
    var sel = b ? b.servizi.map(function (s) { return s.id; }) : [];
    var dataKey = b ? b.inizio.slice(0, 10) : (pre.dataKey || V.dataKey);
    var ora = b ? b.inizio.slice(11) : (pre.ora || '10:00');
    var barberId = b ? b.barberId : (pre.barberId || (attivi()[0] || {}).id);

    // anche i servizi tolti dal listino, se sono già su questa prenotazione:
    // altrimenti riaprirla per spostarla li cancellerebbe di nascosto
    var servizi = E.db.services.filter(function (s) { return s.attivo || sel.indexOf(s.id) !== -1; })
      .sort(function (a, c) { return a.categoria.localeCompare(c.categoria) || a.ordine - c.ordine; });

    apriModale(
      '<h2>' + (b ? 'Modifica prenotazione' : 'Nuova prenotazione') + '</h2>' +
      (b ? '<p class="muted">Codice ' + b.codice + ' — resta invariato.</p>' : '') +
      '<div class="grid2">' +
        '<label class="f"><span>Nome</span><input type="text" name="nome" value="' + esc(b ? b.nome : '') + '"></label>' +
        '<label class="f"><span>Cognome</span><input type="text" name="cognome" value="' + esc(b ? b.cognome : '') + '"></label>' +
      '</div>' +
      '<label class="f"><span>Telefono</span><input type="tel" name="telefono" value="' + esc(b ? b.telefono : '') + '" placeholder="328 077 4789"></label>' +
      '<div class="grid2">' +
        '<label class="f"><span>Data</span><input type="date" name="data" value="' + dataKey + '"></label>' +
        '<label class="f"><span>Ora</span><input type="time" name="ora" step="300" value="' + ora + '"></label>' +
      '</div>' +
      '<label class="f"><span>Barbiere</span><select name="barbiere">' +
        attivi().map(function (x) {
          return '<option value="' + x.id + '"' + (x.id === barberId ? ' selected' : '') + '>' + esc(x.nome) + '</option>';
        }).join('') + '</select></label>' +
      '<label class="f"><span>Servizi</span></label>' +
      '<div style="max-height:190px;overflow:auto;border:1px solid var(--line);padding:8px;margin-bottom:12px">' +
        servizi.map(function (s) {
          return '<label style="display:flex;gap:9px;align-items:center;padding:5px 2px;cursor:pointer">' +
            '<input type="checkbox" name="svc" value="' + s.id + '"' +
            (sel.indexOf(s.id) !== -1 ? ' checked' : '') + ' style="width:18px;height:18px;margin:0">' +
            '<span>' + esc(s.nome) + ' <span class="muted">· ' + E.durataLabel(s.durata) + ' · ' + E.euro(s.prezzo) +
            (s.attivo ? '' : ' · fuori listino') + '</span></span></label>';
        }).join('') +
      '</div>' +
      '<div class="row-between" style="margin-bottom:12px"><span class="muted">Totale</span><span class="totale" data-tot>—</span></div>' +
      '<label class="f"><span>Note</span><textarea name="note">' + esc(b ? b.note : '') + '</textarea></label>' +
      '<label style="display:flex;gap:9px;align-items:flex-start;margin-bottom:16px;cursor:pointer">' +
        '<input type="checkbox" name="forza" style="width:18px;height:18px;margin:2px 0 0">' +
        '<span class="muted" style="font-size:.86rem">Consenti sovrapposizione o orario fuori turno ' +
        '(per incastrare un cliente di persona).</span></label>' +
      '<p class="pill" data-err hidden style="display:block;border-color:rgba(226,86,74,.6);color:#f0a49c;padding:9px 11px"></p>' +
      '<div class="stack" style="margin-top:14px">' +
        '<button class="btn btn-solid" data-salva>' + (b ? 'Salva modifiche' : 'Crea prenotazione') + '</button>' +
        '<button class="btn" data-chiudi>Annulla</button>' +
        (b ? '<button class="btn btn-bad" data-elimina>Elimina</button>' : '') +
      '</div>',
      function (box) {
        function scelti() {
          return [].slice.call(box.querySelectorAll('[name=svc]:checked')).map(function (i) { return i.value; });
        }
        function aggiornaTot() {
          var t = E.totali(scelti());
          box.querySelector('[data-tot]').textContent =
            t.servizi.length ? E.euro(t.prezzo) + ' · ' + E.durataLabel(t.durata) : '—';
        }
        box.querySelectorAll('[name=svc]').forEach(function (i) { i.addEventListener('change', aggiornaTot); });
        aggiornaTot();

        function errore(msg) {
          var p = box.querySelector('[data-err]');
          p.hidden = !msg;
          p.textContent = msg || '';
        }

        box.querySelector('[data-salva]').addEventListener('click', function () {
          var dati = {
            serviziIds: scelti(),
            nome: box.querySelector('[name=nome]').value,
            cognome: box.querySelector('[name=cognome]').value,
            telefono: box.querySelector('[name=telefono]').value,
            barberId: box.querySelector('[name=barbiere]').value,
            inizio: box.querySelector('[name=data]').value + 'T' + box.querySelector('[name=ora]').value,
            note: box.querySelector('[name=note]').value,
            forza: box.querySelector('[name=forza]').checked,
            origine: 'manuale',
            consenso: true
          };
          var res = b ? E.aggiornaPrenotazione(b.id, dati) : E.creaPrenotazione(dati);
          if (!res.ok) return errore(res.error);
          V.dataKey = dati.inizio.slice(0, 10);
          chiudiModale();
          render();
        });

        var del = box.querySelector('[data-elimina]');
        if (del) del.addEventListener('click', function () {
          if (!confirm('Eliminare definitivamente questa prenotazione?')) return;
          E.rimuovi('bookings', b.id);
          chiudiModale();
          render();
        });
      }
    );
  }
})(typeof window !== 'undefined' ? window : globalThis);

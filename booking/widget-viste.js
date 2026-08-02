/* Barber Shop Ernest — schermate del flusso di prenotazione.
   Solo generazione di markup: lo stato e la navigazione stanno in widget.js.
   Ogni vista rilegge lo stato da ctx.stato(), perché l'oggetto viene sostituito
   a ogni nuova prenotazione. */
(function (global) {
  'use strict';

  global.ErnestViste = {
    crea: function (ctx) {
      var E = ctx.E, esc = ctx.esc, S;
      function totali() { return ctx.totali(); }
      function durataTotale() { return totali().durata; }
      function sync() { S = ctx.stato(); }

      function vistaLunghezza() {
          sync();
        var opzioni = [
          ['lunghi', 'Lunghi', 'Ti consiglio il taglio con shampoo'],
          ['corti', 'Corti', 'Taglio base o rasatura a misura unica'],
          ['solo_barba', 'Vengo solo per la barba', 'Salti direttamente ai servizi barba']
        ];
        return '<p class="bk-sub">Serve solo a proporti i servizi giusti. Puoi comunque sceglierli tutti.</p>' +
          '<div class="bk-choices">' + opzioni.map(function (o) {
            return '<button class="bk-choice" type="button" data-act="lunghezza" data-val="' + o[0] + '"' +
              ' aria-pressed="' + (S.lunghezza === o[0]) + '" data-selected="' + (S.lunghezza === o[0]) + '">' +
              '<span><span class="bk-choice-name">' + o[1] + '</span>' +
              '<span class="bk-choice-desc">' + o[2] + '</span></span>' +
              '<span class="bk-mark">' + (S.lunghezza === o[0] ? '✓' : '') + '</span></button>';
          }).join('') + '</div>' +
          '<button class="bk-link" type="button" data-act="gestisci">Ho già una prenotazione — gestiscila</button>';
      }

      function cardServizio(s) {
          sync();
        var scelto = S.serviziIds.indexOf(s.id) !== -1;
        var comboScelto = S.serviziIds.some(function (x) {
          var o = E.byId(E.db.services, x);
          return o && o.categoria === 'combo';
        });
        // con un combo attivo capelli e barba sono già inclusi: si disabilitano,
        // non si nascondono, così resta chiaro perché non sono cliccabili
        var bloccato = !scelto && comboScelto &&
          (s.categoria === 'capelli' || s.categoria === 'barba');

        var risparmio = s.prezzoPieno && s.prezzoPieno > s.prezzo
          ? '<span class="bk-badge">Risparmi ' + E.euro(s.prezzoPieno - s.prezzo) + '</span>' : '';

        return '<button class="bk-choice" type="button" data-act="servizio" data-id="' + s.id + '"' +
          ' aria-pressed="' + scelto + '" data-selected="' + scelto + '"' + (bloccato ? ' disabled' : '') + '>' +
          '<span><span class="bk-choice-name">' + esc(s.nome) + '</span>' +
          '<span class="bk-choice-desc">' + esc(s.descrizione || '') + '</span>' + risparmio + '</span>' +
          '<span class="bk-choice-meta">' +
            '<span class="bk-choice-price">' + E.euro(s.prezzo) + '</span>' +
            '<span class="bk-choice-dur">' + E.durataLabel(s.durata) + '</span>' +
          '</span></button>';
      }

      function vistaServizi() {
          sync();
        var attivi = E.db.services.filter(function (s) { return s.attivo; })
          .sort(function (a, b) { return a.ordine - b.ordine; });

        function gruppo(cat) {
          return attivi.filter(function (s) { return s.categoria === cat; }).map(cardServizio).join('');
        }

        // la lunghezza dichiarata decide solo l'ordine dei blocchi, non cosa è scegliibile
        var blocchi = [
          ['combo', 'Combo — taglio + barba'],
          ['capelli', 'Capelli'],
          ['barba', 'Barba'],
          ['extra', 'Extra — da aggiungere']
        ];
        if (S.lunghezza === 'solo_barba') blocchi = [blocchi[2], blocchi[0], blocchi[1], blocchi[3]];

        return '<p class="bk-sub">Puoi combinare più servizi: durata e prezzo si sommano.</p>' +
          blocchi.map(function (b) {
            return '<h3 class="bk-group-title">' + b[1] + '</h3><div class="bk-choices">' + gruppo(b[0]) + '</div>';
          }).join('');
      }

      function vistaBarbiere() {
          sync();
        var t = totali();
        var barbieri = E.db.barbers.filter(function (b) { return b.attivo; })
          .sort(function (a, b) { return a.ordine - b.ordine; });

        var auto = '<button class="bk-choice" type="button" data-act="barbiere" data-id="auto"' +
          ' aria-pressed="' + (S.barberId === null) + '" data-selected="' + (S.barberId === null) + '">' +
          '<span><span class="bk-choice-name">Primo disponibile</span>' +
          '<span class="bk-choice-desc">Ti assegniamo il barbiere libero prima</span></span>' +
          '<span class="bk-mark">' + (S.barberId === null ? '✓' : '') + '</span></button>';

        var lista = barbieri.map(function (b) {
          var avatar = b.foto
            ? '<span class="bk-avatar"><img src="' + esc(b.foto) + '" alt="" width="84" height="84" loading="lazy"></span>'
            : '<span class="bk-avatar" style="background:' + esc(b.colore) + '">' + esc(b.nome.charAt(0)) + '</span>';
          return '<button class="bk-choice bk-choice-with-avatar" type="button" data-act="barbiere" data-id="' + b.id + '"' +
            ' aria-pressed="' + (S.barberId === b.id) + '" data-selected="' + (S.barberId === b.id) + '">' +
            avatar +
            '<span><span class="bk-choice-name">' + esc(b.nome) + '</span>' +
            '<span class="bk-choice-desc">' + esc(b.specialita || '') + '</span></span>' +
            '<span class="bk-mark">' + (S.barberId === b.id ? '✓' : '') + '</span></button>';
        }).join('');

        return '<p class="bk-sub">Servizio da ' + E.durataLabel(t.durata) + '.</p>' +
          '<div class="bk-choices">' + auto + lista + '</div>';
      }

      function vistaQuando() {
          sync();
        var durata = durataTotale();
        var oggi = new Date();
        var giorni = [];
        // l'orizzonte è quello impostato nel gestionale, non un numero fisso:
        // altrimenti il motore rifiuta date che la striscia mostra come libere
        var orizzonte = E.db.settings.giorniAvanti;
        for (var i = 0; i <= orizzonte; i++) {
          var d = E.addDays(oggi, i);
          var key = E.dayKey(d);
          var liberi = E.slotsFor(key, S.barberId === null ? null : S.barberId, durata);
          giorni.push({ d: d, key: key, liberi: liberi });
        }

        var primoUtile = giorni.filter(function (g) { return g.liberi.length; })[0];
        if (!S.dataKey && primoUtile) S.dataKey = primoUtile.key;

        var strip = giorni.map(function (g) {
          var sel = g.key === S.dataKey;
          return '<button class="bk-day" type="button" data-act="giorno" data-key="' + g.key + '"' +
            ' aria-pressed="' + sel + '"' + (g.liberi.length ? '' : ' disabled') + '>' +
            '<span class="bk-day-dow">' + E.GIORNI[E.weekday(g.d)].slice(0, 3) + '</span>' +
            '<span class="bk-day-num">' + g.d.getDate() + '</span>' +
            '<span class="bk-day-mon">' + E.MESI[g.d.getMonth()].slice(0, 3) + '</span></button>';
        }).join('');

        var scelto = giorni.filter(function (g) { return g.key === S.dataKey; })[0];
        var corpo;

        if (!scelto || !scelto.liberi.length) {
          corpo = '<div class="bk-empty">Nessuna disponibilità in questo giorno.' +
            (primoUtile ? ' Primo giorno libero: <button class="bk-link" type="button" data-act="giorno" data-key="' +
              primoUtile.key + '">' + E.labelData(primoUtile.d) + '</button>.' : '') + '</div>';
        } else {
          var fasce = [
            ['Mattina', function (o) { return E.toMin(o) < 12 * 60; }],
            ['Pomeriggio', function (o) { return E.toMin(o) >= 12 * 60 && E.toMin(o) < 17 * 60; }],
            ['Sera', function (o) { return E.toMin(o) >= 17 * 60; }]
          ];
          corpo = fasce.map(function (f) {
            var s = scelto.liberi.filter(function (x) { return f[1](x.ora); });
            if (!s.length) return '';
            return '<div class="bk-slot-group"><h3 class="bk-group-title">' + f[0] + '</h3><div class="bk-slots">' +
              s.map(function (x) {
                return '<button class="bk-slot" type="button" data-act="slot" data-ora="' + x.ora +
                  '" data-barber="' + x.barberId + '" aria-pressed="' + (S.ora === x.ora) + '">' + x.ora + '</button>';
              }).join('') + '</div></div>';
          }).join('');
        }

        return '<p class="bk-sub">Durata prevista ' + E.durataLabel(durata) + '.</p>' +
          '<div class="bk-days">' + strip + '</div>' + corpo;
      }

      function vistaDati() {
          sync();
        return '<p class="bk-sub">Ci servono solo per riconoscerti quando arrivi.</p>' +
          '<label class="bk-field"><span>Nome</span>' +
            '<input name="nome" type="text" autocomplete="given-name" value="' + esc(S.nome) + '" required></label>' +
          '<label class="bk-field"><span>Cognome</span>' +
            '<input name="cognome" type="text" autocomplete="family-name" value="' + esc(S.cognome) + '" required></label>' +
          '<label class="bk-field"><span>Telefono</span>' +
            '<input name="telefono" type="tel" inputmode="tel" autocomplete="tel" placeholder="328 077 4789" value="' +
            esc(S.telefono) + '" required></label>' +
          '<label class="bk-field"><span>Note (facoltativo)</span>' +
            '<textarea name="note" maxlength="200" placeholder="Es. preferisco la sfumatura bassa">' + esc(S.note) + '</textarea></label>' +
          '<label class="bk-check"><input name="consenso" type="checkbox"' + (S.consenso ? ' checked' : '') + '>' +
          '<span>Ho letto l\'informativa privacy e acconsento al trattamento dei miei dati per la gestione della prenotazione.</span></label>';
      }

      function riepilogoDati() {
          sync();
        var t = totali();
        var barbiere = S.barberAssegnato ? E.byId(E.db.barbers, S.barberAssegnato) : null;
        var d = E.at(S.dataKey, 0);
        return { t: t, barbiere: barbiere, d: d };
      }

      function vistaRiepilogo() {
          sync();
        var r = riepilogoDati();
        var righe = [
          ['Servizi', r.t.servizi.map(function (s) { return esc(s.nome); }).join('<br>')],
          ['Durata', E.durataLabel(r.t.durata)],
          ['Barbiere', r.barbiere ? esc(r.barbiere.nome) : '—'],
          ['Quando', E.labelData(r.d) + '<br>ore ' + S.ora],
          ['Cliente', esc(S.nome) + ' ' + esc(S.cognome) + '<br>' + esc(E.normalizzaTelefono(S.telefono))]
        ];
        if (S.note) righe.push(['Note', esc(S.note)]);

        return '<p class="bk-sub">Ancora un controllo, poi sei a posto.</p><dl class="bk-recap">' +
          righe.map(function (x) {
            return '<div class="bk-recap-row"><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>';
          }).join('') +
          '<div class="bk-recap-row bk-recap-total"><dt>Totale</dt><dd>' + E.euro(r.t.prezzo) + '</dd></div></dl>';
      }

      function vistaFatto() {
          sync();
        var b = S.booking;
        var barbiere = E.byId(E.db.barbers, b.barberId);
        var d = E.parse(b.inizio);
        var wa = 'https://wa.me/' + E.db.settings.telefono.replace('+', '') +
          '?text=' + encodeURIComponent('Ciao, ho prenotato con codice ' + b.codice + '.');

        return '<p class="bk-sub">' + esc(E.labelData(d)) + ' alle ' + b.inizio.slice(11) +
          ' con ' + esc(barbiere ? barbiere.nome : '') + '.</p>' +
          '<div class="bk-code"><b>' + b.codice + '</b>' +
          '<small>Salva questo codice: ti serve per disdire</small></div>' +
          '<div class="bk-actions">' +
            '<button type="button" data-act="copia">Copia codice</button>' +
            '<button type="button" data-act="ics">Aggiungi al calendario</button>' +
            '<a href="https://www.google.com/maps/search/?api=1&amp;query=Corso+Giuseppe+Mazzini+128%2C+48018+Faenza+RA" target="_blank" rel="noopener">Come arrivare</a>' +
            '<a href="' + wa + '" target="_blank" rel="noopener">Scrivi su WhatsApp</a>' +
          '</div>' +
          '<dl class="bk-recap">' +
            '<div class="bk-recap-row"><dt>Servizi</dt><dd>' +
              b.servizi.map(function (s) { return esc(s.nome); }).join('<br>') + '</dd></div>' +
            '<div class="bk-recap-row"><dt>Durata</dt><dd>' + E.durataLabel(b.durata) + '</dd></div>' +
            '<div class="bk-recap-row bk-recap-total"><dt>Totale</dt><dd>' + E.euro(b.prezzo) + '</dd></div>' +
          '</dl>' +
          '<button class="bk-link" type="button" data-act="chiudi">Torna al sito</button>';
      }

      return {
        lunghezza: vistaLunghezza, servizi: vistaServizi, barbiere: vistaBarbiere,
        quando: vistaQuando, dati: vistaDati, riepilogo: vistaRiepilogo, fatto: vistaFatto
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);

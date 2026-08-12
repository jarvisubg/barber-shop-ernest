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

      /* ------------------------------------------------------------ servizi */

      /* Le pill in cima al listino. "In evidenza" non è una categoria vera: è
         la selezione che il negozio vuole far vedere per prima, presa dal campo
         `evidenza` del listino e trasversale alle categorie. */
      var CATEGORIE = [
        ['evidenza', 'In evidenza'],
        ['combo', 'Combo'],
        ['capelli', 'Taglio capelli'],
        ['barba', 'Barba'],
        ['extra', 'Extra']
      ];

      function inCategoria(attivi, cat) {
        if (cat === 'evidenza') {
          /* A parità di posizione decide l'ordine di categoria e poi il nome:
             il negozio può dare per sbaglio lo stesso numero a due servizi, e
             senza questo la vetrina cambierebbe a seconda di com'è fatto il
             database invece che di quello che ha scelto il negozio. */
          return attivi.filter(function (s) { return s.evidenza; })
            .sort(function (a, b) {
              return a.evidenza - b.evidenza || a.ordine - b.ordine ||
                a.nome.localeCompare(b.nome);
            });
        }
        return attivi.filter(function (s) { return s.categoria === cat; })
          .sort(function (a, b) { return a.ordine - b.ordine; });
      }

      function cardServizio(s) {
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

        return '<button class="bk-card" type="button" data-act="servizio" data-id="' + s.id + '"' +
          ' aria-pressed="' + scelto + '" data-selected="' + scelto + '"' + (bloccato ? ' disabled' : '') + '>' +
          '<span class="bk-card-name">' + esc(s.nome) + '</span>' +
          '<span class="bk-card-dur">' + E.durataLabel(s.durata) + '</span>' +
          '<span class="bk-card-desc">' + esc(s.descrizione || '') + '</span>' +
          '<span class="bk-card-foot">' +
            '<span class="bk-card-prezzo">' + E.euro(s.prezzo) +
              (s.prezzoPieno && s.prezzoPieno > s.prezzo
                ? '<s>' + E.euro(s.prezzoPieno) + '</s>' : '') +
            '</span>' +
            risparmio +
            '<span class="bk-card-add" aria-hidden="true">' + (scelto ? '✓' : '+') + '</span>' +
          '</span></button>';
      }

      function gruppo(titolo, lista) {
        return '<h3 class="bk-group-title">' + esc(titolo) + '</h3>' +
          '<div class="bk-cards">' + lista.map(cardServizio).join('') + '</div>';
      }

      function vistaServizi() {
        sync();
        var attivi = E.db.services.filter(function (s) { return s.attivo; });

        // una pill che non ha servizi dietro è una via chiusa: non si mostra
        var disponibili = CATEGORIE.filter(function (c) { return inCategoria(attivi, c[0]).length; });
        // se il gestionale svuota la categoria aperta si torna al listino intero,
        // invece di lasciare a video una schermata senza servizi
        if (S.catAttiva !== 'tutti' && !disponibili.some(function (c) { return c[0] === S.catAttiva; })) {
          S.catAttiva = 'tutti';
        }

        var pills = [['tutti', 'Tutti']].concat(disponibili).map(function (c) {
          return '<button class="bk-pill" type="button" data-act="categoria" data-cat="' + c[0] + '"' +
            ' aria-pressed="' + (S.catAttiva === c[0]) + '">' + c[1] + '</button>';
        }).join('');

        var corpo;
        if (S.catAttiva === 'tutti') {
          /* Listino intero, "In evidenza" in cima. I servizi già in vetrina non
             si ripetono sotto la loro categoria: due card identiche nella stessa
             schermata sembrano due servizi diversi. Filtrando una categoria
             invece si mostra tutta, evidenza compresa. */
          var inVetrina = inCategoria(attivi, 'evidenza');
          corpo = disponibili.map(function (c) {
            var lista = c[0] === 'evidenza'
              ? inVetrina
              : inCategoria(attivi, c[0]).filter(function (s) { return !s.evidenza; });
            return lista.length ? gruppo(c[1], lista) : '';
          }).join('');
        } else {
          var cat = disponibili.filter(function (c) { return c[0] === S.catAttiva; })[0];
          corpo = gruppo(cat[1], inCategoria(attivi, cat[0]));
        }

        return '<div class="bk-pills">' + pills + '</div>' + corpo +
          '<button class="bk-link" type="button" data-act="gestisci">Ho già una prenotazione — gestiscila</button>';
      }

      /* ------------------------------------------------------ professionista */

      function vistaProfessionista() {
        sync();
        var barbieri = E.db.barbers.filter(function (b) { return b.attivo; })
          .sort(function (a, b) { return a.ordine - b.ordine; });

        var auto = '<button class="bk-choice" type="button" data-act="barbiere" data-id="auto"' +
          ' aria-pressed="' + (S.barberId === null) + '" data-selected="' + (S.barberId === null) + '">' +
          '<span><span class="bk-choice-name">Primo disponibile</span>' +
          '<span class="bk-choice-desc">Massima disponibilità: ti assegniamo il barbiere libero prima</span></span>' +
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

        return '<div class="bk-choices">' + auto + lista + '</div>';
      }

      /* ---------------------------------------------------------------- ora */

      function slotDi(key, durata) {
        return E.slotsFor(key, S.barberId === null ? null : S.barberId, durata);
      }

      /* Un giorno senza orari liberi può essere tre cose diverse, e al cliente
         vanno dette in tre modi diversi:
           pieno    → il negozio lavora ma è tutto preso: una disdetta libera
           ferie    → chiusura che finisce: si può essere avvisati alla riapertura
           mai      → quel giorno non si lavora (domenica): non c'è niente da fare
         Il calcolo si fa solo sui giorni senza posti, mai sugli altri. */
      function statoGiorno(key, durata) {
        var b = S.barberId === null ? null : S.barberId;
        if (E.slotsFor(key, b, durata, { soloStruttura: true }).length) return 'pieno';
        if (E.slotsFor(key, b, durata, { soloOrari: true }).length) return 'ferie';
        return 'mai';
      }

      /* Primo giorno con posto a partire da `da`. Si ferma appena lo trova:
         scorrere tutto l'orizzonte a ogni render costerebbe 365 calcoli di
         slot per un'informazione che serve solo quando non c'è niente libero. */
      function primoLibero(da, limite, durata) {
        for (var d = da; d <= limite; d = E.addDays(d, 1)) {
          var key = E.dayKey(d);
          if (slotDi(key, durata).length) return { d: d, key: key };
        }
        return null;
      }

      /* La striscia dei giorni si sfoglia per mese. L'orizzonte è un anno:
         una striscia unica sarebbe da 365 pulsanti, inservibile sul telefono e
         inutile da calcolare, perché gli slot vanno ricavati giorno per giorno.
         Il limite resta quello del gestionale, non un numero fisso, altrimenti
         il motore rifiuterebbe date che la striscia mostra come libere. */
      function vistaOra() {
        sync();
        var durata = durataTotale();
        var oggi = E.at(E.dayKey(new Date()), 0);
        var limite = E.addDays(oggi, E.db.settings.giorniAvanti);

        var mese = new Date(oggi.getFullYear(), oggi.getMonth() + S.meseOffset, 1);
        var dal = mese < oggi ? oggi : mese;
        var fineMese = new Date(mese.getFullYear(), mese.getMonth() + 1, 0);
        var al = fineMese > limite ? limite : fineMese;

        var giorni = [];
        for (var d = dal; d <= al; d = E.addDays(d, 1)) {
          var k = E.dayKey(d);
          var liberi = slotDi(k, durata);
          giorni.push({
            d: d, key: k, liberi: liberi,
            stato: liberi.length ? 'libero' : statoGiorno(k, durata)
          });
        }

        /* La data scelta deve stare nel mese guardato: altrimenti sotto la
           striscia comparirebbero gli orari di un giorno che non si vede.
           Se non c'è niente di libero si punta comunque su un giorno pieno,
           così lo stato vuoto può offrire la lista d'attesa invece di lasciare
           la schermata muta. */
        var scelto = giorni.filter(function (g) { return g.key === S.dataKey; })[0];
        if (!scelto) {
          scelto = giorni.filter(function (g) { return g.liberi.length; })[0] ||
            giorni.filter(function (g) { return g.stato !== 'mai'; })[0] || null;
          S.dataKey = scelto ? scelto.key : null;
        }

        var testata = '<div class="bk-mese">' +
          '<button class="bk-mese-nav" type="button" data-act="mese" data-delta="-1"' +
            (S.meseOffset > 0 ? '' : ' disabled') + ' aria-label="Mese precedente">&lsaquo;</button>' +
          '<span class="bk-mese-nome">' + esc(E.MESI[mese.getMonth()]) + ' ' + mese.getFullYear() + '</span>' +
          '<button class="bk-mese-nav" type="button" data-act="mese" data-delta="1"' +
            (E.addDays(al, 1) <= limite ? '' : ' disabled') + ' aria-label="Mese successivo">&rsaquo;</button>' +
        '</div>';

        var strip = giorni.map(function (g) {
          var sel = g.key === S.dataKey;
          /* Pieno e ferie restano cliccabili: sono i due casi in cui il cliente
             può ancora lasciare il numero. Si spegne solo il giorno in cui non
             si lavora mai, dove non c'è niente da aspettare. */
          return '<button class="bk-day" type="button" data-act="giorno" data-key="' + g.key + '"' +
            ' aria-pressed="' + sel + '"' +
            (g.stato === 'libero' ? '' : ' data-stato="' + g.stato + '"') +
            (g.stato === 'mai' ? ' disabled' : '') + '>' +
            '<span class="bk-day-dow">' + E.GIORNI[E.weekday(g.d)].slice(0, 3) + '</span>' +
            '<span class="bk-day-num">' + g.d.getDate() + '</span>' +
            '<span class="bk-day-mon">' + E.MESI[g.d.getMonth()].slice(0, 3) + '</span></button>';
        }).join('');

        var corpo;

        if (!scelto || !scelto.liberi.length) {
          /* Due casi diversi: il giorno scelto si è appena riempito, oppure in
             tutto il mese non c'è niente. Il salto porta anche la striscia sul
             mese giusto — lo fa il gestore di `giorno` in widget.js. */
          var prossimo = primoLibero(scelto ? E.addDays(scelto.d, 1) : dal, limite, durata);
          var chiPerFerie = S.barberId
            ? (E.byId(E.db.barbers, S.barberId) || {}).nome
            : 'Il negozio';
          corpo = '<div class="bk-empty">' +
            '<b>' + (scelto
              // la data va ripetuta: la striscia scorre e il riquadro scelto
              // può restare fuori dallo schermo su telefono
              ? (scelto.stato === 'ferie'
                ? esc(E.labelData(scelto.d)) + ': ' + esc(chiPerFerie) + ' non c\'è.'
                : esc(E.labelData(scelto.d)) + ': completamente prenotato.')
              // "in agosto" e non "a agosto": regge tutti i mesi senza eufonia
              : 'Nessun orario libero in ' + esc(E.MESI[mese.getMonth()]) + '.') + '</b>' +
            (prossimo
              ? '<span>Disponibile da ' + esc(E.labelData(prossimo.d)) + '</span>' +
                '<button class="bk-cta bk-cta-ghost" type="button" data-act="giorno" data-key="' +
                prossimo.key + '">Vai alla prossima data disponibile</button>'
              : '<span>Nessuna disponibilità fino al ' + esc(E.labelData(limite)) + '. ' +
                'Chiama il negozio allo ' + esc(E.db.settings.telefonoLabel) + '.</span>') +
            /* La lista d'attesa si offre solo su un giorno preciso: senza una
               data scelta non ci sarebbe niente per cui aspettare. */
            (scelto
              ? '<button class="bk-cta bk-cta-ghost" type="button" data-act="attesa" data-key="' +
                scelto.key + '" data-stato="' + esc(scelto.stato) + '">' +
                (scelto.stato === 'ferie' ? 'Avvisami quando torna disponibile'
                  : 'Iscriviti alla lista d\'attesa') + '</button>'
              : '') +
            '</div>';
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
                  '" data-barber="' + x.barberId + '" aria-pressed="' + (S.ora === x.ora) + '">' +
                  '<span>' + x.ora + '</span></button>';
              }).join('') + '</div></div>';
          }).join('');
        }

        return '<h3 class="bk-group-title">Seleziona una data</h3>' +
          testata + '<div class="bk-days">' + strip + '</div>' + corpo;
      }

      /* ----------------------------------------------------------- conferma */

      /* Dati e riepilogo stanno sullo stesso schermo: Fresha chiude in quattro
         passi e il carrello a lato mostra già servizi, orario e totale. */
      function vistaConferma() {
        sync();
        var t = totali();
        var barbiere = S.barberAssegnato ? E.byId(E.db.barbers, S.barberAssegnato) : null;
        var d = E.at(S.dataKey, 0);

        var righe = [
          ['Quando', E.labelData(d) + '<br>ore ' + esc(S.ora)],
          ['Barbiere', barbiere ? esc(barbiere.nome) : '—'],
          ['Servizi', t.servizi.map(function (s) { return esc(s.nome); }).join('<br>')],
          ['Durata', E.durataLabel(t.durata)]
        ];

        return '<dl class="bk-recap">' +
            righe.map(function (x) {
              return '<div class="bk-recap-row"><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>';
            }).join('') +
            '<div class="bk-recap-row bk-recap-total"><dt>Totale</dt><dd>' + E.euro(t.prezzo) + '</dd></div>' +
          '</dl>' +
          '<h3 class="bk-group-title">I tuoi dati</h3>' +
          '<p class="bk-sub">Ci servono solo per riconoscerti quando arrivi.</p>' +
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

      /* -------------------------------------------------------------- fatto */

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
        servizi: vistaServizi, professionista: vistaProfessionista,
        ora: vistaOra, conferma: vistaConferma, fatto: vistaFatto
      };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);

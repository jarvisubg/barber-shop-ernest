/* Barber Shop Ernest — verifiche automatiche del motore prenotazioni.
   Coprono i criteri di completamento elencati al §10 del prompt.
   Si lanciano con ErnestBooking.selfCheck() dalla console, dal pulsante
   "Esegui verifiche" nel gestionale, o aprendo una pagina con ?selfcheck.
   Non girano mai da sole e non lasciano traccia sui dati reali: il motore le
   esegue dentro ambienteDiProva(), che parte da un database vuoto, sospende il
   salvataggio e ripristina tutto in coda. */
(function (global, E) {
  'use strict';
  if (!E) return;

  E.selfCheck = function () {
    var esiti = [];
    function ok(nome, cond) { esiti.push({ nome: nome, ok: !!cond }); }

    E.ambienteDiProva(function (db) {
      var domani = E.addDays(new Date(), 1);
      // porta il test su un martedì, così esistono entrambe le fasce 10-12 e 13:30-21
      while (E.weekday(domani) !== 2) domani = E.addDays(domani, 1);
      var key = E.dayKey(domani);

      // 1 — sovrapposizione parziale rifiutata
      var a = E.creaPrenotazione({
        serviziIds: ['cap-lunghi'], nome: 'Test', cognome: 'Uno', telefono: '3331112222',
        barberId: 'b1', inizio: key + 'T10:00', consenso: true
      });
      var b = E.creaPrenotazione({
        serviziIds: ['cap-rasatura'], nome: 'Test', cognome: 'Due', telefono: '3331112223',
        barberId: 'b1', inizio: key + 'T10:15', consenso: true
      });
      ok('sovrapposizione parziale rifiutata', a.ok && !b.ok);

      // 2 — la pausa pranzo del martedì non produce slot
      var s = E.slotsFor(key, 'b1', 30, { ignoraAnticipo: true }).map(function (x) { return x.ora; });
      ok('pausa 12:00-13:30 esclusa', s.indexOf('12:15') === -1 && s.indexOf('13:00') === -1);

      // 3 — un servizio da 60 min non entra a fine turno del sabato (chiusura 20:00)
      var sab = E.addDays(new Date(), 1);
      while (E.weekday(sab) !== 6) sab = E.addDays(sab, 1);
      var s60 = E.slotsFor(E.dayKey(sab), 'b1', 60, { ignoraAnticipo: true }).map(function (x) { return x.ora; });
      ok('nessuno slot da 60 min oltre la chiusura', s60.indexOf('19:30') === -1 && s60.indexOf('19:00') !== -1);

      // 4 — ferie di mezza giornata tolgono solo quella fascia e solo a quel barbiere
      db.timeOff.push({ id: E.uid(), barberId: 'b1', inizio: key + 'T17:00', fine: key + 'T21:00', motivo: 'test' });
      var dopo = E.slotsFor(key, 'b1', 30, { ignoraAnticipo: true }).map(function (x) { return x.ora; });
      var altro = E.slotsFor(key, 'b2', 30, { ignoraAnticipo: true }).map(function (x) { return x.ora; });
      ok('ferie mezza giornata limitate al barbiere', dopo.indexOf('17:30') === -1 && altro.indexOf('17:30') !== -1);

      // 5 — combo esclude capelli e barba
      ok('combo esclude capelli/barba', !!E.validaSelezione(['combo-base', 'cap-base']));

      // 6 — solo extra non basta
      ok('extra da solo bloccato', !!E.validaSelezione(['extra-sopracciglia']));

      // 7 — durata e prezzo ricalcolati server-side, non presi dal client
      var m = E.creaPrenotazione({
        serviziIds: ['cap-base', 'extra-cera'], nome: 'Test', cognome: 'Tre', telefono: '3331112224',
        barberId: 'b1', inizio: key + 'T14:00', consenso: true, durata: 5, prezzo: 1
      });
      ok('durata/prezzo ricalcolati', m.ok && m.booking.durata === 40 && m.booking.prezzo === 22);

      // 7b — prenotare un barbiere nel suo giorno di riposo viene rifiutato
      //      (Kevin non lavora il martedì)
      var riposo = E.creaPrenotazione({
        serviziIds: ['cap-base'], nome: 'Test', cognome: 'Sei', telefono: '3331112227',
        barberId: 'b3', inizio: key + 'T14:00', consenso: true
      });
      ok('giorno di riposo rispettato', !riposo.ok);

      // 8 — buffer rispettato fra due appuntamenti
      var c1 = E.creaPrenotazione({
        serviziIds: ['cap-base'], nome: 'Test', cognome: 'Quattro', telefono: '3331112225',
        barberId: 'b2', inizio: key + 'T14:00', consenso: true
      });
      var c2 = E.creaPrenotazione({
        serviziIds: ['barba-normale'], nome: 'Test', cognome: 'Cinque', telefono: '3331112226',
        barberId: 'b2', inizio: key + 'T14:30', consenso: true
      });
      ok('buffer di 5 min applicato', c1.ok && !c2.ok);

      // 9 — cancellazione oltre finestra libera lo slot
      var prima = E.slotsFor(key, 'b1', 40, { ignoraAnticipo: true }).length;
      var canc = E.cancellaConCodice(m.booking.codice, '3331112224');
      var dopoC = E.slotsFor(key, 'b1', 40, { ignoraAnticipo: true }).length;
      ok('cancellazione libera lo slot', canc.ok && dopoC > prima);

      // 10 — codice giusto ma telefono sbagliato non cancella
      var x = E.cancellaConCodice(a.booking.codice, '3339999999');
      ok('telefono errato non cancella', !x.ok && x.motivo === 'non_trovata');

      // 11 — chiusura negozio blocca tutti i barbieri
      db.closures.push({ id: E.uid(), inizio: key + 'T00:00', fine: key + 'T23:59', motivo: 'test' });
      ok('chiusura blocca tutti', E.slotsFor(key, null, 30, { ignoraAnticipo: true }).length === 0);
    });

    var falliti = esiti.filter(function (e) { return !e.ok; });
    esiti.forEach(function (e) {
      console[e.ok ? 'log' : 'error']((e.ok ? '✅' : '❌') + ' ' + e.nome);
    });
    console.log(falliti.length ? '❌ ' + falliti.length + ' verifiche fallite'
      : '✅ tutte le ' + esiti.length + ' verifiche passate');
    return { totale: esiti.length, falliti: falliti.length, esiti: esiti };
  };

  if (global.location && /[?&]selfcheck/.test(global.location.search)) E.selfCheck();

})(typeof window !== 'undefined' ? window : globalThis,
   (typeof window !== 'undefined' ? window : globalThis).ErnestBooking);

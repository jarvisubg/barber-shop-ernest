/* Barber Shop Ernest — listino, anagrafiche e dati dimostrativi.
   Separato dal motore perché è l'unica parte che cambia quando il negozio
   cambia prezzi, orari o personale. */
(function (global, T) {
  'use strict';

  /* Si alza di uno ogni volta che cambiano prezzi o durate qui sotto. Il motore
     la usa per aggiornare il listino sui browser che hanno già i dati salvati,
     senza toccare le prenotazioni già prese.
     2 = 2026-08-03, "Capelli + Barba" 45 min e "+ Shampoo" 50 min. */
  var LISTINO_VERSIONE = 2;

  /* Prezzi e durate reali del negozio. prezzoPieno esiste solo sui combo e
     serve a calcolare il risparmio mostrato in UI: non va mai hardcodato.

     `evidenza` è la posizione nella sezione "In evidenza" in cima al listino:
     sono le voci che il negozio vende di più e vuole far vedere per prime.
     Senza il campo il servizio esiste ancora, ma solo dentro la sua categoria.
     L'ordine è quello deciso dal negozio, non il prezzo: non riordinarlo. */
  var SERVIZI = [
    { id: 'cap-base', nome: 'Taglio Base', descrizione: 'Taglio senza shampoo', categoria: 'capelli', durata: 30, prezzo: 15, ordine: 1, evidenza: 1, attivo: true },
    { id: 'cap-lunghi', nome: 'Capelli Lunghi', descrizione: 'Shampoo + taglio', categoria: 'capelli', durata: 40, prezzo: 20, ordine: 2, attivo: true },
    { id: 'cap-bimbo', nome: 'Taglio Bimbo', descrizione: 'Da 0 a 10 anni', categoria: 'capelli', durata: 20, prezzo: 12, ordine: 3, evidenza: 3, attivo: true },
    { id: 'cap-rasatura', nome: 'Rasatura Unica', descrizione: 'Taglio con la stessa misura su tutta la testa', categoria: 'capelli', durata: 20, prezzo: 12, ordine: 4, attivo: true },

    { id: 'barba-normale', nome: 'Barba Normale', descrizione: 'Taglio di barba', categoria: 'barba', durata: 15, prezzo: 10, ordine: 1, evidenza: 7, attivo: true },
    { id: 'barba-lunga', nome: 'Barba Lunga', descrizione: 'Panno caldo + panno freddo + shampoo di barba', categoria: 'barba', durata: 30, prezzo: 15, ordine: 2, evidenza: 8, attivo: true },
    { id: 'barba-full', nome: 'Rasatura Full', descrizione: 'Rasatura completa a rasoio', categoria: 'barba', durata: 20, prezzo: 10, ordine: 3, attivo: true },

    { id: 'combo-base', nome: 'Capelli + Barba', descrizione: 'Taglio capelli e barba senza shampoo', categoria: 'combo', durata: 45, prezzo: 20, prezzoPieno: 25, ordine: 1, evidenza: 2, attivo: true },
    { id: 'combo-shampoo', nome: 'Capelli + Barba + Shampoo', descrizione: 'Taglio capelli e barba, shampoo incluso', categoria: 'combo', durata: 50, prezzo: 25, prezzoPieno: 30, ordine: 2, evidenza: 4, attivo: true },
    { id: 'combo-completo', nome: 'Capelli Lunghi + Barba Lunga', descrizione: 'Taglio capelli e barba lunga, shampoo incluso', categoria: 'combo', durata: 60, prezzo: 30, prezzoPieno: 35, ordine: 3, evidenza: 5, attivo: true },

    { id: 'extra-sopracciglia', nome: 'Sopracciglia', descrizione: 'Sistemazione sopracciglia', categoria: 'extra', durata: 5, prezzo: 5, ordine: 1, evidenza: 6, attivo: true },
    { id: 'extra-hairstyle', nome: 'Styling', descrizione: 'Lavaggio capelli + piega', categoria: 'extra', durata: 10, prezzo: 7, ordine: 2, evidenza: 9, attivo: true },
    { id: 'extra-cera', nome: 'Cera Calda', descrizione: 'Pulizia viso + naso a cera', categoria: 'extra', durata: 10, prezzo: 7, ordine: 3, attivo: true }
  ];

  var BARBIERI = [
    { id: 'b1', nome: 'Ernest', specialita: 'Fade e barba tradizionale', colore: '#c9cdd0', foto: 'images/barber-ernest/barbieri/ernest.webp', ordine: 1, attivo: true },
    { id: 'b2', nome: 'Mario', specialita: 'Tagli classici e rasatura a rasoio', colore: '#8fa3b0', foto: 'images/barber-ernest/barbieri/mario.webp', ordine: 2, attivo: true }
  ];

  /* Orari negozio: Lun 14-21 · Mar-Ven 10-12 e 13:30-21 · Sab 9-12 e 13:30-20 · Dom chiuso.
     Ogni barbiere ha più fasce per giorno — la pausa pranzo del martedì-venerdì
     è esprimibile solo con due righe, non con un unico apertura/chiusura. */
  function orari() {
    var out = [];
    function add(barberId, giorno, inizio, fine) {
      out.push({ id: T.uid(), barberId: barberId, giorno: giorno, inizio: inizio, fine: fine });
    }
    // Ernest — copre tutta l'apertura, riposa la domenica
    add('b1', 1, '14:00', '21:00');
    [2, 3, 4, 5].forEach(function (g) { add('b1', g, '10:00', '12:00'); add('b1', g, '13:30', '21:00'); });
    add('b1', 6, '09:00', '12:00'); add('b1', 6, '13:30', '20:00');
    // Mario — riposa domenica e lunedì, entra solo il pomeriggio infrasettimanale
    [2, 3, 4, 5].forEach(function (g) { add('b2', g, '13:30', '21:00'); });
    add('b2', 6, '09:00', '12:00'); add('b2', 6, '13:30', '20:00');
    return out;
  }

  var SETTINGS = {
    slotGranularita: 15,
    /* Buffer 0 = appuntamenti attaccati, com'è la giornata reale in negozio.
       Attenzione se lo si alza: il buffer vale su entrambi i lati e viene
       arrotondato alla griglia, quindi un solo minuto di buffer con griglia 15
       costa uno slot pieno prima e uno dopo ogni appuntamento. */
    buffer: 0,
    finestraCancellazioneOre: 2,
    anticipoMinimoMinuti: 60,
    giorniAvanti: 30,
    maxPrenotazioniAttive: 3,
    telefono: '+393280774789',
    telefonoLabel: '328 077 4789'
    /* La password del gestionale NON sta qui. Questo file finisce nel bundle
       pubblico: chiunque aprisse il sorgente della pagina la leggerebbe.
       Vive come secret del Worker (ERNEST_ADMIN_PASSWORD) e non lascia mai il
       server — vedi server/README.md. */
  };

  var NOMI = [
    ['Luca', 'Benedetti'], ['Andrea', 'Fabbri'], ['Simone', 'Gardini'], ['Marco', 'Tassinari'],
    ['Davide', 'Montanari'], ['Filippo', 'Ravaioli'], ['Nicola', 'Zauli'], ['Alessio', 'Bandini'],
    ['Gabriele', 'Sangiorgi'], ['Federico', 'Casadio'], ['Riccardo', 'Placci'], ['Tommaso', 'Baldini'],
    ['Stefano', 'Emiliani'], ['Michele', 'Lanzoni'], ['Giulio', 'Cavina']
  ];

  var RICETTE = [
    ['combo-completo'], ['cap-base'], ['cap-lunghi', 'extra-sopracciglia'], ['barba-lunga'],
    ['combo-base'], ['cap-bimbo'], ['cap-base', 'extra-cera'], ['barba-full'],
    ['combo-shampoo'], ['cap-lunghi'], ['barba-normale'], ['combo-base', 'extra-hairstyle'],
    ['cap-base', 'barba-normale'], ['cap-bimbo', 'extra-sopracciglia'], ['combo-shampoo']
  ];

  /* Popola le prenotazioni dimostrative usando le stesse funzioni del motore,
     così i dati di prova rispettano orari, buffer e chiusure come quelli veri.
     Tocca solo i record marcati seed: ciò che l'utente crea testando resta.

     ATTENZIONE — questo non deve girare in produzione, e infatti non gira più
     da solo: si chiama solo a mano dal Worker in ambiente di prova.
     Prima veniva eseguito a ogni cambio di giorno su ogni browser: il negozio
     si trovava l'agenda piena di clienti inventati che occupavano slot veri. */
  function popola(api) {
    var db = api.db, oggi = new Date();

    db.bookings = db.bookings.filter(function (b) { return !b.seed; });
    db.timeOff = db.timeOff.filter(function (t) { return !t.seed; });
    db.closures = db.closures.filter(function (c) { return !c.seed; });

    // Mezza giornata di permesso: Mario, fra 3 giorni dalle 17 in poi
    var perm = T.addDays(oggi, 3);
    db.timeOff.push({
      id: T.uid(), barberId: 'b2', seed: true,
      inizio: T.dayKey(perm) + 'T17:00', fine: T.dayKey(perm) + 'T21:00',
      motivo: 'Permesso personale'
    });

    // Chiusura negozio: giorno intero fra 12 giorni
    var chius = T.addDays(oggi, 12);
    db.closures.push({
      id: T.uid(), seed: true,
      inizio: T.dayKey(chius) + 'T00:00', fine: T.dayKey(chius) + 'T23:59',
      motivo: 'Chiusura straordinaria'
    });

    var creati = 0, giro = 0;
    while (creati < NOMI.length && giro < 400) {
      var g = 1 + (giro % 7);                       // giorni da oggi: 1..7
      var barb = db.barbers[giro % db.barbers.length];
      var ric = RICETTE[creati % RICETTE.length];
      var key = T.dayKey(T.addDays(oggi, g));
      var dur = api.totali(ric).durata;
      var liberi = api.slotsFor(key, barb.id, dur, { ignoraAnticipo: true });
      giro++;
      if (!liberi.length) continue;

      // due prenotazioni consecutive senza buco: la prima del giorno e quella subito dopo
      var scelto = liberi[Math.min(creati % 5 === 0 ? 0 : 2 + (creati % 6), liberi.length - 1)];
      var res = api.locale.creaPrenotazione({
        serviziIds: ric,
        nome: NOMI[creati][0], cognome: NOMI[creati][1],
        telefono: '+3933' + String(1000000 + creati * 7919).slice(0, 7),
        barberId: barb.id,
        inizio: key + 'T' + scelto.ora,
        lunghezzaCapelli: creati % 3 === 0 ? 'lunghi' : (creati % 3 === 1 ? 'corti' : 'solo_barba'),
        consenso: true,
        origine: creati % 4 === 0 ? 'manuale' : 'online',
        seed: true,
        forza: false
      });
      if (res.ok) creati++;
    }

    return creati;
  }

  global.ErnestSeed = {
    SERVIZI: SERVIZI, BARBIERI: BARBIERI, SETTINGS: SETTINGS,
    LISTINO_VERSIONE: LISTINO_VERSIONE,
    orari: orari, popola: popola
  };

})(typeof window !== 'undefined' ? window : globalThis,
   (typeof window !== 'undefined' ? window : globalThis).ErnestTempo);

/* Barber Shop Ernest — indirizzo del server delle prenotazioni.

   Unico file da toccare quando il Worker cambia indirizzo. Va caricato prima
   di engine.js.

   `api` vuoto = nessun server: il sito NON deve andare online così. Il widget
   se ne accorge e manda il cliente a telefonare invece di fargli credere di
   aver prenotato, ma resta una configurazione sbagliata — publish-pages.sh la
   blocca in pubblicazione.

   Il telefono qui sotto è di riserva: serve proprio nei momenti in cui il
   server non risponde e quindi le impostazioni del negozio non sono
   disponibili. */
window.ErnestConfig = {
  api: 'https://ernest-prenotazioni.prenotazioni.workers.dev',
  telefono: '+393280774789',
  telefonoLabel: '328 077 4789'
};

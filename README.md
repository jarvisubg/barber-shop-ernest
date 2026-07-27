# Barber Shop Ernest — anteprima sito e prenotazioni online

Anteprima navigabile del sito e del sistema di prenotazione per **Barber Shop Ernest**,
Corso Giuseppe Mazzini 128, Faenza (RA).

👉 **https://jarvisubg.github.io/barber-shop-ernest/**

Realizzato da [sitiperedilizia.it](https://sitiperedilizia.it).

---

## ⚠️ Questa è un'anteprima, non il sito ufficiale

Le prenotazioni **non arrivano al negozio**. Vengono salvate nel browser di chi visita la
pagina (`localStorage`) e servono solo a far provare il sistema: nessun appuntamento è
reale, nessun dato esce dal dispositivo.

Per andare in produzione servono un database e un backend veri.

---

## Cosa si può provare

**Sito** — scegli un servizio, un barbiere e un orario. Il sistema mostra solo gli slot
davvero liberi: rispetta gli orari del negozio (compresa la pausa pranzo del
martedì-venerdì), le ferie, le chiusure e la durata del servizio scelto. A fine
prenotazione ricevi un codice tipo `ERN-1234` per disdire da solo.

**Gestionale** — il pulsante in alto a destra, oppure `/booking/admin.html`.
Password: `ernest2026` (solo per l'anteprima).

Calendario con una colonna per barbiere, inserimento manuale cliccando su uno spazio
libero, spostamenti, listino, orari a fasce, ferie e chiusure.

---

## Dati dimostrativi

Le prenotazioni visibili sono finte e si rigenerano ogni giorno sui sette giorni
successivi. `Ripristina demo` nel gestionale riporta tutto allo stato iniziale.

I nomi dei barbieri (Ernest, Matteo, Kevin) sono **segnaposto** in attesa di quelli veri.

Il listino, gli orari, l'indirizzo e il telefono sono invece quelli reali del negozio.

---

## Come è fatto

HTML, CSS e JavaScript senza dipendenze né passaggi di build: si apre anche con un doppio
clic su `index.html`.

| File | Ruolo |
|---|---|
| `index.html` | Il sito |
| `booking/tempo.js` | Date, orari e formati |
| `booking/seed.js` | Listino, barbieri, turni e dati dimostrativi |
| `booking/engine.js` | Disponibilità, regole di prenotazione, scritture |
| `booking/selfcheck.js` | 12 verifiche automatiche del motore |
| `booking/widget*.js`, `booking/booking.css` | Il flusso di prenotazione pubblico |
| `booking/admin*.js`, `booking/admin.html` | Il gestionale |

Per cambiare prezzi, orari o personale si tocca solo `booking/seed.js`.

### Verifiche

Le regole delicate (sovrapposizioni, pausa pranzo, buffer fra un cliente e il successivo,
ferie, chiusure, finestra di disdetta) hanno 12 controlli automatici. Si lanciano dal
gestionale in `Impostazioni → Esegui verifiche`, oppure aggiungendo `?selfcheck`
all'indirizzo e aprendo la console.

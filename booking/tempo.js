/* Ernest Barbershop — helper di data, ora e formato.
   Tutto in ora locale: il negozio sta a Faenza, un solo fuso.
   Le date si serializzano come "YYYY-MM-DDTHH:mm" senza UTC, così i confronti
   restano anche lessicografici ed evitano lo scarto di un'ora all'ora legale. */
(function (global) {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function toMin(hhmm) {
    var p = hhmm.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  function toHHMM(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }

  function at(key, minutes) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, minutes);
  }

  function stamp(d) {
    return dayKey(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function parse(s) {
    var parts = s.split('T');
    var d = parts[0].split('-');
    var t = parts[1].split(':');
    return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), Number(t[0]), Number(t[1]));
  }

  /* 1 = lunedì ... 7 = domenica */
  function weekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); }

  function addDays(d, n) {
    var x = new Date(d.getTime());
    x.setDate(x.getDate() + n);
    return x;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  var GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  var MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

  /* L'anno compare solo se non è quello in corso. Da quando si prenota fino a
     un anno avanti, "martedì 3 agosto" da solo è ambiguo: chi conferma per
     l'estate prossima deve vederlo scritto. */
  function labelData(d) {
    var base = GIORNI[weekday(d)] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()];
    return d.getFullYear() === new Date().getFullYear() ? base : base + ' ' + d.getFullYear();
  }

  function euro(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.00', '').replace('.', ',') + ' €';
  }

  function durataLabel(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return m ? h + 'h ' + m + "'" : h + 'h';
  }

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  global.ErnestTempo = {
    pad: pad, dayKey: dayKey, toMin: toMin, toHHMM: toHHMM, at: at,
    stamp: stamp, parse: parse, weekday: weekday, addDays: addDays,
    overlaps: overlaps, labelData: labelData, euro: euro, durataLabel: durataLabel,
    uid: uid, GIORNI: GIORNI, MESI: MESI
  };

})(typeof window !== 'undefined' ? window : globalThis);

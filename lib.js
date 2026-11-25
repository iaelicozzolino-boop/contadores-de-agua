/* Lógica de cálculo, sin DOM. Se usa en el navegador y en node (tests). */
(function (root) {
  'use strict';
  const MS = 86400000;

  function parseFecha(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function fmtFecha(t) { return new Date(t).toISOString().slice(0, 10); }
  function sumaDias(s, n) { return fmtFecha(parseFecha(s) + n * MS); }
  function diasEntre(a, b) { return Math.round((parseFecha(b) - parseFecha(a)) / MS); }
  function hoyMadrid() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  /* Texto -> milésimas de m³ (entero). Sin coma flotante. */
  function parseValor(txt, digitos) {
    const t = String(txt == null ? '' : txt).trim().replace(/\s/g, '').replace(',', '.');
    if (!t) return { ok: false, error: 'Falta la lectura' };
    if (!/^\d+(\.\d{0,3})?$/.test(t)) return { ok: false, error: 'Formato no válido. Ejemplo: 12345,678' };
    const parts = t.split('.');
    const ent = parts[0].replace(/^0+(?=\d)/, '');
    if (ent.length > digitos) return { ok: false, error: 'Máximo ' + digitos + ' dígitos enteros' };
    const dec = ((parts[1] || '') + '000').slice(0, 3);
    return { ok: true, milesimas: Number(parts[0] + dec) };
  }

  function fmtM3(mil, conSigno) {
    if (mil == null) return '–';
    const neg = mil < 0; const s = String(Math.abs(mil)).padStart(4, '0');
    const ent = s.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : (conSigno ? '+' : '')) + ent + ',' + s.slice(-3);
  }

  /* Serie diaria de un contador.
     estados: inicial, ok, sin_lectura, pendiente (hoy aún sin leer), acumulado (hueco previo),
              reseteo, menor (lectura menor que la anterior, sin consumo) */
  function calcularSerie(lects, c, hoy) {
    const arr = lects.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    if (!arr.length) return [];
    const map = new Map(arr.map(l => [l.fecha, l]));
    const minAbs = Math.round(Number(c.umbral_fuga_min_m3) * 1000);
    const dias = []; const hist = []; let prev = null;
    const fin = arr[arr.length - 1].fecha > hoy ? arr[arr.length - 1].fecha : hoy;
    for (let f = arr[0].fecha; f <= fin; f = sumaDias(f, 1)) {
      const l = map.get(f) || null;
      const d = { fecha: f, lectura: l, consumo: null, estado: '', alerta: false, media: null, acumulado: null };
      if (!l) { d.estado = f === hoy ? 'pendiente' : 'sin_lectura'; dias.push(d); continue; }
      if (!prev) d.estado = 'inicial';
      else if (l.reseteo) d.estado = 'reseteo';
      else if (l.valor < prev.valor) d.estado = 'menor';
      else {
        const gap = diasEntre(prev.fecha, f); const dif = l.valor - prev.valor;
        if (gap === 1) {
          d.estado = 'ok'; d.consumo = dif;
          const desde = sumaDias(f, -c.ventana_dias);
          const ref = hist.filter(h => h.fecha >= desde && !h.alerta);
          if (ref.length >= 5) {
            d.media = ref.reduce((s, h) => s + h.consumo, 0) / ref.length;
            if (dif > d.media * (1 + c.umbral_fuga_pct / 100) && dif > minAbs) d.alerta = true;
          }
          hist.push(d);
        } else { d.estado = 'acumulado'; d.acumulado = { dias: gap, milesimas: dif }; }
      }
      prev = l; dias.push(d);
    }
    return dias;
  }

  function lunesDe(f) { const dow = new Date(parseFecha(f)).getUTCDay(); return sumaDias(f, -((dow + 6) % 7)); }

  /* Totales por semana (lunes-domingo) o mes. series = {contadorId: dias[]} */
  function totales(series, hoy, tipo) {
    const per = new Map();
    Object.keys(series).forEach(id => {
      series[id].forEach(d => {
        if (d.estado === 'pendiente' || d.estado === 'inicial') return;
        const clave = tipo === 'semana' ? lunesDe(d.fecha) : d.fecha.slice(0, 7);
        if (!per.has(clave)) per.set(clave, {});
        const p = per.get(clave);
        const z = p[id] || (p[id] = { m3: 0, sinDato: 0, acumulado: 0 });
        if (d.estado === 'ok') z.m3 += d.consumo;
        else { z.sinDato++; if (d.estado === 'acumulado') z.acumulado += d.acumulado.milesimas; }
      });
    });
    return Array.from(per.keys()).sort().reverse().map(clave => {
      const zonas = per.get(clave); let m3 = 0, sinDato = 0, acumulado = 0;
      Object.values(zonas).forEach(z => { m3 += z.m3; sinDato += z.sinDato; acumulado += z.acumulado; });
      const fin = tipo === 'semana' ? sumaDias(clave, 6) : null;
      const enCurso = tipo === 'semana' ? fin >= hoy : clave === hoy.slice(0, 7);
      return { clave, zonas, total: { m3, sinDato, acumulado }, enCurso };
    });
  }

  const api = { parseFecha, fmtFecha, sumaDias, diasEntre, hoyMadrid, parseValor, fmtM3, calcularSerie, totales, lunesDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);

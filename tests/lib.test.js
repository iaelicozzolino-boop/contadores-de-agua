const assert = require('assert');
const L = require('../lib.js');
const c = { umbral_fuga_pct: 50, umbral_fuga_min_m3: 0.5, ventana_dias: 14 };
let v = 1000000;
const lects = [];
for (let i = 0; i < 10; i++) { lects.push({ fecha: L.sumaDias('2026-11-01', i), valor: v, reseteo: false }); v += 2000; }
// día 11 (11-11): consumo 9 m3 -> alerta
lects.push({ fecha: '2026-11-11', valor: v + 7000, reseteo: false });
// 11-12 sin lectura, 11-13 con lectura: acumulado
lects.push({ fecha: '2026-11-13', valor: v + 7000 + 5000, reseteo: false });
// 11-14 menor
lects.push({ fecha: '2026-11-14', valor: 1000, reseteo: false });
const s = L.calcularSerie(lects, c, '2026-11-15');
const by = f => s.find(d => d.fecha === f);
assert.equal(by('2026-11-01').estado, 'inicial');
assert.equal(by('2026-11-02').consumo, 2000);
assert.equal(by('2026-11-11').alerta, true);
assert.equal(by('2026-11-12').estado, 'sin_lectura');
assert.equal(by('2026-11-13').estado, 'acumulado');
assert.equal(by('2026-11-13').consumo, null);
assert.equal(by('2026-11-14').estado, 'menor');
assert.equal(by('2026-11-14').consumo, null);
assert.equal(by('2026-11-15').estado, 'pendiente');
assert.equal(L.parseValor('12345,678', 6).milesimas, 12345678);
assert.equal(L.parseValor('7.5', 6).milesimas, 7500);
assert.equal(L.parseValor('1234567', 6).ok, false);
assert.equal(L.parseValor('1,2345', 6).ok, false);
assert.equal(L.fmtM3(12345678), '12.345,678');
assert.equal(L.fmtM3(5), '0,005');
assert.equal(L.lunesDe('2026-11-25'), '2026-11-23');
const t = L.totales({ 1: s }, '2026-11-15', 'semana');
assert.ok(t.length >= 2);
const mes = L.totales({ 1: s }, '2026-11-15', 'mes');
assert.equal(mes.length, 1);
assert.equal(mes[0].zonas[1].sinDato, 3); // 12 sin lectura, 13 acumulado, 14 menor
console.log('ok');

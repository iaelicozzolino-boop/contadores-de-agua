(function () {
  'use strict';
  const L = window.Lib, CFG = window.CONFIG;
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const COLORS = ['var(--z1)', 'var(--z2)', 'var(--z3)'];
  const COLORS_HEX = ['#1F3A68', '#2F8FBF', '#7A5BB8'];

  const S = {
    token: null, contadores: [], lecturas: [], correcciones: [], series: {},
    tab: 'registro', fecha: L.hoyMadrid(), operario: '', cards: {},
    hist: { zona: null, limite: 45 }, graf: { rango: 60, off: {} }, tot: { tipo: 'semana' },
    cargado: false
  };

  /* ---------- utilidades ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
  const fmtDia = f => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(L.parseFecha(f));
  const fmtDiaLargo = f => new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(L.parseFecha(f));
  const fmtHora = iso => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date(iso));
  const hoy = () => L.hoyMadrid();
  const nombreZona = id => (S.contadores.find(c => c.id === id) || {}).nombre || '?';

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  function setNet(msg, err) { const n = $('#net'); n.textContent = msg || ''; n.className = 'net' + (err ? ' err' : ''); }
  function busy(msg) { $('#overlay').innerHTML = msg ? '<div class="busy">' + esc(msg) + '</div>' : ''; }

  async function rpc(fn, args) {
    const r = await fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { 'apikey': CFG.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_token: S.token }, args || {}))
    });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { /* no JSON */ }
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('Error ' + r.status));
    return j;
  }

  /* ---------- datos ---------- */
  function recalcular() {
    S.series = {};
    S.contadores.forEach(c => { S.series[c.id] = L.calcularSerie(S.lecturas.filter(l => l.contador_id === c.id), c, hoy()); });
    if (!S.hist.zona && S.contadores.length) S.hist.zona = S.contadores[0].id;
  }
  async function cargar() {
    try {
      setNet('Cargando…');
      const d = await rpc('app_datos');
      S.contadores = d.contadores; S.lecturas = d.lecturas; S.correcciones = d.correcciones;
      S.cargado = true; recalcular(); setNet('');
    } catch (e) { setNet('Sin conexión con el servidor: ' + e.message, true); throw e; }
  }
  const operarios = () => {
    const s = new Set(); S.lecturas.forEach(l => s.add(l.operario)); S.correcciones.forEach(c => s.add(c.operario)); return Array.from(s).sort();
  };

  /* ---------- navegación ---------- */
  function go(tab) {
    S.tab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    render();
  }
  function render() {
    if (!S.token) { app.innerHTML = '<div class="msg bad">Abre la app con el enlace completo que te dieron. Este enlace no incluye el código de acceso.</div>'; return; }
    if (!S.cargado) { app.innerHTML = '<div class="empty">Cargando…</div>'; return; }
    ({ registro: vRegistro, grafico: vGrafico, totales: vTotales, historial: vHistorial, ajustes: vAjustes })[S.tab]();
  }

  /* ============ REGISTRO ============ */
  function card(id) { return S.cards[id] || (S.cards[id] = { texto: '', foto: null, reseteo: false, ack: false, conf: new Set(), leyendo: false }); }
  function lecturaDe(id, fecha) { return S.lecturas.find(l => l.contador_id === id && l.fecha === fecha); }
  function anteriorA(id, fecha) {
    let r = null; S.lecturas.forEach(l => { if (l.contador_id === id && l.fecha < fecha && (!r || l.fecha > r.fecha)) r = l; }); return r;
  }

  function vRegistro() {
    const ops = operarios();
    app.innerHTML =
      '<div class="row2 field">' +
        '<div><label class="lbl" for="f-fecha">Fecha</label><input type="date" id="f-fecha" value="' + S.fecha + '" max="' + hoy() + '"></div>' +
        '<div><label class="lbl" for="f-op">Tu nombre</label><input type="text" id="f-op" list="ops" autocomplete="off" placeholder="Nombre" value="' + esc(S.operario) + '"></div>' +
      '</div><datalist id="ops">' + ops.map(o => '<option value="' + esc(o) + '">').join('') + '</datalist>' +
      (S.fecha !== hoy() ? '<div class="msg warn" style="margin:0 0 12px">Estás registrando el ' + esc(fmtDiaLargo(S.fecha)) + ', no hoy.</div>' : '') +
      S.contadores.map(c => '<div class="card" id="card-' + c.id + '"></div>').join('');
    S.contadores.forEach(c => pintarCard(c.id, true));
  }

  function chipsInfo(c, st) {
    const n = c.digitos_enteros + 3;
    const p = L.parseValor(st.texto, c.digitos_enteros);
    if (!st.foto || !p.ok) return null;
    const cur = String(p.milesimas).padStart(n, '0'), ocr = st.foto.digitos;
    const items = cur.split('').map((d, i) => {
      const duda = st.foto.dudosas[i];
      let cls = '';
      if (duda) cls = (d !== ocr[i] || st.conf.has(i)) ? 'fixed' : 'pend';
      return { d, cls, i };
    });
    return { items, pend: items.filter(x => x.cls === 'pend').length, n };
  }

  function pintarCard(id, completa) {
    const c = S.contadores.find(x => x.id === id), st = card(id), el = $('#card-' + id);
    if (!el) return;
    const existente = lecturaDe(id, S.fecha), color = COLORS[S.contadores.indexOf(c) % 3];
    if (completa) {
      let h = '<h2><span class="dot" style="background:' + color + '"></span>' + esc(c.nombre) + '</h2>';
      const prev = anteriorA(id, S.fecha);
      h += '<div class="sub">' + (prev ? 'Anterior: <b class="num">' + L.fmtM3(prev.valor) + '</b> m³ · ' + esc(fmtDia(prev.fecha)) : 'Sin lecturas anteriores') + '</div>';
      if (existente) {
        h += '<div style="margin-top:10px"><div class="big">' + L.fmtM3(existente.valor) + ' <span class="sub">m³</span></div>' +
          '<div class="sub">Registrada por ' + esc(existente.operario) + ' · ' + esc(fmtHora(existente.creada_en)) + '</div></div>' +
          '<div class="actions"><button class="btn" data-act="detalle" data-id="' + existente.id + '">Ver</button><button class="btn primary" data-act="corregir" data-id="' + existente.id + '">Corregir</button></div>';
        el.innerHTML = h; return;
      }
      h += '<div class="field" style="margin-top:10px"><label class="lbl" for="in-' + id + '">Lectura (m³, hasta ' + c.digitos_enteros + ' enteros y 3 decimales)</label>' +
        '<input type="text" inputmode="decimal" autocomplete="off" id="in-' + id + '" data-in="' + id + '" placeholder="' + '0'.repeat(c.digitos_enteros) + ',000" value="' + esc(st.texto) + '"></div>' +
        '<div class="pv"></div><div class="chips"></div><div class="acks"></div>' +
        '<div class="actions"><label class="btn" style="cursor:pointer">📷 Foto<input type="file" accept="image/*" capture="environment" data-foto="' + id + '" hidden></label>' +
        '<button class="btn primary" data-act="guardar" data-id="' + id + '" disabled>Guardar</button></div>';
      el.innerHTML = h;
    }
    if (existente) return;
    const p = L.parseValor(st.texto, c.digitos_enteros);
    const pv = el.querySelector('.pv'), chips = el.querySelector('.chips'), acks = el.querySelector('.acks'), btn = el.querySelector('[data-act=guardar]');
    let html = '', puedeGuardar = p.ok && !st.leyendo && !!S.operario.trim(), aviso = '';
    if (st.texto && !p.ok) html += '<div class="msg bad">' + esc(p.error) + '</div>';
    if (p.ok) {
      const prev = anteriorA(id, S.fecha);
      const prov = S.lecturas.filter(l => l.contador_id === id).concat([{ fecha: S.fecha, valor: p.milesimas, reseteo: st.reseteo, contador_id: id }]);
      const serie = L.calcularSerie(prov, c, hoy()), d = serie.find(x => x.fecha === S.fecha);
      if (d && d.estado === 'ok') {
        html += '<div class="msg ' + (d.alerta ? 'bad' : 'info') + '">Consumo del día: <b class="num">' + L.fmtM3(d.consumo) + ' m³</b>' +
          (d.alerta ? '<br>⚠ Posible fuga: la media de los últimos días es ' + L.fmtM3(Math.round(d.media)) + ' m³ y este valor la supera más de un ' + c.umbral_fuga_pct + '%.' : '') + '</div>';
      } else if (d && d.estado === 'acumulado') {
        html += '<div class="msg warn">Faltan lecturas desde el ' + esc(fmtDia(prev.fecha)) + ' (' + d.acumulado.dias + ' días hasta esta). Diferencia: <b class="num">' + L.fmtM3(d.acumulado.milesimas) + ' m³</b>. No se reparte entre los días; el consumo diario queda sin calcular.</div>';
      } else if (d && d.estado === 'menor') {
        puedeGuardar = false;
        html += '<div class="msg bad">La lectura es <b>menor</b> que la anterior (' + L.fmtM3(prev.valor) + ' m³). Puede ser un error al teclear o un contador reseteado o sustituido. No se calcula consumo negativo.</div>';
        aviso = '<label class="check"><input type="checkbox" data-reseteo="' + id + '">El contador se ha reseteado o sustituido (la lectura es correcta)</label>';
      } else if (d && d.estado === 'reseteo') {
        html += '<div class="msg warn">Marcado como reseteo o sustitución del contador. Este día no tiene consumo.</div>';
        aviso = '<label class="check"><input type="checkbox" data-reseteo="' + id + '" checked>El contador se ha reseteado o sustituido</label>';
      }
    }
    const ci = chipsInfo(c, st);
    if (ci) {
      let ch = '<span class="sub" style="width:100%">Lectura leída de la pantalla. Compara con el contador y toca cada cifra en rojo cuando la hayas comprobado (en pantallas LCD se confunden el 1 con el 7, el 3 con el 8 y el 5 con el 6):</span>';
      ci.items.forEach((x, k) => {
        if (k === c.digitos_enteros) ch += '<span class="sep">,</span>';
        ch += '<button type="button" class="chip ' + (k >= c.digitos_enteros ? 'dec ' : '') + x.cls + '" data-chip="' + id + ':' + x.i + '">' + x.d + '</button>';
      });
      chips.innerHTML = ch;
      let ak = '';
      if (ci.pend) ak += '<div class="msg warn">' + ci.pend + (ci.pend === 1 ? ' cifra dudosa sin confirmar' : ' cifras dudosas sin confirmar') + '.</div>';
      ak += '<label class="check"><input type="checkbox" data-ack="' + id + '"' + (st.ack ? ' checked' : '') + '>He comparado el número con el contador y es correcto</label>';
      acks.innerHTML = ak + aviso;
      if (ci.pend || !st.ack) puedeGuardar = false;
    } else { chips.innerHTML = ''; acks.innerHTML = aviso; }
    if (st.leyendo) html = '<div class="msg info">Leyendo la foto…</div>' + html;
    if (st.foto && st.foto.error) html = '<div class="msg warn">' + esc(st.foto.error) + '</div>' + html;
    if (!S.operario.trim() && p.ok) html += '<div class="msg warn">Escribe tu nombre arriba para poder guardar.</div>';
    pv.innerHTML = html;
    if (btn) btn.disabled = !puedeGuardar;
  }

  async function guardar(id) {
    const c = S.contadores.find(x => x.id === id), st = card(id), p = L.parseValor(st.texto, c.digitos_enteros);
    if (!p.ok) return;
    const dud = st.foto ? st.foto.dudosas.map((d, i) => d ? i + 1 : null).filter(Boolean).join(',') || null : null;
    busy('Guardando…');
    try {
      await rpc('app_guardar_lectura', {
        p_contador: id, p_fecha: S.fecha, p_valor: p.milesimas, p_origen: st.foto ? 'foto' : 'manual',
        p_dudosas: dud, p_ocr: st.foto ? { texto: st.foto.texto, digitos: st.foto.digitos, confianza: st.foto.conf } : null,
        p_reseteo: !!st.reseteo, p_operario: S.operario.trim()
      });
      S.cards[id] = null; await cargar(); toast('Lectura guardada: ' + c.nombre);
    } catch (e) { toast('No se guardó: ' + e.message); }
    busy(''); if (S.tab === 'registro') render();
  }

  /* ---------- OCR (Tesseract en el móvil) ---------- */
  function cargarScript(src) {
    return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => ko(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
  }
  /* Contadores digitales (LCD de 7 segmentos): el usuario recorta la línea principal de cifras,
     se enmascara el rojo (recuadro), se binariza con umbral local y se lee con Tesseract. */
  async function cargarBitmap(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* respaldo */ }
    try { return await createImageBitmap(file); } catch (e) { /* respaldo */ }
    return new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ko(new Error('No se pudo abrir la imagen')); im.src = URL.createObjectURL(file); });
  }
  const roiGet = id => { try { const r = JSON.parse(lsGet('roi-' + id)); if (r && r.w > 0.02 && r.h > 0.02) return r; } catch (e) { /* nada */ } return { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }; };
  let cropResolve = null;

  /* Paso de recorte: devuelve {x,y,w,h} en fracciones de la imagen, o null si se cancela */
  function recortar(bmp, id, c) {
    return new Promise(ok => {
      cropResolve = ok;
      let r = roiGet(id);
      const maxW = Math.min(560, window.innerWidth - 36), maxH = Math.round(window.innerHeight * 0.55);
      const k = Math.min(maxW / bmp.width, maxH / bmp.height), W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
      sheet('<h3>Recorta la línea de cifras</h3><div class="sub">Dibuja con el dedo un recuadro que rodee <b>solo el número grande</b> de ' + esc(c.nombre) + '. Deja fuera el recuadro rojo y los números pequeños de abajo. Se recuerda para la próxima vez.</div>' +
        '<canvas id="crop-cv" width="' + W + '" height="' + H + '" style="width:' + W + 'px;height:' + H + 'px;max-width:100%;touch-action:none;border-radius:12px;margin:12px auto;display:block;border:1px solid var(--line)"></canvas>' +
        '<div class="actions"><button class="btn" data-act="crop-no">Cancelar</button><button class="btn primary" data-act="crop-ok">Leer cifras</button></div>');
      const cv = $('#crop-cv'), g = cv.getContext('2d');
      const pintar = () => {
        g.drawImage(bmp, 0, 0, W, H); g.fillStyle = 'rgba(20,24,31,.45)'; g.fillRect(0, 0, W, H);
        const x = r.x * W, y = r.y * H, w = r.w * W, h = r.h * H;
        g.drawImage(bmp, r.x * bmp.width, r.y * bmp.height, r.w * bmp.width, r.h * bmp.height, x, y, w, h);
        g.strokeStyle = '#2F8FBF'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
      };
      pintar();
      let ini = null; const pos = ev => { const b = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (ev.clientY - b.top) / b.height)) }; };
      cv.addEventListener('pointerdown', ev => { ini = pos(ev); cv.setPointerCapture(ev.pointerId); });
      cv.addEventListener('pointermove', ev => { if (!ini) return; const p = pos(ev); r = { x: Math.min(ini.x, p.x), y: Math.min(ini.y, p.y), w: Math.abs(p.x - ini.x), h: Math.abs(p.y - ini.y) }; pintar(); });
      cv.addEventListener('pointerup', () => { ini = null; });
      cropResolve = v => { cropResolve = null; ok(v ? (r.w > 0.02 && r.h > 0.02 ? r : null) : null); };
    });
  }

  /* Recorte -> escala de grises sin rojo, escala x, umbral local */
  function prepararLCD(bmp, r, modo) {
    const sw = Math.max(1, Math.round(r.w * bmp.width)), sh = Math.max(1, Math.round(r.h * bmp.height));
    const esc2 = Math.min(5, Math.max(1, 140 / sh)), w = Math.round(sw * esc2), h = Math.round(sh * esc2), pad = 24;
    const cv = document.createElement('canvas'); cv.width = w + pad * 2; cv.height = h + pad * 2;
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, r.x * bmp.width, r.y * bmp.height, sw, sh, pad, pad, w, h);
    const im = ctx.getImageData(pad, pad, w, h), px = im.data, gris = new Float32Array(w * h);
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const R = px[i], G = px[i + 1], B = px[i + 2];
      gris[j] = (R > 70 && R > G * 1.6 && R > B * 1.4) ? 255 : 0.299 * R + 0.587 * G + 0.114 * B; // el recuadro rojo se ignora
    }
    if (modo === 'binario') {
      const ii = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += gris[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; } }
      const rad = Math.max(8, Math.round(h / 4));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1), y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
        const s = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0], m = s / ((x1 - x0) * (y1 - y0));
        const v = gris[y * w + x] < m * 0.9 ? 0 : 255, o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255;
      }
    } else {
      let lo = 255, hi = 0; for (let j = 0; j < gris.length; j++) { if (gris[j] < 255) { if (gris[j] < lo) lo = gris[j]; if (gris[j] > hi) hi = gris[j]; } }
      const rng = Math.max(1, hi - lo);
      for (let j = 0, o = 0; j < gris.length; j++, o += 4) { const v = Math.max(0, Math.min(255, (gris[j] - lo) * 255 / rng)); px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255; }
    }
    ctx.putImageData(im, pad, pad); return cv;
  }

  window.__lcd = prepararLCD; // para pruebas
  let worker = null;
  async function reconocer(cv) {
    const { data } = await worker.recognize(cv, {}, { blocks: true });
    const sims = [];
    (function walk(o) {
      if (!o) return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.symbols) o.symbols.forEach(s => sims.push(s));
      ['blocks', 'paragraphs', 'lines', 'words'].forEach(k => o[k] && walk(o[k]));
    })(data);
    let digs = [], conf = [];
    sims.forEach(s => { if (/^\d$/.test(s.text)) { digs.push(s.text); conf.push(Math.round(s.confidence)); } });
    if (!digs.length) { const t = (data.text || '').replace(/\D/g, ''); digs = t.split(''); conf = digs.map(() => 0); }
    return { digs, conf, texto: (data.text || '').trim() };
  }

  async function leerFoto(bmp, r, c) {
    const n = c.digitos_enteros + 3;
    if (!window.Tesseract) await cargarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    if (!worker) {
      worker = await window.Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
    }
    const intentos = [];
    for (const modo of ['binario', 'gris']) {
      const x = await reconocer(prepararLCD(bmp, r, modo));
      x.puntos = (x.digs.length === n ? 1000 : 0) + (x.conf.length ? x.conf.reduce((a, b) => a + b, 0) / x.conf.length : 0);
      intentos.push(x);
    }
    intentos.sort((a, b) => b.puntos - a.puntos);
    let { digs, conf, texto } = intentos[0];
    if (!digs.length) return { error: 'No se ha detectado ningún número. Ajusta el recuadro para que rodee solo las cifras, evita reflejos y limpia la pantalla si puedes. O escríbelo a mano.', texto, digitos: '', dudosas: [], conf: [] };
    let aviso = null;
    if (digs.length !== n) {
      aviso = 'Se han detectado ' + digs.length + ' cifras y este contador tiene ' + n + ' (' + c.digitos_enteros + ' enteras y 3 decimales). Revisa todas, o repite el recorte.';
      if (digs.length > n) { digs = digs.slice(-n); conf = conf.slice(-n); } else { while (digs.length < n) { digs.unshift('0'); conf.unshift(0); } }
    }
    // En 7 segmentos se confunden 1/7, 3/8, 5/6, 0/8, 6/8: se exige más confianza que con texto impreso.
    const dudosas = conf.map(x => aviso ? true : x < 90);
    return { digitos: digs.join(''), dudosas, conf, texto, error: aviso };
  }

  async function onFoto(id, file) {
    const c = S.contadores.find(x => x.id === id), st = card(id);
    if (!file) return;
    let bmp;
    try { bmp = await cargarBitmap(file); } catch (e) { toast('No se pudo abrir la foto'); return; }
    const r = await recortar(bmp, id, c);
    cerrar();
    if (!r) return;
    lsSet('roi-' + id, JSON.stringify(r));
    st.leyendo = true; st.foto = null; st.ack = false; st.conf = new Set(); st.reseteo = false; pintarCard(id);
    try {
      const res = await leerFoto(bmp, r, c);
      st.foto = res;
      if (res.digitos) {
        const n = res.digitos, e = n.slice(0, c.digitos_enteros).replace(/^0+(?=\d)/, ''), d = n.slice(c.digitos_enteros);
        st.texto = e + ',' + d; const inp = $('#in-' + id); if (inp) inp.value = st.texto;
      }
    } catch (e) { st.foto = { error: 'Error al leer la foto: ' + e.message + '. Escribe la lectura a mano.', digitos: '', dudosas: [], conf: [], texto: '' }; }
    st.leyendo = false; pintarCard(id);
  }

  /* ============ CORRECCIÓN / DETALLE ============ */
  function sheet(html) {
    $('#overlay').innerHTML = '<div class="scrim" data-act="cerrar"><div class="sheet"><div class="grab"></div>' + html + '</div></div>';
  }
  const cerrar = () => { $('#overlay').innerHTML = ''; };

  function detalle(lid) {
    const l = S.lecturas.find(x => x.id === lid); if (!l) return;
    const cs = S.correcciones.filter(x => x.lectura_id === lid).sort((a, b) => (a.corregida_en < b.corregida_en ? 1 : -1));
    const orig = cs.length ? cs[cs.length - 1].valor_anterior : l.valor;
    sheet('<h3>' + esc(nombreZona(l.contador_id)) + ' · ' + esc(fmtDia(l.fecha)) + '</h3>' +
      '<div class="big">' + L.fmtM3(l.valor) + ' <span class="sub">m³</span></div>' +
      '<div class="sub">Primera anotación: ' + L.fmtM3(orig) + ' m³ por ' + esc(l.operario) + ' · ' + esc(fmtHora(l.creada_en)) + ' · ' + (l.origen === 'foto' ? 'por foto' : 'a mano') +
      (l.cifras_dudosas ? ' · cifras dudosas: ' + esc(l.cifras_dudosas) : '') + (l.reseteo ? ' · reseteo de contador' : '') + '</div>' +
      '<h4 class="sec">Correcciones (' + cs.length + ')</h4>' +
      (cs.length ? '<div class="list">' + cs.map(x => '<div class="item"><div class="grow"><div class="t num">' + L.fmtM3(x.valor_anterior) + ' → ' + L.fmtM3(x.valor_nuevo) + '</div><div class="sub">' + esc(x.operario) + ' · ' + esc(fmtHora(x.corregida_en)) + (x.motivo ? '<br>' + esc(x.motivo) : '') + (x.reseteo_anterior !== x.reseteo_nuevo ? '<br>Reseteo: ' + (x.reseteo_nuevo ? 'marcado' : 'desmarcado') : '') + '</div></div></div>').join('') + '</div>' : '<div class="sub">Sin correcciones.</div>') +
      '<div class="actions"><button class="btn" data-act="cerrar">Cerrar</button><button class="btn primary" data-act="corregir" data-id="' + lid + '">Corregir</button></div>');
  }
  function corregir(lid) {
    const l = S.lecturas.find(x => x.id === lid), c = S.contadores.find(x => x.id === l.contador_id);
    sheet('<h3>Corregir lectura</h3><div class="sub">' + esc(c.nombre) + ' · ' + esc(fmtDia(l.fecha)) + '. Valor actual: <b class="num">' + L.fmtM3(l.valor) + ' m³</b>. El valor anterior queda guardado.</div>' +
      '<div class="field" style="margin-top:12px"><label class="lbl" for="c-val">Valor correcto (m³)</label><input type="text" inputmode="decimal" id="c-val" value="' + esc(L.fmtM3(l.valor).replace(/\./g, '')) + '"></div>' +
      '<div class="field"><label class="lbl" for="c-op">Tu nombre</label><input type="text" id="c-op" list="ops2" value="' + esc(S.operario) + '"><datalist id="ops2">' + operarios().map(o => '<option value="' + esc(o) + '">').join('') + '</datalist></div>' +
      '<div class="field"><label class="lbl" for="c-mot">Motivo (opcional)</label><textarea id="c-mot" placeholder="Error al teclear, cifra mal leída…"></textarea></div>' +
      '<label class="check"><input type="checkbox" id="c-res"' + (l.reseteo ? ' checked' : '') + '>El contador se reseteó o se sustituyó este día</label>' +
      '<div id="c-msg"></div><div class="actions"><button class="btn" data-act="cerrar">Cancelar</button><button class="btn primary" data-act="ok-corregir" data-id="' + lid + '">Guardar corrección</button></div>');
  }
  async function okCorregir(lid) {
    const l = S.lecturas.find(x => x.id === lid), c = S.contadores.find(x => x.id === l.contador_id);
    const p = L.parseValor($('#c-val').value, c.digitos_enteros), op = $('#c-op').value.trim(), msg = $('#c-msg');
    if (!p.ok) { msg.innerHTML = '<div class="msg bad">' + esc(p.error) + '</div>'; return; }
    if (!op) { msg.innerHTML = '<div class="msg bad">Escribe tu nombre.</div>'; return; }
    S.operario = op; lsSet('operario', op);
    busy('Guardando…');
    try {
      await rpc('app_corregir_lectura', { p_lectura: lid, p_valor: p.milesimas, p_reseteo: $('#c-res').checked, p_operario: op, p_motivo: $('#c-mot').value });
      await cargar(); busy(''); cerrar(); toast('Corrección guardada'); render();
    } catch (e) { busy(''); msg.innerHTML = '<div class="msg bad">' + esc(e.message) + '</div>'; }
  }

  /* ============ HISTORIAL ============ */
  const ESTADO = { sin_lectura: 'Sin lectura', pendiente: 'Pendiente de hoy', inicial: 'Primera lectura', reseteo: 'Reseteo de contador', menor: 'Menor que la anterior' };
  function vHistorial() {
    const z = S.hist.zona, serie = (S.series[z] || []).slice().reverse();
    let h = '<div class="seg">' + S.contadores.map(c => '<button data-act="zona" data-id="' + c.id + '" class="' + (c.id === z ? 'on' : '') + '">' + esc(c.nombre) + '</button>').join('') + '</div>';
    if (!serie.length) h += '<div class="empty">Todavía no hay lecturas de esta zona.</div>';
    else {
      h += '<div class="list">' + serie.slice(0, S.hist.limite).map(d => {
        const l = d.lectura, ncor = l ? S.correcciones.filter(x => x.lectura_id === l.id).length : 0;
        let der = '', tags = '';
        if (d.estado === 'ok') der = L.fmtM3(d.consumo) + ' m³';
        else if (d.estado === 'acumulado') { der = '+' + L.fmtM3(d.acumulado.milesimas) + ' m³'; tags = '<span class="tag warn">Acumulado ' + d.acumulado.dias + ' días</span>'; }
        else tags = '<span class="tag ' + (d.estado === 'menor' || d.estado === 'sin_lectura' ? 'warn' : '') + '">' + ESTADO[d.estado] + '</span>';
        if (d.alerta) tags += ' <span class="tag alert">Posible fuga</span>';
        if (ncor) tags += ' <span class="tag brand">Corregida ×' + ncor + '</span>';
        return '<div class="item ' + (l ? 'clickable' : '') + '" ' + (l ? 'data-act="detalle" data-id="' + l.id + '"' : '') + '>' +
          '<div class="grow"><div class="t">' + esc(fmtDia(d.fecha)) + '</div><div class="sub">' + (l ? '<span class="num">' + L.fmtM3(l.valor) + '</span> m³ · ' + esc(l.operario) : '') + '</div><div style="margin-top:3px">' + tags + '</div></div>' +
          '<div class="r" ' + (d.alerta ? 'style="color:var(--alert)"' : '') + '>' + der + '</div>' +
          (!l && d.estado === 'sin_lectura' ? '<button class="btn" data-act="registrar-dia" data-fecha="' + d.fecha + '" style="height:36px;padding:0 12px">Añadir</button>' : '') + '</div>';
      }).join('') + '</div>';
      if (serie.length > S.hist.limite) h += '<button class="btn block" data-act="mas" style="margin-top:12px">Ver más</button>';
    }
    app.innerHTML = h;
  }

  /* ============ GRÁFICO ============ */
  function vGrafico() {
    const rango = S.graf.rango, fin = hoy(), ini = rango ? L.sumaDias(fin, -(rango - 1)) : null;
    let h = '<div class="seg">' + [[30, '30 días'], [60, '60 días'], [180, '6 meses'], [0, 'Todo']].map(r => '<button data-act="rango" data-v="' + r[0] + '" class="' + (r[0] === rango ? 'on' : '') + '">' + r[1] + '</button>').join('') + '</div>';
    h += '<div class="legend">' + S.contadores.map((c, i) => '<button data-act="toggle-zona" data-id="' + c.id + '" style="all:unset;cursor:pointer;opacity:' + (S.graf.off[c.id] ? .35 : 1) + '"><i style="background:' + COLORS[i % 3] + '"></i>' + esc(c.nombre) + '</button>').join('') + '<span><i style="background:var(--alert);border-radius:50%"></i>Posible fuga</span></div>';
    const act = S.contadores.filter(c => !S.graf.off[c.id]);
    const pts = []; act.forEach(c => (S.series[c.id] || []).forEach(d => { if (!ini || d.fecha >= ini) pts.push(d); }));
    const alertas = []; S.contadores.forEach(c => (S.series[c.id] || []).forEach(d => { if (d.alerta && (!ini || d.fecha >= ini)) alertas.push({ c, d }); }));
    const fechas = pts.map(d => d.fecha).sort();
    if (!fechas.length) { app.innerHTML = h + '<div class="empty">Aún no hay datos para dibujar.</div>'; return; }
    const f0 = ini && ini > fechas[0] ? ini : fechas[0], f1 = fin;
    const W = 640, H = 280, mL = 54, mR = 12, mT = 12, mB = 28, nd = Math.max(1, L.diasEntre(f0, f1));
    const vals = pts.filter(d => d.consumo != null).map(d => d.consumo / 1000);
    let ymax = Math.max(1, ...vals); const mag = Math.pow(10, Math.floor(Math.log10(ymax))); ymax = Math.ceil(ymax / (mag / 2)) * (mag / 2);
    const X = f => mL + (L.diasEntre(f0, f) / nd) * (W - mL - mR), Y = v => mT + (1 - v / ymax) * (H - mT - mB);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Consumo diario por zona">';
    for (let i = 0; i <= 4; i++) { const v = ymax * i / 4, y = Y(v); svg += '<line x1="' + mL + '" x2="' + (W - mR) + '" y1="' + y + '" y2="' + y + '" stroke="#E1E5EA"/><text x="' + (mL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#6B7480">' + (Math.round(v * 10) / 10).toString().replace('.', ',') + '</text>'; }
    const nT = Math.min(5, nd); for (let i = 0; i <= nT; i++) { const f = L.sumaDias(f0, Math.round(nd * i / nT)); svg += '<text x="' + X(f) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#6B7480">' + f.slice(8) + '/' + f.slice(5, 7) + '</text>'; }
    svg += '<text x="4" y="10" font-size="11" fill="#6B7480">m³/día</text>';
    S.contadores.forEach((c, zi) => {
      if (S.graf.off[c.id]) return;
      const col = COLORS_HEX[zi % 3]; let path = '', prevOk = false;
      (S.series[c.id] || []).forEach(d => {
        if (d.fecha < f0) return;
        if (d.consumo != null) { path += (prevOk ? 'L' : 'M') + X(d.fecha).toFixed(1) + ' ' + Y(d.consumo / 1000).toFixed(1) + ' '; prevOk = true; } else if (d.estado !== 'pendiente') prevOk = false;
      });
      svg += '<path d="' + path + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"/>';
      (S.series[c.id] || []).forEach(d => {
        if (d.fecha < f0 || d.consumo == null) return;
        svg += d.alerta ? '<circle cx="' + X(d.fecha) + '" cy="' + Y(d.consumo / 1000) + '" r="6" fill="#C4302B" stroke="#fff" stroke-width="2"/>' : (nd <= 90 ? '<circle cx="' + X(d.fecha) + '" cy="' + Y(d.consumo / 1000) + '" r="2.5" fill="' + col + '"/>' : '');
      });
    });
    svg += '</svg>';
    h += '<div class="card" style="padding:8px">' + svg + '</div><div class="sub">Las interrupciones en la línea son días sin lectura o sin consumo calculable.</div>';
    h += '<h4 class="sec">Alertas de posible fuga (' + alertas.length + ')</h4>';
    h += alertas.length ? '<div class="list">' + alertas.sort((a, b) => (a.d.fecha < b.d.fecha ? 1 : -1)).map(a => '<div class="item"><div class="grow"><div class="t">' + esc(a.c.nombre) + ' · ' + esc(fmtDia(a.d.fecha)) + '</div><div class="sub">Media previa ' + L.fmtM3(Math.round(a.d.media)) + ' m³</div></div><div class="r" style="color:var(--alert)">' + L.fmtM3(a.d.consumo) + ' m³</div></div>').join('') + '</div>' : '<div class="sub">Sin alertas en este periodo. La alerta necesita al menos 5 días de consumo previo en la ventana.</div>';
    app.innerHTML = h;
  }

  /* ============ TOTALES + EXPORTACIÓN ============ */
  function etiqueta(tipo, clave) {
    if (tipo === 'mes') return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(L.parseFecha(clave + '-01'));
    return 'Semana del ' + new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(L.parseFecha(clave)) + ' al ' + new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(L.parseFecha(L.sumaDias(clave, 6)));
  }
  function vTotales() {
    const tipo = S.tot.tipo, rows = L.totales(S.series, hoy(), tipo).slice(0, 26);
    let h = '<div class="seg"><button data-act="tipo" data-v="semana" class="' + (tipo === 'semana' ? 'on' : '') + '">Semanas</button><button data-act="tipo" data-v="mes" class="' + (tipo === 'mes' ? 'on' : '') + '">Meses</button></div>';
    h += '<button class="btn primary block" data-act="exportar" style="margin-bottom:14px">⬇ Exportar a Excel</button>';
    if (!rows.length) h += '<div class="empty">Todavía no hay consumos calculables.</div>';
    rows.forEach(r => {
      h += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>' + esc(etiqueta(tipo, r.clave)) + '</b>' + (r.enCurso ? '<span class="tag brand">En curso</span>' : '') + '</div>' +
        '<div class="big" style="margin:4px 0">' + L.fmtM3(r.total.m3) + ' <span class="sub">m³ total marina</span></div>' +
        S.contadores.map((c, i) => { const z = r.zonas[c.id] || { m3: 0, sinDato: 0, acumulado: 0 }; return '<div class="item" style="padding:6px 0;border-bottom:0;display:flex;gap:8px"><span class="dot" style="background:' + COLORS[i % 3] + '"></span><span class="grow">' + esc(c.nombre) + (z.sinDato ? ' <span class="tag warn">' + z.sinDato + (z.sinDato === 1 ? ' día sin dato' : ' días sin dato') + '</span>' : '') + '</span><span class="num"><b>' + L.fmtM3(z.m3) + '</b> m³</span></div>'; }).join('') +
        (r.total.sinDato ? '<div class="msg warn">Total incompleto: faltan ' + r.total.sinDato + ' días de lectura entre las zonas.' + (r.total.acumulado ? ' Hay ' + L.fmtM3(r.total.acumulado) + ' m³ acumulados entre lecturas que no están repartidos en ningún día.' : '') + '</div>' : '') + '</div>';
    });
    app.innerHTML = h;
  }

  async function exportar() {
    busy('Preparando Excel…');
    try {
      if (!window.XLSX) await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const X = window.XLSX, wb = X.utils.book_new();
      S.contadores.forEach(c => {
        const rows = [['Fecha', 'Lectura (m³)', 'Consumo (m³)', 'Estado', 'Operario', 'Origen', 'Correcciones']];
        (S.series[c.id] || []).forEach(d => {
          const l = d.lectura, cs = l ? S.correcciones.filter(x => x.lectura_id === l.id) : [];
          let est = d.alerta ? 'Posible fuga' : ({ ok: 'OK', sin_lectura: 'Sin lectura', pendiente: 'Pendiente', inicial: 'Primera lectura', reseteo: 'Reseteo de contador', menor: 'Lectura menor que la anterior (sin consumo)', acumulado: 'Acumulado de ' + (d.acumulado && d.acumulado.dias) + ' días, sin repartir (' + (d.acumulado ? d.acumulado.milesimas / 1000 : '') + ' m³)' }[d.estado]);
          rows.push([d.fecha, l ? l.valor / 1000 : '', d.consumo != null ? d.consumo / 1000 : '', est, l ? l.operario : '', l ? (l.origen === 'foto' ? 'Foto' : 'Manual') : '',
            cs.map(x => x.valor_anterior / 1000 + ' → ' + x.valor_nuevo / 1000 + ' (' + x.operario + ', ' + fmtHora(x.corregida_en) + (x.motivo ? ', ' + x.motivo : '') + ')').join(' | ')]);
        });
        const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 44 }, { wch: 16 }, { wch: 9 }, { wch: 60 }];
        X.utils.book_append_sheet(wb, ws, c.nombre.slice(0, 31));
      });
      const res = [['RESUMEN SEMANAL (lunes a domingo)']];
      [['semana', 'Semana (lunes)'], ['mes', 'Mes']].forEach(([tipo, tit], k) => {
        if (k) res.push([], ['RESUMEN MENSUAL']);
        res.push([tit].concat(S.contadores.map(c => c.nombre + ' (m³)'), ['Total marina (m³)', 'Días-zona sin dato', 'Acumulado sin repartir (m³)', 'Periodo en curso']));
        L.totales(S.series, hoy(), tipo).slice().reverse().forEach(r => res.push([r.clave].concat(S.contadores.map(c => (r.zonas[c.id] ? r.zonas[c.id].m3 : 0) / 1000), [r.total.m3 / 1000, r.total.sinDato, r.total.acumulado / 1000, r.enCurso ? 'Sí' : 'No'])));
      });
      const wr = X.utils.aoa_to_sheet(res); wr['!cols'] = [{ wch: 18 }].concat(S.contadores.map(() => ({ wch: 16 })), [{ wch: 18 }, { wch: 18 }, { wch: 26 }, { wch: 16 }]);
      X.utils.book_append_sheet(wb, wr, 'Resumen');
      const nombre = 'lecturas-agua-' + hoy() + '.xlsx', buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file = new File([blob], nombre, { type: blob.type });
      busy('');
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: nombre }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { busy(''); toast('No se pudo exportar: ' + e.message); }
    busy('');
  }

  /* ============ AJUSTES ============ */
  function vAjustes() {
    app.innerHTML = '<div class="msg info" style="margin-top:0">Los cambios de ajustes afectan al cálculo de alertas de todo el histórico, no a las lecturas guardadas.</div><div style="height:12px"></div>' + S.contadores.map((c, i) =>
      '<div class="card" data-aj="' + c.id + '"><h2><span class="dot" style="background:' + COLORS[i % 3] + '"></span>' + esc(c.nombre) + '</h2>' +
      '<div class="row2" style="margin-top:12px"><div><label class="lbl">Dígitos enteros</label><input type="number" inputmode="numeric" min="1" max="12" data-k="dig" value="' + c.digitos_enteros + '"></div>' +
      '<div><label class="lbl">Ventana (días)</label><input type="number" inputmode="numeric" min="3" max="90" data-k="ven" value="' + c.ventana_dias + '"></div></div>' +
      '<div class="row2" style="margin-top:10px"><div><label class="lbl">Umbral fuga (%)</label><input type="number" inputmode="numeric" min="0" data-k="pct" value="' + c.umbral_fuga_pct + '"></div>' +
      '<div><label class="lbl">Mín. alerta (m³/día)</label><input type="number" inputmode="decimal" step="0.1" min="0" data-k="min" value="' + c.umbral_fuga_min_m3 + '"></div></div>' +
      '<div class="sub" style="margin-top:8px">Alerta si el consumo del día supera la media de los últimos ' + c.ventana_dias + ' días en más de un ' + c.umbral_fuga_pct + '% y es mayor que ' + c.umbral_fuga_min_m3 + ' m³.</div>' +
      '<button class="btn primary block" data-act="guardar-aj" data-id="' + c.id + '" style="margin-top:10px">Guardar ' + esc(c.nombre) + '</button></div>').join('');
  }
  async function guardarAj(id) {
    const el = document.querySelector('[data-aj="' + id + '"]'), g = k => el.querySelector('[data-k=' + k + ']').value;
    const dig = parseInt(g('dig'), 10), ven = parseInt(g('ven'), 10), pct = parseInt(g('pct'), 10), min = parseFloat(String(g('min')).replace(',', '.'));
    if (!(dig >= 1 && dig <= 12 && ven >= 3 && ven <= 90 && pct >= 0 && min >= 0)) { toast('Revisa los valores'); return; }
    busy('Guardando…');
    try { await rpc('app_ajustes_contador', { p_contador: id, p_digitos: dig, p_pct: pct, p_min: min, p_ventana: ven }); await cargar(); toast('Ajustes guardados'); }
    catch (e) { toast('No se guardó: ' + e.message); }
    busy(''); render();
  }

  /* ============ eventos ============ */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-tab],[data-chip]'); if (!t) return;
    if (t.dataset.tab) return go(t.dataset.tab);
    if (t.dataset.chip) { const [id, i] = t.dataset.chip.split(':').map(Number); card(id).conf.add(i); return pintarCard(id); }
    const a = t.dataset.act, id = Number(t.dataset.id);
    if (a === 'crop-ok') { if (cropResolve) cropResolve(true); return; }
    if (a === 'crop-no') { if (cropResolve) cropResolve(false); cerrar(); return; }
    if (a === 'cerrar') { if (e.target === t || t.tagName === 'BUTTON') { if (cropResolve) cropResolve(false); cerrar(); } }
    else if (a === 'guardar') guardar(id);
    else if (a === 'detalle') detalle(id);
    else if (a === 'corregir') corregir(id);
    else if (a === 'ok-corregir') okCorregir(id);
    else if (a === 'zona') { S.hist.zona = id; S.hist.limite = 45; vHistorial(); }
    else if (a === 'mas') { S.hist.limite += 60; vHistorial(); }
    else if (a === 'registrar-dia') { S.fecha = t.dataset.fecha; go('registro'); }
    else if (a === 'rango') { S.graf.rango = Number(t.dataset.v); vGrafico(); }
    else if (a === 'toggle-zona') { S.graf.off[id] = !S.graf.off[id]; vGrafico(); }
    else if (a === 'tipo') { S.tot.tipo = t.dataset.v; vTotales(); }
    else if (a === 'exportar') exportar();
    else if (a === 'guardar-aj') guardarAj(id);
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'f-op') { S.operario = t.value; lsSet('operario', t.value); S.contadores.forEach(c => pintarCard(c.id)); }
    else if (t.dataset.in) { const id = Number(t.dataset.in), st = card(id); st.texto = t.value; st.ack = false; st.reseteo = false; pintarCard(id); }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'f-fecha') { if (t.value) { S.fecha = t.value > hoy() ? hoy() : t.value; S.cards = {}; vRegistro(); } }
    else if (t.dataset.foto) onFoto(Number(t.dataset.foto), t.files[0]), t.value = '';
    else if (t.dataset.ack) { const id = Number(t.dataset.ack); card(id).ack = t.checked; pintarCard(id); }
    else if (t.dataset.reseteo) { const id = Number(t.dataset.reseteo); card(id).reseteo = t.checked; pintarCard(id); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.cargado && S.tab !== 'registro') cargar().then(render).catch(() => {}); });

  /* ============ arranque ============ */
  (async function init() {
    S.operario = lsGet('operario') || '';
    const m = /[#&]t=([A-Za-z0-9]+)/.exec(location.hash);
    if (m) { lsSet('token', m[1]); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* nada */ } }
    S.token = m ? m[1] : lsGet('token');
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
    render();
    if (!S.token) return;
    try { await cargar(); } catch (e) { app.innerHTML = '<div class="msg bad">No se han podido cargar los datos: ' + esc(e.message) + '</div><button class="btn block" style="margin-top:12px" onclick="location.reload()">Reintentar</button>'; return; }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();

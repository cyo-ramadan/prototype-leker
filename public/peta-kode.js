// Peta Kode 3D (Bos Cyo, 2026-10-04). Satu titik = satu file, warna = modul, garis = file
// yang saling memakai. Digambar dengan canvas 2D + proyeksi 3D buatan sendiri: tanpa pustaka
// dari internet (halaman tidak boleh gagal hanya karena CDN diblokir). Datanya dari
// GET /api/owner/peta-kode (khusus Owner, src/peta-kode.js) -- hasil scripts/build-peta-kode.mjs.
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const RECENT_DAYS = 7;
  const CAM = 300;
  const DEFAULT_VIEW = { yaw: 0.5, pitch: -0.28, zoom: 1 };
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = { ...DEFAULT_VIEW, spin: !reduceMotion, sel: -1, hover: -1, query: '', recent: false, hidden: new Set(), fly: null };

  let data = null;
  let nodes = [];
  let edges = [];
  let adj = [];
  let centroids = [];
  let sprites = [];
  let W = 0, H = 0, dpr = 1;
  let background = null;
  let stars = [];
  let matchSet = new Set();
  let density = [];
  let interacting = false;
  let velocity = 0;
  let slowFrames = 0;
  let lite = false;
  let last = 0;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fmt = new Intl.NumberFormat('id-ID');
  const dateText = iso => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function showMessage(html) {
    $('msgText').innerHTML = html;
    $('msg').classList.add('show');
  }

  function needLogin(reason) {
    showMessage(`<h2>Khusus Owner</h2><p>${esc(reason)} Masuk dulu di <a href="/owner">Owner Console</a>, lalu buka peta ini dari tombol <b>Peta Kode 3D</b>.</p>`);
  }

  async function load() {
    let token = '';
    try { token = localStorage.getItem('lekerOwnerToken') || ''; } catch { /* penyimpanan diblokir */ }
    if (!token) return needLogin('Belum masuk sebagai Owner.');
    let response;
    try {
      response = await fetch('/api/owner/peta-kode', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    } catch {
      return showMessage('<h2>Peta gagal dimuat</h2><p>Koneksi bermasalah. Coba muat ulang halaman.</p>');
    }
    if (response.status === 401) return needLogin('Sesi Owner habis.');
    if (!response.ok) return showMessage(`<h2>Peta gagal dimuat</h2><p>Kode kesalahan ${response.status}.</p>`);
    data = await response.json();
    start();
  }

  function start() {
    const builtAt = Date.parse(data.meta.generatedAt);
    nodes = data.nodes.map((node, i) => ({
      ...node,
      i,
      x: node.x,
      y: node.v,
      z: node.z,
      r: 0.7 + Math.sqrt(node.s) * 0.22,
      name: node.p.split('/').pop(),
      lower: node.p.toLowerCase(),
      recent: Boolean(node.d) && builtAt - Date.parse(`${node.d}T00:00:00Z`) <= RECENT_DAYS * 86400000,
      sx: 0, sy: 0, z2: 0, k: 1
    }));
    edges = data.edges.map(([a, b, w]) => ({ a, b, w }));
    adj = nodes.map(() => []);
    for (const edge of edges) { adj[edge.a].push({ j: edge.b, w: edge.w }); adj[edge.b].push({ j: edge.a, w: edge.w }); }
    for (const list of adj) list.sort((x, y) => y.w - x.w);
    centroids = data.modules.map((_, m) => {
      const own = nodes.filter(node => node.m === m);
      const n = own.length || 1;
      return { x: own.reduce((s, node) => s + node.x, 0) / n, y: own.reduce((s, node) => s + node.y, 0) / n, z: own.reduce((s, node) => s + node.z, 0) / n, count: own.length };
    });
    sprites = data.modules.map(module => makeSprite(module.color));
    // Modul yang titiknya banyak dan rapat dibuat lebih redup supaya cahayanya tidak menumpuk jadi gumpalan putih.
    density = data.modules.map(module => clamp(46 / Math.max(1, module.count), 0.22, 1));
    for (const [m, module] of data.modules.entries()) if (module.key === 'tes') state.hidden.add(m);
    buildLegend();
    buildMeta();
    bind();
    resize();
    window.__petaKode = { ready: true, files: nodes.length, edges: edges.length };
    requestAnimationFrame(frame);
  }

  function makeSprite(color) {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.18, color);
    grad.addColorStop(0.5, `${color}40`);
    grad.addColorStop(1, `${color}00`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function buildLegend() {
    $('legend').innerHTML = data.modules.map((module, m) => `<span class="chip${state.hidden.has(m) ? ' off' : ''}" data-m="${m}" style="color:${esc(module.color)}" title="Ketuk untuk sembunyikan/tampilkan"><i></i><span style="color:var(--ink)">${esc(module.label)}</span> <small>${fmt.format(module.count)}</small></span>`).join('');
  }

  function buildMeta() {
    const meta = data.meta;
    const days = Math.floor((Date.now() - Date.parse(meta.generatedAt)) / 86400000);
    const age = days <= 0 ? 'hari ini' : `${days} hari lalu`;
    const stale = days > 3 ? ' <span style="color:#fbbf24">⚠ peta mulai usang — minta Hana memperbarui</span>' : '';
    const recentCount = nodes.filter(node => node.recent).length;
    $('meta').innerHTML = `<b>${fmt.format(meta.fileCount)}</b> file · <b>${fmt.format(meta.edgeCount)}</b> hubungan · <b>${fmt.format(meta.symbolCount)}</b> simbol · dari commit <b>${esc(String(meta.builtAtCommit).slice(0, 7))}</b> · dibuat <b>${esc(dateText(meta.generatedAt))}</b> (${age})${stale}<span class="extra">${recentCount ? ` · <b>${recentCount}</b> file diubah ≤${RECENT_DAYS} hari sebelum peta dibuat` : ''} · file Tes disembunyikan dulu (ketuk warnanya untuk menampilkan)</span>`;
  }

  // ------------------------------------------------------------- tampilan ---

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    background = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    background.addColorStop(0, '#0c1c38');
    background.addColorStop(0.55, '#07101f');
    background.addColorStop(1, '#030610');
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand(), a: 0.15 + rand() * 0.5, s: 0.4 + rand() * 1.1 }));
  }

  function project() {
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const focal = Math.min(W, H) * 1.1;
    const cx = W / 2, cyy = H * 0.56;
    const place = (point, target) => {
      const x1 = point.x * cy - point.z * sy;
      const z1 = point.x * sy + point.z * cy;
      const y2 = point.y * cp - z1 * sp;
      const z2 = point.y * sp + z1 * cp;
      const k = (focal / (CAM + z2)) * state.zoom;
      target.sx = cx + x1 * k;
      target.sy = cyy + y2 * k;
      target.z2 = z2;
      target.k = k;
    };
    for (const node of nodes) place(node, node);
    for (const c of centroids) place(c, c);
  }

  function selectionSet() {
    if (state.sel < 0) return null;
    const set = new Set([state.sel]);
    for (const { j } of adj[state.sel]) set.add(j);
    return set;
  }

  function emphasis(node, selSet) {
    let e = 1;
    if (selSet) e *= selSet.has(node.i) ? 1 : 0.12;
    if (state.query.length >= 2) e *= matchSet.has(node.i) ? 1 : 0.1;
    if (state.recent) e *= node.recent ? 1 : 0.14;
    return Math.max(0.05, e);
  }

  const visible = node => !state.hidden.has(node.m);
  const depthFade = z2 => 0.45 + 0.55 * clamp(1 - (z2 + 110) / 220, 0, 1);

  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#9fd4ff';
    for (const star of stars) {
      ctx.globalAlpha = star.a;
      const x = ((star.x * W - state.yaw * 18) % W + W) % W;
      ctx.fillRect(x, star.y * H, star.s, star.s);
    }

    const selSet = selectionSet();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const edge of edges) {
      const a = nodes[edge.a], b = nodes[edge.b];
      if (!visible(a) || !visible(b)) continue;
      const incident = state.sel >= 0 && (edge.a === state.sel || edge.b === state.sel);
      if (lite && !incident && edge.w < 2) continue;
      const emph = Math.min(emphasis(a, selSet), emphasis(b, selSet));
      const depth = depthFade((a.z2 + b.z2) / 2);
      const alpha = incident ? 0.9 : (0.08 + 0.2 * depth) * emph * (state.sel >= 0 ? 0.5 : 1);
      if (alpha < 0.012) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = a.m === b.m ? data.modules[a.m].color : '#a9d6ff';
      ctx.lineWidth = incident ? 1.5 : 0.6 + Math.min(1, edge.w / 10) * 0.7;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    const order = nodes.filter(visible).sort((x, y) => y.z2 - x.z2);
    for (const node of order) {
      const emph = emphasis(node, selSet);
      const r = node.r * node.k;
      const alpha = emph * depthFade(node.z2);
      ctx.globalAlpha = alpha;
      const glow = r * (emph > 0.5 ? 3.6 : 2.4);
      ctx.globalAlpha = alpha * density[node.m];
      ctx.drawImage(sprites[node.m], node.sx - glow, node.sy - glow, glow * 2, glow * 2);
      ctx.globalAlpha = Math.min(1, alpha * 0.95);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(node.sx, node.sy, Math.max(0.7, r * 0.5), 0, Math.PI * 2);
      ctx.fill();
      if (state.recent && node.recent) {
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = data.modules[node.m].color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(node.sx, node.sy, r * (2.4 + 0.9 * Math.sin(time / 380 + node.i)), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
    drawLabels(selSet);
  }

  function label(text, x, y, color, size = 11, alpha = 1, bold = false) {
    ctx.globalAlpha = alpha;
    ctx.font = `${bold ? '700 ' : ''}${size}px system-ui,sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(3,6,16,.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawLabels(selSet) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let m = 0; m < centroids.length; m++) {
      if (state.hidden.has(m) || !centroids[m].count) continue;
      const c = centroids[m];
      label(data.modules[m].label.toUpperCase(), c.sx, c.sy, data.modules[m].color, 12 + Math.min(6, state.zoom * 2), selSet || state.query.length >= 2 ? 0.28 : 0.75 * depthFade(c.z2), true);
    }
    ctx.textAlign = 'left';
    const shown = new Set();
    const nameIt = (i, alpha = 1, bold = false) => {
      if (i < 0 || shown.has(i)) return;
      const node = nodes[i];
      if (!visible(node)) return;
      shown.add(i);
      label(node.name, node.sx + node.r * node.k * 2.4 + 3, node.sy - 6, '#eaf6ff', bold ? 13 : 11, alpha, bold);
    };
    if (state.sel >= 0) {
      nameIt(state.sel, 1, true);
      adj[state.sel].slice(0, 10).forEach(({ j }) => nameIt(j, 0.9));
    }
    nameIt(state.hover, 1, true);
    if (state.query.length >= 2) [...matchSet].slice(0, 14).forEach(i => nameIt(i, 0.95));
    if (state.recent) nodes.filter(node => node.recent).sort((x, y) => y.n - x.n).slice(0, 8).forEach(node => nameIt(node.i, 0.85));
  }

  function frame(time) {
    const dt = Math.min(60, time - last || 16);
    last = time;
    if (dt > 38) slowFrames += 1; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 25) lite = true;
    if (state.fly) {
      const f = state.fly;
      const p = clamp((time - f.t0) / f.dur, 0, 1);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      state.yaw = f.from.yaw + f.dy * e;
      state.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * e;
      state.zoom = f.from.zoom + (f.to.zoom - f.from.zoom) * e;
      if (p >= 1) state.fly = null;
    } else if (!interacting) {
      if (Math.abs(velocity) > 0.00002) { state.yaw += velocity * dt; velocity *= Math.pow(0.94, dt / 16); } else velocity = 0;
      if (state.spin && velocity === 0) state.yaw += dt * 0.00005;
    }
    project();
    draw(time);
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------- interaksi ---

  function flyTo(i) {
    const node = nodes[i];
    const flat = Math.hypot(node.x, node.z);
    const targetYaw = Math.atan2(node.x, node.z) + Math.PI;
    let dy = targetYaw - state.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    state.fly = {
      t0: performance.now(), dur: 750,
      from: { yaw: state.yaw, pitch: state.pitch, zoom: state.zoom }, dy,
      to: { pitch: clamp(Math.atan2(-node.y, flat), -1.2, 1.2), zoom: Math.max(state.zoom, 1.9) }
    };
  }

  function pick(x, y) {
    let best = -1, bestD = Infinity;
    for (const node of nodes) {
      if (!visible(node)) continue;
      const reach = Math.max(node.r * node.k * 2.6, 13);
      const d2 = (node.sx - x) ** 2 + (node.sy - y) ** 2;
      if (d2 > reach * reach) continue;
      const score = d2 + node.z2 * 0.4;
      if (score < bestD) { bestD = score; best = node.i; }
    }
    return best;
  }

  function select(i, { fly = false } = {}) {
    state.sel = i;
    renderInfo();
    if (i >= 0 && fly) flyTo(i);
  }

  function renderInfo() {
    const box = $('info');
    if (state.sel < 0) { box.classList.remove('show'); box.innerHTML = ''; return; }
    const node = nodes[state.sel];
    const module = data.modules[node.m];
    const neighbours = adj[node.i].slice(0, 10);
    box.innerHTML = `
      <button class="x" type="button" data-close aria-label="Tutup">×</button>
      <h2>${esc(node.p)}</h2>
      <span class="mod" style="color:${esc(module.color)}"><i></i><span style="color:var(--ink)">${esc(module.label)}</span></span>
      <p>${fmt.format(node.s)} simbol di file ini · terhubung ke ${fmt.format(adj[node.i].length)} file lain</p>
      <p>${node.d ? `Terakhir diubah: ${esc(dateText(node.d))}` : 'Tanggal ubah terakhir tidak tersedia (riwayat git terpotong).'}</p>
      ${node.y.length ? `<p>Isi utama: ${node.y.map(esc).join(' · ')}</p>` : ''}
      ${neighbours.length ? `<p>Paling erat terhubung:</p><div class="row">${neighbours.map(({ j, w }) => `<button class="link" type="button" data-i="${j}" style="border-color:${esc(data.modules[nodes[j].m].color)}66">${esc(nodes[j].p)} <small>×${w}</small></button>`).join('')}</div>` : ''}`;
    box.classList.add('show');
  }

  function bind() {
    window.addEventListener('resize', resize);
    const pointers = new Map();
    let drag = null;
    let pinch = 0;
    canvas.addEventListener('pointerdown', event => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) drag = { moved: 0, t: performance.now() };
      if (pointers.size === 2) { const [p, q] = [...pointers.values()]; pinch = Math.hypot(p.x - q.x, p.y - q.y); }
      interacting = true;
      velocity = 0;
      state.fly = null;
      canvas.classList.add('drag');
    });
    canvas.addEventListener('pointermove', event => {
      const before = pointers.get(event.pointerId);
      if (!before) {
        if (event.pointerType === 'mouse') {
          state.hover = pick(event.clientX, event.clientY);
          canvas.classList.toggle('pointer', state.hover >= 0);
        }
        return;
      }
      const dx = event.clientX - before.x, dy = event.clientY - before.y;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        state.yaw += dx * 0.006;
        state.pitch = clamp(state.pitch - dy * 0.006, -1.45, 1.45);
        velocity = dx * 0.006 / Math.max(8, performance.now() - (drag?.last || performance.now() - 16));
        if (drag) { drag.moved += Math.abs(dx) + Math.abs(dy); drag.last = performance.now(); }
      } else if (pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        const distance = Math.hypot(p.x - q.x, p.y - q.y);
        if (pinch > 0) state.zoom = clamp(state.zoom * (distance / pinch), 0.5, 5);
        pinch = distance;
        if (drag) drag.moved += 10;
      }
    });
    const end = event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (pointers.size === 0) {
        interacting = false;
        canvas.classList.remove('drag');
        if (event.type === 'pointerup' && drag && drag.moved < 6 && performance.now() - drag.t < 600) {
          const hit = pick(event.clientX, event.clientY);
          select(hit);
        }
        drag = null;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { state.hover = -1; });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.0012), 0.5, 5);
    }, { passive: false });

    $('legend').addEventListener('click', event => {
      const chip = event.target.closest('[data-m]');
      if (!chip) return;
      const m = Number(chip.dataset.m);
      if (state.hidden.has(m)) state.hidden.delete(m); else state.hidden.add(m);
      chip.classList.toggle('off', state.hidden.has(m));
      if (state.sel >= 0 && state.hidden.has(nodes[state.sel].m)) select(-1);
    });
    $('info').addEventListener('click', event => {
      if (event.target.closest('[data-close]')) return select(-1);
      const link = event.target.closest('[data-i]');
      if (link) select(Number(link.dataset.i), { fly: true });
    });
    $('spin').addEventListener('click', () => {
      state.spin = !state.spin;
      $('spin').setAttribute('aria-pressed', String(state.spin));
    });
    $('recent').addEventListener('click', () => {
      state.recent = !state.recent;
      $('recent').setAttribute('aria-pressed', String(state.recent));
    });
    $('reset').addEventListener('click', () => {
      Object.assign(state, DEFAULT_VIEW, { sel: -1, query: '', recent: false, fly: null });
      state.hidden.clear();
      matchSet = new Set();
      $('q').value = '';
      $('recent').setAttribute('aria-pressed', 'false');
      data.modules.forEach((module, m) => { if (module.key === 'tes') state.hidden.add(m); });
      document.querySelectorAll('#legend .chip').forEach(chip => chip.classList.toggle('off', state.hidden.has(Number(chip.dataset.m))));
      renderInfo();
    });
    $('q').addEventListener('input', () => {
      state.query = $('q').value.trim().toLowerCase();
      matchSet = new Set(state.query.length >= 2 ? nodes.filter(node => node.lower.includes(state.query)).map(node => node.i) : []);
    });
    $('q').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const first = [...matchSet].map(i => nodes[i]).filter(visible).sort((a, b) => b.s - a.s)[0];
      if (first) { select(first.i, { fly: true }); $('q').blur(); }
    });
    $('spin').setAttribute('aria-pressed', String(state.spin));
  }

  load();
})();

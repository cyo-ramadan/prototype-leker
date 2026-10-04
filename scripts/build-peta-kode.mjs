// Penyusun data Peta Kode 3D (Bos Cyo, 2026-10-04).
//
// Membaca peta graphify yang tersimpan di repo (graphify-out/graph.json) lalu menulis
// generated/peta-kode-data.js: satu titik per FILE, diwarnai per modul, dengan posisi 3D yang
// sudah dihitung di sini (halaman tinggal menggambar). Tidak memakai token AI, tidak
// butuh jaringan. Dijalankan: `npm run peta:build` -- setelah `graphify update .`.
//
// (Disimpan di generated/, bukan src/: nama tabel lama di dalamnya membuat pemindai tabel-yatim memberi alarm palsu.)
// Data ini hanya dilayani lewat GET /api/owner/peta-kode (src/peta-kode.js) setelah login
// Owner; nama file dan tabel aplikasi tidak boleh terbuka untuk umum.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MODULES = Object.freeze([
  { key: 'kasir', label: 'Layar Kasir', color: '#38bdf8' },
  { key: 'akuntansi', label: 'Akuntansi', color: '#fbbf24' },
  { key: 'una', label: 'Una (asisten AI)', color: '#f472b6' },
  { key: 'staf', label: 'Portal Staf & Gaji', color: '#4ade80' },
  { key: 'admin', label: 'Admin & Owner', color: '#c084fc' },
  { key: 'stok', label: 'Barang, Stok & HPP', color: '#fb923c' },
  { key: 'pelanggan', label: 'Pelanggan & Promo', color: '#a3e635' },
  { key: 'ikan', label: 'Modul Ikan', color: '#6366f1' },
  { key: 'database', label: 'Database (migration)', color: '#f87171' },
  { key: 'tes', label: 'Tes', color: '#94a3b8' },
  { key: 'dokumen', label: 'Dokumen & keputusan', color: '#f1f5f9' },
  { key: 'infra', label: 'Inti server & alat', color: '#14b8a6' }
]);

// Urutan penting: aturan pertama yang cocok menang.
const RULES = [
  ['tes', p => p.startsWith('test/')],
  ['database', p => p.startsWith('migrations/')],
  ['dokumen', p => /\.md$/.test(p)],
  ['una', p => /(^|\/)caca-/.test(p)],
  ['akuntansi', p => /accounting|ledger|business-settings|net-profit|journal/.test(p)],
  ['staf', p => /staff|attendance|payroll|employee|permit|presensi|entity-backup-cashiers/.test(p)],
  ['kasir', p => /cashier|drawer|pos-|warung|live-photo|camera-snapshot|angka-input|pimasatu|stock-adjustment-pilatu|operational-posting/.test(p)],
  ['stok', p => /product|hpp|stock|inventory|manufactur|cost-master|recipe|warehouse|purchase|(^|\/)units?[.-]|supplier|item-/.test(p)],
  ['ikan', p => /ikan/.test(p)],
  ['pelanggan', p => /customer|(^|\/)orders|voucher|roda-puter|(^|\/)game|membership|leker-menu|menu-category/.test(p)],
  ['admin', p => /admin|owner|branch-|(^|\/)stores|tenant|unified-login|nav-groups|store-context|ui-skin|ui-profile|skin-|management/.test(p)]
];

export function classifyModule(path) {
  const p = String(path).toLowerCase();
  for (const [key, test] of RULES) if (test(p)) return key;
  return 'infra';
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tata letak gaya "galaksi": tiap modul punya pusat sendiri di bola besar, tiap file
// ditarik ke pusat modulnya, saling tolak, dan ditarik ke file yang dipakainya. Hasilnya
// sama setiap dijalankan untuk data yang sama (benih acak tetap).
export function layout(nodes, edges, moduleKeys) {
  const n = nodes.length;
  const rand = mulberry32(20261004);
  const anchors = moduleKeys.map((_, i) => {
    const k = moduleKeys.length;
    const y = 1 - (2 * (i + 0.5)) / k;
    const r = Math.sqrt(1 - y * y);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(phi) * r * 130, y * 130, Math.sin(phi) * r * 130];
  });
  const pos = new Float64Array(n * 3);
  const vel = new Float64Array(n * 3);
  nodes.forEach((node, i) => {
    const a = anchors[node.m];
    for (let d = 0; d < 3; d++) pos[i * 3 + d] = a[d] + (rand() - 0.5) * 40;
  });
  const STEPS = 320;
  for (let step = 0; step < STEPS; step++) {
    const cool = 1 - step / STEPS;
    const force = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i * 3] - pos[j * 3];
        let dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        let dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 6400) continue; // tolakan hanya jarak dekat
        if (d2 < 0.01) { dx = rand() - 0.5; dy = rand() - 0.5; dz = rand() - 0.5; d2 = 0.5; }
        const f = 60 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        force[i * 3] += fx; force[i * 3 + 1] += fy; force[i * 3 + 2] += fz;
        force[j * 3] -= fx; force[j * 3 + 1] -= fy; force[j * 3 + 2] -= fz;
      }
    }
    for (const [a, b, w] of edges) {
      const dx = pos[b * 3] - pos[a * 3];
      const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      // Hubungan antar-modul (terutama dari Tes yang menyentuh semuanya) ditarik lemah supaya
      // modul tetap terpisah menjadi "galaksi" sendiri-sendiri.
      const strength = nodes[a].m === nodes[b].m ? 0.012 : 0.0006;
      const k = strength * Math.log2(1 + w) * (d - 14);
      const fx = (dx / d) * k, fy = (dy / d) * k, fz = (dz / d) * k;
      force[a * 3] += fx; force[a * 3 + 1] += fy; force[a * 3 + 2] += fz;
      force[b * 3] -= fx; force[b * 3 + 1] -= fy; force[b * 3 + 2] -= fz;
    }
    for (let i = 0; i < n; i++) {
      const a = anchors[nodes[i].m];
      for (let d = 0; d < 3; d++) {
        force[i * 3 + d] += (a[d] - pos[i * 3 + d]) * 0.05 - pos[i * 3 + d] * 0.0008;
        vel[i * 3 + d] = (vel[i * 3 + d] + force[i * 3 + d]) * 0.82;
        pos[i * 3 + d] += Math.max(-6, Math.min(6, vel[i * 3 + d])) * (0.25 + 0.75 * cool);
      }
    }
  }
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let maxR = 1;
  for (let i = 0; i < n; i++) {
    pos[i * 3] -= cx; pos[i * 3 + 1] -= cy; pos[i * 3 + 2] -= cz;
    maxR = Math.max(maxR, Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  }
  const scale = 100 / maxR;
  return nodes.map((_, i) => [0, 1, 2].map(d => Math.round(pos[i * 3 + d] * scale * 10) / 10));
}

function lastChangeByFile() {
  const map = new Map();
  try {
    const out = execFileSync('git', ['log', '--name-only', '--format=@%cI'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let date = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('@')) { date = line.slice(1, 11); continue; }
      const file = line.trim();
      if (!file || !date) continue;
      const row = map.get(file);
      if (row) row.n += 1;
      else map.set(file, { d: date, n: 1 });
    }
    // Clone dangkal (sesi cloud) memotong riwayat: file yang hanya muncul di commit paling
    // tua yang terbaca belum tentu baru diubah di hari itu, jadi tanggalnya dikosongkan.
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true';
    if (shallow) {
      const oldest = [...map.values()].reduce((min, row) => (row.d < min ? row.d : min), '9999-99-99');
      for (const row of map.values()) if (row.d === oldest) row.d = '';
    }
  } catch { /* tanpa git: peta tetap jadi, hanya tanpa tanggal ubah */ }
  return map;
}

export function buildPetaKodeData(graph, { graphSha, changes = new Map(), generatedAt = new Date().toISOString() } = {}) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const degree = new Map();
  for (const link of graph.links) {
    degree.set(link.source, (degree.get(link.source) || 0) + 1);
    degree.set(link.target, (degree.get(link.target) || 0) + 1);
  }
  const files = new Map();
  for (const node of graph.nodes) {
    const path = node.source_file;
    // Lewati simpul tanpa file nyata: modul luar (node:fs), alamat relatif salah baca ('../..').
    if (!path || path.includes(':') || path.split('/').includes('..')) continue;
    let row = files.get(path);
    if (!row) { row = { p: path, symbols: [] }; files.set(path, row); }
    row.symbols.push(node);
  }
  const moduleIndex = new Map(MODULES.map((m, i) => [m.key, i]));
  const paths = [...files.keys()].sort();
  const index = new Map(paths.map((p, i) => [p, i]));
  const nodes = paths.map(p => {
    const row = files.get(p);
    const base = p.split('/').pop();
    const names = row.symbols
      .filter(s => s.label && s.label !== base && !String(s.id).startsWith('ref_node_'))
      .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0))
      .map(s => String(s.label).slice(0, 60));
    const change = changes.get(p);
    return {
      p,
      m: moduleIndex.get(classifyModule(p)),
      s: row.symbols.length,
      y: [...new Set(names)].slice(0, 6),
      d: change?.d || '',
      n: change?.n || 0
    };
  });
  const pairs = new Map();
  for (const link of graph.links) {
    const a = byId.get(link.source)?.source_file;
    const b = byId.get(link.target)?.source_file;
    if (!a || !b || a === b || !index.has(a) || !index.has(b)) continue;
    const [i, j] = [index.get(a), index.get(b)].sort((x, y) => x - y);
    const key = `${i}:${j}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }
  const edges = [...pairs.entries()].map(([key, w]) => [...key.split(':').map(Number), w]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const positions = layout(nodes, edges, MODULES.map(m => m.key));
  nodes.forEach((node, i) => { [node.x, node.y3, node.z] = positions[i]; });
  const counts = MODULES.map((_, i) => nodes.filter(node => node.m === i).length);
  return {
    meta: {
      graphSha,
      builtAtCommit: graph.built_at_commit || '',
      generatedAt,
      fileCount: nodes.length,
      edgeCount: edges.length,
      symbolCount: graph.nodes.length
    },
    modules: MODULES.map((m, i) => ({ ...m, count: counts[i] })),
    nodes: nodes.map(node => ({ p: node.p, m: node.m, s: node.s, y: node.y, d: node.d, n: node.n, x: node.x, v: node.y3, z: node.z })),
    edges
  };
}

export function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const raw = readFileSync(`${root}graphify-out/graph.json`);
  const graph = JSON.parse(raw.toString('utf8'));
  const graphSha = createHash('sha256').update(raw).digest('hex');
  const data = buildPetaKodeData(graph, { graphSha, changes: lastChangeByFile() });
  const body = `// DIBANGKITKAN oleh scripts/build-peta-kode.mjs dari graphify-out/graph.json -- jangan disunting tangan.\n// Jalankan \`npm run peta:build\` setelah \`graphify update .\`.\nexport default ${JSON.stringify(data)};\n`;
  writeFileSync(`${root}generated/peta-kode-data.js`, body);
  console.log(`peta-kode: ${data.meta.fileCount} file, ${data.meta.edgeCount} hubungan, ${(body.length / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

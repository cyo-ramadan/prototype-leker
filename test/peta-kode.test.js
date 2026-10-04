import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { handlePetaKodeApi } from '../src/peta-kode.js';
import petaKode from '../generated/peta-kode-data.js';
import { hashCredential } from '../src/owner-auth.js';
import { MODULES, buildPetaKodeData, classifyModule } from '../scripts/build-peta-kode.mjs';

// Bos Cyo, 2026-10-04: peta kode 3D untuk Owner. Data dibangkitkan dari peta graphify di repo
// (graphify-out/graph.json), hanya dilayani setelah login Owner, dan digambar tanpa pustaka luar.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const result = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(result.changes || 0) } }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

async function ownerEnv() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(read(`migrations/${file}`));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_pk', 'owner_pk', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_pk', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-pk'));
  return { db, env: { DB: new D1Database(db) } };
}

test('peta 3D selaras dengan peta graphify yang tersimpan di repo (kalau gagal: npm run peta:build)', () => {
  const sha = createHash('sha256').update(readFileSync(new URL('../graphify-out/graph.json', import.meta.url))).digest('hex');
  assert.equal(petaKode.meta.graphSha, sha, 'generated/peta-kode-data.js dibangun dari graph.json yang lain -- jalankan `npm run peta:build` setelah `graphify update .`');
});

test('data peta utuh: modul, indeks hubungan, koordinat, tanpa file palsu', () => {
  assert.equal(petaKode.modules.length, MODULES.length);
  assert.equal(petaKode.meta.fileCount, petaKode.nodes.length);
  assert.equal(petaKode.meta.edgeCount, petaKode.edges.length);
  const paths = new Set();
  for (const node of petaKode.nodes) {
    assert.ok(Number.isInteger(node.m) && node.m >= 0 && node.m < MODULES.length, `modul ${node.p}`);
    assert.ok([node.x, node.v, node.z].every(Number.isFinite), `koordinat ${node.p}`);
    assert.ok(!node.p.split('/').includes('..') && !node.p.includes(':'), `bukan file nyata: ${node.p}`);
    assert.ok(!paths.has(node.p), `ganda: ${node.p}`);
    paths.add(node.p);
  }
  for (const [a, b, w] of petaKode.edges) {
    assert.ok(a < b && a >= 0 && b < petaKode.nodes.length && w >= 1);
  }
  const total = petaKode.modules.reduce((sum, module) => sum + module.count, 0);
  assert.equal(total, petaKode.nodes.length);
  assert.ok(petaKode.nodes.length > 500, 'peta kosong/terpotong');
});

test('klasifikasi modul: nama file menentukan warna', () => {
  const expected = {
    'public/cashier.js': 'kasir', 'src/drawer-report.js': 'kasir', 'src/accounting-ledger.js': 'akuntansi',
    'public/admin-accounting-workspace.js': 'akuntansi', 'src/caca-chat.js': 'una', 'src/staff-portal.js': 'staf',
    'src/payroll-ledger.js': 'akuntansi', 'public/admin-employees.js': 'staf', 'src/owner-auth.js': 'admin',
    'src/product-master.js': 'stok', 'src/hpp-recalculation.js': 'stok', 'src/customers.js': 'pelanggan',
    'src/ikan-penjualan.js': 'ikan', 'migrations/0136_employee_deposit_proof_photo.sql': 'database',
    'test/peta-kode.test.js': 'tes', 'adr/ADR-051-profit-loss-reads-accounting.md': 'dokumen', 'src/http.js': 'infra'
  };
  for (const [path, module] of Object.entries(expected)) assert.equal(classifyModule(path), module, path);
});

test('penyusun data: hasilnya sama setiap dijalankan, simpul luar dibuang, hubungan antar-file dijumlahkan', () => {
  const graph = {
    built_at_commit: 'abc1234',
    nodes: [
      { id: 'a1', label: 'bayar()', source_file: 'src/cashier-a.js' },
      { id: 'a2', label: 'hitung()', source_file: 'src/cashier-a.js' },
      { id: 'b1', label: 'catat()', source_file: 'src/accounting-b.js' },
      { id: 'x1', label: 'fs', source_file: 'node:fs' },
      { id: 'x2', label: 'salah', source_file: '../../luar.js' }
    ],
    links: [
      { source: 'a1', target: 'b1', relation: 'calls' },
      { source: 'a2', target: 'b1', relation: 'calls' },
      { source: 'a1', target: 'a2', relation: 'contains' },
      { source: 'a1', target: 'x1', relation: 'imports' }
    ]
  };
  const opts = { graphSha: 'sha', generatedAt: '2026-10-04T00:00:00.000Z' };
  const first = buildPetaKodeData(graph, opts);
  assert.deepEqual(first, buildPetaKodeData(graph, opts));
  assert.deepEqual(first.nodes.map(node => node.p), ['src/accounting-b.js', 'src/cashier-a.js']);
  assert.deepEqual(first.edges, [[0, 1, 2]], 'dua panggilan a->b dijumlahkan jadi satu hubungan file');
  assert.equal(first.meta.builtAtCommit, 'abc1234');
});

test('API peta kode: wajib login Owner, hanya GET, dan sudah terpasang di router', async () => {
  const { db, env } = await ownerEnv();
  try {
    const noLogin = await worker.fetch(new Request('https://example.test/api/owner/peta-kode'), env);
    assert.equal(noLogin.status, 401, 'tanpa login Owner datanya tidak boleh keluar');
    assert.equal((await noLogin.json()).code, 'OWNER_LOGIN_REQUIRED');

    const wrong = await worker.fetch(new Request('https://example.test/api/owner/peta-kode', { headers: { authorization: 'Bearer salah' } }), env);
    assert.equal(wrong.status, 401);

    const ok = await worker.fetch(new Request('https://example.test/api/owner/peta-kode', { headers: { authorization: 'Bearer owner-pk' } }), env);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.meta.graphSha, petaKode.meta.graphSha);
    assert.equal(body.nodes.length, petaKode.nodes.length);

    const post = await handlePetaKodeApi(new Request('https://example.test/api/owner/peta-kode', { method: 'POST', headers: { authorization: 'Bearer owner-pk' } }), env, '/api/owner/peta-kode');
    assert.equal(post.status, 405);
    assert.equal(await handlePetaKodeApi(new Request('https://example.test/api/owner/lain'), env, '/api/owner/lain'), null);
  } finally { db.close(); }
});

test('data peta tidak ditaruh di folder publik, dan halaman tidak memuat apa pun dari internet', () => {
  const html = read('public/peta-kode.html');
  const js = read('public/peta-kode.js');
  for (const source of [html, js]) {
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']https?:\/\//i, 'tidak boleh memuat skrip/gaya dari luar (CDN bisa diblokir)');
    assert.doesNotMatch(source, /fetch\(\s*["']https?:/i);
    assert.doesNotMatch(source, /import\s+.*from\s+["']https?:/i);
  }
  assert.match(js, /\/api\/owner\/peta-kode/);
  assert.match(js, /lekerOwnerToken/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /\/peta-kode\.js\?v=20261004-peta-kode-v1/);
  const publicFiles = readdirSync(new URL('../public/', import.meta.url));
  assert.ok(!publicFiles.some(name => /peta-kode-data|graph\.json/.test(name)), 'data peta hanya lewat API Owner');
});

test('Owner Console punya tombol ke Peta Kode 3D, dan file barunya masuk script check', () => {
  const owner = read('public/owner.html');
  assert.match(owner, /<a class="primary-btn" href="\/peta-kode" id="ownerPetaKodeLink">/);
  const pkg = read('package.json');
  for (const file of ['src/peta-kode.js', 'generated/peta-kode-data.js', 'public/peta-kode.js', 'scripts/build-peta-kode.mjs']) {
    assert.ok(pkg.includes(`node --check ${file}`), `${file} belum ada di script check`);
  }
  assert.match(pkg, /"peta:build": "node scripts\/build-peta-kode\.mjs"/);
});

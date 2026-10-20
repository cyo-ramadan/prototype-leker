import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { handlePetaAgenApi } from '../src/peta-agen.js';
import petaAgen from '../generated/peta-agen-data.js';
import { hashCredential } from '../src/owner-auth.js';
import { AGEN, JENIS, bacaManifest, bangunPetaAgen, kodeDariRepo } from '../scripts/build-peta-agen.mjs';

// Bos Cyo, 2026-10-20: Peta Agen (Una, Rika, Fina) di Owner Console, ikut berubah saat program
// berubah. Status tiap kotak dihitung dari kode; data hanya lewat API Owner.

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, ROOT), 'utf8');

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
  for (const file of readdirSync(new URL('migrations/', ROOT)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(read(`migrations/${file}`));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_pa', 'owner_pa', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_pa', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-pa'));
  return { db, env: { DB: new D1Database(db) } };
}

test('peta agen selaras dengan kode sekarang (kalau gagal: npm run peta:build lalu commit generated/peta-agen-data.js)', () => {
  const segar = bangunPetaAgen(bacaManifest(ROOT), kodeDariRepo(ROOT));
  const ringkas = data => data.kotak.map(k => `${k.id}:${k.status}:${k.bukti.map(b => (b.ok ? 1 : 0)).join('')}`);
  assert.deepEqual(ringkas(petaAgen), ringkas(segar), 'status kotak berbeda dari kode -- jalankan `npm run peta:build`');
  assert.deepEqual(petaAgen, JSON.parse(JSON.stringify(segar)), 'isi rancangan berbeda dari manifest -- jalankan `npm run peta:build`');
});

test('manifest utuh: id unik, jenis & agen dikenal, garis menunjuk kotak yang ada, kotak tidak keluar kanvas', () => {
  const ids = new Set();
  for (const k of petaAgen.kotak) {
    assert.ok(!ids.has(k.id), `ganda: ${k.id}`); ids.add(k.id);
    assert.ok(JENIS.includes(k.jenis), `jenis ${k.id}`);
    assert.ok(k.agen.length && k.agen.every(a => AGEN.includes(a)), `agen ${k.id}`);
    assert.ok(k.bukti.length > 0, `kotak tanpa bukti: ${k.id}`);
    assert.ok(k.x >= 0 && k.y >= 0 && k.x + 214 <= petaAgen.ukuran.w && k.y + 60 <= petaAgen.ukuran.h, `di luar kanvas: ${k.id}`);
    if (k.file) assert.ok(!k.file.includes('..') && !k.file.includes(':'), `berkas bukan path repo: ${k.id}`);
  }
  for (const [a, b] of petaAgen.garis) assert.ok(ids.has(a) && ids.has(b), `garis ${a} -> ${b}`);
  for (const [agen, r] of Object.entries(petaAgen.ringkas)) assert.equal(r.selesai + r.sebagian + r.belum, r.total, agen);
});

test('penyusun: status dari bukti (semua lolos = selesai, sebagian, belum), tanpa menebak', () => {
  const manifest = {
    judul: 't', handoff: 'h', ukuran: { w: 10, h: 10 }, jalur: [], garis: [],
    kotak: [
      { id: 'a', agen: ['rika'], bukti: [{ f: 'ada.js' }, { m: 'kartu' }] },
      { id: 'b', agen: ['rika'], bukti: [{ f: 'ada.js' }, { g: 'tidak_ada', p: 'ada.js' }] },
      { id: 'c', agen: ['fina'], bukti: [{ f: 'hilang.js' }, { g: 'apa', p: 'hilang.js' }] },
      { id: 'd', agen: ['mesin'], bukti: [{ luar: 'catatan', ok: true }] }
    ]
  };
  const kode = { ada: p => p === 'ada.js', baca: () => 'isi berkas', migrasi: ['migrations/0200_agen_kartu_kasus.sql'] };
  const hasil = bangunPetaAgen(manifest, kode);
  assert.deepEqual(hasil.kotak.map(k => k.status), ['selesai', 'sebagian', 'belum', 'selesai']);
  assert.equal(hasil.kotak[0].bukti[1].cocok, 'migrations/0200_agen_kartu_kasus.sql');
  assert.deepEqual(hasil.ringkas.rika, { total: 2, selesai: 1, sebagian: 1, belum: 0 });
  assert.throws(() => bangunPetaAgen({ ...manifest, kotak: [{ id: 'x', agen: ['una'], bukti: [{ aneh: 1 }] }] }, kode));
});

test('API peta agen: wajib login Owner, hanya GET, sudah terpasang di router', async () => {
  const { db, env } = await ownerEnv();
  try {
    const noLogin = await worker.fetch(new Request('https://example.test/api/owner/peta-agen'), env);
    assert.equal(noLogin.status, 401);
    const ok = await worker.fetch(new Request('https://example.test/api/owner/peta-agen', { headers: { authorization: 'Bearer owner-pa' } }), env);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).kotak.length, petaAgen.kotak.length);
    const post = await handlePetaAgenApi(new Request('https://example.test/api/owner/peta-agen', { method: 'POST', headers: { authorization: 'Bearer owner-pa' } }), env, '/api/owner/peta-agen');
    assert.equal(post.status, 405);
    assert.equal(await handlePetaAgenApi(new Request('https://example.test/api/owner/lain'), env, '/api/owner/lain'), null);
  } finally { db.close(); }
});

test('halaman tidak memuat apa pun dari internet, data tidak di folder publik, tombol ada di Owner Console', () => {
  const html = read('public/peta-agen.html');
  const js = read('public/peta-agen.js');
  for (const source of [html, js]) {
    assert.doesNotMatch(source, /(?:src|href)\s*=\s*["']https?:\/\//i);
    assert.doesNotMatch(source, /fetch\(\s*["']https?:/i);
    assert.doesNotMatch(source, /vscode:\/\/|C:\/Users/i, 'tidak boleh menyebut path laptop');
  }
  assert.match(js, /\/api\/owner\/peta-agen/);
  assert.match(js, /lekerOwnerToken/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /\/peta-agen\.js\?v=20261020-peta-agen-v1/);
  assert.ok(!readdirSync(new URL('public/', ROOT)).some(name => /peta-agen-data|peta-agen-manifest/.test(name)));
  for (const page of ['public/owner.html', 'public/admin.html']) assert.match(read(page), /<a class="primary-btn" href="\/peta-agen" id="ownerPetaAgenLink">/);
  const check = read('scripts/check-syntax.mjs');
  for (const file of ['src/peta-agen.js', 'generated/peta-agen-data.js', 'public/peta-agen.js', 'scripts/build-peta-agen.mjs']) assert.ok(check.includes(file), file);
  assert.match(read('package.json'), /"peta:build": "node scripts\/build-peta-kode\.mjs && node scripts\/build-peta-agen\.mjs"/);
});

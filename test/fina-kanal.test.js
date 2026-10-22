import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { statusKanal, kanalDariToken } from '../src/fina-kanal.js';

// Karyawan -> Pelamar (input manual, 0181) dan Sambungan Fina WA/Email/IG/FB (0182). Bos Cyo 2026-10-22.

const MIGRASI = new URL('../migrations/', import.meta.url);
const semuaMigrasi = () => readdirSync(MIGRASI).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort();
let sqlite, env, store, other;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  run() { return { success: true, meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes || 0) } }; }
}
const req = (path, { token = 'kn-ea', method = 'GET', body } = {}) => new Request('https://test.invalid' + path, {
  method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
});
const call = async (path, opsi) => { const r = await worker.fetch(req(path, opsi), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };

before(async () => {
  sqlite = new DatabaseSync(':memory:');
  for (const f of semuaMigrasi()) sqlite.exec(readFileSync(new URL(f, MIGRASI), 'utf8'));
  store = sqlite.prepare("SELECT * FROM stores WHERE id='store_beji'").get();
  other = sqlite.prepare("SELECT * FROM stores WHERE id='store_001'").get();
  sqlite.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name,is_active) VALUES('kn-ea',?,'kn-ea','x','EA',1), ('kn-ea2','ENT-G001','kn-ea2','x','EA2',1)").run(store.entity_id);
  for (const id of ['kn-ea', 'kn-ea2']) sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(id), id);
  sqlite.prepare("INSERT INTO store_admins(id,username,password_hash,display_name,store_id,is_active) VALUES('kn-admin','kn-admin','x','Admin',?,1)").run(store.id);
  sqlite.prepare("INSERT INTO store_admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,'kn-admin','2026-01-01','2099-01-01')").run(await hashCredential('kn-admin'));
  env = { DB: { prepare: sql => new Statement(sql), batch: async ss => ss.map(s => s.run()) } };
});
after(() => sqlite?.close());

test('migration 0181 menyalin pelamar lama utuh dan mengisi posisi & gerai dari lowongannya', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const f of semuaMigrasi().filter(n => n < '0181')) db.exec(readFileSync(new URL(f, MIGRASI), 'utf8'));
    db.exec("INSERT INTO hr_lowongan(id,entity_id,store_id,slug,posisi,status) VALUES('low1','ENT-KPM','store_beji','cs-beji','CS pagi','TAYANG')");
    db.exec("INSERT INTO hr_pelamar(id,lowongan_id,entity_id,nama,no_wa,status,sumber) VALUES('p1','low1','ENT-KPM','Sari','6281234567890','INTERVIEW','WEB')");
    db.exec(readFileSync(new URL(semuaMigrasi().find(n => n.startsWith('0181')), MIGRASI), 'utf8'));
    const row = db.prepare("SELECT * FROM hr_pelamar WHERE id='p1'").get();
    assert.equal(row.nama, 'Sari');
    assert.equal(row.status, 'INTERVIEW');
    assert.equal(row.posisi, 'CS pagi');
    assert.equal(row.store_id, 'store_beji');
    db.exec("INSERT INTO hr_pelamar(id,lowongan_id,entity_id,nama,no_wa,sumber) VALUES('p2',NULL,'ENT-KPM','Dita','6281111111111','MANUAL')");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hr_pelamar").get().n, 2, 'tanpa lowongan & sumber MANUAL boleh');
  } finally { db.close(); }
});

test('Karyawan -> Pelamar: input manual, nomor dobel ditolak, gerai entity lain ditolak, daftar memuat gerai', async () => {
  const baru = await call('/api/entity-admin/fina/pelamar', { method: 'POST', body: { nama: 'Rani', noWa: '0812-2222-3333', posisi: 'CS sore', storeId: store.id, sumber: 'IG', umur: '20', domisili: 'Malang' } });
  assert.equal(baru.status, 201, JSON.stringify(baru.body));
  assert.equal((await call('/api/entity-admin/fina/pelamar', { method: 'POST', body: { nama: 'Rani lagi', noWa: '+6281222223333' } })).status, 409);
  assert.equal((await call('/api/entity-admin/fina/pelamar', { method: 'POST', body: { nama: 'Xavi', noWa: '081299990000', storeId: other.id } })).status, 403);
  assert.equal((await call('/api/entity-admin/fina/pelamar', { method: 'POST', body: { nama: 'Yuni', noWa: '123' } })).status, 400);
  assert.equal((await call('/api/entity-admin/fina/pelamar', { token: 'kn-admin', method: 'POST', body: { nama: 'Zara', noWa: '081288887777' } })).status, 401, 'Admin gerai tidak boleh');
  const daftar = await call(`/api/entity-admin/fina/pelamar?store=${store.id}`);
  const rani = daftar.body.pelamar.find(p => p.nama === 'Rani');
  assert.equal(rani.storeCode, store.code);
  assert.equal(rani.posisi, 'CS sore');
  assert.equal(rani.sumber, 'IG');
  assert.equal(rani.status, 'BARU');
  assert.equal((await call('/api/entity-admin/fina/pelamar', { token: 'kn-ea2' })).body.pelamar.length, 0, 'entity lain tidak melihat');
});

test('Sambungan Fina: empat kanal, simpan, token WA tampil sekali (disimpan hash), entity terpisah', async () => {
  const awal = await call('/api/entity-admin/fina/kanal');
  assert.equal(awal.status, 200);
  assert.deepEqual(awal.body.kanal.map(k => k.jenis), ['WA', 'EMAIL', 'IG', 'FB']);
  assert.ok(awal.body.kanal.every(k => !k.aktif && k.status.kode === 'MATI'));
  assert.equal((await call('/api/entity-admin/fina/kanal', { method: 'PUT', body: { jenis: 'SMS', aktif: true } })).status, 400);
  assert.equal((await call('/api/entity-admin/fina/kanal', { method: 'PUT', body: { jenis: 'WA', aktif: 'ya' } })).status, 400);
  const wa = await call('/api/entity-admin/fina/kanal', { method: 'PUT', body: { jenis: 'WA', aktif: true, identitas: '0812 HR' } });
  assert.equal(wa.body.kanal.status.kode, 'PERLU_TOKEN');
  const tok = await call('/api/entity-admin/fina/kanal/WA/token', { method: 'POST', body: {} });
  assert.match(tok.body.token, /^otwa_[0-9a-f]{64}$/);
  const row = sqlite.prepare("SELECT * FROM hr_kanal WHERE entity_id=? AND jenis='WA'").get(store.entity_id);
  assert.notEqual(row.token_hash, tok.body.token, 'yang disimpan hash');
  assert.equal(JSON.stringify((await call('/api/entity-admin/fina/kanal')).body).includes(tok.body.token), false, 'token tidak pernah tampil lagi');
  assert.equal((await kanalDariToken(env.DB, tok.body.token)).entity_id, store.entity_id);
  assert.equal(await kanalDariToken(env.DB, 'otwa_' + '0'.repeat(64)), null);
  const ganti = await call('/api/entity-admin/fina/kanal/WA/token', { method: 'POST', body: {} });
  assert.equal(await kanalDariToken(env.DB, tok.body.token), null, 'token lama tidak berlaku');
  assert.ok(await kanalDariToken(env.DB, ganti.body.token));
  assert.ok((await call('/api/entity-admin/fina/kanal', { token: 'kn-ea2' })).body.kanal.every(k => !k.aktif));
  assert.equal((await call('/api/entity-admin/fina/kanal', { token: 'kn-admin' })).status, 401);
});

test('status sambungan dihitung kode', () => {
  const kini = new Date('2026-10-22T10:00:00Z');
  assert.equal(statusKanal('WA', { aktif: 1, token_hash: 'h', terakhir_terlihat: '2026-10-22T09:55:00Z' }, kini).kode, 'TERSAMBUNG');
  assert.equal(statusKanal('WA', { aktif: 1, token_hash: 'h', terakhir_terlihat: '2026-10-22T09:00:00Z' }, kini).kode, 'MENUNGGU');
  assert.equal(statusKanal('IG', { aktif: 1 }, kini).kode, 'MANUAL');
  assert.equal(statusKanal('EMAIL', null, kini).kode, 'MATI');
});

test('layar: tombol Pelamar | Karyawan, bawaan Karyawan; kartu Sambungan Fina dimuat', () => {
  const html = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  assert.match(html, /data-karyawan-mode="pelamar" aria-pressed="false"/);
  assert.match(html, /data-karyawan-mode="karyawan" aria-pressed="true"/);
  assert.match(html, /id="entityPelamarPanel" hidden/);
  assert.match(html, /id="entityFinaKanal"/);
  assert.match(html, /entity-pelamar\.js\?v=/);
  assert.match(html, /entity-fina-kanal\.js\?v=/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { FINA_BAWAAN, gabungPengaturanFina, pengaturanFina, simpanPengaturanFina } from '../src/fina-pengaturan.js';

// Paket H1 (contracts/fina-hr-paket-v1.md): aturan HR Fina per entity + override per gerai,
// nilai KPM hanya bawaan, tarif & denda dibaca dari Dana Apresiasi.

class D1Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { return { success: true, meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes || 0) } }; }
}

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_kpm', 'ENT-KPM', 'ea_kpm', 'x', 'EA KPM', 1), ('ea_g1', 'ENT-G001', 'ea_g1', 'x', 'EA G1', 1)`).run();
  for (const [token, id] of [['tok-kpm', 'ea_kpm'], ['tok-g1', 'ea_g1']]) {
    sqlite.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, ?, '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token), id);
  }
  const env = { DB: { prepare: (sql) => new D1Statement(sqlite, sql), batch: async (ss) => ss.map((s) => s.run()) } };
  const call = async (method, body, token = 'tok-kpm') => {
    const res = await worker.fetch(new Request('https://example.test/api/entity-admin/fina/settings', {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
    }), env);
    return { status: res.status, body: await res.json() };
  };
  return { sqlite, env, call };
}

test('gabungan gerai -> entity -> bawaan; NULL / kosong ikut tingkat di atasnya', () => {
  assert.deepEqual(gabungPengaturanFina(null, null), { ...FINA_BAWAAN, spTingkat: [...FINA_BAWAAN.spTingkat] });
  const entity = { deteksiKosongMenit: 15, tawaranSerentak: null, backupLintasGerai: false, spTingkat: ['TEGURAN', 'SP1'], kopSurat: 'PT Contoh' };
  const gerai = { deteksiKosongMenit: 5, backupLintasGerai: null, spBerlakuHari: 60, kopSurat: '' };
  const hasil = gabungPengaturanFina(entity, gerai);
  assert.equal(hasil.deteksiKosongMenit, 5, 'gerai menang');
  assert.equal(hasil.tawaranSerentak, FINA_BAWAAN.tawaranSerentak, 'entity kosong -> bawaan');
  assert.equal(hasil.backupLintasGerai, false, 'gerai NULL -> entity (false tetap false)');
  assert.equal(hasil.spBerlakuHari, 60);
  assert.deepEqual(hasil.spTingkat, ['TEGURAN', 'SP1']);
  assert.equal(hasil.kopSurat, 'PT Contoh', 'kop kosong di gerai ikut entity');
  assert.equal(gabungPengaturanFina(entity, null).deteksiKosongMenit, 15);
});

test('validasi menolak nilai di luar rentang dan tingkatan SP yang tidak wajar', async () => {
  const { env } = await setup();
  const simpan = (input) => simpanPengaturanFina(env.DB, { entityId: 'ENT-KPM', input });
  for (const salah of [
    { deteksiKosongMenit: 0 }, { deteksiKosongMenit: 241 }, { deteksiKosongMenit: 2.5 }, { tawaranSerentak: 21 },
    { batasTungguMenit: 4 }, { spBerlakuHari: 731 }, { backupLintasGerai: 'kadang' },
    { spTingkat: [] }, { spTingkat: 'A,B,C,D,E,F,G' }, { spTingkat: 'SP1, sp1' }, { spTingkat: '<script>' }, { kopSurat: 'x'.repeat(501) }
  ]) {
    const hasil = await simpan(salah);
    assert.equal(hasil.ok, false, JSON.stringify(salah));
    assert.ok(hasil.error);
  }
  assert.equal((await simpan({ spTingkat: 'teguran lisan, sp 1, sp 2', deteksiKosongMenit: '20' })).ok, true);
  const efektif = await pengaturanFina(env.DB, 'ENT-KPM');
  assert.deepEqual(efektif.spTingkat, ['TEGURAN LISAN', 'SP 1', 'SP 2']);
  assert.equal(efektif.deteksiKosongMenit, 20);
});

test('pengaturanFina per gerai membaca tarif & denda dari Dana Apresiasi (tidak disimpan ulang)', async () => {
  const { sqlite, env } = await setup();
  sqlite.prepare(`INSERT INTO apresiasi_settings (entity_id, store_id, enabled, rate_per_hour_rupiah) VALUES ('ENT-KPM', '', 1, 3000)`).run();
  const hasil = await pengaturanFina(env.DB, 'ENT-KPM', 'store_beji');
  assert.equal(hasil.apresiasi.tarifPerJamRupiah, 3000);
  assert.equal(hasil.deteksiKosongMenit, FINA_BAWAAN.deteksiKosongMenit);
  const kolom = sqlite.prepare("SELECT name FROM pragma_table_info('hr_settings')").all().map((r) => r.name);
  assert.ok(!kolom.some((n) => /rate|tarif|denda/.test(n)), 'hr_settings tidak menyimpan tarif/denda');
});

test('API: hanya Entity Admin/Owner; gerai entity lain ditolak; simpan & baca per gerai', async () => {
  const { call } = await setup();
  assert.equal((await call('GET', null, null)).status, 401);
  assert.equal((await call('PUT', { deteksiKosongMenit: 5 }, null)).status, 401);
  assert.equal((await call('POST', {})).status, 405);

  const awal = await call('GET');
  assert.equal(awal.status, 200);
  assert.equal(awal.body.entity.tersimpan, null);
  assert.equal(awal.body.entity.efektif.deteksiKosongMenit, FINA_BAWAAN.deteksiKosongMenit);
  assert.ok(awal.body.stores.some((s) => s.storeId === 'store_beji'));
  assert.ok(!awal.body.stores.some((s) => s.storeId === 'store_001'), 'hanya gerai entity sendiri');

  assert.equal((await call('PUT', { deteksiKosongMenit: 15, backupLintasGerai: false, kopSurat: 'KPM\nMalang' })).status, 200);
  const gerai = await call('PUT', { storeId: 'store_beji', deteksiKosongMenit: 5 });
  assert.equal(gerai.status, 200, JSON.stringify(gerai.body));
  assert.equal(gerai.body.efektif.deteksiKosongMenit, 5);
  assert.equal(gerai.body.efektif.backupLintasGerai, false, 'ikut entity');
  assert.equal(gerai.body.efektif.kopSurat, 'KPM\nMalang');

  const sesudah = await call('GET');
  const beji = sesudah.body.stores.find((s) => s.storeId === 'store_beji');
  const pendem = sesudah.body.stores.find((s) => s.storeId === 'store_pendem');
  assert.equal(beji.efektif.deteksiKosongMenit, 5);
  assert.equal(pendem.efektif.deteksiKosongMenit, 15);
  assert.equal(pendem.override, null);

  assert.equal((await call('PUT', { storeId: 'store_001', deteksiKosongMenit: 5 })).status, 403, 'gerai entity lain');
  assert.equal((await call('PUT', { deteksiKosongMenit: 999 })).status, 400);
  // Entity lain tidak melihat pengaturan KPM.
  const lain = await call('GET', null, 'tok-g1');
  assert.equal(lain.status, 200);
  assert.equal(lain.body.entity.tersimpan, null);
});

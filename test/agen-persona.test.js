import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import { hashCredential } from '../src/owner-auth.js';
import { handleCacaApi } from '../src/caca-chat.js';
import { namaAsistenValid } from '../src/caca-pengaturan.js';
import { jawabPertanyaan, alatPersonaUrut } from '../src/caca-agen.js';
import { AKSI_TULIS, AKSI_FINA, cariAksi } from '../src/caca-aksi.js';
import {
  PERSONA, DAFTAR_AGEN, agenDari, personaUntuk, daftarPersona, alatPersona, bolehAlat, pengaturanPersonaDari
} from '../src/agen-persona.js';

// Paket H0 (contracts/fina-hr-paket-v1.md): registry persona, `agen` di /api/caca/tanya,
// pemilih Una · Rika · Fina, saklar & nama per tenant. Una tidak berubah.

const HR = new Set(['atur_jadwal_kasir', 'buat_karyawan', 'jelaskan', 'selesai', 'tidak_ada', ...AKSI_FINA.map((a) => a.nama)]);

test('registry: Una = semua alat lama, Fina hanya alat HR, Rika hanya alat akuntan', () => {
  assert.deepEqual(DAFTAR_AGEN, ['una', 'rika', 'fina']);
  assert.equal(PERSONA.una.alat, null);
  assert.equal(alatPersona(PERSONA.una, AKSI_TULIS), AKSI_TULIS, 'Una melihat daftar yang sama persis');
  const fina = alatPersona(PERSONA.fina, AKSI_TULIS).map((a) => a.nama);
  assert.ok(fina.length > 0);
  for (const nama of fina) assert.ok(HR.has(nama), `Fina tidak boleh melihat ${nama}`);
  for (const bukanHr of ['buat_barang', 'buat_jurnal', 'penyesuaian_gaji', 'catat_bea_gaji', 'cek_setoran_cs', 'hitung_ulang_hpp']) {
    assert.equal(bolehAlat(PERSONA.fina, bukanHr), false, bukanHr);
  }
  assert.equal(bolehAlat(PERSONA.fina, 'baca_api'), false, 'Fina tidak membaca API bebas');
  assert.equal(bolehAlat(PERSONA.rika, 'buat_barang'), false);
  assert.equal(bolehAlat(PERSONA.rika, 'buat_jurnal'), true);
  // Semua alat Rika/Fina benar-benar ada (alat mesin, alat baca lama, atau aksi terdaftar).
  for (const id of ['rika', 'fina']) {
    for (const nama of PERSONA[id].alat) {
      assert.ok(['laba_periode', 'stok_sisa', 'baca_api', 'rencana'].includes(nama) || cariAksi(nama), `${id}: ${nama} tidak ada`);
    }
  }
});

test('personaUntuk: tidak dikenal 404, peran tidak diizinkan / dimatikan 403, bawaan aktif', () => {
  const bawaan = pengaturanPersonaDari({});
  assert.equal(agenDari(undefined), 'una');
  assert.equal(agenDari('FINA'), 'fina');
  assert.equal(agenDari('jarvis'), null);
  assert.equal(personaUntuk('jarvis', { role: 'OWNER', pengaturan: bawaan }).status, 404);
  assert.equal(personaUntuk('rika', { role: 'ADMIN', pengaturan: bawaan }).status, 403);
  assert.equal(personaUntuk('fina', { role: 'ENTITY_ADMIN', pengaturan: bawaan }).ok, true);
  const mati = pengaturanPersonaDari({ agen_fina_aktif: '0', fina_nama_asisten: 'Bu Fina' }, namaAsistenValid);
  const ditolak = personaUntuk('fina', { role: 'OWNER', pengaturan: mati });
  assert.equal(ditolak.status, 403);
  assert.equal(ditolak.code, 'AGEN_DIMATIKAN');
  assert.match(ditolak.error, /Bu Fina/);
  assert.deepEqual(daftarPersona({ role: 'OWNER', pengaturan: mati }).map((a) => a.id), ['una', 'rika']);
  assert.deepEqual(daftarPersona({ role: 'ENTITY_ADMIN', pengaturan: bawaan }).map((a) => a.nama), ['Una', 'Rika', 'Fina']);
});

const konteks = { nama: 'Bos Cyo', peran: 'Owner', storeCode: 'G001', storeName: 'Mandala', hariIni: '2026-10-21', lingkup: 'gerai', namaLingkup: 'Mandala' };
function modelPalsu(...balasan) {
  const panggilan = [];
  return {
    panggilan,
    panggilModel: async (env, permintaan) => { panggilan.push(permintaan); return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'habis' }; }
  };
}

test('mesin: Fina hanya dikirimi alat HR ke model; Una tetap mendapat daftar lengkap', async () => {
  const fina = modelPalsu({ ok: true, value: { alat: 'selesai', jawaban_akhir: 'Halo Bos.' } });
  await jawabPertanyaan('halo', { ...konteks, persona: PERSONA.fina, namaAsisten: 'Fina' }, { env: {}, panggilModel: fina.panggilModel });
  const enumFina = fina.panggilan[0].schema.properties.alat.enum;
  for (const nama of enumFina) assert.ok(HR.has(nama), `enum Fina memuat ${nama}`);
  assert.match(fina.panggilan[0].system, /Kamu Fina, asisten HR/);
  assert.doesNotMatch(fina.panggilan[0].system, /buat_barang|baca_api|Maimunah/);
  assert.deepEqual(alatPersonaUrut(PERSONA.fina).filter((n) => !HR.has(n)), []);

  const una = modelPalsu({ ok: true, value: { alat: 'selesai', jawaban_akhir: 'Halo Bos.' } });
  await jawabPertanyaan('halo', konteks, { env: {}, panggilModel: una.panggilModel });
  const enumUna = una.panggilan[0].schema.properties.alat.enum;
  for (const nama of ['buat_barang', 'baca_api', 'catat_pengeluaran', 'penyesuaian_gaji', 'rencana']) assert.ok(enumUna.includes(nama), nama);
  assert.match(una.panggilan[0].system, /Kamu Maimunah/);
});

test('mesin: alat di luar wewenang Fina ditolak kode walau model memilihnya', async () => {
  const { panggilModel } = modelPalsu({ ok: true, value: { alat: 'buat_barang', barang_nama: 'Es Teh', barang_harga_jual: '5rb' } });
  const hasil = await jawabPertanyaan('bikin barang es teh 5rb', { ...konteks, persona: PERSONA.fina, namaAsisten: 'Fina' }, {
    env: {}, panggilModel, jalurAksi: { baca: async () => { throw new Error('tidak boleh membaca'); }, kirim: async () => { throw new Error('tidak boleh menulis'); } }
  });
  assert.equal(hasil.draft, undefined);
  assert.equal(hasil.alat, null);
  assert.match(hasil.jawaban, /belum bisa bantu/);
});

test('riwayat tidak tercampur: tugas tertunda Una tidak ikut ke Fina', async () => {
  const tertunda = { alat: 'buat_barang', tangkapan: { barang_nama: 'Es Teh' }, tanya: 'Harga jualnya berapa?', kurang: 'barang_harga_jual' };
  const fina = modelPalsu({ ok: true, value: { alat: 'selesai', jawaban_akhir: 'Siap.' } });
  await jawabPertanyaan('5000', { ...konteks, persona: PERSONA.fina, namaAsisten: 'Fina' }, { env: {}, panggilModel: fina.panggilModel, tertunda });
  const teks = fina.panggilan.map((p) => p.content.map((b) => b.text).join('\n')).join('\n');
  assert.doesNotMatch(teks, /TUGAS YANG SEDANG/);

  // Una masih melanjutkan tugasnya sendiri seperti dulu.
  const una = modelPalsu({ ok: true, value: { alat: 'selesai', jawaban_akhir: 'Siap.' } });
  await jawabPertanyaan('5000', konteks, { env: {}, panggilModel: una.panggilModel, tertunda });
  assert.match(una.panggilan.map((p) => p.content.map((b) => b.text).join('\n')).join('\n'), /TUGAS YANG SEDANG/);
});

class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { return { success: true, meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } }; }
}
async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const env = { DB: { prepare: (sql) => new Statement(sqlite, sql), batch: async (ss) => ss.map((s) => s.run()) } };
  sqlite.exec("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('agen-e1','ENT-G001','agen-e1','x','One'),('agen-e2','ENT-G002','agen-e2','x','Two')");
  for (const id of ['agen-e1', 'agen-e2']) {
    sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')").run(await hashCredential(id), id);
  }
  async function call(path, method = 'GET', body, token = 'agen-e1') {
    const req = new Request(`https://example.test${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const res = await handleCacaApi(req, env, new URL(req.url).pathname);
    return { status: res.status, body: await res.json() };
  }
  return { sqlite, call };
}

test('/api/caca/tanya: agen dikenal dipakai, tidak dikenal 404, dimatikan 403 (bukan diam-diam ke Una)', async (t) => {
  const f = await fixture(t);
  const tanya = (body, token) => f.call('/api/caca/tanya?store=G001', 'POST', { conversationId: '17171717-1717-4171-8171-171717171717', ...body }, token);
  const fina = await tanya({ pertanyaan: 'buka Karyawan', agen: 'fina' });
  assert.equal(fina.status, 200, JSON.stringify(fina.body));
  assert.equal(fina.body.agen, 'fina');
  assert.equal(fina.body.namaAsisten, 'Fina');
  const una = await tanya({ pertanyaan: 'buka Karyawan' });
  assert.equal(una.status, 200);
  assert.equal(una.body.agen, undefined, 'balasan Una tidak berubah bentuk');
  assert.equal(una.body.namaAsisten, 'Una');
  assert.equal((await tanya({ pertanyaan: 'halo', agen: 'jarvis' })).status, 404);

  // Saklar per tenant: matikan Fina di tenant E1 -> 403; tenant lain tidak terpengaruh.
  const patch = await f.call('/api/caca/pengaturan?store=G001', 'PATCH', { persona: 'fina', aktif: false, namaAsisten: 'Bu Fina' });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  assert.equal(patch.body.aktif, false);
  assert.deepEqual(patch.body.agen.map((a) => a.id), ['una', 'rika']);
  const mati = await tanya({ pertanyaan: 'buka Karyawan', agen: 'fina' });
  assert.equal(mati.status, 403);
  assert.equal(mati.body.code, 'AGEN_DIMATIKAN');
  const lain = await f.call('/api/caca/tanya?store=G002', 'POST', { pertanyaan: 'buka Karyawan', agen: 'fina' }, 'agen-e2');
  assert.equal(lain.status, 200);
  assert.equal(lain.body.namaAsisten, 'Fina');

  const atur = await f.call('/api/caca/pengaturan?store=G001');
  assert.deepEqual(atur.body.agen.map((a) => a.id), ['una', 'rika']);
  assert.deepEqual(atur.body.persona.fina, { nama: 'Bu Fina', aktif: false });
  assert.equal(atur.body.namaAsisten, 'Una', 'nama Una tidak ikut berubah');
  assert.equal((await f.call('/api/caca/pengaturan?store=G001', 'PATCH', { persona: 'fina', aktif: 'mati' })).status, 400);
  assert.equal((await f.call('/api/caca/pengaturan?store=G001', 'PATCH', { persona: 'jarvis', aktif: true })).status, 404);
});

test('/api/caca/catat: draft alat Una tidak bisa diposting atas nama Fina', async (t) => {
  const f = await fixture(t);
  const draft = { aksi: 'buat_barang', muatan: { name: 'Es Teh' }, tangkapan: { barang_nama: 'Es Teh', barang_harga_jual: '5rb' } };
  const hasil = await f.call('/api/caca/catat?store=G001', 'POST', { draft, agen: 'fina' });
  assert.equal(hasil.status, 403);
  assert.equal(hasil.body.code, 'AGEN_DRAFT_LAIN');
});

test('panel: percakapan & conversationId dipisah per persona, Una memakai kunci lama', () => {
  const sumber = readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
  const potong = sumber.match(/const CACA_SIMPANAN = [^\n]+/)[0]
    + '\nconst cacaState = { agen: "una", daftarAgen: [] };\n'
    + sumber.match(/const CACA_AGEN_BAWAAN[\s\S]*?function cacaRenderPilihAgen/)[0].replace(/function cacaRenderPilihAgen$/, '')
    + '\n({ kunci: cacaKunciSimpanan, isi: cacaDenganAgen, state: cacaState })';
  const { kunci, isi, state } = vm.runInNewContext(potong, { WeakMap });
  assert.equal(kunci('una'), 'lekerUnaPercakapan');
  assert.equal(kunci('fina'), 'lekerUnaPercakapan:fina');
  assert.notEqual(kunci('rika'), kunci('fina'));
  assert.equal(JSON.stringify(isi({ pertanyaan: 'x' })), '{"pertanyaan":"x"}', 'Una tidak mengirim agen');
  state.agen = 'fina';
  assert.equal(JSON.stringify(isi({ pertanyaan: 'x' })), '{"pertanyaan":"x","agen":"fina"}');
  assert.match(sumber, /const key = cacaKunciSimpanan\(\) \+ ':id:'/);
  assert.match(sumber, /id="cacaPilihAgen"[^>]*role="tablist"/);
});

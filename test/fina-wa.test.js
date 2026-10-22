import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { periksaUlangDraft } from '../src/caca-aksi.js';
import { PERSONA, bolehAlat } from '../src/agen-persona.js';
import { getJakartaBusinessDate } from '../src/time.js';
import { catatPelamarDariWa, undangPelamar, kabariCsTraining } from '../src/agen-fina-tulis.js';
import { samarkanNomor, BATAS_WA } from '../src/fina-wa.js';

// WA Fina lewat gateway lokal (migration 0183): pesan masuk, antrean keluar, alat Fina tanpa nomor.

let sqlite, env, store, tokenGateway;
const HARI_INI = getJakartaBusinessDate();
const BESOK = new Date(Date.parse(HARI_INI + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  run() { return { success: true, meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes || 0) } }; }
}
const req = (path, { token = 'wa-ea', method = 'GET', body } = {}) => new Request('https://test.invalid' + path, {
  method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
});
const call = async (path, opsi) => { const r = await worker.fetch(req(path, opsi), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };
const gw = (path, opsi = {}) => call(path, { ...opsi, token: tokenGateway });
const ctxAgen = () => ({
  ...bangunJalurAksi(req('/api/caca/tanya'), env, { storeCode: store.code, jalurUtama: r => worker.fetch(r, env, { waitUntil() {} }) }),
  lingkup: 'gerai', hariIni: HARI_INI, namaLingkup: store.store_name, storeCode: store.code
});
const NOMOR_LENGKAP = /62\d{8,13}/;

before(async () => {
  sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  store = sqlite.prepare("SELECT * FROM stores WHERE id='store_beji'").get();
  sqlite.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name,is_active) VALUES('wa-ea',?,'wa-ea','x','EA',1), ('wa-ea2','ENT-G001','wa-ea2','x','EA2',1)").run(store.entity_id);
  for (const id of ['wa-ea', 'wa-ea2']) sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(id), id);
  // CS Beji dengan nomor HP di data karyawan.
  sqlite.prepare("INSERT INTO cashiers(id,username,password_hash,employee_name,store_id,is_active) VALUES('wa-cs','wa-cs','x','Avinda',?,1)").run(store.id);
  sqlite.prepare("INSERT INTO employees(id,entity_id,full_name,phone,status) VALUES('emp-avinda',?,'Avinda','0813-1111-2222','ACTIVE')").run(store.entity_id);
  sqlite.prepare("INSERT INTO employee_account_links(id,employee_id,entity_id,account_type,account_id,store_id,effective_from) VALUES('lnk1','emp-avinda',?,'CASHIER','wa-cs',?,'2026-01-01')").run(store.entity_id, store.id);
  env = { DB: { prepare: sql => new Statement(sql), batch: async ss => ss.map(s => s.run()) } };
  await call('/api/entity-admin/fina/kanal', { method: 'PUT', body: { jenis: 'WA', aktif: true, identitas: 'HR' } });
  tokenGateway = (await call('/api/entity-admin/fina/kanal/WA/token', { method: 'POST', body: {} })).body.token;
});
after(() => sqlite?.close());

test('gateway: token wajib, pesan masuk sekali, pengirim dikenali (karyawan / asing), terlihat tercatat', async () => {
  assert.equal((await call('/api/fina/wa/gateway/masuk', { token: 'otwa_' + 'b'.repeat(64), method: 'POST', body: { pesan: [] } })).status, 401);
  const pesan = [
    { waId: 'M1', jid: '628555000111@s.whatsapp.net', nama: 'Sari', teks: 'Kak mau lamar kerja CS', waktu: 1761100000 },
    { waId: 'M2', jid: '123456789@lid', noWa: '6281311112222', nama: 'Avinda', teks: 'Siap kak' },
    { waId: 'M3', jid: 'bukan-jid', teks: 'diabaikan' }
  ];
  const r = await gw('/api/fina/wa/gateway/masuk', { method: 'POST', body: { pesan } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.baru, 2);
  assert.equal((await gw('/api/fina/wa/gateway/masuk', { method: 'POST', body: { pesan } })).body.baru, 0, 'dedup per id pesan');
  const masuk = (await call('/api/entity-admin/fina/wa/masuk')).body.masuk;
  assert.equal(masuk.find(m => m.namaWa === 'Avinda').pengirim, 'KARYAWAN');
  assert.equal(masuk.find(m => m.namaWa === 'Sari').pengirim, 'ASING');
  assert.ok(sqlite.prepare("SELECT terakhir_terlihat FROM hr_kanal WHERE entity_id=? AND jenis='WA'").get(store.entity_id).terakhir_terlihat);
  assert.equal((await call('/api/entity-admin/fina/wa/masuk', { token: 'wa-ea2' })).body.masuk.length, 0, 'entity lain tidak melihat');
});

test('alat Fina: catat pelamar dari WA tanpa nomor lengkap & tanpa isi pesan asing di draft', async () => {
  assert.equal(bolehAlat(PERSONA.fina, 'catat_pelamar_dari_wa'), true);
  assert.equal(bolehAlat(PERSONA.rika, 'undang_pelamar'), false);
  const ctx = ctxAgen();
  const t = { cw_posisi: 'CS', cw_gerai: '' };
  const r = await catatPelamarDariWa.siapkan(t, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  const teksDraft = JSON.stringify(r.draft);
  assert.doesNotMatch(teksDraft, NOMOR_LENGKAP, 'nomor tersamar');
  assert.doesNotMatch(teksDraft, /lamar kerja/, 'isi pesan asing tidak ikut draft');
  const cek = await periksaUlangDraft({ ...r.draft, tangkapan: t }, ctx);
  assert.equal(cek.ok, true, JSON.stringify(cek));
  const hasil = await catatPelamarDariWa.posting(cek.draft, ctx);
  assert.match(hasil.jawaban, /1 pelamar baru/);
  const sari = sqlite.prepare("SELECT * FROM hr_pelamar WHERE nama='Sari'").get();
  assert.equal(sari.no_wa, '628555000111');
  assert.equal(sari.sumber, 'WA');
  assert.match(sari.catatan, /lamar kerja/);
  assert.equal((await catatPelamarDariWa.siapkan(t, ctx)).ok, false, 'sudah diproses tidak muncul lagi');
});

test('alat Fina: undang pelamar & kabari CS -> antrean DISETUJUI; gateway mengambil, batas & hasil', async () => {
  const ctx = ctxAgen();
  const tu = { up_pelamar: 'sari', up_jenis: 'interview', up_tanggal: BESOK, up_jam: '10:00', up_catatan: 'Bawa KTP.' };
  const u = await undangPelamar.siapkan(tu, ctx);
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.doesNotMatch(JSON.stringify(u.draft), NOMOR_LENGKAP);
  assert.match(u.draft.tabel.isi[0][0], /interview di gerai .* pukul 10:00 WIB\. Bawa KTP\./);
  assert.equal((await undangPelamar.siapkan({ ...tu, up_tanggal: '2020-01-01' }, ctx)).ok, false, 'tanggal lewat ditolak');
  const cu = await periksaUlangDraft({ ...u.draft, tangkapan: tu }, ctx);
  assert.equal((await undangPelamar.posting(cu.draft, ctx)).ok, true);

  const tk = { kc_cs: 'avinda', kc_pelamar: 'Sari', kc_tanggal: BESOK, kc_jam: '14:00' };
  const k = await kabariCsTraining.siapkan(tk, ctx);
  assert.equal(k.ok, true, JSON.stringify(k));
  assert.doesNotMatch(JSON.stringify(k.draft), NOMOR_LENGKAP);
  const ck = await periksaUlangDraft({ ...k.draft, tangkapan: tk }, ctx);
  assert.equal((await kabariCsTraining.posting(ck.draft, ctx)).ok, true);

  const antre = (await call('/api/entity-admin/fina/wa/keluar')).body.keluar;
  assert.deepEqual(antre.map(x => x.status).sort(), ['DISETUJUI', 'DISETUJUI']);
  const ambil = await gw('/api/fina/wa/gateway/keluar');
  assert.deepEqual(ambil.body.pesan.map(p => p.noWa).sort(), ['6281311112222', '628555000111']);
  assert.equal((await gw('/api/fina/wa/gateway/keluar')).body.pesan.length, 0, 'yang sudah diambil tidak diambil dua kali');
  const [p1, p2] = ambil.body.pesan;
  assert.equal((await gw(`/api/fina/wa/gateway/keluar/${p1.id}/hasil`, { method: 'POST', body: { ok: true } })).status, 200);
  assert.equal((await gw(`/api/fina/wa/gateway/keluar/${p2.id}/hasil`, { method: 'POST', body: { ok: false, alasan: 'nomor tidak terdaftar' } })).status, 200);
  assert.equal((await gw(`/api/fina/wa/gateway/keluar/${p1.id}/hasil`, { method: 'POST', body: { ok: true } })).status, 409);
  const akhir = (await call('/api/entity-admin/fina/wa/keluar')).body.keluar;
  assert.deepEqual(akhir.map(x => x.status).sort(), ['DIKIRIM', 'GAGAL']);
});

test('antrean: draft perlu Setujui, batas kirim per nomor per hari ditegakkan server', async () => {
  const ids = [];
  for (let i = 0; i < BATAS_WA.kirimPerNomorPerHari + 1; i += 1) {
    const r = await call('/api/entity-admin/fina/wa/keluar', { method: 'POST', body: { noWa: '081299998888', teks: `Pesan ${i}`, setujui: i > 0 } });
    assert.equal(r.status, 201);
    ids.push(r.body.id);
  }
  assert.equal((await call(`/api/entity-admin/fina/wa/keluar/${ids[0]}/setujui`, { method: 'POST', body: {} })).status, 200);
  const ambil = (await gw('/api/fina/wa/gateway/keluar')).body.pesan.filter(p => p.noWa === '6281299998888');
  assert.equal(ambil.length, BATAS_WA.kirimPerNomorPerHari, 'maks per nomor per hari');
  assert.equal((await call('/api/entity-admin/fina/wa/keluar', { method: 'POST', body: { noWa: '123', teks: 'x' } })).status, 400);
  assert.equal(samarkanNomor('6281234567890'), '0812****7890');
});

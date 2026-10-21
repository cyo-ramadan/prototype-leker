import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { periksaUlangDraft, cariAksi } from '../src/caca-aksi.js';
import { PERSONA, bolehAlat } from '../src/agen-persona.js';
import { getJakartaBusinessDate } from '../src/time.js';
import { AKSI_FINA_TULIS, susunIsiSurat, siapkanTawaranBackup, catatPengganti, pasangPengumuman, draftSp } from '../src/agen-fina-tulis.js';

// Paket H3 (contracts/fina-hr-paket-v1.md): alat tulis Fina, semua lewat draft + "Ya" (tawaran
// backup hanya teks). Surat SP disimpan DRAFT; status hanya berubah lewat tombol manusia.

let sqlite, env, store;
const HARI_INI = getJakartaBusinessDate();
const geser = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const KEMARIN = geser(HARI_INI, -1);
const wib = (date, hhmm) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();

class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  run() { return { success: true, meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes || 0) } }; }
}
const req = (path, token = 'h3-ea', method = 'GET', body) => new Request('https://test.invalid' + path, {
  method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {})
});
const fetchJson = async (path, token, method, body) => { const r = await worker.fetch(req(path, token, method, body), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };
const ctxAgen = () => ({
  ...bangunJalurAksi(req('/api/caca/tanya'), env, { storeCode: store.code, jalurUtama: r => worker.fetch(r, env, { waitUntil() {} }) }),
  lingkup: 'gerai', hariIni: HARI_INI, namaLingkup: store.store_name || store.code, storeCode: store.code
});

before(async () => {
  sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  store = sqlite.prepare("SELECT * FROM stores WHERE id='store_pendem'").get();
  for (const [id, nama, backup] of [['h3-rika', 'Rika Asli', 0], ['h3-avinda', 'Avinda Free', 1], ['h3-dita', 'Dita Free', 1]]) {
    sqlite.prepare("INSERT INTO cashiers(id,username,password_hash,employee_name,store_id,is_active,is_entity_backup) VALUES(?,?,'x',?,?,1,?)").run(id, id, nama, store.id, backup);
  }
  for (let d = 0; d < 7; d += 1) sqlite.prepare("INSERT INTO account_shift_schedule(account_type,account_id,day_of_week,is_day_off,shift_start,shift_end) VALUES('CASHIER','h3-rika',?,0,'09:00','17:00')").run(d);
  // Rika telat 30 menit kemarin; Avinda presensi kemarin (dia yang menggantikan).
  sqlite.prepare("INSERT INTO staff_attendance(id,user_id,store_id,attendance_type,photo_blob,photo_type,created_at,status,check_out_at) VALUES('h3-sesi-rika','h3-rika',?,'in',x'00','image/jpeg',?,'CLOSED',?)").run(store.id, wib(KEMARIN, '09:30'), wib(KEMARIN, '17:00'));
  sqlite.prepare("INSERT INTO staff_attendance(id,user_id,store_id,attendance_type,photo_blob,photo_type,created_at,status,check_out_at) VALUES('h3-sesi-avinda','h3-avinda',?,'in',x'00','image/jpeg',?,'CLOSED',?)").run(store.id, wib(KEMARIN, '13:00'), wib(KEMARIN, '17:00'));
  sqlite.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name,is_active) VALUES('h3-ea',?,'h3-ea','x','EA',1), ('h3-ea-lain','ENT-G001','h3-ea-lain','x','EA2',1)").run(store.entity_id);
  for (const id of ['h3-ea', 'h3-ea-lain']) sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(id), id);
  sqlite.prepare("INSERT INTO store_admins(id,username,password_hash,display_name,store_id,is_active) VALUES('h3-admin','h3-admin','x','Admin',?,1)").run(store.id);
  sqlite.prepare("INSERT INTO store_admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,'h3-admin','2026-01-01','2099-01-01')").run(await hashCredential('h3-admin'));
  sqlite.prepare("INSERT INTO hr_settings(entity_id,store_id,tawaran_serentak,batas_tunggu_menit,kop_surat) VALUES(?,'',1,45,'CV Contoh Malang')").run(store.entity_id);
  env = { DB: { prepare: sql => new Statement(sql), batch: async ss => ss.map(s => s.run()) } };
});
after(() => sqlite?.close());

test('terdaftar sebagai alat Fina saja; isi surat hanya menulis fakta yang ada angkanya', () => {
  for (const alat of AKSI_FINA_TULIS) {
    assert.equal(cariAksi(alat.nama), alat);
    assert.equal(bolehAlat(PERSONA.fina, alat.nama), true);
    assert.equal(bolehAlat(PERSONA.rika, alat.nama), false);
  }
  const isi = susunIsiSurat({ kop: '', gerai: 'PENDEM', tingkat: 'TEGURAN', hariIni: '2026-10-21', nama: 'Rika', dari: '2026-10-01', sampai: '2026-10-21',
    fakta: { telatMenit: 30, pulangAwalMenit: 0, kosongMenit: 0, denda: 0, lupaPulang: 1, kejadian: 2, bukti: [{ businessDate: '2026-10-20' }] }, berlakuHari: 90 });
  assert.match(isi, /^PENDEM\n/);
  assert.match(isi, /terlambat total 30 menit/);
  assert.match(isi, /Lupa presensi pulang 1 kali/);
  assert.doesNotMatch(isi, /Pulang sebelum|tidak terjaga|Denda/);
  assert.match(isi, /berlaku 90 hari/);
});

test('tawaran backup: teks siap salin sejumlah pengaturan tawaran serentak, tanpa menulis apa pun', async () => {
  const sebelum = sqlite.prepare('SELECT total_changes() AS n').get().n;
  const r = await siapkanTawaranBackup.siapkan({ fh_jam_dari: '18:00', fh_jam_sampai: '22:00' }, ctxAgen());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.draft, undefined);
  assert.equal(r.tabel.isi.length, 1, 'tawaran_serentak = 1');
  assert.match(r.tabel.isi[0][2], /balas YA atau TIDAK dalam 45 menit/);
  assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n, sebelum);
});

test('catat pengganti: draft diperiksa ulang lalu tercatat lewat rute Dana Apresiasi', async () => {
  const ctx = ctxAgen();
  const t = { cp_pengganti: 'avinda', cp_digantikan: 'rika', cp_tanggal: KEMARIN };
  const r = await catatPengganti.siapkan(t, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.draft.muatan.attendanceId, 'h3-sesi-avinda');
  const cek = await periksaUlangDraft({ ...r.draft, tangkapan: t }, ctx);
  assert.equal(cek.ok, true, JSON.stringify(cek));
  const hasil = await catatPengganti.posting(cek.draft, ctx);
  assert.equal(hasil.ok, true, JSON.stringify(hasil));
  assert.equal(sqlite.prepare("SELECT replaces_account_id FROM apresiasi_pengganti WHERE attendance_id='h3-sesi-avinda'").get().replaces_account_id, 'h3-rika');
  const lagi = await catatPengganti.siapkan(t, ctx);
  assert.equal(lagi.ok, false);
  assert.match(lagi.tanya, /Sudah tercatat/);
  assert.equal((await catatPengganti.siapkan({ ...t, cp_pengganti: 'dita' }, ctx)).ok, false, 'tanpa presensi tidak bisa jadi pengganti');
});

test('pasang pengumuman: draft lalu tayang di papan CS (semua gerai)', async () => {
  const ctx = ctxAgen();
  const r = await pasangPengumuman.siapkan({ pu_judul: 'Info QRIS', pu_isi: 'Mulai besok QRIS wajib diklaim.', pu_semua_gerai: true }, ctx);
  assert.equal(r.ok, true);
  const hasil = await pasangPengumuman.posting(r.draft, ctx);
  assert.equal(hasil.ok, true, JSON.stringify(hasil));
  const row = sqlite.prepare("SELECT * FROM announcements WHERE title='Info QRIS'").get();
  assert.equal(row.store_id, null);
  assert.equal(row.entity_id, store.entity_id);
});

test('draft SP: fakta sama dengan rekap, tersimpan DRAFT, agen tidak bisa menyetujui, tingkat naik setelah disetujui manusia', async () => {
  const ctx = ctxAgen();
  const t = { sp_orang: 'rika', sp_periode: '7_hari_terakhir' };
  const r = await draftSp.siapkan(t, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.draft.muatan.tingkat, 'TEGURAN');
  assert.match(r.draft.muatan.isi, /^CV Contoh Malang/);
  const rekap = await fetchJson(`/api/admin/fina/masalah?store=${store.code}&from=${r.draft.muatan.periodeDari}&to=${r.draft.muatan.periodeSampai}`);
  const baris = rekap.body.employees.find(e => e.accountId === 'h3-rika');
  assert.ok(baris.telatMenit >= 30);
  assert.deepEqual(r.draft.muatan.fakta, baris, 'SP memuat fakta yang sama dengan rekap');

  const cek = await periksaUlangDraft({ ...r.draft, tangkapan: t }, ctx);
  assert.equal(cek.ok, true, JSON.stringify(cek));
  assert.equal((await draftSp.posting(cek.draft, ctx)).ok, true);
  assert.match((await draftSp.posting(cek.draft, ctx)).jawaban, /tidak dibuat dua kali/);
  const surat = sqlite.prepare("SELECT * FROM hr_surat WHERE account_id='h3-rika'").all();
  assert.equal(surat.length, 1);
  assert.equal(surat[0].status, 'DRAFT');

  // Jalur agen tidak punya pintu ke setujui/batalkan.
  const dicoba = await ctx.kirim('POST', `/api/entity-admin/fina/surat/${surat[0].id}/setujui`, {});
  assert.equal(dicoba.ok, false);
  assert.equal(sqlite.prepare('SELECT status FROM hr_surat WHERE id=?').get(surat[0].id).status, 'DRAFT');

  // Tombol manusia.
  assert.equal((await fetchJson(`/api/entity-admin/fina/surat/${surat[0].id}/setujui`, 'h3-admin', 'POST', {})).status, 401, 'Admin gerai tidak boleh');
  assert.equal((await fetchJson(`/api/entity-admin/fina/surat/${surat[0].id}/setujui`, 'h3-ea-lain', 'POST', {})).status, 404, 'entity lain tidak melihat');
  const ok = await fetchJson(`/api/entity-admin/fina/surat/${surat[0].id}/setujui`, 'h3-ea', 'POST', {});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.berlakuSampai, geser(HARI_INI, 90));
  assert.equal((await fetchJson(`/api/entity-admin/fina/surat/${surat[0].id}/batalkan`, 'h3-ea', 'POST', { alasan: '' })).status, 400, 'batal wajib alasan');

  const berikut = await draftSp.siapkan(t, ctx);
  assert.equal(berikut.draft.muatan.tingkat, 'SP1', 'naik satu tingkat dari surat yang masih berlaku');
  assert.equal((await draftSp.siapkan({ ...t, sp_tingkat: 'SP9' }, ctx)).ok, false);
  assert.equal((await draftSp.siapkan({ sp_orang: 'dita', sp_periode: '7_hari_terakhir' }, ctx)).ok, false, 'tanpa catatan masalah tidak ada dasar surat');
});

test('rute surat: hanya Entity Admin/Owner, gerai entity lain ditolak, tingkat harus dari pengaturan', async () => {
  const body = { storeCode: store.code, accountId: 'h3-rika', tingkat: 'SP2', periodeDari: KEMARIN, periodeSampai: KEMARIN, fakta: { kejadian: 1 }, isi: 'Isi' };
  assert.equal((await fetchJson('/api/entity-admin/fina/surat', 'h3-admin', 'POST', body)).status, 401);
  assert.equal((await fetchJson('/api/entity-admin/fina/surat', 'h3-ea-lain', 'POST', body)).status, 403);
  assert.equal((await fetchJson('/api/entity-admin/fina/surat', 'h3-ea', 'POST', { ...body, tingkat: 'PECAT' })).status, 400);
  const list = await fetchJson('/api/entity-admin/fina/surat', 'h3-ea');
  assert.equal(list.status, 200);
  assert.ok(list.body.surat.every(s => s.storeCode === store.code));
  assert.equal((await fetchJson('/api/entity-admin/fina/surat', 'h3-ea-lain')).body.surat.length, 0);
});

test('kamus ber-tag agen: entri khusus Fina tidak menggeser jawaban Una', async () => {
  const { jelaskan } = await import('../src/caca-jelaskan.js');
  for (const [q, una, fina] of [['gerai kosong', 'dana_apresiasi', 'fina_baca'], ['cara setujui sp', null, 'fina_surat'], ['gimana catat pengganti', null, 'fina_tulis']]) {
    const u = jelaskan(q, { halaman: 'entity' }).topik;
    if (una) assert.equal(u, una, q); else assert.ok(!String(u).startsWith('fina_'), `${q}: Una tidak memakai entri Fina`);
    assert.equal(jelaskan(q, { halaman: 'entity', agen: 'fina' }).topik, fina, q);
  }
});

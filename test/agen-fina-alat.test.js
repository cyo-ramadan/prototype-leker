import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { handleFinaApi } from '../src/fina-api.js';
import { AKSI_FINA_BACA, cariGeraiKosong, daftarFreelanceTersedia, rekapMasalahCs } from '../src/agen-fina-alat.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { bangunAlamat, cariApi } from '../src/caca-baca-katalog.js';
let sqlite, env, store, other, alien;
const NOW = new Date('2026-10-21T10:00:00+07:00');
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { assert.ok(values.length <= 100, 'batas bind D1'); return new Statement(this.sql, values); }
  first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
}
const request = (path, token = 'fina-owner', method = 'GET') => new Request('https://test.invalid' + path, { method, headers: { authorization: 'Bearer ' + token } });
const call = (suffix, token, method) => {
  const r = request('/api/admin/fina/' + suffix, token, method);
  return handleFinaApi(r, env, new URL(r.url).pathname, { now: NOW });
};
before(async () => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  store = sqlite.prepare("SELECT * FROM stores WHERE id='store_pendem'").get();
  other = sqlite.prepare('SELECT * FROM stores WHERE entity_id=? AND id<>? AND is_active=1 LIMIT 1').get(store.entity_id, store.id);
  alien = sqlite.prepare('SELECT * FROM stores WHERE entity_id<>? AND is_active=1 LIMIT 1').get(store.entity_id);
  assert.ok(store && other && alien);
  // H1 owns the production migration. This is only the schema fixture for H2's reader.
  sqlite.exec("CREATE TABLE IF NOT EXISTS hr_settings (entity_id TEXT, store_id TEXT, deteksi_kosong_menit INTEGER, backup_lintas_gerai INTEGER, PRIMARY KEY(entity_id, store_id))");
  sqlite.prepare("INSERT INTO hr_settings(entity_id,store_id,deteksi_kosong_menit,backup_lintas_gerai) VALUES(?,'',10,1)").run(store.entity_id);
  for (const [id, sid, backup] of [['fina-asli',store.id,0],['fina-free',store.id,1],['fina-away',other.id,1]]) {
    sqlite.prepare("INSERT INTO cashiers(id,username,password_hash,employee_name,store_id,is_active,is_entity_backup) VALUES(?,?,'x',?,?,1,?)").run(id,id,id,sid,backup);
  }
  sqlite.prepare("INSERT INTO account_shift_schedule(account_type,account_id,day_of_week,is_day_off,shift_start,shift_end) VALUES('CASHIER','fina-asli',3,0,'09:00','17:00')").run();
  sqlite.prepare("INSERT INTO owner_accounts(id,username,password_hash,display_name,is_active) VALUES('fina-owner','fina-owner','x','Bos',1)").run();
  sqlite.prepare("INSERT INTO owner_sessions(token_hash,owner_id,created_at,expires_at) VALUES(?,'fina-owner','2026-01-01','2099-01-01')").run(await hashCredential('fina-owner'));
  sqlite.prepare("INSERT INTO store_admins(id,username,password_hash,display_name,store_id,is_active) VALUES('fina-admin','fina-admin','x','Admin',?,1)").run(store.id);
  sqlite.prepare("INSERT INTO store_admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,'fina-admin','2026-01-01','2099-01-01')").run(await hashCredential('fina-admin'));
  sqlite.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name,is_active) VALUES('fina-ea',?,'fina-ea','x','EA',1)").run(store.entity_id);
  sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,'fina-ea','2026-01-01','2099-01-01')").run(await hashCredential('fina-ea'));
  env = { DB: { prepare: sql => new Statement(sql) } };
});
after(() => sqlite?.close());

test('rute H2 menolak tanpa login, gerai Admin lain dan entity lain; Admin tanpa param mengikuti sesi', async () => {
  assert.equal((await call('kosong?store=' + store.code, 'salah')).status, 401);
  assert.equal((await call('kosong?store=' + other.code, 'fina-admin')).status, 403);
  assert.equal((await call('kosong?store=' + alien.code, 'fina-ea')).status, 403);
  const own = await call('kosong', 'fina-admin');
  assert.equal(own.status, 200);
  assert.equal((await own.json()).store.id, store.id);
  assert.equal((await call('kosong?store=' + store.code, 'fina-owner', 'POST')).status, 405);
});
test('index merutekan H2, keluaran tanpa kontak, dan membaca tidak memotong gaji/menulis DB', async () => {
  const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
  const r = await worker.fetch(request('/api/admin/fina/kosong?store=' + store.code + '&date=2026-10-21'), env, { waitUntil() {} });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.store.id, store.id);
  assert.equal(data.date, '2026-10-21');
  assert.ok(Array.isArray(data.shifts));
  assert.equal(JSON.stringify(data).includes('address'), false);
  assert.equal(JSON.stringify(data).includes('phone'), false);
  assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n, before);
});
test('pengaturan gerai menimpa entity dan H1 yang belum lengkap gagal tertutup tanpa konstanta H2', async () => {
  sqlite.prepare("INSERT INTO hr_settings VALUES(?,?,120,NULL)").run(store.entity_id,store.id);
  try {
    const data = await (await call('kosong?store=' + store.code)).json();
    assert.equal(data.deteksiMenit, 120);
    assert.equal(data.shifts.some(s => s.accountId === 'fina-asli'), false);
  } finally { sqlite.prepare('DELETE FROM hr_settings WHERE store_id=?').run(store.id); }
  sqlite.prepare('UPDATE hr_settings SET deteksi_kosong_menit=NULL WHERE entity_id=?').run(store.entity_id);
  try { assert.equal((await call('kosong?store=' + store.code)).status, 503); }
  finally { sqlite.prepare('UPDATE hr_settings SET deteksi_kosong_menit=10 WHERE entity_id=?').run(store.entity_id); }
});
test('freelance lintas entity dibatasi server, Admin hanya kandidat gerainya, aktivasi gerai lain tidak tersedia', async () => {
  const suffix = 'freelance?store=' + store.code + '&date=2026-10-21&from=14:00&to=22:00';
  const ea = await (await call(suffix, 'fina-ea')).json();
  assert.ok(ea.candidates.some(c => c.accountId === 'fina-away'));
  const admin = await (await call(suffix, 'fina-admin')).json();
  assert.ok(admin.candidates.every(c => c.storeId === store.id));
  sqlite.prepare("INSERT INTO account_daily_activations(id,account_type,account_id,business_date,store_id,activated_by_role,activated_by_id) VALUES('fina-act','CASHIER','fina-away','2026-10-21',?,'OWNER','test')").run(other.id);
  try { assert.equal((await (await call(suffix, 'fina-ea')).json()).candidates.some(c => c.accountId === 'fina-away'), false); }
  finally { sqlite.prepare("DELETE FROM account_daily_activations WHERE id='fina-act'").run(); }
});
test('tanggal palsu, rentang berlebih dan jam salah ditolak, rekap memakai jadwal Rabu dan tanpa perubahan data', async () => {
  for (const suffix of ['kosong?date=2026-02-30','masalah?from=2026-01-01&to=2026-03-01','masalah?from=2026-10-22&to=2026-10-21','freelance?from=99:00&to=18:00']) {
    assert.equal((await call(suffix + '&store=' + store.code)).status, 400, suffix);
  }
  sqlite.prepare("INSERT INTO staff_attendance(id,user_id,store_id,attendance_type,photo_blob,photo_type,created_at,status,check_out_at,auto_closed) VALUES('fina-att','fina-asli',?,'in',x'00','image/jpeg','2026-10-21T02:15:00.000Z','CLOSED','2026-10-21T09:30:00.000Z',1)").run(store.id);
  try {
    const before = sqlite.prepare('SELECT total_changes() AS n').get().n;
    const r = await call('masalah?store=' + store.code + '&from=2026-10-21&to=2026-10-21');
    assert.equal(r.status, 200);
    const cs = (await r.json()).employees.find(e => e.accountId === 'fina-asli');
    assert.equal(cs.telatMenit, 15); assert.equal(cs.lupaPulang, 1); assert.equal(cs.pulangAwalMenit, 0);
    assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n, before);
  } finally { sqlite.prepare("DELETE FROM staff_attendance WHERE id='fina-att'").run(); }
});
test('alat H2 selalu baca, tanpa posting; jam ucapan diparsing kode dan katalog menerima HH:MM', () => {
  assert.equal(AKSI_FINA_BACA.length, 3);
  assert.ok(AKSI_FINA_BACA.every(a => a.baca === true && !a.posting));
  const t = daftarFreelanceTersedia.isiDariPesan({}, 'siapa bisa backup jam 14–22 di Beji?');
  assert.equal(t.fh_jam_dari, '14:00'); assert.equal(t.fh_jam_sampai, '22:00');
  assert.equal(bangunAlamat(cariApi('fina_freelance'), [{ kunci: 'from', nilai: '14:00' },{ kunci: 'to', nilai: '22:00' }]).ok, true);
  assert.equal(bangunAlamat(cariApi('fina_freelance'), [{ kunci: 'from', nilai: '25:00' }]).ok, false);
});
test('alat benar-benar melewati pembaca aman katalog dengan auth gerai dan tidak menyelundupkan store', async () => {
  const jalur = bangunJalurAksi(request('/api/caca/tanya'), env, { storeCode: store.code,
    jalurUtama: r => handleFinaApi(r, env, new URL(r.url).pathname, { now: NOW }) });
  const ctx = { ...jalur, lingkup: 'gerai', hariIni: '2026-10-21', namaLingkup: store.code };
  const r = await cariGeraiKosong.siapkan({}, ctx);
  assert.equal(r.ok, true); assert.ok(r.tabel.isi.some(row => row[1] === 'fina-asli')); assert.ok(!r.draft);
  const f = await daftarFreelanceTersedia.siapkan({ fh_jam_dari: '14:00', fh_jam_sampai: '22:00' }, ctx);
  assert.equal(f.ok, true); assert.ok(f.tabel.isi.some(row => row[0] === 'fina-free'));
  assert.equal((await cariGeraiKosong.siapkan({ fh_gerai: other.code }, ctx)).ok, false);
});
test('gagal baca satu gerai tidak disimpulkan aman; periode rekap dihitung kode dan hasil dibersihkan', async () => {
  let called;
  const ctx = { lingkup: 'entity', hariIni: '2026-10-21',
    baca: async () => ({ ok: true, data: { stores: [{ code: 'A', isActive: true }, { code: 'B', isActive: true }] } }),
    jalurGerai: code => ({ baca: async path => { called=path; return code==='B' ? { ok: false, error: 'kuota' } : { ok: true, data: { shifts: [], employees: [] } }; } }) };
  assert.equal((await cariGeraiKosong.siapkan({}, ctx)).ok, false);
  assert.equal((await daftarFreelanceTersedia.siapkan({ fh_jam_dari:'14:00', fh_jam_sampai:'22:00' },ctx)).kurang,'fh_gerai');
  const one = { ...ctx, lingkup: 'gerai', baca: async path => {called=path; return { ok:true, data:{ employees:[], phone:'08123456789', address:'pribadi' } }; } };
  const r=await rekapMasalahCs.siapkan({},one);
  assert.match(called,/from=2026-10-15/); assert.match(called,/to=2026-10-21/);
  assert.equal(r.ok,true); assert.equal(JSON.stringify(r).includes('08123456789'),false);
  const entityResult=await rekapMasalahCs.siapkan({}, { ...ctx, jalurGerai: () => ({ baca: async () => ({ok:true,data:{employees:[]}}) }) });
  assert.equal(entityResult.ok,true);
  assert.equal(entityResult.tawaran[0].layar,'settings');
  assert.equal(entityResult.tawaran[0].halaman,'entity');
  const { LAYAR } = await import('../src/caca-jelaskan.js');
  assert.equal(LAYAR[entityResult.tawaran[0].layar].halaman,'entity');
  assert.equal(LAYAR['attendance-report'].halaman,'gerai');
});

test('lebih dari 100 akun tetap dapat dibaca melalui batch D1 dan kandidat tidak terpotong diam-diam', async () => {
  sqlite.exec('SAVEPOINT fina_bulk');
  try {
    const insert = sqlite.prepare("INSERT INTO cashiers(id,username,password_hash,employee_name,store_id,is_active,is_entity_backup) VALUES(?,?,'x',?,?,1,1)");
    for (let i=0;i<121;i++) insert.run('fina-bulk-'+i,'fina-bulk-'+i,'Bulk '+i,store.id);
    const r=await call('freelance?store='+store.code+'&date=2026-10-21&from=14:00&to=22:00','fina-ea');
    assert.equal(r.status,200);
    assert.equal((await r.json()).candidates.filter(c=>c.accountId.startsWith('fina-bulk-')).length,121);
  } finally { sqlite.exec('ROLLBACK TO fina_bulk; RELEASE fina_bulk'); }
});
test('kamus Fina cocok tiga kalimat berbeda dan tag persona dapat menyaringnya', async () => {
  const { KAMUS } = await import('../src/caca-jelaskan.js');
  const { peringkatKamus } = await import('../src/kerangka/kamus.js');
  const { normalkan } = await import('../src/caca-aksi-dasar.js');
  const { kataInti } = await import('../src/caca-kata.js');
  for (const pesan of ['apa itu gerai kosong','cara melihat freelance tersedia','cara rekap masalah cs']) {
    const result=peringkatKamus(pesan,KAMUS,{ normalisasi:normalkan,kata:kataInti,konteks:{agen:'fina'} });
    assert.equal(result[0].entri.id,'fina_baca',pesan);
  }
  assert.equal(peringkatKamus('gerai kosong',KAMUS,{ normalisasi:normalkan,kata:kataInti,konteks:{agen:'una'} }).some(r=>r.entri.id==='fina_baca'),false);
});

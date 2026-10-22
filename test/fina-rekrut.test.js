import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { bangunJalurAksi, PINTU_AKSI } from '../src/caca-chat.js';
import { periksaUlangDraft } from '../src/caca-aksi.js';
import { KATALOG } from '../src/caca-baca-katalog.js';
import { PERSONA, bolehAlat } from '../src/agen-persona.js';
import { draftLoker, susunTeksLoker } from '../src/agen-fina-tulis.js';
import { normalkanNoWa, BATAS_LAMARAN } from '../src/fina-rekrut.js';

// Paket H4 (contracts/fina-hr-paket-v1.md): lowongan + pelamar + halaman loker publik + draft_loker.

let sqlite, env, store;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  run() { return { success: true, meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes || 0) } }; }
}
const req = (path, { token = 'h4-ea', method = 'GET', body, ip = '1.1.1.1' } = {}) => new Request('https://test.invalid' + path, {
  method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json', 'cf-connecting-ip': ip }, ...(body ? { body: JSON.stringify(body) } : {})
});
const call = async (path, opsi) => { const r = await worker.fetch(req(path, opsi), env, { waitUntil() {} }); return { status: r.status, body: await r.json() }; };

before(async () => {
  sqlite = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
  store = sqlite.prepare("SELECT * FROM stores WHERE id='store_beji'").get();
  sqlite.prepare("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name,is_active) VALUES('h4-ea',?,'h4-ea','x','EA',1), ('h4-ea-lain','ENT-G001','h4-ea-lain','x','EA2',1)").run(store.entity_id);
  for (const id of ['h4-ea', 'h4-ea-lain']) sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01','2099-01-01')").run(await hashCredential(id), id);
  sqlite.prepare("INSERT INTO store_admins(id,username,password_hash,display_name,store_id,is_active) VALUES('h4-admin','h4-admin','x','Admin',?,1)").run(store.id);
  sqlite.prepare("INSERT INTO store_admin_sessions(token_hash,admin_id,created_at,expires_at) VALUES(?,'h4-admin','2026-01-01','2099-01-01')").run(await hashCredential('h4-admin'));
  env = { DB: { prepare: sql => new Statement(sql), batch: async ss => ss.map(s => s.run()) } };
});
after(() => sqlite?.close());

test('nomor WA dinormalkan; teks loker dari templat tanpa mengarang gaji', () => {
  assert.equal(normalkanNoWa('0812-3456-7890'), '6281234567890');
  assert.equal(normalkanNoWa('+62 812 3456 7890'), '6281234567890');
  assert.equal(normalkanNoWa('812345678'), '62812345678');
  assert.equal(normalkanNoWa('12345'), null);
  assert.equal(normalkanNoWa('0812abc'), null);
  const t = susunTeksLoker({ usaha: '', gerai: 'BEJI', posisi: 'CS', jamKerja: '', gajiTeks: '', syarat: 'jujur; rajin', deskripsi: '' });
  assert.match(t.loker, /- jujur\n- rajin/);
  assert.doesNotMatch(t.loker + t.caption, /Gaji/);
});

test('draft_loker: hanya Fina, membuat lowongan DRAFT; agen tidak bisa menayangkan atau membaca pelamar', async () => {
  assert.equal(bolehAlat(PERSONA.fina, 'draft_loker'), true);
  assert.equal(bolehAlat(PERSONA.rika, 'draft_loker'), false);
  const ctx = { ...bangunJalurAksi(req('/api/caca/tanya'), env, { storeCode: store.code, jalurUtama: r => worker.fetch(r, env, { waitUntil() {} }) }),
    lingkup: 'gerai', hariIni: '2026-10-21', namaLingkup: store.store_name, storeCode: store.code };
  const t = { lk_posisi: 'CS shift pagi', lk_jam: '07.00-15.00', lk_syarat: 'jujur; bisa HP' };
  const r = await draftLoker.siapkan(t, ctx);
  assert.equal(r.ok, true);
  const cek = await periksaUlangDraft({ ...r.draft, tangkapan: t }, ctx);
  assert.equal(cek.ok, true, JSON.stringify(cek));
  const hasil = await draftLoker.posting(cek.draft, ctx);
  assert.equal(hasil.ok, true, JSON.stringify(hasil));
  const row = sqlite.prepare("SELECT * FROM hr_lowongan WHERE posisi='CS shift pagi'").get();
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.store_id, store.id);
  const dicoba = await ctx.kirim('PATCH', `/api/entity-admin/fina/lowongan/${row.id}`, { status: 'TAYANG' });
  assert.equal(dicoba.ok, false, 'agen tidak punya pintu PATCH lowongan');
  assert.equal(sqlite.prepare('SELECT status FROM hr_lowongan WHERE id=?').get(row.id).status, 'DRAFT');
  assert.equal((await ctx.baca('/api/entity-admin/fina/pelamar')).ok, false, 'agen tidak bisa membaca pelamar');
  // Nomor HP tidak pernah sampai ke model: tidak ada katalog/pintu baca ke data pelamar.
  assert.ok(!KATALOG.some(k => /pelamar|lamaran/.test(k.path)));
  // Pintu agen yang menyebut pelamar hanya rute khusus alat WA Fina tanpa nomor lengkap (diuji di
  // test/fina-wa.test.js); data pelamar lengkap dan lamaran publik tidak pernah jadi pintu agen.
  const pintuPelamar = PINTU_AKSI.filter(p => /pelamar|lamaran/.test(p));
  assert.deepEqual(pintuPelamar, ['/api/entity-admin/fina/wa/calon-pelamar$', '/api/entity-admin/fina/wa/jadikan-pelamar$', '/api/entity-admin/fina/wa/pelamar-ringkas$']);
  assert.ok(!PINTU_AKSI.some(p => /fina\/pelamar|publik\/lamaran|fina\/wa\/masuk/.test(p)));
});

test('loker publik: hanya TAYANG, tanpa data internal; entity lain tidak melihat lowongan', async () => {
  const buat = await call('/api/entity-admin/fina/lowongan', { method: 'POST', body: { posisi: 'Kasir malam', storeId: store.id, gajiTeks: 'Rp1,6 jt', syarat: 'jujur' } });
  assert.equal(buat.status, 201);
  const slug = buat.body.slug;
  assert.equal((await call(`/api/publik/loker/${slug}`, { token: null })).status, 404, 'draft belum tayang');
  assert.equal((await call(`/api/entity-admin/fina/lowongan/${buat.body.id}`, { token: 'h4-admin', method: 'PATCH', body: { status: 'TAYANG' } })).status, 401, 'Admin gerai tidak boleh');
  assert.equal((await call(`/api/entity-admin/fina/lowongan/${buat.body.id}`, { token: 'h4-ea-lain', method: 'PATCH', body: { status: 'TAYANG' } })).status, 404, 'entity lain');
  assert.equal((await call(`/api/entity-admin/fina/lowongan/${buat.body.id}`, { method: 'PATCH', body: { status: 'TAYANG' } })).status, 200);
  const pub = await call(`/api/publik/loker/${slug}`, { token: null });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.loker.posisi, 'Kasir malam');
  const teks = JSON.stringify(pub.body);
  for (const internal of ['entity', 'store_', 'lowongan_', 'ENT-', 'dibuat', 'pelamar']) assert.ok(!teks.includes(internal), internal);
  assert.equal((await call('/api/entity-admin/fina/lowongan', { token: 'h4-ea-lain' })).body.lowongan.length, 0);
});

test('lamaran publik: honeypot, validasi, batas per nomor/hari dan per IP/jam; status hanya diubah admin', async () => {
  const buat = await call('/api/entity-admin/fina/lowongan', { method: 'POST', body: { posisi: 'CS sore' } });
  await call(`/api/entity-admin/fina/lowongan/${buat.body.id}`, { method: 'PATCH', body: { status: 'TAYANG' } });
  const slug = buat.body.slug;
  const lamar = (body, ip = '2.2.2.2') => call('/api/publik/lamaran', { token: null, method: 'POST', body: { slug, ...body }, ip });
  const sebelum = sqlite.prepare('SELECT COUNT(*) AS n FROM hr_pelamar').get().n;
  assert.equal((await lamar({ nama: 'Robot', noWa: '081234567890', website: 'http://spam' })).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM hr_pelamar').get().n, sebelum, 'honeypot tidak disimpan');
  assert.equal((await lamar({ nama: 'Sari', noWa: '123' })).status, 400);
  assert.equal((await lamar({ nama: 'Sari', noWa: '081234567890', umur: 9 })).status, 400);
  assert.equal((await lamar({ nama: 'x'.repeat(81), noWa: '081234567890' })).status, 400, 'panjang dibatasi');
  const ok = await lamar({ nama: 'Sari', noWa: '0812-3456-7890', umur: '21', domisili: 'Batu', pengalaman: 'Jaga toko 1 th' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await lamar({ nama: 'Sari lagi', noWa: '+6281234567890' }, '3.3.3.3')).status, 429, 'satu nomor satu lamaran per hari per lowongan');
  for (let i = 0; i < BATAS_LAMARAN.perIpPerJam - 1; i += 1) assert.equal((await lamar({ nama: `Orang ${i}`, noWa: `08129999000${i}` })).status, 201);
  assert.equal((await lamar({ nama: 'Orang lebih', noWa: '081288887777' })).status, 429, 'batas per IP per jam');
  await call(`/api/entity-admin/fina/lowongan/${buat.body.id}`, { method: 'PATCH', body: { status: 'TUTUP' } });
  assert.equal((await lamar({ nama: 'Telat', noWa: '081277776666' }, '4.4.4.4')).status, 404, 'lowongan tutup');

  const daftar = await call(`/api/entity-admin/fina/pelamar?lowongan=${buat.body.id}`);
  const sari = daftar.body.pelamar.find(p => p.nama === 'Sari');
  assert.equal(sari.noWa, '6281234567890');
  assert.equal(sari.status, 'BARU');
  assert.equal((await call(`/api/entity-admin/fina/pelamar/${sari.id}`, { method: 'PATCH', body: { status: 'LULUS' } })).status, 400);
  assert.equal((await call(`/api/entity-admin/fina/pelamar/${sari.id}`, { token: 'h4-ea-lain', method: 'PATCH', body: { status: 'DITOLAK' } })).status, 404);
  assert.equal((await call(`/api/entity-admin/fina/pelamar/${sari.id}`, { method: 'PATCH', body: { status: 'DITERIMA', catatan: 'Interview oke' } })).status, 200);
  assert.equal(sqlite.prepare('SELECT status FROM hr_pelamar WHERE id=?').get(sari.id).status, 'DITERIMA');
  assert.equal((await call('/api/entity-admin/fina/pelamar', { token: 'h4-ea-lain' })).body.pelamar.length, 0, 'entity lain tidak melihat pelamar');
});

test('halaman loker publik ringan: tanpa pustaka luar, honeypot tersembunyi, memakai API publik', () => {
  const html = readFileSync(new URL('../public/loker.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/loker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html + js, /(?:src|href)\s*=\s*["']https?:\/\//i);
  assert.match(html, /name="website"[^>]*tabindex="-1"/);
  assert.match(js, /\/api\/publik\/loker\//);
  assert.match(js, /\/api\/publik\/lamaran/);
});

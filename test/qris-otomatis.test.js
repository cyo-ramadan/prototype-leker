import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import { handleQrisApi, bacaNominal, bacaNotifikasi } from '../src/qris-otomatis.js';
import { hashCredential } from '../src/owner-auth.js';

// QRIS Otomatis (Bos Cyo, 2026-10-16): uang QRIS masuk diteruskan dari HP penerima pemilik,
// berbunyi di kasir, dan setiap penjualan QRIS harus tertaut ke tepat satu uang masuk.
// CS tidak bisa membuat uang masuk sendiri -- jadi orderan QRIS karangan tetap "Belum tertaut".

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() {
            const result = statement.run(...args);
            return { ...result, success: true, meta: { changes: result.changes } };
          }
        };
      }
    };
  }
  return {
    prepare: prepared,
    async batch(bound) {
      return bound.map(item => {
        const result = item._statement.run(...item._args);
        return { success: true, meta: { changes: result.changes } };
      });
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

async function session(sqlite, table, column, id, token) {
  sqlite.prepare(`INSERT INTO ${table} (token_hash, ${column}, created_at, expires_at) VALUES (?, ?, '2026-10-16T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return token;
}

async function fixture() {
  const sqlite = freshDatabase();
  const env = { DB: d1(sqlite) };
  const owner = sqlite.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at) VALUES ('drawer_qris', 'store_pendem', 'cashier_pendem_pilot', 'OPEN', ?)`)
    .run(new Date().toISOString());
  return {
    sqlite,
    env,
    kasir: await session(sqlite, 'cashier_sessions', 'cashier_id', 'cashier_pendem_pilot', 'qr-kasir'),
    admin: await session(sqlite, 'store_admin_sessions', 'admin_id', 'admin_pendem_pilot', 'qr-admin'),
    owner: await session(sqlite, 'owner_sessions', 'owner_id', owner.id, 'qr-owner')
  };
}

async function call(env, pathname, { token, method = 'GET', body, store = 'PENDEM', query = {} } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await handleQrisApi(new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), env, pathname);
  return { status: response.status, body: await response.json() };
}

function addSale(sqlite, { id, amount, method = 'BANK', at = new Date() }) {
  sqlite.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at, payment_method)
    VALUES (?, 'store_pendem', 'drawer_qris', 'cashier_pendem_pilot', ?, ?, ?)`).run(id, amount, new Date(at).toISOString(), method);
}

async function siapkan(f, { semuaGerai = false } = {}) {
  assert.equal((await call(f.env, '/api/qris/setelan', { token: f.admin, method: 'PUT', body: { paymentMethodCode: 'BANK', kataKunci: 'LEKER PENDEM' } })).status, 200);
  const created = await call(f.env, '/api/qris/penerima', { token: semuaGerai ? f.owner : f.admin, method: 'POST', body: { label: 'HP Bos', semuaGerai } });
  assert.equal(created.status, 201);
  assert.match(created.body.token, /^qr_[a-f0-9]{48}$/);
  return created.body.token;
}

const kirim = (f, token, payload) => call(f.env, '/api/qris/masuk', { store: null, method: 'POST', body: payload, query: { token } });

// Saklar qris_tautan_sistem OFF: CS menautkan sendiri penjualan QRIS ke uang masuk (perilaku sebelum 2026-10-19).
function tautanCs(f) {
  const tenant = f.sqlite.prepare(`SELECT tenant_id FROM entity_tenancy WHERE entity_id = 'ENT-KPM' AND effective_to IS NULL`).get();
  f.sqlite.prepare(`INSERT OR REPLACE INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_at) VALUES (?, 'qris_tautan_sistem', '0', '2026-10-19T00:00:00Z')`).run(tenant.tenant_id);
}

// Mode lama (kolam bersama OFF): uang masuk langsung ke gerai dan berbunyi di kasirnya.
function kolamMati(f) {
  const tenant = f.sqlite.prepare(`SELECT tenant_id FROM entity_tenancy WHERE entity_id = 'ENT-KPM' AND effective_to IS NULL`).get();
  f.sqlite.prepare(`INSERT OR REPLACE INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_at) VALUES (?, 'qris_kolam_bersama', '0', '2026-10-17T00:00:00Z')`).run(tenant.tenant_id);
}

test('membaca nominal dan arah notifikasi merchant', () => {
  assert.equal(bacaNominal('Pembayaran QRIS Rp 15.000 berhasil diterima'), 15000);
  assert.equal(bacaNominal('Kamu menerima Rp15.000,00 dari pelanggan'), 15000);
  assert.equal(bacaNominal('Received IDR 1,250,000.00'), 1250000);
  assert.equal(bacaNominal('Rp2500.'), 2500);
  assert.equal(bacaNominal('tanpa nominal'), null);
  assert.equal(bacaNotifikasi({ text: 'QRIS Rp 15.000 diterima' }).amount, 15000);
  assert.equal(bacaNotifikasi({ text: 'Refund Rp 15.000 berhasil' }).ok, false);
  assert.equal(bacaNotifikasi({ text: 'Penarikan saldo Rp 500.000 berhasil' }).ok, false);
});

test('notif dari HP penerima tercatat, berbunyi di kasir, dan menaut otomatis bila tidak ragu', async () => {
  const f = await fixture();
  kolamMati(f);
  const token = await siapkan(f);
  addSale(f.sqlite, { id: 'sale_a', amount: 15000 });

  const masuk = await kirim(f, token, { app: 'com.gojek.gobiz', title: 'GoBiz', text: 'Pembayaran QRIS Rp 15.000 berhasil diterima' });
  assert.equal(masuk.status, 201);
  assert.equal(masuk.body.storeCode, 'PENDEM');
  assert.equal(masuk.body.tertaut, true);

  const notif = f.sqlite.prepare(`SELECT title, kind FROM management_notifications WHERE recipient_key = 'CASHIER:cashier_pendem_pilot'`).all();
  assert.equal(notif.length, 1);
  assert.equal(notif[0].kind, 'QRIS_MASUK');
  assert.match(notif[0].title, /Rp15\.000/);

  // Aplikasi penerus mengirim ulang notifikasi yang sama -> tidak dobel.
  const ulang = await kirim(f, token, { app: 'com.gojek.gobiz', title: 'GoBiz', text: 'Pembayaran QRIS Rp 15.000 berhasil diterima' });
  assert.equal(ulang.body.duplicate, true);

  const list = await call(f.env, '/api/qris', { token: f.kasir });
  assert.equal(list.status, 200);
  assert.equal(list.body.sales[0].masukId, masuk.body.id);
  assert.equal(list.body.sales[0].linkMode, 'OTOMATIS');
  assert.equal(list.body.ringkas.penjualanBelum, 0);
});

test('dua pembeli bernominal sama tidak ditebak; CS memilih, satu uang masuk hanya untuk satu penjualan', async () => {
  const f = await fixture();
  tautanCs(f);
  const token = await siapkan(f);
  addSale(f.sqlite, { id: 'sale_1', amount: 20000 });
  addSale(f.sqlite, { id: 'sale_2', amount: 20000 });
  addSale(f.sqlite, { id: 'sale_karangan', amount: 30000 });
  const a = await kirim(f, token, { text: 'QRIS Rp20.000 diterima', ref: 'trx-1' });
  const b = await kirim(f, token, { text: 'QRIS Rp20.000 diterima', ref: 'trx-2' });
  assert.equal(a.body.tertaut, false);
  assert.equal(b.body.tertaut, false);
  assert.equal((await kirim(f, token, { text: 'QRIS Rp20.000 diterima', ref: 'trx-1' })).body.duplicate, true);

  let list = await call(f.env, '/api/qris', { token: f.kasir });
  assert.equal(list.body.ringkas.penjualanBelum, 3);
  assert.equal(list.body.pilihan.length, 2);

  assert.equal((await call(f.env, '/api/qris/tautkan', { token: f.kasir, method: 'POST', body: { masukId: a.body.id, saleId: 'sale_1' } })).status, 200);
  const dobel = await call(f.env, '/api/qris/tautkan', { token: f.kasir, method: 'POST', body: { masukId: a.body.id, saleId: 'sale_2' } });
  assert.equal(dobel.status, 409);
  assert.equal(dobel.body.code, 'QRIS_SUDAH_DIPAKAI');

  // Orderan QRIS Rp30.000 tanpa uang masuk: CS tidak bisa menautkan nominal lain, tidak bisa menambah uang masuk.
  const beda = await call(f.env, '/api/qris/tautkan', { token: f.kasir, method: 'POST', body: { masukId: b.body.id, saleId: 'sale_karangan' } });
  assert.equal(beda.body.code, 'QRIS_NOMINAL_BEDA');
  assert.equal((await call(f.env, '/api/qris/manual', { token: f.kasir, method: 'POST', body: { amount: 30000, catatan: 'x' } })).status, 403);

  // Setelah pembeli pertama dipilih CS, sisa pasangan Rp20.000 tidak ragu lagi -> tertaut sendiri.
  list = await call(f.env, '/api/qris', { token: f.kasir });
  assert.equal(list.body.sales.find(sale => sale.id === 'sale_2').linkMode, 'OTOMATIS');
  assert.equal(list.body.ringkas.penjualanBelum, 1);
  assert.equal(list.body.sales.find(sale => sale.id === 'sale_karangan').masukId, null);
});

test('admin: tambah manual wajib catatan, abaikan & lepas; kasir tidak bisa', async () => {
  const f = await fixture();
  await siapkan(f);
  addSale(f.sqlite, { id: 'sale_m', amount: 12000 });
  assert.equal((await call(f.env, '/api/qris/manual', { token: f.admin, method: 'POST', body: { amount: 12000 } })).body.code, 'QRIS_CATATAN_WAJIB');
  const manual = await call(f.env, '/api/qris/manual', { token: f.admin, method: 'POST', body: { amount: 12000, catatan: 'Dicek di mutasi BRI 14:05' } });
  assert.equal(manual.status, 201);
  let list = await call(f.env, '/api/qris', { token: f.admin });
  assert.equal(list.body.sales[0].masukId, manual.body.id);

  assert.equal((await call(f.env, '/api/qris/lepas', { token: f.kasir, method: 'POST', body: { masukId: manual.body.id, catatan: 'x' } })).status, 403);
  assert.equal((await call(f.env, '/api/qris/lepas', { token: f.admin, method: 'POST', body: { masukId: manual.body.id, catatan: 'salah tautan' } })).status, 200);
  assert.equal((await call(f.env, '/api/qris/abaikan', { token: f.admin, method: 'POST', body: { masukId: manual.body.id, catatan: 'uji coba' } })).status, 200);
  list = await call(f.env, '/api/qris', { token: f.admin });
  assert.equal(list.body.masuk[0].status, 'DIABAIKAN');
  assert.equal(list.body.ringkas.penjualanBelum, 1);
});

test('penerima semua gerai menebak gerai dari kata kunci; tak dikenal masuk antrean Entity', async () => {
  const f = await fixture();
  const token = await siapkan(f, { semuaGerai: true });
  const kenal = await kirim(f, token, { text: 'LEKER PENDEM menerima pembayaran QRIS Rp 8.000' });
  assert.equal(kenal.body.storeCode, 'PENDEM');
  const asing = await kirim(f, token, { text: 'TOKO LAIN menerima pembayaran QRIS Rp 9.000' });
  assert.equal(asing.body.storeCode, null);
  const ringkas = await call(f.env, '/api/qris/ringkasan', { token: f.owner });
  assert.equal(ringkas.body.tanpaGerai, 1);
  const list = await call(f.env, '/api/qris', { token: f.owner });
  assert.equal(list.body.tanpaGerai.length, 1);
  assert.equal((await call(f.env, '/api/qris/pindah-gerai', { token: f.owner, method: 'POST', body: { masukId: asing.body.id, storeCode: 'PENDEM', catatan: 'GoBiz gerai Pendem' } })).status, 200);
  // Admin gerai tidak boleh membuat penerima semua gerai.
  assert.equal((await call(f.env, '/api/qris/penerima', { token: f.admin, method: 'POST', body: { semuaGerai: true } })).status, 403);
});

test('token salah/dicabut ditolak, notif bukan uang masuk diabaikan, saklar tenant mati = 403', async () => {
  const f = await fixture();
  const token = await siapkan(f);
  assert.equal((await kirim(f, 'qr_' + '0'.repeat(48), { text: 'QRIS Rp 1.000 diterima' })).status, 401);
  const refund = await kirim(f, token, { text: 'Refund QRIS Rp 5.000 berhasil' });
  assert.equal(refund.body.ignored, true);
  const tes = await kirim(f, token, { text: 'tes' });
  assert.equal(tes.body.test, true);
  const setelan = await call(f.env, '/api/qris/setelan', { token: f.admin });
  assert.match(setelan.body.penerima[0].lastResult, /Tes sambungan/);

  const tenant = f.sqlite.prepare(`SELECT tenant_id FROM entity_tenancy WHERE entity_id = 'ENT-KPM' AND effective_to IS NULL`).get();
  f.sqlite.prepare(`INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_at) VALUES (?, 'qris_otomatis', '0', '2026-10-16T00:00:00Z')`).run(tenant.tenant_id);
  assert.equal((await kirim(f, token, { text: 'QRIS Rp 1.000 diterima' })).status, 403);
  assert.equal((await call(f.env, '/api/qris/ringkasan', { token: f.kasir })).body.enabled, false);

  f.sqlite.prepare(`DELETE FROM tenant_policy_settings WHERE setting_key = 'qris_otomatis'`).run();
  const id = setelan.body.penerima[0].id;
  assert.equal((await call(f.env, '/api/qris/penerima/cabut', { token: f.admin, method: 'POST', body: { id } })).status, 200);
  assert.equal((await kirim(f, token, { text: 'QRIS Rp 1.000 diterima' })).status, 401);
});

test('merchantBCA: jam transaksi & RRN dibaca dari teks, notif telat 6 jam tetap tertaut dan tidak dobel', async () => {
  const { bacaWaktu, bacaRef } = await import('../src/qris-otomatis.js');
  const now = new Date('2026-10-17T07:32:00.000Z'); // 14:32 WIB
  assert.equal(bacaWaktu('17 Okt 2026 08:31:48 WIB', now).toISOString(), '2026-10-17T01:31:48.000Z');
  assert.equal(bacaWaktu('17/10/2026 08:31', now).toISOString(), '2026-10-17T01:31:00.000Z');
  assert.equal(bacaWaktu('pukul 08:31:48 WIB', now).toISOString(), '2026-10-17T01:31:48.000Z');
  assert.equal(bacaWaktu('1 Jan 2020 08:00', now), null);
  assert.equal(bacaRef('Rp 1,00 RRN: 308862333'), '308862333');
  assert.equal(bacaNominal('Rp 1,00 17 Okt 2026 08:31:48'), 1);

  const f = await fixture();
  kolamMati(f);
  const token = await siapkan(f, { semuaGerai: true });
  f.sqlite.prepare(`UPDATE qris_gerai_setelan SET kata_kunci = 'TEH POCI BENDUNGAN' WHERE store_id = 'store_pendem'`).run();
  const sekarang = new Date();
  const transaksi = new Date(sekarang.getTime() - 6 * 3600_000);
  addSale(f.sqlite, { id: 'sale_bca', amount: 1, at: transaksi });
  const jam = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
    .format(transaksi).replace(/\./g, ':').replace(',', '');
  const teks = `Pembayaran QRIS diterima TEH POCI BENDUNGAN Rp 1,00 ${jam} WIB RRN: 308862333`;
  const masuk = await kirim(f, token, { title: 'merchantBCA', text: teks });
  assert.equal(masuk.status, 201, JSON.stringify(masuk.body));
  assert.equal(masuk.body.storeCode, 'PENDEM');
  assert.ok(masuk.body.terlambatMenit >= 350, String(masuk.body.terlambatMenit));
  assert.equal(masuk.body.tertaut, true);
  assert.equal((await kirim(f, token, { title: 'merchantBCA', text: teks })).body.duplicate, true);
  const notif = f.sqlite.prepare(`SELECT body FROM management_notifications WHERE recipient_key = 'CASHIER:cashier_pendem_pilot'`).get();
  assert.match(notif.body, /notif telat 6 jam/);
});

test('kolam bersama: semua kasir berlaci terbuka melihat, satu gerai mengklaim, gerai lain terkunci, batal klaim', async () => {
  const f = await fixture();
  const mandala = await session(f.sqlite, 'cashier_sessions', 'cashier_id', 'cashier_mandala_pilot', 'qr-kasir-mandala');
  const token = await siapkan(f, { semuaGerai: true });
  addSale(f.sqlite, { id: 'sale_pendem_dana', amount: 6000 });

  // Notif merchantBCA tanpa nama outlet -> masuk kolam, tanpa notifikasi ke kasir mana pun.
  const masuk = await kirim(f, token, { title: 'Merchant BCA', text: 'Anda telah menerima pembayaran QRIS sebesar Rp 6.000 dari DANA.' });
  assert.equal(masuk.status, 201);
  assert.equal(masuk.body.storeCode, null);
  assert.equal(masuk.body.kolam, true);
  assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM management_notifications WHERE kind = 'QRIS_MASUK'`).get().n, 0);

  // Laci Mandala belum dibuka -> belum boleh melihat kolam.
  assert.equal((await call(f.env, '/api/qris/kolam', { token: mandala, store: 'MANDALA' })).status, 403);
  f.sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at) VALUES ('drawer_mandala', 'store_mandala', 'cashier_mandala_pilot', 'OPEN', ?)`).run(new Date().toISOString());

  let kolamPendem = await call(f.env, '/api/qris/kolam', { token: f.kasir });
  assert.equal(kolamPendem.status, 200);
  assert.equal(kolamPendem.body.items.length, 1);
  assert.equal(kolamPendem.body.items[0].sumberBayar, 'DANA');
  assert.equal(kolamPendem.body.items[0].diklaim, false);
  assert.equal((await call(f.env, '/api/qris/ringkasan', { token: f.kasir })).body.kolamBelum, 1);

  // Pendem mengklaim -> langsung tertaut ke satu-satunya penjualan Rp6.000 Pendem.
  const k = await call(f.env, '/api/qris/klaim', { token: f.kasir, method: 'POST', body: { masukId: masuk.body.id } });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.tertaut, true);

  // Default disaring SQL: uang yang diklaim hilang; pilihan Semua/Sudah tetap bisa melihatnya.
  for (const query of [{}, { klaim: 'BELUM' }]) {
    const belum = await call(f.env, '/api/qris/kolam', { token: f.kasir, query });
    assert.equal(belum.body.klaim, 'BELUM');
    assert.deepEqual(belum.body.items, []);
  }
  const sudah = await call(f.env, '/api/qris/kolam', { token: f.kasir, query: { klaim: 'SUDAH' } });
  assert.deepEqual(sudah.body.items.map(item => item.id), [masuk.body.id]);
  assert.equal(sudah.body.items[0].diklaim, true);
  assert.equal((await call(f.env, '/api/qris/kolam', { token: f.kasir, query: { klaim: 'SALAH' } })).status, 400);

  // Mandala melihat "diklaim PENDEM" dan tidak bisa mengklaim / membatalkan.
  const kolamMandala = await call(f.env, '/api/qris/kolam', { token: mandala, store: 'MANDALA', query: { klaim: 'SEMUA' } });
  assert.equal(kolamMandala.body.items[0].storeCode, 'PENDEM');
  assert.equal(kolamMandala.body.items[0].bisaBatal, false);
  const rebut = await call(f.env, '/api/qris/klaim', { token: mandala, store: 'MANDALA', method: 'POST', body: { masukId: masuk.body.id } });
  assert.equal(rebut.status, 409);
  assert.match(rebut.body.error, /PENDEM/);
  assert.equal((await call(f.env, '/api/qris/batal-klaim', { token: mandala, store: 'MANDALA', method: 'POST', body: { masukId: masuk.body.id } })).status, 403);

  // Kepencet: Pendem membatalkan -> kembali ke kolam, tautan ikut lepas, penjualannya kuning lagi.
  assert.equal((await call(f.env, '/api/qris/batal-klaim', { token: f.kasir, method: 'POST', body: { masukId: masuk.body.id } })).status, 200);
  kolamPendem = await call(f.env, '/api/qris/kolam', { token: f.kasir });
  assert.equal(kolamPendem.body.items[0].diklaim, false);
  const harian = await call(f.env, '/api/qris', { token: f.kasir });
  assert.equal(harian.body.sales.find(sale => sale.id === 'sale_pendem_dana').masukId, null);

  // Sekarang Mandala boleh mengklaim (tanpa penjualan cocok -> belum tertaut).
  const m = await call(f.env, '/api/qris/klaim', { token: mandala, store: 'MANDALA', method: 'POST', body: { masukId: masuk.body.id } });
  assert.equal(m.status, 200);
  assert.equal(m.body.tertaut, false);
  // Admin membatalkan klaim gerai lain wajib catatan.
  assert.equal((await call(f.env, '/api/qris/batal-klaim', { token: f.owner, method: 'POST', body: { masukId: masuk.body.id } })).body.code, 'QRIS_CATATAN_WAJIB');
  assert.equal((await call(f.env, '/api/qris/batal-klaim', { token: f.owner, method: 'POST', body: { masukId: masuk.body.id, catatan: 'Mutasi: outlet Pendem' } })).status, 200);
});

test('migration 0165: cara bayar QRIS dibuat dari REKBER (akun & Rekening Bersama sama), idempoten, data lain tidak berubah', async () => {
  const { sqlite } = await fixture();
  const akun = sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = '1103'`).get();
  assert.ok(akun, 'akun 1103 Rekening Bersama gerai ada');
  sqlite.prepare(`INSERT INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default, creates_payable) VALUES ('pm_rekber_pendem', 'store_pendem', 'REKBER', 'Rekening Bersama Malang', ?, 1, 0, 0)`).run(akun.id);
  const sebelum = sqlite.prepare(`SELECT id, code, name, account_id, is_active, is_default FROM payment_methods ORDER BY id`).all();
  const sql = readFileSync(new URL('0165_cara_bayar_qris.sql', migrationDir), 'utf8');
  sqlite.exec(sql);
  sqlite.exec(sql);
  const qris = sqlite.prepare(`SELECT * FROM payment_methods WHERE store_id = 'store_pendem' AND code = 'QRIS'`).all();
  assert.equal(qris.length, 1);
  assert.equal(qris[0].account_id, akun.id);
  assert.equal(qris[0].is_default, 0);
  assert.equal(qris[0].creates_payable, 0);
  const sesudah = sqlite.prepare(`SELECT id, code, name, account_id, is_active, is_default FROM payment_methods WHERE code != 'QRIS' ORDER BY id`).all();
  assert.deepEqual(sesudah, sebelum);
  // Gerai tanpa REKBER tidak mendapat QRIS otomatis.
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM payment_methods WHERE code = 'QRIS'`).get().n, 1);
});

test('Penerus QRIS: notif tertahan saat offline tetap tercatat di jam notifikasi muncul (postedAt), id mencegah dobel', async () => {
  const f = await fixture();
  const token = await siapkan(f, { semuaGerai: true });
  const muncul = Date.now() - 2 * 3600_000;
  const kiriman = { app: 'com.bca.msb', title: 'Merchant BCA', text: 'Anda telah menerima pembayaran QRIS sebesar Rp 6.000 dari DANA.', postedAt: muncul, id: `0|com.bca.msb|-1536433262|null|10317|${muncul}` };
  const masuk = await kirim(f, token, kiriman);
  assert.equal(masuk.status, 201);
  assert.equal(masuk.body.waktu, new Date(muncul).toISOString());
  assert.ok(masuk.body.terlambatMenit >= 119);
  assert.equal((await kirim(f, token, kiriman)).body.duplicate, true);
  // postedAt yang tidak masuk akal diabaikan (pakai jam sekarang).
  const aneh = await kirim(f, token, { ...kiriman, id: 'lain', postedAt: 1 });
  assert.ok(Math.abs(new Date(aneh.body.waktu).getTime() - Date.now()) < 60_000);
});

test('menu Data: filter cara bayar, tombol QRIS merah/hijau, klaim+tautkan sekali ketuk dari baris penjualan', async () => {
  const { handleCashierDataApi } = await import('../src/cashier-data-explorer.js');
  const f = await fixture();
  tautanCs(f);
  const token = await siapkan(f, { semuaGerai: true });
  const mandala = await session(f.sqlite, 'cashier_sessions', 'cashier_id', 'cashier_mandala_pilot', 'qr-kasir-mandala-2');
  f.sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at) VALUES ('drawer_mandala2', 'store_mandala', 'cashier_mandala_pilot', 'OPEN', ?)`).run(new Date().toISOString());
  addSale(f.sqlite, { id: 'sale_qris_6k', amount: 6000 });
  addSale(f.sqlite, { id: 'sale_tunai', amount: 9000, method: 'CASH' });
  const data = async query => {
    const url = new URL('https://example.test/api/cashier/data/transactions');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await handleCashierDataApi(new Request(url, { headers: { Authorization: `Bearer ${f.kasir}` } }), f.env, url.pathname);
    return res.json();
  };
  const qrisSaja = await data({ filter: 'SALES', bayar: 'QRIS' });
  assert.deepEqual(qrisSaja.transactions.map(row => row.id), ['sale_qris_6k']);
  assert.deepEqual(qrisSaja.transactions[0].qris, { amount: 6000, tertaut: false, masukId: null, linkMode: null, diklaim: false });
  assert.deepEqual((await data({ filter: 'SALES', bayar: 'TUNAI' })).transactions.map(row => row.id), ['sale_tunai']);

  // Dua uang Rp6.000 di kolam. Pendem memilih salah satu dari baris penjualannya.
  const a = await kirim(f, token, { text: 'Anda telah menerima pembayaran QRIS sebesar Rp 6.000 dari DANA.', id: 'n1', postedAt: Date.now() });
  const b = await kirim(f, token, { text: 'Anda telah menerima pembayaran QRIS sebesar Rp 6.000 dari GOPAY.', id: 'n2', postedAt: Date.now() });
  const calon = await call(f.env, '/api/qris/kandidat', { token: f.kasir, query: { saleId: 'sale_qris_6k' } });
  assert.equal(calon.body.qris, true);
  assert.equal(calon.body.kandidat.length, 2);
  // Mandala sempat mengklaim uang "b" duluan -> Pendem ditolak untuk "b", berhasil untuk "a".
  assert.equal((await call(f.env, '/api/qris/klaim', { token: mandala, store: 'MANDALA', method: 'POST', body: { masukId: b.body.id } })).status, 200);
  const rebut = await call(f.env, '/api/qris/klaim-tautkan', { token: f.kasir, method: 'POST', body: { masukId: b.body.id, saleId: 'sale_qris_6k' } });
  assert.equal(rebut.status, 409);
  assert.match(rebut.body.error, /MANDALA/);
  const ok = await call(f.env, '/api/qris/klaim-tautkan', { token: f.kasir, method: 'POST', body: { masukId: a.body.id, saleId: 'sale_qris_6k' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const hijau = (await data({ filter: 'SALES', bayar: 'QRIS' })).transactions[0].qris;
  assert.equal(hijau.tertaut, true);
  assert.equal(hijau.masukId, a.body.id);
  // Penjualan tunai tidak punya tombol QRIS; uang "a" sekarang milik Pendem dan terkunci.
  assert.equal((await data({ filter: 'SALES', bayar: 'TUNAI' })).transactions[0].qris, undefined);
  const tautan = await call(f.env, '/api/qris/kandidat', { token: f.kasir, query: { saleId: 'sale_qris_6k' } });
  assert.equal(tautan.body.tautan.id, a.body.id);
  assert.equal(tautan.body.tautan.bisaBatal, true);
  // Nominal beda tidak bisa ditautkan CS -> klaim yang sempat terjadi dikembalikan ke kolam.
  addSale(f.sqlite, { id: 'sale_qris_7k', amount: 7000 });
  const c = await kirim(f, token, { text: 'Anda telah menerima pembayaran QRIS sebesar Rp 8.000 dari OVO.', id: 'n3', postedAt: Date.now() });
  const salah = await call(f.env, '/api/qris/klaim-tautkan', { token: f.kasir, method: 'POST', body: { masukId: c.body.id, saleId: 'sale_qris_7k' } });
  assert.equal(salah.body.code, 'QRIS_NOMINAL_BEDA');
  assert.equal(f.sqlite.prepare(`SELECT store_id FROM qris_masuk WHERE id = ?`).get(c.body.id).store_id, null);
});

test('pengumuman: angka merah per akun -- baru sampai tab dibuka, lalu nol', async () => {
  const { handleStaffAnnouncementApi } = await import('../src/staff-announcement.js');
  const f = await fixture();
  f.sqlite.prepare(`INSERT INTO announcements (id, entity_id, store_id, title, body, created_by, created_by_role, is_active, created_at) VALUES ('ann_qris', 'ENT-KPM', NULL, 'QRIS', 'isi', 'Bos', 'OWNER', 1, '2026-10-18 01:00:00')`).run();
  const panggil = async (path, method = 'GET') => {
    const res = await handleStaffAnnouncementApi(new Request(`https://x.test${path}`, { method, headers: { Authorization: `Bearer ${f.kasir}` }, body: method === 'POST' ? '{}' : undefined }), f.env, path);
    return res.json();
  };
  let daftar = await panggil('/api/staff/announcements');
  assert.ok(daftar.unread >= 1, "pengumuman baru terhitung (migration bisa menambah pengumuman lain)");
  assert.ok(daftar.announcements.find(a => a.id === "ann_qris").isNew);
  assert.equal((await panggil('/api/staff/announcements/seen', 'POST')).ok, true);
  daftar = await panggil('/api/staff/announcements');
  assert.equal(daftar.unread, 0);
  f.sqlite.prepare(`INSERT INTO announcements (id, entity_id, store_id, title, body, created_by, created_by_role, is_active, created_at) VALUES ('ann_baru', 'ENT-KPM', NULL, 'Baru', '', 'Bos', 'OWNER', 1, '2999-01-01 00:00:00')`).run();
  assert.equal((await panggil('/api/staff/announcements')).unread, 1);
});

test('penautan oleh sistem (bawaan): CS hanya mengklaim, tidak ada pemilih/tombol tautan, klaim asli tersimpan', async () => {
  const { handleCashierDataApi } = await import('../src/cashier-data-explorer.js');
  const f = await fixture();
  const token = await siapkan(f, { semuaGerai: true });
  addSale(f.sqlite, { id: 'sale_qris_6k', amount: 6000 });
  const a = await kirim(f, token, { text: 'Anda telah menerima pembayaran QRIS sebesar Rp 6.000 dari DANA.', id: 'n1', postedAt: Date.now() });
  assert.deepEqual((await call(f.env, '/api/qris/kandidat', { token: f.kasir, query: { saleId: 'sale_qris_6k' } })).body, { qris: true, tautanSistem: true });
  const taut = await call(f.env, '/api/qris/klaim-tautkan', { token: f.kasir, method: 'POST', body: { masukId: a.body.id, saleId: 'sale_qris_6k' } });
  assert.equal(taut.status, 403);
  assert.equal(taut.body.code, 'QRIS_TAUTAN_SISTEM');
  assert.equal(f.sqlite.prepare(`SELECT store_id FROM qris_masuk WHERE id = ?`).get(a.body.id).store_id, null, 'klaim tidak terjadi');
  assert.equal((await call(f.env, '/api/qris/tautkan', { token: f.kasir, method: 'POST', body: { masukId: a.body.id, saleId: 'sale_qris_6k' } })).body.code, 'QRIS_TAUTAN_SISTEM');
  const url = new URL('https://example.test/api/cashier/data/transactions?filter=SALES');
  const data = await (await handleCashierDataApi(new Request(url, { headers: { Authorization: `Bearer ${f.kasir}` } }), f.env, url.pathname)).json();
  assert.equal(data.transactions[0].qris, undefined, 'tanpa tombol QRIS merah/hijau');
  const kolam = await call(f.env, '/api/qris/kolam', { token: f.kasir });
  assert.equal(kolam.body.tautanSistem, true);
  assert.equal((await call(f.env, '/api/qris/klaim', { token: f.kasir, method: 'POST', body: { masukId: a.body.id } })).status, 200);
  assert.deepEqual({ ...f.sqlite.prepare(`SELECT klaim_store_id, klaim_cashier_id FROM qris_masuk WHERE id = ?`).get(a.body.id) }, { klaim_store_id: 'store_pendem', klaim_cashier_id: 'cashier_pendem_pilot' });
  assert.equal((await call(f.env, '/api/qris/batal-klaim', { token: f.kasir, method: 'POST', body: { masukId: a.body.id } })).status, 200);
  assert.deepEqual({ ...f.sqlite.prepare(`SELECT klaim_store_id, klaim_cashier_id FROM qris_masuk WHERE id = ?`).get(a.body.id) }, { klaim_store_id: null, klaim_cashier_id: null }, 'batal klaim = klaim tidak dinilai');
});

test('mutasi BCA H+1: sistem memindah, membuat, menautkan, lalu mencatat kesalahan tiap CS ke Raport', async () => {
  const { getCashierRaportFacts } = await import('../src/staff-raport.js');
  const f = await fixture();
  const kemarin = new Date(Date.now() - 24 * 3600_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const wib = jam => new Date(`${kemarin}T${jam}+07:00`).toISOString();
  for (const store of ['PENDEM', 'MANDALA']) {
    assert.equal((await call(f.env, '/api/qris/setelan', { token: f.owner, store, method: 'PUT', body: { paymentMethodCode: 'BANK', kataKunci: '' } })).status, 200);
  }
  f.sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at, closed_at) VALUES ('laci_p', 'store_pendem', 'cashier_pendem_pilot', 'CLOSED', ?, ?)`).run(wib('08:00:00'), wib('22:00:00'));
  f.sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at, closed_at) VALUES ('laci_m', 'store_mandala', 'cashier_mandala_pilot', 'CLOSED', ?, ?)`).run(wib('08:00:00'), wib('22:00:00'));
  const jual = (id, store, amount, jam) => f.sqlite.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at, payment_method) VALUES (?, ?, ?, ?, ?, ?, 'BANK')`)
    .run(id, `store_${store}`, `laci_${store[0]}`, `cashier_${store}_pilot`, amount, wib(jam));
  jual('sale_p1', 'pendem', 6000, '10:00:10');
  jual('sale_m1', 'mandala', 6000, '10:01:00');
  jual('sale_m2', 'mandala', 9000, '11:02:00');
  jual('sale_p2', 'pendem', 12000, '13:30:00');
  jual('sale_p3', 'pendem', 8000, '14:00:00');
  const masuk = (id, amount, jam, sumber, { klaim = null, sale = null } = {}) => f.sqlite.prepare(`
    INSERT INTO qris_masuk (id, entity_id, store_id, amount, source, received_at, business_date, sumber_bayar, status, sale_id, link_mode, claimed_at, claimed_by_role, claimed_by_id, claimed_by_name, klaim_store_id, klaim_cashier_id, created_at)
    VALUES (?, 'ENT-KPM', ?, ?, 'NOTIF_HP', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, klaim ? `store_${klaim}` : null, amount, wib(jam), kemarin, sumber,
    sale ? 'TERTAUT' : 'BELUM', sale, sale ? 'CS' : null, klaim ? wib(jam) : null, klaim ? 'CASHIER' : '', klaim ? `cashier_${klaim}_pilot` : '', klaim ? `Kasir ${klaim}` : '',
    klaim ? `store_${klaim}` : null, klaim ? `cashier_${klaim}_pilot` : null, wib(jam));
  masuk('m1', 6000, '10:00:30', 'DANA', { klaim: 'pendem', sale: 'sale_p1' });
  masuk('m2', 6000, '10:00:40', 'DANA', { klaim: 'pendem' }); // uang Mandala diklaim Pendem
  masuk('m3', 7000, '10:05:20', 'BCA'); // uang Pendem tak diklaim & tak ada penjualannya
  masuk('m5', 9000, '11:40:00', 'GOPAY', { klaim: 'mandala' }); // notifikasi telat 40 menit
  masuk('m4', 4000, '12:00:00', 'OVO'); // tidak ada di mutasi
  f.sqlite.prepare(`UPDATE qris_masuk SET klaim_at = ? WHERE id = 'm5'`).run(wib('11:55:00')); // diklaim 15 menit sesudah notif muncul
  const baris = (mid, amount, jam, rrn, paymentType) => ({ merchantName: `OUTLET ${mid}`, mid, nmid: '', amount, tanggal: kemarin, jam, rrn, approvalCode: '1', paymentType, payer: 'X', reversal: '' });
  const rows = [
    baris('111111', 6000, '10:00', 'R1', 'DANA'), baris('111111', 7000, '10:05', 'R2', 'BCA'), baris('111111', 12000, '13:00', 'R6', 'BRI'),
    baris('222222', 6000, '10:00', 'R3', 'DANA'), baris('222222', 9000, '11:00', 'R4', 'GOPAY'),
    baris('333333', 5000, '13:00', 'R5', 'BRI')
  ];
  assert.equal((await call(f.env, '/api/qris/mutasi', { token: f.kasir, method: 'POST', body: { rows } })).status, 403);
  const up = await call(f.env, '/api/qris/mutasi', { token: f.owner, method: 'POST', body: { fileName: 'uji.xlsx', rows } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.baru, 6);
  assert.equal((await call(f.env, '/api/qris/mutasi', { token: f.owner, method: 'POST', body: { rows } })).body.dobel, 6);
  const hariIni = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  assert.equal((await call(f.env, '/api/qris/mutasi', { token: f.owner, method: 'POST', body: { rows: [{ ...rows[0], tanggal: hariIni, rrn: 'RX' }] } })).body.code, 'MUTASI_HARI_INI');

  assert.equal((await call(f.env, '/api/qris/mutasi/peta', { token: f.owner, method: 'POST', body: { mid: '111111', storeCode: 'PENDEM' } })).status, 200);
  assert.equal((await call(f.env, '/api/qris/mutasi/peta', { token: f.owner, method: 'POST', body: { mid: '222222', storeCode: 'MANDALA' } })).status, 200);
  const periksa = async () => {
    const lihat = await call(f.env, '/api/qris/mutasi', { token: f.owner, query: { tanggal: kemarin } });
    assert.equal(lihat.status, 200, JSON.stringify(lihat.body));
    const st = rrn => lihat.body.baris.find(row => row.rrn === rrn);
    assert.equal(st('R1').status, 'COCOK');
    assert.equal(st('R1').sale.id, 'sale_p1');
    assert.equal(st('R3').status, 'COCOK', 'uang Mandala dipindah sistem lalu tertaut ke penjualan Mandala');
    assert.equal(st('R3').sale.id, 'sale_m1');
    assert.equal(st('R2').status, 'TANPA_PENJUALAN');
    assert.equal(st('R4').sale.id, 'sale_m2');
    assert.equal(st('R4').notifTelatMenit, 40);
    assert.equal(st('R6').status, 'COCOK');
    assert.equal(st('R6').notifTidakSampai, true);
    assert.equal(st('R6').sale.id, 'sale_p2');
    assert.equal(st('R5').status, 'BELUM_DIPETAKAN');
    assert.deepEqual(st('R3').catatan.map(k => [k.jenis, k.cashierName]), [['SALAH_KLAIM', 'Kasir Pendem (Percontohan)']]);
    assert.deepEqual(lihat.body.notifTanpaMutasi.map(row => row.id), ['m4']);
    assert.deepEqual(lihat.body.ringkas, { total: 6, totalRupiah: 45000, cocok: 4, tanpaPenjualan: 1, belumDipetakan: 1, notifTidakSampai: 1, salahKlaim: 1, tidakKlaim: 1, klaimLambat: 1, selisihKlaim: 2, penjualanTanpaUang: 1, notifTanpaMutasi: 1 });
    const pendem = lihat.body.perCs.find(cs => cs.cashierId === 'cashier_pendem_pilot');
    assert.deepEqual(pendem.jumlah, { SALAH_KLAIM: 1, TIDAK_KLAIM: 1, KLAIM_LAMBAT: 0, SELISIH_KLAIM: 1, PENJUALAN_TANPA_UANG: 1, UANG_TANPA_PENJUALAN: 1 });
    const mandala = lihat.body.perCs.find(cs => cs.cashierId === 'cashier_mandala_pilot');
    assert.deepEqual(mandala.jumlah, { SALAH_KLAIM: 0, TIDAK_KLAIM: 0, KLAIM_LAMBAT: 1, SELISIH_KLAIM: 1, PENJUALAN_TANPA_UANG: 0, UANG_TANPA_PENJUALAN: 0 }, 'klaim 15 menit + uang 6.000-nya direbut Pendem');
    assert.deepEqual(lihat.body.rekapCs.map(r => [r.cashierId, r.klaimRp, r.penjualanRp, r.cocok]),
      [['cashier_mandala_pilot', 9000, 15000, false], ['cashier_pendem_pilot', 12000, 26000, false]]);
    assert.deepEqual(lihat.body.penjualanTanpaUang.map(k => k.amount), [8000]);
  };
  await periksa();
  assert.deepEqual({ ...f.sqlite.prepare(`SELECT store_id, klaim_store_id FROM qris_masuk WHERE id = 'm2'`).get() }, { store_id: 'store_mandala', klaim_store_id: 'store_pendem' });
  // Proses ulang = hasil sama, tidak ada uang masuk/catatan dobel.
  assert.equal((await call(f.env, '/api/qris/mutasi/proses', { token: f.owner, method: 'POST', body: { tanggal: kemarin } })).status, 200);
  await periksa();
  assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM qris_masuk WHERE source = 'MANUAL'`).get().n, 1);
  assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM qris_catatan_cs`).get().n, 7);
  // Raport CS.
  assert.deepEqual((await getCashierRaportFacts(f.env.DB, 'store_pendem', 'cashier_pendem_pilot')).facts.qris,
    { salahKlaim: 1, tidakKlaim: 1, klaimLambat: 0, selisihKlaim: 1, penjualanTanpaUang: 1, uangTanpaPenjualan: 1, nominalTidakSesuai: 2 });
  assert.deepEqual((await getCashierRaportFacts(f.env.DB, 'store_mandala', 'cashier_mandala_pilot')).facts.qris,
    { salahKlaim: 0, tidakKlaim: 0, klaimLambat: 1, selisihKlaim: 1, penjualanTanpaUang: 0, uangTanpaPenjualan: 0, nominalTidakSesuai: 0 });
});

test('minta klaim: gerai lain meminta, CS pengklaim melepas atau mempertahankan; kolam hanya uang hari ini', async () => {
  const f = await fixture();
  const token = await siapkan(f, { semuaGerai: true });
  const mandala = await session(f.sqlite, 'cashier_sessions', 'cashier_id', 'cashier_mandala_pilot', 'qr-kasir-mandala-3');
  f.sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at) VALUES ('drawer_mandala3', 'store_mandala', 'cashier_mandala_pilot', 'OPEN', ?)`).run(new Date().toISOString());
  const a = await kirim(f, token, { text: 'Anda telah menerima pembayaran QRIS sebesar Rp 6.000 dari DANA.', id: 'n1', postedAt: Date.now() });
  const b = await kirim(f, token, { text: 'Anda telah menerima pembayaran QRIS sebesar Rp 7.000 dari GOPAY.', id: 'n2', postedAt: Date.now() });
  const kemarinIso = new Date(Date.now() - 30 * 3600_000).toISOString();
  f.sqlite.prepare(`INSERT INTO qris_masuk (id, entity_id, amount, source, received_at, business_date, created_at) VALUES ('kemarin', 'ENT-KPM', 5000, 'NOTIF_HP', ?, ?, ?)`)
    .run(kemarinIso, new Date(kemarinIso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }), kemarinIso);
  assert.ok(!(await call(f.env, '/api/qris/kolam', { token: f.kasir, query: { klaim: 'SEMUA' } })).body.items.some(item => item.id === 'kemarin'), 'uang kemarin tidak tampil');
  const minta = (who, store, masukId) => call(f.env, '/api/qris/minta', { token: who, store, method: 'POST', body: { masukId } });
  assert.equal((await minta(mandala, 'MANDALA', a.body.id)).body.code, 'QRIS_BELUM_DIKLAIM');
  for (const id of [a.body.id, b.body.id]) assert.equal((await call(f.env, '/api/qris/klaim', { token: f.kasir, method: 'POST', body: { masukId: id } })).status, 200);
  const dilihatMandala = await call(f.env, '/api/qris/kolam', { token: mandala, store: 'MANDALA', query: { klaim: 'SUDAH' } });
  assert.equal(dilihatMandala.body.items.find(item => item.id === a.body.id).bisaMinta, true);
  const req = await minta(mandala, 'MANDALA', a.body.id);
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal((await minta(mandala, 'MANDALA', a.body.id)).body.code, 'QRIS_SUDAH_DIMINTA');
  assert.equal((await minta(f.kasir, 'PENDEM', a.body.id)).status, 409, 'klaim sendiri tidak bisa diminta');
  const dilihatPendem = await call(f.env, '/api/qris/kolam', { token: f.kasir });
  assert.deepEqual(dilihatPendem.body.permintaanMasuk.map(p => [p.masukId, p.dariStoreCode]), [[a.body.id, 'MANDALA']], 'permintaan tampil walau filter Belum diklaim');
  assert.equal((await call(f.env, '/api/qris/permintaan/lepas', { token: mandala, store: 'MANDALA', method: 'POST', body: { permintaanId: req.body.id } })).status, 403);
  assert.equal((await call(f.env, '/api/qris/permintaan/lepas', { token: f.kasir, method: 'POST', body: { permintaanId: req.body.id } })).status, 200);
  assert.deepEqual({ ...f.sqlite.prepare(`SELECT store_id, klaim_store_id, klaim_cashier_id, claimed_by_name FROM qris_masuk WHERE id = ?`).get(a.body.id) },
    { store_id: 'store_mandala', klaim_store_id: 'store_mandala', klaim_cashier_id: 'cashier_mandala_pilot', claimed_by_name: 'Kasir Mandala (Percontohan)' });
  // Uang b: diminta lalu dipertahankan -- tetap milik Pendem.
  const req2 = await minta(mandala, 'MANDALA', b.body.id);
  assert.equal((await call(f.env, '/api/qris/permintaan/tahan', { token: f.kasir, method: 'POST', body: { permintaanId: req2.body.id } })).body.status, 'DIPERTAHANKAN');
  assert.equal(f.sqlite.prepare(`SELECT store_id FROM qris_masuk WHERE id = ?`).get(b.body.id).store_id, 'store_pendem');
  assert.equal((await call(f.env, '/api/qris/permintaan/tahan', { token: f.kasir, method: 'POST', body: { permintaanId: req2.body.id } })).body.code, 'QRIS_PERMINTAAN_SELESAI');
  assert.deepEqual((await call(f.env, '/api/qris/kolam', { token: f.kasir })).body.permintaanMasuk, []);
});

test('pembaca mutasi BCA di browser: buka Excel terkunci, baca baris, sandi salah ditolak; SHA-1 cepat = SHA-1 standar', async () => {
  const { createHash, randomBytes } = await import('node:crypto');
  await import('../public/bca-mutasi-baca.js');
  const { BcaMutasi } = globalThis;
  for (const n of [0, 1, 20, 24, 55, 56, 64, 65, 200]) {
    const data = randomBytes(n);
    assert.equal(Buffer.from(BcaMutasi._uji.sha1(new Uint8Array(data))).toString('hex'), createHash('sha1').update(data).digest('hex'));
  }
  const file = readFileSync(new URL('./fixtures/qris/mutasi-bca-uji.xlsx', import.meta.url));
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.length);
  await assert.rejects(BcaMutasi.baca(buf, 'SALAH'), error => error.code === 'SANDI_SALAH');
  await assert.rejects(BcaMutasi.baca(buf, ''), error => error.code === 'SANDI_PERLU');
  const hasil = await BcaMutasi.baca(buf, 'UJI-BCA');
  assert.deepEqual(hasil.tanggal, ['2026-10-16']);
  assert.deepEqual(hasil.rows.map(row => [row.mid, row.amount, row.jam, row.rrn, row.paymentType]), [
    ['009990001', 6000, '09:52', 'RRNUJI001', 'DANA'],
    ['009990001', 12000, '14:05', 'RRNUJI002', 'BCA']
  ]);
});


test('filter kolam: buka hanya mengambil kolam BELUM, ganti filter meminta data server, buka ulang kembali BELUM', async () => {
  const requests = [];
  const filter = { value: 'BELUM', disabled: false };
  const node = {
    open: false, innerHTML: '',
    showModal() { this.open = true; },
    querySelectorAll() { return []; },
    querySelector(selector) { return selector === '[data-qr-klaim-filter]' ? filter : null; }
  };
  const window = {};
  runInNewContext(readFileSync(new URL('../public/qris-otomatis.js', import.meta.url), 'utf8'), {
    window, document: { getElementById() { return node; } }, URLSearchParams
  });
  const api = async path => {
    requests.push(path);
    return { store: { code: 'PENDEM' }, canManage: false, entityWide: false, items: [] };
  };
  await window.QrisOtomatis.open({ api, storeCode: 'PENDEM', kolam: true });
  assert.deepEqual(requests, ['/api/qris/kolam?store=PENDEM&klaim=BELUM']);
  for (const value of ['SEMUA', 'SUDAH']) {
    filter.value = value;
    filter.onchange();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.at(-1), `/api/qris/kolam?store=PENDEM&klaim=${value}`);
  }
  await window.QrisOtomatis.open({ api, storeCode: 'PENDEM', kolam: true });
  assert.equal(requests.at(-1), '/api/qris/kolam?store=PENDEM&klaim=BELUM');
  assert.equal(requests.length, 4);
});

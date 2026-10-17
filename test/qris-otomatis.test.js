import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

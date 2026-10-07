import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Menjalankan public/store-context.js apa adanya dengan browser palsu minimal.
function runStoreContext({ pathname, storage = {} }) {
  const data = new Map(Object.entries(storage));
  class FakeStorage {
    getItem(key) { return data.has(key) ? data.get(key) : null; }
    setItem(key, value) { data.set(key, String(value)); }
    removeItem(key) { data.delete(key); }
  }
  const localStorage = new FakeStorage();
  const context = {
    Storage: FakeStorage,
    localStorage,
    location: { pathname, origin: 'https://example.test' },
    document: { addEventListener() {}, querySelectorAll: () => [] },
    URL,
    Request: class {},
    Response: class {},
    Promise
  };
  context.window = context;
  context.fetch = async () => ({});
  vm.runInNewContext(read('public/store-context.js'), context);
  return { storeCode: context.LEKER_STORE_CODE, remembered: data.get('lekerCustomerStoreCode') };
}

const cashierSession = {
  lekerCashierToken: 'x'.repeat(64),
  lekerStaffSessionMeta: JSON.stringify({ id: 'c1', role: 'CASHIER', name: 'Anida', storeCode: 'mandala' })
};

test('halaman Kasir tanpa /s/:kode memakai gerai milik akun yang masuk, bukan gerai terakhir/G001', () => {
  // Login mengarahkan ke "/cashier" polos. Dulu jatuh ke G001 (tenant lain, skin lain).
  assert.equal(runStoreContext({ pathname: '/cashier', storage: cashierSession }).storeCode, 'MANDALA');
  assert.equal(
    runStoreContext({ pathname: '/cashier', storage: { ...cashierSession, lekerCustomerStoreCode: 'G001' } }).storeCode,
    'MANDALA'
  );
  assert.equal(runStoreContext({ pathname: '/s/PENDEM/warung', storage: cashierSession }).storeCode, 'MANDALA');
  assert.equal(runStoreContext({ pathname: '/s/PENDEM/racik', storage: cashierSession }).storeCode, 'MANDALA');
});

test('gerai dari alamat tetap berlaku untuk yang bukan akun kasir yang sedang masuk', () => {
  // Belum login / halaman pelanggan / Mode Lihat tanpa token kasir: perilaku lama tidak berubah.
  assert.equal(runStoreContext({ pathname: '/s/PENDEM/cashier' }).storeCode, 'PENDEM');
  assert.equal(runStoreContext({ pathname: '/cashier', storage: { lekerCustomerStoreCode: 'NGIJO' } }).storeCode, 'NGIJO');
  assert.equal(runStoreContext({ pathname: '/cashier' }).storeCode, 'G001');
  assert.equal(runStoreContext({ pathname: '/s/PENDEM/customer', storage: cashierSession }).storeCode, 'PENDEM');
  // Token tanpa meta kasir (mis. meta milik Admin) tidak dipakai menebak gerai kasir.
  const adminMeta = { lekerCashierToken: 'x', lekerStaffSessionMeta: JSON.stringify({ role: 'ADMIN', storeCode: 'MANDALA' }) };
  assert.equal(runStoreContext({ pathname: '/s/PENDEM/cashier', storage: adminMeta }).storeCode, 'PENDEM');
});

test('skin dicek ulang ke server saat tab kembali aktif, halaman dipulihkan dari riwayat, dan koneksi kembali', () => {
  const skin = read('public/ui-skin.js');
  assert.match(skin, /document\.addEventListener\('visibilitychange'/);
  assert.match(skin, /window\.addEventListener\('pageshow'/);
  assert.match(skin, /window\.addEventListener\('online'/);
  // Bukan polling (invariant #6): tidak ada timer berulang.
  assert.doesNotMatch(skin, /setInterval/);
  // Gagal menjangkau server tidak dianggap sudah benar: waktu cek terakhir hanya naik saat sukses.
  assert.match(skin, /if \(response\.ok\) \{\s*setState\(await response\.json\(\), ctx\);\s*lastRefreshAt = Date\.now\(\);/);
});

test('pindah skin Warung/Racik saat Kasir terbuka langsung berlaku, dan tombol pulang ikut hilang', () => {
  const entry = read('public/warung-entry.js');
  assert.match(entry, /addEventListener\('maxi-skin-change', onSkinChange\)/);
  assert.match(entry, /getElementById\('warungReturnBtn'\)\?\.remove\(\)/);
});

test('Portal Staf tidak meminta presensi: setor uang bisa dikirim walau belum presensi', () => {
  const deposits = read('src/employee-deposit-settlement.js');
  const submit = deposits.slice(deposits.indexOf('const submitMatch'), deposits.indexOf('return json(result, 201)'));
  assert.ok(submit.length > 200, 'blok kirim setoran harus ditemukan');
  assert.doesNotMatch(submit, /attendance|presensi|latestAttendanceStatus/i);
});

test('file JS lama yang diubah mem-bump ?v= di semua HTML yang memuatnya', () => {
  for (const [file, version] of [
    ['store-context.js', '20261007-skin-gerai-akun-v1'],
    ['ui-skin.js', '20261007-skin-segar-v1']
  ]) {
    for (const page of ['branch-admin', 'cashier', 'customer', 'racik', 'warung', 'staff', 'entity-admin', 'game']) {
      const html = read(`public/${page}.html`);
      if (!html.includes(`/${file}`)) continue;
      assert.ok(html.includes(`/${file}?v=${version}`), `${page}.html harus memuat ${file}?v=${version}`);
    }
  }
  const cashier = read('public/cashier.html');
  assert.ok(cashier.includes('/warung-entry.js?v=20261007-skin-segar-v1'));
  assert.ok(cashier.includes('/cashier-presensi-gate.js?v=20261007-gate-kembali-v1'));
});

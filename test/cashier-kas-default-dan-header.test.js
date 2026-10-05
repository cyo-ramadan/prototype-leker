import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bos Cyo, 2026-10-05: "buat di penjualan, beli bahan, pengeluaran default pembayarannya itu pake kas"
// dan "ilangin tombol kasir login, susun jadi lebih tertata lagi".
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('cara bayar default = Kas (CASH) untuk Penjualan, Beli Bahan, dan Pengeluaran, mengalahkan tanda default lain', () => {
  const source = read('public/cashier-payment-methods.js');
  const body = source.slice(source.indexOf('function defaultCode()'), source.indexOf('function methodOptions'));
  assert.ok(body.indexOf("item.code === 'CASH'") < body.indexOf('item.isDefault'), 'CASH harus dicari sebelum tanda isDefault');
  assert.match(source, /id="dialogPurchasePayment"[^>]*>\$\{methodOptions\(\)\}/);
  assert.match(source, /id="dialogOperationalPayment"[^>]*>\$\{methodOptions\(\)\}/);
});

test('pilihan cara bayar penjualan tidak menempel: dialog baru mulai dari Kas dan kembali ke Kas setelah tersimpan', () => {
  const source = read('public/cashier-payment-methods.js');
  assert.match(source, /function resetSalePaymentToDefault\(\)/);
  assert.match(source, /const posted = await canonicalFactPost\(path, payload\);\s*resetSalePaymentToDefault\(\);/);
  assert.doesNotMatch(source, /select\?\.value \|\| byId\('salePaymentMethod'\)\?\.value \|\| defaultCode\(\)/);
  // pengiriman tidak boleh berada di dalam try yang bisa memicu kirim ulang lewat baseApi
  const wrapper = source.slice(source.indexOf('api = async function cashierPaymentAwareApi'));
  const tryBlock = wrapper.slice(wrapper.indexOf('try {'), wrapper.indexOf('} catch'));
  assert.doesNotMatch(tryBlock, /canonicalFactPost/);
});

test('header Workspace Gerai: tombol Kasir Login dihapus, Lihat Kasir tetap, header HP tersusun rapi', () => {
  const html = read('public/branch-admin.html');
  assert.doesNotMatch(html, />Kasir Login</);
  assert.match(html, /id="cashierReadOnlyLink"/);
  const css = read('public/admin.css');
  assert.match(css, /@media \(max-width: 620px\) \{\s*\.admin-topbar \{ flex-wrap: wrap;/);
  assert.match(css, /\.admin-top-actions \{ width: 100%; justify-content: flex-start;/);
});

test('header halaman kasir di HP tidak meluber: baris sendiri untuk akun + tombol', () => {
  assert.match(read('public/cashier-auth.css'), /\.topbar:has\(\.cashier-user-chip\)\{flex-wrap:wrap/);
  assert.match(read('public/cashier.html'), /cashier-auth\.css\?v=20261005-header-rapi-v1/);
});

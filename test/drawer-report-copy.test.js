import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bos Cyo, 2026-09-28: tombol Salin di Detail Laci -- format teks siap
// ditempel ke WA, dipakai sisi Kasir DAN Admin karena drawer-report-ui.js
// adalah satu-satunya renderer untuk dua-duanya (window.MAXIDrawerReport).
//
// Sesuai konvensi test public/*.js repo ini: assertion berbasis regex ke
// source (lihat test/accounting-journal-list-ui.test.js), karena file ini
// bergantung pada document/navigator yang tidak tersedia di node:test biasa.

const source = readFileSync(new URL('../public/drawer-report-ui.js', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

test('Tombol Salin ada di markup render() dan dipasang di kedua halaman (kasir + admin)', () => {
  assert.match(source, /data-drawer-report-copy/);
  assert.match(branchAdminHtml, /drawer-report-ui\.js\?v=/);
  assert.match(cashierHtml, /drawer-report-ui\.js\?v=/);
});

test('Klik disalurkan lewat event delegation ke jurnal terakhir yang dirender (lastReportForCopy), bukan closure per-render', () => {
  assert.match(source, /document\.addEventListener\('click', async event => \{/);
  assert.match(source, /lastReportForCopy = report;/);
  assert.match(source, /if \(!button \|\| !lastReportForCopy\) return;/);
});

test('Clipboard API dipakai dengan fallback execCommand untuk browser lama', () => {
  assert.match(source, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(source, /document\.execCommand\('copy'\)/);
});

test('Teks salinan mencakup semua bagian yang sama dengan tampilan Detail Laci', () => {
  const expectedSections = [
    '1. PENJUALAN BAYAR TUNAI',
    '2. PROMOSI',
    '3A. BELANJA BAHAN BAYAR TUNAI',
    '4.1 OPERASIONAL KAS',
    '4.2 OPERASIONAL NON KAS',
    '5. MASAK',
    '6. STOK SISA',
    'PERHITUNGAN',
    '1B. PENJUALAN BAYAR NON TUNAI',
    '3B. BELANJA BAHAN BAYAR NON TUNAI',
    'PENYESUAIAN STOK',
    'ARUS BARANG',
    'PENDAPATAN LAIN',
    'ARUS KAS MASUK',
    'ARUS KAS KELUAR'
  ];
  for (const label of expectedSections) {
    assert.ok(source.includes(`'${label}'`), `bagian "${label}" wajib ada di teks salinan`);
  }
});

test('Header teks salinan memakai field yang sama dengan header tampilan (ID Laci, Shift, Modal, dst)', () => {
  assert.match(source, /`ID Laci: \$\{drawer\.id\}`/);
  assert.match(source, /`Modal: \$\{rupiah\(drawer\.openingAmount\)\}`/);
  assert.match(source, /`Insentif: \$\{rupiah\(drawer\.incentiveAmount\)\}`/);
});

test('Pemisah kolom "|" pada nama barang/keterangan disaring supaya tidak merusak format', () => {
  assert.match(source, /replace\(\/\\\|\/g, '-'\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Bos Cyo, 2026-09-17: tombol Laporan (Net Profit harian) di panel Entity
// Admin -- pilih range tanggal + gerai, tekan tombol, tampil tabel
// tanggal x gerai + Total. Sumber datanya endpoint
// /api/admin/reports/net-profit (src/net-profit-report.js).

test('entity-admin.html gains a Laporan tab with date range, store checklist, and a results table', async () => {
  const html = await read('public/entity-admin.html');
  assert.match(html, /data-entity-tab="reports"/);
  assert.match(html, /id="entityTab-reports"/);
  assert.match(html, /id="entityReportFrom"/);
  assert.match(html, /id="entityReportTo"/);
  assert.match(html, /id="entityReportStoreChecklist"/);
  assert.match(html, /id="entityReportRun"/);
  assert.match(html, /id="entityReportTableWrap"/);
});

test('switchEntityTab wires the reports tab and calls the net-profit endpoint on run', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /name === 'reports'/);
  assert.match(source, /api\/admin\/reports\/net-profit\?store=/);
  assert.match(source, /runEntityReport/);
});

// Bug ketemu langsung (2026-09-17): tanpa ?store=, request jatuh ke gerai
// default (server-side) yang bisa saja BUKAN bagian dari entity si pemanggil
// -- laporan kelihatan kosong/ditolak tanpa pesan yang jelas kenapa, karena
// dari sisi UI tidak ada error yang mencolok. ?store= wajib dikirim supaya
// server tahu entity mana yang memanggil (src/net-profit-report.js
// selectedStore()).
test('runEntityReport() mengirim ?store= dari gerai entity sendiri, bukan mengandalkan default server', async () => {
  const source = await read('public/entity-admin.js');
  const fnBody = source.slice(source.indexOf('async function runEntityReport'), source.indexOf('async function saveEntityEmployee'));
  assert.match(fnBody, /anyEntityStoreCode\(\)/, 'harus memakai gerai entity sendiri sebagai pengenal pemanggil, bukan default server');
  assert.match(fnBody, /store=\$\{encodeURIComponent\(callerStoreCode\)\}/);
  assert.match(fnBody, /if \(!callerStoreCode\)/, 'entity tanpa gerai sama sekali harus dicegat dengan pesan, bukan memanggil API dengan store kosong');
});

test('store checklist is mounted once and never resets user selection on tab re-entry', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /dataset\.mounted === '1'/);
});

test('negative net profit values are visually distinguished in the rendered table', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /value < 0/);
});

// Bos Cyo, 2026-10-01: grafik perbandingan gerai -- urut dari terbesar ke
// terkecil, hijau untung / merah rugi, dengan tombol pilihan ukuran.
test('Laporan Entity punya grafik perbandingan gerai dengan tombol Untung Bersih, Omset, Untung Kotor, Total Beban, HPP, Margin', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const js = await read('public/entity-admin.js');
  const html = await read('public/entity-admin.html');
  const css = await read('public/entity-report-chart.css');

  for (const label of ['Untung Bersih', 'Omset', 'Untung Kotor', 'Total Beban', 'HPP', 'Margin Bersih %']) assert.ok(js.includes(`label: '${label}'`), label);
  assert.match(js, /storeTotals/);
  assert.match(js, /\.sort\(\(a, b\) => \(b\.v \?\? -Infinity\) - \(a\.v \?\? -Infinity\)/, 'urut terbesar di atas');
  // Untung/rugi bukan hanya warna: ada tanda segitiga dan angka bertanda minus.
  assert.match(js, /\\u25b2/);
  assert.match(js, /\\u25bc/);
  assert.match(js, /entityVizMinus/);
  assert.match(css, /--viz-good/);
  assert.match(css, /--viz-bad/);
  assert.match(html, /id="entityReportChart"/);
  assert.match(html, /entity-report-chart\.css\?v=20261002-grafik-gerai-v3/);
  assert.ok(String(html.match(/\/entity-admin\.js\?v=([\w-]+)/)?.[1] || '') >= '20261002-kartu-ringkas-v2', 'versi entity-admin.js tidak boleh lebih lama dari 20261002-kartu-ringkas-v2');
});

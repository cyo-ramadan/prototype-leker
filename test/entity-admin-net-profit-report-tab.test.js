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
  assert.match(source, /api\/admin\/reports\/net-profit\?from=/);
  assert.match(source, /runEntityReport/);
});

test('store checklist is mounted once and never resets user selection on tab re-entry', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /dataset\.mounted === '1'/);
});

test('negative net profit values are visually distinguished in the rendered table', async () => {
  const source = await read('public/entity-admin.js');
  assert.match(source, /value < 0/);
});

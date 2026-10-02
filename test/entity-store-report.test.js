import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Laporan Gerai di Admin Entity (Bos Cyo, 2026-10-02): klik satu gerai -> baris
// tanggal, kolom Omset, HPP, SO+, SO-, Gross Profit, Beban Lapak, Gaji, Beban
// Lainnya, Net Profit. Datanya dari endpoint Laporan Untung Rugi satu gerai
// (rincian per hari; diuji di net-profit-*.test.js), jadi di sini yang dijaga
// adalah pemasangan tab dan aturan pemecahan beban.

const html = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/entity-store-report.js', import.meta.url), 'utf8');
const adminJs = readFileSync(new URL('../public/entity-admin.js', import.meta.url), 'utf8');

test('tab Laporan Gerai terpasang dengan versi file yang dibump', () => {
  assert.match(html, /data-entity-tab="storereport"/);
  assert.match(html, /id="entityTab-storereport"/);
  assert.match(html, /id="entityStoreReportStores"/);
  assert.match(html, /id="entityStoreReportTable"/);
  assert.match(html, /entity-store-report\.js\?v=20261002-laporan-gerai-v1/);
  assert.match(html, /entity-store-report\.css\?v=20261002-laporan-gerai-v1/);
  assert.match(html, /entity-admin\.js\?v=20261002-laporan-gerai-skin-v1/);
  assert.match(adminJs, /loadEntityStoreReport/);
});

test('kolom laporan sesuai permintaan, beban dipecah Lapak / Gaji / Lainnya, tanpa polling', () => {
  for (const label of ['Omset', 'HPP', 'SO+', 'SO−', 'Gross Profit', 'Beban Lapak', 'Gaji', 'Beban Lainnya', 'Net Profit']) {
    assert.ok(js.includes(`'${label}'`), `kolom ${label}`);
  }
  assert.match(js, /\/lapak\//);
  assert.match(js, /\/gaji\//);
  assert.match(js, /\/api\/admin\/reports\/net-profit\?/);
  assert.doesNotMatch(js, /setInterval/);
});

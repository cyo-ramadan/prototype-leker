import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 2026-09-15, Bos Cyo: "ui/ux di portal admin yang harusnya menyamakan
// dengan portal kasir (admin yang adjust mengikuti kasir): transaksi, stok,
// detil laci... tombolnya dibuuat simbol juga sepeeti kasir, biar satu
// trma [tema]... tampilan untuk device nya juga disamain aja kaya kasir,
// pake tombol2 kebawah gitu". Detail Laci was already shared via
// drawer-report-ui.js before this change -- these tests only cover the
// Transaksi and Stok tabs, which previously had their own plain/grey
// mini-btn styling with no icons and no mobile stacking.

const transactionsUi = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const stockUi = readFileSync(new URL('../public/admin-stock.js', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../public/data-explorer-shared.css', import.meta.url), 'utf8');

test('branch-admin.html loads the shared Admin/Kasir button-theme stylesheet', () => {
  assert.match(branchAdminHtml, /data-explorer-shared\.css/);
});

test('the shared theme defines brand-colored primary and grey buttons, plus a mobile stack-downward rule', () => {
  assert.match(theme, /\.admin-tx-btn-primary\s*\{[^}]*background:var\(--brand\)/);
  assert.match(theme, /\.admin-tx-btn-grey/);
  assert.match(theme, /@media\(max-width:640px\)\{/);
  assert.match(theme, /\.admin-tx-toolbar\{flex-direction:column\}/);
});

test('Admin Transaksi filter chips and the Detail action use the shared theme classes with icons, not plain mini-btn', () => {
  assert.match(transactionsUi, /class="admin-tx-btn" data-transaction-filter="ALL" type="button">📋 Semua</);
  assert.match(transactionsUi, /class="admin-tx-btn" data-transaction-filter="SALES" type="button">🛒 Penjualan</);
  assert.match(transactionsUi, /id="adminTransactionFilters" class="admin-tx-toolbar"/);
  assert.match(transactionsUi, /class="admin-tx-btn admin-tx-btn-primary" type="button" data-transaction-detail-kind/);
  // Filter text must stay an exact substring match for existing regression
  // coverage in admin-transaction-explorer.test.js and
  // manufacturing-admin-transactions.test.js, so the ampersand is not
  // HTML-entity-escaped.
  assert.match(transactionsUi, /Stok & Produksi/);
});

test('Admin Transaksi filter toggling uses the shared active/grey classes, not the unrelated global .primary-btn', () => {
  assert.match(transactionsUi, /button\.classList\.toggle\('admin-tx-btn-primary', active\)/);
  assert.match(transactionsUi, /button\.classList\.toggle\('active', active\)/);
  assert.match(transactionsUi, /button\.classList\.toggle\('admin-tx-btn-grey', !active\)/);
  // The old toggle put the full-width global .primary-btn class onto a flex
  // chip, which stretched the active filter to fill the whole row -- make
  // sure that regression does not come back.
  assert.doesNotMatch(transactionsUi, /classList\.toggle\('primary-btn', active\)/);
});

test('Admin Stok row actions (Lihat Mutasi, Histori HPP) use the shared theme with icons', () => {
  assert.match(stockUi, /class="admin-tx-btn admin-tx-btn-primary" type="button" data-stock-detail="\$\{item\.productId\}">📦 Lihat Mutasi</);
  assert.match(stockUi, /class="admin-tx-btn admin-tx-btn-grey" type="button" data-hpp-history="\$\{item\.productId\}">📈 Histori HPP</);
});

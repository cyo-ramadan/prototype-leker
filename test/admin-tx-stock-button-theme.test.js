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

// 2026-10-20: Transaksi now follows Data Kasir: select filters and a responsive table.
test('Admin Transaksi uses the cashier-style filter controls and shared Detail button', () => {
  assert.match(transactionsUi, /id="adminTransactionsFilter" class="text-input"/);
  assert.match(transactionsUi, /id="adminTransactionsBayar" class="text-input"/);
  assert.match(transactionsUi, /id="adminTransactionsCreator" class="text-input"/);
  assert.match(transactionsUi, /class="admin-tx-btn admin-tx-btn-primary" type="button" data-transaction-detail-kind/);
  assert.match(transactionsUi, /\['GOODS_FLOW', 'Arus Barang'\]/);
  assert.match(transactionsUi, /\['PRODUCTION', 'Produksi'\]/);
});

test('Admin Transaksi keeps table scrolling local and reflows into cards on mobile', () => {
  assert.match(theme, /\.admin-data-table-wrap\{[^}]*overflow-x:auto/);
  assert.match(theme, /\.admin-data-table thead\{display:none\}/);
  assert.match(theme, /content:attr\(data-label\)/);
  assert.doesNotMatch(transactionsUi, /classList\.toggle\('primary-btn', active\)/);
});

test('Admin Stok row actions (Lihat Mutasi, Histori HPP) use the shared theme with icons', () => {
  assert.match(stockUi, /class="admin-tx-btn admin-tx-btn-primary" type="button" data-stock-detail="\$\{item\.productId\}">📦 Lihat Mutasi</);
  assert.match(stockUi, /class="admin-tx-btn admin-tx-btn-grey" type="button" data-hpp-history="\$\{item\.productId\}">📈 Histori HPP</);
});

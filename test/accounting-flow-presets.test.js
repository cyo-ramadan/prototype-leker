import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../public/admin-accounting-flow-presets.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const accountingSettings = readFileSync(new URL('../src/accounting-settings.js', import.meta.url), 'utf8');
const warehouseSettings = readFileSync(new URL('../src/warehouse-settings.js', import.meta.url), 'utf8');

test('Accounting flow presets reuse the existing settings registries instead of creating a parallel mapper', () => {
  assert.match(adminHtml, /admin-accounting-flow-presets\.js/);
  assert.match(ui, /\/api\/admin\/settings\/accounting\/transaction-categories/);
  assert.match(ui, /\/api\/admin\/settings\/accounting\/journal-rules/);
  assert.doesNotMatch(ui, /CREATE TABLE|INSERT INTO|localStorage.*mapping/i);
});

test('cash flow presets preserve the accounting direction requested by the business owner', () => {
  assert.match(ui, /cash_flow_in/);
  assert.match(ui, /side: 'DEBIT', sourceType: 'payment_method'/);
  assert.match(ui, /side: 'CREDIT', sourceType: 'fixed_account'/);
  assert.match(ui, /cash_flow_out/);
  assert.match(ui, /side: 'DEBIT', sourceType: 'fixed_account'/);
  assert.match(ui, /side: 'CREDIT', sourceType: 'payment_method'/);
});

test('goods flow presets use Jenis Barang inventory mapping and configurable counterpart accounts', () => {
  assert.match(ui, /goods_flow_in/);
  assert.match(ui, /item_category_inventory/);
  assert.match(ui, /Akun lawan barang masuk/);
  assert.match(ui, /goods_flow_out/);
  assert.match(ui, /Akun lawan barang keluar/);
  assert.match(ui, /Revenue\/Expense/);
  assert.match(ui, /ASSET\/LIABILITY\/EQUITY/);
});

test('warehouse choices are read from the existing Warehouse Settings capability and execution remains fail-closed', () => {
  assert.match(ui, /\/api\/admin\/settings\/warehouse/);
  assert.match(ui, /ROUTING HOLD/);
  assert.match(ui, /inventory_stock_balances/);
  assert.match(ui, /store-level/);
  assert.match(warehouseSettings, /MAXI_WAREHOUSE_SETTINGS_V1/);
  assert.doesNotMatch(accountingSettings, /warehouse_.*account.*mapping/i);
});

test('preset reapply refuses to overwrite customized journal rule shapes', () => {
  assert.match(ui, /matchesManagedShape/);
  assert.match(ui, /sudah dikustomisasi/);
  assert.match(ui, /Karen tidak overwrite rule custom/);
});

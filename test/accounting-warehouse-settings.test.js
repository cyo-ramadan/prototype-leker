import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0022_accounting_warehouse_settings.sql', import.meta.url), 'utf8');
const accountingApi = readFileSync(new URL('../src/accounting-settings.js', import.meta.url), 'utf8');
const warehouseApi = readFileSync(new URL('../src/warehouse-settings.js', import.meta.url), 'utf8');
const accountingReference = readFileSync(new URL('../src/accounting-reference.js', import.meta.url), 'utf8');
const settingsUi = readFileSync(new URL('../public/admin-settings-panels.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('Accounting Settings schema follows the approved five-table rule registry', () => {
  for (const table of ['chart_of_accounts', 'payment_methods', 'item_categories', 'transaction_categories', 'journal_rules']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /side TEXT NOT NULL CHECK \(side IN \('DEBIT','CREDIT'\)\)/);
  for (const source of ['fixed_account','payment_method','item_category_inventory','item_category_cogs','item_category_revenue','cost_center_cash']) {
    assert.match(migration, new RegExp(`'${source}'`));
  }
});

test('core transaction categories are seeded without hardcoded journal rules', () => {
  for (const code of ['sale','purchase_material','operational','payroll','deposit']) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  assert.doesNotMatch(migration, /jrule_.*_(sale|purchase_material|operational|payroll|deposit)/);
});

test('Warehouse registers transaction categories in Module A and owns no account mapping table', () => {
  for (const code of ['wh_transfer','wh_opname','wh_production','wh_return']) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  assert.match(migration, /registered_by_module/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS warehouse_.*account.*mapping/i);
  assert.doesNotMatch(warehouseApi, /chart_of_accounts|journal_rules|fixed_account_id|account_id/);
  assert.match(warehouseApi, /registered_by_module = 'WAREHOUSE'/);
});

test('warehouse adjustment accounts are seeded and explicitly marked for owner review', () => {
  assert.match(migration, /'4201', 'Pendapatan Koreksi Stok'/);
  assert.match(migration, /'6103', 'Beban Susut Persediaan'/);
  assert.match(migration, /review_required/);
  assert.match(migration, /wh_opname_gain_cr/);
  assert.match(migration, /wh_opname_loss_dr/);
});

test('Accounting settings API supports configuration only and does not generate journals', () => {
  assert.match(accountingApi, /MAXI_ACCOUNTING_SETTINGS_V1/);
  assert.match(accountingApi, /journalGeneration: 'OUT_OF_SCOPE'/);
  assert.match(accountingApi, /debitCount/);
  assert.match(accountingApi, /creditCount/);
  assert.match(accountingApi, /COMPLETE/);
  assert.match(accountingApi, /INCOMPLETE/);
  assert.doesNotMatch(accountingApi, /INSERT INTO journal_headers|INSERT INTO journalHeaders|INSERT INTO journal_entries|postJournal/i);
  assert.doesNotMatch(accountingReference, /INSERT INTO journal_headers|INSERT INTO journalHeaders|postJournal/i);
});

test('COA has no hard delete route and blocks deactivation while actively referenced', () => {
  assert.match(accountingApi, /accountReferenceCount/);
  assert.match(accountingApi, /Akun masih direferensikan konfigurasi aktif/);
  assert.doesNotMatch(accountingApi, /request\.method === 'DELETE'/);
});

test('Accounting UI exposes all requested panels, completeness marker, and journal preview', () => {
  assert.match(adminHtml, /admin-settings-panels\.js/);
  assert.match(settingsUi, /Chart of Accounts/);
  assert.match(settingsUi, /Payment Methods/);
  assert.match(settingsUi, /Item Categories/);
  assert.match(settingsUi, /Transaction & Journal Rules/);
  assert.match(settingsUi, /Lengkap/);
  assert.match(settingsUi, /Belum Lengkap/);
  assert.match(settingsUi, /Pratinjau Jurnal/);
  assert.match(settingsUi, /Akun Persediaan/);
  assert.match(settingsUi, /Akun HPP/);
  assert.match(settingsUi, /Akun Penjualan/);
});

test('Warehouse UI exposes locations access and stock opname parameters without direct accounting editor', () => {
  assert.match(settingsUi, /Warehouse Settings/);
  assert.match(settingsUi, /Tambah Gudang \/ Lokasi/);
  assert.match(settingsUi, /Hak Akses Gudang/);
  assert.match(settingsUi, /Toleransi Qty/);
  assert.match(settingsUi, /Toleransi Persentase/);
  assert.match(settingsUi, /Parameter Stock Opname/);
  assert.match(settingsUi, /Registrasi ke Accounting Settings/);
  assert.match(settingsUi, /Warehouse tidak memiliki tabel account mapping sendiri/);
});

test('settings handlers run before generic admin handler', () => {
  const accounting = indexSource.indexOf('const accountingSettingsResponse = await handleAccountingSettingsApi');
  const warehouse = indexSource.indexOf('const warehouseSettingsResponse = await handleWarehouseSettingsApi');
  const generic = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(accounting >= 0 && accounting < generic);
  assert.ok(warehouse >= 0 && warehouse < generic);
});

test('legacy pair mapping writer is retired instead of becoming a second mapping engine', () => {
  assert.match(accountingReference, /Pair mapping legacy sudah dipensiunkan/);
  assert.match(accountingReference, /410/);
  assert.doesNotMatch(accountingReference, /transaction_accounting_mappings/);
  assert.doesNotMatch(accountingReference, /accounting_account_refs/);
});

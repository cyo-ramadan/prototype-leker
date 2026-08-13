import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const accountingApi = readFileSync(new URL('../src/accounting-settings.js', import.meta.url), 'utf8');
const boundaryUi = readFileSync(new URL('../public/accounting-settings-boundary.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('Accounting module owns account maintenance and automatic unique account code policy', () => {
  assert.match(accountingApi, /accountMaintenance: 'ACCOUNTING_MODULE_ONLY'/);
  assert.match(accountingApi, /accountCodePolicy: 'AUTO_UNIQUE_BY_ACCOUNTING_MODULE'/);
  assert.match(accountingApi, /ACCOUNT_MAINTENANCE_OWNED_BY_ACCOUNTING/);
  assert.match(accountingApi, /Setting Akuntansi hanya membaca akun untuk mapping/);
});

test('Setting Akuntansi exposes accounts read-only rather than account-maintenance UI', () => {
  assert.match(adminHtml, /accounting-settings-boundary\.js/);
  assert.match(boundaryUi, /Setting Akuntansi/);
  assert.match(boundaryUi, /Akun dari Modul Akuntansi/);
  assert.match(boundaryUi, /Read only di halaman ini/);
  assert.match(boundaryUi, /Kode akun tidak diinput manual di Setting Akuntansi/);
  assert.match(boundaryUi, /data-edit-account/);
  assert.doesNotThrow(() => new Function(boundaryUi));
});

test('Setting Akuntansi boundary observer is idempotent and cannot self-trigger forever', () => {
  assert.match(boundaryUi, /node\.textContent !== value/);
  assert.match(boundaryUi, /node\.innerHTML !== value/);
  assert.doesNotMatch(boundaryUi, /if \(tab\) tab\.textContent =/);
  assert.doesNotMatch(boundaryUi, /if \(warehouseHint\) warehouseHint\.innerHTML =/);
});

test('Accounting work stays outside Settings', () => {
  assert.match(boundaryUi, /Pekerjaan akuntansi tetap dilakukan di modul Akuntansi/);
  assert.doesNotMatch(boundaryUi, /Buku Besar|Neraca Saldo|Closing|Posting Jurnal/);
});

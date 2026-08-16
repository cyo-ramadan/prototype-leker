import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/pimasatu-ui.css', import.meta.url), 'utf8');
const adapters = readFileSync(new URL('../public/cashier-pimasatu-adapters.js', import.meta.url), 'utf8');
const payments = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/cost-master.js', import.meta.url), 'utf8');
const adminUi = readFileSync(new URL('../public/admin-cost-master.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0034_cost_master.sql', import.meta.url), 'utf8');
const boundaryMigration = readFileSync(new URL('../migrations/0038_operational_accounting_boundary.sql', import.meta.url), 'utf8');

test('PIMASATU is a reusable one-at-a-time component with mobile compact quantity', () => {
  assert.match(component, /window\.MAXIPimasatu/);
  assert.match(component, /state\.lines\.unshift/);
  assert.doesNotMatch(component, /reset\(\); setExpanded\(false\)/);
  assert.match(component, /reset\(\); setExpanded\(true\)/);
  assert.match(component, /initialExpanded = true/);
  assert.match(component, /setExpanded\(initialExpanded\)/);
  assert.match(component, /toggle\.classList\.toggle\('hidden', value\)/);
  assert.match(component, /toggle\.onclick = \(\) => setExpanded\(true\)/);
  assert.doesNotMatch(component, /Tutup pilihan/);
  assert.doesNotMatch(component, /search\.focus\(\)/);
  assert.match(component, /qty\.value = '1'/);
  assert.match(css, /grid-template-columns:minmax\(72px,92px\) minmax\(0,1fr\)/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(adapters, /renderDetails: false/);
  assert.match(payments, /detailTitle: 'Detail Operasional'/);
});

test('Beli Bahan prefetches purchase and supplier data in parallel and shares its cache', () => {
  assert.match(payments, /Promise\.all/);
  assert.match(payments, /window\.__cashierPurchaseOptions = purchase/);
  assert.match(payments, /loadPurchaseData\(\)\.catch/);
});

test('Master Biaya stays store scoped and exposes Operasional business concepts, not Accounting rules', () => {
  assert.match(migration, /CREATE TABLE cost_types/);
  assert.match(migration, /CREATE TABLE cost_masters/);
  assert.match(migration, /Ongkir Lokal/);
  assert.match(migration, /Biaya Kemasan/);
  assert.match(boundaryMigration, /operational_accounting_boundary_recovery_0038/);
  assert.match(api, /requireCashier/);
  assert.match(api, /requireManagement/);
  assert.match(api, /outgoingAmount/);
  assert.match(api, /incomingAmount/);
  assert.match(api, /transactionCategoryCode:\s*'operational'/);
  assert.doesNotMatch(api, /journal_rules|accountingComponentRuleId|accounting_component_rule_id/);
  assert.match(adminUi, /Kategori transaksi: Operasional/);
  assert.match(adminUi, /Mapping akun diatur di Setting Akuntansi/);
  assert.doesNotMatch(adminUi, /accountingComponentLabel|Accounting belum linked/);
});

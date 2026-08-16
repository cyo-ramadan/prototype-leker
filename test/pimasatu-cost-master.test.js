import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/pimasatu-ui.css', import.meta.url), 'utf8');
const adapters = readFileSync(new URL('../public/cashier-pimasatu-adapters.js', import.meta.url), 'utf8');
const payments = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/cost-master.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0034_cost_master.sql', import.meta.url), 'utf8');
const defaults = readFileSync(new URL('../migrations/0035_operational_cost_accounting_defaults.sql', import.meta.url), 'utf8');

test('PIMASATU is a reusable one-at-a-time component with mobile compact quantity', () => {
  assert.match(component, /window\.MAXIPimasatu/);
  assert.match(component, /state\.lines\.unshift/);
  assert.match(component, /setExpanded\(false\)/);
  assert.match(component, /initialExpanded = true/);
  assert.match(component, /setExpanded\(initialExpanded\)/);
  assert.doesNotMatch(component, /renderLines\(\); setExpanded\(false\)/);
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

test('Master Biaya is store scoped and links separate Jenis Biaya to Accounting rules', () => {
  assert.match(migration, /CREATE TABLE cost_types/);
  assert.match(migration, /accounting_component_rule_id/);
  assert.match(migration, /CREATE TABLE cost_masters/);
  assert.match(migration, /Ongkir Lokal/);
  assert.match(migration, /Biaya Kemasan/);
  assert.match(api, /requireCashier/);
  assert.match(api, /requireManagement/);
  assert.match(api, /outgoingAmount/);
  assert.match(api, /incomingAmount/);
  assert.match(defaults, /'DEBIT', 'fixed_account'/);
  assert.match(defaults, /'CREDIT', 'payment_method'/);
  assert.match(defaults, /UPDATE cost_types/);
});

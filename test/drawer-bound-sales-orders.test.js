import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');
const db = readFileSync(new URL('../src/db-multistore.js', import.meta.url), 'utf8');
const orders = readFileSync(new URL('../src/orders-multistore.js', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0012_drawer_bound_sales_orders.sql', import.meta.url), 'utf8');

test('sales and orders workspace is nested inside the drawer card', () => {
  assert.match(ui, /drawerCard\.appendChild\(workspace\)/);
  assert.match(ui, /workspace\.appendChild\(posLayout\)/);
  assert.match(ui, /workspace\.appendChild\(orderSection\)/);
});

test('accepting a customer order binds the active drawer and snapshots PATCH response into draft', () => {
  assert.match(index, /changeOrderStatus\(env\.DB, storeId, statusMatch\[1\], body\.value\?\.status, drawerAuth\.drawer\.id\)/);
  assert.match(orders, /drawerSessionId = null/);
  assert.match(db, /drawer_session_id = CASE[\s\S]*WHEN \? = 'PREPARING'/);
  assert.match(ui, /snapshotOrderToDraft\(data\)/);
  const snapshotStart = ui.indexOf('function snapshotOrderToDraft');
  const snapshotEnd = ui.indexOf('function orderHistoryRows', snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
  assert.doesNotMatch(ui.slice(snapshotStart, snapshotEnd), /api\(/);
});

test('order source is legacy-safe and filter rendering groups in one pass', () => {
  assert.match(migration, /source TEXT NOT NULL DEFAULT 'customer'/);
  assert.match(db, /source: row\.source \|\| 'customer'/);
  assert.match(ui, /Dari Customer/);
  assert.match(ui, /Dari Kasir/);
  assert.match(ui, /for \(const order of state\.orders \|\| \[\]\)/);
});

test('search selection clears and hides the result dropdown', () => {
  assert.match(ui, /changeDraft\(Number\(button\.dataset\.searchProduct\), 1\);[\s\S]*input\.value = '';[\s\S]*target\.classList\.add\('hidden'\)/);
});

test('direct cashier sales emit Diterima, Dibuat, Sudah Jadi tracking in transactional batch', () => {
  assert.match(tracking, /'PREPARING'/);
  assert.match(tracking, /status = 'READY'/);
  assert.match(tracking, /status = 'COMPLETED'/);
  assert.match(tracking, /source, drawer_session_id/);
  assert.match(tracking, /'cashier'/);
  assert.match(tracking, /env\.DB\.batch\(statements\)/);
});

test('customer-derived sale keeps one order lineage instead of creating duplicate cashier order', () => {
  assert.match(ui, /sourceOrderId: draftOriginOrderId/);
  assert.match(tracking, /linkedOrderId: sourceOrder\.id/);
  assert.match(tracking, /order: null/);
  assert.match(migration, /ALTER TABLE sales ADD COLUMN order_id TEXT/);
});

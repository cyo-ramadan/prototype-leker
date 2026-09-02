import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { purchasePriceRangeViolations } from '../src/cashier-purchase.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const purchaseSource = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const approvalSource = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const productMasterSource = readFileSync(new URL('../src/product-master.js', import.meta.url), 'utf8');
const productUiSource = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const cashierUiSource = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

test('Mode Warning OFF keeps out-of-range Purchase posting ungated', () => {
  assert.deepEqual(purchasePriceRangeViolations([{ outsidePriceRange: true }], false), []);
});

test('Mode Warning ON gates an out-of-range Purchase into the existing Approval Queue', () => {
  assert.equal(purchasePriceRangeViolations([{ productId: 1, outsidePriceRange: true }], true).length, 1);
  assert.match(purchaseSource, /'PURCHASE_PRICE_RANGE'/);
  assert.match(purchaseSource, /'pending_approval', 'unposted'/);
  assert.match(purchaseSource, /pendingApproval: true/);
  assert.match(purchaseSource, /}, 202\);/);
  assert.match(approvalSource, /current\.payload\?\.purpose === 'PURCHASE_PRICE_RANGE'/);
  assert.match(approvalSource, /buildPurchasePostingPlan/);
  assert.match(cashierUiSource, /result\.pendingApproval/);
  assert.match(cashierUiSource, /menunggu ACC Admin/);
});

test('Mode Warning ON lets in-range Purchase post normally', () => {
  assert.deepEqual(purchasePriceRangeViolations([{ outsidePriceRange: false }], true), []);
  assert.match(purchaseSource, /const statements = plan\.statements;\s*await env\.DB\.batch\(statements\)/);
});

test('empty min/max ranges never gate even when Mode Warning is ON', () => {
  assert.deepEqual(purchasePriceRangeViolations([{
    minPurchasePriceScaled: null,
    maxPurchasePriceScaled: null,
    outsidePriceRange: false
  }], true), []);
});

test('range migration defaults warning OFF and HPP breach creates a persistent store-scoped alert', () => {
  const sqlite = freshDatabase();
  try {
    const product = sqlite.prepare(`SELECT id, store_id FROM products ORDER BY id LIMIT 1`).get();
    assert.ok(product?.id);
    const store = sqlite.prepare(`SELECT purchase_price_warning_enabled FROM stores WHERE id = ?`).get(product.store_id);
    assert.equal(store.purchase_price_warning_enabled, 0);

    sqlite.prepare(`
      UPDATE products
      SET min_purchase_price_scaled = NULL, max_purchase_price_scaled = NULL,
          min_average_cost_scaled = 1000000, max_average_cost_scaled = 2000000
      WHERE id = ? AND store_id = ?
    `).run(product.id, product.store_id);
    sqlite.prepare(`UPDATE products SET average_cost = 3000000 WHERE id = ? AND store_id = ?`).run(product.id, product.store_id);
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM product_average_cost_alerts WHERE store_id = ?`).get(product.store_id).count, 0);

    sqlite.prepare(`UPDATE stores SET purchase_price_warning_enabled = 1 WHERE id = ?`).run(product.store_id);
    sqlite.prepare(`UPDATE products SET average_cost = 3000001 WHERE id = ? AND store_id = ?`).run(product.id, product.store_id);
    const alert = sqlite.prepare(`
      SELECT product_id, average_cost_scaled, min_average_cost_scaled, max_average_cost_scaled
      FROM product_average_cost_alerts WHERE store_id = ?
    `).get(product.store_id);
    assert.deepEqual({ ...alert }, {
      product_id: product.id,
      average_cost_scaled: 3000001,
      min_average_cost_scaled: 1000000,
      max_average_cost_scaled: 2000000
    });
  } finally {
    sqlite.close();
  }
});

test('Master Barang exposes optional scaled ranges, per-store toggle, and persistent alert panel', () => {
  assert.match(productMasterSource, /min_purchase_price_scaled/);
  assert.match(productMasterSource, /max_purchase_price_scaled/);
  assert.match(productMasterSource, /min_average_cost_scaled/);
  assert.match(productMasterSource, /max_average_cost_scaled/);
  assert.match(productMasterSource, /purchase_price_warning_enabled/);
  assert.match(productUiSource, /Mode Warning Harga & HPP/);
  assert.match(productUiSource, /productHppAlerts/);
  assert.match(productUiSource, /productMinPurchasePrice/);
  assert.match(productUiSource, /productMaxAverageCost/);
});

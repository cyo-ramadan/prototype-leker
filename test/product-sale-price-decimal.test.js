import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { scaledPurchasePriceFromInput } from '../src/product-master.js';
import { listProducts, getProductsByIds } from '../src/db-multistore.js';
import { validateDirectLines } from '../src/cashier-sales-tracking.js';
import { createOrder } from '../src/orders-multistore.js';

const migration0060 = readFileSync(new URL('../migrations/0060_product_sale_price_scaled.sql', import.meta.url), 'utf8');
const migrationDir = new URL('../migrations/', import.meta.url);

// Reuses the in-memory D1-mock harness established in
// test/accounting-cash-flow-bridge.test.js: a real, executing SQLite database
// behind the same prepare().bind().first()/all()/run() + batch() shape the
// actual Cloudflare D1 binding exposes.
function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            _statement: statement,
            _args: args,
            async first() { return statement.get(...args) || null; },
            async all() { return { results: statement.all(...args) }; },
            async run() { return statement.run(...args); }
          };
        }
      };
    },
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

const STORE_ID = 'store_001';
const STORE_CODE = 'G001';

function insertProduct(sqlite, { id, price, name = 'Gula Cair' }) {
  sqlite.prepare(`
    INSERT INTO products (id, store_id, name, purchase_price, price, category, emoji, image_data, display_order, is_active)
    VALUES (?, ?, ?, 0, ?, 'Bahan', '', '', 1, 1)
  `).run(id, STORE_ID, name, price);
}

test('migration 0060 scales an existing whole-rupiah products.price exactly, no rounding loss', () => {
  assert.match(migration0060, /UPDATE products/);
  assert.match(migration0060, /price \* 1000000/);
});

test('scaledPurchasePriceFromInput accepts a sub-rupiah Harga Jual value (products.price reuses the same scaler)', () => {
  assert.equal(scaledPurchasePriceFromInput(0.5), 500000);
  assert.equal(scaledPurchasePriceFromInput(0.000001), 1);
  assert.equal(scaledPurchasePriceFromInput(-1), null);
});

test('db-multistore read paths convert scaled products.price back to the true fractional rupiah value', async () => {
  const sqlite = freshDatabase();
  insertProduct(sqlite, { id: 9001, price: 500000 }); // Rp0.5/unit
  const db = d1(sqlite);

  const listed = await listProducts(db, STORE_ID);
  const listedProduct = listed.find(product => product.id === 9001);
  assert.equal(listedProduct.price, 0.5);

  const byIds = await getProductsByIds(db, STORE_ID, [9001]);
  assert.equal(byIds[0].price, 0.5);
});

test('validateDirectLines rounds only the final line total, never the fractional catalog price itself', () => {
  // Rp0.5/gram x 3 gram = Rp1.5 -> whole-rupiah cash figure rounds to 2,
  // and the stored unit_price snapshot is derived back from that rounded
  // total (2 / 3 -> rounds to 1), never truncated from the raw 0.5 price.
  const products = [{ id: 1, name: 'Gula Cair', price: 0.5 }];
  const result = validateDirectLines(products, [{ productId: 1, quantity: 3 }]);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0].lineTotal, 2);
  assert.equal(result.total, 2);
  assert.equal(result.lines[0].unitPrice, Math.round(2 / 3));
});

test('validateDirectLines keeps a whole-rupiah catalog price behaving exactly as before (no regression)', () => {
  const products = [{ id: 1, name: 'Es Teh', price: 5000 }];
  const result = validateDirectLines(products, [{ productId: 1, quantity: 3 }]);
  assert.equal(result.ok, true);
  assert.equal(result.lines[0].lineTotal, 15000);
  assert.equal(result.lines[0].unitPrice, 5000);
  assert.equal(result.total, 15000);
});

test('createOrder persists a whole-rupiah order total and unit_price snapshot for a fractional catalog price', async () => {
  const sqlite = freshDatabase();
  insertProduct(sqlite, { id: 9002, price: 700000, name: 'Larutan Gula' }); // Rp0.7/unit
  const db = d1(sqlite);
  const store = { id: STORE_ID, code: STORE_CODE };

  const result = await createOrder(db, store, {
    items: [{ menuId: 9002, qty: 3, note: '' }],
    customerName: 'Test'
  });

  assert.equal(result.ok, true, result.error);
  // 0.7 x 3 = 2.1 -> exact whole-rupiah cash figure rounds to 2.
  assert.equal(result.order.total, 2);
  assert.equal(result.order.items[0].lineTotal, 2);
  assert.equal(result.order.items[0].price, Math.round(2 / 3));

  const persistedOrder = sqlite.prepare('SELECT total_amount FROM orders WHERE id = ?').get(result.order.id);
  assert.equal(persistedOrder.total_amount, 2);

  const persistedItem = sqlite.prepare('SELECT unit_price, line_total, quantity FROM order_items WHERE order_id = ?').get(result.order.id);
  assert.equal(persistedItem.line_total, 2);
  assert.equal(persistedItem.unit_price, Math.round(2 / 3));
  assert.equal(persistedItem.quantity, 3);
});

test('createOrder still produces exact whole-rupiah totals for a plain integer catalog price (no regression)', async () => {
  const sqlite = freshDatabase();
  insertProduct(sqlite, { id: 9003, price: 8_000_000, name: 'Es Teh Poci' }); // Rp8/unit scaled
  const db = d1(sqlite);
  const store = { id: STORE_ID, code: STORE_CODE };

  const result = await createOrder(db, store, {
    items: [{ menuId: 9003, qty: 4, note: '' }],
    customerName: 'Test'
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.order.total, 32);
  assert.equal(result.order.items[0].lineTotal, 32);
  assert.equal(result.order.items[0].price, 8);
});

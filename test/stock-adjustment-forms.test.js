import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { listStockAdjustmentForms } from '../src/approval-queue.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const adminUiSource = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() { return statement.get(...args) || null; },
            async all() { return { results: statement.all(...args) }; },
            async run() { return statement.run(...args); }
          };
        }
      };
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

test('Stock Adjustment forms are store scoped and hide inactive or untracked products', async () => {
  const sqlite = freshDatabase();
  try {
    const stores = sqlite.prepare(`SELECT id FROM stores ORDER BY id LIMIT 2`).all();
    assert.equal(stores.length, 2);
    const fixtures = stores.map(store => {
      const product = sqlite.prepare(`SELECT id FROM products WHERE store_id = ? ORDER BY id LIMIT 1`).get(store.id);
      assert.ok(product?.id);
      sqlite.prepare(`UPDATE products SET is_active = 1, stock_tracking_enabled = 1 WHERE store_id = ? AND id = ?`).run(store.id, product.id);
      return { storeId: store.id, productId: Number(product.id) };
    });

    fixtures.forEach((fixture, index) => {
      const formId = `form_store_${index + 1}`;
      sqlite.prepare(`INSERT INTO stock_adjustment_forms (id, store_id, name) VALUES (?, ?, ?)`).run(formId, fixture.storeId, `Form ${index + 1}`);
      sqlite.prepare(`INSERT INTO stock_adjustment_form_items (form_id, store_id, product_id, display_order) VALUES (?, ?, ?, 0)`).run(formId, fixture.storeId, fixture.productId);
    });

    const firstStoreForms = await listStockAdjustmentForms(d1(sqlite), fixtures[0].storeId);
    assert.deepEqual(firstStoreForms.map(form => form.id), ['form_store_1']);
    assert.deepEqual(firstStoreForms[0].productIds, [fixtures[0].productId]);

    sqlite.prepare(`UPDATE products SET stock_tracking_enabled = 0 WHERE store_id = ? AND id = ?`).run(fixtures[0].storeId, fixtures[0].productId);
    const withoutUntracked = await listStockAdjustmentForms(d1(sqlite), fixtures[0].storeId);
    assert.deepEqual(withoutUntracked[0].productIds, []);

    sqlite.prepare(`UPDATE stock_adjustment_forms SET is_active = 0 WHERE id = 'form_store_1'`).run();
    assert.deepEqual(await listStockAdjustmentForms(d1(sqlite), fixtures[0].storeId), []);
    assert.equal((await listStockAdjustmentForms(d1(sqlite), fixtures[0].storeId, { activeOnly: false })).length, 1);
  } finally {
    sqlite.close();
  }
});

test('Admin exposes store-scoped Form Penyesuaian create, edit, and nonaktif controls', () => {
  assert.match(adminUiSource, /Form Penyesuaian/);
  assert.match(adminUiSource, /\/api\/management\/stock-adjustment-forms/);
  assert.match(adminUiSource, /method: editing \? 'PATCH' : 'POST'/);
  assert.match(adminUiSource, /stockAdjustmentFormActive/);
});

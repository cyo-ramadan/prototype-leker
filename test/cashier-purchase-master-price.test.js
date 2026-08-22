import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { purchaseItemStatements } from '../src/cashier-purchase.js';

function recordingDb() {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      const statement = {
        sql: String(sql),
        bindings: [],
        bind(...bindings) {
          statement.bindings = bindings;
          return statement;
        }
      };
      prepared.push(statement);
      return statement;
    }
  };
}

test('purchase posting updates transaction cost history without overwriting Master Purchase Price', () => {
  const db = recordingDb();
  const item = {
    productId: 11,
    productName: 'Bahan Uji',
    productKindId: 'kind_raw',
    productKindCode: 'RAW',
    quantity: 4,
    lineTotal: 24_000,
    unitCostScaled: 6_000_000_000,
    unitId: 'unit_pcs',
    unitSymbol: 'pcs'
  };

  const statements = purchaseItemStatements(db, {
    purchaseId: 'purchase_test',
    storeId: 'store_001',
    drawerId: 'drawer_001',
    cashierId: 'cashier_001',
    item,
    now: '2026-08-22T00:00:00.000Z',
    warehouseEnabled: false
  });

  const productUpdate = statements.find(statement => /UPDATE\s+products/i.test(statement.sql));
  assert.ok(productUpdate, 'purchase posting must update server-owned cost history');
  assert.match(productUpdate.sql, /average_cost\s*=/i);
  assert.match(productUpdate.sql, /last_purchase_price\s*=/i);
  assert.match(productUpdate.sql, /last_purchase_at\s*=/i);
  assert.doesNotMatch(
    productUpdate.sql,
    /(?:^|[,\s])purchase_price\s*=/i,
    'products.purchase_price is an editable master default and must stay independent from purchase posting'
  );

  const purchaseItemInsert = statements.find(statement => /INSERT\s+INTO\s+purchase_items/i.test(statement.sql));
  assert.ok(purchaseItemInsert, 'purchase must persist an itemized transaction snapshot');
  assert.match(purchaseItemInsert.sql, /p\.id\s*=\s*\?\s+AND\s+p\.store_id\s*=\s*\?/i);
});

test('purchase boundary keeps supplier and product eligibility store-scoped', async () => {
  const source = await readFile(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /SELECT id FROM suppliers WHERE id = \? AND store_id = \? AND is_active = 1/,
    'supplier identity must resolve inside the cashier store'
  );
  assert.match(
    source,
    /COALESCE\(t\.can_purchase, 1\) = 1/,
    'purchase options/items must remain limited to purchasable product types'
  );
  assert.match(
    source,
    /\? = 0 OR \(p\.stock_tracking_enabled = 1 AND COALESCE\(t\.track_stock, 1\) = 1\)/,
    'Warehouse ON requires stock tracking while Warehouse OFF preserves the approved direct-expense compatibility path'
  );
});

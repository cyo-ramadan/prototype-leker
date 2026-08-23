import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSaleStatements } from '../src/cashier-sales-tracking.js';
import { loadPosAccountingFact } from '../src/accounting-pos-bridge.js';

function recordingDb() {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      return {
        bind(...values) {
          const statement = { sql, values };
          prepared.push(statement);
          return statement;
        }
      };
    }
  };
}

test('sale commit carries payment, same-store item identity, Jenis Barang, and HPP snapshots without accounting decisions', () => {
  const db = recordingDb();
  const statements = buildSaleStatements(db, {
    saleId: 'sale_1',
    storeId: 'store_1',
    drawerId: 'drawer_1',
    cashierId: 'cashier_1',
    linkedOrderId: 'order_1',
    customerId: null,
    customerName: 'Walk-in',
    total: 45000,
    totalPoints: 0,
    note: '',
    now: '2026-08-22T10:00:00.000Z',
    channel: 'QRIS',
    lines: [{
      productId: 'product_1',
      productName: 'Es Teh',
      unitPrice: 15000,
      quantity: 3,
      lineTotal: 45000,
      pointsPerUnit: 0,
      linePoints: 0,
      recipeId: null,
      productionRunId: null
    }],
    operationalStatements: [],
    pointShareGroupId: null
  });

  assert.equal(statements.length, 2);

  const saleStatement = statements[0];
  assert.match(saleStatement.sql, /INSERT INTO sales/);
  assert.match(saleStatement.sql, /payment_method/);
  assert.equal(saleStatement.values[8], 'QRIS');

  const itemStatement = statements[1];
  assert.match(itemStatement.sql, /INSERT INTO sale_items/);
  assert.match(itemStatement.sql, /product_kind_id, product_kind_code, product_kind_name, unit_cost_snapshot, line_cogs/);
  assert.match(itemStatement.sql, /p\.product_kind_id/);
  assert.match(itemStatement.sql, /COALESCE\(k\.code, ''\)/);
  assert.match(itemStatement.sql, /COALESCE\(k\.name, ''\)/);
  assert.match(itemStatement.sql, /p\.average_cost, p\.average_cost \* \?/);
  assert.match(itemStatement.sql, /WHERE p\.id = \? AND p\.store_id = \?/);
  assert.deepEqual(itemStatement.values.slice(-3), [3, 'product_1', 'store_1']);

  const committedSql = statements.map(statement => statement.sql).join('\n');
  assert.doesNotMatch(committedSql, /\bjournal_rules\b|\bchart_of_accounts\b|\baccount_id\b|\bDEBIT\b|\bCREDIT\b/i);
});

test('Accounting reads the committed sale snapshots instead of current Product Master cost or classification', async () => {
  const queries = [];
  const currentProductMaster = {
    productKindCode: 'NEW_KIND',
    productKindName: 'Jenis Baru',
    averageCostScaled: 999_000_000
  };
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          queries.push({ sql, values });
          return {
            async first() {
              if (/FROM sales/.test(sql)) {
                return {
                  id: 'sale_1',
                  total_amount: 45000,
                  payment_method: 'QRIS',
                  created_at: '2026-08-22T10:00:00.000Z',
                  note: 'snapshot test'
                };
              }
              throw new Error(`Unexpected first() query: ${sql}`);
            },
            async all() {
              if (/FROM sale_items/.test(sql)) {
                return {
                  results: [{
                    product_kind_id: 'kind_old',
                    product_kind_code: 'OLD_KIND',
                    product_kind_name: 'Jenis Saat Transaksi',
                    line_total: 45000,
                    line_cogs: 321_000_000
                  }]
                };
              }
              throw new Error(`Unexpected all() query: ${sql}`);
            }
          };
        }
      };
    }
  };

  const fact = await loadPosAccountingFact(db, 'store_1', 'SALE', 'sale_1');

  assert.equal(fact.paymentMethodCode, 'QRIS');
  assert.equal(fact.itemLines[0].productKindCode, 'OLD_KIND');
  assert.equal(fact.itemLines[0].productKindName, 'Jenis Saat Transaksi');
  assert.equal(fact.itemLines[0].lineCogsScaled, 321_000_000);
  assert.notEqual(fact.itemLines[0].productKindCode, currentProductMaster.productKindCode);
  assert.notEqual(fact.itemLines[0].productKindName, currentProductMaster.productKindName);
  assert.notEqual(fact.itemLines[0].lineCogsScaled, currentProductMaster.averageCostScaled);
  assert.equal(queries.some(({ sql }) => /FROM products\b/.test(sql)), false);
  assert.equal(queries.some(({ sql }) => /FROM product_kinds\b/.test(sql)), false);
});

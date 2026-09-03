import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildDrawerReport } from '../src/drawer-report.js';

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(statement => statement.run()); }
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function insertApprovalRequest(db, {
  id, drawerId, cashierId, requestType = 'GOODS_FLOW', postingStatus = 'posted', approvalStatus = 'approved', payload, postedAt
}) {
  db.prepare(`
    INSERT INTO approval_requests (
      id, store_id, drawer_session_id, cashier_id, request_type, approval_status, posting_status,
      payload_json, created_at, updated_at, posted_at
    ) VALUES (?, 'store_001', ?, ?, ?, ?, ?, ?, '2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', ?)
  `).run(id, drawerId, cashierId, requestType, approvalStatus, postingStatus, JSON.stringify(payload), postedAt || '2026-09-03T00:00:00.000Z');
}

test('drawer report surfaces posted stock adjustments (PENYESUAIAN STOK) for the drawer session', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_adj_a', 'store_001', ?, 100000, 'OPEN', '2026-09-03T00:00:00.000Z')
    `).run(cashier.id);

    insertApprovalRequest(db, {
      id: 'approval_adj_a', drawerId: 'drawer_adj_a', cashierId: cashier.id,
      payload: {
        purpose: 'STOCK_ADJUSTMENT', productId: 1, productName: 'Larutan Teh Poci Jasmine',
        unitSymbol: 'ml', currentQuantitySnapshot: 2000, targetQuantity: 1500,
        direction: 'OUT', quantity: 500, reason: 'Tumpah saat produksi'
      }
    });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_adj_a');
    assert.ok(report);
    assert.equal(report.sections.stockAdjustments.length, 1);
    const [row] = report.sections.stockAdjustments;
    assert.equal(row.productName, 'Larutan Teh Poci Jasmine');
    assert.equal(row.recordedStock, 2000);
    assert.equal(row.actualStock, 1500);
    assert.equal(row.difference, -500);
  } finally {
    db.close();
  }
});

test('drawer report excludes unposted stock adjustments and non-adjustment GOODS_FLOW/CASH_FLOW requests', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_adj_b', 'store_001', ?, 100000, 'OPEN', '2026-09-03T00:00:00.000Z')
    `).run(cashier.id);

    insertApprovalRequest(db, {
      id: 'approval_adj_pending', drawerId: 'drawer_adj_b', cashierId: cashier.id, postingStatus: 'unposted', approvalStatus: 'pending_approval',
      payload: { purpose: 'STOCK_ADJUSTMENT', productId: 1, productName: 'Belum diposting', currentQuantitySnapshot: 100, targetQuantity: 50 }
    });
    insertApprovalRequest(db, {
      id: 'approval_adj_goods_flow', drawerId: 'drawer_adj_b', cashierId: cashier.id,
      payload: { purpose: 'RESTOCK_TRANSFER', productId: 2, productName: 'Bukan penyesuaian' }
    });
    insertApprovalRequest(db, {
      id: 'approval_adj_cash', drawerId: 'drawer_adj_b', cashierId: cashier.id, requestType: 'CASH_FLOW',
      payload: { direction: 'IN', amount: 10000, description: 'Setoran' }
    });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_adj_b');
    assert.ok(report);
    assert.equal(report.sections.stockAdjustments.length, 0);
  } finally {
    db.close();
  }
});

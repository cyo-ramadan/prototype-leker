import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildDrawerReport } from '../src/drawer-report.js';

// Bos Cyo, 2026-09-23: "arus barang belum masuk ke laporan laci". Query di
// src/drawer-report.js SUDAH menarik semua approval_requests GOODS_FLOW yang
// posted (request_type = 'GOODS_FLOW'), tapi baris mapping-nya cuma
// meloloskan payload yang purpose-nya STOCK_ADJUSTMENT -- Arus Barang biasa
// (barang masuk/keluar, payload.purpose TIDAK PERNAH diisi untuk kasus ini,
// lihat normalizeApprovalPayload di src/operational-posting.js) ditarik dari
// database lalu dibuang diam-diam, tidak pernah dirender di mana pun.

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
    ) VALUES (?, 'store_001', ?, ?, ?, ?, ?, ?, '2026-09-23T00:00:00.000Z', '2026-09-23T00:00:00.000Z', ?)
  `).run(id, drawerId, cashierId, requestType, approvalStatus, postingStatus, JSON.stringify(payload), postedAt || '2026-09-23T00:00:00.000Z');
}

test('drawer report surfaces posted Arus Barang biasa (bukan Penyesuaian Stok) -- inilah bug yang dilaporkan Bos Cyo', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_goods_a', 'store_001', ?, 100000, 'OPEN', '2026-09-23T00:00:00.000Z')
    `).run(cashier.id);

    // Payload persis seperti yang dihasilkan normalizeApprovalPayload untuk
    // Arus Barang biasa -- TIDAK ADA field purpose sama sekali.
    insertApprovalRequest(db, {
      id: 'approval_goods_in', drawerId: 'drawer_goods_a', cashierId: cashier.id,
      payload: { productId: 1, productName: 'Cup Plastik 16oz', unitSymbol: 'pcs', direction: 'IN', quantity: 200, note: 'Kiriman dari gudang pusat' }
    });
    insertApprovalRequest(db, {
      id: 'approval_goods_out', drawerId: 'drawer_goods_a', cashierId: cashier.id,
      payload: { productId: 2, productName: 'Sedotan', unitSymbol: 'pcs', direction: 'OUT', quantity: 50, note: 'Dikirim ke gerai Dermo' }
    });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_goods_a');
    assert.ok(report);

    // Sebelum perbaikan, dua baris ini tertelan filter purpose === 'STOCK_ADJUSTMENT'
    // dan sections.goodsFlow bahkan belum ada sama sekali.
    assert.ok(Array.isArray(report.sections.goodsFlow), 'sections.goodsFlow wajib ada');
    assert.equal(report.sections.goodsFlow.length, 2, 'kedua Arus Barang biasa wajib muncul, bukan dibuang diam-diam');

    const [inRow, outRow] = report.sections.goodsFlow;
    assert.equal(inRow.productName, 'Cup Plastik 16oz');
    assert.equal(inRow.direction, 'IN');
    assert.equal(inRow.quantity, 200);
    assert.equal(inRow.unitSymbol, 'pcs');
    assert.equal(inRow.note, 'Kiriman dari gudang pusat');
    assert.equal(inRow.sharedAccountName, '', 'tidak dikaitkan Rekening Bersama -- wajib kosong, bukan undefined/null yang bikin UI error');

    assert.equal(outRow.productName, 'Sedotan');
    assert.equal(outRow.direction, 'OUT');
    assert.equal(outRow.quantity, 50);

    // Arus Barang biasa tidak boleh nyasar ke Penyesuaian Stok.
    assert.equal(report.sections.stockAdjustments.length, 0);
  } finally {
    db.close();
  }
});

test('Arus Barang yang dikaitkan Rekening Bersama menampilkan nama rekeningnya, bukan id mentah', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_goods_b', 'store_001', ?, 100000, 'OPEN', '2026-09-23T00:00:00.000Z')
    `).run(cashier.id);
    db.prepare(`
      INSERT INTO entity_shared_accounts (id, entity_id, name, is_active)
      VALUES ('sa_1', 'ENT-G001', 'Rekening Maxi Malang', 1)
    `).run();

    insertApprovalRequest(db, {
      id: 'approval_goods_shared', drawerId: 'drawer_goods_b', cashierId: cashier.id,
      payload: {
        productId: 1, productName: 'Cup Plastik 16oz', unitSymbol: 'pcs', direction: 'OUT', quantity: 100,
        sharedAccountId: 'sa_1', sharedAccountEntityId: 'ENT-G001',
        unitCostSnapshotScaled: 2_000_000, totalCostSnapshotScaled: 200_000_000, sharedAccountAmount: 200,
        note: 'Transfer ke gerai Dermo'
      }
    });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_goods_b');
    assert.equal(report.sections.goodsFlow.length, 1);
    assert.equal(report.sections.goodsFlow[0].sharedAccountName, 'Rekening Maxi Malang');
  } finally {
    db.close();
  }
});

test('Rekening Bersama yang sudah dihapus tetap ditampilkan dengan label jelas, bukan bikin laporan error', async () => {
  const db = migratedDatabase();
  try {
    const cashier = db.prepare("SELECT id FROM cashiers WHERE store_id = 'store_001' AND is_active = 1 ORDER BY id LIMIT 1").get();
    db.prepare(`
      INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
      VALUES ('drawer_goods_c', 'store_001', ?, 100000, 'OPEN', '2026-09-23T00:00:00.000Z')
    `).run(cashier.id);

    insertApprovalRequest(db, {
      id: 'approval_goods_deleted_account', drawerId: 'drawer_goods_c', cashierId: cashier.id,
      payload: {
        productId: 1, productName: 'Cup Plastik 16oz', unitSymbol: 'pcs', direction: 'OUT', quantity: 10,
        sharedAccountId: 'sa_sudah_hilang', note: ''
      }
    });

    const report = await buildDrawerReport(new D1Database(db), 'store_001', 'drawer_goods_c');
    assert.equal(report.sections.goodsFlow.length, 1);
    assert.equal(report.sections.goodsFlow[0].sharedAccountName, 'Rekening Bersama (sudah dihapus)');
  } finally {
    db.close();
  }
});

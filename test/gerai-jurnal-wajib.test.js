import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// ADR-054 (Bos Cyo, 2026-10-08): "setiap bikin tenant atau gerai baru wajib banget untuk konekin jurnal
// wajibnya". Dibuktikan ke D1 produksi: gerai yang dibuat belakangan (LAB01, PARFUM01) tidak punya
// akun 1202 Piutang Karyawan (trigger-nya hilang di produksi) dan aturan jurnal Beban Kasir
// ("operational", dulu hanya diisi sekali oleh migration 0035).

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  return db;
}

const kelengkapan = (db, storeId) => ({
  piutangKaryawan: db.prepare(`SELECT COUNT(*) n FROM chart_of_accounts WHERE store_id = ? AND code = '1202' AND is_active = 1`).get(storeId).n,
  bebanKasir: db.prepare(`
    SELECT r.side FROM journal_rules r JOIN transaction_categories t ON t.id = r.transaction_category_id
    WHERE t.store_id = ? AND t.code = 'operational' AND r.is_active = 1 ORDER BY r.side
  `).all(storeId).map(row => row.side)
});

test('Gerai baru dari panel Owner langsung punya Piutang Karyawan dan aturan jurnal Beban Kasir', async () => {
  const db = freshDb();
  try {
    // Keadaan produksi: trigger 1202 hilang.
    db.exec('DROP TRIGGER IF EXISTS trg_stores_employee_deposit_accounting_defaults_after_insert');
    db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_g', 'owner_g', 'x', 'Bos')`).run();
    db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_g', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-g'));
    const env = { DB: new D1Database(db) };
    const res = await worker.fetch(new Request('https://example.test/api/owner/stores', {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-g', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'BARU01', storeName: 'Gerai Baru', entityId: 'ENT-KPM' })
    }), env);
    assert.equal(res.status, 201, await res.clone().text());
    const storeId = (await res.json()).store.id;
    assert.deepEqual(kelengkapan(db, storeId), { piutangKaryawan: 1, bebanKasir: ['CREDIT', 'DEBIT'] });
  } finally { db.close(); }
});

test('Migration 0144 melengkapi gerai lama yang kurang, tanpa menggandakan aturan yang sudah dipasang akuntan', () => {
  const db = freshDb();
  try {
    db.exec('DROP TRIGGER IF EXISTS trg_stores_employee_deposit_accounting_defaults_after_insert');
    db.prepare(`INSERT INTO stores (id, code, store_name, address, logo_data, is_active, entity_id) VALUES ('store_kurang', 'KURANG', 'Kurang', '', '', 1, 'ENT-KPM')`).run();
    assert.deepEqual(kelengkapan(db, 'store_kurang'), { piutangKaryawan: 0, bebanKasir: [] });
    // Gerai yang aturannya sudah dipasang dengan id lain (mis. disalin dari gerai acuan).
    const pendemOps = db.prepare(`SELECT side FROM journal_rules r JOIN transaction_categories t ON t.id = r.transaction_category_id WHERE t.store_id = 'store_pendem' AND t.code = 'operational' AND r.is_active = 1`).all().length;

    const sql = readFileSync(new URL('0144_gerai_jurnal_wajib.sql', migrationDir), 'utf8');
    db.exec(sql);
    db.exec(sql); // aman dijalankan ulang
    assert.deepEqual(kelengkapan(db, 'store_kurang'), { piutangKaryawan: 1, bebanKasir: ['CREDIT', 'DEBIT'] });
    assert.equal(db.prepare(`SELECT side FROM journal_rules r JOIN transaction_categories t ON t.id = r.transaction_category_id WHERE t.store_id = 'store_pendem' AND t.code = 'operational' AND r.is_active = 1`).all().length, pendemOps);
    // Trigger 1202 kembali terpasang untuk gerai sesudahnya.
    db.prepare(`INSERT INTO stores (id, code, store_name, address, logo_data, is_active, entity_id) VALUES ('store_lanjut', 'LANJUT', 'Lanjut', '', '', 1, 'ENT-KPM')`).run();
    assert.equal(kelengkapan(db, 'store_lanjut').piutangKaryawan, 1);
  } finally { db.close(); }
});

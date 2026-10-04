import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createEmployeeDepositReceivable, listOwnEmployeeDeposits, postPendingEmployeeDepositJournals } from '../src/employee-deposit-settlement.js';

// Bos Cyo, 2026-10-03: "setoran cs belum konek ke akuntansi ya? harusnya selama
// cs belum setorin uang itu piutangnya terus nambah." Jembatan jurnalnya sudah
// ada, tapi di produksi 38 dari 40 akun kasir tidak tertaut ke karyawan sehingga
// setoran tidak pernah menimbulkan piutang. Sekarang tetap dicatat atas nama akun
// kasir, dan jurnal yang gagal dicoba ulang oleh sinkron otomatis.

const migrationDir = new URL('../migrations/', import.meta.url);
class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const r = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { this.db.exec('BEGIN'); try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
}
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort()) sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES ('kasir_setor', 'kasir_setor', 'x', 'Rina CS', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  return { sqlite, d1: new D1Database(sqlite) };
}
const journalLines = (sqlite, ref) => sqlite.prepare(`
  SELECT a.code, l.side, l.amount_scaled FROM accounting_journal_lines l
  JOIN accounting_journal_headers h ON h.id = l.journal_id JOIN chart_of_accounts a ON a.id = l.account_id
  WHERE h.source_system = 'EMPLOYEE_DEPOSIT' AND h.source_reference_id = ? ORDER BY l.side`).all(ref).map(r => [r.code, r.side, Number(r.amount_scaled)]);

test('akun kasir yang belum tertaut ke karyawan tetap menimbulkan piutang setoran dan jurnal Piutang Karyawan / Kas', async () => {
  const { sqlite, d1 } = setup();
  try {
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM employee_account_links').get().n, 0);
    const item = await createEmployeeDepositReceivable(d1, { storeId: 'store_kantor', cashierId: 'kasir_setor', drawerSessionId: 'laci_1', amountRupiah: 150000, transactionDate: '2026-10-03' });
    assert.ok(item, 'piutang dibuat walau akun belum tertaut');
    assert.equal(item.counterpartyName ?? item.counterparty_name_snapshot, 'Rina CS');
    assert.equal(item.accounting.ok, true);
    assert.deepEqual(journalLines(sqlite, item.id), [['1101', 'CREDIT', 150000 * 1_000_000], ['1202', 'DEBIT', 150000 * 1_000_000]]);

    // Setoran berikutnya menambah piutang; daftar milik akun itu memuat semuanya.
    await createEmployeeDepositReceivable(d1, { storeId: 'store_kantor', cashierId: 'kasir_setor', drawerSessionId: 'laci_2', amountRupiah: 80000, transactionDate: '2026-10-04' });
    const own = await listOwnEmployeeDeposits(d1, 'store_kantor', 'kasir_setor');
    assert.equal(own.length, 2);
  } finally { sqlite.close(); }
});

test('jurnal setoran yang gagal terposting dicoba ulang oleh sinkron otomatis, tanpa jurnal ganda', async () => {
  const { sqlite, d1 } = setup();
  try {
    // Piutang tersimpan tetapi jurnalnya gagal (mis. akun belum siap saat tutup laci).
    const entity = sqlite.prepare("SELECT entity_id FROM stores WHERE id = 'store_kantor'").get().entity_id;
    sqlite.prepare(`INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, description, original_amount, transaction_date)
      VALUES ('ORP_gagal', 'store_kantor', ?, 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', 'laci_1', 'cashier:kasir_setor', 'Rina CS', 'Setoran laci', ?, '2026-10-03')`).run(entity, 150000 * 1_000_000);
    assert.equal(journalLines(sqlite, 'ORP_gagal').length, 0);

    const first = await postPendingEmployeeDepositJournals(d1, 'store_kantor');
    assert.deepEqual(first.map(r => [r.factType, r.status]), [['SETORAN_PIUTANG', 'POSTED']]);
    assert.deepEqual(journalLines(sqlite, 'ORP_gagal'), [['1101', 'CREDIT', 150000 * 1_000_000], ['1202', 'DEBIT', 150000 * 1_000_000]]);
    assert.deepEqual(await postPendingEmployeeDepositJournals(d1, 'store_kantor'), [], 'sudah terjurnal -> tidak diulang');
  } finally { sqlite.close(); }
});

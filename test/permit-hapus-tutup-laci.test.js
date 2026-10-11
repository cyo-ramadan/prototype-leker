import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { CATATAN_GAGAL_TUTUP_LACI, gagalkanPermitHapusSaatTutupLaci } from '../src/permit-hapus-tutup-laci.js';

// Bos Cyo, 2026-10-11: izin hapus transaksi yang belum di-ACC saat CS tutup laci -> otomatis gagal;
// penyesuaian sesudahnya lewat Admin.

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
}

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

function seed(raw) {
  const store = raw.prepare('SELECT id FROM stores WHERE is_active = 1 LIMIT 1').get().id;
  raw.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES ('cs_uji', 'cs_uji', 'x', 'CS Uji', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(store);
  // Satu gerai hanya boleh punya satu laci OPEN; laci_b = laci kemarin yang sudah ditutup.
  for (const [drawer, status] of [['laci_a', 'OPEN'], ['laci_b', 'CLOSED']]) {
    raw.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, status, opened_at) VALUES (?, ?, 'cs_uji', ?, '2026-10-11T01:00:00Z')`).run(drawer, store, status);
  }
  const permit = (id, drawer, status) => {
    raw.prepare(`INSERT INTO sales (id, store_id, drawer_session_id, cashier_id, total_amount, created_at) VALUES (?, ?, ?, 'cs_uji', 10000, '2026-10-11T02:00:00Z')`).run(`sale_${id}`, store, drawer);
    raw.prepare(`INSERT INTO approval_permits (id, store_id, drawer_session_id, cashier_id, permit_type, subject_type, subject_id,
        subject_snapshot_json, reason, approval_status, requested_at, updated_at)
      VALUES (?, ?, ?, 'cs_uji', 'TRANSACTION_VOID', 'SALE', ?, '{}', 'salah input', ?, '2026-10-11T03:00:00Z', '2026-10-11T03:00:00Z')`)
      .run(id, store, drawer, `sale_${id}`, status);
  };
  permit('p_menunggu_1', 'laci_a', 'pending_approval');
  permit('p_menunggu_2', 'laci_a', 'pending_approval');
  permit('p_sudah_acc', 'laci_a', 'approved');
  permit('p_laci_lain', 'laci_b', 'pending_approval');
}

test('tutup laci: semua izin hapus yang masih menunggu di laci itu otomatis gagal, yang lain tidak tersentuh', async () => {
  const raw = migratedDatabase();
  seed(raw);
  const jumlah = await gagalkanPermitHapusSaatTutupLaci(new D1Database(raw), 'laci_a', '2026-10-11T10:00:00Z');
  assert.equal(jumlah, 2);
  const status = Object.fromEntries(raw.prepare('SELECT id, approval_status FROM approval_permits').all().map(r => [r.id, r.approval_status]));
  assert.deepEqual(status, { p_menunggu_1: 'rejected', p_menunggu_2: 'rejected', p_sudah_acc: 'approved', p_laci_lain: 'pending_approval' });
  const gagal = raw.prepare("SELECT decision_note, approved_by_role, decided_at FROM approval_permits WHERE id = 'p_menunggu_1'").get();
  assert.equal(gagal.decision_note, CATATAN_GAGAL_TUTUP_LACI);
  assert.equal(gagal.approved_by_role, 'SYSTEM_DRAWER_CLOSED');
  assert.equal(gagal.decided_at, '2026-10-11T10:00:00Z');
  // transaksinya tidak dihapus
  assert.equal(raw.prepare("SELECT voided_at FROM sales WHERE id = 'sale_p_menunggu_1'").get().voided_at, null);
});

test('memanggil ulang tidak mengubah apa-apa lagi', async () => {
  const raw = migratedDatabase();
  seed(raw);
  const db = new D1Database(raw);
  await gagalkanPermitHapusSaatTutupLaci(db, 'laci_a');
  assert.equal(await gagalkanPermitHapusSaatTutupLaci(db, 'laci_a'), 0);
  assert.equal(await gagalkanPermitHapusSaatTutupLaci(db, null), 0);
});

test('SEMUA jalur tutup laci memanggil penggagal izin hapus', () => {
  const src = readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js'));
  const penutup = src.filter(name => /UPDATE cash_drawer_sessions[\s\S]{0,200}?status = 'CLOSED'/.test(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')));
  assert.deepEqual(penutup.sort(), ['cashier-drawer-close-permit.js', 'cashier-drawer.js'], 'jalur tutup laci baru? panggil gagalkanPermitHapusSaatTutupLaci di sana lalu perbarui daftar ini');
  for (const name of penutup) {
    assert.match(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'), /await gagalkanPermitHapusSaatTutupLaci\(db, /, `${name} belum menggagalkan izin hapus`);
  }
});

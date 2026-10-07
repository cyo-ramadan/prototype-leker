import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUnifiedLoginApi } from '../src/unified-login.js';

// Bos Cyo, 2026-10-07: "ketika login dia landing di portal staff (ga wajib harus presensi dulu) tapi tetep
// dia ga bisa entry apapun sebelum dia presensi, hanya setor uang saja yang bisa di-entry saat belum presensi".

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

async function loginKasir(db) {
  const response = await handleUnifiedLoginApi(
    new Request('https://example.test/api/auth/staff-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'kasir_kantor', password: 'kasir_kantor123' })
    }),
    { DB: new D1Database(db) }, '/api/auth/staff-login'
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.role, 'CASHIER');
  return body;
}

function setSkin(db, choice) {
  const entityId = db.prepare(`SELECT entity_id FROM stores WHERE id = 'store_kantor'`).get().entity_id;
  const tenantId = db.prepare(`SELECT tenant_id FROM entity_tenancy WHERE entity_id = ? AND effective_to IS NULL`).get(entityId).tenant_id;
  db.prepare(`DELETE FROM tenant_policy_settings WHERE tenant_id = ? AND setting_key = 'ui_skin'`).run(tenantId);
  if (choice) {
    db.prepare(`INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id) VALUES (?, 'ui_skin', ?, 'OWNER', 'test')`).run(tenantId, choice);
  }
}

test('kasir yang login mendarat di Portal Staf (tanpa wajib presensi dulu)', async () => {
  const db = migratedDatabase();
  try {
    for (const choice of [null, '0', 'A', 'D']) {
      setSkin(db, choice);
      assert.equal((await loginKasir(db)).redirect, '/staff', `skin ${choice ?? 'bawaan'}`);
    }
  } finally { db.close(); }
});

test('skin E/F tanpa presensi tetap langsung ke Kasir seperti sebelumnya', async () => {
  const db = migratedDatabase();
  try {
    for (const choice of ['E', 'F']) {
      setSkin(db, choice);
      assert.equal((await loginKasir(db)).redirect, '/cashier', `skin ${choice}`);
    }
  } finally { db.close(); }
});

test('peran lain tidak ikut berubah arahnya', () => {
  const source = readFileSync(new URL('../src/unified-login.js', import.meta.url), 'utf8');
  assert.match(source, /if \(match\.role === 'CASHIER'\) spec\.redirect = await cashierLandingPath/);
  assert.match(source, /redirect: '\/admin'/);
  assert.match(source, /redirect: '\/entity-admin'/);
});

test('entry tetap tertahan sebelum presensi: layar Kasir menahan, server menolak buka laci', () => {
  const gate = readFileSync(new URL('../public/cashier-presensi-gate.js', import.meta.url), 'utf8');
  assert.match(gate, /if \(attendanceStatus === 'in' \|\| state\.cashier\?\.store\?\.attendanceOptional\)/);
  const drawer = readFileSync(new URL('../src/cashier-drawer.js', import.meta.url), 'utf8');
  assert.match(drawer, /await latestAttendanceStatus\(db, cashier\.id\) !== 'in'/);
});

test('setor uang di Portal Staf tidak butuh presensi', () => {
  const deposits = readFileSync(new URL('../src/employee-deposit-settlement.js', import.meta.url), 'utf8');
  const submit = deposits.slice(deposits.indexOf('const submitMatch'), deposits.indexOf('return json(result, 201)'));
  assert.ok(submit.length > 200);
  assert.doesNotMatch(submit, /attendance|presensi/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierOperationalExpenseApi } from '../src/cashier-operational-expense.js';
import { hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const transactionUi = readFileSync(new URL('../public/cashier-payment-methods.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

// Bos Cyo, 2026-09-21: "harusnya kan itu milih dari master biaya ya dengan
// cara search, tapi bikin itu editable untuk nama qty dan harganya...
// intinya nama yang ga ada di master biaya menjadi biaya lainnya." Kategori
// Biaya (Master Biaya, dipilih lewat search -- tidak berubah) tetap wajib;
// Keterangan Biaya (teks bebas, baru) boleh beda, dan begitu beda Kategori
// efektifnya otomatis pindah ke "Biaya Lainnya" -- kategori catch-all yang
// migration 0113 auto-seed di SETIAP gerai (lama maupun baru).

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

async function cashierFixture(db, storeId) {
  const cashier = db.prepare('SELECT id, store_id FROM cashiers WHERE store_id = ? AND is_active = 1 ORDER BY id LIMIT 1').get(storeId);
  assert.ok(cashier, `cashier seed required for ${storeId}`);
  const token = `operational-expense-category-test-${storeId}`;
  const tokenHash = await hashCredential(token);
  db.prepare('INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, cashier.id, '2026-09-21T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
  db.prepare(`
    INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at)
    VALUES (?, ?, ?, 100000, 'OPEN', '2026-09-21T00:00:00.000Z')
  `).run(`drawer_operational_category_${storeId}`, storeId, cashier.id);
  return { cashier, token };
}

function expenseRequest(token, body) {
  return new Request('https://example.test/api/cashier/expenses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('every store (seeded and freshly created) automatically has a "Biaya Lainnya" catch-all Kategori Biaya', () => {
  const db = migratedDatabase();
  try {
    const seededStores = db.prepare('SELECT id FROM stores').all();
    assert.ok(seededStores.length > 0);
    for (const store of seededStores) {
      const master = db.prepare("SELECT id, cost_type_id, is_active FROM cost_masters WHERE store_id = ? AND name = 'Biaya Lainnya'").get(store.id);
      assert.ok(master, `store ${store.id} must have an auto-seeded Biaya Lainnya`);
      assert.equal(master.is_active, 1);
      const type = db.prepare('SELECT is_active FROM cost_types WHERE id = ?').get(master.cost_type_id);
      assert.ok(type, 'Biaya Lainnya must reference an existing active Jenis Biaya');
      assert.equal(type.is_active, 1);
    }

    // Gerai baru (dibuat setelah migration ini applied) juga harus otomatis dapat -- lewat trigger, bukan cuma backfill sekali jalan.
    db.prepare(`INSERT INTO stores (id, code, store_name) VALUES ('store_operational_category_new', 'NEWSTORE', 'Gerai Baru')`).run();
    const newMaster = db.prepare("SELECT id FROM cost_masters WHERE store_id = 'store_operational_category_new' AND name = 'Biaya Lainnya'").get();
    assert.ok(newMaster, 'trigger must seed Biaya Lainnya for a store created after migration 0113');
  } finally {
    db.close();
  }
});

test('expense items keep old behavior when no description override is sent, and persist cost_master_id for traceability', async () => {
  const db = migratedDatabase();
  try {
    const costMaster = db.prepare("SELECT id, name FROM cost_masters WHERE store_id = 'store_001' AND is_active = 1 AND name <> 'Biaya Lainnya' ORDER BY id LIMIT 1").get();
    assert.ok(costMaster, 'G001 Cost Master seed required');
    const { token } = await cashierFixture(db, 'store_001');

    const response = await handleCashierOperationalExpenseApi(
      expenseRequest(token, { paymentMethod: 'CASH', items: [{ costMasterId: costMaster.id, quantity: 2, unitAmount: 5000 }] }),
      { DB: new D1Database(db) }, '/api/cashier/expenses'
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.items[0].name, costMaster.name, 'description defaults to the Kategori name exactly like before');

    const row = db.prepare('SELECT description, cost_master_id FROM expenses WHERE id = ?').get(body.id);
    assert.equal(row.description, costMaster.name);
    assert.equal(row.cost_master_id, costMaster.id);
  } finally {
    db.close();
  }
});

test('a custom description is stored verbatim while cost_master_id still traces back to whichever Kategori was actually submitted', async () => {
  const db = migratedDatabase();
  try {
    const lainnya = db.prepare("SELECT id FROM cost_masters WHERE store_id = 'store_001' AND name = 'Biaya Lainnya'").get();
    assert.ok(lainnya);
    const { token } = await cashierFixture(db, 'store_001');

    const response = await handleCashierOperationalExpenseApi(
      expenseRequest(token, {
        paymentMethod: 'CASH',
        items: [{ costMasterId: lainnya.id, quantity: 1, unitAmount: 25000, description: 'Tarikan Sampah RT 03' }]
      }),
      { DB: new D1Database(db) }, '/api/cashier/expenses'
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.items[0].name, 'Tarikan Sampah RT 03');

    const row = db.prepare('SELECT description, cost_master_id FROM expenses WHERE id = ?').get(body.id);
    assert.equal(row.description, 'Tarikan Sampah RT 03');
    assert.equal(row.cost_master_id, lainnya.id, 'category link is whatever costMasterId the client sent (already snapped to Biaya Lainnya client-side), not guessed server-side from the free text');
  } finally {
    db.close();
  }
});

test('an empty/whitespace-only description falls back to the Kategori name, matching the no-override path', async () => {
  const db = migratedDatabase();
  try {
    const costMaster = db.prepare("SELECT id, name FROM cost_masters WHERE store_id = 'store_001' AND is_active = 1 AND name <> 'Biaya Lainnya' ORDER BY id LIMIT 1").get();
    const { token } = await cashierFixture(db, 'store_001');

    const response = await handleCashierOperationalExpenseApi(
      expenseRequest(token, { paymentMethod: 'CASH', items: [{ costMasterId: costMaster.id, quantity: 1, unitAmount: 1000, description: '   ' }] }),
      { DB: new D1Database(db) }, '/api/cashier/expenses'
    );
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.items[0].name, costMaster.name);
  } finally {
    db.close();
  }
});

test('cashier UI: Kategori Biaya stays search-only, Keterangan Biaya is a separate editable field, and mismatches snap to Biaya Lainnya', () => {
  assert.match(transactionUi, /itemLabel: 'Kategori Biaya'/);
  assert.match(transactionUi, /id="operationalDescriptionEditor"/);
  assert.match(transactionUi, /data-operational-description/);
  assert.match(transactionUi, /fallbackCost = costs\.find\(cost => String\(cost\.name\)\.trim\(\)\.toLowerCase\(\) === 'biaya lainnya'\)/);
  assert.match(transactionUi, /const overridden = Boolean\(custom\) && custom\.toLowerCase\(\) !== line\.label\.trim\(\)\.toLowerCase\(\)/);
  assert.match(transactionUi, /renderDescriptionEditor\(lines\)/);
  // PIMASATU sendiri tetap tidak tahu apa-apa soal "Biaya Lainnya"/cost
  // master -- logic snap ada di cashier-payment-methods.js, bukan di dalam
  // komponen generic-nya (contracts/pimasatu-ui-v1.md).
  const pimasatuUi = readFileSync(new URL('../public/pimasatu-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(pimasatuUi, /biaya lainnya|costMaster/i);
  assert.match(cashierHtml, /cashier-payment-methods\.js\?v=[\w.-]+/);
});

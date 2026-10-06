import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { requireCashier } from '../src/cashier-auth.js';
import { validateDirectLines } from '../src/cashier-sales-tracking.js';
import { hashCredential } from '../src/owner-auth.js';
import { UI_SKIN_KEY, setTenantPolicySetting, isRacikChoice, isOwnerOperatedChoice } from '../src/tenant-policy.js';
import { resolveUiProfile } from '../src/ui-profile.js';

// Skin F "Racik Parfum" (Bos Cyo 2026-10-06) -- DESAIN-SKIN-F-RACIK-PARFUM.md.
// Aturan server yang berubah cuma satu: kasir boleh mengubah harga jual, dan
// perubahannya tercatat. Tenant lain: harga dari klien diabaikan.

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

async function seedCashier(db, storeId, username) {
  const id = `cashier_test_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')
  `).run(id, username, username, storeId);
  const token = `token-${username}`;
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-10-02T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return { id, token };
}

function tenantOf(db, storeId) {
  return db.prepare(`
    SELECT et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL WHERE s.id = ?
  `).get(storeId).tenant_id;
}


const products = [{ id: 1, name: 'Bubble Gum 50 ml', price: 120000 }];

test('skin F: flag ubah harga hanya menyala di tenant Racik Parfum', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const cashier = await seedCashier(db, 'store_001', 'racik');
    const auth = () => requireCashier(new Request('https://example.test/api/cashier/sales', { headers: { Authorization: `Bearer ${cashier.token}` } }), env.DB);
    assert.equal((await auth()).cashier.store.priceOverrideAllowed, false);
    await setTenantPolicySetting(env.DB, tenantOf(db, 'store_001'), UI_SKIN_KEY, 'F', { role: 'OWNER', id: 'test' });
    const racik = await auth();
    assert.equal(racik.cashier.store.priceOverrideAllowed, true);
    assert.equal(racik.cashier.store.ownerOperated, false, 'F tidak ikut melepas absen seperti E');
  } finally {
    db.close();
  }
});

test('skin F: harga jual boleh diubah dan perubahannya tercatat di baris', () => {
  const result = validateDirectLines(products, [{ productId: 1, quantity: 2, unitPrice: 110000 }], { allowPriceOverride: true });
  assert.equal(result.ok, true);
  assert.equal(result.total, 220000);
  assert.equal(result.lines[0].unitPrice, 110000);
  assert.match(result.lines[0].note, /Harga daftar Rp120\.000 → dijual Rp110\.000/);

  const same = validateDirectLines(products, [{ productId: 1, quantity: 1, unitPrice: 120000 }], { allowPriceOverride: true });
  assert.equal(same.lines[0].note, '', 'harga sama tidak perlu catatan');
  const free = validateDirectLines(products, [{ productId: 1, quantity: 1, unitPrice: 0 }], { allowPriceOverride: true });
  assert.equal(free.total, 0);

  for (const bad of [-1, 1.5, 'abc', 100_000_001]) {
    assert.equal(validateDirectLines(products, [{ productId: 1, quantity: 1, unitPrice: bad }], { allowPriceOverride: true }).ok, false, `harga ${bad} harus ditolak`);
  }
});

test('tenant lain: unitPrice dari klien diabaikan, harga tetap dari katalog', () => {
  const result = validateDirectLines(products, [{ productId: 1, quantity: 1, unitPrice: 1 }]);
  assert.equal(result.ok, true);
  assert.equal(result.total, 120000);
  assert.equal(result.lines[0].note, '');
});

test('jalur penjualan langsung meneruskan izin dari server, bukan dari body', () => {
  const source = readFileSync(new URL('../src/cashier-sales-tracking.js', import.meta.url), 'utf8');
  assert.match(source, /allowPriceOverride: auth\.cashier\.store\?\.priceOverrideAllowed === true/);
  assert.match(source, /priceNotes/);
});

test('skin F dipetakan ke data-skin "f"; bukan jaga sendiri', async () => {
  assert.equal(isRacikChoice('F'), true);
  for (const choice of ['0', 'A', 'B', 'C', 'D', 'E']) assert.equal(isRacikChoice(choice), false);
  assert.equal(isOwnerOperatedChoice('F'), false);
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    await setTenantPolicySetting(env.DB, tenantOf(db, 'store_001'), UI_SKIN_KEY, 'F', { role: 'OWNER', id: 'test' });
    const profile = await resolveUiProfile(env.DB, { storeCode: db.prepare("SELECT code FROM stores WHERE id = 'store_001'").get().code });
    assert.equal(profile.skin, 'f');
  } finally {
    db.close();
  }
});

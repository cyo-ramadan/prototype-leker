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

test('migration 0140: tenant baru Toko Parfum langsung memakai skin F', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    assert.equal((await resolveUiProfile(env.DB, { storeCode: 'PARFUM01' })).skin, 'f');
    const admin = db.prepare(`SELECT entity_id, is_active FROM entity_admins WHERE username = 'parfum_pemilik'`).get();
    assert.equal(admin.entity_id, 'ENT-PARFUM');
    assert.equal(admin.is_active, 1);
    assert.equal(db.prepare(`SELECT tenant_id FROM entity_tenancy WHERE entity_id = 'ENT-PARFUM' AND effective_to IS NULL`).get().tenant_id, 'TEN-PARFUM');
  } finally {
    db.close();
  }
});

test('layar Racik: /s/<kode>/racik, hanya jalur kasir yang sudah ada, tanpa polling', async () => {
  const { assetRoute } = await import('../src/index.js');
  assert.equal(assetRoute('/s/PARFUM01/racik'), '/racik');
  assert.equal(assetRoute('/s/PARFUM01/racik/'), '/racik');
  const js = readFileSync(new URL('../public/racik.js', import.meta.url), 'utf8');
  const endpoints = new Set([...js.matchAll(/'(\/api\/[^'?]+)'/g)].map(match => match[1]));
  assert.deepEqual([...endpoints].sort(), [
    '/api/cashier/drawer', '/api/cashier/logout', '/api/cashier/me', '/api/cashier/menu',
    '/api/cashier/production', '/api/cashier/production/options', '/api/cashier/sales', '/api/cashier/workspace'
  ]);
  // Botol sudah diproduksi -> dijual dari stok, bahan tidak terpotong dua kali.
  assert.match(js, /productionMode: 'STOCK'/);
  assert.doesNotMatch(js, /setInterval/);
  // Draft & racikan terakhir di HP/tablet ini, per gerai.
  assert.match(js, /maxiRacikDrafts:\$\{storeCode\(\)\}/);
  assert.match(js, /maxiRacikLast:\$\{storeCode\(\)\}/);
  // Gagal bayar setelah botol diracik: draft tetap ada di tahap "diracik".
  assert.match(js, /draft\.stage = 'diracik'/);
  const css = readFileSync(new URL('../public/racik.css', import.meta.url), 'utf8');
  assert.match(css, /@media print/);
  assert.match(css, /size: 58mm auto/);
  const html = readFileSync(new URL('../public/racik.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/racik\.js\?v=[^"]+"><\/script>/);
  assert.match(readFileSync(new URL('../public/ui-skin.js', import.meta.url), 'utf8'), /\bf: 'family=Fraunces/);
  assert.match(readFileSync(new URL('../package.json', import.meta.url), 'utf8'), /node --check public\/racik\.js/);
});

test('skin F Workspace Gerai: tab "Bahan & Aroma" -- sedikit isian wajib, sisanya default, endpoint lama', () => {
  const js = readFileSync(new URL('../public/racik-admin.js', import.meta.url), 'utf8');
  assert.match(js, /const isOn = \(\) => window\.MaxiSkin\?\.skin\?\.\(\) === 'f'/);
  const endpoints = new Set([...js.matchAll(/'(\/api\/[^'?]+)'/g)].map(match => match[1]));
  assert.deepEqual([...endpoints].sort(), [
    '/api/admin/bootstrap', '/api/admin/manufacturing/bootstrap', '/api/admin/manufacturing/recipes', '/api/admin/products'
  ]);
  assert.match(js, /\/api\/admin\/manufacturing\/products\/\$\{created\.id\}/);
  // Default yang tidak perlu diisi pemilik.
  assert.match(js, /unit: 'ML'/);
  assert.match(js, /category: 'Bahan'/);
  assert.match(js, /category: 'Parfum'/);
  assert.match(js, /outputQuantity: 1/);
  assert.match(js, /digits\(\$\('rbMaterialCost'\)\.value\) \?\? 0/);
  assert.doesNotMatch(js, /setInterval/);
  const html = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/racik-admin\.js\?v=[^"]+"><\/script>/);
  // Una tetap ada di Workspace Gerai.
  assert.match(html, /<script src="\/caca-chat\.js\?v=[^"]+"><\/script>/);
  const nav = readFileSync(new URL('../public/nav-groups.js', import.meta.url), 'utf8');
  assert.match(nav, /items: \['racikbahan', \.\.\.group\.items\]/);
  assert.match(nav, /racikbahan: 'Bahan & Aroma'/);
});

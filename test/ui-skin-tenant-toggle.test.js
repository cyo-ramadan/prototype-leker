import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUiProfileApi, PRODUCT_BRAND_NAME } from '../src/ui-profile.js';
import { readdirSync as listDir } from 'node:fs';
import { UI_SKIN_KEY, listTenantPolicySettings, setTenantPolicySetting } from '../src/tenant-policy.js';
import { handleOwnerApi, hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const r = this.db.prepare(this.sql).run(...this.params); return { meta: { changes: Number(r.changes || 0) } }; }
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

async function profile(env, query) {
  const response = await handleUiProfileApi(new Request(`https://example.test/api/ui-profile?${query}`), env, '/api/ui-profile');
  assert.equal(response.status, 200);
  return response.json();
}

test('migration 0132/0133 creates the Lab Tampilan tenant with one store, an owner login, and skin A only for Lab', () => {
  const db = migratedDatabase();
  try {
    assert.equal(db.prepare(`SELECT name FROM tenants WHERE id = 'TEN-LAB-TAMPILAN'`).get()?.name, 'Lab Tampilan');
    const store = db.prepare(`
      SELECT s.code, et.tenant_id FROM stores s
      JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL
      WHERE s.code = 'LAB01'
    `).get();
    assert.equal(store?.tenant_id, 'TEN-LAB-TAMPILAN');
    assert.equal(db.prepare(`SELECT entity_id FROM entity_admins WHERE username = 'lab_pemilik'`).get()?.entity_id, 'ENT-LAB-TAMPILAN');
    const setting = db.prepare(`SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = 'TEN-LAB-TAMPILAN' AND setting_key = ?`).get(UI_SKIN_KEY);
    assert.equal(setting?.setting_value, 'A');
    // Tidak ada tenant lain yang ikut berubah tampilan -- kecuali tenant baru
    // Toko Parfum yang memang dibuat langsung dengan skin F (migration 0140).
    assert.deepEqual(db.prepare(`SELECT tenant_id, setting_value FROM tenant_policy_settings WHERE setting_key = ? ORDER BY tenant_id`).all(UI_SKIN_KEY)
      .map(row => `${row.tenant_id}:${row.setting_value}`), ['TEN-LAB-TAMPILAN:A', 'TEN-PARFUM:F']);
  } finally {
    db.close();
  }
});

test('ui-profile follows the tenant choice 0/A/B/C; other tenants stay on 0 (tampilan sekarang)', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    assert.deepEqual(await profile(env, 'store=LAB01'), { skin: 'a', brandName: PRODUCT_BRAND_NAME });
    assert.deepEqual(await profile(env, 'store=G001'), { skin: 'classic', brandName: PRODUCT_BRAND_NAME });
    assert.deepEqual(await profile(env, 'entity=ENT-LAB-TAMPILAN'), { skin: 'a', brandName: PRODUCT_BRAND_NAME });
    assert.deepEqual(await profile(env, ''), { skin: 'classic', brandName: PRODUCT_BRAND_NAME });

    for (const [choice, skin] of [['B', 'b'], ['C', 'c'], ['0', 'classic'], ['A', 'a']]) {
      await setTenantPolicySetting(env.DB, 'TEN-LAB-TAMPILAN', UI_SKIN_KEY, choice, { role: 'OWNER', id: 'test' });
      assert.equal((await profile(env, 'store=LAB01')).skin, skin, `pilihan ${choice}`);
    }
    // Nilai asing tidak pernah tersimpan sebagai skin.
    await setTenantPolicySetting(env.DB, 'TEN-LAB-TAMPILAN', UI_SKIN_KEY, 'Z', { role: 'OWNER', id: 'test' });
    assert.equal((await profile(env, 'store=LAB01')).skin, 'classic');
    assert.equal((await profile(env, 'store=G001')).skin, 'classic');
  } finally {
    db.close();
  }
});

test('Owner panel lists the skin choice (default 0) and rejects unknown options', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const leker = await listTenantPolicySettings(env.DB, 'TEN-PROTOTYPE');
    const skin = leker.find(item => item.key === UI_SKIN_KEY);
    assert.equal(skin?.type, 'choice');
    assert.equal(skin?.value, '0');
    assert.deepEqual(skin.options.map(option => option.value), ['0', 'A', 'B', 'C', 'D', 'E', 'F']);

    const owner = db.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
    db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-10-01T00:00:00Z', '2099-01-01T00:00:00Z')`)
      .run(await hashCredential('skin-owner-token'), owner.id);
    const patch = value => handleOwnerApi(new Request('https://example.test/api/owner/tenants/TEN-PROTOTYPE/policy-settings', {
      method: 'PATCH', headers: { Authorization: 'Bearer skin-owner-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ key: UI_SKIN_KEY, value })
    }), env, '/api/owner/tenants/TEN-PROTOTYPE/policy-settings');
    assert.equal((await patch('X')).status, 400);
    const ok = await patch('B');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).settings.find(item => item.key === UI_SKIN_KEY).value, 'B');
  } finally {
    db.close();
  }
});

test('three skin stylesheets exist and only apply under their own html[data-skin]', () => {
  for (const code of ['a', 'b', 'c', 'd', 'e']) {
    const css = readFileSync(new URL(`../public/skin-${code}.css`, import.meta.url), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').split('}').map(rule => rule.trim()).filter(Boolean);
    for (const rule of rules) {
      const selectors = rule.split('{')[0].split(',').map(part => part.trim()).filter(Boolean);
      for (const selector of selectors) assert.ok(selector.startsWith(`html[data-skin="${code}"]`), `skin-${code}.css: selector bocor ke tenant lain: ${selector}`);
    }
  }
});

test('skin script is loaded on every tenant-facing page', () => {
  for (const page of ['cashier', 'staff', 'branch-admin', 'entity-admin', 'customer']) {
    const html = readFileSync(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /<script src="\/ui-skin\.js\?v=[^"]+"><\/script>/, `${page}.html must load ui-skin.js`);
  }
});

test('T1 handoff UI/UX berlaku untuk SEMUA tenant: tanpa "Prototype", tanpa catatan developer, tanpa "segera hadir"', () => {
  const publicDir = new URL('../public/', import.meta.url);
  const files = listDir(publicDir).filter(name => /\.(html|js)$/.test(name) && name !== 'ui-skin.js');
  const banned = [
    /<title>[^<]*Prototype/i,
    /modul Masak pada prototype/,
    /Karen (sengaja|tidak overwrite)/,
    /canonical <code>inventory_stock_balances/,
    /operasi tersendiri per ADR-030/,
    /earn\/redeem belum diaktifkan/,
    /segera hadir/,
    /Status PROVISIONAL sampai terhubung/,
    /Legacy \/ tracking off/,
    /ditolak (otomatis )?sebagai stale/,
    /Stale-snapshot guard/,
    /Renderer detail/,
    /Coming next/i,
    /Structure level/i,
    /MAXI LEKER|MAXI Leker ·|<title>MAXI Leker/,
    /Pilih leker|leker jangan|Belum ada leker|menyiapkan leker/
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, publicDir), 'utf8');
    for (const pattern of banned) assert.doesNotMatch(source, pattern, `${file} masih memuat ${pattern}`);
  }
  // Perubahan T1 tidak boleh bersembunyi di balik saklar skin Lab.
  const drawerUi = readFileSync(new URL('drawer-report-ui.js', publicDir), 'utf8');
  assert.match(drawerUi, /'Belum ada catatan masak\.'/);
  assert.doesNotMatch(drawerUi, /MaxiSkin/);
});

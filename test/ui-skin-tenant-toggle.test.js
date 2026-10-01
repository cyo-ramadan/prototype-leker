import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleUiProfileApi, PRODUCT_BRAND_NAME } from '../src/ui-profile.js';
import { UI_SKIN_SIAP_JUAL_KEY, listTenantPolicySettings, setTenantPolicySetting } from '../src/tenant-policy.js';

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

test('migration 0132 creates the Lab Tampilan tenant with one store, an owner login, and the skin switched ON', () => {
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
    const setting = db.prepare(`SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = 'TEN-LAB-TAMPILAN' AND setting_key = ?`).get(UI_SKIN_SIAP_JUAL_KEY);
    assert.equal(setting?.setting_value, '1');
    // Tidak ada tenant lain yang ikut dinyalakan.
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM tenant_policy_settings WHERE setting_key = ?`).get(UI_SKIN_SIAP_JUAL_KEY).n, 1);
  } finally {
    db.close();
  }
});

test('ui-profile: Lab store gets the new skin; Leker store stays classic; toggling the tenant switch flips it', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    assert.deepEqual(await profile(env, 'store=LAB01'), { skin: 'siap-jual', brandName: PRODUCT_BRAND_NAME });
    assert.deepEqual(await profile(env, 'store=G001'), { skin: 'classic', brandName: null });
    assert.deepEqual(await profile(env, 'entity=ENT-LAB-TAMPILAN'), { skin: 'siap-jual', brandName: PRODUCT_BRAND_NAME });
    assert.deepEqual(await profile(env, ''), { skin: 'classic', brandName: null });

    await setTenantPolicySetting(env.DB, 'TEN-LAB-TAMPILAN', UI_SKIN_SIAP_JUAL_KEY, false, { role: 'OWNER', id: 'test' });
    assert.equal((await profile(env, 'store=LAB01')).skin, 'classic');

    const lekerTenant = db.prepare(`
      SELECT et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL
      WHERE s.code = 'G001'
    `).get().tenant_id;
    await setTenantPolicySetting(env.DB, lekerTenant, UI_SKIN_SIAP_JUAL_KEY, true, { role: 'OWNER', id: 'test' });
    assert.equal((await profile(env, 'store=G001')).skin, 'siap-jual');
  } finally {
    db.close();
  }
});

test('the switch shows up in the Owner tenant policy panel and defaults OFF for existing tenants', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const leker = await listTenantPolicySettings(env.DB, 'TEN-PROTOTYPE');
    assert.equal(leker.find(item => item.key === UI_SKIN_SIAP_JUAL_KEY)?.value, false);
    const lab = await listTenantPolicySettings(env.DB, 'TEN-LAB-TAMPILAN');
    assert.equal(lab.find(item => item.key === UI_SKIN_SIAP_JUAL_KEY)?.value, true);
  } finally {
    db.close();
  }
});

test('skin script is loaded on every tenant-facing page, and T1 copy only changes behind the switch', () => {
  for (const page of ['cashier', 'staff', 'branch-admin', 'entity-admin', 'customer']) {
    const html = readFileSync(new URL(`../public/${page}.html`, import.meta.url), 'utf8');
    assert.match(html, /<script src="\/ui-skin\.js\?v=[^"]+"><\/script>/, `${page}.html must load ui-skin.js`);
  }
  const drawerUi = readFileSync(new URL('../public/drawer-report-ui.js', import.meta.url), 'utf8');
  // Teks lama tetap ada (tenant OFF), teks baru hanya lewat MaxiSkin.pick.
  assert.match(drawerUi, /MaxiSkin\?\.pick\('Belum ada modul Masak pada prototype ini\.', 'Belum ada catatan masak\.'\)/);
  const presets = readFileSync(new URL('../public/admin-accounting-flow-presets.js', import.meta.url), 'utf8');
  assert.match(presets, /MaxiSkin\?\.pick\('Kategori ini sudah dikustomisasi[^']*Karen[^']*', 'Kategori ini sudah diatur manual/);
});

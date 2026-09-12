import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const migration0081 = new URL('../migrations/0081_kpm_stores_from_pendem_template.sql', import.meta.url);

const targets = [
  ['store_sugiono', 'SUGIONO', 'admin_sugiono'],
  ['store_genengan', 'GENENGAN', 'admin_genengan'],
  ['store_ngijo', 'NGIJO', 'admin_ngijo'],
  ['store_beji', 'BEJI', 'admin_beji'],
  ['store_tlekung', 'TLEKUNG', 'admin_tlekung'],
  ['store_dermo', 'DERMO', 'admin_dermo'],
  ['store_kaliurang', 'KALIURANG', 'admin_kaliurang'],
];

const migrationFiles = readdirSync(migrationDir)
  .filter(name => /^\d{4}_.+\.sql$/.test(name))
  .sort();

function databaseThrough(beforeFile = null) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrationFiles) {
    if (beforeFile && file === beforeFile) break;
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function freshDatabase() {
  // This suite verifies the 0081 KPM clone contract at its own migration
  // boundary. Later store-specific onboarding (0083 Dermo Leker) is allowed
  // to intentionally diverge one target's master data after the clone.
  return databaseThrough('0083_dermo_leker_catalog_and_recipes.sql');
}

function count(sqlite, table, storeId) {
  return sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE store_id = ?`).get(storeId).n;
}

test('seven requested stores follow Pendem entity and operational template', () => {
  const sqlite = freshDatabase();
  const pendem = sqlite
    .prepare(`SELECT entity_id, edition, warehouse_enabled FROM stores WHERE id = 'store_pendem'`)
    .get();
  assert.ok(pendem?.entity_id, 'Pendem must resolve to an Entity before onboarding');

  const sourceProductCount = count(sqlite, 'products', 'store_pendem');
  const sourceCategoryCount = count(sqlite, 'categories', 'store_pendem');
  const sourceSupplierCount = count(sqlite, 'suppliers', 'store_pendem');
  const sourceKindCount = count(sqlite, 'product_kinds', 'store_pendem');
  const sourceActiveRecipeCount = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM manufacturing_recipes WHERE store_id = 'store_pendem' AND status = 'ACTIVE'`)
    .get().n;
  const sourceProductGroupCount = count(sqlite, 'product_groups', 'store_pendem');
  const sourceItemCategoryCount = count(sqlite, 'item_categories', 'store_pendem');
  const sourceJournalRuleCount = count(sqlite, 'journal_rules', 'store_pendem');

  for (const [storeId, code, username] of targets) {
    const store = sqlite
      .prepare(`SELECT code, entity_id, edition, warehouse_enabled FROM stores WHERE id = ?`)
      .get(storeId);
    assert.equal(store?.code, code);
    assert.equal(store.entity_id, pendem.entity_id, `${code} must share Pendem's exact Entity`);
    assert.equal(store.edition, pendem.edition);
    assert.equal(store.warehouse_enabled, pendem.warehouse_enabled);

    assert.equal(count(sqlite, 'products', storeId), sourceProductCount, `${code} Product Master parity`);
    assert.equal(count(sqlite, 'categories', storeId), sourceCategoryCount, `${code} categories parity`);
    assert.equal(count(sqlite, 'suppliers', storeId), sourceSupplierCount, `${code} supplier master parity`);
    assert.equal(count(sqlite, 'product_kinds', storeId), sourceKindCount, `${code} Jenis Barang parity`);
    assert.equal(count(sqlite, 'product_groups', storeId), sourceProductGroupCount, `${code} Product Group parity`);
    assert.equal(count(sqlite, 'item_categories', storeId), sourceItemCategoryCount, `${code} Accounting item mapping parity`);
    assert.equal(count(sqlite, 'journal_rules', storeId), sourceJournalRuleCount, `${code} journal-rule config parity`);

    const activeRecipeCount = sqlite
      .prepare(`SELECT COUNT(*) AS n FROM manufacturing_recipes WHERE store_id = ? AND status = 'ACTIVE'`)
      .get(storeId).n;
    assert.equal(activeRecipeCount, sourceActiveRecipeCount, `${code} active Recipe/BOM parity`);

    const costingLeak = sqlite
      .prepare(`
        SELECT COUNT(*) AS n FROM products
        WHERE store_id = ?
          AND (average_cost <> 0 OR last_purchase_price <> 0 OR cost_updated_at IS NOT NULL OR last_purchase_at IS NOT NULL)
      `)
      .get(storeId).n;
    assert.equal(costingLeak, 0, `${code} must start with fresh valuation/HPP state`);

    const admin = sqlite
      .prepare(`SELECT username, password_hash, is_active FROM store_admins WHERE store_id = ?`)
      .get(storeId);
    assert.equal(admin?.username, username);
    assert.match(admin.password_hash, /^[a-f0-9]{64}$/);
    assert.equal(admin.is_active, 1);
  }
});

test('0081 preserves canonical provisioned COA ids required by active triggers', () => {
  const sqlite = freshDatabase();
  const canonicalCodes = ['1201', '1301', '4101', '5101'];

  for (const [storeId, code] of targets) {
    for (const accountCode of canonicalCodes) {
      const sourceExists = sqlite
        .prepare(`SELECT 1 FROM chart_of_accounts WHERE store_id = 'store_pendem' AND code = ?`)
        .get(accountCode);
      if (!sourceExists) continue;

      const target = sqlite
        .prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = ?`)
        .get(storeId, accountCode);
      assert.equal(target?.id, `coa_${storeId}_${accountCode}`, `${code} ${accountCode} must keep canonical provisioned id`);
    }

    const receivableOffset = sqlite
      .prepare(`SELECT account_id FROM payment_methods WHERE store_id = ? AND code = 'RECEIVABLE_OFFSET'`)
      .get(storeId);
    if (receivableOffset) {
      assert.equal(receivableOffset.account_id, `coa_${storeId}_1201`, `${code} CASH trigger must resolve canonical Piutang account`);
    }
  }

  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [], 'full chain must end with zero FK violations');
});

test('post-onboarding Product Kind provisioning still resolves canonical Accounting accounts', () => {
  const sqlite = freshDatabase();
  const storeId = 'store_beji';
  const kindId = 'product_kind_store_beji_post_clone_probe';

  sqlite.prepare(`
    INSERT INTO product_kinds (id, store_id, code, name)
    VALUES (?, ?, 'POST_CLONE_PROBE', 'Post Clone Probe')
  `).run(kindId, storeId);

  const mapping = sqlite.prepare(`
    SELECT inventory_account_id, cogs_account_id, revenue_account_id
    FROM item_categories
    WHERE store_id = ? AND product_kind_id = ?
  `).get(storeId, kindId);

  assert.deepEqual({ ...mapping }, {
    inventory_account_id: `coa_${storeId}_1301`,
    cogs_account_id: `coa_${storeId}_5101`,
    revenue_account_id: `coa_${storeId}_4101`,
  });
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('Pendem-only custom COA is cloned by code without replacing canonical system ids', () => {
  const migrationName = '0081_kpm_stores_from_pendem_template.sql';
  const sqlite = databaseThrough(migrationName);

  sqlite.prepare(`
    INSERT INTO chart_of_accounts (
      id, store_id, code, name, type, subtype, is_active, review_required
    ) VALUES (
      'coa_pendem_custom_clone_probe', 'store_pendem', '9988',
      'Akun Clone Probe', 'ASSET', 'PROBE', 1, 0
    )
  `).run();

  sqlite.exec(readFileSync(migration0081, 'utf8'));

  for (const [storeId, code] of targets) {
    const custom = sqlite
      .prepare(`SELECT id, name FROM chart_of_accounts WHERE store_id = ? AND code = '9988'`)
      .get(storeId);
    assert.ok(custom, `${code} must receive Pendem-only custom COA`);
    assert.equal(custom.name, 'Akun Clone Probe');
    assert.match(custom.id, /^clone0080_/);
    assert.equal(
      sqlite.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = '1201'`).get(storeId)?.id,
      `coa_${storeId}_1201`,
      `${code} canonical system account must remain untouched while custom COA is added`,
    );
  }

  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('Rika is the validated Entity Admin provenance for onboarding-created config', () => {
  const sqlite = freshDatabase();
  const rika = sqlite.prepare(`
    SELECT ea.id, ea.entity_id, ea.is_active
    FROM entity_admins ea
    JOIN stores p ON p.entity_id = ea.entity_id
    WHERE ea.id = 'entity_admin_rika_pilot' AND p.id = 'store_pendem'
  `).get();
  assert.equal(rika?.id, 'entity_admin_rika_pilot');
  assert.equal(rika.is_active, 1);

  for (const [storeId, code] of targets) {
    const recipeProvenance = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN created_by_role = 'ENTITY_ADMIN' AND created_by_id = 'entity_admin_rika_pilot' THEN 1 ELSE 0 END) AS by_rika
      FROM manufacturing_recipes
      WHERE store_id = ?
    `).get(storeId);
    assert.equal(Number(recipeProvenance.by_rika ?? 0), recipeProvenance.total, `${code} cloned recipes provenance`);

    const groupProvenance = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN created_by_role = 'ENTITY_ADMIN' AND created_by_id = 'entity_admin_rika_pilot' THEN 1 ELSE 0 END) AS by_rika
      FROM product_groups
      WHERE store_id = ?
    `).get(storeId);
    assert.equal(Number(groupProvenance.by_rika ?? 0), groupProvenance.total, `${code} cloned Product Groups provenance`);

    const voucherProvenance = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN created_by_role = 'ENTITY_ADMIN' AND created_by_id = 'entity_admin_rika_pilot' THEN 1 ELSE 0 END) AS by_rika
      FROM voucher_masters
      WHERE store_id = ?
    `).get(storeId);
    assert.equal(Number(voucherProvenance.by_rika ?? 0), voucherProvenance.total, `${code} cloned Voucher provenance`);

    const rodaProvenance = sqlite.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN created_by_role = 'ENTITY_ADMIN' AND created_by_id = 'entity_admin_rika_pilot' THEN 1 ELSE 0 END) AS by_rika
      FROM roda_puter_campaigns
      WHERE store_id = ?
    `).get(storeId);
    assert.equal(Number(rodaProvenance.by_rika ?? 0), rodaProvenance.total, `${code} cloned Roda Puter provenance`);

    const approval = sqlite
      .prepare(`SELECT auto_permit_enabled, enabled_by_role, enabled_by_id FROM store_approval_settings WHERE store_id = ?`)
      .get(storeId);
    if (approval?.auto_permit_enabled === 1) {
      assert.equal(approval.enabled_by_role, 'ENTITY_ADMIN');
      assert.equal(approval.enabled_by_id, 'entity_admin_rika_pilot');
    }
  }
});

test('new stores start without Pendem transaction/history facts', () => {
  const sqlite = freshDatabase();
  const targetIds = targets.map(([storeId]) => storeId);
  const factTables = [
    'customers',
    'cashiers',
    'cash_drawer_sessions',
    'orders',
    'sales',
    'purchases',
    'expenses',
    'other_income',
    'stock_movements',
    'inventory_stock_balances',
    'production_runs',
    'accounting_journal_headers',
    'approval_requests',
    'voucher_redemptions',
    'roda_puter_official_spins',
    'game_plays',
  ];

  for (const storeId of targetIds) {
    for (const table of factTables) {
      assert.equal(count(sqlite, table, storeId), 0, `${table} must start empty for ${storeId}`);
    }
  }

  const distributedVoucherFacts = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM voucher_instances WHERE distributed_store_id IN (${targetIds.map(() => '?').join(',')})`)
    .get(...targetIds).n;
  assert.equal(distributedVoucherFacts, 0, 'Voucher instances are runtime facts and must not be cloned');
});

test('0081 resolves Entity from Pendem, validates Rika, and does not create or rewrite Entity identity', () => {
  const sql = readFileSync(migration0081, 'utf8');
  assert.match(sql, /CROSS JOIN stores p[\s\S]*p\.id = 'store_pendem'/);
  assert.match(sql, /p\.entity_id/);
  assert.match(sql, /entity_admin_rika_pilot/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+chart_of_accounts\s+WHERE\s+store_id\s+IN\s*\(SELECT\s+store_id\s+FROM\s+clone_targets_0080\)/i);
  assert.doesNotMatch(sql, /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entities\b/i);
  assert.doesNotMatch(sql, /UPDATE\s+entities\b/i);
  assert.doesNotMatch(sql, /UPDATE\s+stores[\s\S]{0,180}store_pendem/i);
});
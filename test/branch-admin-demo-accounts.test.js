import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('migration seeds two demo customers and two admin logins per branch', async () => {
  const migration = await read('migrations/0009_branch_admin_and_demo_accounts.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_admins/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS store_admin_sessions/);

  for (const username of ['fufu', 'fafa', 'elkecepatan', 'aurafarming']) {
    assert.match(migration, new RegExp(`'${username}'`));
  }
  for (const username of ['bablil', 'kingluhut', 'lordrizz', 'rusdiprime']) {
    assert.match(migration, new RegExp(`'${username}'`));
  }

  assert.match(migration, /'admin_g001_bablil', 'store_001'/);
  assert.match(migration, /'admin_g001_kingluhut', 'store_001'/);
  assert.match(migration, /'admin_g002_lordrizz', 'store_002'/);
  assert.match(migration, /'admin_g002_rusdiprime', 'store_002'/);
  assert.match(migration, /'customer_g001_fufu', 'store_001'/);
  assert.match(migration, /'customer_g001_fafa', 'store_001'/);
  assert.match(migration, /'customer_g002_elkecepatan', 'store_002'/);
  assert.match(migration, /'customer_g002_aurafarming', 'store_002'/);
});

test('each branch has two seeded cashier logins without deleting existing cashier seeds', async () => {
  const [baseCashiers, demoAccounts] = await Promise.all([
    read('migrations/0005_cashier_auth.sql'),
    read('migrations/0009_branch_admin_and_demo_accounts.sql')
  ]);
  assert.match(baseCashiers, /'cashier_wowo'.*'store_001'/s);
  assert.match(baseCashiers, /'cashier_wiwi'.*'store_002'/s);
  assert.match(demoAccounts, /'cashier_sigma'.*'store_001'/s);
  assert.match(demoAccounts, /'cashier_mewing'.*'store_002'/s);
});

test('staff login recognizes ADMIN and creates branch-scoped admin session', async () => {
  const [unified, auth, index] = await Promise.all([
    read('src/unified-login.js'),
    read('src/owner-auth.js'),
    read('src/index.js')
  ]);
  assert.match(unified, /FROM store_admins a/);
  assert.match(unified, /role: 'ADMIN'/);
  assert.match(unified, /store_admin_sessions/);
  assert.match(unified, /\/api\/auth\/staff-login/);
  assert.match(auth, /storeAdminFromRequest/);
  assert.match(auth, /ADMIN_STORE_SCOPE_MISMATCH/);
  assert.match(auth, /Create dan pengaturan gerai hanya boleh dilakukan Owner/);
  assert.match(index, /handleStoreAdminApi/);
});

test('browser stores admin session separately and branch workspace accepts it', async () => {
  const [entry, branchAuth] = await Promise.all([
    read('public/auth-entry-split.js'),
    read('public/branch-owner-auth.js')
  ]);
  assert.match(entry, /payload\.role === 'ADMIN'/);
  assert.match(entry, /lekerAdminToken/);
  assert.match(entry, /lekerAdminStoreCode/);
  assert.match(branchAuth, /lekerOwnerToken/);
  assert.match(branchAuth, /lekerAdminToken/);
  assert.match(branchAuth, /STORE_ADMIN_SESSION/);
  assert.match(branchAuth, /Logout Admin/);
});

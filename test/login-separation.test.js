import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer and staff use separate login endpoints and staff resolves internal rank', async () => {
  const [api, ui] = await Promise.all([
    read('src/unified-login.js'),
    read('public/auth-entry-split.js')
  ]);
  assert.match(api, /\/api\/auth\/customer-login/);
  assert.match(api, /\/api\/auth\/staff-login/);
  assert.match(api, /AMBIGUOUS_STAFF_LOGIN/);
  assert.match(ui, />Pelanggan<\/button>/);
  assert.match(ui, />Karyawan<\/button>/);
  assert.match(ui, /\/api\/auth\/customer-login/);
  assert.match(ui, /\/api\/auth\/staff-login/);
  assert.doesNotMatch(ui, /Owner, Admin Gerai, Kasir, atau Pelanggan/);
});

test('staff session policy is single active session with explicit takeover', async () => {
  const [api, migration, lock] = await Promise.all([
    read('src/unified-login.js'),
    read('migrations/0011_staff_single_session.sql'),
    read('public/staff-tab-lock.js')
  ]);
  assert.match(api, /STAFF_SESSION_ACTIVE/);
  assert.match(api, /takeover/);
  assert.match(migration, /trg_owner_single_session/);
  assert.match(migration, /trg_store_admin_single_session/);
  assert.match(migration, /trg_cashier_single_session/);
  assert.doesNotMatch(migration, /customer_sessions/);
  assert.match(lock, /lekerStaffBrowserLease/);
  assert.match(lock, /staffBlocked=1/);
  assert.match(lock, /setInterval/);
  assert.doesNotMatch(lock, /fetch\s*\(/);
});

test('cashier workspace combines menu orders and drawer into one authenticated read', async () => {
  const [handler, index] = await Promise.all([
    read('src/cashier-workspace.js'),
    read('src/index.js')
  ]);
  assert.match(handler, /listProducts/);
  assert.match(handler, /listOrders/);
  assert.match(handler, /getOpenDrawer/);
  assert.match(handler, /requireCashier/);
  assert.match(index, /handleCashierWorkspaceApi/);
});

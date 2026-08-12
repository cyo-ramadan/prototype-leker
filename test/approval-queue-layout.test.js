import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
const cashierModes = readFileSync(new URL('../public/cashier-sales-orders.js', import.meta.url), 'utf8');
const cashierApprovals = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const managementUi = readFileSync(new URL('../public/management-approval-queue.js', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const ownerHtml = readFileSync(new URL('../public/owner.html', import.meta.url), 'utf8');
const approvalApi = readFileSync(new URL('../src/approval-queue.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0013_approval_queue.sql', import.meta.url), 'utf8');

test('cashier header removes visible Buka Customer control', () => {
  assert.doesNotMatch(cashierHtml, />Buka Customer</);
  assert.match(cashierHtml, /id="openKioskLink" hidden/);
});

test('sales and orders are aligned into drawer action bar without replacing existing action ids', () => {
  assert.match(cashierModes, /purchaseButton\?\.insertAdjacentHTML\('beforebegin'/);
  assert.match(cashierModes, /id="cashierSalesActionBtn" class="drawer-action-btn"/);
  assert.match(cashierModes, /id="cashierOrdersActionBtn" class="drawer-action-btn"/);
  assert.match(cashierHtml, /id="purchaseBtn"/);
  assert.match(cashierHtml, /id="expenseBtn"/);
  assert.match(cashierHtml, /id="otherIncomeBtn"/);
});

test('new drawer action buttons exist and staged modules do not direct-post', () => {
  for (const id of ['stockAdjustmentBtn', 'productionBtn', 'cashFlowBtn', 'goodsFlowBtn', 'assetBtn']) {
    assert.match(cashierHtml, new RegExp(`id="${id}"`));
  }
  assert.match(cashierApprovals, /\/api\/cashier\/approval-requests/);
  assert.match(cashierApprovals, /CASH_FLOW/);
  assert.match(cashierApprovals, /GOODS_FLOW/);
  assert.match(cashierApprovals, /ASSET/);
  assert.doesNotMatch(cashierApprovals, /\/api\/cashier\/(expenses|other-income|purchases|sales)/);
});

test('approval queue is isolated and defaults cashier submissions to pending approval and unposted', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS approval_requests/);
  assert.match(migration, /approval_status TEXT NOT NULL DEFAULT 'pending_approval'/);
  assert.match(migration, /posting_status TEXT NOT NULL DEFAULT 'unposted'/);
  assert.match(approvalApi, /'pending_approval', 'unposted'/);
  assert.doesNotMatch(approvalApi, /INSERT INTO (sales|expenses|other_income|purchases|sale_items)/);
  assert.doesNotMatch(approvalApi, /UPDATE products/);
});

test('admin and owner can decide queue while posting stays explicitly blocked without a domain contract', () => {
  assert.match(branchAdminHtml, /management-approval-queue\.js/);
  assert.match(ownerHtml, /management-approval-queue\.js/);
  assert.match(managementUi, /data-approval-acc/);
  assert.match(managementUi, /data-approval-reject/);
  assert.match(managementUi, /sessionStorage\.getItem\('lekerOwnerToken'\)/);
  assert.match(approvalApi, /posting_status = 'blocked'/);
  assert.match(approvalApi, /POSTING_CONTRACT_REQUIRED/);
});

test('retained order and search flow stays present', () => {
  assert.match(cashierModes, /Dari Customer/);
  assert.match(cashierModes, /Dari Kasir/);
  assert.match(cashierModes, /snapshotOrderToDraft\(data\)/);
  assert.match(cashierModes, /sourceOrderId: draftOriginOrderId/);
  assert.match(cashierModes, /input\.value = ''/);
  assert.match(cashierModes, /target\.classList\.add\('hidden'\)/);
  assert.doesNotMatch(cashierApprovals, /setInterval\s*\(/);
  assert.doesNotMatch(managementUi, /setInterval\s*\(/);
});

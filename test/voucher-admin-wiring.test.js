import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const branchAdminSource = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const voucherAdminSource = readFileSync(new URL('../public/admin-voucher.js', import.meta.url), 'utf8');

test('Workspace Gerai loads the Voucher admin surface', () => {
  assert.match(
    branchAdminSource,
    /<script src="\/admin-voucher\.js\?v=20260907-admin-voucher-tab-v1"><\/script>/
  );
  assert.match(voucherAdminSource, /button\.textContent = 'Voucher'/);
  assert.match(voucherAdminSource, /section\.id = 'tab-vouchers'/);
});

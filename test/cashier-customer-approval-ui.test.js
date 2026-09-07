import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');
const html = fs.readFileSync(path.join(root, 'public', 'cashier.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'cashier-customer-approval.js'), 'utf8');

test('cashier panel exposes customer approval command and scoped API flow', () => {
  assert.match(html, /id="customerApprovalBtn"[^>]*>👤 ACC Pelanggan<\/button>/);
  assert.match(html, /<script src="\/cashier-customer-approval\.js\?v=20260907-customer-approval-v1"><\/script>/);
  assert.match(script, /\/api\/admin\/customer-requests/);
  assert.match(script, /store=\$\{encodeURIComponent\(storeCode\)\}/);
  assert.match(script, /action === 'REJECT' \? \{ action, reason \} : \{ action \}/);
  assert.match(script, /customerApprovalButton\.addEventListener\('click', openCustomerApprovalDialog\)/);
  assert.doesNotMatch(script, /setInterval\s*\(/);
  new vm.Script(script);
});

test('customer approval command is not gated by cash drawer write mode', () => {
  const button = html.match(/<button id="customerApprovalBtn"[^>]*>/)?.[0] || '';
  assert.ok(button, 'customer approval button must exist');
  assert.doesNotMatch(button, /\bdisabled\b/);
});

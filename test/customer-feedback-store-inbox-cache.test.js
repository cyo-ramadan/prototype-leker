import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Store Admin feedback inbox cache-busts the Entity Admin-aware management client', async () => {
  const [branchAdminHtml, managementScript, server] = await Promise.all([
    readFile(new URL('../public/branch-admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/management-customer-feedback.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/customer-feedback.js', import.meta.url), 'utf8')
  ]);

  assert.match(
    branchAdminHtml,
    /management-customer-feedback\.js\?v=20260816-admin-delivery-identity-v2&rev=20260907-entity-admin-store-inbox-v1/
  );
  assert.match(managementScript, /lekerEntityAdminToken/);
  assert.match(managementScript, /\/api\/admin\/customer-feedback\?store=\$\{encodeURIComponent\(branchStoreCode\)\}/);
  assert.match(server, /if \(management\.admin\)[\s\S]*filters\.push\('r\.store_id = \?'\)/);
});

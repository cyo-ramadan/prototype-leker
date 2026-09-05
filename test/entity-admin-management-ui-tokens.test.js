import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');

// The server-side ENTITY_ADMIN branch in requireManagement (owner-auth.js) grants
// Entity Admin read/write on a store's admin panel, but each management-*.js
// client file resolves its own bearer token independently of the fetch-patching
// in branch-owner-auth.js. Any of these that only checked lekerOwnerToken/
// lekerAdminToken silently locked Entity Admin out of a feature the server
// already authorized -- this pins that every one of them also checks
// lekerEntityAdminToken.
test('management UI client files recognize the Entity Admin session token', () => {
  for (const file of [
    'management-approval-queue.js',
    'management-transaction-void-permits.js',
    'management-customer-feedback.js',
    'admin-session-bootstrap-guard.js'
  ]) {
    assert.match(read(file), /lekerEntityAdminToken/, `${file} must resolve the Entity Admin bearer token`);
  }
});

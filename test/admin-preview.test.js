import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ownerHtmlUrl = new URL('../public/owner.html', import.meta.url);
const ownerJsUrl = new URL('../public/owner.js', import.meta.url);
const branchHtmlUrl = new URL('../public/branch-admin.html', import.meta.url);
const branchAuthUrl = new URL('../public/branch-owner-auth.js', import.meta.url);

test('management UI accepts Owner or scoped Admin Gerai before branch masters are opened', async () => {
  const [ownerHtml, ownerJs, branchHtml, branchAuth] = await Promise.all([
    readFile(ownerHtmlUrl, 'utf8'),
    readFile(ownerJsUrl, 'utf8'),
    readFile(branchHtmlUrl, 'utf8'),
    readFile(branchAuthUrl, 'utf8')
  ]);

  assert.match(ownerHtml, /Login Owner/);
  assert.match(ownerHtml, /CREATE GERAI/);
  assert.match(ownerJs, /\/api\/owner\/login/);
  assert.match(ownerJs, /\/api\/owner\/stores/);
  assert.match(branchHtml, /Workspace Gerai/);
  assert.match(branchAuth, /lekerOwnerToken/);
  assert.match(branchAuth, /lekerAdminToken/);
  assert.match(branchAuth, /lekerAdminStoreCode/);
  assert.match(branchAuth, /Authorization/);
  assert.match(branchAuth, /adminStoreCode !== currentStoreCode/);
  assert.match(branchAuth, /STORE_ADMIN_SESSION/);
});

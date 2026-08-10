import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminUrl = new URL('../public/admin.html', import.meta.url);
const ownerUrl = new URL('../public/owner.html', import.meta.url);

test('/admin static alias renders Owner Console instead of redirecting to itself', async () => {
  const [adminHtml, ownerHtml] = await Promise.all([
    readFile(adminUrl, 'utf8'),
    readFile(ownerUrl, 'utf8')
  ]);

  assert.equal(adminHtml, ownerHtml);
  assert.match(adminHtml, /Login Owner/);
  assert.match(adminHtml, /owner\.js/);
  assert.doesNotMatch(adminHtml, /location\.replace\('\/admin'\)/);
  assert.doesNotMatch(adminHtml, /http-equiv="refresh"/i);
});

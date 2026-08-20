import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Admin Gerai feedback inbox authenticates its own management read and exposes load status', async () => {
  const script = await readFile(new URL('../public/management-customer-feedback.js', import.meta.url), 'utf8');

  assert.match(script, /sessionStorage\.getItem\('lekerAdminToken'\)/);
  assert.match(script, /sessionStorage\.getItem\('lekerOwnerToken'\)/);
  assert.match(script, /Authorization: `Bearer \$\{token\}`/);
  assert.match(script, /Array\.isArray\(payload\.feedback\) \? payload\.feedback : \[\]/);
  assert.match(script, /laporan berhasil dibaca dari server/);
  assert.match(script, /Gagal membaca laporan:/);
  assert.doesNotThrow(() => new vm.Script(script));
});

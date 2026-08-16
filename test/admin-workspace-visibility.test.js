import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('Admin Gerai has a permanent Kotak Saran tab and panel in HTML', async () => {
  const html = await readFile(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

  assert.match(html, /data-tab="customer-feedback"[^>]*data-customer-feedback-tab/);
  assert.match(html, /id="tab-customer-feedback"/);
  assert.match(html, /<h2>Komentar Customer<\/h2>/);
  assert.match(html, /data-feedback-list/);
  assert.match(html, /Admin\/Owner yang berwenang dapat melihat identitas akun pengirim/);
  assert.match(html, /management-customer-feedback\.js\?v=20260816-admin-delivery-identity-v2/);
});

test('modern Admin or Owner session can recover a hidden workspace without legacy PIN status', async () => {
  const [html, guard] = await Promise.all([
    readFile(new URL('../public/branch-admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/admin-session-bootstrap-guard.js', import.meta.url), 'utf8')
  ]);

  assert.match(guard, /lekerAdminToken/);
  assert.match(guard, /lekerOwnerToken/);
  assert.match(guard, /typeof window\.unlock !== 'function'/);
  assert.match(guard, /await window\.unlock\(\)/);
  assert.match(guard, /Workspace Admin gagal dimuat/);
  assert.match(guard, /gate\?\.classList\.remove\('hidden'\)/);
  assert.ok(
    html.indexOf('/admin.js') < html.indexOf('/admin-session-bootstrap-guard.js'),
    'bootstrap guard must run after admin.js defines unlock()'
  );
  assert.doesNotThrow(() => new vm.Script(guard));
});

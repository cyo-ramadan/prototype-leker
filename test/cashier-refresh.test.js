import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('cashier uses manual and focus refresh instead of periodic polling', async () => {
  const [html, refresh, workspace] = await Promise.all([
    read('public/cashier.html'),
    read('public/cashier-refresh.js'),
    read('public/cashier-workspace.js')
  ]);

  assert.match(html, /id="refreshOrdersBtn"/);
  assert.match(html, /cashier\.js[\s\S]*cashier-workspace\.js[\s\S]*cashier-refresh\.js/);
  assert.match(refresh, /startPolling\s*=\s*function bindCashierRefreshEvents/);
  assert.match(refresh, /visibilitychange/);
  assert.match(refresh, /window\.addEventListener\('focus'/);
  assert.match(refresh, /refreshCashierWorkspace/);
  assert.match(workspace, /\/api\/cashier\/workspace/);
  assert.doesNotMatch(refresh, /setInterval\s*\(/);
});

test('manual refresh does not invalidate cashier session on non-auth errors', async () => {
  const refresh = await read('public/cashier-refresh.js');
  assert.match(refresh, /error\?\.status !== 401/);
  assert.match(refresh, /Gagal memperbarui data kasir/);
});

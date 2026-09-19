import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Bos Cyo, 2026-09-19: "kasih tombol kasir bisa permit tutup laci kasir
// sebelumnya karna sudah waktu dia untuk jaga. nanti admin acc kan akhirnya
// di force close." Source-level checks (pola sama seperti
// test/product-master-entity-admin-ui.test.js) memastikan tombol/wiring
// tetap ada, bukan menguji rendering DOM sungguhan.

test('cashier.html gains a button to request closing the previous cashier\'s drawer', async () => {
  const html = await read('public/cashier.html');
  assert.match(html, /id="requestClosePermitBtn"/);
});

test('cashier.js wires the button to a dialog that posts to /api/cashier/drawer/close-permits, only shown when the drawer is held by someone else and not for read-only management visitors', async () => {
  const source = await read('public/cashier.js');
  assert.match(source, /requestClosePermitBtn'\)\.addEventListener\('click', requestClosePermitDialog\)/);
  assert.match(source, /function requestClosePermitDialog/);
  assert.match(source, /\/api\/cashier\/drawer\/close-permits/);
  assert.match(source, /state\.closePermitPending/);
  assert.match(source, /if \(state\.readOnly\) \{\s*el\('requestClosePermitBtn'\)\.classList\.add\('hidden'\)/);
});

test('admin-drawers.js gains a pending close-permit list with ACC/Reject actions that refresh the drawer list afterward', async () => {
  const source = await read('public/admin-drawers.js');
  assert.match(source, /id="adminClosePermitList"/);
  assert.match(source, /async function loadClosePermits/);
  assert.match(source, /\/api\/admin\/drawer\/close-permits/);
  assert.match(source, /data-acc-close-permit/);
  assert.match(source, /data-reject-close-permit/);
  assert.match(source, /async function decideClosePermit/);
  assert.match(source, /Promise\.all\(\[loadClosePermits\(\), loadDrawers\(\)\]\)/);
});

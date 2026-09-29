import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer and staff use separate login endpoints and staff resolves internal rank', async () => {
  const [api, ui] = await Promise.all([
    read('src/unified-login.js'),
    read('public/auth-entry-split.js')
  ]);
  assert.match(api, /\/api\/auth\/customer-login/);
  assert.match(api, /\/api\/auth\/staff-login/);
  assert.match(api, /AMBIGUOUS_STAFF_LOGIN/);
  assert.match(ui, />Pelanggan<\/button>/);
  assert.match(ui, />Karyawan<\/button>/);
  assert.match(ui, /\/api\/auth\/customer-login/);
  assert.match(ui, /\/api\/auth\/staff-login/);
  assert.doesNotMatch(ui, /Owner, Admin Gerai, Kasir, atau Pelanggan/);
});

// KOREKSI KEBIJAKAN 2026-09-18 (Bos Cyo: "user udah mulai risih"). Aturan
// lama "satu sesi aktif per akun + takeover eksplisit" DICABUT, bukan
// dilonggarkan diam-diam:
//   - 409 STAFF_SESSION_ACTIVE + tombol "Ambil alih sesi" dihapus dari server
//     (src/unified-login.js) -- prompt-nya paling sering mengenai orang yang
//     sama di browser yang sama, dan tidak menambah keamanan karena tombolnya
//     bebas ditekan siapa pun yang sudah lolos password.
//   - trigger satu-sesi di level database dicabut (migration 0102) -- itu yang
//     bikin buka tab kedua langsung mematikan tab pertama.
// Yang MASIH ditegakkan: dalam satu browser tidak boleh PINDAH USER. Itu
// sekarang dijaga guard sisi klien dengan membandingkan identitas, bukan
// dengan mencabut sesi orang lain di server.
test('staff session policy: banyak sesi per akun boleh, pindah user dalam satu browser tetap dicegat', async () => {
  const [api, dropMigration, lock] = await Promise.all([
    read('src/unified-login.js'),
    read('migrations/0102_staff_multi_session.sql'),
    read('public/staff-tab-lock.js')
  ]);
  // Dicek pada KODE-nya, bukan prosanya -- komentar di file itu memang masih
  // menjelaskan aturan lama supaya sesi berikutnya tahu kenapa dicabut.
  const apiCode = api.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(apiCode, /code: 'STAFF_SESSION_ACTIVE'/, 'server tidak boleh menolak login akun yang sama lagi');
  assert.doesNotMatch(apiCode, /canTakeover/);
  assert.doesNotMatch(apiCode, /takeover/, 'jalur takeover harus benar-benar dicabut, bukan disisakan mati');
  assert.match(dropMigration, /DROP TRIGGER IF EXISTS trg_owner_single_session/);
  assert.match(dropMigration, /DROP TRIGGER IF EXISTS trg_store_admin_single_session/);
  assert.match(dropMigration, /DROP TRIGGER IF EXISTS trg_cashier_single_session/);
  assert.doesNotMatch(dropMigration, /customer_sessions/, 'sesi pelanggan tidak pernah ikut aturan ini, jangan ikut disentuh');
  // Guard antar tab tetap ada -- yang berubah dasarnya: identitas user, bukan
  // jumlah tab. Dan tetap tanpa network polling (invariant CLAUDE.md #6).
  assert.match(lock, /lekerStaffBrowserLease/);
  assert.match(lock, /staffBlocked=1/);
  assert.match(lock, /setInterval/);
  assert.match(lock, /leaseIsOtherUser/);
  assert.doesNotMatch(lock, /fetch\s*\(/);
});

test('cashier workspace combines menu orders and drawer into one authenticated read', async () => {
  const [handler, index] = await Promise.all([
    read('src/cashier-workspace.js'),
    read('src/index.js')
  ]);
  assert.match(handler, /listProducts/);
  assert.match(handler, /listOrders/);
  assert.match(handler, /getOpenDrawer/);
  assert.match(handler, /requireCashier/);
  assert.match(index, /handleCashierWorkspaceApi/);
});

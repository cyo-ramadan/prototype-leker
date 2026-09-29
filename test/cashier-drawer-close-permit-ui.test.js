import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Bos Cyo, 2026-09-19: "kasih tombol kasir bisa permit tutup laci kasir
// sebelumnya karna sudah waktu dia untuk jaga. nanti admin acc kan akhirnya
// di force close." Source-level checks (pola sama seperti
// test/product-master-entity-admin-ui.test.js) memastikan tombol/wiring
// tetap ada, bukan menguji rendering DOM sungguhan.
//
// Koreksi UX Bos Cyo, 2026-09-19 (sesudah live): "ini ux nya ada masalah
// untuk force close laci ... gini aja deh kalo ada cs emang jam kerjanya
// sebagai kasir harus buka laci itu maka dia itu klik buka lacinya
// request, lalu ada pertanyaan, laci sedang dibuka oleh cs ... apakah kamu
// yakin mau buka laci? kalo dia yes, ada pertanyaan lagi, apakah kamu
// sudah didepan laci, masukkan uang laci saat ini." Tombol pengajuan
// terpisah (requestClosePermitBtn) DIHAPUS -- "Buka Laci" yang sama
// sekarang memicu alur konfirmasi -> pengajuan kalau lacinya masih
// dipegang orang lain. Dan: "tombol admint untuk force close, jadi
// langsung itu di del aja. jadi admin hanya bisa close kalo ada request."

test('tombol pengajuan tutup laci terpisah sudah dihapus dari cashier.html -- "Buka Laci" jadi satu-satunya pintu masuk', async () => {
  const html = await read('public/cashier.html');
  assert.doesNotMatch(html, /id="requestClosePermitBtn"/);
  assert.match(html, /id="openDrawerBtn"/);
});

test('klik Buka Laci saat laci dipegang orang lain memicu konfirmasi berjenjang lalu POST ke /api/cashier/drawer/close-permits', async () => {
  const source = await read('public/cashier.js');
  assert.doesNotMatch(source, /requestClosePermitBtn/, 'referensi ke tombol terpisah yang sudah dihapus tidak boleh tersisa');

  const openFn = source.slice(source.indexOf('function openDrawerDialog'), source.indexOf('function closeDrawerDialog'));
  assert.match(openFn, /if \(drawer && !state\.canWrite\)/);
  assert.match(openFn, /requestOpenOccupiedDrawer\(drawer\)/);

  const guardFn = source.slice(source.indexOf('function requestOpenOccupiedDrawer'), source.indexOf('function requestClosePermitDialog'));
  assert.match(guardFn, /state\.closePermitPending/, 'sudah ada pengajuan pending tidak boleh membuka alur konfirmasi lagi');
  assert.match(guardFn, /confirm\(/, 'konfirmasi pertama: yakin mau mengajukan buka laci');
  assert.match(guardFn, /requestClosePermitDialog\(drawer\)/);

  const dialogFn = source.slice(source.indexOf('function requestClosePermitDialog'));
  assert.match(dialogFn, /dialogPermitClosingAmount/, 'konfirmasi kedua: masukkan uang laci saat ini');
  assert.match(dialogFn, /\/api\/cashier\/drawer\/close-permits/);
  assert.match(dialogFn, /result\.autoPermit/, 'pesan sukses harus beda kalau Auto Permit langsung menutup laci');
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

// Bos Cyo, 2026-09-19 (koreksi UX): "tombol admint untuk force close, jadi
// langsung itu di del aja. jadi admin hanya bisa close kalo ada request."
test('tombol Tutup Paksa langsung Admin sudah dihapus -- Admin cuma bisa ACC/Tolak pengajuan yang sudah ada', async () => {
  const source = await read('public/admin-drawers.js');
  assert.doesNotMatch(source, /data-force-close-drawer/);
  assert.doesNotMatch(source, /forceCloseDrawer/);
  assert.doesNotMatch(source, /close-permits\/direct/);
});

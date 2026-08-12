import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const camera = readFileSync(new URL('../public/camera-snapshot-modal.js', import.meta.url), 'utf8');
const cashierPhoto = readFileSync(new URL('../public/cashier-live-photo.js', import.meta.url), 'utf8');
const staffUi = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
const staffHtml = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../public/staff-auth-fetch.js', import.meta.url), 'utf8');
const staffApi = readFileSync(new URL('../src/staff-portal.js', import.meta.url), 'utf8');
const drawerApi = readFileSync(new URL('../src/cashier-drawer.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0015_staff_attendance_live_photo.sql', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('camera implementation is centralized and stops every media track', () => {
  assert.match(camera, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(camera, /getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(camera, /toBlob\(/);
  assert.match(camera, /facingMode = 'user'/);
  assert.doesNotMatch(cashierPhoto, /getUserMedia/);
  assert.doesNotMatch(staffUi, /getUserMedia/);
});

test('drawer close reuses canonical drawer endpoint and uploads Blob as multipart', () => {
  assert.match(cashierPhoto, /\/api\/cashier\/drawer\/close/);
  assert.match(cashierPhoto, /new FormData\(\)/);
  assert.match(cashierPhoto, /form\.set\('photo', blob/);
  assert.match(drawerApi, /isMultipartRequest\(request\)/);
  assert.match(drawerApi, /readLivePhoto\(form, 'photo'\)/);
  assert.doesNotMatch(index, /cashdrawer\/close/);
});

test('staff attendance is bound to authenticated user and independent from drawer', () => {
  assert.match(staffApi, /requireCashier\(request, env\.DB\)/);
  assert.match(staffApi, /user_id, store_id, attendance_type/);
  assert.match(staffApi, /auth\.cashier\.id/);
  assert.doesNotMatch(staffApi, /requireDrawerOwner/);
  assert.doesNotMatch(staffApi, /cash_drawer_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_attendance/);
});

test('portal exposes attendance, KPI, deposits and payroll sections', () => {
  assert.match(staffHtml, /Presensi Masuk/);
  assert.match(staffHtml, /Presensi Keluar/);
  assert.match(staffHtml, /KPI/);
  assert.match(staffHtml, /Riwayat Setoran/);
  assert.match(staffHtml, /Riwayat Gaji/);
  assert.match(staffUi, /CameraSnapshotModal\.open/);
});

test('staff API authorization is refreshed from sessionStorage per fetch', () => {
  assert.match(transport, /sessionStorage\.getItem\('lekerCashierToken'\)/);
  assert.match(transport, /headers\.set\('Authorization'/);
  assert.match(transport, /body instanceof FormData/);
  assert.match(transport, /headers\.delete\('Content-Type'\)/);
  assert.doesNotMatch(transport, /localStorage\.getItem\([^)]*Token/);
});

test('migration stores photos without adding blobs to attendance list payloads', () => {
  assert.match(migration, /closing_photo BLOB/);
  assert.match(migration, /photo_blob BLOB NOT NULL/);
  assert.match(staffApi, /SELECT id, user_id, store_id, attendance_type, photo_type, created_at/);
  assert.doesNotMatch(staffApi, /SELECT[^;]*photo_blob/);
});

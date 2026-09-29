import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Bos Cyo, 2026-09-28: tombol melayang ganti gerai di Workspace Gerai --
// hanya untuk Owner/Entity Admin (yang berwenang lintas gerai server-side
// lewat requireManagement), bukan Admin Gerai biasa yang dipin ke satu
// store_id (invariant #5). Klik daftar gerai TIDAK pindah halaman; klik
// satu gerai baru navigasi ke /s/<CODE>/admin, pola yang sama dengan
// "Buka Workspace" di entity-admin.js/owner.js.
//
// Sesuai konvensi test public/*.js repo ini (lihat
// test/accounting-journal-list-ui.test.js): assertion berbasis regex ke
// source, karena file ini bergantung pada document/window/localStorage
// yang tidak tersedia di lingkungan node:test biasa.

const switcherSource = readFileSync(new URL('../public/admin-workspace-switcher.js', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

test('admin-workspace-switcher.js didaftarkan di branch-admin.html', () => {
  assert.match(branchAdminHtml, /<script src="\/admin-workspace-switcher\.js"><\/script>/);
});

test('Switcher hanya aktif untuk Owner atau Entity Admin, bukan Admin Gerai biasa', () => {
  assert.match(switcherSource, /localStorage\.getItem\('lekerOwnerToken'\)/);
  assert.match(switcherSource, /localStorage\.getItem\('lekerEntityAdminToken'\)/);
  assert.match(switcherSource, /if \(!isOwner && !isEntityAdmin\) return;/);
  // Tidak boleh membaca token Admin Gerai biasa sama sekali -- itu tandanya
  // fitur ini pernah "bocor" ke role yang dipin satu gerai.
  assert.doesNotMatch(switcherSource, /lekerAdminToken/);
});

test('Owner memakai /api/owner/stores, Entity Admin memakai /api/entity-admin/stores', () => {
  assert.match(switcherSource, /isOwner \? '\/api\/owner\/stores' : '\/api\/entity-admin\/stores'/);
  assert.match(switcherSource, /Authorization: `Bearer \$\{token\}`/);
});

test('Klik gerai lain navigasi ke /s/<CODE>/admin, gerai saat ini tidak bisa diklik ulang', () => {
  assert.match(switcherSource, /location\.href = `\/s\/\$\{encodeURIComponent\(button\.dataset\.wsCode\)\}\/admin`/);
  assert.match(switcherSource, /isCurrent \? 'disabled'/);
});

test('Tombol melayang + panel dipasang sekali (idempotent mount, tidak menumpuk kalau script dievaluasi ulang)', () => {
  assert.match(switcherSource, /if \(document\.getElementById\('workspaceSwitcherBtn'\)\) return true;/);
});

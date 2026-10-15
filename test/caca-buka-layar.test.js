import test from 'node:test';
import assert from 'node:assert/strict';
import { permintaanBuka, bukaLayarDariPesan } from '../src/caca-buka-layar.js';
import { jawabPertanyaan } from '../src/caca-agen.js';
const ctx = { peran: 'Entity Admin', lingkup: 'gerai', skin: 'classic', hariIni: '2026-10-13', riwayat: [] };
test('direct screen navigation uses code and never calls model or creates draft', async () => {
 let calls = 0;
 const hasil = await jawabPertanyaan('Una, buka halaman Karyawan', ctx, { panggilModel: () => { calls++; throw new Error('model should not run'); } });
 assert.equal(calls,0); assert.equal(hasil.alat,'buka_layar'); assert.equal(hasil.navigasi.tab,'employees'); assert.equal(hasil.perluKonfirmasi,false); assert.equal(hasil.draft,undefined);
});
test('screen names and keywords follow tenant skins F G D', () => {
 assert.equal(bukaLayarDariPesan('buka bahan dan aroma', {...ctx,skin:'f'}).navigasi?.tab,'racikbahan');
 const f=bukaLayarDariPesan('bukain bahan', {...ctx,skin:'f'}); assert.equal(f.navigasi?.tab,'racikbahan');
 const g=bukaLayarDariPesan('pindah ke antrian cetak',{...ctx,skin:'g'}); assert.equal(g.navigasi?.tab,'cetak');
 assert.equal(bukaLayarDariPesan('buka antrian cetak',ctx).navigasi,undefined);
 const d=bukaLayarDariPesan('buka Biaya Toko',{...ctx,skin:'d'}); assert.equal(d.navigasi?.label,'Biaya Toko');
});
test('custom name, unknown screen and cashier permission fail safely', () => {
 assert.equal(permintaanBuka('Jarvis, tolong buka Karyawan','Jarvis'),'karyawan');
 assert.equal(bukaLayarDariPesan('buka layar tidakada',ctx).menuTidakDitemukan,true);
 assert.equal(bukaLayarDariPesan('buka Karyawan',{...ctx,peran:'CASHIER'}).navigasi,undefined);
});
test('compound write commands are not truncated into navigation', () => {
 for (const pesan of ['buka Karyawan lalu tambah Budi','buka Karyawan, tambah Budi','buka Karyawan sekaligus tambah Budi','buka Karyawan, tambahkan Budi','buka Karyawan, buatkan akun Budi']) assert.equal(permintaanBuka(pesan),null);
 assert.equal(permintaanBuka('tolong tambah karyawan Budi'),null);
});

test('entity laporan means the real Entity Laporan page without widening other scopes',()=>{
  const r=bukaLayarDariPesan('buka laporan',{...ctx,lingkup:'entity'});
  assert.equal(r.navigasi?.halaman,'entity');assert.equal(r.navigasi?.tab,'reports');assert.equal(r.uiActions[0].capabilityId,'page.open');
  assert.equal(bukaLayarDariPesan('buka laporan',{...ctx,lingkup:'entity',peran:'CASHIER'}).navigasi,undefined);
});

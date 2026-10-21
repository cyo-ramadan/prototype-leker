import test from 'node:test';
import assert from 'node:assert/strict';
import { cariShiftKosong, pilihFreelance, rekapMasalah, rentangShiftFina } from '../src/fina-hitung.js';
const at = value => new Date(value + '+07:00').toISOString();
const shift = { account_id: 'asli', store_id: 'A', employee_name: 'Rika', business_date: '2026-10-20', shift_start: '22:00', shift_end: '06:00' };
const kosong = options => cariShiftKosong({ jadwal: [shift], sekarang: '2026-10-21T01:00:00+07:00', deteksiMenit: 10, ...options });
const session = (id, start, end, extra = {}) => ({ id, account_id: 'asli', store_id: 'A', created_at: at(start), check_out_at: end ? at(end) : null, status: end ? 'CLOSED' : 'OPEN', ...extra });
const free = extra => pilihFreelance({ kandidat: [{ account_id: 'f', employee_name: 'Freelance', status: 'FREELANCE', store_id: 'A' }], tanggal: '2026-10-21', dari: '00:00', sampai: '04:00', lintasGerai: true, storeId: 'A', ...extra });

test('shift malam memakai tanggal mulai sebelumnya dan ambang dari pengaturan', () => {
  assert.equal(kosong({})[0].businessDate, '2026-10-20');
  assert.equal(kosong({ sekarang: '2026-10-20T22:09:00+07:00' }).length, 0);
  assert.equal(kosong({ sekarang: '2026-10-20T22:10:00+07:00' }).length, 1);
  assert.equal(kosong({ deteksiMenit: 20, sekarang: '2026-10-20T22:10:00+07:00' }).length, 0);
  assert.equal(kosong({ sekarang: '2026-10-21T06:00:00+07:00' }).length, 0);
  assert.throws(() => kosong({ deteksiMenit: undefined }), /pengaturan HR/);
});
test('hari libur dan jadwal hari lain tidak menghasilkan shift kosong', () => {
  assert.equal(kosong({ jadwal: [{ ...shift, is_day_off: 1 }] }).length, 0);
  assert.equal(kosong({ jadwal: [{ ...shift, day_of_week: 3 }] }).length, 0);
});
test('presensi sendiri dan pengganti tercatat menutup kekosongan, aktivasi saja tidak', () => {
  assert.equal(kosong({ presensi: [session('a', '2026-10-20T22:00:00', null)] }).length, 0);
  const backup = session('b', '2026-10-20T22:00:00', null, { account_id: 'f', replaces_account_id: 'asli' });
  assert.equal(kosong({ presensi: [backup] }).length, 0);
  assert.equal(kosong({ presensi: [{ ...backup, store_id: 'B' }] }).length, 1);
  assert.equal(kosong({ presensi: [{ ...backup, replaces_account_id: '' }] }).length, 1);
  assert.equal(kosong({ aktivasi: [{ account_id: 'f', business_date: '2026-10-21', store_id: 'A' }] }).length, 1);
});
test('presensi yang sudah pulang atau ditutup otomatis tidak menutup shift berjalan', () => {
  assert.equal(kosong({ presensi: [session('a', '2026-10-20T22:00:00', '2026-10-21T00:00:00', { auto_closed: 1 })] }).length, 1);
});
test('freelance bentrok shift malam sebelumnya, sesi aktif gerai lain, dan aktivasi beda gerai dibuang', () => {
  assert.equal(free({ jadwal: [{ ...shift, account_id: 'f' }] }).length, 0);
  assert.equal(free({ presensi: [session('a', '2026-10-20T23:00:00', null, { account_id: 'f', store_id: 'B' })] }).length, 0);
  assert.equal(free({ aktivasi: [{ account_id: 'f', business_date: '2026-10-21', store_id: 'B' }] }).length, 0);
  assert.equal(free({ jadwal: [{ ...shift, account_id: 'f', is_day_off: 1 }] }).length, 1);
});
test('freelance gerai sama lebih dulu, lintas gerai mati, akun nonaktif dan status asli tidak dipilih', () => {
  const kandidat = ['B', 'A'].map((store_id, i) => ({ account_id: String(i), name: 'CS ' + i, store_id, status: 'FREELANCE' }));
  assert.deepEqual(free({ kandidat }).map(r => r.storeId), ['A', 'B']);
  assert.deepEqual(free({ kandidat, lintasGerai: false }).map(r => r.storeId), ['A']);
  assert.equal(free({ kandidat: [{ ...kandidat[0], is_active: 0 }, { ...kandidat[1], status: 'ASLI' }] }).length, 0);
});
test('backup lintas tengah malam memeriksa aktivasi hari berikutnya dan jam bersebelahan boleh', () => {
  assert.equal(free({ dari: '22:00', sampai: '04:00', aktivasi: [{ account_id: 'f', store_id: 'B', business_date: '2026-10-22' }] }).length, 0);
  assert.equal(free({ presensi: [session('a', '2026-10-20T22:00:00', '2026-10-21T00:00:00', { account_id: 'f' })] }).length, 1);
  assert.equal(rentangShiftFina('2026-10-21', '12:00', '12:00'), null);
});
test('akun orang yang sama tidak ditawarkan ketika akunnya yang lain sedang bertugas', () => {
  assert.equal(free({ kandidat: [{ account_id: 'f', employee_id: 'orang', store_id: 'A', status: 'FREELANCE' }],
    presensi: [session('a', '2026-10-20T22:00:00', null, { account_id: 'akun-lain', employee_id: 'orang' })] }).length, 0);
});
test('rekap memakai snapshot malam, tidak menghitung jeda sesi sebagai pulang awal, dan satu shift satu kejadian', () => {
  const result = rekapMasalah({ evaluasi: [{ ...shift, id: 'v', kosong_minutes: 30, denda_kind: 'RINGAN', denda_amount_scaled: '-10000000000' }],
    presensi: [session('a', '2026-10-20T22:10:00', '2026-10-21T00:00:00'), session('b', '2026-10-21T00:20:00', '2026-10-21T05:30:00')],
    dari: '2026-10-20', sampai: '2026-10-20' })[0];
  assert.deepEqual([result.telatMenit, result.pulangAwalMenit, result.kosongMenit, result.denda, result.kejadian], [10, 30, 30, 1, 1]);
  assert.equal(result.dendaSkala, '-10000000000');
});
test('tutup otomatis dihitung lupa pulang, bukan pulang awal; rekap dibatasi tanggal', () => {
  const s = { ...shift, business_date: '2026-10-21', shift_start: '08:00', shift_end: '16:00' };
  const a = session('a', '2026-10-21T08:00:00', '2026-10-21T15:00:00', { auto_closed: 1 });
  const [r] = rekapMasalah({ evaluasi: [s], presensi: [a, a], dari: '2026-10-21', sampai: '2026-10-21' });
  assert.equal(r.lupaPulang, 1); assert.equal(r.pulangAwalMenit, 0); assert.equal(r.kejadian, 1);
  assert.equal(rekapMasalah({ evaluasi: [s], presensi: [a], dari: '2026-10-22', sampai: '2026-10-22' }).length, 0);
});

test('lupa pulang yang masuk sesudah tengah malam tetap milik tanggal shift malam', () => {
  const [r] = rekapMasalah({ evaluasi: [shift],
    presensi: [session('malam', '2026-10-21T00:05:00', '2026-10-21T06:00:00', { auto_closed: 1 })],
    dari: '2026-10-20', sampai: '2026-10-20' });
  assert.equal(r.lupaPulang, 1); assert.equal(r.kejadian, 1); assert.equal(r.telatMenit, 125);
});
test('dua akun orang sama dipilih satu, mengutamakan akun gerai tujuan', () => {
  const kandidat = ['B','A'].map((store_id,i) => ({ account_id:'k'+i, employee_id:'orang', name:'CS', store_id, status:'FREELANCE' }));
  assert.deepEqual(free({ kandidat }).map(r => r.storeId), ['A']);
});

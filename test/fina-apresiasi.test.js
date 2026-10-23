import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi } from '../src/caca-aksi.js';
import { PINTU_AKSI } from '../src/caca-chat.js';

// Bos Cyo, 2026-10-22: "hr fina atau akuntan rika harusnya bisa nyelesaiin ini" -- Fina memakai tombol
// Nilai ulang & Berhenti per tanggal Dana Apresiasi, dengan pratinjau angka di draft.

const EVAL = [
  { id: 'ev18', accountId: 'indah', accountName: 'Indah Ayu Febrianti', storeCode: 'BEJI', businessDate: '2026-10-18' },
  { id: 'ev19', accountId: 'indah', accountName: 'Indah Ayu Febrianti', storeCode: 'BEJI', businessDate: '2026-10-19' },
  { id: 'evx', accountId: 'elma', accountName: 'Elma', storeCode: 'BEJI', businessDate: '2026-10-19' }
];

function ctxPalsu(terkirim) {
  return {
    storeCode: 'BEJI', namaLingkup: 'Beji', hariIni: '2026-10-22',
    baca: async (path) => {
      if (path.startsWith('/api/entity-admin/dana-apresiasi/rekap')) return { ok: true, data: { evaluations: EVAL } };
      if (path.startsWith('/api/entity-admin/dana-apresiasi/settings')) return { ok: true, data: { stores: [{ storeCode: 'BEJI', accounts: [{ id: 'indah', username: 'indahbejik2s2', name: 'Indah Ayu Febrianti' }, { id: 'elma', name: 'Elma' }] }] } };
      return { ok: false, error: `tidak dikenal ${path}` };
    },
    kirim: async (method, path, body) => {
      terkirim.push({ method, path, body });
      if (body?.dryRun) return { ok: true, data: { changed: true, shift: 'berhenti 2026-10-18', lama: [{ kind: 'DENDA', amountRupiah: -10000 }, { kind: 'POTONG_KOSONG', amountRupiah: -9600 }], baru: [] } };
      return { ok: true, data: { reevaluated: 2 } };
    }
  };
}

test('jalur Fina untuk nilai ulang & berhenti terdaftar', () => {
  for (const jalur of ['nilai-ulang', 'berhenti', 'rekap', 'settings']) {
    assert.ok(PINTU_AKSI.includes(`/api/entity-admin/dana-apresiasi/${jalur}$`), jalur);
  }
  assert.ok(cariAksi('nilai_ulang_apresiasi'));
  assert.ok(cariAksi('karyawan_resign'));
  assert.ok(PINTU_AKSI.includes('^/api/admin/employees/[A-Za-z0-9_.-]+/resign$'));
});

test('karyawan_resign: draft menampilkan akun yang dinonaktifkan & potongan yang dibatalkan, posting ke rute resign', async () => {
  const terkirim = [];
  const ctx = ctxPalsu(terkirim);
  const bacaAsli = ctx.baca;
  ctx.baca = async (path) => {
    if (path.startsWith('/api/admin/employees')) return { ok: true, data: { employees: [
      { id: 'emp_indah', fullName: 'Indah Ayu Febrianti', status: 'ACTIVE', links: [{ accountId: 'indah', username: 'indahbejik2s2', effectiveTo: null }] },
      { id: 'emp_lama', fullName: 'Indah Lama', status: 'INACTIVE', links: [] }
    ] } };
    if (path.startsWith('/api/entity-admin/dana-apresiasi/rekap')) return { ok: true, data: { evaluations: EVAL, entries: [
      { accountId: 'indah', businessDate: '2026-10-18', kind: 'DENDA', amountRupiah: -10000, description: 'Denda gerai kosong', voided: false },
      { accountId: 'indah', businessDate: '2026-10-17', kind: 'DENDA', amountRupiah: -10000, description: 'sebelum resign', voided: false },
      { accountId: 'elma', businessDate: '2026-10-19', kind: 'DENDA', amountRupiah: -10000, description: 'orang lain', voided: false }
    ] } };
    return bacaAsli(path);
  };
  const aksi = cariAksi('karyawan_resign');
  const hasil = await aksi.siapkan({ kr_nama: 'indah', kr_tanggal: '2026-10-18' }, ctx);
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.deepEqual(hasil.draft.muatan, { employeeId: 'emp_indah', tanggal: '2026-10-18', alasan: 'Resign', nama: 'Indah Ayu Febrianti' });
  assert.ok(hasil.draft.baris.some(([label, isi]) => label === 'Akun kasir dinonaktifkan' && isi === 'indahbejik2s2'));
  assert.equal(hasil.draft.baris.filter(([label]) => label.startsWith('Dibatalkan')).length, 1, 'hanya baris sejak tanggal resign milik akunnya');
  assert.equal(terkirim.length, 0, 'draft tidak menulis apa pun');
  const posting = await aksi.posting(hasil.draft, ctx);
  assert.equal(posting.ok, true);
  assert.deepEqual(terkirim.at(-1), { method: 'POST', path: '/api/admin/employees/emp_indah/resign', body: { tanggal: '2026-10-18', alasan: 'Resign' } });
});

test('nilai_ulang_apresiasi: hanya shift CS itu di gerai panel, pratinjau dulu', async () => {
  const terkirim = [];
  const aksi = cariAksi('nilai_ulang_apresiasi');
  const hasil = await aksi.siapkan({ nu_nama: 'Indah', nu_dari: '2026-10-18', nu_sampai: '2026-10-19' }, ctxPalsu(terkirim));
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.deepEqual(hasil.draft.muatan.evaluationIds, ['ev18', 'ev19']);
  assert.equal(hasil.draft.baris[0][1], 'DENDA −Rp10.000; POTONG_KOSONG −Rp9.600');
  assert.equal(hasil.draft.baris[1][1], 'tidak ada');
});

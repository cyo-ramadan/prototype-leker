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
  assert.ok(cariAksi('cs_berhenti'));
});

test('cs_berhenti: draft menampilkan potongan yang dibatalkan, posting ke rute berhenti', async () => {
  const terkirim = [];
  const aksi = cariAksi('cs_berhenti');
  const hasil = await aksi.siapkan({ cb_nama: 'indah', cb_tanggal: '2026-10-18' }, ctxPalsu(terkirim));
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.deepEqual(hasil.draft.muatan, { accountId: 'indah', tanggal: '2026-10-18', nama: 'Indah Ayu Febrianti' });
  assert.equal(hasil.draft.baris.filter(([label]) => label.startsWith('Dibatalkan')).length, 2);
  assert.equal(terkirim.every(t => t.body?.dryRun === true), true, 'draft hanya pratinjau');
  const posting = await aksi.posting(hasil.draft, ctxPalsu(terkirim));
  assert.equal(posting.ok, true);
  assert.deepEqual(terkirim.at(-1), { method: 'POST', path: '/api/entity-admin/dana-apresiasi/berhenti', body: { accountId: 'indah', tanggal: '2026-10-18' } });
});

test('nilai_ulang_apresiasi: hanya shift CS itu di gerai panel, pratinjau dulu', async () => {
  const terkirim = [];
  const aksi = cariAksi('nilai_ulang_apresiasi');
  const hasil = await aksi.siapkan({ nu_nama: 'Indah', nu_dari: '2026-10-18', nu_sampai: '2026-10-19' }, ctxPalsu(terkirim));
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.deepEqual(hasil.draft.muatan.evaluationIds, ['ev18', 'ev19']);
  assert.match(hasil.draft.baris[0][1], /−Rp19\.600 → \+Rp0/);
});

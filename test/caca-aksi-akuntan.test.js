import test from 'node:test';
import assert from 'node:assert/strict';
import { AKSI_TULIS, cariAksi, bolehDiLingkup, periksaUlangDraft, SKEMA_AKSI } from '../src/caca-aksi.js';
import { KATALOG } from '../src/caca-baca-katalog.js';

// Bos Cyo, 2026-10-03: Una harus bisa membereskan sendiri transaksi yang belum
// berjurnal karena setelan, dengan alat yang sama dengan akuntan manusia.

const NAMA = { MANDALA: 'Mandala', BEJI: 'Beji', PENDEM: 'Pendem', GENENGAN: 'Genengan' };

const akun = (id, code, name) => ({ id, code, name, type: 'EXPENSE', isActive: true });
const aturan = (id, side, code, extra = {}) => ({
  id, label: `${side} ${code}`, side, sourceType: 'fixed_account', fixedAccountId: `acc_${code}`,
  fixedAccount: { code, name: `Akun ${code}` }, isActive: true, isDefault: side === 'DEBIT', sortOrder: side === 'DEBIT' ? 0 : 1, ...extra
});
const kategori = (id, code, rules, completeness) => ({ id, code, name: code, completeness, rules });

// Keadaan produksi 2026-10-03: kategori "operational" Mandala kosong, gerai lain lengkap.
function dataGerai() {
  const lengkap = (prefix) => ({
    accounts: [akun(`${prefix}_6101`, '6101', 'Beban Operasional'), akun(`${prefix}_1101`, '1101', 'Kas')],
    transactionCategories: [kategori(`${prefix}_cat_op`, 'operational', [aturan(`${prefix}_r1`, 'DEBIT', '6101'), aturan(`${prefix}_r2`, 'CREDIT', '1101')], 'COMPLETE')]
  });
  return {
    BEJI: lengkap('beji'),
    PENDEM: lengkap('pendem'),
    GENENGAN: lengkap('gen'),
    MANDALA: {
      accounts: [akun('man_6101', '6101', 'Beban Operasional'), akun('man_1101', '1101', 'Kas')],
      transactionCategories: [kategori('man_cat_op', 'operational', [], 'INCOMPLETE')]
    }
  };
}

function ctxPalsu({ lingkup = 'entity', storeCode = '', data = dataGerai(), issues = {}, terkirim = [] } = {}) {
  const jalurGerai = (kode) => ({
    baca: async (path) => {
      if (path === '/api/admin/settings/accounting') return { ok: true, data: data[kode] };
      if (path === '/api/admin/accounting/bridge/issues') return { ok: true, data: issues[kode] ?? { accounting: true, summary: { owing: 0, byCause: [] }, hppCorrectionsWaiting: 0 } };
      return { ok: false, error: `tidak dikenal ${path}` };
    },
    kirim: async (method, path, body) => {
      terkirim.push({ gerai: kode, method, path, body });
      if (path === '/api/admin/accounting/bridge/sync') return { ok: true, data: { attempted: 5, posted: 4, needsConfiguration: 1, failed: 0 } };
      return { ok: true, data: { ok: true, id: 'baru' } };
    }
  });
  const sendiri = storeCode ? jalurGerai(storeCode) : null;
  return {
    terkirim, lingkup, storeCode, hariIni: '2026-10-03',
    namaLingkup: lingkup === 'entity' ? 'Kantor Pendem Mandala' : NAMA[storeCode],
    jalurGerai,
    baca: async (path) => {
      if (path === '/api/entity-admin/stores') return { ok: true, data: { stores: Object.keys(data).map((code) => ({ code, storeName: NAMA[code], isActive: true })) } };
      return sendiri ? sendiri.baca(path) : { ok: false, error: 'tidak dikenal' };
    },
    kirim: async (...args) => (sendiri ? sendiri.kirim(...args) : { ok: false, error: 'tidak dikenal' })
  };
}

const issuesMandala = {
  MANDALA: {
    accounting: true,
    summary: { owing: 5, byCause: [{ code: 'NEEDS_MAPPING', count: 5, cause: { arti: 'Aturan jurnal untuk jenis transaksi ini kosong.' } }] },
    hppCorrectionsWaiting: 0
  }
};

// --- terdaftar ----------------------------------------------------------------

test('alat akuntan terdaftar di Una dan skemanya tidak bentrok dengan alat lain', () => {
  assert.ok(cariAksi('sinkron_akuntansi'));
  assert.ok(cariAksi('samakan_aturan_jurnal'));
  assert.equal(bolehDiLingkup(cariAksi('sinkron_akuntansi'), 'gerai'), true);
  assert.equal(bolehDiLingkup(cariAksi('sinkron_akuntansi'), 'entity'), true);
  assert.equal(bolehDiLingkup(cariAksi('samakan_aturan_jurnal'), 'entity'), true);
  assert.equal(bolehDiLingkup(cariAksi('samakan_aturan_jurnal'), 'gerai'), false, 'butuh membaca gerai lain sebagai acuan');
  const kunci = AKSI_TULIS.flatMap((aksi) => Object.keys(aksi.skema));
  for (const nama of ['aj_kategori', 'aj_dari_gerai']) {
    assert.equal(kunci.filter((k) => k === nama).length, 1, `${nama} tidak boleh dipakai alat lain`);
    assert.ok(SKEMA_AKSI[nama]);
  }
});

test('pembaca jembatan_masalah dan audit_hpp ada di katalog baca Una', () => {
  const byId = Object.fromEntries(KATALOG.map((api) => [api.id, api]));
  assert.equal(byId.jembatan_masalah.path, '/api/admin/accounting/bridge/issues');
  assert.equal(byId.audit_hpp.path, '/api/admin/hpp-audit');
  assert.ok(!byId.jembatan_masalah.lintasGerai && !byId.audit_hpp.lintasGerai, 'per gerai: berat, tidak boleh fan-out sekaligus');
});

// --- sinkron_akuntansi --------------------------------------------------------

test('sinkron: draft hanya memuat gerai yang punya utang jurnal, lalu posting memicu sinkron per gerai', async () => {
  const ctx = ctxPalsu({ issues: issuesMandala });
  const hasil = await cariAksi('sinkron_akuntansi').siapkan({}, ctx);
  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.tabel.isi.map((baris) => baris[0]), ['Mandala']);
  assert.equal(hasil.draft.tabel.isi[0][1], '5');
  assert.match(hasil.draft.tabel.isi[0][3], /Aturan jurnal/);
  assert.match(hasil.draft.judul, /5 transaksi/);

  const posted = await cariAksi('sinkron_akuntansi').posting(hasil.draft, ctx);
  assert.equal(posted.ok, true);
  assert.deepEqual(ctx.terkirim.map((t) => [t.gerai, t.method, t.path]), [['MANDALA', 'POST', '/api/admin/accounting/bridge/sync']]);
  assert.match(posted.jawaban, /Mandala: 4 dari 5 berhasil dijurnalkan, 1 masih mandek/);
});

test('sinkron: kalau semua sudah berjurnal, tidak membuat draft', async () => {
  const hasil = await cariAksi('sinkron_akuntansi').siapkan({}, ctxPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /sudah berjurnal/);
});

test('sinkron: gerai non-Akuntansi dilewati, koreksi HPP yang menunggu ikut dihitung', async () => {
  const ctx = ctxPalsu({ issues: { BEJI: { accounting: false }, PENDEM: { accounting: true, summary: { owing: 0, byCause: [] }, hppCorrectionsWaiting: 12 } } });
  const hasil = await cariAksi('sinkron_akuntansi').siapkan({}, ctx);
  assert.deepEqual(hasil.draft.tabel.isi.map((baris) => [baris[0], baris[2]]), [['Pendem', '12']]);
});

// --- samakan_aturan_jurnal ----------------------------------------------------

test('samakan aturan: kategori kosong di Mandala dilengkapi dari konfigurasi gerai lain yang paling umum', async () => {
  const ctx = ctxPalsu();
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  assert.equal(hasil.ok, true);
  assert.match(hasil.draft.judul, /operational/);
  assert.deepEqual(hasil.draft.tabel.isi, [['Mandala', '0 baris aktif', 'Debit 6101, Kredit 1101']]);
  assert.equal(hasil.draft.muatan.acuan, 'BEJI', 'deterministik: gerai dengan kode terkecil di antara konfigurasi terumum');

  const posted = await cariAksi('samakan_aturan_jurnal').posting(hasil.draft, ctx);
  assert.equal(posted.ok, true);
  const tulis = ctx.terkirim.filter((t) => t.method === 'POST');
  assert.equal(tulis.length, 2);
  assert.deepEqual(tulis.map((t) => t.path), ['/api/admin/settings/accounting/journal-rules', '/api/admin/settings/accounting/journal-rules']);
  assert.deepEqual(tulis.map((t) => [t.gerai, t.body.transactionCategoryId, t.body.side, t.body.fixedAccountId, t.body.isDefault]), [
    ['MANDALA', 'man_cat_op', 'DEBIT', 'man_6101', true],
    ['MANDALA', 'man_cat_op', 'CREDIT', 'man_1101', false]
  ]);
  assert.match(posted.jawaban, /sinkron_akuntansi/);
});

test('samakan aturan: hanya menambah yang kurang, tidak menghapus dan tidak membuat baris kembar', async () => {
  const data = dataGerai();
  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101')]; // debit sudah ada, kredit belum
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  assert.deepEqual(hasil.draft.tabel.isi, [['Mandala', '1 baris aktif', 'Kredit 1101']]);
  await cariAksi('samakan_aturan_jurnal').posting(hasil.draft, ctx);
  assert.deepEqual(ctx.terkirim.map((t) => [t.method, t.body.side]), [['POST', 'CREDIT']]);
  assert.equal(ctx.terkirim.some((t) => t.method === 'DELETE'), false);
});

test('samakan aturan: baris yang ada tapi nonaktif diaktifkan lagi (PATCH), bukan dibuat ganda', async () => {
  const data = dataGerai();
  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101', { isActive: false }), aturan('man_r2', 'CREDIT', '1101')];
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  await cariAksi('samakan_aturan_jurnal').posting(hasil.draft, ctx);
  assert.deepEqual(ctx.terkirim.map((t) => [t.method, t.path, t.body]), [['PATCH', '/api/admin/settings/accounting/journal-rules/man_r1', { isActive: true }]]);
});

test('samakan aturan: konfirmasi ganda tidak membuat baris kembar (dihitung ulang tepat sebelum menulis)', async () => {
  const data = dataGerai();
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  // Antara draft tampil dan "Ya" ada orang lain yang sudah melengkapinya.
  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101'), aturan('man_r2', 'CREDIT', '1101')];
  const posted = await cariAksi('samakan_aturan_jurnal').posting(hasil.draft, ctx);
  assert.equal(ctx.terkirim.length, 0);
  assert.match(posted.jawaban, /sudah lengkap/);
});

test('samakan aturan: akun acuan tidak ada di gerai tujuan -> gerai itu dilewati dengan alasan, tidak menebak akun lain', async () => {
  const data = dataGerai();
  data.MANDALA.accounts = [akun('man_1101', '1101', 'Kas')]; // tidak punya 6101
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /akun 6101 belum ada/);
});

test('samakan aturan: acuan memakai pilihan akun (tidak bisa disalin otomatis) -> berhenti dan jelaskan', async () => {
  const data = dataGerai();
  for (const kode of ['BEJI', 'PENDEM', 'GENENGAN']) {
    data[kode].transactionCategories[0].rules = [aturan('r1', 'DEBIT', '6101'), aturan('r2', 'CREDIT', '1101'), { id: 'r3', label: 'pilih', side: 'CREDIT', sourceType: 'choice_group', isActive: true, fixedAccount: null }];
  }
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctxPalsu({ data }));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /pilihan akun/);
});

test('samakan aturan: tanpa kategori ditanyakan; kategori tak dikenal ditanyakan; gerai acuan harus lengkap', async () => {
  const ctx = ctxPalsu();
  assert.match((await cariAksi('samakan_aturan_jurnal').siapkan({}, ctx)).tanya, /Kategori transaksi yang mana/);
  assert.match((await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'tidak-ada' }, ctx)).tanya, /belum ketemu/);
  assert.match((await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational', aj_dari_gerai: 'MANDALA' }, ctx)).tanya, /tidak punya aturan "operational" yang lengkap/);
});

test('samakan aturan: semua gerai sudah lengkap -> tidak ada draft', async () => {
  const data = dataGerai();
  data.MANDALA = JSON.parse(JSON.stringify(data.BEJI));
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctxPalsu({ data }));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Tidak ada gerai yang perlu dilengkapi/);
});

test('draft disusun ulang persis sama saat konfirmasi; kalau datanya berubah, ditolak', async () => {
  const data = dataGerai();
  const ctx = ctxPalsu({ data });
  const aksi = cariAksi('samakan_aturan_jurnal');
  const disiapkan = await aksi.siapkan({ aj_kategori: 'operational' }, ctx);
  const draft = { ...disiapkan.draft, tangkapan: { aj_kategori: 'operational' } };

  assert.equal((await periksaUlangDraft(draft, ctx)).ok, true);

  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101')];
  const berubah = await periksaUlangDraft(draft, ctx);
  assert.equal(berubah.ok, false);
  assert.match(berubah.error, /berubah sejak draft/);
});

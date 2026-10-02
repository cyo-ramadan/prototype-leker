import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { rupiahSkala } from '../src/caca-aksi-akun.js';
import { jawabPertanyaan } from '../src/caca-agen.js';
import { bangunJalurAksi } from '../src/caca-chat.js';

const HARI_INI = '2026-10-02';
const JT = 1_000_000;

// Tiga gerai yang meniru keadaan produksi 2026-10-02: Beji sudah standar
// (akun Piutang Poci Malang nonaktif, saldo nol), Dermo boleh custom dan masih
// memakai akun itu, Genengan tidak punya cara bayar Pembayaran Restock.
function dataGerai() {
  const akun = (id, code, name, type, isActive = true, extra = {}) => ({ accountId: id, accountCode: code, accountName: name, accountType: type, isActive, ...extra });
  // Bentuk asli daftar akun di GET /api/admin/settings/accounting (accountDto).
  const akunSetting = (id, code, name, type) => ({ id, code, name, type, subtype: '', isActive: true, reviewRequired: false });
  return {
    BEJI: {
      accounting: {
        customAccountsAllowed: false,
        accounts: [akun('beji_1103', '1103', 'Rekening Bersama', 'ASSET'), akun('beji_pm', 'ACC-000005', 'Piutang Poci Malang', 'ASSET', false), akun('beji_2101', '2101', 'Utang Usaha', 'LIABILITY')]
      },
      neraca: { assets: [{ accountId: 'beji_1103', accountCode: '1103', debitScaled: 0, creditScaled: 1_044_250 * JT, balanceScaled: -1_044_250 * JT }], liabilities: [], equity: [] },
      settings: {
        accounts: [akunSetting('beji_1103', '1103', 'Rekening Bersama', 'ASSET'), akunSetting('beji_2101', '2101', 'Utang Usaha', 'LIABILITY')],
        sharedAccounts: [{ id: 'rek_malang', name: 'Rekening Bersama Malang' }],
        paymentMethods: [
          { id: 'pay_beji_restock', code: 'PEMBAYARAN_RESTOCK', name: 'Pembayaran Restock', account: { code: '1103', name: 'Rekening Bersama' }, sharedAccountId: null, sharedAccountName: null, isActive: true, isDefault: false },
          { id: 'pay_beji_cash', code: 'CASH', name: 'Tunai', account: { code: '1101', name: 'Kas' }, sharedAccountName: null, isActive: true, isDefault: true }
        ]
      },
      hutang: { sharedAccounts: [{ id: 'rek_malang', name: 'Rekening Bersama Malang', storeBalance: 0 }] }
    },
    DERMO: {
      accounting: {
        customAccountsAllowed: true,
        accounts: [akun('dermo_1103', '1103', 'Rekening Bersama', 'ASSET'), akun('dermo_pm', 'ACC-000005', 'Piutang Poci Malang', 'ASSET'), akun('dermo_2101', '2101', 'Utang Usaha', 'LIABILITY')]
      },
      neraca: { assets: [{ accountId: 'dermo_pm', accountCode: 'ACC-000005', debitScaled: 300_000 * JT, creditScaled: 50_000 * JT, balanceScaled: 250_000 * JT }], liabilities: [], equity: [] },
      settings: {
        accounts: [akunSetting('dermo_1103', '1103', 'Rekening Bersama', 'ASSET'), akunSetting('dermo_pm', 'ACC-000005', 'Piutang Poci Malang', 'ASSET')],
        sharedAccounts: [{ id: 'rek_malang', name: 'Rekening Bersama Malang' }],
        paymentMethods: [
          { id: 'pay_dermo_restock', code: 'PEMBAYARAN_RESTOCK', name: 'Pembayaran Restock', account: { code: 'ACC-000005', name: 'Piutang Poci Malang' }, sharedAccountName: null, isActive: true, isDefault: false }
        ]
      },
      hutang: { sharedAccounts: [{ id: 'rek_malang', name: 'Rekening Bersama Malang', storeBalance: 0 }] }
    },
    GENENGAN: {
      accounting: { customAccountsAllowed: false, accounts: [akun('gen_1103', '1103', 'Rekening Bersama', 'ASSET')] },
      neraca: { assets: [], liabilities: [], equity: [] },
      settings: { accounts: [akunSetting('gen_1103', '1103', 'Rekening Bersama', 'ASSET')], sharedAccounts: [{ id: 'rek_malang', name: 'Rekening Bersama Malang' }], paymentMethods: [] },
      hutang: { sharedAccounts: [{ id: 'rek_malang', name: 'Rekening Bersama Malang', storeBalance: 0 }] }
    }
  };
}

const NAMA = { BEJI: 'Beji', DERMO: 'Dermo', GENENGAN: 'Genengan' };

function ctxPalsu({ lingkup = 'entity', storeCode = '', data = dataGerai(), terkirim = [] } = {}) {
  const jalurGerai = (kode) => ({
    baca: async (path) => {
      const g = data[kode];
      if (path === '/api/admin/accounting') return { ok: true, data: g.accounting };
      if (path.startsWith('/api/admin/accounting/balance-sheet')) return { ok: true, data: { report: g.neraca } };
      if (path === '/api/admin/settings/accounting') return { ok: true, data: g.settings };
      if (path === '/api/admin/hutang-piutang') return { ok: true, data: g.hutang };
      return { ok: false, error: `tidak dikenal ${path}` };
    },
    kirim: async (method, path, body) => {
      terkirim.push({ gerai: kode, method, path, body });
      return { ok: true, data: { journal: { journalNumber: `JRN-${kode}` } } };
    }
  });
  const sendiri = storeCode ? jalurGerai(storeCode) : null;
  return {
    terkirim,
    lingkup,
    storeCode,
    hariIni: HARI_INI,
    namaLingkup: lingkup === 'entity' ? 'Kantor Pendem Mandala' : NAMA[storeCode],
    jalurGerai,
    baca: async (path) => {
      if (path === '/api/entity-admin/stores') {
        return { ok: true, data: { stores: Object.keys(data).map((code) => ({ code, storeName: NAMA[code], isActive: true })) } };
      }
      return sendiri ? sendiri.baca(path) : { ok: false, error: 'tidak dikenal' };
    },
    kirim: async (...args) => (sendiri ? sendiri.kirim(...args) : { ok: false, error: 'tidak dikenal' })
  };
}

test('rupiahSkala menampilkan skala 1.000.000 persis tanpa float', () => {
  assert.equal(rupiahSkala(1_044_250 * JT), '1.044.250');
  assert.equal(rupiahSkala(-1_044_250 * JT), '−1.044.250');
  assert.equal(rupiahSkala(12_345_678_901), '12.345,678901');
  assert.equal(rupiahSkala(0), '0');
});

// --- cek Rekening Bersama -----------------------------------------------------

test('cek Rekber: membandingkan mutasi dan pembukuan 1103 per gerai, tanpa draft', async () => {
  const hasil = await cariAksi('cek_rekening_bersama').siapkan({}, ctxPalsu());
  assert.equal(hasil.ok, true);
  assert.equal(hasil.draft, undefined);
  assert.match(hasil.jawaban, /1 dari 3 gerai belum cocok/);
  const beji = hasil.tabel.isi.find((r) => r[0] === 'Beji');
  assert.deepEqual(beji, ['Beji', '0', '−1.044.250', 'beda −1.044.250']);
});

test('alat baca tidak bisa "dikonfirmasi" lewat jalur catat', async () => {
  const hasil = await periksaUlangDraft({ aksi: 'cek_rekening_bersama', tangkapan: {} }, ctxPalsu());
  assert.equal(hasil.ok, false);
});

test('agen: alat baca menjawab langsung dengan tabel, satu panggilan model saja', async () => {
  let panggilan = 0;
  const hasil = await jawabPertanyaan('rekber udah cocok?', {
    nama: 'Bos', peran: 'Entity Admin', lingkup: 'entity', namaLingkup: 'Kantor Pendem Mandala', hariIni: HARI_INI
  }, {
    env: {},
    jalurAksi: ctxPalsu(),
    panggilModel: async () => { panggilan += 1; return { ok: true, value: { alat: 'cek_rekening_bersama' } }; }
  });
  assert.equal(panggilan, 1);
  assert.ok(hasil.tabel.isi.length === 3);
  assert.equal(hasil.draft, undefined);
});

// --- atur cara bayar ----------------------------------------------------------

test('atur cara bayar semua gerai: hanya gerai yang punya cara bayarnya, yang lain disebut dilewati', async () => {
  const ctx = ctxPalsu();
  const hasil = await cariAksi('atur_cara_bayar').siapkan({
    cb_nama: 'pembayaran restock', cb_akun: '1103', cb_rekber: 'Rekening Bersama Malang'
  }, ctx);

  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.muatan.langkah.map((l) => l.store), ['BEJI', 'DERMO']);
  assert.deepEqual(hasil.draft.muatan.langkah[1].ubah, { accountId: 'dermo_1103', sharedAccountId: 'rek_malang' });
  assert.ok(hasil.draft.dampak.some((d) => /Dilewati.*Genengan/.test(d)));
  assert.equal(ctx.terkirim.length, 0, 'tidak ada yang terkirim sebelum Ya');
});

test('atur cara bayar: cara bayar bawaan tidak bisa dinonaktifkan', async () => {
  const hasil = await cariAksi('atur_cara_bayar').siapkan({ cb_nama: 'Tunai', cb_status: 'nonaktif' }, ctxPalsu({ lingkup: 'gerai', storeCode: 'BEJI' }));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /bawaan/);
});

test('atur cara bayar: diposting per gerai lewat endpoint layar, hasil tiap gerai dilaporkan', async () => {
  const ctx = ctxPalsu();
  const { draft } = await cariAksi('atur_cara_bayar').siapkan({ cb_nama: 'Pembayaran Restock', cb_rekber: 'Rekening Bersama Malang' }, ctx);
  const diperiksa = await periksaUlangDraft({ ...draft, tangkapan: { cb_nama: 'Pembayaran Restock', cb_rekber: 'Rekening Bersama Malang' } }, ctx);
  assert.equal(diperiksa.ok, true);
  const hasil = await diperiksa.aksi.posting(diperiksa.draft, ctx);
  assert.deepEqual(ctx.terkirim.map((k) => [k.gerai, k.method, k.path]), [
    ['BEJI', 'PATCH', '/api/admin/settings/business/payment-methods/pay_beji_restock'],
    ['DERMO', 'PATCH', '/api/admin/settings/business/payment-methods/pay_dermo_restock']
  ]);
  assert.match(hasil.jawaban, /Beji: sudah diubah/);
  assert.match(hasil.jawaban, /Dermo: sudah diubah/);
});

// --- pindah saldo akun ---------------------------------------------------------

test('pindah saldo semua gerai: hanya gerai yang bersaldo/boleh custom, jurnal exact dua sisi', async () => {
  const hasil = await cariAksi('pindah_saldo_akun').siapkan({
    ps_asal: 'Piutang Poci Malang', ps_tujuan: 'Rekening Bersama', ps_nonaktifkan: 'ya'
  }, ctxPalsu());

  assert.equal(hasil.ok, true);
  const [dermo] = hasil.draft.muatan.langkah;
  assert.equal(hasil.draft.muatan.langkah.length, 1);
  assert.equal(dermo.store, 'DERMO');
  // Saldo debit 250.000: kredit akun asal, debit tujuan, nominal skala persis.
  assert.deepEqual(dermo.jurnal.journalLines, [
    { accountId: 'dermo_1103', side: 'DEBIT', amountScaled: 250_000 * JT },
    { accountId: 'dermo_pm', side: 'CREDIT', amountScaled: 250_000 * JT }
  ]);
  assert.equal(dermo.nonaktifkanAkunId, 'dermo_pm');
  assert.match(dermo.jurnal.sourceReferenceId, /^caca_[0-9a-f-]{36}:DERMO$/);
  // Beji: saldo 0 dan akunnya sudah nonaktif → dilewati, dan itu disebut.
  assert.ok(hasil.draft.dampak.some((d) => /Dilewati: .*Beji/.test(d)));
});

test('pindah saldo: saldo kredit di akun aset ikut pindah sebagai kredit, tidak di-abs()', async () => {
  const data = dataGerai();
  data.DERMO.neraca.assets[0] = { accountId: 'dermo_pm', accountCode: 'ACC-000005', debitScaled: 0, creditScaled: 566_000 * JT, balanceScaled: -566_000 * JT };
  const hasil = await cariAksi('pindah_saldo_akun').siapkan({ ps_asal: 'Piutang Poci Malang', ps_tujuan: 'Rekening Bersama' }, ctxPalsu({ lingkup: 'gerai', storeCode: 'DERMO', data }));
  assert.deepEqual(hasil.draft.muatan.langkah[0].jurnal.journalLines, [
    { accountId: 'dermo_pm', side: 'DEBIT', amountScaled: 566_000 * JT },
    { accountId: 'dermo_1103', side: 'CREDIT', amountScaled: 566_000 * JT }
  ]);
  assert.match(hasil.draft.tabel.isi[0][2], /566\.000 kredit/);
});

test('pindah saldo: beda golongan akun ditolak', async () => {
  const hasil = await cariAksi('pindah_saldo_akun').siapkan({ ps_asal: 'Piutang Poci Malang', ps_tujuan: 'Utang Usaha' }, ctxPalsu({ lingkup: 'gerai', storeCode: 'DERMO' }));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /beda golongan/);
});

test('nonaktifkan saja: akun bersaldo ditanya mau dipindah ke mana', async () => {
  const hasil = await cariAksi('pindah_saldo_akun').siapkan({ ps_asal: 'Piutang Poci Malang', ps_nonaktifkan: 'ya' }, ctxPalsu({ lingkup: 'gerai', storeCode: 'DERMO' }));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /masih bersaldo 250\.000/);
});

test('pindah saldo: posting jurnal dulu, akun baru dinonaktifkan kalau jurnalnya berhasil', async () => {
  const ctx = ctxPalsu();
  const tangkapan = { ps_asal: 'Piutang Poci Malang', ps_tujuan: 'Rekening Bersama', ps_nonaktifkan: 'ya' };
  const { draft } = await cariAksi('pindah_saldo_akun').siapkan(tangkapan, ctx);
  const diperiksa = await periksaUlangDraft({ ...draft, tangkapan }, ctx);
  assert.equal(diperiksa.ok, true, diperiksa.error);
  const hasil = await diperiksa.aksi.posting(diperiksa.draft, ctx);
  assert.deepEqual(ctx.terkirim.map((k) => [k.gerai, k.method, k.path]), [
    ['DERMO', 'POST', '/api/admin/accounting/journals'],
    ['DERMO', 'PATCH', '/api/admin/accounting/accounts/dermo_pm']
  ]);
  assert.match(hasil.jawaban, /Dermo: jurnal JRN-DERMO, akun dinonaktifkan/);
});

test('pindah saldo: saldo berubah sejak draft dibuat → draft ditolak', async () => {
  const tangkapan = { ps_asal: 'Piutang Poci Malang', ps_tujuan: 'Rekening Bersama' };
  const { draft } = await cariAksi('pindah_saldo_akun').siapkan(tangkapan, ctxPalsu());
  const data = dataGerai();
  data.DERMO.neraca.assets[0].debitScaled = 400_000 * JT;
  const hasil = await periksaUlangDraft({ ...draft, tangkapan }, ctxPalsu({ data }));
  assert.equal(hasil.ok, false);
});

// --- pintu ---------------------------------------------------------------------

test('pintu: query boleh ikut, izin dinilai dari path; bootstrap hanya cocok persis', async () => {
  const diterima = [];
  const request = new Request('https://leker.test/api/caca/tanya?lingkup=entity', { method: 'POST', headers: { authorization: 'Bearer x' }, body: '{}' });
  const jalur = bangunJalurAksi(request, {}, {
    jalurUtama: async (req) => { diterima.push(new URL(req.url)); return new Response('{}', { status: 200 }); }
  });

  assert.equal((await jalur.baca('/api/admin/accounting/balance-sheet?asOf=2026-10-02')).ok, true);
  assert.equal(diterima[0].searchParams.get('asOf'), '2026-10-02');
  assert.equal((await jalur.baca('/api/admin/accounting')).ok, true);
  assert.equal((await jalur.baca('/api/admin/settings/accounting')).ok, true);
  // Sub-path bootstrap yang tidak terdaftar tetap ditolak.
  assert.equal((await jalur.kirim('POST', '/api/admin/settings/accounting/journal-rules', {})).ok, false);
  assert.equal((await jalur.kirim('POST', '/api/admin/accounting/standardize-accounts', {})).ok, false);

  const geraiLain = jalur.jalurGerai('DERMO');
  await geraiLain.baca('/api/admin/accounting');
  assert.equal(diterima.at(-1).searchParams.get('store'), 'DERMO');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { AKSI_TULIS, cariAksi, bolehDiLingkup, periksaUlangDraft, SKEMA_AKSI } from '../src/caca-aksi.js';
import { KATALOG } from '../src/caca-baca-katalog.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { alatPasti } from '../src/caca-agen.js';

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

// Draft bertahap: panel mengirim langkah satu per satu (satu permintaan per langkah).
async function jalankanSemua(draft, ctx) {
  const aksi = cariAksi('samakan_aturan_jurnal');
  const hasil = [];
  for (let i = 0; i < draft.muatan.daftar.length; i += 1) {
    const r = await aksi.postingBagian(draft, i, ctx);
    assert.equal(r.ok, true, r.error);
    hasil.push(r);
  }
  return hasil;
}

// --- terdaftar ----------------------------------------------------------------

test('alat akuntan terdaftar di Una dan skemanya tidak bentrok dengan alat lain', () => {
  assert.ok(cariAksi('sinkron_akuntansi'));
  assert.ok(cariAksi('samakan_aturan_jurnal'));
  assert.equal(bolehDiLingkup(cariAksi('sinkron_akuntansi'), 'gerai'), true);
  assert.equal(bolehDiLingkup(cariAksi('sinkron_akuntansi'), 'entity'), true);
  assert.equal(bolehDiLingkup(cariAksi('samakan_aturan_jurnal'), 'entity'), true);
  // Bos Cyo, 2026-10-04: "una masih belum bisa ngonekin jurnal" -- dulu entity saja, jadi dari
  // panel satu gerai Una hanya bisa menyuruh Bos. Sekarang gerai juga (acuan: gerai lain se-entity).
  assert.equal(bolehDiLingkup(cariAksi('samakan_aturan_jurnal'), 'gerai'), true);
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
  assert.deepEqual(hasil.draft.tabel.isi, [['Mandala', 'operational', '0 baris aktif', 'Debit 6101, Kredit 1101']]);
  assert.deepEqual(hasil.draft.baris[0], ['Acuan', 'operational: Beji (Debit 6101, Kredit 1101)'], 'deterministik: gerai dengan kode terkecil di antara konfigurasi terumum');
  assert.equal(hasil.draft.bertahap, true);
  assert.deepEqual(hasil.draft.muatan.daftar.map((l) => [l.jenis, l.store]), [['aturan', 'MANDALA'], ['sinkron', 'MANDALA']]);

  const posted = await jalankanSemua(hasil.draft, ctx);
  const tulis = ctx.terkirim.filter((t) => t.path.startsWith('/api/admin/settings/accounting/journal-rules'));
  assert.equal(tulis.length, 2);
  assert.deepEqual(tulis.map((t) => t.path), ['/api/admin/settings/accounting/journal-rules', '/api/admin/settings/accounting/journal-rules']);
  assert.deepEqual(tulis.map((t) => [t.gerai, t.body.transactionCategoryId, t.body.side, t.body.fixedAccountId, t.body.isDefault]), [
    ['MANDALA', 'man_cat_op', 'DEBIT', 'man_6101', true],
    ['MANDALA', 'man_cat_op', 'CREDIT', 'man_1101', false]
  ]);
  // Sesudah aturan lengkap, yang mandek langsung dikirim ulang: satu "Ya" = jurnal tersambung.
  assert.deepEqual([ctx.terkirim.at(-1).gerai, ctx.terkirim.at(-1).path], ['MANDALA', '/api/admin/accounting/bridge/sync']);
  assert.deepEqual(ctx.terkirim.at(-1).body, { limit: 25 });
  assert.match(posted[0].nama, /Mandala \(operational\): 2 baris aturan jurnal ditambah/);
  assert.match(posted[1].nama, /Mandala: 4 dari 5 transaksi mandek sekarang sudah berjurnal, 1 masih mandek/);
});

test('samakan aturan: hanya menambah yang kurang, tidak menghapus dan tidak membuat baris kembar', async () => {
  const data = dataGerai();
  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101')]; // debit sudah ada, kredit belum
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  assert.deepEqual(hasil.draft.tabel.isi, [['Mandala', 'operational', '1 baris aktif', 'Kredit 1101']]);
  await jalankanSemua(hasil.draft, ctx);
  assert.deepEqual(ctx.terkirim.filter((t) => t.path.includes('journal-rules')).map((t) => [t.method, t.body.side]), [['POST', 'CREDIT']]);
  assert.equal(ctx.terkirim.some((t) => t.method === 'DELETE'), false);
});

test('samakan aturan: baris yang ada tapi nonaktif diaktifkan lagi (PATCH), bukan dibuat ganda', async () => {
  const data = dataGerai();
  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101', { isActive: false }), aturan('man_r2', 'CREDIT', '1101')];
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  await jalankanSemua(hasil.draft, ctx);
  assert.deepEqual(ctx.terkirim.filter((t) => t.path.includes('journal-rules')).map((t) => [t.method, t.path, t.body]), [['PATCH', '/api/admin/settings/accounting/journal-rules/man_r1', { isActive: true }]]);
});

test('samakan aturan: konfirmasi ganda tidak membuat baris kembar (dihitung ulang tepat sebelum menulis)', async () => {
  const data = dataGerai();
  const ctx = ctxPalsu({ data });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctx);
  // Antara draft tampil dan "Ya" ada orang lain yang sudah melengkapinya.
  data.MANDALA.transactionCategories[0].rules = [aturan('man_r1', 'DEBIT', '6101'), aturan('man_r2', 'CREDIT', '1101')];
  const posted = await jalankanSemua(hasil.draft, ctx);
  assert.equal(ctx.terkirim.filter((t) => t.path.includes('journal-rules')).length, 0, 'tidak ada baris aturan kembar');
  assert.equal(posted[0].hasil, 'sudah_lengkap');
  assert.match(posted[0].nama, /sudah lengkap/);
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

test('konfirmasi memakai isi beku (tanpa membaca ulang semua gerai); isi yang diutak-atik ditolak', async () => {
  const data = dataGerai();
  const ctx = ctxPalsu({ data });
  const aksi = cariAksi('samakan_aturan_jurnal');
  const disiapkan = await aksi.siapkan({ aj_kategori: 'operational' }, ctx);
  const draft = { ...disiapkan.draft, tangkapan: { aj_kategori: 'operational' } };

  let bacaan = 0;
  const hitungBaca = { ...ctx, jalurGerai: (kode) => { const j = ctx.jalurGerai(kode); return { ...j, baca: async (p) => { bacaan += 1; return j.baca(p); } }; } };
  assert.equal((await periksaUlangDraft(draft, hitungBaca)).ok, true);
  assert.equal(bacaan, 0, 'tiap langkah konfirmasi tidak membaca setelan semua gerai lagi (batas kerja per permintaan)');

  const diutak = JSON.parse(JSON.stringify(draft));
  diutak.muatan.daftar[0].baris[0].side = 'MIRING';
  assert.equal((await periksaUlangDraft(diutak, ctx)).ok, false);
});

test('lingkup gerai: isi beku yang menunjuk gerai lain ditolak', async () => {
  const ctx = ctxGeraiOwner({ pesan: 'aturan jurnal operational kosong, betulkan' });
  const disiapkan = await cariAksi('samakan_aturan_jurnal').siapkan({}, ctx);
  const draft = JSON.parse(JSON.stringify({ ...disiapkan.draft, tangkapan: {} }));
  assert.equal((await periksaUlangDraft(draft, ctx)).ok, true);
  draft.muatan.daftar[0].store = 'BEJI';
  assert.equal((await periksaUlangDraft(draft, ctx)).ok, false, 'dari panel MANDALA tidak boleh menulis ke BEJI');
});

// --- lingkup gerai (Bos Cyo 2026-10-04) ----------------------------------------
// Keadaan yang dilaporkan: Una di panel MANDALA bilang "Bos perlu samakan_aturan_jurnal
// kategori operational" untuk 6 transaksi operasional yang mandek.

const faktaMandek = (n, category = 'operational') => Array.from({ length: n }, (_, i) => ({
  factId: `op_${i}`, category, failureCode: 'NEEDS_MAPPING', cause: { alat: 'samakan_aturan_jurnal', parameter: { kategori: category } }
}));

function ctxGeraiOwner({ data = dataGerai(), issues, terkirim = [], pesan = '' } = {}) {
  const ctx = ctxPalsu({ lingkup: 'gerai', storeCode: 'MANDALA', data, issues, terkirim });
  const bacaAsli = ctx.baca;
  ctx.pesan = pesan;
  ctx.baca = async (path) => {
    // Owner: endpoint Entity Admin menolak, daftar gerai Owner memuat entity tiap gerai.
    if (path === '/api/entity-admin/stores') return { ok: false, status: 401, error: 'Session Entity Admin tidak valid' };
    if (path === '/api/owner/stores') {
      return { ok: true, data: { stores: [
        ...Object.keys(data).map((code) => ({ code, storeName: NAMA[code], isActive: true, entityId: 'ENT-KPM' })),
        { code: 'G002', storeName: 'Gerai Lain', isActive: true, entityId: 'ENT-G002' }
      ] } };
    }
    return bacaAsli(path);
  };
  return ctx;
}

test('lingkup gerai: tanpa menyebut kategori, Una mencari sendiri dari transaksi yang mandek, melengkapi aturan, lalu mengirim ulang', async () => {
  const data = dataGerai();
  data.G002 = { accounts: [], transactionCategories: [kategori('g2', 'operational', [aturan('x1', 'DEBIT', '9999'), aturan('x2', 'CREDIT', '9998')], 'COMPLETE')] };
  const issues = { MANDALA: { accounting: true, summary: { owing: 6, byCause: [] }, facts: faktaMandek(6), hppCorrectionsWaiting: 0 } };
  const ctx = ctxGeraiOwner({ data, issues, pesan: 'Una, sambungkan jurnal yang mandek' });
  const aksi = cariAksi('samakan_aturan_jurnal');
  const hasil = await aksi.siapkan({}, ctx);
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.deepEqual(hasil.draft.tabel.isi, [['Mandala', 'operational', '0 baris aktif', 'Debit 6101, Kredit 1101']]);
  assert.match(hasil.draft.baris[0][1], /^operational: Beji/, 'acuan hanya gerai se-entity; G002 (entity lain) tidak ikut');
  assert.deepEqual(hasil.draft.muatan.daftar.map((l) => [l.jenis, l.store]), [['aturan', 'MANDALA'], ['sinkron', 'MANDALA']]);

  await jalankanSemua(hasil.draft, ctx);
  assert.deepEqual([...new Set(ctx.terkirim.map((t) => t.gerai))], ['MANDALA'], 'yang ditulis hanya gerai yang sedang dibuka');
  assert.deepEqual(ctx.terkirim.map((t) => t.path), [
    '/api/admin/settings/accounting/journal-rules',
    '/api/admin/settings/accounting/journal-rules',
    '/api/admin/accounting/bridge/sync'
  ]);

  // Draft disusun ulang persis sama saat konfirmasi.
  assert.equal((await periksaUlangDraft({ ...hasil.draft, tangkapan: {} }, ctxGeraiOwner({ data, issues, pesan: 'Una, sambungkan jurnal yang mandek' }))).ok, true);
});

test('lingkup gerai: calon acuan dibaca satu per satu dan berhenti begitu dua gerai lengkap sepakat', async () => {
  const data = dataGerai();
  data.TLEKUNG = JSON.parse(JSON.stringify(data.BEJI));
  NAMA.TLEKUNG = 'Tlekung';
  const ctx = ctxGeraiOwner({ data, pesan: 'aturan jurnal operational kosong, betulkan' });
  const dibaca = [];
  const asli = ctx.jalurGerai;
  ctx.jalurGerai = (kode) => { const j = asli(kode); return { ...j, baca: async (p) => { if (p === '/api/admin/settings/accounting') dibaca.push(kode); return j.baca(p); } }; };
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({}, ctx);
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.deepEqual(dibaca, ['MANDALA', 'BEJI', 'GENENGAN'], 'Beji + Genengan sudah sepakat; Pendem dan Tlekung tidak perlu dibaca');
});

test('lingkup gerai: kategori yang disebut di kalimat dipakai tanpa membaca transaksi mandek', async () => {
  const ctx = ctxGeraiOwner({ pesan: 'aturan jurnal operational mandala kosong, betulkan' });
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({}, ctx);
  assert.equal(hasil.ok, true, hasil.tanya);
  assert.equal(hasil.draft.muatan.daftar[0].kategori, 'operational');
});

test('lingkup gerai: tidak ada yang mandek karena aturan -> dijelaskan, tidak ada draft', async () => {
  const kosong = await cariAksi('samakan_aturan_jurnal').siapkan({}, ctxGeraiOwner({ pesan: 'sambungkan jurnal' }));
  assert.equal(kosong.ok, false);
  assert.match(kosong.tanya, /sudah berjurnal/);
  const lain = await cariAksi('samakan_aturan_jurnal').siapkan({}, ctxGeraiOwner({
    pesan: 'sambungkan jurnal',
    issues: { MANDALA: { accounting: true, summary: { owing: 3 }, facts: [{ category: 'sales', cause: { alat: 'atur_cara_bayar' } }], hppCorrectionsWaiting: 0 } }
  }));
  assert.equal(lain.ok, false);
  assert.match(lain.tanya, /penyebabnya lain/);
});

test('lingkup gerai: aturan gerai ini sudah lengkap -> tidak menulis apa pun', async () => {
  const data = dataGerai();
  data.MANDALA = JSON.parse(JSON.stringify(data.BEJI));
  const hasil = await cariAksi('samakan_aturan_jurnal').siapkan({ aj_kategori: 'operational' }, ctxGeraiOwner({ data }));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /sudah lengkap/);
});

test('perintah pendek "sambungkan/betulkan jurnal" langsung ke alatnya; pertanyaan tetap ke model', () => {
  for (const pesan of [
    'Una, sambungkan jurnal yang mandek',
    'tolong konekin jurnal mandala',
    'aturan jurnal operasional kosong, samakan dengan gerai lain',
    'betulkan aturan jurnal operational',
    'samakan aturan jurnal'
  ]) assert.equal(alatPasti(pesan), 'samakan_aturan_jurnal', pesan);
  for (const pesan of ['kenapa jurnal mandala belum tersambung?', 'jurnal hari ini berapa?', 'Una, sinkronkan akuntansi MANDALA.']) {
    assert.notEqual(alatPasti(pesan), 'samakan_aturan_jurnal', pesan);
  }
});

// --- daftar izin jalur Una (PINTU_AKSI) -----------------------------------------
// Test di atas memakai jalur palsu, jadi tidak akan menangkap jalur yang belum
// diizinkan. Bug nyata 2026-10-03: bridge/sync dan journal-rules lupa didaftarkan,
// sehingga di produksi kedua alat gagal "Jalur ini tidak terdaftar untuk Una".

function jalurSungguhan() {
  const diterima = [];
  const jalurUtama = async (request) => {
    const url = new URL(request.url);
    diterima.push([request.method, url.pathname]);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { diterima, jalur: bangunJalurAksi(new Request('https://example.test/api/caca/catat'), {}, { storeCode: 'MANDALA', jalurUtama }) };
}

test('jalur sungguhan mengizinkan semua endpoint yang dipakai alat akuntan', async () => {
  const { diterima, jalur } = jalurSungguhan();
  const dipakai = [
    ['baca', '/api/admin/accounting/bridge/issues'],
    ['baca', '/api/admin/hpp-audit'],
    ['baca', '/api/admin/settings/accounting'],
    ['baca', '/api/entity-admin/stores'],
    ['baca', '/api/owner/stores'],
    ['kirim', 'POST', '/api/admin/accounting/bridge/sync'],
    ['kirim', 'POST', '/api/admin/settings/accounting/journal-rules'],
    ['kirim', 'PATCH', '/api/admin/settings/accounting/journal-rules/man_r1']
  ];
  for (const [cara, ...sisanya] of dipakai) {
    const hasil = cara === 'baca' ? await jalur.baca(sisanya[0]) : await jalur.kirim(sisanya[0], sisanya[1], {});
    assert.equal(hasil.ok, true, `${sisanya.join(' ')} ditolak: ${hasil.error}`);
  }
  assert.equal(diterima.length, dipakai.length);
});

test('izin yang ditambahkan sempit: bukan pintu ke sub-path lain di bawahnya', async () => {
  const { jalur } = jalurSungguhan();
  for (const path of ['/api/admin/accounting/bridge/sync/semua', '/api/admin/accounting/bridge', '/api/owner/stores/G001', '/api/admin/settings/accounting/transaction-categories', '/api/admin/settings/accounting/accounts']) {
    const hasil = await jalur.kirim('POST', path, {});
    assert.equal(hasil.ok, false, `${path} seharusnya tidak diizinkan`);
    assert.match(hasil.error, /tidak terdaftar untuk Una/);
  }
});

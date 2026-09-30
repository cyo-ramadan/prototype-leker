import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, cocokkanSatu, periksaUlangDraft } from '../src/caca-aksi.js';
import { jawabPertanyaan } from '../src/caca-agen.js';
import { bangunJalurAksi } from '../src/caca-chat.js';

const HARI_INI = '2026-09-30';

const BOOTSTRAP = {
  units: [
    { id: 'u_pcs', code: 'PCS', name: 'Pieces', symbol: 'pcs', isActive: true },
    { id: 'u_g', code: 'GRAM', name: 'Gram', symbol: 'g', isActive: true },
    { id: 'u_ml', code: 'ML', name: 'Mililiter', symbol: 'ml', isActive: true }
  ],
  products: [
    { id: 1, name: 'Leker Coklat', unitSymbol: 'pcs' },
    { id: 2, name: 'Tepung Terigu', unitSymbol: 'g' },
    { id: 3, name: 'Telur', unitSymbol: 'pcs' },
    { id: 4, name: 'Coklat Batang', unitSymbol: 'g' },
    { id: 5, name: 'Leker Keju', unitSymbol: 'pcs' }
  ]
};

const AKUN = {
  accounts: [
    { accountId: 'acc_kas', accountCode: '1-100', accountName: 'Kas', isActive: true },
    { accountId: 'acc_bank', accountCode: '1-110', accountName: 'Bank BCA', isActive: true },
    { accountId: 'acc_modal', accountCode: '3-100', accountName: 'Modal Pemilik', isActive: true },
    { accountId: 'acc_lama', accountCode: '9-999', accountName: 'Kas Lama', isActive: false }
  ]
};

function jalurPalsu({ bootstrap = BOOTSTRAP, resep = { recipes: [] }, akun = AKUN, jawabKirim = { ok: true, data: {} } } = {}) {
  const terkirim = [];
  return {
    terkirim,
    baca: async (path) => {
      if (path === '/api/admin/manufacturing/bootstrap') return { ok: true, data: bootstrap };
      if (path === '/api/admin/manufacturing/recipes') return { ok: true, data: resep };
      if (path === '/api/entity-admin/accounts') return { ok: true, data: akun };
      return { ok: false, error: `jalur tidak dikenal: ${path}` };
    },
    kirim: async (method, path, body) => {
      terkirim.push({ method, path, body });
      return jawabKirim;
    },
    hariIni: HARI_INI,
    namaLingkup: 'Leker Beji'
  };
}

// --- pencocokan -------------------------------------------------------------

test('nama dicocokkan persis dulu, lalu "mengandung" hanya kalau kandidatnya satu', () => {
  const opsi = { label: 'barang', namaDari: (p) => p.name };
  assert.equal(cocokkanSatu('telur', BOOTSTRAP.products, opsi).nilai.id, 3);
  assert.equal(cocokkanSatu('terigu', BOOTSTRAP.products, opsi).nilai.id, 2);

  const ambigu = cocokkanSatu('leker', BOOTSTRAP.products, opsi);
  assert.equal(ambigu.ok, false);
  assert.match(ambigu.tanya, /Leker Coklat/);
  assert.match(ambigu.tanya, /Leker Keju/);

  assert.equal(cocokkanSatu('gula', BOOTSTRAP.products, opsi).ok, false);
});

// --- barang -----------------------------------------------------------------

test('barang baru: nominal diurai kode, satuan dicocokkan, draft memuat muatan persis', async () => {
  const jalur = jalurPalsu();
  const hasil = await cariAksi('buat_barang').siapkan({
    barang_nama: 'Leker Tiramisu', barang_kategori: 'Leker',
    barang_harga_jual: '15rb', barang_harga_beli: '6.000', barang_satuan: 'pcs'
  }, jalur);

  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.muatan, {
    name: 'Leker Tiramisu', category: 'Leker', price: 15000, purchasePrice: 6000, baseUnitId: 'u_pcs'
  });
});

test('barang baru: harga beli tidak diisi 0 diam-diam', async () => {
  const hasil = await cariAksi('buat_barang').siapkan({
    barang_nama: 'Leker Tiramisu', barang_kategori: 'Leker', barang_harga_jual: '15rb'
  }, jalurPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Harga beli/);
});

test('barang baru: nama yang sudah ada ditolak, tidak dibuat kembar', async () => {
  const hasil = await cariAksi('buat_barang').siapkan({
    barang_nama: 'leker coklat', barang_kategori: 'Leker', barang_harga_jual: '12rb', barang_harga_beli: '5rb'
  }, jalurPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /sudah ada/);
});

// --- resep ------------------------------------------------------------------

test('resep: bahan dicocokkan ke barang nyata, jumlah bulat, ID diambil dari master', async () => {
  const hasil = await cariAksi('buat_resep').siapkan({
    resep_hasil: 'leker coklat', resep_hasil_qty: '10',
    resep_komponen: [{ barang: 'terigu', qty: '250' }, { barang: 'telur', qty: '2' }, { barang: 'coklat batang', qty: '100' }]
  }, jalurPalsu());

  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.muatan, {
    outputProductId: 1,
    outputQuantity: 10,
    variantLabel: '',
    components: [{ productId: 2, quantity: 250 }, { productId: 3, quantity: 2 }, { productId: 4, quantity: 100 }]
  });
  assert.deepEqual(hasil.draft.tabel.isi[0], ['Tepung Terigu', '250 g']);
});

test('resep: yang akan menggantikan resep aktif disebut di dampaknya', async () => {
  const hasil = await cariAksi('buat_resep').siapkan({
    resep_hasil: 'Leker Coklat', resep_hasil_qty: '10', resep_komponen: [{ barang: 'telur', qty: '2' }]
  }, jalurPalsu({ resep: { recipes: [{ output_product_id: 1, variant_label: '', status: 'ACTIVE', revision: 3 }] } }));
  assert.match(hasil.draft.dampak[0], /revisi 3/);
});

test('resep: bahan ambigu, bahan kembar, dan qty pecahan ditanyakan', async () => {
  const aksi = cariAksi('buat_resep');
  const dasar = { resep_hasil: 'Leker Coklat', resep_hasil_qty: '10' };

  const ambigu = await aksi.siapkan({ ...dasar, resep_komponen: [{ barang: 'leker', qty: '1' }] }, jalurPalsu());
  assert.match(ambigu.tanya, /beberapa bahan/);

  const kembar = await aksi.siapkan({ ...dasar, resep_komponen: [{ barang: 'telur', qty: '1' }, { barang: 'Telur', qty: '1' }] }, jalurPalsu());
  assert.match(kembar.tanya, /dua kali/);

  const pecahan = await aksi.siapkan({ ...dasar, resep_komponen: [{ barang: 'telur', qty: '1,5' }] }, jalurPalsu());
  assert.equal(pecahan.ok, false);

  const tanpaQtyHasil = await aksi.siapkan({ resep_hasil: 'Leker Coklat', resep_komponen: [{ barang: 'telur', qty: '2' }] }, jalurPalsu());
  assert.match(tanpaQtyHasil.tanya, /menghasilkan berapa/);
});

// --- jurnal -----------------------------------------------------------------

test('jurnal: akun dicocokkan lewat nama atau kode, nominal jadi rupiah bulat', async () => {
  const hasil = await cariAksi('buat_jurnal').siapkan({
    jurnal_keterangan: 'Setoran modal',
    jurnal_baris: [
      { akun: 'kas', sisi: 'debit', nominal: '5jt' },
      { akun: '3-100', sisi: 'kredit', nominal: '5.000.000' }
    ]
  }, jalurPalsu());

  assert.equal(hasil.ok, true);
  const { journalLines, businessDate, sourceReferenceId } = hasil.draft.muatan;
  assert.deepEqual(journalLines, [
    { accountId: 'acc_kas', side: 'DEBIT', amountMinor: 5000000 },
    { accountId: 'acc_modal', side: 'CREDIT', amountMinor: 5000000 }
  ]);
  assert.equal(businessDate, HARI_INI);
  assert.match(sourceReferenceId, /^caca_/);
});

// Invariant #3: balance exact, tanpa toleransi.
test('jurnal yang tidak balance ditanyakan, tidak ditambal', async () => {
  const hasil = await cariAksi('buat_jurnal').siapkan({
    jurnal_keterangan: 'Setoran modal',
    jurnal_baris: [
      { akun: 'Kas', sisi: 'debit', nominal: '5jt' },
      { akun: 'Modal Pemilik', sisi: 'kredit', nominal: '4.999.999' }
    ]
  }, jalurPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /selisih 1/);
});

test('jurnal tidak memakai akun nonaktif', async () => {
  const hasil = await cariAksi('buat_jurnal').siapkan({
    jurnal_keterangan: 'x',
    jurnal_baris: [{ akun: 'Kas Lama', sisi: 'debit', nominal: '1rb' }, { akun: 'Modal Pemilik', sisi: 'kredit', nominal: '1rb' }]
  }, jalurPalsu());
  // "Kas Lama" nonaktif. Tidak boleh jatuh diam-diam ke akun "Kas" hanya
  // karena namanya termuat di dalam kalimat.
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Kas Lama/);
});

test('jurnal bertanggal masa depan ditanyakan', async () => {
  const hasil = await cariAksi('buat_jurnal').siapkan({
    jurnal_keterangan: 'x', jurnal_tanggal: '2026-10-05',
    jurnal_baris: [{ akun: 'Kas', sisi: 'debit', nominal: '1rb' }, { akun: 'Modal Pemilik', sisi: 'kredit', nominal: '1rb' }]
  }, jalurPalsu());
  assert.match(hasil.tanya, /masa depan/);
});

// --- konfirmasi -------------------------------------------------------------

async function draftDariAgen(pertanyaan, pilihan, konteks, jalur) {
  const hasil = await jawabPertanyaan(pertanyaan, konteks, {
    env: {},
    jalurAksi: jalur,
    panggilModel: async () => ({ ok: true, value: pilihan })
  });
  return hasil;
}

const KONTEKS_GERAI = { nama: 'Bos Cyo', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Leker Beji', storeCode: 'G001', storeName: 'Leker Beji', hariIni: HARI_INI };
const KONTEKS_ENTITY = { nama: 'Bos Cyo', peran: 'Entity Admin', lingkup: 'entity', namaLingkup: 'Kantor Pendem', hariIni: HARI_INI };

test('agen: perintah tulis berhenti di draft, tidak ada yang terkirim', async () => {
  const jalur = jalurPalsu();
  const hasil = await draftDariAgen('bikin barang', {
    alat: 'buat_barang', barang_nama: 'Leker Matcha', barang_kategori: 'Leker', barang_harga_jual: '15rb', barang_harga_beli: '0'
  }, KONTEKS_GERAI, jalur);

  assert.equal(hasil.perluKonfirmasi, true);
  assert.equal(hasil.draft.aksi, 'buat_barang');
  assert.equal(hasil.draft.tangkapan.barang_nama, 'Leker Matcha');
  assert.equal(jalur.terkirim.length, 0);
});

test('agen: jurnal di lingkup gerai diarahkan ke mode entity, dan sebaliknya', async () => {
  const diGerai = await draftDariAgen('jurnal', { alat: 'buat_jurnal' }, KONTEKS_GERAI, jalurPalsu());
  assert.match(diGerai.jawaban, /semua gerai/);
  assert.equal(diGerai.draft, undefined);

  const diEntity = await draftDariAgen('bikin barang', { alat: 'buat_barang' }, KONTEKS_ENTITY, jalurPalsu());
  assert.match(diEntity.jawaban, /per gerai/);

  const bacaDiEntity = await draftDariAgen('untung?', { alat: 'laba_periode', periode: 'hari_ini' }, KONTEKS_ENTITY, jalurPalsu());
  assert.match(bacaDiEntity.jawaban, /baru bisa membuat jurnal/);
});

test('konfirmasi: draft yang sama persis diposting, dengan referensi yang sama', async () => {
  const jalur = jalurPalsu({ jawabKirim: { ok: true, data: { journal: { journalNumber: 'ENT-JRN-0007' } } } });
  const { draft } = await draftDariAgen('jurnal', {
    alat: 'buat_jurnal', jurnal_keterangan: 'Setoran modal',
    jurnal_baris: [{ akun: 'Kas', sisi: 'debit', nominal: '5jt' }, { akun: 'Modal Pemilik', sisi: 'kredit', nominal: '5jt' }]
  }, KONTEKS_ENTITY, jalur);

  const diperiksa = await periksaUlangDraft(draft, { ...jalur, namaLingkup: KONTEKS_ENTITY.namaLingkup });
  assert.equal(diperiksa.ok, true);
  assert.equal(diperiksa.draft.muatan.sourceReferenceId, draft.muatan.sourceReferenceId);

  const posting = await diperiksa.aksi.posting(diperiksa.draft, jalur);
  assert.match(posting.jawaban, /ENT-JRN-0007/);
  assert.equal(jalur.terkirim[0].path, '/api/entity-admin/journals');
});

test('konfirmasi: draft yang diutak-atik di browser ditolak', async () => {
  const jalur = jalurPalsu();
  const { draft } = await draftDariAgen('bikin barang', {
    alat: 'buat_barang', barang_nama: 'Leker Matcha', barang_kategori: 'Leker', barang_harga_jual: '15rb', barang_harga_beli: '5rb'
  }, KONTEKS_GERAI, jalur);

  const diubah = { ...draft, muatan: { ...draft.muatan, price: 1 } };
  const hasil = await periksaUlangDraft(diubah, jalur);
  assert.equal(hasil.ok, false);
  assert.match(hasil.error, /berubah/);
});

test('konfirmasi: data master berubah sejak draft dibuat → diminta draft ulang', async () => {
  const { draft } = await draftDariAgen('resep', {
    alat: 'buat_resep', resep_hasil: 'Leker Coklat', resep_hasil_qty: '10', resep_komponen: [{ barang: 'telur', qty: '2' }]
  }, KONTEKS_GERAI, jalurPalsu());

  // Sesudah draft tampil, resep aktif lain sempat dibuat dari layar.
  const jalurBaru = jalurPalsu({ resep: { recipes: [{ output_product_id: 1, variant_label: '', status: 'ACTIVE', revision: 1 }] } });
  const hasil = await periksaUlangDraft(draft, jalurBaru);
  assert.equal(hasil.ok, false);
  assert.equal(jalurBaru.terkirim.length, 0);
});

// --- pintu ------------------------------------------------------------------

test('pintu aksi: gerai dari sesi, kredensial penyuruh diteruskan, jalur lain ditolak', async () => {
  const diterima = [];
  const pintu = [['/api/admin/manufacturing/', async (req) => {
    diterima.push(req);
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }]];
  const request = new Request('https://leker.test/api/caca/catat?store=G002', {
    method: 'POST', headers: { authorization: 'Bearer rahasia', 'content-type': 'application/json' }, body: '{}'
  });
  const jalur = bangunJalurAksi(request, {}, { storeCode: 'G002', pintu });

  const hasil = await jalur.kirim('POST', '/api/admin/manufacturing/recipes', { a: 1 });
  assert.equal(hasil.ok, true);
  const url = new URL(diterima[0].url);
  assert.equal(url.searchParams.get('store'), 'G002');
  assert.equal(diterima[0].headers.get('authorization'), 'Bearer rahasia');
  assert.deepEqual(await diterima[0].json(), { a: 1 });

  const liar = await jalur.kirim('POST', '/api/admin/stores/hapus', {});
  assert.equal(liar.ok, false);
});

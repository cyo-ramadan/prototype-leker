import test from 'node:test';
import assert from 'node:assert/strict';
import { jawabPertanyaan, panduanPasti } from '../src/caca-agen.js';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { jelaskan } from '../src/caca-jelaskan.js';
import { uraiPesanSupplier } from '../src/caca-aksi-master.js';

// Uji karyawan Bos Cyo 2026-10-11 (Notepad_Una.txt): 14 pertanyaan "bagaimana cara …"
// soal barang, stok, supplier, dan pembelian dijawab "belum punya penjelasan" atau
// diarahkan ke layar yang salah (restock → "gerai dan entity", nota supplier → jadwal
// kerja, supplier → Daftar Barang). Kalimat aslinya dijawab kode tanpa model.

const ASLI = [
  ['cara menambahkan barang baru', 'barang_tambah'],
  ['bagaimana cara memasukkan nama barang?', 'barang_tambah'],
  ['Bagaimana cara menenrtukan kategori barang baru?', 'kategori_barang'],
  ['bagaimana cara memasukkan harga beli dan harga jual barang?', 'harga_barang'],
  ['bagaimana cara menonaktifkan barang yang sudah tidak dijual tanpa menghapus riwayat transaksinya', 'barang_nonaktif'],
  ['bagaimana cara memasukkan restock ke stok gerai', 'pembelian'],
  ['bagaimana cara mencatat restock barang yang jumlah nya berbeda dari nota suplier?', 'nota_beda'],
  ['bagaimana cara mencatat barang yang rusak saat diterima?', 'barang_rusak'],
  ['bagaimana cara mencatat barang keluar untuk kebutuhan internal gerai?', 'barang_keluar'],
  ['bagaimana cara melakukan penyesuaian stok?', 'penyesuaian_stok'],
  ['bagaimana cara melihat riwayat keluar masuk setiap barang?', 'riwayat_stok'],
  ['bagaimana cara menangani stok minus atau stok transaksi yang tidak sesuai dengan transaksi penjualan?', 'stok_minus'],
  ['bagaimana cara mendaftarkan suplier baru ke sistem?', 'supplier_tambah'],
  ['bagaimana cara mencatat pembelian barang dari suplier?', 'pembelian']
];

// "bukan cuma bisa jawab spesifik itu, tapi case yang setype" — kalimat lain yang setipe.
const SETIPE = [
  ['gimana cara input produk baru?', 'barang_tambah'],
  ['kalau mau ganti harga jual menu gimana?', 'harga_barang'],
  ['cara bikin kategori minuman gimana', 'kategori_barang'],
  ['gimana caranya barang yang udah ga dijual biar ga muncul di kasir?', 'barang_nonaktif'],
  ['cara hapus menu yang udah ga dipakai', 'barang_nonaktif'],
  ['belanja bahan dicatat di mana?', 'pembelian'],
  ['cara catat kulakan ke pasar', 'pembelian'],
  ['gimana cara masukin barang yang baru dibeli ke stok?', 'pembelian'],
  ['gimana kalau kiriman supplier kurang dari nota?', 'nota_beda'],
  ['kalau ada bahan yang basi gimana nyatetnya?', 'barang_rusak'],
  ['cup pecah pas dikirim gimana', 'barang_rusak'],
  ['cara nyatet gula yang dipakai buat konsumsi karyawan?', 'barang_keluar'],
  ['gimana cara stok opname?', 'penyesuaian_stok'],
  ['stok di sistem beda sama stok fisik gimana?', 'penyesuaian_stok'],
  ['di mana lihat mutasi stok gula?', 'riwayat_stok'],
  ['stok kok minus gimana benerinnya?', 'stok_minus'],
  ['cara nambahin pemasok baru', 'supplier_tambah']
];

test('14 pertanyaan karyawan dijawab panduan yang tepat, tanpa model', () => {
  for (const [tanya, topik] of ASLI) {
    assert.equal(panduanPasti(tanya)?.topik, topik, tanya);
  }
});

test('kalimat lain yang setipe juga kena panduan yang sama', () => {
  for (const [tanya, topik] of SETIPE) {
    assert.equal(jelaskan(tanya).topik, topik, tanya);
  }
});

test('kata umum tidak lagi menyeret ke panduan yang salah', () => {
  assert.notEqual(jelaskan('cara restock ke stok gerai').topik, 'gerai_entity');
  assert.notEqual(jelaskan('jumlah barang berbeda dari nota').topik, 'jadwal_beda');
  assert.equal(jelaskan('jam masuk cs tiap hari berbeda').topik, 'jadwal_beda');
  assert.equal(jelaskan('apa itu gerai dan entity').topik, 'gerai_entity');
});

const KONTEKS = { nama: 'Bos', peran: 'Entity Admin', storeCode: 'TESTINGUNA', storeName: 'Testing Una', hariIni: '2026-10-11', lingkup: 'gerai', namaLingkup: 'Testing Una' };

function jalurPalsu(suppliers = []) {
  const kiriman = [];
  return {
    kiriman,
    baca: async (p) => (p === '/api/admin/suppliers' ? { ok: true, data: { suppliers } } : { ok: false, error: p }),
    kirim: async (method, path, body) => { kiriman.push({ method, path, body }); return { ok: true, data: { ok: true, id: 'x' } }; }
  };
}
const tanpaModel = async () => { throw new Error('model tidak boleh dipanggil'); };

test('"cara daftar supplier" → "buatin dong" → nama → draft supplier, lalu terkirim ke jalur layar', async () => {
  const jalur = jalurPalsu([{ name: 'Toko Lama', isActive: true }]);
  const satu = await jawabPertanyaan('bagaimana cara mendaftarkan suplier baru ke sistem?', KONTEKS, { env: {}, panggilModel: tanpaModel, jalurAksi: jalur });
  assert.match(satu.jawaban, /Tambah supplier/);
  assert.match(satu.jawaban, /Mau Una daftarkan\?/);
  const dua = await jawabPertanyaan('buatin dong', KONTEKS, { env: {}, panggilModel: tanpaModel, jalurAksi: jalur, tertunda: satu.tertunda });
  assert.equal(dua.alat, 'buat_supplier');
  assert.equal(dua.tertunda.kurang, 'sp_nama');
  const model = async () => ({ ok: true, value: { alat: 'tidak_ada' } });
  const tiga = await jawabPertanyaan('Toko Makmur', KONTEKS, { env: {}, panggilModel: model, jalurAksi: jalur, tertunda: dua.tertunda });
  assert.equal(tiga.perluKonfirmasi, true, tiga.jawaban);
  assert.deepEqual(tiga.draft.muatan, { name: 'Toko Makmur', phone: '', address: '' });
  const diperiksa = await periksaUlangDraft(tiga.draft, { ...jalur, hariIni: KONTEKS.hariIni, namaLingkup: KONTEKS.namaLingkup, lingkup: 'gerai' });
  assert.equal(diperiksa.ok, true, diperiksa.error);
  await cariAksi('buat_supplier').posting(diperiksa.draft, jalur);
  assert.deepEqual(jalur.kiriman[0], { method: 'POST', path: '/api/admin/suppliers', body: { name: 'Toko Makmur', phone: '', address: '', notes: '' } });

  const kembar = await cariAksi('buat_supplier').siapkan({ sp_nama: 'toko lama' }, jalur);
  assert.equal(kembar.ok, false);
  assert.match(kembar.tanya, /sudah ada/);
  assert.deepEqual(uraiPesanSupplier('tambah supplier Toko Makmur hp 0812-3456-7890, alamat Pasar Baru'), { sp_nama: 'Toko Makmur', sp_hp: '081234567890', sp_alamat: 'Pasar Baru' });
});

test('buat_kategori: draft + POST /api/admin/categories; kembar dijelaskan, bukan galat mentah', async () => {
  const aksi = cariAksi('buat_kategori');
  assert.deepEqual(aksi.isiDariPesan({}, 'bikin kategori Minuman Dingin'), { kat_nama: 'Minuman Dingin' });
  const jalur = jalurPalsu();
  const siap = await aksi.siapkan({ kat_nama: 'Minuman Dingin' }, jalur);
  assert.equal(siap.ok, true);
  await aksi.posting(siap.draft, jalur);
  assert.deepEqual(jalur.kiriman[0], { method: 'POST', path: '/api/admin/categories', body: { name: 'Minuman Dingin' } });
  const kembar = await aksi.posting(siap.draft, { kirim: async () => ({ ok: false, status: 409, error: 'Kategori sudah ada di gerai ini.' }) });
  assert.match(kembar.error, /ternyata sudah ada/);
});

test('panduan yang dicatat kasir tidak menawarkan Una mengerjakannya', () => {
  for (const topik of ['pembelian', 'barang_rusak', 'barang_keluar', 'penyesuaian_stok']) {
    const hasil = jelaskan(topik);
    assert.equal(hasil.kerjakan, null, topik);
    assert.match(hasil.jawaban, /Kasir|kasir/, topik);
  }
});

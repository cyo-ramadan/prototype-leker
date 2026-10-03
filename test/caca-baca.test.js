import test from 'node:test';
import assert from 'node:assert/strict';
import { bacaBebas, angkaTanpaBukti } from '../src/caca-baca.js';
import { jawabPertanyaan } from '../src/caca-agen.js';

const HARI_INI = '2026-10-02';
const KONTEKS_GERAI = { nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Dermo', storeCode: 'DERMO', storeName: 'Dermo', hariIni: HARI_INI };
const KONTEKS_ENTITY = { nama: 'Bos', peran: 'Entity Admin', lingkup: 'entity', namaLingkup: 'Kantor Pendem Mandala', hariIni: HARI_INI };

function modelBertahap(...balasan) {
  const panggilan = [];
  const panggilModel = async (_env, permintaan) => {
    panggilan.push(permintaan);
    return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'model kehabisan balasan' };
  };
  return { panggilModel, panggilan };
}
const langkah = (nilai) => ({ ok: true, value: nilai });

function produkBanyak() {
  const baris = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1, name: `Barang ${i + 1}`, category: 'Leker', price: 10000, averageCost: 7000,
    imageData: 'data:image/png;base64,AAAAAAAA', isActive: true
  }));
  baris[41] = { ...baris[41], name: 'Es Teh', price: 3000, averageCost: 3500.5 };
  baris[77] = { ...baris[77], name: 'Gula', price: 15000, averageCost: 15250 };
  return { store: { code: 'DERMO' }, products: baris };
}

function jalurPalsu({ perAlamat = {}, perGerai = {}, daftarGerai = ['BEJI', 'DERMO', 'GENENGAN'] } = {}) {
  const dibaca = [];
  const baca = (kode) => async (alamat) => {
    dibaca.push(`${kode || '-'} ${alamat}`);
    if (alamat === '/api/entity-admin/stores') return { ok: true, data: { stores: daftarGerai.map((code) => ({ code, storeName: code })) } };
    const sumber = kode ? (perGerai[kode] ?? perAlamat) : perAlamat;
    const hasil = typeof sumber === 'function' ? sumber(alamat) : sumber[alamat.split('?')[0]];
    return hasil?.ok === false ? hasil : { ok: true, data: hasil };
  };
  return { dibaca, baca: baca(''), jalurGerai: (kode) => ({ baca: baca(kode) }) };
}

// --- alur utama: pertanyaan di screenshot Bos Cyo ------------------------------

test('HPP di atas harga jual: baca → hitung oleh kode → jawab; angka dari tabel, gambar tak ikut ke model', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/master/products/editor': produkBanyak() } });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({
      langkah: 'hitung', daftar: 'products',
      turunan: [{ nama: 'margin', kolom_a: 'price', operasi: 'kurang', kolom_b: 'averageCost' }],
      saring: [{ kolom: 'margin', op: 'kurang_dari', nilai: '0' }],
      urut_kolom: 'margin', urut_arah: 'naik', kolom: ['name', 'price', 'averageCost', 'margin']
    }),
    langkah({ langkah: 'jawab', jawaban: 'Peh, ada 2 barang yang HPP-nya di atas harga jual: Gula (margin −250) dan Es Teh (margin −500,5).' })
  );

  const hasil = await bacaBebas({
    pertanyaan: 'barang mana yang hpp nya lebih tinggi dari harga jual?',
    pilihan: { api: 'barang', api_query: [] }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel
  });

  assert.equal(hasil.ok, true);
  assert.equal(panggilan.length, 2);
  // Model hanya melihat BENTUK data yang besar, bukan 300 baris dan bukan gambarnya.
  const dilihat = panggilan[0].content[0].text;
  assert.match(dilihat, /datanya besar/);
  assert.match(dilihat, /daftar "products": 300 baris/);
  assert.equal(dilihat.includes('base64'), false);
  assert.ok(dilihat.length < 6000);
  // Langkah kedua melihat hasil hitung dari kode.
  assert.match(panggilan[1].content[0].text, /HASIL HITUNG dari barang \/ products: 2 baris cocok/);
  // Tabel di layar dari kode, urut selisih terburuk.
  assert.deepEqual(hasil.tabel.isi.map((b) => b[0]), ['Es Teh', 'Gula']);
  assert.deepEqual(hasil.tabel.isi[0], ['Es Teh', '3.000', '3.500,5', '−500,5']);
  assert.equal(hasil.peringatan, null);
  assert.match(hasil.jejak, /dari barang · dihitung sistem/);
  assert.deepEqual(jalur.dibaca, ['- /api/admin/master/products/editor?ringkas=1']);
});

test('langkah terakhir hanya boleh menjawab, dan model dibatasi tiga langkah', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 5 }] } } });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({ langkah: 'baca', api: 'jenis_barang', api_query: [] }),
    langkah({ langkah: 'hitung', daftar: 'tidak_ada' }),
    langkah({ langkah: 'baca', api: 'supplier' }), // diabaikan: langkah terakhir dipaksa jawab
  );
  const hasil = await bacaBebas({
    pertanyaan: 'stok?', pilihan: { api: 'stok', api_query: [] }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel
  });
  assert.equal(panggilan.length, 3);
  assert.deepEqual(panggilan[0].schema.properties.langkah.enum, ['jawab', 'hitung', 'baca']);
  assert.deepEqual(panggilan[2].schema.properties.langkah.enum, ['jawab']);
  assert.match(panggilan[2].system, /langkah terakhir/);
  assert.equal(hasil.ok, true);
  assert.match(hasil.jawaban, /belum bisa menyimpulkan/);
});

test('data kecil dikirim utuh sehingga cukup satu langkah', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 5 }] } } });
  const { panggilModel, panggilan } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'Gula tinggal 5.' }));
  const hasil = await bacaBebas({ pertanyaan: 'stok gula?', pilihan: { api: 'stok' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.equal(panggilan.length, 1);
  assert.match(panggilan[0].content[0].text, /"name":"Gula","quantity":5/);
  assert.equal(hasil.jawaban, 'Gula tinggal 5.');
  assert.equal(hasil.tabel, null);
});

// --- angka tidak boleh dikarang -------------------------------------------------

test('angka di jawaban yang tidak ada di data dilaporkan, angka yang ada lolos', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/laporan-beban': { total: 1500000, kategori: [{ nama: 'Gaji', jumlah: 1500000 }] } } });
  const { panggilModel } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'Total beban 1.500.000, naik dari 1.200.000 bulan lalu.' }));
  const hasil = await bacaBebas({ pertanyaan: 'beban?', pilihan: { api: 'beban' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.match(hasil.peringatan, /1\.200\.000/);
  assert.equal(hasil.peringatan.includes('1.500.000'), false);
});

test('angkaTanpaBukti: pemisah ribuan, desimal, dan angka kecil yang berisik diabaikan', () => {
  const bukti = '{"total":1500000,"rata":12.5,"tanggal":"2026-10-02"} hari ini 2026-10-02';
  assert.deepEqual(angkaTanpaBukti('Total 1.500.000, rata 12,5 pada 2026, ada 3 barang dan 45 baris.', bukti), []);
  assert.deepEqual(angkaTanpaBukti('Total 2.500.000 dan 777', bukti), ['2.500.000', '777']);
});

// --- kegagalan dan pagar ---------------------------------------------------------

test('API yang tidak ada atau parameter buruk: dijawab terus terang tanpa memanggil model', async () => {
  const jalur = jalurPalsu();
  const { panggilModel, panggilan } = modelBertahap();
  const a = await bacaBebas({ pertanyaan: 'x', pilihan: { api: 'hapus_semua' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.match(a.jawaban, /tidak ada di daftar/);
  const b = await bacaBebas({ pertanyaan: 'x', pilihan: { api: 'laba', api_query: [{ kunci: 'from', nilai: 'kemarin' }] }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.match(b.jawaban, /YYYY-MM-DD/);
  assert.equal(panggilan.length, 0);
  assert.equal(jalur.dibaca.length, 0);
});

test('endpoint menolak (bukan hak penyuruh): pesan penolakan sampai ke jawaban, bukan dikarang', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/employees': { ok: false, error: 'Admin Gerai tidak berwenang.' } } });
  const { panggilModel } = modelBertahap();
  const hasil = await bacaBebas({ pertanyaan: 'karyawan?', pilihan: { api: 'karyawan' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.match(hasil.jawaban, /Admin Gerai tidak berwenang/);
});

test('hasil baca yang sama tidak dibaca dua kali; daftar yang salah memberi petunjuk daftar yang ada', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 5 }] } } });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({ langkah: 'baca', api: 'stok', api_query: [] }),
    langkah({ langkah: 'hitung', daftar: 'barang' }),
    langkah({ langkah: 'jawab', jawaban: 'Gula tinggal 5.' })
  );
  await bacaBebas({ pertanyaan: 'stok?', pilihan: { api: 'stok' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.equal(jalur.dibaca.length, 1);
  assert.match(panggilan[1].content[0].text, /sudah dibaca tadi/);
  assert.match(panggilan[2].content[0].text, /GAGAL MENGHITUNG: daftar "barang" tidak ada di stok. Daftar yang ada: stocks/);
});

test('anggaran baca per pertanyaan dihormati', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/stock': { stocks: [] }, '/api/admin/suppliers': { suppliers: [] } } });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({ langkah: 'baca', api: 'supplier' }),
    langkah({ langkah: 'jawab', jawaban: 'ok' })
  );
  await bacaBebas({ pertanyaan: 'x', pilihan: { api: 'stok' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel, maksBaca: 1 });
  assert.match(panggilan[1].content[0].text, /anggaran baca per pertanyaan habis/);
  assert.equal(jalur.dibaca.length, 1);
});

test('model yang gagal dilaporkan sebagai gagal', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/stock': { stocks: [] } } });
  const { panggilModel } = modelBertahap({ ok: false, status: 502, error: 'Mesin AI menolak' });
  const hasil = await bacaBebas({ pertanyaan: 'x', pilihan: { api: 'stok' }, konteks: KONTEKS_GERAI, jalurAksi: jalur, panggilModel });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.status, 502);
});

// --- semua gerai --------------------------------------------------------------------

test('semua gerai: API biasa dibaca per gerai lalu digabung dengan kolom _gerai', async () => {
  const jalur = jalurPalsu({
    perGerai: {
      BEJI: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 5 }] } },
      DERMO: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 9 }] } },
      GENENGAN: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 2 }] } }
    }
  });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({ langkah: 'hitung', daftar: 'stocks', agregat_fungsi: 'jumlah', agregat_kolom: 'quantity', agregat_per: '_gerai' }),
    langkah({ langkah: 'jawab', jawaban: 'Dermo paling banyak.' })
  );
  const hasil = await bacaBebas({ pertanyaan: 'stok gula per gerai', pilihan: { api: 'stok' }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel });
  assert.match(panggilan[0].content[0].text, /3 dari 3 gerai terbaca/);
  assert.deepEqual(hasil.tabel.isi, [['DERMO', '9', '1'], ['BEJI', '5', '1'], ['GENENGAN', '2', '1']]);
  assert.deepEqual(jalur.dibaca.filter((d) => d.endsWith('/api/admin/stock')).map((d) => d.split(' ')[0]), ['BEJI', 'DERMO', 'GENENGAN']);
});

test('semua gerai: gerai yang gagal disebut, dan batas sistem menghentikan pembacaan berikutnya', async () => {
  const jalur = jalurPalsu({
    perGerai: {
      BEJI: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 5 }] } },
      DERMO: { '/api/admin/stock': { ok: false, error: 'pembacaan gagal: Too many API requests by single worker invocation.' } },
      GENENGAN: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 2 }] } }
    }
  });
  const { panggilModel, panggilan } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'Baru Beji.' }));
  await bacaBebas({ pertanyaan: 'stok', pilihan: { api: 'stok' }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel });
  assert.match(panggilan[0].content[0].text, /1 dari 3 gerai terbaca, gagal: DERMO \(.*Too many.*\); GENENGAN \(dibatasi sistem\)/);
  assert.equal(jalur.dibaca.some((d) => d.startsWith('GENENGAN')), false, 'tidak lanjut membaca setelah kena batas');
});

test('semua gerai: API berat tetap dibaca lintas gerai, tapi barisnya dibatasi per gerai (kuota)', async () => {
  const diminta = [];
  const jalur = jalurPalsu({
    perGerai: Object.fromEntries(['BEJI', 'DERMO', 'GENENGAN'].map((kode) => [kode, (alamat) => {
      diminta.push(`${kode} ${alamat}`);
      return { transactions: [{ id: `${kode}-1`, kind: 'SALE', total: 10000 }] };
    }]))
  });
  const { panggilModel } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'Ada 3 penjualan.' }));
  const hasil = await bacaBebas({
    pertanyaan: 'penjualan terbaru semua gerai',
    pilihan: { api: 'transaksi', api_query: [{ kunci: 'limit', nilai: '100' }, { kunci: 'filter', nilai: 'SALES' }] },
    konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel
  });
  assert.equal(hasil.ok, true);
  assert.equal(diminta.length, 3);
  // Diminta 100 per gerai, dipotong jadi 20 — dan filter yang sah ikut.
  assert.ok(diminta.every((d) => /limit=20/.test(d) && /filter=SALES/.test(d)), diminta.join('\n'));
  // Tanpa limit pun tetap dibatasi.
  diminta.length = 0;
  await bacaBebas({ pertanyaan: 'x', pilihan: { api: 'transaksi' }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel: modelBertahap(langkah({ langkah: 'jawab', jawaban: 'ok' })).panggilModel });
  assert.ok(diminta.every((d) => /limit=20/.test(d)));
});

test('semua gerai: API yang tidak bermakna lintas gerai ditolak dengan alasan; lintas gerai asli satu panggilan', async () => {
  const jalur = jalurPalsu({ perGerai: { BEJI: { '/api/admin/entity-stock': { rows: [{ name: 'Gula', quantity: 5 }] } } } });
  const { panggilModel, panggilan } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'Gula 5.' }));

  for (const api of ['akuntansi_ringkas', 'hpp_hitung_ulang']) {
    const ditolak = await bacaBebas({ pertanyaan: 'x', pilihan: { api }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel });
    assert.match(ditolak.jawaban, /hanya bermakna untuk satu gerai/, api);
  }
  const mutasi = await bacaBebas({ pertanyaan: 'x', pilihan: { api: 'stok_mutasi', api_query: [{ kunci: 'id', nilai: '5' }] }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel });
  assert.match(mutasi.jawaban, /hanya bermakna untuk satu gerai/);
  assert.equal(panggilan.length, 0);

  const lintas = await bacaBebas({ pertanyaan: 'stok semua', pilihan: { api: 'stok_entity' }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel });
  assert.equal(lintas.ok, true);
  assert.equal(jalur.dibaca.filter((d) => d.endsWith('/api/admin/entity-stock')).length, 1);
});

test('periode dihitung kode dari maunya model; tanggal tulisan model ditimpa', async () => {
  const diminta = [];
  const jalur = jalurPalsu({
    perGerai: Object.fromEntries(['BEJI', 'DERMO'].map((kode) => [kode, (alamat) => {
      diminta.push(alamat);
      return { totals: { revenue: 100 } };
    }]))
  });
  const { panggilModel } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'ok' }));
  await bacaBebas({
    pertanyaan: 'laba kemarin',
    pilihan: { api: 'laba', periode: 'kemarin', api_query: [{ kunci: 'from', nilai: '2020-01-01' }] },
    konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel
  });
  assert.deepEqual(diminta, [
    '/api/admin/reports/net-profit?from=2026-10-01&to=2026-10-01',
    '/api/admin/reports/net-profit?from=2026-10-01&to=2026-10-01'
  ]);
});

test('API tingkat entity dibaca sekali lewat jalur utama, tanpa fan-out', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/entity-admin/stores': { stores: [{ code: 'BEJI' }] } } });
  const { panggilModel } = modelBertahap(langkah({ langkah: 'jawab', jawaban: 'Satu gerai.' }));
  await bacaBebas({ pertanyaan: 'gerai?', pilihan: { api: 'daftar_gerai' }, konteks: KONTEKS_ENTITY, jalurAksi: jalur, panggilModel });
  assert.deepEqual(jalur.dibaca, ['- /api/entity-admin/stores']);
});

// --- lewat otak Una -------------------------------------------------------------------

test('otak Una: baca_api ada di pilihan alat, dengan daftar API di prompt, lalu masuk ke pembaca', async () => {
  const jalur = jalurPalsu({ perAlamat: { '/api/admin/stock': { stocks: [{ name: 'Gula', quantity: 5 }] } } });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({ alat: 'baca_api', api: 'stok', api_query: [] }),
    langkah({ langkah: 'jawab', jawaban: 'Gula tinggal 5.' })
  );
  const hasil = await jawabPertanyaan('stok gula berapa', KONTEKS_GERAI, { env: {}, jalurAksi: jalur, panggilModel });

  assert.ok(panggilan[0].schema.properties.alat.enum.includes('baca_api'));
  assert.equal(panggilan[0].schema.properties.api.type, 'string');
  assert.match(panggilan[0].system, /- barang: Master barang gerai/);
  assert.match(panggilan[0].system, /- transaksi \[berat\]/);
  assert.equal(hasil.alat, 'baca_api');
  assert.equal(hasil.jawaban, 'Gula tinggal 5.');
  assert.equal(hasil.draft, undefined);
});

// --- alat baca lama di tingkat entity -------------------------------------------------

test('otak Una: "untung hari ini" di tingkat entity dibaca ke semua gerai, bukan ditolak', async () => {
  const jalur = jalurPalsu({
    perGerai: {
      BEJI: { '/api/admin/reports/net-profit': { totals: { netProfit: 117000 } } },
      DERMO: { '/api/admin/reports/net-profit': { totals: { netProfit: 50000 } } },
      GENENGAN: { '/api/admin/reports/net-profit': { totals: { netProfit: 9000 } } }
    }
  });
  const { panggilModel, panggilan } = modelBertahap(
    langkah({ alat: 'laba_periode', periode: 'hari_ini' }),
    langkah({ langkah: 'hitung', daftar: 'ringkasan_gerai', agregat_fungsi: 'jumlah', agregat_kolom: 'totals.netProfit' }),
    langkah({ langkah: 'jawab', jawaban: 'Total untung semua gerai 176.000.' })
  );
  const hasil = await jawabPertanyaan('untung hari ini berapa', KONTEKS_ENTITY, { env: {}, jalurAksi: jalur, panggilModel });
  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.tabel.isi, [['176.000', '3']]);
  assert.equal(hasil.peringatan, null);
  assert.equal(panggilan.length, 3);
});

test('otak Una: mencatat di tingkat entity dijawab dengan alasan yang benar (per gerai)', async () => {
  const { panggilModel } = modelBertahap(langkah({ alat: 'catat_pengeluaran', keterangan: 'gas', nominal_tertulis: '22rb' }));
  const hasil = await jawabPertanyaan('beli gas 22rb', KONTEKS_ENTITY, { env: {}, jalurAksi: jalurPalsu(), panggilModel });
  assert.match(hasil.jawaban, /Mencatat dikerjakan per gerai/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { MAKS_BARIS_BARANG } from '../src/caca-aksi-barang.js';
import { jawabPertanyaan, susunRencana } from '../src/caca-agen.js';
import { bangunAlamat, cariApi } from '../src/caca-baca-katalog.js';
import { KAMUS, LAYAR, cariTopik, jelaskan } from '../src/caca-jelaskan.js';
import { susunKesiapan, sapaanKesiapan } from '../src/caca-kesiapan.js';
import { tangkapanDariMenu } from '../src/caca-baca-menu.js';

const BOOTSTRAP = {
  store: { code: 'LAB01', storeName: 'Gerai Contoh', attendanceRefLatitude: null, attendanceRefLongitude: null },
  itemTypes: [
    { id: 't_jadi', code: 'FINISHED_GOOD', name: 'Barang Jadi' },
    { id: 't_bahan', code: 'RAW_MATERIAL', name: 'Bahan' }
  ],
  units: [
    { id: 'u_pcs', code: 'PCS', name: 'Pcs', symbol: 'pcs', isActive: true },
    { id: 'u_g', code: 'GRAM', name: 'Gram', symbol: 'g', isActive: true },
    { id: 'u_ml', code: 'ML', name: 'Mililiter', symbol: 'ml', isActive: true }
  ],
  products: [{ id: 7, name: 'Es Teh', itemTypeCode: 'FINISHED_GOOD' }]
};

function jalurPalsu(bootstrap = BOOTSTRAP) {
  const terkirim = [];
  return {
    terkirim,
    baca: async (path) => (path === '/api/admin/manufacturing/bootstrap' ? { ok: true, data: bootstrap } : { ok: false, error: path }),
    kirim: async (method, path, body) => { terkirim.push({ method, path, body }); return { ok: true, data: { id: 99 } }; },
    hariIni: '2026-10-02',
    namaLingkup: 'Gerai Contoh',
    lingkup: 'gerai'
  };
}

const siapkan = (t, jalur = jalurPalsu()) => cariAksi('buat_barang_banyak').siapkan({ daftar_kategori: '', daftar_jenis: 'jualan', ...t }, jalur);

test('isi massal: default ditulis terang, yang sudah ada dilewati', async () => {
  const hasil = await siapkan({
    daftar_barang: [
      { nama: 'Es Teh', harga_jual: '5rb' },
      { nama: 'Kopi Susu', harga_jual: '12rb' },
      { nama: 'Roti Bakar', harga_jual: '15rb', harga_beli: '6rb', kategori: 'Makanan' }
    ]
  });
  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.muatan, {
    daftar: [
      { name: 'Kopi Susu', category: 'Menu', price: 12000, purchasePrice: 0, baseUnitId: 'u_pcs', itemTypeId: 't_jadi' },
      { name: 'Roti Bakar', category: 'Makanan', price: 15000, purchasePrice: 6000, baseUnitId: 'u_pcs', itemTypeId: 't_jadi' }
    ],
    sudahAda: ['Es Teh']
  });
  const dampak = hasil.draft.dampak.join('\n');
  assert.match(dampak, /"Menu"/, 'kategori bawaan disebut');
  assert.match(dampak, /Harga beli yang kosong diisi 0/, 'harga beli 0 tidak diam-diam');
  assert.match(dampak, /Sudah ada di gerai ini, dilewati: Es Teh/);
  assert.match(dampak, /batalkan yang barusan/);
  assert.equal(hasil.draft.bertahap, true);
});

test('isi massal: harga singkat dibaca ribuan hanya kalau SEMUA harga ditulis singkat', async () => {
  const singkat = await siapkan({ daftar_barang: [{ nama: 'Teh Tarik', harga_jual: '5' }, { nama: 'Kopi', harga_jual: '12', harga_beli: '4' }] });
  assert.deepEqual(singkat.draft.muatan.daftar.map((b) => [b.price, b.purchasePrice]), [[5000, 0], [12000, 4000]]);
  assert.ok(singkat.draft.dampak.some((d) => /ribuan/.test(d)));

  const campur = await siapkan({ daftar_barang: [{ nama: 'Permen', harga_jual: '500' }, { nama: 'Kopi', harga_jual: '12rb' }] });
  assert.deepEqual(campur.draft.muatan.daftar.map((b) => b.price), [500, 12000]);
  assert.ok(!campur.draft.dampak.some((d) => /ribuan/.test(d)));
});

test('isi massal: baris bermasalah dilewati dan disebut, sisanya tetap jalan', async () => {
  const hasil = await siapkan({
    daftar_barang: [
      { nama: 'Kopi', harga_jual: '12rb' },
      { nama: 'Pisang Goreng' },
      { nama: 'Bakso', harga_jual: 'murah' },
      { nama: 'Kopi', harga_jual: '15rb' },
      { nama: 'Sirup', harga_jual: '8rb', satuan: 'botol' }
    ]
  });
  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.draft.muatan.daftar.map((b) => b.name), ['Kopi']);
  const dampak = hasil.draft.dampak.join('\n');
  assert.match(dampak, /Pisang Goreng \(harga jualnya belum ada\)/);
  assert.match(dampak, /Bakso \(harga jual "murah" belum kebaca\)/);
  assert.match(dampak, /Sirup \(satuan "botol" belum dikenal\)/);
  assert.match(dampak, /Disebut dua kali, dipakai yang pertama: Kopi/);
});

test('isi massal bahan: tipe Bahan, harga jual 0, satuan yang tidak disebut jadi pcs dan ditulis', async () => {
  const hasil = await siapkan({
    daftar_jenis: 'bahan',
    daftar_barang: [{ nama: 'Gula Pasir', satuan: 'gram' }, { nama: 'Susu', satuan: 'ml', harga_beli: '20' }, { nama: 'Teh' }]
  });
  assert.deepEqual(hasil.draft.muatan.daftar, [
    { name: 'Gula Pasir', category: 'Bahan', price: 0, purchasePrice: 0, baseUnitId: 'u_g', itemTypeId: 't_bahan' },
    { name: 'Susu', category: 'Bahan', price: 0, purchasePrice: 20, baseUnitId: 'u_ml', itemTypeId: 't_bahan' },
    { name: 'Teh', category: 'Bahan', price: 0, purchasePrice: 0, baseUnitId: 'u_pcs', itemTypeId: 't_bahan' }
  ]);
  assert.deepEqual(hasil.draft.tabel.kolom, ['Nama', 'Kategori', 'Harga beli', 'Satuan']);
  assert.ok(hasil.draft.dampak.some((d) => /Una pakai pcs: Teh/.test(d)));
});

test('isi massal: daftar kosong atau semuanya sudah ada → ditanyakan, bukan draft kosong', async () => {
  assert.match((await siapkan({ daftar_barang: [] })).tanya, /Daftar barangnya mana/);
  const semuaAda = await siapkan({ daftar_barang: [{ nama: 'es teh', harga_jual: '5rb' }] });
  assert.equal(semuaAda.ok, false);
  assert.match(semuaAda.tanya, /sudah ada di gerai: es teh/);
});

test(`isi massal: maksimal ${MAKS_BARIS_BARANG} baris, sisanya disebut`, async () => {
  const daftar = Array.from({ length: MAKS_BARIS_BARANG + 5 }, (_, i) => ({ nama: `Menu ${i + 1}`, harga_jual: '10rb' }));
  const hasil = await siapkan({ daftar_barang: daftar });
  assert.equal(hasil.draft.muatan.daftar.length, MAKS_BARIS_BARANG);
  assert.ok(hasil.draft.dampak.some((d) => /5 sisanya kirim lagi/.test(d)));
});

test('isi massal: potongan berikutnya tetap lolos periksa ulang walau barang potongan sebelumnya sudah ada', async () => {
  const tangkapan = { daftar_barang: [{ nama: 'Kopi', harga_jual: '12rb' }, { nama: 'Roti', harga_jual: '15rb' }], daftar_kategori: '', daftar_jenis: 'jualan' };
  const awal = await siapkan(tangkapan);
  const draft = { ...awal.draft, tangkapan };
  // Kopi sudah dibuat potongan pertama.
  const sesudah = jalurPalsu({ ...BOOTSTRAP, products: [...BOOTSTRAP.products, { id: 8, name: 'Kopi' }] });
  const diperiksa = await periksaUlangDraft(draft, sesudah);
  assert.equal(diperiksa.ok, true, diperiksa.error);

  const ulangKopi = await diperiksa.aksi.postingBagian(diperiksa.draft, 0, sesudah);
  assert.deepEqual(ulangKopi, { ok: true, hasil: 'sudah_ada', nama: 'Kopi', id: 8 });
  const roti = await diperiksa.aksi.postingBagian(diperiksa.draft, 1, sesudah);
  assert.equal(roti.hasil, 'dibuat');
  assert.deepEqual(sesudah.terkirim, [{
    method: 'POST',
    path: '/api/admin/master/products/editor?ringkas=1',
    body: { name: 'Roti', category: 'Menu', price: 15000, purchasePrice: 0, baseUnitId: 'u_pcs', itemTypeId: 't_jadi' }
  }]);
});

test('nonaktifkan barang: nama dicocokkan, yang ambigu ditanyakan; konfirmasi menolak nama yang berubah', async () => {
  const bootstrap = { ...BOOTSTRAP, products: [{ id: 1, name: 'Es Teh Manis' }, { id: 2, name: 'Es Teh Tawar' }, { id: 3, name: 'Kopi' }] };
  const aksi = cariAksi('nonaktifkan_barang');
  const ambigu = await aksi.siapkan({ nonaktif_barang: ['es teh'] }, jalurPalsu(bootstrap));
  assert.equal(ambigu.ok, false);
  assert.match(ambigu.tanya, /Es Teh Manis/);

  const hasil = await aksi.siapkan({ nonaktif_barang: ['kopi'] }, jalurPalsu(bootstrap));
  assert.deepEqual(hasil.draft.muatan.daftar, [{ id: 3, name: 'Kopi' }]);

  const draft = { ...hasil.draft, tangkapan: { nonaktif_barang: ['kopi'] } };
  const diganti = { ...bootstrap, products: [{ id: 3, name: 'Kopi Hitam' }] };
  const tolak = await periksaUlangDraft(draft, jalurPalsu(diganti));
  assert.equal(tolak.ok, false);
});

test('agen: daftar barang → draft massal dengan tangkapan, tidak ada yang terkirim', async () => {
  const jalur = jalurPalsu();
  const hasil = await jawabPertanyaan('masukin menu: kopi 12rb, roti 15rb', {
    nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Gerai Contoh', storeCode: 'LAB01', storeName: 'Gerai Contoh', hariIni: '2026-10-02'
  }, {
    jalurAksi: jalur,
    panggilModel: async () => ({
      ok: true,
      value: { alat: 'buat_barang_banyak', daftar_barang: [{ nama: 'kopi', harga_jual: '12rb' }, { nama: 'roti', harga_jual: '15rb' }], daftar_jenis: 'jualan' }
    })
  });
  assert.equal(hasil.perluKonfirmasi, true);
  assert.equal(hasil.draft.aksi, 'buat_barang_banyak');
  assert.deepEqual(Object.keys(hasil.draft.tangkapan).sort(), ['daftar_barang', 'daftar_jenis', 'daftar_kategori']);
  assert.equal(jalur.terkirim.length, 0);
});

test('agen: "HPP itu apa" dijawab kamus, model dipanggil sekali saja', async () => {
  let panggilan = 0;
  const hasil = await jawabPertanyaan('hpp itu apa sih?', {
    nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Gerai Contoh', storeCode: 'LAB01', storeName: 'Gerai Contoh', hariIni: '2026-10-02'
  }, {
    jalurAksi: jalurPalsu(),
    panggilModel: async () => { panggilan += 1; return { ok: true, value: { alat: 'jelaskan', jelaskan_topik: 'hpp' } }; }
  });
  assert.equal(panggilan, 1);
  assert.match(hasil.jawaban, /HPP = modal/);
  assert.ok(hasil.tawaran.length > 0);
});

test('kamus: kunci terpanjang menang, semua tawaran menunjuk layar dan topik yang ada', () => {
  assert.equal(cariTopik('rekening bersama itu apa').id, 'rekening_bersama');
  assert.equal(cariTopik('akun kasir bikinnya di mana').id, 'akun_kasir');
  assert.equal(cariTopik('akun itu apa').id, 'akun');
  assert.equal(cariTopik('hpp').id, 'hpp');
  assert.equal(cariTopik('kenapa stok minus').id, 'stok_minus');
  assert.equal(jelaskan('').dikenal, false);

  const topik = new Set(KAMUS.map((e) => e.id));
  for (const entri of KAMUS) {
    for (const t of entri.tawaran) {
      if (t.jenis === 'buka') assert.ok(LAYAR[t.layar], `${entri.id}: layar ${t.layar}`);
      if (t.jenis === 'jelaskan') assert.ok(topik.has(t.topik), `${entri.id}: topik ${t.topik}`);
    }
  }
});

test('kesiapan: bacaan yang gagal tidak dianggap "belum", urutan langkah mengikuti yang wajib', () => {
  const kosong = susunKesiapan({ referensi: { ...BOOTSTRAP, products: [] }, resep: { recipes: [] }, kasir: { cashiers: [] }, karyawan: { employees: [] }, laci: { drawers: [] } });
  assert.equal(kosong.berikutnya, 'menu');
  assert.equal(kosong.beres, 0);
  assert.match(sapaanKesiapan(kosong), /Gerai Contoh masih kosong/);

  const adaMenu = susunKesiapan({ referensi: BOOTSTRAP, resep: { recipes: [] }, kasir: { cashiers: [] }, karyawan: null, laci: { drawers: [] } });
  assert.equal(adaMenu.berikutnya, 'kasir');
  assert.equal(adaMenu.langkah.find((l) => l.id === 'karyawan').selesai, null, 'gagal dibaca = belum diketahui');
  assert.deepEqual(adaMenu.langkah.find((l) => l.id === 'menu').tawaran, [], 'langkah beres tidak menawarkan apa-apa');

  const jalan = susunKesiapan({
    referensi: { ...BOOTSTRAP, store: { ...BOOTSTRAP.store, attendanceRefLatitude: -7.9, attendanceRefLongitude: 112.6 } },
    resep: { recipes: [{ status: 'ACTIVE' }] },
    kasir: { cashiers: [{ isActive: true }] },
    karyawan: { employees: [{ status: 'ACTIVE', ownedByThisStore: true }] },
    laci: { drawers: [{ id: 'd1' }] }
  });
  assert.equal(jalan.siapJualan, true);
  assert.equal(jalan.berikutnya, null);
  assert.equal(jalan.beres, jalan.total);
});

test('foto menu: tulisan kapital semua dirapikan, yang campuran dibiarkan', () => {
  const t = tangkapanDariMenu({ barang: [{ nama: 'ES TEH MANIS', harga: '5', kategori: 'MINUMAN' }, { nama: 'Kopi ABC', harga: '8' }, { nama: '  ' }] });
  assert.deepEqual(t.daftar_barang.map((b) => [b.nama, b.kategori]), [['Es Teh Manis', 'Minuman'], ['Kopi ABC', '']]);
  assert.equal(t.daftar_jenis, 'jualan');
});

// Bos Cyo 2026-10-03: perintah berurutan ditulis dulu jadi langkah ✓ / … / ○,
// dikerjakan satu per satu, dan bisa dilanjutkan dari langkah yang terputus.
test('rencana: model menulis langkah, server tidak menjalankan apa pun', async () => {
  const jalur = jalurPalsu();
  const hasil = await jawabPertanyaan('cek harga yang anomali, lalu ganti dengan harga normal', {
    nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Gerai Contoh', storeCode: 'LAB01', storeName: 'Gerai Contoh', hariIni: '2026-10-03'
  }, {
    jalurAksi: jalur,
    panggilModel: async () => ({ ok: true, value: { alat: 'rencana', rencana_langkah: [
      { judul: 'Baca daftar harga', perintah: 'baca daftar harga jual semua barang di gerai ini' },
      { judul: 'Pilih yang anomali', perintah: 'dari daftar tadi, barang mana yang harganya tidak wajar?' },
      { judul: 'Ganti harga', perintah: 'ganti harga barang yang tidak wajar tadi ke harga normalnya; tanyakan ke Bos kalau belum jelas' }
    ] } })
  });
  assert.equal(hasil.rencana.length, 3);
  assert.equal(hasil.rencana[0].judul, 'Baca daftar harga');
  assert.equal(jalur.terkirim.length, 0);
  assert.equal(hasil.draft, undefined);
});

test('rencana: dibersihkan; kurang dari 2 langkah bukan rencana; maks MAKS_LANGKAH_RENCANA (8)', () => {
  assert.equal(susunRencana([{ judul: 'a', perintah: 'b' }]), null);
  assert.equal(susunRencana('bukan daftar'), null);
  assert.equal(susunRencana([{ judul: '', perintah: 'x' }, { judul: 'y', perintah: '' }]), null);
  const banyak = susunRencana(Array.from({ length: 12 }, (_, i) => ({ judul: ` L${i}\n `, perintah: `p${i}` })));
  assert.equal(banyak.length, 8);
  assert.equal(banyak[0].judul, 'L0');
});

test('prompt: fakta harga ada di gerai (bukan entity), cek_barang dan rencana disebut', async () => {
  let sistem = '';
  await jawabPertanyaan('halo', { nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'X', storeCode: 'X', storeName: 'X', hariIni: '2026-10-03' }, {
    jalurAksi: jalurPalsu(), panggilModel: async (_env, p) => { sistem = p.system; return { ok: true, value: { alat: 'tidak_ada' } }; }
  });
  assert.match(sistem, /Entity tidak\n?\s*menyimpan harga|Entity tidak menyimpan harga/);
  assert.match(sistem, /jangan bilang tidak punya akses ke master/);
  assert.match(sistem, /= cek_barang/);
  assert.match(sistem, /rencana: pilih ini HANYA/);
});

test('katalog barang selalu meminta daftar tanpa foto', () => {
  assert.equal(bangunAlamat(cariApi('barang'), []).alamat, '/api/admin/master/products/editor?ringkas=1');
});

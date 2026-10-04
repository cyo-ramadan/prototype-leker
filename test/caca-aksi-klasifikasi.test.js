import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, bolehDiLingkup, periksaUlangDraft } from '../src/caca-aksi.js';
import { bangunJalurAksi } from '../src/caca-chat.js';

// Bos Cyo, 2026-10-03: celah yang tadinya hanya bisa dibereskan manual di Master
// Barang (MANDALA: bahan bertipe Barang Jadi, Gula bersatuan pcs padahal gram).

const TIPE = [
  { id: 't_raw', code: 'RAW_MATERIAL', name: 'Bahan Baku', isActive: true },
  { id: 't_semi', code: 'SEMI_FINISHED', name: 'Barang Setengah Jadi', isActive: true },
  { id: 't_fin', code: 'FINISHED_GOOD', name: 'Barang Jadi', isActive: true }
];
const JENIS = [
  { id: 'k_raw', code: 'RAW_MATERIAL', name: 'Bahan Baku', isActive: true },
  { id: 'k_fin', code: 'FINISHED_GOOD', name: 'Barang Jadi', isActive: true }
];
const SATUAN = [
  { id: 'u_g', code: 'GRAM', name: 'Gram', symbol: 'g', isActive: true },
  { id: 'u_kg', code: 'KILOGRAM', name: 'Kilogram', symbol: 'kg', isActive: true },
  { id: 'u_ml', code: 'MILILITER', name: 'Mililiter', symbol: 'ml', isActive: true },
  { id: 'u_pcs', code: 'PCS', name: 'Pcs', symbol: 'pcs', isActive: true }
];

function produk(id, name, itemTypeId, productKindId, baseUnitId, extra = {}) {
  return { id, name, isActive: true, itemTypeId, itemTypeName: TIPE.find((t) => t.id === itemTypeId)?.name, productKindId, productKindName: JENIS.find((k) => k.id === productKindId)?.name, productKindCode: JENIS.find((k) => k.id === productKindId)?.code, baseUnitId, unitSymbol: SATUAN.find((u) => u.id === baseUnitId)?.symbol, ...extra };
}

// Keadaan MANDALA 2026-10-03: semua bertipe Barang Jadi walau Jenis Barangnya Bahan Baku.
function dataMandala() {
  return {
    products: [
      produk(1, 'Air Mineral', 't_fin', 'k_raw', 'u_ml'),
      produk(2, 'Gula', 't_fin', 'k_raw', 'u_pcs'),
      produk(3, 'Larutan Gula', 't_fin', 'k_raw', 'u_ml'),
      produk(4, 'Teh Vanilla', 't_fin', 'k_raw', 'u_pcs'),
      produk(5, 'Teh Jasmine', 't_raw', 'k_raw', 'u_pcs'),
      produk(6, 'Es Teh', 't_fin', 'k_fin', 'u_pcs'),
      produk(7, 'Bahan Lama', 't_fin', 'k_raw', 'u_pcs', { isActive: false })
    ],
    itemTypes: TIPE, productKinds: JENIS, units: SATUAN
  };
}

function ctxPalsu(data = dataMandala(), terkirim = []) {
  return {
    terkirim, lingkup: 'gerai', storeCode: 'MANDALA', namaLingkup: 'Mandala', hariIni: '2026-10-03',
    baca: async (path) => (path === '/api/admin/master/products/editor?ringkas=1' ? { ok: true, data } : { ok: false, error: `tidak dikenal ${path}` }),
    kirim: async (method, path, body) => { terkirim.push({ method, path, body }); return { ok: true, data: { ok: true } }; }
  };
}

const aksi = () => cariAksi('betulkan_klasifikasi_barang');

test('terdaftar sebagai alat bertahap lingkup gerai', () => {
  assert.ok(aksi());
  assert.equal(aksi().bertahap, true);
  assert.equal(bolehDiLingkup(aksi(), 'gerai'), true);
  assert.equal(bolehDiLingkup(aksi(), 'entity'), false);
});

test('tipe banyak barang sekaligus: bahan baku dan setengah jadi, bahasa sehari-hari, Jenis Barang tidak ikut berubah', async () => {
  const hasil = await aksi().siapkan({ kb_daftar: [
    { barang: 'Air Mineral', tipe: 'bahan baku' },
    { barang: 'Teh Vanilla', tipe: 'Bahan Baku' },
    { barang: 'Larutan Gula', tipe: 'setengah jadi' },
    { barang: 'Teh Jasmine', tipe: 'bahan baku' }
  ] }, ctxPalsu());
  assert.equal(hasil.ok, true);
  const { draft } = hasil;
  assert.equal(draft.bertahap, true);
  assert.deepEqual(draft.muatan.daftar.map((b) => [b.name, b.perubahan]), [
    ['Air Mineral', { itemTypeId: 't_raw' }],
    ['Teh Vanilla', { itemTypeId: 't_raw' }],
    ['Larutan Gula', { itemTypeId: 't_semi' }]
  ]);
  assert.deepEqual(draft.muatan.sudahSesuai, ['Teh Jasmine']);
  assert.deepEqual(draft.tabel.isi[0], ['Air Mineral', 'Tipe barang', 'Barang Jadi', 'Bahan Baku']);
  assert.ok(draft.dampak.some((d) => /Jenis Barang .* tidak ikut berubah/.test(d)));
});

test('satuan "g" memilih Gram persis, bukan Kilogram; ganti satuan dijelaskan sebagai ganti label', async () => {
  const hasil = await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', tipe: 'bahan baku', satuan: 'g' }] }, ctxPalsu());
  assert.equal(hasil.ok, true);
  const [baris] = hasil.draft.muatan.daftar;
  assert.deepEqual(baris.perubahan, { itemTypeId: 't_raw', baseUnitId: 'u_g' });
  assert.equal(baris.ubahSatuan, true);
  assert.ok(hasil.draft.dampak.some((d) => /hanya mengganti LABEL.*TIDAK dikonversi/.test(d)));
  assert.deepEqual(hasil.draft.tabel.isi.find((r) => r[1] === 'Satuan'), ['Gula', 'Satuan', 'pcs', 'g']);
});

test('nama persis menang atas yang mengandung ("Gula" bukan "Larutan Gula"); nama ambigu ditanyakan', async () => {
  const exact = await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', satuan: 'g' }] }, ctxPalsu());
  assert.equal(exact.draft.muatan.daftar[0].id, 2);
  const ambigu = await aksi().siapkan({ kb_daftar: [{ barang: 'Teh', tipe: 'bahan baku' }] }, ctxPalsu());
  assert.equal(ambigu.ok, false);
  assert.match(ambigu.tanya, /cocok dengan beberapa barang/);
});

test('barang tidak ketemu / nonaktif tidak dicari / tipe atau satuan tidak dikenal: ditanyakan, tidak menebak', async () => {
  assert.match((await aksi().siapkan({ kb_daftar: [{ barang: 'Kopi Hantu', tipe: 'bahan baku' }] }, ctxPalsu())).tanya, /belum (ketemu|nemu) nih/);
  assert.match((await aksi().siapkan({ kb_daftar: [{ barang: 'Bahan Lama', tipe: 'bahan baku' }] }, ctxPalsu())).tanya, /belum (ketemu|nemu) nih/);
  assert.match((await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', tipe: 'ajaib' }] }, ctxPalsu())).tanya, /tipe barang/i);
  assert.match((await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', satuan: 'galon' }] }, ctxPalsu())).tanya, /satuan/i);
});

test('baris tanpa isian yang mau diganti, nama ganda, dan daftar kebanyakan ditolak', async () => {
  assert.match((await aksi().siapkan({ kb_daftar: [{ barang: 'Gula' }] }, ctxPalsu())).tanya, /mau diganti apanya/);
  assert.match((await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', satuan: 'g' }, { barang: 'gula', satuan: 'g' }] }, ctxPalsu())).tanya, /disebut dua kali/);
  const banyak = Array.from({ length: 61 }, () => ({ barang: 'Gula', satuan: 'g' }));
  assert.match((await aksi().siapkan({ kb_daftar: banyak }, ctxPalsu())).tanya, /Kebanyakan/);
  assert.match((await aksi().siapkan({}, ctxPalsu())).tanya, /Barang yang mana/);
});

test('sudah sesuai semua: tidak ada draft', async () => {
  const hasil = await aksi().siapkan({ kb_daftar: [{ barang: 'Teh Jasmine', tipe: 'bahan baku' }] }, ctxPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /sudah seperti yang diminta/);
});

test('tipe bukan Barang Jadi tetapi Jenis Barangnya Barang Jadi: diperingatkan', async () => {
  const hasil = await aksi().siapkan({ kb_daftar: [{ barang: 'Es Teh', tipe: 'bahan baku' }] }, ctxPalsu());
  assert.ok(hasil.draft.dampak.some((d) => /Es Teh.*Jenis Barangnya Barang Jadi/.test(d)));
});

test('Jenis Barang bisa dipasang eksplisit', async () => {
  const hasil = await aksi().siapkan({ kb_daftar: [{ barang: 'Es Teh', jenis: 'Bahan Baku' }] }, ctxPalsu());
  assert.deepEqual(hasil.draft.muatan.daftar[0].perubahan, { productKindId: 'k_raw' });
});

test('posting per barang lewat PATCH Master Barang; konfirmasi ganti satuan HANYA untuk baris yang menampilkan perubahan satuan', async () => {
  const ctx = ctxPalsu();
  const { draft } = await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', satuan: 'g' }, { barang: 'Air Mineral', tipe: 'bahan baku' }] }, ctx);
  const a = await aksi().postingBagian(draft, 0, ctx);
  const b = await aksi().postingBagian(draft, 1, ctx);
  assert.deepEqual([a, b].map((h) => [h.ok, h.hasil, h.nama]), [[true, 'diubah', 'Gula'], [true, 'diubah', 'Air Mineral']]);
  assert.deepEqual(ctx.terkirim, [
    { method: 'PATCH', path: '/api/admin/master/products/editor/2?ringkas=1', body: { baseUnitId: 'u_g', confirmUnitChange: true } },
    { method: 'PATCH', path: '/api/admin/master/products/editor/1?ringkas=1', body: { itemTypeId: 't_raw' } }
  ]);
  assert.equal((await aksi().posting(draft, ctx)).ok, false, 'tidak ada jalur satu-kali untuk alat bertahap');
});

test('kegagalan di tengah dikembalikan apa adanya supaya bisa dilanjutkan dari baris itu', async () => {
  const ctx = ctxPalsu();
  ctx.kirim = async () => ({ ok: false, status: 400, error: 'Satuan tidak valid.' });
  const { draft } = await aksi().siapkan({ kb_daftar: [{ barang: 'Gula', satuan: 'g' }] }, ctx);
  const hasil = await aksi().postingBagian(draft, 0, ctx);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.error, 'Satuan tidak valid.');
});

test('konfirmasi memakai isi draft yang BEKU: potongan yang sudah jalan tidak membuat draft dianggap berubah', async () => {
  const data = dataMandala();
  const ctx = ctxPalsu(data);
  const disiapkan = await aksi().siapkan({ kb_daftar: [{ barang: 'Air Mineral', tipe: 'bahan baku' }, { barang: 'Teh Vanilla', tipe: 'bahan baku' }] }, ctx);
  const draft = { ...disiapkan.draft, tangkapan: { kb_daftar: [{ barang: 'Air Mineral', tipe: 'bahan baku' }, { barang: 'Teh Vanilla', tipe: 'bahan baku' }] } };
  // Potongan pertama sudah jalan: Air Mineral kini bertipe Bahan Baku di data.
  data.products[0].itemTypeId = 't_raw';
  const lagi = await periksaUlangDraft(draft, ctx);
  assert.equal(lagi.ok, true);
  assert.equal(lagi.draft.muatan.daftar.length, 2);
});

test('draft beku yang bentuknya rusak ditolak', async () => {
  const hasil = await aksi().siapkan({}, { ...ctxPalsu(), draftAsli: { muatan: { daftar: [{ id: 'x', name: 1 }], catatan: [], sudahSesuai: [] } } });
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /berubah/);
});

test('jalur sungguhan mengizinkan PATCH Master Barang yang dipakai alat ini', async () => {
  const jalur = bangunJalurAksi(new Request('https://example.test/api/caca/catat'), {}, {
    storeCode: 'MANDALA',
    jalurUtama: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal((await jalur.baca('/api/admin/master/products/editor?ringkas=1')).ok, true);
  assert.equal((await jalur.kirim('PATCH', '/api/admin/master/products/editor/2?ringkas=1', { baseUnitId: 'u_g' })).ok, true);
});

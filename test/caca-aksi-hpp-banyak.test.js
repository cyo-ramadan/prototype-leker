import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, bolehDiLingkup, periksaUlangDraft } from '../src/caca-aksi.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { BATAS_HPP_BANYAK } from '../src/caca-aksi-hpp-banyak.js';

// Bos Cyo, 2026-10-03: "una uda bisa beresin hpp2 anomali dan hitungkan ulang
// dari september" -- puluhan bahan per gerai, satu draft, satu "Ya".

const BAHAN = [
  { productId: 11, name: 'Gula', unitSymbol: 'g', unitCode: 'GRAM', averageCostRupiah: 14417.638679 },
  { productId: 12, name: 'Air Mineral', unitSymbol: 'ml', unitCode: 'MILILITER', averageCostRupiah: 6.295733 },
  { productId: 13, name: 'Teh Jasmine', unitSymbol: 'pcs', unitCode: 'PCS', averageCostRupiah: 0 },
  { productId: 14, name: 'Larutan Gula', unitSymbol: 'ml', unitCode: 'MILILITER', averageCostRupiah: 11253.692048 },
  { productId: 15, name: 'Sedotan', unitSymbol: 'pcs', unitCode: 'PCS', averageCostRupiah: 52.1 }
];

// Pratinjau palsu: Sedotan sudah benar (tanpa penjualan terdampak), Teh Jasmine tanpa
// penjualan tapi harga rata-rata beda (hanya harga), sisanya punya penjualan terdampak.
function ringkasan(productId) {
  if (productId === 15) return { lineCount: 0, averageCostOnly: false, byDate: [] };
  if (productId === 13) return { lineCount: 0, averageCostOnly: true, byDate: [] };
  return {
    lineCount: 2, averageCostOnly: false,
    byDate: [
      { businessDate: '2026-09-21', saleCount: 3, oldHppRupiah: 900, newHppRupiah: 300, deltaRupiah: -600 },
      { businessDate: '2026-10-03', saleCount: 1, oldHppRupiah: 100, newHppRupiah: 50, deltaRupiah: -50 }
    ]
  };
}

function ctxPalsu(terkirim = []) {
  return {
    terkirim, lingkup: 'gerai', storeCode: 'BEJI', namaLingkup: 'Beji', hariIni: '2026-10-03',
    baca: async (path) => (path === '/api/admin/hpp-recalculation/components' ? { ok: true, data: { components: BAHAN } } : { ok: false, error: `tidak dikenal ${path}` }),
    kirim: async (method, path, body) => {
      terkirim.push({ method, path, body });
      if (path.endsWith('/preview')) return { ok: true, data: { summary: ringkasan(body.componentProductId) } };
      return { ok: true, data: { summary: { saleCount: 4, deltaRupiah: -650 } } };
    }
  };
}

const aksi = () => cariAksi('koreksi_hpp_banyak');
const daftarBenar = () => ({ kh_dari: '2026-09-21', kh_daftar: [
  { bahan: 'Gula', harga: '18.966667' },
  { bahan: 'Teh Jasmine', harga: '1500' },
  { bahan: 'Larutan Gula', harga: '11,3' }
] });

test('terdaftar sebagai alat bertahap lingkup gerai', () => {
  assert.ok(aksi());
  assert.equal(aksi().bertahap, true);
  assert.equal(bolehDiLingkup(aksi(), 'gerai'), true);
  assert.equal(bolehDiLingkup(aksi(), 'entity'), false);
});

test('draft: urutan persis seperti diminta, tanggal, penjualan terdampak, dan hanya-harga', async () => {
  const hasil = await aksi().siapkan(daftarBenar(), ctxPalsu());
  assert.equal(hasil.ok, true);
  const { draft } = hasil;
  assert.equal(draft.bertahap, true);
  assert.deepEqual(draft.muatan.daftar.map((b) => b.name), ['Gula', 'Teh Jasmine', 'Larutan Gula']);
  assert.deepEqual(draft.muatan.daftar.map((b) => b.unitCost), ['18.966667', '1500', '11.3'], 'koma desimal diubah ke titik, tidak pernah float');
  assert.deepEqual(draft.muatan.daftar.map((b) => b.hanyaHarga), [false, true, false]);
  assert.equal(draft.muatan.daftar[0].jual, 3, 'penjualan hari ini tidak dihitung "s/d kemarin"');
  assert.equal(draft.muatan.daftar[0].selisihRupiah, -600);
  assert.deepEqual(draft.baris[1], ['Mulai tanggal', '2026-09-21']);
  assert.deepEqual(draft.tabel.isi[1].slice(0, 3), ['Teh Jasmine', 'Rp0/pcs', 'Rp1.500/pcs']);
  assert.equal(draft.tabel.isi[1][4], 'harga saja');
  assert.ok(draft.dampak.some((d) => /bahan baku harus di depan olahan/i.test(d)));
});

test('bahan yang sudah benar dan tanpa penjualan terdampak dilewati dan disebut di draft', async () => {
  const t = daftarBenar();
  t.kh_daftar.push({ bahan: 'Sedotan', harga: '52.1' });
  const { draft } = await aksi().siapkan(t, ctxPalsu());
  assert.deepEqual(draft.muatan.sudahSesuai, ['Sedotan']);
  assert.equal(draft.muatan.daftar.length, 3);
  assert.ok(draft.dampak.some((d) => /Sudah sesuai.*Sedotan/.test(d)));
});

test('semua sudah sesuai: tidak ada draft', async () => {
  const hasil = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Sedotan', harga: '52.1' }] }, ctxPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /tidak ada yang perlu dikoreksi/i);
});

test('tanggal mulai wajib: tanpa tanggal Una bertanya, tidak menebak', async () => {
  const t = daftarBenar();
  delete t.kh_dari;
  const terkirim = [];
  const hasil = await aksi().siapkan(t, ctxPalsu(terkirim));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /tanggal berapa/i);
  assert.equal(terkirim.length, 0, 'belum ada pratinjau yang dijalankan');
});

test('tanggal per baris mengalahkan tanggal bersama; tanggal masa depan ditolak', async () => {
  const t = daftarBenar();
  t.kh_daftar[0].dari = '2026-09-25';
  const { draft } = await aksi().siapkan(t, ctxPalsu());
  assert.deepEqual(draft.muatan.daftar.map((b) => b.from), ['2026-09-25', '2026-09-21', '2026-09-21']);
  assert.match(draft.baris[1][1], /2026-09-21 s\/d 2026-09-25/);
  const masaDepan = await aksi().siapkan({ kh_dari: '2026-12-01', kh_daftar: [{ bahan: 'Gula', harga: '18' }] }, ctxPalsu());
  assert.equal(masaDepan.ok, false);
  assert.match(masaDepan.tanya, /masa depan/);
});

test('satu nama atau harga salah: berhenti sebelum pratinjau pertama', async () => {
  const terkirim = [];
  const t = { kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Gula', harga: '18' }, { bahan: 'Bahan Hantu', harga: '10' }] };
  const hasil = await aksi().siapkan(t, ctxPalsu(terkirim));
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Bahan Hantu/);
  assert.equal(terkirim.length, 0);

  const nol = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Gula', harga: '0' }] }, ctxPalsu());
  assert.equal(nol.ok, false);
  assert.match(nol.tanya, /Gula/);

  const dobel = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Gula', harga: '18' }, { bahan: 'gula', harga: '19' }] }, ctxPalsu());
  assert.equal(dobel.ok, false);
  assert.match(dobel.tanya, /dua kali/);
});

test('daftar kosong atau kebanyakan ditanyakan', async () => {
  assert.equal((await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [] }, ctxPalsu())).ok, false);
  const banyak = Array.from({ length: BATAS_HPP_BANYAK + 1 }, (_, i) => ({ bahan: `B${i}`, harga: '1' }));
  const hasil = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: banyak }, ctxPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Kebanyakan/);
});

test('posting per bagian: tepat satu Hitung Ulang HPP per bahan, dengan alasan dan tanggal dari draft', async () => {
  const terkirim = [];
  const ctx = ctxPalsu(terkirim);
  const { draft } = await aksi().siapkan(daftarBenar(), ctx);
  terkirim.length = 0;
  const hasil = await aksi().postingBagian(draft, 1, ctx);
  assert.deepEqual(hasil, { ok: true, hasil: 'dikoreksi', nama: 'Teh Jasmine', id: 13 });
  assert.equal(terkirim.length, 1);
  assert.equal(terkirim[0].method, 'POST');
  assert.equal(terkirim[0].path, '/api/admin/hpp-recalculation');
  assert.deepEqual({ ...terkirim[0].body, reason: undefined }, { componentProductId: 13, unitCost: '1500', from: '2026-09-21', reason: undefined });
  assert.ok(terkirim[0].body.reason.length >= 5);
  assert.equal((await aksi().posting(draft, ctx)).ok, false, 'tidak ada jalur satu-kali untuk alat bertahap');
});

test('kegagalan di tengah dikembalikan apa adanya supaya bisa dilanjutkan dari bahan itu', async () => {
  const ctx = ctxPalsu();
  const { draft } = await aksi().siapkan(daftarBenar(), ctx);
  ctx.kirim = async () => ({ ok: false, status: 400, error: 'Terlalu banyak penjualan.' });
  const hasil = await aksi().postingBagian(draft, 0, ctx);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.error, 'Terlalu banyak penjualan.');
});

test('konfirmasi memakai draft BEKU: tanpa pratinjau ulang, dan draft hasilnya identik dengan yang dilihat', async () => {
  const ctx = ctxPalsu();
  const disiapkan = await aksi().siapkan(daftarBenar(), ctx);
  const draft = { ...disiapkan.draft, tangkapan: daftarBenar() };
  const terkirim = [];
  // Setelah potongan pertama jalan, pratinjau akan menjawab lain; draft beku tidak boleh peduli.
  const ctxLagi = { ...ctxPalsu(terkirim), baca: async () => ({ ok: false, error: 'tidak boleh dibaca ulang' }) };
  const lagi = await periksaUlangDraft(draft, ctxLagi);
  assert.equal(lagi.ok, true);
  assert.equal(terkirim.length, 0);
  assert.equal(lagi.draft.muatan.daftar.length, 3);
});

test('draft beku yang bentuknya rusak atau berisi angka aneh ditolak', async () => {
  const rusak = await aksi().siapkan({}, { ...ctxPalsu(), draftAsli: { muatan: { daftar: [{ componentProductId: 'x', name: 1 }], sudahSesuai: [] } } });
  assert.equal(rusak.ok, false);
  assert.match(rusak.tanya, /berubah/);

  const { draft } = await aksi().siapkan(daftarBenar(), ctxPalsu());
  const aneh = structuredClone(draft);
  aneh.muatan.daftar[0].unitCost = '1e9';
  const hasil = await aksi().siapkan({}, { ...ctxPalsu(), draftAsli: aneh });
  assert.equal(hasil.ok, false, 'harga hanya boleh digit dengan titik desimal');
});

test('koma desimal tiga digit dibaca desimal (4,664), titik tiga digit tetap dibaca ribuan (4.664 = 4664): format daftar di INSTRUKSI-UNA-HPP-SEPTEMBER.md memakai koma', async () => {
  const koma = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Gula', harga: '4,664' }] }, ctxPalsu());
  assert.equal(koma.draft.muatan.daftar[0].unitCost, '4.664');
  const titik = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Gula', harga: '4.664' }] }, ctxPalsu());
  assert.equal(titik.draft.muatan.daftar[0].unitCost, '4664', 'perilaku yang sama dengan hitung_ulang_hpp; makanya dokumen instruksi memakai koma');
});

test('jalur sungguhan mengizinkan semua jalur yang dipakai alat ini', async () => {
  const jalur = bangunJalurAksi(new Request('https://example.test/api/caca/catat'), {}, {
    storeCode: 'BEJI',
    jalurUtama: async () => new Response(JSON.stringify({ ok: true, components: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal((await jalur.baca('/api/admin/hpp-recalculation/components')).ok, true);
  assert.equal((await jalur.kirim('POST', '/api/admin/hpp-recalculation/preview', { componentProductId: 1, unitCost: '1', from: '2026-09-01' })).ok, true);
  assert.equal((await jalur.kirim('POST', '/api/admin/hpp-recalculation', { componentProductId: 1, unitCost: '1', from: '2026-09-01', reason: 'uji koreksi' })).ok, true);
});

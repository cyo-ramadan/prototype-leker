import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, bolehDiLingkup, periksaUlangDraft } from '../src/caca-aksi.js';
import { bangunJalurAksi } from '../src/caca-chat.js';
import { BATAS_HPP_BANYAK } from '../src/caca-aksi-hpp-banyak.js';

// Bos Cyo, 2026-10-03: "una uda bisa beresin hpp2 anomali dan hitungkan ulang
// dari september" -- puluhan bahan per gerai, satu draft, satu "Ya".
// Revisi hari yang sama: draft tidak boleh memanggil pratinjau per bahan dalam satu
// permintaan (batas kerja per permintaan paket Cloudflare gratis).

const BAHAN = [
  { productId: 11, name: 'Gula', unitSymbol: 'g', unitCode: 'GRAM', averageCostRupiah: 14417.638679 },
  { productId: 12, name: 'Air Mineral', unitSymbol: 'ml', unitCode: 'MILILITER', averageCostRupiah: 6.295733 },
  { productId: 13, name: 'Teh Jasmine', unitSymbol: 'pcs', unitCode: 'PCS', averageCostRupiah: 0 },
  { productId: 14, name: 'Larutan Gula', unitSymbol: 'ml', unitCode: 'MILILITER', averageCostRupiah: 11253.692048 },
  { productId: 15, name: 'Sedotan', unitSymbol: 'pcs', unitCode: 'PCS', averageCostRupiah: 52.1 }
];

const SUDAH_SAMA = 'Tidak ada penjualan yang HPP-nya berubah dan harga rata-rata bahan sudah sama dengan harga ini.';

function ctxPalsu(terkirim = []) {
  return {
    terkirim, lingkup: 'gerai', storeCode: 'BEJI', namaLingkup: 'Beji', hariIni: '2026-10-03',
    baca: async (path) => {
      terkirim.push({ method: 'GET', path });
      return path === '/api/admin/hpp-recalculation/components' ? { ok: true, data: { components: BAHAN } } : { ok: false, error: `tidak dikenal ${path}` };
    },
    kirim: async (method, path, body) => {
      terkirim.push({ method, path, body });
      // Sedotan sudah benar: Hitung Ulang HPP menolak dengan 409 seperti aslinya.
      if (body.componentProductId === 15) return { ok: false, status: 409, error: SUDAH_SAMA };
      return { ok: true, data: { summary: { saleCount: 4, deltaRupiah: -650 } } };
    }
  };
}

const aksi = () => cariAksi('koreksi_hpp_banyak');
const daftarBenar = () => ({ kh_dari: '2026-09-21', kh_daftar: [
  { bahan: 'Gula', harga: '18,966667' },
  { bahan: 'Teh Jasmine', harga: '1500' },
  { bahan: 'Larutan Gula', harga: '11,3' }
] });

test('terdaftar sebagai alat bertahap lingkup gerai', () => {
  assert.ok(aksi());
  assert.equal(aksi().bertahap, true);
  assert.equal(bolehDiLingkup(aksi(), 'gerai'), true);
  assert.equal(bolehDiLingkup(aksi(), 'entity'), false);
});

test('draft: satu bacaan daftar bahan saja (tanpa pratinjau per bahan), urutan persis, harga dan tanggal', async () => {
  const terkirim = [];
  const hasil = await aksi().siapkan(daftarBenar(), ctxPalsu(terkirim));
  assert.equal(hasil.ok, true);
  assert.deepEqual(terkirim.map((t) => `${t.method} ${t.path}`), ['GET /api/admin/hpp-recalculation/components'],
    'draft tidak boleh memicu pratinjau/hitung per bahan dalam satu permintaan');
  const { draft } = hasil;
  assert.equal(draft.bertahap, true);
  assert.deepEqual(draft.muatan.daftar.map((b) => b.name), ['Gula', 'Teh Jasmine', 'Larutan Gula']);
  assert.deepEqual(draft.muatan.daftar.map((b) => b.unitCost), ['18.966667', '1500', '11.3'], 'koma desimal diubah ke titik, tidak pernah float');
  assert.deepEqual(draft.baris[1], ['Mulai tanggal', '2026-09-21']);
  assert.deepEqual(draft.tabel.isi[1], ['Teh Jasmine', 'Rp0/pcs', 'Rp1.500/pcs', '2026-09-21']);
  assert.ok(draft.dampak.some((d) => /bahan baku harus di depan olahan/i.test(d)));
  assert.ok(draft.dampak.some((d) => /sudah benar dilewati/i.test(d)));
});

test('daftar panjang (40 bahan) tetap satu draft dengan satu bacaan', async () => {
  const banyak = Array.from({ length: 40 }, (_, i) => ({ productId: 100 + i, name: `Bahan ${String(i).padStart(2, '0')}`, unitSymbol: 'pcs', averageCostRupiah: 0 }));
  const terkirim = [];
  const ctx = { ...ctxPalsu(terkirim), baca: async (path) => { terkirim.push({ method: 'GET', path }); return { ok: true, data: { components: banyak } }; } };
  const hasil = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: banyak.map((b) => ({ bahan: b.name, harga: '850' })) }, ctx);
  assert.equal(hasil.ok, true);
  assert.equal(hasil.draft.muatan.daftar.length, 40);
  assert.equal(terkirim.length, 1);
});

test('tanggal mulai wajib: tanpa tanggal Una bertanya, tidak menebak', async () => {
  const t = daftarBenar();
  delete t.kh_dari;
  const hasil = await aksi().siapkan(t, ctxPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /tanggal berapa/i);
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

test('satu nama atau harga salah: berhenti sebelum draft, menyebut bahannya', async () => {
  const hasil = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Gula', harga: '18' }, { bahan: 'Bahan Hantu', harga: '10' }] }, ctxPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Bahan Hantu/);

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

test('bahan yang ternyata sudah benar dilewati (bukan gagal), supaya sisa daftar tetap jalan', async () => {
  const ctx = ctxPalsu();
  const { draft } = await aksi().siapkan({ kh_dari: '2026-09-21', kh_daftar: [{ bahan: 'Sedotan', harga: '52,1' }, { bahan: 'Gula', harga: '18' }] }, ctx);
  assert.deepEqual(await aksi().postingBagian(draft, 0, ctx), { ok: true, hasil: 'sudah_sesuai', nama: 'Sedotan', id: 15 });
  assert.equal((await aksi().postingBagian(draft, 1, ctx)).hasil, 'dikoreksi');
});

test('kegagalan lain di tengah dikembalikan apa adanya supaya bisa dilanjutkan dari bahan itu', async () => {
  const ctx = ctxPalsu();
  const { draft } = await aksi().siapkan(daftarBenar(), ctx);
  ctx.kirim = async () => ({ ok: false, status: 400, error: 'Terlalu banyak penjualan.' });
  const hasil = await aksi().postingBagian(draft, 0, ctx);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.error, 'Terlalu banyak penjualan.');
  ctx.kirim = async () => ({ ok: false, status: 409, error: 'Tanggal bisnis ditutup.' });
  assert.equal((await aksi().postingBagian(draft, 0, ctx)).ok, false, '409 lain tidak boleh dianggap "sudah benar"');
});

test('konfirmasi memakai draft BEKU: tanpa membaca ulang, dan draft hasilnya identik dengan yang dilihat', async () => {
  const disiapkan = await aksi().siapkan(daftarBenar(), ctxPalsu());
  const draft = { ...disiapkan.draft, tangkapan: daftarBenar() };
  const terkirim = [];
  const ctxLagi = { ...ctxPalsu(terkirim), baca: async () => ({ ok: false, error: 'tidak boleh dibaca ulang' }) };
  const lagi = await periksaUlangDraft(draft, ctxLagi);
  assert.equal(lagi.ok, true);
  assert.equal(terkirim.length, 0);
  assert.equal(lagi.draft.muatan.daftar.length, 3);
});

test('draft beku yang bentuknya rusak atau berisi angka aneh ditolak', async () => {
  const rusak = await aksi().siapkan({}, { ...ctxPalsu(), draftAsli: { muatan: { daftar: [{ componentProductId: 'x', name: 1 }] } } });
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
  assert.equal((await jalur.kirim('POST', '/api/admin/hpp-recalculation', { componentProductId: 1, unitCost: '1', from: '2026-09-01', reason: 'uji koreksi' })).ok, true);
});

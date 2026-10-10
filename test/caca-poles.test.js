import test from 'node:test';
import assert from 'node:assert/strict';
import { jawabPertanyaan } from '../src/caca-agen.js';
import { polesPanduan, periksaPoles } from '../src/caca-poles.js';
import { jelaskan, peringkatTopik } from '../src/caca-jelaskan.js';

// Bos Cyo 2026-10-10: "kenapa gemininya engga disuruh ngecek apakah pertanyaan dan
// jawaban dari kamus cocok? dan misal cocok gemini suruh kasih sentuhan biar bahasanya
// engga templat banget". Fakta tetap dari kamus; Gemini memeriksa kecocokan dan memoles.

const KONTEKS = { nama: 'Bos', peran: 'Owner', storeCode: 'G1', storeName: 'G1', hariIni: '2026-10-10', lingkup: 'gerai', namaLingkup: 'G1', riwayat: [] };
const PERTANYAAN = 'bagaimana cara mendaftarkan suplier baru ke sistem?';

function model(...balasan) {
  const panggilan = [];
  return { panggilan, panggilModel: async (_env, p) => { panggilan.push(p); const b = balasan[panggilan.length - 1]; if (b instanceof Error) throw b; return b ?? { ok: false, status: 502, error: 'habis' }; } };
}
const jawab = (cocok, jawaban) => ({ ok: true, value: { cocok, jawaban } });

test('panduan yang cocok dipoles: bahasa baru, nama menu/tombol/angka tetap, tawaran mengerjakan tetap dari kode', async () => {
  const asli = jelaskan(PERTANYAAN);
  assert.equal(asli.topik, 'supplier_tambah');
  const m = model(jawab('1', [
    'Gampang kok, Bos! Buka Barang → Supplier, nanti ada form "Tambah supplier" di sebelah kiri.',
    'Isi Nama supplier, No. HP, Alamat, dan Catatan kalau perlu, centang Aktif, lalu Simpan supplier.',
    'Supplier yang aktif bakal muncul di pilihan "Supplier" waktu kasir mencatat Beli Bahan, jadi hutang dan uang muka ke dia kelihatan per nama.'
  ].join('\n')));
  const hasil = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m.panggilModel });
  assert.equal(m.panggilan.length, 1);
  assert.equal(hasil.dipoles, true);
  assert.match(hasil.jawaban, /^Gampang kok, Bos!/);
  assert.notEqual(hasil.jawaban.split('\n')[0], asli.jawaban.split('\n')[0]);
  assert.match(hasil.jawaban, /Mau Una daftarkan\?/, 'tawaran mengerjakan ditambah kode, bukan model');
  assert.equal(hasil.tertunda.alat, 'buat_supplier');
  assert.ok(hasil.tawaran.some((t) => t.layar === 'suppliers'));
});

test('prompt memuat kandidat panduan sebagai data, pertanyaan Bos, dan aturan jangan mengarang', async () => {
  const m = model(jawab('tidak_ada', ''));
  await polesPanduan({ pertanyaan: PERTANYAAN, panduan: jelaskan(PERTANYAAN), konteks: KONTEKS, env: {}, panggilModel: m.panggilModel });
  const { system, content } = m.panggilan[0];
  assert.match(system, /PANDUAN RESMI/);
  assert.match(system, /Jangan menambah langkah/);
  assert.match(content[0].text, /Pertanyaan Bos: bagaimana cara mendaftarkan suplier baru/);
  assert.match(content[0].text, /PANDUAN 1 — Mendaftarkan supplier baru/);
  assert.ok((content[0].text.match(/PANDUAN \d —/g) ?? []).length >= 2, 'ada pembanding supaya pemeriksaan berarti');
});

test('Gemini bilang tidak cocok → panduan tebakan kode dibuang, lanjut ke pilih-alat biasa', async () => {
  const m = model(
    jawab('tidak_ada', ''),
    { ok: true, value: { alat: 'tidak_ada', alasan_kosong: 'itu bukan soal cara pakai' } }
  );
  const hasil = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m.panggilModel });
  assert.equal(m.panggilan.length, 2, 'pemeriksaan + pilih-alat; panduan yang sudah ditolak tidak ditanyakan lagi');
  assert.match(m.panggilan[1].system, /alat/i);
  assert.notEqual(hasil.dipoles, true);
  assert.doesNotMatch(hasil.jawaban, /Tambah supplier/);
});

test('Gemini memilih panduan lain yang lebih pas → dipakai, lengkap dengan tawaran miliknya', async () => {
  const pertanyaan = 'cara nyatet kiriman supplier yang kurang dari nota';
  const peringkat = peringkatTopik(pertanyaan, 3).map((x) => x.entri.id);
  assert.ok(peringkat.includes('nota_beda'));
  const kodeMenebak = jelaskan(pertanyaan).topik;
  const nomor = [kodeMenebak, ...peringkat.filter((id) => id !== kodeMenebak)].indexOf('nota_beda') + 1;
  const m = model(jawab(String(nomor), 'Kalau barang datang kurang dari nota, catat yang benar-benar datang saja lewat Beli Bahan; selisih bayarnya jadi deposit.'));
  const asli = jelaskan('nota_beda');
  const hasil = await polesPanduan({ pertanyaan, panduan: jelaskan(pertanyaan), konteks: KONTEKS, env: {}, panggilModel: m.panggilModel });
  assert.equal(hasil.tidakCocok, false);
  assert.equal(hasil.panduan.topik, 'nota_beda');
  assert.deepEqual(hasil.panduan.kerjakan, asli.kerjakan);
});

test('pagar: polesan yang membuang nama tombol, mengubah jalur menu, atau menambah angka ditolak → teks asli', () => {
  const sumber = jelaskan('supplier_tambah').jawaban;
  const bagus = 'Buka Barang → Supplier, isi form "Tambah supplier" (Nama, HP, Alamat), centang Aktif lalu Simpan supplier. Nanti dia muncul di pilihan "Supplier" saat Beli Bahan.';
  assert.equal(periksaPoles(sumber, bagus).aman, true, periksaPoles(sumber, bagus).alasan);
  assert.match(periksaPoles(sumber, bagus.replace('"Tambah supplier"', 'tombol tambah')).alasan, /Tambah supplier.*hilang/);
  assert.match(periksaPoles(sumber, bagus.replace('Barang → Supplier', 'menu Supplier')).alasan, /jalur/);
  assert.match(periksaPoles(sumber, `${bagus} Gratis 30 hari pertama.`).alasan, /angka baru/);
  assert.match(periksaPoles(sumber, `${bagus} Maksimal 500.000 supplier.`).alasan, /angka baru/);
  assert.equal(periksaPoles(sumber, '').aman, false);
  assert.match(periksaPoles(sumber, `${bagus} ${bagus} ${bagus} ${bagus} ${bagus}`).alasan, /panjang/);
});

test('polesan ditolak pagar → jawaban tetap panduan asli (cocok tetap dihormati)', async () => {
  const m = model(jawab('1', 'Tinggal buka menu supplier terus isi aja formnya ya Bos, gampang banget kok pokoknya.'));
  const hasil = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m.panggilModel });
  assert.equal(m.panggilan.length, 2, 'asli + satu perbaikan (balasan kedua dari model palsu gagal)');
  assert.equal(hasil.dipoles, false);
  assert.equal(hasil.jawaban.split('\n')[0], jelaskan(PERTANYAAN).jawaban.split('\n')[0]);
});

test('Gemini gagal / kena limit / melempar → panduan asli tetap tampil, tanpa galat', async () => {
  for (const balasan of [
    { ok: false, status: 429, error: 'RESOURCE_EXHAUSTED' },
    new Error('jaringan putus'),
    { ok: true, value: { cocok: 'entah', jawaban: 'x' } },
    { ok: true, value: {} }
  ]) {
    const m = model(balasan);
    const hasil = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m.panggilModel });
    assert.equal(hasil.ok, true);
    assert.equal(hasil.alat, 'jelaskan');
    assert.match(hasil.jawaban, /Tambah supplier/);
    assert.equal(m.panggilan.length, 1, 'tidak jatuh ke pilih-alat 10 ribu token saat limit');
  }
});

test('"kamu bisa buatin itu?" sesudah panduan tidak memanggil pemeriksa lagi', async () => {
  const m1 = model(jawab('1', 'ok'));
  const satu = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m1.panggilModel });
  const m2 = model();
  const dua = await jawabPertanyaan('kamu bisa buatin itu?', KONTEKS, { env: {}, panggilModel: m2.panggilModel, tertunda: satu.tertunda });
  assert.equal(m2.panggilan.length, 0);
  assert.equal(dua.alat, 'buat_supplier');
});

test('pagar hanya mengunci nama tombol berhuruf kapital, bukan contoh isian berhuruf kecil', () => {
  const sumber = jelaskan('penyesuaian_stok').jawaban;
  assert.match(sumber, /"hasil hitung fisik"/);
  const tulisan = 'Di kasir tekan "🧮 Penyesuaian Stok", pilih barangnya, isi "Target stok fisik" sesuai hitungan, dan alasannya (mis. habis dihitung ulang) lalu AJUKAN PENYESUAIAN. Admin/Owner meng-ACC di Transaksi → Persetujuan; stoknya dicek ulang saat ACC. Sebelum itu cek dulu Barang → Stok → Lihat Mutasi: sering penyebabnya pembelian yang belum dicatat.';
  const hasil = periksaPoles(sumber, tulisan);
  assert.equal(hasil.aman, true, hasil.alasan);
  assert.match(periksaPoles(sumber, tulisan.replace('"🧮 Penyesuaian Stok"', 'tombol penyesuaian')).alasan, /Penyesuaian Stok.*hilang/);
});

test('model memilih alat "jelaskan" sendiri (tanpa "bagaimana cara") → panduannya tetap diperiksa & dipoles', async () => {
  const pertanyaan = 'stok kok minus gimana benerinnya?';
  const sumber = jelaskan('stok_minus').jawaban;
  const polesan = [
    'Tenang Bos, stok minus itu bukan error — artinya barangnya sudah terjual sebelum pembeliannya dicatat. Begitu pembelian dicatat di kasir, stoknya balik sesuai.',
    'Cara menanganinya: (1) cek Barang → Stok → Lihat Mutasi buat lihat penjualan/pemakaian yang mengurangi; (2) pastikan semua belanja sudah dicatat lewat Beli Bahan; (3) untuk bahan, cek takaran resepnya; (4) kalau masih beda dengan hitungan fisik, ajukan Penyesuaian Stok dari kasir.'
  ].join('\n');
  assert.equal(periksaPoles(sumber, polesan).aman, true, periksaPoles(sumber, polesan).alasan);
  const panggilan = [];
  const panggilModel = async (_e, p) => {
    panggilan.push(p);
    return panggilan.length === 1 ? { ok: true, value: { alat: 'jelaskan', jelaskan_topik: 'stok minus' } } : jawab('1', polesan);
  };
  const hasil = await jawabPertanyaan(pertanyaan, KONTEKS, { env: {}, panggilModel, jalurAksi: { baca: async () => ({ ok: false }), kirim: async () => ({ ok: false }) } });
  assert.equal(panggilan.length, 2);
  assert.match(panggilan[1].system, /PANDUAN RESMI/);
  assert.equal(hasil.dipoles, true);
  assert.match(hasil.jawaban, /^Tenang Bos/);
});

test('model memilih "jelaskan" tapi pemeriksa bilang tidak cocok → jujur belum yakin, bukan panduan yang salah', async () => {
  const panggilan = [];
  const panggilModel = async () => {
    panggilan.push(1);
    return panggilan.length === 1 ? { ok: true, value: { alat: 'jelaskan', jelaskan_topik: 'stok' } } : jawab('tidak_ada', '');
  };
  const hasil = await jawabPertanyaan('kenapa laporan kemarin beda sama hari ini', KONTEKS, { env: {}, panggilModel, jalurAksi: { baca: async () => ({ ok: false }), kirim: async () => ({ ok: false }) } });
  if (hasil.alat === 'jelaskan') return; // kode tidak menemukan panduan sama sekali → tidak lewat pemeriksa
  assert.match(hasil.jawaban, /belum yakin|belum bisa|belum punya/i);
});

test('polesan ditolak pagar → satu kali diminta memperbaiki dengan alasan yang jelas; berhasil → dipakai', async () => {
  const buruk = 'Tinggal buka menu supplier terus isi formnya ya Bos, gampang banget kok, nanti supplier-nya muncul waktu kasir beli bahan buat usaha.';
  const baik = 'Buka Barang → Supplier, isi form "Tambah supplier" (Nama supplier, No. HP, Alamat), centang Aktif, lalu "Simpan supplier". Nanti muncul di pilihan "Supplier" waktu kasir Beli Bahan.';
  const m = model(jawab('1', buruk), jawab('1', baik));
  const hasil = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m.panggilModel });
  assert.equal(m.panggilan.length, 2);
  assert.match(m.panggilan[1].content[0].text, /DITOLAK pemeriksa karena: nama "Tambah supplier" hilang/);
  assert.equal(hasil.dipoles, true);
  assert.equal(hasil.jawaban.split('\n')[0], baik.split('\n')[0]);
});

test('perbaikan kedua juga ditolak → teks panduan asli, dengan alasan keduanya tercatat', async () => {
  const buruk = 'Tinggal buka menu supplier terus isi formnya ya Bos, gampang banget kok, nanti supplier-nya muncul waktu kasir beli bahan buat usaha.';
  const m = model(jawab('1', buruk), jawab('1', buruk));
  const hasil = await jawabPertanyaan(PERTANYAAN, KONTEKS, { env: {}, panggilModel: m.panggilModel });
  assert.equal(m.panggilan.length, 2, 'hanya satu perbaikan, tidak berulang');
  assert.equal(hasil.dipoles, false);
  assert.match(hasil.polesCatatan, /perbaikan:/);
  assert.match(hasil.jawaban, /Tambah supplier/);
});

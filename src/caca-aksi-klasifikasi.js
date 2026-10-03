// Alat Una: membetulkan klasifikasi barang (Tipe Barang, Jenis Barang, satuan dasar)
// untuk satu atau banyak barang -- Bos Cyo 2026-10-03: celah yang tadinya hanya bisa
// dibereskan manual di Master Barang (mis. MANDALA: 23 bahan bertipe Barang Jadi,
// Gula bersatuan pcs padahal gram).
//
// Sama dengan layar Master Barang: PATCH /api/admin/master/products/editor/:id,
// hanya isian yang berubah dikirim. Bertahap (satu barang per permintaan) seperti
// ubah_barang, supaya puluhan barang tidak menembus batas kerja per permintaan.
//
// Aturan yang dijaga:
//   - Ganti satuan = ganti LABEL saja (keputusan Bos Cyo 2026-09-28): angka stok,
//     HPP, dan takaran resep tidak dikonversi. Draft menyebutnya terang-terangan,
//     dan konfirmasi hanya dikirim untuk baris yang tampil di draft itu.
//   - Jenis Barang (penentu akun pembukuan) TIDAK ikut berubah kecuali disebut.
//   - Tidak pernah menebak: barang/tipe/jenis/satuan yang tidak cocok persis
//     dikembalikan sebagai pertanyaan.

import { normalkan, cocokkanSatu, teks, BELUM_KETEMU } from './caca-aksi-dasar.js';

export const BATAS_KLASIFIKASI = 60;
const ANGKA_ID = /^\d{1,9}$/;

// Kata sehari-hari -> kode Tipe Barang (urutan penting: "setengah jadi" memuat "jadi").
const ALIAS_TIPE = Object.freeze([
  [/setengah|olahan|semi|larutan|adonan/, 'SEMI_FINISHED'],
  [/bahan|raw|mentah/, 'RAW_MATERIAL'],
  [/jadi|jualan|finished|produk/, 'FINISHED_GOOD']
]);

function cariTipe(tertulis, daftarTipe) {
  const aktif = daftarTipe.filter((t) => t.isActive !== false);
  const kunci = normalkan(tertulis);
  const exact = aktif.filter((t) => normalkan(t.code) === kunci || normalkan(t.name) === kunci);
  if (exact.length === 1) return { ok: true, nilai: exact[0] };
  const alias = ALIAS_TIPE.find(([pola]) => pola.test(kunci));
  if (alias) {
    const kena = aktif.find((t) => t.code === alias[1]);
    if (kena) return { ok: true, nilai: kena };
  }
  return cocokkanSatu(tertulis, aktif, { label: 'tipe barang', namaDari: (t) => t.name, kunciLain: (t) => [t.code] });
}

const cariJenis = (tertulis, daftar) => cocokkanSatu(tertulis, daftar.filter((k) => k.isActive !== false), { label: 'jenis barang', namaDari: (k) => k.name, kunciLain: (k) => [k.code] });
const cariSatuan = (tertulis, daftar) => cocokkanSatu(tertulis, daftar.filter((u) => u.isActive !== false), { label: 'satuan', namaDari: (u) => u.name, kunciLain: (u) => [u.symbol, u.code] });

function bentukValid(daftar) {
  if (!Array.isArray(daftar) || !daftar.length || daftar.length > BATAS_KLASIFIKASI) return false;
  return daftar.every((b) => ANGKA_ID.test(String(b?.id)) && typeof b.name === 'string'
    && b.perubahan && typeof b.perubahan === 'object' && Object.keys(b.perubahan).length > 0
    && Object.entries(b.perubahan).every(([kunci, nilai]) => ['itemTypeId', 'productKindId', 'baseUnitId'].includes(kunci) && typeof nilai === 'string' && nilai.length > 0 && nilai.length <= 180)
    && b.sebelum && typeof b.sebelum === 'object' && b.sesudah && typeof b.sesudah === 'object' && typeof b.ubahSatuan === 'boolean');
}

function susunDraft(daftar, catatan, sudahSesuai) {
  const isi = [];
  for (const b of daftar) {
    if ('itemTypeId' in b.perubahan) isi.push([b.name, 'Tipe barang', b.sebelum.tipe, b.sesudah.tipe]);
    if ('productKindId' in b.perubahan) isi.push([b.name, 'Jenis barang', b.sebelum.jenis, b.sesudah.jenis]);
    if ('baseUnitId' in b.perubahan) isi.push([b.name, 'Satuan', b.sebelum.satuan, b.sesudah.satuan]);
  }
  const ada = (kunci) => daftar.some((b) => kunci in b.perubahan);
  const jenisBentrok = daftar.filter((b) => b.sesudah.jenisKode === 'FINISHED_GOOD' && b.sesudah.tipeKode && b.sesudah.tipeKode !== 'FINISHED_GOOD').map((b) => b.name);
  return {
    aksi: 'betulkan_klasifikasi_barang',
    bertahap: true,
    judul: `Una mau membetulkan klasifikasi ${daftar.length} barang — dicek dulu ya:`,
    baris: [['Jumlah', `${daftar.length} barang`]],
    tabel: { kolom: ['Barang', 'Yang diubah', 'Sebelum', 'Sesudah'], isi },
    dampak: [
      ...catatan,
      ...(ada('itemTypeId') ? ['Tipe memengaruhi perilaku barang di sistem (bisa dijual, dibeli, diproduksi, atau dipakai sebagai bahan). Jenis Barang (penentu akun pembukuan) tidak ikut berubah kecuali disebut.'] : []),
      ...(ada('baseUnitId') ? ['Ganti satuan hanya mengganti LABEL: angka stok, HPP, dan takaran resep TIDAK dikonversi. Pastikan angkanya memang sudah dalam satuan yang benar.'] : []),
      ...(ada('productKindId') ? ['Jenis Barang menentukan akun Persediaan/HPP/Penjualan di pembukuan untuk transaksi berikutnya; jurnal lama tidak berubah.'] : []),
      ...(jenisBentrok.length ? [`Perhatian: ${jenisBentrok.slice(0, 5).join(', ')} akan bertipe bukan Barang Jadi tetapi Jenis Barangnya Barang Jadi. Sebut jenis barangnya juga kalau itu keliru.`] : []),
      ...(sudahSesuai.length ? [`Sudah sesuai, tidak diubah: ${sudahSesuai.slice(0, 10).join(', ')}${sudahSesuai.length > 10 ? ', …' : ''}.`] : [])
    ],
    muatan: { daftar, catatan, sudahSesuai }
  };
}

const betulkanKlasifikasi = Object.freeze({
  nama: 'betulkan_klasifikasi_barang',
  lingkup: 'gerai',
  bertahap: true,
  petunjuk: 'MEMBETULKAN klasifikasi barang yang salah: Tipe Barang (bahan baku / setengah jadi / barang jadi), Jenis Barang, dan/atau satuan dasar — satu atau banyak barang di gerai yang sedang dibuka, mis. "semua bubuk rasa di Mandala itu bahan baku, bukan barang jadi", "Gula Mandala satuannya gram bukan pcs", "pasang jenis barang Bahan Baku ke Air Mineral". Ganti satuan hanya mengganti label (stok/HPP/resep tidak dikonversi). Daftar barang yang tipenya mencurigakan ada di hasil audit_hpp (typeIssues). Bukan untuk harga atau nama (itu ubah_barang).',
  skema: {
    kb_daftar: {
      type: 'array',
      description: 'betulkan_klasifikasi_barang: satu objek per barang, hanya isian yang mau diganti.',
      items: {
        type: 'object',
        required: ['barang'],
        properties: {
          barang: { type: 'string', description: 'Nama barang PERSIS seperti disebut (tanpa nama gerai).' },
          tipe: { type: 'string', description: 'Tipe BARU: "bahan baku", "setengah jadi", atau "barang jadi", hanya kalau disebut.' },
          jenis: { type: 'string', description: 'Jenis Barang BARU (nama atau kode), hanya kalau disebut.' },
          satuan: { type: 'string', description: 'Satuan dasar BARU (g, ml, pcs, …), hanya kalau disebut.' }
        }
      }
    }
  },

  async siapkan(t, ctx) {
    // Konfirmasi (potongan mana pun): isi dibekukan di draft yang dilihat.
    const beku = ctx.draftAsli?.muatan;
    if (beku && Array.isArray(beku.daftar)) {
      if (!bentukValid(beku.daftar) || !Array.isArray(beku.catatan) || !Array.isArray(beku.sudahSesuai)) {
        return { ok: false, tanya: 'Daftar perubahannya kayaknya berubah. Minta Una menyusun ulang ya.' };
      }
      return { ok: true, draft: susunDraft(beku.daftar, beku.catatan.map(String).slice(0, 20), beku.sudahSesuai.map(String).slice(0, 60)) };
    }

    const mentah = (Array.isArray(t?.kb_daftar) ? t.kb_daftar : []).filter((b) => teks(b?.barang, 100));
    if (!mentah.length) return { ok: false, tanya: 'Barang yang mana yang klasifikasinya mau dibetulkan, dan jadi apa?' };
    if (mentah.length > BATAS_KLASIFIKASI) return { ok: false, tanya: `Kebanyakan untuk sekali jalan (maks ${BATAS_KLASIFIKASI}). Bagi dua ya.` };
    if (mentah.some((b) => !teks(b.tipe, 60) && !teks(b.jenis, 60) && !teks(b.satuan, 30))) {
      const kosong = mentah.find((b) => !teks(b.tipe, 60) && !teks(b.jenis, 60) && !teks(b.satuan, 30));
      return { ok: false, tanya: `"${teks(kosong.barang, 100)}" mau diganti apanya? Tipe, jenis barang, atau satuan?` };
    }

    const ref = await ctx.baca('/api/admin/master/products/editor?ringkas=1');
    if (!ref.ok) return ref;
    const produk = (ref.data.products ?? []).filter((p) => p.isActive !== false);
    const tipe = ref.data.itemTypes ?? [];
    const jenis = ref.data.productKinds ?? [];
    const satuan = ref.data.units ?? [];
    const tipePerId = new Map(tipe.map((x) => [x.id, x]));
    const jenisPerId = new Map(jenis.map((x) => [x.id, x]));
    const satuanPerId = new Map(satuan.map((x) => [x.id, x]));

    const daftar = [];
    const sudahSesuai = [];
    const dipakai = new Set();
    for (const baris of mentah) {
      const tertulis = teks(baris.barang, 100);
      const cocok = cocokkanSatu(tertulis, produk, { label: 'barang', namaDari: (p) => p.name });
      if (!cocok.ok) {
        return BELUM_KETEMU.test(cocok.tanya) ? { ok: false, tanya: `${cocok.tanya} (di ${ctx.namaLingkup || 'gerai ini'}; barang nonaktif tidak ikut dicari.)` } : cocok;
      }
      const p = cocok.nilai;
      if (dipakai.has(p.id)) return { ok: false, tanya: `"${p.name}" disebut dua kali. Yang mana perubahannya?` };
      dipakai.add(p.id);

      const perubahan = {};
      const sebelum = {};
      const sesudah = {};
      const tipeSekarang = tipePerId.get(p.itemTypeId);
      const jenisSekarang = jenisPerId.get(p.productKindId);
      const satuanSekarang = satuanPerId.get(p.baseUnitId);
      sesudah.tipeKode = tipeSekarang?.code ?? '';
      sesudah.jenisKode = jenisSekarang?.code ?? p.productKindCode ?? '';

      if (teks(baris.tipe, 60)) {
        const ketemu = cariTipe(teks(baris.tipe, 60), tipe);
        if (!ketemu.ok) return { ok: false, tanya: `${p.name}: ${ketemu.tanya}` };
        sesudah.tipeKode = ketemu.nilai.code;
        if (ketemu.nilai.id !== p.itemTypeId) {
          perubahan.itemTypeId = ketemu.nilai.id;
          sebelum.tipe = tipeSekarang?.name || p.itemTypeName || '—';
          sesudah.tipe = ketemu.nilai.name;
        }
      }
      if (teks(baris.jenis, 60)) {
        const ketemu = cariJenis(teks(baris.jenis, 60), jenis);
        if (!ketemu.ok) return { ok: false, tanya: `${p.name}: ${ketemu.tanya}` };
        sesudah.jenisKode = ketemu.nilai.code;
        if (ketemu.nilai.id !== p.productKindId) {
          perubahan.productKindId = ketemu.nilai.id;
          sebelum.jenis = jenisSekarang ? `${jenisSekarang.name}` : (p.productKindName || 'Belum ditentukan');
          sesudah.jenis = ketemu.nilai.name;
        }
      }
      let ubahSatuan = false;
      if (teks(baris.satuan, 30)) {
        const ketemu = cariSatuan(teks(baris.satuan, 30), satuan);
        if (!ketemu.ok) return { ok: false, tanya: `${p.name}: ${ketemu.tanya}` };
        if (ketemu.nilai.id !== p.baseUnitId) {
          perubahan.baseUnitId = ketemu.nilai.id;
          sebelum.satuan = satuanSekarang?.symbol || p.unitSymbol || '—';
          sesudah.satuan = ketemu.nilai.symbol;
          ubahSatuan = true;
        }
      }
      if (!Object.keys(perubahan).length) { sudahSesuai.push(p.name); continue; }
      // Untuk tampilan: kolom yang tidak berubah tidak dipakai, tapi bentuknya tetap lengkap.
      sebelum.tipe ??= ''; sebelum.jenis ??= ''; sebelum.satuan ??= '';
      sesudah.tipe ??= ''; sesudah.jenis ??= ''; sesudah.satuan ??= '';
      daftar.push({ id: Number(p.id), name: p.name, perubahan, sebelum, sesudah, ubahSatuan });
    }
    if (!daftar.length) return { ok: false, tanya: `Barang itu sudah seperti yang diminta (${sudahSesuai.slice(0, 8).join(', ')}), tidak ada yang perlu dibetulkan.` };
    return { ok: true, draft: susunDraft(daftar, [], sudahSesuai) };
  },

  async postingBagian(draft, bagian, ctx) {
    const baris = draft.muatan.daftar[bagian];
    // PATCH parsial seperti layar Master Barang. Konfirmasi ganti satuan dikirim
    // HANYA untuk baris yang di draft memang menampilkan perubahan satuan.
    const badan = { ...baris.perubahan, ...(baris.ubahSatuan ? { confirmUnitChange: true } : {}) };
    const hasil = await ctx.kirim('PATCH', `/api/admin/master/products/editor/${Number(baris.id)}?ringkas=1`, badan);
    if (!hasil.ok) return hasil;
    return { ok: true, hasil: 'diubah', nama: baris.name, id: baris.id };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

export const AKSI_KLASIFIKASI = Object.freeze([betulkanKlasifikasi]);

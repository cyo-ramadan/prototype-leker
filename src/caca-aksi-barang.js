// Isi daftar barang sekaligus + batalkan barang (Bos Cyo 2026-10-02:
// "misal user takut ngisi2 jenis barang yang panjang, maka solusinya adalah
// una ... oh sesimple ini ya"). Riset & alasannya: UNA-PENDAMPING.md.
//
// Pemilik baru cukup menempel daftar seperti di chat WhatsApp ("Es Teh 5rb,
// Kopi Susu 12rb, ...") atau memotret papan menu. Satu tabel draft, satu "Ya".
//
// Tiga aturan yang membuatnya terasa sederhana tanpa mengorbankan ketelitian:
//   - DEFAULT DULU, TERANG-TERANGAN. Kategori, satuan, dan harga beli punya
//     nilai bawaan, tapi selalu tertulis di tabel draft — tidak ada yang diisi
//     diam-diam (harga beli 0 disebut di dampaknya beserta akibatnya).
//   - KERJAKAN YANG BISA. Satu baris yang harganya tidak terbaca tidak
//     menggagalkan 39 baris lainnya; baris itu disebut terang dan dilewati.
//   - BERTAHAP. Draft diposting satu barang per permintaan dari panel, bukan
//     semuanya dalam satu permintaan: satu barang memakai belasan kueri dan
//     paket Cloudflare gratis membatasi CPU (10 ms) dan panggilan layanan per
//     permintaan. Bonusnya: pemilik melihat hitungan "12 dari 40" berjalan.
//
// Draft bertahap diperiksa ulang di SETIAP potongan. Supaya barang yang sudah
// dibuat potongan sebelumnya tidak membuat draft "berubah", pembagian "sudah
// ada di gerai" diambil dari draft itu sendiri saat konfirmasi; keberadaan
// barang tetap dicek langsung tepat sebelum tiap barang dibuat.

import { rupiah } from './caca-nominal.js';
import { normalkan, cocokkanSatu, rupiahDari, teks } from './caca-aksi-dasar.js';

export const MAKS_BARIS_BARANG = 60;

const JENIS = Object.freeze({
  jualan: { tipe: 'FINISHED_GOOD', kategoriBawaan: 'Menu', label: 'barang jualan', keterangan: 'Barang jualan (muncul di kasir)' },
  bahan: { tipe: 'RAW_MATERIAL', kategoriBawaan: 'Bahan', label: 'bahan', keterangan: 'Bahan (untuk resep dan pembelian)' }
});

// Papan menu dan chat sering menulis harga singkat: "Es Teh 5, Kopi 12"
// artinya 5.000 dan 12.000. Itu hanya ditafsirkan begitu kalau SEMUA harga
// jual di daftar ditulis 1–3 digit tanpa satuan — dan tafsirannya ditulis di
// dampak draft, jadi pemilik yang melihat 5.000 padahal maksudnya 5 bisa Batal.
const SINGKAT = /^\s*(rp\.?)?\s*\d{1,3}\s*$/i;

function hargaSingkatJadiRibuan(baris) {
  const berharga = baris.filter((b) => teks(b?.harga_jual, 40));
  return berharga.length >= 2 && berharga.every((b) => SINGKAT.test(String(b.harga_jual)));
}

function dariRibuan(tertulis, berlaku) {
  const mentah = teks(tertulis, 40);
  if (!berlaku || !SINGKAT.test(mentah)) return mentah;
  return `${mentah.replace(/rp\.?/i, '').trim()}rb`;
}

function satuanAktif(ref) {
  return (ref.units ?? []).filter((u) => u.isActive !== false);
}

/**
 * Menyusun barang dari tangkapan. Murni terhadap data master (satuan, tipe):
 * keberadaan barang di gerai dinilai di luar fungsi ini.
 */
function uraikanDaftar(t, ref) {
  const jenis = JENIS[t?.daftar_jenis === 'bahan' ? 'bahan' : 'jualan'];
  const mentah = (Array.isArray(t?.daftar_barang) ? t.daftar_barang : []).filter((b) => teks(b?.nama, 100));
  const kelebihan = Math.max(0, mentah.length - MAKS_BARIS_BARANG);
  const daftar = mentah.slice(0, MAKS_BARIS_BARANG);

  const tipe = (ref.itemTypes ?? []).find((x) => x.code === jenis.tipe);
  if (!tipe) return { ok: false, tanya: 'Tipe barang di gerai ini belum siap. Coba buka layar Data Barang sekali, lalu ulangi.' };
  const satuanList = satuanAktif(ref);
  const pcs = satuanList.find((u) => u.code === 'PCS');

  const ribuan = jenis === JENIS.jualan && hargaSingkatJadiRibuan(daftar);
  const kategoriSemua = teks(t?.daftar_kategori, 60);
  const baris = [];
  const dilewati = [];
  const kembarDiDaftar = [];
  let pakaiKategoriBawaan = false;
  let tanpaHargaBeli = 0;

  for (const b of daftar) {
    const nama = teks(b.nama, 100);
    if (baris.some((x) => normalkan(x.name) === normalkan(nama)) || dilewati.some((x) => normalkan(x.nama) === normalkan(nama))) {
      kembarDiDaftar.push(nama);
      continue;
    }

    let price = 0;
    if (jenis === JENIS.jualan) {
      const tertulis = dariRibuan(b.harga_jual, ribuan);
      if (!tertulis) { dilewati.push({ nama, alasan: 'harga jualnya belum ada' }); continue; }
      const jual = rupiahDari(tertulis, 'Harga jual', { bolehNol: true });
      if (!jual.ok) { dilewati.push({ nama, alasan: `harga jual "${teks(b.harga_jual, 40)}" belum kebaca` }); continue; }
      price = jual.nilai;
    }

    let purchasePrice = 0;
    const beliTertulis = dariRibuan(b.harga_beli, ribuan);
    if (beliTertulis) {
      const beli = rupiahDari(beliTertulis, 'Harga beli', { bolehNol: true });
      if (!beli.ok) { dilewati.push({ nama, alasan: `harga beli "${teks(b.harga_beli, 40)}" belum kebaca` }); continue; }
      purchasePrice = beli.nilai;
    } else {
      tanpaHargaBeli += 1;
    }

    let satuan = null;
    if (teks(b.satuan, 40)) {
      const cocok = cocokkanSatu(b.satuan, satuanList, { label: 'satuan', namaDari: (u) => u.name, kunciLain: (u) => [u.symbol, u.code] });
      if (!cocok.ok) { dilewati.push({ nama, alasan: `satuan "${teks(b.satuan, 40)}" belum dikenal` }); continue; }
      satuan = cocok.nilai;
    } else if (jenis === JENIS.jualan && pcs) {
      satuan = pcs;
    } else {
      // Satuan dasar bahan menentukan takaran resep (gram vs kg vs pcs), jadi
      // tidak ditebak.
      dilewati.push({ nama, alasan: 'satuannya belum disebut (gram, ml, pcs, …)' });
      continue;
    }

    const kategori = teks(b.kategori, 60) || kategoriSemua || jenis.kategoriBawaan;
    if (!teks(b.kategori, 60) && !kategoriSemua) pakaiKategoriBawaan = true;

    baris.push({
      name: nama,
      category: kategori,
      price,
      purchasePrice,
      baseUnitId: satuan.id,
      itemTypeId: tipe.id,
      _satuan: satuan.symbol || satuan.name
    });
  }

  return { ok: true, jenis, baris, dilewati, kembarDiDaftar, kelebihan, ribuan, pakaiKategoriBawaan, tanpaHargaBeli };
}

const barangBanyak = Object.freeze({
  nama: 'buat_barang_banyak',
  lingkup: 'gerai',
  bertahap: true,
  petunjuk: 'memasukkan BANYAK barang sekaligus (2 atau lebih) dari daftar yang diketik/ditempel atau daftar menu, mis. "masukin menu: Es Teh 5rb, Kopi Susu 12rb, Roti Bakar 15rb" atau "masukin bahan: gula pasir (gram), susu kental (ml)". Satu barang saja pakai buat_barang.',
  skema: {
    daftar_barang: {
      type: 'array',
      description: 'buat_barang_banyak: SEMUA barang yang disebut, satu objek per barang, urut seperti ditulis.',
      items: {
        type: 'object',
        required: ['nama'],
        properties: {
          nama: { type: 'string', description: 'Nama PERSIS seperti ditulis.' },
          harga_jual: { type: 'string', description: 'Harga jual PERSIS seperti ditulis, mis. "15rb" atau "15". Kosongkan kalau tidak ada.' },
          harga_beli: { type: 'string', description: 'Harga beli/modal PERSIS seperti ditulis, hanya kalau disebut.' },
          kategori: { type: 'string', description: 'Kategori atau judul kelompoknya, hanya kalau ditulis.' },
          satuan: { type: 'string', description: 'Satuan (pcs, gram, ml, dll), hanya kalau ditulis.' }
        }
      }
    },
    daftar_kategori: { type: 'string', description: 'buat_barang_banyak: kategori untuk SEMUA barang, kalau disebut sekali untuk semuanya.' },
    daftar_jenis: { type: 'string', enum: ['jualan', 'bahan'], description: 'buat_barang_banyak: "bahan" kalau yang dimasukkan bahan baku untuk resep/pembelian; selain itu "jualan".' }
  },

  async siapkan(t, ctx) {
    if (!(Array.isArray(t?.daftar_barang) && t.daftar_barang.some((b) => teks(b?.nama, 100)))) {
      return { ok: false, tanya: 'Daftar barangnya mana? Tempel aja seperti nulis di chat, mis. "Es Teh 5rb, Kopi Susu 12rb".' };
    }
    const ref = await ctx.baca('/api/admin/manufacturing/bootstrap');
    if (!ref.ok) return ref;

    const urai = uraikanDaftar(t, ref.data);
    if (!urai.ok) return urai;

    // Saat konfirmasi, pembagian "sudah ada" diambil dari draft yang dilihat
    // orang: barang yang baru saja dibuat potongan sebelumnya tidak boleh
    // membuat draft dianggap berubah. Keberadaannya dicek lagi di postingBagian.
    const dariDraft = ctx.draftAsli?.muatan?.sudahAda;
    const adaDiGerai = Array.isArray(dariDraft)
      ? new Set(dariDraft.map((nama) => normalkan(nama)))
      : new Set((ref.data.products ?? []).map((p) => normalkan(p.name)));
    const baru = urai.baris.filter((b) => !adaDiGerai.has(normalkan(b.name)));
    const sudahAda = urai.baris.filter((b) => adaDiGerai.has(normalkan(b.name))).map((b) => b.name);

    if (!baru.length) {
      const alasan = [
        sudahAda.length ? `sudah ada di gerai: ${sudahAda.slice(0, 8).join(', ')}` : '',
        ...urai.dilewati.slice(0, 5).map((d) => `${d.nama} — ${d.alasan}`)
      ].filter(Boolean);
      return { ok: false, tanya: `Belum ada barang yang bisa Una buat dari daftar itu${alasan.length ? `: ${alasan.join('; ')}` : ''}.` };
    }

    const { jenis } = urai;
    const dampak = [
      jenis === JENIS.jualan
        ? `Langsung aktif dan muncul di kasir ${ctx.namaLingkup}. Stok awalnya 0.`
        : `Masuk daftar bahan ${ctx.namaLingkup}, siap dipakai di resep dan pembelian. Stok awalnya 0.`
    ];
    if (urai.ribuan) dampak.push('Harga ditulis singkat, jadi Una baca dalam ribuan (mis. 5 = 5.000). Kalau bukan begitu maksudnya, tekan Batal.');
    if (urai.pakaiKategoriBawaan) dampak.push(`Yang kategorinya tidak disebut Una taruh di "${jenis.kategoriBawaan}" — bisa dipindah nanti.`);
    if (urai.tanpaHargaBeli) {
      dampak.push(jenis === JENIS.jualan
        ? 'Harga beli yang kosong diisi 0: modalnya menyusul dari resep atau pembelian pertama.'
        : 'Harga beli yang kosong diisi 0: terisi sendiri dari pembelian pertama.');
    }
    if (sudahAda.length) dampak.push(`Sudah ada di gerai ini, dilewati: ${sudahAda.join(', ')}.`);
    if (urai.dilewati.length) dampak.push(`Belum bisa dibuat: ${urai.dilewati.map((d) => `${d.nama} (${d.alasan})`).join('; ')}.`);
    if (urai.kembarDiDaftar.length) dampak.push(`Disebut dua kali, dipakai yang pertama: ${urai.kembarDiDaftar.join(', ')}.`);
    if (urai.kelebihan) dampak.push(`Baru ${MAKS_BARIS_BARANG} baris pertama yang ikut; ${urai.kelebihan} sisanya kirim lagi sesudah ini.`);
    dampak.push('Salah bikin? Bilang "batalkan yang barusan" — barangnya Una nonaktifkan lagi.');

    return {
      ok: true,
      draft: {
        aksi: 'buat_barang_banyak',
        bertahap: true,
        judul: `Una mau memasukkan ${baru.length} ${jenis.label} — dicek dulu ya:`,
        baris: [['Jumlah', `${baru.length} barang baru`], ['Jenis', jenis.keterangan]],
        tabel: {
          kolom: jenis === JENIS.jualan ? ['Nama', 'Kategori', 'Harga jual', 'Harga beli', 'Satuan'] : ['Nama', 'Kategori', 'Harga beli', 'Satuan'],
          isi: baru.map((b) => (jenis === JENIS.jualan
            ? [b.name, b.category, rupiah(b.price), b.purchasePrice ? rupiah(b.purchasePrice) : '—', b._satuan]
            : [b.name, b.category, b.purchasePrice ? rupiah(b.purchasePrice) : '—', b._satuan]))
        },
        dampak,
        muatan: {
          daftar: baru.map(({ _satuan, ...muatan }) => muatan),
          sudahAda
        }
      }
    };
  },

  async postingBagian(draft, bagian, ctx) {
    const barang = draft.muatan.daftar[bagian];
    // Dicek tepat sebelum dibuat: tombol yang tertekan dua kali, atau koneksi
    // putus lalu diulang, tidak menghasilkan barang kembar.
    const ref = await ctx.baca('/api/admin/manufacturing/bootstrap');
    if (!ref.ok) return ref;
    const ada = (ref.data.products ?? []).find((p) => normalkan(p.name) === normalkan(barang.name));
    if (ada) return { ok: true, hasil: 'sudah_ada', nama: ada.name, id: Number(ada.id) || null };
    const hasil = await ctx.kirim('POST', '/api/admin/master/products/editor?ringkas=1', barang);
    if (!hasil.ok) return hasil;
    return { ok: true, hasil: 'dibuat', nama: barang.name, id: Number(hasil.data?.id) || null };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

// --- nonaktifkan barang ("batalkan yang barusan") -------------------------
//
// Bukan menghapus: barang dinonaktifkan supaya hilang dari kasir dan daftar,
// sementara riwayat penjualan/stok/HPP-nya tetap utuh dan bisa diaktifkan lagi.

const ANGKA_ID = /^\d{1,9}$/;

function draftNonaktif(daftar) {
  return {
    aksi: 'nonaktifkan_barang',
    bertahap: true,
    judul: `Una mau menonaktifkan ${daftar.length} barang — dicek dulu ya:`,
    baris: [['Jumlah', `${daftar.length} barang`]],
    tabel: { kolom: ['Barang'], isi: daftar.map((b) => [b.name]) },
    dampak: [
      'Tidak dihapus: barangnya cuma disembunyikan dari kasir dan daftar barang aktif.',
      'Riwayat penjualan, stok, dan HPP-nya tetap utuh.',
      'Bisa diaktifkan lagi kapan saja di layar Data Barang.'
    ],
    muatan: { daftar }
  };
}

const nonaktifkanBarang = Object.freeze({
  nama: 'nonaktifkan_barang',
  lingkup: 'gerai',
  bertahap: true,
  petunjuk: 'menonaktifkan (menyembunyikan, bukan menghapus) barang, termasuk "batalkan barang yang barusan dibuat", mis. "nonaktifkan Es Teh dan Kopi Susu".',
  skema: {
    nonaktif_barang: { type: 'array', description: 'nonaktifkan_barang: nama-nama barang PERSIS seperti disebut.', items: { type: 'string' } }
  },

  async siapkan(t, ctx) {
    const ref = await ctx.baca('/api/admin/manufacturing/bootstrap');
    if (!ref.ok) return ref;
    const aktif = (ref.data.products ?? []).map((p) => ({ id: Number(p.id), name: p.name }));

    // Konfirmasi potongan berikutnya: barang potongan sebelumnya sudah
    // nonaktif, jadi tidak bisa dicocokkan ulang lewat nama. Yang diperiksa:
    // tiap baris yang masih aktif harus id DAN namanya sama dengan yang tadi
    // dilihat; baris yang sudah nonaktif dilewati waktu diposting.
    const dariDraft = ctx.draftAsli?.muatan?.daftar;
    if (Array.isArray(dariDraft)) {
      if (!dariDraft.length || dariDraft.length > MAKS_BARIS_BARANG) return { ok: false, tanya: 'Daftar barangnya tidak valid.' };
      for (const baris of dariDraft) {
        if (!ANGKA_ID.test(String(baris?.id)) || typeof baris?.name !== 'string') return { ok: false, tanya: 'Daftar barangnya tidak valid.' };
        const kini = aktif.find((p) => p.id === Number(baris.id));
        if (kini && kini.name !== baris.name) return { ok: false, tanya: `Nama barang "${baris.name}" sudah berubah. Minta Una menyusun ulang ya.` };
      }
      return { ok: true, draft: draftNonaktif(dariDraft.map((b) => ({ id: Number(b.id), name: b.name }))) };
    }

    const daftar = [];
    const tambah = (barang) => { if (!daftar.some((b) => b.id === barang.id)) daftar.push(barang); };
    // Dari tombol "batalkan yang barusan": id barang yang tadi dibuat Una.
    const id = Array.isArray(t?.nonaktif_id) ? t.nonaktif_id.slice(0, MAKS_BARIS_BARANG) : [];
    for (const nilai of id) {
      const barang = aktif.find((p) => p.id === Number(nilai));
      if (barang) tambah(barang);
    }
    // Dari kalimat: dicocokkan seperti biasa, yang ambigu ditanyakan.
    const nama = Array.isArray(t?.nonaktif_barang) ? t.nonaktif_barang.slice(0, MAKS_BARIS_BARANG) : [];
    for (const tertulis of nama) {
      const cocok = cocokkanSatu(tertulis, aktif, { label: 'barang', namaDari: (p) => p.name });
      if (!cocok.ok) return cocok;
      tambah(cocok.nilai);
    }
    if (!daftar.length) {
      return { ok: false, tanya: id.length ? 'Barang-barang itu sudah tidak aktif — tidak ada yang perlu dibatalkan.' : 'Barang mana yang mau dinonaktifkan?' };
    }
    return { ok: true, draft: draftNonaktif(daftar) };
  },

  async postingBagian(draft, bagian, ctx) {
    const barang = draft.muatan.daftar[bagian];
    const ref = await ctx.baca('/api/admin/manufacturing/bootstrap');
    if (!ref.ok) return ref;
    if (!(ref.data.products ?? []).some((p) => Number(p.id) === Number(barang.id))) {
      return { ok: true, hasil: 'sudah_nonaktif', nama: barang.name, id: barang.id };
    }
    const hasil = await ctx.kirim('PATCH', `/api/admin/master/products/editor/${Number(barang.id)}?ringkas=1`, { isActive: false });
    if (!hasil.ok) return hasil;
    return { ok: true, hasil: 'dinonaktifkan', nama: barang.name, id: barang.id };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

export const AKSI_BARANG = Object.freeze([barangBanyak, nonaktifkanBarang]);

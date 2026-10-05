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
import { tampilSkala } from './caca-hitung.js';
import { normalkan, cocokkanSatu, rupiahDari, teks, BELUM_KETEMU, kataBelumKetemu } from './caca-aksi-dasar.js';

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
  const bahanTanpaSatuan = [];

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
    } else if (pcs) {
      // Bos Cyo 2026-10-02: detail yang tidak disebut diisi yang dasar, tidak
      // ditanyakan. Untuk bahan, satuan pcs disebut terang di draft karena
      // takaran resep bergantung padanya.
      satuan = pcs;
      if (jenis === JENIS.bahan) bahanTanpaSatuan.push(nama);
    } else {
      dilewati.push({ nama, alasan: 'satuan pcs belum ada di gerai ini' });
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

  return { ok: true, jenis, baris, dilewati, kembarDiDaftar, kelebihan, ribuan, pakaiKategoriBawaan, tanpaHargaBeli, bahanTanpaSatuan };
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

    // Semua barang di daftar ternyata SUDAH ADA dan ada harganya: maksud Bos
    // hampir pasti mengganti harga, bukan membuat barang (uji langsung
    // 2026-10-05: "Susu Kental Manis 2rb, Teh Vanilla 2rb" sesudah Una
    // menemukan harga janggal). Dialihkan ke ubah_barang, yang tetap membuat
    // draft sebelum/sesudah + "Ya".
    if (!baru.length && sudahAda.length && !Array.isArray(dariDraft)) {
      const ubah = t.daftar_barang
        .filter((b) => adaDiGerai.has(normalkan(teks(b?.nama, 100))) && (teks(b?.harga_jual, 30) || teks(b?.harga_beli, 30)))
        .map((b) => ({ barang: teks(b.nama, 100), harga_jual: teks(b.harga_jual, 30) || undefined, harga_beli: teks(b.harga_beli, 30) || undefined }));
      if (ubah.length) return { ok: false, alihkan: { alat: 'ubah_barang', tangkapan: { ubah_daftar: ubah } } };
    }

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
    if (urai.bahanTanpaSatuan.length) dampak.push(`Satuan belum disebut, Una pakai pcs: ${urai.bahanTanpaSatuan.join(', ')} — kalau maksudnya gram/ml, bilang aja nanti.`);
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
      if (!dariDraft.length || dariDraft.length > MAKS_BARIS_BARANG) return { ok: false, tanya: 'Daftar barangnya kayaknya berubah. Minta Una menyusun ulang ya.' };
      for (const baris of dariDraft) {
        if (!ANGKA_ID.test(String(baris?.id)) || typeof baris?.name !== 'string') return { ok: false, tanya: 'Daftar barangnya kayaknya berubah. Minta Una menyusun ulang ya.' };
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

// --- ubah barang (harga jual, harga beli, nama, kategori) -----------------
//
// Bos Cyo 2026-10-03: "jangankan koreksi hpp, ganti harga aja masa ga bisa.
// kan uda bisa bikin barang, masak edit ga bisa". Lewat endpoint editor yang
// sama dengan layar Data Barang (PATCH parsial: hanya isian yang disebut yang
// berubah, sisanya — foto, poin, tipe, resep — tidak tersentuh).
//
// Salah ketik nama ("blackcurent") dibaca kode: kalau tepat satu barang yang
// jaraknya dekat, dipakai dan DISEBUT di draft; kalau ragu, ditanyakan.
// Isi draft dibekukan di muatan (id + nilai lama/baru), supaya potongan
// berikutnya tidak menganggap draft "berubah" setelah potongan sebelumnya
// sudah mengubah harganya.

const MAKS_HARGA = 10_000_000;

function jarakEdit(a, b) {
  const baris = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let kiriAtas = baris[0];
    baris[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const atas = baris[j];
      baris[j] = Math.min(baris[j] + 1, baris[j - 1] + 1, kiriAtas + (a[i - 1] === b[j - 1] ? 0 : 1));
      kiriAtas = atas;
    }
  }
  return baris[b.length];
}

const ringkasHuruf = (nama) => normalkan(nama).replace(/ /g, '');

function trigram(teksRingkas) {
  const unit = teksRingkas.length >= 3 ? 3 : 2;
  const hasil = new Map();
  for (let i = 0; i + unit <= teksRingkas.length; i += 1) {
    const kunci = teksRingkas.slice(i, i + unit);
    hasil.set(kunci, (hasil.get(kunci) ?? 0) + 1);
  }
  return hasil;
}

/** Kemiripan 0..1: irisan potongan huruf (tahan salah ketik dan spasi yang beda). */
function kemiripan(tertulis, nama) {
  const a = ringkasHuruf(tertulis);
  const b = ringkasHuruf(nama);
  if (!a || !b) return 0;
  const ta = trigram(a);
  const tb = trigram(b);
  let irisan = 0;
  for (const [kunci, n] of ta) irisan += Math.min(n, tb.get(kunci) ?? 0);
  const dice = (2 * irisan) / (a.length + b.length - 2 * (a.length >= 3 && b.length >= 3 ? 2 : 1));
  // Kata-kata yang diketik ada di nama (atau nyaris): "black curent" dalam "Milktea Black Curent".
  const kata = normalkan(tertulis).split(' ').filter((k) => k.length >= 3);
  const nyaris = (k) => b.includes(k) || normalkan(nama).split(' ').some((n) => n.length >= 4 && jarakEdit(k, n) <= 1);
  const tutup = kata.length ? kata.filter(nyaris).length / kata.length : 0;
  return Math.min(1, 0.6 * Math.max(0, dice) + 0.4 * tutup);
}

/**
 * Barang yang namanya dekat (salah ketik). Tepat satu yang nyaris sama → dipakai
 * dan DISEBUT di draft. Selain itu: rekomendasi berdasarkan kemiripan terbanyak
 * ("maksudnya es teh black curent atau milktea black curent ya Bos?"), dan nama
 * gerai disebut — "di Mandala" yang diucapkan belum tentu gerai yang sedang
 * dibuka, dan itu sebab paling umum barang "tidak ada".
 */
function cocokkanMirip(tertulis, daftar, namaGerai = 'gerai ini') {
  const kunci = ringkasHuruf(tertulis);
  const jarak = daftar
    .map((p) => ({ p, d: jarakEdit(kunci, ringkasHuruf(p.name)) }))
    .sort((x, y) => x.d - y.d);
  const batas = Math.max(2, Math.floor(kunci.length * 0.2));
  if (jarak[0] && jarak[0].d <= batas && (!jarak[1] || jarak[1].d - jarak[0].d >= 2)) {
    return { ok: true, nilai: jarak[0].p, dibetulkan: true };
  }
  const saran = daftar
    .map((p) => ({ p, skor: kemiripan(tertulis, p.name) }))
    .filter((x) => x.skor >= 0.3)
    .sort((x, y) => y.skor - x.skor)
    .slice(0, 3);
  if (saran.length) {
    const nama = saran.map((x) => `"${x.p.name}"`);
    const sebut = nama.length === 1 ? nama[0] : `${nama.slice(0, -1).join(', ')} atau ${nama.at(-1)}`;
    return { ok: false, tanya: `Barang "${tertulis}" ${kataBelumKetemu(tertulis)} di ${namaGerai}. Maksudnya ${sebut} ya Bos?` };
  }
  return { ok: false, tanya: `Barang "${tertulis}" ${kataBelumKetemu(tertulis)} di ${namaGerai}. Mungkin ada di gerai lain? Pindah dulu lewat tombol ▾ di atas ya.` };
}

const skala = (rupiahBulat) => Math.round(Number(rupiahBulat || 0) * 1_000_000);

function tampilRupiah(nilai) {
  return `Rp${rupiah(Math.round(Number(nilai) || 0))}`;
}

function susunDraftUbah(daftar, catatan) {
  const isi = [];
  for (const baris of daftar) {
    const { perubahan, sebelum } = baris;
    if ('name' in perubahan) isi.push([baris.name, 'Nama', sebelum.name ?? baris.name, perubahan.name]);
    if ('price' in perubahan) isi.push([perubahan.name ?? baris.name, 'Harga jual', sebelum.price, tampilRupiah(perubahan.price)]);
    if ('purchasePrice' in perubahan) isi.push([perubahan.name ?? baris.name, 'Harga beli', sebelum.purchasePrice, tampilRupiah(perubahan.purchasePrice)]);
    if ('category' in perubahan) isi.push([perubahan.name ?? baris.name, 'Kategori', sebelum.category || '—', perubahan.category]);
  }
  const semua = daftar.flatMap((b) => Object.keys(b.perubahan));
  const dampak = [
    ...catatan,
    ...(semua.includes('price') ? ['Harga jual baru berlaku di kasir untuk penjualan berikutnya; penjualan yang sudah tercatat tidak berubah.'] : []),
    ...(semua.includes('purchasePrice') ? ['Yang berubah hanya Harga Beli di Master Barang. HPP (modal rata-rata) tidak ikut berubah — kalau HPP-nya yang salah, bilang "koreksi HPP".'] : []),
    ...(semua.includes('name') ? ['Nama baru ikut tampil di kasir dan laporan; riwayat tetap tertaut ke barang yang sama.'] : []),
    'Foto, poin, tipe, dan resep barang tidak disentuh. Salah ubah? Sebut nilai yang benar, Una ubah lagi.'
  ];
  return {
    aksi: 'ubah_barang',
    bertahap: true,
    judul: `Una mau mengubah ${daftar.length} barang — dicek dulu ya:`,
    baris: [['Jumlah', `${daftar.length} barang`]],
    tabel: { kolom: ['Barang', 'Yang diubah', 'Sebelum', 'Sesudah'], isi },
    dampak,
    muatan: { daftar, catatan }
  };
}

const BATAS_ISI_UBAH = 60;

function bentukUbahValid(daftar) {
  if (!Array.isArray(daftar) || !daftar.length || daftar.length > BATAS_ISI_UBAH) return false;
  return daftar.every((b) => ANGKA_ID.test(String(b?.id)) && typeof b.name === 'string'
    && b.perubahan && typeof b.perubahan === 'object' && b.sebelum && typeof b.sebelum === 'object'
    && Object.keys(b.perubahan).length > 0
    && Object.entries(b.perubahan).every(([kunci, nilai]) => (
      (kunci === 'name' || kunci === 'category') ? typeof nilai === 'string' && nilai.trim()
        : (kunci === 'price' || kunci === 'purchasePrice') ? Number.isInteger(nilai) && nilai >= 0 && nilai <= MAKS_HARGA
          : false)));
}

const ubahBarang = Object.freeze({
  nama: 'ubah_barang',
  lingkup: 'gerai',
  bertahap: true,
  petunjuk: 'MENGUBAH barang yang sudah ada: harga jual, harga beli, nama, atau kategori — satu atau banyak, mis. "harga es teh blackcurant di mandala ganti jadi 7rb", "harga beli gula jadi 18rb", "ganti nama Kopi Susu jadi Kopi Susu Gula Aren". Bukan untuk membuat barang baru, bukan untuk HPP.',
  skema: {
    ubah_daftar: {
      type: 'array',
      description: 'ubah_barang: satu objek per barang yang diubah, hanya isian yang disebut.',
      items: {
        type: 'object',
        required: ['barang'],
        properties: {
          barang: { type: 'string', description: 'Nama barang yang diubah PERSIS seperti disebut (tanpa nama gerai).' },
          harga_jual: { type: 'string', description: 'Harga jual BARU PERSIS seperti disebut, mis. "7rb".' },
          harga_beli: { type: 'string', description: 'Harga beli BARU PERSIS seperti disebut.' },
          nama_baru: { type: 'string', description: 'Nama BARU barang, kalau diganti.' },
          kategori: { type: 'string', description: 'Kategori BARU, kalau dipindah.' }
        }
      }
    }
  },

  async siapkan(t, ctx) {
    // Konfirmasi (potongan mana pun): isi dibekukan di draft yang dilihat.
    const beku = ctx.draftAsli?.muatan;
    if (beku && Array.isArray(beku.daftar)) {
      if (!bentukUbahValid(beku.daftar) || !Array.isArray(beku.catatan)) return { ok: false, tanya: 'Daftar perubahannya kayaknya berubah. Minta Una menyusun ulang ya.' };
      return { ok: true, draft: susunDraftUbah(beku.daftar, beku.catatan.map(String).slice(0, 20)) };
    }

    const mentah = (Array.isArray(t?.ubah_daftar) ? t.ubah_daftar : []).filter((b) => teks(b?.barang, 100));
    if (!mentah.length) return { ok: false, tanya: 'Barang yang mana yang mau diubah, dan jadi apa?' };
    if (mentah.length > BATAS_ISI_UBAH) return { ok: false, tanya: `Kebanyakan untuk sekali ubah (maks ${BATAS_ISI_UBAH}). Bagi dua ya.` };

    // Tanpa foto: satu foto barang bisa ratusan KB.
    const ref = await ctx.baca('/api/admin/master/products/editor?ringkas=1');
    if (!ref.ok) return ref;
    const semua = ref.data.products ?? [];
    const aktif = semua.filter((p) => p.isActive !== false);

    const daftar = [];
    const catatan = [];
    const dipakai = new Set();
    for (const baris of mentah) {
      const tertulis = teks(baris.barang, 100);
      let cocok = cocokkanSatu(tertulis, aktif, { label: 'barang', namaDari: (p) => p.name });
      if (!cocok.ok && BELUM_KETEMU.test(cocok.tanya)) {
        const nonaktif = semua.find((p) => p.isActive === false && normalkan(p.name) === normalkan(tertulis));
        if (nonaktif) return { ok: false, tanya: `"${nonaktif.name}" sedang nonaktif. Aktifkan dulu di layar Data Barang, baru Una ubah ya.` };
        cocok = cocokkanMirip(tertulis, aktif, ctx.namaLingkup || 'gerai ini');
      }
      if (!cocok.ok) return cocok;
      const p = cocok.nilai;
      if (dipakai.has(p.id)) return { ok: false, tanya: `"${p.name}" disebut dua kali. Yang mana perubahannya?` };
      dipakai.add(p.id);
      if (cocok.dibetulkan) catatan.push(`Una membaca "${tertulis}" sebagai "${p.name}".`);

      const perubahan = {};
      const sebelum = {};
      if (teks(baris.harga_jual, 40)) {
        const jual = rupiahDari(baris.harga_jual, `Harga jual ${p.name}`, { bolehNol: true });
        if (!jual.ok) return jual;
        if (jual.nilai > MAKS_HARGA) return { ok: false, tanya: `Harga jual ${p.name} kebesaran — kelebihan nol? Tulis ulang ya.` };
        if (skala(p.price) !== skala(jual.nilai)) { perubahan.price = jual.nilai; sebelum.price = tampilRupiah(p.price); }
      }
      if (teks(baris.harga_beli, 40)) {
        const beli = rupiahDari(baris.harga_beli, `Harga beli ${p.name}`, { bolehNol: true });
        if (!beli.ok) return beli;
        if (beli.nilai > MAKS_HARGA) return { ok: false, tanya: `Harga beli ${p.name} kebesaran — kelebihan nol? Tulis ulang ya.` };
        if (skala(p.purchasePrice) !== skala(beli.nilai)) { perubahan.purchasePrice = beli.nilai; sebelum.purchasePrice = tampilRupiah(p.purchasePrice); }
      }
      const namaBaru = teks(baris.nama_baru, 100);
      if (namaBaru && namaBaru !== p.name) {
        const kembar = semua.find((x) => x.id !== p.id && normalkan(x.name) === normalkan(namaBaru));
        if (kembar) return { ok: false, tanya: `Sudah ada barang "${kembar.name}". Pakai nama lain?` };
        perubahan.name = namaBaru;
        sebelum.name = p.name;
      }
      const kategoriBaru = teks(baris.kategori, 60);
      if (kategoriBaru && kategoriBaru !== p.category) { perubahan.category = kategoriBaru; sebelum.category = p.category || ''; }

      if (!Object.keys(perubahan).length) {
        const disebut = [teks(baris.harga_jual, 40) && 'harga jual', teks(baris.harga_beli, 40) && 'harga beli', namaBaru && 'nama', kategoriBaru && 'kategori'].filter(Boolean);
        return { ok: false, tanya: disebut.length
          ? `"${p.name}" sudah seperti itu (${disebut.join(', ')} sama), tidak ada yang perlu diubah.`
          : `Mau diubah apanya dari "${p.name}"? Harga jual, harga beli, nama, atau kategori?` };
      }
      daftar.push({ id: Number(p.id), name: p.name, perubahan, sebelum });
    }
    return { ok: true, draft: susunDraftUbah(daftar, catatan) };
  },

  async postingBagian(draft, bagian, ctx) {
    const baris = draft.muatan.daftar[bagian];
    // PATCH parsial: hanya isian yang berubah dikirim, sisanya dibiarkan oleh
    // endpoint editor. Nilainya mutlak, jadi diulang pun hasilnya sama.
    const hasil = await ctx.kirim('PATCH', `/api/admin/master/products/editor/${Number(baris.id)}?ringkas=1`, baris.perubahan);
    if (!hasil.ok) return hasil;
    return { ok: true, hasil: 'diubah', nama: baris.perubahan.name ?? baris.name, id: baris.id };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

// --- cek barang (harga jual, harga beli, HPP, stok) -----------------------
//
// Bos Cyo 2026-10-03: "coba cek harga jual es teh leci sama es teh black
// curant sekarang brp?" dijawab "Lembarnya terlalu panjang" — pertanyaan
// sesederhana itu lewat pembaca bebas yang membawa seluruh daftar barang ke
// model. Alat ini menjawabnya dengan KODE: cocokkan nama (semua barang yang
// namanya memuat kata itu, karena "es teh leci" bisa Besar dan Kecil), lalu
// tampilkan angkanya apa adanya. Tidak ada panggilan model kedua.

const rupiahPersis = (nilai) => `Rp${tampilSkala(BigInt(Math.round(Number(nilai || 0) * 1_000_000)))}`;
const MAKS_CEK = 15;

const cekBarang = Object.freeze({
  nama: 'cek_barang',
  lingkup: 'gerai',
  baca: true,
  petunjuk: 'MELIHAT harga jual, harga beli, HPP, dan stok barang TERTENTU yang disebut namanya, mis. "harga jual es teh leci sama es teh black curant berapa?", "HPP kopi susu berapa?". Lebih cepat dari baca_api untuk pertanyaan per barang.',
  skema: {
    cek_barang: { type: 'array', description: 'cek_barang: nama-nama barang PERSIS seperti disebut (tanpa nama gerai).', items: { type: 'string' } }
  },

  async siapkan(t, ctx) {
    const nama = (Array.isArray(t?.cek_barang) ? t.cek_barang : []).map((n) => teks(n, 100)).filter(Boolean).slice(0, 10);
    if (!nama.length) return { ok: false, tanya: 'Barang yang mana yang mau dicek?' };
    const ref = await ctx.baca('/api/admin/master/products/editor?ringkas=1');
    if (!ref.ok) return ref;
    const aktif = (ref.data.products ?? []).filter((p) => p.isActive !== false);

    const ketemu = [];
    const catatan = [];
    for (const tertulis of nama) {
      const kunci = normalkan(tertulis);
      let cocok = aktif.filter((p) => normalkan(p.name).includes(kunci));
      if (!cocok.length) {
        const mirip = cocokkanMirip(tertulis, aktif, ctx.namaLingkup || 'gerai ini');
        if (mirip.ok) {
          cocok = [mirip.nilai];
        } else {
          // Hanya membaca, jadi boleh lebih longgar dari ubah_barang: yang
          // paling mirip langsung ditampilkan, dan itu dikatakan terang.
          const dekat = aktif
            .map((p) => ({ p, skor: kemiripan(tertulis, p.name) }))
            .filter((x) => x.skor >= 0.55)
            .sort((x, y) => y.skor - x.skor)
            .slice(0, 3);
          if (!dekat.length) { catatan.push(mirip.tanya); continue; }
          cocok = dekat.map((x) => x.p);
          catatan.push(`"${tertulis}" belum persis ketemu, Una tampilkan yang paling mirip.`);
        }
      }
      for (const p of cocok) if (!ketemu.some((x) => x.id === p.id)) ketemu.push(p);
    }
    if (!ketemu.length) return { ok: true, jawaban: catatan.join(' ') };

    const tampil = ketemu.slice(0, MAKS_CEK);
    const stok = (p) => (p.stockQuantity == null ? '—' : `${rupiah(p.stockQuantity)} ${p.unitSymbol || ''}`.trim());
    return {
      ok: true,
      jawaban: [
        `Ini di ${ctx.namaLingkup || 'gerai ini'}:`,
        ketemu.length > MAKS_CEK ? `(${ketemu.length} barang cocok, Una tampilkan ${MAKS_CEK} pertama — sebut lebih spesifik kalau perlu.)` : '',
        ...catatan
      ].filter(Boolean).join(' '),
      tabel: {
        kolom: ['Barang', 'Harga jual', 'Harga beli', 'HPP', 'Stok'],
        isi: tampil.map((p) => [p.name, rupiahPersis(p.price), rupiahPersis(p.purchasePrice), rupiahPersis(p.averageCost), stok(p)])
      }
    };
  }
});

// --- cek_harga_janggal: mencari harga yang anomali, dihitung kode ----------------
//
// Uji langsung 2026-10-05 di gerai Testing Una: "barang mana yang harga jualnya di
// bawah harga beli?" lewat baca_api dijawab "semua aman" padahal ada 2 barang —
// daftar 46 barang terlalu besar untuk dilihat utuh dan model lite tidak menyusun
// saringannya. Pertanyaan anomali harga itu sering (Bos Cyo: "cek harga2 yang
// anomali, lalu ganti harganya dengan harga normal"), jadi saringannya dikerjakan
// kode. Uang dibandingkan dalam skala 1e6 (BigInt), bukan float.

const skalaBig = (rupiahAngka) => BigInt(Math.round(Number(rupiahAngka || 0) * 1_000_000));
const KALI_JANGGAL = 5n;          // 5x lipat dari median sekategori = curiga salah ketik nol
const MIN_SEKATEGORI = 3;
const MAKS_JANGGAL = 40;

function median(nilai) {
  const urut = [...nilai].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return urut[Math.floor((urut.length - 1) / 2)];
}

/** Daftar {produk, alasan[]} untuk barang aktif yang harganya janggal. */
export function cariHargaJanggal(produk) {
  const aktif = (Array.isArray(produk) ? produk : []).filter((p) => p && p.isActive !== false);
  const hasil = new Map();
  const tandai = (p, alasan) => {
    if (!hasil.has(p.id)) hasil.set(p.id, { produk: p, alasan: [] });
    hasil.get(p.id).alasan.push(alasan);
  };

  const perKategori = new Map();
  for (const p of aktif) {
    const jual = skalaBig(p.price);
    const beli = skalaBig(p.purchasePrice);
    let hpp = 0n;
    try { hpp = p.averageCostScaled != null ? BigInt(String(p.averageCostScaled)) : skalaBig(p.averageCost); } catch { hpp = skalaBig(p.averageCost); }
    const bahan = p.productKindCode === 'RAW_MATERIAL';
    if (jual > 0n && beli > 0n && jual < beli) tandai(p, 'harga jual di bawah harga beli');
    if (jual > 0n && hpp > 0n && jual < hpp) tandai(p, 'harga jual di bawah HPP');
    if (!bahan && jual === 0n) tandai(p, 'harga jual masih 0');
    // Bahan dihargai per gram/ml/pcs, jadi dibandingkan dengan menu sekategori
    // pasti tampak "murah" (uji langsung: gula Rp18/gram ikut ditandai). Hanya
    // barang non-bahan dengan satuan sama yang dibandingkan.
    if (jual > 0n && !bahan) {
      const kunci = `${normalkan(p.category || '')}|${p.unitSymbol || p.baseUnitId || ''}`;
      if (!perKategori.has(kunci)) perKategori.set(kunci, []);
      perKategori.get(kunci).push({ p, jual });
    }
  }
  for (const daftar of perKategori.values()) {
    if (daftar.length < MIN_SEKATEGORI) continue;
    const tengah = median(daftar.map((x) => x.jual));
    for (const { p, jual } of daftar) {
      if (jual >= tengah * KALI_JANGGAL) tandai(p, `jauh lebih mahal dari barang sekategori (umumnya ${tampilRupiah(Number(tengah / 1_000_000n))})`);
      else if (jual * KALI_JANGGAL <= tengah) tandai(p, `jauh lebih murah dari barang sekategori (umumnya ${tampilRupiah(Number(tengah / 1_000_000n))})`);
    }
  }
  return [...hasil.values()];
}

const cekHargaJanggal = Object.freeze({
  nama: 'cek_harga_janggal',
  lingkup: 'gerai',
  baca: true,
  petunjuk: 'MENCARI barang yang harganya janggal/anomali di gerai ini: harga jual di bawah harga beli atau HPP, harga jual masih 0, atau harga jauh beda dari barang sekategori (salah ketik nol). Untuk "cek harga yang anomali", "barang mana yang rugi/dijual di bawah modal", "harga jual di bawah harga beli". Dihitung sistem.',
  skema: {},

  async siapkan(_t, ctx) {
    const ref = await ctx.baca('/api/admin/master/products/editor?ringkas=1');
    if (!ref.ok) return ref;
    const janggal = cariHargaJanggal(ref.data.products ?? []);
    const gerai = ctx.namaLingkup || 'gerai ini';
    if (!janggal.length) {
      return { ok: true, jawaban: `Una sudah cek semua barang aktif di ${gerai}: tidak ada harga jual di bawah harga beli/HPP, tidak ada yang 0, dan tidak ada yang jauh beda dari barang sekategori.` };
    }
    const tampil = janggal.slice(0, MAKS_JANGGAL);
    return {
      ok: true,
      jawaban: `Ada ${janggal.length} barang dengan harga janggal di ${gerai}${janggal.length > MAKS_JANGGAL ? ` (Una tampilkan ${MAKS_JANGGAL} pertama)` : ''}:`,
      tabel: {
        kolom: ['Barang', 'Harga jual', 'Harga beli', 'HPP', 'Kenapa janggal'],
        isi: tampil.map(({ produk: p, alasan }) => [p.name, rupiahPersis(p.price), rupiahPersis(p.purchasePrice), rupiahPersis(p.averageCost), alasan.join('; ')])
      }
    };
  }
});

export const AKSI_BARANG = Object.freeze([barangBanyak, nonaktifkanBarang, ubahBarang, cekBarang, cekHargaJanggal]);

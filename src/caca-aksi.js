// Alat TULIS Caca tahap kedua: barang baru, resep baru, jurnal entity.
//
// Polanya sama persis dengan catat pengeluaran (caca-tulis.js), dan ALASANNYA
// juga sama: satu perintah = satu panggilan AI. Model cuma menyalin kalimat
// jadi data mentah ("nama barang seperti diucapkan", "nominal seperti
// diucapkan"). Kode yang:
//   - mencocokkan nama ke barang/satuan/akun yang benar-benar ada,
//   - mengurai angka,
//   - memeriksa (jurnal balance, barang tidak dobel, komponen ada),
//   - menyusun draft beserta akibatnya,
//   - dan sesudah orang menekan "Ya", memposting lewat endpoint yang sama
//     dengan yang dipakai layar (K1/K4 ADR-045) dengan wewenang si penyuruh.
//
// Satu hal yang berbeda dari pengeluaran: aksi ini bergantung pada data master
// (nama barang, satuan, akun). Kalau data itu berubah di antara draft tampil
// dan tombol "Ya" ditekan, draft disusun ulang dan hasilnya harus SAMA persis
// dengan yang tadi dilihat orang — kalau beda, ditolak dan diminta draft ulang.
// Yang diposting selalu yang sudah dilihat, tidak pernah tafsiran baru.

import { rupiah } from './caca-nominal.js';
import { normalkan, cocokkanSatu, jumlahBulat, rupiahDari, teks, tanggalDari } from './caca-aksi-dasar.js';
import { AKSI_BAYAR } from './caca-aksi-bayar.js';

export { normalkan, cocokkanSatu };

const REFERENSI = /^caca_[0-9a-f-]{36}$/;

// --- barang baru ----------------------------------------------------------

const barang = Object.freeze({
  nama: 'buat_barang',
  lingkup: 'gerai',
  petunjuk: 'mendaftarkan barang baru di gerai, mis. "bikin barang Leker Tiramisu kategori Leker harga 15rb, harga beli 6rb".',
  skema: {
    barang_nama: { type: 'string', description: 'buat_barang: nama barang PERSIS seperti diucapkan.' },
    barang_kategori: { type: 'string', description: 'buat_barang: kategori, kalau disebut.' },
    barang_harga_jual: { type: 'string', description: 'buat_barang: harga jual PERSIS seperti diucapkan, mis. "15rb".' },
    barang_harga_beli: { type: 'string', description: 'buat_barang: harga beli/modal PERSIS seperti diucapkan, kalau disebut.' },
    barang_satuan: { type: 'string', description: 'buat_barang: satuan (pcs, gram, ml, dll), kalau disebut.' }
  },

  async siapkan(t, ctx) {
    const nama = teks(t?.barang_nama, 100);
    if (!nama) return { ok: false, tanya: 'Nama barangnya apa?' };
    const kategori = teks(t?.barang_kategori, 60);
    if (!kategori) return { ok: false, tanya: `"${nama}" masuk kategori apa?` };
    if (!teks(t?.barang_harga_jual, 40)) return { ok: false, tanya: `Harga jual "${nama}" berapa?` };
    const jual = rupiahDari(t.barang_harga_jual, 'Harga jual', { bolehNol: true });
    if (!jual.ok) return jual;
    // Harga beli ikut menentukan HPP awal, jadi tidak diisi diam-diam dengan 0.
    if (!teks(t?.barang_harga_beli, 40)) {
      return { ok: false, tanya: `Harga beli (modal) "${nama}" berapa? Tulis 0 kalau barangnya dibuat sendiri lewat resep.` };
    }
    const beli = rupiahDari(t.barang_harga_beli, 'Harga beli', { bolehNol: true });
    if (!beli.ok) return beli;

    const ref = await ctx.baca(`/api/admin/manufacturing/bootstrap`);
    if (!ref.ok) return ref;
    const kembar = (ref.data.products ?? []).find((p) => normalkan(p.name) === normalkan(nama));
    if (kembar) return { ok: false, tanya: `Barang "${kembar.name}" sudah ada di gerai ini. Mau pakai nama lain?` };

    const satuanList = (ref.data.units ?? []).filter((u) => u.isActive !== false);
    let satuan;
    if (teks(t?.barang_satuan, 40)) {
      const cocok = cocokkanSatu(t.barang_satuan, satuanList, {
        label: 'satuan', namaDari: (u) => u.name, kunciLain: (u) => [u.symbol, u.code]
      });
      if (!cocok.ok) return cocok;
      satuan = cocok.nilai;
    } else {
      satuan = satuanList.find((u) => u.code === 'PCS');
      if (!satuan) return { ok: false, tanya: `Satuan "${nama}" apa?` };
    }

    const muatan = {
      name: nama,
      category: kategori,
      price: jual.nilai,
      purchasePrice: beli.nilai,
      baseUnitId: satuan.id
    };
    return {
      ok: true,
      draft: {
        aksi: 'buat_barang',
        judul: 'Una mau membuat barang baru — dicek dulu ya:',
        baris: [
          ['Nama', nama],
          ['Kategori', kategori],
          ['Harga jual', rupiah(jual.nilai)],
          ['Harga beli', rupiah(beli.nilai)],
          ['Satuan', satuan.symbol || satuan.name]
        ],
        dampak: [
          `Barang baru di ${ctx.namaLingkup}, langsung aktif.`,
          'Stok awalnya 0 — stok bertambah lewat pembelian atau produksi.',
          'Foto, poin, dan tipe barang bisa dilengkapi nanti di Master Barang.'
        ],
        muatan
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/admin/master/products/editor', draft.muatan);
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Sudah Una buat: barang "${draft.muatan.name}".` };
  }
});

// --- resep baru -----------------------------------------------------------

const resep = Object.freeze({
  nama: 'buat_resep',
  lingkup: 'gerai',
  petunjuk: 'membuat resep produksi, mis. "resep Leker Coklat: 10 pcs butuh tepung 250 gram, telur 2, coklat 100 gram".',
  skema: {
    resep_hasil: { type: 'string', description: 'buat_resep: nama barang hasil PERSIS seperti diucapkan.' },
    resep_hasil_qty: { type: 'string', description: 'buat_resep: jumlah hasil satu kali produksi, angka saja. Kosongkan kalau tidak disebut.' },
    resep_varian: { type: 'string', description: 'buat_resep: nama varian resep, hanya kalau disebut.' },
    resep_komponen: {
      type: 'array',
      description: 'buat_resep: bahan-bahannya.',
      items: {
        type: 'object',
        required: ['barang', 'qty'],
        properties: {
          barang: { type: 'string', description: 'Nama bahan PERSIS seperti diucapkan.' },
          qty: { type: 'string', description: 'Jumlahnya, angka saja tanpa satuan.' }
        }
      }
    }
  },

  async siapkan(t, ctx) {
    if (!teks(t?.resep_hasil, 100)) return { ok: false, tanya: 'Resep untuk barang apa?' };
    const komponenMentah = Array.isArray(t?.resep_komponen) ? t.resep_komponen : [];
    if (!komponenMentah.length) return { ok: false, tanya: 'Bahan-bahannya apa saja, dan berapa banyak?' };
    if (komponenMentah.length > 40) return { ok: false, tanya: 'Bahannya kebanyakan untuk satu resep (maks 40).' };

    const ref = await ctx.baca('/api/admin/manufacturing/bootstrap');
    if (!ref.ok) return ref;
    const daftar = ref.data.products ?? [];
    const opsi = { label: 'barang', namaDari: (p) => p.name };

    const hasil = cocokkanSatu(t.resep_hasil, daftar, opsi);
    if (!hasil.ok) return hasil;
    const qtyHasil = teks(t?.resep_hasil_qty, 20)
      ? jumlahBulat(t.resep_hasil_qty, `Jumlah hasil ${hasil.nilai.name}`)
      : { ok: false, tanya: `Satu kali produksi menghasilkan berapa ${hasil.nilai.unitSymbol || ''} ${hasil.nilai.name}?`.replace(/\s+/g, ' ') };
    if (!qtyHasil.ok) return qtyHasil;

    const komponen = [];
    for (const mentah of komponenMentah) {
      const cocok = cocokkanSatu(mentah?.barang, daftar, { ...opsi, label: 'bahan' });
      if (!cocok.ok) return cocok;
      if (cocok.nilai.id === hasil.nilai.id) return { ok: false, tanya: `"${hasil.nilai.name}" tidak bisa jadi bahannya sendiri.` };
      if (komponen.some((k) => k.barang.id === cocok.nilai.id)) {
        return { ok: false, tanya: `"${cocok.nilai.name}" disebut dua kali. Totalnya berapa?` };
      }
      const qty = jumlahBulat(mentah?.qty, `Jumlah ${cocok.nilai.name}`);
      if (!qty.ok) return qty;
      komponen.push({ barang: cocok.nilai, qty: qty.nilai });
    }

    const varian = teks(t?.resep_varian, 40);
    const semuaResep = await ctx.baca('/api/admin/manufacturing/recipes');
    if (!semuaResep.ok) return semuaResep;
    const diganti = (semuaResep.data.recipes ?? []).find((r) =>
      Number(r.output_product_id) === hasil.nilai.id && String(r.variant_label ?? '') === varian && r.status === 'ACTIVE');

    const satuan = (b) => b.unitSymbol || b.unitName || '';
    return {
      ok: true,
      draft: {
        aksi: 'buat_resep',
        judul: 'Una mau membuat resep ini — dicek dulu ya:',
        baris: [
          ['Hasil', `${qtyHasil.nilai} ${satuan(hasil.nilai)} ${hasil.nilai.name}`.replace(/\s+/g, ' ')],
          ...(varian ? [['Varian', varian]] : [])
        ],
        tabel: {
          kolom: ['Bahan', 'Jumlah'],
          isi: komponen.map((k) => [k.barang.name, `${k.qty} ${satuan(k.barang)}`.trim()])
        },
        dampak: [
          diganti
            ? `Resep aktif ${hasil.nilai.name}${varian ? ` varian ${varian}` : ''} (revisi ${diganti.revision}) diarsipkan dan diganti yang ini.`
            : `Resep pertama untuk ${hasil.nilai.name}${varian ? ` varian ${varian}` : ''}.`,
          'Jumlah bahan memakai satuan dasar masing-masing barang, seperti tertulis di tabel.',
          'Belum ada produksi yang dicatat — resep cuma takaran.'
        ],
        muatan: {
          outputProductId: hasil.nilai.id,
          outputQuantity: qtyHasil.nilai,
          variantLabel: varian,
          components: komponen.map((k) => ({ productId: k.barang.id, quantity: k.qty }))
        }
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/admin/manufacturing/recipes', draft.muatan);
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: 'Sudah Una buat resepnya.' };
  }
});

// --- jurnal (buku entity atau buku gerai) ---------------------------------

const SISI = Object.freeze({ debit: 'DEBIT', kredit: 'CREDIT' });

// Buku mana yang dipakai ditentukan lingkup panel, bukan kalimat: "semua
// gerai" = buku entity, satu gerai = buku gerai itu. Endpoint keduanya sama
// dengan yang dipakai layar Buku Entity dan layar Akuntansi gerai.
const BUKU_JURNAL = Object.freeze({
  entity: { akun: '/api/entity-admin/accounts', jurnal: '/api/entity-admin/journals', nama: 'buku entity' },
  gerai: { akun: '/api/admin/accounting/accounts', jurnal: '/api/admin/accounting/journals', nama: 'buku gerai' }
});

const jurnal = Object.freeze({
  nama: 'buat_jurnal',
  lingkup: 'semua',
  petunjuk: 'membuat jurnal umum (manual) di buku yang sedang dibuka, mis. "jurnal setoran modal 5jt: debit Kas, kredit Modal Pemilik".',
  skema: {
    jurnal_keterangan: { type: 'string', description: 'buat_jurnal: keterangan jurnal.' },
    jurnal_tanggal: { type: 'string', description: 'buat_jurnal: YYYY-MM-DD, hanya kalau penanya menyebut tanggal tertentu.' },
    jurnal_baris: {
      type: 'array',
      description: 'buat_jurnal: baris-baris jurnal, sesuai urutan yang diucapkan.',
      items: {
        type: 'object',
        required: ['akun', 'sisi', 'nominal'],
        properties: {
          akun: { type: 'string', description: 'Nama atau kode akun PERSIS seperti diucapkan.' },
          sisi: { type: 'string', enum: ['debit', 'kredit'] },
          nominal: { type: 'string', description: 'Nominal PERSIS seperti diucapkan, mis. "5jt". Jangan dihitung sendiri.' }
        }
      }
    }
  },

  async siapkan(t, ctx) {
    const keterangan = teks(t?.jurnal_keterangan, 300);
    if (!keterangan) return { ok: false, tanya: 'Jurnalnya untuk apa? Tulis keterangannya ya.' };
    const barisMentah = Array.isArray(t?.jurnal_baris) ? t.jurnal_baris : [];
    if (barisMentah.length < 2) return { ok: false, tanya: 'Jurnal butuh minimal dua baris: akun yang di-debit dan yang di-kredit, beserta nominalnya.' };
    if (barisMentah.length > 30) return { ok: false, tanya: 'Barisnya kebanyakan untuk dibuat lewat chat (maks 30).' };

    const tanggalHasil = tanggalDari(t?.jurnal_tanggal, ctx.hariIni);
    if (!tanggalHasil.ok) return tanggalHasil;
    const tanggal = tanggalHasil.nilai;

    const buku = ctx.lingkup === 'entity' ? 'entity' : 'gerai';
    const ref = await ctx.baca(BUKU_JURNAL[buku].akun);
    if (!ref.ok) return ref;
    // Akun Penyesuaian milik sistem tidak boleh dipilih lewat chat: toleransinya
    // bukan karpet untuk menyembunyikan selisih (invariant #3).
    const akunAktif = (ref.data.accounts ?? []).filter((a) => a.isActive && !a.isSystemManaged);

    const baris = [];
    let debit = 0;
    let kredit = 0;
    for (const [i, mentah] of barisMentah.entries()) {
      const sisi = SISI[String(mentah?.sisi ?? '').toLowerCase()];
      if (!sisi) return { ok: false, tanya: `Baris ${i + 1} itu debit atau kredit?` };
      const akun = cocokkanSatu(mentah?.akun, akunAktif, {
        label: 'akun', namaDari: (a) => a.accountName, kunciLain: (a) => [a.accountCode]
      });
      if (!akun.ok) return akun;
      const nominal = rupiahDari(mentah?.nominal, `Nominal ${akun.nilai.accountName}`);
      if (!nominal.ok) return nominal;
      if (sisi === 'DEBIT') debit += nominal.nilai; else kredit += nominal.nilai;
      baris.push({ akun: akun.nilai, sisi, nominal: nominal.nilai });
    }

    // Invariant #3: balance exact, tanpa toleransi apa pun. Selisih ditanyakan,
    // bukan ditambal ke akun penyesuaian.
    if (debit !== kredit) {
      return { ok: false, tanya: `Debit ${rupiah(debit)} dan kredit ${rupiah(kredit)} belum sama (selisih ${rupiah(Math.abs(debit - kredit))}). Yang mana yang perlu dibetulkan?` };
    }

    const referensi = ctx.referensi && REFERENSI.test(ctx.referensi) ? ctx.referensi : `caca_${crypto.randomUUID()}`;
    return {
      ok: true,
      draft: {
        aksi: 'buat_jurnal',
        buku,
        judul: `Una mau memposting jurnal ini ke ${BUKU_JURNAL[buku].nama} — dicek dulu ya:`,
        baris: [['Keterangan', keterangan], ['Tanggal', tanggal], ['Total', rupiah(debit)]],
        tabel: {
          kolom: ['Akun', 'Debit', 'Kredit'],
          isi: baris.map((b) => [
            `${b.akun.accountCode} ${b.akun.accountName}`.trim(),
            b.sisi === 'DEBIT' ? rupiah(b.nominal) : '',
            b.sisi === 'CREDIT' ? rupiah(b.nominal) : ''
          ])
        },
        dampak: [
          buku === 'entity'
            ? `Masuk buku entity ${ctx.namaLingkup}, bukan buku satu gerai.`
            : `Masuk buku gerai ${ctx.namaLingkup} saja, bukan buku entity.`,
          'Jurnal yang sudah diposting tidak bisa diedit — koreksinya lewat jurnal balik.'
        ],
        muatan: {
          businessDate: tanggal,
          description: keterangan,
          // Satu referensi per draft: tombol "Ya" yang tertekan dua kali, atau
          // koneksi putus lalu diulang, tidak menghasilkan jurnal kembar.
          sourceReferenceId: referensi,
          journalLines: baris.map((b) => ({ accountId: b.akun.accountId, side: b.sisi, amountMinor: b.nominal }))
        }
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', BUKU_JURNAL[draft.buku === 'entity' ? 'entity' : 'gerai'].jurnal, draft.muatan);
    if (!hasil.ok) return hasil;
    const nomor = hasil.data?.journal?.journalNumber || hasil.data?.journal?.journal_number;
    return {
      ok: true,
      jawaban: hasil.data?.duplicate
        ? `Jurnal ini sudah pernah diposting${nomor ? ` (${nomor})` : ''}, tidak Una posting dua kali.`
        : `Sudah Una posting jurnalnya${nomor ? `: ${nomor}` : ''}.`
    };
  }
});

export const AKSI_TULIS = Object.freeze([barang, resep, jurnal, ...AKSI_BAYAR]);

export function cariAksi(nama) {
  return AKSI_TULIS.find((aksi) => aksi.nama === nama) ?? null;
}

export const SKEMA_AKSI = Object.freeze(Object.assign({}, ...AKSI_TULIS.map((aksi) => aksi.skema)));

export function bolehDiLingkup(aksi, lingkup) {
  return aksi.lingkup === 'semua' || aksi.lingkup === lingkup;
}

export function daftarAksiUntukModel(lingkup) {
  return AKSI_TULIS
    .filter((aksi) => aksi.lingkup === lingkup)
    .map((aksi) => `- ${aksi.nama}: ${aksi.petunjuk}`)
    .join('\n');
}

/**
 * Menyusun ulang draft dari tangkapan yang dibawa draft itu sendiri, lalu
 * memastikan hasilnya sama persis dengan yang tadi ditampilkan.
 */
export async function periksaUlangDraft(draft, ctx) {
  const aksi = cariAksi(draft?.aksi);
  if (!aksi) return { ok: false, status: 400, error: 'Jenis draft ini tidak dikenal.' };
  const disusun = await aksi.siapkan(draft.tangkapan, { ...ctx, referensi: draft?.muatan?.sourceReferenceId });
  if (!disusun.ok) return { ok: false, status: 409, error: disusun.tanya || disusun.error };
  const { tangkapan: _abaikan, ...dilihat } = draft;
  if (JSON.stringify(disusun.draft) !== JSON.stringify(dilihat)) {
    return { ok: false, status: 409, error: 'Datanya berubah sejak draft ini dibuat. Minta Una menyusun ulang ya.' };
  }
  return { ok: true, aksi, draft: disusun.draft };
}

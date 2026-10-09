// Alat Una untuk master kecil gerai: supplier dan kategori barang (uji karyawan Bos Cyo
// 2026-10-11: "bagaimana cara mendaftarkan suplier baru", "cara menentukan kategori
// barang baru"). Panduannya di kamus (src/caca-jelaskan.js); alat ini MENGERJAKANNYA
// lewat endpoint yang sama dengan layar Barang → Supplier / Kategori, draft + "Ya".

import { normalkan, teks } from './caca-aksi-dasar.js';

const BATAS = String.raw`(?=\s*(?:[,;\n]|\b(?:hp|no\.?|nomor|wa|whatsapp|telp|telepon|alamat\w*|catatan\w*|ket\w*)\b|$))`;

/** Isian berlabel supplier dari kalimat Bos. */
export function uraiPesanSupplier(pesan) {
  const t = String(pesan ?? '').replace(/\s+/g, ' ').trim();
  const hasil = {};
  const nama = t.match(new RegExp(String.raw`\b(?:supplier|suplier|pemasok|vendor)\s*(?:baru)?\s*(?:nama(?:nya)?|bernama|:)?\s*["']?([A-Za-z0-9][\w .&'-]{1,80}?)["']?` + BATAS, 'i'));
  if (nama && !/^(baru|nya|ke|di|dari|untuk)$/i.test(nama[1].trim())) hasil.sp_nama = nama[1].trim();
  const hp = t.match(/\b(?:no\.?\s*hp|nomor\s*hp|hp|no\.?\s*wa|wa|whatsapp|telp|telepon)(?:nya)?\s*(?::|=)?\s*(\+?\d[\d\s-]{6,16}\d)/i);
  if (hp) hasil.sp_hp = hp[1].replace(/[\s-]/g, '');
  const alamat = t.match(/\balamat(?:nya)?\s*(?::|=|di)?\s*([^,;]{3,150})/i);
  if (alamat) hasil.sp_alamat = alamat[1].trim();
  return hasil;
}

const buatSupplier = Object.freeze({
  nama: 'buat_supplier',
  lingkup: 'gerai',
  petunjuk: 'MENDAFTARKAN supplier/pemasok baru di gerai ini, mis. "tambah supplier Toko Makmur hp 0812..., alamat Pasar Baru". Supplier dipilih kasir saat Beli Bahan.',
  skema: {
    sp_nama: { type: 'string', description: 'buat_supplier: nama supplier PERSIS.' },
    sp_hp: { type: 'string', description: 'buat_supplier: nomor HP kalau disebut.' },
    sp_alamat: { type: 'string', description: 'buat_supplier: alamat kalau disebut.' }
  },

  isiDariPesan(t, pesan) {
    return { ...t, ...uraiPesanSupplier(pesan) };
  },

  async siapkan(t, ctx) {
    const nama = teks(t?.sp_nama, 100).replace(/[.!?]+$/, '');
    if (!nama) return { ok: false, kurang: 'sp_nama', tanya: 'Siap. Nama supplier-nya apa? Kalau ada, sebut juga No. HP dan alamatnya.' };
    const ref = await ctx.baca('/api/admin/suppliers');
    if (!ref.ok) return ref;
    const kembar = (ref.data?.suppliers ?? []).find((s) => normalkan(s.name) === normalkan(nama));
    if (kembar) return { ok: false, tanya: `Supplier "${kembar.name}" sudah ada di ${ctx.namaLingkup || 'gerai ini'}${kembar.isActive === false ? ' (nonaktif — aktifkan lagi di Barang → Supplier)' : ''}.` };
    const muatan = { name: nama, phone: teks(t?.sp_hp, 40).replace(/[^\d+]/g, ''), address: teks(t?.sp_alamat, 180) };
    return {
      ok: true,
      draft: {
        aksi: 'buat_supplier',
        judul: 'Una mau mendaftarkan supplier baru — dicek dulu ya:',
        baris: [['Nama', nama], ...(muatan.phone ? [['No. HP', muatan.phone]] : []), ...(muatan.address ? [['Alamat', muatan.address]] : [])],
        dampak: [`Supplier ini muncul di pilihan "Supplier" saat kasir ${ctx.namaLingkup ? `di ${ctx.namaLingkup} ` : ''}mencatat Beli Bahan.`],
        muatan
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/admin/suppliers', { ...draft.muatan, notes: '' });
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Beres, supplier ${draft.muatan.name} sudah terdaftar. Kasir sudah bisa memilihnya saat Beli Bahan.` };
  }
});

const buatKategori = Object.freeze({
  nama: 'buat_kategori',
  lingkup: 'gerai',
  petunjuk: 'MEMBUAT kategori barang baru di gerai ini (pengelompokan di menu kasir), mis. "bikin kategori Minuman Dingin". Memindah barang ke kategori = ubah_barang.',
  skema: {
    kat_nama: { type: 'string', description: 'buat_kategori: nama kategori PERSIS.' }
  },

  isiDariPesan(t, pesan) {
    const m = String(pesan ?? '').match(/\bkategori\s*(?:baru)?\s*(?:nama(?:nya)?|bernama|:)?\s*["']?([A-Za-z0-9][\w .&'/-]{1,58}?)["']?\s*(?:[,.;\n]|$)/i);
    return m && !/^(baru|nya|barang)$/i.test(m[1].trim()) ? { ...t, kat_nama: m[1].trim() } : t;
  },

  async siapkan(t, ctx) {
    const nama = teks(t?.kat_nama, 60).replace(/[.!?]+$/, '');
    if (!nama) return { ok: false, kurang: 'kat_nama', tanya: 'Nama kategorinya apa? Mis. "Minuman Dingin".' };
    // Nama kembar ditolak server saat "Ya" (409 "Kategori sudah ada"); tidak perlu membaca daftar.
    return {
      ok: true,
      draft: {
        aksi: 'buat_kategori',
        judul: 'Una mau membuat kategori baru — dicek dulu ya:',
        baris: [['Nama kategori', nama]],
        dampak: ['Kategori muncul di pilihan Kategori saat menambah/mengubah barang. Belum ada barang yang pindah — bilang "pindahin … ke kategori ini" kalau mau.'],
        muatan: { name: nama }
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/admin/categories', { name: draft.muatan.name });
    if (!hasil.ok && hasil.status === 409) return { ok: false, status: 409, error: `Kategori ${draft.muatan.name} ternyata sudah ada — tinggal dipakai saat menambah/memindah barang.` };
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Beres, kategori ${draft.muatan.name} sudah dibuat.` };
  }
});

export const AKSI_MASTER = Object.freeze([buatSupplier, buatKategori]);

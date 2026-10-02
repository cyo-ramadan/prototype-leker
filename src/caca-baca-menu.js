// Foto papan menu / daftar harga → daftar barang (UNA-PENDAMPING.md, ketakutan #2
// "ngisi daftar barang panjang banget").
//
// Pembagian kerjanya sama dengan pembaca lembar rekap: model hanya MENYALIN
// apa yang tertulis (nama, harga apa adanya, judul kelompok). Kode yang
// mengurai harga, menafsirkan harga singkat ("15" = 15.000, hanya kalau semua
// harga ditulis begitu, dan itu ditulis terang di draft), memasang satuan dan
// kategori bawaan, lalu menyusun draft isi-barang-massal yang sama persis
// dengan jalur ketik (caca-aksi-barang.js). Tidak ada yang tersimpan sebelum
// pemilik menekan "Ya".

export const MENU_SCHEMA = Object.freeze({
  type: 'object',
  required: ['barang'],
  properties: {
    barang: {
      type: 'array',
      description: 'Semua item menu/harga di foto, urut dari atas ke bawah.',
      items: {
        type: 'object',
        required: ['nama'],
        properties: {
          nama: { type: 'string', description: 'Nama item PERSIS seperti tertulis.' },
          harga: { type: 'string', description: 'Harga PERSIS seperti tertulis, mis. "15K", "15.000", "15". Kosongkan kalau tidak terbaca.' },
          kategori: { type: 'string', description: 'Judul kelompok tempat item ini berada (mis. "MINUMAN"), kalau ada.' }
        }
      }
    },
    bukan_menu: { type: 'boolean', description: 'true kalau foto ini jelas bukan daftar menu/harga.' }
  }
});

export const MENU_SYSTEM_PROMPT = [
  'Kamu menyalin daftar menu atau daftar harga dari foto (papan menu, buku menu, kertas harga, tangkapan layar).',
  'Aturan:',
  '- Salin tiap item: nama dan harganya PERSIS seperti tertulis. Jangan membetulkan ejaan, jangan menerjemahkan.',
  '- Harga ditulis apa adanya ("15K", "15.000", "15", "Rp 15.000"). Jangan dikali, jangan dibulatkan, jangan ditebak.',
  '  Harga yang tidak terbaca dikosongkan.',
  '- Kalau ada judul kelompok (MINUMAN, MAKANAN, COFFEE, NON-COFFEE, dst.), isi kategori item di bawahnya dengan judul itu.',
  '- Kalau satu item punya beberapa ukuran/varian dengan harga berbeda (mis. Reg 10 / Large 13), tulis sebagai item',
  '  terpisah: "Nama (Reg)" dan "Nama (Large)".',
  '- Jangan menambah item yang tidak ada di foto. Abaikan alamat, nomor telepon, promo, dan tulisan dekorasi.',
  '- Kalau fotonya jelas bukan daftar menu/harga, isi bukan_menu = true dan barang kosong.'
].join('\n');

// Papan menu sering ditulis huruf besar semua ("ES TEH MANIS"); di layar kasir
// itu terlihat berteriak. Hanya tulisan yang SELURUHNYA kapital yang dirapikan,
// dan hasilnya terlihat di tabel draft sebelum disimpan.
function rapikanKapital(teks) {
  const bersih = String(teks ?? '').trim().replace(/\s+/g, ' ');
  if (!/[A-Z]/.test(bersih) || bersih !== bersih.toUpperCase()) return bersih;
  return bersih.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, awal, huruf) => `${awal}${huruf.toUpperCase()}`);
}

/** Hasil baca model → tangkapan alat buat_barang_banyak. */
export function tangkapanDariMenu(hasil) {
  const barang = Array.isArray(hasil?.barang) ? hasil.barang : [];
  return {
    daftar_barang: barang.map((b) => ({
      nama: rapikanKapital(b?.nama),
      harga_jual: String(b?.harga ?? '').trim(),
      harga_beli: '',
      kategori: rapikanKapital(b?.kategori),
      satuan: ''
    })).filter((b) => b.nama),
    daftar_kategori: '',
    daftar_jenis: 'jualan'
  };
}

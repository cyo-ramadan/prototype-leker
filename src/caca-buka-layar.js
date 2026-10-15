import { buatAksiBuka } from './una-kemampuan.js';
// Navigasi baca saja, dari menu yang sama dengan panduan; tidak membuat draft.
import { menuUntuk, peringkatMenu, aliasMenu } from './caca-peta.js';
const normal = s => String(s ?? '').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N} -]/gu, ' ').replace(/\s+/g, ' ').trim();
export function permintaanBuka(teks, namaAsisten = 'Una') {
  let pesan = normal(teks);
  const nama = normal(namaAsisten);
  for (const panggil of new Set([nama, 'una', 'maimunah'])) if (pesan.startsWith(panggil + ' ')) { pesan = pesan.slice(panggil.length + 1); break; }
  pesan = pesan.replace(/^(tolong|coba|mohon)\s+/, '');
  // Perintah majemuk tetap ke alur agen, bukan diam-diam membuang bagian tulisnya.
  if (/\b(lalu|kemudian|terus|setelah|habis itu|sekaligus|serta)\b|\bdan\s+(tambah|buat|hapus|ubah|catat|bayar|simpan|nonaktif)/.test(pesan)) return null;
  const cocok = /^(?:buka(?:kan|in)?|ke\s+halaman|pindah(?:kan)?\s+ke|masuk\s+ke)\s+(?:(?:halaman|layar|menu|tab)\s+)?(.+)$/.exec(pesan);
  if (cocok && /\S+\s+(?:tambah(?:kan|in)?|buat(?:kan|in)?|hapus(?:kan|in)?|ubah(?:kan|in)?|catat(?:kan|in)?|bayar(?:kan|in)?|simpan(?:kan|in)?|nonaktif(?:kan|in)?|ganti(?:kan|in)?)\b/.test(cocok[1])) return null;
  return cocok ? cocok[1].replace(/\s+(ya|dong|bos|sekarang)$/, '').trim() : null;
}
export function bukaLayarDariPesan(teks, konteks = {}) {
  const cari = permintaanBuka(teks, konteks.namaAsisten);
  if (cari === null) return null;
  const peran = konteks.peran === 'Entity Admin' ? 'ENTITY_ADMIN' : String(konteks.peran ?? '').toUpperCase();
  const opsi = { skin: konteks.skin || 'classic', peran, halaman: konteks.lingkup === 'entity' ? 'entity' : 'gerai' };
  const semua = menuUntuk(opsi);
  let cocok = semua.filter(m => normal(m.label) === cari || normal(m.tab) === cari || aliasMenu(m).some(alias => normal(alias) === cari));
  if(cari==='laporan'&&opsi.halaman==='entity'){const laporan=semua.find(m=>m.halaman==='entity'&&m.tab==='reports');if(laporan)cocok=[laporan];}
  if (!cocok.length) {
    const peringkat = peringkatMenu(cari, opsi);
    const terbaik = peringkat[0]?.skor || 0;
    cocok = peringkat.filter(p => p.skor === terbaik && p.skor >= 2).map(p => p.menu);
  }
  // Label yang sama pada dua halaman memilih lingkup aktif, tanpa mengubah hak akses.
  if (cocok.some(m => m.halaman === opsi.halaman)) cocok = cocok.filter(m => m.halaman === opsi.halaman);
  const unik = [...new Map(cocok.map(m => [m.halaman + ':' + m.tab, m])).values()];
  if (unik.length === 1) {
    const m = unik[0];
    return { ok: true, alat: 'buka_layar', jawaban: `Ini layar ${m.label}, Bos.`, navigasi: { halaman: m.halaman, tab: m.tab, label: m.label, skin: m.skin }, uiActions: buatAksiBuka(m, konteks), perluKonfirmasi: false };
  }
  if (unik.length > 1) return { ok: true, alat: 'buka_layar', jawaban: 'Bos mau membuka layar yang mana?', tawaran: unik.slice(0,6).map(m => ({ jenis: 'buka', layar: m.tab, halaman: m.halaman, label: m.label })), perluKonfirmasi: false };
  return { ok: true, alat: 'buka_layar', jawaban: `Una belum nemu layar ${cari.slice(0,100)} yang tersedia untuk akses dan tampilan Bos.`, menuTidakDitemukan: true, perluKonfirmasi: false };
}

// Isian angka kasir (Bos Cyo, 2026-10-04): "cs kadang menganggap titik adalah koma,
// ada juga yang menganggap koma adalah titik. Aturan entri: tidak boleh mengetik titik.
// Koma masih boleh. Titik akan keluar sendiri otomatis dari program."
//
// Aturannya satu dan sama di semua isian yang memakai helper ini:
//   - Titik TIDAK bisa diketik. Titik yang terlihat selalu pemisah ribuan buatan program.
//   - Koma = desimal, dan hanya di isian yang memang boleh pecahan (harga per satuan).
//     Qty dan total rupiah hanya bilangan bulat: koma pun ditolak di sana.
//   - Teks tempelan yang membawa titik dibaca sebagai pemisah ribuan ("1.500" = 1500),
//     sama dengan arti titik yang dilihat kasir di layar.
// Contoh salah baca yang dicegah: "1.500" dibaca 1,5 (HPP jadi seperseribu), atau qty
// "1.000" gram dibaca 1 gram.
//
// Dipakai PIMASATU (Beli Bahan, Penjualan, Operasional). Fungsi murninya juga dipakai tes.
(function (root) {
  const MAKS_DESIMAL = 6;

  function kelompokRibuan(digit) {
    const bersih = digit.replace(/^0+(?=\d)/, '');
    return bersih.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** Teks isian -> teks rapi: hanya digit (+ satu koma bila desimal), ribuan bertitik. */
  function rapikan(teks, { desimal = false } = {}) {
    let isi = String(teks ?? '').replace(/[^\d,]/g, '');
    if (!desimal) isi = isi.replace(/,/g, '');
    const koma = isi.indexOf(',');
    if (koma === -1) return isi ? kelompokRibuan(isi) : '';
    const bulat = isi.slice(0, koma).replace(/,/g, '');
    const pecahan = isi.slice(koma + 1).replace(/,/g, '').slice(0, MAKS_DESIMAL);
    return `${bulat ? kelompokRibuan(bulat) : '0'},${pecahan}`;
  }

  /** Teks isian (rapi atau tidak) -> angka. Titik = ribuan, koma = desimal. Kosong -> NaN. */
  function nilai(teks) {
    const isi = String(teks ?? '').trim().replace(/\./g, '').replace(/\s+/g, '');
    if (!isi || !/^\d*(,\d*)?$/.test(isi) || isi === ',') return NaN;
    return Number(isi.replace(',', '.'));
  }

  /** Angka -> teks tampilan isian (titik ribuan, koma desimal, tanpa nol di ujung pecahan). */
  function tampil(angka, { desimal = false } = {}) {
    const n = Number(angka);
    if (!Number.isFinite(n) || n < 0) return '';
    const teks = desimal ? n.toFixed(MAKS_DESIMAL).replace(/\.?0+$/, '') : String(Math.round(n));
    return rapikan(teks.replace('.', ','), { desimal });
  }

  function hitungBermakna(teks, sampai) {
    let n = 0;
    for (let i = 0; i < sampai && i < teks.length; i += 1) if (/[\d,]/.test(teks[i])) n += 1;
    return n;
  }

  function posisiSetelah(teks, bermakna) {
    if (bermakna <= 0) return 0;
    let n = 0;
    for (let i = 0; i < teks.length; i += 1) {
      if (/[\d,]/.test(teks[i])) n += 1;
      if (n === bermakna) return i + 1;
    }
    return teks.length;
  }

  /**
   * Memasang aturan di satu <input>. onTitik dipanggil saat kasir mencoba mengetik titik
   * (untuk menampilkan pengingat singkat).
   */
  function pasang(input, { desimal = false, onTitik = null } = {}) {
    if (!input || input.dataset.angkaTerpasang === '1') return input;
    input.dataset.angkaTerpasang = '1';
    input.type = 'text';
    input.inputMode = desimal ? 'decimal' : 'numeric';
    input.autocomplete = 'off';
    input.dataset.angka = desimal ? 'desimal' : 'bulat';
    const ingatkan = (pesan) => { if (typeof onTitik === 'function') onTitik(pesan); };
    input.addEventListener('beforeinput', (event) => {
      const data = event.data ?? '';
      if (event.inputType === 'insertFromPaste') return; // tempelan dirapikan di 'input'
      if (data.includes('.')) {
        event.preventDefault();
        ingatkan(desimal ? 'Titik tidak perlu diketik — ribuan otomatis. Untuk pecahan pakai koma.' : 'Titik tidak perlu diketik — ribuan otomatis.');
      } else if (!desimal && data.includes(',')) {
        event.preventDefault();
        ingatkan('Isian ini hanya angka bulat.');
      }
    });
    input.addEventListener('input', () => {
      const sebelum = input.value;
      const caret = input.selectionStart ?? sebelum.length;
      const bermakna = hitungBermakna(sebelum, caret);
      const sesudah = rapikan(sebelum, { desimal });
      if (sesudah === sebelum) return;
      input.value = sesudah;
      try { const pos = posisiSetelah(sesudah, bermakna); input.setSelectionRange(pos, pos); } catch { /* input tanpa seleksi */ }
    });
    if (input.value) input.value = rapikan(input.value, { desimal });
    return input;
  }

  const api = Object.freeze({ rapikan, nilai, tampil, pasang, MAKS_DESIMAL });
  root.MAXIAngka = api;
})(typeof window !== 'undefined' ? window : globalThis);

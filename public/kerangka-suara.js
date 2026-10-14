// Kerangka suara browser bersama, tanpa ketergantungan pada aplikasi bisnis.
(function (global) {
  'use strict';
  const SATUAN = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function bilangan(nilai) {
    const n = BigInt(nilai);
    if (n < 0n) return 'minus ' + bilangan(-n);
    if (n < 12n) return SATUAN[Number(n)];
    if (n < 20n) return bilangan(n - 10n) + ' belas';
    if (n < 100n) return bilangan(n / 10n) + ' puluh' + (n % 10n ? ' ' + bilangan(n % 10n) : '');
    if (n < 200n) return 'seratus' + (n % 100n ? ' ' + bilangan(n % 100n) : '');
    if (n < 1000n) return bilangan(n / 100n) + ' ratus' + (n % 100n ? ' ' + bilangan(n % 100n) : '');
    if (n < 2000n) return 'seribu' + (n % 1000n ? ' ' + bilangan(n % 1000n) : '');
    for (const [skala, nama] of [[1000000000000000n, 'kuadriliun'], [1000000000000n, 'triliun'], [1000000000n, 'miliar'], [1000000n, 'juta'], [1000n, 'ribu']]) {
      if (n >= skala) return bilangan(n / skala) + ' ' + nama + (n % skala ? ' ' + bilangan(n % skala) : '');
    }
    return '';
  }
  function pilihSuara(daftar = []) {
    return daftar.filter(v => /^id(?:[-_]ID)?$/i.test(String(v.lang || '')))
      .map((v, i) => ({ v, i, nilai: /natural/i.test(v.name) ? 2 : /online/i.test(v.name) ? 1 : 0 }))
      .sort((a, b) => b.nilai - a.nilai || a.i - b.i)[0]?.v || null;
  }
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  function tanggal(teks, tahun, bulan, hari) {
    const y = Number(tahun), m = Number(bulan), d = Number(hari);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return teks;
    return bilangan(d) + ' ' + BULAN[m - 1] + ' ' + bilangan(y);
  }
  function bersihkanUntukDibaca(teks, { draft = null, rahasia = false } = {}) {
    if (draft) {
      const jumlah = draft.muatan?.daftar?.length || draft.tabel?.isi?.length || draft.baris?.length || 1;
      return 'Ada draft ' + jumlah + ' baris di Workspace. Periksa dulu sebelum menekan tombol Ya. Persetujuan harus lewat tombol.';
    }
    let hasil = String(teks || '');
    if (rahasia || /\b(password|kata\s*sandi|token|api[ _-]?key|bearer|otp|pin|rahasia)\b|sk-[a-zA-Z0-9_-]+|eyJ[a-zA-Z0-9_-]+\./i.test(hasil)) return 'Ada informasi pribadi di layar. Silakan periksa langsung.';
    hasil = hasil.replace(/```[\s\S]*?```/g, ' ').split(/\r?\n/)
      .filter(baris => !baris.includes('|')).join('\n')
      .replace(/<[^>]*>/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ').replace(/&(?:amp|lt|gt|quot|#39);/g, ' ')
      .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (t, y, m, d) => tanggal(t, y, m, d))
      .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (t, d, m, y) => tanggal(t, y, m, d))
      .replace(/\bRp\.?\s*(-?\d[\d.]*(?:,\d{1,6})?)/gi, (t, uang) => {
        const [bulat, pecahan] = uang.replace(/\./g, '').split(',');
        try { return bilangan(bulat) + (pecahan ? ' koma ' + [...pecahan].map(d => SATUAN[Number(d)]).join(' ') : '') + ' rupiah'; } catch { return 'nominal di layar'; }
      })
      .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f]/gu, '')
      .replace(/[*_#`~<>\[\]{}=]/g, '').replace(/\s+/g, ' ').trim();
    if (hasil.length > 600) hasil = hasil.slice(0, 555).replace(/\s+\S*$/, '') + '. Selengkapnya ada di layar.';
    return hasil;
  }
  function potongKalimat(teks, maks = 140) {
    const hasil = [];
    for (const kalimat of teks.match(/[^.!?]+[.!?]*/g) || []) {
      let sisa = kalimat.trim();
      while (sisa.length > maks) {
        let batas = sisa.lastIndexOf(' ', maks);
        if (batas < 1) batas = maks;
        hasil.push(sisa.slice(0, batas).trim()); sisa = sisa.slice(batas).trim();
      }
      if (sisa) hasil.push(sisa);
    }
    return hasil;
  }
  function pengenal() { return global.SpeechRecognition || global.webkitSpeechRecognition; }
  function dengar({ mulai = true, continuous = true, ...handlers } = {}) {
    const Pengenal = pengenal();
    if (!Pengenal) throw new Error('Pengenalan suara tidak tersedia.');
    const recognition = new Pengenal();
    recognition.lang = 'id-ID'; recognition.continuous = continuous; recognition.interimResults = true;
    for (const [key, value] of Object.entries(handlers)) if (/^on/.test(key)) recognition[key] = value;
    if (mulai) recognition.start();
    return recognition;
  }
  function buat({ key = 'kerangkaSuaraAktif', onChange = () => {}, onStatus = () => {}, bolehBicara = () => true, storage = null } = {}) {
    const synth = global.speechSynthesis;
    let aktif = false, suara = null, sesi = null;
    try { storage ||= global.localStorage; aktif = storage?.getItem(key) === 'true'; } catch { /* mode privat */ }
    function status() { return { tersedia: Boolean(suara && global.SpeechSynthesisUtterance), aktif, membaca: Boolean(sesi) }; }
    function hentikan() {
      const lama = sesi; sesi = null;
      if (lama) { global.clearTimeout(lama.timer); try { synth.cancel(); } catch { /* sudah berhenti */ } }
      onChange(status());
    }
    function segarkan() {
      try { suara = pilihSuara(synth?.getVoices() || []); } catch { suara = null; }
      if (!suara) hentikan();
      onChange(status());
    }
    function setAktif(nilai) {
      aktif = Boolean(nilai);
      try { storage?.setItem(key, String(aktif)); } catch { /* tetap berfungsi */ }
      if (!aktif) hentikan();
      onChange(status());
    }
    function ucapkan(teks, { paksa = false, ...options } = {}) {
      hentikan();
      if (!suara || !global.SpeechSynthesisUtterance || (!aktif && !paksa) || !bolehBicara()) return false;
      const bagian = potongKalimat(bersihkanUntukDibaca(teks, options));
      if (!bagian.length) return false;
      const token = { timer: null }; sesi = token;
      let index = 0;
      function lanjut() {
        if (sesi !== token) return;
        global.clearTimeout(token.timer);
        if (!bolehBicara()) { hentikan(); return; }
        if (index >= bagian.length) { sesi = null; onChange(status()); return; }
        const ucapan = new global.SpeechSynthesisUtterance(bagian[index++]);
        ucapan.lang = 'id-ID'; ucapan.voice = suara;
        ucapan.onend = () => { if (sesi === token) lanjut(); };
        ucapan.onerror = () => {
          if (sesi !== token) return;
          hentikan(); onStatus('Suara tidak dapat diputar. Jawaban tetap ada di layar.');
        };
        token.timer = global.setTimeout(() => {
          if (sesi !== token) return;
          hentikan(); onStatus('Pembacaan suara dihentikan. Selengkapnya ada di layar.');
        }, 20000);
        try { synth.speak(ucapan); } catch { hentikan(); onStatus('Suara tidak dapat diputar. Jawaban tetap ada di layar.'); }
      }
      onChange(status()); lanjut();
      return true;
    }
    synth?.addEventListener?.('voiceschanged', segarkan);
    segarkan();
    return { status, setAktif, ucapkan, hentikan, segarkan, dispose() { hentikan(); synth?.removeEventListener?.('voiceschanged', segarkan); } };
  }
  global.KerangkaSuara = Object.freeze({ pilihSuara, bersihkanUntukDibaca, potongKalimat, pengenal, dengar, buat });
})(typeof window === 'undefined' ? globalThis : window);

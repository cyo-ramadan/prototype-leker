// Pembaca file mutasi Merchant BCA (Bos Cyo, 2026-10-18). File Excel ekspor "Transaction Report by Merchant
// BCA" dikunci kata sandi (ECMA-376 Agile Encryption: AES + SHA, 100.000 putaran). Dibuka DI BROWSER dengan
// WebCrypto + DecompressionStream -- file mentah dan kata sandinya tidak pernah dikirim ke server; yang
// dikirim hanya baris transaksi hasil bacaan. Tanpa pustaka luar. Juga bisa dijalankan di Node (tes).
//
// Hasil: { rows: [{ merchantName, mid, nmid, amount, tanggal: 'YYYY-MM-DD', jam: 'HH:MM', rrn, approvalCode,
//          paymentType, payer, reversal }], tanggal: [...] }
(() => {
  const te = new TextDecoder();
  const subtle = globalThis.crypto.subtle;

  // ---- Compound File Binary (OLE) -------------------------------------------------------------
  function bacaCfb(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sektor = 1 << dv.getUint16(30, true);
    const miniSektor = 1 << dv.getUint16(32, true);
    const jumlahFatSektor = dv.getUint32(44, true);
    const dirAwal = dv.getUint32(48, true);
    const batasMini = dv.getUint32(56, true);
    const miniFatAwal = dv.getUint32(60, true);
    const difatAwal = dv.getUint32(68, true);
    const offset = s => (s + 1) * sektor;
    const fatSektor = [];
    for (let i = 0; i < 109 && fatSektor.length < jumlahFatSektor; i++) fatSektor.push(dv.getUint32(76 + i * 4, true));
    let difat = difatAwal;
    while (fatSektor.length < jumlahFatSektor && difat < 0xfffffffa) {
      const per = sektor / 4 - 1;
      for (let i = 0; i < per && fatSektor.length < jumlahFatSektor; i++) fatSektor.push(dv.getUint32(offset(difat) + i * 4, true));
      difat = dv.getUint32(offset(difat) + per * 4, true);
    }
    const fat = [];
    for (const s of fatSektor) for (let i = 0; i < sektor / 4; i++) fat.push(dv.getUint32(offset(s) + i * 4, true));
    const rantai = (awal, tabel) => { const out = []; for (let s = awal; s < 0xfffffffa && out.length < 1e6; s = tabel[s]) out.push(s); return out; };
    const gabung = (daftar, ukuran, ambil) => { const out = new Uint8Array(daftar.length * ukuran); daftar.forEach((s, i) => out.set(ambil(s), i * ukuran)); return out; };
    const ambilSektor = s => bytes.subarray(offset(s), offset(s) + sektor);
    const dir = gabung(rantai(dirAwal, fat), sektor, ambilSektor);
    const entri = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const ddv = new DataView(dir.buffer, dir.byteOffset + o, 128);
      const panjangNama = ddv.getUint16(64, true);
      let nama = '';
      for (let i = 0; i + 2 < panjangNama; i += 2) nama += String.fromCharCode(ddv.getUint16(i, true));
      entri.push({ nama, tipe: dir[o + 66], awal: ddv.getUint32(116, true), ukuran: ddv.getUint32(120, true) });
    }
    const akar = entri[0];
    const miniStream = gabung(rantai(akar.awal, fat), sektor, ambilSektor);
    const miniFat = [];
    if (miniFatAwal < 0xfffffffa) for (const s of rantai(miniFatAwal, fat)) for (let i = 0; i < sektor / 4; i++) miniFat.push(dv.getUint32(offset(s) + i * 4, true));
    return nama => {
      const e = entri.find(item => item.nama === nama && item.tipe === 2);
      if (!e) return null;
      if (e.ukuran < batasMini) {
        return gabung(rantai(e.awal, miniFat), miniSektor, s => miniStream.subarray(s * miniSektor, (s + 1) * miniSektor)).subarray(0, e.ukuran);
      }
      return gabung(rantai(e.awal, fat), sektor, ambilSektor).subarray(0, e.ukuran);
    };
  }

  // ---- Agile Encryption ------------------------------------------------------------------------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const gabungBytes = (...bagian) => { const out = new Uint8Array(bagian.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of bagian) { out.set(b, o); o += b.length; } return out; };
  const le32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const algo = nama => ({ SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' }[nama] || 'SHA-1');
  const hash = async (alg, data) => new Uint8Array(await subtle.digest(alg, data));

  // SHA-1 sinkron untuk 100.000 putaran kata sandi: menunggu WebCrypto tiap putaran makan ±6 detik,
  // hitungan langsung ini hanya puluhan milidetik. Hasilnya diuji sama dengan WebCrypto (tes).
  function sha1(pesan) {
    const panjang = pesan.length;
    const blok = new Uint8Array(((panjang + 9 + 63) >> 6) << 6);
    blok.set(pesan);
    blok[panjang] = 0x80;
    const bit = panjang * 8;
    const dv = new DataView(blok.buffer);
    dv.setUint32(blok.length - 8, Math.floor(bit / 0x100000000));
    dv.setUint32(blok.length - 4, bit >>> 0);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80);
    for (let o = 0; o < blok.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20);
    const odv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4].forEach((v, i) => odv.setUint32(i * 4, v));
    return out;
  }
  const pas = (b, n, isi) => { if (b.length >= n) return b.subarray(0, n); const out = new Uint8Array(n).fill(isi); out.set(b); return out; };

  // AES-CBC tanpa padding: WebCrypto mewajibkan PKCS#7, jadi tambahkan satu blok padding palsu yang dibuat
  // dengan mengenkripsi 16 x 0x10 memakai blok sandi terakhir sebagai IV.
  async function aesCbcTanpaPadding(kunciMentah, iv, data) {
    const kunci = await subtle.importKey('raw', kunciMentah, 'AES-CBC', false, ['encrypt', 'decrypt']);
    const ivPadding = data.length ? data.subarray(data.length - 16) : iv;
    const padding = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: ivPadding }, kunci, new Uint8Array(16).fill(16))).subarray(0, 16);
    return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, kunci, gabungBytes(data, padding)));
  }

  function atribut(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}\\b([^>]*)>`));
    if (!m) return null;
    const out = {};
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) out[a[1]] = a[2];
    return out;
  }

  async function bukaKunci(cfbAmbil, sandi) {
    const info = cfbAmbil('EncryptionInfo');
    const paket = cfbAmbil('EncryptedPackage');
    if (!info || !paket) throw new Error('Bukan file Excel terkunci yang dikenal.');
    const versi = new DataView(info.buffer, info.byteOffset).getUint16(0, true);
    if (versi !== 4) throw new Error('Jenis kunci Excel ini belum didukung (bukan Agile Encryption).');
    const xml = te.decode(info.subarray(8));
    const kd = atribut(xml, 'keyData');
    const ek = atribut(xml, 'p:encryptedKey');
    const alg = algo(ek.hashAlgorithm);
    const kunciBit = Number(ek.keyBits) / 8;
    let h = await hash(alg, gabungBytes(b64(ek.saltValue), new Uint8Array(new Uint16Array([...sandi].map(c => c.charCodeAt(0))).buffer)));
    if (alg === 'SHA-1') {
      const buf = new Uint8Array(24);
      for (let i = 0; i < Number(ek.spinCount); i++) { buf.set(le32(i), 0); buf.set(h, 4); h = sha1(buf); }
    } else {
      for (let i = 0; i < Number(ek.spinCount); i++) h = await hash(alg, gabungBytes(le32(i), h));
    }
    const turunan = async blok => pas(await hash(alg, gabungBytes(h, new Uint8Array(blok))), kunciBit, 0x36);
    const garam = b64(ek.saltValue);
    // Cek kata sandi dulu supaya salah sandi menghasilkan pesan jelas, bukan data rusak.
    const masukan = (await aesCbcTanpaPadding(await turunan([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]), garam, b64(ek.encryptedVerifierHashInput))).subarray(0, Number(ek.saltSize));
    const nilai = await aesCbcTanpaPadding(await turunan([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]), garam, b64(ek.encryptedVerifierHashValue));
    const harap = await hash(alg, masukan);
    if (!harap.every((b, i) => b === nilai[i])) throw Object.assign(new Error('Kata sandi file salah.'), { code: 'SANDI_SALAH' });
    const kunciPaket = (await aesCbcTanpaPadding(await turunan([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]), garam, b64(ek.encryptedKeyValue))).subarray(0, Number(kd.keyBits) / 8);
    const ukuran = Number(new DataView(paket.buffer, paket.byteOffset).getBigUint64(0, true));
    const sandiData = paket.subarray(8);
    const keluar = new Uint8Array(Math.ceil(sandiData.length / 16) * 16);
    const garamData = b64(kd.saltValue);
    for (let i = 0, o = 0; o < sandiData.length; i++, o += 4096) {
      const potong = sandiData.subarray(o, Math.min(o + 4096, sandiData.length));
      const iv = pas(await hash(algo(kd.hashAlgorithm), gabungBytes(garamData, le32(i))), Number(kd.blockSize), 0x36);
      keluar.set(await aesCbcTanpaPadding(kunciPaket, iv, potong.subarray(0, potong.length - (potong.length % 16))), o);
    }
    return keluar.subarray(0, ukuran);
  }

  // ---- ZIP + SpreadsheetML ---------------------------------------------------------------------
  async function inflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function bacaZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('File Excel rusak (zip tidak terbaca).');
    const jumlah = dv.getUint16(eocd + 10, true);
    let o = dv.getUint32(eocd + 16, true);
    const isi = new Map();
    for (let n = 0; n < jumlah; n++) {
      const metode = dv.getUint16(o + 10, true);
      const ukuranSandi = dv.getUint32(o + 20, true);
      const panjangNama = dv.getUint16(o + 28, true);
      const panjangEkstra = dv.getUint16(o + 30, true);
      const panjangKomentar = dv.getUint16(o + 32, true);
      const lokal = dv.getUint32(o + 42, true);
      const nama = te.decode(bytes.subarray(o + 46, o + 46 + panjangNama));
      const awalData = lokal + 30 + dv.getUint16(lokal + 26, true) + dv.getUint16(lokal + 28, true);
      isi.set(nama, { metode, data: bytes.subarray(awalData, awalData + ukuranSandi) });
      o += 46 + panjangNama + panjangEkstra + panjangKomentar;
    }
    return async nama => {
      const e = isi.get(nama);
      if (!e) return null;
      return te.decode(e.metode === 0 ? e.data : await inflate(e.data));
    };
  }

  const xmlTeks = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const kolomKe = ref => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

  async function bacaLembar(ambil) {
    const bersama = [];
    const ss = await ambil('xl/sharedStrings.xml');
    if (ss) for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) bersama.push(xmlTeks([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
    const lembar = [];
    for (let i = 1; i <= 200; i++) {
      const xml = await ambil(`xl/worksheets/sheet${i}.xml`);
      if (!xml) break;
      const baris = [];
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const sel = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ref = (c[1].match(/r="([A-Z]+\d+)"/) || [])[1];
          const t = (c[1].match(/t="(\w+)"/) || [])[1];
          const v = ((c[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          const inline = ((c[2] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1];
          const nilai = t === 's' ? bersama[Number(v)] : t === 'inlineStr' ? xmlTeks(inline || '') : xmlTeks(v || '');
          if (ref) sel[kolomKe(ref)] = nilai ?? '';
        }
        baris.push(sel);
      }
      lembar.push(baris);
    }
    return lembar;
  }

  // ---- Baris transaksi Merchant BCA --------------------------------------------------------------
  const KOLOM = {
    merchantName: 'Merchant Name', mid: 'Merchant ID', nmid: 'National Merchant ID', amount: 'Original Amount',
    tanggal: 'Transaction Date', jam: 'Transaction Time', approvalCode: 'Approval Code', rrn: 'Reference Number',
    payer: 'Payer Name', paymentType: 'Payment Type', reversal: 'Reversal'
  };

  function ambilTransaksi(lembar) {
    const rows = [];
    for (const baris of lembar) {
      const kepala = baris.findIndex(sel => (sel || []).includes('Merchant ID') && (sel || []).includes('Reference Number'));
      if (kepala < 0) continue;
      const idx = Object.fromEntries(Object.entries(KOLOM).map(([k, label]) => [k, baris[kepala].indexOf(label)]));
      for (let i = kepala + 1; i < baris.length; i++) {
        const sel = baris[i] || [];
        const mid = String(sel[idx.mid] ?? '').trim();
        if (!/^\d{6,}$/.test(mid)) { if (rows.length && !mid) continue; else continue; }
        const tgl = String(sel[idx.tanggal] ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        const jam = String(sel[idx.jam] ?? '').trim().match(/^(\d{1,2})[:.](\d{2})/);
        const amount = Math.round(Number(String(sel[idx.amount] ?? '').replace(/,/g, '')));
        if (!tgl || !jam || !Number.isFinite(amount)) continue;
        rows.push({
          merchantName: String(sel[idx.merchantName] ?? '').trim(),
          mid,
          nmid: String(sel[idx.nmid] ?? '').trim(),
          amount,
          tanggal: `${tgl[3]}-${tgl[2].padStart(2, '0')}-${tgl[1].padStart(2, '0')}`,
          jam: `${jam[1].padStart(2, '0')}:${jam[2]}`,
          rrn: String(sel[idx.rrn] ?? '').trim(),
          approvalCode: String(sel[idx.approvalCode] ?? '').trim(),
          paymentType: String(sel[idx.paymentType] ?? '').trim(),
          payer: String(sel[idx.payer] ?? '').trim(),
          reversal: String(sel[idx.reversal] ?? '').trim()
        });
      }
    }
    return rows;
  }

  async function baca(arrayBuffer, sandi = '') {
    let bytes = new Uint8Array(arrayBuffer);
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
      if (!sandi) throw Object.assign(new Error('File ini dikunci. Isi kata sandi file dari BCA.'), { code: 'SANDI_PERLU' });
      bytes = await bukaKunci(bacaCfb(bytes), sandi);
    }
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('Bukan file Excel (.xlsx).');
    const rows = ambilTransaksi(await bacaLembar(await bacaZip(bytes)));
    if (!rows.length) throw new Error('Tidak ada baris transaksi Merchant BCA di file ini.');
    return { rows, tanggal: [...new Set(rows.map(row => row.tanggal))].sort() };
  }

  globalThis.BcaMutasi = { baca, _uji: { sha1 } };
})();

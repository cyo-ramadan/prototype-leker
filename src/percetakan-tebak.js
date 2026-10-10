// Pembaca chat order percetakan BERBASIS ATURAN (tanpa AI) -- ADR-055 D7.
//
// Bos Cyo, 2026-10-10: "yang paling penting ini otomatisasi task nya ... dari chat customer
// tersebut, sistem bisa nyimpulin ini orderannya apa dan bikin task ke karyawan tukang nyetak
// atau langsung ke printer."
//
// Kenapa aturan dulu, bukan Una: jalan di setiap pesan WA masuk, jadi harus gratis, cepat, dan
// hasilnya bisa diuji pasti. Prinsipnya sama dengan Una: hanya kalau SEMUA jelas (produk dikenal,
// ukuran ada untuk produk per meter, file pasti milik item yang mana, tidak ada koreksi) hasilnya
// dianggap lengkap dan boleh langsung jadi order. Sedikit saja ragu -> pertanyaan -> draft untuk
// orang (atau Una). Lebih baik satu chat jatuh ke draft daripada satu order salah cetak.
//
// Diuji dengan una-latih/percetakan-chat-contoh.json.

const ANGKA_KATA = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10 };
const ANGKA = `(\\d+|${Object.keys(ANGKA_KATA).join('|')})`;
const SATUAN_JUMLAH = '(?:lembar|lmbr|lbr|lb|pcs|pc|buah|bh|biji|box|eks|exp|rim|set|aja|saja)';
const RE_JUMLAH = new RegExp(`(?:^|[^a-z0-9])${ANGKA}\\s*${SATUAN_JUMLAH}(?![a-z])`);
const RE_UKURAN = /(\d+(?:[.,]\d+)?)\s*(?:(cm|mtr|meter|m)(?![a-z]))?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(?:(cm|mtr|meter|m)(?![a-z]))?/;
const RE_KOREKSI = /(?:^|[^a-z])(ganti|ralat|revisi|salah|batal|batalin|ga jadi|gak jadi|nggak jadi|tidak jadi|eh)(?![a-z])/;
const RE_NIAT = /(?:^|[^a-z])(cetak|print|pesan|order|bikin|buat)(?![a-z])/;
const RE_TENGGAT = /(hari ini|besok|lusa|nanti sore|nanti malam|sore|pagi|siang|malam|jam\s*\d{1,2}(?:[.:]\d{2})?)/g;
const RE_NAMA = /\b(?:saya|aku|nama saya|namaku)\s+([A-Z][a-zA-Z]{1,30})/;

const angka = value => ANGKA_KATA[value] ?? Number.parseInt(value, 10);
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const frasaRe = frasa => new RegExp(`(?:^|[^a-z0-9])${escapeRe(frasa)}(?![a-z0-9])`);

/** Daftar frasa pengenal tiap produk: kata kunci gerai + kodenya. */
export function siapkanKatalog(products) {
  return products.map(product => ({
    product,
    frasa: [...String(product.keywords || '').split(','), String(product.code || '')]
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length >= 2)
  }));
}

/** Produk dengan skor frasa tertinggi; seri antar produk berbeda = ragu. */
export function cocokProduk(teks, katalog) {
  let best = null;
  let tie = false;
  for (const entry of katalog) {
    const matched = entry.frasa.filter(frasa => frasaRe(frasa).test(teks));
    const score = matched.reduce((sum, frasa) => sum + frasa.length, 0);
    if (!score) continue;
    if (!best || score > best.score) { best = { ...entry, matched, score }; tie = false; } else if (score === best.score) tie = true;
  }
  if (!best) return null;
  return tie ? { ambiguous: true } : best;
}

/** "3x1", "300x100 cm", "2,5 x 1 m" -> { widthCm, heightCm, text }. Tanpa satuan: <=20 dianggap meter. */
export function cariUkuran(teks) {
  const m = RE_UKURAN.exec(teks);
  if (!m) return null;
  const a = Number(m[1].replace(',', '.'));
  const b = Number(m[3].replace(',', '.'));
  const unit = m[2] || m[4] || (a <= 20 && b <= 20 ? 'm' : 'cm');
  const toCm = value => Math.round(unit === 'cm' ? value : value * 100);
  const widthCm = toCm(a);
  const heightCm = toCm(b);
  if (!widthCm || !heightCm) return null;
  return { widthCm, heightCm, text: m[0] };
}

export function cariJumlah(teks) {
  const m = RE_JUMLAH.exec(teks);
  return m ? angka(m[1]) : null;
}

function jumlahSebelumProduk(teks, frasaList) {
  for (const frasa of frasaList) {
    const m = new RegExp(`(?:^|[^a-z0-9])${ANGKA}\\s+${escapeRe(frasa)}(?![a-z0-9])`).exec(teks);
    if (m) return angka(m[1]);
  }
  return null;
}

function pecahSegmen(teks) {
  return String(teks || '')
    // Koma di antara dua angka ("1,5 meter") adalah desimal, bukan pemisah.
    .split(/\n|(?<!\d),|,(?!\d)|;|\s+(?:dan|sama|&|terus|trus)\s+/i)
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * messages: [{ id, body_text, file_id, media_file_name, from_name }] urut waktu.
 * products: baris print_products aktif (id, code, name, unit, keywords).
 * Hasil: { customerName, dueText, items[{productId, productCode, productName, qty, widthCm, heightCm, fileId, note}],
 *          questions[], complete }
 */
export function tebakOrder(messages, products) {
  const katalog = siapkanKatalog(products);
  const questions = [];
  const items = [];
  const texts = messages.map(message => String(message.body_text || '')).filter(Boolean);
  const files = messages.filter(message => message.file_id).map(message => ({ id: message.file_id, name: String(message.media_file_name || '').toLowerCase() }));
  const semua = texts.join('\n').toLowerCase();

  if (RE_KOREKSI.test(semua)) questions.push('Ada koreksi di chat (ganti/ralat/batal). Cek manual.');

  let lastEntry = null;
  for (const text of texts) {
    for (const segmen of pecahSegmen(text)) {
      const lower = segmen.toLowerCase();
      const ukuran = cariUkuran(lower);
      const sisa = ukuran ? lower.replace(ukuran.text, ' ') : lower;
      const cocok = cocokProduk(sisa, katalog);
      if (cocok?.ambiguous) {
        questions.push(`Produk untuk "${segmen}" ragu antara beberapa pilihan.`);
        continue;
      }
      const entry = cocok || (ukuran && lastEntry) || null;
      const jumlahTertulis = cariJumlah(sisa) ?? (cocok ? jumlahSebelumProduk(sisa, cocok.matched) : null);
      if (!entry) {
        if (jumlahTertulis || ukuran || RE_NIAT.test(lower)) questions.push(`Belum dikenali: "${segmen}"`);
        continue;
      }
      lastEntry = entry;
      const product = entry.product;
      if (product.unit === 'M2' && !ukuran) questions.push(`${product.name}: ukurannya berapa (lebar x tinggi)?`);
      items.push({
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        qty: jumlahTertulis || 1,
        widthCm: product.unit === 'M2' ? ukuran?.widthCm ?? null : null,
        heightCm: product.unit === 'M2' ? ukuran?.heightCm ?? null : null,
        fileId: null,
        note: jumlahTertulis ? '' : 'jumlah tidak disebut, dianggap 1',
        _frasa: entry.frasa
      });
    }
  }

  if (items.length) {
    if (!files.length) {
      questions.push('File desain belum dikirim.');
    } else if (files.length === items.length) {
      // Nama file yang menyebut produk (brosur.pdf, spanduk.jpg) dipasangkan dulu; sisanya urut.
      const sisaFile = [];
      for (const file of files) {
        const kandidat = items.filter(item => !item.fileId && item._frasa.some(frasa => frasaRe(frasa).test(file.name)));
        if (kandidat.length === 1) kandidat[0].fileId = file.id; else sisaFile.push(file);
      }
      for (const item of items) if (!item.fileId) item.fileId = sisaFile.shift()?.id ?? null;
    } else if (items.length === 1) {
      questions.push(`Ada ${files.length} file untuk 1 item. File mana yang dicetak, atau semua?`);
    } else {
      questions.push(`Jumlah file (${files.length}) tidak sama dengan jumlah item (${items.length}). Pasangkan manual.`);
    }
  }

  const fromName = messages.find(message => message.from_name)?.from_name || '';
  const namaDiChat = texts.map(text => RE_NAMA.exec(text)?.[1]).find(Boolean) || '';
  const tenggat = [...new Set(semua.match(RE_TENGGAT) || [])].join(' ');
  const cleanItems = items.map(({ _frasa, ...item }) => item);
  return {
    customerName: fromName || namaDiChat,
    dueText: tenggat,
    items: cleanItems,
    questions: [...new Set(questions)],
    complete: cleanItems.length > 0 && questions.length === 0 && cleanItems.every(item => item.fileId)
  };
}

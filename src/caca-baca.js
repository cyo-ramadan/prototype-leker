// Una membaca bebas (Bos Cyo 2026-10-02): model memilih API baca dari katalog,
// lalu bergantian dengan kode beberapa langkah sampai bisa menjawab.
//
//   model : pilih API            (dari katalog, parameter diizinkan saja)
//   kode  : baca, bersihkan      (rahasia/gambar/kontak pribadi disingkirkan)
//   model : "hitung ini" atau "jawab"
//   kode  : saring/urut/jumlah/banding (caca-hitung.js — angka tidak dari AI)
//   model : jawab, menyalin angka dari tabel
//
// Pagar yang tidak boleh dilonggarkan:
//   - model tidak pernah menghitung; dia hanya menyebut maunya;
//   - maksimum langkah dan maksimum pembacaan per pertanyaan (biaya dan kuota baca D1);
//   - gerai tidak pernah dari kalimat (parameter gerai tidak ada di katalog);
//   - angka di jawaban yang tidak ditemukan di data dilaporkan, bukan dibiarkan.

import { cariApi, bangunAlamat, daftarApiUntukModel } from './caca-baca-katalog.js';
import { bersihkan, gabungGerai } from './caca-baca-aman.js';
import {
  jalankanHitung, petaDaftar, ambilDaftar, NAMA_OPERASI, NAMA_OP_SARING, NAMA_AGREGAT
} from './caca-hitung.js';
import { GAYA_UNTUK_MODEL } from './caca-gaya.js';

export const MAKS_LANGKAH = 3;
export const MAKS_BACA = 24;
export const MAKS_GERAI_SEKALIGUS = 12;
export const BATAS_LANGSUNG = 7000;
const MAKS_TEKS_KE_MODEL = 14000;

const POLA_BATAS = /(too many|subrequest|exceeded|limit)/i;

// --- skema ------------------------------------------------------------------

/** Isian pilihan API; dipakai juga oleh skema pilih-alat di caca-agen.js. */
export const SKEMA_BACA_API = Object.freeze({
  // Sengaja tanpa enum: daftar API ada di prompt dan divalidasi di kode. Enum 50-an
  // nilai di dalam skema yang sudah besar menambah risiko penyedia menolaknya
  // ("constraint has too many states"), sedangkan salah ketik nama cukup dijawab
  // "tidak ada di daftar".
  api: { type: 'string', description: 'baca_api: id API yang dibuka, PERSIS seperti di daftar API.' },
  api_query: {
    type: 'array',
    description: 'baca_api: parameter API (dari "param" API itu saja), mis. kunci "from" nilai "2026-10-01".',
    items: {
      type: 'object',
      required: ['kunci', 'nilai'],
      properties: { kunci: { type: 'string' }, nilai: { type: 'string' } }
    }
  }
});

function skemaLangkah(bolehLagi) {
  return {
    type: 'object',
    required: ['langkah'],
    properties: {
      langkah: {
        type: 'string',
        enum: bolehLagi ? ['jawab', 'hitung', 'baca'] : ['jawab'],
        description: 'jawab = data sudah cukup; hitung = perlu menyaring/mengurutkan/menjumlah; baca = perlu data lain.'
      },
      jawaban: { type: 'string', description: 'Untuk langkah "jawab": jawaban untuk pemilik toko.' },
      sumber: { type: 'string', description: 'hitung: id API yang daftarnya dihitung. Kosong = yang terakhir dibaca.' },
      daftar: { type: 'string', description: 'hitung: jalur daftar dari hasil baca, mis. "products" atau "ringkasan_gerai".' },
      turunan: {
        type: 'array',
        description: 'hitung: kolom baru dari dua kolom, mis. margin = price kurang averageCost.',
        items: {
          type: 'object',
          required: ['nama', 'kolom_a', 'operasi', 'kolom_b'],
          properties: {
            nama: { type: 'string' },
            kolom_a: { type: 'string' },
            operasi: { type: 'string', enum: NAMA_OPERASI },
            kolom_b: { type: 'string' }
          }
        }
      },
      saring: {
        type: 'array',
        description: 'hitung: syarat baris (semua harus terpenuhi). Isi "nilai" ATAU "bandingkan_kolom" (bandingkan dengan kolom lain).',
        items: {
          type: 'object',
          required: ['kolom', 'op'],
          properties: {
            kolom: { type: 'string' },
            op: { type: 'string', enum: NAMA_OP_SARING },
            nilai: { type: 'string' },
            bandingkan_kolom: { type: 'string' }
          }
        }
      },
      urut_kolom: { type: 'string', description: 'hitung: kolom pengurut.' },
      urut_arah: { type: 'string', enum: ['naik', 'turun'] },
      ambil: { type: 'integer', description: 'hitung: berapa baris ditampilkan (maks 50).' },
      kolom: { type: 'array', items: { type: 'string' }, description: 'hitung: kolom yang ditampilkan (maks 8).' },
      agregat_fungsi: { type: 'string', enum: NAMA_AGREGAT, description: 'hitung: jumlah, rata, terkecil, terbesar, atau banyak.' },
      agregat_kolom: { type: 'string' },
      agregat_per: { type: 'string', description: 'hitung: kelompokkan per kolom ini.' },
      api: SKEMA_BACA_API.api,
      api_query: SKEMA_BACA_API.api_query
    }
  };
}

// --- prompt -----------------------------------------------------------------

function promptLangkah(konteks, bolehLagi) {
  return [
    'Kamu Maimunah, asisten toko yang biasa dipanggil Una. Sebut dirimu "Una", bukan "saya" atau "aku".',
    'Kamu sedang menjawab pertanyaan pemilik toko dengan MEMBACA data, selangkah demi selangkah.',
    '',
    konteks.lingkup === 'entity'
      ? `Yang dibuka: buku entity ${konteks.namaLingkup} (semua gerai).`
      : `Gerai yang dibuka: ${konteks.namaLingkup}.`,
    `Hari ini tanggal ${konteks.hariIni}.`,
    '',
    'Pilih satu per langkah:',
    '- "jawab": kalau data di bawah sudah cukup. Isi "jawaban" 1-4 kalimat.',
    bolehLagi ? '- "hitung": kalau perlu menyaring, mengurutkan, menjumlah, atau membandingkan angka dalam sebuah daftar. Sebut daftarnya ("daftar") dan maunya; SISTEM yang menghitung, bukan kamu.' : '',
    bolehLagi ? '- "baca": kalau perlu data lain. Pilih "api" dari daftar di bawah.' : '- Ini langkah terakhir: jawab sekarang dengan data yang ada. Kalau belum cukup, bilang apa yang kurang.',
    '',
    'Aturan keras:',
    '- SEMUA angka di jawaban harus persis dari data atau hasil hitung di bawah. Dilarang menghitung, menjumlah, membandingkan, atau memperkirakan angka sendiri.',
    '- Dilarang menyebut angka yang tidak ada di data. Kalau data tidak memuat yang ditanyakan, bilang belum ada datanya.',
    '- Nama kolom dan jalur daftar dipakai PERSIS seperti tertulis di data. Kolom uang: harga/HPP/saldo dalam rupiah.',
    '- Tulis rupiah dengan pemisah ribuan, mis. 808.000.',
    '- Kalau hasil hitung terpotong (ditampilkan N dari M baris), sebutkan jumlah M-nya.',
    '- Kalau ada gerai yang gagal dibaca atau pembacaan dibatasi, sebutkan terus terang.',
    '- Kamu asisten otomatis. Kalau ditanya, jujur saja; jangan mengaku manusia.',
    '',
    GAYA_UNTUK_MODEL,
    ...(bolehLagi ? ['', 'Daftar API yang boleh dibaca:', daftarApiUntukModel()] : [])
  ].filter((baris) => baris !== '').join('\n');
}

// --- membaca ----------------------------------------------------------------

function cobaTeks(nilai) {
  try { return JSON.stringify(nilai) ?? ''; } catch { return ''; }
}

function ringkasKolom(kolom) {
  return kolom.slice(0, 40).map((k) => {
    const contoh = typeof k.contoh === 'string' ? `"${k.contoh.slice(0, 30)}"` : String(k.contoh);
    return `${k.nama} (${k.jenis}${k.jenis === 'kosong' ? '' : `, mis. ${contoh}`})`;
  }).join('; ');
}

function teksHasilBaca(rec) {
  const kepala = `HASIL BACA ${rec.id}${rec.gerai ? ` — ${rec.gerai.terbaca.length} dari ${rec.gerai.total} gerai terbaca${rec.gerai.gagal.length ? `, gagal: ${rec.gerai.gagal.map((g) => `${g.kode} (${g.error})`).join('; ')}` : ''}` : ''}`;
  const catatan = rec.catatan.length ? `\nCatatan sistem: ${rec.catatan.join('; ')}.` : '';
  const penuh = cobaTeks(rec.data);
  if (penuh.length <= BATAS_LANGSUNG) return `${kepala}${catatan}\n${penuh}`;

  const peta = petaDaftar(rec.data);
  const baris = peta.slice(0, 8).map((d) => `  • daftar "${d.jalur}": ${d.banyak} baris. Kolom: ${ringkasKolom(d.kolom)}`);
  // Isian di luar daftar (total, status) biasanya kecil dan sering jadi jawabannya.
  const luar = {};
  if (rec.data && typeof rec.data === 'object' && !Array.isArray(rec.data)) {
    for (const [k, v] of Object.entries(rec.data)) {
      if (!Array.isArray(v) && cobaTeks(v).length <= 600) luar[k] = v;
    }
  }
  return [
    `${kepala} — datanya besar, hanya bentuknya yang ditampilkan.${catatan}`,
    ...baris,
    Object.keys(luar).length ? `  Isian di luar daftar: ${cobaTeks(luar)}` : '',
    'Pakai langkah "hitung" untuk menyaring/mengurutkan/menjumlah daftar di atas.'
  ].filter(Boolean).join('\n');
}

function teksHitung(sumber, daftar, hasil) {
  const tabel = [hasil.kolom.join(' | '), ...hasil.isi.map((b) => b.join(' | '))].join('\n');
  return `HASIL HITUNG dari ${sumber} / ${daftar}: ${hasil.jumlahCocok} baris cocok${hasil.terpotong ? `, ditampilkan ${hasil.isi.length}` : ''}.\n${tabel}`;
}

/** Angka di jawaban yang tidak ada di bukti (data + hasil hitung + tanggal hari ini). */
export function angkaTanpaBukti(jawaban, bukti) {
  const ambilToken = (teks) => [...String(teks).matchAll(/\d[\d.,]*\d|\d/g)].map((m) => m[0]);
  const normal = (token) => token.replace(/[.,]/g, '');
  const ada = new Set();
  for (const token of ambilToken(bukti)) {
    ada.add(normal(token));
    // "12.5" di data boleh ditulis "12,5" atau "12" -> bagian bulatnya.
    const bulat = token.split(/[.,]/)[0];
    if (bulat) ada.add(bulat);
  }
  const hilang = [];
  for (const token of ambilToken(jawaban)) {
    const n = normal(token);
    if (n.length < 3) continue; // angka kecil (2 gerai, 10 barang) terlalu berisik
    if (!ada.has(n) && !hilang.includes(token)) hilang.push(token);
  }
  return hilang;
}

function normalkanSpec(nilai) {
  const daftar = (x) => (Array.isArray(x) ? x : []);
  const adaTeks = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);
  return {
    turunan: daftar(nilai.turunan).map((t) => ({ nama: t?.nama, kolom_a: t?.kolom_a, operasi: t?.operasi, kolom_b: t?.kolom_b })),
    saring: daftar(nilai.saring)
      .map((s) => ({ kolom: s?.kolom, op: s?.op, nilai: adaTeks(s?.nilai) ?? undefined, bandingkan_kolom: adaTeks(s?.bandingkan_kolom) ?? undefined })),
    urut: adaTeks(nilai.urut_kolom) ? { kolom: nilai.urut_kolom.trim(), arah: nilai.urut_arah === 'naik' ? 'naik' : 'turun' } : null,
    ambil: Number.isInteger(nilai.ambil) ? nilai.ambil : null,
    kolom: daftar(nilai.kolom).filter((k) => typeof k === 'string' && k.trim()),
    agregat: adaTeks(nilai.agregat_fungsi)
      ? { fungsi: nilai.agregat_fungsi, kolom: adaTeks(nilai.agregat_kolom) ?? undefined, per: adaTeks(nilai.agregat_per) ?? undefined }
      : null
  };
}

/**
 * @param {object} p
 * @param {string} p.pertanyaan
 * @param {object} p.pilihan hasil pilih-alat: { api, api_query }
 * @param {object} p.konteks { lingkup, namaLingkup, hariIni, storeCode, ... }
 * @param {{baca:Function, jalurGerai:Function}} p.jalurAksi
 * @param {Function} p.panggilModel
 * @param {object} [p.env]
 */
export async function bacaBebas({
  pertanyaan, pilihan, konteks, jalurAksi, panggilModel, env,
  maksLangkah = MAKS_LANGKAH, maksBaca = MAKS_BACA
}) {
  const hasilBaca = new Map(); // kunci -> rec
  const urutan = [];           // rec menurut waktu dibaca
  const blok = [];             // teks yang ditunjukkan ke model, berurutan
  const jejak = [];
  const state = { sisaBaca: maksBaca, batasTercapai: false, tabel: null, gerai: null };

  async function bacaSatu(jalur, alamat) {
    if (state.sisaBaca <= 0) return { ok: false, error: 'anggaran baca per pertanyaan habis' };
    state.sisaBaca -= 1;
    const r = await jalur.baca(alamat);
    if (!r.ok && POLA_BATAS.test(String(r.error))) state.batasTercapai = true;
    return r;
  }

  async function daftarGerai() {
    if (state.gerai) return state.gerai;
    const r = await bacaSatu(jalurAksi, '/api/entity-admin/stores');
    if (!r.ok) return { ok: false, error: r.error };
    state.gerai = {
      ok: true,
      nilai: (r.data.stores ?? []).filter((s) => s.isActive !== false).map((s) => s.code).sort()
    };
    return state.gerai;
  }

  async function bacaApi(id, pasangan) {
    const api = cariApi(id);
    if (!api) return { ok: false, error: `API "${id}" tidak ada di daftar.` };
    const alamat = bangunAlamat(api, pasangan);
    if (!alamat.ok) return { ok: false, error: alamat.error };

    const kunci = `${api.id}|${alamat.alamat}`;
    if (hasilBaca.has(kunci)) return { ok: true, rec: hasilBaca.get(kunci), ulang: true };

    let data;
    let catatan = [];
    let gerai = null;

    if (api.lingkup === 'entity' || konteks.lingkup !== 'entity') {
      const r = await bacaSatu(jalurAksi, alamat.alamat);
      if (!r.ok) return { ok: false, error: `${api.id}: ${r.error}` };
      ({ data, catatan } = bersihkan(r.data));
    } else if (api.lintasGerai) {
      // Satu panggilan yang sudah mencakup semua gerai entity; cukup lewat satu gerai mana pun.
      const daftar = await daftarGerai();
      if (!daftar.ok || !daftar.nilai.length) return { ok: false, error: `${api.id}: daftar gerai tidak terbaca` };
      const r = await bacaSatu(jalurAksi.jalurGerai(daftar.nilai[0]), alamat.alamat);
      if (!r.ok) return { ok: false, error: `${api.id}: ${r.error}` };
      ({ data, catatan } = bersihkan(r.data));
    } else if (api.berat) {
      return { ok: false, error: `${api.id} berat, jadi hanya bisa untuk satu gerai. Minta pemilik memilih gerainya di judul panel dulu.` };
    } else {
      const daftar = await daftarGerai();
      if (!daftar.ok) return { ok: false, error: `${api.id}: daftar gerai tidak terbaca (${daftar.error})` };
      const sasaran = daftar.nilai.slice(0, MAKS_GERAI_SEKALIGUS);
      const terbaca = [];
      const gagal = [];
      const perGerai = [];
      for (const kode of sasaran) {
        if (state.batasTercapai || state.sisaBaca <= 0) {
          gagal.push({ kode, error: state.batasTercapai ? 'dibatasi sistem' : 'anggaran baca habis' });
          continue;
        }
        const r = await bacaSatu(jalurAksi.jalurGerai(kode), alamat.alamat);
        if (!r.ok) { gagal.push({ kode, error: String(r.error).slice(0, 80) }); continue; }
        const bersih = bersihkan(r.data);
        catatan.push(...bersih.catatan);
        perGerai.push({ kode, data: bersih.data });
        terbaca.push(kode);
      }
      if (!terbaca.length) return { ok: false, error: `${api.id}: tidak ada gerai yang terbaca (${gagal.map((g) => `${g.kode}: ${g.error}`).join('; ')})` };
      data = gabungGerai(perGerai);
      catatan = [...new Set(catatan)];
      gerai = { terbaca, gagal, total: daftar.nilai.length };
    }

    const rec = { id: api.id, alamat: alamat.alamat, data, catatan, gerai };
    hasilBaca.set(kunci, rec);
    urutan.push(rec);
    jejak.push(api.id);
    return { ok: true, rec };
  }

  function tunjukkan(hasil) {
    if (!hasil.ok) { blok.push(`GAGAL MEMBACA: ${hasil.error}`); return; }
    blok.push(hasil.ulang ? `(${hasil.rec.id} sudah dibaca tadi, pakai hasil di atas.)` : teksHasilBaca(hasil.rec));
  }

  // Bacaan pertama datang dari pilihan awal (tanpa panggilan model tambahan).
  const pertama = await bacaApi(pilihan?.api, pilihan?.api_query);
  if (!pertama.ok) {
    return { ok: true, jawaban: `Una belum bisa membuka datanya: ${pertama.error}`, ditolak: true, jejak: null };
  }
  tunjukkan(pertama);

  let langkah = 0;
  for (;;) {
    const bolehLagi = langkah < maksLangkah - 1;
    const isi = [`Pertanyaan: ${pertanyaan}`, '', ...blok].join('\n').slice(0, MAKS_TEKS_KE_MODEL);
    const balasan = await panggilModel(env, {
      system: promptLangkah(konteks, bolehLagi),
      content: [{ type: 'text', text: isi }],
      schema: skemaLangkah(bolehLagi)
    });
    if (!balasan.ok) return { ok: false, status: balasan.status, error: balasan.error };
    const v = balasan.value ?? {};

    if (v.langkah === 'jawab' || !bolehLagi) {
      const jawaban = String(v.jawaban ?? '').trim() || 'Una belum bisa menyimpulkan dari data yang ada.';
      const bukti = `${blok.join('\n')}\n${konteks.hariIni}`;
      const hilang = angkaTanpaBukti(jawaban, bukti);
      const catatanTabel = state.tabel && state.tabel.terpotong
        ? `menampilkan ${state.tabel.isi.length} dari ${state.tabel.jumlahCocok} baris`
        : null;
      return {
        ok: true,
        jawaban,
        tabel: state.tabel ? { kolom: state.tabel.kolom, isi: state.tabel.isi } : null,
        jejak: `dari ${[...new Set(jejak)].join(' + ')}${state.tabel ? ' · dihitung sistem' : ''}${catatanTabel ? ` · ${catatanTabel}` : ''}`,
        peringatan: hilang.length
          ? `Ada angka di jawaban yang tidak ketemu persis di data (${hilang.slice(0, 5).join(', ')}). Cek tabelnya ya.`
          : null,
        data: {}
      };
    }

    if (v.langkah === 'baca') {
      tunjukkan(await bacaApi(v.api, v.api_query));
    } else {
      // hitung
      const rec = (v.sumber && [...urutan].reverse().find((r) => r.id === v.sumber)) || urutan[urutan.length - 1];
      const baris = rec ? ambilDaftar(rec.data, v.daftar) : null;
      if (!baris) {
        const ada = rec ? petaDaftar(rec.data).map((d) => d.jalur).join(', ') || '(tidak ada daftar)' : '(belum ada yang dibaca)';
        blok.push(`GAGAL MENGHITUNG: daftar "${v.daftar}" tidak ada di ${rec?.id}. Daftar yang ada: ${ada}.`);
      } else {
        const hasil = jalankanHitung(baris, normalkanSpec(v));
        if (!hasil.ok) {
          blok.push(`GAGAL MENGHITUNG: ${hasil.error}`);
        } else {
          state.tabel = hasil;
          blok.push(teksHitung(rec.id, v.daftar, hasil));
        }
      }
    }
    langkah += 1;
  }
}

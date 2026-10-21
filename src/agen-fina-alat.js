// H2 hanya membaca. Pendaftaran ke persona/registry adalah milik H0.
import { bersihkan } from './caca-baca-aman.js';
import { hitungPeriode } from './caca-alat.js';

const teks = value => String(value ?? '').trim();
const normal = value => teks(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TANGGAL = { type: 'string', description: 'Tanggal pemeriksaan YYYY-MM-DD, hanya bila Bos menyebut tanggal. Kosong = hari ini WIB.' };
const GERAI = { type: 'string', description: 'Kode atau nama gerai PERSIS dari ucapan Bos; jangan menebak.' };
const MAKS_GERAI = 12;
const bukaPresensi = ctx => ctx.lingkup === 'entity'
  ? [{ jenis: 'buka', layar: 'settings', halaman: 'entity', label: 'Buka Dana Apresiasi di Pengaturan' }]
  : [{ jenis: 'buka', layar: 'attendance-report', halaman: 'gerai', label: 'Buka Presensi' }];
const alamat = (jenis, params) => '/api/admin/fina/' + jenis + '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')));

async function geraiUntuk(t, ctx, semua = false) {
  const diminta = teks(t?.fh_gerai);
  if (ctx.lingkup !== 'entity') {
    if (diminta) return { ok: false, kurang: 'fh_gerai', tanya: 'Pilih gerai yang dimaksud di kepala panel terlebih dahulu; Fina memakai gerai panel.' };
    return { ok: true, list: [{ kode: ctx.namaLingkup || 'gerai ini', jalur: ctx }], total: 1 };
  }
  const ref = await ctx.baca('/api/entity-admin/stores');
  if (!ref.ok) return ref;
  const stores = (bersihkan(ref.data).data?.stores || []).filter(s => s.isActive !== false);
  if (diminta) {
    const matches = stores.filter(s => [s.code, s.storeName, s.name].some(n => n && normal(n) === normal(diminta)));
    if (matches.length !== 1) return { ok: false, kurang: 'fh_gerai', tanya: 'Gerainya belum cocok satu. Sebut kode gerai dari daftar gerai entity.' };
    return { ok: true, list: [{ kode: matches[0].code, jalur: ctx.jalurGerai(matches[0].code) }], total: 1 };
  }
  if (!semua) return { ok: false, kurang: 'fh_gerai', tanya: 'Backup untuk gerai mana? Sebut nama atau kode gerainya.' };
  return { ok: true, list: stores.slice(0, MAKS_GERAI).map(s => ({ kode: s.code, jalur: ctx.jalurGerai(s.code) })), total: stores.length };
}

async function bacaDaftar(targets, jenis, params, key) {
  const list = [], gagal = [];
  for (const target of targets.list) {
    const ref = await target.jalur.baca(alamat(jenis, params));
    if (!ref.ok) { gagal.push(target.kode + ': ' + (ref.error || 'belum terbaca')); continue; }
    const data = bersihkan(ref.data).data;
    if (!Array.isArray(data?.[key])) { gagal.push(target.kode + ': jawaban data belum lengkap'); continue; }
    list.push(...data[key].map(row => ({ ...row, gerai: target.kode })));
  }
  if (targets.total > targets.list.length) gagal.push((targets.total - targets.list.length) + ' gerai belum dibaca karena batas sekali periksa');
  if (gagal.length) return { ok: false, error: 'Fina belum dapat menyimpulkan lengkap. ' + gagal.join('; ') + '.', tanya: 'Fina belum dapat menyimpulkan lengkap. ' + gagal.join('; ') + '.' };
  return { ok: true, list };
}

export const cariGeraiKosong = Object.freeze({
  nama: 'cari_gerai_kosong', lingkup: 'semua', baca: true,
  petunjuk: 'MEMBACA gerai/shift yang sedang kosong: jadwal vs presensi dan pengganti tercatat, mis. gerai mana yang kosong sekarang? Hitungan oleh server, tanpa memotong gaji.',
  skema: { fh_tanggal: TANGGAL, fh_gerai: GERAI },
  async siapkan(t, ctx) {
    const targets = await geraiUntuk(t, ctx, true);
    if (!targets.ok) return targets;
    const result = await bacaDaftar(targets, 'kosong', { date: t?.fh_tanggal }, 'shifts');
    if (!result.ok) return result;
    return { ok: true,
      jawaban: result.list.length ? result.list.length + ' shift belum dijaga pada waktu diperiksa. Periksa Presensi sebelum menentukan pengganti.' : 'Tidak ada shift berjalan yang terdeteksi kosong dalam gerai yang diperiksa.',
      tabel: { kolom: ['Gerai', 'CS', 'Tanggal shift', 'Jam', 'Lewat (menit)'],
        isi: result.list.map(r => [r.gerai, r.name, r.businessDate, r.shiftStart + '–' + r.shiftEnd, String(r.lewatMenit)]) },
      tawaran: bukaPresensi(ctx) };
  }
});

export const daftarFreelanceTersedia = Object.freeze({
  nama: 'daftar_freelance_tersedia', lingkup: 'semua', baca: true,
  petunjuk: 'MEMBACA siapa freelance yang tersedia backup di gerai dan jam tertentu, mis. siapa bisa backup jam 14–22 di Beji? Tidak mengaktifkan akun atau mengirim tawaran.',
  skema: { fh_tanggal: TANGGAL, fh_gerai: GERAI,
    fh_jam_dari: { type: 'string', description: 'Jam mulai HH:MM dari ucapan Bos, mis. 14:00.' },
    fh_jam_sampai: { type: 'string', description: 'Jam akhir HH:MM dari ucapan Bos, mis. 22:00; boleh melewati tengah malam.' } },
  isiDariPesan(t, pesan) {
    const m = String(pesan || '').match(/\b(?:jam|pukul)\s*([01]?\d|2[0-3])(?:[.:]([0-5]\d))?\s*(?:[-–—]|sampai|hingga|s\/?d)\s*([01]?\d|2[0-3])(?:[.:]([0-5]\d))?\b/i);
    return m ? { ...t, fh_jam_dari: m[1].padStart(2, '0') + ':' + (m[2] || '00'), fh_jam_sampai: m[3].padStart(2, '0') + ':' + (m[4] || '00') } : { ...t };
  },
  async siapkan(t, ctx) {
    if (!t?.fh_jam_dari) return { ok: false, kurang: 'fh_jam_dari', tanya: 'Backup mulai jam berapa?' };
    if (!t?.fh_jam_sampai) return { ok: false, kurang: 'fh_jam_sampai', tanya: 'Backup sampai jam berapa?' };
    const targets = await geraiUntuk(t, ctx);
    if (!targets.ok) return targets;
    const result = await bacaDaftar(targets, 'freelance', { date: t.fh_tanggal, from: t.fh_jam_dari, to: t.fh_jam_sampai }, 'candidates');
    if (!result.ok) return result;
    return { ok: true, jawaban: result.list.length
      ? result.list.length + ' freelance tidak berbenturan dengan jadwal atau tugas yang tercatat. Ketersediaan orangnya tetap perlu dikonfirmasi; akun backup perlu aktivasi admin bila belum aktif.'
      : 'Belum ada freelance tersedia menurut jadwal, presensi, dan aktivasi yang tercatat.',
      tabel: { kolom: ['CS', 'Gerai akun', 'Aktivasi admin'],
        isi: result.list.map(r => [r.name, r.storeCode || r.storeId, r.perluAktivasi ? 'Perlu diaktifkan' : 'Periksa sebelum bertugas']) },
      tawaran: bukaPresensi(ctx) };
  }
});

export const rekapMasalahCs = Object.freeze({
  nama: 'rekap_masalah_cs', lingkup: 'semua', baca: true,
  petunjuk: 'MEMBACA rekap masalah CS/kasir: telat, pulang awal, kosong, denda tercatat, dan lupa presensi pulang per periode. Tidak memberi SP atau membuat keputusan uang.',
  skema: { fh_gerai: GERAI,
    fh_periode: { type: 'string', enum: ['hari_ini', 'kemarin', '7_hari_terakhir', 'bulan_ini', 'bulan_lalu', 'rentang'], description: 'Periode rekap; bawaan 7 hari terakhir.' },
    fh_dari: { type: 'string', description: 'Tanggal mulai YYYY-MM-DD untuk rentang.' },
    fh_sampai: { type: 'string', description: 'Tanggal akhir YYYY-MM-DD untuk rentang.' } },
  async siapkan(t, ctx) {
    const periode = hitungPeriode(t?.fh_periode || '7_hari_terakhir', { dari: t?.fh_dari, sampai: t?.fh_sampai }, ctx.hariIni);
    if (!periode.ok) return periode;
    const targets = await geraiUntuk(t, ctx, true);
    if (!targets.ok) return targets;
    const result = await bacaDaftar(targets, 'masalah', { from: periode.dari, to: periode.sampai }, 'employees');
    if (!result.ok) return result;
    return { ok: true, jawaban: result.list.length + ' baris CS/gerai dengan catatan masalah pada ' + periode.dari + ' sampai ' + periode.sampai + '. Kosong/denda hanya dari evaluasi tersimpan; jam sesi tanpa evaluasi memakai jadwal saat ini. Ini bahan pemeriksaan admin, bukan keputusan SP atau potongan baru.',
      tabel: { kolom: ['Gerai', 'CS', 'Telat (menit)', 'Pulang awal (menit)', 'Kosong (menit)', 'Denda (kejadian)', 'Lupa pulang', 'Shift bermasalah'],
        isi: result.list.map(r => [r.gerai, r.name, r.telatMenit, r.pulangAwalMenit, r.kosongMenit, r.denda, r.lupaPulang, r.kejadian].map(String)) },
      tawaran: bukaPresensi(ctx) };
  }
});

export const AKSI_FINA_BACA = Object.freeze([cariGeraiKosong, daftarFreelanceTersedia, rekapMasalahCs]);

// Alat TULIS Fina (agen HR) -- paket H3 (contracts/fina-hr-paket-v1.md).
//
// Polanya sama dengan alat tulis Una (src/caca-aksi*.js): model hanya menyalin kalimat Bos jadi
// isian mentah; KODE yang mencocokkan nama, membaca data lewat rute aslinya, menyusun draft, dan
// sesudah orang menekan "Ya" memposting lewat rute yang sama dengan layar. Angka hanya dari data.
//   - siapkan_tawaran_backup: teks tawaran siap salin (fase 1 TIDAK mengirim apa pun -> alat baca).
//   - catat_pengganti: "X menggantikan Y" lewat rute koreksi pengganti Dana Apresiasi.
//   - pasang_pengumuman: papan pengumuman CS lewat POST /api/admin/announcements.
//   - draft_sp: surat teguran/SP berisi fakta rekap masalah CS, disimpan DRAFT (hr_surat). Disetujui /
//     dibatalkan hanya oleh tombol manusia di Entity Admin.
// Aturan HR (jumlah tawaran, batas tunggu, tingkat SP, kop, masa berlaku) dari pengaturan Fina (H1).

import { cocokkanSatu, teks, tanggalDari } from './caca-aksi-dasar.js';
import { hitungPeriode } from './caca-alat.js';
import { bersihkan } from './caca-baca-aman.js';
import { daftarFreelanceTersedia } from './agen-fina-alat.js';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const tanggalPanjang = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return `${d} ${BULAN[m - 1] || ''} ${y}`; };
const jamWib = (iso) => (iso ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date(iso)).replace('.', ':') : '-');
const baca = async (ctx, path, params = {}) => {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')));
  const ref = await ctx.baca(q.toString() ? `${path}?${q}` : path);
  return ref.ok ? { ok: true, data: bersihkan(ref.data).data } : ref;
};
const JAM = /^([01]\d|2[0-3]):[0-5]\d$/;

// --- tawaran backup ------------------------------------------------------------------------

export const siapkanTawaranBackup = Object.freeze({
  nama: 'siapkan_tawaran_backup', lingkup: 'gerai', baca: true,
  petunjuk: 'MENYIAPKAN teks tawaran backup siap salin untuk freelance yang tersedia di gerai panel pada jam tertentu, mis. "siapin tawaran backup jam 14-22 hari ini". Tidak mengirim apa pun.',
  skema: {
    fh_tanggal: daftarFreelanceTersedia.skema.fh_tanggal,
    fh_jam_dari: daftarFreelanceTersedia.skema.fh_jam_dari,
    fh_jam_sampai: daftarFreelanceTersedia.skema.fh_jam_sampai
  },
  isiDariPesan: daftarFreelanceTersedia.isiDariPesan,
  async siapkan(t, ctx) {
    if (!JAM.test(teks(t?.fh_jam_dari, 5))) return { ok: false, kurang: 'fh_jam_dari', tanya: 'Backup mulai jam berapa? (mis. 14:00)' };
    if (!JAM.test(teks(t?.fh_jam_sampai, 5))) return { ok: false, kurang: 'fh_jam_sampai', tanya: 'Backup sampai jam berapa? (mis. 22:00)' };
    const tanggal = tanggalDari(t?.fh_tanggal, ctx.hariIni);
    if (!tanggal.ok && teks(t?.fh_tanggal, 10)) return { ...tanggal, kurang: 'fh_tanggal' };
    const date = tanggal.ok ? tanggal.nilai : ctx.hariIni;
    const ref = await baca(ctx, '/api/admin/fina/freelance', { date, from: t.fh_jam_dari, to: t.fh_jam_sampai });
    if (!ref.ok) return ref;
    const semua = Array.isArray(ref.data?.candidates) ? ref.data.candidates : null;
    const jumlah = Number(ref.data?.tawaranSerentak);
    const batas = Number(ref.data?.batasTungguMenit);
    if (!semua || !Number.isInteger(jumlah) || !Number.isInteger(batas)) return { ok: false, error: 'Data freelance belum lengkap terbaca, jadi tawaran belum disiapkan.' };
    const gerai = ref.data?.store?.storeName || ctx.namaLingkup || 'gerai';
    if (!semua.length) return { ok: true, jawaban: `Belum ada freelance yang tersedia di ${gerai} untuk ${t.fh_jam_dari}–${t.fh_jam_sampai} menurut jadwal dan presensi. Kabari Bos/admin untuk dicarikan manual.`, tabel: null };
    const dipilih = semua.slice(0, jumlah);
    const kalimat = (nama) => `Halo ${nama}, ada kebutuhan backup di ${gerai} tanggal ${tanggalPanjang(date)} jam ${t.fh_jam_dari}–${t.fh_jam_sampai}. Bisa bantu? Mohon balas YA atau TIDAK dalam ${batas} menit ya. Terima kasih.`;
    return {
      ok: true,
      jawaban: `Ini teks tawaran untuk ${dipilih.length} freelance (pengaturan: ${jumlah} sekaligus, gerai sendiri didahulukan). Salin dan kirim manual; belum ada yang terkirim. Kalau dalam ${batas} menit tidak ada yang bisa, kabari Bos/admin.`,
      tabel: { kolom: ['CS', 'Gerai akun', 'Teks tawaran'], isi: dipilih.map((c) => [c.name || c.accountId, c.storeCode || c.storeId || '', kalimat(c.name || 'Kak')]) },
      tawaran: [{ jenis: 'buka', layar: 'attendance-report', halaman: 'gerai', label: 'Buka Presensi' }]
    };
  }
});

// --- catat pengganti ------------------------------------------------------------------------

export const catatPengganti = Object.freeze({
  nama: 'catat_pengganti', lingkup: 'gerai',
  petunjuk: 'MENCATAT siapa menggantikan siapa di shift gerai panel, mis. "hari ini Avinda menggantikan Rika", "kemarin Dita gantiin Sari". Lewat koreksi pengganti Dana Apresiasi; shift dinilai ulang.',
  skema: {
    cp_pengganti: { type: 'string', description: 'catat_pengganti: nama CS yang DATANG menggantikan, persis seperti diucapkan.' },
    cp_digantikan: { type: 'string', description: 'catat_pengganti: nama CS yang TIDAK masuk / digantikan, persis seperti diucapkan.' },
    cp_tanggal: { type: 'string', description: 'catat_pengganti: YYYY-MM-DD hanya bila tanggal disebut. Kosong = hari ini.' }
  },
  async siapkan(t, ctx) {
    if (!teks(t?.cp_pengganti, 80)) return { ok: false, kurang: 'cp_pengganti', tanya: 'Siapa yang datang menggantikan?' };
    if (!teks(t?.cp_digantikan, 80)) return { ok: false, kurang: 'cp_digantikan', tanya: `${teks(t.cp_pengganti, 80)} menggantikan siapa?` };
    const tanggal = tanggalDari(t?.cp_tanggal, ctx.hariIni);
    if (!tanggal.ok) return { ...tanggal, kurang: 'cp_tanggal' };
    const ref = await baca(ctx, '/api/admin/fina/sesi', { date: tanggal.nilai });
    if (!ref.ok) return ref;
    const sesi = Array.isArray(ref.data?.sesi) ? ref.data.sesi : [];
    const terjadwal = Array.isArray(ref.data?.terjadwal) ? ref.data.terjadwal : [];
    const orangSesi = [...new Map(sesi.map((s) => [s.accountId, s])).values()];
    const datang = cocokkanSatu(t.cp_pengganti, orangSesi, { label: 'CS yang presensi', namaDari: (s) => s.name, kunciLain: (s) => [s.accountId] });
    if (!datang.ok) return { ...datang, tanya: `${datang.tanya} Fina hanya bisa mencatat untuk CS yang presensi masuk di ${ctx.namaLingkup} tanggal ${tanggal.nilai}.` };
    const sesiOrang = sesi.filter((s) => s.accountId === datang.nilai.accountId);
    if (sesiOrang.length > 1) return { ok: false, tanya: `${datang.nilai.name} punya ${sesiOrang.length} sesi presensi tanggal itu. Koreksi lewat Rekap Dana Apresiasi di Entity Admin supaya sesinya jelas.` };
    const digantikan = cocokkanSatu(t.cp_digantikan, terjadwal, { label: 'CS asli yang berjadwal', namaDari: (s) => s.name, kunciLain: (s) => [s.accountId] });
    if (!digantikan.ok) return { ...digantikan, tanya: `${digantikan.tanya} Yang bisa digantikan hanya CS asli yang berjadwal di ${ctx.namaLingkup} tanggal ${tanggal.nilai}.` };
    const s = sesiOrang[0];
    const y = digantikan.nilai;
    if (s.accountId === y.accountId) return { ok: false, tanya: 'Orang yang sama tidak bisa menggantikan dirinya sendiri.' };
    if (s.replacesAccountId === y.accountId) return { ok: false, tanya: `Sudah tercatat: ${s.name} menggantikan ${y.name} di sesi itu.` };
    return {
      ok: true,
      draft: {
        aksi: 'catat_pengganti',
        judul: 'Catat pengganti shift — dicek dulu ya:',
        baris: [['Tanggal', tanggal.nilai], ['Gerai', ctx.namaLingkup], ['Yang datang', `${s.name} (masuk ${jamWib(s.masuk)})`], ['Menggantikan', `${y.name} (jadwal ${y.shiftStart}–${y.shiftEnd})`]],
        dampak: [
          'Sama dengan koreksi "menggantikan siapa" di Entity Admin → Dana Apresiasi → Rekap: shift hari itu dinilai ulang, jadi potongan apresiasi dan fee backup bisa berubah.',
          ...(s.replacesAccountId ? ['Catatan pengganti lama di sesi ini diganti.'] : [])
        ],
        muatan: { attendanceId: s.attendanceId, replacesAccountId: y.accountId, pengganti: s.name, digantikan: y.name }
      }
    };
  },
  async posting(draft, ctx) {
    const m = draft.muatan;
    const hasil = await ctx.kirim('POST', '/api/entity-admin/dana-apresiasi/pengganti', { attendanceId: m.attendanceId, replacesAccountId: m.replacesAccountId });
    if (!hasil.ok) return hasil;
    const ulang = Number(hasil.data?.reevaluated) || 0;
    return { ok: true, jawaban: `Tercatat: ${m.pengganti} menggantikan ${m.digantikan}.${ulang ? ` ${ulang} penilaian shift dihitung ulang.` : ''}` };
  }
});

// --- pengumuman -------------------------------------------------------------------------------

export const pasangPengumuman = Object.freeze({
  nama: 'pasang_pengumuman', lingkup: 'gerai',
  petunjuk: 'MEMASANG pengumuman di papan pengumuman CS (Portal Staf), untuk gerai panel atau semua gerai, mis. "umumkan ke semua CS: mulai besok QRIS wajib diklaim".',
  skema: {
    pu_judul: { type: 'string', description: 'pasang_pengumuman: judul pendek. Kalau Bos tidak menyebut judul, ringkas isi jadi judul maks 8 kata.' },
    pu_isi: { type: 'string', description: 'pasang_pengumuman: isi pengumuman PERSIS seperti diucapkan Bos (boleh dirapikan ejaannya, jangan ditambah).' },
    pu_semua_gerai: { type: 'boolean', description: 'pasang_pengumuman: true bila untuk semua gerai / semua CS.' }
  },
  async siapkan(t, ctx) {
    const isi = String(t?.pu_isi ?? '').trim();
    if (!isi) return { ok: false, kurang: 'pu_isi', tanya: 'Isi pengumumannya apa?' };
    if (isi.length > 5000) return { ok: false, tanya: 'Isi pengumuman maks 5.000 huruf.' };
    const judul = teks(t?.pu_judul, 200) || teks(isi.split(/[.\n]/)[0], 80);
    const semua = t?.pu_semua_gerai === true;
    return {
      ok: true,
      draft: {
        aksi: 'pasang_pengumuman',
        judul: 'Pasang pengumuman CS — dicek dulu ya:',
        baris: [['Judul', judul], ['Untuk', semua ? 'Semua gerai di entity' : ctx.namaLingkup], ['Isi', isi]],
        dampak: [
          'Langsung tampil di Portal Staf (tab Pengumuman) dengan angka merah untuk CS yang belum membaca.',
          'Isi yang sudah tayang tidak bisa diedit, hanya bisa dinonaktifkan dari layar Pengumuman.',
          ...(semua ? ['Pengumuman semua gerai hanya bisa dibuat Owner / Entity Admin.'] : [])
        ],
        muatan: { title: judul, body: isi, entityWide: semua }
      }
    };
  },
  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/admin/announcements', draft.muatan);
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Pengumuman "${draft.muatan.title}" sudah tayang di papan CS.` };
  }
});

// --- draft SP ---------------------------------------------------------------------------------

const MAKS_BUKTI_SURAT = 31;

/** Isi surat dari fakta rekap (fungsi murni). Hanya baris yang ada angkanya yang ditulis. */
export function susunIsiSurat({ kop, gerai, tingkat, hariIni, nama, dari, sampai, fakta, berlakuHari }) {
  const rinci = [
    fakta.telatMenit > 0 && `- Datang terlambat total ${fakta.telatMenit} menit`,
    fakta.pulangAwalMenit > 0 && `- Pulang sebelum jam shift total ${fakta.pulangAwalMenit} menit`,
    fakta.kosongMenit > 0 && `- Gerai tidak terjaga total ${fakta.kosongMenit} menit`,
    fakta.denda > 0 && `- Denda gerai kosong tercatat ${fakta.denda} kali`,
    fakta.lupaPulang > 0 && `- Lupa presensi pulang ${fakta.lupaPulang} kali`
  ].filter(Boolean);
  const tanggal = [...new Set((fakta.bukti || []).map((b) => b.businessDate).filter(Boolean))].sort();
  return [
    kop || gerai,
    '',
    tingkat,
    `Tanggal: ${tanggalPanjang(hariIni)}`,
    `Kepada: ${nama} (CS ${gerai})`,
    '',
    `Berdasarkan catatan presensi dan penilaian shift periode ${tanggalPanjang(dari)} sampai ${tanggalPanjang(sampai)}:`,
    ...rinci,
    `(${fakta.kejadian} shift bermasalah${tanggal.length ? `: ${tanggal.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7)).join(', ')}` : ''})`,
    '',
    `Surat ini berlaku ${berlakuHari} hari sejak disetujui. Mohon memperbaiki kedisiplinan dan memberi tahu admin lebih awal bila berhalangan.`,
    '',
    'Disetujui oleh: ____________________ (Admin)'
  ].join('\n');
}

export const draftSp = Object.freeze({
  nama: 'draft_sp', lingkup: 'gerai',
  petunjuk: 'MENYUSUN draft surat teguran / SP untuk satu CS dari rekap masalah (telat, pulang awal, kosong, denda, lupa presensi pulang) pada periode tertentu, mis. "buatin SP buat Rika bulan ini". Disimpan DRAFT, keputusan di Admin.',
  skema: {
    sp_orang: { type: 'string', description: 'draft_sp: nama CS persis seperti diucapkan.' },
    sp_tingkat: { type: 'string', description: 'draft_sp: tingkat surat hanya bila disebut (mis. "SP1", "teguran").' },
    sp_periode: { type: 'string', enum: ['hari_ini', 'kemarin', '7_hari_terakhir', 'bulan_ini', 'bulan_lalu', 'rentang'], description: 'draft_sp: periode fakta; kosong = bulan_ini.' },
    sp_dari: { type: 'string', description: 'draft_sp: YYYY-MM-DD bila periode = rentang.' },
    sp_sampai: { type: 'string', description: 'draft_sp: YYYY-MM-DD bila periode = rentang.' }
  },
  async siapkan(t, ctx) {
    const orang = teks(t?.sp_orang, 80);
    if (!orang) return { ok: false, kurang: 'sp_orang', tanya: 'Surat untuk CS siapa?' };
    const periode = hitungPeriode(t?.sp_periode || 'bulan_ini', { dari: t?.sp_dari, sampai: t?.sp_sampai }, ctx.hariIni);
    if (!periode.ok) return { ok: false, tanya: periode.error || 'Periodenya belum jelas.' };
    const ref = await baca(ctx, '/api/admin/fina/masalah', { from: periode.dari, to: periode.sampai });
    if (!ref.ok) return ref;
    const aturan = ref.data?.aturan;
    const daftar = Array.isArray(ref.data?.employees) ? ref.data.employees : null;
    if (!daftar || !Array.isArray(aturan?.spTingkat) || !aturan.spTingkat.length) return { ok: false, error: 'Rekap masalah atau pengaturan SP belum lengkap terbaca.' };
    const cocok = cocokkanSatu(orang, daftar, { label: 'CS dengan catatan masalah', namaDari: (e) => e.name, kunciLain: (e) => [e.accountId] });
    if (!cocok.ok) {
      return { ok: false, tanya: `Tidak ada catatan masalah untuk "${orang}" di ${ctx.namaLingkup} periode ${periode.dari} s.d. ${periode.sampai}, jadi belum ada dasar untuk surat. ${cocok.tanya.includes('beberapa') ? cocok.tanya : ''}`.trim() };
    }
    const e = cocok.nilai;
    // Tingkat: yang disebut Bos (harus ada di pengaturan), atau satu di atas surat DISETUJUI yang masih berlaku.
    let tingkat;
    let catatanTingkat;
    const disebut = teks(t?.sp_tingkat, 20).toUpperCase().replace(/\s+/g, ' ');
    if (disebut) {
      tingkat = aturan.spTingkat.find((x) => x.replace(/\s+/g, '') === disebut.replace(/\s+/g, ''));
      if (!tingkat) return { ok: false, kurang: 'sp_tingkat', tanya: `Tingkat "${disebut}" tidak ada di pengaturan. Pilih salah satu: ${aturan.spTingkat.join(', ')}.` };
      catatanTingkat = 'Tingkat dipilih sesuai pesan Bos.';
    } else {
      const lama = await baca(ctx, '/api/entity-admin/fina/surat', { account: e.accountId, status: 'DISETUJUI' });
      if (!lama.ok) return lama;
      const berlaku = (lama.data?.surat || []).filter((s) => s.berlakuSampai && s.berlakuSampai >= ctx.hariIni);
      const tertinggi = Math.max(-1, ...berlaku.map((s) => aturan.spTingkat.indexOf(s.tingkat)));
      tingkat = aturan.spTingkat[Math.min(tertinggi + 1, aturan.spTingkat.length - 1)];
      catatanTingkat = tertinggi < 0
        ? `Belum ada surat yang masih berlaku, jadi mulai dari ${tingkat}.`
        : `Surat ${aturan.spTingkat[tertinggi]} masih berlaku, jadi naik ke ${tingkat}.`;
    }
    const fakta = { ...e, bukti: (e.bukti || []).slice(0, MAKS_BUKTI_SURAT) };
    const isi = susunIsiSurat({
      kop: aturan.kopSurat, gerai: ctx.namaLingkup, tingkat, hariIni: ctx.hariIni, nama: e.name,
      dari: periode.dari, sampai: periode.sampai, fakta, berlakuHari: aturan.spBerlakuHari
    });
    return {
      ok: true,
      draft: {
        aksi: 'draft_sp',
        judul: `Draft ${tingkat} untuk ${e.name} — dicek dulu ya:`,
        baris: [['CS', e.name], ['Tingkat', tingkat], ['Periode', `${periode.dari} s.d. ${periode.sampai}`], ['Shift bermasalah', String(e.kejadian)]],
        tabel: { kolom: ['Isi surat'], isi: isi.split('\n').map((b) => [b]) },
        dampak: [
          catatanTingkat,
          'Disimpan sebagai DRAFT di Entity Admin → Pengaturan → Surat Fina. Belum dikirim ke CS; berlaku setelah Admin menekan Setujui.',
          'Fakta diambil dari rekap masalah CS yang sama; tidak memotong gaji.'
        ],
        muatan: { storeCode: ctx.storeCode, accountId: e.accountId, tingkat, periodeDari: periode.dari, periodeSampai: periode.sampai, fakta, isi }
      }
    };
  },
  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/entity-admin/fina/surat', draft.muatan);
    if (!hasil.ok) return hasil;
    return {
      ok: true,
      jawaban: hasil.data?.duplicate
        ? 'Draft surat yang sama sudah ada, tidak dibuat dua kali. Cek di Entity Admin → Pengaturan → Surat Fina.'
        : `Draft ${draft.muatan.tingkat} tersimpan. Admin bisa memeriksa dan menekan Setujui di Entity Admin → Pengaturan → Surat Fina.`
    };
  }
});

// --- draft loker (H4) --------------------------------------------------------------------------

/** Teks loker + caption Instagram/Facebook dari isian (fungsi murni, templat tetap, tanpa model). */
export function susunTeksLoker({ usaha, gerai, posisi, jamKerja, gajiTeks, syarat, deskripsi }) {
  const daftar = (judul, isi) => (isi
    ? [`${judul}:`, ...String(isi).split(/\n|;/).map((x) => x.trim().replace(/^[-•]\s*/, '')).filter(Boolean).map((x) => `- ${x}`)]
    : []);
  const loker = [
    `LOWONGAN KERJA: ${posisi.toUpperCase()}`,
    [usaha, gerai].filter(Boolean).join(' · '),
    '',
    ...(deskripsi ? [deskripsi, ''] : []),
    ...daftar('Syarat', syarat),
    ...(jamKerja ? [`Jam kerja: ${jamKerja}`] : []),
    ...(gajiTeks ? [`Gaji: ${gajiTeks}`] : []),
    '',
    'Lamar lewat tautan lowongan (form singkat, gratis).'
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const caption = [
    `Dicari ${posisi} untuk ${gerai || usaha || 'tim kami'}!`,
    ...(jamKerja ? [`Jam kerja ${jamKerja}.`] : []),
    ...(gajiTeks ? [`Gaji ${gajiTeks}.`] : []),
    'Info & daftar: tautan di bio / komentar.',
    `#lowongankerja #loker #loker${posisi.toLowerCase().replace(/[^a-z0-9]+/g, '')}`
  ].join('\n');
  return { loker, caption };
}

export const draftLoker = Object.freeze({
  nama: 'draft_loker', lingkup: 'gerai',
  petunjuk: 'MENYUSUN lowongan kerja (teks loker + caption Instagram/Facebook untuk posting manual) untuk gerai panel, mis. "buatin loker CS shift pagi, jam 07-15, gaji 1,5jt, syarat jujur; bisa HP". Disimpan DRAFT; tayang setelah Admin menekan Tayangkan.',
  skema: {
    lk_posisi: { type: 'string', description: 'draft_loker: posisi PERSIS seperti diucapkan, mis. "CS shift pagi".' },
    lk_jam: { type: 'string', description: 'draft_loker: jam kerja seperti diucapkan, kalau disebut.' },
    lk_gaji: { type: 'string', description: 'draft_loker: gaji seperti diucapkan (teks), kalau disebut. Jangan mengarang.' },
    lk_syarat: { type: 'string', description: 'draft_loker: syarat seperti diucapkan, dipisah titik koma, kalau disebut.' },
    lk_deskripsi: { type: 'string', description: 'draft_loker: deskripsi tugas seperti diucapkan, kalau disebut.' }
  },
  async siapkan(t, ctx) {
    const posisi = teks(t?.lk_posisi, 80);
    if (!posisi) return { ok: false, kurang: 'lk_posisi', tanya: 'Lowongan untuk posisi apa?' };
    const isian = { posisi, jamKerja: teks(t?.lk_jam, 200), gajiTeks: teks(t?.lk_gaji, 120), syarat: teks(t?.lk_syarat, 2000), deskripsi: teks(t?.lk_deskripsi, 2000) };
    const { loker, caption } = susunTeksLoker({ usaha: '', gerai: ctx.namaLingkup, ...isian });
    return {
      ok: true,
      draft: {
        aksi: 'draft_loker',
        judul: `Draft lowongan ${posisi} — dicek dulu ya:`,
        baris: [['Posisi', posisi], ['Gerai', ctx.namaLingkup], ['Jam kerja', isian.jamKerja || '-'], ['Gaji', isian.gajiTeks || '- (tidak ditulis)']],
        tabel: { kolom: ['Teks loker', 'Caption Instagram / Facebook (posting manual)'], isi: [[loker, caption]] },
        dampak: [
          'Disimpan sebagai lowongan DRAFT di Entity Admin → Pengaturan → Rekrutmen Fina. Belum tayang ke umum.',
          'Admin menekan Tayangkan supaya halaman lamaran /loker bisa dibuka pelamar.',
          'Instagram/Facebook belum tersambung otomatis (akun Meta dibatasi): salin caption dan posting manual.'
        ],
        muatan: { storeCode: ctx.storeCode, posisi, jamKerja: isian.jamKerja, gajiTeks: isian.gajiTeks, syarat: isian.syarat, deskripsi: isian.deskripsi }
      }
    };
  },
  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/entity-admin/fina/lowongan', draft.muatan);
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Draft lowongan ${draft.muatan.posisi} tersimpan (belum tayang). Tayangkan dari Entity Admin → Pengaturan → Rekrutmen Fina; tautannya /loker?l=${hasil.data?.slug || ''}.` };
  }
});

// --- WA Fina (gateway lokal, migration 0184) ------------------------------------------------------
// Alat-alat ini tidak pernah memegang nomor lengkap: rute khususnya mengembalikan nomor tersamar, dan
// server mencari nomor asli saat menyimpan / mengirim. Isi pesan dari orang asing tidak dibawa ke model.
// Pesan keluar baru dikirim gateway setelah "Ya" (dan tetap kena batas kirim server).

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const hariTanggal = (iso) => `${HARI[new Date(`${iso}T00:00:00Z`).getUTCDay()]}, ${tanggalPanjang(iso)}`;

function tanggalJanji(tertulis, hariIni) {
  const t = teks(tertulis, 10);
  if (!TANGGAL.test(t)) return { ok: false, tanya: 'Tanggal berapa? (tulis YYYY-MM-DD atau sebut "besok")' };
  if (t < hariIni) return { ok: false, tanya: 'Tanggalnya sudah lewat. Tanggal berapa jadinya?' };
  return { ok: true, nilai: t };
}

async function geraiDari(t, ctx, kunci) {
  const diminta = teks(t?.[kunci], 60);
  if (!diminta) {
    if (ctx.lingkup === 'entity' || !ctx.storeCode) return { ok: false, kurang: kunci, tanya: 'Di gerai mana?' };
    return { ok: true, nilai: { code: ctx.storeCode, storeName: ctx.namaLingkup } };
  }
  for (const path of ['/api/entity-admin/stores', '/api/owner/stores']) {
    const ref = await baca(ctx, path);
    const stores = ref.ok ? (ref.data?.stores ?? []).filter((s) => s.isActive !== false) : null;
    if (!stores) continue;
    const cocok = cocokkanSatu(diminta, stores, { label: 'gerai', namaDari: (s) => s.storeName || s.name || s.code, kunciLain: (s) => [s.code] });
    return cocok.ok ? { ok: true, nilai: { code: cocok.nilai.code, storeName: cocok.nilai.storeName || cocok.nilai.name || cocok.nilai.code } } : { ...cocok, kurang: kunci };
  }
  return { ok: false, kurang: kunci, tanya: 'Daftar gerai belum terbaca. Pilih gerainya di kepala panel ya.' };
}

export const catatPelamarDariWa = Object.freeze({
  nama: 'catat_pelamar_dari_wa', lingkup: 'semua',
  petunjuk: 'MENCATAT pengirim WA yang belum dikenal (yang melamar lewat WA HR) ke data pelamar, mis. "masukin yang chat WA lamar kerja ke data pelamar", "catat pelamar dari WA untuk CS Beji".',
  skema: {
    cw_nama: { type: 'string', description: 'catat_pelamar_dari_wa: nama pengirim tertentu, hanya bila disebut.' },
    cw_posisi: { type: 'string', description: 'catat_pelamar_dari_wa: posisi yang dilamar, bila disebut.' },
    cw_gerai: { type: 'string', description: 'catat_pelamar_dari_wa: gerai tujuan, bila disebut.' }
  },
  async siapkan(t, ctx) {
    const ref = await baca(ctx, '/api/entity-admin/fina/wa/calon-pelamar');
    if (!ref.ok) return ref;
    let calon = Array.isArray(ref.data?.calon) ? ref.data.calon : [];
    const nama = teks(t?.cw_nama, 80);
    if (nama) calon = calon.filter((c) => String(c.namaWa).toLowerCase().includes(nama.toLowerCase()));
    if (!calon.length) return { ok: false, tanya: nama ? `Tidak ada pengirim WA baru bernama "${nama}" (30 hari terakhir).` : 'Tidak ada pengirim WA baru yang belum dicatat (30 hari terakhir). Pesan baru masuk kalau gateway WA di laptop tersambung.' };
    let gerai = null;
    if (teks(t?.cw_gerai, 60)) { const g = await geraiDari(t, ctx, 'cw_gerai'); if (!g.ok) return g; gerai = g.nilai; }
    const posisi = teks(t?.cw_posisi, 80);
    return {
      ok: true,
      draft: {
        aksi: 'catat_pelamar_dari_wa',
        judul: `Catat ${calon.length} pengirim WA ke data pelamar — dicek dulu ya:`,
        baris: [['Posisi', posisi || '-'], ['Gerai tujuan', gerai?.storeName || '-']],
        tabel: { kolom: ['Nama di WA', 'Nomor', 'Pesan', 'Terakhir'], isi: calon.map((c) => [c.namaWa, c.nomorSamar, String(c.jumlahPesan), String(c.terakhir || '').slice(0, 16)]) },
        dampak: [
          'Masuk ke Karyawan → Pelamar dengan sumber WA dan status Baru; isi pesannya disalin ke catatan.',
          'Nomor yang sudah ada di data pelamar dilewati. Baca isi pesannya dulu di Kotak masuk WA kalau ragu itu lamaran.',
          'Nama bisa dibetulkan nanti di data pelamar.'
        ],
        muatan: { daftar: calon.map((c) => ({ kunci: c.kunci, nama: c.namaWa })), posisi, storeCode: gerai?.code || '' }
      }
    };
  },
  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/entity-admin/fina/wa/jadikan-pelamar', draft.muatan);
    if (!hasil.ok) return hasil;
    const lewat = hasil.data?.dilewati?.length ? ` ${hasil.data.dilewati.length} dilewati karena sudah ada.` : '';
    return { ok: true, jawaban: `${hasil.data?.dibuat ?? 0} pelamar baru dicatat dari WA.${lewat}` };
  }
});

export const undangPelamar = Object.freeze({
  nama: 'undang_pelamar', lingkup: 'semua',
  petunjuk: 'MENGIRIM WA undangan interview atau training ke pelamar untuk gerai, tanggal, dan jam tertentu, mis. "undang Rani interview di Beji besok jam 10", "ajak Sari training di Pendem tanggal 25 jam 14".',
  skema: {
    up_pelamar: { type: 'string', description: 'undang_pelamar: nama pelamar PERSIS seperti diucapkan.' },
    up_jenis: { type: 'string', enum: ['interview', 'training'], description: 'undang_pelamar: interview atau training.' },
    up_gerai: { type: 'string', description: 'undang_pelamar: gerai tempat interview/training, bila disebut.' },
    up_tanggal: { type: 'string', description: 'undang_pelamar: YYYY-MM-DD.' },
    up_jam: { type: 'string', description: 'undang_pelamar: jam HH:MM.' },
    up_catatan: { type: 'string', description: 'undang_pelamar: pesan tambahan dari Bos (mis. bawa KTP), bila disebut.' }
  },
  async siapkan(t, ctx) {
    if (!teks(t?.up_pelamar, 80)) return { ok: false, kurang: 'up_pelamar', tanya: 'Pelamar siapa yang diundang?' };
    const jenis = t?.up_jenis === 'training' ? 'training' : t?.up_jenis === 'interview' ? 'interview' : '';
    if (!jenis) return { ok: false, kurang: 'up_jenis', tanya: 'Untuk interview atau training?' };
    const tanggal = tanggalJanji(t?.up_tanggal, ctx.hariIni);
    if (!tanggal.ok) return { ...tanggal, kurang: 'up_tanggal' };
    if (!JAM.test(teks(t?.up_jam, 5))) return { ok: false, kurang: 'up_jam', tanya: 'Jam berapa? (mis. 10:00)' };
    const ref = await baca(ctx, '/api/entity-admin/fina/wa/pelamar-ringkas');
    if (!ref.ok) return ref;
    const cocok = cocokkanSatu(t.up_pelamar, ref.data?.pelamar ?? [], { label: 'pelamar', namaDari: (p) => p.nama });
    if (!cocok.ok) return { ...cocok, kurang: 'up_pelamar' };
    const gerai = await geraiDari(t, ctx, 'up_gerai');
    if (!gerai.ok) return gerai;
    const p = cocok.nilai;
    const catatan = teks(t?.up_catatan, 200);
    const pesan = `Halo ${p.nama}, terima kasih sudah melamar${p.posisi ? ` sebagai ${p.posisi}` : ''}. Kami mengundang ${p.nama} untuk ${jenis} di gerai ${gerai.nilai.storeName} pada ${hariTanggal(tanggal.nilai)} pukul ${t.up_jam} WIB.${catatan ? ` ${catatan}` : ''} Mohon balas YA untuk konfirmasi. Terima kasih.`;
    return {
      ok: true,
      draft: {
        aksi: 'undang_pelamar',
        judul: `Kirim WA undangan ${jenis} ke ${p.nama} — dicek dulu ya:`,
        baris: [['Pelamar', `${p.nama} (${p.nomorSamar})`], ['Keperluan', jenis], ['Gerai', gerai.nilai.storeName], ['Waktu', `${hariTanggal(tanggal.nilai)} ${t.up_jam} WIB`]],
        tabel: { kolom: ['Pesan WA'], isi: [[pesan]] },
        dampak: [
          'Sesudah "Ya", pesan masuk antrean dan dikirim gateway WA di laptop (laptop harus menyala).',
          'Status pelamar tidak diubah otomatis; ubah di Karyawan → Pelamar sesudah ada konfirmasi.',
          'Kabari CS gerai untuk mendampingi bila perlu (minta Fina "kabari CS").'
        ],
        muatan: { pelamarId: p.id, teks: pesan, keperluan: `UNDANGAN_${jenis.toUpperCase()}`, setujui: true }
      }
    };
  },
  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/entity-admin/fina/wa/keluar', draft.muatan);
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Undangan masuk antrean WA untuk ${hasil.data?.tujuan?.nama ?? 'pelamar'}.${hasil.data?.catatan ? ` ${hasil.data.catatan}` : ''}` };
  }
});

export const kabariCsTraining = Object.freeze({
  nama: 'kabari_cs_training', lingkup: 'semua',
  petunjuk: 'MENGIRIM WA ke CS gerai untuk janjian mendampingi training calon karyawan, mis. "kabari Avinda di Beji besok jam 14 ada training Rani".',
  skema: {
    kc_cs: { type: 'string', description: 'kabari_cs_training: nama CS yang dikabari PERSIS seperti diucapkan.' },
    kc_pelamar: { type: 'string', description: 'kabari_cs_training: nama calon karyawan yang training.' },
    kc_gerai: { type: 'string', description: 'kabari_cs_training: gerai, bila disebut.' },
    kc_tanggal: { type: 'string', description: 'kabari_cs_training: YYYY-MM-DD.' },
    kc_jam: { type: 'string', description: 'kabari_cs_training: jam HH:MM.' },
    kc_catatan: { type: 'string', description: 'kabari_cs_training: pesan tambahan, bila disebut.' }
  },
  async siapkan(t, ctx) {
    if (!teks(t?.kc_cs, 80)) return { ok: false, kurang: 'kc_cs', tanya: 'CS siapa yang dikabari?' };
    if (!teks(t?.kc_pelamar, 80)) return { ok: false, kurang: 'kc_pelamar', tanya: 'Siapa yang training?' };
    const tanggal = tanggalJanji(t?.kc_tanggal, ctx.hariIni);
    if (!tanggal.ok) return { ...tanggal, kurang: 'kc_tanggal' };
    if (!JAM.test(teks(t?.kc_jam, 5))) return { ok: false, kurang: 'kc_jam', tanya: 'Jam berapa trainingnya? (mis. 14:00)' };
    const gerai = await geraiDari(t, ctx, 'kc_gerai');
    if (!gerai.ok) return gerai;
    const ref = await baca(ctx, '/api/entity-admin/fina/wa/kontak-cs', { store: gerai.nilai.code });
    if (!ref.ok) return ref;
    const cocok = cocokkanSatu(t.kc_cs, ref.data?.cs ?? [], { label: `CS ${gerai.nilai.storeName}`, namaDari: (c) => c.nama });
    if (!cocok.ok) return { ...cocok, kurang: 'kc_cs' };
    if (!cocok.nilai.adaNomor) return { ok: false, tanya: `Nomor HP ${cocok.nilai.nama} belum diisi di data karyawan. Lengkapi dulu di menu Karyawan.` };
    const catatan = teks(t?.kc_catatan, 200);
    const pesan = `Halo ${cocok.nilai.nama}, ${hariTanggal(tanggal.nilai)} pukul ${t.kc_jam} WIB ada training calon karyawan ${teks(t.kc_pelamar, 80)} di gerai ${gerai.nilai.storeName}. Mohon didampingi ya.${catatan ? ` ${catatan}` : ''} Terima kasih.`;
    return {
      ok: true,
      draft: {
        aksi: 'kabari_cs_training',
        judul: `Kirim WA ke ${cocok.nilai.nama} soal training — dicek dulu ya:`,
        baris: [['CS', cocok.nilai.nama], ['Gerai', gerai.nilai.storeName], ['Waktu', `${hariTanggal(tanggal.nilai)} ${t.kc_jam} WIB`], ['Calon karyawan', teks(t.kc_pelamar, 80)]],
        tabel: { kolom: ['Pesan WA'], isi: [[pesan]] },
        dampak: ['Sesudah "Ya", pesan masuk antrean dan dikirim gateway WA di laptop (laptop harus menyala).', 'Jadwal shift CS tidak diubah; atur di jadwal kasir bila perlu.'],
        muatan: { employeeId: cocok.nilai.employeeId, teks: pesan, keperluan: 'TRAINING_CS', setujui: true }
      }
    };
  },
  async posting(draft, ctx) {
    const hasil = await ctx.kirim('POST', '/api/entity-admin/fina/wa/keluar', draft.muatan);
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Pesan untuk ${hasil.data?.tujuan?.nama ?? 'CS'} masuk antrean WA.${hasil.data?.catatan ? ` ${hasil.data.catatan}` : ''}` };
  }
});


// --- nilai ulang dana apresiasi & CS berhenti (2026-10-22) -------------------------------------
// Laporan admin Bos Cyo: denda/potongan CS yang sudah resign (Indah), fee backup dari presensi basi
// (Ade/Dermo, Adenia/Mandala), potongan karena jadwal kerja salah (Ade/Pendem). "hr fina ... harusnya
// bisa nyelesaiin ini": Fina memakai tombol yang sama dengan Entity Admin -> Dana Apresiasi (Nilai ulang,
// Berhenti per tanggal), dengan pratinjau angka di draft. Jurnal dibalik oleh rute itu sendiri.

const APR = '/api/entity-admin/dana-apresiasi';
const rpBertanda = (n) => `${Number(n) < 0 ? '−' : '+'}Rp${Math.abs(Number(n) || 0).toLocaleString('id-ID')}`;
const totalRp = (list) => list.reduce((sum, row) => sum + (Number(row.amountRupiah) || 0), 0);

async function penilaianCs(ctx, nama, dari, sampai) {
  const ref = await baca(ctx, `${APR}/rekap`, { from: dari, to: sampai });
  if (!ref.ok) return ref;
  const semua = (Array.isArray(ref.data?.evaluations) ? ref.data.evaluations : [])
    .filter((item) => !ctx.storeCode || item.storeCode === ctx.storeCode);
  const orang = [...new Map(semua.map((item) => [item.accountId, { accountId: item.accountId, name: item.accountName }])).values()];
  if (!orang.length) return { ok: false, tanya: `Belum ada shift yang dinilai Dana Apresiasi di ${ctx.namaLingkup} antara ${dari} dan ${sampai}.` };
  const cocok = cocokkanSatu(nama, orang, { label: 'CS', namaDari: (o) => o.name, kunciLain: (o) => [o.accountId] });
  if (!cocok.ok) return cocok;
  return { ok: true, cs: cocok.nilai, penilaian: semua.filter((item) => item.accountId === cocok.nilai.accountId) };
}

export const nilaiUlangApresiasi = Object.freeze({
  nama: 'nilai_ulang_apresiasi', lingkup: 'gerai',
  petunjuk: 'MENILAI ULANG potongan apresiasi / denda / fee backup seorang CS pada tanggal tertentu dengan jadwal kerja dan presensi TERBARU, mis. sesudah jadwal kerjanya dibetulkan atau presensinya dikoreksi: "potongan Ade tanggal 19 salah, jadwalnya sudah dibetulkan", "nilai ulang apresiasi Adenia 18 Oktober".',
  skema: {
    nu_nama: { type: 'string', description: 'nilai_ulang_apresiasi: nama CS persis seperti diucapkan.' },
    nu_dari: { type: 'string', description: 'nilai_ulang_apresiasi: YYYY-MM-DD tanggal (awal) yang disebut.' },
    nu_sampai: { type: 'string', description: 'nilai_ulang_apresiasi: YYYY-MM-DD tanggal akhir bila disebut rentang; kosong = sama dengan tanggal awal.' }
  },
  async siapkan(t, ctx) {
    if (!teks(t?.nu_nama, 80)) return { ok: false, kurang: 'nu_nama', tanya: 'Apresiasi CS siapa yang mau dinilai ulang?' };
    if (!teks(t?.nu_dari, 10)) return { ok: false, kurang: 'nu_dari', tanya: 'Tanggal berapa?' };
    const dari = tanggalDari(t.nu_dari, ctx.hariIni);
    if (!dari.ok) return { ...dari, kurang: 'nu_dari' };
    const sampai = teks(t?.nu_sampai, 10) ? tanggalDari(t.nu_sampai, ctx.hariIni) : dari;
    if (!sampai.ok) return { ...sampai, kurang: 'nu_sampai' };
    const data = await penilaianCs(ctx, t.nu_nama, dari.nilai, sampai.nilai);
    if (!data.ok) return data;
    const berubah = [];
    for (const item of data.penilaian) {
      const pratinjau = await ctx.kirim('POST', `${APR}/nilai-ulang`, { evaluationId: item.id, dryRun: true });
      if (!pratinjau.ok) return pratinjau;
      if (pratinjau.data?.changed) berubah.push({ item, p: pratinjau.data });
    }
    if (!berubah.length) return { ok: false, tanya: `Dengan jadwal dan presensi terbaru, apresiasi ${data.cs.name} ${dari.nilai}${sampai.nilai !== dari.nilai ? `–${sampai.nilai}` : ''} tetap sama. Kalau jadwal kerjanya yang salah, betulkan dulu jadwalnya di Akun Kasir, lalu minta Fina lagi.` };
    return {
      ok: true,
      draft: {
        aksi: 'nilai_ulang_apresiasi',
        judul: `Fina mau menilai ulang Dana Apresiasi ${data.cs.name} — dicek dulu ya:`,
        baris: berubah.map(({ item, p }) => [`${item.businessDate} · shift ${p.shift}`, `${rpBertanda(totalRp(p.lama))} → ${rpBertanda(totalRp(p.baru))}`]),
        dampak: [
          'Dinilai dengan jadwal kerja dan presensi yang tercatat SEKARANG. Baris lama dibatalkan dan jurnalnya dibalik; baris baru dicatat di Riwayat Gaji dan Akuntansi.',
          'Sama dengan tombol "Nilai ulang" di Entity Admin → Dana Apresiasi → Rekap.'
        ],
        muatan: { evaluationIds: berubah.map(({ item }) => item.id), nama: data.cs.name }
      }
    };
  },
  async posting(draft, ctx) {
    let jumlah = 0;
    for (const evaluationId of draft.muatan.evaluationIds) {
      const hasil = await ctx.kirim('POST', `${APR}/nilai-ulang`, { evaluationId, reason: 'Dinilai ulang lewat Fina' });
      if (!hasil.ok) return jumlah ? { ok: false, error: `${jumlah} shift sudah dinilai ulang, sisanya gagal: ${hasil.error}` } : hasil;
      jumlah += 1;
    }
    return { ok: true, jawaban: `Sudah: ${jumlah} shift ${draft.muatan.nama} dinilai ulang, jurnalnya ikut dibetulkan.` };
  }
});

export const csBerhenti = Object.freeze({
  nama: 'cs_berhenti', lingkup: 'gerai',
  petunjuk: 'MENCATAT CS yang berhenti/resign per tanggal untuk Dana Apresiasi: shift sesudahnya tidak dinilai, potongan/denda yang terlanjur tercatat dibatalkan. Mis. "Indah sudah resign per 18 Oktober, hapus dendanya".',
  skema: {
    cb_nama: { type: 'string', description: 'cs_berhenti: nama CS persis seperti diucapkan.' },
    cb_tanggal: { type: 'string', description: 'cs_berhenti: YYYY-MM-DD tanggal mulai berhenti (hari pertama tidak bekerja lagi).' }
  },
  async siapkan(t, ctx) {
    if (!teks(t?.cb_nama, 80)) return { ok: false, kurang: 'cb_nama', tanya: 'Siapa yang berhenti?' };
    if (!teks(t?.cb_tanggal, 10)) return { ok: false, kurang: 'cb_tanggal', tanya: 'Berhenti mulai tanggal berapa?' };
    const tanggal = tanggalDari(t.cb_tanggal, ctx.hariIni);
    if (!tanggal.ok) return { ...tanggal, kurang: 'cb_tanggal' };
    const ref = await baca(ctx, `${APR}/settings`);
    if (!ref.ok) return ref;
    const gerai = (ref.data?.stores || []).find((store) => !ctx.storeCode || store.storeCode === ctx.storeCode);
    const akun = (gerai?.accounts || []).map((a) => ({ accountId: a.id, name: a.name || a.username, berhenti: a.berhentiTanggal || null }));
    const cocok = cocokkanSatu(t.cb_nama, akun, { label: 'akun CS', namaDari: (a) => a.name, kunciLain: (a) => [a.accountId] });
    if (!cocok.ok) return cocok;
    const cs = cocok.nilai;
    if (cs.berhenti === tanggal.nilai) return { ok: false, tanya: `${cs.name} sudah tercatat berhenti per ${tanggal.nilai}.` };
    const data = await penilaianCs(ctx, cs.accountId, tanggal.nilai, ctx.hariIni);
    const batal = [];
    if (data.ok) {
      for (const item of data.penilaian) {
        const p = await ctx.kirim('POST', `${APR}/nilai-ulang`, { evaluationId: item.id, dryRun: true });
        if (p.ok && p.data?.changed) batal.push([item.businessDate, `${rpBertanda(totalRp(p.data.lama))} → ${rpBertanda(totalRp(p.data.baru))}`]);
      }
    }
    return {
      ok: true,
      draft: {
        aksi: 'cs_berhenti',
        judul: `Fina mau mencatat ${cs.name} berhenti per ${tanggal.nilai} — dicek dulu ya:`,
        baris: [['CS', cs.name], ['Berhenti mulai', tanggal.nilai], ...batal.map(([tgl, ubah]) => [`Dibatalkan ${tgl}`, ubah])],
        dampak: [
          'Shift mulai tanggal itu tidak dinilai Dana Apresiasi lagi; potongan/denda yang terlanjur tercatat dibatalkan dan jurnalnya dibalik.',
          'Akun login kasirnya tidak dinonaktifkan oleh Fina: nonaktifkan di Akun Kasir bila perlu.'
        ],
        muatan: { accountId: cs.accountId, tanggal: tanggal.nilai, nama: cs.name }
      }
    };
  },
  async posting(draft, ctx) {
    const m = draft.muatan;
    const hasil = await ctx.kirim('POST', `${APR}/berhenti`, { accountId: m.accountId, tanggal: m.tanggal });
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Tercatat: ${m.nama} berhenti per ${m.tanggal}.${hasil.data?.reevaluated ? ` ${hasil.data.reevaluated} shift dibatalkan/dinilai ulang.` : ''}` };
  }
});

export const AKSI_FINA_TULIS = Object.freeze([siapkanTawaranBackup, catatPengganti, pasangPengumuman, draftSp, draftLoker, catatPelamarDariWa, undangPelamar, kabariCsTraining, nilaiUlangApresiasi, csBerhenti]);

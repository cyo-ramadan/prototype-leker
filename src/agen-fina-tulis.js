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

export const AKSI_FINA_TULIS = Object.freeze([siapkanTawaranBackup, catatPengganti, pasangPengumuman, draftSp]);

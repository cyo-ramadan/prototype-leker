// Alat baca Una untuk urusan karyawan (Bos Cyo 2026-10-10, uji karyawan: "bagaimana
// cara mengetahui setoran cs yang masih dibawa?"). Panduan caranya ada di kamus
// (src/caca-jelaskan.js); alat ini menjawab ANGKANYA langsung dari layar Setoran CS
// (GET /api/admin/employee-deposits/overview — sumber yang sama dengan tab Setoran CS,
// saldo menurut buku Akuntansi, ADR-054). Hanya membaca; ACC tetap di layarnya.
// Saldo boleh negatif (setoran lebih) dan ditampilkan apa adanya (invariant #8).

import { tampilSkala } from './caca-hitung.js';
import { cocokkanSatu, normalkan, rupiahDari, tanggalDari, teks, TANGGAL } from './caca-aksi-dasar.js';
import { rupiah } from './caca-nominal.js';
import { adaJadwal, keJadwalServer, NAMA_HARI, potongJadwal, teksHari, uraiJadwal, URUT_TAMPIL } from './caca-jadwal.js';

const skala = (rupiah) => BigInt(Math.round(Number(rupiah || 0) * 1_000_000));
const rp = (nilaiSkala) => `Rp${tampilSkala(nilaiSkala)}`;

export const cekSetoranCs = Object.freeze({
  nama: 'cek_setoran_cs',
  lingkup: 'gerai',
  baca: true,
  petunjuk: 'MELIHAT setoran CS/kasir: siapa yang masih membawa uang setoran laci (belum disetor ke kantor), berapa sisanya, dan yang menunggu ACC, mis. "setoran cs yang masih dibawa siapa aja?", "piutang setoran rika berapa?".',
  skema: {},

  async siapkan(_t, ctx) {
    const ref = await ctx.baca('/api/admin/employee-deposits/overview');
    if (!ref.ok) return ref;
    const gerai = ctx.namaLingkup || 'gerai ini';
    const saldo = (ref.data?.balances ?? []).map((b) => ({
      nama: b.employeeName || '(tanpa nama)',
      sisa: skala(b.balanceRupiah),
      menunggu: skala(b.pendingAmountRupiah),
      belumBuku: skala(b.belumMasukBukuRupiah)
    })).filter((b) => b.sisa !== 0n || b.menunggu !== 0n);
    const antre = (ref.data?.pending ?? []).length;
    if (!saldo.length) {
      return {
        ok: true,
        jawaban: `Di ${gerai} tidak ada CS yang masih membawa setoran${antre ? `, tapi ada ${antre} setoran yang menunggu ACC` : ''}.`,
        tawaran: [{ jenis: 'buka', layar: 'setoran-cs', label: 'Buka Setoran CS' }]
      };
    }
    const total = saldo.reduce((n, b) => n + b.sisa, 0n);
    return {
      ok: true,
      jawaban: `Setoran yang masih dibawa CS di ${gerai}: total ${rp(total)} dari ${saldo.length} orang${antre ? `; ${antre} bukti transfer menunggu ACC` : ''}.`,
      tabel: {
        kolom: ['CS', 'Masih dibawa', 'Menunggu ACC'],
        isi: saldo.map((b) => [b.nama, rp(b.sisa), b.menunggu ? rp(b.menunggu) : '—'])
      },
      tawaran: [{ jenis: 'buka', layar: 'setoran-cs', label: 'Buka Setoran CS' }]
    };
  }
});


// --- alat tulis karyawan (Bos Cyo 2026-10-10) --------------------------------
// "pastikan una juga bisa mengerjakan yang apabila ditanya mekanismenya aja juga
// bisa": yang dijelaskan panduan HR (src/caca-jelaskan.js) juga bisa dikerjakan.
// Jalurnya sama persis dengan layar Tim → Karyawan / Akun Kasir, lewat draft + "Ya".
//
// Password akun login TIDAK pernah lewat model dan tidak masuk draft: dibuat acak
// oleh server saat "Ya" ditekan, dikembalikan sebagai `rahasia` yang ditampilkan
// panel sekali dan tidak dicatat ke riwayat percakapan (riwayat dikirim ke model).

const BATAS_LABEL = String.raw`(?=\s*(?:[,;\n]|\b(?:hp|no\.?|nomor|wa|whatsapp|telp|telepon|alamat\w*|username\w*|user|login|gaji\w*|jadwal\w*|jabatan\w*|sebagai|posisi\w*|bagian|akun\w*|minggu|ahad|senin|selasa|rabu|kamis|jum'?at|sabtu|tiap|setiap|per)\b|$))`;
const NOMINAL = String.raw`(?:rp\.?\s*)?\d[\d.,]*\s*(?:rb|ribu|k|jt|juta)?(?![\w])`;

/** Nama orang dari isian model/jawaban Bos: dipotong di koma atau label berikutnya. */
function namaOrang(nilai) {
  const t = teks(nilai, 160).replace(/^["']|["']$/g, '');
  const potong = t.match(new RegExp(String.raw`^(.+?)` + BATAS_LABEL, 'i'));
  return (potong ? potong[1] : t).replace(/[.!?]+$/, '').trim().slice(0, 100);
}

const usernameDari = (nilai) => teks(nilai, 60).split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) ?? '';

/** Tanggal ucapan ("kemarin", "tgl 5") → YYYY-MM-DD; selain itu teks apa adanya. */
function tanggalUcapan(pesan, hariIni) {
  if (!TANGGAL.test(String(hariIni ?? ''))) return null;
  const t = String(pesan ?? '').toLowerCase();
  const geser = (hari) => new Date(Date.parse(`${hariIni}T00:00:00Z`) - hari * 86400000).toISOString().slice(0, 10);
  if (/\bkemarin\s*lusa\b/.test(t)) return geser(2);
  if (/\bkemarin\b/.test(t)) return geser(1);
  if (/\bhari\s*ini\b/.test(t)) return hariIni;
  const tgl = t.match(/\b(?:tanggal|tgl\.?)\s*(\d{1,2})\b/);
  if (tgl) {
    const [th, bl] = hariIni.split('-').map(Number);
    const hari = Number(tgl[1]);
    if (hari < 1 || hari > 31) return null;
    let kandidat = `${th}-${String(bl).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
    if (kandidat > hariIni) {
      const lalu = new Date(Date.UTC(th, bl - 2, hari));
      kandidat = lalu.toISOString().slice(0, 10);
    }
    return kandidat;
  }
  return null;
}

/** Isian berlabel karyawan/akun dari kalimat Bos. Label yang tertulis jelas MENANG. */
export function uraiPesanKaryawan(pesan) {
  const t = String(pesan ?? '').replace(/\s+/g, ' ').trim();
  const hasil = {};
  const nama = t.match(new RegExp(String.raw`\b(?:nama(?:\s*lengkap)?(?:nya)?|namanya|atas\s*nama)\s*(?:itu|adalah|:|=)?\s*([A-Za-z][A-Za-z .'-]{1,80}?)` + BATAS_LABEL, 'i'));
  if (nama && nama[1].trim().length >= 2) hasil.kr_nama = nama[1].trim();
  const hp = t.match(/\b(?:no\.?\s*hp|nomor\s*hp|hp|no\.?\s*wa|wa|whatsapp|telp|telepon)(?:nya)?\s*(?::|=)?\s*(\+?\d[\d\s-]{6,16}\d)/i);
  if (hp) hasil.kr_hp = hp[1].replace(/[\s-]/g, '');
  const alamat = t.match(/\balamat(?:nya)?\s*(?::|=|di)?\s*([^,;]{3,150})/i);
  if (alamat) hasil.kr_alamat = alamat[1].trim();
  const user = t.match(/\b(?:username|user\s*name|user|login)(?:nya)?\s*(?::|=|pakai|pake)?\s*["']?([a-z0-9._-]{3,40})/i);
  if (user && !/^(nya|kasir|baru|login|untuk|buat)$/i.test(user[1])) hasil.kr_username = user[1].toLowerCase();
  const jabatan = t.match(new RegExp(String.raw`\b(?:jabatan(?:nya)?|sebagai|posisi(?:nya)?|jenis\s*pekerjaan(?:nya)?|bagian)\s*(?::|=)?\s*([A-Za-z][A-Za-z /-]{1,40}?)` + BATAS_LABEL, 'i'));
  if (jabatan) hasil.kr_jabatan = jabatan[1].trim();
  const gaji = t.match(new RegExp(String.raw`\b(?:gaji|upah|honor)(?:nya)?(?:\s*per\s*(?:jam|sesi|shift))?\s*(?::|=)?\s*(` + NOMINAL + String.raw`(?:\s*(?:\/|per)\s*(?:jam|sesi|shift))?)`, 'i'))
    || t.match(new RegExp(`(${NOMINAL}` + String.raw`\s*(?:\/|per)\s*(?:jam|sesi|shift))`, 'i'));
  if (gaji) hasil.kr_gaji = gaji[1].trim();
  if (/\bper\s*(sesi|shift)\b/i.test(t) && hasil.kr_gaji && !/sesi|shift/i.test(hasil.kr_gaji)) hasil.kr_gaji += ' per sesi';
  const jadwal = potongJadwal(t);
  if (jadwal) hasil.kr_jadwal = jadwal;
  if (/\b(akun|login|username|user)\b/i.test(t) || hasil.kr_username || hasil.kr_jadwal || hasil.kr_gaji) hasil.kr_akun = true;
  return hasil;
}

function gabungBerlabel(t, dari) {
  const hasil = { ...t };
  for (const [k, v] of Object.entries(dari)) {
    if (k === 'kr_akun') { if (v === true) hasil.kr_akun = true; continue; }
    hasil[k] = v;
  }
  return hasil;
}

// 8 huruf dari abjad tanpa huruf kembar-rupa (0/O, 1/l/I): gampang didiktekan.
const ABJAD_PASSWORD = 'abcdefghjkmnpqrstuvwxyz23456789';
export function passwordAcak(panjang = 8) {
  const acak = new Uint8Array(panjang);
  crypto.getRandomValues(acak);
  return [...acak].map((b) => ABJAD_PASSWORD[b % ABJAD_PASSWORD.length]).join('');
}

function tabelJadwal(hari, sebelum = null) {
  return {
    kolom: sebelum ? ['Hari', 'Sebelumnya', 'Jadi'] : ['Hari', 'Jam kerja'],
    isi: URUT_TAMPIL.map((n) => (sebelum
      ? [NAMA_HARI[n], teksHari(sebelum[n]), teksHari(hari[n])]
      : [NAMA_HARI[n], teksHari(hari[n])]))
  };
}

const buatKaryawan = Object.freeze({
  nama: 'buat_karyawan',
  lingkup: 'gerai',
  petunjuk: 'MENAMBAH karyawan baru (data orang) di gerai ini, sekalian akun login kasir/CS-nya kalau diminta (username, gaji per jam/sesi, jadwal per hari), mis. "tambah karyawan Rika Nur hp 0812..., buatin akunnya username rika gaji 12rb per jam, Senin-Sabtu 09.00-17.00, Minggu libur". Juga untuk "buatin akun CS buat Rika". Password dibuat sistem.',
  skema: {
    kr_nama: { type: 'string', description: 'buat_karyawan: nama lengkap karyawan PERSIS.' },
    kr_hp: { type: 'string', description: 'buat_karyawan: nomor HP kalau disebut.' },
    kr_alamat: { type: 'string', description: 'buat_karyawan: alamat kalau disebut.' },
    kr_akun: { type: 'boolean', description: 'buat_karyawan: true kalau Bos minta dibuatkan akun login/kasir juga.' },
    kr_username: { type: 'string', description: 'buat_karyawan: username login PERSIS, kalau disebut.' },
    kr_jabatan: { type: 'string', description: 'buat_karyawan: jenis pekerjaan, mis. "CS".' },
    kr_gaji: { type: 'string', description: 'buat_karyawan: gaji PERSIS, mis. "12rb per jam" atau "50rb per sesi".' },
    kr_jadwal: { type: 'string', description: 'buat_karyawan/atur_jadwal_kasir: jadwal per hari PERSIS, mis. "Senin-Sabtu 09.00-17.00, Minggu libur".' }
  },

  isiDariPesan(t, pesan) {
    return gabungBerlabel(t, uraiPesanKaryawan(pesan));
  },

  async siapkan(t, ctx) {
    const nama = namaOrang(t?.kr_nama);
    const akunDiminta = t?.kr_akun === true || Boolean(teks(t?.kr_username, 60) || teks(t?.kr_jadwal, 400) || teks(t?.kr_gaji, 60));
    if (!nama) {
      return {
        ok: false,
        kurang: 'kr_nama',
        tanya: akunDiminta
          ? 'Akunnya untuk siapa? Sebut nama lengkap karyawannya ya.'
          : 'Siap, Una buatkan. Nama lengkap karyawannya siapa? Kalau sekalian mau dibuatkan akun login, sebut juga username, gaji per jam, dan jadwalnya (mis. "Senin–Sabtu 09.00–17.00, Minggu libur").'
      };
    }

    const ref = await ctx.baca('/api/admin/employees');
    if (!ref.ok) return ref;
    const kembar = (ref.data?.employees ?? []).filter((e) => e.status === 'ACTIVE' && normalkan(e.fullName) === normalkan(nama));
    if (kembar.length > 1) return { ok: false, tanya: `Ada ${kembar.length} karyawan bernama "${nama}". Yang mana ya? Atur akunnya dari layar Karyawan dulu.` };
    const ada = kembar[0] ?? null;
    const akunAda = ada ? (ada.links ?? []).filter((l) => !l.effectiveTo && l.accountType === 'CASHIER') : [];
    if (ada && !akunDiminta) {
      return { ok: false, kurang: 'kr_username', tanya: `${ada.fullName} sudah terdaftar sebagai karyawan. Mau Una buatkan akun login-nya? Sebut username-nya (mis. "${usernameDari(nama.split(' ')[0])}").` };
    }
    if (ada && akunAda.length) {
      return { ok: false, tanya: `${ada.fullName} sudah punya akun login (${akunAda.map((l) => l.username || l.accountName).join(', ')}). Mau ubah jadwalnya? Bilang mis. "ubah jadwal ${ada.fullName.split(' ')[0]}: Senin-Sabtu 09.00-17.00".` };
    }

    let akun = null;
    if (akunDiminta) {
      const username = usernameDari(t?.kr_username);
      if (username.length < 3) {
        return { ok: false, kurang: 'kr_username', tanya: `Username login untuk ${nama} apa? Minimal 3 huruf, mis. "${usernameDari(nama.split(' ')[0]) || 'rika'}". Password-nya nanti dibuat sistem.` };
      }
      const teksGaji = teks(t?.kr_gaji, 60);
      const paymentType = /\b(sesi|shift)\b/i.test(teksGaji) ? 'SESI' : 'JAM';
      let gaji = 0;
      if (teksGaji) {
        const angka = teksGaji.match(new RegExp(NOMINAL, 'i'));
        const urai = rupiahDari(angka ? angka[0] : teksGaji, 'Gaji', { bolehNol: true });
        if (!urai.ok) return { ...urai, kurang: 'kr_gaji' };
        gaji = urai.nilai;
      }
      let jadwal = null;
      if (teks(t?.kr_jadwal, 400)) {
        const urai = uraiJadwal(t.kr_jadwal);
        if (!urai.ok) return { ...urai, kurang: 'kr_jadwal' };
        jadwal = urai.hari;
      }
      akun = { username, jobType: teks(t?.kr_jabatan, 100) || 'CS', paymentType, gaji, jadwal };
    }

    const muatan = {
      nama,
      hp: teks(t?.kr_hp, 40).replace(/[^\d+]/g, ''),
      alamat: teks(t?.kr_alamat, 200),
      employeeId: ada?.id ?? null,
      akun
    };
    const baris = [
      ['Nama', nama],
      ...(ada ? [['Data karyawan', 'sudah ada — tidak dibuat dobel']] : []),
      ...(muatan.hp ? [['No. HP', muatan.hp]] : []),
      ...(muatan.alamat ? [['Alamat', muatan.alamat]] : []),
      ...(akun ? [
        ['Username login', akun.username],
        ['Password', 'dibuat sistem saat Bos tekan "Ya", ditampilkan sekali'],
        ['Jenis pekerjaan', akun.jobType],
        ['Pembayaran', akun.paymentType === 'SESI' ? 'Per sesi' : 'Per jam'],
        [akun.paymentType === 'SESI' ? 'Gaji per sesi' : 'Gaji per jam', akun.gaji ? rupiah(akun.gaji) : 'belum diisi (Rp0)']
      ] : [])
    ];
    const dampak = [
      ada ? null : `${nama} masuk daftar Tim → Karyawan gerai ${ctx.namaLingkup || 'ini'}.`,
      akun ? `Akun login "${akun.username}" dibuat di Tim → Akun Kasir lalu ditautkan ke ${nama}. Catat password yang muncul sesudah "Ya" dan berikan ke orangnya — bisa diganti kapan saja di layar Akun Kasir.` : 'Belum ada akun login — bilang "buatin akunnya juga" kalau dia perlu presensi/login kasir.',
      akun && !akun.gaji ? 'Gaji belum diisi, jadi presensinya belum menghasilkan gaji sampai diatur di Akun Kasir.' : null,
      akun && !akun.jadwal ? 'Jadwal kerja belum diisi — telat belum bisa dinilai sampai jadwalnya diatur.' : null,
      akun?.jadwal ? 'Telat dinilai dari jadwal ini; hari "belum diatur" tidak dinilai telat.' : null
    ].filter(Boolean);
    return {
      ok: true,
      draft: {
        aksi: 'buat_karyawan',
        judul: ada ? `Una mau membuatkan akun login untuk ${nama} — dicek dulu ya:` : 'Una mau menambah karyawan baru — dicek dulu ya:',
        baris,
        ...(akun?.jadwal ? { tabel: tabelJadwal(akun.jadwal) } : {}),
        dampak,
        muatan
      }
    };
  },

  async posting(draft, ctx) {
    const m = draft.muatan;
    let employeeId = m.employeeId;
    if (!employeeId) {
      const orang = await ctx.kirim('POST', '/api/admin/employees', { fullName: m.nama, phone: m.hp, address: m.alamat });
      if (!orang.ok) return orang;
      employeeId = orang.data?.id;
    }
    if (!m.akun) {
      return { ok: true, jawaban: `Beres, ${m.nama} sudah masuk daftar karyawan. Mau sekalian Una buatkan akun login-nya? Sebut username, gaji, dan jadwalnya.` };
    }
    const password = passwordAcak();
    const akun = await ctx.kirim('POST', '/api/admin/cashiers', {
      username: m.akun.username,
      password,
      employeeName: m.nama,
      jobType: m.akun.jobType,
      paymentType: m.akun.paymentType,
      hourlyWage: m.akun.gaji,
      ...(m.akun.jadwal ? { schedule: keJadwalServer(m.akun.jadwal) } : {})
    });
    if (!akun.ok) {
      const sudah = m.employeeId ? '' : ` Data karyawan ${m.nama} sudah tersimpan;`;
      return { ok: false, status: akun.status, error: `${akun.error}${sudah} minta Una buatkan akunnya lagi dengan username lain ya.` };
    }
    const taut = employeeId
      ? await ctx.kirim('POST', `/api/admin/employees/${encodeURIComponent(employeeId)}/links`, { accountType: 'CASHIER', accountId: akun.data?.id })
      : { ok: false };
    return {
      ok: true,
      jawaban: [
        `Beres, ${m.employeeId ? '' : `${m.nama} sudah masuk daftar karyawan dan `}akun login "${m.akun.username}" sudah jadi.`,
        taut.ok ? '' : ' Akunnya belum tertaut ke data orangnya — tautkan di Tim → Karyawan → Tautkan ya.',
        ' Password awalnya ada di kotak di bawah, cuma tampil sekali.'
      ].join(''),
      rahasia: { label: `Password awal "${m.akun.username}"`, nilai: password }
    };
  }
});

// --- jadwal kerja akun yang sudah ada -----------------------------------------

function cocokAkun(tertulis, daftar) {
  return cocokkanSatu(tertulis, daftar, { label: 'akun karyawan', namaDari: (c) => c.employeeName, kunciLain: (c) => [c.username] });
}

const aturJadwalKasir = Object.freeze({
  nama: 'atur_jadwal_kasir',
  lingkup: 'gerai',
  petunjuk: 'MENGUBAH jadwal/jam kerja per hari akun CS/kasir yang SUDAH ADA, mis. "jadwal rika ganti: senin 09-22, selasa-sabtu 09-18, minggu libur", "rika sabtu libur". Hari yang tidak disebut tetap.',
  skema: {
    jk_orang: { type: 'string', description: 'atur_jadwal_kasir: nama karyawan atau username akunnya.' },
    kr_jadwal: buatKaryawan.skema.kr_jadwal
  },

  isiDariPesan(t, pesan) {
    const hasil = { ...t };
    const jadwal = potongJadwal(pesan);
    if (jadwal) hasil.kr_jadwal = jadwal;
    return hasil;
  },

  async siapkan(t, ctx) {
    const orang = namaOrang(t?.jk_orang);
    if (!orang) return { ok: false, kurang: 'jk_orang', tanya: 'Jadwal siapa yang mau diubah? Sebut nama CS atau username-nya.' };
    if (!teks(t?.kr_jadwal, 400) || !adaJadwal(t.kr_jadwal)) {
      return { ok: false, kurang: 'kr_jadwal', tanya: `Jadwal ${orang} mau jadi apa? Sebut per hari, mis. "Senin–Sabtu 09.00–17.00, Minggu libur".` };
    }
    const urai = uraiJadwal(t.kr_jadwal);
    if (!urai.ok) return { ...urai, kurang: 'kr_jadwal' };

    const ref = await ctx.baca('/api/admin/cashiers');
    if (!ref.ok) return ref;
    const cocok = cocokAkun(orang, (ref.data?.cashiers ?? []).filter((c) => c.isActive));
    if (!cocok.ok) return cocok;
    const c = cocok.nilai;
    const sebelum = [0, 1, 2, 3, 4, 5, 6].map((n) => {
      const h = (c.schedule ?? []).find((x) => Number(x.dayOfWeek) === n);
      return h ? { isDayOff: Boolean(h.isDayOff), shiftStart: h.shiftStart || '', shiftEnd: h.shiftEnd || '' } : null;
    });
    const jadi = sebelum.map((h, n) => urai.hari[n] ?? h);
    if (JSON.stringify(jadi) === JSON.stringify(sebelum)) return { ok: false, tanya: `Jadwal ${c.employeeName} sudah persis begitu, tidak ada yang berubah.` };
    return {
      ok: true,
      draft: {
        aksi: 'atur_jadwal_kasir',
        judul: `Una mau mengubah jadwal kerja ${c.employeeName} (${c.username}) — dicek dulu ya:`,
        baris: [['Akun', `${c.employeeName} (${c.username})`]],
        tabel: tabelJadwal(jadi, sebelum),
        dampak: [
          'Telat mulai dinilai dari jadwal baru. Presensi yang sudah lewat tidak dihitung ulang.',
          'Sama seperti menyimpan di layar Akun Kasir: kalau orangnya sedang login, dia diminta login ulang.'
        ],
        muatan: { cashierId: c.id, username: c.username, employeeName: c.employeeName, jadi }
      }
    };
  },

  async posting(draft, ctx) {
    const m = draft.muatan;
    const hasil = await ctx.kirim('PATCH', `/api/admin/cashiers/${encodeURIComponent(m.cashierId)}`, {
      username: m.username, employeeName: m.employeeName, isActive: true, schedule: keJadwalServer(m.jadi)
    });
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Beres, jadwal ${m.employeeName} sudah Una ganti.` };
  }
});

// --- potongan / bonus gaji -------------------------------------------------------

const KATA_POTONG = /\b(potong\w*|denda\w*|kurangi\w*|dikurangi|minus)\b/i;
const KATA_TAMBAH = /\b(bonus\w*|lembur\w*|tambah\w*|ditambah|insentif\w*|uang\s*makan|tunjangan\w*)\b/i;

export function uraiPesanGaji(pesan, hariIni) {
  const t = String(pesan ?? '').replace(/\s+/g, ' ').trim();
  const hasil = {};
  if (KATA_POTONG.test(t) && !KATA_TAMBAH.test(t)) hasil.pg_jenis = 'potong';
  else if (KATA_TAMBAH.test(t) && !KATA_POTONG.test(t)) hasil.pg_jenis = 'tambah';
  const nominal = t.match(new RegExp(`(?<![\\w-])-?${NOMINAL}`, 'i'));
  if (nominal && !/^\d{1,2}$/.test(nominal[0].trim())) hasil.pg_nominal = nominal[0].trim();
  const alasan = t.match(/\b(?:karena|krn|soalnya|gara[- ]?gara|alasan(?:nya)?\s*:?)\s+(.{3,300})$/i);
  if (alasan) hasil.pg_alasan = alasan[1].replace(/[.!]+$/, '').trim();
  const tanggal = tanggalUcapan(t, hariIni);
  if (tanggal) hasil.pg_tanggal = tanggal;
  return hasil;
}

const penyesuaianGaji = Object.freeze({
  nama: 'penyesuaian_gaji',
  lingkup: 'gerai',
  petunjuk: 'POTONGAN atau TAMBAHAN gaji (denda, bonus, lembur, ganti presensi yang gagal) untuk satu CS/kasir di tanggal tertentu, mis. "potong gaji rika 20rb kemarin karena telat", "bonus lembur budi 30rb tgl 5". Alasan wajib (terlihat karyawan).',
  skema: {
    pg_orang: { type: 'string', description: 'penyesuaian_gaji: nama karyawan atau username.' },
    pg_jenis: { type: 'string', enum: ['potong', 'tambah'], description: 'penyesuaian_gaji: potong (denda/potongan) atau tambah (bonus/lembur).' },
    pg_nominal: { type: 'string', description: 'penyesuaian_gaji: nominal PERSIS, mis. "20rb".' },
    pg_tanggal: { type: 'string', description: 'penyesuaian_gaji: tanggal YYYY-MM-DD kalau disebut.' },
    pg_alasan: { type: 'string', description: 'penyesuaian_gaji: alasannya PERSIS.' }
  },

  isiDariPesan(t, pesan, opsi = {}) {
    const dari = uraiPesanGaji(pesan, opsi.hariIni);
    const hasil = { ...t };
    for (const [k, v] of Object.entries(dari)) if (hasil[k] == null || hasil[k] === '' || k === 'pg_tanggal' || k === 'pg_jenis') hasil[k] = v;
    return hasil;
  },

  async siapkan(t, ctx) {
    const orang = namaOrang(t?.pg_orang);
    if (!orang) return { ok: false, kurang: 'pg_orang', tanya: 'Gaji siapa yang mau disesuaikan? Sebut nama CS-nya.' };
    const teksNominal = teks(t?.pg_nominal, 40);
    if (!teksNominal) return { ok: false, kurang: 'pg_nominal', tanya: `Berapa nominalnya untuk ${orang}?` };
    const negatif = /^-/.test(teksNominal);
    const nominal = rupiahDari(teksNominal.replace(/^-/, ''), 'Nominal');
    if (!nominal.ok) return { ...nominal, kurang: 'pg_nominal' };
    const jenis = t?.pg_jenis === 'potong' || negatif ? 'potong' : (t?.pg_jenis === 'tambah' ? 'tambah' : '');
    if (!jenis) return { ok: false, kurang: 'pg_jenis', tanya: `${rupiah(nominal.nilai)} itu potongan atau tambahan (bonus/lembur)?` };
    const alasan = teks(t?.pg_alasan, 300);
    if (!alasan) return { ok: false, kurang: 'pg_alasan', tanya: `Alasannya apa? Nanti terlihat oleh ${orang} di kartu gajinya.` };
    const tanggal = tanggalDari(t?.pg_tanggal, ctx.hariIni);
    if (!tanggal.ok) return { ...tanggal, kurang: 'pg_tanggal' };

    const ref = await ctx.baca('/api/admin/cashiers');
    if (!ref.ok) return ref;
    const cocok = cocokAkun(orang, ref.data?.cashiers ?? []);
    if (!cocok.ok) return cocok;
    const c = cocok.nilai;
    const amount = jenis === 'potong' ? -nominal.nilai : nominal.nilai;
    return {
      ok: true,
      draft: {
        aksi: 'penyesuaian_gaji',
        judul: `Una mau mencatat ${jenis === 'potong' ? 'potongan' : 'tambahan'} gaji — dicek dulu ya:`,
        baris: [
          ['Karyawan', `${c.employeeName} (${c.username})`],
          ['Tanggal', tanggal.nilai],
          ['Jenis', jenis === 'potong' ? 'Potongan' : 'Tambahan'],
          ['Nominal', `${jenis === 'potong' ? '−' : '+'}${rupiah(nominal.nilai)}`],
          ['Alasan', alasan]
        ],
        dampak: [
          `Muncul sebagai kartu terpisah di gaji ${c.employeeName} tanggal ${tanggal.nilai}, dan terlihat oleh karyawannya.`,
          'Salah input? Dibatalkan di Akun Kasir → 💰 Gaji dengan alasan; jejaknya tetap tercatat, tidak dihapus diam-diam.'
        ],
        muatan: { cashierId: c.id, employeeName: c.employeeName, businessDate: tanggal.nilai, amountRupiah: amount, reason: alasan }
      }
    };
  },

  async posting(draft, ctx) {
    const m = draft.muatan;
    const hasil = await ctx.kirim('POST', `/api/admin/cashiers/${encodeURIComponent(m.cashierId)}/payroll`, {
      businessDate: m.businessDate, amountRupiah: m.amountRupiah, reason: m.reason
    });
    if (!hasil.ok) return hasil;
    return { ok: true, jawaban: `Beres, ${m.amountRupiah < 0 ? 'potongan' : 'tambahan'} gaji ${m.employeeName} tanggal ${m.businessDate} sudah tercatat.` };
  }
});

export const AKSI_KARYAWAN = Object.freeze([cekSetoranCs, buatKaryawan, aturJadwalKasir, penyesuaianGaji]);

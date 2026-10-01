// Alat tulis Una untuk transaksi admin gerai yang TIDAK menyentuh kas/laci
// (permintaan Bos Cyo 2026-10-01: "una itu bisa mengerjakan semua transaksi
// asalkan engga berkaitan dengan kas/uang laci, karna admin di kantor juga
// bisa mengerjakan itu").
//
// Semuanya memakai endpoint yang sama dengan layar admin gerai:
//   - Bea Gaji / Bea Lapak (jadi hutang)  -> /api/admin/operational-expenses
//   - Pembayaran Lainnya (bayar langsung) -> /api/admin/hutang-piutang/pembayaran-lainnya
//   - Pelunasan hutang                    -> /api/admin/hutang-piutang/payments
//   - Uang Muka / Deposit                 -> /api/admin/hutang-piutang/deposits
//
// Cara bayar yang dilayani hanya Transfer Bank, Rekening Bersama, dan Deposit.
// "Tunai / Kas Admin" ada di layar, tapi sengaja tidak dilayani Una: uang
// tunai/kas itu yang Bos Cyo kecualikan. Penjualan dan pembelian barang juga
// tidak ada di sini — di program ini keduanya hanya lewat laci kasir.

import { rupiah } from './caca-nominal.js';
import { normalkan, cocokkanSatu, rupiahDari, teks, tanggalDari } from './caca-aksi-dasar.js';
import { uraikanNominal } from './caca-nominal.js';

const SKEMA_TANGGAL = { type: 'string', description: 'YYYY-MM-DD, hanya kalau penanya menyebut tanggal tertentu.' };

const SKEMA_CARA_BAYAR = {
  bayar_cara: { type: 'string', description: 'Dibayar lewat apa, PERSIS seperti diucapkan (mis. "transfer", "rekber", "deposit listrik", "tunai").' },
  bayar_sumber: { type: 'string', description: 'Nama Rekening Bersama atau Deposit yang dipakai, kalau disebut.' }
};

const POLA_TUNAI = /\b(tunai|cash|kas|laci|kontan)\b/;

/**
 * Menerjemahkan cara bayar yang diucapkan jadi isian endpoint. Tunai/kas
 * selalu ditolak di sini, sebelum apa pun dibaca.
 */
async function caraBayar(t, ctx, { nominal, bolehDeposit = true }) {
  const cara = normalkan(t?.bayar_cara);
  if (!cara) {
    return { ok: false, tanya: `Dibayar lewat apa? Transfer bank, Rekening Bersama${bolehDeposit ? ', atau Deposit' : ''}?` };
  }
  if (POLA_TUNAI.test(cara)) {
    return {
      ok: false,
      tanya: 'Yang dibayar tunai/kas menyentuh uang kas atau laci, dan itu tidak Una catat. Catat lewat kasir atau layar admin — atau kalau sebenarnya lewat transfer bank / Rekening Bersama / Deposit, sebut itu.'
    };
  }
  if (/\b(bank|transfer|tf|trf)\b/.test(cara)) {
    return { ok: true, nilai: { paymentMethod: 'BANK', sharedAccountId: null, depositId: null, label: 'Transfer Bank' } };
  }

  const ref = await ctx.baca('/api/admin/hutang-piutang');
  if (!ref.ok) return ref;
  const sumber = teks(t?.bayar_sumber, 120);

  if (/rekber|rekening bersama|bersama/.test(cara)) {
    const daftar = ref.data.sharedAccounts ?? [];
    if (!daftar.length) return { ok: false, tanya: 'Entity ini belum punya Rekening Bersama yang aktif.' };
    let rekening;
    if (sumber) {
      const cocok = cocokkanSatu(sumber, daftar, { label: 'Rekening Bersama', namaDari: (r) => r.name });
      if (!cocok.ok) return cocok;
      rekening = cocok.nilai;
    } else if (daftar.length === 1) {
      rekening = daftar[0];
    } else {
      return { ok: false, tanya: `Rekening Bersama yang mana? ${daftar.map((r) => `"${r.name}"`).join(', ')}.` };
    }
    return { ok: true, nilai: { paymentMethod: 'REKBER', sharedAccountId: rekening.id, depositId: null, label: `Rekening Bersama ${rekening.name}` } };
  }

  if (/deposit|uang muka/.test(cara)) {
    if (!bolehDeposit) return { ok: false, tanya: 'Uang Muka/Deposit tidak bisa dibayar dari Deposit. Lewat transfer bank atau Rekening Bersama?' };
    const daftar = (ref.data.deposits ?? []).filter((d) => d.balanceRupiah > 0);
    if (!daftar.length) return { ok: false, tanya: 'Belum ada Deposit yang masih bersaldo di gerai ini.' };
    // Nama deposit bisa disebut lewat pihaknya ("deposit PLN") atau jenisnya
    // ("deposit listrik"), jadi keduanya ikut dicocokkan.
    const sebutan = sumber || cara.replace(/\b(deposit|uang muka)\b/g, '').trim();
    let deposit;
    if (sebutan) {
      const cocok = cocokkanSatu(sebutan, daftar, {
        label: 'Deposit', namaDari: (d) => `${d.categoryLabel} ${d.counterpartyName}`, kunciLain: (d) => [d.counterpartyName, d.categoryLabel]
      });
      if (!cocok.ok) return cocok;
      deposit = cocok.nilai;
    } else if (daftar.length === 1) {
      deposit = daftar[0];
    } else {
      return { ok: false, tanya: `Deposit yang mana? ${daftar.slice(0, 6).map((d) => `"${d.categoryLabel} ${d.counterpartyName}"`).join(', ')}.` };
    }
    if (nominal > deposit.balanceRupiah) {
      return { ok: false, tanya: `Saldo ${deposit.categoryLabel} ${deposit.counterpartyName} tinggal ${rupiah(deposit.balanceRupiah)}, kurang dari ${rupiah(nominal)}.` };
    }
    return {
      ok: true,
      nilai: { paymentMethod: 'DEPOSIT', sharedAccountId: null, depositId: deposit.id, label: `${deposit.categoryLabel} ${deposit.counterpartyName}` }
    };
  }

  return { ok: false, tanya: `"${t.bayar_cara}" itu lewat apa? Transfer bank, Rekening Bersama${bolehDeposit ? ', atau Deposit' : ''}?` };
}

async function kirimDanJawab(ctx, path, muatan, jawaban) {
  const hasil = await ctx.kirim('POST', path, muatan);
  if (!hasil.ok) return hasil;
  return { ok: true, jawaban };
}

// --- Bea Gaji (jadi hutang gaji) ------------------------------------------

const beaGaji = Object.freeze({
  nama: 'catat_bea_gaji',
  lingkup: 'gerai',
  petunjuk: 'mencatat Bea Gaji karyawan (jadi hutang gaji), termasuk bonus atau potongan, mis. "gaji Rina minggu ini 700rb", "potong gaji Budi 50rb kasbon".',
  skema: {
    gaji_karyawan: { type: 'string', description: 'catat_bea_gaji: nama karyawan PERSIS seperti diucapkan.' },
    gaji_keterangan: { type: 'string', description: 'catat_bea_gaji: keterangan, mis. "gaji minggu ke-2", "potongan kasbon".' },
    gaji_nominal: { type: 'string', description: 'catat_bea_gaji: nominal PERSIS seperti diucapkan. Awali "-" kalau itu potongan.' },
    aksi_tanggal: SKEMA_TANGGAL
  },

  async siapkan(t, ctx) {
    if (!teks(t?.gaji_karyawan, 120)) return { ok: false, tanya: 'Gaji untuk karyawan siapa?' };
    const keterangan = teks(t?.gaji_keterangan, 220);
    if (!keterangan) return { ok: false, tanya: 'Keterangannya apa? Mis. "gaji minggu ini" atau "potongan kasbon".' };
    const nominal = uraikanNominal(t?.gaji_nominal);
    if (!nominal.ok) return { ok: false, tanya: `Nominal gaji: ${nominal.tanya}` };
    const tanggal = tanggalDari(t?.aksi_tanggal, ctx.hariIni);
    if (!tanggal.ok) return tanggal;

    const ref = await ctx.baca('/api/admin/operational-expenses');
    if (!ref.ok) return ref;
    const karyawan = cocokkanSatu(t.gaji_karyawan, ref.data.employees ?? [], { label: 'karyawan', namaDari: (k) => k.fullName });
    if (!karyawan.ok) return karyawan;

    const potongan = nominal.nilai < 0;
    return {
      ok: true,
      draft: {
        aksi: 'catat_bea_gaji',
        judul: `Una mau mencatat ${potongan ? 'potongan' : 'Bea'} gaji ini — dicek dulu ya:`,
        baris: [
          ['Karyawan', karyawan.nilai.fullName],
          ['Keterangan', keterangan],
          ['Nominal', `${potongan ? '−' : ''}${rupiah(Math.abs(nominal.nilai))}`],
          ['Tanggal', tanggal.nilai]
        ],
        dampak: [
          potongan
            ? `Hutang gaji ke ${karyawan.nilai.fullName} berkurang ${rupiah(-nominal.nilai)}.`
            : `Tercatat sebagai hutang gaji ke ${karyawan.nilai.fullName} sebesar ${rupiah(nominal.nilai)}.`,
          `Masuk Riwayat Gaji ${karyawan.nilai.fullName} dan Bea Operasional ${ctx.namaLingkup}.`,
          'Belum ada uang yang keluar — pembayarannya dicatat terpisah lewat pelunasan hutang.'
        ],
        muatan: {
          category: 'BEA_GAJI',
          description: keterangan,
          amount: nominal.nilai,
          employeeId: karyawan.nilai.id,
          businessDate: tanggal.nilai
        }
      }
    };
  },

  posting(draft, ctx) {
    return kirimDanJawab(ctx, '/api/admin/operational-expenses', draft.muatan, 'Sudah Una catat Bea Gajinya.');
  }
});

// --- Bea Lapak (jadi hutang) ----------------------------------------------

const beaLapak = Object.freeze({
  nama: 'catat_bea_lapak',
  lingkup: 'gerai',
  petunjuk: 'mencatat Bea Lapak/sewa tempat yang BELUM dibayar (jadi hutang), mis. "sewa lapak bulan ini 1,5jt ke Pak Haji".',
  skema: {
    lapak_pihak: { type: 'string', description: 'catat_bea_lapak: pemilik lapak/pihak yang dihutangi, PERSIS seperti diucapkan.' },
    lapak_keterangan: { type: 'string', description: 'catat_bea_lapak: keterangan, mis. "sewa lapak Oktober".' },
    lapak_nominal: { type: 'string', description: 'catat_bea_lapak: nominal PERSIS seperti diucapkan.' },
    aksi_tanggal: SKEMA_TANGGAL
  },

  async siapkan(t, ctx) {
    const pihakTertulis = teks(t?.lapak_pihak, 200);
    if (!pihakTertulis) return { ok: false, tanya: 'Sewa lapaknya dihutangkan ke siapa?' };
    const keterangan = teks(t?.lapak_keterangan, 220) || 'Sewa lapak';
    const nominal = rupiahDari(t?.lapak_nominal, 'Nominal sewa');
    if (!nominal.ok) return nominal;
    const tanggal = tanggalDari(t?.aksi_tanggal, ctx.hariIni);
    if (!tanggal.ok) return tanggal;

    const ref = await ctx.baca('/api/admin/operational-expenses');
    if (!ref.ok) return ref;
    // Supplier terdaftar dipakai kalau namanya persis sama; selain itu pihak
    // dicatat sebagai nama bebas — dan draft menyebutnya terang-terangan,
    // supaya salah ketik nama supplier ketahuan sebelum "Ya".
    const supplier = (ref.data.suppliers ?? []).find((s) => normalkan(s.name) === normalkan(pihakTertulis));
    const pihak = supplier
      ? { counterpartyType: 'SUPPLIER', counterpartyId: supplier.id, counterpartyName: supplier.name }
      : { counterpartyType: 'OTHER', counterpartyId: null, counterpartyName: pihakTertulis };

    return {
      ok: true,
      draft: {
        aksi: 'catat_bea_lapak',
        judul: 'Una mau mencatat Bea Lapak ini — dicek dulu ya:',
        baris: [
          ['Ke', `${pihak.counterpartyName}${supplier ? ' (supplier)' : ' (bukan supplier terdaftar)'}`],
          ['Keterangan', keterangan],
          ['Nominal', rupiah(nominal.nilai)],
          ['Tanggal', tanggal.nilai]
        ],
        dampak: [
          `Tercatat sebagai hutang lapak ke ${pihak.counterpartyName} sebesar ${rupiah(nominal.nilai)}.`,
          'Belum ada uang yang keluar — pembayarannya dicatat terpisah lewat pelunasan hutang.'
        ],
        muatan: { category: 'BEA_LAPAK', description: keterangan, amount: nominal.nilai, ...pihak, businessDate: tanggal.nilai }
      }
    };
  },

  posting(draft, ctx) {
    return kirimDanJawab(ctx, '/api/admin/operational-expenses', draft.muatan, 'Sudah Una catat Bea Lapaknya.');
  }
});

// --- Pembayaran Lainnya (beban dibayar langsung) --------------------------

const JENIS_LAINNYA = Object.freeze({ lapak: 'BEA_LAPAK', lainnya: 'BEA_LAINNYA' });

const bayarLainnya = Object.freeze({
  nama: 'bayar_lainnya',
  lingkup: 'gerai',
  petunjuk: 'mencatat beban yang LANGSUNG dibayar (bukan hutang) lewat transfer/Rekening Bersama/Deposit, mis. "bayar listrik 350rb pakai deposit listrik", "bayar sewa lapak 1jt transfer".',
  skema: {
    lainnya_jenis: { type: 'string', enum: ['lapak', 'lainnya'], description: 'bayar_lainnya: "lapak" untuk sewa lapak/tempat, selain itu "lainnya".' },
    lainnya_keterangan: { type: 'string', description: 'bayar_lainnya: untuk apa, mis. "token listrik".' },
    lainnya_pihak: { type: 'string', description: 'bayar_lainnya: dibayarkan ke siapa, kalau disebut.' },
    lainnya_nominal: { type: 'string', description: 'bayar_lainnya: nominal PERSIS seperti diucapkan.' },
    ...SKEMA_CARA_BAYAR,
    aksi_tanggal: SKEMA_TANGGAL
  },

  async siapkan(t, ctx) {
    const keterangan = teks(t?.lainnya_keterangan, 220);
    if (!keterangan) return { ok: false, tanya: 'Pembayarannya untuk apa?' };
    const nominal = rupiahDari(t?.lainnya_nominal, 'Nominal');
    if (!nominal.ok) return nominal;
    const tanggal = tanggalDari(t?.aksi_tanggal, ctx.hariIni);
    if (!tanggal.ok) return tanggal;
    const cara = await caraBayar(t, ctx, { nominal: nominal.nilai });
    if (!cara.ok) return cara;

    const kategori = JENIS_LAINNYA[t?.lainnya_jenis] || 'BEA_LAINNYA';
    const pihak = teks(t?.lainnya_pihak, 200);
    return {
      ok: true,
      draft: {
        aksi: 'bayar_lainnya',
        judul: 'Una mau mencatat pembayaran ini — dicek dulu ya:',
        baris: [
          ['Untuk', keterangan],
          ['Jenis', kategori === 'BEA_LAPAK' ? 'Bea Lapak' : 'Bea Lainnya'],
          ...(pihak ? [['Ke', pihak]] : []),
          ['Nominal', rupiah(nominal.nilai)],
          ['Dibayar lewat', cara.nilai.label],
          ['Tanggal', tanggal.nilai]
        ],
        dampak: [
          `Beban ${rupiah(nominal.nilai)} langsung lunas, tidak jadi hutang.`,
          `Uangnya keluar dari ${cara.nilai.label} — bukan dari kas atau laci.`
        ],
        muatan: {
          category: kategori,
          description: keterangan,
          counterpartyName: pihak,
          amount: nominal.nilai,
          paymentMethod: cara.nilai.paymentMethod,
          sharedAccountId: cara.nilai.sharedAccountId,
          depositId: cara.nilai.depositId,
          businessDate: tanggal.nilai
        }
      }
    };
  },

  posting(draft, ctx) {
    return kirimDanJawab(ctx, '/api/admin/hutang-piutang/pembayaran-lainnya', draft.muatan, 'Sudah Una catat pembayarannya.');
  }
});

// --- Pelunasan hutang -----------------------------------------------------

const bayarHutang = Object.freeze({
  nama: 'bayar_hutang',
  lingkup: 'gerai',
  petunjuk: 'melunasi/mencicil hutang gerai ke seseorang lewat transfer/Rekening Bersama/Deposit, mis. "bayar hutang gaji Rina 700rb transfer", "lunasi hutang lapak Pak Haji".',
  skema: {
    hutang_pihak: { type: 'string', description: 'bayar_hutang: nama orang/pihak yang dihutangi, PERSIS seperti diucapkan.' },
    hutang_jenis: { type: 'string', description: 'bayar_hutang: jenis hutangnya kalau disebut (gaji, lapak, lainnya).' },
    hutang_nominal: { type: 'string', description: 'bayar_hutang: nominal PERSIS seperti diucapkan, atau "lunas" kalau dibayar semua.' },
    ...SKEMA_CARA_BAYAR,
    aksi_tanggal: SKEMA_TANGGAL
  },

  async siapkan(t, ctx) {
    if (!teks(t?.hutang_pihak, 200)) return { ok: false, tanya: 'Hutang ke siapa yang mau dibayar?' };
    const tanggal = tanggalDari(t?.aksi_tanggal, ctx.hariIni);
    if (!tanggal.ok) return tanggal;

    const ref = await ctx.baca('/api/admin/hutang-piutang');
    if (!ref.ok) return ref;
    const orangBerhutang = (ref.data.persons ?? [])
      .map((p) => ({ ...p, bisaDibayar: (p.accounts ?? []).filter((a) => a.payableByAdmin && a.balanceRupiah > 0) }))
      .filter((p) => p.bisaDibayar.length);
    const orang = cocokkanSatu(t.hutang_pihak, orangBerhutang, { label: 'pihak yang dihutangi', namaDari: (p) => p.counterpartyName });
    if (!orang.ok) return orang;

    let akun;
    if (orang.nilai.bisaDibayar.length === 1) {
      akun = orang.nilai.bisaDibayar[0];
    } else {
      const jenis = teks(t?.hutang_jenis, 40);
      const pilihan = orang.nilai.bisaDibayar.map((a) => `${a.label} (${rupiah(a.balanceRupiah)})`).join(', ');
      if (!jenis) return { ok: false, tanya: `${orang.nilai.counterpartyName} punya beberapa hutang: ${pilihan}. Yang mana?` };
      const cocok = cocokkanSatu(jenis, orang.nilai.bisaDibayar, { label: 'jenis hutang', namaDari: (a) => a.label, kunciLain: (a) => [a.account] });
      if (!cocok.ok) return { ok: false, tanya: `${cocok.tanya} Pilihannya: ${pilihan}.` };
      akun = cocok.nilai;
    }

    const mintaLunas = /^(lunas|semua|semuanya|full|sisanya)$/i.test(teks(t?.hutang_nominal, 20));
    let nominal;
    if (mintaLunas) {
      nominal = akun.balanceRupiah;
    } else {
      const hasil = rupiahDari(t?.hutang_nominal, 'Nominal bayar');
      if (!hasil.ok) return { ok: false, tanya: `${hasil.tanya} Sisa ${akun.label} ${orang.nilai.counterpartyName}: ${rupiah(akun.balanceRupiah)}.` };
      nominal = hasil.nilai;
    }
    if (nominal > akun.balanceRupiah) {
      return { ok: false, tanya: `Sisa ${akun.label} ke ${orang.nilai.counterpartyName} cuma ${rupiah(akun.balanceRupiah)}, kurang dari ${rupiah(nominal)}.` };
    }

    const cara = await caraBayar(t, ctx, { nominal });
    if (!cara.ok) return cara;
    const sisa = akun.balanceRupiah - nominal;
    return {
      ok: true,
      draft: {
        aksi: 'bayar_hutang',
        judul: 'Una mau mencatat pembayaran hutang ini — dicek dulu ya:',
        baris: [
          ['Ke', orang.nilai.counterpartyName],
          ['Hutang', akun.label],
          ['Dibayar', rupiah(nominal)],
          ['Dibayar lewat', cara.nilai.label],
          ['Tanggal', tanggal.nilai]
        ],
        dampak: [
          sisa === 0
            ? `${akun.label} ke ${orang.nilai.counterpartyName} jadi lunas.`
            : `Sisa ${akun.label} ke ${orang.nilai.counterpartyName} tinggal ${rupiah(sisa)}.`,
          `Uangnya keluar dari ${cara.nilai.label} — bukan dari kas atau laci.`
        ],
        muatan: {
          accountKey: akun.accountKey,
          amount: nominal,
          paymentMethod: cara.nilai.paymentMethod,
          sharedAccountId: cara.nilai.sharedAccountId,
          depositId: cara.nilai.depositId,
          businessDate: tanggal.nilai
        }
      }
    };
  },

  posting(draft, ctx) {
    return kirimDanJawab(ctx, '/api/admin/hutang-piutang/payments', draft.muatan, 'Sudah Una catat pembayaran hutangnya.');
  }
});

// --- Uang Muka / Deposit --------------------------------------------------

const JENIS_UANG_MUKA = Object.freeze({
  listrik: { kode: 'DEPOSIT_LISTRIK', label: 'Uang Muka Listrik' },
  iklan: { kode: 'DEPOSIT_IKLAN', label: 'Uang Muka Iklan' },
  bahan_baku: { kode: 'DEPOSIT_BAHAN_BAKU', label: 'Uang Muka Bahan Baku' },
  lainnya: { kode: 'DEPOSIT_LAINNYA', label: 'Uang Muka Lainnya' }
});

const uangMuka = Object.freeze({
  nama: 'buat_uang_muka',
  lingkup: 'gerai',
  petunjuk: 'mencatat Uang Muka/Deposit yang baru dibayarkan lewat transfer/Rekening Bersama, mis. "deposit listrik 1jt ke PLN transfer", "DP bahan baku 2jt ke Toko Sinar".',
  skema: {
    um_jenis: { type: 'string', enum: Object.keys(JENIS_UANG_MUKA), description: 'buat_uang_muka: jenis uang mukanya.' },
    um_pihak: { type: 'string', description: 'buat_uang_muka: dibayarkan ke siapa, kalau disebut.' },
    um_keterangan: { type: 'string', description: 'buat_uang_muka: keterangan, kalau disebut.' },
    um_nominal: { type: 'string', description: 'buat_uang_muka: nominal PERSIS seperti diucapkan.' },
    ...SKEMA_CARA_BAYAR,
    aksi_tanggal: SKEMA_TANGGAL
  },

  async siapkan(t, ctx) {
    const jenis = JENIS_UANG_MUKA[t?.um_jenis];
    if (!jenis) return { ok: false, tanya: 'Uang mukanya untuk apa? Listrik, iklan, bahan baku, atau lainnya?' };
    const nominal = rupiahDari(t?.um_nominal, 'Nominal uang muka');
    if (!nominal.ok) return nominal;
    const tanggal = tanggalDari(t?.aksi_tanggal, ctx.hariIni);
    if (!tanggal.ok) return tanggal;
    const cara = await caraBayar(t, ctx, { nominal: nominal.nilai, bolehDeposit: false });
    if (!cara.ok) return cara;

    const pihak = teks(t?.um_pihak, 200);
    const keterangan = teks(t?.um_keterangan, 220) || jenis.label;
    return {
      ok: true,
      draft: {
        aksi: 'buat_uang_muka',
        judul: 'Una mau mencatat Uang Muka ini — dicek dulu ya:',
        baris: [
          ['Jenis', jenis.label],
          ...(pihak ? [['Ke', pihak]] : []),
          ['Keterangan', keterangan],
          ['Nominal', rupiah(nominal.nilai)],
          ['Dibayar lewat', cara.nilai.label],
          ['Tanggal', tanggal.nilai]
        ],
        dampak: [
          `Saldo ${jenis.label} bertambah ${rupiah(nominal.nilai)}, nanti bisa dipakai membayar.`,
          `Uangnya keluar dari ${cara.nilai.label} — bukan dari kas atau laci.`
        ],
        muatan: {
          category: jenis.kode,
          counterpartyType: 'OTHER',
          counterpartyName: pihak,
          description: keterangan,
          amount: nominal.nilai,
          paymentMethod: cara.nilai.paymentMethod,
          sharedAccountId: cara.nilai.sharedAccountId,
          businessDate: tanggal.nilai
        }
      }
    };
  },

  posting(draft, ctx) {
    return kirimDanJawab(ctx, '/api/admin/hutang-piutang/deposits', draft.muatan, 'Sudah Una catat Uang Mukanya.');
  }
});

export const AKSI_BAYAR = Object.freeze([beaGaji, beaLapak, bayarLainnya, bayarHutang, uangMuka]);

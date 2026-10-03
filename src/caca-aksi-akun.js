// Alat Una untuk merawat akun dan cara bayar (permintaan Bos Cyo 2026-10-02:
// "pindahin saldo piutang malang ke rekening bersama, lalu nonaktifkan akun
// piutang malang untuk semua gerai, semua yang dulunya make itu sekarang
// makai rekening bersama, dan pastikan akun rekening bersama di entity itu
// sudah relevan dengan gerai2 lainnya").
//
// Prinsip Bos Cyo: apa pun yang dikerjakan Una harus sudah punya jalurnya di
// sistem, dan Una memastikan dulu lewat draft. Jadi setiap alat di sini hanya
// merangkai endpoint yang sudah dipakai layar:
//   - saldo akun        <- GET  /api/admin/accounting/balance-sheet
//   - daftar akun       <- GET  /api/admin/accounting (juga: boleh akun custom?)
//   - cara bayar        <- GET  /api/admin/settings/accounting
//                          PATCH /api/admin/settings/business/payment-methods/:id
//   - pindah saldo      <- POST /api/admin/accounting/journals (jurnal resmi, balance exact)
//   - nonaktifkan akun  <- PATCH /api/admin/accounting/accounts/:id
//   - mutasi Rekber     <- GET  /api/admin/hutang-piutang (saldo Rekening Bersama per gerai)
//
// Di lingkup entity ("semua gerai") satu perintah dijalankan ke setiap gerai
// entity itu. Draft-nya memuat rincian per gerai, dan waktu "Ya" ditekan
// setiap gerai dijalankan berurutan lewat endpointnya masing-masing; hasil
// tiap gerai dilaporkan sendiri-sendiri, tidak disembunyikan di balik satu
// kata "berhasil".

import { rupiah } from './caca-nominal.js';
import { normalkan, cocokkanSatu, teks } from './caca-aksi-dasar.js';

const SATU_JUTA = 1_000_000n;
const REFERENSI = /^caca_[0-9a-f-]{36}$/;

/** Nominal skala 1.000.000 ditampilkan persis, tanpa float (invariant #1). */
export function rupiahSkala(scaled) {
  const nilai = BigInt(Math.trunc(Number(scaled) || 0));
  const minus = nilai < 0n;
  const abs = minus ? -nilai : nilai;
  const bulat = abs / SATU_JUTA;
  const sisa = abs % SATU_JUTA;
  const pecahan = sisa ? `,${sisa.toString().padStart(6, '0').replace(/0+$/, '')}` : '';
  return `${minus ? '−' : ''}${rupiah(Number(bulat))}${pecahan}`;
}

// Gerai sasaran: satu gerai yang sedang dibuka, atau semua gerai entity.
async function geraiSasaran(ctx) {
  if (ctx.lingkup !== 'entity') return { ok: true, nilai: [{ code: ctx.storeCode, storeName: ctx.namaLingkup }] };
  const ref = await ctx.baca('/api/entity-admin/stores');
  if (!ref.ok) return ref;
  const daftar = (ref.data.stores ?? [])
    .filter((s) => s.isActive !== false)
    .map((s) => ({ code: s.code, storeName: s.storeName }))
    .sort((a, b) => a.code.localeCompare(b.code));
  if (!daftar.length) return { ok: false, tanya: 'Entity ini belum punya gerai aktif.' };
  return { ok: true, nilai: daftar };
}

function cocokAkun(tertulis, akun) {
  return cocokkanSatu(tertulis, akun, { label: 'akun', namaDari: (a) => a.accountName, kunciLain: (a) => [a.accountCode] });
}

// Pencocokan per gerai harus PERSIS (nama atau kode), tidak boleh "mengandung":
// di lingkup entity satu kalimat dijalankan ke banyak gerai, dan pencocokan
// longgar bisa memilih akun yang berbeda-beda di tiap gerai tanpa ada yang
// sadar. Gerai yang tidak punya akun itu dilewati dan disebut di draft.
function akunPersis(tertulis, akun) {
  const kunci = normalkan(tertulis);
  const kandidat = akun.filter((a) => normalkan(a.accountName) === kunci || normalkan(a.accountCode) === kunci);
  return kandidat.length === 1 ? kandidat[0] : null;
}

function jalurUntuk(ctx, gerai) {
  return ctx.lingkup === 'entity' ? ctx.jalurGerai(gerai.code) : ctx;
}

function referensiDraft(ctx) {
  return ctx.referensi && REFERENSI.test(ctx.referensi) ? ctx.referensi : `caca_${crypto.randomUUID()}`;
}

function lingkupKalimat(ctx, gerai) {
  return ctx.lingkup === 'entity' ? `${gerai.length} gerai di ${ctx.namaLingkup}` : ctx.namaLingkup;
}

// --- cek Rekening Bersama (baca saja) --------------------------------------

const cekRekber = Object.freeze({
  nama: 'cek_rekening_bersama',
  lingkup: 'semua',
  baca: true,
  petunjuk: 'mengecek apakah catatan mutasi Rekening Bersama cocok dengan akun Rekening Bersama (1103) di pembukuan, mis. "rekening bersama udah cocok belum?".',
  skema: {},

  async siapkan(_t, ctx) {
    const gerai = await geraiSasaran(ctx);
    if (!gerai.ok) return gerai;

    const isi = [];
    let beda = 0;
    for (const g of gerai.nilai) {
      const jalur = jalurUntuk(ctx, g);
      const [mutasi, neraca] = await Promise.all([
        jalur.baca('/api/admin/hutang-piutang'),
        jalur.baca(`/api/admin/accounting/balance-sheet?asOf=${ctx.hariIni}`)
      ]);
      if (!mutasi.ok || !neraca.ok) {
        isi.push([g.storeName, '—', '—', `belum kebaca: ${(mutasi.ok ? neraca : mutasi).error}`]);
        continue;
      }
      const saldoMutasi = (mutasi.data.sharedAccounts ?? []).reduce((jumlah, r) => jumlah + Number(r.storeBalance || 0), 0);
      const akun1103 = (neraca.data.report?.assets ?? []).find((a) => a.accountCode === '1103');
      const saldoBuku = akun1103 ? Number(akun1103.balanceScaled) : 0;
      const selisih = saldoBuku - saldoMutasi * 1_000_000;
      if (selisih !== 0) beda += 1;
      isi.push([g.storeName, rupiah(saldoMutasi), rupiahSkala(saldoBuku), selisih === 0 ? 'cocok' : `beda ${rupiahSkala(selisih)}`]);
    }

    return {
      ok: true,
      jawaban: beda === 0
        ? `Rekening Bersama cocok di ${gerai.nilai.length} gerai: catatan mutasi sama dengan pembukuan.`
        : `${beda} dari ${gerai.nilai.length} gerai belum cocok antara catatan mutasi Rekening Bersama dan pembukuan akun 1103. Bedanya biasanya dari transaksi yang hanya tercatat di salah satu — mis. cara bayar kasir yang menuju akun Rekening Bersama tapi belum ditautkan ke Rekening Bersama-nya.`,
      tabel: { kolom: ['Gerai', 'Catatan mutasi', 'Pembukuan 1103', 'Hasil'], isi }
    };
  }
});

// --- atur cara bayar --------------------------------------------------------

const POLA_LEPAS = /^(lepas|hapus|tidak ada|kosong|none|-)$/;

const aturCaraBayar = Object.freeze({
  nama: 'atur_cara_bayar',
  lingkup: 'semua',
  petunjuk: 'mengubah cara bayar kasir/admin: akun pembukuannya, tautan ke Rekening Bersama, nama, atau aktif/nonaktif, mis. "cara bayar Piutang Poci Malang ganti nama jadi Rekening Bersama dan tautkan ke Rekening Bersama Malang".',
  skema: {
    cb_nama: { type: 'string', description: 'atur_cara_bayar: nama cara bayar yang diubah, PERSIS seperti diucapkan.' },
    cb_akun: { type: 'string', description: 'atur_cara_bayar: akun pembukuan tujuan (nama atau kode), hanya kalau disebut.' },
    cb_rekber: { type: 'string', description: 'atur_cara_bayar: nama Rekening Bersama yang ditautkan, atau "lepas", hanya kalau disebut.' },
    cb_nama_baru: { type: 'string', description: 'atur_cara_bayar: nama baru, hanya kalau disebut.' },
    cb_status: { type: 'string', enum: ['aktif', 'nonaktif'], description: 'atur_cara_bayar: hanya kalau diminta mengaktifkan/menonaktifkan.' }
  },

  async siapkan(t, ctx) {
    const namaCara = teks(t?.cb_nama, 80);
    if (!namaCara) return { ok: false, tanya: 'Cara bayar yang mana yang mau diubah?' };
    const akunTertulis = teks(t?.cb_akun, 120);
    const rekberTertulis = teks(t?.cb_rekber, 120);
    const namaBaru = teks(t?.cb_nama_baru, 80);
    const status = t?.cb_status === 'aktif' || t?.cb_status === 'nonaktif' ? t.cb_status : '';
    if (!akunTertulis && !rekberTertulis && !namaBaru && !status) {
      return { ok: false, tanya: `"${namaCara}" mau diubah apanya? Akunnya, tautan Rekening Bersama, namanya, atau aktif/nonaktif?` };
    }

    const gerai = await geraiSasaran(ctx);
    if (!gerai.ok) return gerai;

    const isi = [];
    const langkah = [];
    const dilewati = [];
    for (const g of gerai.nilai) {
      const ref = await jalurUntuk(ctx, g).baca('/api/admin/settings/accounting');
      if (!ref.ok) return { ok: false, tanya: `Pengaturan ${g.storeName} belum kebaca nih: ${ref.error}` };
      const cara = (ref.data.paymentMethods ?? []).find((p) => normalkan(p.name) === normalkan(namaCara) || normalkan(p.code) === normalkan(namaCara));
      if (!cara) { dilewati.push(g.storeName); continue; }

      const ubah = {};
      let akunBaru = cara.account;
      if (akunTertulis) {
        // Daftar akun di Setting Akuntansi berbentuk {id, code, name, type},
        // beda dari daftar di modul Akuntansi; disamakan dulu di sini.
        const akunAktif = (ref.data.accounts ?? [])
          .filter((a) => a.isActive !== false)
          .map((a) => ({ accountId: a.id, accountCode: a.code, accountName: a.name, accountType: a.type }));
        const akun = ctx.lingkup === 'entity'
          ? akunPersis(akunTertulis, akunAktif)
          : (cocokAkun(akunTertulis, akunAktif).nilai ?? null);
        if (!akun) return { ok: false, tanya: `Akun "${akunTertulis}" belum ketemu nih di ${g.storeName} (namanya harus persis).` };
        ubah.accountId = akun.accountId;
        akunBaru = { code: akun.accountCode, name: akun.accountName };
      }
      let rekberBaru = cara.sharedAccountName;
      if (rekberTertulis) {
        if (POLA_LEPAS.test(normalkan(rekberTertulis))) {
          ubah.sharedAccountId = '';
          rekberBaru = null;
        } else {
          const rekber = cocokkanSatu(rekberTertulis, ref.data.sharedAccounts ?? [], { label: 'Rekening Bersama', namaDari: (r) => r.name });
          if (!rekber.ok) return { ok: false, tanya: `${g.storeName}: ${rekber.tanya}` };
          ubah.sharedAccountId = rekber.nilai.id;
          rekberBaru = rekber.nilai.name;
        }
      }
      if (namaBaru) ubah.name = namaBaru;
      if (status) ubah.isActive = status === 'aktif';
      if (cara.isDefault && ubah.isActive === false) {
        return { ok: false, tanya: `"${cara.name}" adalah cara bayar bawaan di ${g.storeName}. Pilih bawaan lain dulu sebelum menonaktifkannya.` };
      }

      const akunLabel = (a) => (a ? `${a.code} ${a.name}`.trim() : '—');
      isi.push([
        g.storeName,
        `${cara.name} · ${akunLabel(cara.account)} · ${cara.sharedAccountName || 'tanpa Rekber'}${cara.isActive ? '' : ' · nonaktif'}`,
        `${namaBaru || cara.name} · ${akunLabel(akunBaru)} · ${rekberBaru || 'tanpa Rekber'}${(status ? status === 'aktif' : cara.isActive) ? '' : ' · nonaktif'}`
      ]);
      langkah.push({ store: g.code, storeName: g.storeName, id: cara.id, ubah });
    }

    if (!langkah.length) return { ok: false, tanya: `Cara bayar "${namaCara}" tidak ada di ${ctx.lingkup === 'entity' ? 'gerai mana pun' : ctx.namaLingkup}.` };
    return {
      ok: true,
      draft: {
        aksi: 'atur_cara_bayar',
        judul: `Una mau mengubah cara bayar "${namaCara}" — dicek dulu ya:`,
        baris: [['Berlaku di', lingkupKalimat(ctx, langkah)]],
        tabel: { kolom: ['Gerai', 'Sekarang', 'Jadi'], isi },
        dampak: [
          'Berlaku untuk transaksi BARU yang memakai cara bayar ini. Jurnal dan transaksi lama tidak berubah.',
          ...(rekberTertulis && !POLA_LEPAS.test(normalkan(rekberTertulis))
            ? ['Transaksi baru lewat cara bayar ini ikut tercatat di mutasi Rekening Bersama.'] : []),
          ...(dilewati.length ? [`Dilewati karena tidak punya cara bayar ini: ${dilewati.join(', ')}.`] : [])
        ],
        muatan: { langkah }
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = [];
    for (const l of draft.muatan.langkah) {
      const jalur = ctx.lingkup === 'entity' ? ctx.jalurGerai(l.store) : ctx;
      const r = await jalur.kirim('PATCH', `/api/admin/settings/business/payment-methods/${encodeURIComponent(l.id)}`, l.ubah);
      hasil.push(`${l.storeName}: ${r.ok ? 'sudah diubah' : `gagal — ${r.error}`}`);
    }
    return { ok: true, jawaban: hasil.join('\n') };
  }
});

// --- pindah saldo akun (dan opsional menonaktifkan akun asal) ---------------

const pindahSaldo = Object.freeze({
  nama: 'pindah_saldo_akun',
  lingkup: 'semua',
  petunjuk: 'memindahkan seluruh saldo satu akun ke akun lain lewat jurnal resmi, dan/atau menonaktifkan akun asalnya, mis. "pindahin saldo Piutang Poci Malang ke Rekening Bersama lalu nonaktifkan", "nonaktifkan akun Piutang Poci Malang".',
  skema: {
    ps_asal: { type: 'string', description: 'pindah_saldo_akun: akun asal (nama atau kode) PERSIS seperti diucapkan.' },
    ps_tujuan: { type: 'string', description: 'pindah_saldo_akun: akun tujuan (nama atau kode) PERSIS seperti diucapkan. Kosongkan kalau cuma minta menonaktifkan.' },
    ps_nonaktifkan: { type: 'string', enum: ['ya', 'tidak'], description: 'pindah_saldo_akun: "ya" kalau akun asal sekalian dinonaktifkan.' }
  },

  async siapkan(t, ctx) {
    const asalTertulis = teks(t?.ps_asal, 120);
    const tujuanTertulis = teks(t?.ps_tujuan, 120);
    if (!asalTertulis) return { ok: false, tanya: 'Saldo akun mana yang mau dipindah?' };
    const nonaktifkan = t?.ps_nonaktifkan === 'ya';
    // Tanpa tujuan hanya sah untuk "nonaktifkan saja": akunnya harus bersaldo
    // nol di setiap gerai, dicek di bawah.
    if (!tujuanTertulis && !nonaktifkan) return { ok: false, tanya: `Saldo "${asalTertulis}" dipindah ke akun apa?` };

    const gerai = await geraiSasaran(ctx);
    if (!gerai.ok) return gerai;
    const referensi = referensiDraft(ctx);

    const isi = [];
    const langkah = [];
    const dilewati = [];
    for (const g of gerai.nilai) {
      const jalur = jalurUntuk(ctx, g);
      const [buku, neraca] = await Promise.all([
        jalur.baca('/api/admin/accounting'),
        jalur.baca(`/api/admin/accounting/balance-sheet?asOf=${ctx.hariIni}`)
      ]);
      if (!buku.ok || !neraca.ok) return { ok: false, tanya: `Pembukuan ${g.storeName} belum kebaca nih: ${(buku.ok ? neraca : buku).error}` };

      const semuaAkun = (buku.data.accounts ?? []).filter((a) => !a.isSystemManaged);
      const persis = ctx.lingkup === 'entity';
      const asal = persis ? akunPersis(asalTertulis, semuaAkun) : cocokAkun(asalTertulis, semuaAkun).nilai;
      if (!asal) {
        if (persis) { dilewati.push(g.storeName); continue; }
        return cocokAkun(asalTertulis, semuaAkun);
      }
      const baris = [
        ...(neraca.data.report?.assets ?? []), ...(neraca.data.report?.liabilities ?? []), ...(neraca.data.report?.equity ?? [])
      ].find((r) => r.accountId === asal.accountId);
      // Selisih debit-kredit apa adanya, skala 1.000.000. Saldo kredit di akun
      // aset ikut pindah sebagai kredit (invariant #8), tidak di-abs().
      const bersih = baris ? Number(baris.debitScaled) - Number(baris.creditScaled) : 0;

      let tujuan = null;
      if (bersih !== 0) {
        if (!tujuanTertulis) {
          return { ok: false, tanya: `"${asal.accountName}" di ${g.storeName} masih bersaldo ${rupiahSkala(Math.abs(bersih))}. Saldonya dipindah ke akun apa dulu?` };
        }
        const akunAktif = semuaAkun.filter((a) => a.isActive);
        tujuan = persis ? akunPersis(tujuanTertulis, akunAktif) : cocokAkun(tujuanTertulis, akunAktif).nilai;
        if (!tujuan) return { ok: false, tanya: `Akun tujuan "${tujuanTertulis}" belum nemu nih di ${g.storeName} (yang aktif).` };
        if (tujuan.accountId === asal.accountId) return { ok: false, tanya: 'Akun asal dan tujuan sama.' };
        // Sama seperti peta ADR-047: tipe asal dan tujuan wajib sama, supaya
        // saldo tidak berpindah golongan (mis. aset jadi utang) diam-diam.
        if (tujuan.accountType !== asal.accountType) {
          return { ok: false, tanya: `${g.storeName}: "${asal.accountName}" (${asal.accountType}) dan "${tujuan.accountName}" (${tujuan.accountType}) beda golongan. Saldo hanya dipindah antar akun segolongan.` };
        }
      }
      const bisaNonaktif = nonaktifkan && asal.isActive && Boolean(buku.data.customAccountsAllowed);
      if (bersih === 0 && !bisaNonaktif) { dilewati.push(`${g.storeName} (saldo 0${nonaktifkan && asal.isActive ? ', akun standar terkunci' : ''})`); continue; }

      const nominal = Math.abs(bersih);
      const jurnal = bersih === 0 ? null : {
        businessDate: ctx.hariIni,
        description: `Pindah saldo ${asal.accountName} ke ${tujuan.accountName}`,
        sourceReferenceId: `${referensi}:${g.code}`,
        journalLines: bersih > 0
          ? [{ accountId: tujuan.accountId, side: 'DEBIT', amountScaled: nominal }, { accountId: asal.accountId, side: 'CREDIT', amountScaled: nominal }]
          : [{ accountId: asal.accountId, side: 'DEBIT', amountScaled: nominal }, { accountId: tujuan.accountId, side: 'CREDIT', amountScaled: nominal }]
      };
      isi.push([
        g.storeName,
        `${asal.accountCode} ${asal.accountName}`.trim(),
        bersih === 0 ? '0' : `${rupiahSkala(nominal)} ${bersih > 0 ? 'debit' : 'kredit'}`,
        bisaNonaktif ? 'dinonaktifkan' : (nonaktifkan && asal.isActive ? 'tetap (akun standar terkunci)' : (asal.isActive ? 'tetap aktif' : 'sudah nonaktif'))
      ]);
      langkah.push({ store: g.code, storeName: g.storeName, jurnal, nonaktifkanAkunId: bisaNonaktif ? asal.accountId : null });
    }

    if (!langkah.length) {
      return { ok: false, tanya: `Nggak ada yang perlu dipindah: ${dilewati.length ? dilewati.join(', ') : 'akunnya belum ketemu nih'}.` };
    }
    return {
      ok: true,
      draft: {
        aksi: 'pindah_saldo_akun',
        judul: tujuanTertulis
          ? `Una mau memindahkan saldo "${asalTertulis}" ke "${tujuanTertulis}" — dicek dulu ya:`
          : `Una mau menonaktifkan akun "${asalTertulis}" — dicek dulu ya:`,
        baris: [['Berlaku di', lingkupKalimat(ctx, langkah)], ['Tanggal jurnal', ctx.hariIni]],
        tabel: { kolom: ['Gerai', 'Akun asal', 'Saldo dipindah', 'Akun asal sesudahnya'], isi },
        dampak: [
          'Saldonya dipindah lewat jurnal resmi per gerai — jurnal lama tidak diubah, dan pemindahan ini bisa dibalik dengan jurnal balik.',
          'Akun yang masih dipakai pengaturan aktif (cara bayar, kategori, aturan jurnal) akan ditolak dinonaktifkan sistem — alihkan pemakaiannya dulu.',
          ...(dilewati.length ? [`Dilewati: ${dilewati.join(', ')}.`] : [])
        ],
        muatan: { sourceReferenceId: referensi, langkah }
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = [];
    for (const l of draft.muatan.langkah) {
      const jalur = ctx.lingkup === 'entity' ? ctx.jalurGerai(l.store) : ctx;
      const catatan = [];
      let lanjut = true;
      if (l.jurnal) {
        const r = await jalur.kirim('POST', '/api/admin/accounting/journals', l.jurnal);
        lanjut = r.ok;
        catatan.push(r.ok ? `jurnal ${r.data?.journal?.journalNumber || 'diposting'}${r.data?.duplicate ? ' (sudah pernah)' : ''}` : `jurnal gagal — ${r.error}`);
      }
      // Akun hanya dinonaktifkan kalau saldonya benar-benar sudah pindah.
      if (lanjut && l.nonaktifkanAkunId) {
        const r = await jalur.kirim('PATCH', `/api/admin/accounting/accounts/${encodeURIComponent(l.nonaktifkanAkunId)}`, { isActive: false });
        catatan.push(r.ok ? 'akun dinonaktifkan' : `nonaktif gagal — ${r.error}`);
      }
      hasil.push(`${l.storeName}: ${catatan.join(', ')}`);
    }
    return { ok: true, jawaban: hasil.join('\n') };
  }
});

export const AKSI_AKUN = Object.freeze([cekRekber, aturCaraBayar, pindahSaldo]);

// Alat akuntan Una (permintaan Bos Cyo 2026-10-03: "semuanya harus konek dengan
// akuntansi ... kalau belum bisa konek karena setelan, nanti aku suruh Una").
//
// Alat yang sama dengan yang dipakai akuntan manusia, bukan jalan pintas:
//   - sinkron_akuntansi     <- POST /api/admin/accounting/bridge/sync   (tombol Sinkron)
//   - samakan_aturan_jurnal <- POST/PATCH /api/admin/settings/accounting/journal-rules
//                              (layar Setting Akuntansi > Aturan Jurnal)
// Penemuan masalahnya lewat alat baca `jembatan_masalah`
// (GET /api/admin/accounting/bridge/issues) dan HPP lewat `audit_hpp`
// (GET /api/admin/hpp-audit); koreksi HPP memakai `hitung_ulang_hpp` yang sudah ada.
// Keduanya lewat draft "dicek dulu" seperti alat lain.

import { normalkan, teks } from './caca-aksi-dasar.js';

const MAKS_GERAI_RINGKAS = 30;

// Bentuk aturan yang bisa disalin lintas gerai: hanya baris akun tetap. Baris
// pilihan akun (choice group) menunjuk grup milik gerai itu sendiri, jadi
// tidak punya padanan otomatis di gerai lain.
function tandaTangan(rules) {
  return rules
    .filter((r) => r.isActive && r.sourceType === 'fixed_account' && r.fixedAccount?.code)
    .map((r) => `${r.side}:${r.fixedAccount.code}:${r.isDefault ? 1 : 0}`)
    .sort()
    .join('|');
}

function adaPilihanAkun(rules) {
  return rules.some((r) => r.isActive && r.sourceType !== 'fixed_account');
}

function cariKategori(settings, tertulis) {
  const kunci = normalkan(tertulis);
  return (settings.transactionCategories ?? []).find((k) => normalkan(k.code) === kunci || normalkan(k.name) === kunci) ?? null;
}

async function daftarGerai(ctx) {
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

const jalurUntuk = (ctx, gerai) => (ctx.lingkup === 'entity' ? ctx.jalurGerai(gerai.code) : ctx);

// --- sinkron_akuntansi -------------------------------------------------------

const sinkronAkuntansi = Object.freeze({
  nama: 'sinkron_akuntansi',
  lingkup: 'semua',
  petunjuk: 'mengirim transaksi yang belum berjurnal ke Akuntansi (sama dengan tombol Sinkron di Akuntansi), mis. "sinkronkan akuntansi" atau "coba posting lagi yang mandek". Jalankan SESUDAH setelan akun/aturan jurnal dibetulkan. Cek dulu penyebabnya lewat alat baca jembatan_masalah.',
  skema: {},

  async siapkan(_t, ctx) {
    const gerai = await daftarGerai(ctx);
    if (!gerai.ok) return gerai;

    const isi = [];
    const langkah = [];
    let total = 0;
    for (const g of gerai.nilai) {
      const r = await jalurUntuk(ctx, g).baca('/api/admin/accounting/bridge/issues');
      if (!r.ok) return { ok: false, tanya: `Daftar transaksi mandek ${g.storeName} belum kebaca nih: ${r.error}` };
      if (r.data.accounting === false) continue;
      const owing = Number(r.data.summary?.owing || 0);
      const hppTertunda = Number(r.data.hppCorrectionsWaiting || 0);
      if (owing + hppTertunda === 0) continue;
      const sebab = (r.data.summary?.byCause ?? []).slice(0, 2).map((c) => `${c.cause?.arti ?? c.code} (${c.count})`).join('; ');
      isi.push([g.storeName, String(owing), String(hppTertunda), sebab || '—']);
      langkah.push({ store: g.code, storeName: g.storeName });
      total += owing + hppTertunda;
    }
    if (!langkah.length) {
      return { ok: false, tanya: `Semua transaksi di ${ctx.lingkup === 'entity' ? 'gerai-gerai ini' : ctx.namaLingkup} sudah berjurnal, jadi tidak ada yang perlu disinkron.` };
    }
    return {
      ok: true,
      draft: {
        aksi: 'sinkron_akuntansi',
        judul: `Una mau mengirim ${total} transaksi ke Akuntansi — dicek dulu ya:`,
        baris: [['Berlaku di', ctx.lingkup === 'entity' ? `${langkah.length} gerai di ${ctx.namaLingkup}` : ctx.namaLingkup]],
        tabel: { kolom: ['Gerai', 'Belum berjurnal', 'Koreksi HPP menunggu', 'Penyebab terbanyak'], isi: isi.slice(0, MAKS_GERAI_RINGKAS) },
        dampak: [
          'Yang setelannya sudah lengkap langsung dijurnalkan dan masuk Laporan Untung Rugi sesuai tanggal transaksinya.',
          'Yang setelannya masih belum lengkap tetap mandek dan dilaporkan lagi; tidak ada yang dipaksa.',
          'Jurnal yang berhasil dibuat permanen: kalau ada yang salah, dikoreksi lewat jurnal pembalik, bukan diedit.'
        ],
        muatan: { langkah }
      }
    };
  },

  async posting(draft, ctx) {
    const hasil = [];
    for (const l of draft.muatan.langkah) {
      const jalur = ctx.lingkup === 'entity' ? ctx.jalurGerai(l.store) : ctx;
      const r = await jalur.kirim('POST', '/api/admin/accounting/bridge/sync', { limit: 100 });
      if (!r.ok) { hasil.push(`${l.storeName}: gagal — ${r.error}`); continue; }
      const d = r.data ?? {};
      const sisa = Number(d.needsConfiguration || 0) + Number(d.failed || 0);
      hasil.push(`${l.storeName}: ${d.posted ?? 0} dari ${d.attempted ?? 0} berhasil dijurnalkan${sisa ? `, ${sisa} masih mandek (setelan belum lengkap atau gagal)` : ''}.`);
    }
    return { ok: true, jawaban: `${hasil.join('\n')}\nCek jembatan_masalah lagi untuk melihat yang tersisa.` };
  }
});

// --- samakan_aturan_jurnal ---------------------------------------------------

// Rencana per gerai: baris acuan yang belum ada di gerai itu. Dihitung ulang
// persis sebelum menulis, jadi aman kalau konfirmasi dikirim dua kali.
function rencanaGerai(settingsGerai, kategoriKode, acuan) {
  const kategori = cariKategori(settingsGerai, kategoriKode);
  if (!kategori) return { ok: false, alasan: `belum punya kategori transaksi "${kategoriKode}" (buat dulu di Setting Akuntansi)` };
  const akunAktif = new Map((settingsGerai.accounts ?? []).filter((a) => a.isActive !== false).map((a) => [a.code, a]));
  const buat = [];
  const aktifkan = [];
  const tanpaAkun = [];
  for (const rule of acuan) {
    const akun = akunAktif.get(rule.fixedAccount.code);
    if (!akun) { tanpaAkun.push(rule.fixedAccount.code); continue; }
    const sama = (kategori.rules ?? []).filter((r) => r.sourceType === 'fixed_account' && r.side === rule.side && r.fixedAccount?.code === rule.fixedAccount.code);
    if (sama.some((r) => r.isActive)) continue;
    if (sama.length) { aktifkan.push({ id: sama[0].id, label: rule.label, side: rule.side, akun: rule.fixedAccount.code }); continue; }
    buat.push({
      label: rule.label, side: rule.side, sourceType: 'fixed_account', fixedAccountId: akun.id,
      isDefault: Boolean(rule.isDefault), sortOrder: Number(rule.sortOrder || 0), akun: rule.fixedAccount.code
    });
  }
  if (tanpaAkun.length) return { ok: false, alasan: `akun ${[...new Set(tanpaAkun)].join(', ')} belum ada/aktif di gerai ini` };
  return { ok: true, kategoriId: kategori.id, kategoriNama: kategori.name, buat, aktifkan, sekarang: (kategori.rules ?? []).filter((r) => r.isActive).length };
}

const samakanAturanJurnal = Object.freeze({
  nama: 'samakan_aturan_jurnal',
  lingkup: 'entity',
  petunjuk: 'melengkapi aturan jurnal sebuah kategori transaksi yang kosong/belum lengkap dengan menyalin dari gerai yang sudah beres (sama dengan mengisi Setting Akuntansi > Aturan Jurnal), mis. "aturan jurnal operasional Mandala kosong, samakan dengan gerai lain". Hanya menambah baris yang kurang; aturan yang sudah ada tidak dihapus. Kode kategori ada di hasil jembatan_masalah (cause.parameter.kategori).',
  skema: {
    aj_kategori: { type: 'string', description: 'samakan_aturan_jurnal: kode atau nama kategori transaksi, mis. "operational" atau "purchase_material".' },
    aj_dari_gerai: { type: 'string', description: 'samakan_aturan_jurnal: kode gerai acuan, HANYA kalau penanya menyebutnya. Kosongkan supaya Una memilih konfigurasi yang paling umum di entity.' }
  },

  async siapkan(t, ctx) {
    const kategoriTertulis = teks(t?.aj_kategori, 60);
    if (!kategoriTertulis) return { ok: false, tanya: 'Kategori transaksi yang mana yang aturan jurnalnya mau disamakan? (mis. operasional, pembelian bahan)' };
    const acuanTertulis = teks(t?.aj_dari_gerai, 40).toUpperCase();

    const gerai = await daftarGerai(ctx);
    if (!gerai.ok) return gerai;

    const setelan = new Map();
    for (const g of gerai.nilai) {
      const r = await ctx.jalurGerai(g.code).baca('/api/admin/settings/accounting');
      if (!r.ok) return { ok: false, tanya: `Setelan akuntansi ${g.storeName} belum kebaca nih: ${r.error}` };
      setelan.set(g.code, r.data);
    }

    const peta = gerai.nilai.map((g) => ({ gerai: g, kategori: cariKategori(setelan.get(g.code), kategoriTertulis) }));
    const adaKategori = peta.filter((p) => p.kategori);
    if (!adaKategori.length) return { ok: false, tanya: `Kategori "${kategoriTertulis}" belum ketemu nih di gerai mana pun. Kodenya apa ya?` };
    const kode = adaKategori[0].kategori.code;
    const lengkap = adaKategori.filter((p) => p.kategori.completeness === 'COMPLETE');

    // Gerai acuan: yang disebut penanya, atau konfigurasi lengkap yang paling umum.
    let acuan;
    if (acuanTertulis) {
      acuan = lengkap.find((p) => p.gerai.code === acuanTertulis);
      if (!acuan) return { ok: false, tanya: `Gerai acuan ${acuanTertulis} tidak punya aturan "${kode}" yang lengkap. Pilih gerai lain atau biarkan Una memilih.` };
    } else {
      if (!lengkap.length) return { ok: false, tanya: `Tidak ada gerai yang aturan "${kode}"-nya lengkap sebagai acuan. Aturan ini harus disusun manual dulu di salah satu gerai.` };
      const hitung = new Map();
      for (const p of lengkap) {
        const ttd = tandaTangan(p.kategori.rules);
        hitung.set(ttd, [...(hitung.get(ttd) ?? []), p]);
      }
      const urut = [...hitung.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      acuan = urut[0][1].sort((a, b) => a.gerai.code.localeCompare(b.gerai.code))[0];
    }
    if (adaPilihanAkun(acuan.kategori.rules)) {
      return { ok: false, tanya: `Aturan "${kode}" di ${acuan.gerai.storeName} memakai pilihan akun yang berbeda tiap gerai, jadi tidak bisa disalin otomatis. Susun manual di Setting Akuntansi.` };
    }
    const baris = acuan.kategori.rules
      .filter((r) => r.isActive && r.sourceType === 'fixed_account' && r.fixedAccount?.code)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
    if (!baris.length) return { ok: false, tanya: `Gerai acuan ${acuan.gerai.storeName} tidak punya baris aturan aktif untuk disalin.` };

    const isi = [];
    const langkah = [];
    const dilewati = [];
    for (const p of adaKategori) {
      if (p.gerai.code === acuan.gerai.code || p.kategori.completeness === 'COMPLETE') continue;
      const rencana = rencanaGerai(setelan.get(p.gerai.code), kode, baris);
      if (!rencana.ok) { dilewati.push(`${p.gerai.storeName}: ${rencana.alasan}`); continue; }
      if (!rencana.buat.length && !rencana.aktifkan.length) { dilewati.push(`${p.gerai.storeName}: barisnya sudah lengkap, kemungkinan masalahnya di tempat lain (cek jembatan_masalah)`); continue; }
      const tambah = [...rencana.buat, ...rencana.aktifkan].map((r) => `${r.side === 'DEBIT' ? 'Debit' : 'Kredit'} ${r.akun ?? ''}`.trim()).join(', ');
      isi.push([p.gerai.storeName, `${rencana.sekarang} baris aktif`, tambah]);
      langkah.push({ store: p.gerai.code, storeName: p.gerai.storeName });
    }
    for (const p of peta.filter((x) => !x.kategori)) dilewati.push(`${p.gerai.storeName}: belum punya kategori "${kode}"`);
    if (!langkah.length) {
      return { ok: false, tanya: `Tidak ada gerai yang perlu dilengkapi aturan "${kode}"-nya.${dilewati.length ? ` ${dilewati.join('; ')}.` : ''}` };
    }
    return {
      ok: true,
      draft: {
        aksi: 'samakan_aturan_jurnal',
        judul: `Una mau melengkapi aturan jurnal "${kode}" dengan menyalin dari ${acuan.gerai.storeName} — dicek dulu ya:`,
        baris: [
          ['Acuan', `${acuan.gerai.storeName} (${baris.map((r) => `${r.side === 'DEBIT' ? 'Debit' : 'Kredit'} ${r.fixedAccount.code}`).join(', ')})`],
          ['Berlaku di', `${langkah.length} gerai`]
        ],
        tabel: { kolom: ['Gerai', 'Sekarang', 'Akan ditambah'], isi },
        dampak: [
          'Hanya menambah/mengaktifkan baris yang kurang; aturan yang sudah ada tidak dihapus atau diubah.',
          'Berlaku untuk transaksi baru. Transaksi yang sudah mandek baru terjurnal setelah sinkron_akuntansi dijalankan.',
          'Jurnal yang sudah terbit tidak berubah.',
          ...(dilewati.length ? [`Dilewati: ${dilewati.join('; ')}.`] : [])
        ],
        muatan: { kategori: kode, acuan: acuan.gerai.code, baris: baris.map((r) => ({ label: r.label, side: r.side, fixedAccount: { code: r.fixedAccount.code }, isDefault: r.isDefault, sortOrder: r.sortOrder })), langkah }
      }
    };
  },

  async posting(draft, ctx) {
    const { kategori, baris, langkah } = draft.muatan;
    const hasil = [];
    for (const l of langkah) {
      const jalur = ctx.jalurGerai(l.store);
      // Baca ulang tepat sebelum menulis: konfirmasi ganda tidak boleh membuat baris kembar.
      const ref = await jalur.baca('/api/admin/settings/accounting');
      if (!ref.ok) { hasil.push(`${l.storeName}: setelan belum kebaca — ${ref.error}`); continue; }
      const rencana = rencanaGerai(ref.data, kategori, baris.map((b) => ({ ...b, fixedAccount: b.fixedAccount })));
      if (!rencana.ok) { hasil.push(`${l.storeName}: dilewati — ${rencana.alasan}`); continue; }
      if (!rencana.buat.length && !rencana.aktifkan.length) { hasil.push(`${l.storeName}: sudah lengkap (tidak ada yang perlu ditambah).`); continue; }
      let berhasil = 0;
      const gagal = [];
      for (const b of rencana.buat) {
        const r = await jalur.kirim('POST', '/api/admin/settings/accounting/journal-rules', {
          transactionCategoryId: rencana.kategoriId, label: b.label, side: b.side, sourceType: b.sourceType,
          fixedAccountId: b.fixedAccountId, isActive: true, isDefault: b.isDefault, sortOrder: b.sortOrder
        });
        if (r.ok) berhasil += 1; else gagal.push(`${b.side} ${b.akun}: ${r.error}`);
      }
      for (const a of rencana.aktifkan) {
        const r = await jalur.kirim('PATCH', `/api/admin/settings/accounting/journal-rules/${encodeURIComponent(a.id)}`, { isActive: true });
        if (r.ok) berhasil += 1; else gagal.push(`${a.side} ${a.akun}: ${r.error}`);
      }
      hasil.push(`${l.storeName}: ${berhasil} baris aturan ditambah/diaktifkan${gagal.length ? `, gagal: ${gagal.join('; ')}` : ''}.`);
    }
    return { ok: true, jawaban: `${hasil.join('\n')}\nSelanjutnya jalankan sinkron_akuntansi supaya transaksi yang mandek ikut terjurnal.` };
  }
});

export const AKSI_AKUNTAN = Object.freeze([sinkronAkuntansi, samakanAturanJurnal]);

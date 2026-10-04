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
//
// Bos Cyo, 2026-10-04: "una masih belum bisa ngonekin jurnal, harusnya ada tool yang
// dia bisa kerjakan jurnal tsbt." Dulu alat ini hanya jalan di lingkup entity, jadi
// dari panel satu gerai Una cuma bisa menyuruh Bos. Sekarang jalan di dua lingkup:
//   - gerai : yang dilengkapi hanya gerai yang sedang dibuka; acuannya gerai lain
//             se-entity, dibaca satu per satu dan berhenti begitu dua gerai lengkap
//             sepakat (paling banyak MAKS_ACUAN_GERAI), demi batas kerja per
//             permintaan Cloudflare.
//   - entity: semua gerai entity yang belum lengkap, seperti sebelumnya.
// Kategori boleh tidak disebut: diambil dari kalimat (nama/kode kategori), lalu dari
// transaksi yang mandek karena aturan jurnal (jembatan_masalah). Sesudah aturan
// lengkap, transaksi yang mandek di gerai itu langsung dikirim ulang ke Akuntansi
// (sama dengan tombol Sinkron), jadi satu "Ya" = jurnalnya tersambung. Dijalankan
// bertahap (satu langkah per permintaan) seperti koreksi_hpp_banyak.

const MAKS_ACUAN_GERAI = 4;
const SEPAKAT = 2;
const MAKS_KATEGORI = 5;
const MAKS_LANGKAH = 40;
const BATAS_SINKRON = 25;

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

const sisi = (side) => (side === 'DEBIT' ? 'Debit' : 'Kredit');

// Gerai lain se-entity (calon acuan) untuk lingkup gerai. Entity Admin: daftar gerai
// entity-nya. Owner: semua gerai, disaring ke entity gerai yang sedang dibuka.
// Tiap baca setelan gerai tetap lewat requireManagement endpointnya sendiri.
async function geraiSaudara(ctx) {
  const ea = await ctx.baca('/api/entity-admin/stores');
  let daftar = [];
  if (ea.ok) {
    daftar = ea.data.stores ?? [];
  } else {
    const ow = await ctx.baca('/api/owner/stores');
    if (!ow.ok) return { ok: false, tanya: 'Daftar gerai lain belum kebaca, jadi Una belum bisa mencari gerai acuan untuk aturan jurnalnya.' };
    const semua = ow.data.stores ?? [];
    const sini = semua.find((g) => g.code === ctx.storeCode);
    daftar = sini?.entityId ? semua.filter((g) => g.entityId === sini.entityId) : [];
  }
  const nilai = daftar
    .filter((g) => g.isActive !== false && g.code !== ctx.storeCode)
    .map((g) => ({ code: g.code, storeName: g.storeName }))
    .sort((a, b) => a.code.localeCompare(b.code));
  if (!nilai.length) return { ok: false, tanya: 'Belum ada gerai lain se-entity yang bisa dijadikan acuan aturan jurnal.' };
  return { ok: true, nilai };
}

// Kategori yang transaksinya mandek karena aturan jurnal (cause.alat dari jembatan_masalah).
async function kategoriMandek(ctx) {
  const r = await ctx.baca('/api/admin/accounting/bridge/issues');
  if (!r.ok) return { ok: false, tanya: `Daftar transaksi mandek ${ctx.namaLingkup} belum kebaca nih: ${r.error}` };
  if (r.data.accounting === false) return { ok: true, nilai: [], owing: 0 };
  const facts = r.data.facts ?? [];
  const nilai = [...new Set(facts.filter((f) => f.cause?.alat === 'samakan_aturan_jurnal' && f.category).map((f) => f.category))];
  return { ok: true, nilai, owing: Number(r.data.summary?.owing || 0) };
}

// Nama/kode kategori yang disebut di kalimat ("jurnal operasional mandala kosong").
function kategoriDiKalimat(settings, pesan) {
  const kata = ` ${normalkan(pesan).replace(/[^a-z0-9_]+/g, ' ')} `;
  return (settings?.transactionCategories ?? [])
    .filter((k) => [k.code, k.name].some((n) => { const t = normalkan(n).replace(/[^a-z0-9_]+/g, ' ').trim(); return t.length >= 4 && kata.includes(` ${t} `); }))
    .map((k) => k.code);
}

const lengkapTetap = (k) => k?.completeness === 'COMPLETE' && !adaPilihanAkun(k.rules ?? []);

// Acuan untuk satu kategori dari gerai-gerai yang setelannya sudah dibaca.
function pilihAcuan(kode, calon, acuanTertulis) {
  const lengkap = calon.filter((p) => p.kategori?.completeness === 'COMPLETE');
  if (acuanTertulis) {
    const acuan = lengkap.find((p) => p.gerai.code === acuanTertulis);
    return acuan ? { ok: true, acuan } : { ok: false, alasan: `Gerai acuan ${acuanTertulis} tidak punya aturan "${kode}" yang lengkap. Pilih gerai lain atau biarkan Una memilih.` };
  }
  if (!lengkap.length) return { ok: false, alasan: `Tidak ada gerai yang aturan "${kode}"-nya lengkap sebagai acuan. Aturan ini harus disusun manual dulu di salah satu gerai.` };
  const hitung = new Map();
  for (const p of lengkap) {
    const ttd = tandaTangan(p.kategori.rules);
    hitung.set(ttd, [...(hitung.get(ttd) ?? []), p]);
  }
  const urut = [...hitung.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return { ok: true, acuan: urut[0][1].sort((a, b) => a.gerai.code.localeCompare(b.gerai.code))[0] };
}

// Satu kategori -> langkah "aturan" per gerai sasaran + baris tabel, atau alasan.
function susunKategori(kategoriTertulis, setelan, kandidat, target, acuanTertulis) {
  const peta = (gerai) => gerai.map((g) => ({ gerai: g, kategori: cariKategori(setelan.get(g.code), kategoriTertulis) }));
  const calon = peta(kandidat.filter((g) => setelan.has(g.code))).filter((p) => p.kategori);
  const sasaran = peta(target);
  const adaDiSasaran = sasaran.filter((p) => p.kategori);
  const kode = adaDiSasaran[0]?.kategori.code ?? calon[0]?.kategori.code;
  if (!kode) return { ok: false, alasan: `Kategori "${kategoriTertulis}" belum ketemu nih di gerai mana pun. Kodenya apa ya?` };
  const dipilih = pilihAcuan(kode, calon, acuanTertulis);
  if (!dipilih.ok) return dipilih;
  const { acuan } = dipilih;
  if (adaPilihanAkun(acuan.kategori.rules)) {
    return { ok: false, alasan: `Aturan "${kode}" di ${acuan.gerai.storeName} memakai pilihan akun yang berbeda tiap gerai, jadi tidak bisa disalin otomatis. Susun manual di Setting Akuntansi.` };
  }
  const baris = acuan.kategori.rules
    .filter((r) => r.isActive && r.sourceType === 'fixed_account' && r.fixedAccount?.code)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((r) => ({ label: String(r.label).slice(0, 120), side: r.side, fixedAccount: { code: r.fixedAccount.code }, isDefault: Boolean(r.isDefault), sortOrder: Number(r.sortOrder || 0) }));
  if (!baris.length) return { ok: false, alasan: `Gerai acuan ${acuan.gerai.storeName} tidak punya baris aturan aktif untuk disalin.` };

  const isi = [];
  const langkah = [];
  const dilewati = [];
  for (const p of adaDiSasaran) {
    if (p.gerai.code === acuan.gerai.code) continue;
    if (p.kategori.completeness === 'COMPLETE') { if (target.length === 1) dilewati.push(`${p.gerai.storeName}: aturan "${kode}" sudah lengkap`); continue; }
    const rencana = rencanaGerai(setelan.get(p.gerai.code), kode, baris);
    if (!rencana.ok) { dilewati.push(`${p.gerai.storeName}: ${rencana.alasan}`); continue; }
    if (!rencana.buat.length && !rencana.aktifkan.length) { dilewati.push(`${p.gerai.storeName}: barisnya sudah lengkap, kemungkinan masalahnya di tempat lain (cek jembatan_masalah)`); continue; }
    const tambah = [...rencana.buat, ...rencana.aktifkan].map((r) => `${sisi(r.side)} ${r.akun ?? ''}`.trim()).join(', ');
    isi.push([p.gerai.storeName, kode, `${rencana.sekarang} baris aktif`, tambah]);
    langkah.push({ jenis: 'aturan', store: p.gerai.code, storeName: p.gerai.storeName, kategori: kode, baris, name: `Aturan jurnal ${kode} · ${p.gerai.storeName}` });
  }
  for (const p of sasaran.filter((x) => !x.kategori)) dilewati.push(`${p.gerai.storeName}: belum punya kategori "${kode}"`);
  return { ok: true, kode, isi, langkah, dilewati, acuanLabel: `${kode}: ${acuan.gerai.storeName} (${baris.map((r) => `${sisi(r.side)} ${r.fixedAccount.code}`).join(', ')})` };
}

// --- bentuk draft & pemeriksaan isi beku ---------------------------------------

const KODE_GERAI = /^[A-Za-z0-9_-]{1,30}$/;
const KODE_KATEGORI = /^[A-Za-z0-9_.-]{1,60}$/;
const KODE_AKUN = /^[A-Za-z0-9_.-]{1,40}$/;
const teksPendek = (v, maks) => typeof v === 'string' && v.length > 0 && v.length <= maks;

function langkahValid(l, ctx) {
  if (!l || !['aturan', 'sinkron'].includes(l.jenis)) return false;
  if (!KODE_GERAI.test(String(l.store)) || !teksPendek(l.storeName, 120) || !teksPendek(l.name, 200)) return false;
  // Di lingkup gerai, isi beku hanya boleh menyentuh gerai yang sedang dibuka.
  if (ctx.lingkup !== 'entity' && l.store !== ctx.storeCode) return false;
  if (l.jenis === 'sinkron') return true;
  return KODE_KATEGORI.test(String(l.kategori)) && Array.isArray(l.baris) && l.baris.length > 0 && l.baris.length <= 10
    && l.baris.every((b) => teksPendek(b?.label, 120) && ['DEBIT', 'CREDIT'].includes(b.side) && KODE_AKUN.test(String(b.fixedAccount?.code))
      && typeof b.isDefault === 'boolean' && Number.isInteger(b.sortOrder));
}

function muatanValid(m, ctx) {
  const baris4 = (r) => Array.isArray(r) && r.length === 4 && r.every((x) => typeof x === 'string' && x.length <= 200);
  return Array.isArray(m?.daftar) && m.daftar.length > 0 && m.daftar.length <= MAKS_LANGKAH && m.daftar.every((l) => langkahValid(l, ctx))
    && Array.isArray(m.isi) && m.isi.length <= MAKS_LANGKAH && m.isi.every(baris4)
    && Array.isArray(m.acuan) && m.acuan.length <= MAKS_KATEGORI && m.acuan.every((a) => teksPendek(a, 300))
    && Array.isArray(m.dilewati) && m.dilewati.length <= 60 && m.dilewati.every((d) => teksPendek(d, 300));
}

function susunDraftJurnal(muatan) {
  const kategori = [...new Set(muatan.daftar.filter((l) => l.jenis === 'aturan').map((l) => `"${l.kategori}"`))].join(', ');
  const gerai = [...new Set(muatan.daftar.map((l) => l.storeName))].join(', ');
  return {
    aksi: 'samakan_aturan_jurnal',
    bertahap: true,
    judul: `Una mau menyambungkan jurnal: melengkapi aturan jurnal ${kategori} dengan menyalin dari gerai yang sudah beres, lalu mengirim ulang transaksi yang mandek — dicek dulu ya:`,
    baris: [...muatan.acuan.map((a) => ['Acuan', a]), ['Berlaku di', gerai]],
    tabel: { kolom: ['Gerai', 'Kategori', 'Sekarang', 'Akan ditambah'], isi: muatan.isi },
    dampak: [
      'Hanya menambah/mengaktifkan baris yang kurang; aturan yang sudah ada tidak dihapus atau diubah.',
      'Sesudah itu transaksi yang mandek di gerai tersebut langsung dikirim ulang ke Akuntansi (sama dengan tombol Sinkron) dan masuk Laporan Untung Rugi sesuai tanggal transaksinya.',
      'Jurnal yang sudah terbit tidak berubah; jurnal baru permanen (koreksi lewat jurnal pembalik).',
      'Dijalankan bertahap: tiap langkah satu permintaan, bisa dilanjutkan kalau terhenti.',
      ...(muatan.dilewati.length ? [`Dilewati: ${muatan.dilewati.join('; ')}.`] : [])
    ],
    muatan
  };
}

const samakanAturanJurnal = Object.freeze({
  nama: 'samakan_aturan_jurnal',
  lingkup: 'semua',
  bertahap: true,
  petunjuk: 'MENYAMBUNGKAN jurnal transaksi yang mandek karena aturan jurnal kosong/belum lengkap: menyalin aturan jurnal kategori itu dari gerai lain yang sudah beres (sama dengan mengisi Setting Akuntansi > Aturan Jurnal), lalu langsung mengirim ulang transaksi yang mandek ke Akuntansi. Bisa dari panel satu gerai maupun semua gerai, mis. "sambungkan jurnal yang mandek", "aturan jurnal operasional Mandala kosong, betulkan", "samakan aturan jurnal dengan gerai lain". Kategori boleh tidak disebut: Una mencarinya sendiri dari transaksi yang mandek. Hanya menambah baris yang kurang; aturan yang sudah ada tidak dihapus. Pakai alat ini, JANGAN menyuruh Bos mengerjakannya sendiri.',
  skema: {
    aj_kategori: { type: 'string', description: 'samakan_aturan_jurnal: kode atau nama kategori transaksi HANYA kalau disebut, mis. "operational". Kosongkan kalau tidak disebut — Una mencarinya dari transaksi yang mandek.' },
    aj_dari_gerai: { type: 'string', description: 'samakan_aturan_jurnal: kode gerai acuan, HANYA kalau penanya menyebutnya. Kosongkan supaya Una memilih konfigurasi yang paling umum.' }
  },

  async siapkan(t, ctx) {
    // Konfirmasi (langkah mana pun): isi dibekukan di draft yang dilihat, tanpa membaca
    // ulang semua gerai -- tiap langkah tetap membaca ulang gerainya tepat sebelum menulis.
    const beku = ctx.draftAsli?.muatan;
    if (beku && Array.isArray(beku.daftar)) {
      if (!muatanValid(beku, ctx)) return { ok: false, tanya: 'Draft aturan jurnalnya kayaknya berubah. Minta Una menyusun ulang ya.' };
      return { ok: true, draft: susunDraftJurnal(beku) };
    }

    const acuanTertulis = teks(t?.aj_dari_gerai, 40).toUpperCase();
    const diEntity = ctx.lingkup === 'entity';
    const setelan = new Map();
    const bacaSetelan = async (g) => {
      if (setelan.has(g.code)) return { ok: true };
      const r = await ctx.jalurGerai(g.code).baca('/api/admin/settings/accounting');
      if (!r.ok) return { ok: false, tanya: `Setelan akuntansi ${g.storeName} belum kebaca nih: ${r.error}` };
      setelan.set(g.code, r.data);
      return { ok: true };
    };

    let target;
    let kandidat;
    if (diEntity) {
      const semua = await daftarGerai(ctx);
      if (!semua.ok) return semua;
      target = semua.nilai;
      kandidat = semua.nilai;
      for (const g of target) { const r = await bacaSetelan(g); if (!r.ok) return r; }
    } else {
      target = [{ code: ctx.storeCode, storeName: ctx.namaLingkup }];
      const r = await bacaSetelan(target[0]);
      if (!r.ok) return r;
      const saudara = await geraiSaudara(ctx);
      if (!saudara.ok) return saudara;
      kandidat = saudara.nilai;
    }

    // Kategori: disebut model -> disebut di kalimat -> dari transaksi yang mandek (lingkup gerai).
    let daftarKategori = teks(t?.aj_kategori, 60) ? [teks(t.aj_kategori, 60)] : [];
    if (!daftarKategori.length && ctx.pesan) daftarKategori = kategoriDiKalimat(setelan.get(target[0].code), ctx.pesan);
    if (!daftarKategori.length && !diEntity) {
      const mandek = await kategoriMandek(ctx);
      if (!mandek.ok) return mandek;
      daftarKategori = mandek.nilai;
      if (!daftarKategori.length) {
        return { ok: false, tanya: mandek.owing
          ? `Di ${ctx.namaLingkup} tidak ada transaksi yang mandek karena aturan jurnal. ${mandek.owing} transaksi yang belum berjurnal penyebabnya lain — cek jembatan_masalah, atau coba "sinkronkan akuntansi".`
          : `Semua transaksi di ${ctx.namaLingkup} sudah berjurnal, tidak ada yang perlu disambungkan.` };
      }
    }
    if (!daftarKategori.length) return { ok: false, tanya: 'Kategori transaksi yang mana yang aturan jurnalnya mau disamakan? (mis. operasional, pembelian bahan)' };
    daftarKategori = daftarKategori.slice(0, MAKS_KATEGORI);

    // Lingkup gerai: baca calon acuan satu per satu, berhenti begitu tiap kategori punya
    // SEPAKAT gerai lengkap dengan aturan yang sama (atau gerai acuan yang disebut).
    if (!diEntity) {
      const cukup = () => daftarKategori.every((k) => {
        const lengkap = kandidat.filter((g) => setelan.has(g.code)).map((g) => cariKategori(setelan.get(g.code), k)).filter(lengkapTetap);
        if (acuanTertulis) return setelan.has(acuanTertulis);
        const hitung = new Map();
        for (const kat of lengkap) hitung.set(tandaTangan(kat.rules), (hitung.get(tandaTangan(kat.rules)) ?? 0) + 1);
        return [...hitung.values()].some((n) => n >= SEPAKAT);
      });
      const urutan = acuanTertulis ? kandidat.filter((g) => g.code === acuanTertulis) : kandidat;
      let dibaca = 0;
      for (const g of urutan) {
        if (cukup() || dibaca >= MAKS_ACUAN_GERAI) break;
        const r = await bacaSetelan(g);
        if (!r.ok) return r;
        dibaca += 1;
      }
    }

    const daftar = [];
    const isi = [];
    const acuan = [];
    const dilewati = [];
    for (const kategoriTertulis of daftarKategori) {
      const hasil = susunKategori(kategoriTertulis, setelan, kandidat, target, acuanTertulis);
      if (!hasil.ok) {
        if (daftarKategori.length === 1) return { ok: false, tanya: hasil.alasan };
        dilewati.push(hasil.alasan);
        continue;
      }
      dilewati.push(...hasil.dilewati);
      if (!hasil.langkah.length) continue;
      daftar.push(...hasil.langkah);
      isi.push(...hasil.isi);
      acuan.push(hasil.acuanLabel);
    }
    if (!daftar.length) {
      const nama = daftarKategori.map((k) => `"${k}"`).join(', ');
      return { ok: false, tanya: `Tidak ada gerai yang perlu dilengkapi aturan ${nama}-nya.${dilewati.length ? ` ${dilewati.join('; ')}.` : ''}` };
    }
    // Sesudah semua aturan: satu langkah kirim ulang per gerai yang disentuh.
    const sudah = new Set();
    for (const l of [...daftar]) {
      if (sudah.has(l.store)) continue;
      sudah.add(l.store);
      daftar.push({ jenis: 'sinkron', store: l.store, storeName: l.storeName, name: `Kirim ulang transaksi mandek · ${l.storeName}` });
    }
    if (daftar.length > MAKS_LANGKAH) return { ok: false, tanya: `Kebanyakan untuk sekali jalan (${daftar.length} langkah, maks ${MAKS_LANGKAH}). Kerjakan per kategori ya.` };
    return { ok: true, draft: susunDraftJurnal({ daftar, isi, acuan, dilewati: dilewati.map((d) => d.slice(0, 300)).slice(0, 60) }) };
  },

  async postingBagian(draft, bagian, ctx) {
    const l = draft.muatan.daftar[bagian];
    const jalur = ctx.jalurGerai(l.store);
    if (l.jenis === 'sinkron') {
      // Aturannya baru lengkap: Sinkron sekarang yang membuat jurnalnya benar-benar tersambung.
      const r = await jalur.kirim('POST', '/api/admin/accounting/bridge/sync', { limit: BATAS_SINKRON });
      if (!r.ok) return r;
      const d = r.data ?? {};
      const sisa = Number(d.needsConfiguration || 0) + Number(d.failed || 0);
      const penuh = Number(d.attempted || 0) >= BATAS_SINKRON;
      return {
        ok: true, hasil: 'dikirim', id: l.store,
        nama: `${l.storeName}: ${d.posted ?? 0} dari ${d.attempted ?? 0} transaksi mandek sekarang sudah berjurnal${sisa ? `, ${sisa} masih mandek (penyebab lain — cek jembatan_masalah)` : ''}${penuh ? '. Masih ada sisanya: suruh Una "sinkronkan akuntansi"' : ''}.`
      };
    }
    // Baca ulang tepat sebelum menulis: konfirmasi ganda tidak boleh membuat baris kembar.
    const ref = await jalur.baca('/api/admin/settings/accounting');
    if (!ref.ok) return ref;
    const rencana = rencanaGerai(ref.data, l.kategori, l.baris);
    if (!rencana.ok) return { ok: true, hasil: 'dilewati', id: l.store, nama: `${l.storeName} (${l.kategori}): dilewati — ${rencana.alasan}.` };
    if (!rencana.buat.length && !rencana.aktifkan.length) return { ok: true, hasil: 'sudah_lengkap', id: l.store, nama: `${l.storeName} (${l.kategori}): aturan sudah lengkap.` };
    let berhasil = 0;
    for (const b of rencana.buat) {
      const r = await jalur.kirim('POST', '/api/admin/settings/accounting/journal-rules', {
        transactionCategoryId: rencana.kategoriId, label: b.label, side: b.side, sourceType: b.sourceType,
        fixedAccountId: b.fixedAccountId, isActive: true, isDefault: b.isDefault, sortOrder: b.sortOrder
      });
      if (!r.ok) return { ok: false, status: r.status, error: `${l.storeName} (${l.kategori}) ${sisi(b.side)} ${b.akun}: ${r.error}` };
      berhasil += 1;
    }
    for (const a of rencana.aktifkan) {
      const r = await jalur.kirim('PATCH', `/api/admin/settings/accounting/journal-rules/${encodeURIComponent(a.id)}`, { isActive: true });
      if (!r.ok) return { ok: false, status: r.status, error: `${l.storeName} (${l.kategori}) ${sisi(a.side)} ${a.akun}: ${r.error}` };
      berhasil += 1;
    }
    return { ok: true, hasil: 'diubah', id: l.store, nama: `${l.storeName} (${l.kategori}): ${berhasil} baris aturan jurnal ditambah/diaktifkan.` };
  },

  posting() {
    return { ok: false, status: 409, error: 'Draft ini dijalankan bertahap. Muat ulang halaman lalu minta Una menyusun ulang ya.' };
  }
});

export const AKSI_AKUNTAN = Object.freeze([sinkronAkuntansi, samakanAturanJurnal]);

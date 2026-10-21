// Putar Ulang HPP (Bos Cyo, 2026-10-21, kasus Air Mineral Kaliurang Rp19.000): "harusnya ada tool
// untuk menghitung ulang tadi secara otomatis, jadi itu bisa dipake untuk una betulin nanti, cuman
// makenya ya tau waktu lah misalnya diatas jam 11 malem sampe sebelum jam 7 pagi".
//
// Pembelian yang dibatalkan (atau diganti nominalnya) sesudah bahannya ikut terpakai / dibeli lagi
// tidak bisa dibalik HPP-nya dengan sekadar mengembalikan "harga rata-rata sebelum". Harga rata-rata
// sesudahnya sudah ikut tercampur angka yang salah. Alat ini MEMUTAR ULANG riwayat mutasi bahan itu
// sejak pembelian yang salah, dengan rumus yang sama persis dengan kasir (src/cashier-purchase.js
// purchaseItemStatements), dua kali:
//   1. "seperti tercatat": hasilnya WAJIB sama dengan harga rata-rata tiap pembelian dan harga
//      rata-rata bahan sekarang. Kalau tidak sama, ada perubahan HPP lewat jalur lain yang tidak bisa
//      direkonstruksi; alat berhenti, tidak mengubah apa pun.
//   2. "seharusnya": tanpa pembelian yang salah (dan pembelian pengganti diletakkan di tempatnya).
//      Hasil akhirnya menjadi harga rata-rata bahan yang baru.
// Selisih HPP pada pemakaian bahan di antaranya (penjualan/produksi) hanya DIHITUNG dan dicatat:
// jurnal HPP lama tidak ditulis ulang (Bos: "hpp ga masalah kalo ga signifikan"). Kalau besar, Admin
// bisa memakai Hitung Ulang HPP (src/hpp-recalculation.js).
//
// Hanya dijalankan di jam sepi (23.00–07.00 WIB) supaya tidak mengganggu kerja gerai: otomatis lewat
// cron, atau oleh Una / Admin atas permintaan. Uang laci, stok, dan jurnal pembelian sudah beres saat
// ACC; yang menunggu jam sepi hanya harga rata-rata (HPP) bahan.

const SKALA = 1_000_000;
const MAKS_MUTASI = 5000;
export const JAM_SEPI_MULAI = 23;
export const JAM_SEPI_SELESAI = 7;
export const STATUS_MENUNGGU = 'MENUNGGU';
export const STATUS_SELESAI = 'SELESAI';
export const STATUS_TERTAHAN = 'TERTAHAN';
export const AMBANG_SELISIH_RUPIAH = 1000;

const jamWib = now => (new Date(now).getUTCHours() + 7) % 24;

export function dalamJamSepi(now = new Date()) {
  const jam = jamWib(now);
  return jam >= JAM_SEPI_MULAI || jam < JAM_SEPI_SELESAI;
}

export const PESAN_DI_LUAR_JAM_SEPI = `Hitung ulang HPP hanya dijalankan di jam sepi, ${JAM_SEPI_MULAI}.00–0${JAM_SEPI_SELESAI}.00 WIB, supaya tidak mengganggu kerja gerai. Sistem juga menjalankannya otomatis di jam itu.`;

// Rumus kasir (cashier-purchase.js): stok <= 0 -> harga per satuan pembelian itu; selain itu
// CAST((stok*rata2 + total_baris*1e6 + (stok+qty)/2) / (stok+qty) AS INTEGER). average_cost kolom
// REAL, jadi pembagian luar adalah pembagian pecahan yang dipotong -- sama dengan Math.trunc.
export function rataRataSesudahBeli(stok, rataRata, { quantity, lineTotal, unitCost }) {
  if (stok <= 0) return Number(unitCost);
  return Math.trunc((stok * rataRata + lineTotal * SKALA + Math.trunc((stok + quantity) / 2)) / (stok + quantity));
}

const rupiahBulat = scaled => Math.round(Number(scaled) / SKALA);
const tertahan = alasan => ({ ok: false, alasan });

/**
 * Menghitung harga rata-rata yang benar untuk satu bahan bila pembelian `pembelianSalahId` tidak
 * pernah terjadi (dan `penggantiId`, kalau ada, terjadi di tempatnya). Tidak menulis apa pun.
 */
export async function hitungPutarUlang(db, storeId, productId, { pembelianSalahId, penggantiId = null }) {
  const salah = await db.prepare(`
    SELECT product_name, quantity, line_total, unit_cost, average_cost_before, created_at
    FROM purchase_items WHERE purchase_id = ? AND store_id = ? AND product_id = ? LIMIT 1
  `).bind(pembelianSalahId, storeId, productId).first();
  if (!salah) return tertahan('Baris pembelian yang dibatalkan tidak ditemukan.');
  const nama = salah.product_name;

  const sekarang = await db.prepare(`
    SELECT p.average_cost, COALESCE(b.quantity, 0) AS quantity
    FROM products p
    LEFT JOIN inventory_stock_balances b ON b.store_id = p.store_id AND b.product_id = p.id
    WHERE p.id = ? AND p.store_id = ? LIMIT 1
  `).bind(productId, storeId).first();
  if (!sekarang) return tertahan(`Barang ${nama} tidak ditemukan.`);

  const lain = await db.prepare(`
    SELECT source_type FROM product_average_cost_snapshots
    WHERE store_id = ? AND product_id = ? AND created_at >= ? AND source_type <> 'PURCHASE'
    LIMIT 1
  `).bind(storeId, productId, salah.created_at).first();
  if (lain) return tertahan(`HPP ${nama} sempat diubah lewat jalur ${lain.source_type} sesudah pembelian itu; riwayatnya tidak bisa diputar ulang otomatis.`);

  const mutasi = (await db.prepare(`
    SELECT id, direction, quantity, source_type, source_id, occurred_at
    FROM stock_movements
    WHERE store_id = ? AND product_id = ? AND occurred_at >= ?
    ORDER BY occurred_at, id
    LIMIT ?
  `).bind(storeId, productId, salah.created_at, MAKS_MUTASI + 1).all()).results ?? [];
  if (mutasi.length > MAKS_MUTASI) return tertahan(`Riwayat mutasi ${nama} sejak pembelian itu terlalu panjang untuk diputar ulang otomatis.`);

  const beli = new Map(((await db.prepare(`
    SELECT purchase_id, quantity, line_total, unit_cost, average_cost_after
    FROM purchase_items WHERE store_id = ? AND product_id = ? AND created_at >= ?
  `).bind(storeId, productId, salah.created_at).all()).results ?? []).map(row => [row.purchase_id, row]));

  const masukSalah = mutasi.find(m => m.source_type === 'PURCHASE' && m.source_id === pembelianSalahId && m.direction === 'IN');
  if (!masukSalah) return tertahan(`Mutasi stok pembelian ${nama} yang dibatalkan tidak ditemukan.`);
  const masukPengganti = penggantiId
    ? mutasi.find(m => m.source_type === 'PURCHASE' && m.source_id === penggantiId && m.direction === 'IN')
    : null;
  if (penggantiId && !masukPengganti) return tertahan(`Mutasi stok pembelian pengganti ${nama} tidak ditemukan.`);

  const neto = mutasi.reduce((sum, m) => sum + (m.direction === 'IN' ? 1 : -1) * Number(m.quantity), 0);
  const stokAwal = Number(sekarang.quantity) - neto;
  const rataAwal = Number(salah.average_cost_before);

  // 1. Seperti tercatat: setiap pembelian harus menghasilkan average_cost_after yang tersimpan.
  let stok = stokAwal;
  let rata = rataAwal;
  const rataTercatatSaat = new Map();
  for (const m of mutasi) {
    const q = Number(m.quantity);
    if (m.source_type === 'PURCHASE' && m.direction === 'IN') {
      const baris = beli.get(m.source_id);
      if (!baris) return tertahan(`Data pembelian ${m.source_id} untuk ${nama} tidak lengkap.`);
      rata = rataRataSesudahBeli(stok, rata, { quantity: q, lineTotal: Number(baris.line_total), unitCost: baris.unit_cost });
      if (rata !== Math.trunc(Number(baris.average_cost_after))) {
        return tertahan(`Riwayat HPP ${nama} tidak cocok saat diputar ulang (pembelian ${m.source_id}); dicek manual dulu.`);
      }
      stok += q;
    } else {
      stok += m.direction === 'IN' ? q : -q;
    }
    rataTercatatSaat.set(m.id, rata);
  }
  if (rata !== Math.trunc(Number(sekarang.average_cost))) {
    return tertahan(`HPP ${nama} sekarang tidak sama dengan hasil putar ulang riwayatnya; dicek manual dulu.`);
  }

  // 2. Seharusnya: pembelian salah dan pembaliknya tidak ada; pengganti diletakkan di tempatnya.
  const urutan = mutasi.filter(m => m !== masukPengganti && !(m.source_type === 'PURCHASE_VOID' && m.source_id === pembelianSalahId));
  stok = stokAwal;
  rata = rataAwal;
  let selisihScaled = 0;
  let pemakaian = 0;
  for (const m of urutan) {
    const masuk = m === masukSalah ? masukPengganti : m;
    if (!masuk) continue;
    const q = Number(masuk.quantity);
    if (masuk.source_type === 'PURCHASE' && masuk.direction === 'IN') {
      const baris = beli.get(masuk.source_id);
      rata = rataRataSesudahBeli(stok, rata, { quantity: q, lineTotal: Number(baris.line_total), unitCost: baris.unit_cost });
      stok += q;
    } else if (masuk.direction === 'IN') {
      stok += q;
    } else {
      stok -= q;
      // Pemakaian bahan (penjualan, produksi, dll) memakai harga rata-rata saat itu.
      if (masuk.source_type !== 'PURCHASE_VOID') {
        selisihScaled += q * (rataTercatatSaat.get(masuk.id) - rata);
        pemakaian += 1;
      }
    }
  }

  return {
    ok: true,
    productId,
    nama,
    hppTercatat: Math.trunc(Number(sekarang.average_cost)),
    hppBenar: rata,
    stok: Number(sekarang.quantity),
    jumlahMutasi: mutasi.length,
    pemakaian,
    selisihHppRupiah: rupiahBulat(selisihScaled)
  };
}

async function itemPembelian(db, storeId, purchaseId) {
  return (await db.prepare(`
    SELECT DISTINCT product_id FROM purchase_items WHERE purchase_id = ? AND store_id = ? ORDER BY product_id
  `).bind(purchaseId, storeId).all()).results?.map(row => Number(row.product_id)) ?? [];
}

/** Pratinjau semua bahan dari satu izin; tidak menulis apa pun. */
export async function pratinjauPutarUlangIzin(db, permit) {
  const hasil = [];
  for (const productId of await itemPembelian(db, permit.storeId, permit.subjectId)) {
    const satu = await hitungPutarUlang(db, permit.storeId, productId, {
      pembelianSalahId: permit.subjectId, penggantiId: permit.replacementSubjectId || null
    });
    if (!satu.ok) return { ok: false, alasan: satu.alasan, bahan: hasil };
    hasil.push(satu);
  }
  return { ok: true, bahan: hasil };
}

function ringkas(bahan) {
  return bahan.map(b => {
    const selisih = b.selisihHppRupiah
      ? `; selisih HPP pemakaian sebelumnya ±Rp${Math.abs(b.selisihHppRupiah).toLocaleString('id-ID')}${Math.abs(b.selisihHppRupiah) >= AMBANG_SELISIH_RUPIAH ? ' (besar: pertimbangkan Hitung Ulang HPP)' : ''}`
      : '';
    return `${b.nama}: Rp${(b.hppTercatat / SKALA).toLocaleString('id-ID', { maximumFractionDigits: 6 })} → Rp${(b.hppBenar / SKALA).toLocaleString('id-ID', { maximumFractionDigits: 6 })} per satuan${selisih}`;
  }).join(' · ');
}

/**
 * Menerapkan hasil putar ulang untuk satu izin yang HPP-nya menunggu. Harga rata-rata hanya diganti
 * kalau masih sama dengan yang tadi dihitung (kalau berubah di tengah jalan, batch gagal utuh).
 */
export async function terapkanPutarUlangIzin(db, permit, now = new Date().toISOString(), { paksaJam = false } = {}) {
  if (!paksaJam && !dalamJamSepi(now)) return { ok: false, diLuarJam: true, alasan: PESAN_DI_LUAR_JAM_SEPI };
  if (permit.hppReplayStatus !== STATUS_MENUNGGU && permit.hppReplayStatus !== STATUS_TERTAHAN) {
    return { ok: false, alasan: 'Izin ini tidak sedang menunggu hitung ulang HPP.' };
  }
  const pratinjau = await pratinjauPutarUlangIzin(db, permit);
  if (!pratinjau.ok) {
    await db.prepare(`
      UPDATE approval_permits SET hpp_replay_status = ?, hpp_replay_detail = ?, updated_at = ? WHERE id = ?
    `).bind(STATUS_TERTAHAN, pratinjau.alasan, now, permit.id).run();
    return { ok: false, tertahan: true, alasan: pratinjau.alasan };
  }
  const detail = `Selesai ${now}: ${ringkas(pratinjau.bahan)}`.slice(0, 1000);
  const statements = [];
  for (const b of pratinjau.bahan) {
    statements.push(
      db.prepare(`
        UPDATE products SET average_cost = CASE WHEN average_cost = ? THEN ? ELSE -1 END,
          cost_updated_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND store_id = ?
      `).bind(b.hppTercatat, b.hppBenar, now, b.productId, permit.storeId),
      db.prepare(`
        INSERT INTO product_average_cost_snapshots (id, store_id, product_id, average_cost_scaled, source_type, source_id, created_at)
        SELECT ?, store_id, id, average_cost, 'CORRECTION', ?, ? FROM products WHERE id = ? AND store_id = ?
      `).bind(`hpp_snap_${crypto.randomUUID()}`, permit.id, now, b.productId, permit.storeId)
    );
  }
  statements.push(db.prepare(`
    UPDATE approval_permits SET hpp_replay_status = ?, hpp_replay_detail = ?, updated_at = ?
    WHERE id = ? AND hpp_replay_status IN (?, ?)
  `).bind(STATUS_SELESAI, detail, now, permit.id, STATUS_MENUNGGU, STATUS_TERTAHAN));
  try {
    const hasil = await db.batch(statements);
    if (Number(hasil.at(-1)?.meta?.changes ?? 0) !== 1) return { ok: false, alasan: 'Izin ini sudah diproses permintaan lain.' };
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('check constraint')) {
      return { ok: false, alasan: 'HPP berubah saat dihitung ulang (ada transaksi baru); coba lagi sebentar.' };
    }
    throw error;
  }
  return { ok: true, bahan: pratinjau.bahan, detail };
}

export function izinDariBaris(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    subjectId: row.subject_id,
    replacementSubjectId: row.replacement_subject_id || null,
    hppReplayStatus: row.hpp_replay_status || ''
  };
}

export async function daftarIzinMenunggu(db, { storeId = null, limit = 20 } = {}) {
  const rows = await db.prepare(`
    SELECT id, store_id, subject_id, replacement_subject_id, hpp_replay_status, hpp_replay_detail, requested_at
    FROM approval_permits
    WHERE subject_type = 'PURCHASE' AND execution_status = 'EXECUTED'
      AND hpp_replay_status IN (?, ?)
      AND (? IS NULL OR store_id = ?)
    ORDER BY requested_at
    LIMIT ?
  `).bind(STATUS_MENUNGGU, STATUS_TERTAHAN, storeId, storeId, limit).all();
  return rows.results ?? [];
}

/** Cron: di jam sepi, bereskan izin yang HPP-nya menunggu (yang tertahan menunggu Admin/Una). */
export async function prosesAntreanPutarUlang(env, now = new Date()) {
  if (!dalamJamSepi(now)) return { dijalankan: 0 };
  const iso = new Date(now).toISOString();
  const rows = (await daftarIzinMenunggu(env.DB, { limit: 5 })).filter(row => row.hpp_replay_status === STATUS_MENUNGGU);
  let dijalankan = 0;
  for (const row of rows) {
    try {
      await terapkanPutarUlangIzin(env.DB, izinDariBaris(row), iso);
      dijalankan += 1;
    } catch (error) {
      console.warn('putar ulang HPP gagal', row.id, error?.message);
    }
  }
  return { dijalankan };
}

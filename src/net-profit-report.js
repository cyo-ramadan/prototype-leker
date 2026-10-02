import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, listStores, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { countUnsyncedPosFacts } from './accounting-pos-bridge.js';
import { countPendingAdminFacts } from './accounting-admin-bridge.js';

// ADR-051 (2026-10-02): mesin fakta POS di file ini tetap berdiri sendiri
// untuk gerai LITE/FLEXIBLE. Gerai ACCOUNTING dibaca dari jurnal (lihat
// computeAccountingBreakdown di bawah) -- impor jembatan di atas hanya untuk
// menghitung transaksi yang belum masuk pembukuan.
//
// Duplikasi sengaja dari src/accounting-ledger.js -- modul ini harus
// TIDAK bergantung pada Accounting sama sekali (Bos Cyo, 2026-09-17:
// "desainnya sampai detik ini harus bisa dulu tanpa akuntansi"), jadi
// tidak boleh import apa pun dari accounting-ledger.js. ADR-040 D2 sudah
// mencatat duplikasi format tanggal semacam ini sebagai utang platform
// yang akan disatukan nanti -- bukan diabaikan di sini, cuma belum waktunya.
function validateBusinessDate(value) {
  const trimmed = String(value ?? '').trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return trimmed;
}

// Laporan Net Profit harian -- Bos Cyo, 2026-09-17: harus bisa keluar TANPA
// Accounting aktif (POS berdiri sendiri, POS_MODULE_INDEPENDENCE.md), dihitung
// langsung dari business fact kasir, dan tidak boleh berat kalau range
// tanggalnya lebar. Lihat migrations/0099_store_daily_profit_snapshot.sql
// untuk rasionalnya lengkap.
//
// Formula, disepakati eksplisit dengan Bos Cyo -- JANGAN diubah tanpa
// persetujuan, ini kebijakan bisnis:
//   Omset + Pendapatan Lain - HPP           = Untung Kotor (Gross Profit)
//   Untung Kotor + Stok Lebih(+) - Stok Hilang(-) - Beban/Bea = Untung Bersih (Net Profit)
// Pembelian Bahan TIDAK PERNAH masuk formula ini (Persediaan/aset, bukan
// Beban -- sudah otomatis kepisah karena tercatat di tabel purchases,
// bukan expenses).
//
// Beban/Bea dirinci empat sumber (Bos Cyo, 2026-09-17: laporan lama
// dianggap "ga jelas" karena melebur semuanya jadi satu angka) --
// Beban Kasir (`expenses`) dan tiga kategori Bea Admin (`admin_operational_
// expenses`, migration 0100: Bea Gaji/Lapak/Lainnya) masing-masing kolom
// sendiri, dijumlah baru jadi total Beban di netProfitFromFacts(). Kalau
// nanti ada fitur/tombol baru yang debit-nya dianalisis sebagai Beban
// (aturan Bos Cyo: nama tombolnya wajib dimulai "Beban"/"Bea"), WAJIB
// ditambahkan eksplisit di computeFactsForDates() + netProfitFromFacts()
// di sini juga -- penamaan itu penanda buat manusia, kode di sini yang
// benar-benar dibaca laporan.
//
// 2026-09-24, Bos Cyo (koreksi Akun Gaji): "kalo dalam akuntansi ketika ada
// gaji harian itu jurnalnya debet beban gaji kredit hutang gaji ... jadi
// harusnya nominal di sesi jam harian itu uda mencetak beban dan hutang
// gaji." Kolom beaGaji sekarang PENJUMLAHAN DUA sumber: Bea Gaji manual
// (admin_operational_expenses, seperti semula) DITAMBAH akrual presensi
// harian otomatis (payroll_ledger_entries, entry_type=ACCRUAL, migration
// 0116, src/payroll-ledger.js) -- sengaja aditif, bukan mengganti sumber
// lama, supaya laporan yang sudah ke-cache sebelum fitur ini tidak berubah
// nilainya. HANYA sesi presensi yang SELESAI setelah fitur ini live yang
// tercatat -- histori presensi sebelumnya TIDAK di-backfill (lihat catatan
// migration 0116), jadi Beban Gaji bulan-bulan lama tidak tiba-tiba berubah.
const BEBAN_SOURCES = ['expenses', 'admin_operational_expenses', 'payroll_ledger_entries'];

const COST_SCALE = 1_000_000;
// Sum di ruang scaled dulu (line_cogs), baru dibagi skala SEKALI di akhir --
// menghindari akumulasi pembulatan per baris (invariant CLAUDE.md #1).
const rupiahFromScaledSum = scaledSum => Math.round(Number(scaledSum || 0) / COST_SCALE);

// Asia/Jakarta tidak punya DST, jadi offset +7 jam tetap valid sepanjang
// tahun -- pola yang sama seperti getJakartaBusinessDate() di time.js, versi
// SQL supaya bisa dipakai di GROUP BY tanpa menarik tiap baris ke JS dulu.
const JAKARTA_BUSINESS_DATE_SQL = "date(created_at, '+7 hours')";

function placeholders(list) {
  return list.map(() => '?').join(',');
}

// Bentuk breakdown kosong -- dipakai sebagai default kalau sebuah tanggal
// tidak punya baris breakdown sama sekali, dan sebagai nilai awal reduce
// breakdownTotals. Satu tempat supaya field-nya tidak bisa beda ketinggalan
// antara dua pemakaian.
const EMPTY_BREAKDOWN = Object.freeze({
  revenue: 0, otherIncome: 0, hpp: 0, grossProfit: 0,
  expenseKasir: 0, beaGaji: 0, beaLapak: 0, beaLainnya: 0, totalBeban: 0,
  stockAdjustmentGain: 0, stockAdjustmentLoss: 0, netProfit: 0
});

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function enumerateDates(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function loadCachedRows(db, storeIds, dates) {
  if (!storeIds.length || !dates.length) return [];
  const rows = await db.prepare(`
    SELECT store_id, business_date, revenue, other_income, hpp, expense,
           bea_gaji, bea_lapak, bea_lainnya,
           stock_adjustment_gain, stock_adjustment_loss, net_profit
    FROM store_daily_profit_snapshot
    WHERE store_id IN (${placeholders(storeIds)}) AND business_date IN (${placeholders(dates)})
  `).bind(...storeIds, ...dates).all();
  return rows.results ?? [];
}

async function sumByStoreDate(db, sql, params) {
  const rows = await db.prepare(sql).bind(...params).all();
  return rows.results ?? [];
}

// Empat sumber fakta terpisah (sales, sale_items, expenses, other_income)
// tidak alami di-JOIN satu sama lain (satu penjualan dan satu pengeluaran
// bukan baris yang berhubungan) -- jadi ini 4 query GROUP BY yang masing-
// masing sekali jalan untuk SEMUA gerai+tanggal yang belum ke-cache
// sekaligus, bukan diulang per hari/per gerai. Tetap jauh di bawah batas
// compound-SELECT D1 karena tidak ada UNION ALL sama sekali di sini.
async function computeFactsForDates(db, storeIds, dates) {
  if (!storeIds.length || !dates.length) return new Map();
  const storePh = placeholders(storeIds);
  const datePh = placeholders(dates);

  const [revenueRows, otherIncomeRows, expenseRows, hppRows, stockAdjustmentRows, adminExpenseRows, attendanceAccrualRows] = await Promise.all([
    sumByStoreDate(db, `
      SELECT store_id, ${JAKARTA_BUSINESS_DATE_SQL} AS business_date, COALESCE(SUM(total_amount), 0) AS value
      FROM sales
      WHERE voided_at IS NULL AND store_id IN (${storePh}) AND ${JAKARTA_BUSINESS_DATE_SQL} IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates]),
    sumByStoreDate(db, `
      SELECT store_id, ${JAKARTA_BUSINESS_DATE_SQL} AS business_date, COALESCE(SUM(amount), 0) AS value
      FROM other_income
      WHERE store_id IN (${storePh}) AND ${JAKARTA_BUSINESS_DATE_SQL} IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates]),
    sumByStoreDate(db, `
      SELECT store_id, ${JAKARTA_BUSINESS_DATE_SQL} AS business_date, COALESCE(SUM(amount), 0) AS value
      FROM expenses
      WHERE voided_at IS NULL AND store_id IN (${storePh}) AND ${JAKARTA_BUSINESS_DATE_SQL} IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates]),
    sumByStoreDate(db, `
      SELECT s.store_id AS store_id, ${JAKARTA_BUSINESS_DATE_SQL.replace('created_at', 's.created_at')} AS business_date,
             COALESCE(SUM(si.line_cogs), 0) AS value
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id AND s.store_id = si.store_id
      WHERE s.voided_at IS NULL AND s.store_id IN (${storePh}) AND ${JAKARTA_BUSINESS_DATE_SQL.replace('created_at', 's.created_at')} IN (${datePh})
      GROUP BY s.store_id, business_date
    `, [...storeIds, ...dates]),
    // Penyesuaian Stok yang sudah di-ACC (Bos Cyo, 2026-09-17: "dari
    // penyesuaian stok kan juga jadi beban kehilangan kalo minus, dan
    // kalo tambah jadi pendapatan lain"), sekarang DUA kolom terpisah
    // (Bos Cyo, sesi berikutnya: laporan lama melebur ini jadi satu angka
    // net, dia minta dipisah "+ dan -") -- direction IN = stok lebih
    // (gain), OUT = stok kurang (loss). Nilainya sudah disnapshot di
    // payload_json saat pengajuan dibuat (totalCostSnapshotScaled,
    // src/operational-posting.js) -- BUKAN dihitung ulang di sini, cukup
    // dibaca. Tetap satu query (dua ekspresi SUM(CASE) dalam satu SELECT),
    // bukan dua query terpisah.
    sumByStoreDate(db, `
      SELECT store_id, ${JAKARTA_BUSINESS_DATE_SQL.replace('created_at', 'posted_at')} AS business_date,
             COALESCE(SUM(CASE WHEN json_extract(payload_json, '$.direction') = 'IN'
                                THEN json_extract(payload_json, '$.totalCostSnapshotScaled') ELSE 0 END), 0) AS gain_value,
             COALESCE(SUM(CASE WHEN json_extract(payload_json, '$.direction') = 'OUT'
                                THEN json_extract(payload_json, '$.totalCostSnapshotScaled') ELSE 0 END), 0) AS loss_value
      FROM approval_requests
      WHERE request_type = 'GOODS_FLOW' AND posting_status = 'posted'
        AND json_extract(payload_json, '$.purpose') = 'STOCK_ADJUSTMENT'
        AND store_id IN (${storePh}) AND ${JAKARTA_BUSINESS_DATE_SQL.replace('created_at', 'posted_at')} IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates]),
    // Bea Operasional yang dicatat dari panel Admin (Bea Gaji/Lapak/Lainnya,
    // migration 0100), DIRINCI PER KATEGORI (Bos Cyo: laporan lama melebur
    // ini jadi satu angka "Biaya & bea yang dikeluarkan", diminta dipecah
    // per nama bea). GROUP BY ikut category -> tiap (gerai, tanggal) bisa
    // punya sampai 3 baris (satu per kategori yang benar-benar dipakai),
    // bukan satu baris gabungan -- tetap satu query, bukan tiga. Tabel ini
    // sudah punya kolom business_date sendiri (diisi Admin, boleh mundur),
    // jadi TIDAK diturunkan dari created_at seperti tiga query pertama.
    sumByStoreDate(db, `
      SELECT store_id, business_date, category, COALESCE(SUM(amount), 0) AS value
      FROM admin_operational_expenses
      WHERE voided_at IS NULL AND store_id IN (${storePh}) AND business_date IN (${datePh})
      GROUP BY store_id, business_date, category
    `, [...storeIds, ...dates]),
    // Akrual presensi harian otomatis (Bos Cyo: "nominal di sesi jam harian
    // itu uda mencetak beban dan hutang gaji") -- payroll_ledger_entries
    // ditambahkan ke beaGaji, ADITIF terhadap Bea Gaji manual di atas, bukan
    // menggantikannya. Scaled (WAGE_SCALE = COST_SCALE = 1.000.000), dibagi
    // sekali lewat rupiahFromScaledSum() sesudah SUM, bukan per baris.
    sumByStoreDate(db, `
      SELECT store_id, business_date, COALESCE(SUM(beban_gaji_delta_scaled), 0) AS value
      FROM payroll_ledger_entries
      WHERE entry_type = 'ACCRUAL' AND voided_at IS NULL
        AND store_id IN (${storePh}) AND business_date IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates])
  ]);

  const key = (storeId, businessDate) => `${storeId}::${businessDate}`;
  const facts = new Map();
  for (const storeId of storeIds) {
    for (const businessDate of dates) {
      facts.set(key(storeId, businessDate), {
        revenue: 0, otherIncome: 0, expenseKasir: 0, beaGaji: 0, beaLapak: 0, beaLainnya: 0,
        hppScaled: 0, stockAdjustmentGainScaled: 0, stockAdjustmentLossScaled: 0
      });
    }
  }
  for (const row of revenueRows) facts.get(key(row.store_id, row.business_date)).revenue = Number(row.value || 0);
  for (const row of otherIncomeRows) facts.get(key(row.store_id, row.business_date)).otherIncome = Number(row.value || 0);
  for (const row of expenseRows) facts.get(key(row.store_id, row.business_date)).expenseKasir = Number(row.value || 0);
  for (const row of hppRows) facts.get(key(row.store_id, row.business_date)).hppScaled = Number(row.value || 0);
  for (const row of stockAdjustmentRows) {
    const fact = facts.get(key(row.store_id, row.business_date));
    fact.stockAdjustmentGainScaled = Number(row.gain_value || 0);
    fact.stockAdjustmentLossScaled = Number(row.loss_value || 0);
  }
  for (const row of adminExpenseRows) {
    const fact = facts.get(key(row.store_id, row.business_date));
    const amount = Number(row.value || 0);
    if (row.category === 'BEA_GAJI') fact.beaGaji = amount;
    else if (row.category === 'BEA_LAPAK') fact.beaLapak = amount;
    else fact.beaLainnya += amount; // BEA_LAINNYA, dan kategori tak dikenal (jaga-jaga) ikut sini
  }
  for (const row of attendanceAccrualRows) {
    facts.get(key(row.store_id, row.business_date)).beaGaji += rupiahFromScaledSum(row.value);
  }
  return facts;
}

function netProfitFromFacts(facts) {
  const hpp = rupiahFromScaledSum(facts.hppScaled);
  const stockAdjustmentGain = rupiahFromScaledSum(facts.stockAdjustmentGainScaled);
  const stockAdjustmentLoss = rupiahFromScaledSum(facts.stockAdjustmentLossScaled);
  // Beban = Beban Kasir + tiga kategori Bea Admin, masing-masing kolom
  // sendiri di cache (migration 0101) -- dijumlah di sini baru jadi total
  // yang mengurangi Untung Kotor, bukan disimpan sebagai satu angka gabungan.
  const totalBeban = facts.expenseKasir + facts.beaGaji + facts.beaLapak + facts.beaLainnya;
  const grossProfit = facts.otherIncome + facts.revenue - hpp;
  const netProfit = grossProfit - totalBeban + stockAdjustmentGain - stockAdjustmentLoss;
  return {
    revenue: facts.revenue,
    otherIncome: facts.otherIncome,
    hpp,
    grossProfit,
    expenseKasir: facts.expenseKasir,
    beaGaji: facts.beaGaji,
    beaLapak: facts.beaLapak,
    beaLainnya: facts.beaLainnya,
    totalBeban,
    stockAdjustmentGain,
    stockAdjustmentLoss,
    netProfit
  };
}

// Dipanggil setiap kali ada Bea Operasional dicatat/dibatalkan untuk sebuah
// (gerai, tanggal). Tanpa ini, bea yang dicatat MUNDUR ke hari yang sudah
// ditutup-buku tidak akan pernah kelihatan -- laporan tetap menyajikan angka
// lama dari cache, dan tidak ada error apa pun yang memberi tahu.
export async function invalidateDailyProfitSnapshot(db, storeId, businessDate) {
  await db.prepare('DELETE FROM store_daily_profit_snapshot WHERE store_id = ? AND business_date = ?')
    .bind(storeId, businessDate).run();
}

// Mesin fakta POS (gerai LITE/FLEXIBLE). Diekspor juga untuk tes yang memang
// menguji mesin ini secara langsung.
export async function getPosFactsNetProfitReport(db, { storeIds, from, to, today = getJakartaBusinessDate() }) {
  const dates = enumerateDates(from, to);
  const closedDates = dates.filter(date => date < today);
  const needsLiveToday = dates.includes(today);

  const cached = await loadCachedRows(db, storeIds, closedDates);
  const cachedKeys = new Set(cached.map(row => `${row.store_id}::${row.business_date}`));
  const missingClosedDates = [...new Set(
    closedDates.filter(date => storeIds.some(storeId => !cachedKeys.has(`${storeId}::${date}`)))
  )];
  const datesToCompute = needsLiveToday ? [...missingClosedDates, today] : missingClosedDates;

  const computed = datesToCompute.length ? await computeFactsForDates(db, storeIds, datesToCompute) : new Map();

  const netProfitByKey = new Map();
  // Rincian per hari ikut dibawa (Omset/Pendapatan Lain/HPP/Beban per
  // kategori/Penyesuaian Stok +/-) supaya panel Admin Gerai bisa menunjukkan
  // KENAPA untung/ruginya segitu, bukan cuma angka akhirnya -- target
  // penggunanya justru yang tidak paham akuntansi. Kolomnya sudah ada di
  // cache sejak migration 0099/0101, jadi ini tidak menambah satu query pun.
  const breakdownByKey = new Map();
  for (const row of cached) {
    const key = `${row.store_id}::${row.business_date}`;
    netProfitByKey.set(key, Number(row.net_profit));
    const expenseKasir = Number(row.expense || 0);
    const beaGaji = Number(row.bea_gaji || 0);
    const beaLapak = Number(row.bea_lapak || 0);
    const beaLainnya = Number(row.bea_lainnya || 0);
    const revenue = Number(row.revenue || 0);
    const otherIncome = Number(row.other_income || 0);
    const hpp = Number(row.hpp || 0);
    breakdownByKey.set(key, {
      revenue,
      otherIncome,
      hpp,
      grossProfit: otherIncome + revenue - hpp,
      expenseKasir,
      beaGaji,
      beaLapak,
      beaLainnya,
      totalBeban: expenseKasir + beaGaji + beaLapak + beaLainnya,
      stockAdjustmentGain: Number(row.stock_adjustment_gain || 0),
      stockAdjustmentLoss: Number(row.stock_adjustment_loss || 0),
      netProfit: Number(row.net_profit || 0)
    });
  }

  const toCache = [];
  for (const [key, facts] of computed) {
    const [storeId, businessDate] = key.split('::');
    const result = netProfitFromFacts(facts);
    netProfitByKey.set(key, result.netProfit);
    breakdownByKey.set(key, result);
    if (businessDate !== today) {
      toCache.push({ storeId, businessDate, ...result });
    }
  }

  if (toCache.length) {
    await db.batch(toCache.map(row => db.prepare(`
      INSERT INTO store_daily_profit_snapshot (
        store_id, business_date, revenue, other_income, hpp, expense,
        bea_gaji, bea_lapak, bea_lainnya,
        stock_adjustment_gain, stock_adjustment_loss, net_profit, computed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (store_id, business_date) DO UPDATE SET
        revenue = excluded.revenue, other_income = excluded.other_income, hpp = excluded.hpp,
        expense = excluded.expense, bea_gaji = excluded.bea_gaji, bea_lapak = excluded.bea_lapak,
        bea_lainnya = excluded.bea_lainnya, stock_adjustment_gain = excluded.stock_adjustment_gain,
        stock_adjustment_loss = excluded.stock_adjustment_loss,
        net_profit = excluded.net_profit, computed_at = CURRENT_TIMESTAMP
    `).bind(
      row.storeId, row.businessDate, row.revenue, row.otherIncome, row.hpp, row.expenseKasir,
      row.beaGaji, row.beaLapak, row.beaLainnya,
      row.stockAdjustmentGain, row.stockAdjustmentLoss, row.netProfit
    )));
  }

  return { dates, netProfitByKey, breakdownByKey };
}


// ---------------------------------------------------------------------------
// ADR-051 (Bos Cyo, 2026-10-02): "kalo sekarang keputusannya akuntansinya
// dikonekin ... yang bener harusnya dikurangin dari beban2 akuntansi ... nanti
// perhitungan rugi laba dsb mulai dari akuntansi."
//
// Gerai edisi ACCOUNTING: angka Untung Rugi dibaca dari jurnal Akuntansi
// (semua jurnal: transaksi kasir, fitur admin, jurnal manual, Beban Rutin,
// jurnal Una) -- jadi beban yang hanya dicatat di Akuntansi ikut mengurangi.
// Gerai LITE/FLEXIBLE tetap memakai mesin fakta POS di atas (POS berdiri
// sendiri, POS_MODULE_INDEPENDENCE.md).
//
// Pemetaan akun -> baris laporan (bahasa pemilik usaha):
//   REVENUE  SALES                -> Omset
//   REVENUE  INVENTORY_ADJUSTMENT -> Stok Lebih
//   REVENUE  lainnya              -> Pendapatan Lain
//   EXPENSE  COGS                 -> HPP
//   EXPENSE  INVENTORY_ADJUSTMENT -> Stok Hilang
//   EXPENSE  lainnya              -> Beban, dirinci PER AKUN (nama akun)
// Jurnal pembalik ikut terjumlah, jadi transaksi yang dibatalkan netral.
// Jumlah dihitung di ruang scaled per (gerai, tanggal, akun), dibagi skala
// sekali di akhir (invariant #1). Tidak di-cache: jurnal boleh masuk mundur
// (sinkron transaksi tertunda, Bea tanggal lalu), jadi angka lama boleh berubah.
const ACCOUNTING_BREAKDOWN_KEYS = ['revenue', 'otherIncome', 'hpp', 'stockAdjustmentGain', 'stockAdjustmentLoss'];

function emptyAccountingBreakdown() {
  return { ...EMPTY_BREAKDOWN, source: 'ACCOUNTING', bebanAccounts: [] };
}

async function computeAccountingBreakdown(db, storeIds, from, to) {
  const result = new Map();
  if (!storeIds.length) return result;
  const rows = await db.prepare(`
    SELECT h.store_id, h.business_date, a.code, a.name, a.type, a.subtype,
           COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE -l.amount_scaled END), 0) AS debit_minus_credit
    FROM accounting_journal_headers h
    JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
    JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
    WHERE h.store_id IN (${placeholders(storeIds)})
      AND h.business_date >= ? AND h.business_date <= ?
      AND a.type IN ('REVENUE', 'EXPENSE')
    GROUP BY h.store_id, h.business_date, a.id
  `).bind(...storeIds, from, to).all();

  const scaled = new Map();
  for (const row of rows.results ?? []) {
    const key = `${row.store_id}::${row.business_date}`;
    if (!scaled.has(key)) scaled.set(key, { revenue: 0, otherIncome: 0, hpp: 0, stockAdjustmentGain: 0, stockAdjustmentLoss: 0, beban: new Map() });
    const bucket = scaled.get(key);
    const dmc = Number(row.debit_minus_credit || 0);
    if (row.type === 'REVENUE') {
      const amount = -dmc;
      if (row.subtype === 'SALES') bucket.revenue += amount;
      else if (row.subtype === 'INVENTORY_ADJUSTMENT') bucket.stockAdjustmentGain += amount;
      else bucket.otherIncome += amount;
    } else if (row.subtype === 'COGS') bucket.hpp += dmc;
    else if (row.subtype === 'INVENTORY_ADJUSTMENT') bucket.stockAdjustmentLoss += dmc;
    else {
      const entry = bucket.beban.get(row.code) || { code: row.code, name: row.name, scaled: 0 };
      entry.scaled += dmc;
      bucket.beban.set(row.code, entry);
    }
  }

  for (const [key, bucket] of scaled) {
    const breakdown = emptyAccountingBreakdown();
    for (const field of ACCOUNTING_BREAKDOWN_KEYS) breakdown[field] = rupiahFromScaledSum(bucket[field]);
    breakdown.bebanAccounts = [...bucket.beban.values()]
      .map(entry => ({ code: entry.code, name: entry.name, amount: rupiahFromScaledSum(entry.scaled) }))
      .filter(entry => entry.amount !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
    breakdown.totalBeban = breakdown.bebanAccounts.reduce((sum, entry) => sum + entry.amount, 0);
    breakdown.grossProfit = breakdown.revenue + breakdown.otherIncome - breakdown.hpp;
    breakdown.netProfit = breakdown.grossProfit - breakdown.totalBeban + breakdown.stockAdjustmentGain - breakdown.stockAdjustmentLoss;
    result.set(key, breakdown);
  }
  return result;
}

// Satu pintu: tiap gerai dibaca dari sumber yang sesuai edisinya.
export async function getNetProfitReport(db, { storeIds, from, to, today = getJakartaBusinessDate() }) {
  const dates = enumerateDates(from, to);
  const editionRows = storeIds.length
    ? await db.prepare(`SELECT id, edition FROM stores WHERE id IN (${placeholders(storeIds)})`).bind(...storeIds).all()
    : { results: [] };
  const accountingIds = new Set((editionRows.results ?? []).filter(row => row.edition === 'ACCOUNTING').map(row => row.id));
  const posIds = storeIds.filter(id => !accountingIds.has(id));

  const pos = posIds.length
    ? await getPosFactsNetProfitReport(db, { storeIds: posIds, from, to, today })
    : { netProfitByKey: new Map(), breakdownByKey: new Map() };
  const netProfitByKey = new Map(pos.netProfitByKey);
  const breakdownByKey = new Map();
  for (const [key, value] of pos.breakdownByKey) breakdownByKey.set(key, { ...value, source: 'POS' });

  if (accountingIds.size) {
    const accounting = await computeAccountingBreakdown(db, [...accountingIds], from, to);
    for (const storeId of accountingIds) {
      for (const businessDate of dates) {
        const key = `${storeId}::${businessDate}`;
        const breakdown = accounting.get(key) || emptyAccountingBreakdown();
        breakdownByKey.set(key, breakdown);
        netProfitByKey.set(key, breakdown.netProfit);
      }
    }
  }
  const sourceByStore = Object.fromEntries(storeIds.map(id => [id, accountingIds.has(id) ? 'ACCOUNTING' : 'POS']));
  return { dates, netProfitByKey, breakdownByKey, sourceByStore };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleNetProfitReportApi(request, env, pathname) {
  if (pathname !== '/api/admin/reports/net-profit' || request.method !== 'GET') return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const callerStore = await selectedStore(db, request);
  if (!callerStore) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!callerStore.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);

  const url = new URL(request.url);
  const from = validateBusinessDate(url.searchParams.get('from') || '');
  const to = validateBusinessDate(url.searchParams.get('to') || '');
  if (!from || !to || from > to) return json({ error: 'Periode laporan tidak valid.', code: 'INVALID_REPORT_PERIOD' }, 400);
  // Batasi lebar range: biaya query pertama kali (belum ke-cache) proporsional
  // ke jumlah hari x gerai -- ini bukan soal keamanan, cuma pagar wajar
  // supaya sekali panggilan tidak menghitung bertahun-tahun sekaligus.
  if (enumerateDates(from, to).length > 366) {
    return json({ error: 'Rentang laporan maksimal 366 hari sekali tampil.', code: 'REPORT_RANGE_TOO_WIDE' }, 400);
  }

  const entityStores = (await listStores(db, { includeInactive: true })).filter(store => store.entityId === callerStore.entityId);

  // Siapa yang boleh melihat SELURUH gerai satu entity, dan siapa yang cuma
  // gerainya sendiri. Ini bukan detail kosmetik: Admin Gerai terikat ke satu
  // gerai lewat `?store=` (adminStoreMatchesRequest), tapi parameter `stores=`
  // di bawah ini jalur terpisah yang tidak ikut kecek di sana -- tanpa pagar
  // ini, Admin gerai A bisa minta laporan untung-rugi gerai B cukup dengan
  // menukar satu parameter. Invariant CLAUDE.md #5 (isolasi store_id
  // server-side).
  const entityWide = Boolean(auth.owner || auth.entityAdmin);
  const allowedStores = entityWide ? entityStores : entityStores.filter(store => store.id === callerStore.id);

  const requestedCodesRaw = (url.searchParams.get('stores') || '').split(',').map(code => code.trim()).filter(Boolean);
  const requestedCodes = requestedCodesRaw.length ? requestedCodesRaw : allowedStores.map(store => store.code);

  const selected = [];
  for (const code of requestedCodes) {
    const store = allowedStores.find(item => item.code === code);
    if (!store) {
      return entityStores.some(item => item.code === code)
        ? json({ error: `Laporan gerai ${code} hanya bisa dibuka Owner atau Admin Entity.`, code: 'STORE_OUT_OF_CALLER_SCOPE' }, 403)
        : json({ error: `Gerai ${code} bukan bagian dari entity ini.`, code: 'STORE_OUT_OF_ENTITY_SCOPE' }, 403);
    }
    selected.push(store);
  }
  if (!selected.length) return json({ from, to, stores: [], rows: [] });

  const { dates, netProfitByKey, breakdownByKey, sourceByStore } = await getNetProfitReport(db, {
    storeIds: selected.map(store => store.id),
    from,
    to
  });

  // Rincian per hari cuma ikut dikirim kalau yang dipilih PERSIS satu gerai --
  // itu bentuk panel Admin Gerai. Kalau 10 gerai x 366 hari, rinciannya jadi
  // payload besar yang tabel entity pun tidak memakainya.
  const withBreakdown = selected.length === 1;
  const rows = dates.map(businessDate => {
    const byStore = {};
    let total = 0;
    for (const store of selected) {
      const value = netProfitByKey.get(`${store.id}::${businessDate}`) ?? 0;
      byStore[store.code] = value;
      total += value;
    }
    const row = { businessDate, byStore, total };
    if (withBreakdown) {
      row.breakdown = breakdownByKey.get(`${selected[0].id}::${businessDate}`) || EMPTY_BREAKDOWN;
    }
    return row;
  });

  const totals = { byStore: {}, total: 0 };
  for (const store of selected) totals.byStore[store.code] = 0;
  for (const row of rows) {
    for (const store of selected) totals.byStore[store.code] += row.byStore[store.code];
    totals.total += row.total;
  }

  // Total per gerai untuk grafik perbandingan Entity (Omset, Untung, Beban...):
  // dijumlah dari rincian harian yang SUDAH dihitung di atas, jadi tidak
  // menambah satu query pun. Beban per akun (sumber Akuntansi) ikut dijumlah.
  const sumBreakdown = dayBreakdowns => {
    const sum = { ...EMPTY_BREAKDOWN };
    const beban = new Map();
    for (const day of dayBreakdowns) {
      if (!day) continue;
      for (const field of Object.keys(EMPTY_BREAKDOWN)) sum[field] += Number(day[field] || 0);
      for (const entry of day.bebanAccounts || []) {
        const current = beban.get(entry.code) || { code: entry.code, name: entry.name, amount: 0 };
        current.amount += entry.amount;
        beban.set(entry.code, current);
      }
    }
    return { ...sum, bebanAccounts: [...beban.values()].filter(entry => entry.amount !== 0).sort((a, b) => a.code.localeCompare(b.code)) };
  };
  const storeTotals = selected.map(store => ({
    code: store.code,
    storeName: store.storeName,
    source: sourceByStore[store.id] || 'POS',
    ...sumBreakdown(dates.map(businessDate => breakdownByKey.get(`${store.id}::${businessDate}`)))
  }));

  // Transaksi yang belum masuk pembukuan (gerai sumber Akuntansi): angkanya
  // ikut ditampilkan supaya laporan tidak diam-diam kurang. Dihitung dari
  // fakta itu sendiri (definisi yang sama dengan tombol sinkron Akuntansi).
  const unposted = {};
  for (const store of selected) {
    if (sourceByStore[store.id] !== 'ACCOUNTING') continue;
    const [posCount, adminCount, reasons] = await Promise.all([
      countUnsyncedPosFacts(db, store.id),
      countPendingAdminFacts(db, store.id),
      db.prepare(`
        SELECT failure_code, failure_detail, COUNT(*) AS n FROM accounting_bridge_deliveries
        WHERE store_id = ? AND status IN ('NEEDS_CONFIGURATION', 'FAILED', 'PENDING')
        GROUP BY failure_code, failure_detail ORDER BY n DESC LIMIT 5
      `).bind(store.id).all()
    ]);
    if (posCount + adminCount > 0) {
      unposted[store.code] = {
        count: posCount + adminCount,
        reasons: (reasons.results ?? []).map(row => ({ code: row.failure_code || '', detail: row.failure_detail || '', count: Number(row.n || 0) }))
      };
    }
  }

  const response = {
    from, to,
    scope: entityWide ? 'ENTITY' : 'STORE',
    stores: selected.map(store => ({ code: store.code, storeName: store.storeName, source: sourceByStore[store.id] || 'POS' })),
    rows,
    totals,
    storeTotals,
    unposted
  };
  if (withBreakdown) {
    response.source = sourceByStore[selected[0].id] || 'POS';
    response.breakdownTotals = sumBreakdown(rows.map(row => row.breakdown));
  }
  return json(response);
}

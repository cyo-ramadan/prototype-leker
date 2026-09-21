import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, listStores, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';

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
//   Gross Profit = Pendapatan Lain + Penjualan - HPP
//   Net Profit   = Gross Profit - Beban Operasional
// Pembelian Bahan TIDAK PERNAH masuk formula ini (Persediaan/aset, bukan
// Beban -- sudah otomatis kepisah karena tercatat di tabel purchases,
// bukan expenses).
//
// BEBAN_SOURCES: sumber Beban yang dibaca laporan ini -- `expenses`
// (Pengeluaran Kasir) dan `admin_operational_expenses` (Bea Operasional
// dari panel Admin Gerai, migration 0100). Kalau nanti ada
// fitur/tombol baru yang debit-nya dianalisis sebagai Beban (aturan Bos
// Cyo: namanya wajib dimulai "Beban"/"Bea" supaya kelihatan dari kode),
// WAJIB didaftarkan eksplisit di sini juga -- penamaan itu penanda buat
// manusia, pendaftaran di sini yang benar-benar dibaca laporan.
const BEBAN_SOURCES = ['expenses', 'admin_operational_expenses'];

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
    SELECT store_id, business_date, revenue, other_income, hpp, expense, stock_adjustment_net, net_profit
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

  const [revenueRows, otherIncomeRows, expenseRows, hppRows, stockAdjustmentRows, adminExpenseRows] = await Promise.all([
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
    // kalo tambah jadi pendapatan lain"). Nilainya sudah disnapshot di
    // payload_json saat pengajuan dibuat (unitCostSnapshotScaled x qty,
    // src/operational-posting.js) -- BUKAN dihitung ulang di sini, cukup
    // dibaca. direction IN = stok lebih (gain), OUT = stok kurang (loss).
    sumByStoreDate(db, `
      SELECT store_id, ${JAKARTA_BUSINESS_DATE_SQL.replace('created_at', 'posted_at')} AS business_date,
             COALESCE(SUM(
               CASE WHEN json_extract(payload_json, '$.direction') = 'IN'
                    THEN json_extract(payload_json, '$.totalCostSnapshotScaled')
                    ELSE -json_extract(payload_json, '$.totalCostSnapshotScaled')
               END
             ), 0) AS value
      FROM approval_requests
      WHERE request_type = 'GOODS_FLOW' AND posting_status = 'posted'
        AND json_extract(payload_json, '$.purpose') = 'STOCK_ADJUSTMENT'
        AND store_id IN (${storePh}) AND ${JAKARTA_BUSINESS_DATE_SQL.replace('created_at', 'posted_at')} IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates]),
    // Bea Operasional yang dicatat dari panel Admin (Bea Gaji/Lapak/Lainnya,
    // migration 0100). Sumber Beban KEDUA di laporan ini. Beda dari tiga query
    // di atas: tabel ini sudah punya kolom business_date sendiri (diisi Admin,
    // boleh mundur -- bayar gaji tanggal 5 untuk periode bulan lalu), jadi
    // TIDAK diturunkan dari created_at.
    sumByStoreDate(db, `
      SELECT store_id, business_date, COALESCE(SUM(amount), 0) AS value
      FROM admin_operational_expenses
      WHERE voided_at IS NULL AND store_id IN (${storePh}) AND business_date IN (${datePh})
      GROUP BY store_id, business_date
    `, [...storeIds, ...dates])
  ]);

  const key = (storeId, businessDate) => `${storeId}::${businessDate}`;
  const facts = new Map();
  for (const storeId of storeIds) {
    for (const businessDate of dates) {
      facts.set(key(storeId, businessDate), { revenue: 0, otherIncome: 0, expense: 0, adminExpense: 0, hppScaled: 0, stockAdjustmentNetScaled: 0 });
    }
  }
  for (const row of revenueRows) facts.get(key(row.store_id, row.business_date)).revenue = Number(row.value || 0);
  for (const row of otherIncomeRows) facts.get(key(row.store_id, row.business_date)).otherIncome = Number(row.value || 0);
  for (const row of expenseRows) facts.get(key(row.store_id, row.business_date)).expense = Number(row.value || 0);
  for (const row of hppRows) facts.get(key(row.store_id, row.business_date)).hppScaled = Number(row.value || 0);
  for (const row of stockAdjustmentRows) facts.get(key(row.store_id, row.business_date)).stockAdjustmentNetScaled = Number(row.value || 0);
  for (const row of adminExpenseRows) facts.get(key(row.store_id, row.business_date)).adminExpense = Number(row.value || 0);
  return facts;
}

function netProfitFromFacts(facts) {
  const hpp = rupiahFromScaledSum(facts.hppScaled);
  const stockAdjustmentNet = rupiahFromScaledSum(facts.stockAdjustmentNetScaled);
  // Beban = Pengeluaran Kasir + Bea Operasional Admin. Dijumlah jadi satu di
  // sini karena kolom `expense` di cache (store_daily_profit_snapshot,
  // migration 0099) memang berarti "total Beban Operasional" -- bukan khusus
  // pengeluaran kasir. Kalau nanti butuh rinciannya per sumber, itu kolom baru
  // di cache, bukan mengubah arti kolom ini.
  const totalExpense = facts.expense + facts.adminExpense;
  const grossProfit = facts.otherIncome + facts.revenue - hpp;
  const netProfit = grossProfit - totalExpense + stockAdjustmentNet;
  return { revenue: facts.revenue, otherIncome: facts.otherIncome, hpp, expense: totalExpense, stockAdjustmentNet, netProfit };
}

// Dipanggil setiap kali ada Bea Operasional dicatat/dibatalkan untuk sebuah
// (gerai, tanggal). Tanpa ini, bea yang dicatat MUNDUR ke hari yang sudah
// ditutup-buku tidak akan pernah kelihatan -- laporan tetap menyajikan angka
// lama dari cache, dan tidak ada error apa pun yang memberi tahu.
export async function invalidateDailyProfitSnapshot(db, storeId, businessDate) {
  await db.prepare('DELETE FROM store_daily_profit_snapshot WHERE store_id = ? AND business_date = ?')
    .bind(storeId, businessDate).run();
}

export async function getNetProfitReport(db, { storeIds, from, to, today = getJakartaBusinessDate() }) {
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
  // Rincian per hari ikut dibawa (Penjualan/HPP/Beban/Penyesuaian Stok) supaya
  // panel Admin Gerai bisa menunjukkan KENAPA untung/ruginya segitu, bukan cuma
  // angka akhirnya -- target penggunanya justru yang tidak paham akuntansi.
  // Kolomnya sudah ada di cache sejak migration 0099, jadi ini tidak menambah
  // satu query pun.
  const breakdownByKey = new Map();
  for (const row of cached) {
    const key = `${row.store_id}::${row.business_date}`;
    netProfitByKey.set(key, Number(row.net_profit));
    breakdownByKey.set(key, {
      revenue: Number(row.revenue || 0),
      otherIncome: Number(row.other_income || 0),
      hpp: Number(row.hpp || 0),
      expense: Number(row.expense || 0),
      stockAdjustmentNet: Number(row.stock_adjustment_net || 0),
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
      INSERT INTO store_daily_profit_snapshot (store_id, business_date, revenue, other_income, hpp, expense, stock_adjustment_net, net_profit, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (store_id, business_date) DO UPDATE SET
        revenue = excluded.revenue, other_income = excluded.other_income, hpp = excluded.hpp,
        expense = excluded.expense, stock_adjustment_net = excluded.stock_adjustment_net,
        net_profit = excluded.net_profit, computed_at = CURRENT_TIMESTAMP
    `).bind(row.storeId, row.businessDate, row.revenue, row.otherIncome, row.hpp, row.expense, row.stockAdjustmentNet, row.netProfit)));
  }

  return { dates, netProfitByKey, breakdownByKey };
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

  const { dates, netProfitByKey, breakdownByKey } = await getNetProfitReport(db, {
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
      row.breakdown = breakdownByKey.get(`${selected[0].id}::${businessDate}`)
        || { revenue: 0, otherIncome: 0, hpp: 0, expense: 0, stockAdjustmentNet: 0, netProfit: 0 };
    }
    return row;
  });

  const totals = { byStore: {}, total: 0 };
  for (const store of selected) totals.byStore[store.code] = 0;
  for (const row of rows) {
    for (const store of selected) totals.byStore[store.code] += row.byStore[store.code];
    totals.total += row.total;
  }

  const response = {
    from, to,
    scope: entityWide ? 'ENTITY' : 'STORE',
    stores: selected.map(store => ({ code: store.code, storeName: store.storeName })),
    rows,
    totals
  };
  if (withBreakdown) {
    response.breakdownTotals = rows.reduce((acc, row) => ({
      revenue: acc.revenue + row.breakdown.revenue,
      otherIncome: acc.otherIncome + row.breakdown.otherIncome,
      hpp: acc.hpp + row.breakdown.hpp,
      expense: acc.expense + row.breakdown.expense,
      stockAdjustmentNet: acc.stockAdjustmentNet + row.breakdown.stockAdjustmentNet,
      netProfit: acc.netProfit + row.breakdown.netProfit
    }), { revenue: 0, otherIncome: 0, hpp: 0, expense: 0, stockAdjustmentNet: 0, netProfit: 0 });
  }
  return json(response);
}

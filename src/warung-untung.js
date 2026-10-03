// Tab "Untung" skin E (jaga sendiri) -- DESAIN-SKIN-E-JAGA-SENDIRI.md §4.
// Bos Cyo, 2026-10-02: "di skin d ini user kita nanti ga ada karyawan, jadi
// yang jadi kasir dan adminnya nanti dia." Pemilik warung tanpa karyawan
// login sekali (akun kasir) dan harus bisa melihat untungnya tanpa pindah ke
// panel Pemilik. Endpoint ini HANYA BACA, hanya gerai milik sesi kasir itu,
// dan hanya untuk tenant skin E -- tenant lain tetap memakai laporan
// /api/admin/reports/net-profit yang wajib login manajemen.
//
// Angka untung diambil dari mesin yang sama dengan laporan Untung Bersih
// (getNetProfitReport), bukan dihitung ulang di sini.
import { json } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { getNetProfitReport } from './net-profit-report.js';
import { autoSyncAccounting } from './accounting-auto-sync.js';
import { getJakartaBusinessDate, jakartaWallClockToUtc } from './time.js';

const DAYS = 7;

function shiftDate(businessDate, days) {
  const date = new Date(`${businessDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function topProductsToday(db, storeId, today) {
  const since = jakartaWallClockToUtc(today, '00:00').toISOString();
  const rows = await db.prepare(`
    SELECT si.product_name AS name, SUM(si.quantity) AS quantity, SUM(si.line_total) AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE si.store_id = ? AND s.voided_at IS NULL AND s.created_at >= ?
    GROUP BY si.product_id, si.product_name
    ORDER BY quantity DESC, total DESC
    LIMIT 5
  `).bind(storeId, since).all();
  return (rows.results ?? []).map(row => ({ name: row.name, quantity: Number(row.quantity) || 0, total: Number(row.total) || 0 }));
}

export async function handleWarungUntungApi(request, env, pathname) {
  if (pathname !== '/api/cashier/warung/untung') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const db = env.DB;
  const auth = await requireCashier(request, db);
  if (!auth.ok) return auth.response;
  const store = auth.cashier.store;
  if (!store.ownerOperated) {
    return json({ error: 'Untung hanya bisa dilihat dari login kasir di tenant Jaga Sendiri (skin E).', code: 'OWNER_OPERATED_ONLY' }, 403);
  }

  const today = getJakartaBusinessDate();
  const from = shiftDate(today, -(DAYS - 1));
  await autoSyncAccounting(db, [store]);
  const { dates, netProfitByKey, breakdownByKey, sourceByStore } = await getNetProfitReport(db, { storeIds: [store.id], from, to: today });
  const days = dates.map(businessDate => ({ businessDate, netProfit: netProfitByKey.get(`${store.id}::${businessDate}`) ?? 0 }));
  const todayBreakdown = breakdownByKey.get(`${store.id}::${today}`) || {};
  const pick = field => Number(todayBreakdown[field] || 0);

  return json({
    store: { code: store.code, storeName: store.storeName },
    today: {
      businessDate: today,
      netProfit: days[days.length - 1]?.netProfit ?? 0,
      revenue: pick('revenue') + pick('otherIncome'),
      modal: pick('hpp'),
      biaya: pick('totalBeban')
    },
    yesterday: { businessDate: days[days.length - 2]?.businessDate ?? null, netProfit: days[days.length - 2]?.netProfit ?? 0 },
    week: { total: days.reduce((sum, day) => sum + day.netProfit, 0), days },
    topProducts: await topProductsToday(db, store.id, today),
    source: sourceByStore[store.id] || 'POS'
  });
}

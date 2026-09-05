import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';

export const STAFF_RAPORT_CONTRACT = 'MAXI_STAFF_RAPORT_FACTS_V1';
const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);

export async function getCashierRaportFacts(db, storeId, cashierId) {
  const [sales, purchases, expenses, permits, attendance, drawers] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount FROM sales WHERE store_id = ? AND cashier_id = ?`).bind(storeId, cashierId).first(),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount FROM purchases WHERE store_id = ? AND cashier_id = ?`).bind(storeId, cashierId).first(),
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM expenses WHERE store_id = ? AND cashier_id = ?`).bind(storeId, cashierId).first(),
    db.prepare(`
      SELECT
        COUNT(*) AS requested,
        COALESCE(SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END), 0) AS approved,
        COALESCE(SUM(CASE WHEN approval_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
        COALESCE(SUM(CASE WHEN approval_status = 'pending_approval' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN execution_status = 'HOLD' THEN 1 ELSE 0 END), 0) AS execution_hold,
        COALESCE(SUM(CASE WHEN execution_status = 'EXECUTED' THEN 1 ELSE 0 END), 0) AS executed
      FROM approval_permits
      WHERE store_id = ? AND cashier_id = ? AND permit_type = 'TRANSACTION_VOID'
    `).bind(storeId, cashierId).first(),
    db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS closed,
             COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open
      FROM staff_attendance WHERE store_id = ? AND user_id = ?
    `).bind(storeId, cashierId).first(),
    db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) AS closed
      FROM cash_drawer_sessions WHERE store_id = ? AND cashier_id = ?
    `).bind(storeId, cashierId).first()
  ]);

  return {
    contract: STAFF_RAPORT_CONTRACT,
    cashierId,
    score: null,
    grade: null,
    scoreStatus: 'NEEDS_KPI_POLICY',
    scoreMessage: 'Bobot, target, periode, dan formula grade belum ditetapkan. Panel menampilkan fakta auditable tanpa mengarang skor.',
    facts: {
      sales: { count: Number(sales?.count || 0), amount: Number(sales?.amount || 0) },
      purchases: { count: Number(purchases?.count || 0), amount: Number(purchases?.amount || 0) },
      operationalExpenses: { count: Number(expenses?.count || 0), amount: Number(expenses?.amount || 0) },
      transactionVoidPermits: {
        requested: Number(permits?.requested || 0),
        approved: Number(permits?.approved || 0),
        rejected: Number(permits?.rejected || 0),
        pending: Number(permits?.pending || 0),
        executionHold: Number(permits?.execution_hold || 0),
        executed: Number(permits?.executed || 0)
      },
      attendance: {
        total: Number(attendance?.total || 0),
        closed: Number(attendance?.closed || 0),
        open: Number(attendance?.open || 0)
      },
      drawers: { total: Number(drawers?.total || 0), closed: Number(drawers?.closed || 0) }
    },
    assessmentInputs: [
      { code: 'transaction_void_requests', label: 'Permintaan hapus/void transaksi', source: 'approval_permits', scoring: 'UNCONFIGURED' },
      { code: 'transaction_activity', label: 'Aktivitas transaksi', source: 'sales+purchases+expenses', scoring: 'UNCONFIGURED' },
      { code: 'attendance_activity', label: 'Aktivitas presensi', source: 'staff_attendance', scoring: 'UNCONFIGURED' },
      { code: 'drawer_activity', label: 'Aktivitas laci', source: 'cash_drawer_sessions', scoring: 'UNCONFIGURED' }
    ]
  };
}

async function managementScope(request, env) {
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth;
  if (auth.authType === 'LEGACY_PIN') return { ok: false, response: json({ error: 'Raport membutuhkan akun Admin Gerai atau Owner.' }, 403) };
  if (auth.admin) return { ...auth, storeId: auth.admin.store.id };
  const token = text(new URL(request.url).searchParams.get('store'), 80);
  if (!token) return { ...auth, storeId: null };
  const store = await resolveStore(env.DB, token, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai Raport tidak ditemukan.' }, 404) };
  return { ...auth, storeId: store.id };
}

export async function handleAdminCashierRaportApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/admin/cashier-raport') return null;
  const scope = await managementScope(request, env);
  if (!scope.ok) return scope.response;
  const conditions = ['c.is_active IN (0, 1)'];
  const values = [];
  if (scope.storeId) { conditions.push('c.store_id = ?'); values.push(scope.storeId); }
  const rows = await env.DB.prepare(`
    SELECT c.id, c.store_id, c.username, c.employee_name, c.is_active, s.code AS store_code, s.store_name
    FROM cashiers c JOIN stores s ON s.id = c.store_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.code, c.employee_name COLLATE NOCASE, c.id
  `).bind(...values).all();
  const cashiers = [];
  for (const row of rows.results || []) {
    cashiers.push({
      cashierId: row.id,
      username: row.username,
      employeeName: row.employee_name,
      isActive: Boolean(row.is_active),
      store: { id: row.store_id, code: row.store_code, storeName: row.store_name },
      raport: await getCashierRaportFacts(env.DB, row.store_id, row.id)
    });
  }
  return json({ contract: STAFF_RAPORT_CONTRACT, cashiers });
}

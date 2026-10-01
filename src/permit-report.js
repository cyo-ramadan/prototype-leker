import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate, jakartaWallClockToUtc } from './time.js';
import { overRadiusMeters } from './attendance-gps.js';

// Bos Cyo, 2026-10-01: "sediakan tombol untuk membaca data2 permit, bisa
// pilih kategorinya juga, permit presensi, permit hapus penjualan, permit
// masukin uang kas, dan permit2 lainya. terus bisa di filter juga berdasarkan
// karyawan requestnya." Laporan baca-saja yang menggabungkan permit dari
// tabel-tabel yang sudah ada (tidak ada tabel baru dan tidak ada yang ditulis):
//   - ATTENDANCE_CORRECTION  attendance_correction_permits
//   - ATTENDANCE_GPS         attendance_gps_permits (perbaikan GPS presensi)
//   - TRANSACTION_VOID       approval_permits (hapus penjualan/pembelian/pengeluaran)
//   - CASH_FLOW/GOODS_FLOW/ASSET  approval_requests (uang kas, arus barang, aset)
//   - DRAWER_CLOSE           drawer_close_permits (tutup laci sebelumnya)
// Status dinormalkan ke PENDING / APPROVED / REJECTED / EXPIRED. Setiap sumber
// dibatasi gerai + rentang tanggal (default 30 hari) supaya pembacaan D1 kecil.

const text = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'];
const MAX_ROWS = 200;
const DEFAULT_DAYS = 30;

const REQUEST_STATUS_EXPR = `CASE r.approval_status WHEN 'pending_approval' THEN 'PENDING' WHEN 'approved' THEN 'APPROVED' ELSE 'REJECTED' END`;
const REQUEST_FROM = 'approval_requests r JOIN cashiers c ON c.id = r.cashier_id';
const REQUEST_SELECT = `
  r.id, r.cashier_id AS requester_id, c.employee_name AS requester_name, r.created_at,
  COALESCE(r.approved_at, r.rejected_at) AS decided_at, r.approved_by_role AS decided_by_role,
  r.decision_note, r.payload_json`;

const SOURCES = [
  {
    code: 'ATTENDANCE_CORRECTION', label: 'Koreksi Presensi',
    from: 'attendance_correction_permits p JOIN cashiers c ON c.id = p.requested_by_cashier_id',
    storeColumn: 'p.store_id', requesterColumn: 'p.requested_by_cashier_id', createdColumn: 'p.created_at',
    statusExpr: 'p.status', baseWhere: '1 = 1',
    select: `p.id, p.requested_by_cashier_id AS requester_id, c.employee_name AS requester_name, p.created_at,
             p.decided_at, p.decided_by_role, p.decision_note, p.reason, p.original_check_in_at, p.requested_check_in_at`,
    summary: row => `Jam masuk ${clock(row.original_check_in_at)} diminta jadi ${clock(row.requested_check_in_at)}`
  },
  {
    code: 'ATTENDANCE_GPS', label: 'Perbaikan GPS Presensi',
    from: 'attendance_gps_permits p JOIN cashiers c ON c.id = p.requested_by_cashier_id',
    storeColumn: 'p.store_id', requesterColumn: 'p.requested_by_cashier_id', createdColumn: 'p.created_at',
    statusExpr: 'p.status', baseWhere: '1 = 1',
    select: `p.id, p.requested_by_cashier_id AS requester_id, c.employee_name AS requester_name, p.created_at,
             p.decided_at, p.decided_by_role, p.decision_note, p.reason, p.which, p.original_status, p.original_distance_m`,
    summary: row => `GPS presensi ${row.which === 'OUT' ? 'pulang' : 'masuk'}: ${row.original_status === 'OUT_OF_RADIUS' ? `melebihi batas radius ${overRadiusMeters(row.original_distance_m)} meter` : 'tanpa GPS'}`
  },
  {
    code: 'TRANSACTION_VOID', label: 'Hapus Transaksi',
    from: 'approval_permits p JOIN cashiers c ON c.id = p.cashier_id',
    storeColumn: 'p.store_id', requesterColumn: 'p.cashier_id', createdColumn: 'p.requested_at',
    statusExpr: `CASE p.approval_status WHEN 'pending_approval' THEN 'PENDING' WHEN 'approved' THEN 'APPROVED' ELSE 'REJECTED' END`,
    baseWhere: `p.permit_type = 'TRANSACTION_VOID'`,
    select: `p.id, p.cashier_id AS requester_id, c.employee_name AS requester_name, p.requested_at AS created_at,
             p.decided_at, p.approved_by_role AS decided_by_role, p.decision_note, p.reason, p.subject_type, p.subject_snapshot_json`,
    summary: row => {
      const snapshot = parseJson(row.subject_snapshot_json);
      const subject = { SALE: 'penjualan', PURCHASE: 'pembelian', EXPENSE: 'pengeluaran' }[row.subject_type] || 'transaksi';
      const parts = [`Hapus ${subject}`];
      if (snapshot.description) parts.push(text(snapshot.description, 80));
      if (snapshot.amount != null) parts.push(rupiah(snapshot.amount));
      return parts.join(' · ');
    }
  },
  ...[
    ['CASH_FLOW', 'Uang Kas Masuk/Keluar', row => {
      const payload = parseJson(row.payload_json);
      const direction = payload.direction === 'IN' ? 'Kas masuk' : payload.direction === 'OUT' ? 'Kas keluar' : 'Arus kas';
      return [direction, payload.amount != null ? rupiah(payload.amount) : '', text(payload.description, 100)].filter(Boolean).join(' · ');
    }],
    ['GOODS_FLOW', 'Arus Barang', row => {
      const payload = parseJson(row.payload_json);
      const label = payload.purpose === 'STOCK_ADJUSTMENT' ? 'Penyesuaian stok' : 'Arus barang';
      return [label, text(payload.productName || payload.description, 100)].filter(Boolean).join(' · ');
    }],
    ['ASSET', 'Aset', row => {
      const payload = parseJson(row.payload_json);
      return ['Aset', payload.amount != null ? rupiah(payload.amount) : '', text(payload.description || payload.name, 100)].filter(Boolean).join(' · ');
    }]
  ].map(([code, label, summary]) => ({
    code, label, from: REQUEST_FROM,
    storeColumn: 'r.store_id', requesterColumn: 'r.cashier_id', createdColumn: 'r.created_at',
    statusExpr: REQUEST_STATUS_EXPR, baseWhere: `r.request_type = '${code}'`,
    select: REQUEST_SELECT, summary,
    reason: row => text(parseJson(row.payload_json).note || parseJson(row.payload_json).reason, 300)
  })),
  {
    code: 'DRAWER_CLOSE', label: 'Tutup Laci Sebelumnya',
    from: 'drawer_close_permits p JOIN cashiers c ON c.id = p.requested_by_cashier_id JOIN cashiers t ON t.id = p.target_cashier_id',
    storeColumn: 'p.store_id', requesterColumn: 'p.requested_by_cashier_id', createdColumn: 'p.created_at',
    statusExpr: `CASE WHEN p.status = 'REJECTED' AND COALESCE(p.decided_by_role, '') = 'SYSTEM' THEN 'EXPIRED' ELSE p.status END`,
    baseWhere: '1 = 1',
    select: `p.id, p.requested_by_cashier_id AS requester_id, c.employee_name AS requester_name, p.created_at,
             p.decided_at, p.decided_by_role, p.decision_note, p.reason, t.employee_name AS target_name, p.closing_amount, p.deposit_amount`,
    summary: row => `Tutup laci ${row.target_name || ''} · saldo ${rupiah(row.closing_amount)}${Number(row.deposit_amount) ? ` · setoran ${rupiah(row.deposit_amount)}` : ''}`
  }
];

function parseJson(value) {
  try { return JSON.parse(value || '{}') || {}; } catch { return {}; }
}
function rupiah(value) {
  return `Rp${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
}
function clock(value) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(value));
}
// Kolom created_at ada yang ISO 'T...Z' dan ada yang 'YYYY-MM-DD HH:MM:SS' (UTC).
function isoOf(value) {
  if (!value) return null;
  const raw = String(value);
  return raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
}

function addDays(date, days) {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function resolveRange(url) {
  const to = DATE.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : getJakartaBusinessDate(new Date());
  const from = DATE.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : addDays(to, -(DEFAULT_DAYS - 1));
  if (from > to) return null;
  return {
    from, to,
    fromUtc: jakartaWallClockToUtc(from, '00:00').toISOString(),
    toExclusiveUtc: jakartaWallClockToUtc(addDays(to, 1), '00:00').toISOString()
  };
}

function whereFor(source, storeId, range, requesterId) {
  const conditions = [source.baseWhere, `${source.storeColumn} = ?`, `datetime(${source.createdColumn}) >= datetime(?)`, `datetime(${source.createdColumn}) < datetime(?)`];
  const values = [storeId, range.fromUtc, range.toExclusiveUtc];
  if (requesterId) { conditions.push(`${source.requesterColumn} = ?`); values.push(requesterId); }
  return { sql: conditions.join(' AND '), values };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function buildPermitReport(db, storeId, { category = 'ALL', requesterId = null, status = 'ALL', range }) {
  const sources = SOURCES.filter(source => category === 'ALL' || source.code === category);
  const rows = [];
  const byCategory = {};
  for (const source of sources) {
    const where = whereFor(source, storeId, range, requesterId);
    const statusFilter = status !== 'ALL' ? ` AND ${source.statusExpr} = ?` : '';
    const listValues = status !== 'ALL' ? [...where.values, status] : where.values;
    const [list, counts] = await Promise.all([
      db.prepare(`
        SELECT ${source.select}, ${source.statusExpr} AS status
        FROM ${source.from}
        WHERE ${where.sql}${statusFilter}
        ORDER BY datetime(${source.createdColumn}) DESC LIMIT ${MAX_ROWS}
      `).bind(...listValues).all(),
      db.prepare(`
        SELECT ${source.statusExpr} AS status, COUNT(*) AS n
        FROM ${source.from}
        WHERE ${where.sql}
        GROUP BY ${source.statusExpr}
      `).bind(...where.values).all()
    ]);
    byCategory[source.code] = Object.fromEntries(STATUSES.map(name => [name, 0]));
    for (const entry of counts.results ?? []) byCategory[source.code][entry.status] = Number(entry.n);
    for (const row of list.results ?? []) {
      rows.push({
        category: source.code,
        categoryLabel: source.label,
        id: row.id,
        requesterId: row.requester_id,
        requesterName: row.requester_name || '',
        status: row.status,
        createdAt: isoOf(row.created_at),
        decidedAt: isoOf(row.decided_at),
        decidedByRole: row.decided_by_role || null,
        decisionNote: row.decision_note || '',
        reason: text(source.reason ? source.reason(row) : row.reason, 300),
        summary: source.summary(row)
      });
    }
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const totals = Object.fromEntries(STATUSES.map(name => [name, 0]));
  for (const counts of Object.values(byCategory)) for (const name of STATUSES) totals[name] += counts[name];
  return {
    rows: rows.slice(0, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
    summary: { total: Object.values(totals).reduce((sum, n) => sum + n, 0), byStatus: totals, byCategory }
  };
}

export async function handlePermitReportApi(request, env, pathname) {
  if (pathname !== '/api/admin/permit-report' || request.method !== 'GET') return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const url = new URL(request.url);
  const category = text(url.searchParams.get('category'), 40).toUpperCase() || 'ALL';
  if (category !== 'ALL' && !SOURCES.some(source => source.code === category)) return json({ error: 'Kategori permit tidak dikenal.' }, 400);
  const status = text(url.searchParams.get('status'), 20).toUpperCase() || 'ALL';
  if (status !== 'ALL' && !STATUSES.includes(status)) return json({ error: 'Status permit tidak dikenal.' }, 400);
  const range = resolveRange(url);
  if (!range) return json({ error: 'Tanggal "dari" tidak boleh setelah tanggal "sampai".' }, 400);
  const requesterId = text(url.searchParams.get('requester'), 160) || null;

  const report = await buildPermitReport(db, store.id, { category, requesterId, status, range });
  const cashiers = await db.prepare(`SELECT id, employee_name FROM cashiers WHERE store_id = ? ORDER BY employee_name COLLATE NOCASE`).bind(store.id).all();
  const requesters = new Map((cashiers.results ?? []).map(row => [row.id, row.employee_name]));
  for (const row of report.rows) if (!requesters.has(row.requesterId)) requesters.set(row.requesterId, row.requesterName);

  return json({
    store,
    filters: { category, status, requester: requesterId, from: range.from, to: range.to },
    categories: SOURCES.map(source => ({ code: source.code, label: source.label })),
    requesters: [...requesters].map(([id, name]) => ({ id, name })),
    ...report
  });
}

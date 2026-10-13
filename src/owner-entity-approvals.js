import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { handleApprovalQueueApi } from './approval-queue.js';
import { handleTransactionVoidPermitApi } from './transaction-void-permits.js';
import { handleDrawerClosePermitApi } from './cashier-drawer-close-permit.js';
import { handleAttendanceCorrectionPermitApi } from './attendance-correction-permit.js';
import { handleAttendanceGpsPermitApi } from './attendance-gps-permit.js';
import { handleEmployeeDepositApi } from './employee-deposit-settlement.js';
import { handleCustomerMembershipApi } from './customer-membership.js';

const BASE = '/api/management/owner-entity';
const TYPES = {
  operation: ['/api/management/approval-requests', handleApprovalQueueApi, 'requests', 'Operasional'],
  void: ['/api/management/transaction-void-permits', handleTransactionVoidPermitApi, 'permits', 'Pembatalan transaksi'],
  close: ['/api/admin/drawer/close-permits', handleDrawerClosePermitApi, 'permits', 'Tutup laci'],
  attendance: ['/api/admin/attendance-correction-permits', handleAttendanceCorrectionPermitApi, 'permits', 'Koreksi presensi'],
  gps: ['/api/admin/attendance-gps-permits', handleAttendanceGpsPermitApi, 'permits', 'Izin lokasi presensi'],
  deposit: ['/api/admin/employee-deposits/pending', handleEmployeeDepositApi, 'payments', 'Setoran CS'],
  customer: ['/api/admin/customer-requests', handleCustomerMembershipApi, 'requests', 'Pendaftaran pelanggan']
};
export { ownerEntityContext } from './owner-entity-context.js';
function inner(request, path, store, method = 'GET', body) {
  const url = new URL(path, request.url); url.searchParams.set('store', store.code);
  return new Request(url, { method, headers: { Authorization: request.headers.get('Authorization') || '', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
export function normalizeOwnerApproval(kind, row, store) {
  const status = String(row.approvalStatus || row.status || '').toLowerCase(), p = row.payload || {};
  let title = TYPES[kind][3];
  if (kind === 'operation') title = p.purpose === 'STOCK_ADJUSTMENT' ? 'Penyesuaian stok' : ({ CASH_FLOW: 'Arus uang', GOODS_FLOW: 'Arus barang', ASSET: 'Aset' }[row.requestType] || title);
  return { key: kind + ':' + store.id + ':' + row.id, kind, id: row.id, storeCode: store.code, storeName: store.storeName, title, status,
    pending: ['pending', 'pending_approval'].includes(status), retry: kind === 'void' && status === 'approved' && row.executionStatus !== 'EXECUTED',
    actor: row.cashierName || row.requestedByCashierName || row.requestedByName || row.employeeName || row.customerName || '',
    reason: row.reason || p.reason || p.note || row.decisionNote || row.rejectionReason || '', createdAt: row.requestedAt || row.createdAt,
    amount: row.subject?.amount ?? row.amountRupiah ?? row.closingAmount ?? p.amount ?? null, data: row };
}
async function readKind(request, env, store, kind, history) {
  const [base, handler, field] = TYPES[kind];
  if (kind === 'customer' && history) {
    return (await env.DB.prepare('SELECT id, customer_name AS customerName, status, rejection_reason AS rejectionReason, created_at AS createdAt, reviewed_at AS reviewedAt FROM customer_registration_requests WHERE store_id = ? ORDER BY created_at DESC LIMIT 200').bind(store.id).all()).results || [];
  }
  let path = kind === 'deposit' && history ? '/api/admin/employee-deposits/overview' : base;
  if (!['deposit', 'customer'].includes(kind)) path += '?status=' + (history ? 'all' : (['operation', 'void'].includes(kind) ? 'pending_approval' : 'PENDING'));
  const req = inner(request, path, store), response = await handler(req, env, new URL(req.url).pathname), body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Daftar belum dapat dimuat.');
  const rows = kind === 'deposit' && history ? body.history : body[field];
  if (!Array.isArray(rows)) throw new Error('Data persetujuan tidak lengkap.');
  return rows;
}
export async function handleOwnerEntityApi(request, env, pathname) {
  if (!pathname.startsWith(BASE + '/')) return null;
  const c = await ownerEntityContext(request, env); if (c.response) return c.response;
  if (pathname === BASE + '/context' && request.method === 'GET') {
    return json({ ownerMode: Boolean(c.owner), entityAdmin: { ...(c.entityAdmin || c.owner), entityId: c.entityId, entityName: c.entity.name }, stores: c.stores });
  }
  if (pathname === BASE + '/approvals' && request.method === 'GET') {
    const history = new URL(request.url).searchParams.get('status') === 'all', items = [], errors = [];
    let limited = false;
    for (const store of c.stores) {
      for (const kinds of [Object.keys(TYPES).slice(0, 4), Object.keys(TYPES).slice(4)]) {
        const results = await Promise.allSettled(kinds.map(kind => readKind(request, env, store, kind, history)));
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') { limited ||= r.value.length >= 200; items.push(...r.value.map(row => normalizeOwnerApproval(kinds[i], row, store))); }
          else errors.push({ storeCode: store.code, kind: kinds[i], error: r.reason.message });
        });
      }
    }
    items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return json({ items, errors, limited, complete: !errors.length && !limited, entityId: c.entityId });
  }
  if (pathname === BASE + '/approvals/decision' && request.method === 'POST') {
    const parsed = await readJson(request); if (!parsed.ok) return json({ error: 'Keputusan tidak valid.' }, 400);
    const { kind, id, storeCode, decision, note = '', sessionId } = parsed.value || {};
    const spec = Object.hasOwn(TYPES, kind || '') ? TYPES[kind] : null, store = c.stores.find(s => s.code === storeCode);
    if (!store) return json({ error: 'Gerai di luar entity ini.' }, 403);
    if (!spec || typeof id !== 'string' || !id || id.length > 200 || !['ACC', 'REJECT', 'RETRY_EXECUTION'].includes(decision)) return json({ error: 'Jenis atau keputusan tidak valid.' }, 400);
    if (decision === 'RETRY_EXECUTION' && kind !== 'void') return json({ error: 'Pengulangan ini tidak tersedia.' }, 400);
    if (decision === 'REJECT' && String(note).trim().length < 3) return json({ error: 'Isi alasan penolakan minimal tiga karakter.' }, 400);
    const body = ['customer', 'deposit'].includes(kind) ? { action: decision === 'ACC' ? 'APPROVE' : 'REJECT', reason: note, rejectionReason: note } : { decision, note, decisionNote: note };
    let path = (kind === 'deposit' ? '/api/admin/employee-deposits/payments' : spec[0]) + '/' + encodeURIComponent(id);
    if (kind === 'operation' && sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length > 200) return json({ error: 'Sesi stok tidak valid.' }, 400);
      path = spec[0] + '/session/' + encodeURIComponent(sessionId);
    }
    const req = inner(request, path, store, 'PATCH', body);
    return spec[1](req, env, new URL(req.url).pathname);
  }
  return json({ error: 'Route portal tidak tersedia.' }, 404);
}

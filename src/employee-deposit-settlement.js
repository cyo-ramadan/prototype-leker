import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { newId } from './ikan-ids.js';
import { rupiahToScaled, scaledToRupiah } from './ikan-money.js';
import {
  addOperationalPayment,
  getOperationalReceivablePayable,
  listOperationalReceivablesPayables,
} from './operational-receivables-payables.js';

// 2026-09-06, Bos Cyo: sisa setoran laci yang belum diserahkan ke kantor jadi
// piutang perusahaan ke CS itu. Fakta piutangnya sendiri hidup di
// operational_receivables_payables (migration 0074, source_type
// EMPLOYEE_DEPOSIT) -- modul itu sudah menyediakan payment+approval flow-nya
// lengkap (addOperationalPayment), file ini cuma menambahkan bagian yang
// sengaja ditinggalkan modul itu untuk "task drawer berikutnya": membuat
// baris EMPLOYEE_DEPOSIT itu sendiri (perlu tahu drawer + pemegang akun),
// dan endpoint entry/approval yang menghadap kasir & Admin/Finance.
//
// Nominal boleh dicicil -- satu piutang bisa dilunasi lewat beberapa entry
// setoran terpisah, dan entry yang di-ACC boleh melebihi sisa saldo (saldo
// jadi negatif, itu bukan bug, invariant #8 CLAUDE.md).

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: 'LEGACY_PIN', id: '' };
}

async function currentAccountHolder(db, storeId, cashierId) {
  const row = await db.prepare(`
    SELECT l.employee_id, l.entity_id, e.full_name
    FROM employee_account_links l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.account_type = 'CASHIER' AND l.account_id = ? AND l.store_id = ? AND l.effective_to IS NULL
    LIMIT 1
  `).bind(cashierId, storeId).first();
  return row || null;
}

// Dipanggil dari src/cashier-drawer.js tepat setelah tutup laci sukses dengan
// depositAmount > 0. Kalau akun kasir itu belum ditautkan ke karyawan mana pun
// (Master Karyawan belum dipakai di gerai ini), sengaja TIDAK membuat piutang
// apa pun -- daripada menebak siapa yang harus ditagih.
export async function createEmployeeDepositReceivable(db, { storeId, cashierId, drawerSessionId, amountRupiah, transactionDate }) {
  const holder = await currentAccountHolder(db, storeId, cashierId);
  if (!holder) return null;
  const id = newId('ORP');
  await db.prepare(`
    INSERT INTO operational_receivables_payables (
      id, store_id, entity_id, source_type, balance_type, source_id,
      counterparty_id, counterparty_name_snapshot, description,
      original_amount, transaction_date
    ) VALUES (?, ?, ?, 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', ?, ?, ?, 'Setoran laci', ?, ?)
  `).bind(
    id, storeId, holder.entity_id, drawerSessionId,
    holder.employee_id, holder.full_name,
    rupiahToScaled(amountRupiah), transactionDate
  ).run();
  return getOperationalReceivablePayable(db, id, { storeId });
}

export async function listOwnEmployeeDeposits(db, storeId, cashierId) {
  const holder = await currentAccountHolder(db, storeId, cashierId);
  if (!holder) return [];
  const all = await listOperationalReceivablesPayables(db, { storeId, filterSourceType: 'EMPLOYEE_DEPOSIT' });
  return all.filter(row => row.counterpartyId === holder.employee_id);
}

function mapPayment(row) {
  return {
    id: row.id,
    receivablePayableId: row.receivable_payable_id,
    amountRupiah: scaledToRupiah(Number(row.amount)),
    approvalStatus: row.approval_status,
    proofReference: row.proof_reference,
    note: row.note,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at
  };
}

async function listPaymentsFor(db, receivablePayableId, storeId) {
  const rows = await db.prepare(`
    SELECT * FROM operational_receivable_payable_payments
    WHERE receivable_payable_id = ? AND store_id = ?
    ORDER BY created_at DESC
  `).bind(receivablePayableId, storeId).all();
  return (rows.results ?? []).map(mapPayment);
}

async function listPendingDepositPayments(db, storeId) {
  const rows = await db.prepare(`
    SELECT p.*, r.counterparty_name_snapshot, r.original_amount
    FROM operational_receivable_payable_payments p
    JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
    WHERE p.store_id = ? AND p.approval_status = 'pending_approval' AND r.source_type = 'EMPLOYEE_DEPOSIT'
    ORDER BY p.created_at ASC
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    ...mapPayment(row),
    employeeName: row.counterparty_name_snapshot
  }));
}

async function reviewDepositPayment(db, paymentId, storeId, { action, reviewerId, rejectionReason }) {
  const payment = await db.prepare(`
    SELECT * FROM operational_receivable_payable_payments WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(paymentId, storeId).first();
  if (!payment) return { ok: false, status: 404, error: 'PAYMENT_NOT_FOUND' };
  if (payment.approval_status !== 'pending_approval') {
    return { ok: false, status: 409, error: 'PAYMENT_ALREADY_REVIEWED' };
  }
  const now = new Date().toISOString();
  if (action === 'APPROVE') {
    await db.prepare(`
      UPDATE operational_receivable_payable_payments
      SET approval_status = 'approved', reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND store_id = ?
    `).bind(reviewerId, now, paymentId, storeId).run();
    return { ok: true };
  }
  if (action === 'REJECT') {
    const reason = text(rejectionReason, 500);
    if (!reason) return { ok: false, status: 400, error: 'REJECTION_REASON_REQUIRED' };
    await db.prepare(`
      UPDATE operational_receivable_payable_payments
      SET approval_status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?
      WHERE id = ? AND store_id = ?
    `).bind(reviewerId, now, reason, paymentId, storeId).run();
    return { ok: true };
  }
  return { ok: false, status: 400, error: 'ACTION_INVALID' };
}

export async function handleEmployeeDepositApi(request, env, pathname) {
  const db = env.DB;

  if (pathname === '/api/cashier/employee-deposits' || pathname.startsWith('/api/cashier/employee-deposits/')) {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    const cashier = auth.cashier;

    if (request.method === 'GET' && pathname === '/api/cashier/employee-deposits') {
      const items = await listOwnEmployeeDeposits(db, cashier.store.id, cashier.id);
      const withPayments = await Promise.all(items.map(async item => ({
        ...item,
        payments: await listPaymentsFor(db, item.id, cashier.store.id)
      })));
      return json({ items: withPayments });
    }

    const submitMatch = pathname.match(/^\/api\/cashier\/employee-deposits\/([^/]+)\/payments$/);
    if (request.method === 'POST' && submitMatch) {
      const receivableId = decodeURIComponent(submitMatch[1]);
      const owned = await listOwnEmployeeDeposits(db, cashier.store.id, cashier.id);
      if (!owned.some(item => item.id === receivableId)) {
        return json({ error: 'Piutang setoran ini bukan milik akun ini.' }, 403);
      }
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload setoran tidak valid.' }, 400);
      const proofReference = text(body.value?.proofReference, 500);
      if (!proofReference) return json({ error: 'Bukti transfer wajib disertakan.' }, 400);
      try {
        const result = await addOperationalPayment(db, receivableId, {
          amountRupiah: body.value?.amountRupiah,
          proofReference,
          note: body.value?.note,
          submittedBy: cashier.id
        }, { storeId: cashier.store.id });
        return json(result, 201);
      } catch (error) {
        return json({ error: error.code || 'SUBMIT_FAILED' }, error.status || 400);
      }
    }

    return json({ error: 'Route setoran karyawan tidak ditemukan.' }, 404);
  }

  if (pathname === '/api/admin/employee-deposits/pending' || pathname.startsWith('/api/admin/employee-deposits/payments/')) {
    const auth = await requireManagement(request, db);
    if (!auth.ok) return auth.response;
    const store = await selectedStore(db, request);
    if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
    const actor = actorFrom(auth);

    if (request.method === 'GET' && pathname === '/api/admin/employee-deposits/pending') {
      return json({ store, payments: await listPendingDepositPayments(db, store.id) });
    }

    const reviewMatch = pathname.match(/^\/api\/admin\/employee-deposits\/payments\/([^/]+)$/);
    if (reviewMatch && request.method === 'PATCH') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload review tidak valid.' }, 400);
      const action = text(body.value?.action, 20).toUpperCase();
      const result = await reviewDepositPayment(db, decodeURIComponent(reviewMatch[1]), store.id, {
        action,
        reviewerId: actor.id || actor.role,
        rejectionReason: body.value?.rejectionReason
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      return json({ ok: true });
    }

    return json({ error: 'Route review setoran karyawan tidak ditemukan.' }, 404);
  }

  return null;
}

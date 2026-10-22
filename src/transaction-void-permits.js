import { json, readJson } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { requireManagement } from './owner-auth.js';
import { resolveStore } from './stores.js';
import { executeTransactionCorrection } from './transaction-correction-executor.js';
import { loadPurchasePriceRanges, purchaseRangeViolation } from './purchase-price-ranges.js';
import { scaledUnitCost } from './cashier-purchase.js';
import { getTenantPolicyChoice, getTenantPolicySetting, KOREKSI_NOMINAL_PEMBELIAN_KEY, UI_SKIN_KEY } from './tenant-policy.js';
import {
  dalamJamSepi, daftarIzinMenunggu, izinDariBaris, pratinjauPutarUlangIzin, terapkanPutarUlangIzin,
  PESAN_DI_LUAR_JAM_SEPI, STATUS_MENUNGGU
} from './hpp-putar-ulang.js';

export const TRANSACTION_VOID_PERMIT_CONTRACT = 'MAXI_TRANSACTION_VOID_PERMIT_V1';
const SUBJECT_TYPES = new Set(['SALE', 'PURCHASE', 'EXPENSE']);
const CORRECTION_KINDS = new Set(['VOID', 'AMOUNT']);
const APPROVAL_STATUSES = new Set(['pending_approval', 'approved', 'rejected']);
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function parseSnapshot(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
// requested_lines_json: array lama [{productId, lineTotal}] atau {lines:[{productId, quantity, lineTotal}], paymentMethod}.
function parseRequested(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (Array.isArray(parsed)) return { lines: parsed, paymentMethod: null };
    return { lines: Array.isArray(parsed?.lines) ? parsed.lines : [], paymentMethod: parsed?.paymentMethod || null };
  } catch { return { lines: [], paymentMethod: null }; }
}
function permitDto(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    drawerSessionId: row.drawer_session_id,
    cashierId: row.cashier_id,
    cashierName: row.cashier_name || '',
    permitType: row.permit_type,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subject: parseSnapshot(row.subject_snapshot_json),
    reason: row.reason,
    approvalStatus: row.approval_status,
    executionStatus: row.execution_status,
    executionCode: row.execution_code || '',
    executionDetail: row.execution_detail || '',
    accountingStatus: row.accounting_status || 'NOT_REQUIRED',
    originalJournalId: row.original_journal_id || null,
    reversalJournalId: row.reversal_journal_id || null,
    decisionNote: row.decision_note || '',
    approvedByRole: row.approved_by_role || null,
    approvedById: row.approved_by_id || null,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at || null,
    executedAt: row.executed_at || null,
    correctionKind: row.correction_kind || 'VOID',
    requestedLines: parseRequested(row.requested_lines_json).lines,
    requestedPaymentMethod: parseRequested(row.requested_lines_json).paymentMethod,
    replacementSubjectId: row.replacement_subject_id || null,
    hppReplayStatus: row.hpp_replay_status || '',
    hppReplayDetail: row.hpp_replay_detail || ''
  };
}

async function getPermit(db, id) {
  const row = await db.prepare(`
    SELECT p.*, c.employee_name AS cashier_name
    FROM approval_permits p
    JOIN cashiers c ON c.id = p.cashier_id
    WHERE p.id = ?
    LIMIT 1
  `).bind(id).first();
  return row ? permitDto(row) : null;
}

async function listPermits(db, { storeId = null, cashierId = null, drawerId = null, status = null, limit = 200 } = {}) {
  const conditions = [`p.permit_type = 'TRANSACTION_VOID'`];
  const values = [];
  if (storeId) { conditions.push('p.store_id = ?'); values.push(storeId); }
  if (cashierId) { conditions.push('p.cashier_id = ?'); values.push(cashierId); }
  if (drawerId) { conditions.push('p.drawer_session_id = ?'); values.push(drawerId); }
  if (status) { conditions.push('p.approval_status = ?'); values.push(status); }
  values.push(Math.max(1, Math.min(500, Number(limit) || 200)));
  const rows = await db.prepare(`
    SELECT p.*, c.employee_name AS cashier_name
    FROM approval_permits p
    JOIN cashiers c ON c.id = p.cashier_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.requested_at DESC, p.id DESC
    LIMIT ?
  `).bind(...values).all();
  return (rows.results || []).map(permitDto);
}

async function transactionSubject(db, storeId, drawerId, cashierId, subjectType, subjectId) {
  if (subjectType === 'SALE') {
    const row = await db.prepare(`
      SELECT id, customer_name, total_amount, payment_method, note, created_at, order_id,
             (SELECT COALESCE(SUM(sp.amount), 0) FROM sale_payments sp WHERE sp.sale_id = sales.id AND sp.payment_method_code = 'CASH') AS split_cash
      FROM sales
      WHERE id = ? AND store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND voided_at IS NULL
      LIMIT 1
    `).bind(subjectId, storeId, drawerId, cashierId).first();
    return row ? { subjectType: 'SALE', subjectId: row.id, amount: Number(row.total_amount || 0), description: row.customer_name ? `Penjualan · ${row.customer_name}` : 'Penjualan', paymentMethod: row.payment_method || 'CASH', note: row.note || '', orderId: row.order_id || null, createdAt: row.created_at,
      // Pembayaran campuran: bagian tunai yang akan keluar dari laci bila penjualan dibatalkan.
      ...(row.payment_method === 'CAMPURAN' ? { cashAmount: Number(row.split_cash || 0) } : {}) } : null;
  }
  if (subjectType === 'PURCHASE') {
    const row = await db.prepare(`
      SELECT id, description, total_amount, payment_method, note, supplier_id, created_at, deposit_id
      FROM purchases
      WHERE id = ? AND store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND voided_at IS NULL
      LIMIT 1
    `).bind(subjectId, storeId, drawerId, cashierId).first();
    if (!row) return null;
    const items = await db.prepare(`
      SELECT pi.product_id, pi.product_name, pi.quantity, pi.unit_symbol, pi.line_total, COALESCE(b.quantity, 0) AS current_stock
      FROM purchase_items pi
      LEFT JOIN inventory_stock_balances b ON b.store_id = pi.store_id AND b.product_id = pi.product_id
      WHERE pi.purchase_id = ? AND pi.store_id = ? ORDER BY pi.product_id
    `).bind(row.id, storeId).all();
    return {
      subjectType: 'PURCHASE', subjectId: row.id, amount: Number(row.total_amount || 0), description: row.description || 'Pembelian Bahan', paymentMethod: row.payment_method || 'CASH', note: row.note || '', supplierId: row.supplier_id || null, createdAt: row.created_at,
      depositId: row.deposit_id || null,
      items: (items.results || []).map(item => ({ productId: Number(item.product_id), productName: item.product_name, quantity: Number(item.quantity), unitSymbol: item.unit_symbol, lineTotal: Number(item.line_total), currentStock: Number(item.current_stock) }))
    };
  }
  if (subjectType === 'EXPENSE') {
    const row = await db.prepare(`
      SELECT id, description, amount, quantity, payment_method, created_at
      FROM expenses
      WHERE id = ? AND store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND voided_at IS NULL
      LIMIT 1
    `).bind(subjectId, storeId, drawerId, cashierId).first();
    return row ? { subjectType: 'EXPENSE', subjectId: row.id, amount: Number(row.amount || 0), description: row.description || 'Pengeluaran Operasional', quantity: row.quantity || '1', paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at } : null;
  }
  return null;
}

async function listCandidates(db, storeId, drawerId, cashierId) {
  const [sales, purchases, expenses, permits] = await Promise.all([
    db.prepare(`SELECT id, customer_name AS description, total_amount AS amount, payment_method, created_at FROM sales WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND voided_at IS NULL ORDER BY created_at DESC LIMIT 80`).bind(storeId, drawerId, cashierId).all(),
    db.prepare(`SELECT id, description, total_amount AS amount, payment_method, created_at FROM purchases WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND voided_at IS NULL ORDER BY created_at DESC LIMIT 80`).bind(storeId, drawerId, cashierId).all(),
    db.prepare(`SELECT id, description, amount, payment_method, created_at FROM expenses WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND voided_at IS NULL ORDER BY created_at DESC LIMIT 80`).bind(storeId, drawerId, cashierId).all(),
    db.prepare(`SELECT subject_type, subject_id, approval_status, execution_status, execution_code, requested_at FROM approval_permits WHERE store_id = ? AND drawer_session_id = ? AND cashier_id = ? AND permit_type = 'TRANSACTION_VOID' ORDER BY requested_at DESC`).bind(storeId, drawerId, cashierId).all()
  ]);
  const latest = new Map();
  for (const row of permits.results || []) {
    const key = `${row.subject_type}:${row.subject_id}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  const rows = [
    ...(sales.results || []).map(row => ({ subjectType: 'SALE', subjectId: row.id, description: row.description ? `Penjualan · ${row.description}` : 'Penjualan', amount: Number(row.amount || 0), paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at })),
    ...(purchases.results || []).map(row => ({ subjectType: 'PURCHASE', subjectId: row.id, description: row.description || 'Pembelian Bahan', amount: Number(row.amount || 0), paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at })),
    ...(expenses.results || []).map(row => ({ subjectType: 'EXPENSE', subjectId: row.id, description: row.description || 'Pengeluaran Operasional', amount: Number(row.amount || 0), paymentMethod: row.payment_method || 'CASH', createdAt: row.created_at }))
  ];
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 150).map(row => {
    const permit = latest.get(`${row.subjectType}:${row.subjectId}`);
    return { ...row, permit: permit ? { approvalStatus: permit.approval_status, executionStatus: permit.execution_status, executionCode: permit.execution_code || '', requestedAt: permit.requested_at } : null };
  });
}

async function existingOpenPermit(db, storeId, subjectType, subjectId) {
  return db.prepare(`
    SELECT id, approval_status, execution_status
    FROM approval_permits
    WHERE store_id = ? AND permit_type = 'TRANSACTION_VOID'
      AND subject_type = ? AND subject_id = ?
      AND (approval_status = 'pending_approval' OR (approval_status = 'approved' AND execution_status <> 'EXECUTED'))
    ORDER BY requested_at DESC
    LIMIT 1
  `).bind(storeId, subjectType, subjectId).first();
}

async function amountCorrectionEnabled(db, storeId) {
  const store = await resolveStore(db, storeId);
  return getTenantPolicySetting(db, store?.tenantId || null, KOREKSI_NOMINAL_PEMBELIAN_KEY);
}

// Ganti nominal pembelian (Bos Cyo, 2026-10-21): barang & qty tetap, CS mengisi total benar di nota
// per baris. Deposit/Hutang belum didukung (pembaliknya menyentuh catatan lain) -> pakai hapus.
// Cara bayar yang boleh dipakai pembelian pengganti: aktif, bukan Hutang (pembalik hutang belum didukung).
async function replacementPaymentMethods(db, storeId) {
  const rows = await db.prepare(`
    SELECT code, name FROM payment_methods WHERE store_id = ? AND is_active = 1 AND COALESCE(creates_payable, 0) = 0 ORDER BY name
  `).bind(storeId).all();
  return (rows.results || []).map(row => ({ code: row.code, name: row.name }));
}

// Pembelian pengganti (Bos Cyo, 2026-10-21/22): barang tetap, CS mengisi qty yang didapat, total di nota,
// dan cara bayar yang benar. Wajib bila stok bahannya sudah terpakai (hapus saja akan membuat stok minus):
// "sistem baca stok uda berkurang maka dia harus sambil input yang benernya". Deposit/Hutang belum didukung.
async function checkAmountCorrection(db, storeId, subject, rawLines, rawPaymentMethod) {
  if (subject.subjectType !== 'PURCHASE') return { ok: false, error: 'Ganti hanya untuk pembelian bahan.' };
  if (!await amountCorrectionEnabled(db, storeId)) return { ok: false, error: 'Ganti pembelian tidak aktif untuk tenant ini; ajukan hapus.', code: 'AMOUNT_CORRECTION_DISABLED' };
  if (subject.depositId) return { ok: false, error: 'Pembelian dari Deposit belum bisa diganti; hubungi Admin.', code: 'AMOUNT_CORRECTION_UNSUPPORTED' };
  const method = await db.prepare('SELECT creates_payable FROM payment_methods WHERE store_id = ? AND code = ? LIMIT 1').bind(storeId, subject.paymentMethod).first();
  if (method?.creates_payable) return { ok: false, error: 'Pembelian Hutang belum bisa diganti; hubungi Admin.', code: 'AMOUNT_CORRECTION_UNSUPPORTED' };
  const paymentMethod = text(rawPaymentMethod || subject.paymentMethod, 40).toUpperCase();
  if (!(await replacementPaymentMethods(db, storeId)).some(row => row.code === paymentMethod)) {
    return { ok: false, error: 'Cara bayar pengganti tidak aktif / tidak boleh dipakai (Hutang belum didukung).', code: 'PAYMENT_METHOD_NOT_AVAILABLE' };
  }
  const byProduct = new Map((Array.isArray(rawLines) ? rawLines : []).map(line => [Number(line?.productId), line]));
  const items = subject.items || [];
  if (!items.length || byProduct.size !== items.length) return { ok: false, error: 'Isi qty dan total benar untuk setiap barang di pembelian ini.' };
  const ranges = await loadPurchasePriceRanges(db, storeId);
  const lines = [];
  let changed = paymentMethod !== subject.paymentMethod;
  for (const item of items) {
    const raw = byProduct.get(item.productId);
    const lineTotal = Number(raw?.lineTotal);
    const quantity = raw?.quantity == null || raw?.quantity === '' ? item.quantity : Number(raw.quantity);
    if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) return { ok: false, error: `Total benar ${item.productName} wajib angka rupiah lebih dari 0.` };
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return { ok: false, error: `Qty benar ${item.productName} wajib bilangan bulat lebih dari 0.` };
    // Rentang harga beli wajar ikut berlaku, sama seperti input pembelian baru.
    const violation = purchaseRangeViolation({ ...item, quantity, unitCostScaled: scaledUnitCost(lineTotal, quantity), lineTotal }, ranges.get(item.productId));
    if (violation) return { ok: false, error: violation, code: 'PURCHASE_PRICE_OUT_OF_RANGE' };
    if (lineTotal !== item.lineTotal || quantity !== item.quantity) changed = true;
    lines.push({ productId: item.productId, quantity, lineTotal });
  }
  if (!changed) return { ok: false, error: 'Isinya sama dengan yang tercatat; tidak ada yang perlu diganti.' };
  // Stok harus cukup untuk membalik pembelian lama SESUDAH pembelian pengganti masuk.
  for (const item of items) {
    const line = lines.find(row => row.productId === item.productId);
    if (Number(item.currentStock || 0) + line.quantity < item.quantity) {
      return { ok: false, error: `Stok ${item.productName} tinggal ${item.currentStock}; sesudah pembelian pengganti ${line.quantity} pun masih kurang untuk membalik ${item.quantity}. Hubungi Admin.`, code: 'STOCK_SHORT' };
    }
  }
  return { ok: true, lines, paymentMethod };
}

// H menyatukan pekerjaan Owner dan Admin Entity. Pada skin ini saja, saklar
// Auto Permit gerai juga mencakup permit hapus transaksi. Eksekusinya tetap
// memakai executor correction canonical di bawah (termasuk HOLD dan retry),
// jadi tidak ada jalur pembalik stok/kas/jurnal kedua yang bisa menyimpang.
async function autoVoidDecision(db, auth) {
  const store = await resolveStore(db, auth.cashier.store.id);
  if (!store?.tenantId || await getTenantPolicyChoice(db, store.tenantId, UI_SKIN_KEY) !== 'H') return null;

  if (auth.cashier.officeActor) {
    return {
      store,
      approverRole: auth.cashier.officeActor.role,
      approverId: auth.cashier.officeActor.id,
      note: 'Tindakan langsung pemilik Kantor'
    };
  }

  const settings = await db.prepare(`
    SELECT auto_permit_enabled, enabled_by_id
    FROM store_approval_settings
    WHERE store_id = ?
  `).bind(store.id).first();
  if (!settings?.auto_permit_enabled) return null;
  return {
    store,
    approverRole: 'AUTO_PERMIT',
    approverId: settings.enabled_by_id || '',
    note: 'Auto Permit Skin H'
  };
}

async function handleCashier(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/transaction-void')) return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const drawer = await requireDrawerOwner(env.DB, auth.cashier);
  if (!drawer.ok) return drawer.response;

  if (request.method === 'GET' && pathname === '/api/cashier/transaction-void/candidates') {
    return json({ contract: TRANSACTION_VOID_PERMIT_CONTRACT, candidates: await listCandidates(env.DB, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id) });
  }
  if (request.method === 'GET' && pathname === '/api/cashier/transaction-void/permits') {
    return json({ permits: await listPermits(env.DB, { storeId: auth.cashier.store.id, cashierId: auth.cashier.id }) });
  }
  // Isi transaksi untuk dialog hapus / ganti nominal (barang, qty, nominal per baris) dan apakah
  // tenant mengaktifkan ganti nominal pembelian.
  if (request.method === 'GET' && pathname === '/api/cashier/transaction-void/subject') {
    const url = new URL(request.url);
    const subjectType = text(url.searchParams.get('type'), 20).toUpperCase();
    const subject = SUBJECT_TYPES.has(subjectType)
      ? await transactionSubject(env.DB, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id, subjectType, text(url.searchParams.get('id'), 180))
      : null;
    if (!subject) return json({ error: 'Transaksi aktif tidak ditemukan pada laci milik kasir ini.' }, 404);
    const stockShort = subjectType === 'PURCHASE' && (subject.items || []).some(item => item.currentStock < item.quantity);
    return json({
      subject,
      amountCorrectionEnabled: subjectType === 'PURCHASE' && await amountCorrectionEnabled(env.DB, auth.cashier.store.id),
      stockShort,
      paymentMethods: subjectType === 'PURCHASE' ? await replacementPaymentMethods(env.DB, auth.cashier.store.id) : []
    });
  }
  if (request.method === 'POST' && pathname === '/api/cashier/transaction-void/permits') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload permit hapus tidak valid.' }, 400);
    const subjectType = text(body.value?.subjectType, 20).toUpperCase();
    const subjectId = text(body.value?.subjectId, 180);
    const reason = text(body.value?.reason, 500);
    const correctionKind = text(body.value?.correctionKind || 'VOID', 10).toUpperCase();
    if (!SUBJECT_TYPES.has(subjectType) || !subjectId || !reason || !CORRECTION_KINDS.has(correctionKind)) return json({ error: 'Jenis transaksi, ID transaksi, dan alasan wajib valid.' }, 400);
    const subject = await transactionSubject(env.DB, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id, subjectType, subjectId);
    if (!subject) return json({ error: 'Transaksi aktif tidak ditemukan pada laci milik kasir ini.' }, 404);
    const existing = await existingOpenPermit(env.DB, auth.cashier.store.id, subjectType, subjectId);
    if (existing) return json({ error: existing.approval_status === 'pending_approval' ? 'Permit hapus transaksi ini masih menunggu Admin.' : 'Permit sudah di-ACC tetapi eksekusi correction belum selesai.', code: 'VOID_PERMIT_ALREADY_OPEN' }, 409);
    let requested = null;
    if (correctionKind === 'AMOUNT') {
      const checked = await checkAmountCorrection(env.DB, auth.cashier.store.id, subject, body.value?.lines, body.value?.paymentMethod);
      if (!checked.ok) return json({ error: checked.error, code: checked.code || 'AMOUNT_CORRECTION_INVALID' }, 400);
      requested = { lines: checked.lines, paymentMethod: checked.paymentMethod };
    } else if (subjectType === 'PURCHASE') {
      const short = (subject.items || []).filter(item => item.currentStock < item.quantity);
      if (short.length) {
        const daftar = short.map(item => `${item.productName} tinggal ${item.currentStock} (dibeli ${item.quantity})`).join(', ');
        return json({
          error: `Stok ${daftar}: bahannya sudah terpakai, jadi pembelian ini tidak bisa dihapus begitu saja. Pilih "Ganti dengan pembelian yang benar" lalu isi qty, total nota, dan cara bayar yang benar.`,
          code: 'STOCK_SHORT_NEED_REPLACEMENT'
        }, 400);
      }
    }
    const id = `permit_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO approval_permits (
        id, store_id, drawer_session_id, cashier_id, permit_type,
        subject_type, subject_id, subject_snapshot_json, reason,
        approval_status, execution_status, requested_at, updated_at,
        correction_kind, requested_lines_json
      ) VALUES (?, ?, ?, ?, 'TRANSACTION_VOID', ?, ?, ?, ?, 'pending_approval', 'NOT_ATTEMPTED', ?, ?, ?, ?)
    `).bind(id, auth.cashier.store.id, drawer.drawer.id, auth.cashier.id, subjectType, subjectId, JSON.stringify(subject), reason, now, now,
      correctionKind, requested ? JSON.stringify(requested) : '').run();
    const automatic = await autoVoidDecision(env.DB, auth);
    if (!automatic) return json({ ok: true, permit: await getPermit(env.DB, id), autoPermit: false }, 201);

    // Klaim dengan predicate status yang sama seperti keputusan manual. Ini
    // mencegah double execution jika dua request identik tiba bersamaan.
    const claimed = await env.DB.prepare(`
      UPDATE approval_permits
      SET approval_status = 'approved', decision_note = ?, approved_by_role = ?,
          approved_by_id = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND approval_status = 'pending_approval'
    `).bind(automatic.note, automatic.approverRole, automatic.approverId, now, now, id).run();
    if (!claimed.success || Number(claimed.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Permit sudah diputuskan request lain.' }, 409);
    }
    const approved = await getPermit(env.DB, id);
    const result = await runCorrectionAndFinalize(
      env,
      { store: automatic.store },
      approved,
      automatic.approverRole,
      automatic.approverId,
      now
    );
    return json({ ...result, autoPermit: true }, 201);
  }
  const cancelMatch = pathname.match(/^\/api\/cashier\/transaction-void\/permits\/([^/]+)$/);
  if (request.method === 'DELETE' && cancelMatch) {
    const id = decodeURIComponent(cancelMatch[1]);
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`
      UPDATE approval_permits
      SET approval_status = 'rejected', decision_note = 'Dibatalkan sendiri oleh kasir/CS', approved_by_role = 'CASHIER_SELF', approved_by_id = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND store_id = ? AND cashier_id = ? AND approval_status = 'pending_approval'
    `).bind(auth.cashier.id, now, now, id, auth.cashier.store.id, auth.cashier.id).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Permit tidak ditemukan, bukan milik kasir ini, atau sudah diputuskan Admin.' }, 409);
    return json({ ok: true, permit: await getPermit(env.DB, id) });
  }
  return json({ error: 'Route permit transaksi kasir tidak ditemukan.' }, 404);
}

export async function managementScope(request, env) {
  const auth = await requireManagement(request, env.DB, env);
  if (!auth.ok) return auth;
  if (auth.authType === 'LEGACY_PIN') return { ok: false, response: json({ error: 'Permit transaksi membutuhkan akun Admin Gerai atau Owner.', code: 'ACCOUNT_APPROVAL_REQUIRED' }, 403) };
  if (auth.admin) return { ...auth, storeId: auth.admin.store.id, store: auth.admin.store };
  const storeToken = text(new URL(request.url).searchParams.get('store'), 80);
  if (!storeToken) return { ...auth, storeId: null, store: null };
  const store = await resolveStore(env.DB, storeToken, { includeInactive: true });
  if (!store) return { ok: false, response: json({ error: 'Gerai permit tidak ditemukan.' }, 404) };
  return { ...auth, storeId: store.id, store };
}

async function runCorrectionAndFinalize(env, scope, approved, approverRole, approverId, now) {
  const executed = await executeTransactionCorrection(env.DB, scope.store, approved, { role: approverRole, id: approverId }, now);

  if (!executed.ok) {
    await env.DB.prepare(`
      UPDATE approval_permits
      SET execution_status = ?, execution_code = ?, execution_detail = ?, updated_at = ?
      WHERE id = ?
    `).bind(executed.status === 'HOLD' ? 'HOLD' : 'FAILED', executed.code || 'CORRECTION_EXECUTION_FAILED', executed.detail || 'Eksekusi correction gagal.', now, approved.id).run();
    return { ok: true, permit: await getPermit(env.DB, approved.id), executed: false, executionHold: executed.status === 'HOLD', message: executed.detail };
  }

  const accounting = executed.accounting || { accountingStatus: 'NOT_REQUIRED' };
  const executionCode = accounting.ok === false ? (accounting.code || 'ACCOUNTING_REVERSAL_FAILED') : '';
  const baseDetail = accounting.ok === false ? (accounting.error || 'Operational correction selesai, tetapi jurnal pembalik belum berhasil.') : (accounting.detail || 'Correction selesai.');
  const executionDetail = `${baseDetail} · Accounting: ${accounting.accountingStatus || 'NOT_REQUIRED'}${accounting.reversalJournalId ? ` (jurnal pembalik ${accounting.reversalJournalId})` : ''}`;
  // Production D1 approval_permits tidak punya kolom accounting_status /
  // original_journal_id / reversal_journal_id (schema drift: migration 0027
  // tercatat applied, kolomnya tidak ada -- dicek 2026-09-24 lewat
  // pragma_table_info). Menulis ke kolom itu membuat SETIAP eksekusi yang
  // berhasil gagal di langkah finalisasi (0 permit pernah EXECUTED). Status
  // Accounting dicatat di execution_detail; jurnal pembaliknya sendiri tetap
  // bisa ditelusuri lewat idempotency key LEKER_POS_VOID:<permitId>.
  const extras = [
    executed.replacementId ? `Pembelian pengganti ${executed.replacementId} (Rp${Number(executed.replacementTotal || 0).toLocaleString('id-ID')}) dibuat sesuai qty, total, dan cara bayar yang diajukan.` : '',
    executed.hppMenunggu ? `HPP ${(executed.itemNames || []).join(', ')} dihitung ulang otomatis di jam sepi (23.00–07.00 WIB); uang laci, stok, dan jurnal sudah beres sekarang.` : ''
  ].filter(Boolean).join(' ');
  await env.DB.prepare(`
    UPDATE approval_permits
    SET execution_status = 'EXECUTED', execution_code = ?, execution_detail = ?,
        executed_at = ?, updated_at = ?, replacement_subject_id = ?, hpp_replay_status = ?
    WHERE id = ?
  `).bind(executionCode, `${executionDetail}${extras ? ` · ${extras}` : ''}`, now, now,
    executed.replacementId || null, executed.hppMenunggu ? STATUS_MENUNGGU : '', approved.id).run();

  return { ok: true, permit: await getPermit(env.DB, approved.id), executed: true, accounting, hppMenunggu: Boolean(executed.hppMenunggu) };
}

// Putar Ulang HPP untuk izin pembelian yang HPP-nya menunggu (src/hpp-putar-ulang.js). Pratinjau boleh
// kapan saja; menerapkan hanya di jam sepi -- dipakai layar Admin dan alat Una.
async function handlePutarUlang(request, env, pathname, scope) {
  if (request.method === 'GET' && pathname === '/api/management/transaction-void-permits/hpp-putar-ulang') {
    const rows = await daftarIzinMenunggu(env.DB, { storeId: scope.storeId, limit: 20 });
    const items = [];
    for (const row of rows) {
      const permit = await getPermit(env.DB, row.id);
      const pratinjau = await pratinjauPutarUlangIzin(env.DB, izinDariBaris(row));
      items.push({ permit, pratinjau });
    }
    return json({ jamSepi: dalamJamSepi(), pesanJam: PESAN_DI_LUAR_JAM_SEPI, items });
  }
  const match = pathname.match(/^\/api\/management\/transaction-void-permits\/([^/]+)\/hpp-putar-ulang$/);
  if (request.method === 'POST' && match) {
    const row = await env.DB.prepare(`
      SELECT id, store_id, subject_id, replacement_subject_id, hpp_replay_status FROM approval_permits WHERE id = ? LIMIT 1
    `).bind(decodeURIComponent(match[1])).first();
    if (!row) return json({ error: 'Permit tidak ditemukan.' }, 404);
    if (scope.storeId && row.store_id !== scope.storeId) return json({ error: 'Permit di luar scope gerai akun ini.' }, 403);
    const hasil = await terapkanPutarUlangIzin(env.DB, izinDariBaris(row));
    if (hasil.diLuarJam) return json({ error: hasil.alasan, code: 'DI_LUAR_JAM_SEPI' }, 423);
    if (!hasil.ok) return json({ error: hasil.alasan, code: hasil.tertahan ? 'PUTAR_ULANG_TERTAHAN' : 'PUTAR_ULANG_GAGAL' }, 409);
    return json({ ok: true, bahan: hasil.bahan, detail: hasil.detail, permit: await getPermit(env.DB, row.id) });
  }
  return null;
}

async function handleManagement(request, env, pathname) {
  if (!pathname.startsWith('/api/management/transaction-void-permits')) return null;
  const scope = await managementScope(request, env);
  if (!scope.ok) return scope.response;
  if (pathname.includes('/hpp-putar-ulang')) {
    const putarUlang = await handlePutarUlang(request, env, pathname, scope);
    if (putarUlang) return putarUlang;
  }

  if (request.method === 'GET' && pathname === '/api/management/transaction-void-permits') {
    const rawStatus = text(new URL(request.url).searchParams.get('status'), 40) || 'pending_approval';
    const status = rawStatus === 'all' ? null : rawStatus;
    if (status && !APPROVAL_STATUSES.has(status)) return json({ error: 'Filter permit tidak valid.' }, 400);
    const permits = await listPermits(env.DB, { storeId: scope.storeId, status, limit: 300 });
    return json({
      contract: TRANSACTION_VOID_PERMIT_CONTRACT,
      permits,
      summary: {
        total: permits.length,
        pending: permits.filter(item => item.approvalStatus === 'pending_approval').length,
        approved: permits.filter(item => item.approvalStatus === 'approved').length,
        rejected: permits.filter(item => item.approvalStatus === 'rejected').length,
        executionHold: permits.filter(item => item.executionStatus === 'HOLD').length,
        executed: permits.filter(item => item.executionStatus === 'EXECUTED').length
      }
    });
  }

  const match = pathname.match(/^\/api\/management\/transaction-void-permits\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const current = await getPermit(env.DB, decodeURIComponent(match[1]));
    if (!current) return json({ error: 'Permit tidak ditemukan.' }, 404);
    if (scope.storeId && current.storeId !== scope.storeId) return json({ error: 'Permit di luar scope gerai akun ini.' }, 403);
    if (!scope.store || current.storeId !== scope.store.id) return json({ error: 'Gerai permit belum dipilih.' }, 400);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload keputusan permit tidak valid.' }, 400);
    const decision = text(body.value?.decision, 20).toUpperCase();
    const note = text(body.value?.note, 500);
    if (!['ACC', 'REJECT', 'RETRY_EXECUTION'].includes(decision)) return json({ error: 'Decision wajib ACC, REJECT, atau RETRY_EXECUTION.' }, 400);

    const now = new Date().toISOString();
    const approverRole = scope.owner ? 'OWNER' : scope.entityAdmin ? 'ENTITY_ADMIN' : 'ADMIN';
    const approverId = scope.owner?.id || scope.entityAdmin?.id || scope.admin?.id || '';

    // A client disconnect between the ACC write below and the finalize write
    // in runCorrectionAndFinalize() can leave a permit stuck at
    // approved/NOT_ATTEMPTED forever -- the operational correction and the
    // Accounting reversal are both self-idempotent (voided_at guard,
    // idempotency_key), so Admin can safely re-run the same execution step
    // without re-deciding or double-applying anything.
    if (decision === 'RETRY_EXECUTION') {
      if (current.approvalStatus !== 'approved' || current.executionStatus === 'EXECUTED') {
        return json({ error: 'Retry eksekusi hanya berlaku untuk permit yang sudah ACC tetapi eksekusinya belum selesai.' }, 409);
      }
      return json(await runCorrectionAndFinalize(env, scope, current, approverRole, approverId, now));
    }

    if (current.approvalStatus !== 'pending_approval') return json({ error: 'Permit ini sudah memiliki keputusan.' }, 409);

    if (decision === 'REJECT') {
      const result = await env.DB.prepare(`
        UPDATE approval_permits
        SET approval_status = 'rejected', decision_note = ?, approved_by_role = ?, approved_by_id = ?, decided_at = ?, updated_at = ?
        WHERE id = ? AND approval_status = 'pending_approval'
      `).bind(note, approverRole, approverId, now, now, current.id).run();
      if (!result.success || Number(result.meta?.changes ?? 0) !== 1) return json({ error: 'Permit sudah diputuskan request lain.' }, 409);
      return json({ ok: true, permit: await getPermit(env.DB, current.id), executed: false });
    }

    const claimed = await env.DB.prepare(`
      UPDATE approval_permits
      SET approval_status = 'approved', decision_note = ?, approved_by_role = ?, approved_by_id = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND approval_status = 'pending_approval'
    `).bind(note, approverRole, approverId, now, now, current.id).run();
    if (!claimed.success || Number(claimed.meta?.changes ?? 0) !== 1) return json({ error: 'Permit sudah diputuskan request lain.' }, 409);

    const approved = await getPermit(env.DB, current.id);
    return json(await runCorrectionAndFinalize(env, scope, approved, approverRole, approverId, now));
  }

  return json({ error: 'Route permit management tidak ditemukan.' }, 404);
}

export async function handleTransactionVoidPermitApi(request, env, pathname) {
  const cashier = await handleCashier(request, env, pathname);
  if (cashier) return cashier;
  return handleManagement(request, env, pathname);
}

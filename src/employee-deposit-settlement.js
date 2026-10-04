import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { newId } from './ikan-ids.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';
import { rupiahToScaled, scaledToRupiah } from './ikan-money.js';
import {
  postEmployeeDepositRecognitionJournal,
  postEmployeeDepositSettlementJournal,
} from './accounting-employee-deposit-bridge.js';
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
//
// 2026-10-04, Bos Cyo: "bisa mengurangi piutang cs dengan cara cs itu transfer kirim
// poto bukti, habis itu kalo admin acc baru berkurang, yang ini ga boleh auto acc harus
// klik dari admin. historinya di portal cs harusnya bisa diliat di riwayat setoran.
// panel admin pun punya sendiri untuk ngecek dan validasi itu." Maka:
//   - kiriman setoran WAJIB foto bukti transfer (multipart, migration 0136), keterangan
//     teks opsional;
//   - selalu pending_approval sampai Admin klik ACC (tidak ada Auto Permit di sini);
//   - Portal Staf: riwayat setoran + foto; Admin: tab Setoran CS (antrean, sisa piutang
//     per CS, riwayat) lewat /api/admin/employee-deposits/overview.

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

// Pemegang setoran: karyawan yang akun kasirnya tertaut (Master Karyawan). Kalau
// akun kasir belum ditautkan ke siapa pun, setoran TETAP dicatat sebagai piutang
// atas nama akun kasir itu (Bos Cyo, 2026-10-03: "selama CS belum setorin uang itu
// piutangnya terus nambah") -- sebelumnya dilewati diam-diam, sehingga di produksi
// 38 dari 40 akun kasir tidak pernah menimbulkan piutang. Penanda `cashier:<id>`
// dipakai sebagai counterparty_id supaya daftar milik akun itu tetap bisa dicari.
async function currentAccountHolder(db, storeId, cashierId) {
  const linked = await db.prepare(`
    SELECT l.employee_id, l.entity_id, e.full_name
    FROM employee_account_links l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.account_type = 'CASHIER' AND l.account_id = ? AND l.store_id = ? AND l.effective_to IS NULL
    LIMIT 1
  `).bind(cashierId, storeId).first();
  if (linked) return linked;
  const account = await db.prepare(`
    SELECT c.employee_name, c.username, s.entity_id
    FROM cashiers c JOIN stores s ON s.id = c.store_id
    WHERE c.id = ? AND c.store_id = ? LIMIT 1
  `).bind(cashierId, storeId).first();
  if (!account?.entity_id) return null;
  return {
    employee_id: `cashier:${cashierId}`,
    entity_id: account.entity_id,
    full_name: text(account.employee_name || account.username || 'Kasir', 120)
  };
}

async function accountingStore(db, storeId) {
  const store = await db.prepare(`
    SELECT id, edition FROM stores WHERE id = ? LIMIT 1
  `).bind(storeId).first();
  if (!store) {
    const error = new Error('STORE_NOT_FOUND');
    error.code = 'STORE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  return store;
}

function accountingFailure(error, fallbackCode) {
  return {
    ok: false,
    status: Number(error?.status || 503),
    code: error?.code || fallbackCode,
    error: error?.error || error?.message || 'Jurnal Accounting gagal diproses.'
  };
}

// Dipanggil dari src/cashier-drawer.js tepat setelah tutup laci sukses dengan
// depositAmount > 0. Kalau akun kasir itu belum ditautkan ke karyawan mana pun
// (Master Karyawan belum dipakai di gerai ini), sengaja TIDAK membuat piutang
// apa pun -- daripada menebak siapa yang harus ditagih.
export async function createEmployeeDepositReceivable(db, { storeId, cashierId, drawerSessionId, amountRupiah, transactionDate }) {
  const holder = await currentAccountHolder(db, storeId, cashierId);
  if (!holder) return null;
  const amountScaled = rupiahToScaled(amountRupiah);
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) {
    const error = new Error('EMPLOYEE_DEPOSIT_AMOUNT_INVALID');
    error.code = 'EMPLOYEE_DEPOSIT_AMOUNT_INVALID';
    error.status = 400;
    throw error;
  }
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
    amountScaled, transactionDate
  ).run();
  const item = await getOperationalReceivablePayable(db, id, { storeId });
  let accounting;
  try {
    accounting = await postEmployeeDepositRecognitionJournal(
      db,
      await accountingStore(db, storeId),
      {
        receivableId: id,
        businessDate: transactionDate,
        amountScaled,
        occurredAt: item.createdAt
      }
    );
  } catch (error) {
    console.error('employee deposit recognition bridge failed after receivable commit', { storeId, receivableId: id, error });
    accounting = accountingFailure(error, 'EMPLOYEE_DEPOSIT_RECOGNITION_POST_FAILED');
  }
  return { ...item, accounting };
}

// Jurnal setoran yang gagal terposting setelah fakta operasionalnya tersimpan
// (pengakuan piutang saat tutup laci, pelunasan saat disetujui) dicoba ulang di
// sini; idempotency key di jembatan menjamin tidak ada jurnal ganda. Dipanggil
// sinkron Akuntansi otomatis -- hanya gerai Akuntansi.
export async function postPendingEmployeeDepositJournals(db, storeId, limit = 25) {
  const store = await accountingStore(db, storeId);
  if (String(store.edition || '').toUpperCase() !== 'ACCOUNTING') return [];
  const results = [];
  const receivables = await db.prepare(`
    SELECT r.id, r.original_amount, r.transaction_date, r.created_at
    FROM operational_receivables_payables r
    WHERE r.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT'
      AND NOT EXISTS (SELECT 1 FROM accounting_journal_headers h WHERE h.store_id = r.store_id AND h.source_system = 'EMPLOYEE_DEPOSIT' AND h.source_reference_id = r.id)
    ORDER BY r.created_at LIMIT ?
  `).bind(storeId, limit).all();
  for (const row of receivables.results ?? []) {
    const posted = await postEmployeeDepositRecognitionJournal(db, store, {
      receivableId: row.id, businessDate: row.transaction_date, amountScaled: Number(row.original_amount), occurredAt: row.created_at
    });
    results.push({ factType: 'SETORAN_PIUTANG', factId: row.id, status: posted.ok ? 'POSTED' : 'FAILED' });
  }
  const payments = await db.prepare(`
    SELECT p.id, p.amount, p.reviewed_at
    FROM operational_receivable_payable_payments p
    JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
    WHERE p.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT' AND p.approval_status = 'approved'
      AND NOT EXISTS (SELECT 1 FROM accounting_journal_headers h WHERE h.store_id = p.store_id AND h.source_system = 'EMPLOYEE_DEPOSIT' AND h.source_reference_id = p.id)
    ORDER BY p.created_at LIMIT ?
  `).bind(storeId, limit).all();
  for (const row of payments.results ?? []) {
    const reviewedAt = row.reviewed_at || new Date().toISOString();
    const posted = await postEmployeeDepositSettlementJournal(db, store, {
      paymentId: row.id, businessDate: reviewedAt.slice(0, 10), amountScaled: Number(row.amount), occurredAt: reviewedAt
    });
    results.push({ factType: 'SETORAN_PELUNASAN', factId: row.id, status: posted.ok ? 'POSTED' : 'FAILED' });
  }
  return results;
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
    createdAt: row.created_at,
    hasPhoto: Boolean(row.has_photo)
  };
}

// Kolom setoran TANPA isi foto: foto (s.d. 800 KB) hanya diambil lewat endpoint fotonya
// sendiri, bukan ikut dimuat setiap kali daftar dibuka.
const KOLOM_SETORAN = `p.id, p.receivable_payable_id, p.amount, p.approval_status, p.proof_reference, p.note,
  p.submitted_by, p.reviewed_by, p.reviewed_at, p.rejection_reason, p.created_at, p.proof_photo IS NOT NULL AS has_photo`;

function photoResponse(row) {
  if (!row || !row.proof_photo) return json({ error: 'Foto bukti setoran tidak ditemukan.' }, 404);
  return new Response(row.proof_photo, {
    headers: { 'Content-Type': row.proof_photo_type || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
  });
}

async function listPaymentsFor(db, receivablePayableId, storeId) {
  const rows = await db.prepare(`
    SELECT ${KOLOM_SETORAN} FROM operational_receivable_payable_payments p
    WHERE p.receivable_payable_id = ? AND p.store_id = ?
    ORDER BY p.created_at DESC
  `).bind(receivablePayableId, storeId).all();
  return (rows.results ?? []).map(mapPayment);
}

async function listPendingDepositPayments(db, storeId) {
  const rows = await db.prepare(`
    SELECT ${KOLOM_SETORAN}, r.counterparty_name_snapshot, r.original_amount, r.transaction_date
    FROM operational_receivable_payable_payments p
    JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
    WHERE p.store_id = ? AND p.approval_status = 'pending_approval' AND r.source_type = 'EMPLOYEE_DEPOSIT'
    ORDER BY p.created_at ASC
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    ...mapPayment(row),
    employeeName: row.counterparty_name_snapshot,
    depositDate: row.transaction_date || null
  }));
}

// Tab Setoran CS di panel Admin: antrean ACC, sisa piutang per CS, dan riwayat keputusan.
async function depositOverview(db, storeId) {
  const [pending, history, balances] = await Promise.all([
    listPendingDepositPayments(db, storeId),
    db.prepare(`
      SELECT ${KOLOM_SETORAN}, r.counterparty_name_snapshot, r.transaction_date
      FROM operational_receivable_payable_payments p
      JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
      WHERE p.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT' AND p.approval_status IN ('approved', 'rejected')
      ORDER BY COALESCE(p.reviewed_at, p.created_at) DESC
      LIMIT 50
    `).bind(storeId).all(),
    db.prepare(`
      SELECT r.counterparty_id, MAX(r.counterparty_name_snapshot) AS name, COUNT(*) AS jumlah,
             SUM(r.original_amount) AS original_amount,
             SUM(COALESCE((SELECT SUM(p.amount) FROM operational_receivable_payable_payments p
                           WHERE p.receivable_payable_id = r.id AND p.store_id = r.store_id AND p.approval_status = 'approved'), 0)) AS paid_amount,
             SUM(COALESCE((SELECT SUM(p.amount) FROM operational_receivable_payable_payments p
                           WHERE p.receivable_payable_id = r.id AND p.store_id = r.store_id AND p.approval_status = 'pending_approval'), 0)) AS pending_amount
      FROM operational_receivables_payables r
      WHERE r.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT'
      GROUP BY r.counterparty_id
      ORDER BY name COLLATE NOCASE
    `).bind(storeId).all()
  ]);
  return {
    pending,
    history: (history.results ?? []).map(row => ({ ...mapPayment(row), employeeName: row.counterparty_name_snapshot, depositDate: row.transaction_date || null })),
    // Saldo boleh negatif (setoran lebih) -- tidak di-abs (invariant #8).
    balances: (balances.results ?? []).map(row => {
      const original = scaledToRupiah(Number(row.original_amount || 0));
      const paid = scaledToRupiah(Number(row.paid_amount || 0));
      return {
        employeeName: row.name,
        receivableCount: Number(row.jumlah || 0),
        originalAmountRupiah: original,
        paidAmountRupiah: paid,
        pendingAmountRupiah: scaledToRupiah(Number(row.pending_amount || 0)),
        balanceRupiah: original - paid
      };
    })
  };
}

async function reviewDepositPayment(db, paymentId, storeId, { action, reviewerId, rejectionReason }) {
  const payment = await db.prepare(`
    SELECT p.id, p.amount, p.approval_status, p.reviewed_at, r.transaction_date, r.source_type
    FROM operational_receivable_payable_payments p
    JOIN operational_receivables_payables r
      ON r.id = p.receivable_payable_id
     AND r.store_id = p.store_id
     AND r.entity_id = p.entity_id
    WHERE p.id = ? AND p.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT'
    LIMIT 1
  `).bind(paymentId, storeId).first();
  if (!payment) return { ok: false, status: 404, error: 'PAYMENT_NOT_FOUND' };
  const retryApprovedPosting = action === 'APPROVE' && payment.approval_status === 'approved';
  if (payment.approval_status !== 'pending_approval' && !retryApprovedPosting) {
    return { ok: false, status: 409, error: 'PAYMENT_ALREADY_REVIEWED' };
  }
  const now = new Date().toISOString();
  if (action === 'APPROVE') {
    let reviewedAt = payment.reviewed_at || now;
    if (!retryApprovedPosting) {
      const update = await db.prepare(`
        UPDATE operational_receivable_payable_payments
        SET approval_status = 'approved', reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND store_id = ? AND approval_status = 'pending_approval'
      `).bind(reviewerId, now, paymentId, storeId).run();
      if (!update.success || Number(update.meta?.changes ?? 0) !== 1) {
        return { ok: false, status: 409, error: 'PAYMENT_ALREADY_REVIEWED' };
      }
      reviewedAt = now;
    }

    let accounting;
    try {
      accounting = await postEmployeeDepositSettlementJournal(
        db,
        await accountingStore(db, storeId),
        {
          paymentId,
          businessDate: reviewedAt.slice(0, 10),
          amountScaled: Number(payment.amount),
          occurredAt: reviewedAt
        }
      );
    } catch (error) {
      console.error('employee deposit settlement bridge failed after payment approval commit', { storeId, paymentId, error });
      accounting = accountingFailure(error, 'EMPLOYEE_DEPOSIT_SETTLEMENT_POST_FAILED');
    }
    if (!accounting.ok) return { ...accounting, paymentCommitted: true };
    return { ok: true, accounting, duplicateReview: retryApprovedPosting };
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

    // Foto bukti setoran milik akun ini sendiri; setoran CS lain tidak bisa diintip lewat tebak id.
    const ownPhotoMatch = pathname.match(/^\/api\/cashier\/employee-deposits\/payments\/([^/]+)\/photo$/);
    if (request.method === 'GET' && ownPhotoMatch) {
      const holder = await currentAccountHolder(db, cashier.store.id, cashier.id);
      if (!holder) return json({ error: 'Foto bukti setoran tidak ditemukan.' }, 404);
      const row = await db.prepare(`
        SELECT p.proof_photo, p.proof_photo_type
        FROM operational_receivable_payable_payments p
        JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
        WHERE p.id = ? AND p.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT' AND r.counterparty_id = ?
        LIMIT 1
      `).bind(decodeURIComponent(ownPhotoMatch[1]), cashier.store.id, holder.employee_id).first();
      return photoResponse(row);
    }

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
      // Bukti = FOTO bukti transfer (wajib). Kiriman lama tanpa foto (JSON) ditolak
      // dengan pesan yang menyuruh memuat ulang halaman.
      if (!isMultipartRequest(request)) {
        return json({ error: 'Bukti setoran sekarang wajib foto bukti transfer. Muat ulang Portal Staf, lalu kirim lagi dengan foto.', code: 'EMPLOYEE_DEPOSIT_PHOTO_REQUIRED' }, 400);
      }
      const form = await request.formData();
      const photo = await readLivePhoto(form, 'photo');
      if (!photo.ok) {
        return json({ error: photo.status === 400 ? 'Foto bukti transfer wajib dilampirkan.' : photo.error, code: 'EMPLOYEE_DEPOSIT_PHOTO_REQUIRED' }, photo.status);
      }
      const keterangan = text(form.get('proofReference'), 300);
      try {
        const result = await addOperationalPayment(db, receivableId, {
          amountRupiah: Number(String(form.get('amountRupiah') ?? '').trim()),
          proofReference: keterangan ? `Foto bukti transfer · ${keterangan}` : 'Foto bukti transfer',
          note: form.get('note'),
          submittedBy: cashier.id,
          proofPhoto: { bytes: photo.bytes, type: photo.type }
        }, { storeId: cashier.store.id });
        return json(result, 201);
      } catch (error) {
        return json({ error: error.code || 'SUBMIT_FAILED' }, error.status || 400);
      }
    }

    return json({ error: 'Route setoran karyawan tidak ditemukan.' }, 404);
  }

  if (pathname.startsWith('/api/admin/employee-deposits/')) {
    const auth = await requireManagement(request, db, env);
    if (!auth.ok) return auth.response;
    const store = await selectedStore(db, request);
    if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
    const actor = actorFrom(auth);

    if (request.method === 'GET' && pathname === '/api/admin/employee-deposits/pending') {
      return json({ store, payments: await listPendingDepositPayments(db, store.id) });
    }

    if (request.method === 'GET' && pathname === '/api/admin/employee-deposits/overview') {
      return json({ store, ...(await depositOverview(db, store.id)) });
    }

    const photoMatch = pathname.match(/^\/api\/admin\/employee-deposits\/payments\/([^/]+)\/photo$/);
    if (request.method === 'GET' && photoMatch) {
      const row = await db.prepare(`
        SELECT p.proof_photo, p.proof_photo_type
        FROM operational_receivable_payable_payments p
        JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
        WHERE p.id = ? AND p.store_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT'
        LIMIT 1
      `).bind(decodeURIComponent(photoMatch[1]), store.id).first();
      return photoResponse(row);
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
      if (!result.ok) {
        return json({
          error: result.error,
          code: result.code || result.error,
          paymentCommitted: Boolean(result.paymentCommitted)
        }, result.status);
      }
      return json({
        ok: true,
        accounting: result.accounting?.skipped
          ? { status: result.accounting.status }
          : {
              status: 'POSTED',
              journalId: result.accounting?.journal?.journalId || null,
              duplicate: Boolean(result.accounting?.duplicate)
            },
        duplicateReview: Boolean(result.duplicateReview)
      });
    }

    return json({ error: 'Route review setoran karyawan tidak ditemukan.' }, 404);
  }

  return null;
}

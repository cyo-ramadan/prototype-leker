import { IKAN_STORE_ID } from './ikan-config.js';
import { newId } from './ikan-ids.js';
import { rupiahToScaled, SCALE } from './ikan-money.js';

export const OPERATIONAL_SOURCE_TYPES = Object.freeze({
  SALE_RECEIVABLE: 'SALE_RECEIVABLE',
  PURCHASE_PAYABLE: 'PURCHASE_PAYABLE',
  COST_PAYABLE: 'COST_PAYABLE',
  EMPLOYEE_DEPOSIT: 'EMPLOYEE_DEPOSIT',
});

const SOURCE_BALANCE_TYPES = Object.freeze({
  [OPERATIONAL_SOURCE_TYPES.SALE_RECEIVABLE]: 'RECEIVABLE',
  [OPERATIONAL_SOURCE_TYPES.PURCHASE_PAYABLE]: 'PAYABLE',
  [OPERATIONAL_SOURCE_TYPES.COST_PAYABLE]: 'PAYABLE',
  [OPERATIONAL_SOURCE_TYPES.EMPLOYEE_DEPOSIT]: 'RECEIVABLE',
});

const API_ROOT = '/api/ikan/operational-receivables-payables';

class OperationalBalanceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'OperationalBalanceError';
    this.code = code;
    this.status = status;
  }
}

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);

function sourceType(value) {
  const normalized = text(value, 40).toUpperCase();
  if (!SOURCE_BALANCE_TYPES[normalized]) {
    throw new OperationalBalanceError('SOURCE_TYPE_INVALID');
  }
  return normalized;
}

function positiveScaledRupiah(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OperationalBalanceError('AMOUNT_RUPIAH_MUST_BE_POSITIVE_INTEGER');
  }
  const scaled = rupiahToScaled(value);
  if (!Number.isSafeInteger(scaled)) {
    throw new OperationalBalanceError('AMOUNT_OUT_OF_RANGE');
  }
  return scaled;
}

function signedScaledToRupiah(value) {
  const scaled = Number(value);
  if (!Number.isSafeInteger(scaled) || scaled % SCALE !== 0) {
    throw new OperationalBalanceError('STORED_AMOUNT_INVALID', 500);
  }
  return scaled / SCALE;
}

async function storeEntity(db, storeId) {
  const row = await db.prepare('SELECT entity_id FROM stores WHERE id = ? LIMIT 1').bind(storeId).first();
  if (!row) throw new OperationalBalanceError('STORE_NOT_FOUND', 404);
  if (!row.entity_id) throw new OperationalBalanceError('STORE_WITHOUT_ENTITY', 409);
  return row.entity_id;
}

async function ikanSourceSnapshot(db, storeId, type, sourceId, input) {
  if (type === OPERATIONAL_SOURCE_TYPES.SALE_RECEIVABLE) {
    const row = await db.prepare(`
      SELECT sale_id AS source_id, contact_id AS counterparty_id,
             customer_name_snapshot AS counterparty_name_snapshot, transaction_date
      FROM ikan_sales
      WHERE sale_id = ? AND store_id = ? AND sale_status <> 'CANCELLED'
      LIMIT 1
    `).bind(sourceId, storeId).first();
    if (!row) throw new OperationalBalanceError('SALE_NOT_FOUND', 404);
    return row;
  }

  if (type === OPERATIONAL_SOURCE_TYPES.PURCHASE_PAYABLE) {
    const row = await db.prepare(`
      SELECT p.purchase_id AS source_id, p.petani_contact_id AS counterparty_id,
             c.contact_name AS counterparty_name_snapshot, p.transaction_date
      FROM ikan_purchases p
      JOIN ikan_contacts c
        ON c.contact_id = p.petani_contact_id AND c.store_id = p.store_id
      WHERE p.purchase_id = ? AND p.store_id = ?
      LIMIT 1
    `).bind(sourceId, storeId).first();
    if (!row) throw new OperationalBalanceError('PURCHASE_NOT_FOUND', 404);
    return row;
  }

  if (type === OPERATIONAL_SOURCE_TYPES.COST_PAYABLE) {
    const sale = await db.prepare(`
      SELECT sale_id AS source_id, transaction_date
      FROM ikan_sales
      WHERE sale_id = ? AND store_id = ? AND sale_status <> 'CANCELLED'
      LIMIT 1
    `).bind(sourceId, storeId).first();
    if (!sale) throw new OperationalBalanceError('SALE_NOT_FOUND', 404);

    const requestedCounterpartyId = text(input.counterpartyId, 180) || null;
    let counterpartyName = text(input.counterpartyName, 200);
    if (requestedCounterpartyId) {
      const contact = await db.prepare(`
        SELECT contact_name FROM ikan_contacts
        WHERE contact_id = ? AND store_id = ? LIMIT 1
      `).bind(requestedCounterpartyId, storeId).first();
      if (!contact) throw new OperationalBalanceError('COUNTERPARTY_NOT_FOUND', 404);
      counterpartyName = contact.contact_name;
    }
    if (!counterpartyName) throw new OperationalBalanceError('COUNTERPARTY_NAME_REQUIRED');
    return {
      ...sale,
      counterparty_id: requestedCounterpartyId,
      counterparty_name_snapshot: counterpartyName,
    };
  }

  // EMPLOYEE_DEPOSIT sengaja belum punya writer publik di task fondasi ini.
  // Task drawer berikutnya yang mengetahui drawer, employee holder, dan actor
  // Finance akan mengisi source_id/counterparty_id tanpa menebak relasinya di sini.
  throw new OperationalBalanceError('EMPLOYEE_DEPOSIT_REQUIRES_APPROVAL_FLOW', 409);
}

function selectRowsSql(extraWhere = '') {
  return `
    SELECT r.*,
           COALESCE(SUM(CASE WHEN p.approval_status = 'approved' THEN p.amount ELSE 0 END), 0) AS paid_amount
    FROM operational_receivables_payables r
    LEFT JOIN operational_receivable_payable_payments p
      ON p.receivable_payable_id = r.id
     AND p.store_id = r.store_id
     AND p.entity_id = r.entity_id
    WHERE r.store_id = ? ${extraWhere}
    GROUP BY r.id
  `;
}

function mapBalanceRow(row) {
  const originalAmountRupiah = signedScaledToRupiah(row.original_amount);
  const paidAmountRupiah = signedScaledToRupiah(row.paid_amount);
  return {
    id: row.id,
    storeId: row.store_id,
    entityId: row.entity_id,
    sourceType: row.source_type,
    balanceType: row.balance_type,
    sourceId: row.source_id,
    counterpartyId: row.counterparty_id || null,
    counterpartyName: row.counterparty_name_snapshot,
    description: row.description,
    originalAmountRupiah,
    paidAmountRupiah,
    balanceRupiah: originalAmountRupiah - paidAmountRupiah,
    transactionDate: row.transaction_date,
    createdAt: row.created_at,
  };
}

export async function getOperationalReceivablePayable(db, id, { storeId = IKAN_STORE_ID } = {}) {
  const row = await db.prepare(`${selectRowsSql('AND r.id = ?')} LIMIT 1`).bind(storeId, id).first();
  return row ? mapBalanceRow(row) : null;
}

export async function listOperationalReceivablesPayables(
  db,
  { storeId = IKAN_STORE_ID, filterSourceType, balanceType, openOnly = false } = {}
) {
  const conditions = [];
  const args = [storeId];
  if (filterSourceType) {
    conditions.push('r.source_type = ?');
    args.push(sourceType(filterSourceType));
  }
  if (balanceType) {
    const normalized = text(balanceType, 20).toUpperCase();
    if (!['RECEIVABLE', 'PAYABLE'].includes(normalized)) {
      throw new OperationalBalanceError('BALANCE_TYPE_INVALID');
    }
    conditions.push('r.balance_type = ?');
    args.push(normalized);
  }
  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
  const result = await db.prepare(`${selectRowsSql(where)} ORDER BY r.transaction_date DESC, r.created_at DESC`).bind(...args).all();
  const rows = (result.results ?? []).map(mapBalanceRow);
  return openOnly ? rows.filter((row) => row.balanceRupiah !== 0) : rows;
}

export async function addOperationalReceivablePayable(
  db,
  input,
  { storeId = IKAN_STORE_ID } = {}
) {
  const type = sourceType(input?.sourceType);
  const sourceId = text(input?.sourceId, 180);
  if (!sourceId) throw new OperationalBalanceError('SOURCE_ID_REQUIRED');
  const amount = positiveScaledRupiah(input?.amountRupiah);
  const entityId = await storeEntity(db, storeId);
  const snapshot = await ikanSourceSnapshot(db, storeId, type, sourceId, input ?? {});
  const id = newId('ORP');
  const description = text(input?.description, 300)
    || (type === OPERATIONAL_SOURCE_TYPES.COST_PAYABLE ? 'Titipan Biaya' : type.replaceAll('_', ' '));

  const statements = [
    db.prepare(`
      INSERT INTO operational_receivables_payables (
        id, store_id, entity_id, source_type, balance_type, source_id,
        counterparty_id, counterparty_name_snapshot, description,
        original_amount, transaction_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      storeId,
      entityId,
      type,
      SOURCE_BALANCE_TYPES[type],
      snapshot.source_id,
      snapshot.counterparty_id ?? null,
      snapshot.counterparty_name_snapshot,
      description,
      amount,
      snapshot.transaction_date
    ),
  ];

  if (type === OPERATIONAL_SOURCE_TYPES.COST_PAYABLE) {
    statements.push(
      db.prepare(`
        UPDATE ikan_sales
        SET total_amount = total_amount + ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE sale_id = ? AND store_id = ?
      `).bind(amount, sourceId, storeId)
    );
  }

  await db.batch(statements);
  return getOperationalReceivablePayable(db, id, { storeId });
}

function mapPayment(row) {
  return {
    id: row.id,
    receivablePayableId: row.receivable_payable_id,
    amountRupiah: signedScaledToRupiah(row.amount),
    approvalStatus: row.approval_status,
    proofReference: row.proof_reference,
    note: row.note,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

export async function addOperationalPayment(
  db,
  id,
  input,
  { storeId = IKAN_STORE_ID } = {}
) {
  const parent = await db.prepare(`
    SELECT * FROM operational_receivables_payables
    WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(id, storeId).first();
  if (!parent) throw new OperationalBalanceError('RECEIVABLE_PAYABLE_NOT_FOUND', 404);

  const amount = positiveScaledRupiah(input?.amountRupiah);
  const isEmployeeDeposit = parent.source_type === OPERATIONAL_SOURCE_TYPES.EMPLOYEE_DEPOSIT;
  const proofReference = text(input?.proofReference, 500);
  if (isEmployeeDeposit && !proofReference) {
    throw new OperationalBalanceError('EMPLOYEE_DEPOSIT_PAYMENT_PROOF_REQUIRED');
  }

  const paymentId = newId('ORPP');
  const approvalStatus = isEmployeeDeposit ? 'pending_approval' : 'approved';
  await db.prepare(`
    INSERT INTO operational_receivable_payable_payments (
      id, receivable_payable_id, store_id, entity_id, amount,
      approval_status, proof_reference, note, submitted_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    paymentId,
    parent.id,
    parent.store_id,
    parent.entity_id,
    amount,
    approvalStatus,
    proofReference,
    text(input?.note, 300),
    text(input?.submittedBy, 180)
  ).run();

  const payment = await db.prepare(`
    SELECT * FROM operational_receivable_payable_payments
    WHERE id = ? AND store_id = ? LIMIT 1
  `).bind(paymentId, storeId).first();
  return {
    payment: mapPayment(payment),
    item: await getOperationalReceivablePayable(db, parent.id, { storeId }),
  };
}

export async function recapOperationalReceivablesPayables(db, { storeId = IKAN_STORE_ID } = {}) {
  const rows = await listOperationalReceivablesPayables(db, { storeId });
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.balanceType}:${row.sourceType}`;
    if (!groups.has(key)) {
      groups.set(key, {
        balanceType: row.balanceType,
        sourceType: row.sourceType,
        count: 0,
        originalAmountRupiah: 0,
        paidAmountRupiah: 0,
        balanceRupiah: 0,
      });
    }
    const group = groups.get(key);
    group.count += 1;
    group.originalAmountRupiah += row.originalAmountRupiah;
    group.paidAmountRupiah += row.paidAmountRupiah;
    group.balanceRupiah += row.balanceRupiah;
  }
  return [...groups.values()].sort((a, b) => (
    a.balanceType.localeCompare(b.balanceType) || a.sourceType.localeCompare(b.sourceType)
  ));
}

function errorResponse(error) {
  if (error instanceof OperationalBalanceError) {
    return Response.json({ error: error.code }, { status: error.status });
  }
  throw error;
}

export async function handleOperationalReceivablesPayablesApi(request, env, pathname = new URL(request.url).pathname) {
  if (pathname !== API_ROOT && !pathname.startsWith(`${API_ROOT}/`)) return null;
  try {
    if (request.method === 'GET' && pathname === `${API_ROOT}/recap`) {
      return Response.json({ items: await recapOperationalReceivablesPayables(env.DB) });
    }

    if (request.method === 'GET' && pathname === API_ROOT) {
      const url = new URL(request.url);
      return Response.json({
        items: await listOperationalReceivablesPayables(env.DB, {
          filterSourceType: url.searchParams.get('sourceType') || undefined,
          balanceType: url.searchParams.get('balanceType') || undefined,
          openOnly: url.searchParams.get('open') === '1',
        }),
      });
    }

    if (request.method === 'POST' && pathname === API_ROOT) {
      const input = await request.json();
      const item = await addOperationalReceivablePayable(env.DB, input);
      return Response.json({ item }, { status: 201 });
    }

    const paymentMatch = pathname.match(/^\/api\/ikan\/operational-receivables-payables\/([^/]+)\/payments$/);
    if (request.method === 'POST' && paymentMatch) {
      const input = await request.json();
      const result = await addOperationalPayment(env.DB, decodeURIComponent(paymentMatch[1]), input);
      return Response.json(result, { status: 201 });
    }

    const detailMatch = pathname.match(/^\/api\/ikan\/operational-receivables-payables\/([^/]+)$/);
    if (request.method === 'GET' && detailMatch) {
      const item = await getOperationalReceivablePayable(env.DB, decodeURIComponent(detailMatch[1]));
      return item
        ? Response.json({ item })
        : Response.json({ error: 'RECEIVABLE_PAYABLE_NOT_FOUND' }, { status: 404 });
    }

    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'INVALID_JSON' }, { status: 400 });
    }
    return errorResponse(error);
  }
}

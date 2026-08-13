export const ACCOUNT_TYPES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
export const JOURNAL_SIDES = Object.freeze(['DEBIT', 'CREDIT']);
export const ACCOUNTING_AMOUNT_SCALE = 1_000_000;
export const SYSTEM_ADJUSTMENT_TOLERANCE_SCALED = 100 * ACCOUNTING_AMOUNT_SCALE;
export const SYSTEM_ADJUSTMENT_POLICY = 'AUTO_EQUITY_UP_TO_100_RUPIAH';

const SYSTEM_ADJUSTMENT_SUBTYPE = 'ROUNDING_ADJUSTMENT';
const MAX_TEXT = 500;
const text = (value, max = MAX_TEXT) => String(value ?? '').trim().slice(0, max);

export function accountNormalSide(accountType) {
  return ['ASSET', 'EXPENSE'].includes(String(accountType || '').toUpperCase()) ? 'DEBIT' : 'CREDIT';
}

export function validateBusinessDate(value) {
  const businessDate = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return businessDate;
}

function safeScaledInteger(value, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  if (allowZero ? number < 0 : number <= 0) return null;
  return number;
}

function wholeRupiahToScaled(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const scaled = amount * ACCOUNTING_AMOUNT_SCALE;
  return Number.isSafeInteger(scaled) ? scaled : null;
}

export function parseRupiahAmountToScaled(value) {
  const raw = String(value ?? '').trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = match[2] || '';
  const kept = fraction.slice(0, 6).padEnd(6, '0');
  let scaled = whole * 1000000n + BigInt(kept || '0');
  if (fraction.length > 6 && Number(fraction[6]) >= 5) scaled += 1n;
  if (scaled <= 0n || scaled > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(scaled);
}

export function scaledAmountToExactString(value) {
  const scaled = safeScaledInteger(value, { allowZero: true });
  if (scaled === null) return null;
  const amount = BigInt(scaled);
  const whole = amount / 1000000n;
  const fraction = String(amount % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function scaledToCompatibilityRupiah(value) {
  const exact = scaledAmountToExactString(value);
  return exact === null ? null : Number(exact);
}

function normalizeJournalAmount(raw) {
  if (raw?.amountScaled !== undefined && raw?.amountScaled !== null && raw?.amountScaled !== '') {
    return safeScaledInteger(raw.amountScaled);
  }
  if (raw?.amountExact !== undefined && raw?.amountExact !== null && raw?.amountExact !== '') {
    return parseRupiahAmountToScaled(raw.amountExact);
  }
  if (raw?.amountMinor !== undefined && raw?.amountMinor !== null && raw?.amountMinor !== '') {
    return wholeRupiahToScaled(raw.amountMinor);
  }
  return null;
}

function safeAdd(current, next) {
  const total = current + next;
  if (!Number.isSafeInteger(total)) throw new Error('ACCOUNTING_AMOUNT_OVERFLOW');
  return total;
}

export function calculateNormalBalance(accountType, debitAmount, creditAmount) {
  const debit = Number(debitAmount || 0);
  const credit = Number(creditAmount || 0);
  return accountNormalSide(accountType) === 'DEBIT' ? debit - credit : credit - debit;
}

export function validateJournalLines(lines, allowedAccountIds = null, options = {}) {
  const maxLines = Number(options.maxLines || 100);
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > maxLines) {
    return { ok: false, code: 'JOURNAL_LINES_INVALID', error: `Jurnal wajib memiliki 2–${maxLines} baris.` };
  }
  let totalDebitScaled = 0;
  let totalCreditScaled = 0;
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || {};
    const accountId = text(raw.accountId, 180);
    const side = text(raw.side, 10).toUpperCase();
    const amountScaled = normalizeJournalAmount(raw);
    if (!accountId || !JOURNAL_SIDES.includes(side) || amountScaled === null) {
      return { ok: false, code: 'JOURNAL_LINE_INVALID', error: `Baris ${index + 1} wajib memiliki akun, sisi, dan nominal positif maksimal 6 desimal.` };
    }
    if (allowedAccountIds && !allowedAccountIds.has(accountId)) {
      return { ok: false, code: 'ACCOUNT_NOT_POSTABLE', error: `Akun pada baris ${index + 1} tidak aktif / tidak tersedia.` };
    }
    if (side === 'DEBIT') totalDebitScaled = safeAdd(totalDebitScaled, amountScaled);
    else totalCreditScaled = safeAdd(totalCreditScaled, amountScaled);
    normalized.push({
      accountId,
      side,
      amountScaled,
      amountExact: scaledAmountToExactString(amountScaled),
      description: text(raw.description, 240),
      isSystemGenerated: Boolean(raw.isSystemGenerated)
    });
  }
  if (totalDebitScaled <= 0) {
    return { ok: false, code: 'EMPTY_JOURNAL', error: 'Nominal jurnal harus lebih dari nol.' };
  }
  if (options.requireBalanced !== false && totalDebitScaled !== totalCreditScaled) {
    return {
      ok: false,
      code: 'UNBALANCED_JOURNAL',
      error: 'Total Debit dan Kredit harus sama.',
      totalDebitScaled,
      totalCreditScaled,
      totalDebitExact: scaledAmountToExactString(totalDebitScaled),
      totalCreditExact: scaledAmountToExactString(totalCreditScaled),
      totalDebitMinor: scaledToCompatibilityRupiah(totalDebitScaled),
      totalCreditMinor: scaledToCompatibilityRupiah(totalCreditScaled)
    };
  }
  return {
    ok: true,
    lines: normalized,
    totalDebitScaled,
    totalCreditScaled,
    totalDebitExact: scaledAmountToExactString(totalDebitScaled),
    totalCreditExact: scaledAmountToExactString(totalCreditScaled),
    totalDebitMinor: scaledToCompatibilityRupiah(totalDebitScaled),
    totalCreditMinor: scaledToCompatibilityRupiah(totalCreditScaled)
  };
}

async function nextSequence(db, storeId, sequenceKey) {
  const row = await db.prepare(`
    INSERT INTO accounting_sequences (store_id, sequence_key, last_value, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(store_id, sequence_key) DO UPDATE SET
      last_value = accounting_sequences.last_value + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING last_value
  `).bind(storeId, sequenceKey).first();
  const value = Number(row?.last_value || 0);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('ACCOUNTING_SEQUENCE_INVALID');
  return value;
}

function sequenceCode(prefix, value) {
  return `${prefix}-${String(value).padStart(6, '0')}`;
}

export async function listAccountingAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, type, subtype, is_active, review_required, created_at, updated_at
    FROM chart_of_accounts
    WHERE store_id = ?
    ORDER BY CASE type
      WHEN 'ASSET' THEN 1 WHEN 'LIABILITY' THEN 2 WHEN 'EQUITY' THEN 3
      WHEN 'REVENUE' THEN 4 WHEN 'EXPENSE' THEN 5 ELSE 9 END,
      code COLLATE NOCASE, name COLLATE NOCASE
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    accountId: row.id,
    accountCode: row.code,
    accountName: row.name,
    accountType: row.type,
    subtype: row.subtype || '',
    normalSide: accountNormalSide(row.type),
    isActive: Boolean(row.is_active),
    reviewRequired: Boolean(row.review_required),
    isSystemManaged: row.subtype === SYSTEM_ADJUSTMENT_SUBTYPE,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

async function activeAccountReferenceCount(db, storeId, accountId) {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM payment_methods WHERE store_id = ? AND account_id = ? AND is_active = 1) +
      (SELECT COUNT(*) FROM item_categories WHERE store_id = ? AND is_active = 1
        AND (inventory_account_id = ? OR cogs_account_id = ? OR revenue_account_id = ?)) +
      (SELECT COUNT(*) FROM journal_rules WHERE store_id = ? AND fixed_account_id = ? AND is_active = 1) AS count
  `).bind(storeId, accountId, storeId, accountId, accountId, accountId, storeId, accountId).first();
  return Number(row?.count || 0);
}

export async function createAccountingAccount(db, store, input) {
  const accountName = text(input?.accountName, 100);
  const accountType = text(input?.accountType, 20).toUpperCase();
  const subtype = text(input?.subtype, 60).toUpperCase();
  if (!accountName || !ACCOUNT_TYPES.includes(accountType)) {
    return { ok: false, status: 400, code: 'ACCOUNT_INPUT_INVALID', error: 'Nama dan tipe akun wajib valid.' };
  }
  if (subtype === SYSTEM_ADJUSTMENT_SUBTYPE) {
    return { ok: false, status: 400, code: 'ACCOUNT_SUBTYPE_RESERVED', error: 'Subtype ROUNDING_ADJUSTMENT dikelola otomatis oleh Accounting.' };
  }
  const sequence = await nextSequence(db, store.id, 'ACCOUNT_CODE');
  const accountCode = sequenceCode('ACC', sequence);
  const accountId = `coa_${store.id}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO chart_of_accounts (
        id, store_id, code, name, type, subtype, is_active, review_required, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(accountId, store.id, accountCode, accountName, accountType, subtype).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return { ok: false, status: 409, code: 'ACCOUNT_CODE_CONFLICT', error: 'Kode akun otomatis bentrok. Silakan ulangi.' };
    }
    throw error;
  }
  return { ok: true, accountId, accountCode };
}

export async function updateAccountingAccount(db, store, accountId, input) {
  const current = await db.prepare(`
    SELECT id, code, name, type, subtype, is_active
    FROM chart_of_accounts
    WHERE id = ? AND store_id = ?
  `).bind(accountId, store.id).first();
  if (!current) return { ok: false, status: 404, code: 'ACCOUNT_NOT_FOUND', error: 'Akun tidak ditemukan.' };
  if (current.subtype === SYSTEM_ADJUSTMENT_SUBTYPE) {
    return { ok: false, status: 409, code: 'SYSTEM_ACCOUNT_IMMUTABLE', error: 'Akun Penyesuaian dikelola otomatis oleh Accounting.' };
  }
  const accountName = text(input?.accountName ?? current.name, 100);
  const subtype = text(input?.subtype ?? current.subtype, 60).toUpperCase();
  const isActive = input?.isActive === undefined ? Boolean(current.is_active) : Boolean(input.isActive);
  if (!accountName || subtype === SYSTEM_ADJUSTMENT_SUBTYPE) {
    return { ok: false, status: 400, code: 'ACCOUNT_INPUT_INVALID', error: 'Nama/subtype akun tidak valid.' };
  }
  if (!isActive && Boolean(current.is_active) && await activeAccountReferenceCount(db, store.id, accountId) > 0) {
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNT_ACTIVE_MAPPING_EXISTS',
      error: 'Akun masih dipakai Setting Akuntansi aktif. Pindahkan/nonaktifkan mapping lebih dulu.'
    };
  }
  await db.prepare(`
    UPDATE chart_of_accounts
    SET name = ?, subtype = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND store_id = ?
  `).bind(accountName, subtype, isActive ? 1 : 0, accountId, store.id).run();
  return { ok: true, accountId, accountCode: current.code, accountType: current.type };
}

async function activeAccountIds(db, storeId) {
  const rows = await db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND is_active = 1`).bind(storeId).all();
  return new Set((rows.results ?? []).map(row => row.id));
}

async function systemAdjustmentAccount(db, storeId) {
  return db.prepare(`
    SELECT id, code, name
    FROM chart_of_accounts
    WHERE store_id = ? AND subtype = ? AND type = 'EQUITY' AND is_active = 1
    ORDER BY code
    LIMIT 1
  `).bind(storeId, SYSTEM_ADJUSTMENT_SUBTYPE).first();
}

export async function getAccountingJournal(db, storeId, journalId) {
  const header = await db.prepare(`
    SELECT id, journal_number, business_date, occurred_at, currency_code,
           source_system, source_reference_id, correlation_id, idempotency_key,
           description, journal_status, posted_at, reversal_of_journal_id
    FROM accounting_journal_headers
    WHERE id = ? AND store_id = ?
  `).bind(journalId, storeId).first();
  if (!header) return null;
  const rows = await db.prepare(`
    SELECT l.id, l.line_number, l.account_id, l.side, l.amount_scaled,
           l.is_system_generated, l.description,
           a.code AS account_code, a.name AS account_name, a.type AS account_type
    FROM accounting_journal_lines l
    JOIN chart_of_accounts a ON a.id = l.account_id AND a.store_id = l.store_id
    WHERE l.journal_id = ? AND l.store_id = ?
    ORDER BY l.line_number
  `).bind(journalId, storeId).all();
  return {
    journalId: header.id,
    journalNumber: header.journal_number,
    businessDate: header.business_date,
    occurredAt: header.occurred_at,
    currencyCode: header.currency_code,
    sourceSystem: header.source_system,
    sourceReferenceId: header.source_reference_id,
    correlationId: header.correlation_id,
    idempotencyKey: header.idempotency_key,
    description: header.description,
    journalStatus: header.journal_status,
    postedAt: header.posted_at,
    reversalOfJournalId: header.reversal_of_journal_id || null,
    lines: (rows.results ?? []).map(row => {
      const amountScaled = Number(row.amount_scaled);
      return {
        journalLineId: row.id,
        lineNumber: Number(row.line_number),
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        side: row.side,
        amountScaled,
        amountExact: scaledAmountToExactString(amountScaled),
        amountMinor: scaledToCompatibilityRupiah(amountScaled),
        isSystemGenerated: Boolean(row.is_system_generated),
        description: row.description || ''
      };
    })
  };
}

export async function postAccountingJournal(db, store, command) {
  const businessDate = validateBusinessDate(command?.businessDate);
  const sourceSystem = text(command?.sourceSystem, 60).toUpperCase();
  const sourceReferenceId = text(command?.sourceReferenceId, 180);
  const correlationId = text(command?.correlationId || sourceReferenceId, 180);
  const idempotencyKey = text(command?.idempotencyKey, 220);
  const description = text(command?.description, 300);
  if (!businessDate || !sourceSystem || !sourceReferenceId || !correlationId || !idempotencyKey || !description) {
    return { ok: false, status: 400, code: 'JOURNAL_HEADER_INVALID', error: 'Tanggal, sumber, referensi, idempotency key, dan deskripsi jurnal wajib valid.' };
  }
  const existing = await db.prepare(`
    SELECT id FROM accounting_journal_headers WHERE store_id = ? AND idempotency_key = ?
  `).bind(store.id, idempotencyKey).first();
  if (existing) return { ok: true, duplicate: true, journal: await getAccountingJournal(db, store.id, existing.id) };

  const allowSystemAdjustment = sourceSystem !== 'MANUAL'
    && command?.systemAdjustmentPolicy === SYSTEM_ADJUSTMENT_POLICY;

  let checked;
  try {
    checked = validateJournalLines(
      command?.journalLines,
      await activeAccountIds(db, store.id),
      { requireBalanced: !allowSystemAdjustment, maxLines: 100 }
    );
  } catch (error) {
    if (String(error?.message || '') === 'ACCOUNTING_AMOUNT_OVERFLOW') {
      return { ok: false, status: 400, code: 'ACCOUNTING_AMOUNT_OVERFLOW', error: 'Total jurnal melampaui batas integer aman.' };
    }
    throw error;
  }
  if (!checked.ok) return { ...checked, status: 400 };

  if (checked.totalDebitScaled !== checked.totalCreditScaled) {
    const differenceScaled = Math.abs(checked.totalDebitScaled - checked.totalCreditScaled);
    if (!allowSystemAdjustment || differenceScaled > SYSTEM_ADJUSTMENT_TOLERANCE_SCALED) {
      return {
        ok: false,
        status: 400,
        code: 'UNBALANCED_JOURNAL_OUTSIDE_TOLERANCE',
        error: allowSystemAdjustment
          ? 'Selisih jurnal sistem melebihi toleransi Penyesuaian Rp100.'
          : 'Total Debit dan Kredit harus sama.',
        totalDebitScaled: checked.totalDebitScaled,
        totalCreditScaled: checked.totalCreditScaled,
        differenceScaled,
        differenceExact: scaledAmountToExactString(differenceScaled)
      };
    }
    const adjustment = await systemAdjustmentAccount(db, store.id);
    if (!adjustment) {
      return { ok: false, status: 409, code: 'SYSTEM_ADJUSTMENT_ACCOUNT_MISSING', error: 'Akun sistem Penyesuaian tidak tersedia / tidak aktif.' };
    }
    checked.lines.push({
      accountId: adjustment.id,
      side: checked.totalDebitScaled > checked.totalCreditScaled ? 'CREDIT' : 'DEBIT',
      amountScaled: differenceScaled,
      amountExact: scaledAmountToExactString(differenceScaled),
      description: 'Penyesuaian',
      isSystemGenerated: true
    });
    checked = validateJournalLines(checked.lines, await activeAccountIds(db, store.id), { requireBalanced: true, maxLines: 101 });
    if (!checked.ok) return { ...checked, status: 400 };
  }

  const journalId = `journal_${crypto.randomUUID()}`;
  const journalNumber = sequenceCode('JRN', await nextSequence(db, store.id, 'JOURNAL_NUMBER'));
  const occurredAt = text(command?.occurredAt, 40) || new Date().toISOString();
  const postedAt = new Date().toISOString();
  const reversalOfJournalId = text(command?.reversalOfJournalId, 180) || null;
  if (reversalOfJournalId) {
    const original = await db.prepare(`SELECT id FROM accounting_journal_headers WHERE id = ? AND store_id = ?`).bind(reversalOfJournalId, store.id).first();
    if (!original) return { ok: false, status: 400, code: 'REVERSAL_SOURCE_NOT_FOUND', error: 'Jurnal sumber reversal tidak ditemukan.' };
  }

  const statements = [
    db.prepare(`
      INSERT INTO accounting_journal_headers (
        id, store_id, journal_number, business_date, occurred_at, currency_code,
        source_system, source_reference_id, correlation_id, idempotency_key,
        description, journal_status, posted_at, reversal_of_journal_id
      ) VALUES (?, ?, ?, ?, ?, 'IDR', ?, ?, ?, ?, ?, 'POSTED', ?, ?)
    `).bind(
      journalId, store.id, journalNumber, businessDate, occurredAt,
      sourceSystem, sourceReferenceId, correlationId, idempotencyKey,
      description, postedAt, reversalOfJournalId
    )
  ];
  checked.lines.forEach((line, index) => {
    statements.push(db.prepare(`
      INSERT INTO accounting_journal_lines (
        id, store_id, journal_id, line_number, account_id, side,
        amount_scaled, is_system_generated, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `${journalId}:L${String(index + 1).padStart(3, '0')}`,
      store.id,
      journalId,
      index + 1,
      line.accountId,
      line.side,
      line.amountScaled,
      line.isSystemGenerated ? 1 : 0,
      line.description
    ));
  });
  try {
    await db.batch(statements);
  } catch (error) {
    const duplicate = await db.prepare(`SELECT id FROM accounting_journal_headers WHERE store_id = ? AND idempotency_key = ?`).bind(store.id, idempotencyKey).first();
    if (duplicate) return { ok: true, duplicate: true, journal: await getAccountingJournal(db, store.id, duplicate.id) };
    throw error;
  }
  return { ok: true, duplicate: false, journal: await getAccountingJournal(db, store.id, journalId) };
}

export async function listAccountingJournals(db, storeId, { from = '', to = '', limit = 200 } = {}) {
  const fromDate = from ? validateBusinessDate(from) : null;
  const toDate = to ? validateBusinessDate(to) : null;
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const rows = await db.prepare(`
    SELECT h.id, h.journal_number, h.business_date, h.source_system, h.source_reference_id,
           h.description, h.posted_at, h.reversal_of_journal_id,
           COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE 0 END), 0) AS total_debit_scaled,
           COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount_scaled ELSE 0 END), 0) AS total_credit_scaled
    FROM accounting_journal_headers h
    LEFT JOIN accounting_journal_lines l ON l.journal_id = h.id AND l.store_id = h.store_id
    WHERE h.store_id = ?
      AND (? IS NULL OR h.business_date >= ?)
      AND (? IS NULL OR h.business_date <= ?)
    GROUP BY h.id
    ORDER BY h.business_date DESC, h.journal_number DESC
    LIMIT ?
  `).bind(storeId, fromDate, fromDate, toDate, toDate, safeLimit).all();
  return (rows.results ?? []).map(row => {
    const totalDebitScaled = Number(row.total_debit_scaled || 0);
    const totalCreditScaled = Number(row.total_credit_scaled || 0);
    return {
      journalId: row.id,
      journalNumber: row.journal_number,
      businessDate: row.business_date,
      sourceSystem: row.source_system,
      sourceReferenceId: row.source_reference_id,
      description: row.description,
      postedAt: row.posted_at,
      reversalOfJournalId: row.reversal_of_journal_id || null,
      totalDebitScaled,
      totalCreditScaled,
      totalDebitExact: scaledAmountToExactString(totalDebitScaled),
      totalCreditExact: scaledAmountToExactString(totalCreditScaled),
      totalDebitMinor: scaledToCompatibilityRupiah(totalDebitScaled),
      totalCreditMinor: scaledToCompatibilityRupiah(totalCreditScaled)
    };
  });
}

async function accountRow(db, storeId, accountId) {
  return db.prepare(`
    SELECT id, code, name, type, subtype, is_active
    FROM chart_of_accounts
    WHERE id = ? AND store_id = ?
  `).bind(accountId, storeId).first();
}

export async function getGeneralLedger(db, storeId, accountId, from, to) {
  const account = await accountRow(db, storeId, accountId);
  if (!account) return null;
  const fromDate = validateBusinessDate(from);
  const toDate = validateBusinessDate(to);
  if (!fromDate || !toDate || fromDate > toDate) return { error: 'Periode buku besar tidak valid.', code: 'INVALID_REPORT_PERIOD' };
  const opening = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE 0 END), 0) AS debit_scaled,
      COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount_scaled ELSE 0 END), 0) AS credit_scaled
    FROM accounting_journal_lines l
    JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
    WHERE l.store_id = ? AND l.account_id = ? AND h.business_date < ?
  `).bind(storeId, accountId, fromDate).first();
  const openingDebitScaled = Number(opening?.debit_scaled || 0);
  const openingCreditScaled = Number(opening?.credit_scaled || 0);
  let runningBalanceScaled = calculateNormalBalance(account.type, openingDebitScaled, openingCreditScaled);
  const rows = await db.prepare(`
    SELECT h.id AS journal_id, h.journal_number, h.business_date, h.description AS journal_description,
           h.source_system, h.source_reference_id,
           l.side, l.amount_scaled, l.description AS line_description, l.line_number, l.is_system_generated
    FROM accounting_journal_lines l
    JOIN accounting_journal_headers h ON h.id = l.journal_id AND h.store_id = l.store_id
    WHERE l.store_id = ? AND l.account_id = ?
      AND h.business_date >= ? AND h.business_date <= ?
    ORDER BY h.business_date, h.journal_number, l.line_number
  `).bind(storeId, accountId, fromDate, toDate).all();
  const entries = (rows.results ?? []).map(row => {
    const amountScaled = Number(row.amount_scaled);
    const debitScaled = row.side === 'DEBIT' ? amountScaled : 0;
    const creditScaled = row.side === 'CREDIT' ? amountScaled : 0;
    runningBalanceScaled += accountNormalSide(account.type) === 'DEBIT'
      ? debitScaled - creditScaled
      : creditScaled - debitScaled;
    return {
      journalId: row.journal_id,
      journalNumber: row.journal_number,
      businessDate: row.business_date,
      description: row.line_description || row.journal_description,
      sourceSystem: row.source_system,
      sourceReferenceId: row.source_reference_id,
      debitScaled,
      creditScaled,
      balanceScaled: runningBalanceScaled,
      debitExact: scaledAmountToExactString(debitScaled),
      creditExact: scaledAmountToExactString(creditScaled),
      balanceExact: scaledAmountToExactString(Math.abs(runningBalanceScaled)),
      debitMinor: scaledToCompatibilityRupiah(debitScaled),
      creditMinor: scaledToCompatibilityRupiah(creditScaled),
      balanceMinor: scaledToCompatibilityRupiah(runningBalanceScaled),
      isSystemGenerated: Boolean(row.is_system_generated)
    };
  });
  const openingBalanceScaled = calculateNormalBalance(account.type, openingDebitScaled, openingCreditScaled);
  return {
    account: {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      normalSide: accountNormalSide(account.type)
    },
    period: { from: fromDate, to: toDate },
    openingBalanceScaled,
    openingBalanceExact: scaledAmountToExactString(Math.abs(openingBalanceScaled)),
    openingBalanceMinor: scaledToCompatibilityRupiah(openingBalanceScaled),
    entries,
    closingBalanceScaled: runningBalanceScaled,
    closingBalanceExact: scaledAmountToExactString(Math.abs(runningBalanceScaled)),
    closingBalanceMinor: scaledToCompatibilityRupiah(runningBalanceScaled)
  };
}

async function groupedBalances(db, storeId, journalPeriodClause, values) {
  const rows = await db.prepare(`
    SELECT a.id AS account_id, a.code AS account_code, a.name AS account_name, a.type AS account_type,
           COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE 0 END), 0) AS debit_scaled,
           COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount_scaled ELSE 0 END), 0) AS credit_scaled
    FROM chart_of_accounts a
    LEFT JOIN accounting_journal_lines l
      ON l.account_id = a.id
     AND l.store_id = a.store_id
     AND EXISTS (
       SELECT 1
       FROM accounting_journal_headers h
       WHERE h.id = l.journal_id
         AND h.store_id = l.store_id
         ${journalPeriodClause}
     )
    WHERE a.store_id = ?
    GROUP BY a.id
    ORDER BY a.code COLLATE NOCASE, a.name COLLATE NOCASE
  `).bind(...values, storeId).all();
  return (rows.results ?? []).map(row => {
    const debitScaled = Number(row.debit_scaled || 0);
    const creditScaled = Number(row.credit_scaled || 0);
    const balanceScaled = calculateNormalBalance(row.account_type, debitScaled, creditScaled);
    return {
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      accountType: row.account_type,
      debitScaled,
      creditScaled,
      balanceScaled,
      debitExact: scaledAmountToExactString(debitScaled),
      creditExact: scaledAmountToExactString(creditScaled),
      balanceExact: scaledAmountToExactString(Math.abs(balanceScaled)),
      debitMinor: scaledToCompatibilityRupiah(debitScaled),
      creditMinor: scaledToCompatibilityRupiah(creditScaled),
      balanceMinor: scaledToCompatibilityRupiah(balanceScaled)
    };
  });
}

export function summarizeProfitLoss(rows) {
  const revenue = rows.filter(row => row.accountType === 'REVENUE' && row.balanceScaled !== 0);
  const expenses = rows.filter(row => row.accountType === 'EXPENSE' && row.balanceScaled !== 0);
  const totalRevenueScaled = revenue.reduce((sum, row) => safeAdd(sum, row.balanceScaled), 0);
  const totalExpenseScaled = expenses.reduce((sum, row) => safeAdd(sum, row.balanceScaled), 0);
  const netIncomeScaled = totalRevenueScaled - totalExpenseScaled;
  return {
    revenue,
    expenses,
    totalRevenueScaled,
    totalExpenseScaled,
    netIncomeScaled,
    totalRevenueExact: scaledAmountToExactString(totalRevenueScaled),
    totalExpenseExact: scaledAmountToExactString(totalExpenseScaled),
    netIncomeExact: scaledAmountToExactString(Math.abs(netIncomeScaled)),
    totalRevenueMinor: scaledToCompatibilityRupiah(totalRevenueScaled),
    totalExpenseMinor: scaledToCompatibilityRupiah(totalExpenseScaled),
    netIncomeMinor: scaledToCompatibilityRupiah(netIncomeScaled)
  };
}

export async function getProfitLoss(db, storeId, from, to) {
  const fromDate = validateBusinessDate(from);
  const toDate = validateBusinessDate(to);
  if (!fromDate || !toDate || fromDate > toDate) return { error: 'Periode laba rugi tidak valid.', code: 'INVALID_REPORT_PERIOD' };
  const rows = await groupedBalances(
    db,
    storeId,
    `AND h.business_date >= ? AND h.business_date <= ?`,
    [fromDate, toDate]
  );
  return { period: { from: fromDate, to: toDate }, ...summarizeProfitLoss(rows) };
}

export function summarizeBalanceSheet(rows, currentEarningsScaled) {
  const assets = rows.filter(row => row.accountType === 'ASSET' && row.balanceScaled !== 0);
  const liabilities = rows.filter(row => row.accountType === 'LIABILITY' && row.balanceScaled !== 0);
  const equity = rows.filter(row => row.accountType === 'EQUITY' && row.balanceScaled !== 0);
  const totalAssetsScaled = assets.reduce((sum, row) => safeAdd(sum, row.balanceScaled), 0);
  const totalLiabilitiesScaled = liabilities.reduce((sum, row) => safeAdd(sum, row.balanceScaled), 0);
  const totalEquityScaled = equity.reduce((sum, row) => safeAdd(sum, row.balanceScaled), 0);
  const totalLiabilitiesAndEquityScaled = totalLiabilitiesScaled + totalEquityScaled + currentEarningsScaled;
  return {
    assets,
    liabilities,
    equity,
    currentEarningsScaled,
    totalAssetsScaled,
    totalLiabilitiesScaled,
    totalEquityScaled,
    totalLiabilitiesAndEquityScaled,
    currentEarningsExact: scaledAmountToExactString(Math.abs(currentEarningsScaled)),
    totalAssetsExact: scaledAmountToExactString(Math.abs(totalAssetsScaled)),
    totalLiabilitiesExact: scaledAmountToExactString(Math.abs(totalLiabilitiesScaled)),
    totalEquityExact: scaledAmountToExactString(Math.abs(totalEquityScaled)),
    totalLiabilitiesAndEquityExact: scaledAmountToExactString(Math.abs(totalLiabilitiesAndEquityScaled)),
    currentEarningsMinor: scaledToCompatibilityRupiah(currentEarningsScaled),
    totalAssetsMinor: scaledToCompatibilityRupiah(totalAssetsScaled),
    totalLiabilitiesMinor: scaledToCompatibilityRupiah(totalLiabilitiesScaled),
    totalEquityMinor: scaledToCompatibilityRupiah(totalEquityScaled),
    totalLiabilitiesAndEquityMinor: scaledToCompatibilityRupiah(totalLiabilitiesAndEquityScaled),
    isBalanced: totalAssetsScaled === totalLiabilitiesAndEquityScaled
  };
}

export async function getBalanceSheet(db, storeId, asOf) {
  const asOfDate = validateBusinessDate(asOf);
  if (!asOfDate) return { error: 'Tanggal neraca tidak valid.', code: 'INVALID_REPORT_DATE' };
  const rows = await groupedBalances(db, storeId, `AND h.business_date <= ?`, [asOfDate]);
  const profitLoss = summarizeProfitLoss(rows);
  return { asOfDate, ...summarizeBalanceSheet(rows, profitLoss.netIncomeScaled) };
}

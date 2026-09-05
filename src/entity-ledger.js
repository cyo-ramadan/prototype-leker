import {
  ACCOUNT_TYPES,
  accountNormalSide,
  validateBusinessDate,
  validateJournalLines,
  scaledAmountToExactString
} from './accounting-ledger.js';

// Buku Entity (migration 0073) -- cermin src/accounting-ledger.js, dikunci
// entity_id bukan store_id. Fungsi murni (validateJournalLines,
// scaledAmountToExactString, dst) dipakai ulang dari sana apa adanya --
// sudah entity-agnostic sejak awal.
//
// Sengaja tanpa toleransi Penyesuaian pembulatan: semua jurnal di sini
// manual (source_system selalu 'MANUAL'), jadi selalu wajib balance PAS
// (CLAUDE.md invariant #3).

const MAX_TEXT = 500;
const text = (value, max = MAX_TEXT) => String(value ?? '').trim().slice(0, max);

async function nextSequence(db, entityId, sequenceKey) {
  const row = await db.prepare(`
    INSERT INTO entity_accounting_sequences (entity_id, sequence_key, last_value, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(entity_id, sequence_key) DO UPDATE SET
      last_value = entity_accounting_sequences.last_value + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING last_value
  `).bind(entityId, sequenceKey).first();
  const value = Number(row?.last_value || 0);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('ENTITY_ACCOUNTING_SEQUENCE_INVALID');
  return value;
}

function sequenceCode(prefix, value) {
  return `${prefix}-${String(value).padStart(6, '0')}`;
}

export async function listEntityAccounts(db, entityId) {
  const rows = await db.prepare(`
    SELECT id, code, name, type, subtype, is_active, created_at, updated_at
    FROM entity_chart_of_accounts
    WHERE entity_id = ?
    ORDER BY CASE type
      WHEN 'ASSET' THEN 1 WHEN 'LIABILITY' THEN 2 WHEN 'EQUITY' THEN 3
      WHEN 'REVENUE' THEN 4 WHEN 'EXPENSE' THEN 5 ELSE 9 END,
      code COLLATE NOCASE, name COLLATE NOCASE
  `).bind(entityId).all();
  return (rows.results ?? []).map(row => ({
    accountId: row.id,
    accountCode: row.code,
    accountName: row.name,
    accountType: row.type,
    subtype: row.subtype || '',
    normalSide: accountNormalSide(row.type),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function createEntityAccount(db, entityId, input) {
  const accountName = text(input?.accountName, 100);
  const accountType = text(input?.accountType, 20).toUpperCase();
  const subtype = text(input?.subtype, 60).toUpperCase();
  if (!accountName || !ACCOUNT_TYPES.includes(accountType)) {
    return { ok: false, status: 400, code: 'ACCOUNT_INPUT_INVALID', error: 'Nama dan tipe akun wajib valid.' };
  }
  const sequence = await nextSequence(db, entityId, 'ACCOUNT_CODE');
  const accountCode = sequenceCode('ENT-ACC', sequence);
  const accountId = `entcoa_${entityId}_${crypto.randomUUID()}`;
  try {
    await db.prepare(`
      INSERT INTO entity_chart_of_accounts (
        id, entity_id, code, name, type, subtype, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(accountId, entityId, accountCode, accountName, accountType, subtype).run();
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return { ok: false, status: 409, code: 'ACCOUNT_CODE_CONFLICT', error: 'Kode akun otomatis bentrok. Silakan ulangi.' };
    }
    throw error;
  }
  return { ok: true, accountId, accountCode };
}

export async function updateEntityAccount(db, entityId, accountId, input) {
  const current = await db.prepare(`
    SELECT id, code, name, type, subtype, is_active
    FROM entity_chart_of_accounts
    WHERE id = ? AND entity_id = ?
  `).bind(accountId, entityId).first();
  if (!current) return { ok: false, status: 404, code: 'ACCOUNT_NOT_FOUND', error: 'Akun Entity tidak ditemukan.' };

  const accountName = text(input?.accountName ?? current.name, 100);
  const subtype = text(input?.subtype ?? current.subtype, 60).toUpperCase();
  const isActive = input?.isActive === undefined ? Boolean(current.is_active) : Boolean(input.isActive);
  if (!accountName) return { ok: false, status: 400, code: 'ACCOUNT_INPUT_INVALID', error: 'Nama akun tidak valid.' };

  if (!isActive && Boolean(current.is_active)) {
    const referenced = await db.prepare(`
      SELECT COUNT(*) AS n FROM entity_journal_lines WHERE entity_id = ? AND account_id = ?
    `).bind(entityId, accountId).first();
    if (Number(referenced?.n ?? 0) > 0) {
      return { ok: false, status: 409, code: 'ACCOUNT_HAS_JOURNAL_LINES', error: 'Akun ini sudah punya baris jurnal, tidak bisa dinonaktifkan (histori tetap harus terbaca).' };
    }
  }
  await db.prepare(`
    UPDATE entity_chart_of_accounts
    SET name = ?, subtype = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND entity_id = ?
  `).bind(accountName, subtype, isActive ? 1 : 0, accountId, entityId).run();
  return { ok: true, accountId, accountCode: current.code, accountType: current.type };
}

async function activeAccountIds(db, entityId) {
  const rows = await db.prepare(`SELECT id FROM entity_chart_of_accounts WHERE entity_id = ? AND is_active = 1`).bind(entityId).all();
  return new Set((rows.results ?? []).map(row => row.id));
}

export async function getEntityJournal(db, entityId, journalId) {
  const header = await db.prepare(`
    SELECT id, journal_number, business_date, occurred_at, currency_code,
           source_system, source_reference_id, correlation_id, idempotency_key,
           description, journal_status, posted_at, reversal_of_journal_id
    FROM entity_journal_headers
    WHERE id = ? AND entity_id = ?
  `).bind(journalId, entityId).first();
  if (!header) return null;
  const rows = await db.prepare(`
    SELECT l.id, l.line_number, l.account_id, l.side, l.amount_scaled, l.description,
           a.code AS account_code, a.name AS account_name, a.type AS account_type
    FROM entity_journal_lines l
    JOIN entity_chart_of_accounts a ON a.id = l.account_id AND a.entity_id = l.entity_id
    WHERE l.journal_id = ? AND l.entity_id = ?
    ORDER BY l.line_number
  `).bind(journalId, entityId).all();
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
        description: row.description || ''
      };
    })
  };
}

export async function postEntityJournal(db, entityId, command) {
  const businessDate = validateBusinessDate(command?.businessDate);
  const sourceSystem = text(command?.sourceSystem || 'MANUAL', 60).toUpperCase();
  const sourceReferenceId = text(command?.sourceReferenceId, 180);
  const correlationId = text(command?.correlationId || sourceReferenceId, 180);
  const idempotencyKey = text(command?.idempotencyKey, 220);
  const description = text(command?.description, 300);
  if (!businessDate || !sourceReferenceId || !correlationId || !idempotencyKey || !description) {
    return { ok: false, status: 400, code: 'JOURNAL_HEADER_INVALID', error: 'Tanggal, referensi, idempotency key, dan deskripsi jurnal wajib valid.' };
  }
  const existing = await db.prepare(`
    SELECT id FROM entity_journal_headers WHERE entity_id = ? AND idempotency_key = ?
  `).bind(entityId, idempotencyKey).first();
  if (existing) return { ok: true, duplicate: true, journal: await getEntityJournal(db, entityId, existing.id) };

  let checked;
  try {
    checked = validateJournalLines(command?.journalLines, await activeAccountIds(db, entityId), { requireBalanced: true, maxLines: 100 });
  } catch (error) {
    if (String(error?.message || '') === 'ACCOUNTING_AMOUNT_OVERFLOW') {
      return { ok: false, status: 400, code: 'ACCOUNTING_AMOUNT_OVERFLOW', error: 'Total jurnal melampaui batas integer aman.' };
    }
    throw error;
  }
  if (!checked.ok) return { ...checked, status: 400 };

  const journalId = `entjournal_${crypto.randomUUID()}`;
  const journalNumber = sequenceCode('ENT-JRN', await nextSequence(db, entityId, 'JOURNAL_NUMBER'));
  const occurredAt = text(command?.occurredAt, 40) || new Date().toISOString();
  const postedAt = new Date().toISOString();
  const reversalOfJournalId = text(command?.reversalOfJournalId, 180) || null;
  if (reversalOfJournalId) {
    const original = await getEntityJournal(db, entityId, reversalOfJournalId);
    if (!original) return { ok: false, status: 400, code: 'REVERSAL_SOURCE_NOT_FOUND', error: 'Jurnal sumber reversal tidak ditemukan.' };
  }

  const statements = [
    db.prepare(`
      INSERT INTO entity_journal_headers (
        id, entity_id, journal_number, business_date, occurred_at, currency_code,
        source_system, source_reference_id, correlation_id, idempotency_key,
        description, journal_status, posted_at, reversal_of_journal_id
      ) VALUES (?, ?, ?, ?, ?, 'IDR', ?, ?, ?, ?, ?, 'POSTED', ?, ?)
    `).bind(
      journalId, entityId, journalNumber, businessDate, occurredAt,
      sourceSystem, sourceReferenceId, correlationId, idempotencyKey,
      description, postedAt, reversalOfJournalId
    )
  ];
  checked.lines.forEach((line, index) => {
    statements.push(db.prepare(`
      INSERT INTO entity_journal_lines (
        id, entity_id, journal_id, line_number, account_id, side, amount_scaled, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `${journalId}:L${String(index + 1).padStart(3, '0')}`,
      entityId, journalId, index + 1, line.accountId, line.side, line.amountScaled, line.description
    ));
  });
  try {
    await db.batch(statements);
  } catch (error) {
    const duplicate = await db.prepare(`SELECT id FROM entity_journal_headers WHERE entity_id = ? AND idempotency_key = ?`).bind(entityId, idempotencyKey).first();
    if (duplicate) return { ok: true, duplicate: true, journal: await getEntityJournal(db, entityId, duplicate.id) };
    throw error;
  }
  return { ok: true, duplicate: false, journal: await getEntityJournal(db, entityId, journalId) };
}

export async function listEntityJournals(db, entityId, { from = '', to = '', limit = 200 } = {}) {
  const conditions = ['entity_id = ?'];
  const values = [entityId];
  if (validateBusinessDate(from)) { conditions.push('business_date >= ?'); values.push(from); }
  if (validateBusinessDate(to)) { conditions.push('business_date <= ?'); values.push(to); }
  const boundedLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = await db.prepare(`
    SELECT id, journal_number, business_date, source_system, description, reversal_of_journal_id
    FROM entity_journal_headers
    WHERE ${conditions.join(' AND ')}
    ORDER BY business_date DESC, journal_number DESC
    LIMIT ?
  `).bind(...values, boundedLimit).all();
  return (rows.results ?? []).map(row => ({
    journalId: row.id,
    journalNumber: row.journal_number,
    businessDate: row.business_date,
    sourceSystem: row.source_system,
    description: row.description,
    isReversal: Boolean(row.reversal_of_journal_id)
  }));
}

import { postAccountingJournal } from './accounting-ledger.js';

const CASH_ACCOUNT = Object.freeze({
  code: '1101',
  name: 'Kas',
  type: 'ASSET',
  subtype: 'CASH'
});

const EMPLOYEE_RECEIVABLE_ACCOUNT = Object.freeze({
  code: '1202',
  name: 'Piutang Karyawan',
  type: 'ASSET',
  subtype: 'RECEIVABLE'
});

function exactAccount(rows, expected) {
  return rows.find(row =>
    row.code === expected.code
    && row.name === expected.name
    && row.type === expected.type
    && row.subtype === expected.subtype
    && Number(row.is_active) === 1
  ) || null;
}

async function employeeDepositAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, type, COALESCE(subtype, '') AS subtype, is_active
    FROM chart_of_accounts
    WHERE store_id = ? AND code IN ('1101', '1103', '1202')
    ORDER BY code
  `).bind(storeId).all();
  const accounts = rows.results ?? [];
  return {
    cash: exactAccount(accounts, CASH_ACCOUNT),
    // Rekening Bersama (ADR-047 kode seragam 1103). Cukup kode + Aset + aktif: namanya boleh
    // disesuaikan gerai, kodenya yang dikunci standardisasi akun.
    sharedAccount: accounts.find(row => row.code === '1103' && row.type === 'ASSET' && Number(row.is_active) === 1) || null,
    employeeReceivable: exactAccount(accounts, EMPLOYEE_RECEIVABLE_ACCOUNT)
  };
}

// ADR-054: baris Piutang Karyawan membawa nama CS pemegang setoran, supaya Riwayat Setoran per
// orang bisa dibaca dari buku. Pemegang = counterparty piutang setoran (id karyawan, atau
// `cashier:<id>` untuk akun kasir yang belum ditautkan).
async function depositHolder(db, storeId, event, referenceId) {
  const row = event === 'RECOGNITION'
    ? await db.prepare(`
        SELECT counterparty_id, counterparty_name_snapshot AS name
        FROM operational_receivables_payables WHERE id = ? AND store_id = ? LIMIT 1
      `).bind(referenceId, storeId).first()
    : await db.prepare(`
        SELECT r.counterparty_id, r.counterparty_name_snapshot AS name
        FROM operational_receivable_payable_payments p
        JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
        WHERE p.id = ? AND p.store_id = ? LIMIT 1
      `).bind(referenceId, storeId).first();
  const name = String(row?.name || '').trim();
  if (!row?.counterparty_id || name.length < 2) return null;
  return { type: 'EMPLOYEE', employeeId: row.counterparty_id, name };
}

async function postEmployeeDepositJournal(db, store, {
  referenceId,
  businessDate,
  amountScaled,
  occurredAt,
  event,
  debit,
  credit
}) {
  if (String(store?.edition || '').toUpperCase() !== 'ACCOUNTING') {
    return { ok: true, skipped: true, status: 'SKIPPED_NON_ACCOUNTING' };
  }

  const storeId = String(store?.id || '').trim();
  const normalizedReferenceId = String(referenceId || '').trim();
  const normalizedAmount = Number(amountScaled);
  if (
    !storeId
    || !normalizedReferenceId
    || !String(businessDate || '').trim()
    || !Number.isSafeInteger(normalizedAmount)
    || normalizedAmount <= 0
  ) {
    return {
      ok: false,
      status: 400,
      code: 'EMPLOYEE_DEPOSIT_ACCOUNTING_FACT_INVALID',
      error: 'Referensi, tanggal, atau nominal Setoran Karyawan tidak valid untuk posting Accounting.'
    };
  }

  const accounts = await employeeDepositAccounts(db, storeId);
  if (!accounts.cash || !accounts.employeeReceivable) {
    return {
      ok: false,
      status: 409,
      code: 'EMPLOYEE_DEPOSIT_ACCOUNTING_ACCOUNTS_MISSING',
      error: 'Akun Kas atau Piutang Karyawan tidak tersedia sesuai kontrak.'
    };
  }
  if ((debit === 'sharedAccount' || credit === 'sharedAccount') && !accounts.sharedAccount) {
    return {
      ok: false,
      status: 409,
      code: 'EMPLOYEE_DEPOSIT_SHARED_ACCOUNT_MISSING',
      error: 'Akun 1103 Rekening Bersama belum aktif di gerai ini.'
    };
  }

  const accountByName = {
    cash: accounts.cash,
    sharedAccount: accounts.sharedAccount,
    employeeReceivable: accounts.employeeReceivable
  };
  const idempotencyKey = `EMPLOYEE_DEPOSIT_${event}:${storeId}:${normalizedReferenceId}`;
  const recognition = event === 'RECOGNITION';
  const holder = await depositHolder(db, storeId, event, normalizedReferenceId);
  return postAccountingJournal(db, { id: storeId }, {
    businessDate,
    occurredAt,
    sourceSystem: 'EMPLOYEE_DEPOSIT',
    sourceReferenceId: normalizedReferenceId,
    correlationId: normalizedReferenceId,
    idempotencyKey,
    description: recognition ? 'Pengakuan Piutang Karyawan' : 'Pelunasan Piutang Karyawan',
    journalLines: [
      {
        accountId: accountByName[debit].id,
        side: 'DEBIT',
        amountScaled: normalizedAmount,
        description: recognition ? 'Piutang Karyawan dari tutup laci' : debit === 'sharedAccount' ? 'Setoran karyawan masuk Rekening Bersama' : 'Kas dari setoran karyawan'
      },
      {
        accountId: accountByName[credit].id,
        side: 'CREDIT',
        amountScaled: normalizedAmount,
        description: recognition ? 'Kas yang masih dipegang karyawan' : 'Pelunasan Piutang Karyawan'
      }
    ],
    lineParties: [debit, credit].map(key => (key === 'employeeReceivable' ? holder : null))
  });
}

export function postEmployeeDepositRecognitionJournal(db, store, {
  receivableId,
  businessDate,
  amountScaled,
  occurredAt = ''
} = {}) {
  return postEmployeeDepositJournal(db, store, {
    referenceId: receivableId,
    businessDate,
    amountScaled,
    occurredAt,
    event: 'RECOGNITION',
    debit: 'employeeReceivable',
    credit: 'cash'
  });
}

// viaSharedAccount (migration 0139, Bos Cyo 2026-10-06): setoran yang dikirim ke Rekening
// Bersama -> Dr 1103 Rekening Bersama / Cr 1202. Kiriman lama tanpa tujuan tetap Dr 1101 Kas.
export function postEmployeeDepositSettlementJournal(db, store, {
  paymentId,
  businessDate,
  amountScaled,
  occurredAt = '',
  viaSharedAccount = false
} = {}) {
  return postEmployeeDepositJournal(db, store, {
    referenceId: paymentId,
    businessDate,
    amountScaled,
    occurredAt,
    event: 'SETTLEMENT',
    debit: viaSharedAccount ? 'sharedAccount' : 'cash',
    credit: 'employeeReceivable'
  });
}

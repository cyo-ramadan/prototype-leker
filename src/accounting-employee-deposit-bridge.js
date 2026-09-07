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
    WHERE store_id = ? AND code IN ('1101', '1202')
    ORDER BY code
  `).bind(storeId).all();
  const accounts = rows.results ?? [];
  return {
    cash: exactAccount(accounts, CASH_ACCOUNT),
    employeeReceivable: exactAccount(accounts, EMPLOYEE_RECEIVABLE_ACCOUNT)
  };
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

  const accountByName = {
    cash: accounts.cash,
    employeeReceivable: accounts.employeeReceivable
  };
  const idempotencyKey = `EMPLOYEE_DEPOSIT_${event}:${storeId}:${normalizedReferenceId}`;
  const recognition = event === 'RECOGNITION';
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
        description: recognition ? 'Piutang Karyawan dari tutup laci' : 'Kas dari setoran karyawan'
      },
      {
        accountId: accountByName[credit].id,
        side: 'CREDIT',
        amountScaled: normalizedAmount,
        description: recognition ? 'Kas yang masih dipegang karyawan' : 'Pelunasan Piutang Karyawan'
      }
    ]
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

export function postEmployeeDepositSettlementJournal(db, store, {
  paymentId,
  businessDate,
  amountScaled,
  occurredAt = ''
} = {}) {
  return postEmployeeDepositJournal(db, store, {
    referenceId: paymentId,
    businessDate,
    amountScaled,
    occurredAt,
    event: 'SETTLEMENT',
    debit: 'cash',
    credit: 'employeeReceivable'
  });
}

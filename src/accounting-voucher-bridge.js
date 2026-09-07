import { postAccountingJournal } from './accounting-ledger.js';

const PROMOTION_EXPENSE_ACCOUNT = Object.freeze({
  code: '6105',
  name: 'Beban Promosi',
  type: 'EXPENSE',
  subtype: 'PROMOTIONAL_EXPENSE'
});

const PROMOTION_INVENTORY_ACCOUNT = Object.freeze({
  code: '1304',
  name: 'Persediaan - Vocer Promosi',
  type: 'ASSET',
  subtype: 'INVENTORY'
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

async function voucherAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT id, code, name, type, COALESCE(subtype, '') AS subtype, is_active
    FROM chart_of_accounts
    WHERE store_id = ? AND code IN ('1304', '6105')
    ORDER BY code
  `).bind(storeId).all();
  const accounts = rows.results ?? [];
  return {
    promotionExpense: exactAccount(accounts, PROMOTION_EXPENSE_ACCOUNT),
    promotionInventory: exactAccount(accounts, PROMOTION_INVENTORY_ACCOUNT)
  };
}

export async function postVoucherRedemptionJournal(db, store, {
  redemptionId,
  businessDate,
  costScaled,
  occurredAt = ''
} = {}) {
  if (String(store?.edition || '').toUpperCase() !== 'ACCOUNTING') {
    return { ok: true, skipped: true, status: 'SKIPPED_NON_ACCOUNTING' };
  }

  const storeId = String(store?.id || '').trim();
  const referenceId = String(redemptionId || '').trim();
  const amountScaled = Number(costScaled);
  if (!storeId || !referenceId || !Number.isSafeInteger(amountScaled) || amountScaled <= 0) {
    return {
      ok: false,
      status: 400,
      code: 'VOUCHER_ACCOUNTING_FACT_INVALID',
      error: 'Referensi, tanggal, atau HPP Voucher tidak valid untuk posting Accounting.'
    };
  }

  const accounts = await voucherAccounts(db, storeId);
  if (!accounts.promotionExpense || !accounts.promotionInventory) {
    return {
      ok: false,
      status: 409,
      code: 'VOUCHER_ACCOUNTING_ACCOUNTS_MISSING',
      error: 'Akun Beban Promosi atau Persediaan - Vocer Promosi tidak tersedia sesuai kontrak.'
    };
  }

  return postAccountingJournal(db, { id: storeId }, {
    businessDate,
    occurredAt,
    sourceSystem: 'VOUCHER',
    sourceReferenceId: referenceId,
    correlationId: referenceId,
    idempotencyKey: `VOUCHER:${storeId}:${referenceId}`,
    description: 'Penukaran Voucher',
    journalLines: [
      {
        accountId: accounts.promotionExpense.id,
        side: 'DEBIT',
        amountScaled,
        description: 'Beban Promosi dari penukaran Voucher'
      },
      {
        accountId: accounts.promotionInventory.id,
        side: 'CREDIT',
        amountScaled,
        description: 'Persediaan barang promosi yang ditukar'
      }
    ]
  });
}

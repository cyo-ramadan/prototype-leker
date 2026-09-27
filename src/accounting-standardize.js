import { customAccountsAllowed, postAccountingJournal } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';

// ADR-047, Bos Cyo 2026-09-27: semua gerai (kecuali yang diizinkan custom,
// yaitu DERMO) memakai akun standar yang sama. Migration 0124 sudah
// mengarahkan aturan jurnal/cara bayar ke akun standar dan menutup akun custom
// yang saldonya nol. Akun custom yang masih bersaldo dipindah di sini, lewat
// pintu jurnal resmi (postAccountingJournal) -- bukan UPDATE saldo, karena
// jurnal posted immutable (invariant #2).
//
// Akun custom = kode ACC-xxxxxx. Kode yang sama berarti akun berbeda di tiap
// gerai, jadi tujuan ditentukan dari NAMA + TIPE lewat tabel
// accounting_standard_account_aliases.

export const ACCOUNTING_STANDARDIZE_CONTRACT = 'MAXI_ACCOUNTING_STANDARD_ACCOUNTS_V1';

const TARGET_SQL = `
  SELECT std.id, std.code, std.name
  FROM accounting_standard_account_aliases m
  JOIN chart_of_accounts std ON std.store_id = ? AND std.code = m.target_code AND std.type = m.account_type AND std.is_active = 1
  WHERE m.account_type = ? AND lower(?) LIKE m.name_pattern
  ORDER BY length(m.name_pattern) DESC
  LIMIT 1
`;

async function customAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT a.id, a.code, a.name, a.type,
      COALESCE((SELECT SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE -l.amount_scaled END)
                FROM accounting_journal_lines l WHERE l.account_id = a.id), 0) AS balance_scaled,
      (SELECT COUNT(*) FROM accounting_journal_lines l WHERE l.account_id = a.id) AS line_count
    FROM chart_of_accounts a
    WHERE a.store_id = ? AND a.code LIKE 'ACC-%' AND a.is_active = 1
    ORDER BY a.code
  `).bind(storeId).all();
  const accounts = [];
  for (const row of rows.results ?? []) {
    const target = await db.prepare(TARGET_SQL).bind(storeId, row.type, row.name).first();
    accounts.push({
      accountId: row.id,
      accountCode: row.code,
      accountName: row.name,
      accountType: row.type,
      balanceScaled: Number(row.balance_scaled || 0),
      lineCount: Number(row.line_count || 0),
      target: target ? { accountId: target.id, accountCode: target.code, accountName: target.name } : null
    });
  }
  return accounts;
}

export async function getAccountStandardization(db, storeId) {
  if (await customAccountsAllowed(db, storeId)) {
    return { contract: ACCOUNTING_STANDARDIZE_CONTRACT, customAccountsAllowed: true, pending: [] };
  }
  return { contract: ACCOUNTING_STANDARDIZE_CONTRACT, customAccountsAllowed: false, pending: await customAccounts(db, storeId) };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function repointStatements(db, storeId, fromId, toId) {
  return [
    db.prepare(`UPDATE journal_rules SET fixed_account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND fixed_account_id = ?`).bind(toId, storeId, fromId),
    db.prepare(`UPDATE payment_methods SET account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND account_id = ?`).bind(toId, storeId, fromId),
    db.prepare(`UPDATE item_categories SET inventory_account_id = ? WHERE store_id = ? AND inventory_account_id = ?`).bind(toId, storeId, fromId),
    db.prepare(`UPDATE item_categories SET cogs_account_id = ? WHERE store_id = ? AND cogs_account_id = ?`).bind(toId, storeId, fromId),
    db.prepare(`UPDATE item_categories SET revenue_account_id = ? WHERE store_id = ? AND revenue_account_id = ?`).bind(toId, storeId, fromId),
    db.prepare(`UPDATE accounting_choice_options SET account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND account_id = ?`).bind(toId, storeId, fromId)
  ];
}

// Pindahkan saldo semua akun custom yang punya tujuan ke akun standarnya
// (satu jurnal), arahkan rujukannya, lalu tutup (punya riwayat jurnal) atau
// hapus (belum pernah dipakai). Aman diklik ulang: tanpa saldo tersisa tidak
// ada jurnal baru, dan jurnal yang sama tidak bisa terposting dua kali
// (idempotency key dari isi pemindahannya).
export async function standardizeStoreAccounts(db, store, { businessDate = getJakartaBusinessDate() } = {}) {
  if (await customAccountsAllowed(db, store.id)) {
    return { ok: false, status: 409, code: 'CUSTOM_ACCOUNTS_ALLOWED', error: 'Gerai ini diizinkan memakai akun sendiri; tidak ada yang perlu disamakan.' };
  }
  const accounts = await customAccounts(db, store.id);
  const movable = accounts.filter(account => account.target);
  const unmapped = accounts.filter(account => !account.target);

  const withBalance = movable.filter(account => account.balanceScaled !== 0);
  let journal = null;
  if (withBalance.length) {
    const journalLines = [];
    for (const account of withBalance) {
      const amountScaled = Math.abs(account.balanceScaled);
      const label = `${account.accountName} → ${account.target.accountCode} ${account.target.accountName}`;
      // Saldo debit (positif): kredit akun lama, debit akun standar. Saldo
      // kredit (negatif, mis. Hutang Gaji): kebalikannya.
      const oldSide = account.balanceScaled > 0 ? 'CREDIT' : 'DEBIT';
      const newSide = oldSide === 'CREDIT' ? 'DEBIT' : 'CREDIT';
      journalLines.push({ accountId: account.accountId, side: oldSide, amountScaled, description: `Tutup ${label}` });
      journalLines.push({ accountId: account.target.accountId, side: newSide, amountScaled, description: `Pindah saldo ${label}` });
    }
    const fingerprint = await sha256Hex(withBalance.map(account => `${account.accountId}:${account.balanceScaled}`).join('|'));
    const sourceReferenceId = `standardize_${store.id}_${fingerprint.slice(0, 24)}`;
    const result = await postAccountingJournal(db, store, {
      businessDate,
      occurredAt: new Date().toISOString(),
      sourceSystem: 'ACCOUNT_STANDARDIZE',
      sourceReferenceId,
      correlationId: sourceReferenceId,
      idempotencyKey: `ACCOUNT_STANDARDIZE:${store.id}:${fingerprint}`,
      description: 'Pemindahan saldo akun buatan gerai ke akun standar',
      journalLines
    });
    if (result?.ok === false) return result;
    journal = result.journal || null;
  }

  const closed = [];
  const removed = [];
  for (const account of movable) {
    const statements = repointStatements(db, store.id, account.accountId, account.target.accountId);
    if (account.lineCount > 0) {
      statements.push(db.prepare(`UPDATE chart_of_accounts SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`).bind(account.accountId, store.id));
      closed.push(account.accountCode);
    } else {
      statements.push(db.prepare(`DELETE FROM chart_of_accounts WHERE id = ? AND store_id = ? AND NOT EXISTS (SELECT 1 FROM accounting_journal_lines l WHERE l.account_id = ?)`).bind(account.accountId, store.id, account.accountId));
      removed.push(account.accountCode);
    }
    await db.batch(statements);
  }

  return {
    ok: true,
    contract: ACCOUNTING_STANDARDIZE_CONTRACT,
    journal,
    moved: withBalance.map(account => ({
      accountCode: account.accountCode,
      accountName: account.accountName,
      balanceScaled: account.balanceScaled,
      target: account.target
    })),
    closed,
    removed,
    unmapped: unmapped.map(account => ({ accountCode: account.accountCode, accountName: account.accountName, accountType: account.accountType }))
  };
}

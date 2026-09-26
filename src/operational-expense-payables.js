import { newId } from './ikan-ids.js';
import { OPERATIONAL_SOURCE_TYPES } from './operational-receivables-payables.js';

// Bos Cyo, 2026-09-26: "bea operasional itu kita bikin tombol kusus untuk
// membuat hutang, jadi pembayaran pilihannya adalah hutang pak azis
// (suplier) hutang mang darus(suplier) adiva(karyawan) dsb." Jembatan Bea
// Lapak/Bea Lainnya (src/admin-operational-expense.js) ke modul hutang-
// piutang generik yang sudah ada (operational_receivables_payables,
// migration 0074/0120/0121) -- pola sama dengan src/employee-deposit-
// settlement.js: INSERT langsung dengan source_type sendiri.
//
// Pelunasannya TIDAK di sini -- satu pintu untuk semua jenis Hutang ada di
// src/hutang-piutang.js (tombol Pembayaran Hutang/Piutang). Pembatalan Bea
// juga tidak perlu disentuh di sini: saldo dihitung saat dibaca, dan Bea
// yang dibatalkan membuat hutangnya bernilai 0 (lihat loadOrpItems).
//
// Kenapa Bea Gaji tidak ikut lewat sini: KNOWN_ISSUES.md ("Hutang: Gaji vs
// Lapak/Lainnya").
export const OPERATIONAL_EXPENSE_PAYABLE_CATEGORIES = Object.freeze([
  OPERATIONAL_SOURCE_TYPES.BEA_LAPAK,
  OPERATIONAL_SOURCE_TYPES.BEA_LAINNYA,
]);

export const COUNTERPARTY_TYPES = Object.freeze(['SUPPLIER', 'EMPLOYEE', 'OTHER']);

// Mengembalikan prepared statement (bukan menjalankannya) supaya pemanggil
// bisa menaruhnya di db.batch yang sama dengan baris Bea-nya -- Beban dan
// Hutangnya lahir bersama atau tidak sama sekali.
export function operationalExpensePayableStatement(db, {
  storeId, entityId, category, expenseId, counterpartyType, counterpartyId, counterpartyName, description, amountRupiah, businessDate
}) {
  if (!OPERATIONAL_EXPENSE_PAYABLE_CATEGORIES.includes(category)) throw new Error('OPERATIONAL_EXPENSE_PAYABLE_CATEGORY_INVALID');
  if (!COUNTERPARTY_TYPES.includes(counterpartyType)) throw new Error('OPERATIONAL_EXPENSE_PAYABLE_COUNTERPARTY_INVALID');
  const amountScaled = Number(amountRupiah) * 1_000_000;
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) throw new Error('OPERATIONAL_EXPENSE_PAYABLE_AMOUNT_INVALID');
  return db.prepare(`
    INSERT INTO operational_receivables_payables (
      id, store_id, entity_id, source_type, balance_type, source_id,
      counterparty_id, counterparty_name_snapshot, description,
      original_amount, transaction_date, counterparty_type
    ) VALUES (?, ?, ?, ?, 'PAYABLE', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId('ORP'), storeId, entityId, category, expenseId,
    counterpartyId || null,
    String(counterpartyName || '').trim().slice(0, 200) || 'Pihak ketiga',
    String(description || '').trim().slice(0, 300), amountScaled, businessDate, counterpartyType
  );
}

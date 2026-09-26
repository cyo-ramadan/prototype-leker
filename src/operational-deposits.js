import { newId } from './ikan-ids.js';
import {
  OPERATIONAL_SOURCE_TYPES,
  getOperationalReceivablePayable,
  listOperationalReceivablesPayables
} from './operational-receivables-payables.js';

// Bos Cyo, 2026-09-26: "kalo misal dibikin beli deposit gitu apa ribet?"
// Contoh: token listrik dibeli Rp1jt, bulan ini baru kepakai Rp500rb --
// sisanya bukan Beban, itu nilai yang KITA masih pegang. Sama untuk saldo
// iklan dan DP bahan baku. Beda dari Hutang (src/hutang-piutang.js): Hutang
// itu orang lain berhutang KE kita atau kita berhutang KE orang lain;
// Deposit ini murni nilai yang kita bayar duluan, belum semuanya
// terealisasi jadi Beban/barang.
//
// Bentuknya persis EMPLOYEE_DEPOSIT (piutang setoran laci) yang sudah ada:
// baris di operational_receivables_payables, balance_type RECEIVABLE,
// ditarik belakangan lewat addOperationalPayment yang sama dipakai Hutang --
// fungsi itu tidak peduli arah PAYABLE/RECEIVABLE. Modul ini cuma
// menyediakan pembuatan + daftar; PENARIKANNYA numpang di
// src/hutang-piutang.js (cara bayar "Deposit" di Pembayaran Lainnya/Hutang)
// dan src/cashier-purchase.js (cara bayar "Deposit" di form Pembelian,
// bahan baku ditarik otomatis sebesar barang yang benar-benar diterima).
export const DEPOSIT_CATEGORIES = Object.freeze([
  { code: OPERATIONAL_SOURCE_TYPES.DEPOSIT_LISTRIK, label: 'Uang Muka Listrik' },
  { code: OPERATIONAL_SOURCE_TYPES.DEPOSIT_IKLAN, label: 'Uang Muka Iklan' },
  { code: OPERATIONAL_SOURCE_TYPES.DEPOSIT_BAHAN_BAKU, label: 'Uang Muka Bahan Baku' },
  { code: OPERATIONAL_SOURCE_TYPES.DEPOSIT_LAINNYA, label: 'Uang Muka Lainnya' }
]);
const DEPOSIT_CODES = DEPOSIT_CATEGORIES.map(item => item.code);
const DEPOSIT_LABEL_BY_CODE = Object.fromEntries(DEPOSIT_CATEGORIES.map(item => [item.code, item.label]));
const COUNTERPARTY_TYPES = Object.freeze(['SUPPLIER', 'EMPLOYEE', 'OTHER']);

function domainError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function depositLabel(category) {
  return DEPOSIT_LABEL_BY_CODE[category] || category;
}

export async function createDeposit(db, {
  storeId, entityId, category, counterpartyType, counterpartyId, counterpartyName, description, amountRupiah, businessDate
}) {
  if (!DEPOSIT_CODES.includes(category)) throw domainError('Jenis Uang Muka/Deposit tidak dikenal.', 'DEPOSIT_CATEGORY_INVALID');
  if (!COUNTERPARTY_TYPES.includes(counterpartyType)) throw domainError('Jenis pihak tidak dikenal.', 'DEPOSIT_COUNTERPARTY_TYPE_INVALID');
  const amountScaled = Number(amountRupiah) * 1_000_000;
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) throw domainError('Nominal Uang Muka/Deposit harus bilangan bulat rupiah lebih dari nol.', 'DEPOSIT_AMOUNT_INVALID');
  if (!entityId) throw domainError('Gerai ini belum terhubung Entity, Uang Muka/Deposit butuh itu.', 'STORE_WITHOUT_ENTITY', 409);
  const name = String(counterpartyName || '').trim().slice(0, 200) || depositLabel(category);
  // source_id self-referensi -- deposit tidak lahir dari baris tabel lain
  // (beda dari Bea/Pembelian yang punya baris asalnya sendiri), jadi id
  // baris ini sekaligus jadi source_id-nya sendiri untuk penelusuran.
  const id = newId('ORP');
  await db.prepare(`
    INSERT INTO operational_receivables_payables (
      id, store_id, entity_id, source_type, balance_type, source_id,
      counterparty_id, counterparty_name_snapshot, description,
      original_amount, transaction_date, counterparty_type
    ) VALUES (?, ?, ?, ?, 'RECEIVABLE', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, storeId, entityId, category, id, counterpartyId || null, name,
    String(description || '').trim().slice(0, 300), amountScaled, businessDate, counterpartyType
  ).run();
  return getOperationalReceivablePayable(db, id, { storeId });
}

export async function listOpenDeposits(db, storeId) {
  const groups = await Promise.all(
    DEPOSIT_CODES.map(category => listOperationalReceivablesPayables(db, { storeId, filterSourceType: category, openOnly: true }))
  );
  return groups.flat()
    .map(item => ({ ...item, categoryLabel: depositLabel(item.sourceType) }))
    .sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
}

export async function getDepositForStore(db, storeId, depositId) {
  const item = await getOperationalReceivablePayable(db, depositId, { storeId });
  if (!item || !DEPOSIT_CODES.includes(item.sourceType)) return null;
  return item;
}

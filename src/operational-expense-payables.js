import { newId } from './ikan-ids.js';
import { rupiahToScaled } from './ikan-money.js';
import {
  OPERATIONAL_SOURCE_TYPES,
  getOperationalReceivablePayable,
  listOperationalReceivablesPayables,
  addOperationalPayment,
} from './operational-receivables-payables.js';

// Bos Cyo, 2026-09-26: "lapak juga lewat hutang dulu aja ... jadi nanti
// pembayaran2 by admin tinggal bayar2 hutang aja". Jembatan Bea Lapak/Bea
// Lainnya (src/admin-operational-expense.js) ke modul hutang-piutang generik
// yang sudah ada (src/operational-receivables-payables.js, migration 0074).
//
// Polanya sama persis dengan src/employee-deposit-settlement.js (EMPLOYEE_
// DEPOSIT): file itu INSERT langsung ke operational_receivables_payables
// dengan source_type miliknya sendiri -- bukan lewat
// addOperationalReceivablePayable()/ikanSourceSnapshot() karena sumbernya
// bukan tabel Ikan -- lalu pakai ulang addOperationalPayment/
// getOperationalReceivablePayable/listOperationalReceivablesPayables untuk
// siklus baca & bayarnya. File ini melakukan hal yang sama untuk Bea Lapak/
// Bea Lainnya.
//
// Kenapa Bea Gaji TIDAK ikut lewat sini: dijelaskan panjang di migration
// 0120 dan KNOWN_ISSUES.md -- gaji numpuk otomatis berkali-kali sehari dari
// presensi (bentuk akrual), sedangkan tabel ini bentuknya "satu baris = satu
// tagihan, dilunasi bertahap" (cocok untuk tagihan yang dicatat manual
// sesekali seperti Lapak/Lainnya, bukan untuk akrual per-shift).
export const OPERATIONAL_EXPENSE_PAYABLE_CATEGORIES = Object.freeze([
  OPERATIONAL_SOURCE_TYPES.BEA_LAPAK,
  OPERATIONAL_SOURCE_TYPES.BEA_LAINNYA,
]);

function assertCategory(category) {
  if (!OPERATIONAL_EXPENSE_PAYABLE_CATEGORIES.includes(category)) {
    const error = new Error('OPERATIONAL_EXPENSE_PAYABLE_CATEGORY_INVALID');
    error.code = 'OPERATIONAL_EXPENSE_PAYABLE_CATEGORY_INVALID';
    error.status = 400;
    throw error;
  }
}

function domainError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

// Dipanggil dari src/admin-operational-expense.js tepat sesudah baris
// admin_operational_expenses (BEA_LAPAK/BEA_LAINNYA) commit. Baris
// admin_operational_expenses itu yang mengakui Beban-nya (langsung, karena
// tidak ada akrual otomatis seperti gaji) -- baris Hutang di sini murni
// catatan "belum dibayar" dan TIDAK menambah Beban lagi, supaya tidak dobel
// hitung di Laporan Net Profit saat dilunasi nanti.
export async function createOperationalExpensePayable(db, {
  storeId, entityId, category, expenseId, counterpartyName, description, amountRupiah, businessDate
}) {
  assertCategory(category);
  const amountScaled = rupiahToScaled(amountRupiah);
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) {
    throw domainError('OPERATIONAL_EXPENSE_PAYABLE_AMOUNT_INVALID');
  }
  if (!expenseId) throw domainError('OPERATIONAL_EXPENSE_PAYABLE_EXPENSE_ID_REQUIRED');
  const id = newId('ORP');
  await db.prepare(`
    INSERT INTO operational_receivables_payables (
      id, store_id, entity_id, source_type, balance_type, source_id,
      counterparty_id, counterparty_name_snapshot, description,
      original_amount, transaction_date
    ) VALUES (?, ?, ?, ?, 'PAYABLE', ?, NULL, ?, ?, ?, ?)
  `).bind(
    id, storeId, entityId, category, expenseId,
    String(counterpartyName || '').trim().slice(0, 200) || 'Pihak ketiga',
    String(description || '').trim().slice(0, 300), amountScaled, businessDate
  ).run();
  return getOperationalReceivablePayable(db, id, { storeId });
}

export async function listOpenOperationalExpensePayables(db, storeId) {
  const groups = await Promise.all(
    OPERATIONAL_EXPENSE_PAYABLE_CATEGORIES.map(category =>
      listOperationalReceivablesPayables(db, { storeId, filterSourceType: category, openOnly: true })
    )
  );
  return groups.flat().sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
}

// Pelunasan Hutang Lapak/Lainnya. Cash-neutral terhadap Laporan Net Profit --
// Beban-nya sudah diakui sekali waktu Hutang ini dibuat (lihat komentar di
// atas createOperationalExpensePayable), jadi pembayaran di sini TIDAK
// menyentuh admin_operational_expenses sama sekali, cuma mengurangi saldo
// Hutang. Boleh melebihi sisa saldo (saldo jadi negatif = kelebihan bayar) --
// itu bukan bug, CLAUDE.md invariant #8.
export async function payOperationalExpensePayable(db, payableId, { storeId, amountRupiah, note, submittedBy }) {
  const item = await getOperationalReceivablePayable(db, payableId, { storeId });
  if (!item || !OPERATIONAL_EXPENSE_PAYABLE_CATEGORIES.includes(item.sourceType)) {
    throw domainError('OPERATIONAL_EXPENSE_PAYABLE_NOT_FOUND', 404);
  }
  return addOperationalPayment(db, payableId, { amountRupiah, note, submittedBy }, { storeId });
}

async function findPayableByExpenseId(db, storeId, expenseId) {
  const row = await db.prepare(`
    SELECT id FROM operational_receivables_payables
    WHERE store_id = ? AND source_id = ? AND source_type IN ('BEA_LAPAK', 'BEA_LAINNYA')
    LIMIT 1
  `).bind(storeId, expenseId).first();
  return row ? getOperationalReceivablePayable(db, row.id, { storeId }) : null;
}

// Dipanggil dari src/admin-operational-expense.js SESUDAH Bea Lapak/Lainnya
// berhasil dibatalkan (void). Kalau Hutangnya belum tersentuh sama sekali
// (belum pernah dibayar), tutup jadi nol lewat mekanisme pembayaran yang
// sudah ada -- bukan hapus/edit baris aslinya. Kalau sudah pernah dibayar
// sebagian/seluruhnya, SENGAJA dibiarkan apa adanya (tidak error, tidak
// menyentuh apa pun) -- uang yang sudah benar-benar berpindah tidak pernah
// dihapus diam-diam hanya karena baris pengakuan Beban-nya dibatalkan.
export async function closeOperationalExpensePayableForVoid(db, { storeId, expenseId, actorLabel }) {
  const payable = await findPayableByExpenseId(db, storeId, expenseId);
  if (!payable || payable.balanceRupiah === 0 || payable.paidAmountRupiah > 0) return payable || null;
  await addOperationalPayment(db, payable.id, {
    amountRupiah: payable.balanceRupiah,
    note: 'Ditutup otomatis -- Bea aslinya dibatalkan (void)',
    submittedBy: actorLabel || 'SYSTEM'
  }, { storeId });
  return getOperationalReceivablePayable(db, payable.id, { storeId });
}

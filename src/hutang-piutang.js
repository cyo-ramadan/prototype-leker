import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';
import { newId } from './ikan-ids.js';

// Bos Cyo, 2026-09-26: "bea operasional itu kita bikin tombol kusus untuk
// membuat hutang ... lalu kita bikin tombol lagi di sisi admin misal kita
// kusus pembayaran hutang/piutang. nah disitu kita nanti tinggal milih2 aja
// mau bayar hutang2 siapa, isi nominal dan cara bayarnya bisa rekber atau
// lainnya ... untuk sementara kita bikin 2 tombol saja, ada kusus
// pembayaran hutang piutang. dan pembayaran lainnya." Ditambah: laporan
// hutang piutang per orang, laporan beban, "rekber nya jangan dijadikan
// label tapi udah bener2 jadi rekening bersama", dan pembelian kasir yang
// cara bayarnya hutang ikut masuk catatan hutang.
//
// Aturannya SATU untuk semua jenis:
//   - Bea Operasional (src/admin-operational-expense.js) = satu-satunya
//     pintu MEMBUAT Hutang + mengakui Beban.
//   - Modul ini = satu-satunya pintu MELUNASI. Pelunasan cash-neutral
//     terhadap Laporan Net Profit: tidak pernah menulis Beban baru, cuma
//     mengurangi saldo Hutang. Pengecualian yang disengaja: "Pembayaran
//     Lainnya" = Beban yang langsung dibayar (tanpa Hutang), jadi dia yang
//     menulis baris Beban-nya sendiri.
//
// Sumber saldo per orang ada DUA ledger (alasannya di KNOWN_ISSUES.md):
//   - payroll_ledger_entries (Hutang Gaji: akrual presensi + Bea Gaji)
//   - operational_receivables_payables (Hutang Lapak/Lainnya/Pembelian +
//     Piutang setoran laci)
// Modul ini yang menyatukan keduanya jadi satu daftar per orang, supaya
// admin tidak perlu tahu ada dua mesin di belakangnya.
//
// Nominal di tabel admin_payments dan entity_shared_account_ledger = rupiah
// bulat; ledger Hutang (ORP & payroll) = scaled x1.000.000. Konversi cuma
// terjadi di sini, satu arah, lewat SCALE.

const SCALE = 1_000_000;
const MAX_AMOUNT_RUPIAH = 1_000_000_000;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

export const HUTANG_ACCOUNT_LABELS = Object.freeze({
  GAJI: 'Hutang Gaji',
  BEA_LAPAK: 'Hutang Lapak',
  BEA_LAINNYA: 'Hutang Lainnya',
  PURCHASE_PAYABLE: 'Hutang Pembelian',
  COST_PAYABLE: 'Hutang Titipan Biaya',
  SALE_RECEIVABLE: 'Piutang Penjualan',
  EMPLOYEE_DEPOSIT: 'Piutang Setoran Laci'
});

// Hutang yang boleh dilunasi dari layar Pembayaran Hutang/Piutang. Piutang
// setoran laci tetap lewat alurnya sendiri (bukti transfer + ACC, src/
// employee-deposit-settlement.js) -- di sini cuma ditampilkan.
const PAYABLE_BY_ADMIN = new Set(['GAJI', 'BEA_LAPAK', 'BEA_LAINNYA', 'PURCHASE_PAYABLE']);
const PAYMENT_METHODS = new Set(['KAS', 'BANK', 'REKBER']);
export const PAYMENT_METHOD_LABELS = Object.freeze({ KAS: 'Tunai / Kas Admin', BANK: 'Transfer Bank', REKBER: 'Rekening Bersama' });
const LAINNYA_CATEGORIES = new Set(['BEA_LAPAK', 'BEA_LAINNYA']);

function domainError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function amountInput(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > MAX_AMOUNT_RUPIAH) return null;
  return number;
}

function businessDateInput(value) {
  const trimmed = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return trimmed;
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  if (auth.agent) return { role: 'AGENT', id: String(auth.agent.id || auth.agent.name || '') };
  return { role: 'LEGACY_PIN', id: '' };
}

const rupiah = scaled => Math.round(Number(scaled || 0) / SCALE);

export function counterpartyKey(type, id, name) {
  return `${type}:${id || `name:${String(name || '').trim().toLowerCase()}`}`;
}

// ---------------------------------------------------------------- saldo ---

async function loadOrpItems(db, storeId) {
  const rows = await db.prepare(`
    SELECT r.id, r.entity_id, r.source_type, r.balance_type, r.source_id, r.counterparty_type,
           r.counterparty_id, r.counterparty_name_snapshot, r.description, r.original_amount,
           r.transaction_date, r.created_at,
           COALESCE((SELECT SUM(p.amount) FROM operational_receivable_payable_payments p
                     WHERE p.receivable_payable_id = r.id AND p.store_id = r.store_id
                       AND p.approval_status = 'approved'), 0) AS paid_amount,
           CASE
             WHEN r.source_type IN ('BEA_LAPAK', 'BEA_LAINNYA')
                  AND EXISTS (SELECT 1 FROM admin_operational_expenses e WHERE e.id = r.source_id AND e.voided_at IS NOT NULL) THEN 1
             WHEN r.source_type = 'PURCHASE_PAYABLE'
                  AND EXISTS (SELECT 1 FROM purchases pu WHERE pu.id = r.source_id AND pu.voided_at IS NOT NULL) THEN 1
             ELSE 0
           END AS source_voided
    FROM operational_receivables_payables r
    WHERE r.store_id = ?
    ORDER BY r.transaction_date, r.created_at
  `).bind(storeId).all();
  // Sumber (Bea/Pembelian) dibatalkan = hutangnya dianggap tidak pernah
  // ada (nominal asal 0), TAPI pembayaran yang sudah terjadi tetap dihitung
  // -- saldonya jadi minus = pihak itu yang sekarang berhutang balik ke kita.
  // Uang yang sudah benar-benar berpindah tidak pernah dihapus diam-diam.
  return (rows.results ?? []).map(row => {
    const originalScaled = row.source_voided ? 0 : Number(row.original_amount);
    const paidScaled = Number(row.paid_amount || 0);
    return {
      id: row.id,
      entityId: row.entity_id,
      account: row.source_type,
      balanceType: row.balance_type,
      sourceId: row.source_id,
      counterpartyType: row.counterparty_type || 'OTHER',
      counterpartyId: row.counterparty_id || null,
      counterpartyName: row.counterparty_name_snapshot,
      description: row.description || '',
      transactionDate: row.transaction_date,
      createdAt: row.created_at,
      sourceVoided: Boolean(row.source_voided),
      originalScaled,
      paidScaled,
      balanceScaled: originalScaled - paidScaled
    };
  });
}

async function loadGajiAccounts(db, storeId) {
  const rows = await db.prepare(`
    SELECT l.employee_id, e.full_name,
           COALESCE(SUM(CASE WHEN l.entry_type <> 'PAYMENT' THEN l.hutang_gaji_delta_scaled ELSE 0 END), 0) AS created_scaled,
           COALESCE(SUM(CASE WHEN l.entry_type = 'PAYMENT' THEN -l.hutang_gaji_delta_scaled ELSE 0 END), 0) AS paid_scaled,
           COALESCE(SUM(l.hutang_gaji_delta_scaled), 0) AS balance_scaled,
           COUNT(*) AS entry_count,
           MAX(l.business_date) AS last_date
    FROM payroll_ledger_entries l
    JOIN employees e ON e.id = l.employee_id
    WHERE l.store_id = ? AND l.voided_at IS NULL AND l.employee_id IS NOT NULL
    GROUP BY l.employee_id, e.full_name
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    employeeId: row.employee_id,
    employeeName: row.full_name,
    createdScaled: Number(row.created_scaled || 0),
    paidScaled: Number(row.paid_scaled || 0),
    balanceScaled: Number(row.balance_scaled || 0),
    entryCount: Number(row.entry_count || 0),
    lastDate: row.last_date
  }));
}

// Rekap per orang: satu orang bisa punya beberapa "akun" Hutang/Piutang
// (mis. Adiva: Hutang Gaji + Hutang Lainnya + Piutang Setoran Laci).
export async function buildHutangPiutangSummary(db, storeId) {
  const [orpItems, gajiAccounts] = await Promise.all([loadOrpItems(db, storeId), loadGajiAccounts(db, storeId)]);
  const persons = new Map();

  function personFor(type, id, name) {
    const key = counterpartyKey(type, id, name);
    if (!persons.has(key)) persons.set(key, { key, counterpartyType: type, counterpartyId: id || null, counterpartyName: name, accounts: new Map() });
    return persons.get(key);
  }
  function accountFor(person, account, balanceType) {
    const accountKey = `${account}|${person.key}`;
    if (!person.accounts.has(accountKey)) {
      person.accounts.set(accountKey, {
        accountKey, account, label: HUTANG_ACCOUNT_LABELS[account] || account, balanceType,
        createdScaled: 0, paidScaled: 0, balanceScaled: 0, items: []
      });
    }
    return person.accounts.get(accountKey);
  }

  for (const gaji of gajiAccounts) {
    const person = personFor('EMPLOYEE', gaji.employeeId, gaji.employeeName);
    const account = accountFor(person, 'GAJI', 'PAYABLE');
    account.createdScaled += gaji.createdScaled;
    account.paidScaled += gaji.paidScaled;
    account.balanceScaled += gaji.balanceScaled;
    account.lastDate = gaji.lastDate;
    account.entryCount = gaji.entryCount;
  }
  for (const item of orpItems) {
    const person = personFor(item.counterpartyType, item.counterpartyId, item.counterpartyName);
    const account = accountFor(person, item.account, item.balanceType);
    account.createdScaled += item.originalScaled;
    account.paidScaled += item.paidScaled;
    account.balanceScaled += item.balanceScaled;
    account.items.push(item);
  }

  const personList = [...persons.values()].map(person => {
    const accounts = [...person.accounts.values()].map(account => ({
      accountKey: account.accountKey,
      account: account.account,
      label: account.label,
      balanceType: account.balanceType,
      createdRupiah: rupiah(account.createdScaled),
      paidRupiah: rupiah(account.paidScaled),
      balanceRupiah: rupiah(account.balanceScaled),
      payableByAdmin: account.balanceType === 'PAYABLE' && PAYABLE_BY_ADMIN.has(account.account),
      items: account.items.map(item => ({
        id: item.id,
        description: item.description,
        transactionDate: item.transactionDate,
        sourceVoided: item.sourceVoided,
        originalRupiah: rupiah(item.originalScaled),
        paidRupiah: rupiah(item.paidScaled),
        balanceRupiah: rupiah(item.balanceScaled)
      }))
    }));
    const hutangRupiah = accounts.filter(a => a.balanceType === 'PAYABLE').reduce((sum, a) => sum + a.balanceRupiah, 0);
    const piutangRupiah = accounts.filter(a => a.balanceType === 'RECEIVABLE').reduce((sum, a) => sum + a.balanceRupiah, 0);
    return {
      key: person.key,
      counterpartyType: person.counterpartyType,
      counterpartyId: person.counterpartyId,
      counterpartyName: person.counterpartyName,
      hutangRupiah,
      piutangRupiah,
      accounts
    };
  }).sort((a, b) => a.counterpartyName.localeCompare(b.counterpartyName, 'id'));

  return {
    persons: personList,
    totals: {
      hutangRupiah: personList.reduce((sum, p) => sum + p.hutangRupiah, 0),
      piutangRupiah: personList.reduce((sum, p) => sum + p.piutangRupiah, 0)
    },
    // internal: dipakai payHutang untuk alokasi FIFO, tidak dikirim ke UI.
    _orpItems: orpItems
  };
}

function publicSummary(summary) {
  const { _orpItems, ...rest } = summary;
  return rest;
}

// ------------------------------------------------------ Rekening Bersama ---

export async function listSharedAccountsForPayment(db, store) {
  if (!store.entityId) return [];
  const rows = await db.prepare(`
    SELECT sa.id, sa.name,
           COALESCE((SELECT SUM(CASE WHEN l.direction = 'IN' THEN l.amount ELSE -l.amount END)
                     FROM entity_shared_account_ledger l
                     WHERE l.shared_account_id = sa.id AND l.store_id = ?), 0) AS store_balance
    FROM entity_shared_accounts sa
    WHERE sa.entity_id = ? AND sa.is_active = 1
    ORDER BY sa.name COLLATE NOCASE
  `).bind(store.id, store.entityId).all();
  return (rows.results ?? []).map(row => ({ id: row.id, name: row.name, storeBalance: Number(row.store_balance || 0) }));
}

async function resolvePaymentMethod(db, store, paymentMethod, sharedAccountId) {
  const method = text(paymentMethod, 20).toUpperCase();
  if (!PAYMENT_METHODS.has(method)) throw domainError('Pilih cara bayar: Tunai, Transfer Bank, atau Rekening Bersama.', 'PAYMENT_METHOD_REQUIRED');
  if (method !== 'REKBER') return { method, sharedAccount: null };
  const id = text(sharedAccountId, 80);
  if (!id) throw domainError('Pilih Rekening Bersama yang dipakai membayar.', 'SHARED_ACCOUNT_REQUIRED');
  const account = await db.prepare(`
    SELECT id, name FROM entity_shared_accounts WHERE id = ? AND entity_id = ? AND is_active = 1
  `).bind(id, store.entityId || '').first();
  if (!account) throw domainError('Rekening Bersama tidak aktif / bukan milik entity gerai ini.', 'SHARED_ACCOUNT_OUT_OF_SCOPE');
  return { method, sharedAccount: account };
}

// Uang keluar lewat Rekening Bersama = baris OUT sungguhan di ledger
// Rekening Bersama, mengurangi bagian gerai ini (bukan label). Source type
// EXPENSE (sudah diizinkan migration 0111), source_id = id pembayaran admin.
function sharedLedgerStatement(db, { ledgerId, sharedAccount, store, direction, amount, paymentId, note, actor, now }) {
  return db.prepare(`
    INSERT INTO entity_shared_account_ledger (
      id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, note,
      created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'EXPENSE', ?, ?, ?, ?, ?)
  `).bind(ledgerId, sharedAccount.id, store.entityId, store.id, direction, amount, paymentId, note, actor.role, actor.id, now);
}

// ----------------------------------------------------------- pembayaran ---

export async function payHutang(db, { store, actor, accountKey, amountRupiah, paymentMethod, sharedAccountId, businessDate, note }) {
  const amount = amountInput(amountRupiah);
  if (!amount) throw domainError('Nominal bayar harus bilangan bulat rupiah lebih dari nol.', 'AMOUNT_INVALID');
  const summary = await buildHutangPiutangSummary(db, store.id);
  let person = null;
  let account = null;
  for (const candidate of summary.persons) {
    const found = candidate.accounts.find(a => a.accountKey === accountKey);
    if (found) { person = candidate; account = found; break; }
  }
  if (!account) throw domainError('Hutang yang dipilih tidak ditemukan di gerai ini.', 'HUTANG_ACCOUNT_NOT_FOUND', 404);
  if (!account.payableByAdmin) throw domainError('Jenis ini tidak dilunasi dari layar Pembayaran Hutang (mis. piutang setoran laci punya alurnya sendiri).', 'HUTANG_ACCOUNT_NOT_PAYABLE', 409);

  const { method, sharedAccount } = await resolvePaymentMethod(db, store, paymentMethod, sharedAccountId);
  const date = businessDateInput(businessDate) || getJakartaBusinessDate();
  const now = new Date().toISOString();
  const paymentId = `admpay_${crypto.randomUUID()}`;
  const methodLabel = sharedAccount ? `Rekening Bersama ${sharedAccount.name}` : PAYMENT_METHOD_LABELS[method];
  const noteText = text(note, 300);
  const statements = [];

  let sharedLedgerId = null;
  if (sharedAccount) {
    sharedLedgerId = `shared_ledger_${crypto.randomUUID()}`;
    statements.push(sharedLedgerStatement(db, {
      ledgerId: sharedLedgerId, sharedAccount, store, direction: 'OUT', amount, paymentId,
      note: `Pelunasan ${account.label} · ${person.counterpartyName}`, actor, now
    }));
  }

  statements.push(db.prepare(`
    INSERT INTO admin_payments (
      id, store_id, entity_id, kind, hutang_account, counterparty_type, counterparty_id, counterparty_name,
      amount, payment_method, shared_account_id, shared_ledger_id, business_date, note,
      created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, 'HUTANG', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    paymentId, store.id, store.entityId || null, account.account, person.counterpartyType, person.counterpartyId,
    person.counterpartyName, amount, method, sharedAccount?.id || null, sharedLedgerId, date, noteText,
    actor.role, actor.id, now
  ));

  const amountScaled = amount * SCALE;
  if (account.account === 'GAJI') {
    // entry_type PAYMENT sudah disiapkan migration 0116. Beban 0 -- beban
    // gajinya sudah diakui saat akrual presensi / Bea Gaji.
    statements.push(db.prepare(`
      INSERT INTO payroll_ledger_entries (
        id, employee_id, account_type, account_id, store_id, business_date, entry_type,
        hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id,
        description, created_by_role, created_by_id, created_at
      ) VALUES (?, ?, NULL, NULL, ?, ?, 'PAYMENT', ?, 0, 'BEA_OPERASIONAL', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      `paygaji_${crypto.randomUUID()}`, person.counterpartyId, store.id, date, -amountScaled, paymentId,
      `Pelunasan Hutang Gaji · ${methodLabel}${noteText ? ` · ${noteText}` : ''}`, actor.role, actor.id
    ));
  } else {
    // Alokasi FIFO: tagihan tertua dilunasi dulu. Kelebihan bayar ditaruh di
    // tagihan terakhir yang disentuh (saldo jadi minus = kelebihan bayar,
    // bukan bug -- CLAUDE.md invariant #8).
    const items = summary._orpItems
      .filter(item => `${item.account}|${counterpartyKey(item.counterpartyType, item.counterpartyId, item.counterpartyName)}` === accountKey);
    if (!items.length) throw domainError('Rincian hutang tidak ditemukan.', 'HUTANG_ITEMS_NOT_FOUND', 404);
    const allocations = new Map();
    let remaining = amountScaled;
    for (const item of items.filter(i => i.balanceScaled > 0)) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, item.balanceScaled);
      allocations.set(item.id, { item, amount: take });
      remaining -= take;
    }
    if (remaining > 0) {
      const target = allocations.size ? [...allocations.values()].at(-1).item : items.at(-1);
      const current = allocations.get(target.id);
      allocations.set(target.id, { item: target, amount: (current?.amount || 0) + remaining });
    }
    for (const { item, amount: allocated } of allocations.values()) {
      statements.push(db.prepare(`
        INSERT INTO operational_receivable_payable_payments (
          id, receivable_payable_id, store_id, entity_id, amount, approval_status,
          proof_reference, note, submitted_by, admin_payment_id
        ) VALUES (?, ?, ?, ?, ?, 'approved', '', ?, ?, ?)
      `).bind(
        newId('ORPP'), item.id, store.id, item.entityId, allocated,
        `${methodLabel}${noteText ? ` · ${noteText}` : ''}`, `${actor.role}:${actor.id}`, paymentId
      ));
    }
  }

  await db.batch(statements);
  return getPayment(db, store.id, paymentId);
}

export async function payLainnya(db, { store, actor, category, description, counterpartyName, amountRupiah, paymentMethod, sharedAccountId, businessDate, note }) {
  const cat = text(category, 20).toUpperCase();
  if (!LAINNYA_CATEGORIES.has(cat)) throw domainError('Jenis pembayaran lainnya: Bea Lapak atau Bea Lainnya.', 'CATEGORY_INVALID');
  const desc = text(description, 220);
  if (!desc) throw domainError('Keterangan wajib diisi.', 'DESCRIPTION_REQUIRED');
  const amount = amountInput(amountRupiah);
  if (!amount) throw domainError('Nominal harus bilangan bulat rupiah lebih dari nol.', 'AMOUNT_INVALID');
  const { method, sharedAccount } = await resolvePaymentMethod(db, store, paymentMethod, sharedAccountId);
  const date = businessDateInput(businessDate) || getJakartaBusinessDate();
  const now = new Date().toISOString();
  const paymentId = `admpay_${crypto.randomUUID()}`;
  const expenseId = `beaops_${crypto.randomUUID()}`;
  const party = text(counterpartyName, 200);
  const statements = [
    db.prepare(`
      INSERT INTO admin_operational_expenses (
        id, store_id, category, employee_id, description, amount, business_date, note,
        created_by_role, created_by_id, created_at, settlement, counterparty_name, payment_method, shared_account_id
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'LANGSUNG', ?, ?, ?)
    `).bind(expenseId, store.id, cat, desc, amount, date, text(note, 500), actor.role, actor.id, party, method, sharedAccount?.id || null)
  ];
  let sharedLedgerId = null;
  if (sharedAccount) {
    sharedLedgerId = `shared_ledger_${crypto.randomUUID()}`;
    statements.push(sharedLedgerStatement(db, {
      ledgerId: sharedLedgerId, sharedAccount, store, direction: 'OUT', amount, paymentId,
      note: `Pembayaran lainnya · ${desc}`, actor, now
    }));
  }
  statements.push(db.prepare(`
    INSERT INTO admin_payments (
      id, store_id, entity_id, kind, hutang_account, counterparty_type, counterparty_id, counterparty_name,
      amount, payment_method, shared_account_id, shared_ledger_id, expense_id, business_date, note,
      created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, 'LAINNYA', '', 'OTHER', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    paymentId, store.id, store.entityId || null, party, amount, method, sharedAccount?.id || null,
    sharedLedgerId, expenseId, date, text(note, 300), actor.role, actor.id, now
  ));
  await db.batch(statements);
  await invalidateDailyProfitSnapshot(db, store.id, date);
  return getPayment(db, store.id, paymentId);
}

// Batalkan pembayaran: semua efeknya dibalik, tidak ada yang dihapus.
//   - Rekening Bersama: baris IN pembalik (ledger immutable, migration 0111)
//   - Hutang Gaji: baris PAYMENT-nya ditandai voided
//   - Hutang lain: alokasinya ditandai rejected (saldo cuma menghitung approved)
//   - Pembayaran Lainnya: Bea-nya ikut dibatalkan
export async function voidPayment(db, { store, actor, paymentId, reason }) {
  const payment = await db.prepare(`SELECT * FROM admin_payments WHERE id = ? AND store_id = ?`).bind(paymentId, store.id).first();
  if (!payment) throw domainError('Pembayaran tidak ditemukan di gerai ini.', 'PAYMENT_NOT_FOUND', 404);
  if (payment.voided_at) throw domainError('Pembayaran ini sudah dibatalkan.', 'ALREADY_VOIDED', 409);
  const now = new Date().toISOString();
  const reasonText = text(reason, 200);
  const statements = [];
  let voidLedgerId = null;
  if (payment.shared_ledger_id) {
    voidLedgerId = `shared_ledger_${crypto.randomUUID()}`;
    const sharedAccount = { id: payment.shared_account_id };
    statements.push(sharedLedgerStatement(db, {
      ledgerId: voidLedgerId, sharedAccount, store, direction: 'IN', amount: Number(payment.amount), paymentId,
      note: `Pembatalan pembayaran${reasonText ? ` · ${reasonText}` : ''}`, actor, now
    }));
  }
  statements.push(db.prepare(`
    UPDATE admin_payments
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?, void_shared_ledger_id = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, actor.role, actor.id, reasonText, voidLedgerId, paymentId, store.id));
  if (payment.kind === 'HUTANG' && payment.hutang_account === 'GAJI') {
    statements.push(db.prepare(`
      UPDATE payroll_ledger_entries
      SET voided_at = CURRENT_TIMESTAMP, voided_by_role = ?, voided_by_id = ?, void_reason = ?
      WHERE source_type = 'BEA_OPERASIONAL' AND source_id = ? AND entry_type = 'PAYMENT' AND voided_at IS NULL
    `).bind(actor.role, actor.id, reasonText || 'Pembayaran dibatalkan', paymentId));
  } else if (payment.kind === 'HUTANG') {
    statements.push(db.prepare(`
      UPDATE operational_receivable_payable_payments
      SET approval_status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?
      WHERE admin_payment_id = ? AND store_id = ? AND approval_status = 'approved'
    `).bind(`${actor.role}:${actor.id}`, now, `Pembayaran dibatalkan${reasonText ? `: ${reasonText}` : ''}`, paymentId, store.id));
  } else if (payment.expense_id) {
    statements.push(db.prepare(`
      UPDATE admin_operational_expenses
      SET voided_at = CURRENT_TIMESTAMP, voided_by_role = ?, voided_by_id = ?, void_reason = ?
      WHERE id = ? AND store_id = ? AND voided_at IS NULL
    `).bind(actor.role, actor.id, reasonText || 'Pembayaran dibatalkan', payment.expense_id, store.id));
  }
  await db.batch(statements);
  if (payment.expense_id) await invalidateDailyProfitSnapshot(db, store.id, payment.business_date);
  return getPayment(db, store.id, paymentId);
}

function mapPayment(row) {
  return row ? {
    id: row.id,
    kind: row.kind,
    hutangAccount: row.hutang_account || '',
    hutangLabel: row.kind === 'HUTANG' ? (HUTANG_ACCOUNT_LABELS[row.hutang_account] || row.hutang_account) : 'Pembayaran Lainnya',
    counterpartyType: row.counterparty_type,
    counterpartyId: row.counterparty_id || null,
    counterpartyName: row.counterparty_name || '',
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    paymentMethodLabel: row.payment_method === 'REKBER' ? `Rekening Bersama ${row.shared_account_name || ''}`.trim() : PAYMENT_METHOD_LABELS[row.payment_method],
    sharedAccountId: row.shared_account_id || null,
    expenseId: row.expense_id || null,
    expenseDescription: row.expense_description || '',
    businessDate: row.business_date,
    note: row.note || '',
    createdByRole: row.created_by_role || '',
    createdAt: row.created_at,
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || ''
  } : null;
}

const PAYMENT_SELECT = `
  SELECT ap.*, sa.name AS shared_account_name, e.description AS expense_description
  FROM admin_payments ap
  LEFT JOIN entity_shared_accounts sa ON sa.id = ap.shared_account_id
  LEFT JOIN admin_operational_expenses e ON e.id = ap.expense_id
`;

async function getPayment(db, storeId, id) {
  return mapPayment(await db.prepare(`${PAYMENT_SELECT} WHERE ap.id = ? AND ap.store_id = ?`).bind(id, storeId).first());
}

export async function listPayments(db, storeId, { from, to, limit = 200 } = {}) {
  const clauses = ['ap.store_id = ?'];
  const values = [storeId];
  if (from) { clauses.push('ap.business_date >= ?'); values.push(from); }
  if (to) { clauses.push('ap.business_date <= ?'); values.push(to); }
  const rows = await db.prepare(`${PAYMENT_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ap.business_date DESC, ap.created_at DESC LIMIT ?`)
    .bind(...values, limit).all();
  return (rows.results ?? []).map(mapPayment);
}

// ------------------------------------------------------- Laporan Beban ---

// Bos Cyo, 2026-09-26: "tambahkan juga data beban2 ya bisa aku track dan aku
// pelajari kedepannya kita butuh apa untuk melengkapi sistem ini". Semua
// sumber yang sudah dihitung Laporan Net Profit sebagai Beban, dirinci per
// baris (bukan cuma total) supaya kelihatan beban apa saja yang masuk,
// dari mana, ke siapa, dan dibayar/dihutang lewat apa. Read-only.
export async function buildBebanReport(db, storeId, { from, to }) {
  const [kasir, admin, gaji, stock] = await Promise.all([
    db.prepare(`
      SELECT x.id, date(x.created_at, '+7 hours') AS business_date, x.description, x.amount, x.payment_method,
             COALESCE(cm.name, '') AS cost_name, COALESCE(pm.name, x.payment_method) AS payment_label
      FROM expenses x
      LEFT JOIN cost_masters cm ON cm.id = x.cost_master_id
      LEFT JOIN payment_methods pm ON pm.store_id = x.store_id AND pm.code = x.payment_method
      WHERE x.store_id = ? AND x.voided_at IS NULL AND date(x.created_at, '+7 hours') BETWEEN ? AND ?
    `).bind(storeId, from, to).all(),
    db.prepare(`
      SELECT e.id, e.business_date, e.category, e.description, e.amount, e.settlement, e.payment_method,
             COALESCE(NULLIF(e.counterparty_name, ''), emp.full_name, r.counterparty_name_snapshot, '') AS party,
             sa.name AS shared_account_name
      FROM admin_operational_expenses e
      LEFT JOIN employees emp ON emp.id = e.employee_id
      LEFT JOIN operational_receivables_payables r ON r.source_id = e.id AND r.store_id = e.store_id AND r.source_type IN ('BEA_LAPAK', 'BEA_LAINNYA')
      LEFT JOIN entity_shared_accounts sa ON sa.id = e.shared_account_id
      WHERE e.store_id = ? AND e.voided_at IS NULL AND e.business_date BETWEEN ? AND ?
    `).bind(storeId, from, to).all(),
    db.prepare(`
      SELECT l.id, l.business_date, l.description, l.beban_gaji_delta_scaled, emp.full_name
      FROM payroll_ledger_entries l
      LEFT JOIN employees emp ON emp.id = l.employee_id
      WHERE l.store_id = ? AND l.entry_type = 'ACCRUAL' AND l.voided_at IS NULL AND l.business_date BETWEEN ? AND ?
    `).bind(storeId, from, to).all(),
    db.prepare(`
      SELECT id, date(posted_at, '+7 hours') AS business_date,
             json_extract(payload_json, '$.productName') AS product_name,
             json_extract(payload_json, '$.totalCostSnapshotScaled') AS value_scaled
      FROM approval_requests
      WHERE store_id = ? AND request_type = 'GOODS_FLOW' AND posting_status = 'posted'
        AND json_extract(payload_json, '$.purpose') = 'STOCK_ADJUSTMENT'
        AND json_extract(payload_json, '$.direction') = 'OUT'
        AND date(posted_at, '+7 hours') BETWEEN ? AND ?
    `).bind(storeId, from, to).all()
  ]);

  const CATEGORY_LABEL = { BEA_GAJI: 'Bea Gaji', BEA_LAPAK: 'Bea Lapak', BEA_LAINNYA: 'Bea Lainnya' };
  const rows = [
    ...(kasir.results ?? []).map(row => ({
      id: row.id, businessDate: row.business_date, source: 'KASIR', sourceLabel: 'Pengeluaran Kasir',
      category: row.cost_name || 'Pengeluaran Kasir', description: row.description, party: '',
      amount: Number(row.amount || 0), status: `Dibayar · ${row.payment_label || row.payment_method}`
    })),
    ...(admin.results ?? []).map(row => ({
      id: row.id, businessDate: row.business_date, source: 'ADMIN', sourceLabel: 'Bea Operasional Admin',
      category: CATEGORY_LABEL[row.category] || row.category, description: row.description, party: row.party || '',
      amount: Number(row.amount || 0),
      status: row.settlement === 'HUTANG'
        ? 'Jadi Hutang'
        : `Dibayar langsung${row.payment_method ? ` · ${row.payment_method === 'REKBER' ? `Rekening Bersama ${row.shared_account_name || ''}`.trim() : (PAYMENT_METHOD_LABELS[row.payment_method] || row.payment_method)}` : ''}`
    })),
    ...(gaji.results ?? []).map(row => ({
      id: row.id, businessDate: row.business_date, source: 'PRESENSI', sourceLabel: 'Gaji dari Presensi',
      category: 'Gaji (presensi)', description: row.description || 'Akrual presensi', party: row.full_name || '(akun belum ditautkan ke karyawan)',
      amount: rupiah(row.beban_gaji_delta_scaled), status: 'Jadi Hutang Gaji'
    })),
    ...(stock.results ?? []).map(row => ({
      id: row.id, businessDate: row.business_date, source: 'STOK', sourceLabel: 'Penyesuaian Stok',
      category: 'Selisih stok (kurang)', description: row.product_name || 'Penyesuaian stok', party: '',
      amount: rupiah(row.value_scaled), status: 'Kehilangan stok'
    }))
  ].sort((a, b) => (a.businessDate === b.businessDate ? 0 : a.businessDate < b.businessDate ? 1 : -1));

  const byCategory = new Map();
  const bySource = new Map();
  for (const row of rows) {
    const cat = byCategory.get(row.category) || { category: row.category, total: 0, count: 0 };
    cat.total += row.amount; cat.count += 1; byCategory.set(row.category, cat);
    const src = bySource.get(row.source) || { source: row.source, sourceLabel: row.sourceLabel, total: 0, count: 0 };
    src.total += row.amount; src.count += 1; bySource.set(row.source, src);
  }
  return {
    from, to, rows,
    byCategory: [...byCategory.values()].sort((a, b) => b.total - a.total),
    bySource: [...bySource.values()].sort((a, b) => b.total - a.total),
    total: rows.reduce((sum, row) => sum + row.amount, 0)
  };
}

// --------------------------------------- Pembelian kasir -> Hutang Supplier

// Bos Cyo, 2026-09-26: "yang cara bayarnya hutang ke suplier ikut
// disambungkan ke catatan hutang kita". Cara bayar mana yang artinya hutang
// DITANDAI ADMIN SENDIRI (payment_methods.creates_payable, Setting Akuntansi
// > Metode Pembayaran) -- di produksi kasir tidak memakai PAYABLE bawaan,
// mereka memakai cara bayar buatan admin (mis. "Piutang Poci Malang"), jadi
// Hana tidak menebak. Pihaknya = Supplier yang dipilih di pembelian; kalau
// kosong, nama cara bayarnya.
export function purchasePayableStatement(db, { purchaseId, store, supplier, paymentMethod, totalAmount, businessDate, description }) {
  if (!store.entityId || !(Number(totalAmount) > 0)) return null;
  const counterpartyType = supplier ? 'SUPPLIER' : 'OTHER';
  return db.prepare(`
    INSERT INTO operational_receivables_payables (
      id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id,
      counterparty_name_snapshot, description, original_amount, transaction_date, counterparty_type
    ) VALUES (?, ?, ?, 'PURCHASE_PAYABLE', 'PAYABLE', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newId('ORP'), store.id, store.entityId, purchaseId, supplier?.id || null,
    supplier?.name || paymentMethod.name, text(description, 300), Number(totalAmount) * SCALE, businessDate, counterpartyType
  );
}

// Waktu admin baru menandai sebuah cara bayar sebagai "Jadi Hutang", pembelian
// lama yang memakai cara bayar itu ikut ditarik jadi Hutang (idempotent: yang
// sudah punya baris hutang tidak dibuat dua kali; yang sudah dibatalkan
// tidak ditarik).
export async function backfillPurchasePayables(db, store, paymentMethodCode) {
  if (!store.entityId) return 0;
  const result = await db.prepare(`
    INSERT INTO operational_receivables_payables (
      id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id,
      counterparty_name_snapshot, description, original_amount, transaction_date, counterparty_type
    )
    SELECT 'ORP-' || lower(hex(randomblob(12))), p.store_id, ?, 'PURCHASE_PAYABLE', 'PAYABLE', p.id, p.supplier_id,
           COALESCE(s.name, pm.name), p.description, p.total_amount * ${SCALE}, date(p.created_at, '+7 hours'),
           CASE WHEN s.id IS NOT NULL THEN 'SUPPLIER' ELSE 'OTHER' END
    FROM purchases p
    JOIN payment_methods pm ON pm.store_id = p.store_id AND pm.code = p.payment_method
    LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.store_id = p.store_id
    WHERE p.store_id = ? AND p.payment_method = ? AND p.voided_at IS NULL AND p.total_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM operational_receivables_payables r
        WHERE r.store_id = p.store_id AND r.source_type = 'PURCHASE_PAYABLE' AND r.source_id = p.id
      )
  `).bind(store.entityId, store.id, paymentMethodCode).run();
  return Number(result.meta?.changes || 0);
}

// ------------------------------------------------------------- routing ---

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

function errorResponse(error) {
  if (error?.code && error?.status) return json({ error: error.message, code: error.code }, error.status);
  throw error;
}

export async function handleHutangPiutangApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/hutang-piutang') && pathname !== '/api/admin/laporan-beban') return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  if (auth.authType === 'LEGACY_PIN') {
    return json({ error: 'Pembayaran & laporan Hutang Piutang butuh akun Admin Gerai, Entity Admin, atau Owner.', code: 'ACCOUNT_REQUIRED' }, 403);
  }
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const actor = actorFrom(auth);
  const url = new URL(request.url);

  try {
    if (request.method === 'GET' && pathname === '/api/admin/laporan-beban') {
      const today = getJakartaBusinessDate();
      const to = businessDateInput(url.searchParams.get('to')) || today;
      const from = businessDateInput(url.searchParams.get('from')) || `${to.slice(0, 8)}01`;
      if (from > to) return json({ error: 'Tanggal awal harus sebelum tanggal akhir.' }, 400);
      return json({ store, ...(await buildBebanReport(db, store.id, { from, to })) });
    }

    if (request.method === 'GET' && pathname === '/api/admin/hutang-piutang') {
      const [summary, sharedAccounts, payments] = await Promise.all([
        buildHutangPiutangSummary(db, store.id),
        listSharedAccountsForPayment(db, store),
        listPayments(db, store.id, { limit: 100 })
      ]);
      return json({
        store,
        today: getJakartaBusinessDate(),
        ...publicSummary(summary),
        sharedAccounts,
        paymentMethods: Object.entries(PAYMENT_METHOD_LABELS).map(([code, label]) => ({ code, label })),
        payments
      });
    }

    if (request.method === 'POST' && pathname === '/api/admin/hutang-piutang/payments') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload pembayaran tidak valid.' }, 400);
      const payment = await payHutang(db, {
        store, actor,
        accountKey: text(body.value?.accountKey, 400),
        amountRupiah: body.value?.amount,
        paymentMethod: body.value?.paymentMethod,
        sharedAccountId: body.value?.sharedAccountId,
        businessDate: body.value?.businessDate,
        note: body.value?.note
      });
      return json({ ok: true, payment, ...publicSummary(await buildHutangPiutangSummary(db, store.id)), sharedAccounts: await listSharedAccountsForPayment(db, store) }, 201);
    }

    if (request.method === 'POST' && pathname === '/api/admin/hutang-piutang/pembayaran-lainnya') {
      const body = await readJson(request);
      if (!body.ok) return json({ error: 'Payload pembayaran tidak valid.' }, 400);
      const payment = await payLainnya(db, {
        store, actor,
        category: body.value?.category,
        description: body.value?.description,
        counterpartyName: body.value?.counterpartyName,
        amountRupiah: body.value?.amount,
        paymentMethod: body.value?.paymentMethod,
        sharedAccountId: body.value?.sharedAccountId,
        businessDate: body.value?.businessDate,
        note: body.value?.note
      });
      return json({ ok: true, payment, sharedAccounts: await listSharedAccountsForPayment(db, store) }, 201);
    }

    const voidMatch = pathname.match(/^\/api\/admin\/hutang-piutang\/payments\/([^/]+)\/void$/);
    if (request.method === 'POST' && voidMatch) {
      const body = await readJson(request);
      const payment = await voidPayment(db, {
        store, actor, paymentId: decodeURIComponent(voidMatch[1]), reason: body.ok ? body.value?.reason : ''
      });
      return json({ ok: true, payment, ...publicSummary(await buildHutangPiutangSummary(db, store.id)), sharedAccounts: await listSharedAccountsForPayment(db, store) });
    }

    if (request.method === 'GET' && pathname === '/api/admin/hutang-piutang/payments') {
      return json({
        payments: await listPayments(db, store.id, {
          from: businessDateInput(url.searchParams.get('from')),
          to: businessDateInput(url.searchParams.get('to'))
        })
      });
    }
  } catch (error) {
    return errorResponse(error);
  }

  return json({ error: 'Route Hutang Piutang tidak ditemukan.' }, 404);
}

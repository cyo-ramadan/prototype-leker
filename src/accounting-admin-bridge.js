import { json } from './http.js';
import { ACCOUNTING_AMOUNT_SCALE, getAccountingJournal, postAccountingJournal } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';

// ADR-046, Bos Cyo 2026-09-27: "dari awal uda konek akuntansi tapi kita buat
// agar orang awam pun ga perlu setting2 akuntansi, kita uda tentuin setiap
// transaksi bikin jurnal ini dan itu." Lane posting Accounting untuk fakta
// fitur admin -- Bea Operasional, Pembayaran Hutang/Piutang, Pembayaran
// Lainnya, gaji presensi, Uang Muka/Deposit -- dengan pola yang sama persis
// dengan accounting-cash-flow-bridge.js: dipanggil SESUDAH fakta operasional
// commit, membaca Setting Akuntansi (transaction_categories + journal_rules,
// migration 0123), mencatat hasilnya di accounting_bridge_deliveries, dan
// gagal-lembut -- transaksi operasional tidak pernah ikut batal.
//
// Hanya fakta BARU (Bos Cyo: "data lama biarin tanpa akuntansi"). Tidak ada
// backfill; membatalkan fakta lama yang tidak pernah dijurnal = tidak perlu
// jurnal pembalik.

export const ACCOUNTING_ADMIN_BRIDGE_CONTRACT = 'MAXI_ACCOUNTING_ADMIN_BRIDGE_V1';
const PRODUCER = 'ADMIN';
const SOURCE_SYSTEM = 'LEKER_ADMIN';
const BEA_CATEGORY = Object.freeze({ BEA_GAJI: 'admin_gaji', BEA_LAPAK: 'admin_bea_lapak', BEA_LAINNYA: 'admin_bea_lainnya' });
const HUTANG_CATEGORY = Object.freeze({ GAJI: 'admin_gaji', BEA_LAPAK: 'admin_bea_lapak', BEA_LAINNYA: 'admin_bea_lainnya' });
const BEA_LABEL = Object.freeze({ BEA_GAJI: 'Bea Gaji', BEA_LAPAK: 'Bea Lapak', BEA_LAINNYA: 'Bea Lainnya' });
const METHOD_LABEL = Object.freeze({ KAS: 'Tunai', BANK: 'Bank', REKBER: 'Rekening Bersama', DEPOSIT: 'Uang Muka / Deposit' });

const text = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const outcome = (status, code = '', error = '', extra = {}) => ({ ok: status === 'POSTED', status, code, error, ...extra });
const needs = (code, error) => outcome('NEEDS_CONFIGURATION', code, error);
const failed = (code, error) => outcome('FAILED', code, error);

function rupiahToScaled(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return null;
  const scaled = amount * ACCOUNTING_AMOUNT_SCALE;
  return Number.isSafeInteger(scaled) ? scaled : null;
}

// ------------------------------------------------------------ Setting ---

async function categoryAccounts(db, storeId, code) {
  const rows = await db.prepare(`
    SELECT r.side, r.source_type, r.label, r.fixed_account_id, a.id AS active_account_id
    FROM transaction_categories c
    JOIN journal_rules r ON r.transaction_category_id = c.id AND r.store_id = c.store_id AND r.is_active = 1
    LEFT JOIN chart_of_accounts a ON a.id = r.fixed_account_id AND a.store_id = r.store_id AND a.is_active = 1
    WHERE c.store_id = ? AND c.code = ? AND c.is_active = 1
    ORDER BY r.sort_order, r.id
  `).bind(storeId, code).all();
  const list = rows.results ?? [];
  if (!list.length) return null;
  const pick = side => list.find(row => row.side === side) || null;
  const debit = pick('DEBIT');
  const credit = pick('CREDIT');
  return {
    debitAccountId: debit?.source_type === 'fixed_account' ? debit.active_account_id || null : null,
    creditAccountId: credit?.source_type === 'fixed_account' ? credit.active_account_id || null : null
  };
}

// Akun Uang Muka = akun Debit Jenis Transaksi "Uang Muka / Deposit". Dipakai
// juga oleh Pembelian kasir yang dibayar dari Deposit (accounting-pos-bridge).
export async function uangMukaAccountId(db, storeId) {
  return (await categoryAccounts(db, storeId, 'admin_uang_muka'))?.debitAccountId || null;
}

// Cara bayar admin -> akun. Tunai/Bank ikut akun cara bayar POS CASH/BANK di
// Setting Akuntansi (sama dengan Arus Kas), Rekening Bersama = akun 1103,
// Deposit = akun Uang Muka.
async function settlementAccountId(db, storeId, method) {
  if (method === 'KAS' || method === 'BANK') {
    const row = await db.prepare(`
      SELECT a.id FROM payment_methods p
      JOIN chart_of_accounts a ON a.id = p.account_id AND a.store_id = p.store_id AND a.is_active = 1
      WHERE p.store_id = ? AND p.code = ? AND p.is_active = 1
      LIMIT 1
    `).bind(storeId, method === 'KAS' ? 'CASH' : 'BANK').first();
    return row?.id || null;
  }
  if (method === 'REKBER') {
    const row = await db.prepare(`SELECT id FROM chart_of_accounts WHERE store_id = ? AND code = '1103' AND is_active = 1 LIMIT 1`).bind(storeId).first();
    return row?.id || null;
  }
  if (method === 'DEPOSIT') return uangMukaAccountId(db, storeId);
  return null;
}

// ------------------------------------------------------------- delivery ---

async function existingDelivery(db, storeId, factType, factId) {
  return db.prepare(`
    SELECT status, journal_id FROM accounting_bridge_deliveries
    WHERE store_id = ? AND producer_module = ? AND fact_type = ? AND fact_id = ?
    LIMIT 1
  `).bind(storeId, PRODUCER, factType, factId).first();
}

async function saveDelivery(db, storeId, factType, factId, categoryCode, value) {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO accounting_bridge_deliveries (
      id, store_id, producer_module, fact_type, fact_id, transaction_category_code,
      status, journal_id, failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(store_id, producer_module, fact_type, fact_id) DO UPDATE SET
      transaction_category_code = excluded.transaction_category_code,
      status = excluded.status,
      journal_id = excluded.journal_id,
      failure_code = excluded.failure_code,
      failure_detail = excluded.failure_detail,
      attempts = accounting_bridge_deliveries.attempts + 1,
      last_attempt_at = excluded.last_attempt_at,
      updated_at = excluded.updated_at
  `).bind(
    `accounting_admin_${crypto.randomUUID()}`, storeId, PRODUCER, factType, factId, categoryCode || '',
    value.status, value.journalId || null, value.code || '', text(value.error, 500), now, now, now
  ).run();
}

async function isAccountingStore(db, storeId) {
  const row = await db.prepare('SELECT edition FROM stores WHERE id = ? LIMIT 1').bind(storeId).first();
  return row?.edition === 'ACCOUNTING';
}

// ------------------------------------------------------------- builders ---
// Tiap builder mengembalikan { storeId, categoryCode, businessDate,
// description, lines } atau { skip: true } (tidak ada yang perlu dijurnal)
// atau { storeId, categoryCode, failure } (disimpan sebagai delivery gagal).

function twoLines(debitAccountId, creditAccountId, amountScaled, debitLabel, creditLabel) {
  // Nominal minus (potongan Bea Gaji) = sisi Debit/Kredit ditukar, jurnal
  // tetap positif (KNOWN_PITFALLS "Saldo negatif bukan jurnal tidak balance").
  const [dr, cr, drLabel, crLabel] = amountScaled < 0
    ? [creditAccountId, debitAccountId, creditLabel, debitLabel]
    : [debitAccountId, creditAccountId, debitLabel, creditLabel];
  const amount = Math.abs(amountScaled);
  return [
    { accountId: dr, side: 'DEBIT', amountScaled: amount, description: drLabel },
    { accountId: cr, side: 'CREDIT', amountScaled: amount, description: crLabel }
  ];
}

async function buildBea(db, expenseId) {
  const row = await db.prepare(`
    SELECT id, store_id, category, description, amount, business_date, settlement, payment_method, voided_at
    FROM admin_operational_expenses WHERE id = ? LIMIT 1
  `).bind(expenseId).first();
  if (!row) return { skip: true };
  const categoryCode = BEA_CATEGORY[row.category];
  const base = { storeId: row.store_id, categoryCode: categoryCode || '' };
  if (!categoryCode) return { ...base, failure: failed('BEA_CATEGORY_UNSUPPORTED', `Kategori ${row.category} belum punya jurnal.`) };
  const accounts = await categoryAccounts(db, row.store_id, categoryCode);
  if (!accounts) return { ...base, failure: needs('NEEDS_TRANSACTION_MAPPING', `Jenis transaksi ${categoryCode} belum aktif di Setting Akuntansi.`) };
  if (!accounts.debitAccountId) return { ...base, failure: needs('NEEDS_FIXED_ACCOUNT', `Akun Beban untuk ${BEA_LABEL[row.category]} belum aktif.`) };

  const settledNow = row.settlement === 'LANGSUNG';
  const creditAccountId = settledNow
    ? await settlementAccountId(db, row.store_id, row.payment_method)
    : accounts.creditAccountId;
  if (!creditAccountId) {
    return {
      ...base,
      failure: settledNow
        ? needs('NEEDS_PAYMENT_MAPPING', `Cara bayar ${METHOD_LABEL[row.payment_method] || row.payment_method || '-'} belum punya akun.`)
        : needs('NEEDS_FIXED_ACCOUNT', `Akun Utang untuk ${BEA_LABEL[row.category]} belum aktif.`)
    };
  }
  const amountScaled = rupiahToScaled(row.amount);
  if (!amountScaled) return { ...base, failure: failed('AMOUNT_INVALID', 'Nominal Bea tidak valid.') };
  const label = BEA_LABEL[row.category];
  return {
    ...base,
    businessDate: row.business_date,
    description: `${label} · ${text(row.description, 200)}`,
    lines: twoLines(
      accounts.debitAccountId, creditAccountId, amountScaled, label,
      settledNow ? `Dibayar · ${METHOD_LABEL[row.payment_method] || row.payment_method}` : `Utang · ${label}`
    )
  };
}

async function buildGajiPresensi(db, entryId) {
  const row = await db.prepare(`
    SELECT id, store_id, business_date, entry_type, beban_gaji_delta_scaled, description, voided_at
    FROM payroll_ledger_entries WHERE id = ? LIMIT 1
  `).bind(entryId).first();
  if (!row || row.entry_type !== 'ACCRUAL' || row.voided_at) return { skip: true };
  const amountScaled = Number(row.beban_gaji_delta_scaled);
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) return { skip: true };
  const base = { storeId: row.store_id, categoryCode: 'admin_gaji' };
  const accounts = await categoryAccounts(db, row.store_id, 'admin_gaji');
  if (!accounts) return { ...base, failure: needs('NEEDS_TRANSACTION_MAPPING', 'Jenis transaksi admin_gaji belum aktif di Setting Akuntansi.') };
  if (!accounts.debitAccountId || !accounts.creditAccountId) return { ...base, failure: needs('NEEDS_FIXED_ACCOUNT', 'Akun Beban Gaji / Utang Gaji belum aktif.') };
  return {
    ...base,
    businessDate: row.business_date,
    description: text(row.description, 200) || 'Gaji presensi',
    lines: twoLines(accounts.debitAccountId, accounts.creditAccountId, amountScaled, 'Beban Gaji presensi', 'Utang Gaji')
  };
}

async function buildBayarHutang(db, paymentId) {
  const row = await db.prepare(`
    SELECT id, store_id, kind, hutang_account, counterparty_name, amount, payment_method, business_date, voided_at
    FROM admin_payments WHERE id = ? LIMIT 1
  `).bind(paymentId).first();
  if (!row || row.kind !== 'HUTANG') return { skip: true };
  const base = { storeId: row.store_id, categoryCode: HUTANG_CATEGORY[row.hutang_account] || 'purchase_material' };
  const creditAccountId = await settlementAccountId(db, row.store_id, row.payment_method);
  if (!creditAccountId) return { ...base, failure: needs('NEEDS_PAYMENT_MAPPING', `Cara bayar ${METHOD_LABEL[row.payment_method] || row.payment_method} belum punya akun.`) };
  const totalScaled = rupiahToScaled(row.amount);
  if (!totalScaled || totalScaled <= 0) return { ...base, failure: failed('AMOUNT_INVALID', 'Nominal pembayaran tidak valid.') };

  // Debit = akun Utang yang dulu dikredit waktu hutangnya lahir.
  const debits = new Map();
  if (HUTANG_CATEGORY[row.hutang_account]) {
    const accounts = await categoryAccounts(db, row.store_id, HUTANG_CATEGORY[row.hutang_account]);
    if (!accounts?.creditAccountId) return { ...base, failure: needs('NEEDS_FIXED_ACCOUNT', `Akun Utang untuk ${row.hutang_account} belum aktif.`) };
    debits.set(accounts.creditAccountId, totalScaled);
  } else if (row.hutang_account === 'PURCHASE_PAYABLE') {
    // Hutang Pembelian dikredit ke akun cara bayar pembeliannya; satu
    // pelunasan FIFO bisa menyentuh beberapa pembelian dengan cara bayar beda.
    const rows = await db.prepare(`
      SELECT p.amount, a.id AS account_id
      FROM operational_receivable_payable_payments p
      JOIN operational_receivables_payables r ON r.id = p.receivable_payable_id AND r.store_id = p.store_id
      LEFT JOIN purchases pu ON pu.id = r.source_id AND pu.store_id = r.store_id
      LEFT JOIN payment_methods pm ON pm.store_id = pu.store_id AND pm.code = pu.payment_method
      LEFT JOIN chart_of_accounts a ON a.id = pm.account_id AND a.store_id = pm.store_id AND a.is_active = 1
      WHERE p.admin_payment_id = ? AND p.store_id = ? AND r.source_type = 'PURCHASE_PAYABLE'
    `).bind(paymentId, row.store_id).all();
    for (const allocation of rows.results ?? []) {
      if (!allocation.account_id) return { ...base, failure: needs('NEEDS_PAYMENT_MAPPING', 'Cara bayar pembelian yang dilunasi belum punya akun Utang.') };
      debits.set(allocation.account_id, (debits.get(allocation.account_id) || 0) + Number(allocation.amount));
    }
    if (!debits.size) return { ...base, failure: failed('ALLOCATION_NOT_FOUND', 'Rincian pelunasan pembelian tidak ditemukan.') };
  } else {
    return { ...base, failure: failed('HUTANG_ACCOUNT_UNSUPPORTED', `Jenis hutang ${row.hutang_account} belum punya jurnal.`) };
  }

  const who = text(row.counterparty_name, 120);
  return {
    ...base,
    businessDate: row.business_date,
    description: `Pelunasan hutang${who ? ` · ${who}` : ''}`,
    lines: [
      ...[...debits].map(([accountId, amountScaled]) => ({ accountId, side: 'DEBIT', amountScaled, description: `Utang berkurang${who ? ` · ${who}` : ''}` })),
      { accountId: creditAccountId, side: 'CREDIT', amountScaled: totalScaled, description: `Dibayar · ${METHOD_LABEL[row.payment_method] || row.payment_method}` }
    ]
  };
}

async function buildUangMuka(db, depositId) {
  const row = await db.prepare(`
    SELECT id, store_id, source_type, counterparty_name_snapshot, description, original_amount, transaction_date, funding_method
    FROM operational_receivables_payables WHERE id = ? LIMIT 1
  `).bind(depositId).first();
  if (!row || !String(row.source_type).startsWith('DEPOSIT_') || !row.funding_method) return { skip: true };
  const base = { storeId: row.store_id, categoryCode: 'admin_uang_muka' };
  const debitAccountId = await uangMukaAccountId(db, row.store_id);
  if (!debitAccountId) return { ...base, failure: needs('NEEDS_FIXED_ACCOUNT', 'Akun Uang Muka / Deposit belum aktif.') };
  const creditAccountId = await settlementAccountId(db, row.store_id, row.funding_method);
  if (!creditAccountId) return { ...base, failure: needs('NEEDS_PAYMENT_MAPPING', `Cara bayar ${METHOD_LABEL[row.funding_method]} belum punya akun.`) };
  const amountScaled = Number(row.original_amount);
  if (!Number.isSafeInteger(amountScaled) || amountScaled <= 0) return { ...base, failure: failed('AMOUNT_INVALID', 'Nominal Uang Muka tidak valid.') };
  return {
    ...base,
    businessDate: row.transaction_date,
    description: `Uang Muka · ${text(row.counterparty_name_snapshot, 120)}${row.description ? ` · ${text(row.description, 120)}` : ''}`,
    lines: twoLines(debitAccountId, creditAccountId, amountScaled, 'Uang Muka / Deposit', `Dibayar · ${METHOD_LABEL[row.funding_method]}`)
  };
}

const BUILDERS = Object.freeze({
  BEA: buildBea,
  GAJI_PRESENSI: buildGajiPresensi,
  BAYAR_HUTANG: buildBayarHutang,
  UANG_MUKA: buildUangMuka
});

// ----------------------------------------------------------- backlog ---
// ADR-051 (Bos Cyo, 2026-10-02): "beban yang belum konek akuntansi mulailah
// digabungkan" -- menggantikan ADR-046 poin 4 (tanpa backfill). Fakta admin
// yang belum punya delivery POSTED (lahir sebelum 0123, lewat jalur yang dulu
// melewati jembatan, atau gagal karena setting) ikut disinkronkan lewat
// tombol sinkron Akuntansi yang sama dengan transaksi kasir. Idempotent:
// dispatchAdminAccountingFact memakai kunci LEKER_ADMIN:<fakta>:<id>.
// Urut created_at supaya hutang lahir (Bea) dijurnal sebelum pelunasannya.
const ADMIN_BACKLOG_SQL = `
  SELECT 'BEA' AS fact_type, e.id AS fact_id, e.created_at
  FROM admin_operational_expenses e
  WHERE e.store_id = ? AND e.voided_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = e.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'BEA' AND d.fact_id = e.id AND d.status = 'POSTED')
  UNION ALL
  SELECT 'GAJI_PRESENSI', p.id, p.created_at
  FROM payroll_ledger_entries p
  WHERE p.store_id = ? AND p.entry_type = 'ACCRUAL' AND p.voided_at IS NULL AND p.beban_gaji_delta_scaled > 0
    AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = p.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'GAJI_PRESENSI' AND d.fact_id = p.id AND d.status = 'POSTED')
  UNION ALL
  SELECT 'BAYAR_HUTANG', a.id, a.created_at
  FROM admin_payments a
  WHERE a.store_id = ? AND a.kind = 'HUTANG' AND a.voided_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = a.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'BAYAR_HUTANG' AND d.fact_id = a.id AND d.status = 'POSTED')
  UNION ALL
  SELECT 'UANG_MUKA', r.id, r.created_at
  FROM operational_receivables_payables r
  WHERE r.store_id = ? AND r.source_type LIKE 'DEPOSIT_%' AND r.funding_method <> ''
    AND NOT EXISTS (SELECT 1 FROM accounting_bridge_deliveries d WHERE d.store_id = r.store_id AND d.producer_module = 'ADMIN' AND d.fact_type = 'UANG_MUKA' AND d.fact_id = r.id AND d.status = 'POSTED')
`;

export async function pendingAdminFacts(db, storeId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = await db.prepare(`
    SELECT fact_type, fact_id, created_at FROM (${ADMIN_BACKLOG_SQL})
    ORDER BY created_at, fact_type, fact_id LIMIT ?
  `).bind(storeId, storeId, storeId, storeId, safeLimit).all();
  return rows.results ?? [];
}

export async function countPendingAdminFacts(db, storeId) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM (${ADMIN_BACKLOG_SQL})`).bind(storeId, storeId, storeId, storeId).first();
  return Number(row?.count || 0);
}

// ------------------------------------------------------------- dispatch ---

export async function dispatchAdminAccountingFact(db, factType, factId) {
  const type = text(factType, 40).toUpperCase();
  const id = text(factId, 180);
  const build = BUILDERS[type];
  if (!build || !id) return failed('FACT_REFERENCE_INVALID', 'Referensi fakta admin tidak valid.');

  const built = await build(db, id);
  if (built.skip) return outcome('NOT_REQUIRED');
  if (!(await isAccountingStore(db, built.storeId))) return outcome('NOT_REQUIRED', 'NON_ACCOUNTING_EDITION');

  const previous = await existingDelivery(db, built.storeId, type, id);
  if (previous?.status === 'POSTED' && previous.journal_id) return outcome('POSTED', '', '', { duplicate: true, journalId: previous.journal_id });

  if (built.failure) {
    await saveDelivery(db, built.storeId, type, id, built.categoryCode, built.failure);
    return built.failure;
  }

  let posted;
  try {
    posted = await postAccountingJournal(db, { id: built.storeId }, {
      businessDate: built.businessDate,
      occurredAt: new Date().toISOString(),
      sourceSystem: SOURCE_SYSTEM,
      sourceReferenceId: `${type}:${id}`,
      correlationId: id,
      idempotencyKey: `${SOURCE_SYSTEM}:${type}:${id}`,
      description: built.description,
      journalLines: built.lines
    });
  } catch (error) {
    const value = failed('ACCOUNTING_POST_FAILED', text(error?.message || error, 500));
    await saveDelivery(db, built.storeId, type, id, built.categoryCode, value);
    return value;
  }
  const value = posted.ok
    ? outcome('POSTED', '', '', { journalId: posted.journal.journalId, journalNumber: posted.journal.journalNumber, duplicate: Boolean(posted.duplicate) })
    : outcome(posted.code?.startsWith('NEEDS_') ? 'NEEDS_CONFIGURATION' : 'FAILED', posted.code || 'ACCOUNTING_POST_FAILED', posted.error || 'Accounting posting gagal.');
  await saveDelivery(db, built.storeId, type, id, built.categoryCode, value);
  return value;
}

// Fakta yang dibatalkan: jurnal aslinya dibalik persis (Debit <-> Kredit),
// posted journal tidak pernah diedit (CLAUDE.md invariant #2). Fakta yang
// tidak pernah dijurnal (data lama / belum terkonfigurasi) tidak perlu dibalik.
export async function reverseAdminAccountingFact(db, factType, factId, reason = '') {
  const type = text(factType, 40).toUpperCase();
  const id = text(factId, 180);
  const delivery = await db.prepare(`
    SELECT store_id, status, journal_id, transaction_category_code FROM accounting_bridge_deliveries
    WHERE producer_module = ? AND fact_type = ? AND fact_id = ?
    LIMIT 1
  `).bind(PRODUCER, type, id).first();
  if (!delivery || delivery.status !== 'POSTED' || !delivery.journal_id) return outcome('NOT_REQUIRED');

  const voidType = `${type}_VOID`;
  const previous = await existingDelivery(db, delivery.store_id, voidType, id);
  if (previous?.status === 'POSTED' && previous.journal_id) return outcome('POSTED', '', '', { duplicate: true, journalId: previous.journal_id });

  const original = await getAccountingJournal(db, delivery.store_id, delivery.journal_id);
  if (!original) {
    const value = failed('ORIGINAL_ACCOUNTING_JOURNAL_NOT_FOUND', 'Jurnal asal tidak ditemukan untuk dibalik.');
    await saveDelivery(db, delivery.store_id, voidType, id, delivery.transaction_category_code, value);
    return value;
  }
  const now = new Date();
  const posted = await postAccountingJournal(db, { id: delivery.store_id }, {
    businessDate: getJakartaBusinessDate(now),
    occurredAt: now.toISOString(),
    sourceSystem: `${SOURCE_SYSTEM}_VOID`,
    sourceReferenceId: `VOID:${type}:${id}`,
    correlationId: id,
    idempotencyKey: `${SOURCE_SYSTEM}_VOID:${type}:${id}`,
    description: `Pembalik ${original.description}${reason ? ` · ${text(reason, 120)}` : ''}`.slice(0, 300),
    reversalOfJournalId: original.journalId,
    journalLines: original.lines.map(line => ({
      accountId: line.accountId,
      side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amountScaled: line.amountScaled,
      description: `Pembalik · ${line.description || original.description}`.slice(0, 240)
    }))
  });
  const value = posted.ok
    ? outcome('POSTED', '', '', { journalId: posted.journal.journalId, journalNumber: posted.journal.journalNumber, reversalOf: original.journalId })
    : failed(posted.code || 'ACCOUNTING_REVERSAL_FAILED', posted.error || 'Jurnal pembalik gagal diposting.');
  await saveDelivery(db, delivery.store_id, voidType, id, delivery.transaction_category_code, value);
  return value;
}

// ------------------------------------------------------ post-commit hook ---

async function jsonPayload(response) {
  try { return await response.clone().json(); } catch { return null; }
}

// Menentukan fakta apa yang baru saja commit dari respons handler admin --
// handler Operasional tidak mengimpor apa pun dari Accounting (pola yang sama
// dengan attachAccountingBridgeToCommittedResponse untuk kasir).
async function actionsFor(db, pathname, payload) {
  if (pathname === '/api/admin/operational-expenses' && payload?.id) return [['dispatch', 'BEA', payload.id]];
  const beaVoid = pathname.match(/^\/api\/admin\/operational-expenses\/([^/]+)\/void$/);
  if (beaVoid) return [['reverse', 'BEA', decodeURIComponent(beaVoid[1])]];
  if (pathname === '/api/admin/hutang-piutang/payments' && payload?.payment?.id) return [['dispatch', 'BAYAR_HUTANG', payload.payment.id]];
  if (pathname === '/api/admin/hutang-piutang/pembayaran-lainnya' && payload?.payment?.expenseId) return [['dispatch', 'BEA', payload.payment.expenseId]];
  if (/^\/api\/admin\/hutang-piutang\/payments\/[^/]+\/void$/.test(pathname) && payload?.payment) {
    return payload.payment.kind === 'HUTANG'
      ? [['reverse', 'BAYAR_HUTANG', payload.payment.id]]
      : payload.payment.expenseId ? [['reverse', 'BEA', payload.payment.expenseId]] : [];
  }
  if (pathname === '/api/admin/hutang-piutang/deposits' && payload?.deposit?.id) return [['dispatch', 'UANG_MUKA', payload.deposit.id]];
  if (pathname === '/api/staff/attendance' && payload?.attendance?.id) {
    const entry = await db.prepare(`
      SELECT id FROM payroll_ledger_entries WHERE source_type = 'ATTENDANCE' AND source_id = ? AND entry_type = 'ACCRUAL' LIMIT 1
    `).bind(payload.attendance.id).first();
    return entry ? [['dispatch', 'GAJI_PRESENSI', entry.id]] : [];
  }
  return [];
}

export async function attachAdminAccountingToCommittedResponse(request, response, env, pathname) {
  if (!response || request.method !== 'POST' || response.status < 200 || response.status >= 300) return response;
  try {
    const payload = await jsonPayload(response);
    if (!payload) return response;
    const actions = await actionsFor(env.DB, pathname, payload);
    if (!actions.length) return response;
    const deliveries = [];
    for (const [action, factType, factId] of actions) {
      const result = action === 'reverse'
        ? await reverseAdminAccountingFact(env.DB, factType, factId)
        : await dispatchAdminAccountingFact(env.DB, factType, factId);
      deliveries.push({
        factType, factId, action,
        bridgeStatus: result.status,
        journalReference: result.journalId || null,
        failureCode: result.ok ? null : (result.code || null),
        failureDetail: result.ok ? null : (result.error || null)
      });
    }
    return json({ ...payload, accounting: { bridgeContract: ACCOUNTING_ADMIN_BRIDGE_CONTRACT, deliveries } }, response.status);
  } catch (error) {
    // Fakta operasional sudah commit; kegagalan Accounting tidak boleh
    // mengubah hasilnya di mata admin.
    console.error('admin accounting bridge failed', { pathname, error });
    return response;
  }
}

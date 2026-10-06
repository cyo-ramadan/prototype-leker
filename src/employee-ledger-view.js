import { json } from './http.js';
import { entityAdminFromRequest } from './owner-auth.js';

// Bos Cyo, 2026-10-06: "didalam tombol karyawan entity admin itu tambahin untuk cek saldo
// piutang/setoran dari karyawan tersebut, terlihat jika satu karyawan tadi tertaut dengan 2 atau
// lebih akun kerja dan beda gerai, dari situ terlihat semua mutasi ke semua akun yang tertaut itu.
// berikan tombol filter untuk memilih misal hanya dari akun terpilih saja ... sediakan juga dengan
// mekanisme yang sama untuk hutang gajinya."
//
// Read-only, lintas gerai dalam SATU entity (entity Entity Admin pemanggil). Sumber data:
//   Setoran : operational_receivables_payables EMPLOYEE_DEPOSIT (+ pembayaran/ACC-nya) atas nama
//             karyawan ini, atau atas nama akun kasirnya sebelum ditautkan (`cashier:<id>`), plus
//             jurnal manual Piutang Karyawan yang menyebut namanya (accounting_party_entries).
//             Akun asal setoran = kasir pemegang laci (cash_drawer_sessions.cashier_id).
//   Gaji    : payroll_ledger_entries milik karyawan ini atau akun-akun tertautnya.
// Saldo dihitung berurutan waktu; boleh negatif (invariant #8).

const SCALE = 1_000_000;
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const rupiah = scaled => Number(scaled || 0) / SCALE;

async function linkedAccounts(db, employeeId, entityId) {
  const rows = await db.prepare(`
    SELECT DISTINCT l.account_id, l.account_type, c.username, c.employee_name, s.code AS store_code, s.store_name
    FROM employee_account_links l
    LEFT JOIN cashiers c ON c.id = l.account_id AND l.account_type = 'CASHIER'
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE l.employee_id = ? AND l.entity_id = ? AND l.account_type = 'CASHIER'
    ORDER BY s.code, c.username
  `).bind(employeeId, entityId).all();
  return (rows.results ?? []).map(row => ({
    accountId: row.account_id,
    username: row.username || row.account_id,
    storeCode: row.store_code || '',
    storeName: row.store_name || ''
  }));
}

function inList(values) {
  return values.length ? values.map(() => '?').join(',') : "''";
}

async function setoranEntries(db, employeeId, entityId, accounts) {
  const holderIds = [employeeId, ...accounts.map(account => `cashier:${account.accountId}`)];
  const receivables = await db.prepare(`
    SELECT r.id, r.original_amount, r.transaction_date, r.created_at, s.code AS store_code, d.cashier_id
    FROM operational_receivables_payables r
    JOIN stores s ON s.id = r.store_id
    LEFT JOIN cash_drawer_sessions d ON d.id = r.source_id AND d.store_id = r.store_id
    WHERE r.entity_id = ? AND r.source_type = 'EMPLOYEE_DEPOSIT' AND r.counterparty_id IN (${inList(holderIds)})
  `).bind(entityId, ...holderIds).all();
  const list = receivables.results ?? [];
  const entries = list.map(row => ({
    at: row.created_at || `${row.transaction_date}T00:00:00.000Z`,
    businessDate: row.transaction_date,
    kind: 'SETORAN_LACI',
    label: 'Setoran dari tutup laci',
    storeCode: row.store_code,
    accountId: row.cashier_id || null,
    amountScaled: Number(row.original_amount),
    status: 'POSTED'
  }));
  const accountByReceivable = new Map(list.map(row => [row.id, { storeCode: row.store_code, accountId: row.cashier_id || null }]));
  const ids = [...accountByReceivable.keys()];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const payments = await db.prepare(`
      SELECT p.receivable_payable_id, p.amount, p.approval_status, p.created_at, p.reviewed_at, p.admin_payment_id,
             p.rejection_reason, (SELECT sa.name FROM entity_shared_accounts sa WHERE sa.id = p.shared_account_id) AS shared_account_name
      FROM operational_receivable_payable_payments p
      WHERE p.receivable_payable_id IN (${inList(chunk)})
    `).bind(...chunk).all();
    for (const row of payments.results ?? []) {
      const origin = accountByReceivable.get(row.receivable_payable_id) || {};
      const at = row.reviewed_at || row.created_at;
      entries.push({
        at,
        businessDate: String(at || '').slice(0, 10),
        kind: row.admin_payment_id ? 'DIPAKAI_BAYAR' : 'TRANSFER_SETORAN',
        label: row.admin_payment_id
          ? 'Dipakai membayar (oleh Admin)'
          : row.shared_account_name ? `Transfer setoran ke ${row.shared_account_name}` : 'Transfer setoran',
        storeCode: origin.storeCode || '',
        accountId: origin.accountId || null,
        amountScaled: -Number(row.amount),
        status: row.approval_status === 'approved' ? 'POSTED' : row.approval_status === 'pending_approval' ? 'PENDING' : 'REJECTED',
        note: row.rejection_reason || ''
      });
    }
  }
  const manual = await db.prepare(`
    SELECT e.side, e.amount_scaled, e.business_date, e.created_at, e.description, h.journal_number, s.code AS store_code
    FROM accounting_party_entries e
    JOIN accounting_journal_headers h ON h.id = e.journal_id
    JOIN stores s ON s.id = e.store_id
    WHERE s.entity_id = ? AND e.account_code = '1202' AND e.employee_id IN (${inList(holderIds)}) AND h.journal_status = 'POSTED'
  `).bind(entityId, ...holderIds).all();
  for (const row of manual.results ?? []) {
    entries.push({
      at: row.created_at || `${row.business_date}T00:00:00.000Z`,
      businessDate: row.business_date,
      kind: 'JURNAL_AKUNTANSI',
      label: `Penyesuaian dari Akuntansi · Jurnal ${row.journal_number}`,
      storeCode: row.store_code,
      accountId: null,
      amountScaled: (row.side === 'DEBIT' ? 1 : -1) * Number(row.amount_scaled),
      status: 'POSTED',
      note: row.description || ''
    });
  }
  return entries;
}

async function gajiEntries(db, employeeId, entityId, accounts) {
  const accountIds = accounts.map(account => account.accountId);
  const rows = await db.prepare(`
    SELECT p.entry_type, p.account_id, p.business_date, p.created_at, p.hutang_gaji_delta_scaled, p.description, s.code AS store_code
    FROM payroll_ledger_entries p
    JOIN stores s ON s.id = p.store_id
    WHERE s.entity_id = ? AND p.voided_at IS NULL AND p.hutang_gaji_delta_scaled <> 0
      AND (p.employee_id = ? OR (p.account_type = 'CASHIER' AND p.account_id IN (${inList(accountIds)})))
  `).bind(entityId, employeeId, ...accountIds).all();
  const label = { ACCRUAL: 'Gaji dari presensi', ADJUSTMENT: 'Bea Gaji / penyesuaian', PAYMENT: 'Pembayaran gaji' };
  return (rows.results ?? []).map(row => ({
    at: row.created_at || `${row.business_date}T00:00:00.000Z`,
    businessDate: row.business_date,
    kind: row.entry_type,
    label: label[row.entry_type] || row.entry_type,
    storeCode: row.store_code,
    accountId: row.account_id || null,
    amountScaled: Number(row.hutang_gaji_delta_scaled),
    status: 'POSTED',
    note: row.description || ''
  }));
}

export async function buildEmployeeLedger(db, { employeeId, entityId, kind, accountId = '' }) {
  const employee = await db.prepare(`SELECT id, full_name FROM employees WHERE id = ? AND entity_id = ?`).bind(employeeId, entityId).first();
  if (!employee) return null;
  const accounts = await linkedAccounts(db, employee.id, entityId);
  let entries = kind === 'gaji'
    ? await gajiEntries(db, employee.id, entityId, accounts)
    : await setoranEntries(db, employee.id, entityId, accounts);
  // Filter akun: mutasi yang tidak bisa ditempelkan ke satu akun (mis. jurnal manual, pembayaran
  // gaji per orang) hanya tampil di "Semua akun".
  if (accountId) entries = entries.filter(entry => entry.accountId === accountId);
  const byAccount = new Map(accounts.map(account => [account.accountId, account]));
  entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let balance = 0;
  let pending = 0;
  const withBalance = entries.map(entry => {
    if (entry.status === 'POSTED') balance += entry.amountScaled;
    if (entry.status === 'PENDING') pending += -entry.amountScaled;
    const account = entry.accountId ? byAccount.get(entry.accountId) : null;
    return {
      at: entry.at,
      businessDate: entry.businessDate,
      kind: entry.kind,
      label: entry.label,
      storeCode: entry.storeCode,
      accountId: entry.accountId,
      accountUsername: account?.username || null,
      status: entry.status,
      note: entry.note || '',
      amountRupiah: rupiah(entry.amountScaled),
      balanceRupiah: rupiah(balance)
    };
  });
  return {
    employee: { id: employee.id, fullName: employee.full_name },
    kind: kind === 'gaji' ? 'gaji' : 'setoran',
    accounts,
    selectedAccountId: accountId || null,
    balanceRupiah: rupiah(balance),
    pendingRupiah: rupiah(pending),
    entries: withBalance.reverse()
  };
}

export async function handleEmployeeLedgerViewApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/entity-admin\/employees\/([^/]+)\/ledger$/);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Method tidak didukung.' }, 405);
  const entityAdmin = await entityAdminFromRequest(request, env.DB);
  if (!entityAdmin) return json({ error: 'Login Entity Admin diperlukan.', code: 'ENTITY_ADMIN_REQUIRED' }, 401);
  const url = new URL(request.url);
  const result = await buildEmployeeLedger(env.DB, {
    employeeId: decodeURIComponent(match[1]),
    entityId: entityAdmin.entityId,
    kind: text(url.searchParams.get('kind'), 20).toLowerCase(),
    accountId: text(url.searchParams.get('account'), 120)
  });
  if (!result) return json({ error: 'Karyawan tidak ditemukan di entity ini.' }, 404);
  return json(result);
}

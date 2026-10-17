import { json } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { AKUN_HUTANG_GAJI, AKUN_PIUTANG_KARYAWAN, operasionalPerGerai, riwayatDariBuku } from './riwayat-dari-buku.js';
import { loadJobDetail, loadSchedule } from './cashier-auth.js';
import { scheduleMap, listAttendance, buildPayroll } from './staff-attendance.js';
import { listPayrollAdjustments } from './payroll-adjustments.js';
import { resolveTenantId, getTenantPolicySetting, ATTENDANCE_SCHEDULE_GATE_KEY } from './tenant-policy.js';
import { listActiveSyncs, SYNC_LABEL } from './sinkron-akuntansi-baris.js';
import { evaluateDueApresiasi } from './dana-apresiasi.js';

// Bos Cyo, 2026-10-06: "didalam tombol karyawan entity admin itu tambahin untuk cek saldo
// piutang/setoran dari karyawan tersebut, terlihat jika satu karyawan tadi tertaut dengan 2 atau
// lebih akun kerja dan beda gerai, dari situ terlihat semua mutasi ke semua akun yang tertaut itu.
// berikan tombol filter untuk memilih misal hanya dari akun terpilih saja ... sediakan juga dengan
// mekanisme yang sama untuk hutang gajinya."
//
// Read-only, lintas gerai dalam SATU entity (entity Entity Admin pemanggil). Sumber data:
//   Setoran : operational_receivables_payables EMPLOYEE_DEPOSIT (+ pembayaran/ACC-nya) atas nama
//             karyawan ini, atau atas nama akun kasirnya sebelum ditautkan (`cashier:<id>`).
//   Keduanya ditambah jurnal Akuntansi di luar fakta operasional yang menyebut namanya, dan saldonya
//   saldo menurut buku (ADR-054, src/riwayat-dari-buku.js).
//             Akun asal setoran = kasir pemegang laci (cash_drawer_sessions.cashier_id).
//   Gaji    : payroll_ledger_entries milik karyawan ini atau akun-akun tertautnya, DITAMBAH sumber
//             yang sama dengan Riwayat Gaji Portal Staf (Bos Cyo, 2026-10-12: "riwayat gaji di
//             entity admin engga kebaca"): gaji dari presensi (dihitung ulang dari presensi + tarif)
//             yang belum punya baris ACCRUAL di ledger, dan Penyesuaian Gaji Admin (payroll_adjustments).
// Saldo dihitung berurutan waktu; boleh negatif (invariant #8).

const SCALE = 1_000_000;
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const rupiah = scaled => Number(scaled || 0) / SCALE;

export async function linkedAccounts(db, employeeId, entityId) {
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
    SELECT r.id, r.store_id, r.original_amount, r.transaction_date, r.created_at, s.code AS store_code, d.cashier_id
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
    storeId: row.store_id,
    storeCode: row.store_code,
    accountId: row.cashier_id || null,
    amountScaled: Number(row.original_amount),
    status: 'POSTED'
  }));
  const accountByReceivable = new Map(list.map(row => [row.id, { storeId: row.store_id, storeCode: row.store_code, accountId: row.cashier_id || null }]));
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
        storeId: origin.storeId || null,
        storeCode: origin.storeCode || '',
        accountId: origin.accountId || null,
        amountScaled: -Number(row.amount),
        status: row.approval_status === 'approved' ? 'POSTED' : row.approval_status === 'pending_approval' ? 'PENDING' : 'REJECTED',
        note: row.rejection_reason || ''
      });
    }
  }
  return entries;
}

async function gajiEntries(db, employeeId, entityId, accounts) {
  const accountIds = accounts.map(account => account.accountId);
  // Dana apresiasi (ADR-058): shift yang sudah lewat di gerai akun-akun orang ini dinilai dulu.
  const accountStores = accountIds.length
    ? (await db.prepare(`SELECT DISTINCT store_id FROM cashiers WHERE id IN (${inList(accountIds)})`).bind(...accountIds).all()).results ?? []
    : [];
  for (const row of accountStores) {
    try { await evaluateDueApresiasi(db, row.store_id); } catch (error) { console.warn('nilai apresiasi gagal', row.store_id, error?.message); }
  }
  const rows = await db.prepare(`
    SELECT p.entry_type, p.source_type, p.source_id, p.voided_at, p.void_reason, p.account_id, p.store_id, p.business_date, p.created_at, p.hutang_gaji_delta_scaled, p.description, s.code AS store_code
    FROM payroll_ledger_entries p
    JOIN stores s ON s.id = p.store_id
    WHERE s.entity_id = ? AND p.hutang_gaji_delta_scaled <> 0
      AND (p.employee_id = ? OR (p.account_type = 'CASHIER' AND p.account_id IN (${inList(accountIds)})))
  `).bind(entityId, employeeId, ...accountIds).all();
  const label = { ACCRUAL: 'Gaji dari presensi', ADJUSTMENT: 'Bea Gaji / penyesuaian', PAYMENT: 'Pembayaran gaji' };
  const ledger = rows.results ?? [];
  // Termasuk baris yang dibatalkan: sesi presensi yang ACCRUAL-nya dibatalkan tidak dihitung ulang.
  // Gaji hasil revisi jam presensi bersumber `<attendance>#rev-<permit>` (src/attendance-revision-permit.js).
  const ledgerAttendanceIds = new Set(ledger.filter(row => row.source_type === 'ATTENDANCE').map(row => String(row.source_id).split('#')[0]));
  // Revisi jam presensi (2026-10-17): baris gaji lama tetap tampil apa adanya, tiap revisi tampil sebagai
  // baris selisih di bawahnya (jumlahnya = gaji sesudah revisi, sama dengan buku).
  const revisedChain = new Map();
  for (const row of ledger) {
    if (row.source_type !== 'ATTENDANCE' || row.entry_type !== 'ACCRUAL') continue;
    const revisedAway = row.voided_at && String(row.void_reason || '').startsWith('Revisi jam presensi');
    if (!revisedAway && !String(row.source_id).includes('#rev-')) continue;
    const base = String(row.source_id).split('#')[0];
    if (!revisedChain.has(base)) revisedChain.set(base, []);
    revisedChain.get(base).push(row);
  }
  const chainRows = new Map();
  for (const list of revisedChain.values()) {
    // Urutan rantai: baris asli, lalu revisi yang sudah digantikan, terakhir yang masih berlaku (created_at bisa sama detiknya).
    const rank = row => [String(row.source_id).includes('#rev-') ? 1 : 0, row.voided_at ? 0 : 1];
    list.sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1] || String(a.created_at).localeCompare(String(b.created_at)));
    list.forEach((row, index) => chainRows.set(row, index === 0 ? null : Number(list[index - 1].hutang_gaji_delta_scaled)));
  }
  const entries = ledger.filter(row => !row.voided_at || chainRows.has(row)).map(row => {
    const previous = chainRows.get(row);
    const isRevision = chainRows.has(row) && previous !== null;
    return {
      at: row.created_at || `${row.business_date}T00:00:00.000Z`,
      businessDate: row.business_date,
      kind: isRevision ? 'REVISI_JAM' : row.entry_type,
      label: isRevision ? 'Revisi jam presensi di-ACC (selisih)' : (label[row.entry_type] || row.entry_type),
      storeId: row.store_id,
      storeCode: row.store_code,
      accountId: row.account_id || null,
      amountScaled: Number(row.hutang_gaji_delta_scaled) - (isRevision ? previous : 0),
      status: 'POSTED',
      note: row.description || ''
    };
  });
  // Dana apresiasi & denda (ADR-058): potongan CS asli, fee backup, penyesuaian Entity Admin.
  const apresiasi = await db.prepare(`
    SELECT x.id, x.kind, x.account_id, x.store_id, x.business_date, x.created_at, x.amount_scaled, x.description, s.code AS store_code
    FROM apresiasi_entries x JOIN stores s ON s.id = x.store_id
    WHERE x.entity_id = ? AND x.voided_at IS NULL AND x.amount_scaled <> 0
      AND (x.employee_id = ? OR x.account_id IN (${inList(accountIds)}))
  `).bind(entityId, employeeId, ...accountIds).all();
  for (const row of apresiasi.results ?? []) {
    entries.push({
      at: row.created_at || `${row.business_date}T00:00:00.000Z`,
      businessDate: row.business_date,
      kind: `APRESIASI_${row.kind}`,
      label: row.description || 'Dana apresiasi',
      apresiasiEntryId: row.kind === 'PENYESUAIAN' ? null : row.id,
      storeId: row.store_id,
      storeCode: row.store_code,
      accountId: row.account_id,
      amountScaled: Number(row.amount_scaled),
      status: 'POSTED'
    });
  }
  // Portal Staf menghitung gaji dari presensi tiap kali dibuka; ledger hanya terisi untuk sesi yang
  // ditutup lewat presensi pulang setelah migration 0116. Sesi lain (lama, ditutup otomatis) tetap
  // ditampilkan di sini dari presensi -- tanpa dobel dengan baris ACCRUAL yang sudah ada.
  if (!accounts.length) return entries;
  const gate = await getTenantPolicySetting(db, await resolveTenantId(db, entityId), ATTENDANCE_SCHEDULE_GATE_KEY);
  const storeIdByCode = new Map((await db.prepare('SELECT id, code FROM stores WHERE entity_id = ?').bind(entityId).all()).results?.map(row => [row.code, row.id]) ?? []);
  for (const account of accounts) {
    const storeId = storeIdByCode.get(account.storeCode) || null;
    const jobDetail = await loadJobDetail(db, account.accountId);
    const scheduleByDay = scheduleMap(await loadSchedule(db, account.accountId));
    const attendance = jobDetail ? await listAttendance(db, account.accountId, scheduleByDay, gate) : [];
    for (const row of buildPayroll(attendance, jobDetail, scheduleByDay, gate)) {
      if (ledgerAttendanceIds.has(row.attendanceId) || !row.earningRupiah) continue;
      entries.push({
        at: row.checkOutAt || row.checkInAt,
        businessDate: row.date,
        kind: 'ACCRUAL',
        label: 'Gaji dari presensi',
        storeId,
        storeCode: account.storeCode,
        accountId: account.accountId,
        amountScaled: Math.round(row.earningRupiah * SCALE),
        status: 'POSTED',
        note: row.paymentType === 'SESI' ? 'Per sesi' : `Per jam${row.hoursWorked != null ? ` · ${row.hoursWorked} jam` : ''}`
      });
    }
    if (!storeId) continue;
    for (const adjustment of await listPayrollAdjustments(db, { accountId: account.accountId, storeId })) {
      entries.push({
        at: adjustment.createdAt || `${adjustment.businessDate}T00:00:00.000Z`,
        businessDate: adjustment.businessDate,
        kind: 'PENYESUAIAN_ADMIN',
        label: 'Penyesuaian Gaji dari Admin',
        storeId,
        storeCode: account.storeCode,
        accountId: account.accountId,
        amountScaled: Math.round(Number(adjustment.amountRupiah || 0) * SCALE),
        status: adjustment.voided ? 'REJECTED' : 'POSTED',
        note: adjustment.voided ? `Dibatalkan: ${adjustment.voidReason || ''}` : (adjustment.reason || '')
      });
    }
  }
  return entries;
}

// Fakta operasional satu karyawan (tanpa jurnal penyesuaian & sinkronisasi) -- dipakai riwayat di
// bawah dan perhitungan selisih tombol Sinkronisasi Akuntansi (src/sinkron-akuntansi.js).
export function operationalEntries(db, employeeId, entityId, accounts, kind) {
  return kind === 'gaji'
    ? gajiEntries(db, employeeId, entityId, accounts)
    : setoranEntries(db, employeeId, entityId, accounts);
}

// Baris Sinkronisasi Akuntansi (migration 0153) dalam bentuk mutasi riwayat. Tidak menempel ke satu
// akun kerja, jadi hanya tampil di "Semua akun".
export async function syncLedgerEntries(db, employeeId, kind) {
  return (await listActiveSyncs(db, { employeeId, kind })).map(row => ({
    at: row.createdAt,
    businessDate: String(row.createdAt || '').slice(0, 10),
    kind: 'SINKRONISASI',
    label: SYNC_LABEL,
    syncId: row.id,
    storeId: row.storeId,
    storeCode: row.storeCode,
    accountId: null,
    amountScaled: row.amountScaled,
    status: 'POSTED',
    note: 'Penyamaan riwayat dengan buku Akuntansi (tidak dijurnal)'
  }));
}

export async function buildEmployeeLedger(db, { employeeId, entityId, kind, accountId = '' }) {
  const employee = await db.prepare(`SELECT id, full_name FROM employees WHERE id = ? AND entity_id = ?`).bind(employeeId, entityId).first();
  if (!employee) return null;
  const accounts = await linkedAccounts(db, employee.id, entityId);
  // Sinkronisasi dihitung sebagai bagian Operasional: setelah disinkronkan, riwayat = buku dan
  // peringatan "belum masuk pembukuan" hilang.
  const operational = [
    ...await operationalEntries(db, employee.id, entityId, accounts, kind),
    ...await syncLedgerEntries(db, employee.id, kind)
  ];
  // ADR-054: saldo = buku Akuntansi; jurnal di luar fakta operasional (jurnal akuntan, dst.) atas
  // nama orang ini -- termasuk akun kasirnya sebelum ditautkan -- tampil sebagai penyesuaian.
  const buku = await riwayatDariBuku(db, {
    entityId,
    accountCode: kind === 'gaji' ? AKUN_HUTANG_GAJI : AKUN_PIUTANG_KARYAWAN,
    holderIds: [employee.id, ...accounts.map(account => `cashier:${account.accountId}`)],
    operationalByStore: operasionalPerGerai(operational.map(entry => ({ storeId: entry.storeId, amountScaled: entry.amountScaled, aktif: entry.status === 'POSTED' }))),
    syncStoreIds: operational.map(entry => entry.storeId)
  });
  let entries = [
    ...operational,
    ...buku.penyesuaian.map(entry => ({
      at: entry.createdAt || `${entry.businessDate}T00:00:00.000Z`,
      businessDate: entry.businessDate,
      kind: 'JURNAL_AKUNTANSI',
      label: `Penyesuaian dari Akuntansi · Jurnal ${entry.journalNumber}`,
      storeId: entry.storeId,
      storeCode: entry.storeCode,
      accountId: null,
      amountScaled: entry.amountScaled,
      status: 'POSTED',
      note: entry.description
    }))
  ];
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
      syncId: entry.syncId || null,
      apresiasiEntryId: entry.apresiasiEntryId || null,
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
    // Saldo semua akun = buku Akuntansi; saat difilter satu akun, jumlah mutasi akun itu.
    balanceRupiah: accountId ? rupiah(balance) : buku.balanceRupiah,
    belumMasukBukuRupiah: buku.belumMasukBukuRupiah,
    pendingRupiah: rupiah(pending),
    entries: withBalance.reverse()
  };
}

export async function handleEmployeeLedgerViewApi(request, env, pathname) {
  const match = pathname.match(/^\/api\/entity-admin\/employees\/([^/]+)\/ledger$/);
  if (!match) return null;
  if (request.method !== 'GET') return json({ error: 'Method tidak didukung.' }, 405);
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const url = new URL(request.url);
  const result = await buildEmployeeLedger(env.DB, {
    employeeId: decodeURIComponent(match[1]),
    entityId: context.entityId,
    kind: text(url.searchParams.get('kind'), 20).toLowerCase(),
    accountId: text(url.searchParams.get('account'), 120)
  });
  if (!result) return json({ error: 'Karyawan tidak ditemukan di entity ini.' }, 404);
  return json(result);
}

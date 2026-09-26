import { WAGE_SCALE } from './staff-attendance.js';

// Bos Cyo, 2026-09-24 (koreksi atas Penyesuaian Gaji): "harusnya entry gaji
// cukup yang di operasional itu kan bisa, engga usa bikin yang baru ...
// bikin semacam akun gaji, dan apabila menyentuh itu harus cek juga employ
// dan nama karyawan itu ... model akun gaji ini sebaiknya mengikuti konsep
// debet dan kredit ... jangan lupa catat yang jadi beban gajinya, untuk
// perhitungan di rugi laba nya." Lalu soal presensi harian: "kalo dalam
// akuntansi ketika ada gaji harian itu jurnalnya debet beban gaji kredit
// hutang gaji ... jadi harusnya nominal di sesi jam harian itu uda mencetak
// beban dan hutang gaji." Lihat migration 0116 untuk desain lengkap tabelnya.
//
// Dipakai dua sumber (src/staff-portal.js saat presensi keluar, dan
// src/admin-operational-expense.js saat kategori Bea Gaji dicatat/dibatalkan)
// -- modul netral supaya tidak ada impor silang, pola yang sama dengan
// staff-attendance.js/payroll-adjustments.js/entity-backup-cashiers.js.

export { WAGE_SCALE };

// Siapa memegang akun ini PADA SAAT kejadian (bukan siapa pun yang kebetulan
// memegangnya sekarang) -- inilah "cek employ dan nama karyawan" yang
// diminta: penting khusus akun backup, yang sengaja dipakai gantian orang.
// null kalau akun belum/tidak sedang ditautkan ke siapa pun di tanggal itu --
// pemanggil tetap mencatat baris ledgernya, cuma employee_id-nya kosong.
export async function resolveEmployeeForAccount(db, accountType, accountId, atIso) {
  const row = await db.prepare(`
    SELECT employee_id FROM employee_account_links
    WHERE account_type = ? AND account_id = ?
      AND effective_from <= ?
      AND (effective_to IS NULL OR effective_to > ?)
    ORDER BY effective_from DESC LIMIT 1
  `).bind(accountType, accountId, atIso, atIso).first();
  return row?.employee_id ?? null;
}

// Satu baris per sesi presensi SELESAI, dipanggil dari staff-portal.js waktu
// presensi keluar. amountScaled <= 0 (belum ada tarif gaji diisi, atau durasi
// nol) sengaja dilewati -- bukan error, cuma tidak ada apa pun yang perlu
// dicatat. Idempotent lewat INSERT OR IGNORE pada UNIQUE(source_type,
// source_id) (migration 0116) -- checkout yang keulang/retry tidak pernah
// dobel Beban Gaji untuk sesi yang sama.
export async function recordAttendanceAccrual(db, {
  accountType, accountId, storeId, businessDate, checkInAtIso, amountScaled, attendanceId, description
}) {
  if (!Number.isFinite(amountScaled) || amountScaled <= 0) return { ok: true, skipped: true };
  const employeeId = await resolveEmployeeForAccount(db, accountType, accountId, checkInAtIso);
  const id = `paygaji_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT OR IGNORE INTO payroll_ledger_entries (
      id, employee_id, account_type, account_id, store_id, business_date, entry_type,
      hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id,
      description, created_by_role, created_by_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ACCRUAL', ?, ?, 'ATTENDANCE', ?, ?, 'SYSTEM', '', CURRENT_TIMESTAMP)
  `).bind(
    id, employeeId, accountType, accountId, storeId, businessDate,
    amountScaled, amountScaled, attendanceId, description || 'Gaji presensi'
  ).run();
  return { ok: true, employeeId };
}

// Satu baris ADJUSTMENT per baris admin_operational_expenses kategori
// BEA_GAJI -- mirror, bukan sumber ganda: Bea Operasional tetap satu-satunya
// pintu entry manual (Bos Cyo: "engga usa bikin yang baru"), ledger ini cuma
// menyalin peristiwa yang sama supaya bisa muncul di Riwayat Gaji per nama
// dan menambah/mengurangi saldo Hutang Gaji orang itu. amountScaled boleh
// negatif (potongan/pinalti) -- hutang & beban dua-duanya ikut turun.
export async function recordBeaGajiAdjustment(db, {
  employeeId, storeId, businessDate, amountScaled, expenseId, description, createdByRole, createdById
}) {
  const id = `paygaji_${crypto.randomUUID()}`;
  await db.prepare(`
    INSERT INTO payroll_ledger_entries (
      id, employee_id, account_type, account_id, store_id, business_date, entry_type,
      hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id,
      description, created_by_role, created_by_id, created_at
    ) VALUES (?, ?, NULL, NULL, ?, ?, 'ADJUSTMENT', ?, ?, 'BEA_OPERASIONAL', ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(
    id, employeeId, storeId, businessDate, amountScaled, amountScaled,
    expenseId, description || '', createdByRole || '', createdById || ''
  ).run();
  return id;
}

// Dipanggil waktu Bea Operasional (BEA_GAJI) dibatalkan -- baris ledger
// mirror-nya ikut dibatalkan (voided_at), bukan DELETE, pola append-only yang
// sama dengan tabel lain di repo ini. Tidak error kalau tidak ada baris
// (mis. entry lama sebelum fitur ini ada) -- itu wajar, bukan bug.
export async function voidLedgerEntryBySource(db, { sourceType, sourceId, voidedByRole, voidedById, reason }) {
  await db.prepare(`
    UPDATE payroll_ledger_entries
    SET voided_at = CURRENT_TIMESTAMP, voided_by_role = ?, voided_by_id = ?, void_reason = ?
    WHERE source_type = ? AND source_id = ? AND voided_at IS NULL
  `).bind(voidedByRole || '', voidedById || '', reason || '', sourceType, sourceId).run();
}

function mapLedgerRow(row) {
  return {
    id: row.id,
    entryType: row.entry_type,
    accountType: row.account_type,
    accountId: row.account_id,
    storeId: row.store_id,
    storeCode: row.store_code || '',
    businessDate: row.business_date,
    hutangGajiDeltaRupiah: Number(row.hutang_gaji_delta_scaled) / WAGE_SCALE,
    bebanGajiDeltaRupiah: Number(row.beban_gaji_delta_scaled) / WAGE_SCALE,
    sourceType: row.source_type,
    sourceId: row.source_id,
    description: row.description || '',
    createdByRole: row.created_by_role || '',
    createdAt: row.created_at,
    voided: Boolean(row.voided_at),
    voidReason: row.void_reason || ''
  };
}

// Riwayat Gaji per nama orang (Bos Cyo: "acuannya per nama orang aja ...
// keluar kartu2 gajinya pertanggal, dan dari mana gajinya tersebut dan masuk
// melalui apa") -- lintas SEMUA akun yang pernah dipegang orang ini, lintas
// gerai (backup lintas gerai tetap kelihatan di sini, masing-masing baris
// tetap membawa store_id-nya sendiri -- "tanggungan gaji per gerai walaupun
// memakai user bersama"). Saldo Hutang Gaji = SUM seluruh delta yang belum
// dibatalkan; entries diurutkan terbaru dulu, pemanggil (UI) yang
// mengelompokkan per tanggal jadi kartu-kartu.
export async function listLedgerForEmployee(db, employeeId) {
  const rows = await db.prepare(`
    SELECT l.*, s.code AS store_code
    FROM payroll_ledger_entries l
    JOIN stores s ON s.id = l.store_id
    WHERE l.employee_id = ?
    ORDER BY l.business_date DESC, l.created_at DESC
  `).bind(employeeId).all();
  const entries = (rows.results ?? []).map(mapLedgerRow);
  const hutangGajiBalanceRupiah = entries.reduce((sum, entry) => sum + (entry.voided ? 0 : entry.hutangGajiDeltaRupiah), 0);
  return { entries, hutangGajiBalanceRupiah };
}

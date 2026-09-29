import { getJakartaBusinessDate } from './time.js';

// Bos Cyo, 2026-09-24: "untuk akun backup mending ikut entity aja, jadi
// bikin akunnya cuma 1 aja ... intinya hal ini untuk menghindari di hari
// dan jam normal cs ini presensi memakai user backup, karna user backup
// itu gaji per jam nya lebih gede." Lihat migration 0115 untuk desain
// lengkap dan kenapa cashiers.store_id TETAP NOT NULL (dipindah, bukan
// dijadikan nullable) -- modul ini murni operasi atas pilihan itu.

// Dipakai dua tempat: src/cashier-auth.js (Admin mengaktifkan) dan
// src/staff-portal.js (gerbang presensi masuk mengecek aktivasi hari ini).
// Diekspor terpisah dari kedua pemanggil supaya tidak ada impor silang,
// sama seperti staff-attendance.js/payroll-adjustments.js.

export async function isActivatedToday(db, accountId, storeId, { accountType = 'CASHIER', businessDate } = {}) {
  const date = businessDate || getJakartaBusinessDate();
  const row = await db.prepare(`
    SELECT 1 FROM account_daily_activations
    WHERE account_type = ? AND account_id = ? AND business_date = ? AND store_id = ?
    LIMIT 1
  `).bind(accountType, accountId, date, storeId).first();
  return Boolean(row);
}

export async function listTodayActivation(db, accountId, { accountType = 'CASHIER', businessDate } = {}) {
  const date = businessDate || getJakartaBusinessDate();
  const row = await db.prepare(`
    SELECT store_id, activated_by_role, activated_at
    FROM account_daily_activations
    WHERE account_type = ? AND account_id = ? AND business_date = ?
    LIMIT 1
  `).bind(accountType, accountId, date).first();
  return row ? { storeId: row.store_id, activatedByRole: row.activated_by_role, activatedAt: row.activated_at } : null;
}

// Memindahkan akun ke gerai pengaktif HARI INI + mencatat baris aktivasi.
// UNIQUE (account_id, business_date) di migration 0115 membuat aktivasi
// kedua di hari yang sama (gerai lain) tertolak lewat error constraint --
// caller cukup menampilkan errornya, bukan menimpa aktivasi yang sudah ada
// (satu backup cuma satu gerai per hari, sesuai kenyataan fisiknya).
export async function activateEntityBackupCashier(db, {
  accountId, storeId, activatedByRole, activatedById, accountType = 'CASHIER', businessDate
}) {
  const date = businessDate || getJakartaBusinessDate();
  const existing = await listTodayActivation(db, accountId, { accountType, businessDate: date });
  if (existing && existing.storeId !== storeId) {
    return { ok: false, error: `Akun ini sudah diaktifkan untuk gerai lain hari ini (${date}). Satu akun backup cuma bisa aktif di satu gerai per hari.` };
  }
  if (existing) return { ok: true, alreadyActive: true };

  const id = `activation_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE cashiers SET store_id = ?, updated_at = ? WHERE id = ? AND is_entity_backup = 1`).bind(storeId, now, accountId),
    db.prepare(`
      INSERT INTO account_daily_activations (id, account_type, account_id, business_date, store_id, activated_by_role, activated_by_id, activated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, accountType, accountId, date, storeId, activatedByRole, activatedById, now)
  ]);
  return { ok: true, alreadyActive: false };
}

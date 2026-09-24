const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

// Bos Cyo, 2026-09-24: "gaji nanti juga bisa dibuat oleh akuntan sendiri...
// jadi di tanggal 26 nanti akan terlihat 2 kartu, 1 dari presensi normal, 2
// tambah entryan akuntan." Ini BUKAN bagian dari staff-attendance.js
// (buildPayroll dkk) dengan sengaja -- payroll dari presensi selalu
// dihitung ulang dari fakta, sementara ini adalah FAKTA itu sendiri (baris
// permanen, append-only). Dua sumber berbeda yang digabung tampilannya di
// endpoint pemanggil (src/cashier-auth.js), bukan dicampur logikanya di sini.
// Ditampilkan sebagai role saja ("Admin Gerai", "Owner", dst), bukan nama
// orangnya -- modul ini sengaja tidak tahu skema tabel akun manajemen
// (owner_accounts/store_admins/entity_admins beda-beda), cuma menyimpan
// role+id mentah. Cukup buat jejak audit; nama lengkap bisa ditambah nanti
// kalau memang dibutuhkan.
function mapAdjustment(row) {
  return {
    id: row.id,
    businessDate: row.business_date,
    amountRupiah: Number(row.amount_rupiah),
    reason: row.reason,
    createdByRole: row.created_by_role,
    createdAt: row.created_at,
    voided: row.voided_at != null,
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || ''
  };
}
export async function listPayrollAdjustments(db, { accountType = 'CASHIER', accountId, storeId }) {
  const rows = await db.prepare(`
    SELECT id, business_date, amount_rupiah, reason, created_by_role, created_by_id, created_at,
           voided_at, voided_by_role, voided_by_id, void_reason
    FROM payroll_adjustments
    WHERE account_type = ? AND account_id = ? AND store_id = ?
    ORDER BY business_date DESC, created_at DESC
  `).bind(accountType, accountId, storeId).all();
  return (rows.results ?? []).map(mapAdjustment);
}

function amountInput(value) {
  const number = Number(value);
  // Integer rupiah bulat, boleh negatif (potongan) atau positif (tambahan).
  // 0 ditolak -- bukan penyesuaian kalau nilainya nol, cuma bikin baris
  // kosong yang membingungkan di riwayat.
  if (!Number.isInteger(number) || number === 0) return undefined;
  return number;
}

export async function createPayrollAdjustment(db, {
  accountType = 'CASHIER', accountId, storeId, businessDate, amountRupiah, reason, createdByRole, createdById
}) {
  const amount = amountInput(amountRupiah);
  if (amount === undefined) return { ok: false, error: 'Nominal penyesuaian wajib bilangan bulat rupiah dan tidak boleh nol.' };
  const businessDateText = text(businessDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateText)) return { ok: false, error: 'Tanggal penyesuaian wajib format YYYY-MM-DD.' };
  const reasonText = text(reason, 500);
  if (!reasonText) return { ok: false, error: 'Alasan penyesuaian wajib diisi -- ini akan terlihat karyawan dan jadi jejak audit.' };

  const id = `payroll_adj_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO payroll_adjustments (id, account_type, account_id, store_id, business_date, amount_rupiah, reason, created_by_role, created_by_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, accountType, accountId, storeId, businessDateText, amount, reasonText, createdByRole, createdById, now).run();

  return { ok: true, id };
}

export async function voidPayrollAdjustment(db, { id, storeId, reason, voidedByRole, voidedById }) {
  const reasonText = text(reason, 500);
  if (!reasonText) return { ok: false, error: 'Alasan pembatalan wajib diisi.' };
  const now = new Date().toISOString();
  // WHERE store_id = ? menutup jalur Admin gerai lain membatalkan entry
  // gerai orang, dan voided_at IS NULL mencegah void dobel menimpa jejak
  // void yang sudah ada (append-only -- baris void pertama itu final).
  const result = await db.prepare(`
    UPDATE payroll_adjustments
    SET voided_at = ?, voided_by_role = ?, voided_by_id = ?, void_reason = ?
    WHERE id = ? AND store_id = ? AND voided_at IS NULL
  `).bind(now, voidedByRole, voidedById, reasonText, id, storeId).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return { ok: false, error: 'Penyesuaian tidak ditemukan di gerai ini, atau sudah dibatalkan sebelumnya.' };
  }
  return { ok: true };
}

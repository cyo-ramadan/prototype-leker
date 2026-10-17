// Pembayaran campuran (Bos Cyo, 2026-10-17; migration 0166). Satu penjualan dibayar dengan lebih dari
// satu cara bayar, mis. Rp12.000 = QRIS Rp5.000 + Tunai Rp7.000. sales.payment_method = 'CAMPURAN',
// rinciannya di sale_payments. Penjualan biasa tidak punya rincian -- semua pembaca di bawah jatuh ke
// sales.payment_method + total seperti sebelumnya.
import { resolvePosPaymentMethod } from './pos-payment-methods.js';
import { PEMBAYARAN_CAMPURAN_KEY, getTenantPolicySetting, resolveTenantId } from './tenant-policy.js';

export const CAMPURAN = 'CAMPURAN';
const MAX_BAGIAN = 3;

export async function campuranEnabled(db, entityId) {
  return getTenantPolicySetting(db, await resolveTenantId(db, entityId), PEMBAYARAN_CAMPURAN_KEY);
}

// payments: [{ paymentMethod, amount }]. Hasil: { ok, parts: [{ code, name, amount }] } atau { ok:false, error }.
// Cara bayar yang membuat hutang (creates_payable) tidak boleh dicampur: penjualan memang tidak memakainya,
// dan memecah piutang/hutang di satu nota membuat penagihan kacau.
export async function resolveSplitPayments(db, storeId, payments, total) {
  if (!Array.isArray(payments) || payments.length < 2) return { ok: false, error: 'Pembayaran campuran butuh minimal 2 cara bayar.' };
  if (payments.length > MAX_BAGIAN) return { ok: false, error: `Pembayaran campuran maksimal ${MAX_BAGIAN} cara bayar.` };
  const parts = [];
  for (const item of payments) {
    const amount = Number(item?.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: 'Nominal tiap cara bayar harus angka bulat lebih dari 0.' };
    const method = await resolvePosPaymentMethod(db, storeId, String(item?.paymentMethod || '').trim().toUpperCase() || 'X');
    if (!method || method.code === CAMPURAN) return { ok: false, error: 'Ada cara bayar yang tidak aktif / tidak terdaftar.' };
    if (parts.some(part => part.code === method.code)) return { ok: false, error: `Cara bayar ${method.name} dipilih dua kali.` };
    const payable = await db.prepare(`SELECT creates_payable FROM payment_methods WHERE store_id = ? AND code = ? LIMIT 1`).bind(storeId, method.code).first();
    if (Number(payable?.creates_payable)) return { ok: false, error: `${method.name} tidak bisa dipakai di pembayaran campuran.` };
    parts.push({ code: method.code, name: method.name, amount });
  }
  const sum = parts.reduce((acc, part) => acc + part.amount, 0);
  if (sum !== Number(total)) return { ok: false, error: `Jumlah pembayaran (Rp${sum.toLocaleString('id-ID')}) harus sama dengan total (Rp${Number(total).toLocaleString('id-ID')}).`, code: 'SPLIT_TOTAL_MISMATCH' };
  return { ok: true, parts };
}

export function buildSalePaymentStatements(db, { saleId, storeId, parts, now }) {
  return parts.map(part => db.prepare(`
    INSERT INTO sale_payments (id, sale_id, store_id, payment_method_code, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(`salepay_${crypto.randomUUID()}`, saleId, storeId, part.code, part.amount, now));
}

// Rincian bayar per penjualan. Penjualan biasa -> satu bagian = cara bayarnya, sebesar total.
export async function salePaymentParts(db, sale) {
  if (String(sale?.payment_method || '').toUpperCase() !== CAMPURAN) {
    return [{ code: sale?.payment_method || 'CASH', amount: Number(sale?.total_amount || 0) }];
  }
  const rows = (await db.prepare(`SELECT payment_method_code, amount FROM sale_payments WHERE sale_id = ? ORDER BY amount DESC, payment_method_code`).bind(sale.id).all()).results ?? [];
  return rows.map(row => ({ code: row.payment_method_code, amount: Number(row.amount) }));
}

export function salePaymentLabel(parts) {
  return parts.map(part => `${part.code} ${Number(part.amount).toLocaleString('id-ID')}`).join(' + ');
}

// GET /api/cashier/pembayaran-campuran -> { enabled } supaya kasir hanya menampilkan pilihan
// "Campuran" bila saklar tenantnya aktif. Server tetap menolak (403) penjualan campuran bila mati.
export async function handleSalePaymentsApi(request, env, pathname, requireCashier) {
  if (pathname !== '/api/cashier/pembayaran-campuran' || request.method !== 'GET') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await env.DB.prepare('SELECT entity_id FROM stores WHERE id = ?').bind(auth.cashier.store.id).first();
  return Response.json({ enabled: await campuranEnabled(env.DB, store?.entity_id || null) }, { headers: { 'cache-control': 'no-store' } });
}

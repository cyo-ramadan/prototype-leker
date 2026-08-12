import { json } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { requireDrawerOwner } from './cashier-drawer.js';
import { isMultipartRequest, readLivePhoto } from './live-photo.js';

const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export async function handleCashDrawerLivePhotoApi(request, env, pathname) {
  if (request.method !== 'POST' || pathname !== '/api/cashdrawer/close') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const ownership = await requireDrawerOwner(env.DB, auth.cashier);
  if (!ownership.ok) return ownership.response;
  if (!isMultipartRequest(request)) return json({ error: 'Tutup laci dengan Live Photo wajib multipart/form-data.' }, 415);

  const form = await request.formData();
  const closingAmount = Number(form.get('closingAmount'));
  if (!Number.isFinite(closingAmount) || closingAmount < 0 || !Number.isInteger(closingAmount)) {
    return json({ error: 'Saldo akhir laci wajib berupa bilangan rupiah valid.' }, 400);
  }
  const photo = await readLivePhoto(form, 'photo');
  if (!photo.ok) return json({ error: photo.error }, photo.status);

  const now = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE cash_drawer_sessions
    SET closing_amount = ?, status = 'CLOSED', closed_at = ?, closing_note = ?,
        closing_photo = ?, closing_photo_type = ?
    WHERE id = ? AND cashier_id = ? AND status = 'OPEN'
  `).bind(
    closingAmount,
    now,
    text(form.get('closingNote'), 500),
    photo.bytes,
    photo.type,
    ownership.drawer.id,
    auth.cashier.id
  ).run();
  if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
    return json({ error: 'Laci sudah berubah status di request lain.' }, 409);
  }
  return json({ ok: true, drawerId: ownership.drawer.id, closedAt: now, photoType: photo.type });
}

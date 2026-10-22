import { json, readJson } from './http.js';
import { ownerEntityContext } from './owner-entity-context.js';
import { getJakartaBusinessDate } from './time.js';
import { createPenyesuaian, reevaluate, rekap, saveSettings, setBerhenti, setCsStatus, setPengganti, settingsOverview, voidPenyesuaian } from './dana-apresiasi.js';

// Entity Admin -> Pengaturan -> Dana Apresiasi & Denda (ADR-058). Satu pintu untuk saklar (bawaan
// entity + override per gerai), angka, jam operasional, status akun CS asli/freelance, rekap
// harian/bulanan, koreksi "menggantikan siapa", dan penyesuaian (alasan syar'i).

const BASE = '/api/entity-admin/dana-apresiasi';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);

export async function handleDanaApresiasiApi(request, env, pathname) {
  if (!pathname.startsWith(`${BASE}/`)) return null;
  const context = await ownerEntityContext(request, env, { allowEntityAdminOutsideSkin: true });
  if (context.response) return context.response;
  const db = env.DB;
  const actor = context.entityAdmin ? { role: 'ENTITY_ADMIN', id: context.entityAdmin.id } : { role: 'OWNER', id: context.owner?.id || '' };
  const storeIds = new Set(context.stores.map(store => store.id));
  const route = pathname.slice(BASE.length);

  if (request.method === 'GET' && route === '/settings') {
    return json(await settingsOverview(db, { entityId: context.entityId, stores: context.stores }));
  }
  if (request.method === 'GET' && route === '/rekap') {
    const url = new URL(request.url);
    const today = getJakartaBusinessDate();
    const from = DATE.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : `${today.slice(0, 8)}01`;
    const to = DATE.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : today;
    if (from > to) return json({ error: 'Tanggal awal harus sebelum tanggal akhir.' }, 400);
    return json(await rekap(db, { entityId: context.entityId, stores: context.stores, from, to }));
  }
  if (request.method !== 'POST') return json({ error: 'Route Dana Apresiasi tidak ditemukan.' }, 404);
  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
  const input = body.value || {};

  if (route === '/settings') {
    const storeId = text(input.storeId, 120);
    if (storeId && !storeIds.has(storeId)) return json({ error: 'Gerai di luar entity ini.' }, 403);
    const result = await saveSettings(db, { entityId: context.entityId, storeId, input, actor });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
  }
  if (route === '/status') {
    const accountId = text(input.accountId, 120);
    const account = await db.prepare('SELECT store_id FROM cashiers WHERE id = ?').bind(accountId).first();
    if (!account || !storeIds.has(account.store_id)) return json({ error: 'Akun kasir di luar entity ini.' }, 403);
    const result = await setCsStatus(db, { accountId, status: input.status, actor });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
  }
  if (route === '/pengganti') {
    const attendanceId = text(input.attendanceId, 120);
    const session = await db.prepare('SELECT store_id FROM staff_attendance WHERE id = ?').bind(attendanceId).first();
    if (!session || !storeIds.has(session.store_id)) return json({ error: 'Sesi presensi di luar entity ini.' }, 403);
    const result = await setPengganti(db, { attendanceId, replacesAccountId: input.replacesAccountId ?? 'AUTO', actor });
    return result.ok ? json({ ok: true, reevaluated: result.reevaluated }) : json({ error: result.error }, 400);
  }
  // CS berhenti/resign per tanggal (2026-10-22): shift sesudahnya tidak dinilai, yang terlanjur dibatalkan.
  if (route === '/berhenti') {
    const accountId = text(input.accountId, 120);
    const account = await db.prepare('SELECT store_id FROM cashiers WHERE id = ?').bind(accountId).first();
    if (!account || !storeIds.has(account.store_id)) return json({ error: 'Akun kasir di luar entity ini.' }, 403);
    const result = await setBerhenti(db, { accountId, tanggal: input.tanggal || null, actor });
    return result.ok ? json({ ok: true, reevaluated: result.reevaluated }) : json({ error: result.error }, 400);
  }
  // Nilai ulang satu shift dengan jadwal & presensi terbaru (dryRun = pratinjau, tidak menulis).
  if (route === '/nilai-ulang') {
    const evaluationId = text(input.evaluationId, 120);
    const evaluation = await db.prepare('SELECT store_id FROM apresiasi_evaluations WHERE id = ?').bind(evaluationId).first();
    if (!evaluation || !storeIds.has(evaluation.store_id)) return json({ error: 'Penilaian shift di luar entity ini.' }, 403);
    const result = await reevaluate(db, evaluationId, {
      actor, reason: text(input.reason, 200) || 'Nilai ulang dengan jadwal & presensi terbaru', jadwalSekarang: true, dryRun: input.dryRun === true
    });
    return result.ok ? json(result) : json({ error: result.error }, 400);
  }
  if (route === '/penyesuaian') {
    const result = await createPenyesuaian(db, {
      entityId: context.entityId, entryId: text(input.entryId, 120), amountRupiah: input.amountRupiah, note: input.note, actor
    });
    return result.ok ? json({ ok: true, id: result.id }, 201) : json({ error: result.error }, 400);
  }
  const voidMatch = route.match(/^\/penyesuaian\/([^/]+)\/void$/);
  if (voidMatch) {
    const result = await voidPenyesuaian(db, { entityId: context.entityId, id: decodeURIComponent(voidMatch[1]), reason: input.reason, actor });
    return result.ok ? json({ ok: true }) : json({ error: result.error }, 400);
  }
  return json({ error: 'Route Dana Apresiasi tidak ditemukan.' }, 404);
}

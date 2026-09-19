import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';
import { requireCashier } from './cashier-auth.js';
import { getJakartaBusinessDate } from './time.js';

// Bos Cyo, 2026-09-19: "portal staf kasih tombol daily task ya, nanti
// isi2nya aku mau kasih seperti pakai appron, bersih2, tes rasa2 ...
// pengaturan task juga di set up oleh admin dari panel nya." Template
// (daily_task_templates) diisi Admin per gerai -- migration 0109. Isi
// contoh (apron/bersih-bersih/tes rasa) TIDAK di-hardcode di sini.
//
// Video bukti tugas (max 8 detik, auto-hapus) BELUM diimplementasi --
// menunggu R2 diaktifkan di akun Cloudflare (dicek langsung: r2_buckets_list
// masih 403 "Please enable R2 through the Cloudflare Dashboard" per
// 2026-09-19). Checklist ini murni tandai selesai + catatan teks dulu.
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const noteText = (value, max = 500) => String(value ?? '').trim().slice(0, max);

function mapTemplate(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    isActive: Boolean(row.is_active),
    sortOrder: row.sort_order
  };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleStaffDailyTaskApi(request, env, pathname) {
  const db = env.DB;

  // Portal Staf -- checklist HARI INI (tanggal bisnis Jakarta) untuk gerai
  // kasir yang login, digabung dengan completion miliknya sendiri.
  if (request.method === 'GET' && pathname === '/api/staff/daily-tasks') {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    const businessDate = getJakartaBusinessDate();
    const rows = await db.prepare(`
      SELECT t.id, t.title, t.description,
             c.id AS completion_id, c.note, c.completed_at
      FROM daily_task_templates t
      LEFT JOIN daily_task_completions c
        ON c.template_id = t.id AND c.cashier_id = ? AND c.business_date = ?
      WHERE t.store_id = ? AND t.is_active = 1
      ORDER BY t.sort_order, t.title COLLATE NOCASE
    `).bind(auth.cashier.id, businessDate, auth.cashier.store.id).all();
    return json({
      businessDate,
      tasks: (rows.results ?? []).map(row => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        completed: row.completion_id != null,
        note: row.note || '',
        completedAt: row.completed_at || null
      }))
    });
  }

  if (request.method === 'POST' && pathname === '/api/staff/daily-tasks/complete') {
    const auth = await requireCashier(request, db);
    if (!auth.ok) return auth.response;
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const templateId = text(body.value?.templateId, 80);
    if (!templateId) return json({ error: 'templateId wajib diisi.' }, 400);
    const template = await db.prepare('SELECT id FROM daily_task_templates WHERE id = ? AND store_id = ? AND is_active = 1')
      .bind(templateId, auth.cashier.store.id).first();
    if (!template) return json({ error: 'Tugas tidak ditemukan di gerai ini.' }, 404);
    const businessDate = getJakartaBusinessDate();
    const note = noteText(body.value?.note);
    const id = `dailytaskdone_${crypto.randomUUID()}`;
    // ON CONFLICT (UNIQUE template_id+cashier_id+business_date, migration 0109)
    // -- klik "selesai" berkali-kali di hari yang sama TIDAK bikin baris baru,
    // cuma memperbarui catatan+jam selesainya.
    await db.prepare(`
      INSERT INTO daily_task_completions (id, template_id, cashier_id, store_id, business_date, note, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (template_id, cashier_id, business_date) DO UPDATE SET
        note = excluded.note, completed_at = CURRENT_TIMESTAMP
    `).bind(id, templateId, auth.cashier.id, auth.cashier.store.id, businessDate, note).run();
    return json({ ok: true });
  }

  if (!pathname.startsWith('/api/admin/daily-task-templates')) return null;

  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/daily-task-templates') {
    const rows = await db.prepare(`
      SELECT id, title, description, is_active, sort_order
      FROM daily_task_templates WHERE store_id = ?
      ORDER BY sort_order, title COLLATE NOCASE
    `).bind(store.id).all();
    return json({ templates: (rows.results ?? []).map(mapTemplate), store });
  }

  if (request.method === 'POST' && pathname === '/api/admin/daily-task-templates') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const title = text(body.value?.title, 100);
    if (!title) return json({ error: 'Judul tugas wajib diisi.' }, 400);
    const description = text(body.value?.description, 500);
    const sortOrder = Number.isFinite(Number(body.value?.sortOrder)) ? Math.trunc(Number(body.value.sortOrder)) : 0;
    const id = `dailytask_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO daily_task_templates (id, store_id, title, description, is_active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, store.id, title, description, sortOrder).run();
    return json({ ok: true, id }, 201);
  }

  const match = pathname.match(/^\/api\/admin\/daily-task-templates\/([^/]+)$/);
  if (!match) return json({ error: 'Route Daily Task tidak ditemukan.' }, 404);
  const id = decodeURIComponent(match[1]);
  const current = await db.prepare('SELECT id FROM daily_task_templates WHERE id = ? AND store_id = ?').bind(id, store.id).first();
  if (!current) return json({ error: 'Tugas tidak ditemukan di gerai ini.' }, 404);

  if (request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload tidak valid.' }, 400);
    const owns = key => Object.prototype.hasOwnProperty.call(body.value || {}, key);
    const fields = [];
    const values = [];
    if (owns('title')) {
      const title = text(body.value.title, 100);
      if (!title) return json({ error: 'Judul tugas tidak boleh kosong.' }, 400);
      fields.push('title = ?'); values.push(title);
    }
    if (owns('description')) { fields.push('description = ?'); values.push(text(body.value.description, 500)); }
    if (owns('sortOrder')) { fields.push('sort_order = ?'); values.push(Math.trunc(Number(body.value.sortOrder)) || 0); }
    if (owns('isActive')) { fields.push('is_active = ?'); values.push(body.value.isActive ? 1 : 0); }
    if (!fields.length) return json({ error: 'Tidak ada field untuk diubah.' }, 400);
    fields.push('updated_at = CURRENT_TIMESTAMP');
    await db.prepare(`UPDATE daily_task_templates SET ${fields.join(', ')} WHERE id = ? AND store_id = ?`).bind(...values, id, store.id).run();
    return json({ ok: true });
  }

  return json({ error: 'Method tidak didukung.' }, 405);
}

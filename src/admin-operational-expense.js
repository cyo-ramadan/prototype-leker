import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';

// Bea Operasional dari panel Admin Gerai (migration 0100) -- Bos Cyo,
// 2026-09-17. Uang keluar yang dibayar Admin, bukan lewat laci kasir:
// Bea Gaji, Bea Lapak, Bea Lainnya.
//
// Ini sumber Beban KEDUA untuk Laporan Net Profit (yang pertama tabel
// `expenses`/Pengeluaran Kasir). Sudah didaftarkan di
// src/net-profit-report.js -- jangan tambah jenis bea baru di sini tanpa
// memastikan pendaftaran itu masih mencakupnya.

export const BEA_CATEGORIES = Object.freeze([
  { code: 'BEA_GAJI', label: 'Bea Gaji' },
  { code: 'BEA_LAPAK', label: 'Bea Lapak' },
  { code: 'BEA_LAINNYA', label: 'Bea Lainnya' }
]);

const CATEGORY_CODES = new Set(BEA_CATEGORIES.map(item => item.code));
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

// Batas atas sekadar pagar salah ketik (mis. kelebihan nol), bukan aturan
// bisnis. Rupiah bulat -- bukan skala 1.000.000, itu khusus HPP/jurnal.
const MAX_AMOUNT_RUPIAH = 1_000_000_000;

function amountInput(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_AMOUNT_RUPIAH) return null;
  return number;
}

function businessDateInput(value) {
  const trimmed = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return trimmed;
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: 'LEGACY_PIN', id: '' };
}

function mapExpense(row) {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: BEA_CATEGORIES.find(item => item.code === row.category)?.label || row.category,
    description: row.description,
    amount: Number(row.amount || 0),
    businessDate: row.business_date,
    note: row.note || '',
    createdAt: row.created_at,
    createdByRole: row.created_by_role || '',
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || ''
  };
}

async function listExpenses(db, storeId, { from, to, limit = 200 } = {}) {
  const clauses = ['store_id = ?'];
  const values = [storeId];
  if (from) { clauses.push('business_date >= ?'); values.push(from); }
  if (to) { clauses.push('business_date <= ?'); values.push(to); }
  const rows = await db.prepare(`
    SELECT id, category, description, amount, business_date, note, created_at,
           created_by_role, voided_at, void_reason
    FROM admin_operational_expenses
    WHERE ${clauses.join(' AND ')}
    ORDER BY business_date DESC, created_at DESC
    LIMIT ?
  `).bind(...values, limit).all();
  return (rows.results ?? []).map(mapExpense);
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminOperationalExpenseApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/operational-expenses')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const actor = actorFrom(auth);
  const url = new URL(request.url);

  if (request.method === 'GET' && pathname === '/api/admin/operational-expenses') {
    return json({
      store,
      categories: BEA_CATEGORIES,
      today: getJakartaBusinessDate(),
      expenses: await listExpenses(db, store.id, {
        from: businessDateInput(url.searchParams.get('from')),
        to: businessDateInput(url.searchParams.get('to'))
      })
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/operational-expenses') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Bea Operasional tidak valid.' }, 400);

    const category = text(body.value?.category, 20).toUpperCase();
    if (!CATEGORY_CODES.has(category)) return json({ error: 'Jenis bea tidak dikenal.', code: 'UNKNOWN_BEA_CATEGORY' }, 400);

    const description = text(body.value?.description, 220);
    if (!description) return json({ error: 'Keterangan bea wajib diisi.' }, 400);

    const amount = amountInput(body.value?.amount);
    if (amount === null) return json({ error: 'Nominal bea harus bilangan bulat rupiah yang wajar.' }, 400);
    if (amount === 0) return json({ error: 'Nominal bea tidak boleh nol.' }, 400);

    // Default hari ini kalau tidak diisi -- Admin tetap boleh mundur (bayar
    // gaji tanggal 5 untuk periode bulan lalu).
    const businessDate = businessDateInput(body.value?.businessDate) || getJakartaBusinessDate();

    const id = `beaops_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO admin_operational_expenses (
        id, store_id, category, description, amount, business_date, note,
        created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(id, store.id, category, description, amount, businessDate, text(body.value?.note, 500), actor.role, actor.id).run();

    // Hari yang sudah ditutup-buku mungkin sudah tersimpan di cache laporan
    // dengan angka lama -- buang cache tanggal itu supaya dihitung ulang.
    await invalidateDailyProfitSnapshot(db, store.id, businessDate);

    return json({ ok: true, id, expenses: await listExpenses(db, store.id) }, 201);
  }

  const voidMatch = pathname.match(/^\/api\/admin\/operational-expenses\/([^/]+)\/void$/);
  if (request.method === 'POST' && voidMatch) {
    const id = decodeURIComponent(voidMatch[1]);
    const current = await db.prepare('SELECT id, business_date, voided_at FROM admin_operational_expenses WHERE id = ? AND store_id = ?')
      .bind(id, store.id).first();
    if (!current) return json({ error: 'Bea tidak ditemukan di gerai ini.' }, 404);
    if (current.voided_at) return json({ error: 'Bea ini sudah dibatalkan sebelumnya.', code: 'ALREADY_VOIDED' }, 409);

    const body = await readJson(request);
    const reason = body.ok ? text(body.value?.reason, 200) : '';
    const result = await db.prepare(`
      UPDATE admin_operational_expenses
      SET voided_at = CURRENT_TIMESTAMP, voided_by_role = ?, voided_by_id = ?, void_reason = ?
      WHERE id = ? AND store_id = ? AND voided_at IS NULL
    `).bind(actor.role, actor.id, reason, id, store.id).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Bea sudah berubah di request lain.' }, 409);
    }

    await invalidateDailyProfitSnapshot(db, store.id, current.business_date);
    return json({ ok: true, expenses: await listExpenses(db, store.id) });
  }

  return json({ error: 'Route Bea Operasional tidak ditemukan.' }, 404);
}

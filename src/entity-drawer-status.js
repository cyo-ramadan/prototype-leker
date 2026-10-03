import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, listStores, resolveStore } from './stores.js';

// Status laci semua gerai di Admin Entity (Bos Cyo, 2026-10-03): "tombol buat
// cek gerai mana yang saat ini dibuka laci ... status open or close, kasih jam
// terkininya ... sama kasih cs yang bukanya siapa."
//
//   GET /api/admin/entity-drawer-status?store=<gerai pemanggil>
//
// Baca-saja, dua query untuk seluruh gerai (laci OPEN lewat indeks unik "satu
// laci buka per gerai"; laci tutup terakhir per gerai), tanpa query per gerai.
// Pagar sama dengan Stok Gerai / Laporan Net Profit (invariant #5): Owner dan
// Admin Entity melihat semua gerai aktif di entity; Admin Gerai hanya gerainya.

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function buildEntityDrawerStatus(db, stores) {
  if (!stores.length) return [];
  const ids = stores.map(store => store.id);
  const marks = ids.map(() => '?').join(',');
  const open = await db.prepare(`
    SELECT d.store_id, d.opened_at, d.opening_amount, d.shift_label, c.employee_name, c.username
    FROM cash_drawer_sessions d
    LEFT JOIN cashiers c ON c.id = d.cashier_id
    WHERE d.status = 'OPEN' AND d.store_id IN (${marks})
  `).bind(...ids).all();
  const lastClosed = await db.prepare(`
    SELECT d.store_id, d.opened_at, d.closed_at, c.employee_name, c.username
    FROM cash_drawer_sessions d
    JOIN (
      SELECT store_id, MAX(closed_at) AS closed_at
      FROM cash_drawer_sessions
      WHERE status = 'CLOSED' AND store_id IN (${marks})
      GROUP BY store_id
    ) latest ON latest.store_id = d.store_id AND latest.closed_at = d.closed_at
    LEFT JOIN cashiers c ON c.id = d.cashier_id
    WHERE d.status = 'CLOSED'
  `).bind(...ids).all();
  const openByStore = new Map((open.results ?? []).map(row => [row.store_id, row]));
  const closedByStore = new Map((lastClosed.results ?? []).map(row => [row.store_id, row]));
  const who = row => (row?.employee_name || row?.username || '').trim();

  return stores.map(store => {
    const current = openByStore.get(store.id);
    const previous = closedByStore.get(store.id);
    if (current) {
      return {
        code: store.code, storeName: store.storeName, status: 'OPEN',
        since: current.opened_at, openedBy: who(current), shiftLabel: current.shift_label || ''
      };
    }
    if (previous) {
      return {
        code: store.code, storeName: store.storeName, status: 'CLOSED',
        since: previous.closed_at, lastOpenedBy: who(previous), lastOpenedAt: previous.opened_at
      };
    }
    return { code: store.code, storeName: store.storeName, status: 'NEVER', since: null };
  });
}

export async function handleEntityDrawerStatusApi(request, env, pathname) {
  if (pathname !== '/api/admin/entity-drawer-status' || request.method !== 'GET') return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const callerStore = await selectedStore(db, request);
  if (!callerStore) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  if (!callerStore.entityId) return json({ error: 'Gerai ini belum terhubung ke Entity mana pun.', code: 'STORE_WITHOUT_ENTITY' }, 409);

  const entityWide = Boolean(auth.owner || auth.entityAdmin);
  const entityStores = (await listStores(db, { includeInactive: true }))
    .filter(store => store.entityId === callerStore.entityId && store.isActive);
  const allowed = entityWide ? entityStores : entityStores.filter(store => store.id === callerStore.id);
  const stores = await buildEntityDrawerStatus(db, allowed);
  return json({
    scope: entityWide ? 'ENTITY' : 'STORE',
    asOf: new Date().toISOString(),
    openCount: stores.filter(item => item.status === 'OPEN').length,
    stores
  });
}

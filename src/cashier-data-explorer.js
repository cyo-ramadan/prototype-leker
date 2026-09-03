import { json } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { listStoreTransactions, parseIso, parseCursor as parseTransactionCursor } from './admin-transactions.js';
import { listStoreStockBalances, listProductStockMovements, parseCursor as parseStockCursor } from './admin-stock.js';

// Read-only mirror of Admin's Transaksi + Stok tabs for Kasir/CS. Same query
// logic (imported, not duplicated), but the store always comes from the
// authenticated cashier's own account -- never from a client-supplied ?store=
// -- so a kasir can only ever see their own gerai's data.
export async function handleCashierDataApi(request, env, pathname) {
  if (!pathname.startsWith('/api/cashier/data/')) return null;
  if (request.method !== 'GET') return json({ error: 'Data Transaksi/Stok kasir saat ini read-only.' }, 405);
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const storeId = auth.cashier.store.id;
  const url = new URL(request.url);

  if (pathname === '/api/cashier/data/transactions') {
    const filter = String(url.searchParams.get('filter') || 'ALL').trim().toUpperCase();
    const from = parseIso(url.searchParams.get('from'));
    const to = parseIso(url.searchParams.get('to'));
    if (url.searchParams.get('from') && !from) return json({ error: 'Tanggal awal tidak valid.' }, 400);
    if (url.searchParams.get('to') && !to) return json({ error: 'Tanggal akhir tidak valid.' }, 400);
    const rawCursor = url.searchParams.get('before');
    const before = parseTransactionCursor(rawCursor);
    if (rawCursor && !before) return json({ error: 'Cursor transaksi tidak valid.' }, 400);
    const requestedLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;
    const listing = await listStoreTransactions(env.DB, storeId, { filter, from, to, before, limit });
    if (!listing.ok) return json({ error: listing.error }, 400);
    return json({ filter: listing.filter, transactions: listing.transactions, hasMore: listing.hasMore, nextCursor: listing.nextCursor });
  }

  if (pathname === '/api/cashier/data/stock') {
    return json({ stocks: await listStoreStockBalances(env.DB, storeId) });
  }

  const match = pathname.match(/^\/api\/cashier\/data\/stock\/(\d+)\/movements$/);
  if (match) {
    const productId = Number(match[1]);
    const before = parseStockCursor(url.searchParams.get('before'));
    if (url.searchParams.get('before') && !before) return json({ error: 'Cursor mutasi stok tidak valid.' }, 400);
    const requestedLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(10, requestedLimit)) : 50;
    const listing = await listProductStockMovements(env.DB, storeId, productId, { before, limit });
    if (!listing.ok) return json({ error: listing.error }, 404);
    return json({ product: listing.product, movements: listing.movements, hasMore: listing.hasMore, nextCursor: listing.nextCursor });
  }

  return json({ error: 'Route Data kasir tidak ditemukan.' }, 404);
}

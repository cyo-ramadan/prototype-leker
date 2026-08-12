import { json } from './http.js';
import { requireCashier } from './cashier-auth.js';
import { resolveCustomerScope } from './customer-sharing.js';

const placeholders = count => Array.from({ length: count }, () => '?').join(', ');

function likeTerm(value) {
  return String(value || '').trim().slice(0, 80).replace(/[\\%_]/g, char => `\\${char}`);
}

export async function handleCashierCustomerSearchApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/cashier/customers/search') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) return auth.response;
  const query = likeTerm(new URL(request.url).searchParams.get('q'));
  if (query.length < 2) return json({ customers: [] });

  const scope = await resolveCustomerScope(env.DB, auth.cashier.store.id);
  const term = `%${query}%`;
  const rows = await env.DB.prepare(`
    SELECT c.id, c.customer_code, c.customer_name, c.phone, c.username,
           s.code AS store_code, s.store_name
    FROM customers c
    JOIN stores s ON s.id = c.store_id
    WHERE c.is_active = 1
      AND c.store_id IN (${placeholders(scope.storeIds.length)})
      AND (
        c.customer_name LIKE ? ESCAPE '\\'
        OR c.customer_code LIKE ? ESCAPE '\\'
        OR c.phone LIKE ? ESCAPE '\\'
        OR COALESCE(c.username, '') LIKE ? ESCAPE '\\'
      )
    ORDER BY c.customer_name COLLATE NOCASE, c.id
    LIMIT 10
  `).bind(...scope.storeIds, term, term, term, term).all();

  return json({
    sharing: scope.group,
    customers: (rows.results ?? []).map(row => ({
      id: row.id,
      customerCode: row.customer_code,
      customerName: row.customer_name,
      phone: row.phone || '',
      username: row.username || '',
      store: { code: row.store_code, storeName: row.store_name }
    }))
  });
}

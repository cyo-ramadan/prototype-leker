import { json, readJson } from './http.js';
import { DEFAULT_STORE_CODE, listStores, normalizeStoreCode, resolveStore } from './stores.js';
import { requireManagement } from './owner-auth.js';

const MAX_PRODUCT_IMAGE_LENGTH = 900_000;
const MAX_LOGO_IMAGE_LENGTH = 500_000;
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const COST_SCALE = 1_000_000;
const costFromScaled = value => Number(value || 0) / COST_SCALE;
const scaledPurchasePrice = value => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10_000_000) return null;
  const scaled = Math.round(number * COST_SCALE);
  return Number.isSafeInteger(scaled) ? scaled : null;
};

function imageData(value, maxLength) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!normalized.startsWith('data:image/')) return null;
  return normalized.length <= maxLength ? normalized : null;
}

async function hashPin(pin) {
  const bytes = new TextEncoder().encode(String(pin ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getAdminSettings(db) {
  return db.prepare('SELECT admin_pin_hash FROM store_settings WHERE id = 1').first();
}

async function requireAdmin(request, db) {
  return requireManagement(request, db);
}

function storeTokenFrom(request) {
  return new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
}

async function selectedStore(db, request, includeInactive = true) {
  return resolveStore(db, storeTokenFrom(request), { includeInactive });
}

// null = tidak diisi (biarkan apa adanya / tidak dikelompokkan), undefined
// dipakai sebagai penanda gagal validasi supaya berbeda dari null yang sah.
async function resolveCategoryGroupId(db, storeId, rawCategoryGroupId) {
  if (rawCategoryGroupId === null || rawCategoryGroupId === undefined || rawCategoryGroupId === '') return null;
  const categoryGroupId = Number(rawCategoryGroupId);
  if (!Number.isInteger(categoryGroupId)) return undefined;
  const group = await db.prepare('SELECT id FROM category_groups WHERE id = ? AND store_id = ?').bind(categoryGroupId, storeId).first();
  return group ? categoryGroupId : undefined;
}

async function ensureCategory(db, storeId, categoryName) {
  const existing = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND name = ?').bind(storeId, categoryName).first();
  if (existing) return;
  const next = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM categories WHERE store_id = ?').bind(storeId).first();
  await db.prepare(`
    INSERT INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(storeId, categoryName, Number(next?.next_order ?? 1)).run();
}

const mapProduct = row => ({
  id: row.id,
  name: row.name,
  purchasePrice: costFromScaled(row.purchase_price),
  price: costFromScaled(row.price),
  category: row.category,
  emoji: row.emoji,
  hasImage: Boolean(row.has_image),
  displayOrder: row.display_order,
  isActive: Boolean(row.is_active)
});

// 2026-09-15, Bos Cyo: Admin Dermo "berat banget, malah ga bisa masuk".
// Dermo punya 118 barang berfoto, ~3.1MB base64 digabung -- bootstrap lama
// mengirim semuanya sekaligus dalam satu respons JSON tiap kali dashboard
// dibuka, jadi loginnya sendiri nunggu 3.1MB itu selesai. Diganti: listing
// cuma bawa flag hasImage, fotonya sendiri diambil satu-satu lewat endpoint
// terpisah (lihat productImageMatch di bawah) begitu barisnya dirender.
function decodeProductImage(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  try {
    return { contentType: match[1], bytes: Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)) };
  } catch {
    return null;
  }
}
const mapCategory = row => ({ id: row.id, name: row.name, displayOrder: row.display_order, isActive: Boolean(row.is_active), categoryGroupId: row.category_group_id || null });
const mapCategoryGroup = row => ({ id: row.id, name: row.name, displayOrder: row.display_order, isActive: Boolean(row.is_active) });
const mapContact = row => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at });

async function adminBootstrap(db, store) {
  const [stores, products, categories, categoryGroups, contacts] = await Promise.all([
    listStores(db, { includeInactive: true }),
    db.prepare(`SELECT id, name, purchase_price, price, category, emoji, display_order, is_active, (image_data IS NOT NULL AND image_data != '') AS has_image FROM products WHERE store_id = ? ORDER BY display_order, id`).bind(store.id).all(),
    db.prepare(`SELECT id, name, display_order, is_active, category_group_id FROM categories WHERE store_id = ? ORDER BY display_order, id`).bind(store.id).all(),
    db.prepare(`SELECT id, name, display_order, is_active FROM category_groups WHERE store_id = ? ORDER BY display_order, id`).bind(store.id).all(),
    db.prepare(`SELECT id, name, phone, email, notes, created_at, updated_at FROM contacts WHERE store_id = ? ORDER BY name COLLATE NOCASE`).bind(store.id).all()
  ]);
  return {
    store,
    stores,
    products: (products.results ?? []).map(mapProduct),
    categories: (categories.results ?? []).map(mapCategory),
    categoryGroups: (categoryGroups.results ?? []).map(mapCategoryGroup),
    contacts: (contacts.results ?? []).map(mapContact)
  };
}

export async function getPublicStore(db, storeId) {
  const store = await resolveStore(db, storeId);
  return store ? { storeId: store.id, code: store.code, storeName: store.storeName, address: store.address, logoData: store.logoData } : null;
}

export async function handleAdminApi(request, env, pathname) {
  const db = env.DB;

  if (request.method === 'GET' && pathname === '/api/admin/status') {
    const settings = await getAdminSettings(db);
    return json({ setupRequired: !settings?.admin_pin_hash, defaultStoreCode: DEFAULT_STORE_CODE });
  }

  if (request.method === 'POST' && pathname === '/api/admin/setup') {
    const settings = await getAdminSettings(db);
    if (settings?.admin_pin_hash) return json({ error: 'Admin PIN sudah pernah dibuat.' }, 409);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const pin = String(body.value?.pin ?? '').trim();
    if (!/^\d{4,12}$/.test(pin)) return json({ error: 'PIN harus 4–12 digit.' }, 400);
    await db.prepare('UPDATE store_settings SET admin_pin_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').bind(await hashPin(pin)).run();
    return json({ ok: true });
  }

  const auth = await requireAdmin(request, db);
  if (!auth.ok) return auth.response;

  if (request.method === 'POST' && pathname === '/api/admin/stores') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const code = normalizeStoreCode(body.value?.code);
    const storeName = text(body.value?.storeName, 80);
    const address = text(body.value?.address, 180);
    const logo = imageData(body.value?.logoData, MAX_LOGO_IMAGE_LENGTH);
    if (code.length < 2 || !storeName) return json({ error: 'Kode gerai dan nama gerai wajib diisi.' }, 400);
    if (logo === null) return json({ error: 'Logo tidak valid atau terlalu besar.' }, 400);
    const duplicate = await db.prepare('SELECT id FROM stores WHERE code = ?').bind(code).first();
    if (duplicate) return json({ error: 'Kode gerai sudah dipakai.' }, 409);
    const id = `store_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO stores (id, code, store_name, address, logo_data, is_active) VALUES (?, ?, ?, ?, ?, 1)`).bind(id, code, storeName, address, logo).run();
    return json({ ok: true, store: await resolveStore(db, id, { includeInactive: true }) }, 201);
  }

  const storeMatch = pathname.match(/^\/api\/admin\/stores\/([^/]+)$/);
  if (storeMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const id = decodeURIComponent(storeMatch[1]);
    const current = await resolveStore(db, id, { includeInactive: true });
    if (!current) return json({ error: 'Gerai tidak ditemukan.' }, 404);
    const code = normalizeStoreCode(body.value?.code ?? current.code);
    const storeName = text(body.value?.storeName ?? current.storeName, 80);
    const address = text(body.value?.address ?? current.address, 180);
    const logo = body.value?.logoData === undefined ? current.logoData : imageData(body.value.logoData, MAX_LOGO_IMAGE_LENGTH);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (code.length < 2 || !storeName || logo === null) return json({ error: 'Data gerai tidak valid.' }, 400);
    const duplicate = await db.prepare('SELECT id FROM stores WHERE code = ? AND id <> ?').bind(code, id).first();
    if (duplicate) return json({ error: 'Kode gerai sudah dipakai.' }, 409);
    await db.prepare(`UPDATE stores SET code = ?, store_name = ?, address = ?, logo_data = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(code, storeName, address, logo, isActive, id).run();
    return json({ ok: true, store: await resolveStore(db, id, { includeInactive: true }) });
  }

  const store = await selectedStore(db, request, true);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  if (request.method === 'GET' && pathname === '/api/admin/bootstrap') return json(await adminBootstrap(db, store));

  if (request.method === 'PUT' && pathname === '/api/admin/store') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const storeName = text(body.value?.storeName, 80);
    const address = text(body.value?.address ?? store.address, 180);
    const logo = imageData(body.value?.logoData, MAX_LOGO_IMAGE_LENGTH);
    if (!storeName || logo === null) return json({ error: 'Identitas gerai tidak valid.' }, 400);
    await db.prepare(`UPDATE stores SET store_name = ?, address = ?, logo_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(storeName, address, logo, store.id).run();
    return json({ ok: true, store: await resolveStore(db, store.id, { includeInactive: true }) });
  }

  if (request.method === 'POST' && pathname === '/api/admin/products') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    const purchasePrice = scaledPurchasePrice(body.value?.purchasePrice);
    const price = scaledPurchasePrice(body.value?.price);
    const category = text(body.value?.category, 60);
    const emoji = text(body.value?.emoji, 8) || '🥞';
    const productImage = imageData(body.value?.imageData, MAX_PRODUCT_IMAGE_LENGTH);
    if (!name || purchasePrice === null || price === null || !category || productImage === null) return json({ error: 'Nama, kategori, harga beli/jual, atau foto tidak valid.' }, 400);
    await ensureCategory(db, store.id, category);
    const next = await db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM products').first();
    const order = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM products WHERE store_id = ?').bind(store.id).first();
    const id = Number(next?.next_id ?? 1);
    await db.prepare(`INSERT INTO products (id, store_id, name, purchase_price, price, category, emoji, image_data, display_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).bind(id, store.id, name, purchasePrice, price, category, emoji, productImage, Number(order?.next_order ?? 1)).run();
    return json({ ok: true, id }, 201);
  }

  const productImageMatch = pathname.match(/^\/api\/admin\/products\/(\d+)\/image$/);
  if (productImageMatch && request.method === 'GET') {
    const row = await db.prepare('SELECT image_data FROM products WHERE id = ? AND store_id = ?').bind(Number(productImageMatch[1]), store.id).first();
    const decoded = decodeProductImage(row?.image_data);
    if (!decoded) return json({ error: 'Foto barang tidak ditemukan.' }, 404);
    return new Response(decoded.bytes, { headers: { 'Content-Type': decoded.contentType, 'Cache-Control': 'private, max-age=86400' } });
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
  if (productMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const id = Number(productMatch[1]);
    const name = text(body.value?.name, 100);
    const purchasePrice = scaledPurchasePrice(body.value?.purchasePrice);
    const price = scaledPurchasePrice(body.value?.price);
    const category = text(body.value?.category, 60);
    const emoji = text(body.value?.emoji, 8) || '🥞';
    const productImage = imageData(body.value?.imageData, MAX_PRODUCT_IMAGE_LENGTH);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (!name || purchasePrice === null || price === null || !category || productImage === null) return json({ error: 'Data barang tidak valid.' }, 400);
    await ensureCategory(db, store.id, category);
    const result = await db.prepare(`UPDATE products SET name = ?, purchase_price = ?, price = ?, category = ?, emoji = ?, image_data = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?`).bind(name, purchasePrice, price, category, emoji, productImage, isActive, id, store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Produk tidak ditemukan di gerai ini.' }, 404);
  }
  if (productMatch && request.method === 'DELETE') {
    const result = await db.prepare('UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(Number(productMatch[1]), store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Produk tidak ditemukan di gerai ini.' }, 404);
  }

  if (request.method === 'POST' && pathname === '/api/admin/category-groups') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 60);
    if (!name) return json({ error: 'Nama kategori utama wajib diisi.' }, 400);
    const existing = await db.prepare('SELECT id FROM category_groups WHERE store_id = ? AND name = ?').bind(store.id, name).first();
    if (existing) return json({ error: 'Kategori utama sudah ada di gerai ini.' }, 409);
    const next = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM category_groups WHERE store_id = ?').bind(store.id).first();
    const result = await db.prepare('INSERT INTO category_groups (store_id, name, display_order, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').bind(store.id, name, Number(next?.next_order ?? 1)).run();
    return json({ ok: true, id: result.meta?.last_row_id }, 201);
  }

  const categoryGroupMatch = pathname.match(/^\/api\/admin\/category-groups\/(\d+)$/);
  if (categoryGroupMatch && request.method === 'PATCH') {
    const id = Number(categoryGroupMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 60);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (!name) return json({ error: 'Nama kategori utama tidak valid.' }, 400);
    const result = await db.prepare('UPDATE category_groups SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(name, isActive, id, store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Kategori utama tidak ditemukan di gerai ini.' }, 404);
  }
  if (categoryGroupMatch && request.method === 'DELETE') {
    const result = await db.prepare('UPDATE category_groups SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(Number(categoryGroupMatch[1]), store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Kategori utama tidak ditemukan di gerai ini.' }, 404);
  }

  if (request.method === 'POST' && pathname === '/api/admin/categories') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 60);
    if (!name) return json({ error: 'Nama kategori wajib diisi.' }, 400);
    const categoryGroupId = await resolveCategoryGroupId(db, store.id, body.value?.categoryGroupId);
    if (categoryGroupId === undefined) return json({ error: 'Kategori utama tidak ditemukan di gerai ini.' }, 400);
    const existing = await db.prepare('SELECT id FROM categories WHERE store_id = ? AND name = ?').bind(store.id, name).first();
    if (existing) return json({ error: 'Kategori sudah ada di gerai ini.' }, 409);
    const next = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM categories WHERE store_id = ?').bind(store.id).first();
    const result = await db.prepare('INSERT INTO categories (store_id, name, display_order, is_active, category_group_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').bind(store.id, name, Number(next?.next_order ?? 1), categoryGroupId).run();
    return json({ ok: true, id: result.meta?.last_row_id }, 201);
  }

  const categoryMatch = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
  if (categoryMatch && request.method === 'PATCH') {
    const id = Number(categoryMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 60);
    const isActive = body.value?.isActive === false ? 0 : 1;
    const current = await db.prepare('SELECT name FROM categories WHERE id = ? AND store_id = ?').bind(id, store.id).first();
    if (!current || !name) return json({ error: 'Kategori tidak ditemukan atau nama invalid.' }, 404);
    const categoryGroupId = await resolveCategoryGroupId(db, store.id, body.value?.categoryGroupId);
    if (categoryGroupId === undefined) return json({ error: 'Kategori utama tidak ditemukan di gerai ini.' }, 400);
    await db.batch([
      db.prepare('UPDATE categories SET name = ?, is_active = ?, category_group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(name, isActive, categoryGroupId, id, store.id),
      db.prepare('UPDATE products SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ? AND store_id = ?').bind(name, current.name, store.id)
    ]);
    return json({ ok: true });
  }
  if (categoryMatch && request.method === 'DELETE') {
    const result = await db.prepare('UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND store_id = ?').bind(Number(categoryMatch[1]), store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Kategori tidak ditemukan di gerai ini.' }, 404);
  }

  if (request.method === 'POST' && pathname === '/api/admin/contacts') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    if (!name) return json({ error: 'Nama customer/contact wajib diisi.' }, 400);
    const now = new Date().toISOString();
    const id = `contact_${crypto.randomUUID()}`;
    await db.prepare('INSERT INTO contacts (id, store_id, name, phone, email, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, store.id, name, text(body.value?.phone, 40), text(body.value?.email, 120), text(body.value?.notes, 500), now, now).run();
    return json({ ok: true, id }, 201);
  }

  const contactMatch = pathname.match(/^\/api\/admin\/contacts\/([^/]+)$/);
  if (contactMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    if (!name) return json({ error: 'Nama customer/contact wajib diisi.' }, 400);
    const id = decodeURIComponent(contactMatch[1]);
    const result = await db.prepare('UPDATE contacts SET name = ?, phone = ?, email = ?, notes = ?, updated_at = ? WHERE id = ? AND store_id = ?').bind(name, text(body.value?.phone, 40), text(body.value?.email, 120), text(body.value?.notes, 500), new Date().toISOString(), id, store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Contact tidak ditemukan di gerai ini.' }, 404);
  }
  if (contactMatch && request.method === 'DELETE') {
    const result = await db.prepare('DELETE FROM contacts WHERE id = ? AND store_id = ?').bind(decodeURIComponent(contactMatch[1]), store.id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Contact tidak ditemukan di gerai ini.' }, 404);
  }

  return json({ error: 'Admin route tidak ditemukan.' }, 404);
}

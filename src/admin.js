import { json, readJson } from './http.js';

const MAX_PRODUCT_IMAGE_LENGTH = 900_000;
const MAX_LOGO_IMAGE_LENGTH = 500_000;

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const money = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
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

async function getSettings(db) {
  return db.prepare(`
    SELECT store_name, logo_data, admin_pin_hash, updated_at
    FROM store_settings
    WHERE id = 1
  `).first();
}

async function requireAdmin(request, db) {
  const settings = await getSettings(db);
  if (!settings?.admin_pin_hash) {
    return { ok: false, response: json({ error: 'Admin PIN belum dibuat.', code: 'ADMIN_SETUP_REQUIRED' }, 428) };
  }

  const pin = request.headers.get('x-admin-pin') ?? '';
  if (!pin || await hashPin(pin) !== settings.admin_pin_hash) {
    return { ok: false, response: json({ error: 'PIN admin salah.', code: 'ADMIN_UNAUTHORIZED' }, 401) };
  }
  return { ok: true, settings };
}

async function ensureCategory(db, categoryName) {
  const existing = await db.prepare('SELECT id FROM categories WHERE name = ?').bind(categoryName).first();
  if (existing) return;
  const next = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM categories').first();
  await db.prepare(`
    INSERT INTO categories (name, display_order, is_active, created_at, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(categoryName, Number(next?.next_order ?? 1)).run();
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    purchasePrice: row.purchase_price,
    price: row.price,
    category: row.category,
    emoji: row.emoji,
    imageData: row.image_data,
    displayOrder: row.display_order,
    isActive: Boolean(row.is_active)
  };
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    displayOrder: row.display_order,
    isActive: Boolean(row.is_active)
  };
}

function mapContact(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function adminBootstrap(db) {
  const [settings, products, categories, contacts] = await Promise.all([
    getSettings(db),
    db.prepare(`
      SELECT id, name, purchase_price, price, category, emoji, image_data, display_order, is_active
      FROM products
      ORDER BY display_order ASC, id ASC
    `).all(),
    db.prepare(`
      SELECT id, name, display_order, is_active
      FROM categories
      ORDER BY display_order ASC, id ASC
    `).all(),
    db.prepare(`
      SELECT id, name, phone, email, notes, created_at, updated_at
      FROM contacts
      ORDER BY name COLLATE NOCASE ASC
    `).all()
  ]);

  return {
    store: {
      storeName: settings?.store_name ?? 'MAXI LEKER',
      logoData: settings?.logo_data ?? '',
      updatedAt: settings?.updated_at ?? null
    },
    products: (products.results ?? []).map(mapProduct),
    categories: (categories.results ?? []).map(mapCategory),
    contacts: (contacts.results ?? []).map(mapContact)
  };
}

export async function getPublicStore(db) {
  const settings = await getSettings(db);
  return {
    storeName: settings?.store_name ?? 'MAXI LEKER',
    logoData: settings?.logo_data ?? ''
  };
}

export async function handleAdminApi(request, env, pathname) {
  const db = env.DB;

  if (request.method === 'GET' && pathname === '/api/admin/status') {
    const settings = await getSettings(db);
    return json({
      setupRequired: !settings?.admin_pin_hash,
      storeName: settings?.store_name ?? 'MAXI LEKER'
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/setup') {
    const settings = await getSettings(db);
    if (settings?.admin_pin_hash) return json({ error: 'Admin PIN sudah pernah dibuat.' }, 409);

    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const pin = String(body.value?.pin ?? '').trim();
    if (!/^\d{4,12}$/.test(pin)) return json({ error: 'PIN harus 4–12 digit.' }, 400);

    await db.prepare(`
      UPDATE store_settings
      SET admin_pin_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND admin_pin_hash = ''
    `).bind(await hashPin(pin)).run();
    return json({ ok: true });
  }

  const auth = await requireAdmin(request, db);
  if (!auth.ok) return auth.response;

  if (request.method === 'GET' && pathname === '/api/admin/bootstrap') {
    return json(await adminBootstrap(db));
  }

  if (request.method === 'PUT' && pathname === '/api/admin/store') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const storeName = text(body.value?.storeName, 80);
    const logoData = imageData(body.value?.logoData, MAX_LOGO_IMAGE_LENGTH);
    if (!storeName) return json({ error: 'Nama toko wajib diisi.' }, 400);
    if (logoData === null) return json({ error: 'Logo tidak valid atau terlalu besar.' }, 400);

    await db.prepare(`
      UPDATE store_settings
      SET store_name = ?, logo_data = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(storeName, logoData).run();
    return json({ ok: true, store: { storeName, logoData } });
  }

  if (request.method === 'POST' && pathname === '/api/admin/products') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    const purchasePrice = money(body.value?.purchasePrice);
    const price = money(body.value?.price);
    const category = text(body.value?.category, 60);
    const emoji = text(body.value?.emoji, 8) || '🥞';
    const productImage = imageData(body.value?.imageData, MAX_PRODUCT_IMAGE_LENGTH);
    if (!name || purchasePrice === null || price === null || !category) return json({ error: 'Nama, kategori, harga beli, dan harga jual wajib valid.' }, 400);
    if (productImage === null) return json({ error: 'Foto produk tidak valid atau terlalu besar.' }, 400);

    await ensureCategory(db, category);
    const next = await db.prepare(`
      SELECT COALESCE(MAX(id), 0) + 1 AS next_id,
             COALESCE(MAX(display_order), 0) + 1 AS next_order
      FROM products
    `).first();
    const id = Number(next?.next_id ?? 1);
    const displayOrder = Number(next?.next_order ?? id);
    await db.prepare(`
      INSERT INTO products (
        id, name, purchase_price, price, category, emoji, image_data,
        display_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, name, purchasePrice, price, category, emoji, productImage, displayOrder).run();
    return json({ ok: true, id }, 201);
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
  if (productMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const id = Number(productMatch[1]);
    const name = text(body.value?.name, 100);
    const purchasePrice = money(body.value?.purchasePrice);
    const price = money(body.value?.price);
    const category = text(body.value?.category, 60);
    const emoji = text(body.value?.emoji, 8) || '🥞';
    const productImage = imageData(body.value?.imageData, MAX_PRODUCT_IMAGE_LENGTH);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (!name || purchasePrice === null || price === null || !category) return json({ error: 'Nama, kategori, harga beli, dan harga jual wajib valid.' }, 400);
    if (productImage === null) return json({ error: 'Foto produk tidak valid atau terlalu besar.' }, 400);

    await ensureCategory(db, category);
    const result = await db.prepare(`
      UPDATE products
      SET name = ?, purchase_price = ?, price = ?, category = ?, emoji = ?, image_data = ?,
          is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(name, purchasePrice, price, category, emoji, productImage, isActive, id).run();
    if (!result.meta?.changes) return json({ error: 'Produk tidak ditemukan.' }, 404);
    return json({ ok: true });
  }

  if (productMatch && request.method === 'DELETE') {
    const id = Number(productMatch[1]);
    const result = await db.prepare(`
      UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(id).run();
    if (!result.meta?.changes) return json({ error: 'Produk tidak ditemukan.' }, 404);
    return json({ ok: true });
  }

  if (request.method === 'POST' && pathname === '/api/admin/categories') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 60);
    if (!name) return json({ error: 'Nama kategori wajib diisi.' }, 400);
    const existing = await db.prepare('SELECT id FROM categories WHERE name = ?').bind(name).first();
    if (existing) return json({ error: 'Kategori sudah ada.' }, 409);
    const next = await db.prepare('SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM categories').first();
    const result = await db.prepare(`
      INSERT INTO categories (name, display_order, is_active, created_at, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(name, Number(next?.next_order ?? 1)).run();
    return json({ ok: true, id: result.meta?.last_row_id }, 201);
  }

  const categoryMatch = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
  if (categoryMatch && request.method === 'PATCH') {
    const id = Number(categoryMatch[1]);
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 60);
    const isActive = body.value?.isActive === false ? 0 : 1;
    if (!name) return json({ error: 'Nama kategori wajib diisi.' }, 400);
    const current = await db.prepare('SELECT name FROM categories WHERE id = ?').bind(id).first();
    if (!current) return json({ error: 'Kategori tidak ditemukan.' }, 404);
    await db.batch([
      db.prepare(`UPDATE categories SET name = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(name, isActive, id),
      db.prepare(`UPDATE products SET category = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?`).bind(name, current.name)
    ]);
    return json({ ok: true });
  }

  if (categoryMatch && request.method === 'DELETE') {
    const id = Number(categoryMatch[1]);
    const result = await db.prepare(`UPDATE categories SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
    if (!result.meta?.changes) return json({ error: 'Kategori tidak ditemukan.' }, 404);
    return json({ ok: true });
  }

  if (request.method === 'POST' && pathname === '/api/admin/contacts') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    if (!name) return json({ error: 'Nama customer/contact wajib diisi.' }, 400);
    const now = new Date().toISOString();
    const id = `contact_${crypto.randomUUID()}`;
    await db.prepare(`
      INSERT INTO contacts (id, name, phone, email, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, name, text(body.value?.phone, 40), text(body.value?.email, 120), text(body.value?.notes, 500), now, now).run();
    return json({ ok: true, id }, 201);
  }

  const contactMatch = pathname.match(/^\/api\/admin\/contacts\/([^/]+)$/);
  if (contactMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload JSON tidak valid.' }, 400);
    const name = text(body.value?.name, 100);
    if (!name) return json({ error: 'Nama customer/contact wajib diisi.' }, 400);
    const result = await db.prepare(`
      UPDATE contacts
      SET name = ?, phone = ?, email = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      name,
      text(body.value?.phone, 40),
      text(body.value?.email, 120),
      text(body.value?.notes, 500),
      new Date().toISOString(),
      decodeURIComponent(contactMatch[1])
    ).run();
    if (!result.meta?.changes) return json({ error: 'Contact tidak ditemukan.' }, 404);
    return json({ ok: true });
  }

  if (contactMatch && request.method === 'DELETE') {
    const result = await db.prepare('DELETE FROM contacts WHERE id = ?').bind(decodeURIComponent(contactMatch[1])).run();
    if (!result.meta?.changes) return json({ error: 'Contact tidak ditemukan.' }, 404);
    return json({ ok: true });
  }

  return json({ error: 'Admin route tidak ditemukan.' }, 404);
}

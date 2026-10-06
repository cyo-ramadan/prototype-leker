// Data demo FIKTIF toko parfum racikan (tenant TEN-PARFUM, gerai PARFUM01,
// migration 0140) -- HANYA ke database LOKAL milik `wrangler dev --local`,
// TIDAK PERNAH ke D1 produksi. Untuk mencoba layar Racik (skin F) di lokal:
//   node scripts/demo-toko-parfum-lokal.mjs
//   buka http://localhost:8787/s/PARFUM01/racik dengan localStorage
//   lekerCashierToken = 'demo-racik-lokal' (kasir fiktif "Nadia").
// Bahan, aroma, resep standar, stok, absen, dan laci terbuka hari ini.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

const dir = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url);
const file = readdirSync(dir).find(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
if (!file) throw new Error('Database lokal belum ada. Jalankan `npx wrangler dev --local` sekali dulu.');
const db = new DatabaseSync(new URL(file, dir));
if (!db.prepare(`SELECT 1 FROM stores WHERE id = 'store_parfum01'`).get()) throw new Error('Gerai PARFUM01 belum ada -- apply migration 0140 dulu.');

const S = 1_000_000;
const store = 'store_parfum01';
const now = new Date().toISOString();
const unit = code => `unit_${store}_${code}`;
const RAW = `item_type_${store}_raw`;
const FIN = `item_type_${store}_finished`;
const sha = value => createHash('sha256').update(value).digest('hex');

// [id, nama, satuan, modal per satuan (Rp), stok]
const materials = [
  [880001, 'Bibit Bubble Gum', 'ml', 2000, 200],
  [880002, 'Bibit Vanilla', 'ml', 1800, 10],
  [880003, 'Bibit White Musk', 'ml', 2200, 120],
  [880004, 'Alkohol Parfum', 'ml', 60, 5000],
  [880005, 'Fixative', 'ml', 300, 400],
  [880006, 'Botol Spray 50 ml', 'pcs', 8000, 20],
  [880007, 'Botol Spray 30 ml', 'pcs', 6000, 20]
];
// [id, nama aroma, harga daftar, resep standar [[bahan, qty]]]
const aromas = [
  [880101, 'Bubble Gum 50 ml', 120000, [[880001, 15], [880004, 33], [880005, 2], [880006, 1]]],
  [880102, 'Vanilla Musk 30 ml', 95000, [[880002, 5], [880003, 4], [880004, 20], [880005, 1], [880007, 1]]],
  [880103, 'White Musk 50 ml', 125000, [[880003, 16], [880004, 32], [880005, 2], [880006, 1]]]
];

db.exec('BEGIN');
for (const [id, name, u, cost, stock] of materials) {
  db.prepare(`INSERT OR REPLACE INTO products (id, store_id, name, price, category, item_type_id, base_unit_id, stock_tracking_enabled, average_cost, last_purchase_price, display_order, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'Bahan', ?, ?, 1, ?, ?, ?, ?, ?)`).run(id, store, name, RAW, unit(u), cost * S, cost * S, id, now, now);
  db.prepare(`INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?)`).run(store, id, stock, now);
}
for (const [id, name, price, recipe] of aromas) {
  const recipeId = `recipe_demo_parfum_${id}`;
  db.prepare(`INSERT OR REPLACE INTO products (id, store_id, name, price, category, item_type_id, base_unit_id, stock_tracking_enabled, production_mode, recipe_link_enabled, display_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Parfum', ?, ?, 1, 'STOCK', 1, ?, ?, ?)`).run(id, store, name, price * S, FIN, unit('pcs'), id, now, now);
  db.prepare(`DELETE FROM manufacturing_recipe_components WHERE recipe_id = ?`).run(recipeId);
  db.prepare(`INSERT OR REPLACE INTO manufacturing_recipes (id, store_id, output_product_id, output_unit_id, output_quantity, revision, status, notes, created_by_role, created_by_id, created_at, variant_label)
    VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE', 'Resep standar (demo lokal)', 'SYSTEM', 'demo-parfum', ?, '')`).run(recipeId, store, id, unit('pcs'), now);
  recipe.forEach(([component, quantity], index) => {
    const material = materials.find(item => item[0] === component);
    db.prepare(`INSERT INTO manufacturing_recipe_components (id, recipe_id, store_id, component_product_id, component_unit_id, quantity, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`${recipeId}_${component}`, recipeId, store, component, unit(material[2]), quantity, index);
  });
  db.prepare(`UPDATE products SET linked_recipe_id = ? WHERE id = ?`).run(recipeId, id);
}

const cashierId = 'cashier_demo_parfum_nadia';
db.prepare(`INSERT OR REPLACE INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES (?, 'demo_nadia', ?, 'Nadia', ?, 1, ?, ?)`)
  .run(cashierId, sha('demo-tidak-dipakai'), store, now, now);
db.prepare(`DELETE FROM cashier_sessions WHERE cashier_id = ?`).run(cashierId);
db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')`).run(sha('demo-racik-lokal'), cashierId, now);
db.prepare(`INSERT OR REPLACE INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, gps_in_status)
  VALUES ('att_demo_parfum_nadia', ?, ?, 'in', x'00', 'image/jpeg', ?, 'OPEN', 'OK')`).run(cashierId, store, now);
if (!db.prepare(`SELECT 1 FROM cash_drawer_sessions WHERE store_id = ? AND status = 'OPEN'`).get(store)) {
  db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at, shift_label, closing_note, incentive_amount, opening_note, deposit_amount)
    VALUES ('drawer_demo_parfum', ?, ?, 200000, 'OPEN', ?, 'Pagi', '', 0, '', 0)`).run(store, cashierId, now);
}
db.exec('COMMIT');
console.log('Data demo toko parfum siap: /s/PARFUM01/racik, token kasir demo-racik-lokal');

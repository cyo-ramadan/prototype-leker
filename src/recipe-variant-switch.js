// Memindahkan resep aktif barang bervarian ke pilihan kasir, plus jejaknya.
// Sengaja terpisah dari stock-production.js: file itu dijaga tes supaya tidak
// menulis ke tabel products (penulisan HPP hanya lewat Manufaktur). Pergantian
// ini hanya menyentuh penunjuk resep, bukan angka biaya apa pun.
export function recipeSwitchStatements(db, { storeId, productId, fromRecipeId, toRecipeId, cashierId, saleId, now }) {
  return [
    db.prepare(`
      UPDATE products SET linked_recipe_id = ?, recipe_link_enabled = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND store_id = ?
    `).bind(toRecipeId, productId, storeId),
    db.prepare(`
      INSERT INTO product_recipe_switch_log (
        id, store_id, product_id, from_recipe_id, to_recipe_id, actor_role, actor_id, sale_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 'CASHIER', ?, ?, ?)
    `).bind(`recipe_switch_${crypto.randomUUID()}`, storeId, productId, fromRecipeId, toRecipeId, cashierId, saleId, now)
  ];
}

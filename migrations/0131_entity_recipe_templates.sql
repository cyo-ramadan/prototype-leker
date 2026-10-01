-- Resep Entity (ADR-050, Bos Cyo 2026-10-01: "resep di taruh entity aja, biar
-- ga ngerjain satu2 per gerai"). Template resep yang bisa dieksekusi, dimiliki
-- Entity, dirujuk lewat Kode Barang (product_masters). Template TIDAK pernah
-- memotong stok sendiri: ia "diterapkan" ke gerai dan hasilnya adalah
-- manufacturing_recipes milik gerai itu (store-scoped, ADR-043 tetap utuh).
--
-- Revisi template immutable (pola manufacturing_recipes): ubah = revisi baru,
-- revisi lama ARCHIVED. Satu template ACTIVE per (Kode Barang hasil, varian).
-- Qty bilangan bulat dalam satuan dasar; unit_code disimpan supaya penerapan
-- ditolak di gerai yang satuan dasar barangnya berbeda (fail-closed).
CREATE TABLE IF NOT EXISTS entity_recipe_templates (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  output_master_id TEXT NOT NULL REFERENCES product_masters(id),
  variant_label TEXT NOT NULL DEFAULT '',
  output_quantity INTEGER NOT NULL CHECK (output_quantity > 0),
  output_unit_code TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  notes TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_recipe_templates_active
  ON entity_recipe_templates(output_master_id, variant_label) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_entity_recipe_templates_entity
  ON entity_recipe_templates(entity_id, status);

CREATE TABLE IF NOT EXISTS entity_recipe_template_components (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES entity_recipe_templates(id) ON DELETE CASCADE,
  component_master_id TEXT NOT NULL REFERENCES product_masters(id),
  unit_code TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entity_recipe_template_components_template
  ON entity_recipe_template_components(template_id, display_order);

-- Jejak penerapan: revisi template mana sudah dipasang ke gerai mana, menjadi
-- manufacturing_recipes yang mana. Dipakai untuk menandai "sudah terbaru" dan
-- mencegah penerapan ganda revisi yang sama.
CREATE TABLE IF NOT EXISTS entity_recipe_applications (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES entity_recipe_templates(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  recipe_id TEXT NOT NULL REFERENCES manufacturing_recipes(id),
  applied_by_role TEXT NOT NULL DEFAULT '',
  applied_by_id TEXT NOT NULL DEFAULT '',
  applied_at TEXT NOT NULL,
  UNIQUE (template_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_recipe_applications_store
  ON entity_recipe_applications(store_id, applied_at DESC);

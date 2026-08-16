PRAGMA foreign_keys = ON;

CREATE TABLE cost_types (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  accounting_component_rule_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, code),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (accounting_component_rule_id) REFERENCES journal_rules(id)
);

CREATE TABLE cost_masters (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  outgoing_amount INTEGER NOT NULL DEFAULT 0 CHECK (outgoing_amount >= 0),
  incoming_amount INTEGER NOT NULL DEFAULT 0 CHECK (incoming_amount >= 0),
  cost_type_id TEXT NOT NULL,
  cost_group TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, name),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (cost_type_id) REFERENCES cost_types(id)
);

CREATE INDEX idx_cost_types_store_active ON cost_types(store_id, is_active, name);
CREATE INDEX idx_cost_masters_store_active ON cost_masters(store_id, is_active, cost_group, name);

INSERT INTO cost_types (id, store_id, code, name, accounting_component_rule_id)
SELECT
  'cost_type_g001_delivery', 'store_001', 'DELIVERY', 'Pengiriman',
  (SELECT jr.id FROM journal_rules jr
   JOIN transaction_categories tc ON tc.id = jr.transaction_category_id
   WHERE tc.store_id = 'store_001' AND tc.code = 'operational'
     AND jr.side = 'DEBIT' AND jr.is_active = 1
   ORDER BY jr.sort_order, jr.id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM stores WHERE id = 'store_001');

INSERT INTO cost_types (id, store_id, code, name, accounting_component_rule_id)
SELECT
  'cost_type_g001_packaging', 'store_001', 'PACKAGING', 'Kemasan',
  COALESCE(
    (SELECT jr.id FROM journal_rules jr
     JOIN transaction_categories tc ON tc.id = jr.transaction_category_id
     WHERE tc.store_id = 'store_001' AND tc.code = 'operational'
       AND jr.side = 'DEBIT' AND jr.is_active = 1
     ORDER BY jr.sort_order, jr.id LIMIT 1 OFFSET 1),
    (SELECT jr.id FROM journal_rules jr
     JOIN transaction_categories tc ON tc.id = jr.transaction_category_id
     WHERE tc.store_id = 'store_001' AND tc.code = 'operational'
       AND jr.side = 'DEBIT' AND jr.is_active = 1
     ORDER BY jr.sort_order, jr.id LIMIT 1)
  )
WHERE EXISTS (SELECT 1 FROM stores WHERE id = 'store_001');

INSERT INTO cost_masters (
  id, store_id, name, contact, outgoing_amount, incoming_amount,
  cost_type_id, cost_group
) VALUES
  ('cost_g001_local_delivery', 'store_001', 'Ongkir Lokal', 'Kurir Lokal', 10000, 15000, 'cost_type_g001_delivery', 'Logistik'),
  ('cost_g001_packaging', 'store_001', 'Biaya Kemasan', 'Supplier Kemasan', 2000, 3000, 'cost_type_g001_packaging', 'Packaging');

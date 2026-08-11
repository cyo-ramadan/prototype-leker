PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS store_admins (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS store_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES store_admins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_admins_store_active
  ON store_admins(store_id, is_active, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_store_admin_sessions_expiry
  ON store_admin_sessions(expires_at);

-- Prototype demo Admin Gerai credentials. Password hashes are SHA-256.
-- G001: bablil / bablil123
INSERT OR REPLACE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_g001_bablil', 'store_001', 'bablil',
  '6edb4c278e4cf7ac0f2bd8c8cf2cb529c0bb8722b64c7e030ffc93dbfc1b0992',
  'Bablil', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G001: kingluhut / luhut123
INSERT OR REPLACE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_g001_kingluhut', 'store_001', 'kingluhut',
  'dd31f49cdbfa7f7399c0b5a02a7cdd4746bfaed1c74c699aa6bbec07ed25c928',
  'King Luhut', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G002: lordrizz / rizz123
INSERT OR REPLACE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_g002_lordrizz', 'store_002', 'lordrizz',
  '294c7d3a77084a2e55993e1247b1bb80dae88b0e553b45afb50a7a5737c71aff',
  'Lord Rizz', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G002: rusdiprime / rusdi123
INSERT OR REPLACE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_g002_rusdiprime', 'store_002', 'rusdiprime',
  'd233cbc5398e159c05b4cc0300070dcac09afb191381b63999b28a06adc21df9',
  'Mas Rusdi Prime', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Two login-enabled demo customers per gerai.
-- G001: fufu / fufu123
INSERT OR REPLACE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_g001_fufu', 'store_001', 'CUST-G001-FUFU', 'fufu',
  'b72e5e443e0819942ce64ce570044585aa8d88afb890dab6429f9ca58741af2f',
  'Fufu', '', '', 'Demo pelanggan G001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G001: fafa / fafa123
INSERT OR REPLACE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_g001_fafa', 'store_001', 'CUST-G001-FAFA', 'fafa',
  'cfb7ca6ff86667f255c37a129e2e0bd3d9444adde0b85fa1dbb625a300e65d58',
  'Fafa', '', '', 'Demo pelanggan G001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G002: elkecepatan / cepat123
INSERT OR REPLACE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_g002_elkecepatan', 'store_002', 'CUST-G002-ELKECEPATAN', 'elkecepatan',
  'e506dafa46e0a61ef0ecb35c47a150d4457d5c61b8de481eec2aceab7b55dc8a',
  'El Kecepatan', '', '', 'Demo pelanggan G002', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G002: aurafarming / aura123
INSERT OR REPLACE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_g002_aurafarming', 'store_002', 'CUST-G002-AURAFARMING', 'aurafarming',
  '5f253db1700aa24fc601450fe55edae679facaab0ae5a544868c5b2acfcaefae',
  'Aura Farming', '', '', 'Demo pelanggan G002', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Existing Wowo (G001) and Wiwi (G002) remain the first cashier accounts.
-- Add one more demo cashier to each gerai so each gerai has two seeded cashier logins.
-- G001: sigma / sigma123
INSERT OR REPLACE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_sigma', 'sigma',
  '34dbd1dfd23c98dc98ca3e0566526f968c53e02957452cac12d05444d54a7d96',
  'Sigma Boy', 'store_001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- G002: mewing / mewing123
INSERT OR REPLACE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_mewing', 'mewing',
  '33c8c07dbbb32e4309c46fa4b457a24fcfd22d124aa6e1291d8c77f9f1796113',
  'Mewing Max', 'store_002', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

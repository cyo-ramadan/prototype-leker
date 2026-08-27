PRAGMA foreign_keys = ON;

-- Akun percontohan untuk tiga gerai baru (Kantor/Pendem/Mandala) -- permintaan
-- Bos Cyo 2026-08-25, buat coba pakai sistem sekaligus debug. Satu kasir, satu
-- Admin Gerai, satu pelanggan per gerai. Pola persis migration 0009 (demo
-- accounts G001/G002): password_hash = SHA-256(password), sama seperti
-- hashCredential() di src/owner-auth.js.
--
-- Kredensial plaintext-nya CUMA ada di laporan Hana ke Bos Cyo, bukan di
-- migration ini maupun di komentar manapun yang ikut ter-log permanen selain
-- di sini sebagai referensi migrasi (pola yang sama seperti 0009 sudah
-- pakai). Ganti password ini sebelum dipakai ke transaksi sungguhan bukan
-- percontohan lagi.
--
-- Additive murni. Tidak menyentuh akun gerai lain yang sudah ada.

-- Kantor: kasir_kantor / kasir_kantor123
INSERT OR IGNORE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_kantor_pilot', 'kasir_kantor',
  'fe00d4bbd9787a096e005383f12b9f692e3dbe42b73249c75400b6b055237724',
  'Kasir Kantor (Percontohan)', 'store_kantor', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Kantor: admin_kantor / admin_kantor123
INSERT OR IGNORE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_kantor_pilot', 'store_kantor', 'admin_kantor',
  'e14df197a61d2e25717185d1e381ca7ad2fe05df72838d8ae79fe7e2995d3061',
  'Admin Kantor (Percontohan)', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Kantor: pelanggan_kantor / pelanggan_kantor123
INSERT OR IGNORE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_kantor_pilot', 'store_kantor', 'CUST-KANTOR-01', 'pelanggan_kantor',
  'e770dd2fcb3309d8ba2ce2ac8cdf5188d2b93ef6d59fbef95fb4e1de19fbebc3',
  'Pelanggan Kantor (Percontohan)', '', '', 'Akun percontohan/debug', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Pendem: kasir_pendem / kasir_pendem123
INSERT OR IGNORE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_pendem_pilot', 'kasir_pendem',
  '1c3730b31dc0a0890a142a2b3cd51c8d2c5136600411e71960c812a6eb817995',
  'Kasir Pendem (Percontohan)', 'store_pendem', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Pendem: admin_pendem / admin_pendem123
INSERT OR IGNORE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_pendem_pilot', 'store_pendem', 'admin_pendem',
  '372daf49bfb31cbd7af530ad140ec5fd21de28c05f30bf9c51af3a8f59c942b8',
  'Admin Pendem (Percontohan)', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Pendem: pelanggan_pendem / pelanggan_pendem123
INSERT OR IGNORE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_pendem_pilot', 'store_pendem', 'CUST-PENDEM-01', 'pelanggan_pendem',
  '168038905572e5d90650219f701afd37902bbd0331f20f515e243e3943b504cf',
  'Pelanggan Pendem (Percontohan)', '', '', 'Akun percontohan/debug', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Mandala: kasir_mandala / kasir_mandala123
INSERT OR IGNORE INTO cashiers (
  id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at
) VALUES (
  'cashier_mandala_pilot', 'kasir_mandala',
  '0e88cf09492a254ae94c68ab42c76f4622fc4ad0cf09c2afca4310e5a2eb17ef',
  'Kasir Mandala (Percontohan)', 'store_mandala', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Mandala: admin_mandala / admin_mandala123
INSERT OR IGNORE INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES (
  'admin_mandala_pilot', 'store_mandala', 'admin_mandala',
  '6be2c76058251f862c85f6bb52bd55907aa28c970b5cbdd1ad95935bb0c0fe89',
  'Admin Mandala (Percontohan)', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

-- Mandala: pelanggan_mandala / pelanggan_mandala123
INSERT OR IGNORE INTO customers (
  id, store_id, customer_code, username, password_hash, customer_name,
  phone, email, notes, is_active, created_at, updated_at
) VALUES (
  'customer_mandala_pilot', 'store_mandala', 'CUST-MANDALA-01', 'pelanggan_mandala',
  '9612277c048bc096530f6a319b6316372be177d3d0dad8542ada714ac0f623e3',
  'Pelanggan Mandala (Percontohan)', '', '', 'Akun percontohan/debug', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

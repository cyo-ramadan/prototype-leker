PRAGMA foreign_keys = ON;

-- 2026-09-04, Bos Cyo: pisahkan "orang" dari "akun login".
--
-- Sampai sekarang identitas karyawan cuma numpang jadi kolom teks di tiap
-- tabel akun (cashiers.employee_name, store_admins.display_name) -- artinya
-- satu orang yang pegang dua akun di dua gerai tercatat sebagai dua orang
-- yang tidak berhubungan, dan begitu sebuah username dipindahtangankan ke
-- karyawan pengganti, jejak siapa yang dulu memegangnya hilang total.
--
-- Dua tabel di sini memisahkan itu:
--
-- 1. employees -- satu baris per MANUSIA. Pemiliknya Entity (badan usaha),
--    bukan gerai: perekrutnya boleh gerai (home_store_id diisi) atau Entity
--    langsung (home_store_id NULL, mis. OB kantor yang tidak nempel gerai
--    mana pun). Ini pelebaran lintas-gerai yang disengaja dan disetujui Bos
--    Cyo -- majikan yang sebenarnya memang Entity, bukan gerai. Isolasi
--    tetap dijaga server-side di lapisan API (gerai hanya melihat karyawan
--    di bawah entity-nya sendiri, dan hanya boleh mengubah detail karyawan
--    yang gerainya sendiri yang merekrut).
--
-- 2. employee_account_links -- SIAPA memegang akun APA, DARI KAPAN SAMPAI
--    KAPAN. Berjangka waktu, bukan kolom pointer yang ditimpa, karena
--    riwayat keuangan (gaji, setoran, hutang) yang sudah terjadi harus tetap
--    menempel ke orang yang memegang akun itu SAAT kejadian -- bukan ikut
--    berpindah diam-diam ke pemegang berikutnya. Pola persis entity_tenancy
--    (migration 0039): tutup periode lama dengan effective_to, buka baris
--    baru, tidak pernah meng-UPDATE hubungan lama.
--
-- Satu orang boleh memegang beberapa akun sekaligus di gerai berbeda (kasus
-- nyata: CS yang membackup gerai yang kosong), tapi satu akun hanya boleh
-- dipegang satu orang pada satu waktu -- dijaga unique index parsial di
-- bawah.

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  home_store_id TEXT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  id_number TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by_role TEXT NOT NULL DEFAULT '' CHECK (created_by_role IN ('', 'OWNER', 'ENTITY_ADMIN', 'ADMIN', 'LEGACY_PIN')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (home_store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_employees_entity_status
  ON employees(entity_id, status, full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_employees_home_store
  ON employees(home_store_id, status);

CREATE TABLE IF NOT EXISTS employee_account_links (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('CASHIER', 'STORE_ADMIN', 'ENTITY_ADMIN')),
  account_id TEXT NOT NULL,
  store_id TEXT,
  -- Timestamp ISO milidetik dari aplikasi, bukan CURRENT_TIMESTAMP SQLite
  -- (yang cuma beresolusi detik dan formatnya beda: 'YYYY-MM-DD HH:MM:SS'
  -- vs 'YYYY-MM-DDTHH:MM:SS.sssZ'). Mencampur dua format di kolom yang
  -- diurutkan sebagai teks bikin urutan riwayat salah, jadi sengaja tidak
  -- diberi DEFAULT -- pemanggil wajib eksplisit.
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  ended_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  -- Sengaja >= dan bukan >: salah tautkan lalu langsung dilepas di detik yang
  -- sama itu koreksi yang wajar, dan periode nol-detik tetap riwayat yang sah.
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- ENTITY_ADMIN tidak menempel ke satu gerai; dua jenis lainnya wajib.
  CHECK ((account_type = 'ENTITY_ADMIN' AND store_id IS NULL)
      OR (account_type <> 'ENTITY_ADMIN' AND store_id IS NOT NULL))
);

-- Satu akun hanya boleh punya SATU pemegang aktif. Periode lama (effective_to
-- terisi) bebas menumpuk berapa pun, itu justru riwayat yang ingin disimpan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_link_one_active_holder
  ON employee_account_links(account_type, account_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_link_employee
  ON employee_account_links(employee_id, effective_to);
CREATE INDEX IF NOT EXISTS idx_employee_link_store_active
  ON employee_account_links(store_id, effective_to);

-- Pagar scope, mengikuti pola trg_journal_rule_scope_insert (migration 0022):
-- link tidak boleh menyeberang entity, dan akun yang ditunjuk harus benar-benar
-- ada di gerai/entity yang diklaim. Tanpa ini, API yang keliru bisa menautkan
-- karyawan gerai A ke username gerai B tanpa error apa pun.
DROP TRIGGER IF EXISTS trg_employee_link_scope_insert;
CREATE TRIGGER trg_employee_link_scope_insert
BEFORE INSERT ON employee_account_links
WHEN (SELECT entity_id FROM employees WHERE id = NEW.employee_id) IS NOT NEW.entity_id
  OR NOT EXISTS (
    SELECT 1 FROM cashiers c JOIN stores s ON s.id = c.store_id
     WHERE NEW.account_type = 'CASHIER' AND c.id = NEW.account_id
       AND c.store_id = NEW.store_id AND s.entity_id = NEW.entity_id
    UNION ALL
    SELECT 1 FROM store_admins a JOIN stores s ON s.id = a.store_id
     WHERE NEW.account_type = 'STORE_ADMIN' AND a.id = NEW.account_id
       AND a.store_id = NEW.store_id AND s.entity_id = NEW.entity_id
    UNION ALL
    SELECT 1 FROM entity_admins ea
     WHERE NEW.account_type = 'ENTITY_ADMIN' AND ea.id = NEW.account_id
       AND ea.entity_id = NEW.entity_id
  )
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_LINK_SCOPE_MISMATCH');
END;

-- Periode yang sudah ditutup tidak boleh dibuka lagi atau dipindah ke orang
-- lain -- itu sama saja menulis ulang riwayat. Yang boleh berubah dari sebuah
-- link hanya penutupannya (effective_to + ended_reason).
DROP TRIGGER IF EXISTS trg_employee_link_history_immutable;
CREATE TRIGGER trg_employee_link_history_immutable
BEFORE UPDATE ON employee_account_links
WHEN OLD.effective_to IS NOT NULL
  OR NEW.employee_id <> OLD.employee_id
  OR NEW.entity_id <> OLD.entity_id
  OR NEW.account_type <> OLD.account_type
  OR NEW.account_id <> OLD.account_id
  OR NEW.effective_from <> OLD.effective_from
  OR NEW.store_id IS NOT OLD.store_id
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_LINK_HISTORY_IMMUTABLE');
END;

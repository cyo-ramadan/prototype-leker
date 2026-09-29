PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-19: "kasih tombol kasir bisa permit tutup laci kasir
-- sebelumnya karna sudah waktu dia untuk jaga. nanti admin acc kan akhirnya
-- di force close." Skenario: kasir A pulang shift tapi lupa/tidak sempat
-- tutup lacinya sendiri, kasir B datang gantian jaga dan butuh buka laci --
-- tapi sistem menolak (DRAWER_ALREADY_OPEN, src/cashier-drawer.js) selama
-- laci A masih OPEN. Sebelum ini TIDAK ADA jalan keluar buat B selain
-- menunggu A balik login sendiri.
--
-- Tabel terpisah (bukan menumpang approval_requests yang sudah ada) karena
-- approval_requests dipasangkan ketat ke tiga request_type finansial
-- (CASH_FLOW/GOODS_FLOW/ASSET) yang mengalir lewat
-- buildOperationalPostingStatements (src/operational-posting.js) -- proses
-- posting itu didesain buat mutasi kas/stok/aset, bukan buat menutup paksa
-- sesi laci orang lain. Memaksakannya ke sana berarti nambah cabang khusus
-- di jalur yang sudah padat aturan finansial, lebih berisiko daripada bikin
-- tabel kecil sendiri.
--
-- closing_amount/deposit_amount di sini adalah HASIL HITUNG FISIK milik kasir
-- B saat itu (dia yang megang laci secara fisik, A sudah tidak di tempat) --
-- begitu Admin ACC, angka ini yang dipakai nutup baris cash_drawer_sessions
-- milik A persis seperti alur tutup laci normal (lihat
-- src/cashier-drawer-close-permit.js), termasuk setoran (kalau ada) tetap
-- diatasnamakan A (target_cashier_id), bukan B -- itu uang shift A, B cuma
-- pelapor.
--
-- target_cashier_id dicatat eksplisit (bukan cuma diturunkan dari
-- cash_drawer_sessions.cashier_id saat dibaca) supaya baris ini tetap utuh
-- jadi jejak "siapa yang gagal tutup laci sendiri" -- Bos Cyo sudah bilang
-- eksplisit ini akan dipakai mempengaruhi penilaian kasir (Raport/KPI) di
-- kemudian hari. Query KPI nanti tinggal SELECT dari tabel ini
-- (status='APPROVED', target_cashier_id = ?), tidak perlu baca ke
-- cash_drawer_sessions.

CREATE TABLE IF NOT EXISTS drawer_close_permits (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  drawer_session_id TEXT NOT NULL REFERENCES cash_drawer_sessions(id),
  target_cashier_id TEXT NOT NULL REFERENCES cashiers(id),
  requested_by_cashier_id TEXT NOT NULL REFERENCES cashiers(id),
  closing_amount INTEGER NOT NULL CHECK (closing_amount >= 0),
  deposit_amount INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  closing_note TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_by_role TEXT,
  decided_by_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drawer_close_permits_store_status
  ON drawer_close_permits(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drawer_close_permits_target_cashier
  ON drawer_close_permits(target_cashier_id, status);

-- Satu laci cuma boleh punya satu permit PENDING nangkring bersamaan --
-- dua kasir tidak boleh mengajukan force-close ganda buat laci yang sama.
CREATE UNIQUE INDEX IF NOT EXISTS uq_drawer_close_permits_pending_drawer
  ON drawer_close_permits(drawer_session_id) WHERE status = 'PENDING';

-- Tanda angka merah di tombol Pengumuman Portal Staf (Bos Cyo, 2026-10-18): "kalo ada yang baru harusnya
-- ada tanda 1 warna merah di tombolnya" -- seperti notifikasi Facebook. Disimpan per akun kasir (bukan per
-- HP), jadi tetap benar walau CS berganti perangkat. Pengumuman lebih baru dari last_seen_at = belum dibaca.
CREATE TABLE IF NOT EXISTS staff_announcement_seen (
  cashier_id TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL,
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

-- Pengumuman atas permintaan Bos Cyo, 2026-10-19; hanya ENT-KPM (Pendem/BEJI).
-- Id tetap dan NOT EXISTS mencegah pengumuman ganda saat dijalankan ulang.
CREATE INDEX IF NOT EXISTS idx_info_gerai_reports_author
  ON info_gerai_entries(store_id, created_by_id)
  WHERE kind = 'LAPORAN' AND created_by_role = 'CASHIER' AND source = 'CS';

INSERT INTO announcements (id, entity_id, store_id, title, body, created_by, created_by_role, is_active, created_at)
SELECT 'announce_qris_kontak_kpi_20261019', e.id, NULL,
  'QRIS: wajib klaim segera & lengkapi kontak darurat gerai',
  '**PENGUMUMAN UNTUK SELURUH CS

1. QRIS
Menautkan notifikasi QRIS ke transaksi QRIS SUDAH TIDAK WAJIB. Yang WAJIB adalah KLAIM notifikasi QRIS SEGERA ketika customer menunjukkan pembayaran. Cocokkan nominal dan waktu pembayarannya, lalu klaim untuk gerai sendiri. Jangan ditunda.

2. LENGKAPI INFORMASI KONTAK DARURAT GERAI
Seluruh CS diminta mengisi Info Gerai, bagian Laporan Masalah, dengan informasi supplier yang biasa digunakan untuk belanja kebutuhan darurat. Tulis nama kontak/supplier, nomor WhatsApp, dan alamat yang jelas. Contohnya pemasok es batu, toko plastik, gas, air, atau kebutuhan darurat lainnya.

Contoh format berikut hanya contoh, bukan kontak asli:
- Gerai Pendem - Es batu - 08235623xxx - Jl. Bahlil Raya No. 34.
- Gerai Pendem - Toko plastik Mbak Mega - 07834834xxx - Jl. Mulyana 11/100.

Isi kontak yang benar-benar digunakan gerai masing-masing agar rekan CS mudah menghubunginya saat darurat.

3. RAPORT / KPI
Jumlah laporan Info Gerai yang dikirim tiap CS sudah tercatat pada Raport/KPI sebagai bahan penilaian kontribusi. Isi laporan dengan informasi yang benar, lengkap, dan bermanfaat.**',
  'Bos Cyo', 'OWNER', 1, CURRENT_TIMESTAMP
FROM entities e
WHERE e.id = 'ENT-KPM'
  AND NOT EXISTS (SELECT 1 FROM announcements WHERE id = 'announce_qris_kontak_kpi_20261019');

-- DOC-IMPACT: pengumuman CS ENT-KPM dan indeks hitungan kontribusi laporan pada Raport/KPI.

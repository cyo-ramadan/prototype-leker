-- Cara bayar QRIS (Bos Cyo, 2026-10-17): "pembayaran via qris ini belum ada di pembayaran ... muaranya
-- nanti tetep ke rekber" -- uang QRIS secara teknis masuk rekening QRIS dulu lalu dalam sehari
-- dipindah ke Rekening Bersama, jadi untuk saat ini QRIS dibukukan sama persis seperti REKBER:
-- akun jurnal yang sama (1103 Rekening Bersama) dan Rekening Bersama entity yang sama.
--
-- Hanya MENAMBAH satu cara bayar per gerai aktif yang punya REKBER aktif. Tidak mengubah cara bayar
-- lain, penjualan lama, atau jurnal yang sudah ada. Idempoten: dilewati bila gerai sudah punya cara
-- bayar berkode/bernama QRIS. Gerai baru / tanpa REKBER: admin menambah sendiri di Metode Pembayaran.
INSERT INTO payment_methods (id, store_id, code, name, account_id, shared_account_id, is_active, is_default, creates_payable)
SELECT 'payment_' || p.store_id || '_qris', p.store_id, 'QRIS', 'QRIS', p.account_id, p.shared_account_id, 1, 0, 0
FROM payment_methods p
JOIN stores s ON s.id = p.store_id
WHERE p.code = 'REKBER' AND p.is_active = 1 AND s.is_active = 1
  AND NOT EXISTS (
    SELECT 1 FROM payment_methods q WHERE q.store_id = p.store_id AND (q.code = 'QRIS' OR q.name = 'QRIS')
  );

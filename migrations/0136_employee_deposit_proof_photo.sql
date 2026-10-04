-- Bos Cyo, 2026-10-04: setoran CS mengurangi piutang CS dengan cara CS transfer lalu
-- mengirim FOTO bukti transfer; piutang baru berkurang setelah Admin klik ACC (tidak
-- ada ACC otomatis). Foto disimpan seperti foto presensi dan foto tutup laci (BLOB,
-- maks 800 KB, src/live-photo.js). Hanya menambah kolom; fakta setoran lama tidak disentuh.
ALTER TABLE operational_receivable_payable_payments ADD COLUMN proof_photo BLOB;
ALTER TABLE operational_receivable_payable_payments ADD COLUMN proof_photo_type TEXT;

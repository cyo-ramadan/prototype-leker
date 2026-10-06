-- Setoran CS masuk Rekening Bersama (Bos Cyo, 2026-10-06):
-- "ketika cs mau setoran itu nanti setornya ke rekening bersama. piutang kredit, rekber debet."
--
-- 1. Setiap kiriman setoran CS mencatat Rekening Bersama tujuannya. Saat Admin ACC:
--    - baris IN di entity_shared_account_ledger untuk gerai itu (saldo bagian gerai naik),
--    - jurnal Dr 1103 Rekening Bersama / Cr 1202 Piutang Karyawan (bukan lagi Dr 1101 Kas).
--    Kiriman lama (kolom ini NULL) tetap dijurnal ke Kas seperti sebelumnya -- tidak ada
--    data lama yang ditafsir ulang.
-- 2. entity_shared_account_ledger.source_type dibatasi CHECK (SALE/PURCHASE/EXPENSE/TRANSFER/
--    GOODS_FLOW) dan tabelnya sekarang dirujuk banyak foreign key -- membangun ulang tabel itu
--    untuk melebarkan CHECK berisiko tinggi di D1 produksi. Jadi baris dari Admin tetap memakai
--    source_type 'EXPENSE' (preseden hutang-piutang.js, termasuk arah IN untuk pembatalan) dan
--    rinciannya ditaruh di kolom baru source_kind ('SETORAN_CS', 'BAYAR_HUTANG', ...).
--    source_kind hanya label tampilan; perhitungan saldo tidak membacanya.
--
-- Hanya ALTER TABLE ADD COLUMN (nullable / default kosong): tidak mengubah baris yang ada.
ALTER TABLE operational_receivable_payable_payments ADD COLUMN shared_account_id TEXT REFERENCES entity_shared_accounts(id);
ALTER TABLE operational_receivable_payable_payments ADD COLUMN shared_ledger_id TEXT REFERENCES entity_shared_account_ledger(id);
ALTER TABLE entity_shared_account_ledger ADD COLUMN source_kind TEXT NOT NULL DEFAULT '';

-- Bos Cyo, 2026-10-13: "entry baru tapi di split langsung ... sistem langsung membagi ... kedalam range
-- harian, lalu entry per tanggalnya ... ini untuk semua akun." Jurnal Split baru (tanpa jurnal sumber)
-- memakai mesin jadwal ADR-049 yang sama. Bila akun debit/kredit adalah akun hutang/piutang per orang
-- (PARTY_RULES: 1202, 2102, 2101, 1201, 2103), nama "atas nama"-nya wajib dan disimpan di sini supaya
-- SETIAP jurnal harian ikut bernama (ADR-054/056: tidak menambah "belum bernama" di Buku Pembantu).
-- Isi: JSON { type, employeeId, supplierId, name } hasil validasi prepareJournalParties; NULL = akun
-- itu tidak memakai nama. Jadwal lama tidak berubah (kolom NULL).
ALTER TABLE accounting_journal_schedules ADD COLUMN debit_party_json TEXT;
ALTER TABLE accounting_journal_schedules ADD COLUMN credit_party_json TEXT;

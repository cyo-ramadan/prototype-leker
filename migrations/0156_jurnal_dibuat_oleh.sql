-- Bos Cyo, 2026-10-14: "menurutmu sebenernya perlu engga sih histori siapa yang entry? ... masukinnya di
-- detil nya saja jangan tabel yang langsung terlihat." Jurnal mencatat SIAPA yang membuatnya: peran + id
-- user (nama dibaca saat Detail dibuka dari tabel akunnya), plus catatan singkat untuk jurnal sistem
-- (mis. "Koreksi tanggal pembalik atas perintah Bos Cyo"). Jurnal otomatis dari transaksi operasional
-- mewarisi pembuat transaksinya (Bea: yang input / yang membatalkan; hapus transaksi kasir: yang ACC).
-- Tidak berlaku mundur: jurnal lama NULL dan tampil "-" di Detail.
ALTER TABLE accounting_journal_headers ADD COLUMN created_by_role TEXT;
ALTER TABLE accounting_journal_headers ADD COLUMN created_by_id TEXT;
ALTER TABLE accounting_journal_headers ADD COLUMN created_by_note TEXT;

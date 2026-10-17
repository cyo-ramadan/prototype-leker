-- Denda kekosongan bertingkat (Bos Cyo, 2026-10-17): denda dihitung dari lamanya gerai KOSONG (tidak ada
-- yang jaga) dalam satu shift, bukan dari "kosong penuh/sebagian". Bawaan: kosong 3-4 jam = Rp10.000,
-- lebih dari 4 jam = Rp20.000, kurang dari 3 jam tanpa denda (potongan apresiasi per jam tetap). Semua
-- bisa diatur pelanggan: denda ON/OFF, batas jam, nominal. NULL = ikut bawaan entity / aplikasi.
-- Nominal memakai kolom lama: denda_sebagian_rupiah = denda ringan, denda_penuh_rupiah = denda berat.
ALTER TABLE apresiasi_settings ADD COLUMN denda_enabled INTEGER CHECK (denda_enabled IS NULL OR denda_enabled IN (0, 1));
ALTER TABLE apresiasi_settings ADD COLUMN denda_ringan_menit INTEGER CHECK (denda_ringan_menit IS NULL OR denda_ringan_menit >= 0);
ALTER TABLE apresiasi_settings ADD COLUMN denda_berat_menit INTEGER CHECK (denda_berat_menit IS NULL OR denda_berat_menit >= 0);

-- Kartu revisi di riwayat (Bos Cyo, 2026-10-17): "riwayat lama tetep muncul terus dibawahnya ... ada kartu
-- lagi keterangan untuk revisinya". Gaji sesi sebelum & sesudah revisi disimpan saat ACC supaya riwayat
-- menampilkan kartu lama apa adanya + kartu revisi berisi selisihnya (scaled x1.000.000).
ALTER TABLE attendance_revision_permits ADD COLUMN pay_before_scaled INTEGER;
ALTER TABLE attendance_revision_permits ADD COLUMN pay_after_scaled INTEGER;

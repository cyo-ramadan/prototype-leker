-- Tanggal berhenti/resign CS (Bos Cyo, 2026-10-22, kasus Indah Beji): Dana Apresiasi tidak menilai shift
-- pada/sesudah tanggal ini; yang terlanjur dinilai dibatalkan lewat nilai ulang (src/dana-apresiasi.js setBerhenti).
ALTER TABLE cashier_cs_status ADD COLUMN berhenti_tanggal TEXT CHECK (berhenti_tanggal IS NULL OR berhenti_tanggal GLOB '????-??-??');

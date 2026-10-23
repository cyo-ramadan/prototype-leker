-- Tanggal berhenti/resign CS (Bos Cyo, 2026-10-22, kasus Indah Beji): Dana Apresiasi tidak menilai shift
-- pada/sesudah tanggal ini; yang terlanjur dinilai dibatalkan lewat nilai ulang (src/dana-apresiasi.js setBerhenti).
ALTER TABLE cashier_cs_status ADD COLUMN berhenti_tanggal TEXT CHECK (berhenti_tanggal IS NULL OR berhenti_tanggal GLOB '????-??-??');

-- Resign karyawan (Bos Cyo, 2026-10-22: "di karyawan itu kasih kolom aktive atau engga. jadi cs yang resign
-- maka uda engga aktive lagi"): tanggal & alasan berhenti di master karyawan (src/employee-master.js).
ALTER TABLE employees ADD COLUMN berhenti_tanggal TEXT CHECK (berhenti_tanggal IS NULL OR berhenti_tanggal GLOB '????-??-??');
ALTER TABLE employees ADD COLUMN berhenti_alasan TEXT NOT NULL DEFAULT '';

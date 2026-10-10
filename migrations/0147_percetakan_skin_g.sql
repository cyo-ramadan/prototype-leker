PRAGMA foreign_keys = ON;

-- MAXI-PERCETAKAN-SKIN-G-20261010 -- ADR-055 D9.
--
-- Bos Cyo, 2026-10-10: "upgrade fitur2 itu hanya berlaku pada tenant baru tersebut. jadi dijadikan
-- on/off skin. setiap tenant juga bisa pake skin itu kalo dipilih ... tenant lainnya ga ngerasa
-- karna engga on."
--
-- Saklar fitur Percetakan pindah ke kebijakan tenant ui_skin = 'G' (src/tenant-policy.js
-- isPercetakanChoice). Tenant Percetakan yang dibuat migration 0145 langsung memakai G. Hanya
-- diisi kalau Owner belum pernah memilih skin untuk tenant ini -- pilihan Owner tidak ditimpa.
-- Tenant lain tidak disentuh.

INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id)
SELECT 'TEN-CETAK', 'ui_skin', 'G', 'SYSTEM', 'migration-0147'
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-CETAK')
  AND NOT EXISTS (SELECT 1 FROM tenant_policy_settings WHERE tenant_id = 'TEN-CETAK' AND setting_key = 'ui_skin');

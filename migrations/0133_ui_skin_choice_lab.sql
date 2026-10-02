PRAGMA foreign_keys = ON;

-- 2026-10-01, Bos Cyo: "bikin aja ketiga2nya. nanti ada tombol a b dan c dan
-- 0. 0 itu yang skr." Saklar skin per tenant berubah dari ON/OFF
-- (`ui_skin_siap_jual`, migration 0132) menjadi pilihan `ui_skin` = 0/A/B/C
-- (src/tenant-policy.js). Tenant lain tidak punya baris ini = 0 (tampilan
-- sekarang). Lab Tampilan mulai di A; Owner menggantinya dari panel
-- Kebijakan tenant.
--
-- Baris lama `ui_skin_siap_jual` milik Lab dibiarkan (tidak dibaca lagi oleh
-- kode) -- additive murni, tidak menghapus apa pun.

INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id)
SELECT 'TEN-LAB-TAMPILAN', 'ui_skin', 'A', 'SYSTEM', 'migration_0133'
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-LAB-TAMPILAN')
  AND NOT EXISTS (
    SELECT 1 FROM tenant_policy_settings WHERE tenant_id = 'TEN-LAB-TAMPILAN' AND setting_key = 'ui_skin'
  );

PRAGMA foreign_keys = ON;

-- 2026-10-06, Bos Cyo: "ini ada customer jualannya parfum, buatin skin kusus
-- untuk dia ya" -- tenant belum ada ("Belum, buatkan baru"). Nama usaha belum
-- disebut, jadi dipakai nama sementara "Toko Parfum"; nama tenant/entity/gerai
-- bisa diganti Owner lewat panel tanpa migration baru.
--
-- Isi: satu Tenant + satu Entity + satu gerai kosong (PARFUM01), saklar
-- `ui_skin` = F (Racik Parfum, DESAIN-SKIN-F-RACIK-PARFUM.md), dan satu akun
-- Entity Admin untuk pemilik usaha: username `parfum_pemilik`. Password TIDAK
-- ditulis di repo -- hanya hash SHA-256-nya (pola hashCredential() di
-- src/owner-auth.js, precedent 0132); plaintext diserahkan langsung ke Bos Cyo
-- di chat. Akun kasir, bahan (bibit, alkohol, botol), aroma, dan resep standar
-- dibuat pemiliknya lewat Workspace Gerai seperti gerai baru lainnya.
--
-- Gerai dibuat dengan edition default -- sama seperti gerai yang dibuat Owner
-- lewat panel; trigger AFTER INSERT stores menyemai bootstrap akuntansinya.
--
-- Additive murni. Tidak menyentuh tenant/entity/store yang sudah ada.

INSERT INTO tenants (id, name)
SELECT 'TEN-PARFUM', 'Toko Parfum'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-PARFUM');

INSERT INTO entities (id, name)
SELECT 'ENT-PARFUM', 'Toko Parfum'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-PARFUM');

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-PARFUM-01', 'ENT-PARFUM', 'TEN-PARFUM', CURRENT_TIMESTAMP,
       'Tenant baru toko parfum racikan (skin F), 2026-10-06'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-PARFUM' AND effective_to IS NULL
);

INSERT INTO stores (id, code, store_name, address, is_active, entity_id)
SELECT 'store_parfum01', 'PARFUM01', 'Toko Parfum', '', 1, 'ENT-PARFUM'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = 'store_parfum01' OR code = 'PARFUM01');

INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_parfum_pemilik', 'ENT-PARFUM', 'parfum_pemilik',
       '9d398fdddf4e3b67f04529434615e5e36c734c8d87141ceb4c0b9ffb3cb6e3c7',
       'Pemilik Toko Parfum', 1
WHERE NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'parfum_pemilik' COLLATE NOCASE);

INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id)
SELECT 'TEN-PARFUM', 'ui_skin', 'F', 'SYSTEM', 'migration_0140'
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-PARFUM')
  AND NOT EXISTS (
    SELECT 1 FROM tenant_policy_settings WHERE tenant_id = 'TEN-PARFUM' AND setting_key = 'ui_skin'
  );

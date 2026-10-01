PRAGMA foreign_keys = ON;

-- 2026-10-01, Bos Cyo (sesi UI/UX "Siap Jual", HANDOFF-UIUX-SIAP-JUAL.md):
-- "bikin tenant baru ... tenant baru ini nanti akan dipakai bikin skin dan
-- memilih skin yang paling proper sebelum diaplikasikan ke semua tenant."
--
-- Tenant laboratorium tampilan. Isinya satu Entity + satu gerai kosong
-- (bukan data asli Leker), plus saklar kebijakan tenant `ui_skin_siap_jual`
-- yang langsung ON -- semua perubahan tampilan T1 dst hanya muncul di tenant
-- yang saklarnya ON (src/tenant-policy.js, src/ui-profile.js). Tenant lain
-- tidak punya baris saklar ini, jadi jatuh ke default OFF = tampilan lama.
--
-- Gerai dibuat dengan edition default (ACCOUNTING) -- sama persis seperti
-- gerai yang dibuat Owner lewat panel (POST /api/owner/stores tidak mengisi
-- edition) -- supaya semua layar, termasuk yang nanti disembunyikan T2, ikut
-- terlihat dan bisa dibandingkan. Trigger AFTER INSERT stores menyemai
-- bootstrap akuntansinya sendiri, sama seperti gerai baru lainnya.
--
-- Akun Entity Admin (pemilik usaha) untuk lab ini: username `lab_pemilik`.
-- Password TIDAK ditulis di repo (beda dari precedent 0064/0090) -- hanya
-- hash SHA-256-nya (pola hashCredential() di src/owner-auth.js); plaintext
-- diserahkan langsung ke Bos Cyo di chat. Akun kasir dibuat dari Workspace
-- Gerai seperti biasa.
--
-- Additive murni. Tidak menyentuh tenant/entity/store yang sudah ada.

INSERT INTO tenants (id, name)
SELECT 'TEN-LAB-TAMPILAN', 'Lab Tampilan'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-LAB-TAMPILAN');

INSERT INTO entities (id, name)
SELECT 'ENT-LAB-TAMPILAN', 'Lab Tampilan - Usaha Contoh'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-LAB-TAMPILAN');

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-LAB-TAMPILAN-01', 'ENT-LAB-TAMPILAN', 'TEN-LAB-TAMPILAN', CURRENT_TIMESTAMP,
       'Tenant laboratorium tampilan (uji skin sebelum dipakai semua tenant), 2026-10-01'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-LAB-TAMPILAN' AND effective_to IS NULL
);

INSERT INTO stores (id, code, store_name, address, is_active, entity_id)
SELECT 'store_lab01', 'LAB01', 'Gerai Contoh', '', 1, 'ENT-LAB-TAMPILAN'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE code = 'LAB01');

INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_lab_pemilik', 'ENT-LAB-TAMPILAN', 'lab_pemilik',
       'a5df3223694194d430b0782cbf2b4845ea2f5c710dafab98b5c8bdc7d8b9ef7a',
       'Pemilik Lab', 1
WHERE NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'lab_pemilik' COLLATE NOCASE);

INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value, updated_by_role, updated_by_id)
SELECT 'TEN-LAB-TAMPILAN', 'ui_skin_siap_jual', '1', 'SYSTEM', 'migration_0132'
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_policy_settings WHERE tenant_id = 'TEN-LAB-TAMPILAN' AND setting_key = 'ui_skin_siap_jual'
);

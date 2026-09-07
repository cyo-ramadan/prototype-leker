PRAGMA foreign_keys = ON;

-- 2026-09-07, Bos Cyo: gerai Mall Dinoyo (store_001 / ENT-G001) sejatinya beda
-- tenant dari MAXI -- pemiliknya PT Harilibur, bukan bagian dari Prototype
-- Leker (TEN-PROTOTYPE) yang selama ini jadi tenant default hasil backfill
-- ADR-030 (migration 0039). Ini split, bukan onboarding baru: entity_id
-- ENT-G001 TIDAK berubah (ADR-030 SS2 -- ledger, stock, dan journal yang sudah
-- posted tetap anchor ke entity_id yang sama, jadi split tenant ini tidak
-- menyentuh satu pun baris transaksi), yang berubah hanya kepemilikan
-- (entity_tenancy) dan nama entity-nya. Pola persis migration 0050
-- (ikan-galeh-tenant) untuk bagian "buat tenant baru"; bedanya di sini
-- entity-nya sudah ada lama (dibuat 2026-08-19) jadi bukan INSERT entity baru,
-- melainkan UPDATE nama + tutup entity_tenancy lama/buka yang baru (ADR-030
-- SS3: "Membership is closed and reopened, never overwritten").
--
-- Additive terhadap tenants/entity_tenancy, rename terhadap entities.name.
-- Tidak menyentuh stores, chart_of_accounts, journal, atau stock manapun.
--
-- Baris entity_tenancy lama dari migration 0039 punya id deterministik
-- 'TNC-' || code (di sini 'TNC-G001'), jadi dirujuk langsung -- bukan
-- dicari lewat WHERE tenant_id/effective_to supaya tidak salah pegang kalau
-- suatu saat ada baris historis lain. CASE di effective_to: CHECK constraint
-- tabel ini mewajibkan effective_to > effective_from (ketat, bukan >=) --
-- kalau migration ini jalan di detik yang sama dengan effective_from-nya
-- (skenario nyata di test yang mengaplikasikan seluruh migration 0001-0079
-- back-to-back dalam hitungan milidetik), CURRENT_TIMESTAMP polos bisa
-- persis sama dengan effective_from dan CHECK gagal -- fallback +1 detik
-- menjamin tetap valid tanpa mengubah perilaku di production (di sana
-- effective_from-nya 2026-08-19, jauh di belakang, jadi cabang CURRENT_TIMESTAMP
-- yang dipakai). Baris baru effective_from-nya diambil dari effective_to
-- baris lama supaya sambung persis, tidak ada gap maupun overlap.

INSERT INTO tenants (id, name)
SELECT 'TEN-HARILIBUR', 'PT Harilibur'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-HARILIBUR');

UPDATE entities
SET name = 'leker.hari.malang'
WHERE id = 'ENT-G001';

UPDATE entity_tenancy
SET effective_to = CASE
  WHEN CURRENT_TIMESTAMP > effective_from THEN CURRENT_TIMESTAMP
  ELSE datetime(effective_from, '+1 seconds')
END
WHERE id = 'TNC-G001' AND effective_to IS NULL;

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-G001-02', 'ENT-G001', 'TEN-HARILIBUR',
       (SELECT effective_to FROM entity_tenancy WHERE id = 'TNC-G001'),
       'Split dari Prototype Leker: gerai Mall Dinoyo (store_001) milik PT Harilibur, bukan MAXI (Bos Cyo, 2026-09-07)'
WHERE NOT EXISTS (SELECT 1 FROM entity_tenancy WHERE id = 'TNC-G001-02');

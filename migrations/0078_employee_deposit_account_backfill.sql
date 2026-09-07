PRAGMA foreign_keys = ON;

-- 2026-09-07, Hana: schema drift ditemukan saat verifikasi PR #204 (Setoran
-- Karyawan). Migration 0075 sudah applied (tercatat di d1_migrations) dan
-- berhasil membuat akun 1202 "Piutang Karyawan" untuk 6 store ACCOUNTING
-- yang ada saat itu, TAPI 1304/6105 (migration 0076, pola INSERT OR IGNORE
-- identik) berhasil untuk semua 6 store sementara 1202 gagal untuk semua 6
-- -- inspect langsung ke chart_of_accounts remote membuktikan 0 baris code
-- 1202 padahal ada 6 store ACCOUNTING aktif dengan 1101/1304/6105 lengkap.
-- Ini BUKAN migration 0075 ditulis ulang (dilarang, CLAUDE.md invariant #7)
-- -- ini backfill idempotent terpisah untuk object yang terbukti hilang.
INSERT OR IGNORE INTO chart_of_accounts (
  id, store_id, code, name, type, subtype, is_active
)
SELECT
  'coa_' || id || '_1202', id, '1202', 'Piutang Karyawan',
  'ASSET', 'RECEIVABLE', 1
FROM stores
WHERE edition = 'ACCOUNTING';

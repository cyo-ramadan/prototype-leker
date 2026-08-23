// Konstanta bersama modul Ikan-galeh di dalam Worker prototype-leker. Cuma ada
// satu toko Ikan hari ini (lihat migrations/0050_ikan_galeh_tenant.sql) -- kalau
// kelak ada tenant Ikan kedua, ini yang perlu jadi parameter per-request, bukan
// ditambah migration baru (tabel ikan_* sudah punya kolom store_id dari awal).
export const IKAN_STORE_ID = 'store_ikan01';

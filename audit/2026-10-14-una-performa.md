# Audit performa Una — 2026-10-14

Arahan Bos Cyo: jangan terbitkan apabila penambahan fitur memperlambat pengguna secara signifikan. Tidak ada push/deploy/migration produksi selama pengukuran ini.

## Pengukuran browser, suara tidak dipakai

Baseline produksi `6a875c04c331c9a4a05c256724215613d5bc4185` dibanding implementasi lokal. Chromium Windows, fixture terkontrol memakai script/CSS chat sebenarnya, API palsu, tanpa model AI atau akun produksi. Versi diuji bergantian 24 kali; sampel pertama masing-masing dibuang, tersisa23. Ini pengukuran inisialisasi script chat dan membuka panel, **bukan** audit seluruh halaman/Core Web Vitals, HP lambat, jaringan seluler, beban produksi atau latensi D1 dari Worker.

| Ukuran | Baseline | Fitur, suara OFF |
|---|---:|---:|
| Median inisialisasi script |11,7ms|25,8ms|
| P95 inisialisasi script |17,2ms|34,6ms|
| Median membuka chat |32,4ms|32,8ms|
| P95 membuka chat |39,0ms|44,2ms|
| Long task teramati, total23 sampel |1|3|
| Model/Worker audio/AudioContext/mikrofon |0|0|
| Error browser |0|0|
| JS chat gzip |32.857byte|41.977byte|
| CSS bersama/chat gzip |10.212byte|10.440byte|

Tambahan unduhan awal JS+CSS sekitar9,1KiB. Mesin pengenal pemilik (~4,8KiB gzip script) kini baru dimuat saat pengaturan suara/mikrofon dipilih. Whisper ~41MB dan pengenal pemilik ~102MB tetap hanya sesudah tindakan pengguna. Buka pengaturan saja tidak memuat model atau meminta mikrofon.

Pengulangan awal sebelum pengurangan script menunjukkan tambahan inisialisasi sekitar31ms dan buka chat6ms; pengulangan saat tes CPU lain berjalan menunjukkan24ms/16ms. Variasi ini alasan tidak memakai satu sampel atau menyimpulkan persentase relatif sebagai latensi produksi. Data mentah pengulangan akhir: `2026-10-14-una-performa.json`.

Ulangi: `node scripts/fixtures/una-perf-local.mjs`, buka `http://127.0.0.1:4321/`, tekan **Mulai perbandingan** dan biarkan tab foreground sampai selesai. Fixture hanya localhost, API palsu, mikrofon diblokir, hasil ditulis ke TEMP. Hentikan server sesudah pengujian.

## Pemeriksaan server dan perbaikan

- Jalur selain `/api/caca/` tidak menjalankan konteks/pencatatan Una. Tidak ada polling audio/inferensi server untuk pengguna yang tidak memakai suara.
- Konteks skin/nama/keaktifan tenant sekarang satu lookup dengan index, menggantikan beberapa lookup terpisah. Dibanding baseline, endpoint chat/kesiapan bertambah1 statement: Owner2→3, Entity Admin gerai5→6, Entity Admin entity1→2. Pengaturan3/6/2. Angka adalah instrumentasi query fake DB, bukan pengukuran waktu produksi.
- `EXPLAIN QUERY PLAN` read-only pada D1 produksi memastikan lookup entity_tenancy, entities, tenants dan kedua tenant_policy_settings memakai index. Tidak ada perubahan data. SQL-duration EXPLAIN tidak dipakai sebagai latensi request.
- Balasan sehat tidak melakukan diagnostic I/O. Klarifikasi pertama recorder turun dari6→3 statement Owner dan7→4 Entity Admin; tidak menjalankan cleanup global, menggunakan UPSERT RETURNING dan reset expiry atomik.
- Recorder memakai `ctx.waitUntil`; regresi membuktikan response tidak menunggu recorder yang tertahan. Pencatatan tetap best-effort, bukan antrian durable; kegagalan/timeout background dapat menghilangkan diagnosis.
- Ditemukan fetch daftar pelanggan tidak terbatas pada kegagalan. Diperbaiki: LIMIT501, nama maksimum128 karakter, maksimal500 nama/32.768 karakter. Bila batas/validitas tidak terpenuhi, **semua** teks trigger/giliran disamarkan, termasuk nama pelanggan di luar sampel. Metadata alasan/peran/status tetap ada.
- EXPLAIN produksi sebelum index menemukan SCAN stores. Migration0155 yang belum diterapkan menambah index `idx_stores_entity_id(entity_id,id)`. Regresi SQLite dengan seluruh migration memastikan lookup gerai memakai covering index itu, pelanggan memakai `idx_customers_store_active_name`, tanpa SCAN stores. Index produksi harus dibuktikan ulang sesudah canonical deploy.

## Validasi dan keputusan

- Syntax seluruh aplikasi321file+modul baru: lulus. Wrangler4.150 dry-run: lulus, tanpa deployment.
- Regresi luas Una/kerangka/skin/schema/deploy:582tes,580lulus;1kegagalan lama pembaca dokumen HPP akibat CRLF telah terbukti pada baseline;1bug parser snapshot HEAD pada tes penjaga baru diperbaiki tanpa mengubah snapshot/batas cakupan, lalu20/20tes kamus+background lulus.
- Pembatasan pelanggan21/21lulus; assertion plan+nama di luar sampel diuji ulang1/1lulus. Uji klik mikrofon ganda/kegagalan pemuatan termasuk24/24suara/UIlulus. Kelompok bertumpang tindih, bukan dijumlahkan.
- Full suite sebelum penggabungan main:1937tes,1929lulus,8gagal baseline yang didokumentasikan pada handoff. Tidak mengklaim full suite versi akhir hijau dari hasil tersebut; CI Linux tetap pemeriksaan rilis.

**Hasil:** belum teramati pelambatan signifikan dalam pengujian lokal pengguna yang tidak memakai suara. Tambahan median inisialisasi14,1ms dan buka chat0,4ms. Risiko pembacaan pelanggan tidak terbatas sudah dibatasi dan diuji. Hasil ini cukup untuk melanjutkan pemeriksaan rilis sesuai izin Bos Cyo, dengan suara tetap OFF secara default; bukan jaminan latensi semua perangkat/tenant. Jika pemeriksaan rilis menemukan regresi nyata, publikasi tetap ditahan.

Belum diuji: percakapan mikrofon nyata di laptop/HP, akurasi pengenal pemilik populasi, CPU/baterai perangkat ketika live aktif, konkurensi tenant produksi. Pengguna yang menyalakan live dapat merasakan beban lokal dan unduhan awal. Suara Budi CapCut belum diintegrasikan; TTS memakai suara Indonesia browser/OS yang tersedia.

DOC-IMPACT: audit/reproduksi performa sebelum rilis; tidak mengklaim fitur sudah live.

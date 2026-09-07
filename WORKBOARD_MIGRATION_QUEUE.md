# Workboard Migration Queue

Dokumen ini adalah temporary mirror untuk task/report yang belum bisa dicatat ke MAXI Workboard karena jalur plugin/connector Workboard belum tersedia di sesi Karen. Entry di sini harus dipindahkan ke Workboard ketika jalur tersebut sudah tersedia dan verified. Jangan menganggap file ini sebagai pengganti permanen Workboard.

## TEMP-BOS-CYO-LEKER-CASHIER-CUSTOMER-APPROVAL-20260907

**Source / issued by:** BOS_CYO  
**Instruction:** disuruh Bos Cyo pada 2026-09-07  
**Assignee:** Karen  
**Project:** MAXI Leker (`cyo-ramadan/prototype-leker`)  
**Kind:** FEATURE  
**Territory:** Operasional / Cashier UI  
**Workboard status:** PENDING_MIGRATION  

### Task

Tambahkan akses review pendaftaran pelanggan langsung dari panel Kasir. Kasir harus dapat melihat request pelanggan yang masih `PENDING` untuk gerainya sendiri, lalu melakukan `ACC` atau `Reject` tanpa harus pindah ke panel Entity Admin/Admin Gerai.

### Preflight finding

Backend customer membership sudah memiliki authority untuk Kasir pada route `/api/admin/customer-requests`: session Kasir boleh list/review request hanya jika store pada request sama dengan store akun Kasir. Cross-store request ditolak server dengan `CASHIER_STORE_SCOPE_MISMATCH`. Existing backend regression test juga sudah mencakup list, approve, reject, dan cross-store denial untuk Kasir.

Gap yang ditemukan berada di UI Kasir: capability backend tersebut belum disurface sebagai command di panel Kasir.

### Implementation scope

- Tambah tombol `👤 ACC Pelanggan` di command panel Kasir.
- Tombol tidak bergantung pada status open/closed cash drawer karena customer approval bukan transaksi laci.
- Saat dibuka, UI mengambil pending registration melalui existing customer-request API dengan query `store=<kode gerai kasir>`.
- `ACC` memakai action `APPROVE`; `Reject` memakai action `REJECT` dengan alasan optional.
- Setelah review berhasil, daftar di-refresh secara explicit. Tidak ada periodic polling.
- Tidak mengubah backend authority, database schema, migration, customer-sharing contract, atau D1 business data secara langsung.

### Invariants / forbidden changes

- Tidak boleh menghilangkan server-side own-store authorization Kasir.
- Tidak boleh memberi Kasir akses review customer lintas gerai.
- Tidak boleh fallback diam-diam ke default store `G001`; setiap request UI ini wajib membawa kode store dari session Kasir.
- Tidak boleh menambah direct D1 write.
- Tidak boleh menambah polling background.
- Tidak boleh mengikat tombol customer approval ke `state.canWrite` / status cash drawer.

### Acceptance evidence

Required evidence untuk dianggap complete:

1. Panel Kasir menampilkan tombol `ACC Pelanggan`.
2. Dialog menampilkan pending request gerai Kasir sendiri.
3. Kasir dapat ACC dan Reject melalui existing API.
4. Existing backend own-store/cross-store guard tetap hijau.
5. Regression test UI memastikan tombol, explicit store routing, approve/reject flow, dan no polling tidak hilang.
6. `npm run check` dan `npm test` hijau pada PR CI.

### DOC-IMPACT

**DOC-IMPACT: REQUIRED.** Dokumen ini menjadi task/report mirror sementara karena Workboard belum dapat dipakai dari sesi Karen. Perubahan user-facing juga dicatat di sini sebagai implementation record sampai entry dipindahkan ke Workboard.

### Report

Preflight menemukan bahwa masalah adalah placement/UI discoverability, bukan missing backend capability. Implementasi dipilih sebagai thin cashier UI layer yang memakai endpoint dan authorization existing agar tidak menduplikasi business rule. Scope code dibatasi pada cashier surface + regression test.

Baseline `main` sebelum perubahan: job `Check & Test` pada Prototype Leker CI berhasil untuk syntax check dan regression tests. Workflow keseluruhan saat itu berstatus failure hanya karena step validasi Cloudflare credential pada job deploy gagal, sehingga deploy job berhenti sebelum migration/deploy.

Verification final bersumber dari PR CI untuk branch `karen/cashier-customer-approval`; status transient CI sengaja tidak diduplikasi di file ini agar dokumentasi tidak cepat stale.

### Workboard migration instruction

Saat plugin/connector Workboard sudah tersedia dan verified:

1. Buat/pindahkan task ini ke MAXI Workboard dengan source/issued-by tetap `BOS_CYO` dan note `disuruh Bos Cyo`.
2. Pindahkan task scope, invariants, acceptance evidence, serta implementation report dari entry ini.
3. Tautkan PR/commit final yang relevan dari branch `karen/cashier-customer-approval`.
4. Setelah record Workboard berhasil diverifikasi, tandai entry ini `MIGRATED` atau hapus mirror sesuai aturan dokumentasi aktif saat itu.

---

## TEMP-BOS-CYO-LEKER-CUSTOMER-WA-DUPLICATE-GUARD-20260907

**Source / issued by:** BOS_CYO  
**Instruction:** disuruh Bos Cyo pada 2026-09-07  
**Assignee:** Karen  
**Project:** MAXI Leker (`cyo-ramadan/prototype-leker`)  
**Kind:** FEATURE  
**Territory:** Customer  
**Workboard status:** PENDING_MIGRATION  

### Task

Tolak pendaftaran pelanggan apabila nomor WhatsApp yang dimasukkan sudah dimiliki customer yang ada di Master Customer. Pesan yang tampil ke customer harus `Customer sudah terdaftar.`

### Preflight finding

Master Customer sudah menyimpan nomor pada `customers.phone`, tetapi schema tidak mempunyai unique constraint untuk phone. Existing registration guard hanya mengecek username. Customer UI sudah menampilkan `payload.error` dari backend secara langsung, jadi pesan duplicate dapat disurface tanpa menambah UI error path baru.

Customer identity dapat melebar lintas gerai hanya melalui Customer Sharing Group. Karena itu duplicate phone mengikuti `resolveCustomerScope()` yang sama dengan identity/username, bukan global lintas tenant/store secara liar.

### Implementation scope

- Normalisasi nomor untuk comparison server-side: buang karakter selain digit dan samakan format Indonesia local `0...` dengan `62...`; bentuk `+62 0...` juga dinormalisasi ke `62...`.
- Saat `POST /api/customer/register`, cek nomor yang sudah ada pada Master Customer di authorized customer-sharing scope.
- Jika match, return HTTP `409` dengan code `CUSTOMER_ALREADY_REGISTERED` dan pesan `Customer sudah terdaftar.`.
- Ulangi check yang sama saat action `APPROVE` supaya request lama tidak bisa lolos bila nomor tersebut menjadi terdaftar setelah request dibuat.
- Nomor kosong tetap optional dan tidak dianggap duplicate.
- Tidak menambah migration, unique index, direct D1 write, polling, atau perubahan authority review.

### Invariants / forbidden changes

- Duplicate check wajib server-side; client-side check saja tidak cukup.
- Normalisasi formatting tidak boleh mengubah nomor yang disimpan sebagai historical/user-entered contact; normalisasi dipakai sebagai comparison key.
- Scope duplicate wajib mengikuti authorized Customer Sharing Group dari store request.
- Existing username guard, own-store cashier authorization, dan registration lifecycle `PENDING → APPROVED/REJECTED` harus tetap berlaku.
- Tidak boleh membuat duplicate customer row ketika approval-time recheck gagal.
- Request yang gagal di-ACC karena duplicate phone harus tetap `PENDING` agar dapat direview/ditangani secara eksplisit.
- Tidak boleh membuat phone menjadi required dalam task ini.

### Acceptance evidence

Required evidence untuk dianggap complete:

1. `0812 3456 7890`, `0812-3456-7890`, `+62 812 3456 7890`, dan `6281234567890` dibandingkan sebagai nomor yang sama.
2. Registration dengan equivalent phone yang sudah ada di Master Customer mendapat HTTP `409`, code `CUSTOMER_ALREADY_REGISTERED`, dan pesan `Customer sudah terdaftar.`.
3. Duplicate guard dijalankan ulang saat `APPROVE`; jika match, request tetap `PENDING` dan customer baru tidak dibuat.
4. Phone kosong tetap dapat mendaftar sesuai behavior existing.
5. Existing customer/cashier authorization dan username regression tetap hijau.
6. `npm run check` dan `npm test` hijau pada PR CI.

### DOC-IMPACT

**DOC-IMPACT: REQUIRED.** Rule identity customer berubah dan dicatat juga pada ADR-005. Entry ini adalah mirror task/report sementara sampai MAXI Workboard bisa ditulis dari sesi Karen.

### Report

Bos Cyo menetapkan nomor WhatsApp yang sudah masuk Master Customer sebagai duplicate-identity guard. Implementasi dipilih sebagai code-only server validation karena kolom phone existing cukup untuk kebutuhan prototype dan user-facing error sudah diteruskan oleh UI.

Guard diletakkan pada dua boundary: submit registration dan approval. Double-check saat approval sengaja dipertahankan agar dua request yang sempat pending bersamaan tidak menghasilkan dua Master Customer setelah salah satunya lebih dulu di-ACC.

Tidak ada schema change atau migration. Normalisasi hanya dipakai untuk comparison dan tidak menulis ulang phone lama di Master Customer.

### Workboard migration instruction

Saat plugin/connector Workboard sudah tersedia dan verified:

1. Buat/pindahkan task ini ke MAXI Workboard dengan source/issued-by tetap `BOS_CYO` dan note `disuruh Bos Cyo`.
2. Pindahkan task scope, invariants, acceptance evidence, serta implementation report dari entry ini.
3. Tautkan PR/commit final dari branch `karen/customer-whatsapp-duplicate-guard`.
4. Setelah record Workboard berhasil diverifikasi, tandai entry ini `MIGRATED` atau hapus mirror sesuai aturan dokumentasi aktif saat itu.

---

## TEMP-BOS-CYO-LEKER-CUSTOMER-STORE-ROUTING-PENDEM-20260907

**Source / issued by:** BOS_CYO  
**Instruction:** disuruh Bos Cyo pada 2026-09-07  
**Assignee:** Karen  
**Project:** MAXI Leker (`cyo-ramadan/prototype-leker`)  
**Kind:** BUG  
**Territory:** Customer / Store Routing  
**Workboard status:** PENDING_MIGRATION  

### Task

Perbaiki kasus customer memilih gerai `PENDEM` dari store picker tetapi kemudian tampil kembali pada gerai sebelumnya/default `G001` (Dinoyo).

### Preflight finding

Canonical route selector sudah mengarah ke `/s/<STORE>/customer`, dan `store-context.js` memang memberi prioritas kepada kode gerai dari path. Gap recovery berada pada timing penyimpanan remembered customer store: pilihan baru hanya menjadi remembered store setelah destination page berhasil menjalankan `store-context.js`. Bila navigation/path context tidak bertahan sampai tahap itu, fallback masih memakai remembered gerai lama dan dapat jatuh ke `G001`.

### Implementation scope

- Normalisasi kode gerai yang dipilih sebelum dipakai untuk routing.
- Simpan `lekerCustomerStoreCode` ke `localStorage` sebelum memulai navigation.
- Tetap gunakan canonical route `/s/<STORE>/customer` sehingga path store tetap authoritative.
- Tambahkan cachebuster baru pada `customer-store-select.js` di customer shell agar browser mengambil routing fix terbaru.
- Tambahkan regression test yang mengunci urutan persist-before-navigation, canonical scoped route, cachebuster, dan precedence path-store existing.
- Tidak mengubah database, API authority, store identity, atau default store contract.

### Invariants / forbidden changes

- `pathStore` tetap authoritative ketika `/s/<STORE>/...` tersedia.
- Remembered store hanya fallback untuk customer entry point yang kehilangan/tidak memiliki scoped path.
- Pemilihan `PENDEM` tidak boleh berubah menjadi `G001` hanya karena fallback state lama.
- Tidak boleh hardcode `PENDEM` sebagai special case; fix berlaku untuk semua kode gerai valid.
- Tidak ada direct D1 write atau migration.

### Acceptance evidence

1. Store picker menyimpan kode pilihan ke `lekerCustomerStoreCode` sebelum navigation.
2. Target navigation tetap `/s/<selected-store>/customer`.
3. Customer shell memuat selector dengan cachebuster versi fix.
4. Regression test memastikan persist terjadi sebelum navigation dan path store tetap lebih tinggi prioritasnya daripada remembered fallback.
5. `npm run check` dan `npm test` hijau.
6. Cloudflare Workers Build untuk commit final hijau dan functional test selection `PENDEM` tidak kembali ke Dinoyo/G001.

### DOC-IMPACT

**DOC-IMPACT: REQUIRED.** Ini bug user-facing store routing dan sekaligus task/report mirror sementara sampai MAXI Workboard dapat ditulis dari sesi Karen.

### Report

Bos Cyo melaporkan langsung bahwa customer memilih gerai Pendem tetapi kembali ke gerai Dinoyo. Patch dipilih sebagai persistence-before-navigation guard pada store picker, tanpa mengubah backend store resolution. Scope sengaja generik untuk semua gerai agar tidak menciptakan special-case Pendem.

### Workboard migration instruction

Saat plugin/connector Workboard sudah tersedia dan verified:

1. Buat/pindahkan task ini ke MAXI Workboard dengan source/issued-by tetap `BOS_CYO` dan note `disuruh Bos Cyo`.
2. Pindahkan scope, invariants, acceptance evidence, root-cause finding, dan implementation report dari entry ini.
3. Tautkan PR/commit final dari branch `karen/customer-store-routing-pendem`.
4. Setelah record Workboard berhasil diverifikasi, tandai entry ini `MIGRATED` atau hapus mirror sesuai aturan dokumentasi aktif saat itu.

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

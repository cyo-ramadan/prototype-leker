# ADR-042 — Game module dan batas reward fulfillment

Status: ACCEPTED
Tanggal: 2026-09-09
Diputuskan oleh: Bos Cyo
Implementasi pondasi: Karen
Mengikat: ADR-040, `contracts/module-contract-v1.md`

## Konteks

Roda Puter awal dibuat sebagai fitur yang langsung mengikat konfigurasi Game ke
Voucher Master + Product. Bentuk itu membuat Game bergantung pada Voucher dan
mendorong UI customer menebak artwork hadiah dari nama barang/sprite hardcoded.
Bos Cyo memutuskan Game akan berkembang menjadi modul horizontal tersendiri yang
bisa dipasang atau dilepas per Tenant, karena ke depan akan ada beberapa jenis
Game hadiah.

## Keputusan

### 1. `GAME` adalah modul horizontal opsional per Tenant

Entitlement modul hidup di registry platform, bukan di kolom baru pada `stores`.
Satu Tenant boleh punya `GAME` aktif atau tidak. Mematikan `GAME` menghentikan
pemakaian baru tetapi tidak menghapus histori Game yang sudah ada.

Entitlement Tenant adalah root. Konfigurasi Game boleh tetap scoped ke Store
untuk kebutuhan operasional seperti campaign Roda Puter per gerai.

### 2. Game tidak memiliki Voucher

Game menentukan outcome. Outcome membawa `reward_key` yang stabil dan snapshot
label/artwork. Game tidak menyimpan foreign key ke Voucher Master, Voucher
Instance, Product, Point, atau provider hadiah lain.

Fulfillment hadiah adalah boundary terpisah. Provider seperti Voucher, Customer
Point, Product, atau provider masa depan menerima business fact dari Game melalui
adapter/kontrak integrasi masing-masing. Game tidak mengimpor modul provider.

### 3. Roda Puter adalah game type pertama, bukan nama modul

`RODA_PUTER` menjadi salah satu `game_type_code` di dalam `GAME`. Jenis Game lain
dapat ditambahkan kemudian tanpa membuat sistem entitlement, campaign, outcome,
dan play history baru dari nol.

### 4. Artwork adalah properti outcome, storage-agnostic

Setiap outcome menyediakan `artwork_ref`. Nilai ini adalah opaque reference dan
Game tidak menentukan file tersebut disimpan di R2, repository static asset,
object storage lain, atau mekanisme lain. Strategi storage diputuskan terpisah.

Karena itu migration pondasi tidak membuat dependency ke R2 dan tidak menyimpan
kontrak vendor storage tertentu.

### 5. Client Game wajib lazy-load

Saat integrasi UI dilakukan, customer shell hanya membaca manifest capability
kecil. Bundle, CSS, artwork, suara, dan resource Game baru dipanggil jika:

1. Tenant memasang `GAME`;
2. game type/campaign terkait aktif;
3. surface customer memang membutuhkan Game tersebut.

Tenant tanpa `GAME` tidak boleh mengunduh bundle tiap game hanya untuk kemudian
menyembunyikannya dengan CSS.

### 6. Histori entitlement versioned

Registry menyimpan periode aktif dengan `effective_from` dan `effective_to`.
Disable menutup periode terbuka. Re-enable membuat row periode baru. Row yang
sudah ditutup tidak boleh diubah atau dihapus.

Pola ini mengikuti prinsip history-preserving ADR-030 dan persyaratan
`MAXI_MODULE_CONTRACT_V1`.

## Pondasi 0080

Migration `0080_game_module_foundation.sql` menambahkan:

- `platform_modules` — katalog definisi modul platform;
- `tenant_module_installations` — histori entitlement per Tenant;
- definisi module `GAME`, tanpa otomatis memasangnya ke Tenant mana pun;
- `game_campaigns` — campaign per Store/Entity;
- `game_outcomes` — outcome + `reward_key` + `artwork_ref`;
- `game_plays` — histori play append-only tanpa foreign key ke provider hadiah.

`src/platform-module-registry.js` hanya membaca registry. `src/game.js` adalah
entry point modul Game dan menyediakan manifest contract untuk lazy-loading.
Routing production dan migrasi Roda Puter legacy dilakukan dalam tahap integrasi
berikutnya supaya pondasi additive ini tidak diam-diam mengubah perilaku Game
existing.

## Compatibility

Tabel dan endpoint `roda_puter_*` legacy belum dihapus atau ditulis ulang dalam
pondasi ini. Roda Puter existing tetap menjadi compatibility surface sampai
campaign/reward/history-nya dimigrasikan secara eksplisit ke `game_*` dan adapter
fulfillment pengganti coupling Voucher sudah tersedia.

## Keputusan yang sengaja ditunda

- provider/storage fisik untuk `artwork_ref`;
- bentuk UI Owner untuk memasang/melepas `GAME` per Tenant;
- adapter fulfillment Voucher/Point/Product;
- migrasi data `roda_puter_*` legacy;
- owner final module `game` di `MODULE_OWNERSHIP.md`.

## DOC-IMPACT

**REQUIRED** — `MODULE_CATALOG.md`, `MODULE_OWNERSHIP.md`,
`contracts/game-module-v1.md`, dan test tenancy/module foundation harus berubah
bersama pondasi ini.

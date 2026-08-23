# Handoff — implementasi ADR-030 Langkah 4 (isolasi pindah ke Entity)

Disiapkan oleh: `hana1.1` — arsitektur
Tanggal: 2026-08-22
Architecture: `adr/ADR-030-multi-entity-tenancy-and-accounting-consolidation.md`

Baca dulu, berurutan: `CLAUDE.md` → `ADR-030` → `migrations/0039_tenancy_and_consolidation_foundation.sql`
→ `test/tenancy-foundation.test.js` → `KNOWN_PITFALLS.md`.

## Kenapa dokumen ini ada

Langkah 1-2 `ADR-030` sudah jalan (tabel `tenants`/`entities`/`entity_tenancy`/
`consolidation_groups`/`consolidation_membership`, kolom `stores.entity_id`
nullable, backfill satu Entity per gerai di bawah `TEN-PROTOTYPE`). Fase 1
menambahkan pembacaan Entity/Tenant di resolver gerai, dan Fase 2 menambahkan
anchor `entity_id` additive di ledger. Enforcement Langkah 4 ("pindahkan
isolasi dari `store_id` ke `entity_id`") masih belum dimulai di 48 file
konsumen `store_id`. Ini bukan kerjaan satu task; kalau dipaksa jadi satu task
besar, hasilnya bakal seperti versi pertama
`karen-BS-PAYMENT-ADMIN-ROUTE` — kelihatan lengkap tapi kontradiksi begitu
disentuh preflight. Dipecah jadi fase, setiap fase diverifikasi ke kode dulu
sebelum ditulis jadi task — pola yang sama yang berhasil di Manufaktur/Warehouse/
Business Settings sesi ini.

## Requirement yang tidak bisa ditawar

Leker (satu-satunya tenant hari ini, `TEN-PROTOTYPE`) **tidak boleh berubah
perilaku sama sekali** di setiap fase. Setiap fase harus additive dan bisa
di-deploy sendiri tanpa fase berikutnya — persis disiplin `HANDOFF-business-settings-implementation.md`.

## Fase 1 — Entity/Tenant kebaca di titik resolusi gerai

**Paths:** `src/stores.js`, `test/stores-entity-resolution.test.js`

**Status: LANDED — PR #139.** `resolveStore()` dan `listStores()` sekarang
menambahkan `entityId`, `entityName`, dan `tenantId` dari membership tenancy
yang masih terbuka tanpa mengubah field store yang lama. Fase ini juga
menyediakan `resolveAuthorizedEntityIds(db, tenantId)` untuk enforcement fase
berikutnya; fungsi itu belum dipakai oleh consumer mana pun.

Hampir semua handler di `src/` resolve gerai lewat satu fungsi:
`resolveStore(db, token)` di `src/stores.js`. Ini titik tercentral yang ada —
manfaatkan, jangan sentuh 48 file konsumennya satu-satu di fase ini.

1. `mapStore()`/`resolveStore()` query ditambah JOIN `stores → entities →
   entity_tenancy (WHERE effective_to IS NULL)`, kembalikan tambahan field
   `entityId`, `entityName`, `tenantId` di objek yang sudah ada. Field lain
   TIDAK berubah bentuk.
2. Fungsi baru `resolveAuthorizedEntityIds(db, tenantId)` — return semua
   `entity_id` yang punya baris `entity_tenancy` terbuka (`effective_to IS
   NULL`) untuk tenant itu. Belum dipakai di mana pun pada fase ini, cuma
   disediakan.

**TIDAK ada satu pun file konsumen `resolveStore` yang boleh diubah di fase
ini** — mereka otomatis dapat field baru itu tanpa perlu tahu, karena cuma
nambah properti ke objek yang sudah ada, bukan mengubah yang lama.

**Acceptance:** 344+ test existing hijau tanpa satu pun diubah; test baru
buktikan `resolveStore` return `entityId`/`tenantId` benar untuk tiap gerai
yang sudah di-backfill migration `0039`; `resolveAuthorizedEntityIds` return
persis entity yang berada di bawah tenant yang diminta.

## Fase 2 — Kolom `entity_id` di tabel ledger (additive, belum dipakai filter)

**Paths:** `migrations/0046_tenancy_ledger_entity_column.sql`,
`test/ledger-entity-backfill.test.js`

**Implementasi:** PR #141 mengerjakan Fase 2 tanpa mengubah read/filter runtime.
Tiga ledger Inventory (`inventory_stock_balances`, `inventory_ledger_entries`,
`stock_movements`) memakai additive `ALTER TABLE` + backfill. Dua tabel posted
journal (`accounting_journal_headers`, `accounting_journal_lines`) direbuild
secara lossless karena trigger immutability melarang `UPDATE` terhadap posted
journal; rebuild mempertahankan kolom existing, reversal link, index, scope
trigger, dan immutable update/delete trigger lalu menambahkan `entity_id`.

Tabel yang menyimpan fakta finansial/nilai (per `ADR-030` §2, ini yang
sebenarnya butuh anchor ke Entity, bukan Tenant):
`accounting_journal_headers`, `accounting_journal_lines`,
`inventory_stock_balances`, `inventory_ledger_entries`, `stock_movements`.

1. Tambahkan `entity_id TEXT REFERENCES entities(id)` secara additive. Untuk
   Inventory dipakai `ALTER TABLE`; untuk dua tabel posted journal dipakai
   rebuild lossless agar tidak melewati invariant immutability.
2. Backfill lewat `stores.entity_id` (tabel-tabel itu semua punya `store_id`).
   Kalau ada baris tanpa owner Entity yang valid, migration gagal lewat guard;
   jangan biarkan baris finansial tanpa books-owner lolos diam-diam.
3. **Belum ada satu query pun yang mulai FILTER pakai `entity_id`** di fase
   ini — itu Fase 3. Fase ini murni "kolomnya ada dan terisi benar."

**WAJIB:** migration baru, jangan sentuh migration yang sudah applied
(invariant #7). Boleh paralel dengan Fase 1 — beda file total.

**Acceptance:** seluruh test existing hijau; test Fase 2 membuktikan tiap baris
di lima tabel punya `entity_id` yang match dengan `entity_id` gerai pemiliknya
lewat `store_id`, row count/reversal link tetap utuh, immutability posted journal
tetap aktif, dan migration fail-closed bila owner Entity tidak bisa di-resolve.

## Fase 3 — Enforcement (belum ditulis jadi task, sengaja)

Ini bagian yang benar-benar mengubah "apa yang bisa dibaca siapa" — 46 file
yang pakai `store_id` sebagai batas hari ini perlu ditinjau satu-satu, mana
yang genuinely butuh jadi batas Entity (laporan lintas-gerai, export,
reconciliation) vs mana yang aman tetap `store_id` sebagai scope operasional
murni (per `ADR-030`: "`store_id` remains operational scope; it stops being an
implied books boundary" — bukan berarti dihapus).

**Sengaja tidak dipecah jadi task sekarang.** Karena taruhannya data
keuangan, tiap domain (Accounting, Admin/reporting lintas-gerai, Operasional,
Warehouse) butuh audit kode dulu sebelum ditulis jadi brief — persis kenapa
Fase 1 `karen-BS-STORES-EDITION` direvisi setelah preflight Karen menemukan
trigger tambahan yang tidak masuk brief awal. Menyusul per domain, begitu
Fase 1-2 mendarat dan hasil auditnya siap.

## Cara mengambil pekerjaan ini

Papan D1 `maxi-agent-bus`, `agent-bus/CLAIM-PROMPT.md`. Fase 1 dan 2 aman
sudah landed; Fase 3 menyusul setelah audit per domain menghasilkan brief yang
aman.

## DOC-IMPACT

**REQUIRED** — perbarui dokumen ini setiap fase mendarat. `MODULE_CATALOG.md`
diperbarui ketika status Fase 1-2 berubah. PR #139 mencatat implementasi dan
regression Fase 1; PR #141 mencatat detail implementasi Fase 2 dalam changeset
yang sama dengan migration dan regression-nya.

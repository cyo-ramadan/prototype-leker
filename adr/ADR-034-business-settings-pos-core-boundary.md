# ADR-034 — Business Settings sebagai lapisan generic, Accounting sebagai extension opsional

Status: SEBAGIAN JALAN (update 2026-08-21) — §1 (`payment_methods` lepas dari kewajiban
`account_id`) sudah kejawab lewat jalur lain: `karen-SA-PAYMENT-GATE-FIX` (PR #128)
memindah runtime baca ke `src/pos-payment-methods.js` dan memakai `account_id` nullable +
`NEEDS_PAYMENT_MAPPING` fail-closed di resolver Accounting — **bukan** tabel ekstensi
`payment_method_accounts` yang diusulkan §1. Efeknya sama (POS tidak butuh `account_id`),
caranya lebih sederhana. **Rekomendasi Hana: skip §1 apa adanya, tidak perlu tabel
ekstensi baru** kecuali Bos Cyo mau tetap punya jalur multi-akun per cara bayar nanti.
§2/§4 (gating dispatch + `stores.edition`) **belum jalan**, task-nya sudah di papan:
`karen-BS-PAYMENT-ADMIN-ROUTE`, `karen-BS-STORES-EDITION`, `karen-BS-DISPATCH-GATING`.
§3 sudah benar dari awal, tidak ada kerjaan.
Date: 2026-08-19
Change ID: `MAXI-BUSINESS-SETTINGS-BOUNDARY-20260819`
Dikerjakan oleh: `hana1.1` — arsitektur, atas usulan dan wewenang Bos Cyo

## Context

`adr/ADR-033` (audit 2026-08-19) menemukan bahwa positioning yang Bos Cyo bayangkan —
POS Core dengan Business Settings opsional dan Accounting sebagai extension opsional
dari itu — **sudah berjalan sebagian** di produksi, tanpa diberi nama:

- sale/purchase/expense commit sudah tidak pernah memanggil resolver Accounting secara
  sinkron (`src/cashier-sales-tracking.js`, `src/cashier-purchase.js`,
  `src/cashier-operational-expense.js`);
- dispatch ke Accounting terjadi post-commit, best-effort, dari satu titik
  (`src/accounting-pos-bridge-response.js`, dikawat di `src/index.js:161,166-167`);
- `product_kinds` dan `cost_types`/`cost_masters` sudah punya CRUD sendiri, terpisah
  dari `accounting-settings.js`.

Yang menahan positioning ini jadi eksplisit hanya dua trigger dan satu kolom:

1. `trg_stores_seed_accounting_settings_defaults` (`migrations/0022`) — gerai baru
   **wajib** menerima scaffolding Accounting penuh;
2. `trg_product_kinds_seed_accounting_mapping` (`migrations/0029`) — Jenis Barang baru
   **wajib** menyentuh `chart_of_accounts` lewat FK;
3. `payment_methods.account_id` — satu kolom dipakai dua pembaca dengan makna berbeda:
   POS Core butuh baris `payment_methods` ada; Accounting butuh `account_id`-nya terisi.

Assessment audit menutup dengan empat pertanyaan terbuka. ADR ini menjawabnya sebagai
usulan hana, ditulis eksplisit dan bisa ditolak per baris, bukan diam-diam diterapkan —
karena bentuk tabel yang salah di sini berarti migrasi ulang setelah ada data uang di
atasnya.

## Decision

### 1. `payment_methods.account_id` pindah ke extension table

**Masalah yang dijawab:** siapa pemilik kolom akun untuk cara bayar.

```sql
CREATE TABLE payment_method_accounts (
  payment_method_id TEXT PRIMARY KEY REFERENCES payment_methods(id) ON DELETE RESTRICT,
  store_id           TEXT NOT NULL REFERENCES stores(id),
  account_id         TEXT NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`payment_methods` sendiri kehilangan kewajiban punya akun — `code`, `name`,
`is_active`, `is_default` cukup untuk POS Core beroperasi. Baris di
`payment_method_accounts` hanya ada kalau admin sudah memetakannya lewat Accounting
Settings.

Pola ini **bukan penemuan baru** — persis pola yang sudah dipakai `item_categories`
terhadap `product_kinds` hari ini: satu tabel generic (`product_kinds`), satu tabel
ekstensi yang menunjuk baliknya (`item_categories`) dan memegang akun. `payment_methods`
tinggal disamakan bentuknya.

**Compatibility:** `payment_methods.account_id` **tidak dihapus** pada fase ini. Ia jadi
compatibility read — resolver membaca `payment_method_accounts` dulu, fallback ke kolom
lama kalau baris ekstensi belum ada. Ini persis disiplin yang sudah dipakai `0038` untuk
`accounting_component_rule_id`.

### 2. Definisi Accounting "OFF" = dispatcher tidak pernah dipanggil

**Masalah yang dijawab:** OFF berarti dispatch-lalu-diabaikan, atau dispatch tidak
pernah terjadi.

**Keputusan: tidak pernah dipanggil.** Kalau dispatch tetap jalan untuk gerai yang
sengaja tidak pakai Accounting, `accounting_bridge_deliveries` terisi baris
`NEEDS_CONFIGURATION` yang tidak berarti apa-apa dan tidak akan pernah diperbaiki
siapa pun — persis bentuk "janji palsu" yang sudah dilarang `ADR-031` untuk status
`Lengkap`. Gating dipasang di **titik pemanggilan** (`src/index.js`), bukan di dalam
resolver:

```js
if (store.hasAccounting) {
  return attachAccountingBridgeToCommittedResponse(trackedSaleResponse, env, 'SALE');
}
return trackedSaleResponse;
```

Resolver (`accounting-pos-bridge.js`) **tidak berubah sama sekali**. Ini menjaga
Constitution R5 tetap utuh: yang berubah cuma apakah Accounting diajak bicara, bukan
bagaimana ia menafsirkan.

### 3. `item_categories` — pola sudah benar, tidak perlu diratakan ulang

**Masalah yang dijawab:** apakah `item_categories` perlu dibentuk ulang mengikuti pola
`payment_method_accounts`.

**Tidak perlu.** `item_categories` **sudah** tabel ekstensi (menunjuk balik ke
`product_kinds` lewat `product_kind_id`, memegang tiga akun), persis bentuk target.
Yang tersisa memang di trigger C2 (§4), bukan di bentuk tabelnya.

### 4. `stores.edition` — tiga tingkat berurut, bukan dua flag bebas

**Masalah yang dijawab:** nama dan bentuk kolom penentu tingkat gerai.

**Bukan** dua flag independen (`has_business_settings`, `has_accounting`). Alasannya
ada di diagram Bos Cyo sendiri: Accounting digambarkan sebagai *"optional extension
dari Business Settings"* — Accounting butuh Business Settings sebagai sumber record
(Cara Bayar, Jenis Barang, Master Biaya) untuk dipetakan. `has_accounting=true` dengan
`has_business_settings=false` tidak punya arti: Accounting tidak akan punya apa pun
untuk dipetakan.

**Keputusan:** kolom berurut tiga tingkat, namanya mengikuti istilah produk yang sudah
Bos Cyo pakai sendiri:

```sql
ALTER TABLE stores ADD COLUMN edition TEXT NOT NULL DEFAULT 'ACCOUNTING'
  CHECK (edition IN ('LITE', 'FLEXIBLE', 'ACCOUNTING'));
```

| `edition` | Business Settings | Accounting | Produk |
|---|---|---|---|
| `LITE` | default bawaan POS, tidak bisa diedit admin | tidak ada | POS Lite |
| `FLEXIBLE` | admin bisa mengatur | tidak ada | POS Flexible |
| `ACCOUNTING` | admin bisa mengatur | aktif | POS Accounting |

Default `'ACCOUNTING'` — bukan `'LITE'` — supaya setiap gerai yang sudah ada (dan setiap
gerai baru yang dibuat tanpa menyatakan `edition`) berperilaku **persis** seperti hari
ini tanpa perlu backfill apa pun. Ini yang membuat fase 2 di bawah aman untuk Leker.

## Yang lolos tanpa perlu keputusan tambahan

- **Cost Master** (`cost_types`/`cost_masters`) sudah generic sepenuhnya —
  `accounting_component_rule_id` sudah bukan FK sejak `0038`, tidak ada rework.
- **Jenis Barang sebagai record** (`product_kinds`) sudah generic — trigger C2 yang
  perlu dibungkus kondisi, bukan tabelnya.

## Konsekuensi pada trigger

Trigger `trg_stores_seed_accounting_settings_defaults` dan
`trg_product_kinds_seed_accounting_mapping` dibungkus `WHEN NEW.edition = 'ACCOUNTING'`
(untuk yang pertama) dan kondisi setara pada `product_kinds` (menoleh ke
`stores.edition` gerai pemiliknya) untuk yang kedua. **Tidak dihapus** — gerai
`edition='ACCOUNTING'` (yaitu semua gerai existing) terus menerima scaffolding penuh
persis seperti hari ini.

## Consequences

- Leker (G001/G002/M002) tidak berubah perilaku sama sekali — ketiganya `edition =
  'ACCOUNTING'` secara default, byte-for-byte sama dengan sebelum ADR ini.
- Gerai `LITE`/`FLEXIBLE` baru bisa lahir tanpa scaffolding Accounting, membuka jalan
  POS Lite/Flexible sebagai produk nyata.
- Upgrade `LITE`/`FLEXIBLE` → `ACCOUNTING` di kemudian hari berarti menjalankan
  scaffolding trigger itu **sekali**, manual, untuk gerai yang di-upgrade — bukan fitur
  yang perlu dibangun sekarang, dicatat sebagai open item.
- **Beban tambahan:** setiap query yang mengasumsikan `payment_methods.account_id`
  selalu terisi (kalau ada) harus disesuaikan membaca lewat extension table dulu.

## Open — tetap milik Bos Cyo

1. **Jalur upgrade edition** — form admin, atau tetap manual lewat migration terarah
   untuk sementara? Ini keputusan produk, bukan teknis, dan tidak menghalangi Fase 0-2
   di `HANDOFF` (§ berikutnya) berjalan lebih dulu.
2. Tiga pertanyaan sisa dari `ADR-033` (Choice Group) **tidak** terjawab oleh ADR ini —
   keduanya independen; ADR ini tidak mengasumsikan jawabannya.

## Related

- `ADR-017`, `ADR-029`, `ADR-031` — batas Operasional/Setting Akuntansi/Accounting
- assessment 2026-08-19 (percakapan ini) — audit dependency map lengkap dengan sitasi
  file/baris untuk tiga coupling di atas
- `HANDOFF-business-settings-implementation.md` — urutan kerja implementer

## DOC-IMPACT

**REQUIRED** — `contracts/accounting-settings-v1.md` mencatat `payment_method_accounts`
sebagai sumber baru akun cara bayar. `README.md` mencatat `stores.edition`.
`KNOWN_PITFALLS.md` menambahkan larangan mengasumsikan `payment_methods.account_id`
selalu terisi.

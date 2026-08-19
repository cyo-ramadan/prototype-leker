# ADR-033 — Choice Group: satu tempat untuk daftar pilihan akun

Status: PROPOSED — menunggu keputusan Bos Cyo atas tiga challenge di §3
Date: 2026-08-19
Change ID: `MAXI-ACC-CHOICE-GROUPS-20260819`
Dikerjakan oleh: `hana1.1` — arsitektur, atas usulan Bos Cyo

## 1. Context

Bos Cyo mengusulkan Setting Akuntansi punya dua level: **Resep** (paket pilihan
reusable, tiap pilihan linked ke akun/resolver) dan **Aturan Transaksi** yang tinggal
menunjuk resep pada sisi Debit/Kredit-nya.

Usulan itu **benar**, dan lebih dari itu: bentuk yang diusulkan sudah ada di sistem
hari ini — empat kali, dengan empat cara berbeda, tanpa satu pun bernama.

## 2. Audit — apa yang sebenarnya ada sekarang

Model sekarang:

```
transaction_categories
  └── journal_rules (side, source_type, fixed_account_id?, is_default, sort_order)
        source_type ∈ fixed_account | payment_method
                    | item_category_{inventory,cogs,revenue} | cost_center_cash
```

Ditambah dua tabel pemetaan satelit: `payment_methods` (kode → akun) dan
`item_categories` (Jenis Barang → Persediaan/HPP/Pendapatan).

### 2.1 `journal_rules` memuat tiga hal sekaligus

1. **struktur baris** — sisi mana yang menghasilkan baris jurnal, urutannya;
2. **strategi resolusi akun** — `source_type`;
3. **satu opsi di dalam sebuah daftar pilihan** — dan yang ketiga ini kecelakaan.

Bukti butir ketiga ada di dalam kode, bukan tafsiran:

- `idx_journal_rules_one_default` — unique index "hanya satu default per kategori",
  konstruksi yang hanya masuk akal untuk sebuah daftar pilihan;
- resolver memfilter `fixedRulesOnSide` lalu mengembalikan `NEEDS_COMPONENT_SELECTION`
  atau `NEEDS_COMPONENT_ALLOCATION` — dua kode error yang lahir semata karena banyak
  baris `fixed_account` pada satu sisi berarti "menu", bukan "beberapa baris jurnal";
- `accounting-cash-flow-bridge.js` menerima `requestedCounterpartRuleId` per request;
- `expenses.accounting_component_rule_id` menyimpan **id baris Setting Akuntansi**
  di dalam tabel Operasional.

### 2.2 Empat mekanisme pilihan yang sudah berjalan

| Pilihan | Dipilih oleh | Opsinya tinggal di | Pilihan dicatat sebagai |
|---|---|---|---|
| Cara bayar | kasir | `payment_methods` | `expenses.payment_method` — **kode**, stabil |
| Komponen beban Operasional | kasir | baris `fixed_account` yang digandakan | `expenses.accounting_component_rule_id` — **id baris config** |
| Akun lawan Arus Kas | kasir | baris `fixed_account` yang digandakan | `requestedCounterpartRuleId` per request, tidak disimpan |
| Jenis Barang | **datanya**, bukan manusia | `item_categories` | diturunkan dari `products.product_kind_id` |

Baris pertama sudah benar bentuknya. Baris kedua dan ketiga adalah usulan Bos Cyo
yang dipaksa masuk ke tabel yang tidak dirancang untuk itu. Baris keempat **bukan
pilihan sama sekali** dan tidak boleh ikut dilebur.

### 2.3 `contracts/accounting-flow-presets-v1.md`

Preset menyatakan dengan tegas *"No new accounting mapping table is created"* dan
menulis langsung ke `journal_rules`. Itu keputusan yang tepat pada waktunya — menahan
lahirnya mapping engine kedua. Tetapi preset hanya pintasan UI: begitu admin menekan
simpan, daftar pilihannya kembali menjadi baris-baris `fixed_account` yang tidak saling
kenal, tidak bisa dipakai ulang di kategori lain, dan tidak punya nama.

Choice Group adalah bentuk tahan lama dari apa yang preset kerjakan sesaat.

## 3. Tiga hal yang saya challenge dari usulan

### 3.1 Nama "Resep" sudah dipakai, dan artinya jauh berbeda

Repo ini punya `manufacturing_recipes` — resep produksi/BOM, dengan
`products.linked_recipe_id` dan `products.recipe_link_enabled`. Tabel `recipes` untuk
akuntansi di sebelahnya adalah jebakan: dua konsep tak berhubungan dengan satu nama,
di satu database.

**Usul:** nama canonical **`accounting_choice_groups`** / `accounting_choice_options` —
memakai istilah Bos Cyo sendiri ("CHOICE GROUP"). Label UI boleh tetap **"Resep"**
kalau itu yang enak dibaca admin; yang tidak boleh bertabrakan adalah nama tabel dan
entitas di kode.

### 3.2 Cara Bayar tidak boleh menjadi resep yang memiliki akunnya sendiri

`sales.payment_method`, `purchases.payment_method`, dan `expenses.payment_method`
menyimpan kode cara bayar sebagai **fakta operasional** — kasir mencatat "dibayar pakai
BCA", dan itu benar terjadi terlepas dari akuntansi.

Kalau daftar cara bayar pindah menjadi baris Setting Akuntansi yang memegang akun,
maka tabel Operasional menunjuk ke konfigurasi Accounting. Itu persis kebocoran yang
baru saja ditutup migration `0038` dan dilarang `ADR-029`.

**Usul:** `payment_methods` **tetap** menjadi satu-satunya registry kosakata cara bayar.
Choice Group "Cara Bayar" boleh ada, tetapi opsinya **mendelegasikan** ke
`payment_methods`, tidak menyalin akunnya. Bos Cyo sendiri sudah menuliskan pintunya:
*"linked ke account/resolver yang berbeda"* — jadi opsi memang punya dua bentuk, dan
`PAYMENT_METHOD` adalah bentuk delegasi.

### 3.3 Jenis Barang tidak boleh dijadikan resep

Dua alasan, dan yang kedua fatal kalau dilanggar:

1. **Tidak dipilih siapa pun.** Akunnya diturunkan dari barang yang benar-benar
   terjual. Kalau ia menjadi resep, resolver kehilangan cara membedakan "menu yang
   menunggu dipilih kasir" dari "pemetaan yang dihitung dari data" — dan
   `NEEDS_COMPONENT_SELECTION` menjadi error yang tidak bisa diselesaikan siapa pun.
2. **Arity-nya berbeda.** Sebuah Choice Group menghasilkan **tepat satu** baris jurnal.
   `item_category_*` menghasilkan **satu baris per item** dalam transaksi. Menyatukan
   keduanya berarti resolver harus menebak berapa baris yang harus terbit, dan tebakan
   yang salah di sini tetap menghasilkan jurnal yang balance.

**Usul:** `item_category_*` tetap `source_type` tersendiri, tidak disentuh.

### 3.4 Satu tambahan yang tidak diminta tapi wajib ada

Choice Group membuat konfigurasi jauh lebih mudah berubah: satu edit pada resep
`CARA BAYAR` merambat ke **setiap** kategori yang memakainya. `ADR-031` sudah mencatat
radius kesalahan Setting Akuntansi adalah "setiap transaksi berikutnya dari jenis itu";
resep melipatgandakannya.

Karena itu setiap baris jurnal wajib **menyimpan jejak** resep dan opsi yang
menghasilkannya, sebagai snapshot. Tanpa itu, mengganti akun sebuah opsi diam-diam
mengubah arti jurnal lama di setiap laporan yang menjoin balik ke konfigurasi — dan
`posted journal immutable` menjadi janji kosong.

## 4. Decision

### 4.1 Domain dan naming canonical

| Entitas | Tabel | Arti |
|---|---|---|
| Choice Group | `accounting_choice_groups` | daftar pilihan bernama dan reusable |
| Choice Option | `accounting_choice_options` | satu pilihan; menunjuk akun **atau** mendelegasi ke cara bayar |
| Journal Rule | `journal_rules` (tetap) | template baris: sisi, urutan, cara akunnya di-resolve |

Label Indonesia di UI: **Resep Akun** dan **Pilihan**. Istilah `recipe` tidak dipakai
di kode maupun schema.

### 4.2 `journal_rules` tetap dipakai — Choice Group masuk sebagai `source_type` baru

Choice Group **bukan** layer di atas `journal_rules`; ia adalah satu nilai baru pada
`source_type`, dengan kolom `choice_group_id`.

```
transaction_categories
  └── journal_rules (side, sort_order, source_type='choice_group', choice_group_id)
        └── accounting_choice_groups
              └── accounting_choice_options
                    └── chart_of_accounts  |  payment_methods
```

Ini persis diagram Bos Cyo. Yang berubah dari usulannya hanya titik pemasangannya:
menggantikan `journal_rules` berarti menulis ulang resolver, POS bridge, cash-flow
bridge, UI Setting Akuntansi, dan 283 tes dalam satu langkah — big-bang rewrite yang
dilarang Constitution C8. Sebagai `source_type` baru, `fixed_account`,
`payment_method`, dan `item_category_*` yang ada terus bekerja tanpa disentuh.

### 4.3 Invariant Choice Group

1. **Satu group menghasilkan tepat satu baris jurnal.** Bukan nol, bukan banyak.
2. **Opsi diidentifikasi oleh `code`, bukan id baris.** Operasional mencatat
   `GROUP:OPTION` (mis. `BEBAN_TETAP:LISTRIK`), bukan UUID konfigurasi. Mengganti label
   atau memindahkan akunnya tidak memutus jejak transaksi lama.
3. **`code` opsi tidak bisa diubah** setelah ia pernah menghasilkan baris jurnal.
4. **Opsi dinonaktifkan, tidak pernah dihapus**, kalau sudah pernah dipakai.
5. **Opsi `PAYMENT_METHOD` tidak boleh memegang akun sendiri** — akunnya milik
   `payment_methods`.
6. **Reversal tidak me-resolve ulang lewat group** (`ADR-031` §4). Reversal menyalin.
7. **Larangan tipe akun `ADR-032` berlaku pada akun opsi**, bukan hanya pada akun rule.
8. **Group yang masih dipakai rule aktif tidak bisa dinonaktifkan.**

### 4.4 Scope: gerai sekarang, entity nanti

`store_id` sekarang, plus kolom `entity_id` nullable sejak hari pertama sesuai
`ADR-030` dan invariant 5 di `CLAUDE.md`. Resep adalah objek berbentuk bagan akun, dan
bagan akun milik Entity, bukan gerai. Membuat tabel ini tanpa `entity_id` berarti
menciptakan utang migrasi di tabel yang justru paling banyak barisnya nanti.

### 4.5 Perlakuan terhadap pemetaan yang sudah ada

| Yang ada | Perlakuan |
|---|---|
| `payment_methods` | **tetap**, tetap satu-satunya registry cara bayar; opsi mendelegasi ke sini |
| `item_categories` | **tetap**, tidak jadi resep (§3.3) |
| `journal_rules` `fixed_account` tunggal | **tetap apa adanya**, tidak dimigrasi |
| `journal_rules` `fixed_account` ganda pada satu sisi | **dimigrasi** menjadi satu group + N opsi, lalu diringkas menjadi satu rule `choice_group` |
| `expenses.accounting_component_rule_id` | dibaca lewat tabel pemetaan legacy selama compatibility window, lalu ditinggalkan |
| `contracts/accounting-flow-presets-v1.md` | preset menulis Choice Group, bukan lagi baris `fixed_account` ganda |

Yang menjaga "tidak ada duplicate source of truth" adalah baris terakhir tabel di atas:
id rule lama **tidak menjadi otoritas kedua**, ia hanya dipetakan ke opsi baru.

## 5. Consequences

- Admin membuat daftar pilihan sekali dan memakainya di banyak kategori. Itu tujuan
  Bos Cyo, dan itu tercapai.
- Dua kode error yang selama ini menutupi kekurangan model — `NEEDS_COMPONENT_SELECTION`
  dan `NEEDS_COMPONENT_ALLOCATION` — berubah makna menjadi jujur: yang pertama berarti
  kasir belum memilih, yang kedua tidak pernah lagi terjadi.
- Operasional berhenti menyimpan id konfigurasi Accounting. `ADR-029` akhirnya utuh.
- Jurnal menyimpan jejak resep yang menghasilkannya, jadi laporan lama tetap terbaca
  setelah resep diubah.
- **Beban tambahan yang nyata:** menambah nilai pada `source_type` berarti membangun
  ulang tabel `journal_rules` (CHECK constraint SQLite tidak bisa dialter). Itu
  migration paling berisiko dalam rencana ini dan harus berdiri sendiri.
- **Radius kesalahan naik.** Satu resep salah kini merusak semua kategori yang
  memakainya. Karena itu cermin `ADR-031` §3 wajib diperluas: layar resep harus
  menunjukkan kategori mana yang memakainya dan berapa jurnal yang sudah dihasilkannya.

## 6. Open — milik Bos Cyo

1. **Nama:** setuju `Choice Group` sebagai nama canonical dengan label UI "Resep"?
2. **Cara Bayar:** setuju opsi cara bayar mendelegasi ke `payment_methods`, bukan
   memegang akun sendiri?
3. **Jenis Barang:** setuju tetap di luar model resep?

Implementasi tidak dimulai sebelum ketiganya dijawab.

## 7. Related

- `ADR-017` — Accounting Work vs Setting Akuntansi Ownership
- `ADR-029` — Operasional melaporkan fakta; Accounting me-resolve jurnal
- `ADR-030` — Entity memiliki buku; tenancy adalah relasi
- `ADR-031` — Setting Akuntansi tetap ada, dan wajib menunjukkan akibatnya
- `ADR-032` — semantik Inventory → Accounting
- `contracts/accounting-choice-groups-v1.md` — kontraknya
- `HANDOFF-choice-groups-implementation.md` — urutan kerja untuk implementer

## DOC-IMPACT

**REQUIRED** — `contracts/accounting-settings-v1.md` menambahkan Choice Group sebagai
registry Setting Akuntansi. `contracts/accounting-flow-presets-v1.md` berubah: preset
menulis Choice Group. `contracts/operational-posting-v1.md` mengganti
`accountingComponentRuleId` dengan selection berbasis kode. `KNOWN_PITFALLS.md`
menambahkan larangan menyimpan id konfigurasi Accounting di tabel Operasional.

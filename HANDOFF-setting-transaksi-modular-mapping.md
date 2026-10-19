# Handoff — Setting Transaksi / SA sebagai modular variable-mapping layer

Tanggal: 2026-08-21
Disusun oleh: Karen berdasarkan keputusan dan brainstorming langsung dengan Bos Cyo.
Repo: `cyo-ramadan/prototype-leker`

> Dokumen ini adalah handoff untuk sesi berikutnya. Ia mencatat arah arsitektur terbaru yang **belum seluruhnya diimplementasikan**. Jangan membaca behavior production sekarang sebagai target final.

## 1. Konteks singkat

Implementasi Setting Transaksi saat ini sudah punya `accounting_choice_groups` / `accounting_choice_options`, resolver Accounting, UI Grup Transaksi, dan pemasangan Choice Group pada Aturan Transaksi.

Namun setelah evaluasi UI dan boundary modular, Bos Cyo mengubah arah desain secara material:

- Setting Transaksi nantinya harus menjadi **modul tersendiri yang bisa dipasang / dicopot dari POS**.
- POS tetap harus berfungsi normal tanpa modul Setting Transaksi.
- Setting Transaksi tidak boleh menciptakan business variable baru secara bebas.
- Business variable harus berasal dari module owner, terutama POS / modul bisnis lain.
- Akun harus berasal dari module Accounting.
- Setting Transaksi berfungsi terutama sebagai **mapping + grouping + composition layer**.

Arah baru ini harus diperlakukan sebagai refactor arsitektur, bukan kosmetik UI.

---

## 2. Keputusan Bos Cyo yang sudah jelas

### 2.1 `Jenis Barang` keluar dari Setting Akuntansi

Bos menilai `Jenis Barang` yang sekarang tampil sebagai bagian Setting Akuntansi tidak perlu dipertahankan sebagai master tersendiri.

Alasan inti:

- data barang / klasifikasi barang seharusnya datang dari module yang memang memiliki barang;
- yang dilakukan SA terhadap barang pada dasarnya adalah mapping;
- SA tidak boleh menciptakan classification paralel tanpa source business yang jelas.

**Arah:** hapus konsep `Jenis Barang` sebagai master buatan SA. Jika suatu rule membutuhkan barang / kategori / product kind, SA harus memilih reference dari source module yang sah.

### 2.2 `Metode Bayar` juga tidak perlu menjadi master khusus SA

Bos menilai metode pembayaran juga seharusnya datang dari POS.

Contoh:

- POS sudah punya `Cash`, `QRIS`, `Bi Ijah`, dll;
- SA tidak perlu membuat ulang master payment method;
- payment variable tersebut dapat dimasukkan sebagai komponen Grup Transaksi;
- pada saat pemasangan rule, payment-related group/variable ditempatkan pada slot/opsi pembayaran yang sesuai.

**Arah:** SA membaca / memetakan payment variable milik POS, bukan membuat payment master sendiri.

### 2.3 SA tidak boleh mengarang business variable

Ini keputusan paling penting.

Jika source module hanya punya:

- `Gaji Yunita`
- `Listrik`
- `Pembayaran Bi Ijah`

maka SA hanya boleh memakai variable tersebut.

SA **tidak boleh** membuat free-form identity seperti `Gaji Mbok Imah` jika source module tidak pernah menyediakan variable itu.

Prinsip:

> SA menyusun reference terhadap data yang dimiliki module lain. SA bukan owner data operasional tersebut.

### 2.4 Account juga harus reference dari Accounting

Jika Accounting menyediakan akun tertentu, SA boleh memilihnya sebagai target mapping.

SA tidak boleh membuat akun baru untuk menutup kekurangan mapping.

Jika Accounting module tidak menyediakan account tersebut, SA harus fail closed / menunjukkan unavailable state sesuai contract yang nanti disepakati.

### 2.5 Grup Transaksi menyusun hasil mapping, bukan menciptakan komponen bebas

Target composer kira-kira:

```text
GRUP: BEBAN 1

Komponen:
- POS / Biaya / Gaji Yunita
  -> Accounting / Beban Gaji
- POS / Biaya / Listrik
  -> Accounting / Beban Listrik
- POS / Pembayaran / Bi Ijah
  -> Accounting / Piutang Bi Ijah
```

Identity komponen harus berasal dari source reference, bukan input nama bebas sebagai identity utama.

Label tampilan boleh dibahas terpisah, tetapi source identity harus stabil.

### 2.6 Setting Transaksi adalah module plug/unplug

Target sistem:

```text
POS CORE
  |
  | exposes variables / business facts
  v
SETTING TRANSAKSI (optional module)
  |
  | mapping/grouping/composition
  v
ACCOUNTING (optional consumer/target)
```

Jika Setting Transaksi dicopot, POS tetap berjalan.

Jika Accounting dicopot, POS dan Setting Transaksi tidak boleh menciptakan fake account / fake Accounting state.

---

## 3. Contoh penting dari Bos: `Pembayaran Bi Ijah`

Anggap POS sudah punya behavior internal khusus:

```text
payment = BI_IJAH
-> POS membuat catatan / behavior internal tertentu
```

Ketika SA memakai variable `BI_IJAH` sebagai komponen, SA tidak boleh mengubah atau menggantikan logic internal POS tersebut.

SA hanya menggunakan reference yang sudah ada untuk grouping / mapping.

Target separation:

```text
POS menjalankan aturan internal Bi Ijah
            |
            | exposes business variable/fact
            v
SA mengenali POS.Payment.BI_IJAH
            |
            | mapping/grouping
            v
Accounting target (jika installed)
```

Tujuan: memasang SA tidak boleh merusak behavior POS yang sudah ada.

---

## 4. Mapping surfaces yang Bos bayangkan

Bos mengusulkan SA memiliki kemampuan mapping seperti:

- Barang/Biaya Mapping
- Pembayaran Mapping
- Akun Mapping (sebagian sudah ada sekarang)

Interpretasi yang perlu dipertahankan:

- source mapping berasal dari module bisnis;
- account mapping berasal dari Accounting;
- group composer hanya memakai hasil/reference mapping tersebut.

### Catatan sparring Karen yang belum menjadi keputusan final

Karen menyarankan engine internal jangan membuat subsystem/table berbeda untuk setiap jenis variable (`payment_mapping`, `cost_mapping`, `product_mapping`, dst.).

Lebih future-proof jika punya generic source identity, misalnya:

```text
sourceModule
sourceType
sourceId
sourceCode
sourceDisplayName
sourceStatus
```

UI tetap boleh menampilkan kategori seperti Biaya / Pembayaran / Barang, tetapi engine memiliki satu contract variable provider.

**Status:** rekomendasi untuk dibahas / divalidasi. Belum keputusan final Bos.

---

## 5. Aturan internal POS vs aturan Setting Transaksi

Bos sebelumnya mengusulkan konsep toggle:

- jika Aturan Transaksi ON -> memakai Aturan Transaksi;
- jika OFF -> mengikuti aturan internal POS.

Contoh Operasional:

```text
POS internal
-> daftar biaya dari Master Biaya
```

Jika SA aktif, grouping/routing dapat memakai configuration SA.

### Catatan sparring Karen yang harus dibahas lagi

Karen menyarankan **business behavior internal POS tetap selalu berjalan** dan toggle hanya menentukan configuration/routing layer yang dipakai oleh integration/accounting interpretation.

Alasannya: bila ON berarti SA mengambil alih business logic POS, modularity akan berubah menjadi hard coupling.

Candidate semantic:

```text
POS internal business rule: selalu berjalan

ruleSource = POS_INTERNAL
atau
ruleSource = SETTING_TRANSACTION
```

Tetapi exact semantics toggle belum disetujui final oleh Bos. **Jangan coding bagian ini sebelum diputuskan.**

---

## 6. Invariant arsitektur yang sangat disarankan

Ini hasil sparring. Sebagian besar konsisten dengan keputusan Bos, tetapi harus diformalisasi di ADR/contract sebelum refactor besar.

### 6.1 No free-form source identity

Komponen harus menyimpan reference stabil, misalnya:

```text
sourceModule + sourceType + sourceId
```

Display name boleh berubah tanpa mengubah identity.

### 6.2 Source module tetap owner

Jika POS rename `Gaji Yunita`, SA ikut membaca nama baru melalui source identity yang sama.

Jika source variable dihapus/nonaktif, SA harus menandainya unavailable, bukan mempertahankan ghost variable aktif.

Historical configuration boleh tetap tersimpan bila diperlukan audit, tetapi tidak boleh diam-diam dianggap runtime-valid.

### 6.3 SA tidak menyimpan operational state

SA tidak menjadi owner:

- saldo;
- harga;
- stock;
- nominal gaji;
- payment settlement state;
- fakta transaksi operasional.

SA menyimpan reference, grouping, rule composition, dan mapping.

### 6.4 Accounting Account adalah target reference

Account bukan business variable buatan SA.

Mapping ideal:

```text
SOURCE VARIABLE
   -> GROUP COMPONENT
   -> ACCOUNT TARGET (jika Accounting tersedia)
```

### 6.5 Jangan hard-code provider hanya POS

Long-term Variable Contract sebaiknya bisa menerima provider lain, misalnya:

- POS
- Inventory
- Payroll/HR
- Purchasing
- CRM
- Online Store
- module future MAXI lainnya

Ini penting agar Setting Transaksi benar-benar module reusable, bukan fitur tersembunyi di POS Leker.

---

## 7. Gap dengan production/current implementation

**Jangan menganggap current code sebagai target final.**

Current implementation masih punya beberapa konsep yang akan ditinjau ulang:

1. `accounting_choice_options` saat ini dapat memiliki nama option yang dibuat dari SA.
2. UI Choice Group saat ini masih mengizinkan composer berdasarkan option lokal, bukan mandatory source reference dari POS/module provider.
3. Setting Akuntansi saat ini masih punya surface/metamodel khusus `payment_methods` dan `item_categories`.
4. `src/accounting-settings.js` masih meng-bootstrap Payment Methods dan Item Categories sebagai bagian current Accounting Settings model.
5. `contracts/accounting-choice-groups-v1.md` dan `ADR-033` merepresentasikan desain Choice Group lama dan perlu dievaluasi terhadap arah modular baru.
6. Existing resolver Choice Group sudah dipakai Accounting. Refactor harus menjaga backward compatibility atau punya migration/compatibility plan. Jangan merusak journal history/provenance.

### UI issue sebelumnya

Bos juga sempat menegaskan Grup Transaksi harus punya satu tombol save untuk seluruh komponen, bukan save per komponen.

Current UI sudah menunjukkan satu `Simpan Grup`, tetapi backend flow masih menulis group lalu option satu-per-satu. Ini belum memenuhi konsep atomic bundle save bila refactor dilanjutkan.

Namun jangan terburu-buru memperbaiki endpoint bundle sebelum model source-variable final ditentukan, karena payload final kemungkinan akan berubah lagi.

---

## 8. Next session — urutan kerja wajib sebelum coding refactor

### STEP 1 — audit source variable POS secara mendalam

Cari semua business variable / master / enum / provider yang saat ini benar-benar dimiliki POS dan modul terkait.

Minimal audit:

- Master Biaya / operational cost;
- payment methods POS;
- product / product kind / category yang relevan;
- customer/supplier jika bisa menjadi rule source;
- warehouse/production variables jika terkait;
- hard-coded internal transaction categories;
- behavior khusus seperti `Pembayaran Bi Ijah` jika ada equivalent nyata di current code/data.

Output audit harus membedakan:

```text
IDENTITY
DISPLAY
OWNER MODULE
SOURCE OF TRUTH
ACTIVE/INACTIVE LIFECYCLE
RUNTIME FACT FIELD
```

Jangan menginventaris variable dari asumsi UI saja. Ikuti code, contract, migration, dan tests.

### STEP 2 — definisikan Variable Provider Contract

Sebelum schema baru, sepakati contract minimal agar module lain bisa expose variable ke Setting Transaksi.

Pertanyaan wajib:

1. Apa canonical identity variable?
2. Bagaimana rename bekerja?
3. Bagaimana delete/nonaktif bekerja?
4. Apakah SA menyimpan snapshot display name untuk history?
5. Bagaimana SA tahu variable boleh dipakai pada slot `payment`, `cost`, `product`, dll.?
6. Apakah variable punya capability/tags daripada type tunggal?
7. Bagaimana versioning provider contract?
8. Bagaimana module uninstall/reinstall memengaruhi mappings?
9. Apakah Account Mapping berada di SA atau adapter Accounting yang meng-extend SA?
10. Bagaimana backward compatibility dengan current `choice_group` resolver?

### STEP 3 — putuskan semantic toggle POS_INTERNAL vs SETTING_TRANSACTION

Jangan implementasikan toggle sebelum menjawab:

- apakah SA hanya mengubah mapping/routing;
- atau benar-benar dapat override composition business transaction;
- bagian mana dari POS internal yang tetap wajib selalu jalan.

Karen merekomendasikan SA **tidak mengambil alih business behavior POS**, tetapi keputusan final milik Bos.

### STEP 4 — baru update architecture docs

Dokumen minimal yang kemungkinan terdampak:

- `adr/ADR-033-accounting-choice-groups.md`
- `contracts/accounting-choice-groups-v1.md`
- `contracts/accounting-settings-v1.md`
- `HANDOFF-choice-groups-implementation.md`
- `MODULE_OWNERSHIP.md` jika ownership surface berubah
- kemungkinan ADR baru bila perubahan ini dianggap architecture direction baru, bukan amend kecil

Jangan rewrite ADR history sebagai seolah desain lama tidak pernah ada. Buat addendum/new ADR sesuai governance repo.

### STEP 5 — baru preflight implementation

Kemungkinan affected code, **belum final sampai audit**:

- `src/accounting-settings.js`
- `public/admin-accounting-settings-comfort.js`
- `public/admin-settings-panels.js`
- POS/business source modules yang hanya perlu expose read contract, bukan menyerahkan ownership
- tests Accounting Settings / Choice Group
- migration hanya jika schema source-reference memang berubah

Existing Accounting resolver/journal provenance harus dijaga.

---

## 9. Non-goals untuk sesi berikutnya

Sampai Variable Contract dan toggle semantic disepakati:

- jangan menghapus tabel production;
- jangan drop `payment_methods` / `item_categories` hanya karena UI target berubah;
- jangan rewrite journal history;
- jangan membuat source variable free-form baru;
- jangan menambah mapping tables per tipe secara impulsif;
- jangan mengubah POS internal business behavior;
- jangan deploy refactor setengah jadi.

---

## 10. Ringkasan satu kalimat

> Target baru: **Setting Transaksi adalah module optional yang membaca variable dari module owner, mengelompokkan/memetakannya tanpa menciptakan fakta baru, lalu menghubungkan reference tersebut ke target seperti Accounting Account; POS dan module sumber tetap menjadi source of truth dan tetap berjalan ketika Setting Transaksi dicopot.**

## DOC-IMPACT

`REQUIRED` untuk implementasi berikutnya karena arah ini mengubah ownership dan semantics dibanding desain Choice Group/Accounting Settings yang sedang deployed.

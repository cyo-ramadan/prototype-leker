# ADR-031 — Setting Akuntansi tetap ada, dan wajib menunjukkan akibatnya

Status: ACCEPTED
Date: 2026-08-19
Change ID: `MAXI-ACC-SETTINGS-DIRECTION-20260819`
Dikerjakan oleh: `hana1.1` — arsitektur, MAXI agent roster

## Context

Bos Cyo menanyakan tiga hal: Setting Akuntansi dan Akuntansi digabung atau tidak, apakah
fungsinya dipahami, dan apakah Setting Akuntansi sebaiknya dibuang saja lalu akun diisi
langsung lewat source code.

Fungsinya memang seperti yang Bos Cyo gambarkan: menyatakan gerai menerima sejumlah cara
bayar, lalu memetakan tiap cara bayar ke akun settlement-nya. Kondisi live `store_001`
hari ini persis itu — `CASH` → `1101`, `BANK` → `1102`, `PAYABLE` → `2101`, dan `NON_CASH`
**belum dipetakan sama sekali**.

Baris terakhir itu bukan cacat, melainkan bukti. Seorang admin bisa memperbaikinya lewat
form dalam hitungan detik. Kalau akun itu ada di dalam source code, memperbaikinya berarti
mengubah kode, menjalankan tes, dan men-deploy Worker — untuk satu akun yang kurang.

## Decision

### 1. Setting Akuntansi tidak dibuang

Memindahkan pemetaan akun ke source code akan:

- **membunuh arah SaaS.** Constitution S2 menetapkan satu codebase melayani banyak
  perusahaan pelanggan, dan tiap pelanggan punya Chart of Accounts sendiri. Hari ini saja
  akun Kas `store_001` adalah `coa_store_001_1101` — id yang berbeda tiap gerai. Meng-hardcode
  berarti setiap gerai baru menjadi perubahan kode, bukan pengisian form;
- **membatalkan USP kedua MAXI.** Mass-customization lewat AI code generation berubah makna
  menjadi "edit source per pelanggan", yang justru kebalikan dari produk SaaS;
- **melanggar batas yang baru saja ditegakkan.** Integration Contract §4 menyatakan aplikasi
  sumber melaporkan penjualan dan tidak pernah mengirim nomor akun Debit/Kredit. Menaruh akun
  di source POS tetap mengirim nomor akun — hanya berpindah dari data ke kode, tempat yang
  lebih sulit dilihat dan tidak bisa diperbaiki admin;
- **mengulang utang yang baru dibayar.** `expenses.accounting_component_rule_id` adalah kasus
  satu-satunya di mana interpretasi Accounting bocor ke Operasional, dan mencabutnya butuh
  migration `0038` plus `ADR-029`. Hardcode adalah bentuk kebocoran yang sama, lebih dalam.

Setting Akuntansi bukan beban tambahan. Justru itulah yang membuat satu program melayani
banyak bagan akun.

### 2. Batas kepemilikan tetap, tidak digabung

`ADR-017` tetap berlaku. **Akuntansi** memiliki akun, kode akun, jurnal, buku besar, laporan,
closing, koreksi. **Setting Akuntansi** hanya memiliki pemetaan: cara bayar → akun, Jenis
Barang → Persediaan/HPP/Penjualan, Jenis Transaksi → ordered Debit/Credit rules.

Keduanya berbeda dalam tiga hal yang menentukan:

| | Akuntansi | Setting Akuntansi |
|---|---|---|
| Yang dimiliki | interpretasi — jurnal | perkabelan — pemetaan |
| Frekuensi berubah | jarang | tiap kali cara bayar/Jenis Barang bertambah |
| Radius kesalahan | satu entri salah | **setiap transaksi berikutnya** dari jenis itu salah |

Radius kesalahan yang berbeda menuntut penjagaan yang berbeda. Menggabungkannya menyamakan
keduanya, dan `ADR-017` lahir justru karena penggabungan seperti itu pernah terjadi dan
menyulitkan.

### 3. Tetapi keduanya berhenti tampil sebagai dua menu yang tidak saling bicara

Yang Bos Cyo rasakan sebagai masalah bukan pemisahannya, melainkan **tidak adanya umpan balik
antar keduanya**. Bukti dari audit 2026-08-18 dan 2026-08-19:

- Setting Akuntansi menampilkan `Lengkap` untuk Penjualan sementara tidak satu pun penjualan
  bisa terbit — status dihitung dari bentuk rule saja (diperbaiki);
- delapan penjualan gagal berhari-hari tanpa ada yang tahu, karena backlog tidak terlihat
  (diperbaiki);
- **enam Jenis Transaksi ada di Setting Akuntansi tanpa satu pun modul yang memposting
  melaluinya**, dan tiga di antaranya — `wh_opname`, `wh_production`, `wh_transfer` — sudah
  punya rule aktif yang dikonfigurasi admin. Admin melihat `Lengkap`, wajar menyimpulkan Stock
  Opname menghasilkan jurnal, dan jurnal itu tidak pernah terbit (task `T-0818-06`).

Ketiganya bukan bukti pemisahan itu salah. Ketiganya adalah pemisahan **tanpa cermin**.

Karena itu setiap pemetaan di Setting Akuntansi wajib bisa menjawab dua pertanyaan, di tempat
pemetaan itu diisi:

1. **apa yang terbit karena ini** — modul mana yang memposting melalui Jenis Transaksi ini,
   atau pernyataan jujur bahwa belum ada;
2. **sudah pernah terbit atau belum** — jumlah jurnal yang benar-benar dihasilkan pemetaan ini,
   dan jumlah fakta yang menunggu.

`Lengkap` hanya boleh berarti "fakta jenis ini akan menghasilkan jurnal". Selama sebuah Jenis
Transaksi tidak punya modul yang mengkonsumsinya, statusnya adalah *belum tersambung*, bukan
*Lengkap*.

## Consequences

- Gerai dan tenant baru tetap bisa onboarding lewat konfigurasi, tanpa deploy.
- Batas Constitution R5 tetap utuh: POS mengirim fakta, Accounting menginterpretasi.
- Admin berhenti menerima janji yang tidak ditepati sistem.
- Beban tambahan: setiap lane posting baru wajib mendaftarkan dirinya sebagai konsumen Jenis
  Transaksi, supaya cermin di poin 3 tetap jujur. Itu memang biayanya, dan lebih murah
  daripada menemukan angka salah setelah dipakai mengambil keputusan.

## Open — milik Bos Cyo

1. **`wh_opname`, `wh_production`, `wh_transfer`** sudah dikonfigurasi tetapi belum punya lane.
   Membuat lane-nya berarti memutuskan semantik Inventory → Accounting: apakah selisih stok
   opname diakui sebagai kerugian periode berjalan, dan apakah produksi memindahkan nilai dari
   Persediaan Bahan ke Persediaan Barang Jadi. Itu kebijakan akuntansi (Constitution R2).
2. **`deposit` dan `payroll`** belum dikonfigurasi di gerai mana pun — diputuskan, atau dicatat
   sengaja ditutup seperti `wh_return`.
3. **Perpetual vs periodic** tetap terbuka dan tidak diubah oleh ADR ini.

## Related

- `ADR-017` — Accounting Work vs Setting Akuntansi Ownership
- `ADR-029` — Operasional reports facts; Accounting resolves journals
- `ADR-030` — Entity owns the books; tenancy is a resolved relation
- `ACCOUNTING_POSTING_COVERAGE_AUDIT_20260818.md`

## DOC-IMPACT

**REQUIRED** — `contracts/accounting-settings-v1.md` menambahkan kewajiban cermin konsumen.
`KNOWN_PITFALLS.md` menambahkan bahwa status `Lengkap` tanpa konsumen adalah janji palsu.

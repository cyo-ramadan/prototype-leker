# ADR-032 — Semantik Inventory → Accounting untuk Opname, Produksi, dan Transfer

Status: ACCEPTED
Date: 2026-08-19
Change ID: `MAXI-WH-ACCOUNTING-SEMANTICS-20260819`
Dikerjakan oleh: `hana1.1` — arsitektur, atas keputusan Bos Cyo

## Context

`ADR-031` menyisakan tiga Jenis Transaksi yang sudah dikonfigurasi di Setting Akuntansi
tetapi belum punya modul yang memposting: `wh_opname`, `wh_production`, `wh_transfer`.
Membuat lane-nya menuntut keputusan kebijakan akuntansi, yang menurut Constitution R2 bukan
milik agen. Bos Cyo memberi keputusan itu pada 2026-08-19.

`KNOWN_PITFALLS.md` mencatat `4201 Pendapatan Koreksi Stok` dan `6103 Beban Susut Persediaan`
berstatus `review_required` sampai pemilik bisnis menyetujui penggunaannya. Keputusan ini
adalah persetujuan tersebut.

## Decision

### 1. `wh_opname` — selisih stok menyentuh laba rugi

Selisih hasil opname mengubah kekayaan, jadi memang masuk Rugi Laba.

| Arah | Jurnal |
|---|---|
| **Lebih** — stok fisik > catatan | Debit `Persediaan` · Kredit `Pendapatan Selisih Persediaan` |
| **Kurang** — stok fisik < catatan | Debit `Beban Selisih Persediaan` · Kredit `Persediaan` |

**Penamaan yang disarankan.** Bos Cyo menyebut "penambahan barang tak wajar" dan "biaya
kehilangan barang"; keduanya tepat maksudnya, dan istilah bakunya:

- **`4201 Pendapatan Selisih Persediaan`** — sub dari Pendapatan Lain-lain. Lebih tepat
  daripada "Koreksi Stok" karena yang dicatat adalah *selisih*, bukan tindakan koreksinya.
- **`6103 Beban Selisih Persediaan`** — disarankan menggantikan label "Beban Susut
  Persediaan". *Susut* secara spesifik berarti menyusut sendiri (menguap, layu, busuk),
  sedangkan selisih opname juga mencakup salah hitung, salah catat, dan kehilangan. Memakai
  "susut" menyempitkan makna dan menyesatkan saat direview.

Kode akun `4201` dan `6103` **tetap** — yang berubah hanya label, dan itu pun opsional.
Mengubah kode akun yang sudah dipakai berarti memutus jejak jurnal lama.

**Guard yang tetap berlaku:** satu opname hanya mengeksekusi **satu** arah. `KNOWN_PITFALLS`
sudah melarang menjalankan keempat baris rule sekaligus, dan larangan itu tidak dicabut.

### 2. `wh_production` — tidak menyentuh laba rugi sama sekali

Produksi memindahkan nilai antar sub-akun Persediaan sesuai jenis bahan. Tidak ada kekayaan
bertambah atau berkurang.

```
Debit  Persediaan <jenis tujuan>
Kredit Persediaan <jenis asal>
```

Kedua kaki adalah akun **Aset**. Rule `wh_production` **dilarang** memakai akun bertipe
`REVENUE` atau `EXPENSE`. Bila jumlah Debit dan Kredit tidak sama, itu berarti ada nilai yang
hilang atau tercipta dalam proses produksi — dan itu harus gagal-tertutup, bukan ditambal ke
akun selisih.

### 3. `wh_transfer` — perpindahan antar akun, bukan pendapatan atau beban

Transfer berpindah di wilayah kas, piutang, dan hutang.

```
Debit  <akun tujuan>    (ASSET atau LIABILITY)
Kredit <akun asal>      (ASSET atau LIABILITY)
```

Rule `wh_transfer` **dilarang** memakai akun bertipe `REVENUE` atau `EXPENSE`. Larangan ini
bukan anjuran: memindahkan uang antar rekening yang tercatat sebagai pendapatan akan
menggelembungkan omzet tanpa satu pun transaksi penjualan terjadi, dan tidak ada tes yang
akan gagal karenanya — jurnalnya tetap balance.

### 4. Ketiganya tetap lewat Setting Akuntansi

Sesuai `ADR-031` §4, ketiganya adalah fakta yang lahir di luar Accounting, jadi akunnya
di-resolve lewat pemetaan, bukan ditulis di kode. Yang berubah dengan ADR ini hanyalah bahwa
sekarang ada modul yang **mengkonsumsinya** — status `Lengkap` untuk ketiganya berhenti
menjadi janji palsu.

## Consequences

- `4201` dan `6103` keluar dari status `review_required`.
- Neraca akhirnya mencerminkan hasil opname; sebelumnya selisih fisik tidak pernah sampai ke
  buku sama sekali.
- Produksi dan transfer tidak akan pernah menggeser Rugi Laba, dan itu ditegakkan oleh
  larangan tipe akun, bukan oleh kehati-hatian.
- Beban tambahan: tiap rule `wh_production` dan `wh_transfer` wajib divalidasi tipe akunnya
  saat disimpan, bukan saat memposting. Menolak di titik konfigurasi jauh lebih murah
  daripada menemukan omzet yang menggelembung setelah dipakai mengambil keputusan.

## Open — masih milik Bos Cyo

- **`deposit`** dan **`payroll`** belum diputuskan.
- **Perpetual vs periodic** tidak diubah oleh ADR ini.

## Related

- `ADR-031` — Setting Akuntansi tetap ada, dan wajib menunjukkan akibatnya
- `ADR-020` — audited stock adjustment dan stale snapshot guard
- `KNOWN_PITFALLS.md` — "Stock Opname tidak boleh menjalankan semua default rules"

## DOC-IMPACT

**REQUIRED** — `KNOWN_PITFALLS.md` mencatat larangan tipe akun untuk `wh_production` dan
`wh_transfer`. `contracts/accounting-settings-v1.md` mencatat validasi tipe akun saat rule
disimpan.

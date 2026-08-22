# Cashier Transaction Composition v1

Status: ACTIVE for Prototype Leker cashier transaction UI
Contract: `MAXI_CASHIER_TRANSACTION_COMPOSITION_V1`

## Purpose

Kontrak ini mengatur susunan field pada modal transaksi kasir. Kontrak ini terpisah dari PIMASATU. PIMASATU hanya boleh dipakai sebagai salah satu komponen UI untuk input item/variabel.

## Canonical Visual Order

Untuk transaksi yang memiliki item/variabel, counterpart, dan settlement, urutan dari atas ke bawah adalah:

1. item/variabel composer;
2. counterpart yang relevan, misalnya customer, supplier, atau contact;
3. metode pembayaran;
4. field transaksi tambahan, summary/total, dan action simpan/proses.

Komponen item/variabel boleh memakai PIMASATU, tetapi counterpart dan metode pembayaran tetap berada di luar komponen PIMASATU.

## Transaction-Specific Composition

### Penjualan

- item Penjualan;
- customer/customer identity bila relevan;
- metode pembayaran;
- catatan dan total;
- proses Penjualan.

### Beli Bahan

- item Bahan;
- supplier;
- metode pembayaran;
- deskripsi/catatan dan total;
- simpan Pembelian.

### Pengeluaran Operasional

- item/variabel Biaya;
- contact context bila tersedia dari Master Biaya;
- metode pembayaran;
- total;
- simpan Operasional.

## Accounting Boundary

Metode pembayaran dibaca dari snapshot workspace registry POS Core dan direfresh sebelum modal transaksi yang membutuhkan settlement digunakan. Snapshot ini tidak membawa Account ID atau readiness Setting Transaksi.

Cashier UI tidak memilih account ID, Debit, atau Credit. SALE, PURCHASE, dan EXPENSE dikirim ke endpoint transaksi POS. Setelah business fact berhasil committed, server-side Accounting bridge menyelesaikan mapping dari Setting Akuntansi dan meneruskan command ke canonical Accounting posting boundary.

Kegagalan delivery Accounting setelah commit tidak boleh membuat cashier mengirim ulang business fact yang sama sebagai transaksi baru.

## Persistence Boundary

PIMASATU tidak menyimpan transaksi. Domain transaction handler membentuk payload dan endpoint kasir memvalidasi serta menyimpan business fact.

## DOC-IMPACT

REQUIRED — perubahan urutan field transaksi kasir, counterpart/payment ownership, atau hubungan cashier transaction UI dengan Setting Akuntansi/Accounting bridge harus memperbarui kontrak ini.

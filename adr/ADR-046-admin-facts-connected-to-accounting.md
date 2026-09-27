# ADR-046 — Fakta fitur admin tersambung ke Akuntansi sejak transaksi baru

Status: ACCEPTED (Bos Cyo, 2026-09-27)

## Context

Sejak 2026-09-17 (`src/net-profit-report.js`: "desainnya sampai detik ini harus bisa dulu
tanpa akuntansi") fitur-fitur admin dibangun sebagai pulau Operasional: Bea Operasional,
Pembayaran Hutang/Piutang, Pembayaran Lainnya, gaji presensi (`payroll_ledger_entries`),
dan Uang Muka/Deposit. Laporannya (Net Profit, Beban, Hutang Piutang) dihitung sendiri dan
tidak pernah menyentuh jurnal Akuntansi. Transaksi kasir (jual/beli/pengeluaran/arus kas)
dan produksi sudah otomatis dijurnal sejak lama (per 2026-09-27: 1.251 delivery POSTED, 81
nyangkut NEEDS_CONFIGURATION).

Bos Cyo, 2026-09-27: "dari awal uda konek akuntansi ... tapi kita buat agar orang awam pun ga
perlu setting2 akuntansi, kita uda tentuin setiap transaksi bikin jurnal ini dan itu ...
untuk data2 baru aja gpp sih, data lama biarin tanpa akuntansi."

## Decision

1. **Lane posting baru `src/accounting-admin-bridge.js`** (producer `ADMIN` di
   `accounting_bridge_deliveries`), pola sama dengan `accounting-cash-flow-bridge.js`:
   post-commit, membaca Setting Akuntansi, gagal-lembut, idempotent
   (`LEKER_ADMIN:<fact>:<id>`). Dipasang di `src/index.js` sebagai pembungkus respons —
   handler Operasional tidak mengimpor Akuntansi (invariant #4).
2. **Jurnal bawaan** (migration 0123), bisa diubah admin di Setting Akuntansi:

   | Fakta | Debit | Kredit |
   |---|---|---|
   | Bea Gaji / gaji presensi (`admin_gaji`) | 6102 Beban Gaji | 2102 Utang Gaji |
   | Bea Lapak jadi hutang (`admin_bea_lapak`) | Beban Sewa Lapak | Utang Lapak (akun admin "Hutang Sewa Lapak" kalau ada, else 2101) |
   | Bea Lainnya jadi hutang (`admin_bea_lainnya`) | 6104 Beban Lainnya | 2103 Utang Lain-lain |
   | Pembayaran Lainnya (Bea dibayar langsung) | Beban kategorinya | akun cara bayar |
   | Pelunasan hutang | akun Utang tempat hutang itu dulu dikredit | akun cara bayar |
   | Uang Muka dibuat (`admin_uang_muka`) | Uang Muka (akun admin "Beban Dibayar Dimuka" kalau ada, else 1401) | akun cara bayar |
   | Pembelian kasir dari Deposit | Persediaan (aturan `purchase_material`) | Uang Muka |

   Akun cara bayar: Tunai/Bank = akun cara bayar POS `CASH`/`BANK`; Rekening Bersama = 1103;
   Deposit = akun Uang Muka. Nominal minus (potongan Bea Gaji) = sisi ditukar.
3. **Pembatalan = jurnal pembalik** persis (`reversal_of_journal_id`), bukan edit
   (invariant #2). Fakta yang tidak pernah dijurnal tidak dibalik.
4. **Tanpa backfill.** Fakta sebelum migration 0123 tetap di luar Akuntansi. Konsekuensi:
   melunasi hutang yang lahir sebelum 0123 mengurangi akun Utang yang tidak pernah dikredit
   (saldo minus — invariant #8, bukan bug). Per 2026-09-27 produksi belum punya satu pun Bea,
   pembayaran, hutang, atau deposit, dan baru 1 baris gaji presensi — praktis tidak kena.
5. **Penyebab transaksi kasir nyangkut dibereskan untuk transaksi baru:** "Non Tunai
   (Legacy)" default ke 1102 Bank; barang tanpa Jenis Barang otomatis dapat Jenis Barang
   sesuai Tipe Barang (migration + trigger + `defaultProductKindForItemType`). Delivery lama
   yang sudah nyangkut tidak diposting otomatis.
6. **Uang Muka mencatat dibayar dari mana** (`operational_receivables_payables.funding_method`);
   dari Rekening Bersama = baris OUT sungguhan di ledger Rekening Bersama.
7. **Pembelian dari Deposit disimpan dengan cara bayar `DEPOSIT`**, bukan `CASH` — laporan laci
   tidak lagi menganggap uang laci keluar.

## Consequences

- Gerai mode `LITE`/`FLEXIBLE` dilewati tanpa delivery.
- Laporan Net Profit/Beban/Hutang Piutang tetap mesin sendiri (belum membaca jurnal);
  menyatukan keduanya adalah langkah terpisah.
- Akun per-orang buatan admin ("Hutang Gaji <nama>") tidak dipakai otomatis; rincian per orang
  ada di Laporan Hutang Piutang.
- Rekening Bersama (ADR-045, dulu sengaja di luar Akuntansi) kini punya cerminan satu akun
  1103 per gerai untuk pembayaran admin. Penjualan/pembelian kasir lewat cara bayar yang
  ditautkan ke Rekening Bersama tetap memakai akun cara bayar POS-nya sendiri.

## Related

`ADR-031` (konsumen posting), `ADR-034`, `ADR-045`, `KNOWN_PITFALLS.md` ("Status `Lengkap`
tanpa konsumen", "Operasional tidak boleh memiliki foreign key ke interpretasi Accounting").

## DOC-IMPACT

Perbarui kalau: jenis fakta admin baru ditambahkan, akun bawaan berubah, backfill data lama
diputuskan, atau laporan Net Profit dipindah membaca jurnal.

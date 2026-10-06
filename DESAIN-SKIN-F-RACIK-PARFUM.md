# Skin F · Racik Parfum — layar Racik untuk toko parfum racikan

Ditulis: 2026-10-06 · Oleh: Hana · Permintaan Bos Cyo: *"ini ada customer jualannya parfum, buatin skin
kusus untuk dia ya ... setiap penjualannya itu resepnya selalu ga sama ... transaksi di skin ini engga
membuat model transaksi baru, tapi dari model yang udah lama disesuaikan aja dengan ux tersebut."*

Keputusan Bos Cyo (2026-10-06): harga jual **boleh diubah kasir, tercatat**; draft disimpan **di HP/tablet
itu**; **racikan terakhir per pelanggan** dibuat sekarang; tenant **baru** (nama usaha belum disebut →
sementara "Toko Parfum", gerai `PARFUM01`, akun pemilik `parfum_pemilik`, migration 0140).

## Alur (satu layar, empat langkah)

1. **Pesanan** — nama pelanggan (saran dari pelanggan yang pernah diracik di HP ini) + pilih aroma.
   Kalau pelanggan ini pernah meracik aroma yang sama: pilih **Racikan terakhir** atau **Resep standar**.
2. **Racik** — daftar bahan dengan takaran −/+ (bisa diketik), tambah/buang bahan. Botol kaca terisi
   lapisan warna tiap bahan; garis putus-putus = isi standar; "48 / 50 ml · Kurang 2 ml". Bahan bersatuan
   lain (botol kemasan, pcs) tetap ditakar tapi tidak dihitung sebagai isi. Peringatan bila takaran
   melebihi stok di catatan (tetap boleh — stok minus bukan bug).
3. **Bayar** — harga daftar sudah terisi, bisa diubah ("Harga daftar Rp120.000 → dijual Rp110.000.
   Perubahan ini tercatat"). Cara bayar, uang diterima, kembalian.
4. **Nota** — siap cetak (kertas thermal 58 mm), takaran bisa dicantumkan/disembunyikan. Nota terakhir
   bisa dicetak ulang dari beranda.

**Tombol "← Simpan draft" dan tombol Back HP** = racikan masuk daftar **Racikan belum selesai**, tidak
hilang. Dari daftar itu racikan dilanjutkan ke tahap terakhirnya.

## Tanpa model transaksi baru

"Selesai" memanggil dua jalur kasir yang sudah ada, berurutan:

| Langkah | Jalur | Yang terjadi |
|---|---|---|
| 1 | `POST /api/cashier/production` | 1 botol diproduksi dengan takaran hasil edit (resep hanya template, `template_modified`). Bahan terpotong sesuai takaran; modal botol = takaran aktual. |
| 2 | `POST /api/cashier/sales` | Botol itu dijual dengan `productionMode: 'STOCK'` (bahan tidak terpotong dua kali), `unitPrice` = harga jual, keterangan berisi takaran. |

Kalau langkah 1 berhasil tapi langkah 2 gagal (mis. internet putus), draft disimpan dengan tahap
**"Sudah diracik · belum dibayar"**: melanjutkan hanya mengulang pembayaran, takaran terkunci. Menghapus draft
di tahap ini tidak membatalkan racikan — botolnya ada di stok dan bisa dijual lewat Kasir lengkap.

## Satu-satunya aturan server yang berubah

`cashier.store.priceOverrideAllowed` (dari `isRacikChoice`, `src/tenant-policy.js`). Hanya untuk tenant
skin F, `unitPrice` dari kasir dipakai; tenant lain tetap harga katalog (nilai dari klien diabaikan).
Perubahan dicatat di keterangan penjualan dan catatan baris pesanan: *"Harga daftar … → dijual …"*.
Harga harus rupiah bulat 0–100 juta.

Daftar bahan untuk layar Racik ikut membawa **sisa stok** (bukan modal — modal tidak ditampilkan ke
karyawan).

## Yang disiapkan pemilik di Workspace Gerai

- Bahan (Jenis "Bahan"): bibit per aroma, alkohol, fixative, botol — satuan ml/pcs, dengan harga beli.
- Aroma (Jenis "Barang Jadi"): satu barang per aroma **per ukuran** ("Bubble Gum 50 ml"), harga daftar,
  dan **resep standar ACTIVE** (takaran bulat). Aroma tanpa resep tidak muncul di layar Racik.
- Akun kasir. Absen & buka laci tetap lewat Kasir lengkap (skin F bukan Jaga Sendiri).

## Batas

- Draft & racikan terakhir hanya di HP/tablet yang dipakai; ganti perangkat = tidak terbawa.
- Takaran harus bilangan bulat (aturan produksi). Untuk setengah ml: pakai satuan lebih kecil.
- Satu racikan = satu aroma (satu botol). Pembeli beli dua botol = dua racikan.

## Mencoba di lokal

```sh
npx wrangler dev --local --port 8787
node scripts/demo-toko-parfum-lokal.mjs   # bahan, aroma, resep, kasir fiktif "Nadia", laci terbuka
# buka /s/PARFUM01/racik dengan localStorage lekerCashierToken = demo-racik-lokal
```

<!-- DOC-IMPACT: 2026-10-06 dokumen baru; skin F Racik Parfum: alur, jalur API, aturan ubah harga, persiapan pemilik, batas. -->

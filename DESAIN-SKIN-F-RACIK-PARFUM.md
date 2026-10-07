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

## Yang disiapkan pemilik: tab "Bahan & Aroma" (Workspace Gerai → Barang)

Bos Cyo, 2026-10-06: *"entry2 barangnya jangan dibuat ribet, sedikitin yang wajib, yang opsi kasi default
langsung aja tanpa ngisi"*. Satu layar (`public/racik-admin.js`, hanya skin F) menggantikan tiga langkah
lama (Data Barang → Peran & Satuan → Resep):

| Isian | Wajib | Default bila tidak diisi |
|---|---|---|
| Bahan: nama | ya | — |
| Bahan: satuan | tidak | ml (pilihan ml / gram / pcs) |
| Bahan: harga beli per satuan | tidak | 0 (modal sebenarnya terisi saat belanja dicatat) |
| Aroma: nama & ukuran | ya | — |
| Aroma: harga jual | ya | — |
| Aroma: resep standar (bahan + takaran) | ya, min. 1 bahan | — |
| Kategori, peran barang, satuan aroma, qty hasil | — | "Bahan"/"Parfum", Bahan/Barang Jadi, pcs, 1 botol |

"Ubah resep" membuat revisi resep baru (resep lama diarsipkan, riwayat produksi tetap). Nama & harga aroma
diubah di Daftar Barang. Endpoint yang dipakai sama dengan tab aslinya (`POST /api/admin/products`,
`PATCH /api/admin/manufacturing/products/:id`, `POST /api/admin/manufacturing/recipes`).
Akun kasir dibuat seperti biasa. Absen & buka laci tetap lewat Kasir lengkap (skin F bukan Jaga Sendiri).

**Una** tetap ada untuk pemilik di Panel Pemilik dan Workspace Gerai (dicoba lokal 2026-10-06).

## Pemilik, Admin, dan kasir disamakan (2026-10-06)

Bos Cyo: *"di skin itu admin/owner/kasir untuk saat ini samakan, boleh langsung jual dan buka laci. di
entity kasih tombol jual barang dan beli bahan juga operasionalnya"*.

- **Tanpa absen.** Tenant skin F tidak menunggu presensi untuk buka laci atau mengajukan tutup laci
  (`isAttendanceOptionalChoice`, flag `cashier.store.attendanceOptional`). Laci dibuka langsung di layar
  Racik (uang awal = sisa penutupan terakhir). Pengajuan (hapus transaksi dsb.) tetap menunggu keputusan --
  ini beda dari skin E yang juga menyetujui otomatis.
- **Tombol kerja di Panel Pemilik dan Workspace Gerai:** per gerai **Jual** (layar Racik), **Beli bahan**,
  **Biaya operasional** (Kasir lengkap, dialognya terbuka otomatis).
- **Tanpa model transaksi kedua.** Pemilik/Admin tidak menulis lewat token manajemen. Tombol itu memanggil
  `POST /api/management/racik/kasir-pemilik?store=`, yang membuat (sekali) akun kasir *"Nama (Pemilik)"*
  milik orang itu di gerai itu dan memberi sesi kasir 12 jam. Semua transaksi tercatat atas nama orangnya
  dengan aturan kasir yang sama (laci satu pemegang, stok, HPP, Accounting). Password akun ini acak dan tidak
  pernah dibagikan; token agen ditolak; hanya tenant skin F. "Selesai jualan" kembali ke panel asal.
- Batas: kalau laci sedang dipegang kasir lain, Pemilik tetap harus menunggu laci itu ditutup (satu laci
  satu penanggung jawab).

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

<!-- DOC-IMPACT: 2026-10-06 dokumen baru; 2026-10-06 pemilik/admin/kasir disamakan (tanpa absen, tombol Jual/Beli bahan/Biaya di panel); 2026-10-06 tab Bahan & Aroma (isian wajib minimal, default otomatis); skin F Racik Parfum: alur, jalur API, aturan ubah harga, persiapan pemilik, batas. -->

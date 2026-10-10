# ADR-055 — Tenant Percetakan: order WA jadi antrian cetak yang tidak bisa dipalsukan

Status: ACCEPTED — Tahap 1 (fondasi + otomatisasi task + agen cetak) sudah ditulis di branch
`eskor/tenant-percetakan`, belum di-merge ke `main`. Tahap berikutnya ada di `HANDOFF-PERCETAKAN.md`.
Tanggal: 2026-10-10
Diminta oleh: Bos Cyo
Ditulis oleh: Eskor (Claude Code di laptop Bos Cyo)

## Konteks

Bos Cyo, 2026-10-10:

> "bikin apk seperti cekat ai. kebutuhannya untuk otomatisasi kerjaan di percetakan. customer
> pesan2 dari wa dan kirim filenya, terus waktu eksekusi pesan itu tadi langsung berubah jadi task
> dengan detil rinciannya, dan sudah terotomatisasi harus print dimana, antrian nomor berapa dsb.
> ini juga diperlukan untuk tracking agar orderan itu tidak dipalsukan oleh karyawan, ada data2
> histori orderan customer. biarpun owner tinggal tetap jalan jujur. ini juga masuk dengan moto
> ownertenang yang kita bangun."

Lanjutannya: "ok bikin tenant baru kusus itu ya ... untuk wa carikan dulu yang gratisan buat
testing, nanti kalo uda berhasil ya kita beli yang berbayarnya." Plus: jangan pakai OpenRouter.

Kecurangan yang paling umum di percetakan: order diterima karyawan lewat WA pribadi / lisan,
dicetak pakai mesin dan bahan toko, uangnya masuk kantong, dan tidak pernah tercatat. Atau order
tercatat, lalu harga/jumlahnya diturunkan diam-diam setelah dibayar penuh pelanggan.

## Keputusan

### D1 — Tenant baru di platform yang sama, bukan aplikasi baru

Pola persis Ikan-galeh (migration 0050): tenant `TEN-CETAK`, entity `ENT-CETAK`, gerai `CETAK01`
(`edition='LITE'`, tanpa Warehouse), dan modul `PERCETAKAN` (VERTICAL) dipasang lewat registry
`platform_modules` / `tenant_module_installations` (ADR-040, migration 0080). Semua route modul
menolak gerai yang tenant-nya tidak memasang modul ini.

Alasannya: login karyawan/Owner/Admin, isolasi `store_id`, penyimpanan R2, mesin AI Una, sistem
skin, dan pelanggan sudah ada. Aplikasi terpisah berarti menulis ulang semuanya dan menjual dua
produk dengan satu janji OwnerTenang.

Tabel modul diberi prefiks `print_*` dan `wa_*` (migration 0145).

### D2 — Una hanya mengusulkan; harga selalu dari master gerai

*(Revisi 2026-10-10: lapisan pertama sekarang pembaca aturan tanpa AI, lihat D7. Una tetap dipakai
untuk chat yang tidak terbaca aturan, lewat tombol, dan hasilnya tetap draft.)*

Mengikuti ADR-044 D1. Alur: pesan masuk → karyawan menekan "Baca dengan Una" (atau "Isi manual")
→ **draft** → karyawan memeriksa dan menekan Konfirmasi → baru jadi order.

- Model hanya mengenali produk (dari kode di daftar produk gerai), jumlah, ukuran, file mana, nama,
  tenggat. Model **tidak pernah** menyebut harga. Kode produk asing, angka kosong, atau file yang
  tidak jelas menjadi **pertanyaan**, tidak ditebak (`src/percetakan-una.js`, `saringUsulan`).
- Harga dibaca server dari `print_products` dan **dibekukan** di `print_order_items` saat order
  dibuat. Harga yang dikirim klien diabaikan (diuji).
- Mesin AI: lapisan yang sama dengan Una (`src/caca-ai-client.js`, Gemini bawaan). Bukan OpenRouter.
- AI tidak jalan di webhook. Nomor siapa saja bisa mengirim pesan; biaya AI baru keluar saat
  karyawan memintanya.

### D3 — WhatsApp: jalur resmi Meta sejak uji coba; simulator untuk mencoba alur

Pilihan "gratis untuk testing" yang dipilih adalah **WhatsApp Cloud API resmi**, bukan gateway
tidak resmi (Fonnte, Baileys, whatsapp-web.js), karena:

- Pesan masuk dari pelanggan tidak ditagih, dan Meta memberi nomor uji gratis. **Koreksi
  2026-10-10:** mulai 1 Oktober 2026 balasan dalam jendela 24 jam (service message) hanya gratis
  1.000 pesan per nomor per bulan, sesudahnya ditagih per pesan (lihat "Biaya WA" di
  `HANDOFF-PERCETAKAN.md`). Template utility di dalam jendela juga mulai ditagih. Akun Meta
  wajib punya metode pembayaran sejak 30 September 2026, atau pesan service tidak terkirim.
- Termurah untuk dipakai sungguhan = **langsung ke Meta Cloud API** (yang dibangun di sini),
  tanpa BSP (Qontak, Wati, dsb). BSP menarik biaya platform bulanan (ratusan ribu rupiah) di
  atas tarif Meta yang sama.
- Kode yang dipakai untuk uji = kode produksi. "Beli yang berbayar" nanti cuma mengaktifkan
  penagihan / verifikasi bisnis di akun Meta, tanpa menulis ulang integrasi.
- Gateway tidak resmi melanggar ToS WhatsApp dan nomornya bisa diblokir permanen (alasan lengkap
  di ADR-044 D2). Kode yang dibuat untuk itu juga harus dibuang saat pindah ke jalur resmi.

Berbeda dari Caca/Una di ADR-044 (satu nomor bersama untuk staf), di percetakan **pelanggan**
yang mengirim pesan ke **nomor WA gerai itu sendiri**. Jadi tiap gerai mendaftarkan nomornya
(`wa_channels`, kunci `phone_number_id` dari Meta), dan gerai ditentukan dari nomor tujuan,
tidak pernah dari isi pesan (invariant #5).

Webhook (`/api/percetakan/wa/webhook`) memverifikasi tanda tangan `X-Hub-Signature-256`
(HMAC app secret). Tanpa secret, webhook menolak (503). Secret lewat `wrangler secret put`,
tidak pernah di repo (invariant #9).

**Simulator** (`SIMULATOR`) dipakai untuk mencoba alur tanpa WA sama sekali. Pagar: hanya Owner/
Admin, pesannya ditandai SIMULASI selamanya, dan simulator **mati otomatis** begitu gerai punya
saluran `META_CLOUD` aktif. Tanpa pagar ini simulator menjadi jalan karyawan mengarang pesan.

**Revisi D3, 2026-10-10:** akun Facebook Bos Cyo dibatasi Meta ("Akses iklan Anda dibatasi"),
sehingga Portofolio Bisnis tidak bisa dibuat dan jalur Meta langsung tertutup sementara. Uji coba
memakai **Twilio WhatsApp Sandbox**: tetap jalur resmi (Twilio adalah BSP WhatsApp), tanpa Facebook,
dengan webhook sendiri `POST /api/percetakan/wa/twilio` dan provider `TWILIO` di `wa_channels`
(migration 0148 membangun ulang tabelnya untuk CHECK baru). Untuk nomor sungguhan: banding di
facebook.com/accountquality, atau portofolio dibuat akun Facebook orang yang dipercaya, lalu pilih
Meta langsung (paling murah) atau sender Twilio.

### D4 — Anti-palsu: yang tercatat tidak bisa diubah diam-diam

| Lapisan | Mekanisme | Yang dicegah |
|---|---|---|
| Pesan WA | `wa_inbound_messages` hanya ditulis webhook, trigger menolak UPDATE/DELETE, idempoten per ID pesan Meta | "Pelanggan tidak pernah pesan itu" / chat dihapus |
| File | Disimpan di R2 dengan SHA-256 isi file | File ditukar setelah order |
| Item | `print_order_items` dibekukan trigger; harga dari master | Harga/jumlah diturunkan setelah bayar |
| Riwayat | `print_order_events` rantai hash per order, append-only; event DIBUAT menyimpan sidik isi order | Status/riwayat diedit, total diubah langsung di database |
| Pembatalan | Hanya Owner/Admin, alasan wajib | Karyawan membatalkan order yang sudah dibayar |
| Order tanpa WA | Boleh (`WALKIN`), tapi ditandai di daftar dan laporan | Order lisan tetap tercatat dan bisa dipantau rasionya |

`GET /api/percetakan/orders/:id` selalu menyertakan `verification` (rantai menyambung, sidik isi
cocok, status sama dengan event terakhir). Layar menampilkannya merah kalau tidak cocok.

**Batas yang jujur:** ancaman yang dijaga adalah **karyawan** lewat aplikasi. Orang yang memegang
akses database penuh (developer / akun Cloudflare) masih bisa menulis ulang seluruh rantai. Penutup
celah itu adalah "jangkar harian": sidik gabungan semua order dikirim ke WA Owner tiap malam,
supaya rantai lama tidak bisa diganti tanpa ketahuan (task T5 di handoff).

Yang **belum** tertutup di Tahap 1 dan tercatat sebagai task: order yang sama sekali tidak dicatat.
Penangkalnya rekonsiliasi counter mesin dan pemakaian bahan terhadap order (T4).

### D5 — Uang belum diposting di Tahap 1

Order menyimpan total (scaled INTEGER, invariant #1) tetapi belum membuat penjualan POS dan belum
menyentuh laci kas atau Accounting. Pembayaran (DP/lunas) dipasang di T2 lewat jalur penjualan
kasir yang sudah ada, bukan tabel uang baru (pola ADR-044 "posting lewat API yang sudah ada").

### D6 — Tanpa polling; aplikasi = web dulu

Layar `/s/<KODE>/cetak` memuat ulang saat tab kembali dilihat atau tombol ditekan (invariant #6).
Notifikasi order baru menyusul lewat push (pola ADR-048) bila dibutuhkan.

"APK": layar web dibuat dulu dan bisa dipasang di HP sebagai PWA (T8). Bungkus APK (TWA) hanya
kalau benar-benar perlu masuk Play Store. Kodenya tetap satu.

### D7 — Otomatisasi task: chat yang jelas langsung jadi order, tanpa AI

Bos Cyo, 2026-10-10: "yang paling penting ini otomatisasi task nya. bukan chat ke customernya.
kalo chat customer itu nanti pake orang gpp. yang penting dari chat customer tersebut, sistem bisa
nyimpulin ini orderannya apa dan bikin task ke karyawan tukang nyetak atau langsung ke printer."

- Setiap pesan masuk menjalankan **pembaca aturan** (`src/percetakan-tebak.js`). Yang dibaca: kata
  kunci produk gerai, ukuran ("3x1", "300x100 cm", "2,5 x 1 m"), jumlah ("2 lembar", "dua lembar",
  "1 aja"), dan pasangan file ke item (dari nama file, lalu urutan). Gratis, dan hasilnya bisa diuji
  pasti, tidak seperti AI.
- Hasilnya dianggap **lengkap** hanya kalau semua item dikenal, produk per meter punya ukuran,
  jumlah file pas dengan jumlah item, dan tidak ada kata koreksi ("ganti", "ralat", "batal", "eh").
  Satu saja ragu → tidak otomatis, dan chat tetap menunggu di layar untuk CS/Una.
- Lengkap + mode gerai `OTOMATIS` → order dibuat lewat `buatOrder` yang sama (harga dari master,
  antrian per mesin, rantai hash), dengan aktor `SYSTEM`. Mode `LANGSUNG_CETAK` sekalian memajukan
  ke `SIAP_CETAK`. Mode `MANUAL` mematikan otomatisasi.
- Order kembar dicegah oleh indeks unik draft per set pesan (`message_key`).
- Jumlah yang tidak disebut dianggap 1, dan itu ditulis terang di catatan item.

Efek ke anti-palsu justru positif: order dari WA tercatat tanpa campur tangan karyawan sama sekali.

### D8 — "Langsung ke printer" lewat agen cetak + hot folder

Server di cloud tidak bisa menjangkau printer di toko. Jembatannya adalah program kecil di PC mesin
(`percetakan-agen/agen-cetak.mjs`) yang memegang **kunci per mesin** (disimpan sebagai SHA-256,
bisa diganti kapan saja).
- Mesin large format memakai software RIP (Maintop, Onyx, PhotoPrint, Caldera, dll) yang mendukung
  **hot folder**: file yang masuk folder langsung diproses sesuai preset. Agen cukup menaruh file di
  folder itu. Printer biasa dicetak lewat SumatraPDF.
- Agen hanya mengambil tiket order `SIAP_CETAK` yang filenya `TERSIMPAN`, mengecek SHA-256 file,
  lalu melapor. Server mencatat event `DIKIRIM_KE_MESIN`, dan setelah semua tiket satu order
  terkirim, order jadi `DICETAK` atas nama mesin.
- Agen bertanya berkala (bawaan 20 detik). Ini program di PC toko, bukan layar kasir, jadi
  invariant #6 tidak dilanggar. Biayanya satu query ber-index per mesin per putaran, dan update
  "terakhir terlihat" dibatasi 5 menit sekali. Versi push lewat Durable Object adalah task T13.

### D9 — Saklar fitur = skin "G · Percetakan", bukan registry modul

Bos Cyo, 2026-10-10: "upgrade fitur2 itu hanya berlaku pada tenant baru tersebut. jadi dijadikan
on/off skin. setiap tenant juga bisa pake skin itu kalo dipilih ... aslinya sourcecode nya uda
berubah tapi tenant lainnya ga ngerasa karna engga on."

- Pintu tunggalnya `percetakanAktif(db, tenantId)` (`src/percetakan.js`), yang membaca kebijakan
  tenant `ui_skin` = `'G'` (`isPercetakanChoice`, `src/tenant-policy.js`). Dipanggil di API layar
  (403 `SKIN_PERCETAKAN_OFF`), webhook WA (pesan tenant non-G tidak dicatat), dan agen cetak (401).
- Owner menyalakan/mematikannya dari Owner Console → Tenant → Kebijakan → Tampilan, sama dengan
  skin lain. Tenant mana pun boleh memilih G. Data percetakan tetap per gerai, dan saat dimatikan
  datanya tidak dihapus.
- Skin G juga mengarahkan kasir ke Layar Cetak (`public/warung-entry.js`) dan menambah tombol
  "Layar Cetak" di Workspace Gerai (`public/percetakan-admin-entry.js`, `public/nav-groups.js`).
- Baris `PERCETAKAN` di `platform_modules` (D1) tetap ada sebagai catatan katalog, tetapi tidak lagi
  menjadi syarat. Migration 0147 memberi tenant Percetakan pilihan G.

## Konsekuensi

- Push branch yang berisi migration 0145 akan langsung menjalankan migration ke D1 produksi
  (lihat CLAUDE.md "Deploy"). Migration ini aditif murni dan aman, tetapi tetap minta izin Bos
  Cyo sebelum push.
- Kunci yang perlu dipasang di Worker sebelum WA sungguhan bisa dipakai: `WA_APP_SECRET`,
  `WA_VERIFY_TOKEN`, `WA_ACCESS_TOKEN`. `GEMINI_API_KEY` sudah dipakai Una.
- File WA disimpan di bucket R2 yang sama (`R2_BUCKET`, prefix `percetakan/`). Meta membatasi
  dokumen 100 MB, dan media ID Meta kedaluwarsa 7 hari.

## Related

- ADR-030 (tenancy), ADR-040 (registry modul), ADR-044 (Una & WhatsApp), ADR-048 (push), ADR-053 (R2)
- `HANDOFF-PERCETAKAN.md` — peta file, cara uji, dan backlog task untuk agen implementer
- Migration `0145_percetakan_tenant_foundation.sql`

## DOC-IMPACT

Diperbarui saat Tahap 1 di-merge (status ACCEPTED → "Tahap 1 live") dan setiap kali satu task
backlog mengubah D2–D5.

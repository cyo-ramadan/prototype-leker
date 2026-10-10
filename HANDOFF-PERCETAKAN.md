# Handoff — Modul Percetakan (order WA → antrian cetak)

Untuk agen implementer (Codex, Karen, Kimi, dst) yang melanjutkan modul ini. Alasan keputusan ada
di `adr/ADR-055-tenant-percetakan-order-wa.md`. Baca itu dulu; dokumen ini berisi **apa yang sudah
ada, cara menjalankannya, dan task berikutnya**.

Ditulis: 2026-10-10 oleh Eskor. Diperbarui: 2026-10-10.

---

## 1. Status singkat

| Bagian | Status | File |
|---|---|---|
| Tenant `TEN-CETAK` / gerai `CETAK01` / modul `PERCETAKAN` | selesai (branch, belum di `main`) | `migrations/0145_percetakan_tenant_foundation.sql` |
| Mesin cetak + produk & harga per gerai | selesai, + data contoh 3 mesin / 7 produk (migration 0146, harga referensi marketplace, ganti dengan harga asli) | `src/percetakan-api.js` |
| Webhook WhatsApp Cloud API (verifikasi + tanda tangan + simpan pesan + unduh file ke R2) | selesai, **belum dicoba dengan Meta sungguhan** | `src/percetakan-wa.js` |
| Simulator WA (uji alur tanpa WA) | selesai | `src/percetakan-wa.js` `simulasiPesan` |
| **Pembaca aturan (tanpa AI)**: chat → produk, ukuran, jumlah, file | selesai, 26/26 contoh chat buatan Eskor; **belum diuji dengan chat asli** | `src/percetakan-tebak.js`, `una-latih/percetakan-chat-contoh.json` |
| **Otomatisasi**: chat lengkap langsung jadi order + task antrian (mode MANUAL / OTOMATIS / LANGSUNG_CETAK per gerai; CETAK01 = OTOMATIS) | selesai | `src/percetakan-otomatis.js` |
| **Agen cetak** di PC mesin: hot folder RIP / SumatraPDF, kunci per mesin | selesai, **belum dicoba di mesin sungguhan** | `src/percetakan-mesin.js`, `percetakan-agen/` |
| Una membaca chat → draft order (tombol, untuk chat yang ragu) | selesai, **akurasi belum diukur dengan chat asli** | `src/percetakan-una.js` |
| Draft → order + mesin + nomor antrian per mesin per hari | selesai | `src/percetakan.js` `buatOrder` |
| Status order + rantai hash + verifikasi | selesai | `src/percetakan.js` `ubahStatus`, `verifikasiRiwayat` |
| Layar operator `/s/CETAK01/cetak` | selesai (versi pertama) | `public/percetakan.{html,js,css}` |
| Tes | 13 tes | `test/percetakan.test.js` |
| Pembayaran, foto hasil, counter mesin, laporan owner | **belum** | lihat §5 |
| Balas WA otomatis ke pelanggan | **sengaja ditunda**: Bos Cyo 2026-10-10, "chat customer itu nanti pake orang gpp" | T1 |

## 2. Alur

```
Pelanggan chat + kirim file ke nomor WA gerai (CS manusia tetap yang membalas chatnya)
  → Meta memanggil POST /api/percetakan/wa/webhook (tanda tangan dicek)
  → wa_inbound_messages (append-only) + print_files (unduh ke R2, sidik SHA-256)
  → prosesOtomatis: pembaca aturan membaca SEMUA pesan nomor itu yang belum diproses
       lengkap (produk dikenal, ukuran ada, file pas, tanpa koreksi) dan mode bukan MANUAL
         → draft ATURAN + order otomatis (aktor SYSTEM); mode LANGSUNG_CETAK: langsung SIAP_CETAK
       belum lengkap → tunggu pesan berikutnya; tetap tampil di "Chat masuk"
Untuk chat yang belum lengkap: karyawan buka /s/CETAK01/cetak → tab "Chat masuk"
  → "Baca dengan Una" (AI) atau "Isi manual" → print_order_drafts (MENUNGGU)
  → periksa rincian → "Konfirmasi jadi order"
  → print_orders + print_order_items (harga dari master, dibekukan)
    + print_queue_tickets (nomor antrian per mesin per tanggal)
    + print_order_events #1 DIBUAT (rantai hash)
Tab "Antrian": per mesin, urut nomor (?mesin=KODE = layar satu mesin). Tiap ganti status = 1 event baru.
Agen cetak (PC mesin): ambil tiket SIAP_CETAK + file TERSIMPAN → hot folder / printer
  → event DIKIRIM_KE_MESIN → semua tiket order terkirim → DICETAK (aktor MESIN)
BARU → DESAIN → SIAP_CETAK → DICETAK → FINISHING → SIAP_AMBIL → DIAMBIL
BATAL: hanya Owner/Admin, alasan wajib, hanya sebelum DICETAK.
```

## 3. API (`src/percetakan-api.js`)

**Saklar:** semua route di bawah (kecuali webhook yang diam-diam mengabaikan) hanya hidup kalau tenant
gerainya memilih skin **G · Percetakan** (ADR-055 D9). Tenant lain mendapat 403 `SKIN_PERCETAKAN_OFF`.

Login: token kasir (gerai dari akunnya) **atau** token Owner/Admin Gerai/Entity Admin + `?store=KODE`.
Token PIN lama / token agen ditolak (riwayat wajib punya orang).

| Method & path | Siapa | Isi |
|---|---|---|
| `GET/POST /api/percetakan/wa/webhook` | Meta (tanpa login) | verifikasi `hub.challenge` / terima pesan |
| `GET /setup` | semua | gerai, aktor, mesin, produk, saluran WA, `aiReady`, `storageReady` |
| `POST /machines` | Owner/Admin | upsert per `code`: `{code, name, isActive?, sortOrder?}` |
| `POST /products` | Owner/Admin | upsert per `code`: `{code, name, unit: M2/LEMBAR/PCS, unitPriceRupiah, machineId, keywords}` |
| `POST /channels` | Owner/Admin | daftarkan nomor Meta: `{phoneNumberId, displayNumber}` |
| `POST /wa/simulasi` | Owner/Admin | `{from, name?, text?, fileName?, mime?, fileBase64?}` (maks 20 MB) |
| `GET /inbox` | semua | chat 7 hari, dikelompokkan per nomor, tanda sudah/belum diproses |
| `POST /drafts/baca` · `/drafts/manual` | semua | `{fromNumber}` → draft dari pesan 3 hari terakhir yang belum masuk draft |
| `GET /drafts` | semua | draft MENUNGGU |
| `POST /drafts/:id/konfirmasi` | semua | `{customerName, dueAt, note, items:[{productId, qty, widthCm?, heightCm?, fileId?, note?}]}` |
| `POST /drafts/:id/tolak` | semua | bukan order |
| `POST /orders` | semua | order datang langsung (`WALKIN`), body sama + `customerPhone` |
| `GET /orders?status=AKTIF\|<STATUS>&phone=` | semua | daftar / riwayat pelanggan |
| `GET /orders/:id` | semua | order + item + antrian + riwayat + `verification` |
| `POST /orders/:id/status` | semua (BATAL: Owner/Admin) | `{toStatus, note}` |
| `GET /antrian` | semua | tiket aktif per mesin |
| `GET /files/:id` · `POST /files/:id/ulang` | semua | unduh file / ambil ulang dari Meta |
| `POST /settings` | Owner/Admin | `{mode: MANUAL / OTOMATIS / LANGSUNG_CETAK}` |
| `POST /machines/:id/kunci` | Owner/Admin | buat kunci agen baru (teks kunci hanya di respons ini; kunci lama mati) |
| `GET /antrian?machine=<id>` | semua | antrian satu mesin |
| `GET /agen/tugas` | kunci mesin | tugas SIAP_CETAK mesin itu (maks 10, urut antrian) |
| `GET /agen/tugas/:ticketId/file` · `POST /agen/tugas/:ticketId/terkirim` | kunci mesin | unduh file / lapor sudah di mesin |

Semua path di atas berawalan `/api/percetakan`.

## 4. Menjalankan & menguji

```sh
node --test test/percetakan.test.js   # cepat, ~15 detik
npm run check && npm test             # wajib sebelum commit (lihat CLAUDE.md)
```

Catatan Windows (laptop Bos Cyo): 13 tes lama gagal karena `core.autocrlf` dan `URL.pathname`.
Itu masalah lingkungan, bukan kode (`~/.maxi-mesin/CATATAN-ESKOR.md`). Bandingkan dengan baseline
itu, jangan dengan "0 gagal".

**Coba tanpa WA (paling cepat):** login Owner → buka `/s/CETAK01/cetak` → Pengaturan: isi mesin
dan produk → Chat masuk: kirim pesan lewat Simulator → Isi manual / Baca dengan Una → Konfirmasi
→ lihat Antrian.

### Menyambungkan WhatsApp lewat Twilio (dipakai Bos Cyo sejak 2026-10-10)

Akun Facebook Bos Cyo dibatasi Meta sehingga tidak bisa membuat Portofolio Bisnis. Twilio adalah mitra
resmi WhatsApp, dan sandbox-nya tidak butuh Facebook. Endpoint: `POST /api/percetakan/wa/twilio`
(`src/percetakan-wa.js` `terimaWebhookTwilio`; tanda tangan `X-Twilio-Signature`, HMAC-SHA1 + Base64).

1. Daftar di twilio.com/try-twilio. Di Console → Messaging → Try it out → Send a WhatsApp message,
   catat nomor sandbox (mis. +1 415 523 8886) dan kode `join ...`. Kirim kode itu dari HP penguji.
2. Pasang secret di Worker (dashboard Cloudflare → prototype-leker-v2 → Settings → Variables and
   Secrets): `TWILIO_ACCOUNT_SID` dan `TWILIO_AUTH_TOKEN`, keduanya dari halaman depan Console Twilio.
3. Di halaman sandbox Twilio, bagian **"When a message comes in"**:
   `https://ownertenang.biz.id/api/percetakan/wa/twilio`, method POST. URL harus persis sama, karena
   ikut dihitung dalam tanda tangan.
4. Layar Cetak → Pengaturan → WhatsApp: pilih **Twilio**, isi nomor sandbox, lalu Sambungkan.
5. Chat dari HP penguji ke nomor sandbox, lalu cek "Chat masuk" / "Antrian".

Catatan: nama file asli tidak dikirim Twilio (diganti `file-xxxxxx.pdf`), jadi pemasangan file ke
item memakai urutan, bukan nama. Sistem tidak membalas chat (TwiML kosong). Sandbox hanya untuk uji;
nomor gerai sungguhan lewat Twilio tetap butuh profil bisnis Meta (WhatsApp Self Sign-up).

### Menyambungkan WhatsApp langsung ke Meta (gratis untuk uji)

1. developers.facebook.com → buat App tipe **Business** → tambah produk **WhatsApp**.
2. Di WhatsApp → API Setup, Meta memberi **nomor uji gratis** + **Phone number ID**. Daftarkan
   nomor HP penguji sebagai penerima di halaman yang sama.
3. Pasang secret di Worker (Bos Cyo / agen yang memegang akses Cloudflare; jangan di repo):
   - `WA_VERIFY_TOKEN`: string acak buatan sendiri
   - `WA_APP_SECRET`: App Settings → Basic → App Secret
   - `WA_ACCESS_TOKEN`: token akses. Token sementara dari API Setup kedaluwarsa ±24 jam. Untuk
     jangka panjang, pakai System User token dari Business Settings.
   ```sh
   npx wrangler secret put WA_VERIFY_TOKEN
   npx wrangler secret put WA_APP_SECRET
   npx wrangler secret put WA_ACCESS_TOKEN
   ```
4. WhatsApp → Configuration → Webhook: URL `https://<domain>/api/percetakan/wa/webhook`, Verify
   token = `WA_VERIFY_TOKEN`, lalu subscribe field **messages**.
5. Di layar Percetakan → Pengaturan → WhatsApp: isi Phone number ID. Mulai saat itu simulator mati
   untuk gerai ini.
6. Dari HP penguji, chat ke nomor uji → pesan muncul di "Chat masuk".

Naik ke nomor sungguhan (berbayar) nanti: verifikasi bisnis di Meta Business Manager, pasang
metode pembayaran, tambah nomor gerai, lalu ganti Phone number ID di langkah 5. Kode tidak berubah.

### Biaya WA (dicek 2026-10-10, dari sumber pihak ketiga; cocokkan dengan halaman harga Meta)

| Jenis | Tarif Indonesia (sebelum PPN 11%) |
|---|---|
| Pesan masuk dari pelanggan | gratis |
| Balasan dalam 24 jam (service) | 1.000 pesan/nomor/bulan gratis, sesudahnya ±Rp357/pesan (berlaku sejak 1 Okt 2026) |
| Template utility (mis. "pesanan siap") | ±Rp357/pesan |
| Template marketing | ±Rp586/pesan (tidak dipakai modul ini) |
| Biaya platform BSP (Qontak, Wati, dst) | Rp0, karena kita langsung ke Meta. BSP biasanya Rp599 rb–750 rb/bulan |

Cara paling murah, yang wajib diikuti T1:
1. Sistem hanya mengirim **2 pesan per order**: konfirmasi order dan "siap diambil". Tidak ada
   pesan basa-basi otomatis.
2. Obrolan biasa tetap dibalas manusia. Cek apakah fitur **coexistence** Meta (nomor yang sama
   dipakai aplikasi WhatsApp Business di HP dan Cloud API sekaligus) tersedia untuk nomor gerai.
   Kalau tersedia, karyawan membalas dari HP seperti biasa dan webhook tetap menerima salinan
   pesan masuk. Status ketersediaan dan biayanya belum diverifikasi.
3. Perkiraan: 10 order/hari ≈ 600 pesan/bulan → Rp0. 30 order/hari ≈ 1.800 pesan/bulan → ±800
   pesan berbayar ≈ Rp285 rb + PPN.

## 5. Backlog task (urut prioritas)

Tiap task berdiri sendiri. Pagar di §6 berlaku untuk semuanya.

**T0 — Uji otomatisasi dengan chat asli (PRIORITAS).** Kumpulkan 30–50 chat order asli dari
percetakan Bos Cyo, tambahkan ke `una-latih/percetakan-chat-contoh.json` beserta jawaban benarnya,
lalu perbaiki `src/percetakan-tebak.js` dan kata kunci produk sampai tes hijau. Ukuran sukses:
**nol chat ragu yang jadi order otomatis** (salah cetak lebih mahal daripada chat yang masuk draft).
Rasio yang otomatis boleh naik pelan-pelan. Tiap salah baca yang ditemukan jadi satu contoh baru.

**T1 — (DITUNDA atas arahan Bos Cyo; chat pelanggan dibalas orang) Balas WA otomatis ke pelanggan.** Setelah order dikonfirmasi, kirim nomor order, rincian,
total, dan tenggat ke pelanggan. Saat status SIAP_AMBIL, kirim "pesanan siap diambil".
- Kirim lewat `POST {GRAPH_API_BASE}/{phone_number_id}/messages`. Dalam 24 jam sejak chat terakhir
  pelanggan → pesan teks biasa (gratis sampai 1.000/bulan, lihat "Biaya WA"). Lewat 24 jam → wajib
  template utility yang disetujui Meta (berbayar).
- Hitung pesan keluar per bulan per nomor dan tampilkan ke Owner, supaya tagihan tidak mengejutkan.
- Simpan log keluar di tabel baru `wa_outbound_messages` (append-only, pola `wa_inbound_messages`).
- Simulator: jangan kirim apa-apa, cukup catat.
- Selesai bila: tes membuktikan pesan di dalam jendela pakai teks, di luar jendela pakai template,
  dan kegagalan kirim tidak menggagalkan konfirmasi order.

**T2 — Pembayaran (DP / lunas) lewat jalur kasir yang sudah ada.** Jangan buat tabel uang baru.
Hubungkan order ke penjualan POS (`sales`) dan laci kas. `DIAMBIL` hanya boleh bila lunas, atau
dengan izin Owner (pola `transaction-void-permits`). Baca dulu `POS_MODULE_INDEPENDENCE.md` dan
`KNOWN_PITFALLS.md`. Gerai `CETAK01` itu `LITE`, tanpa Accounting.

**T3 — Foto bukti hasil cetak.** Wajib foto sebelum `SIAP_AMBIL`, disimpan di R2, key-nya ke
`print_order_events.photo_key` (kolom sudah ada dan ikut di-hash). Pakai `src/live-photo.js`.

**T4 — Rekonsiliasi mesin.** Karyawan mengisi counter mesin (klik / meter) di awal dan akhir shift.
Bandingkan dengan total lembar / m² order yang DICETAK hari itu. Selisih di atas ambang jadi
peringatan ke Owner. Ini yang menangkap **order yang sengaja tidak dicatat**.

**T5 — Laporan Owner harian + jangkar hash.** Tiap malam: jumlah order, omzet, rasio WALKIN,
pembatalan, selisih T4, dan satu sidik gabungan semua `print_order_events.hash` hari itu. Dikirim
ke WA Owner (template berbayar, jadi minta izin Bos Cyo dulu). Jangkar ini menutup celah
"rantai ditulis ulang oleh orang yang memegang akses database" (ADR-055 D4).

**T6 — Pelanggan.** Hubungkan `customer_phone` ke tabel `customers` gerai (riwayat order, poin /
membership bila Bos Cyo mau). Isolasi pelanggan mengikuti Customer Sharing Group (invariant #5).

**T7 — Una bisa ditanya soal percetakan.** Alat BACA di Una: "antrian outdoor berapa?", "order
Pak Budi sudah sampai mana?", "omzet hari ini?". Ikuti `UNA-MESIN-DAN-LATIHAN.md` dan skill
`latih-una`. Model tetap yang termurah.

**T8 — Bisa dipasang di HP (PWA).** `manifest.webmanifest` + ikon + service worker yang hanya
meng-cache aset statis (jangan meng-cache `/api/*`). APK (TWA) hanya kalau Bos Cyo minta Play Store.

**T9 — Pintu masuk dan navigasi.** Tombol ke layar Cetak dari portal kasir / workspace gerai
CETAK01, daftarkan di `public/nav-groups.js`, ajarkan ke Una (`node scripts/build-peta-una.mjs` +
`PENJELASAN` di `src/caca-peta.js`). Lihat CLAUDE.md "Konvensi repo".

**T10 — Ukur akurasi Una** dengan 20–30 chat order asli dari percetakan Bos Cyo (minta contohnya).
Catat skor seperti `UNA-MESIN-DAN-LATIHAN.md` §10. Perbaiki kerangka (prompt, `keywords` produk,
`saringUsulan`), bukan modelnya.

**T12 — Una otomatis untuk chat yang ragu (opsional, berbayar per baca).** Kalau pembaca aturan
bilang belum lengkap tapi ada file dan niat order, jalankan Una di belakang (`ctx.waitUntil`) dan
simpan hasilnya sebagai draft AI, supaya CS tinggal menekan Konfirmasi. Una **tidak** boleh membuat
order otomatis. Batasi per nomor per hari supaya biaya tidak bocor.

**T13 — Push, bukan polling, untuk agen cetak.** Sekarang agen bertanya tiap 20 detik (satu query
ber-index per mesin). Kalau mesinnya banyak, ganti dengan WebSocket Durable Object (pola ADR-048).

**T11 — (SKIN G SELESAI 2026-10-10)** Sisa: baris di `HANDOFF-STRATEGI-PENJUALAN.md` §8, setelah
Bos Cyo menguji dengan WA asli.

## 6. Pagar (jangan dilanggar)

1. **AI tidak pernah membuat order sendiri dan tidak pernah menentukan harga.** Hasil AI = draft.
2. **Jangan UPDATE/DELETE** `wa_inbound_messages`, `print_order_items`, `print_order_events`.
   Koreksi = event baru atau order baru. Trigger akan menolak, jadi jangan "akali" trigger-nya.
3. **Setiap perubahan status lewat `ubahStatus`**, satu-satunya jalur yang menulis event dan cache
   `print_orders.status` bersamaan.
4. **Uang scaled INTEGER**, hitung dengan BigInt, kirim ke D1 sebagai Number aman (pola
   `src/percetakan.js` `toDb`). Tidak ada float.
5. **Gerai dari login / nomor tujuan WA**, tidak pernah dari isi pesan atau body request.
6. **Jangan pakai gateway WA tidak resmi** (ADR-044 D2, ADR-055 D3).
7. **Secret WA tidak masuk repo.** Lewat `wrangler secret put`.
8. **Push branch = migration jalan ke D1 produksi.** Migration baru harus aditif, dan minta izin
   Bos Cyo sebelum push (CLAUDE.md "Deploy").
9. **Tanpa polling** (invariant #6).
11. **Migration: jangan pakai `UNION ALL` panjang.** D1 menolaknya ("too many terms in compound
    SELECT", 2026-10-10, deploy pertama 0146 gagal karena 7 baris), padahal SQLite lokal dan tes
    lulus. Pakai satu `INSERT ... SELECT ... WHERE NOT EXISTS` per baris.
10. Isi chat pelanggan adalah data asing: di layar selalu lewat `esc()`, dan di prompt AI
    ditandai sebagai data, bukan perintah.

## DOC-IMPACT

Perbarui tabel §1 dan backlog §5 setiap kali satu task selesai. Kalau keputusan berubah, perbarui
ADR-055.

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
| Mesin cetak + produk & harga per gerai | selesai | `src/percetakan-api.js` |
| Webhook WhatsApp Cloud API (verifikasi + tanda tangan + simpan pesan + unduh file ke R2) | selesai, **belum dicoba dengan Meta sungguhan** | `src/percetakan-wa.js` |
| Simulator WA (uji alur tanpa WA) | selesai | `src/percetakan-wa.js` `simulasiPesan` |
| Una membaca chat → draft order | selesai, **akurasi belum diukur dengan chat asli** | `src/percetakan-una.js` |
| Draft → order + mesin + nomor antrian per mesin per hari | selesai | `src/percetakan.js` `buatOrder` |
| Status order + rantai hash + verifikasi | selesai | `src/percetakan.js` `ubahStatus`, `verifikasiRiwayat` |
| Layar operator `/s/CETAK01/cetak` | selesai (versi pertama) | `public/percetakan.{html,js,css}` |
| Tes | 9 tes | `test/percetakan.test.js` |
| Balas WA ke pelanggan, pembayaran, foto hasil, counter mesin, laporan owner | **belum** | lihat §5 |

## 2. Alur

```
Pelanggan chat + kirim file ke nomor WA gerai
  → Meta memanggil POST /api/percetakan/wa/webhook (tanda tangan dicek)
  → wa_inbound_messages (append-only) + print_files (unduh ke R2, sidik SHA-256)
Karyawan buka /s/CETAK01/cetak → tab "Chat masuk"
  → "Baca dengan Una" (AI) atau "Isi manual" → print_order_drafts (MENUNGGU)
  → periksa rincian → "Konfirmasi jadi order"
  → print_orders + print_order_items (harga dari master, dibekukan)
    + print_queue_tickets (nomor antrian per mesin per tanggal)
    + print_order_events #1 DIBUAT (rantai hash)
Tab "Antrian": per mesin, urut nomor. Tiap ganti status = 1 event baru.
BARU → DESAIN → SIAP_CETAK → DICETAK → FINISHING → SIAP_AMBIL → DIAMBIL
BATAL: hanya Owner/Admin, alasan wajib, hanya sebelum DICETAK.
```

## 3. API (`src/percetakan-api.js`)

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

### Menyambungkan WhatsApp (gratis untuk uji)

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

Naik ke nomor sungguhan (berbayar) nanti: verifikasi bisnis di Meta Business Manager, tambah nomor
gerai, lalu ganti Phone number ID di langkah 5. Kode tidak berubah.

## 5. Backlog task (urut prioritas)

Tiap task berdiri sendiri. Pagar di §6 berlaku untuk semuanya.

**T1 — Balas WA otomatis ke pelanggan.** Setelah order dikonfirmasi, kirim nomor order, rincian,
total, dan tenggat ke pelanggan. Saat status SIAP_AMBIL, kirim "pesanan siap diambil".
- Kirim lewat `POST {GRAPH_API_BASE}/{phone_number_id}/messages`. Dalam 24 jam sejak chat terakhir
  pelanggan → pesan teks biasa (gratis). Lewat 24 jam → wajib template utility yang disetujui Meta.
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

**T11 — Skin "G · Percetakan"** di `DESAIN-SKIN-KATALOG.md` + baris di
`HANDOFF-STRATEGI-PENJUALAN.md` §8. Dikerjakan **sesudah** fitur live, jangan sebelumnya.

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
10. Isi chat pelanggan adalah data asing: di layar selalu lewat `esc()`, dan di prompt AI
    ditandai sebagai data, bukan perintah.

## DOC-IMPACT

Perbarui tabel §1 dan backlog §5 setiap kali satu task selesai. Kalau keputusan berubah, perbarui
ADR-055.

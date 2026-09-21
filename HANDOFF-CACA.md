# Handoff — "Caca", asisten toko berbasis AI

Dokumen ini untuk **sesi baru yang mulai dari nol** (Hana di sesi lain, atau agen
implementer). Instance tidak berbagi memory, jadi semua yang perlu diketahui
ditulis di sini atau ditunjuk dari sini.

Ditulis: 2026-09-17 · Oleh: Hana · Untuk: sesi lanjutan proyek Caca
Diperbarui: 2026-09-17 sore, setelah Tahap 1 mendarat.

---

## Status singkat

**Tahap 1 sudah ada kodenya, lulus test, tapi BELUM live.** Kodenya masih di
branch `claude/wonderful-fermat-bn4szi` dan belum digabung ke `main` — sesuai
koreksi di `CLAUDE.md` 2026-09-17, kode Worker yang melayani user baru berubah
setelah branch digabung ke `main`, bukan setelah di-push. Klaim "sudah live"
pada versi handoff sebelumnya salah dan dikoreksi di sini.

Isinya: Caca bisa dikirimi foto lembar rekap lewat tab "Caca" di panel Entity
Admin, membacanya, lalu menampilkan hasil beserta daftar hal yang perlu
dipastikan. **Belum ada alat tulis sama sekali** — tidak ada satu pun jalur yang
menyimpan hasil bacaan jadi transaksi. Itu disengaja, jangan "dilengkapi" tanpa
membaca D1 di ADR-044 dulu.

Rencana kemampuan selanjutnya (baca data tenant, catat penjualan/pembelian,
ajukan pembatalan) ada di **`adr/ADR-045`** — arah dan pagarnya sudah disetujui
Bos Cyo, belum ada kodenya.

- Desain lengkap: **`adr/ADR-044-whatsapp-intake-dan-ai-draft-entry.md`**
  (status ACCEPTED untuk Tahap 1). **Baca itu dulu, utuh, sebelum apa pun** —
  terutama bagian "Apa yang ternyata ada di lembar rekap asli" dan urutan tahap,
  yang dua-duanya direvisi setelah Bos Cyo mengirim lembar sungguhan.
- Kodenya: `src/caca-chat.js` (endpoint), `src/caca-rekap-reader.js` (penguraian
  angka + verifikasi), `src/caca-ai-client.js` (pemanggil model),
  `public/caca-chat.js` + `public/caca-chat.css` (panel), tab Caca di
  `public/entity-admin.html`. Test: `test/caca-rekap-reader.test.js`.

## Yang paling penting dikerjakan berikutnya

**Ukur akurasi bacanya dengan foto sungguhan.** Ini satu-satunya hal yang
menentukan apakah tahap-tahap berikutnya layak dilanjutkan, dan sampai sekarang
belum dilakukan. Yang sudah terbukti cuma logika penguraian angka dan
penghitungan ulangnya (diuji dengan angka asli lembar 06-Sep-26); kemampuan
model membaca fotonya **belum diukur sama sekali**.

Prasyaratnya: `GEMINI_API_KEY` terpasang sebagai secret Cloudflare. Tanpa itu
panelnya hidup tapi menjawab "belum tersambung". Jangan pernah meminta kuncinya
dalam bentuk teks ke Bos Cyo (invariant #9).

Mesin yang terpasang **`gemini-3.1-flash-lite`**, dipilih karena murah selagi
masih tahap uji (~Rp70 per foto). Itu keputusan sadar Bos Cyo, bukan default
yang kebetulan — alasan dan pagarnya di ADR-044 bagian "Model mana untuk apa".
Jangan menaikkannya ke model mahal tanpa angka meleset yang menunjukkan perlu,
dan jangan pula menganggap yang murah sudah terbukti cukup sebelum diukur.

**Kalau kuncinya dari jalur gratis Gemini:** itu sah untuk menguji lembar milik
Bos Cyo sendiri, tapi **wajib pindah ke jalur berbayar sebelum data tenant lain
lewat sini** — di jalur gratis isinya boleh dipakai Google mengembangkan
produknya. Pindahnya tidak mengubah kode sama sekali. Rincian di ADR-044.

---

## Apa yang sedang dibangun

Caca = asisten toko yang **diajak ngobrol** oleh pemilik/pegawai toko. Bukan form,
bukan pipa data. Dia sudah tersambung ke toko orangnya, jadi bisa dua hal:

1. **Ditanya** — "untung berapa hari ini?", "stok gula tinggal berapa?"
2. **Disetori data** — kirim foto rekap harian / ketik "jual 3 es teh 15rb"

Pasarnya: pemilik warung/toko yang gaptek, yang akrabnya cuma WhatsApp. Tujuan
akhirnya POS ini bisa dijual, bukan cuma dipakai sendiri.

**Arah jangka panjang**: masuk lewat WhatsApp. **Tapi langkah pertama yang
disepakati bukan WhatsApp** — lihat "Langkah berikutnya" di bawah.

---

## Yang sudah DIPUTUSKAN (jangan dibongkar ulang tanpa Bos Cyo)

1. **Alat BACA jalan langsung; alat TULIS selalu lewat draft + konfirmasi.**
   AI tidak pernah memposting transaksi sendiri. Draft dikonfirmasi user, lalu
   diposting lewat API aplikasi yang sudah ada (bukan tulis langsung ke tabel).
   Ini pagar utama — kalau dilanggar, yang rusak data keuangan pelanggan.
2. **Kalau nanti masuk WhatsApp: wajib Meta Cloud API resmi**, bukan library
   tidak resmi (Baileys/whatsapp-web.js dsb). Alasannya di ADR — intinya nomor
   bisa diblokir permanen dan semua pelanggan berhenti jalan sekaligus.
3. **Nomor WA = kredensial.** Didaftarkan dari panel web oleh admin yang sudah
   login, tidak pernah self-service dari WA. `store_id` diresolusi server-side
   dari nomor pengirim, tidak pernah dari isi pesan.
4. **Mesin AI: pakai API model, otaknya dirakit sendiri.** Bukan bikin model
   sendiri, bukan numpang produk chatbot jadi (Cekat dsb). Alasan + perkiraan
   biaya + model mana untuk apa: ADR-044 bagian "Mesin AI-nya: pakai apa".
5. **Urutan tahap**: kemampuan **bertanya** (alat baca) dulu, baru foto rekap.
   Yang berisiko dan mahal ditaruh setelah alur konfirmasi terbukti dipakai
   orang sungguhan.
6. **Mulai dari kotak chat di web, bukan WhatsApp.** Dikonfirmasi Bos Cyo
   2026-09-17 ("ok berarti kita kasih tombol chat untuk owner ya").
7. **Satu nomor WA dipakai bersama semua pelanggan**, bukan nomor per pelanggan.
   Dikonfirmasi Bos Cyo 2026-09-17. Konsekuensinya: nomor itu jadi titik
   kegagalan tunggal, jadi jalur resmi Meta (D2) bukan lagi saran melainkan
   keharusan. Nomor khusus jadi paket premium, bukan bawaan.
8. **Membaca foto didahulukan, sebelum kemampuan tanya-jawab.** Arahan Bos Cyo
   2026-09-17 ("fokus kerjakan ai di web nya dulu agar dia bener2 bisa ngerti
   kalo dikasih gambar seperti itu"). Aman dilakukan lebih awal justru karena
   modulnya tidak diberi alat tulis sama sekali.
9. **Caca menyalin, kode yang menghitung.** Model tidak pernah diminta
   menjumlahkan atau membetulkan. Ini yang membuat salah baca satu angka
   ketahuan lewat total yang tidak nyambung, bukan lewat begitu saja.
10. **Nama barang dicocokkan ke master barang gerai yang sedang login**, hanya
    kalau cocok persis. Tidak di-hardcode, tidak ditebak mirip-mirip — antar
    tenant daftar barangnya pasti berbeda.

---

## Yang BELUM diputuskan (butuh Bos Cyo)

1. **Arti kolom "Qris" di lembar rekap.** Dugaan kuat Hana: penjualan yang
   dibayar non-tunai, jadi mengurangi setoran tapi bukan uang keluar. Belum
   dikonfirmasi Bos Cyo. Jangan ditebak sendiri — salah tafsir di sini bikin
   laba toko salah tanpa ada error yang muncul. Sementara ini Caca
   menanyakannya setiap kali ketemu.
2. Verifikasi bisnis Meta (WABA) — siap dijalani atau belum? Prasyarat keras
   sebelum jalur WhatsApp bisa dimulai sama sekali.
3. Angka paket: berapa foto/hari dan tanya-jawab/hari per tingkat langganan.
   Perlu diukur biayanya dulu, jangan ditebak.
4. Apakah model murah sudah cukup teliti untuk baca foto — sekarang dipasang
   `gemini-3.1-flash-lite`, belum diukur. Naikkan hanya setelah ada angka
   meleset dari pengujian lembar sungguhan, bukan ditebak di atas kertas.
5. Rekap sehari penuh masuk lewat "sesi laci buatan" (usul Hana di ADR) atau
   cara lain — belum dikonfirmasi Bos Cyo. Baru relevan di Tahap 3.
6. Apakah bentuk lembar rekap sama di semua cabang/tenant, atau tiap tempat
   punya versi sendiri. Menentukan seberapa longgar pembacaannya harus dibuat.

---

## Langkah berikutnya yang disarankan

**Ukur dulu, jangan menambah fitur.** Godaan terbesar di titik ini adalah
langsung menyambung tombol simpan atau menambah kemampuan tanya-jawab, padahal
hal yang paling menentukan belum diketahui: seberapa sering Caca salah membaca.

Urutannya:
1. Pasang kunci API, kirim beberapa lembar rekap sungguhan lewat panelnya.
2. Catat berapa banyak baris yang meleset dan di bagian mana — angka, nama
   barang, atau baris yang kelewat.
3. Kalau melesetnya sering, perbaiki pembacaan dulu (prompt, atau model).
   Kalau jarang, baru lanjut ke Tahap 2 atau 3 sesuai ADR.

Yang **tidak** boleh dilakukan sebelum langkah di atas selesai: menyambungkan
hasil bacaan ke jalur simpan mana pun. Alur konfirmasi yang belum terbukti
akurat cuma memindahkan kesalahan ke tempat yang lebih sulit dilacak.

---

## Yang sudah ada di repo dan bisa langsung dipakai

Jangan bangun ulang yang sudah ada:

| Kebutuhan Caca | Sudah ada di | Catatan |
|---|---|---|
| Pemanggilan model AI | `src/caca-ai-client.js` | Satu-satunya tempat bicara ke penyedia model. Jangan panggil langsung dari handler — modelnya harus tetap bisa ditukar. |
| Penguraian angka + verifikasi lembar | `src/caca-rekap-reader.js` | Sudah teruji dengan angka lembar asli. Tambah jenis pemeriksaan di sini, bukan di prompt. |
| Resolusi gerai/entity dari sesi login | `src/stores.js`, `src/owner-auth.js` (`requireManagement`) | Pakai ini, jangan bikin jalur otorisasi baru |
| Pendaftaran modul per tenant (untuk paket langganan) | `platform_modules` + `tenant_module_installations` (migration 0080), `src/platform-module-registry.js` | Modul Caca direncanakan bernama `CACA_WA`; belum dipasang, Tahap 1 belum berkuota |
| Panel tempat menaruh tombol chat | `public/entity-admin.html` | Tab "Caca" sudah ada di sini |

**Alat baca "untung hari ini" sudah tersedia di `main`** —
`src/net-profit-report.js` plus panel `public/admin-net-profit-report.js`, masuk
lewat PR #295/#296. Jadi Tahap 2 tinggal membungkusnya jadi alat, bukan
membangun dari nol.

---

## Pagar yang tidak boleh dilanggar

Selain 10 keputusan di atas:

- **`CLAUDE.md` invariant #1–#9 tetap berlaku penuh.** Terutama: uang selalu
  scaled-integer (bukan float), Accounting satu-satunya yang memposting jurnal,
  isolasi `store_id` server-side.
- **Gerai tidak pernah ditentukan dari isi gambar.** Lembar rekap memuat tulisan
  "Cabang", dan itu sengaja diabaikan — yang dipakai selalu gerai dari sesi login
  yang sudah divalidasi. Penerapan invariant #5 ke kanal baru.
- **Caca tidak membetulkan lembar yang tidak konsisten.** Kejanggalan diangkat
  sebagai pertanyaan. AI yang "merapikan" angka pemilik toko menghasilkan
  pembukuan yang tidak pernah bisa dicocokkan balik ke kertasnya.
- **Angka keuangan tidak boleh keluar dari ingatan model.** Semua angka wajib
  datang dari query saat ditanya. Model yang "mengingat" angka kemarin lalu
  menyebutkannya lagi hari ini adalah cara paling halus menyajikan angka palsu
  yang terdengar meyakinkan.
- **Caca tidak boleh mengaku manusia** kalau ditanya.
- **Kunci API tidak pernah masuk repo** — lewat secret Cloudflare (invariant #9).
- Baca `KNOWN_PITFALLS.md` sebelum menyentuh apa pun yang berkaitan dengan
  Accounting/Inventory — khususnya catatan "Laporan Net Profit tidak otomatis
  ikut fitur Beban baru".

---

## Siapa yang mengerjakan

Saran Hana, mengikuti pembagian kerja di `CLAUDE.md`:

- **Rancangan dan brainstorming lanjutan → Hana** (di sesi mana pun). Desainnya
  masih bergerak: dalam satu sesi kemarin saja bentuknya berubah tiga kali
  seiring Bos Cyo memperjelas maksudnya. Menyerahkan rancangan yang belum stabil
  ke agen implementer yang mulai dari nol itu pemborosan — dia akan mengerjakan
  versi yang sudah basi sebelum selesai.
- **Implementasi, setelah rancangan sebuah tahap dikunci → agen implementer
  (Karen/dst)** lewat papan agent-bus, pakai skill `agent-task-brief`.
- Tahap 1 dikerjakan Hana sendiri, sesuai perkecualian di `CLAUDE.md`: bentuknya
  berubah beberapa kali dalam satu percakapan, dan konteks lembar rekap aslinya
  mahal ditransfer ulang ke sesi yang mulai dari nol.
- **Pengukuran akurasi berikutnya juga cocok dipegang Hana**, karena hasilnya
  langsung mengubah rancangan (prompt, pemeriksaan, pilihan model) — itu
  rangkaian coba-coba yang saling bergantung, bukan potongan kerja berbatas
  jelas. Begitu angkanya stabil, Tahap 2 dan 3 sudah rapi untuk dilempar.

---

## DOC-IMPACT

Dokumen ini **sementara** — berlaku sampai akurasi baca Tahap 1 terukur dan
dokumen turunannya menyusul (lihat DOC-IMPACT di ADR-044). Begitu
modulnya ada, isinya pindah ke `ADR-044` (status jadi ACCEPTED),
`MODULE_OWNERSHIP.md`, dan `RUNBOOK.md`, lalu file ini dihapus.

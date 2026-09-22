# Handoff — "Caca", asisten toko berbasis AI

Dokumen ini untuk **sesi baru yang mulai dari nol** (Hana di sesi lain, atau agen
implementer). Instance tidak berbagi memory, jadi semua yang perlu diketahui
ditulis di sini atau ditunjuk dari sini.

Ditulis: 2026-09-17 · Oleh: Hana · Untuk: sesi lanjutan proyek Caca

---

## Status singkat

**Belum ada satu baris kode pun yang ditulis.** Yang sudah ada cuma desain.
Jangan mencari modul Caca di repo — belum ada.

- Desain lengkap: **`adr/ADR-044-whatsapp-intake-dan-ai-draft-entry.md`**
  (status PROPOSED). **Baca itu dulu, utuh, sebelum apa pun.**
- Sesi asal (2026-09-17) fokus ke fitur non-AI dan sudah ditutup untuk topik ini.

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
7. **Caca di dokumen ini SPESIFIK untuk konteks pelanggan-tenant (pemilik/
   pegawai toko yang tanya soal operasional gerainya sendiri) -- bukan untuk
   customer publik (pembeli yang mau pesan jajanan di suatu gerai).**
   Dikonfirmasi Bos Cyo, 2026-09-22: "whatsapp dari customer ke caca dan dari
   pelanggan tenant ke caca itu ya beda donks. caca harus bisa deteksi kalo
   ini konteksnya masalah setting gerai, yang satu masalah pingin order2
   jajanan di suatu gerai." Kalau nanti dibangun jalur WA buat customer
   publik (akuisisi member / tanya-tanya jajanan), itu **fitur terpisah**,
   jangan diam-diam digabung ke rancangan Caca di dokumen ini. Semua
   keputusan #1-6 di atas (terutama nomor WA = kredensial yang didaftarkan
   admin dari panel, bukan self-service) berlaku untuk konteks tenant ini
   saja -- BELUM tentu cocok dipakai apa adanya untuk konteks customer
   publik, yang audiensnya anonim dan volumenya berpotensi jauh lebih besar
   dan tidak terkontrol.

---

## Yang BELUM diputuskan (butuh Bos Cyo)

1. **Satu nomor WA bersama untuk semua pelanggan, atau nomor per pelanggan?**
   Hana menyarankan satu nomor bersama (onboarding pelanggan gaptek jadi mungkin,
   modal di depan kecil), dengan nomor khusus dijual sebagai paket premium nanti
   — **tapi Bos Cyo belum mengonfirmasi ini secara eksplisit.** Jangan
   diperlakukan sebagai sudah diputuskan.
2. Verifikasi bisnis Meta (WABA) — siap dijalani atau belum? Prasyarat keras
   sebelum jalur WhatsApp bisa dimulai sama sekali.
3. Angka paket: berapa foto/hari dan tanya-jawab/hari per tingkat langganan.
   Perlu diukur biayanya dulu, jangan ditebak.
4. Model persisnya untuk baca foto — ditentukan setelah diuji pakai lembar
   rekap asli punya Bos Cyo, bukan dipilih di atas kertas.
5. Rekap sehari penuh masuk lewat "sesi laci buatan" (usul Hana di ADR) atau
   cara lain — belum dikonfirmasi Bos Cyo.
6. **Jalur WA untuk customer publik (bukan pelanggan-tenant): satu nomor WA
   yang mendeteksi konteks pengirim (tenant vs customer) lewat AI, atau dua
   persona/nomor terpisah** ("Caca" khusus pelanggan tenant, "Cici" khusus
   customer publik, usul Bos Cyo 2026-09-22)? Belum diputuskan mana yang
   dipakai. Pertimbangan Hana kalau nanti dibahas lagi: satu nomor bersama
   berarti risiko dari sisi customer (volume publik, lebih rawan dianggap
   spam oleh Meta) bisa ikut menjatuhkan akses Caca versi tenant kalau
   nomornya kena banned/limit -- jadi ada alasan infrastruktur (bukan cuma
   kerapian nama) buat pisah nomor/persona sejak awal. Ini baru catatan
   pertimbangan, bukan rekomendasi final; belum dibahas tuntas karena
   Bos Cyo minta ditunda ("bahas lain kali aja").
7. Seluruh mekanisme customer publik lewat WA (identitas = nomor WA tanpa
   registrasi lain, akuisisi member lintas-tenant, dst) masih di tahap
   ide kasar dan BELUM ada satu keputusan pun yang dikunci -- termasuk hal
   dasar seperti verifikasi identitas, pemulihan kalau nomor ganti, dan
   titik temu dengan sistem customer per-gerai yang sudah ada. Jangan
   dianggap sudah punya arah yang jelas hanya karena sempat dibahas.

---

## Langkah berikutnya yang disarankan

**Mulai dari kotak chat Caca di aplikasi web yang sudah jalan — bukan WhatsApp.**

Alasannya (ini keputusan sadar, bukan menunda):
- Tidak perlu verifikasi Meta, tidak perlu nunggu berhari-hari, tidak ada biaya
  per pesan untuk uji coba.
- Membuktikan hal yang paling belum pasti: **apakah jawaban Caca benar-benar
  berguna**, atau cuma kelihatan keren di angan-angan.
- Kalau ternyata meleset atau tidak ada yang memakai, yang hilang cuma waktu —
  bukan biaya verifikasi + nomor + langganan AI.
- Kalau ternyata bagus, WhatsApp tinggal ditambah sebagai pintu masuk; otaknya
  sudah jadi.

Isi langkah pertama: tombol chat untuk Owner/Admin di panel web, dengan **alat
baca saja** (belum ada alat tulis sama sekali). Target pertanyaan: untung hari
ini, penjualan kemarin, sisa stok.

---

## Yang sudah ada di repo dan bisa langsung dipakai

Jangan bangun ulang yang sudah ada:

| Kebutuhan Caca | Sudah ada di | Catatan |
|---|---|---|
| Alat baca "untung hari ini/kemarin" | `src/net-profit-report.js` | Sudah jadi & teruji. Sudah punya cache harian, tidak berat dipanggil berulang. Praktis tinggal dibungkus jadi alat. |
| Resolusi gerai/entity dari sesi login | `src/stores.js`, `src/owner-auth.js` (`requireManagement`) | Pakai ini, jangan bikin jalur otorisasi baru |
| Pendaftaran modul per tenant (untuk paket langganan) | `platform_modules` + `tenant_module_installations` (migration 0080), `src/platform-module-registry.js` | Modul Caca direncanakan bernama `CACA_WA` |
| Panel tempat menaruh tombol chat | `public/entity-admin.html` / `public/branch-admin.html` | Panel Entity Admin baru saja dapat tab Laporan; polanya bisa ditiru |

---

## Pagar yang tidak boleh dilanggar

Selain 6 keputusan di atas:

- **`CLAUDE.md` invariant #1–#9 tetap berlaku penuh.** Terutama: uang selalu
  scaled-integer (bukan float), Accounting satu-satunya yang memposting jurnal,
  isolasi `store_id` server-side.
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
- **Implementasi, setelah rancangan langkah pertama dikunci → agen implementer
  (Karen/dst)** lewat papan agent-bus, pakai skill `agent-task-brief`. Langkah
  pertama (kotak chat + alat baca saja) itu potongan yang rapi dan berbatas
  jelas — cocok dilempar.
- Kecualinya: kalau ternyata langkah pertama banyak coba-coba yang saling
  bergantung (mis. menyetel kualitas jawaban sambil menguji), Hana pegang
  sendiri dulu sampai bentuknya jelas, baru dilempar.

---

## DOC-IMPACT

Dokumen ini **sementara** — berlaku sampai langkah pertama Caca mendarat. Begitu
modulnya ada, isinya pindah ke `ADR-044` (status jadi ACCEPTED),
`MODULE_OWNERSHIP.md`, dan `RUNBOOK.md`, lalu file ini dihapus.

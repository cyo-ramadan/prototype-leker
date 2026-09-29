# Handoff — Hana sebagai pencatat pembukuan ("jalur agen" untuk entry data)

Dokumen ini untuk **sesi baru yang mulai dari nol** (Hana di sesi lain, atau agen
implementer). Instance tidak berbagi memory, jadi semua yang perlu diketahui ditulis di
sini atau ditunjuk dari sini.

Ditulis: 2026-09-27 · Oleh: Hana · Untuk: sesi lanjutan

---

## Status singkat

**Belum ada kode sama sekali.** Yang ada hanya permintaan Bos Cyo (di bawah), rancangan
lama yang berkaitan (Caca, `adr/ADR-044-*` + `HANDOFF-CACA.md`), dan fondasi yang sudah jadi
di repo. Langkah pertama sesi berikutnya adalah **rancangan (ADR-048)** dan keputusan Bos Cyo.
Mulai koding setelah itu.

---

## Permintaan asli Bos Cyo (2026-09-27, apa adanya)

> "tujuan ku bikin web ini sebenernya untuk menghemat operasional juga. di web baru aku masih
> pakai akuntan, misal untuk bikin jurnal baru aku bilang ke akuntan, itu pak eddy tf nambahin
> modal, kamu catat ya. nah nantinya aku pingin perintah itu ke hana saja, dan hana kerjakan
> pencatatan itu seperti manusia. pun untuk pelanggan tenant lain juga memiliki fasilitas itu
> untuk bisa nyuruh2 hana. jadi hana sekarang harus punya jalurnya untuk entry data2 lewat jalan
> seperti manusia, tapi tetep lewat backend."

Ada tiga hal di dalamnya:

1. **Pengganti akuntan.** Perintah bahasa sehari-hari ("Pak Eddy transfer nambahin modal,
   catat ya") dicatat Hana jadi transaksi atau jurnal yang benar.
2. **"Seperti manusia, tapi lewat backend."** Hana memakai **pintu yang sama dengan admin
   manusia**: endpoint aplikasi yang sama, validasi yang sama, jurnal otomatis yang sama.
   Hana tidak menulis langsung ke database.
3. **Untuk semua tenant.** Pelanggan tenant lain juga bisa "nyuruh" Hana untuk toko mereka
   sendiri. Karena itu jalurnya harus **terbatas per tenant**, tidak boleh satu kunci sakti
   untuk semua gerai.

---

## Hubungannya dengan Caca (ADR-044) — baca ini dulu

`HANDOFF-CACA.md` dan `adr/ADR-044-*` sudah merancang asisten untuk pelanggan tenant.
**Baca keduanya utuh.** Permintaan hari ini tidak membatalkan rancangan itu, tapi menggeser dua hal:

| | Caca (2026-09-17) | Permintaan 2026-09-27 |
|---|---|---|
| Yang didahulukan | Alat **baca** dulu ("untung berapa?"), alat tulis belakangan | Alat **tulis/catat** justru inti nilainya (mengganti akuntan) |
| Nama | "Caca" | Bos Cyo menyebut "Hana" untuk tenant juga — **belum diputuskan**, lihat pertanyaan #1 |

Keputusan Caca yang **tetap berlaku** dan jangan dibongkar tanpa Bos Cyo:
- **Alat tulis selalu DRAFT + konfirmasi manusia.** AI tidak pernah memposting sendiri.
  Pola "akuntan manusia" sebenarnya juga begini: akuntan yang baik bilang "saya catat Kas
  bertambah 10 juta, Modal Pak Eddy bertambah 10 juta, betul ya?" sebelum mencatat.
- Toko/tenant diresolusi **server-side dari identitas pemanggil**, tidak pernah dari isi pesan.
- Angka keuangan selalu diambil dari query saat itu, tidak pernah dari ingatan model.
- Kunci API AI dan token lewat secret Cloudflare, tidak pernah masuk repo.

---

## Fondasi yang SUDAH ada (jangan dibangun ulang)

| Kebutuhan | Sudah ada | Catatan penting |
|---|---|---|
| Identitas mesin untuk agen | `AGENT_ADMIN_TOKEN` di `src/owner-auth.js` (`agentAdminFromRequest`, dipakai `requireManagement`) | **Global, semua gerai.** Cocok untuk Hana-developer, **TIDAK** untuk tenant. Belum dicek apakah secret ini terpasang di Worker produksi. |
| Jurnal manual | `POST /api/admin/accounting/journals` (`src/accounting-workspace.js` → `postAccountingJournal`) | Baris jurnal pakai `accountId` (id per gerai), bukan kode. Wajib balance exact. |
| Akun seragam antar gerai | ADR-047 (migration 0124, 2026-09-27) | Kode akun sama di semua gerai kecuali DERMO, jadi katalog aksi bisa memakai **kode** (3101 Modal, 1101 Kas, 1102 Bank, 1103 Rekening Bersama, ...) lalu di-resolve ke id per gerai. |
| Fakta admin yang otomatis terjurnal | ADR-046: `/api/admin/operational-expenses` (Bea Operasional), `/api/admin/hutang-piutang/payments`, `/api/admin/hutang-piutang/pembayaran-lainnya`, `/api/admin/hutang-piutang/deposits` | Jurnalnya dipasang sebagai **pembungkus respons di `src/index.js`** (`attachAdminAccountingToCommittedResponse`). Lihat jebakan #1 di bawah. |
| Rekening Bersama | `/api/admin/shared-accounts` (`src/entity-shared-accounts.js`, ADR-045) | "Pak Eddy transfer" bisa masuk ke sini, bukan Kas/Bank gerai. Harus ditanyakan, bukan ditebak. |
| Laporan (untuk alat baca) | `/api/admin/accounting/ledger`, `/profit-loss`, `/balance-sheet`; `src/net-profit-report.js` | |
| Tenant/entity | tabel `tenants`, `entities` (migration 0039), `tenant_policy_settings`, `platform_modules` + `tenant_module_installations` (ADR-040) | Paket/langganan asisten menumpang registry modul ini. |
| Bridge MCP untuk claude.ai | `agent-bridge/` (Worker terpisah `leker-agent-bridge`) | **Read-only GitHub by construction.** README-nya tegas bukan bagian aplikasi Leker. Menambah alat tulis ke sana mengubah jaminan itu, jadi harus lewat keputusan ADR. |

---

## Jebakan yang sudah ketahuan (baca sebelum merancang)

1. **Memanggil fungsi handler langsung ≠ lewat pintu manusia.** Jurnal otomatis fitur admin
   (ADR-046) baru jalan di **pembungkus respons `src/index.js`** sesudah handler selesai.
   Kalau lapisan aksi Hana memanggil fungsi seperti `createDeposit()` langsung, datanya masuk
   tapi **jurnalnya tidak terbentuk**, dan tidak ada error. Aksi harus lewat routing Worker
   yang sama (mis. `Request` internal ke rute yang sama), atau pembungkusnya dipanggil eksplisit.
   Wajib ada tes regresi yang membuktikan jurnal ikut terbentuk.
2. **`AGENT_ADMIN_TOKEN` melewati batas gerai.** `requireManagement` mengembalikan akses tanpa
   cek `store`/entity untuk token ini. Memberikannya ke tenant sama saja memberi akses ke
   **semua** gerai semua tenant, dan melanggar invariant #5. Tenant butuh identitas agen yang
   di-scope per entity/tenant.
3. **Jurnal tidak mencatat siapa yang menyuruh.** `accounting_journal_headers` tidak punya
   kolom pelaku. Untuk "akuntan AI", jejak audit wajib ada: teks perintah asli, siapa manusia
   yang menyuruh, draft yang diajukan, siapa yang mengonfirmasi, dan id fakta/jurnal hasilnya.
   Jejak ini disimpan di tabel asisten sendiri. Tabel jurnal jangan diubah (invariant #2).
4. **`?store=` default ke G001** (skill `jalur-akses-leker` §3). Aksi agen yang lupa menyertakan
   gerai akan diam-diam masuk ke gerai yang salah. Gerai harus diresolusi dari identitas dan
   ditolak kalau ambigu.
5. **Tanpa polling** (invariant #6). Chat berjalan request/response. Kalau butuh dorongan,
   pakai push.
6. **Push ke branch mana pun = migration jalan di D1 produksi** (`CLAUDE.md` bagian Deploy).

---

## Rancangan awal usulan Hana (bahan ADR-048, belum diputuskan)

Dua lapis yang terpisah:

**Lapis 1 — "Jalur Hana" di backend (fondasi, dipakai semua kanal)**
- **Identitas agen per tenant/entity.** Dibuat Owner dari panel web. Token disimpan sebagai
  hash dan hanya berlaku untuk gerai milik entity/tenant itu. `AGENT_ADMIN_TOKEN` global
  tetap khusus developer.
- **Katalog aksi bertipe** (bukan "panggil endpoint apa saja"). Tiap aksi punya skema input,
  dipetakan ke pintu manusia yang sudah ada:
  - `catat_setoran_modal` → jurnal: Dr Kas/Bank/Rekening Bersama, Cr 3101 Modal
  - `catat_prive` / tarik modal
  - `catat_bea` → `/api/admin/operational-expenses`
  - `bayar_hutang`, `pembayaran_lainnya`, `uang_muka` → rute hutang-piutang
  - `jurnal_manual` → fallback yang **wajib** menyebut akun dan nominal eksplisit
  - Alat baca: saldo akun, laba rugi, neraca, jurnal terakhir
- **Draft → konfirmasi → posting.** Tabel `assistant_drafts` + `assistant_actions` (audit).
  Konfirmasi memicu pemanggilan ke pintu manusia dengan idempotency key dari id draft,
  supaya klik ganda tidak dobel.
- **Pemetaan aksi ke akun ditentukan Bos Cyo, bukan Hana.** Tabelnya ditulis di ADR untuk
  disetujui (kebijakan akuntansi = keputusan Bos Cyo, `MODULE_OWNERSHIP.md` aturan 5).

**Lapis 2 — kanal (cara orang menyuruh)**
- Bos Cyo: lewat Claude (claude.ai/Zee atau Claude Code) yang memanggil Jalur Hana, **atau**
  kotak chat di web. Lihat pertanyaan #3.
- Tenant: kotak chat di panel web (Caca Tahap 1, kini dengan alat tulis). WhatsApp menyusul
  sesuai ADR-044.

Irisan pertama yang Hana sarankan setelah ADR disetujui: identitas agen per entity + audit +
draft/konfirmasi + **dua aksi** (`catat_setoran_modal` dan `catat_bea`) + daftar "Draft dari
Hana" di panel web untuk disetujui dengan satu klik. Cukup untuk membuktikan alur "Pak Eddy
transfer modal" dari ujung ke ujung.

---

## Pertanyaan yang harus dijawab Bos Cyo dulu (jangan ditebak)

1. **Nama asisten untuk tenant: "Hana" atau tetap "Caca"?** Satu persona atau dua (Hana untuk
   Bos Cyo, Caca untuk tenant)?
2. **Konfirmasi.** Cukup "ya" di chat, atau untuk jenis/nominal tertentu wajib klik tombol di
   web? Usul Hana: chat cukup untuk Owner; di atas batas nominal tertentu, atau kalau yang
   menyuruh bukan Owner, wajib klik di web.
3. **Kanal pertama untuk Bos Cyo sendiri:** Claude (claude.ai/Claude Code) atau kotak chat di
   web? Kalau lewat claude.ai, bridge MCP-nya dibuat terpisah dari `agent-bridge/` (yang
   sengaja read-only) atau `agent-bridge/` diubah?
4. **Pemetaan akun per aksi.** Contoh setoran modal: selalu 3101 Modal? Masuk ke Kas, Bank,
   atau Rekening Bersama? Tanya tiap kali, atau ikut kebiasaan? DERMO punya 2 owner: perlu
   Modal per owner (akun custom, hanya DERMO yang boleh — ADR-047)?
5. **Siapa yang boleh menyuruh Hana per tenant:** hanya Owner, atau juga Entity Admin/Admin
   Gerai? Dengan batas aksi apa saja?
6. **Biaya AI untuk tenant:** masuk paket modul (ADR-040), dengan jatah seperti ADR-044?

---

## Pagar yang tidak boleh dilanggar

- `CLAUDE.md` invariant #1–#9 berlaku penuh. Yang paling kena:
  - #1: uang scaled-integer, bukan float. Angka dari bahasa sehari-hari ("10jt", "2,5 juta")
    di-parse ke integer rupiah dengan tes.
  - #2: posted journal immutable. Salah catat dikoreksi lewat pembalik.
  - #3: jurnal manual wajib balance exact.
  - #4: Accounting yang memposting. Agen menyerahkan fakta/perintah lewat pintu yang ada.
  - #5: isolasi gerai/tenant di server.
  - #9: jangan minta token plaintext.
- Tidak ada INSERT/UPDATE langsung ke D1 untuk data bisnis (skill `jalur-akses-leker` §2).
- AI tidak pernah memposting tanpa konfirmasi manusia (keputusan Caca #1).
- Asisten tidak mengaku manusia kalau ditanya (ADR-044).
- Kebijakan akuntansi yang belum jelas: berhenti dan tanya Bos Cyo. Jangan diputuskan sendiri.
- Baca `KNOWN_PITFALLS.md` sebelum menyentuh Accounting.

---

## Siapa mengerjakan

- **ADR-048 + tanya-jawab dengan Bos Cyo → Hana** (sesi berikutnya). Rancangan ini masih
  bergerak dan butuh keputusan kebijakan. Belum cocok dilempar ke agen yang mulai dari nol.
- **Implementasi irisan pertama → agen implementer (Karen/dst)** setelah ADR-048 disetujui,
  lewat papan agent-bus dengan skill `agent-task-brief`. Task-nya `mutates_production = 1`
  (menyentuh jurnal sungguhan).

---

## DOC-IMPACT

Dokumen sementara. Begitu ADR-048 disetujui, isinya pindah ke ADR tersebut,
`MODULE_OWNERSHIP.md` (pemilik modul asisten), dan `HANDOFF-CACA.md` (digabung atau ditutup),
lalu file ini dihapus.

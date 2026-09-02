# ADR-041 — Organization & People: identitas kanonik lintas Workboard, Leker, dan platform SaaS MAXI

Status: PROPOSED — lihat Decision Gates di bagian P, beberapa poin BLOCKED FOR DECISION.
Tanggal: 2026-09-02
Ditulis oleh: Hana, atas permintaan Bos Cyo (audit arsitektur lintas-repo)
Melengkapi, tidak menggantikan: `ADR-030` (Tenant/Entity/Store di Leker), `ADR-040` +
`contracts/module-contract-v1.md` (komposisi modul di dalam Worker Leker)

## Ruang lingkup

Ini ADR baru, bukan revisi. `ADR-030` sudah menjawab Tenant/Entity/Store **di dalam**
Leker. `ADR-040` sudah menjawab bagaimana modul (Olshop, F&B, Accounting, dst) hidup
bersama **di satu Worker/database Leker**. Dua-duanya tetap berlaku utuh, tidak
disentuh di sini.

Yang belum pernah dijawab siapa pun: bagaimana **Workboard** (aplikasi terpisah —
Worker beda, database beda, tim/siklus deploy beda) menyambung ke semua ini, dan
bagaimana mengatasi konsep **Karyawan** yang di Leker tidak ada sama sekali.

Audit ini dilakukan penuh terhadap kode/dokumen aktual kedua repo (`prototype-leker`
dan `program-task`), bukan dari ringkasan atau asumsi.

## A. Current State

### Leker (`prototype-leker`)

- `ADR-030`: Tenant→Entity→Store, dua Tenant hidup hari ini (`TEN-PROTOTYPE`/Leker,
  `TEN-GALEH`/Ikan Galeh). Fondasi tabel + Fase 1-2 (resolusi Entity di titik baca
  gerai, kolom `entity_id` di tabel ledger) **selesai**. Fase 3 (penerapan batas
  sungguhan) baru domain Accounting yang selesai; Admin/Laporan, Operasional, Gudang
  masih diaudit — jalur terpisah, sedang berjalan, tidak diulang di sini.
- `ADR-040` + `contracts/module-contract-v1.md`: arah modul-per-tenant di satu
  Worker/database, kontrak 5 syarat modul, lapisan platform untuk invariant bersama
  (uang/kuantitas/waktu/id) — lapisan platform-nya sendiri **belum dibangun**, itu D2
  di roadmap ADR-040, jalan sendiri.
- **Tidak ada konsep Employee sama sekali.** Tabel `cashiers`
  (`migrations/0005_cashier_auth.sql:3-13`): `employee_name` teks bebas + `store_id`,
  tanpa `employee_id`, tanpa penghubung antar-gerai. Satu orang kerja di 2 gerai =
  dua baris `cashiers` yang hanya kebetulan sama nama ketikannya — tidak ada relasi
  struktural. `staff_attendance.user_id` merujuk ke `cashiers.id`, bukan ke identitas
  orang.

### Workboard (`program-task`)

- Worker + D1 terpisah total: `maxi-workboard-prototype` (`wrangler.toml:14-18`).
  README-nya sendiri eksplisit: "intentionally isolated from `maxi-platform` while
  shared-module governance is unavailable."
- Sudah punya Tenant→Entity→Store→Employee sendiri (`ORGANIZATION_REGISTRY.md`),
  dibangun independen dari Leker. Format ID beda (`ent_*`/`sto_*`/`emp_*` vs Leker
  yang pakai `ENT-<kode>` dst dari `migrations/0039`/`0050`).
- Employee model Workboard justru **lebih rapi** dari Leker: `employees.job_role`
  (fungsi bisnis, mis. ACCOUNTANT/HR/CS) dipisah tegas dari permission role
  (`users.role`/`identity_role`) — pola persis yang diminta instruksi Bos Cyo, sudah
  ada dan sudah didokumentasikan eksplisit (`ORGANIZATION_REGISTRY.md:42-48`).
- **Tapi Employee sepenuhnya terisolasi dari User login sendiri** — dikonfirmasi
  lewat audit langsung: tidak ada kolom `employee_id` di tabel `users` maupun di
  manapun. Jadi bahkan di dalam Workboard sendiri, hipotesis "Employee Master →
  Workboard membership" di instruksi awal **belum berlaku** — itu masih daftar
  "Deferred work" (`ORGANIZATION_REGISTRY.md:73-86`).
- Cuma ada **satu** Tenant (seed `'maxi'`), tidak ada API pembuatan Tenant baru.
- Audience/Visibility (siapa boleh lihat Task/Announcement/Finding) sudah terpisah
  bersih dari Organization Scope (Entity/Store) — pola bagus, tidak tercampur,
  dikonfirmasi tidak ada FK/logic silang antara `resource_audience_rules` dan
  `organization_entities`/`organization_stores`.
- Tidak ada tabel fakta KPI — baru disebut sebagai kemungkinan analisis masa depan
  di dokumentasi, bukan skema.
- Tidak ada module entitlement — eksplisit didaftar sebagai "Deferred work".
- Utang teknis: skema tersebar di dua sumber yang tidak sinkron — file `migrations/`
  vs runtime schema bootstrap di kode Worker (`db:migrate:remote` sengaja dibuat
  no-op). Ini kebalikan dari disiplin Leker (`CLAUDE.md` invariant #7: migration
  file adalah satu-satunya sumber kebenaran skema).

## B. Problem Map

1. **Dua identitas Tenant/Entity/Store yang tidak nyambung.** Leker dan Workboard
   sama-sama punya konsep ini, dibangun sendiri-sendiri, format ID beda, tidak ada
   pemetaan sama sekali di antara keduanya.
2. **Employee tidak ada di Leker, dan tidak nyambung ke User bahkan di Workboard.**
   Dua masalah beda yang harus dibenerin dua-duanya.
3. **Job Role vs Permission Role** — Workboard sudah benar memisahkan. Leker tidak
   punya konsep job role sama sekali.
4. **Effective work assignment** (kerja di gerai mana hari ini) tidak ada di
   manapun. Dibutuhkan supaya KPI Workboard nempel ke gerai yang **benar-benar**
   dikerjakan, bukan "gerai rumah" — persis skenario Indah/Gerai-5 di instruksi.
5. **Module entitlement lintas-app** — ADR-040 sudah menjawab untuk modul di dalam
   Leker (tabel pendaftaran per-tenant, bukan kolom). Workboard butuh konsep yang
   sama tapi belum ada sama sekali.
6. **Tidak ada jawaban siapa nge-host identitas kanonik.** `maxi-platform` disebut
   di README Workboard dan `DEPLOYMENT.md` sebagai tujuan akhir, tapi "governance
   unavailable" — belum siap dipakai.
7. **Utang skema Workboard** (migration vs runtime bootstrap) berisiko menular kalau
   Organization & People dipindah dari sana tanpa dibereskan lebih dulu.

## C. Proposed Canonical Model

```
Tenant (customer MAXI — satu per bisnis yang berlangganan)
├── Entity (badan usaha/unit operasional dalam satu Tenant)
│   └── Store (gerai/outlet, operasional murni)
│
├── Employee (satu manusia, milik Tenant langsung — BUKAN milik satu Entity/Store)
│   └── Assignment (Employee x Entity/Store x Position, PRIMARY atau BACKUP)
│       └── Effective Work Context (di-resolve per tanggal/shift, tidak disimpan statis)
│
├── Position (slot jabatan/fungsi — opsional di fase awal, lihat Decision Gate #1)
│
└── Application Membership (akun per aplikasi, menempel ke Employee)
    ├── Workboard `users.employee_id` (kolom BARU, belum ada)
    └── Leker `cashiers.employee_id` (kolom BARU, belum ada)
```

Employee sengaja tidak dimiliki satu Entity/Store, supaya orang yang kerja di
beberapa gerai tetap satu identitas — ini mempertahankan pola yang Workboard sudah
pilih sendiri secara independen, bukan pola baru.

## D. Domain Ownership Matrix

| Konsep | Pemilik kanonik | Konsumer |
|---|---|---|
| Tenant, Entity, Store | **Organization & People Core (baru)** | Leker (referensi), Workboard (referensi) |
| Employee, Position, Assignment | **Organization & People Core (baru)** | Leker, Workboard |
| Effective Work Context | **Organization & People Core**, fakta sumbernya dari Leker (kehadiran kasir) | KPI engine, Workboard |
| Module entitlement (modul di dalam Leker) | Leker (registry `ADR-040`) | Leker sendiri |
| Module entitlement (Workboard/lintas-app) | **Organization & People Core (baru)** | Workboard |
| Sales/Purchase/Expense/Production facts | Leker (POS Core) | Accounting (business fact saja) |
| Task/Issue/Finding/Announcement | Workboard | KPI engine (baca fakta) |
| Journal/Accounting interpretation | Leker Accounting module | — |
| KPI personal + Store | KPI engine (konsumer fakta, bukan pencatat) | Payroll (di luar cakupan ADR ini) |

## E. Database Architecture

**Tidak ada database gabungan Workboard+Leker.** Ini beda dari arah "satu database"
yang `ADR-040` pilih untuk modul-modul **di dalam** Leker (Olshop/F&B/Accounting,
dst — itu tetap satu database, kontrak yang menjaga batasnya). Workboard beda kelas:
Worker terpisah, siklus deploy terpisah, dan dokumennya sendiri **sudah** memilih
jalur API/adapter, bukan gabung database (`ARCHITECTURE.md:109-113`: "Leker or
another application should pass verified tenant/user/outlet references through an
adapter and must not write Workboard tables... directly"). Membalik keputusan yang
sudah berjalan itu tanpa alasan kuat bukan pilihan yang baik, dan tidak ada alasan
kuat untuk itu di sini.

Yang dibutuhkan: **satu service/database baru, kecil, "Organization & People
Core"** — bukan hidup di Leker (jangan Leker jadi master cuma karena Tenant/Store-nya
sudah hidup duluan), bukan hidup di Workboard (jangan Workboard jadi master cuma
karena panel Organization-nya sudah ada duluan). Servis ini yang mencetak ID
kanonik Tenant/Entity/Store/Employee; Leker dan Workboard menyimpan referensi ID
itu, tidak mencetak identitas sendiri lagi.

**Trade-off:**
- Servis baru = infrastruktur baru yang harus dijaga (Worker+D1 lagi). Ongkos
  operasional bertambah.
- Alternatifnya (memilih salah satu dari yang sudah ada jadi "host") langsung
  melanggar batasan eksplisit di instruksi Bos Cyo sendiri (jangan Workboard atau
  Leker otomatis jadi master organisasi).
- `maxi-platform` disebut sebagai tujuan akhir di dokumen Workboard sendiri, tapi
  belum siap. Servis baru ini bisa dianggap cikal-bakal `maxi-platform` versi paling
  minim — bukan proyek buangan nanti.

## F. ID Strategy

Pola prefiks Workboard (`ent_*`, `sto_*`, `emp_*`) sudah battle-tested di sana.
Leker pakai pola beda. **Rekomendasi:** pakai skema baru yang konsisten dengan pola
Workboard (`ten_*`/`ent_*`/`sto_*`/`emp_*`/`pos_*`/`asg_*`), dicetak ulang dari
Organization & People Core — bukan sekadar menyambung ke tabel Workboard yang ada
sekarang, supaya tidak ada kesan salah satu sistem "menang" atas yang lain.

ID lama (Leker `ENT-GALEH` dst, Workboard `ent_xxx` yang sudah ada) **tidak
langsung dihapus** — disimpan sebagai `external_id` + `source_system` pada baris
kanonik yang baru, supaya data lama tetap bisa ditelusuri baliknya. Migrasi ini
murah dilakukan **sekarang**: Leker baru 2 Tenant dan sedikit Entity/Store, Workboard
baru 1 Tenant — sama seperti observasi instruksi Bos Cyo sendiri soal data yang
masih awal.

## G. Authorization Model

Prinsip yang **sudah** sama-sama dipegang kedua sistem, dibangun independen tanpa
saling contek: tenant identity berasal dari sesi server-side, tidak pernah dari
input klien. Leker: `resolveAuthorizedEntityIds()`. Workboard: "Tenant identity
comes from the authenticated server-side session... never trusted as authorization
context" (`ARCHITECTURE.md:24`). Organization & People Core meneruskan prinsip yang
sama: tiap request membawa token yang di-resolve ke Employee + set Tenant/Entity/
Store yang authorized — tidak pernah menerima ID dari body/query sebagai sumber
kebenaran otorisasi.

## H. Employee & Assignment Model

- **Employee** — satu identitas manusia per Tenant (bukan per Entity/Store): nama,
  kode opsional, status aktif.
- **Position** — slot fungsi/jabatan. Lihat Decision Gate #1, belum final wajib ada
  di fase awal atau tidak.
- **Assignment** — Employee x (Entity atau Store) x Position, tipe PRIMARY atau
  BACKUP. Ini yang belum ada di manapun, harus dibangun baru sepenuhnya.
- **Effective Work Context** — bukan tabel yang disimpan permanen, tapi hasil
  resolve per tanggal: Assignment PRIMARY jadi default, override manual (backup
  yang benar-benar dipakai hari itu) menyimpan baris kecil terpisah, tidak menimpa
  Assignment aslinya. Siapa yang mencatat override ini — Decision Gate #2.

## I. Workboard Team Model

Hipotesis awal instruksi Bos Cyo (Employee Master → Workboard membership) **belum
berlaku hari ini** — audit mengonfirmasi `users` Workboard tidak punya
`employee_id` sama sekali. Jadi bukan cuma Leker yang perlu disambungkan ke
Employee baru; Workboard sendiri juga butuh kolom `users.employee_id` (FK ke
Organization & People Core) yang saat ini tidak ada. Bukan pekerjaan besar, tapi
jangan diasumsikan sudah beres.

## J. Leker Integration Model

`cashiers` mendapat kolom baru `employee_id` (nullable dulu, backfill belakangan).
Identitas tampilan tetap `employee_name`, tapi kepemilikan/keunikan orang pindah ke
`employee_id`. Satu Employee bisa punya banyak baris `cashiers` (satu per gerai
tempat dia kerja) — pola yang diminta di instruksi (akun A Gerai 1 primary, akun B
Gerai 5 backup) langsung terpetakan ke sini tanpa mengubah struktur `cashiers` yang
ada, cukup menambah satu kolom.

## K. KPI Model

Tidak ada di manapun sekarang. Perlu tabel fakta baru di Workboard:
`task_execution_fact` (tenant_id, entity_id, store_id, employee_id, assignment_id,
task_id, completed_at, dst), diisi Workboard saat task selesai; entity_id/store_id
diambil dari Effective Work Context **saat itu** (bukan home Store Employee) — ini
yang membuat skenario "Indah backup di Gerai 5" terjawab benar. Workboard mencatat
fakta saja. Siapa menghitung skor KPI — Decision Gate #3.

## L. Module Entitlement Model

`ADR-040` sudah menetapkan bentuknya untuk modul di dalam Leker (tabel pendaftaran,
bukan kolom, per-tenant, versioned seperti `entity_tenancy`). Untuk Workboard:
konsepnya sama, tapi entitlement-nya (Workboard ON/OFF per Entity) sebaiknya juga
tinggal di Organization & People Core — supaya satu Tenant bisa bertanya "modul apa
saja yang aktif" ke satu tempat, tidak perlu bertanya ke Leker untuk modul Leker
dan ke Workboard untuk modul Workboard secara terpisah.

## M. Management Panel Design

Satu panel baru, "MAXI Platform Admin", terpisah dari panel Organization yang sudah
ada di Workboard sekarang (yang itu jadi tidak relevan lagi begitu Core berdiri —
bukan dihapus paksa, tapi jalur baca/tulisnya dipindah ke Core lewat adapter, pola
yang sama seperti fase migrasi Leker di ADR-030).

Permission (mengikuti batasan eksplisit di instruksi: Tenant Owner tidak otomatis
bisa membuat Tenant baru):

- **Platform Admin** (Bos Cyo/operator MAXI): membuat Tenant baru.
- **Tenant Owner**: membuat/menonaktifkan Entity & Store dalam Tenant-nya sendiri,
  mengelola Employee master.
- **Entity/Store Manager** (opsional) — Decision Gate #4.

## N. Migration Plan

Urutan direvisi dari draf instruksi Bos Cyo berdasarkan temuan audit ini:

0. **Audit lintas-sistem** — selesai, ini dokumennya.
1. **Organization & People Core berdiri** — Tenant/Entity/Store/Employee/Position/
   Assignment, ID kanonik baru, kosong dulu.
2. **Migrasi identitas Leker** — 2 Tenant, sedikit baris, dipetakan ke ID kanonik,
   `external_id` disimpan. Leker tetap baca/tulis tabelnya sendiri, cuma menambah
   kolom referensi.
3. **Migrasi identitas Workboard** — pola sama, 1 Tenant.
4. **Employee master + Assignment** — mulai dari nol (tidak ada yang dimigrasi,
   hanya didaftarkan: Employee mana kerja di mana).
5. **`cashiers.employee_id` dan `users.employee_id`** — menyambungkan akun aplikasi
   ke Employee kanonik.
6. **Effective Work Context + tabel fakta KPI** — baru bisa jalan setelah Assignment
   ada.
7. **Module entitlement terpusat** — menyambung ke registry ADR-040 punya Leker +
   membangun versi Workboard.
8. **Panel MAXI Platform Admin** — begitu Core sudah punya cukup data untuk diurus
   lewat UI, bukan migrasi manual.

Employee+Position+Assignment digabung jadi satu fase (4), berbeda dari draf awal
yang memisahkan Employee lebih dulu — Position/Assignment tidak berguna sendirian
tanpa Employee, memisahkannya hanya menambah satu deploy ekstra tanpa manfaat.

## O. Implementation Steps

Ringkas per fase — detail brief per-task ditulis saat fase itu mulai, mengikuti
disiplin yang sudah berjalan di `ADR-030`/`ADR-039`/`ADR-040`: audit dulu baru
task, jangan tulis brief untuk kerjaan yang belum diverifikasi ke kode.

Tiap fase, tanpa kecuali: goal tertulis eksplisit; path yang disentuh diverifikasi
ke kode dulu (bukan ditebak); migration aditif; test yang membuktikan Tenant lama
tidak berubah perilaku; rollback berupa additive-revert (kolom baru nullable, tabel
baru boleh dibiarkan kalau gagal, tidak butuh rollback destruktif); Decision Gate
ditandai eksplisit sebelum fase itu mulai kalau ada yang belum di-ACC.

## P. Decision Gates — kembali ke Bos Cyo

1. **Position wajib di fase awal, atau ditunda seperti kalender fiskal
   Consolidation Group kemarin?** Rekomendasi Hana: **ditunda.** Assignment bisa
   jalan cukup dengan Entity/Store + tipe (PRIMARY/BACKUP) tanpa Position dulu —
   Position baru relevan kalau ada kebutuhan nyata (payroll per-jabatan, dst).
   Menambah Position sekarang berarti menebak kebutuhan yang belum terbukti.
2. **Siapa mencatat "kerja di gerai lain hari ini"** — Leker (kasir login di sana
   tiap hari) atau Workboard (assignment konsepnya di sana)? Rekomendasi Hana:
   **Leker** — itu tempat fakta "siapa check-in hari ini" benar-benar terjadi
   (`staff_attendance` sudah ada); Workboard tinggal membaca fakta itu lewat Core,
   tidak mencatat sendiri.
3. **Siapa menghitung skor KPI** — Workboard sendiri, atau modul KPI terpisah?
   Rekomendasi Hana: **Workboard dulu** (hitungan sederhana), pindah ke modul
   terpisah kalau aturan KPI berkembang rumit (skor gabungan lintas-app, weighting,
   dst) — disiplin yang sama dengan "jangan bangun untuk kebutuhan yang belum
   terbukti".
4. **Entity/Store Manager sebagai role terpisah** — perlu dari awal atau ditunda?
   Rekomendasi Hana: **ditunda**, Tenant Owner cukup untuk skala 2 Tenant hari ini.
5. **Siapa menge-host Organization & People Core** — servis/Worker+D1 baru yang
   benar-benar terpisah dari Leker dan Workboard, atau menumpang salah satu dulu
   sambil menunggu `maxi-platform` siap? Rekomendasi Hana: **servis baru, minimal.**
   Menumpang salah satu, walau "sementara", berisiko keterusan jadi permanen —
   persis pola yang melahirkan salinan paralel Ikan Galeh (`ADR-040` temuan #1).
6. **Bentuk teknis pasti** (nama tabel, tipe kolom persis) — sengaja tidak dikunci
   di sini, mengikuti pola `ADR-040`/`module-contract-v1.md`: bentuknya milik
   implementer setelah membaca kode, batasannya (pertanyaan wajib terjawab) yang
   dikunci di dokumen arsitektur.

## Yang sengaja tidak dijawab di sini

- **Payroll, posting Accounting dari KPI/Workboard** — di luar cakupan mutlak,
  sesuai batasan eksplisit di instruksi. KPI hanya menyediakan fakta, tidak pernah
  menghitung gaji atau menulis jurnal.
- **Batas modul Olshop vs F&B yang presisi** — prosesnya sudah dijawab di
  `ADR-040`/`module-contract-v1.md` (audit + aturan pemutus), tidak diulang di sini.
- **Kapan `store_id` berhenti jadi batas isolasi** — itu `ADR-030` Fase 3, jalan
  terpisah, sengaja tidak digabung ke sini.

## DOC-IMPACT

**REQUIRED** setelah Decision Gates di-ACC dan Fase 1 mulai — `MODULE_CATALOG.md`,
`program-task/docs/ORGANIZATION_REGISTRY.md` (jadi usang begitu Core berdiri —
Workboard tidak lagi jadi sumber kanonik organisasinya sendiri),
`program-task/docs/ARCHITECTURE.md` bagian "Future MAXI integration".

ARCHITECTURE STATUS: **BLOCKED FOR DECISION** — enam Decision Gate di atas perlu ACC
Bos Cyo sebelum Fase 1 (Organization & People Core berdiri) ditulis jadi task papan.

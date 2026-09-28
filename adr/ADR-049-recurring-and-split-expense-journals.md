# ADR-049 — Jurnal Beban Rutin + Split Beban per Periode

Status: PROPOSED — desain lengkap, siap dikerjakan Karen; beberapa default dipilih Hana secara
eksplisit di bawah (bukan pertanyaan terbuka) supaya tidak menunda pengerjaan, tapi tetap
dicatat supaya Bos Cyo bisa koreksi kalau salah tebak.
Tanggal: 2026-09-28
Diminta oleh: Bos Cyo ("Pembuat & Split Jurnal Beban")

## Context

Bos Cyo minta dua fitur yang berkaitan, tujuan besarnya menggantikan pekerjaan akuntan manusia:

1. **Jurnal Beban Rutin** — beban yang berulang (Beban Lapak, Listrik, WiFi, dst) dibuatkan
   template sekali, lalu sistem yang mengingatkan/membuatkan jurnalnya tiap jatuh tempo — tanpa
   admin gerai perlu tahu istilah akuntansi atau mengetik jurnal manual tiap bulan.
2. **Split Beban per Periode** — satu jurnal yang sudah ada (mis. Deposit Lapak Rp1.500.000)
   dipecah jadi beban harian merata selama periode manfaatnya (mis. 30 hari × Rp50.000), supaya
   Laporan Laba Rugi harian tidak menampilkan lonjakan beban di satu tanggal pembayaran padahal
   manfaatnya dipakai berhari-hari.

Bos Cyo eksplisit: "bikin ui/ux segampang mungkin ... aku akan menyuruh agent untuk mengerjakan
kerjaan itu semua" — jadi dokumen ini yang jadi acuan implementasi Karen, bukan Hana yang
mengetik kodenya.

## Kenapa dua fitur ini satu mesin yang sama

Baik "beban rutin" maupun "split beban" pada dasarnya sama: **satu rencana yang menghasilkan
banyak jurnal kecil pada tanggal-tanggal yang sudah ditentukan**. Bedanya cuma:

| | Beban Rutin | Split Beban |
|---|---|---|
| Jumlah kemunculan | Tanpa batas (sampai dimatikan) | Tetap (jumlah hari yang dipilih) |
| Nominal tiap kemunculan | Sama tiap kali | Total dibagi rata, sisa pembulatan ke hari terakhir |
| Sumbernya | Tidak ada jurnal sumber | Mengacu ke satu jurnal yang sudah ada |
| Konfirmasi | Bisa auto atau nunggu klik (per template) | Auto (keputusan sudah diambil sekali waktu buat split) |

Karena itu **satu tabel jadwal** (`accounting_journal_schedules`) dipakai untuk dua-duanya, dibedakan kolom `kind`. Ini mengurangi kode yang harus dijaga dobel dan memastikan keduanya konsisten (idempotency, pembulatan, jejak audit) dari mesin yang sama.

## Decision

### 1. Skema (migration baru, nomor urut berikutnya sesudah 0124)

```sql
CREATE TABLE accounting_journal_schedules (
  id                  TEXT PRIMARY KEY,
  store_id            TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('RECURRING', 'SPLIT')),
  name                TEXT NOT NULL,
  debit_account_id    TEXT NOT NULL,   -- akun Beban
  credit_account_id   TEXT NOT NULL,   -- akun Hutang/Lawan (RECURRING) atau akun yang di-split (SPLIT)
  amount_scaled       INTEGER,         -- RECURRING: nominal tetap tiap kemunculan. SPLIT: NULL (dihitung dari total_amount_scaled/total_occurrences)
  total_amount_scaled INTEGER,         -- SPLIT only: total yang dipecah. RECURRING: NULL
  start_date          TEXT NOT NULL CHECK (start_date GLOB '????-??-??'),
  end_date            TEXT CHECK (end_date IS NULL OR end_date GLOB '????-??-??'), -- SPLIT: wajib diisi. RECURRING: NULL = tanpa batas
  recurrence_type     TEXT NOT NULL CHECK (recurrence_type IN ('DAILY', 'WEEKLY_ON_DAY', 'MONTHLY_ON_DAY')),
  recurrence_value    INTEGER NOT NULL DEFAULT 0, -- hari-dalam-minggu (0-6) untuk WEEKLY, tanggal (1-31) untuk MONTHLY, diabaikan untuk DAILY
  total_occurrences   INTEGER,         -- SPLIT: jumlah hari (dihitung dari start/end date). RECURRING: NULL (tanpa batas)
  auto_create         INTEGER NOT NULL DEFAULT 0 CHECK (auto_create IN (0, 1)),
  source_journal_id   TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT, -- SPLIT only, jurnal sumber yang di-split
  occurrences_generated INTEGER NOT NULL DEFAULT 0,
  last_generated_date TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (debit_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (credit_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT
);

CREATE TABLE accounting_journal_schedule_occurrences (
  id              TEXT PRIMARY KEY,
  schedule_id     TEXT NOT NULL REFERENCES accounting_journal_schedules(id) ON DELETE RESTRICT,
  store_id        TEXT NOT NULL,
  occurrence_date TEXT NOT NULL CHECK (occurrence_date GLOB '????-??-??'),
  amount_scaled   INTEGER NOT NULL CHECK (amount_scaled > 0),
  status          TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'POSTED', 'SKIPPED')),
  journal_id      TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (schedule_id, occurrence_date)
);
```

`accounting_journal_schedule_occurrences` menyimpan **rencana**, bukan cuma riwayat: untuk SPLIT,
begitu "Buat Split" diklik, SEMUA baris (30 hari di contoh Bos Cyo) langsung dibuat sekaligus
sebagai `PLANNED` dengan nominalnya masing-masing — supaya preview dan pelacakan langsung utuh
tanpa menunggu tanggalnya tiba. Untuk RECURRING, baris cukup dibuat satu per satu begitu jatuh
tempo (tidak ada horizon akhir untuk dihitung dulu).

### 2. Kapan jurnal sungguhan diposting (invariant #6 — tanpa polling)

**Lazy, dipicu waktu ada yang membuka layarnya** — pola yang sama dengan
`forceCloseOverdueSessions` (presensi) — BUKAN cron/scheduled worker (belum ada infrastruktur
cron di proyek ini; menambahkannya HANYA untuk fitur ini tidak sepadan). Setiap kali
`GET /api/admin/accounting` (bootstrap workspace) dipanggil:

1. Cari semua occurrence `PLANNED` dengan `occurrence_date <= hari ini`.
2. Untuk schedule `auto_create = 1` (termasuk semua SPLIT — lihat keputusan #3): posting
   langsung lewat `postAccountingJournal()`, occurrence jadi `POSTED` + `journal_id` terisi.
3. Untuk schedule `auto_create = 0`: JANGAN posting. Occurrence itu tetap `PLANNED` dan muncul di
   bootstrap response sebagai daftar "Menunggu Dibuat" untuk ditampilkan admin, dengan dua tombol
   per baris: **Buat Sekarang** (posting occurrence itu) dan **Lewati** (occurrence itu jadi
   `SKIPPED` tanpa membuat jurnal, tidak akan ditanya lagi).
4. Kalau ada occurrence `PLANNED` untuk RECURRING yang jatuh tempo belum pernah dibuat baris
   occurrence-nya sama sekali (baris memang belum ada karena RECURRING generate satu-per-satu),
   hitung dulu tanggal jatuh tempo berikutnya dari `last_generated_date` + `recurrence_type` +
   `recurrence_value`, buat baris occurrence-nya (`PLANNED`), baru proses seperti langkah 2/3.

Idempotency: `sourceReferenceId = 'schedule_' || scheduleId || '_' || occurrenceDate`,
`idempotencyKey = 'ACCOUNTING_SCHEDULE:' || storeId || ':' || scheduleId || ':' || occurrenceDate`,
`correlationId = scheduleId` (supaya semua jurnal satu schedule bisa dicari lewat satu
`correlationId` — kolom ini sudah ada di `accounting_journal_headers`, tidak perlu kolom baru).
`sourceSystem = 'ACCOUNTING_SCHEDULE'`.

### 3. Split diposting otomatis, tanpa konfirmasi per hari

Keputusan sudah diambil sekali waktu admin mengisi form Split dan klik "Buat Split" — menanyakan
ulang tiap hari cuma menambah beban tanpa nilai. Jadi **`auto_create` untuk `kind = 'SPLIT'`
selalu 1**, tidak ada pilihan di form Split. `auto_create` yang bisa dipilih admin (checkbox
"Buat otomatis tanpa konfirmasi") hanya ada di form **Beban Rutin**.

### 4. Pembulatan Split — total akhir wajib persis sama

`total_amount_scaled ÷ total_occurrences` dengan sisa pembagian (modulo) ditambahkan ke
occurrence **terakhir**, bukan dibagi rata pakai desimal. Contoh Rp1.500.000 ÷ 30 hari = pas
Rp50.000/hari (tidak ada sisa di contoh Bos Cyo), tapi kalau totalnya Rp1.000.000 ÷ 30 hari =
Rp33.333,33...: 29 hari pertama dapat Rp33.333 (dibulatkan ke bawah dalam satuan scaled), hari
ke-30 dapat sisanya supaya total scaled SUM == `total_amount_scaled` **persis**, integer, tanpa
sen yang hilang. Ini bukan toleransi Penyesuaian (invariant #3) — ini alokasi exact dari
algoritma sendiri, jadi tidak boleh lewat akun `SYS-ADJ`.

### 5. Split — akun apa saja yang boleh di-split, dan default akun lawan

- Tombol "Split Beban" cuma muncul di jurnal dengan **persis 2 baris** dan salah satu baris
  DEBIT ke akun bertipe ASSET (uang muka/deposit/dibayar dimuka) — pola yang sudah ada di sistem
  (1401 Uang Muka/Deposit, ADR-046). Jurnal dengan bentuk lain (lebih dari 2 baris, atau tidak
  ada sisi ASSET) tidak menawarkan opsi ini — Split di luar pola itu berisiko salah tafsir
  akuntansi dan Hana tidak menganggapnya wajib untuk versi pertama.
- Form Split: **Akun Lawan** (akun yang berkurang tiap hari) di-default ke akun ASSET yang
  didebit di jurnal sumber, tapi tetap bisa diganti admin (sesuai daftar field UI yang diminta
  Bos Cyo). **Akun Beban** dipilih bebas dari akun tipe EXPENSE.
- Jurnal sumber **tidak diubah sama sekali** (invariant #2) — Split cuma membuat jurnal-jurnal
  BARU yang mengacu balik ke jurnal sumber lewat `source_journal_id`.

### 6. UI (dua layar baru di tab Akuntansi, sesederhana mungkin)

**Layar "Beban Rutin"** (daftar + form):
- Daftar template aktif: nama, nominal, jatuh tempo berikutnya, status (Auto/Perlu Konfirmasi).
- **Banner "N jurnal menunggu dibuat"** di atas kalau ada occurrence `PLANNED` milik template
  `auto_create = 0` yang sudah jatuh tempo — per baris ada tombol **Buat Sekarang** / **Lewati**.
- Form buat/ubah: Nama, Nominal, Akun Beban (dropdown akun EXPENSE), Akun Lawan (dropdown akun
  LIABILITY/ASSET), Mulai tanggal, Pola perulangan (pilihan sederhana: "Tiap bulan tanggal ..." /
  "Tiap minggu hari ..." / "Tiap hari"), checkbox "Buat otomatis tanpa konfirmasi".

**Layar/tombol "Split Beban"** — muncul di detail jurnal yang memenuhi syarat #5:
- Form: Nominal sumber (baca saja, dari jurnal), Tanggal mulai, Tanggal akhir, Jumlah hari
  (dihitung otomatis dari tanggal), Nominal per hari (dihitung otomatis, baca saja), Akun Beban,
  Akun Lawan (prefilled seperti #5).
- **Preview** tabel semua tanggal + nominal sebelum diklik "Buat Split" (hitung di klien, tidak
  perlu request ke server untuk sekadar preview).
- Sesudah dibuat: daftar occurrence (PLANNED/POSTED/SKIPPED) muncul di bawah jurnal sumber
  ("Dipecah jadi 30 beban harian, klik untuk lihat") — inilah pelacakan balik yang diminta Bos Cyo.

### 7. Notifikasi lewat chat (ide Caca)

Bos Cyo sendiri menandai ini "masih perlu dipertimbangkan lebih lanjut" — **tidak masuk cakupan
implementasi pertama**. Banner in-app (#6) sudah cukup untuk versi pertama. Kalau nanti asisten
chat (Caca/Hana pembukuan, `HANDOFF-HANA-PEMBUKUAN.md`) sudah ada, banner yang sama tinggal
disebutkan lewat chat tanpa mengubah mesin di balik layar.

## Consequences

- Tidak menambah infrastruktur baru (tidak ada cron, tidak ada Durable Object) — murni lazy
  check di jalur yang sudah ada, konsisten dengan pola presensi.
- `accounting_journal_schedules`/`_occurrences` jadi tabel baru yang perlu masuk daftar FK
  `ALLOWED_ACCOUNT_REFERENCE_TABLES`? **Tidak** — dia mereferensikan `chart_of_accounts`, bukan
  jadi registry akun baru, jadi tidak melanggar aturan `scripts/verify-remote-schema.mjs` soal
  "satu-satunya canonical account registry".
- Menghapus/menonaktifkan sebuah schedule (`is_active = 0`) menghentikan generate occurrence baru,
  tapi occurrence yang sudah `POSTED` (dan jurnalnya) tidak tersentuh — kalau perlu dibatalkan,
  lewat reversal per jurnal seperti biasa (invariant #2).
- Laporan Laba Rugi otomatis ikut benar tanpa perubahan, karena baik Beban Rutin maupun Split
  keduanya lewat `postAccountingJournal()` — jurnal biasa yang sudah dibaca laporan yang ada.

## Related

`ADR-046` (pola lazy dispatch + idempotency yang ditiru di sini), `CLAUDE.md` invariant #1-#4/#6,
`KNOWN_PITFALLS.md` bagian polling.

## DOC-IMPACT

Perbarui kalau: pola perulangan bertambah (mis. "tiap N hari custom"), Split diizinkan untuk
jurnal >2 baris, notifikasi chat sungguhan dibangun, atau mesin ini dipakai fitur lain di luar
Beban Rutin/Split.

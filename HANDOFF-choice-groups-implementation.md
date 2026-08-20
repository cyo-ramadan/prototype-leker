# Handoff — implementasi Setting Transaksi (Choice Group di kode/schema)

Disiapkan oleh: `hana1.1` — arsitektur
Tanggal: 2026-08-19, diperbarui 2026-08-20 (koreksi `account_id` + scope Fase 3-4,
ditemukan Karen lewat issue #107/#109)
Architecture: `adr/ADR-033-accounting-choice-groups.md` (baca §6-§9, §9 itu koreksinya)
Kontrak: `contracts/accounting-choice-groups-v1.md`

**Label UI-nya "Setting Transaksi"**, bukan "Choice Group"/"Resep" — nama tabel dan
kode tetap `accounting_choice_groups`/`accounting_choice_options`, istilah teknis
tidak pernah muncul ke admin.

**Status per fase (2026-08-20):**
- ✅ **Fase 1 — landed.** `migrations/0042_accounting_choice_groups.sql`,
  dikoreksi `migrations/0043_choice_option_account_optional.sql` (`account_id`
  jadi nullable — lihat `ADR-033` §9.1), `test/setting-transaksi-schema.test.js`
  (11 tes). Nol perubahan perilaku ke data yang sudah ada di kedua migration,
  dibuktikan tes yang membandingkan tabel sebelum/sesudah.
- 🔧 **Fase 3 & 4 — sedang dikerjakan Karen** lewat GitHub-only fallback
  (sesi Karen tidak punya akses D1 langsung — issue #107, #109). Scope-nya
  berubah dari draf semula, baca `ADR-033` §9.2-9.3 sebelum lanjut: `accounting-ledger.js`
  masuk Fase 3 paths, Cash Flow/Flow Preset **ditunda** ke follow-up terpisah.
- **Fase 2 (backfill baris `fixed_account` ganda lama) ditunda** — tidak
  memblokir Fase 3/4, dan tidak diminta Bos Cyo di scope §8. Kategori lama yang
  masih pakai baris `fixed_account` ganda terus jalan seperti sekarang.
- **Fase 5-6 (modul operasional, tutup compatibility window) ditunda** — sama
  alasannya, di luar scope §8.
- Dua pertanyaan `ADR-033` §6 yang dulu memblokir semuanya **sudah terjawab**
  (Cara Bayar dan Jenis Barang tetap di luar model ini sama sekali — jangan
  disentuh oleh pekerjaan ini). Pertanyaan nama masih terbuka tapi tidak
  memblokir — pakai "Setting Transaksi" apa adanya.

Baca dulu, berurutan: `CLAUDE.md` → `ADR-033` → kontrak di atas → `ADR-029` §boundary →
`ADR-031` §4 → `KNOWN_PITFALLS.md`.

## Aturan yang berlaku di seluruh fase

- Tiap fase **satu PR, satu migration**, hijau sendiri, bisa di-deploy tanpa fase
  berikutnya. Kalau sebuah fase hanya bisa hijau bersama fase lain, fasenya salah pecah
   — berhenti dan lapor, jangan digabung diam-diam.
- `npm test` dan `npm run check` wajib hijau. File `src/`/`public/` baru wajib
  ditambahkan ke script `check`.
- Tes yang ditambahkan harus **gagal bila perubahanmu dicabut**.
- Jangan memutuskan kebijakan akuntansi. Gagal-tertutup lalu tulis `escalations`.
- Jangan menyentuh `package.json` script `deploy`.
- Jangan pernah `DELETE` baris konfigurasi yang pernah menghasilkan jurnal.

## Fase 1 — schema, tanpa perubahan perilaku ✅ LANDED 2026-08-19

**Paths:** `migrations/0042_accounting_choice_groups.sql`,
`test/setting-transaksi-schema.test.js`

Selesai dikerjakan Hana. Yang mendarat:

1. `accounting_choice_groups`, `accounting_choice_options` (kolom `entity_id`
   nullable per `ADR-030`, sesuai `ADR-033` §4.4). **`accounting_choice_option_legacy_rules`
   belum dibuat** — itu milik Fase 2, yang ditunda (lihat status di atas).
2. `journal_rules` di-rebuild untuk menerima `source_type='choice_group'` + kolom
   `choice_group_id`. Ternyata ada jebakan yang tidak disebutkan draf semula:
   `ALTER TABLE ... RENAME TO` non-legacy memvalidasi **semua** trigger di schema
   terhadap state sebelum rename, termasuk trigger di tabel lain yang isi bodinya
   menyebut `journal_rules` (`trg_stores_seed_accounting_settings_defaults`,
   dll) — gagal dengan "no such table: journal_rules" walau trigger itu sama
   sekali tidak berhubungan dengan rename-nya. Perbaikannya: `PRAGMA
   legacy_alter_table = ON` sebelum drop+rename, `OFF` lagi sesudahnya. Lihat
   komentar di migration untuk detailnya kalau ketemu jebakan serupa lagi.
3. `accounting_journal_lines` + `choice_group_code`, `choice_option_code` (aditif).

**Acceptance — semua terbukti oleh `test/setting-transaksi-schema.test.js`:**
- kedua index dan kedua trigger yang menyentuh `journal_rules` masih ada sesudah rebuild;
- setiap baris `journal_rules` lama identik sebelum/sesudah 0042 (dibandingkan
  terhadap fixture yang berhenti satu migration sebelum 0042);
- membuat gerai baru masih menghasilkan set rule yang sama persis;
- `source_type='choice_group'` tanpa `choice_group_id` ditolak, dan sebaliknya,
  dan kombinasi keduanya sekaligus juga ditolak;
- guard cross-store (`trg_choice_option_scope_insert/update`) dan
  unique-default-per-group (`idx_choice_options_one_default`) punya tes sendiri;
- 305 tes total hijau (298 lama + 7 baru), tidak ada yang diubah.

## Fase 2 — migrasi data, jurnal harus identik (DITUNDA, di luar scope saat ini)

**Paths:** `migrations/0043_*.sql` (0042 sudah dipakai Fase 1),
`test/choice-groups-backfill.test.js`

Untuk tiap `(transaction_category_id, side)` yang punya **lebih dari satu** baris
`fixed_account` aktif:

1. buat satu group, `code` diturunkan dari kategori+sisi (mis. `OPERATIONAL_DEBIT`),
   `name` dari nama kategori;
2. tiap baris lama menjadi satu opsi `FIXED_ACCOUNT`; `code` opsi diturunkan dari
   `label` (`UPPER_SNAKE`, dedup dengan sufiks angka); `is_default` dan `sort_order`
   dibawa apa adanya;
3. tulis `accounting_choice_option_legacy_rules` untuk tiap id lama;
4. ganti baris-baris lama itu dengan **satu** rule `source_type='choice_group'`,
   `sort_order` = yang terkecil di antara mereka;
5. kategori dengan hanya satu baris `fixed_account` **tidak disentuh**.

**Acceptance — ini butir yang menentukan:**

> Ambil satu fakta `EXPENSE` yang bisa diposting sebelum migration, resolve lewat
> `resolvePosFactToJournalCommand`, simpan `journalLines`-nya. Jalankan migration.
> Resolve fakta yang sama. **Baris jurnalnya harus identik** — sisi, akun, dan nominal.

Tulis tes itu **lebih dulu**, sebelum menulis SQL migrationnya.

Tambahan acceptance: `expenses.accounting_component_rule_id` lama tetap me-resolve ke
akun yang sama lewat tabel legacy.

## Fase 3 — resolver

Status Fase 3: **IMPLEMENTED IN PR #113, CI GREEN; belum merge/deploy.**


**Mulai dari sini.** Baca `ADR-033` §8 dan **§9** (koreksi 2026-08-20, ditemukan Karen)
dulu — §9 mengubah tiga hal di bawah ini dari draf semula. `payment_method` dan
`item_category_*` **tetap tidak disentuh sama sekali** — itu bukan bagian dari
permintaan ini (`ADR-033` §6 butir 2-3).

**Paths:** `src/accounting-pos-bridge.js`, `src/accounting-ledger.js`,
`test/accounting-pos-bridge.test.js`, `test/choice-groups-resolver.test.js`

`src/accounting-cash-flow-bridge.js` **sengaja tidak ada di paths ini** — lihat butir 3.

1. Tangani `source_type='choice_group'` sesuai kontrak §2, termasuk urutan pemilihan
   opsi 1→4 dan kode kegagalan §2.1. **Tambahan (§9.1):** `account_id` opsi boleh
   `NULL` sejak `migrations/0043` — kalau opsi terpilih tidak punya akun aktif, gagal
   tertutup dengan `NEEDS_CHOICE_ACCOUNT`, jangan menebak atau melewatkan baris.
2. Isi `choice_group_code` / `choice_option_code` saat memposting — ini butuh
   `postAccountingJournal()` di `accounting-ledger.js` ikut ditulis ulang (§9.2), bukan
   cuma bridge-nya. Cek dulu `PRAGMA table_info` sebelum menulis kode: kolom itu sudah
   ada aditif sejak `0042`, tinggal diisi.
3. **Cash-flow bridge DITUNDA (§9.3) — jangan disentuh di fase ini.**
   `src/operational-posting.js::normalizeApprovalPayload()` untuk `CASH_FLOW` masih
   menulis `accountingCounterpartRuleId`, dan file itu di luar scope Fase 3 (business-app
   boundary). Kalau resolver arus kas dialihkan ke `choiceSelections` sekarang, tanpa
   writer-nya ikut berubah, pengajuan bisa tertolak sebelum sampai Accounting. Resolver
   POS boleh dibuat forward-compatible menerima `source_type='choice_group'`, tapi Cash
   Flow tetap jalur `fixed_account`/`requestedCounterpartRuleId` untuk sekarang. Migrasi
   writer-nya jadi follow-up terpisah dengan regression test Arus Kas sendiri.
4. **Jangan sentuh** cabang `fixed_account`, `payment_method`, `item_category_*`.
5. **Jangan** membuat reversal me-resolve ulang. `src/accounting-pos-reversal.js` tetap
   menyalin (`ADR-031` §4) — kalau kamu merasa perlu mengubahnya, itu tanda salah baca:
   berhenti dan lapor.

**Acceptance:** invariant 1, 5, 6, 7 di kontrak §6 punya tes masing-masing. Tes
invariant 5 harus membuktikan reversal tetap identik walau akun opsinya sudah diganti
di antara posting dan reversal. `NEEDS_CHOICE_ACCOUNT` punya tes yang membuktikan
resolver gagal tertutup, bukan diam.

## Fase 4 — Setting Akuntansi: API dan UI

Status Fase 4: **IMPLEMENTED IN STACKED PR; belum merge/deploy.**


**Paths:** `src/accounting-settings.js`, `public/admin-settings-panels.js`,
`public/admin-accounting-settings-*.js`,
`test/accounting-settings-choice-groups.test.js`

`public/admin-accounting-flow-presets.js` **sengaja tidak ada di paths ini** — lihat
butir 5 (§9.3).

1. Bootstrap `choiceGroups` + route CRUD sesuai kontrak §4. `account_id` di tiap opsi
   boleh kosong saat disimpan (§9.1) — jangan tolak simpan hanya karena belum ada akun.
2. Validasi simpan sesuai kontrak §5 — **semuanya**, terutama butir 6 (`ADR-032`), tapi
   validasi akun cuma jalan kalau `account_id` diisi.
3. Blocker baru `CHOICE_GROUP_EMPTY` masuk ke `postingBlockers`/`blockersForCategory`.
4. `usedByCategories` dan `journalLineCount` wajib ada. Itu cermin `ADR-031` §3, bukan
   fitur opsional — tanpa itu admin mengedit resep tanpa tahu apa yang ikut berubah.
5. **Jangan alihkan `admin-accounting-flow-presets.js` ke Choice Group di fase ini.**
   Preset hari ini menulis fixed-account counterpart yang masih dipahami writer Cash
   Flow (`operational-posting.js`) — mengalihkannya duluan bisa memutus Arus Kas yang
   sedang jalan. Migrasi preset menyusul sebagai follow-up terpisah setelah writer Cash
   Flow siap (§9.3).
5. Flow presets menulis Choice Group, bukan lagi baris `fixed_account` ganda.

## Fase 5 — modul operasional

**Paths:** `src/cashier-operational-expense.js`, `src/operational-posting.js`,
`public/cashier-procurement-ui.js`, `migrations/0043_*.sql`

1. `expenses.accounting_choice_selection TEXT` (aditif, nullable).
2. Kasir memilih dari opsi group, bukan dari daftar rule. Yang disimpan adalah
   `GROUP:OPTION`.
3. `accounting_component_rule_id` berhenti ditulis; yang lama tetap dibaca.
4. **Operasional tidak boleh punya foreign key ke tabel Accounting mana pun**, termasuk
   `accounting_choice_options`. Yang disimpan adalah kode, bukan id, dan bukan FK.
   Ini `ADR-029` dan invariant 4 di `CLAUDE.md`.

## Fase 6 — tutup compatibility window

Baru dikerjakan setelah tidak ada lagi baris `expenses` dengan
`accounting_component_rule_id` yang belum punya `accounting_choice_selection`.
Buktikan dengan query, jangan diasumsikan. Lalu drop tabel legacy dan alias
`NEEDS_COMPONENT_SELECTION`.

## Yang paling mudah salah

1. **Rebuild `journal_rules` menghilangkan trigger.** Cacat paling mahal di rencana ini,
   dan tidak ada tes existing yang menangkapnya sampai Fase 1 menambahkannya.
2. **Menganggap Jenis Barang sebagai resep.** Arity-nya berbeda; jurnalnya tetap balance
   walau salah. Lihat `ADR-033` §3.3.
3. **Menyimpan id opsi di tabel operasional.** Terasa lebih rapi daripada string kode,
   dan mengulang persis kebocoran yang ditutup `0038`.
4. **Membuat reversal me-resolve ulang lewat group.** Selisihnya tidak pernah muncul
   sebagai error.
5. **Menghapus opsi yang sudah dipakai** karena "toh sudah tidak terpakai". Jejak jurnal
   lama putus dan tidak ada yang gagal.

## Cara mengambil pekerjaan ini

Papan tugas ada di Cloudflare D1 `maxi-agent-bus`
(`cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6`, akun `25c5fe53877002648959e8dd35678188`).
Ikuti `agent-bus/CLAIM-PROMPT.md`: daftarkan sesi, klaim task, kerjakan hanya berkas di
`paths`, laporkan dengan bukti, dan **tulis handoff kalau tab penuh sebelum selesai**.

Kalau ada yang ambigu — arah transaksi, kebijakan akuntansi, kontrak antar-modul —
jangan menebak. Tulis baris di `escalations` lalu berhenti.

## DOC-IMPACT

**REQUIRED** — perbarui dokumen ini setiap satu fase mendarat: fase yang selesai
ditandai, dan apa yang dipelajari tapi tidak terlihat di kode ditulis di sini.

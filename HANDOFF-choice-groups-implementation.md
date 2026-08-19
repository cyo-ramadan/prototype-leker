# Handoff — implementasi Choice Group (Resep Akun)

Disiapkan oleh: `hana1.1` — arsitektur
Tanggal: 2026-08-19
Architecture: `adr/ADR-033-accounting-choice-groups.md`
Kontrak: `contracts/accounting-choice-groups-v1.md`

**Jangan mulai sebelum tiga pertanyaan di `ADR-033` §6 dijawab Bos Cyo.** Ketiganya
mengubah bentuk schema, bukan sekadar penamaan.

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

## Fase 1 — schema, tanpa perubahan perilaku

**Paths:** `migrations/0041_*.sql`, `test/choice-groups-schema.test.js`

1. `accounting_choice_groups`, `accounting_choice_options`,
   `accounting_choice_option_legacy_rules` sesuai kontrak §1.
2. **Rebuild `journal_rules`** untuk menerima `source_type = 'choice_group'` dan kolom
   `choice_group_id`. SQLite tidak bisa mengubah `CHECK`, jadi: buat tabel baru, salin,
   drop, rename, **pasang ulang semua index dan trigger**.
3. `accounting_journal_lines` + `choice_group_code`, `choice_option_code` (aditif).

**Risiko terbesar ada di butir 2.** Sebelum menulis, jalankan
`SELECT type, name, sql FROM sqlite_schema WHERE tbl_name='journal_rules'` di fixture
migrasi penuh dan **daftar semua** index/trigger yang menyentuhnya —
`idx_journal_rules_one_default` dan trigger seed
(`trg_stores_seed_accounting_settings_defaults`, `trg_purchase_category_rules_after_insert`,
`trg_sale_category_rules_after_insert`, dan padanan cash-flow/operational). Kehilangan
salah satunya baru ketahuan berbulan-bulan kemudian sebagai konfigurasi yang diam-diam
tidak terpasang di gerai baru — persis cacat yang baru saja diperbaiki migration `0040`.

**Acceptance:**
- semua index dan trigger yang menyentuh `journal_rules` masih ada sesudah rebuild,
  dibuktikan tes yang membandingkan daftar `sqlite_schema` sebelum dan sesudah;
- membuat gerai baru masih menghasilkan set rule yang sama persis seperti sebelum PR;
- `source_type='choice_group'` tanpa `choice_group_id` ditolak, dan sebaliknya;
- 283 tes lama tetap hijau tanpa satu pun diubah.

## Fase 2 — migrasi data, jurnal harus identik

**Paths:** `migrations/0042_*.sql`, `test/choice-groups-backfill.test.js`

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

**Paths:** `src/accounting-pos-bridge.js`, `src/accounting-cash-flow-bridge.js`,
`test/accounting-pos-bridge.test.js`, `test/choice-groups-resolver.test.js`

1. Tangani `source_type='choice_group'` sesuai kontrak §2, termasuk urutan pemilihan
   opsi 1→4 dan kode kegagalan §2.1.
2. Isi `choice_group_code` / `choice_option_code` saat memposting.
3. Cash-flow bridge: `requestedCounterpartRuleId` → `choiceSelections`, id lama tetap
   diterima selama compatibility window.
4. **Jangan sentuh** cabang `fixed_account`, `payment_method`, `item_category_*`.
5. **Jangan** membuat reversal me-resolve ulang. `src/accounting-pos-reversal.js` tetap
   menyalin (`ADR-031` §4) — kalau kamu merasa perlu mengubahnya, itu tanda salah baca:
   berhenti dan lapor.

**Acceptance:** invariant 1, 5, 6, 7 di kontrak §6 punya tes masing-masing. Tes
invariant 5 harus membuktikan reversal tetap identik walau akun opsinya sudah diganti
di antara posting dan reversal.

## Fase 4 — Setting Akuntansi: API dan UI

**Paths:** `src/accounting-settings.js`, `public/admin-settings-panels.js`,
`public/admin-accounting-settings-*.js`, `public/admin-accounting-flow-presets.js`,
`test/accounting-settings-choice-groups.test.js`

1. Bootstrap `choiceGroups` + route CRUD sesuai kontrak §4.
2. Validasi simpan sesuai kontrak §5 — **semuanya**, terutama butir 6 (`ADR-032`).
3. Blocker baru `CHOICE_GROUP_EMPTY` masuk ke `postingBlockers`/`blockersForCategory`.
4. `usedByCategories` dan `journalLineCount` wajib ada. Itu cermin `ADR-031` §3, bukan
   fitur opsional — tanpa itu admin mengedit resep tanpa tahu apa yang ikut berubah.
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

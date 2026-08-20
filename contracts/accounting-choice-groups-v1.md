# Accounting Choice Groups Contract v1

Status: ACTIVE — schema `0042` + correction `0043`, Fase 3 resolver, dan Fase 4 Setting Akuntansi API/UI active
Contract identifier: `MAXI_ACCOUNTING_CHOICE_GROUPS_V1`
Owner: Setting Akuntansi (configuration layer)
Architecture authority: `ADR-033-accounting-choice-groups.md`

Label UI untuk admin adalah **Setting Transaksi**. Nama canonical di schema dan kode tetap
*choice group* / *choice option*. Istilah `recipe` tidak dipakai karena sudah dimiliki
`manufacturing_recipes`.

## 1. Boundary dan ownership

- `accounting_choice_groups` menyimpan paket pilihan reusable.
- `accounting_choice_options` menyimpan pilihan di dalam group.
- Choice Option boleh hidup sebagai konfigurasi generic tanpa Account.
- `journal_rules.source_type = 'choice_group'` adalah titik sebuah group dipasang ke
  lane Accounting.
- Ketika Accounting benar-benar me-resolve option untuk posting, option tersebut wajib
  menunjuk `chart_of_accounts` aktif pada store yang sama.
- `chart_of_accounts` tetap satu-satunya Account Master. Choice Group tidak boleh menjadi
  registry akun kedua.
- `payment_methods` tetap satu-satunya registry cara bayar.
- `item_categories` dan `source_type = item_category_*` tetap resolver tersendiri.
- Cash Flow / Flow Preset belum memakai Choice Group pada Fase 3 karena writer
  Operasional masih memakai `accountingCounterpartRuleId`; lihat `ADR-033 §9.3`.

## 2. Schema aktif

### 2.1 `accounting_choice_groups`

Bentuk canonical yang landed di `migrations/0042_accounting_choice_groups.sql`:

```sql
CREATE TABLE accounting_choice_groups (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL,
  entity_id  TEXT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE (store_id, code)
);
```

`code` adalah identitas stabil untuk fakta dan provenance. Jangan mengandalkan label
`name` sebagai identifier.

### 2.2 `accounting_choice_options`

`0042` awalnya membuat `account_id NOT NULL`. Bos Cyo kemudian menetapkan pada
2026-08-20 bahwa link akun tidak wajib kecuali konfigurasi itu dipakai oleh Accounting.
`migrations/0043_choice_option_account_optional.sql` memperbaikinya secara forward-only:

```sql
CREATE TABLE accounting_choice_options (
  id              TEXT PRIMARY KEY,
  choice_group_id TEXT NOT NULL,
  store_id        TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  account_id      TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (choice_group_id) REFERENCES accounting_choice_groups(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (choice_group_id, code)
);
```

Scope trigger hanya memvalidasi Account ketika `account_id` terisi. `NULL` adalah state
valid pada konfigurasi generic, bukan error schema.

### 2.3 `journal_rules`

`0042` menambah `choice_group_id` dan source type baru `choice_group`.

Invariant bentuk rule:

```text
fixed_account  -> fixed_account_id terisi, choice_group_id NULL
choice_group   -> choice_group_id terisi, fixed_account_id NULL
source lainnya -> keduanya NULL
```

Rule lama `fixed_account`, `payment_method`, `item_category_*`, dan `cost_center_cash`
tidak dimigrasi atau diubah oleh Fase 3.

### 2.4 `accounting_journal_lines`

`0042` menambah snapshot provenance immutable:

```sql
choice_group_code  TEXT NOT NULL DEFAULT ''
choice_option_code TEXT NOT NULL DEFAULT ''
```

Keduanya harus kosong bersama atau terisi bersama. Journal line yang lahir dari
Choice Group menyimpan kedua kode tersebut saat posting. Laporan historis tidak boleh
menjoin balik konfigurasi sekarang untuk menentukan arti jurnal lama.

## 3. Resolusi Fase 3

Satu rule `source_type = 'choice_group'` menghasilkan **tepat satu** journal line.

Urutan pemilihan option:

1. Cari selection eksplisit dari `fact.choiceSelections[]` dengan `groupCode` yang sama.
2. Jika fakta tidak memilih dan hanya ada satu option aktif, gunakan option itu.
3. Jika ada beberapa option aktif dan satu default aktif, gunakan default.
4. Selain itu fail closed `NEEDS_CHOICE_SELECTION`.

Jika fakta mengirim `optionCode` yang tidak ada atau tidak aktif, fail closed
`NEEDS_CHOICE_OPTION`.

Setelah option terpilih:

```text
option.account_id kosong       -> NEEDS_CHOICE_ACCOUNT
akun tidak ada / tidak aktif   -> NEEDS_CHOICE_ACCOUNT
akun aktif pada store yang sama -> resolve
```

Tidak ada fallback Account dan tidak ada Account yang ditebak dari tipe transaksi.

Output line:

```text
accountId        = option.account_id
side             = journal_rule.side
amountScaled     = seluruh nominal transaksi untuk rule tersebut
label            = <rule.label> · <option.name>
choiceGroupCode  = group.code
choiceOptionCode = option.code
```

Dua rule Choice Group yang kebetulan resolve ke Account yang sama tetap dua journal
lines berbeda. Provenance tidak boleh hilang karena account aggregation.

## 4. Kode kegagalan

| Kode | Arti | Status bridge |
|---|---|---|
| `NEEDS_CHOICE_GROUP` | rule tidak menunjuk group aktif yang valid | `NEEDS_CONFIGURATION` |
| `NEEDS_CHOICE_SELECTION` | fakta perlu memilih option dan tidak ada fallback deterministik | `NEEDS_CONFIGURATION` |
| `NEEDS_CHOICE_OPTION` | option yang diminta tidak ada / tidak aktif | `NEEDS_CONFIGURATION` |
| `NEEDS_CHOICE_ACCOUNT` | option terpilih belum punya Account aktif | `NEEDS_CONFIGURATION` |
| `JOURNAL_LINE_CHOICE_PROVENANCE_INVALID` | hanya satu dari group/option provenance yang diberikan | posting ditolak |

Kode legacy dari lane `fixed_account` tetap berlaku untuk lane lama. Fase 3 tidak
memaksa transaksi existing pindah ke Choice Group.

## 5. Provenance dan reversal

`postAccountingJournal()` menerima optional `choiceGroupCode` + `choiceOptionCode` pada
journal line sebagai pasangan. Pair itu divalidasi lalu disimpan atomically bersama line.

`getAccountingJournal()` mengembalikan provenance yang tersimpan.

Reversal **tidak** me-resolve Choice Group menggunakan konfigurasi terbaru. Ketika
journal reversal adalah exact opposite dari journal sumber, provenance disalin dari
journal sumber bersama Account snapshot yang memang dibalik. Mengubah mapping option
setelah posting tidak boleh mengubah Account maupun provenance reversal historis.

## 6. Kontrak fakta

Fakta yang sudah mampu membawa pilihan menggunakan stable code, bukan row id dan bukan
Account ID:

```json
{
  "choiceSelections": [
    { "groupCode": "BEBAN_TETAP", "optionCode": "LISTRIK" }
  ]
}
```

Accounting tidak mengharuskan semua producer mengirim selection sejak Fase 3. Rule
Choice Group baru boleh diaktifkan end-to-end pada producer yang sudah punya selection
contract atau yang dapat memakai single/default resolution secara deterministik.

Khusus Cash Flow, jangan mengganti Flow Preset legacy ke Choice Group sebelum writer
Operasional ikut mendukung selection berbasis kode. Reader Accounting saja tidak cukup.

## 7. Fase 4 — API/UI Setting Transaksi

Fase 4 menyediakan surface **Bikin Grup** dan **Pasang Grup** di Setting Akuntansi.
Implementasi berada di changeset terpisah dari Fase 3.

Bootstrap `GET /api/admin/settings/accounting` menambah `choiceGroups` dan mirror
penggunaan group, termasuk kategori yang memakai group dan jumlah journal line historis.

Target route:

| Method | Path |
|---|---|
| `POST` | `/api/admin/settings/accounting/choice-groups` |
| `PATCH` | `/api/admin/settings/accounting/choice-groups/{id}` |
| `POST` | `/api/admin/settings/accounting/choice-options` |
| `PATCH` | `/api/admin/settings/accounting/choice-options/{id}` |

`POST/PATCH /journal-rules` menerima `sourceType: "choice_group"` + `choiceGroupId`.
Tidak ada route `DELETE`; lifecycle menggunakan `isActive`.

Runtime Fase 4 menjaga:

- option generic boleh disimpan dengan `accountId = null`;
- setelah group dipasang ke Accounting, readiness tidak boleh menyatakan siap jika
  option yang dapat dipilih belum memiliki Account aktif;
- group tanpa option aktif membuat kategori pemakainya `INCOMPLETE` dengan blocker
  `CHOICE_GROUP_EMPTY`;
- group yang masih dipakai rule aktif tidak boleh dinonaktifkan sembarangan;
- Account Master tetap read-only dari Setting Akuntansi.

## 8. Invariant test wajib

1. Explicit selection resolve ke option yang diminta.
2. Single active option dapat resolve tanpa selection eksplisit.
3. Active default dapat resolve ketika ada beberapa option.
4. Missing/invalid selection fail closed.
5. Generic option dengan `account_id = NULL` valid di schema tetapi gagal
   `NEEDS_CHOICE_ACCOUNT` ketika Accounting mencoba memakainya.
6. Account nonaktif gagal `NEEDS_CHOICE_ACCOUNT`.
7. Dua Choice Group rule ke Account sama tidak collapse menjadi satu line.
8. Journal menyimpan `choice_group_code` + `choice_option_code` sebagai pasangan.
9. Reversal mempertahankan Account dan provenance original setelah mapping berubah.
10. Existing `fixed_account`, `payment_method`, `item_category_*`, dan Cash Flow legacy
    tetap lulus regression tanpa perubahan behavior.

Coverage Fase 3 ada di `test/choice-groups-resolver.test.js` bersama regression bridge
existing.

## 9. Yang tidak berubah

- Account Master: `chart_of_accounts`, owner modul Accounting.
- Cara bayar: `payment_methods`.
- Jenis Barang Accounting mapping: `item_categories`.
- Manual journal tidak memakai resolver Setting Akuntansi.
- Cash Flow / Flow Preset tetap legacy `fixed_account` pada Fase 3.
- Production deploy tidak dilakukan oleh PR Fase 3.

## DOC-IMPACT

**REQUIRED** — contract ini disinkronkan dengan `ADR-033`, migration `0042` + `0043`,
dan behavior Fase 3. Fase 4 wajib memperbarui contract/API docs terkait dalam changeset
Fase 4 jika surface runtime berubah.

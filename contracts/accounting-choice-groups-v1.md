# Accounting Choice Groups Contract v1

Status: DRAFT — mengikuti `ADR-033`, belum diimplementasikan
Contract identifier: `MAXI_ACCOUNTING_CHOICE_GROUPS_V1`
Owner: Setting Akuntansi (configuration layer)
Dikerjakan oleh: `hana1.1`

Label UI Indonesia: **Resep Akun** (group) dan **Pilihan** (option). Nama canonical di
schema dan kode adalah *choice group* / *choice option*; `recipe` tidak dipakai karena
sudah dimiliki `manufacturing_recipes`.

## 1. Entitas

### 1.1 `accounting_choice_groups`

```sql
CREATE TABLE accounting_choice_groups (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES stores(id),
  entity_id     TEXT REFERENCES entities(id),          -- ADR-030; NULL sampai entity scope aktif
  code          TEXT NOT NULL,                          -- BEBAN_TETAP, BEBAN_INSIDENTAL, CARA_BAYAR
  name          TEXT NOT NULL,                          -- "Beban Tetap"
  description   TEXT NOT NULL DEFAULT '',
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, code),
  UNIQUE (store_id, name)
);
```

`code` bersifat `UPPER_SNAKE`, tidak berubah setelah dibuat.

### 1.2 `accounting_choice_options`

```sql
CREATE TABLE accounting_choice_options (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  choice_group_id   TEXT NOT NULL REFERENCES accounting_choice_groups(id) ON DELETE RESTRICT,
  code              TEXT NOT NULL,                      -- LISTRIK, SEWA_LAPAK, GAJI / CASH, BCA, QRIS
  name              TEXT NOT NULL,                      -- "Listrik"
  resolver_kind     TEXT NOT NULL CHECK (resolver_kind IN ('FIXED_ACCOUNT','PAYMENT_METHOD')),
  fixed_account_id  TEXT REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  payment_method_id TEXT REFERENCES payment_methods(id)  ON DELETE RESTRICT,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_default        INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (choice_group_id, code),
  CHECK (
    (resolver_kind = 'FIXED_ACCOUNT'  AND fixed_account_id IS NOT NULL AND payment_method_id IS NULL)
    OR (resolver_kind = 'PAYMENT_METHOD' AND payment_method_id IS NOT NULL AND fixed_account_id IS NULL)
  )
);

CREATE UNIQUE INDEX idx_choice_options_one_default
  ON accounting_choice_options (choice_group_id)
  WHERE is_active = 1 AND is_default = 1;
```

`CHECK` menegakkan **ADR-033 §4.3 invariant 5**: opsi cara bayar tidak memiliki akun
sendiri, akunnya milik `payment_methods`.

### 1.3 `journal_rules` — perubahan

```sql
ALTER TABLE journal_rules ADD COLUMN choice_group_id TEXT REFERENCES accounting_choice_groups(id);
-- source_type menerima nilai baru: 'choice_group'
```

SQLite tidak bisa mengubah `CHECK` constraint, jadi penambahan nilai `source_type`
menuntut **rebuild tabel**. Lihat `HANDOFF` Fase 1.

CHECK baru yang wajib ikut di rebuild:

```sql
CHECK (
  (source_type = 'fixed_account' AND fixed_account_id IS NOT NULL AND choice_group_id IS NULL)
  OR (source_type = 'choice_group' AND choice_group_id IS NOT NULL AND fixed_account_id IS NULL)
  OR (source_type NOT IN ('fixed_account','choice_group') AND fixed_account_id IS NULL AND choice_group_id IS NULL)
)
```

### 1.4 `accounting_journal_lines` — jejak provenance

```sql
ALTER TABLE accounting_journal_lines ADD COLUMN choice_group_code  TEXT NOT NULL DEFAULT '';
ALTER TABLE accounting_journal_lines ADD COLUMN choice_option_code TEXT NOT NULL DEFAULT '';
```

Aditif, tanpa rebuild. Diisi saat posting, tidak pernah diturunkan ulang. Ini yang
membuat jurnal lama tetap terbaca setelah resepnya diubah (`ADR-033` §3.4).

### 1.5 `accounting_choice_option_legacy_rules` — jembatan, bukan otoritas kedua

```sql
CREATE TABLE accounting_choice_option_legacy_rules (
  legacy_journal_rule_id TEXT PRIMARY KEY,
  choice_option_id       TEXT NOT NULL REFERENCES accounting_choice_options(id) ON DELETE RESTRICT,
  created_at             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Hanya menerjemahkan `expenses.accounting_component_rule_id` lama menjadi opsi baru.
Tabel ini **read-only setelah migrasi** dan dibuang di akhir compatibility window. Ia
tidak pernah menjadi sumber akun — akun selalu dibaca dari opsi.

## 2. Resolusi

Sebuah rule `source_type = 'choice_group'` menghasilkan **tepat satu** baris jurnal.

```
pilih opsi:
  1. opsi yang kodenya dikirim fakta (fact.choiceSelections[groupCode])
  2. kalau tidak ada, dan group hanya punya SATU opsi aktif  → opsi itu
  3. kalau tidak ada, dan group punya opsi default aktif      → opsi default
  4. selain itu                                               → NEEDS_CHOICE_SELECTION

resolve akun:
  resolver_kind = FIXED_ACCOUNT   → option.fixed_account_id, wajib aktif
  resolver_kind = PAYMENT_METHOD  → payment_methods.account_id, wajib aktif dan terpetakan

nominal: seluruh nominal transaksi (totalAmountScaled)
label baris: "<rule.label> · <option.name>"
provenance: choice_group_code = group.code, choice_option_code = option.code
```

Langkah 2 mempertahankan perilaku hari ini persis: *"single fixed debit component may
resolve without an explicit selection"*.

### 2.1 Kode kegagalan

| Kode | Arti | Kelas |
|---|---|---|
| `NEEDS_CHOICE_SELECTION` | group punya banyak opsi aktif, fakta tidak memilih, tidak ada default | `NEEDS_CONFIGURATION` |
| `NEEDS_CHOICE_OPTION` | kode opsi yang dikirim tidak ada / tidak aktif di group itu | `NEEDS_CONFIGURATION` |
| `NEEDS_CHOICE_ACCOUNT` | opsi `FIXED_ACCOUNT` menunjuk akun tidak aktif | `NEEDS_CONFIGURATION` |
| `NEEDS_PAYMENT_MAPPING` | opsi `PAYMENT_METHOD` menunjuk cara bayar tanpa akun | sudah ada, dipakai ulang |
| `NEEDS_CHOICE_GROUP` | rule menunjuk group tidak aktif / tidak ada | `NEEDS_CONFIGURATION` |

`NEEDS_COMPONENT_ALLOCATION` **dihapus** setelah Fase 3 — kondisinya tidak bisa terjadi
lagi. `NEEDS_COMPONENT_SELECTION` dipertahankan sebagai alias `NEEDS_CHOICE_SELECTION`
selama compatibility window.

## 3. Kontrak dengan modul operasional

Fakta bisnis membawa pilihan sebagai **kode**, bukan id:

```json
{
  "factType": "EXPENSE",
  "factId": "expense_...",
  "totalAmountMinor": 150000,
  "paymentMethodCode": "CASH",
  "choiceSelections": [
    { "groupCode": "BEBAN_TETAP", "optionCode": "LISTRIK" }
  ]
}
```

Modul operasional **tidak pernah** mengirim nomor akun (Constitution R5, Integration
Contract §4) dan **tidak pernah** menyimpan id baris Setting Akuntansi. Yang disimpan
di `expenses` adalah `accounting_choice_selection TEXT` berisi `BEBAN_TETAP:LISTRIK`.

Selama compatibility window, resolver membaca `accounting_component_rule_id` lama lewat
`accounting_choice_option_legacy_rules` bila `accounting_choice_selection` kosong.

## 4. API

Bootstrap `GET /api/admin/settings/accounting` menambah satu key:

```json
{ "choiceGroups": [
  { "id":"...", "code":"BEBAN_TETAP", "name":"Beban Tetap", "isActive":true,
    "usedByCategories":[{"code":"operational","side":"DEBIT"}],
    "journalLineCount": 42,
    "options":[
      { "id":"...", "code":"LISTRIK", "name":"Listrik", "resolverKind":"FIXED_ACCOUNT",
        "account":{"code":"6101","name":"Beban Listrik","type":"EXPENSE"},
        "isActive":true, "isDefault":true, "sortOrder":10, "journalLineCount": 17 }
    ] } ] }
```

`usedByCategories` dan `journalLineCount` bukan hiasan — itu cermin yang diwajibkan
`ADR-031` §3, dan dengan resep radius kesalahannya lebih lebar.

Route baru:

| Method | Path |
|---|---|
| `POST` | `/api/admin/settings/accounting/choice-groups` |
| `PATCH` | `/api/admin/settings/accounting/choice-groups/{id}` |
| `POST` | `/api/admin/settings/accounting/choice-options` |
| `PATCH` | `/api/admin/settings/accounting/choice-options/{id}` |

`POST /journal-rules` menerima `sourceType: "choice_group"` + `choiceGroupId`.
Tidak ada route `DELETE` — penonaktifan lewat `isActive`.

## 5. Validasi saat simpan

1. `code` group/opsi `UPPER_SNAKE`, unik per scope-nya, **tidak bisa diubah** setelah
   ada baris jurnal dengan provenance itu.
2. Opsi `FIXED_ACCOUNT` wajib menunjuk akun aktif milik gerai yang sama.
3. Opsi `PAYMENT_METHOD` wajib menunjuk cara bayar aktif; akunnya tidak diisi di sini.
4. Menonaktifkan opsi terakhir yang aktif di sebuah group ditolak selama group itu
   dipakai rule aktif.
5. Menonaktifkan group ditolak selama ada rule aktif yang menunjuknya.
6. **`ADR-032`**: bila group dipakai rule `wh_transfer` atau `wh_production`, opsi
   bertipe akun `REVENUE`/`EXPENSE` ditolak — dicek saat opsi disimpan **dan** saat
   group dipasang ke rule.
7. Group tanpa opsi aktif membuat kategori pemakainya berstatus `INCOMPLETE` dengan
   blocker `CHOICE_GROUP_EMPTY`.

## 6. Invariant yang wajib dijaga tes

| # | Invariant | Kenapa mahal kalau bocor |
|---|---|---|
| 1 | satu rule `choice_group` = tepat satu baris jurnal | jurnal tetap balance walau salah jumlah baris |
| 2 | opsi dipilih lewat `code`, id baris tidak pernah keluar dari Accounting | mengulang kebocoran yang ditutup `0038` |
| 3 | `code` opsi immutable setelah menghasilkan jurnal | memutus jejak jurnal lama |
| 4 | opsi yang pernah dipakai tidak bisa dihapus, hanya dinonaktifkan | `ON DELETE RESTRICT` + guard provenance |
| 5 | reversal menyalin, tidak me-resolve ulang | reversal berbeda dari yang dibalik, tanpa error |
| 6 | opsi `PAYMENT_METHOD` tidak memegang akun | dua otoritas untuk akun cara bayar |
| 7 | larangan tipe akun `ADR-032` berlaku di level opsi | omzet menggelembung tanpa penjualan |
| 8 | fakta yang sama menghasilkan jurnal identik sebelum dan sesudah migrasi Fase 2 | migrasi diam-diam mengubah akun |

Invariant 8 adalah tes terkuat dalam rencana ini dan wajib ditulis lebih dulu.

## 7. Yang tidak berubah

- `payment_methods` tetap satu-satunya registry cara bayar.
- `item_categories` dan `source_type = item_category_*` tidak disentuh.
- `journal_rules` tetap memiliki struktur baris.
- `chart_of_accounts` tetap satu-satunya registry akun.
- Jurnal manual dan reversal tetap **tidak** lewat Setting Akuntansi (`ADR-031` §4).

## DOC-IMPACT

**REQUIRED** — `contracts/accounting-settings-v1.md`, `contracts/operational-posting-v1.md`,
`contracts/accounting-flow-presets-v1.md`, `contracts/accounting-pos-bridge-v1.md`,
dan `KNOWN_PITFALLS.md` menyesuaikan saat implementasi tiap fase mendarat.

# ADR-038 — Setting Transaksi jadi modul variable-reference plug/unplug

Status: ACCEPTED — arah dan detail ditentukan langsung oleh Bos Cyo 2026-08-21
(brainstorming dengan Karen), Hana menulis ulang jadi ADR + memeriksa boundary
teknis. Merevisi `ADR-033` secara material (bukan menulis ulang riwayatnya).
Date: 2026-08-21
Change ID: `MAXI-SA-VARIABLE-REFERENCE-20260821`
Dikerjakan oleh: `hana1.1` — arsitektur, atas keputusan Bos Cyo

## 1. Keputusan inti (final, milik Bos Cyo — lihat PR #126)

1. Setting Transaksi jadi modul plug/unplug dari POS. POS tetap jalan tanpa dia.
2. Setting Transaksi **tidak boleh** mengarang business variable sendiri — semua
   komponen Grup wajib reference ke variable nyata milik source module (POS,
   Inventory, dst), bukan input nama bebas.
3. Account tetap milik Accounting — Setting Transaksi cuma memilih reference,
   tidak pernah membuat akun baru.
4. Identity komponen = `sourceModule + sourceType + sourceId` (stabil).
   `displayName` boleh berubah ikut sumber tanpa memutus reference.
5. Toggle per Jenis Transaksi: `ruleSource = POS_INTERNAL` atau
   `SETTING_TRANSACTION`. **POS internal business behavior selalu jalan** di
   kedua kondisi — toggle cuma ganti configuration/routing/mapping layer,
   tidak pernah mengambil alih logic POS.
6. `Jenis Barang` dan `Metode Bayar` bukan master buatan SA lagi — keduanya
   dibaca sebagai reference dari source module (POS/Inventory).
7. Grup Transaksi disimpan atomic — satu tombol Simpan, satu aksi backend,
   gagal sebagian = gagal semua (tidak ada partial write).
8. Pemasangan Grup terjadi di Aturan Transaksi (bukan panel "Pasang Grup"
   terpisah). Grup yang belum lengkap Account tetap muncul di pencarian,
   statusnya "belum siap dipakai Accounting" — bukan disembunyikan.
9. Generic `VariableReference` (sourceModule/sourceType/sourceId/sourceCode/
   displayName/status), bukan tabel terpisah per jenis (`payment_mapping`,
   `cost_mapping`, dst).

Bentuk konsep lengkap ada di `HANDOFF-setting-transaksi-modular-mapping.md`
(PR #126) dan pesan Bos Cyo 2026-08-21 — dokumen ini adalah ADR-nya, bukan
pengganti detail di sana.

## 2. Temuan Hana yang WAJIB masuk scope — belum tertulis di brainstorming asli

### 2.1 Gerbang cara bayar hari ini justru membalik prinsip #1

Diverifikasi ke kode (`src/accounting-pos-bridge.js::resolvePosPaymentMethod`,
dipanggil dari `cashier-sales-tracking.js`, `cashier-purchase.js`,
`cashier-operational-expense.js`): kalau kode cara bayar tidak terdaftar+aktif
di tabel `payment_methods` (yang hari ini hidup di bawah Setting Akuntansi),
transaksi **ditolak sebelum tersimpan** (`PAYMENT_METHOD_NOT_AVAILABLE`, HTTP
400) — bukan "jurnalnya nunggu". Ini gerbang yang beda dan lebih ketat dari
gerbang pengiriman jurnal (post-commit, best-effort, tidak pernah menolak).

**Konsekuensi:** klaim "POS tetap jalan tanpa Setting Transaksi" belum benar
di kode sekarang. Ini prioritas pertama, bukan efek samping — `payment_methods`
harus pindah jadi milik POS Core (baris boleh ada tanpa `account_id`/tanpa
Setting Transaksi terpasang sama sekali), validasi POS tetap jalan independen
dari status ON/OFF Setting Transaksi.

### 2.2 Tiga Jenis Transaksi hari ini terkonfigurasi tapi tidak pernah bisa Siap

`deposit`, `payroll`, dan `wh_return` ada di `transaction_categories` tapi
tidak ada satu modul pun yang mengirim fakta untuknya. Kalau tidak dikunci,
admin bisa mapping ke sana dan statusnya keliatan siap padahal jurnalnya
tidak akan pernah terbit — mengulang pola yang sudah diperbaiki `ADR-031`.
UI baru wajib mengunci Jenis Transaksi yang belum ada konsumennya, dengan
alasan yang terlihat, bukan menyembunyikannya diam-diam.

### 2.3 Data uji sekarang boleh hilang — dikonfirmasi Bos Cyo 2026-08-21

Journal/data live saat ini murni data tes. **Tidak perlu compatibility
window, tidak perlu migrasi bertahap, tidak perlu dua bentuk resolver
hidup bersamaan.** `accounting_choice_options` boleh langsung diubah supaya
`code` wajib reference ke `VariableReference`, bukan nama bebas ketikan
admin. Ini menyederhanakan implementasi secara signifikan dibanding rencana
awal Hana yang mengasumsikan data lama harus dijaga.

### 2.4 Yang sudah settled dari sparring — jangan dibahas ulang

`accounting_choice_options.account_id` nullable di level Group, wajib baru
saat resolve-time (`NEEDS_CHOICE_ACCOUNT` fail-closed) — ini sudah bentuk
schema sekarang (`migrations/0043`), bukan open question lagi.

## 3. Consequences

- `ADR-033` direvisi: model "opsi nama bebas" diganti reference-based. Pola
  `source_type='choice_group'` di `journal_rules` **tetap dipakai** (bukan
  source_type baru) — jadi tidak ada rebuild `journal_rules` (CHECK
  constraint SQLite yang mahal, lihat `ADR-033` §5).
- `payment_methods`/`item_categories` pindah kepemilikan ke POS Core; kolom
  akun pindah ke tabel extension terpisah (pola sama `ADR-034` §1).
- Karena data boleh hilang, migration untuk `accounting_choice_*` boleh
  destructive/rewrite bentuk (bukan additive-only) — **pengecualian eksplisit**
  dari kebiasaan repo, berlaku HANYA untuk tabel ini, HANYA karena Bos Cyo
  konfirmasi datanya tes.

## 4. Open — tetap milik Bos Cyo, dari §18 brainstorming

Belum diputuskan, tidak menghalangi STEP1 audit: POS push vs SA pull
registry, precedence POS_INTERNAL vs SETTING_TRANSACTION vs Accounting
fallback, apakah satu variable boleh beda Account per Group/context,
scope entity/tenant.

## 5. Related

`ADR-029`, `ADR-031`, `ADR-033` (direvisi), `ADR-034` §1 (pola yang sama
diperluas), `HANDOFF-setting-transaksi-modular-mapping.md` (PR #126).

## DOC-IMPACT

**REQUIRED** — `ADR-033` ditandai direvisi menunjuk ADR ini.
`contracts/accounting-choice-groups-v1.md` ditulis ulang total begitu
implementasi STEP1-2 selesai (bukan sekarang).

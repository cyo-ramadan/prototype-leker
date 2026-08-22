# ADR-038 — Consolidation Group: laporan gabungan lintas-Entity, versioned mapping, dan eliminasi

Status: PROPOSED — menunggu ACC Bos Cyo sebelum breakdown ke task papan `maxi-agent-bus`.
Date: 2026-08-22
Change ID: `MAXI-CONSOLIDATION-REPORTING-20260822`
Dikerjakan oleh: `hana` — arsitektur, sesi Claude Code, atas permintaan Bos Cyo

## 1. Ruang lingkup

`ADR-030` udah netapin Consolidation Group itu read-side concern, dan udah nyiapin tabel
`consolidation_groups` + `consolidation_membership` di `migrations/0039_tenancy_and_consolidation_foundation.sql`.
ADR ini nerusin dari situ, jawab "gimana caranya beneran jalan": laporan apa yang bisa
digabung, gimana akun tiap Entity dipetakan ke Chart of Accounts kelompok, dan gimana
eliminasi transaksi antar-Entity dihitung. **Tidak** membuat ulang tabel yang udah ada di
0039 — dipakai apa adanya.

ADR ini murni desain baca. Enggak ada satu pun bagian di sini yang menulis jurnal baru ke
buku Entity manapun, dan enggak ada buku baru di level kelompok yang diusulkan — itu domain
Keputusan Terbuka #1 `ADR-030` yang belum diputuskan Bos Cyo, dan sengaja enggak dijawab di
sini.

## 2. Laporan apa yang bisa digabung

Neraca dan Laba-Rugi tergabung per Consolidation Group: ambil semua Entity anggota grup itu
dari `consolidation_membership` yang berlaku di rentang tanggal laporan, jumlahkan saldo akun
tiap Entity yang udah dipetakan ke akun kelompok yang sama (§3), lalu terapkan eliminasi (§4).

Arus Kas kelompok **sengaja di luar cakupan** ADR ini. Metode arus kas kelompok (langsung/
tidak langsung) nyambung ke pertanyaan apakah kelompok punya siklus pelaporan sendiri —
itu Keputusan Terbuka #1 `ADR-030` yang belum diputuskan. Kalau nanti dibutuhin, itu ADR
terpisah.

## 3. Pemetaan akun Entity ke CoA kelompok (versioned mapping)

Chart of Accounts hari ini masih di-scope per `store_id` (`chart_of_accounts`,
`migrations/0022`), dan tiap gerai udah ke-link ke satu Entity lewat `stores.entity_id`
(`migrations/0039`). Karena satu gerai = satu Entity, "Chart of Accounts milik Entity"
untuk keperluan konsolidasi bisa di-resolve lewat join `chart_of_accounts.store_id ->
stores.entity_id` — enggak perlu nunggu `entity_id` nempel langsung di tabel ledger
(`ADR-030` step 3/4).

Pemetaan-nya perlu **versioned**, dengan alasan yang sama kayak `entity_tenancy`: akun di
CoA Entity bisa berubah dari waktu ke waktu (ditambah, di-nonaktifkan, direstrukturisasi),
dan keanggotaan grup sendiri udah temporal. Laporan periode lama harus tetap resolve
pemetaan yang berlaku di periode itu, bukan pemetaan hari ini.

Kalau ada akun Entity yang enggak punya pemetaan yang berlaku di periode laporan, laporan
**gagal terang-terangan** (bukan diam-diam dilewatin) — ini nurutin prinsip C4 yang udah
ada di `ADR-030`: enggak boleh ada penyelarasan senyap saat sumber datanya enggak lengkap.

## 4. Eliminasi transaksi antar-Entity

Keputusan #6 `ADR-030` udah bilang: fakta yang melintasi dua Entity dalam satu grup butuh
`counterparty_entity_id` eksplisit, kalau enggak, eliminasi enggak bisa dihitung dan
pendapatan/stok kelompok dobel dihitung. Kolom itu **belum ada di manapun** di skema
sekarang — merekam fakta intercompany itu pekerjaan terpisah yang belum dirancang, **bukan**
bagian dari ADR ini.

ADR ini nentuin algoritma eliminasinya, dengan asumsi input itu udah tersedia:

1. Akun kelompok yang mewakili piutang/utang antar-Entity ditandai `subtype = 'INTERCOMPANY'`
   di `consolidation_group_accounts` (§6).
2. Per periode laporan, ambil baris jurnal yang ter-mapping ke akun bertanda INTERCOMPANY,
   yang carry `counterparty_entity_id` menunjuk ke Entity lain di grup yang sama pada
   periode itu.
3. Pasangkan berdasarkan `counterparty_entity_id` timbal-balik (Entity A punya baris ke
   Entity B, Entity B punya baris ke Entity A) dalam periode yang sama, lalu netkan dari
   total kelompok supaya enggak dobel dihitung sebagai fakta eksternal.
4. Kalau pasangannya enggak net ke nol, itu sinyal kualitas data yang dimunculin di laporan
   — bukan dipaksa nol diam-diam. Prinsipnya sama kayak toleransi `Penyesuaian`: enggak
   boleh jadi karpet buat nutupin selisih yang enggak dijelasin.

Bagian ini **enggak bisa jalan** sampai dua prasyarat di luar ADR ini kelar: (a) ada tempat
merekam fakta intercompany yang carry `counterparty_entity_id`, dan (b) CoA kelompok punya
subtype INTERCOMPANY yang konsisten dipakai semua Entity anggota.

## 5. Yang sengaja enggak dijawab di sini

Empat Keputusan Terbuka `ADR-030` masih milik Bos Cyo. ADR ini enggak nebak jawabannya,
tapi nunjukkin di mana tiap keputusan jadi gerbang buat bagian desain ini:

1. **Legal books sendiri buat kelompok?** ADR ini asumsi "reporting-only" (asumsi default
   `ADR-030`) — enggak ada bagian di sini yang posting jurnal ke buku baru. Kalau dijawab
   "ya, kelompok butuh buku sendiri", itu jalur posting baru yang butuh ADR sendiri.
2. **Kebijakan restatement.** ADR ini cuma nyediain resolusi "as of" tanggal (pola sama
   kayak `entity_tenancy`/`consolidation_membership`) — belum nentuin gimana laporan
   periode lama ditampilin ulang kalau ada restatement.
3. **Kalender fiskal.** Desain di §2-3 asumsi semua Entity dalam satu grup pakai kalender
   yang sama (`business_date` yang udah ada). Begitu ada Entity berkalender fiskal beda,
   resolusi periode di sini harus dirombak.
4. **Skala uang di kontrak.** Desain ini asumsi semua Entity yang dikonsolidasi pakai skala
   scaled-integer yang sama kayak Leker sekarang (`amount_minor`, 1 rupiah = 1.000.000
   unit). Entity berskala beda butuh keputusan #4 kelar dulu sebelum penjumlahan §2 valid.

## 6. Skema tambahan yang diusulkan (aditif, sketsa — bukan migration jadi)

```
consolidation_group_accounts(
  id, consolidation_group_id, code, name, type, subtype, created_at
)

consolidation_account_mapping(
  id, consolidation_group_id, entity_id, entity_account_id,
  group_account_id, effective_from, effective_to
)
-- satu open row per (consolidation_group_id, entity_account_id), pola sama kayak
-- entity_tenancy: ditutup & dibuka lagi, enggak pernah di-overwrite.
```

Enggak ada tabel `consolidation_groups`/`consolidation_membership` yang dibuat ulang.

## 7. Konsekuensi & urutan kerja

- §2-3 (pemetaan + agregasi Neraca/Laba-Rugi) **bisa mulai dikerjain sekarang**, enggak
  perlu nunggu `ADR-030` step 3/4, karena resolusi Entity bisa lewat join `store_id ->
  stores.entity_id` yang udah ada dari migration 0039.
- §4 (eliminasi) **enggak bisa dikerjain** sampai ada mekanisme perekaman fakta intercompany
  dengan `counterparty_entity_id` — itu prasyarat di luar ADR ini, kemungkinan butuh ADR
  sendiri.
- §2-3 enggak nyentuh `src/stores.js`, `src/index.js`, atau migration manapun yang lagi
  aktif dikerjain hari ini — tapi ini tetap dicek ulang langsung ke papan tugas D1 sebelum
  task diposting, enggak diasumsikan dari sini.
- Enggak ada journal yang pernah ditulis oleh bagian manapun ADR ini. Murni baca dan
  agregasi saat laporan diminta.

## Related

- `ADR-030` — Entity owns the books; tenancy and consolidation are resolved relations
- `migrations/0039_tenancy_and_consolidation_foundation.sql`
- `test/tenancy-foundation.test.js`

## DOC-IMPACT

PENDING — enggak ada dokumen lain yang perlu diperbarui sampai ADR ini di-ACC dan mulai
diimplementasi. Begitu implementasi mulai, `README.md` dan `KNOWN_ISSUES.md` perlu nyebut
status Consolidation Group reporting.

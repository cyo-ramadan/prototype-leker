# Prototype Leker — panduan kerja Claude Code

File ini dimuat otomatis setiap sesi. Isinya sengaja pendek: aturan keras plus
penunjuk arah. Detail tetap tinggal di dokumen masing-masing — jangan disalin
ke sini.

## Bahasa

Balas dalam Bahasa Indonesia. Panggil pemilik repo **Bos Cyo**. Istilah teknis
(commit, migration, journal, drawer) biarkan dalam bahasa aslinya.

## Siapa mengerjakan apa

- **Zee** — Claude di claude.ai. Tidak punya akses GitHub langsung. Sejak
  `agent-bridge/` di-deploy, Zee bisa **membaca** repo lewat custom connector.
  Zee tidak bisa menulis.
- **Karen** — punya GitHub write access. Jalur default untuk implementasi.
- **Claude Code** (sesi ini) — akses filesystem + GitHub read/write.

Instance-instance ini **tidak berbagi memory**. Jangan berasumsi konteks dari
percakapan Bos Cyo dengan Zee sampai ke sesi ini; minta di-paste kalau perlu.

## Perintah

```sh
npm test        # node --test, seluruh suite (termasuk agent-bridge/)
npm run check   # syntax check; daftar file eksplisit — tambahkan file baru ke sini
```

Jalankan keduanya sebelum commit.

`npm run deploy` adalah alur canonical: `db:migrations:apply` → `db:schema:verify`
→ `wrangler deploy`. Urutannya yang menjaga keamanan, bukan sekadar isinya —
migration jalan dulu supaya rekonsiliasi yang tertunda ikut ter-apply sebelum
verifier menilai schema, dan verifier jalan sebelum Worker dipromosikan supaya
database yang drift menghentikan rilis. **Jangan** membelokkan script ini ke
script recovery sekali-pakai; sudah tiga kali terjadi dan tidak pernah
dikembalikan. `test/canonical-deploy-command.test.js` menjaga bentuknya.

## Invariant yang tidak boleh dilanggar

Melanggar salah satu dari ini merusak data keuangan yang sudah ada, bukan
sekadar bikin tes merah.

1. **Uang tidak pernah floating-point.** Average Cost, HPP, Harga Beli, dan
   journal amount authoritative disimpan sebagai scaled INTEGER,
   `1 rupiah = 1.000.000 unit`, maksimal 6 desimal, half-up di digit ke-7.
   Dilarang `REAL`, dilarang float JS sebagai source of truth, dilarang `* 1.0` di SQL.
2. **Posted journal immutable.** Koreksi lewat reversal, bukan edit.
3. **Manual journal wajib balance exact.** Toleransi `Penyesuaian` (Equity,
   maks Rp100) bukan karpet untuk menyembunyikan error.
4. **Accounting yang memiliki posting jurnal.** POS/Operasional hanya mengirim
   business fact; Accounting yang menginterpretasi. Operasional tidak boleh
   punya foreign key ke interpretasi Accounting.
5. **Isolasi `store_id` server-side.** Hanya Pelanggan yang boleh melebar antar
   gerai, dan hanya lewat Customer Sharing Group milik Owner.
   Tapi **`store_id` bukan batas tenant** — itu gerai, scope operasional. Arah
   SaaS: pemilik buku adalah Entity (Badan Usaha), pelanggan berlangganan adalah
   Tenant, dan keduanya belum ada di schema. Tabel ledger baru yang dibuat tanpa
   memikirkan `entity_id` jadi utang migrasi. Lihat `adr/ADR-030`.
6. **Tanpa polling periodik.** Refresh kasir manual/on-focus. Kalau realtime
   dibutuhkan, pakai push (WebSocket/SSE) setelah impact assessment.
7. **Jangan menulis ulang migration yang sudah applied** untuk menutupi schema
   drift. Ledger migration tidak membuktikan schema object masih lengkap —
   inspect `sqlite_schema`/`PRAGMA` dulu, perbaiki hanya object yang terbukti hilang.
8. **Saldo negatif bukan bug.** Jangan `abs()` supaya UI rapi.
9. **Jangan minta token plaintext ke Bos Cyo** kalau jalur canonical tersedia.

Daftar lengkap 21 pitfall beserta alasannya: `KNOWN_PITFALLS.md`. Baca sebelum
menyentuh Accounting, Inventory/Costing, atau approval flow.

## Baca dulu sebelum kerja

| Mau menyentuh | Baca |
|---|---|
| Apa pun | `README.md` |
| Accounting / Inventory / approval | `KNOWN_PITFALLS.md` |
| Status fitur yang belum kelar | `KNOWN_ISSUES.md` |
| Alasan sebuah keputusan arsitektur | `adr/` (29 ADR) |
| Kontrak antar-modul | `contracts/` |
| Prosedur operasional | `RUNBOOK.md` |
| Siapa pemilik modul + aturan tiap agen | `MODULE_OWNERSHIP.md` |
| Cara memberi/menerima task antar agen | `contracts/agent-task-board-v1.md` |

## Deploy

Canonical: **Cloudflare Workers Git Integration** dari branch `main`. Bukti
deployment yang sah adalah check **`Workers Builds: prototype-leker-v2`**
berstatus `SUCCESS`. Preview Worker hijau **tidak** membuktikan remote D1 siap.

GitHub Actions deploy adalah fallback dan butuh secret Cloudflare. Kegagalan job
fallback karena secret tidak ada **tidak** membatalkan deployment Git Integration
yang sudah `SUCCESS`.

`agent-bridge/` adalah Worker terpisah (`leker-agent-bridge`) dan **tidak** ikut
ter-deploy oleh Git Integration. Deploy manual dengan config-nya sendiri.

## Konvensi repo

- Semua kode ESM, `node:test` + `node:assert/strict`, Node 22.
- File `src/` atau `public/` baru **wajib** ditambahkan ke script `check`.
- Dokumen berakhir dengan penanda **DOC-IMPACT**; perbarui saat perilaku berubah.
- Kerjakan di branch fitur, jangan commit langsung ke `main`.

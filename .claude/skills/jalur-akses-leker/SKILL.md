---
name: jalur-akses-leker
description: Peta jalur akses Prototype Leker untuk agen yang ngoding dan nge-debug sendiri — cara BACA data (API aplikasi per role, /api/debug/*, D1 langsung), cara TULIS data (wajib lewat API aplikasi, jangan pernah INSERT langsung ke D1), cara DEPLOY dan cara membuktikan sesuatu benar-benar sudah hidup, plus apa yang harus dilakukan kalau tidak punya akses D1/token sama sekali. Pakai skill ini SETIAP KALI buntu mencari jalur — "gimana caranya login/entry lewat API", "endpoint mana buat bikin transaksi", "gimana baca data produksi", "gimana tahu ini sudah ke-deploy apa belum", "kenapa datanya masuk ke gerai yang salah", "kenapa 401/403", "aku nggak punya akses D1" — dan sebelum mulai debugging apa pun yang menyentuh aplikasi yang sedang jalan. Pakai juga sebelum menyimpulkan sebuah perubahan sudah live. Jangan menebak endpoint atau bentuk request dari nama file; jalur yang salah bikin data masuk ke gerai/tabel yang salah tanpa error.
---

# Jalur akses Prototype Leker

## Kenapa skill ini ada

Agen yang ngoding dan nge-debug di repo ini paling sering macet bukan karena logikanya susah,
tapi karena **tidak ketemu jalurnya**: mau baca data produksi tapi tidak tahu lewat mana, mau
bikin transaksi uji tapi tidak tahu endpoint dan bentuk auth-nya, atau menyimpulkan sesuatu
"sudah live" padahal belum. Peta ini menggabungkan yang selama ini terpencar di `RUNBOOK.md`,
`agent-bus/CLAIM-PROMPT.md`, `contracts/debugger-control-plane-v1.md`, dan `KNOWN_PITFALLS.md`.

Alamat tetap yang dipakai semua jalur di bawah:

| Hal | Nilai |
|---|---|
| Worker produksi | `https://prototype-leker-v2.daily-napkin.workers.dev` |
| Repo | `cyo-ramadan/prototype-leker`, branch produksi `main` |
| D1 produksi | `prototype-leker-db`, `database_id 6977b54c-afce-4275-a0ad-d28e7d942e19` |
| Cloudflare account | Daily Napkin, `25c5fe53877002648959e8dd35678188` |
| Papan tugas agen | D1 `maxi-agent-bus`, `cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6` |

## Peta cepat

| Mau apa | Jalurnya | Butuh apa |
|---|---|---|
| Baca data operasional apa adanya | Endpoint aplikasi sesuai role (login dulu) | username+password role itu |
| Baca diagnosis lintas modul, read-only | `GET /api/debug/*` | `DEBUG_SUPERADMIN_TOKEN` (secret Worker) |
| Baca isi tabel mentah | Query D1 langsung | connector D1/MCP atau token Cloudflare |
| Bikin/ubah transaksi | **Hanya** endpoint aplikasi | login role yang berwenang |
| Ubah struktur/skema | Migration di repo → jalur deploy canonical | akses repo |
| Deploy | merge/push ke repo (lihat §4) | akses repo |
| Buktikan sudah live | `d1_migrations` + `modified_on` Worker + cek fungsional | akses baca D1 atau bukti build |

## 1. BACA — tiga jalur, beda kegunaan

**a. Lewat API aplikasi (paling representatif).** Ini yang dilihat user sungguhan. Login dulu,
lalu pakai token hasil login sebagai `Authorization: Bearer <token>` di request berikutnya.

| Role | Endpoint login | Isi body |
|---|---|---|
| Kasir | `POST /api/cashier/login` | `{username, password}` |
| Admin Gerai | `POST /api/store-admin/login` | `{username, password}` |
| Owner | `POST /api/owner/login` | `{username, password}` |
| Customer | `POST /api/customer/login` | lihat `src/customers.js` |

Token dari login itu **session token aplikasi**, bukan token Cloudflare/GitHub. Dua hal berbeda;
jangan pernah memakai salah satu untuk yang lain.

**b. Lewat Debugger Control Plane (`/api/debug/*`) — read-only, lintas modul.** Auth-nya
`Authorization: Bearer <DEBUG_SUPERADMIN_TOKEN>` (secret binding di Worker, bukan di repo).
Endpoint yang ada: `/api/debug/me`, `/modules`, `/health?store=<CODE>`,
`/modules/<MODULE>?store=<CODE>`, `/transactions/<REFERENCE_ID>?store=<CODE>`,
`/customer-feedback/<CODE>?store=<CODE>`, `/audit?limit=<1..100>`.

Kalau balasannya `503 DEBUGGER_NOT_CONFIGURED`, secret-nya belum dipasang di Worker — itu bukan
bug kode. `401 DEBUGGER_AUTH_REQUIRED` berarti token salah/tidak dikirim. Debugger **tidak**
punya wewenang di `/api/customer|cashier|admin|owner/*` — dia bukan bypass universal.
Detail: `contracts/debugger-control-plane-v1.md`.

**c. Query D1 langsung — untuk memastikan keadaan sebenarnya.** Ini jalur pembuktian (berapa
baris, migration mana yang sudah applied), bukan jalur menjalankan fitur. Kalau tidak punya
connector D1/MCP, ada pola `curl` + token Cloudflare di `agent-bus/CLAIM-PROMPT.md` — tokennya
dikirim Bos Cyo terpisah di luar chat dan tidak pernah disimpan di repo.

## 2. TULIS — hanya lewat API aplikasi

Menulis langsung ke D1 **tidak sama** dengan lewat API aplikasi. Insert mentah melewati trigger
stok, pembentukan HPP, posting jurnal Accounting, dan notifikasi — hasilnya data yang "ada" tapi
buku dan stoknya tidak ikut bergerak. Itu kerusakan senyap yang baru ketahuan waktu laporan
keuangan sudah salah.

Endpoint tulis yang dipakai kasir sungguhan (semua butuh Bearer token kasir, dan **laci kasir
harus dibuka dulu** — kalau belum, endpoint transaksi menolak):

| Aksi | Endpoint |
|---|---|
| Buka/tutup laci | lihat `src/cashier-drawer.js` |
| Beli bahan | `POST /api/cashier/purchases` (`src/cashier-purchase.js`) |
| Pengeluaran operasional | `POST /api/cashier/expenses` (`src/cashier-operational-expense.js`) |
| Penjualan | `POST /api/cashier/sales` (`src/cashier-sales-tracking.js`) |

Baca file sumber yang disebut untuk bentuk body persisnya — jangan menebak dari nama endpoint.

Pengecualian yang sah untuk menulis langsung ke D1: menerapkan **migration** yang memang sudah
ditulis di repo (mis. saat jalur deploy macet), dan itu pun wajib dicatat di `d1_migrations`
supaya bookkeeping-nya konsisten. Data bisnis baru tidak pernah masuk lewat jalur ini.

## 3. Jebakan `?store=` — paling sering bikin salah gerai

Server menentukan gerai dari query param `store`: `storeTokenFromUrl()` di `src/index.js` membaca
`?store=<CODE>`, dan **kalau tidak ada, jatuh ke gerai default (`G001`)** tanpa error apa pun.

Browser menambahkan param ini otomatis (`public/store-context.js`), tapi kalau memanggil API
langsung dari skrip/`curl`, itu jadi tanggung jawab pemanggil. Gejala khasnya: "datanya masuk,
tapi kok muncul di gerai lain". Endpoint kasir mengikuti gerai milik akun kasirnya, tapi endpoint
admin/owner yang lintas-gerai mengikuti param ini.

## 4. DEPLOY dan cara membuktikannya

Jalur canonical: Cloudflare Workers Git Integration menjalankan `npm run deploy`, yaitu
`db:migrations:apply` → `db:schema:verify` → `wrangler deploy`. **Urutannya yang menjaga
keamanan** — migration jalan dulu supaya verifier menilai skema yang sudah ter-apply, dan
verifier jalan sebelum Worker dipromosikan supaya database yang drift menghentikan rilis.
Jangan pernah membelokkan `npm run deploy` jadi script recovery sekali-pakai.

**Push ke branch fitur = deploy produksi sungguhan.** Dibuktikan 2026-08-31 dengan bukti
langsung: migration yang hanya ada di branch fitur (belum di-merge) muncul applied di
`d1_migrations` produksi, dan `modified_on` Worker berubah 12 detik sesudahnya. Jadi jangan
menganggap branch fitur sebagai ruang aman — migration destruktif/belum yakin tidak boleh
di-push ke branch mana pun sebelum benar-benar siap live. (`RUNBOOK.md` bagian "Preview branch
rule" versi lama menyebut branch build cuma code-preview; itu sudah dikoreksi.)

**Bukti bahwa sesuatu benar-benar live** — jangan berhenti di "PR sudah merged":

1. `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 5` di D1 produksi → migration-nya ada?
2. `modified_on` Worker `prototype-leker-v2` → berubah sesudah commit itu?
3. Cek fungsional di jalur yang benar-benar dipakai user (endpoint/halaman terkait).

Kalau ketiganya belum, statusnya `BLOCKED`, bukan `PASS`. Checklist penuh ada di `RUNBOOK.md`
bagian "Deployment completion checklist".

Kegagalan job GitHub Actions karena secret Cloudflare tidak ada **tidak** membatalkan deployment
Git Integration yang sudah `SUCCESS` — dua jalur berbeda, yang kedua cuma fallback.

## 5. Kalau memang tidak punya akses sama sekali

Tiga kemampuan ini terpisah — jangan menyimpulkan satu dari yang lain: (a) baca/tulis papan tugas
D1, (b) query D1 produksi, (c) memicu deploy lewat merge/push repo. Agen GitHub-only tetap bisa
menyiapkan kode, migration, dan PR tanpa (a) dan (b).

Kalau tidak punya D1/MCP **dan** tidak punya jalur `curl`+token: laporkan status
`BLOCKED_AGENT_BUS` dan **jangan mengarang** baris klaim/laporan atau menyimpulkan keadaan papan
dari ingatan. Jalur relay yang sudah terbukti jalan: GitHub Issue #107 di repo ini — Hana yang
punya akses akan mirror keadaan papan ke sana dan menuliskan laporanmu balik ke D1.

## 6. Sebelum bilang "sudah beres"

- [ ] `npm test` dan `npm run check` hijau (dan file `src/`/`public/` baru sudah ditambahkan ke
      script `check` — itu wajib, gampang kelupaan)
- [ ] Tes regresi baru gagal kalau perubahanmu dicabut — kalau tetap lulus, tesnya tidak
      membuktikan apa pun
- [ ] Klaim "sudah live" dibuktikan dengan tiga bukti di §4, bukan status merge
- [ ] Transaksi uji coba yang dibuat di produksi ditandai jelas di catatannya supaya bisa
      dibedakan dari transaksi asli
- [ ] Tidak ada data bisnis yang masuk lewat INSERT langsung ke D1
- [ ] Kalau ketemu keputusan kebijakan akuntansi/persediaan yang belum jelas: berhenti dan
      eskalasi, jangan diputuskan sendiri

## Dokumen rujukan

| Butuh detail soal | Baca |
|---|---|
| Prosedur deploy, recovery, checklist lengkap | `RUNBOOK.md` |
| Aturan main agen implementer, `BLOCKED_AGENT_BUS`, jalur `curl` | `agent-bus/CLAIM-PROMPT.md` |
| Debugger `/api/debug/*` | `contracts/debugger-control-plane-v1.md` |
| Jebakan yang pernah bikin rusak (21 pitfall) | `KNOWN_PITFALLS.md` |
| Invariant keras (uang, jurnal, tenant) | `CLAUDE.md` |

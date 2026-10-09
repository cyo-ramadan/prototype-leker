# MAXI Agent Office

Dibangun Karen (`karen22.1`) atas permintaan Bos Cyo, 8 Oktober 2026. Kantor 2D ringan dengan collector lokal, adapter Claude Code, dan demo offline. Tidak ada dependency npm runtime, CDN, atau panggilan model AI dari monitor.

## Coba visual sekarang

Buka `preview.html` di browser. Ini **DEMO/SIMULASI**, tidak tersambung ke agent sungguhan. Klik **Kerja**, **Kantin**, **Papan task**, **Approval**, atau **Putus**; klik kartu/karakter untuk mengganti nama, role, warna, serta karakter Human/Kucing/Robot/Kelinci. Karakter awal adalah placeholder. Nama final dan pet custom menyusul arahan Bos Cyo.

## Menjalankan live (Windows / macOS / Linux)

Perlu Node **22.13 atau lebih baru** (Node 24 direkomendasikan). Node 22 bisa menampilkan warning `node:sqlite` experimental; aplikasi memakai SQLite bawaan Node. Tidak perlu `npm install`.

Dari root repo:

```sh
node tools/agent-office/cli.mjs serve
```

Atau di Windows double-click `START-OFFICE.cmd` dalam folder ini. Biarkan terminal server terbuka. Buka file `open-office.html` pada folder `.maxi-agent-office` di home user (Windows biasanya `C:\Users\NAMA\.maxi-agent-office\open-office.html`). File ini login ke kantor lokal. Jangan membagikan file launcher atau `connection.json`: keduanya memuat credential lokal. URL biasa `http://127.0.0.1:4318/?demo=1` selalu dapat membuka demo tanpa login.

Port sudah terpakai: `node tools/agent-office/cli.mjs serve --port 4319`. Jika collector lain masih berjalan, hentikan collector lama lebih dulu. Browser lama perlu dibuka ulang lewat launcher.

### 1. Hubungkan project Claude Code

Jalankan sekali dengan path project yang benar:

```sh
node tools/agent-office/cli.mjs install --project /path/ke/project
```

Dari root repo Leker dapat memakai `--project .`. Installer menggabungkan hook ke `.claude/settings.local.json` project, menyimpan backup, dan tidak mengganti hooks lain. Pengulangan install idempotent. Restart sesi Claude Code setelah pemasangan. Jangan commit settings lokal atau backup-nya ke repo. Installer hanya memasang hook di project yang ditentukan.

### 2. Mulai agent beridentitas jelas

Dari folder project kerja, jalankan CLI dengan path absolut jika diperlukan:

```sh
node /path/ke/agent-office/cli.mjs run --id hana-dev --name Hana --role Developer --task "Rapikan tampilan kasir" -- claude
```

Contoh PowerShell dari root repo Leker:

```powershell
node tools/agent-office/cli.mjs run --id hana-dev --name Hana --role Developer --task "Rapikan tampilan kasir" -- claude
```

Terminal kedua untuk agent SEO:

```powershell
node tools/agent-office/cli.mjs run --id seo-01 --name "Agent SEO" --role SEO --task "Artikel jajanan nikahan" -- claude
```

Nama/role/task berasal dari metadata launcher; monitor tidak meminta model menjelaskan kegiatannya. Ubah role/karakter di kartu jika diinginkan. `--id` yang stabil mempertahankan tampilannya di sesi berikutnya. Tiap proses baru mendapat session ID baru. Tanpa wrapper, hooks tetap mendeteksi sesi asli secara otomatis, dengan nama “Agent baru”; default identitas tampilan dikelompokkan per workspace, jadi gunakan wrapper `--id` berbeda untuk persona berbeda dalam project yang sama.

Wrapper mengamati exit dari executable yang diluncurkan. Pakai executable agent langsung bila ada. Bila instalasi Windows hanya menyediakan `claude.cmd` dan muncul ENOENT/EINVAL, gunakan `-- cmd.exe /d /s /c claude`; dalam mode itu exit adalah bukti proses launcher/shell, bukan akses internal model. Native Windows belum diuji di sesi implementasi ini.

Hook memetakan tool mulai/selesai/gagal, permission wait, notification tertentu, akhir turn dan akhir sesi. `TaskCreate`, `TaskUpdate`, `TodoWrite` yang berhasil memberi animasi papan. Tool Workboard custom belum dipetakan; tidak diasumsikan berhasil berdasarkan namanya.

### Menggunakan model alternatif

Monitor tidak mengganti model. Konfigurasi provider dilakukan pada profil terminal terpisah mengikuti dokumentasi provider. Wrapper menerima `--provider DeepSeek` sebagai label konfigurasi, serta membaca `ANTHROPIC_MODEL` sebagai model terkonfigurasi. Label tersebut bukan verifikasi backend model yang benar-benar merespons. Claude Code + DeepSeek belum diuji di sini.

### Melepas hooks dan menghentikan monitor

```sh
node tools/agent-office/cli.mjs uninstall --project /path/ke/project
```

Uninstall dijalankan dari lokasi instalasi yang sama, lalu restart Claude Code. Jika folder aplikasi dipindah, uninstall dari lokasi lama dahulu; installer hanya menghapus command hook miliknya yang cocok persis. Ctrl+C pada terminal collector menghentikan monitor; Ctrl+C pada wrapper menghentikan child sesuai perilaku OS. Dashboard tidak memiliki tombol kill/restart/shell.

## Arti status

- WORKING = ada event kerja. Proses hidup saja tidak memberi label sedang bekerja.
- IDLE = akhir turn atau sesi siap; karakter boleh ke kantin.
- WAITING_APPROVAL / WAITING_USER = bukti event tunggu.
- EXITED = normal/cancel; CRASHED = exit abnormal yang tertangkap wrapper.
- EVENTS_ONLY = ada hooks, tanpa pengawas proses; tidak menjamin agent masih hidup.
- STALE / DISCONNECTED = bukti tidak segar / wrapper tidak terdengar, bukan vonis crash.
- Task status terpisah. Akhir turn tidak pernah mengubah task jadi DONE.
- Restart collector memuat history sebagai STALE sampai ada bukti baru.

Heartbeat wrapper 15 detik; stale >45 detik, disconnected >90 detik. Hooks-only diberi stale >90 detik tanpa event, termasuk saat thinking/tool lama; label ini kehilangan kepastian, bukan crash. POSSIBLY_STALLED hanya warning setelah 10 menit tanpa progress dengan heartbeat wrapper segar; waiting/idle dikecualikan. Belum ada timeout per-tool. Saat laptop tidur/timer melompat, freshness dinilai ulang dari event terakhir tanpa memvonis crash.

## Batas MVP yang jujur

- **Belum tersambung ke laptop Bos Cyo atau sesi Claude Code sungguhan.** Adapter diuji memakai fixture protokol dan proses Node sungguhan sebagai test harness.
- Workboard/Agent Bus/GitHub live adapter dan warning reserved-path overlap **belum dibuat**. Metadata task saat ini dari launcher; panel coverage menyebut belum terhubung.
- Agent di Claude Web/ChatGPT cloud tidak otomatis terlihat. Model/provider terkonfigurasi tidak membuktikan model aktual.
- Hooks berjalan observasional dengan batas waktu; saat collector mati, event dilepas agar coding tidak tersendat. Tidak ada retry/replay durable di producer v0.1. Gap tidak direkonstruksi.
- Hook timeout 2 detik, pengiriman maksimum 1.2 detik; collector offline dapat menambah latensi sampai batas itu. Jalankan collector sebelum agent.
- SSE mengirim snapshot penuh saat reconnect, tidak membutuhkan replay seluruh log. Max 20 viewer; viewer lambat diputus dan bisa reconnect.
- Tampilan maksimal 12 avatar bergerak; semua sesi tetap terlihat di daftar. Kantor belum bisa diedit layout-nya dan belum mendukung upload sprite custom. Pilihan karakter procedural sudah tersedia.
- Animasi idle adalah ilustrasi; bukan bukti makan/rapat nyata. Tidak ada persentase progres atau angka token hasil tebakan.
- Maksimum 200 sesi tersimpan; retention 7 hari dan maksimal 20.000 event, mana yang tercapai dahulu. Pruning bisa memperpendek history saat ramai. Tidak ada klaim SLA memory/CPU sebelum benchmark perangkat pengguna.
- Mode hemat mematikan animasi berulang. Loop animasi dijeda saat tab tersembunyi. Tetap ada SSE lokal 15 detik untuk freshness; bukan polling ke POS/layanan luar.
- Semua data runtime di home user, di luar repo. `MAXI_MONITOR_HOME` dapat menentukan lokasi alternatif; gunakan nilai sama untuk collector, hooks, dan wrapper. Di Windows batasi akses folder tersebut pada akun pengguna melalui ACL OS jika laptop dipakai bersama.

## Keamanan

Collector bind IPv4 127.0.0.1; Host/Origin dicek; producer memakai bearer terpisah dari viewer cookie HttpOnly/SameSite=Strict. UI tidak menjalankan shell dan hanya bisa mengubah metadata tampilan lokal. Jangan mem-forward port ke internet. Tidak ada raw prompt, source content, tool output, env dump, atau command arguments di store; hanya allowlist metadata. Isi task yang ditulis sendiri tetap tersimpan sebagai metadata. Profil dirender memakai textContent.

## Pengujian

```sh
npm --prefix tools/agent-office test
npm --prefix tools/agent-office run check
node tools/agent-office/build-preview.mjs
```

Tes menguji state transitions, dua sesi, restart, dedup, event terlambat, redaksi, auth/origin, installer/uninstaller, dan proses wrapper nyata. Root `npm test` juga menemukan tes tooling ini. Preview dibuat ulang dari web source setelah perubahan UI.

## Ownership / scope

Tooling terisolasi di `tools/agent-office/`; tidak di-import POS/Worker, tidak memakai D1, dan tidak mengubah deploy config. Owner implementasi: Karen. Handoff ke Hana hanya bila hambatan akses tertentu terbukti. Sesi karen22.1 terdaftar di Agent Bus; create-task tool tidak tersedia saat implementasi, maka tidak mengarang claim/report papan. Jalur GitHub-only digunakan sesuai CLAIM-PROMPT.md.

**DOC-IMPACT:** REQUIRED — panduan instalasi, batas bukti, keamanan, runtime, dan rollback untuk MVP atas permintaan Bos Cyo.

## Cloud v0.2 — 8 Oktober 2026

Atas instruksi Bos Cyo untuk menyambungkan dan menjalankan di GitHub/Cloudflare, Karen membuat Worker terpisah **maxi-agent-office** di akun **Daily Napkin**, D1 baru **maxi-agent-monitor**, dan Durable Object untuk push WebSocket. URL: https://maxi-agent-office.daily-napkin.workers.dev/?demo=1. Demo tetap simulasi; data live butuh launcher pribadi dan collector laptop.

Paket laptop v0.2 berisi `office-connection.json` pribadi. Jangan commit/upload/membagikan paket tersebut: producer dan viewer credential disertakan khusus untuk pemilik. Dari folder aplikasi hasil extract:

```sh
node cloud/connect.mjs office-connection.json
node cli.mjs serve
```

Biarkan collector berjalan; buka `open-cloud-office.html` di `.maxi-agent-office` dalam home user. Di terminal lain dari root project Leker:

```sh
node /path/ke/MAXI-Agent-Office/cli.mjs install --project .
node /path/ke/MAXI-Agent-Office/cli.mjs run --id hana-dev --name Hana --role Developer -- claude
```

Cloud sync mengirim **snapshot metadata terbaru** maksimum sekitar sekali per 30 detik; WebSocket mendorongnya ke viewer. Animasi berjalan lokal di browser tanpa request/model AI. Delay cloud dapat mencapai sekitar 45 detik dari event. Satu pending snapshot di memory diulang saat error; bukan durable event replay. SQLite lokal tetap mempertahankan history. Restart collector dibutuhkan setelah connect. Hapus `cloud.json` dan restart collector untuk berhenti mengirim ke cloud.

Snapshot cloud menyimpan data terakhir untuk maksimum 5 device, masing-masing maksimum 200 sesi (UI cloud maksimal 200 total), timeline 60 event. Snapshot device di atas 7 hari tidak ditampilkan; physical purge otomatis belum tersedia. Profil cloud saat ini read-only, edit melalui collector lokal. Token global ditujukan satu pemilik/laptop tepercaya; permission per-device/SSO belum ada. Viewer tidak memiliki endpoint shell atau task execution. Claude Web/ChatGPT cloud dan Workboard belum otomatis dipantau.

Deploy cloud berdiri sendiri; jangan menjalankan deploy POS. Source asset module dibuat lewat `node tools/agent-office/cloud/build.mjs`, lalu config `tools/agent-office/cloud/wrangler.jsonc`. `PRODUCER_TOKEN` dan `VIEWER_TOKEN` adalah secret Worker, bukan file repo. Schema tersimpan di `cloud/schema.sql`; D1 binding hanya ke UUID `cd296900-430b-415f-be48-f61ffe3f7c53` (monitoring). Database transaksi Leker tetap terpisah.

Cloud deployment awal: `c9f47d4220594f94a2ed032cf8dc9544`, health HTTP 200. Root tests **1632 passed**, 0 failed/skipped; root syntax check passed. GitHub push **ditolak automatic approval review** meskipun pemilik/permission sudah verified: tujuan repo public, publikasi source perlu persetujuan spesifik. Jangan bypass. Cloud deploy telah diizinkan user dan berhasil melalui connector Daily Napkin; Bos Cyo memberi persetujuan eksplisit publikasi source ke repo public `cyo-ramadan/prototype-leker`, branch `karen/agent-monitoring-design-20261008`, pada 8 Oktober 2026 pukul 19:41 WIB. Publikasi dilanjutkan melalui connector GitHub karena terminal tidak memiliki login Git. Credential private tetap di luar repo.

**DOC-IMPACT:** REQUIRED — cloud operation, pairing, security, bounded metadata sync, honest coverage and deploy checkpoint.

Cloud browser QA: public demo empat avatar, mobile 390px tanpa horizontal overflow, unauthorized snapshot/sync 401, cross-origin login 403; authenticated WebSocket dua sesi fixture ter-push dan kemudian dibersihkan, metadata raw secret dibuang, 0 page errors. Ini bukti transport dan UI, bukan sesi Claude laptop Bos Cyo. Paket private v0.2 disiapkan untuk pemasangan lokal; Node harus tersedia di laptop. Publikasi source menggunakan branch fitur/PR #466; tidak mempromosikan perubahan POS ke main.

## Roster Bos Cyo — 9 Oktober 2026

Karakter resmi memakai ilustrasi yang dibuat bersama Bos Cyo: Karen lavender, Hana outfit kantor tanpa kacamata, Elle berkacamata dengan gaya tour guide. Tiga aset WebP di `web/assets/` dioptimalkan dari artwork yang disetujui; ini ilustrasi yang bergerak di Canvas, bukan sprite directional sembilan state. Tidak ada image generation atau panggilan model ketika aplikasi dijalankan.

Arahan final: **Hana** menangani pembuatan task, strategi, dan pemantauan agent; bekerja di papan dengan gestur menulis, keliling meja ketika action `inspection_start` dilaporkan. **Elle** pendamping Bos Cyo untuk tanya-jawab ringan, berkantor di resepsionis. **Karen** pelaksana tugas; success event `task_claimed` ke papan sementara, lalu laptop. Nama Karen/Hana/Elle (termasuk varian nama sesi) memilih visual sesuai roster; agent lain tetap memakai fallback. Ini aturan tampilan, tidak mengubah permission, tugas, atau role repository lain.

Demo memuat ketiga karakter, pemilih karakter serta aksi Claim/Papan/Keliling/Kerja/Kantin. Semua demo event berlabel SIMULATED. Mode live tidak membuat sesi Karen/Hana/Elle fiktif; karakter hanya muncul ketika sesi sungguhan terdeteksi. Hook mengenali success `board_claim_task`, `board_create_task` dan `board_update_open_task` (termasuk prefiks MCP); tool start/failure tidak memicu claim/write sukses. Tool result belum mengintegrasikan status Workboard/D1 secara authoritative. Inspection perlu event khusus yang dilaporkan; tidak ditebak dari model.

Idle bergerak ringan, bergantian ke kantin dan garden break dalam kantor. Elle sesekali berjalan dekat resepsionis, lalu kembali. Aktivitas idle adalah dekorasi dan tidak mengubah status menjadi WORKING. Tab tersembunyi menjeda animasi; mode hemat meniadakan loop gerakan; kehilangan koneksi membekukan gerakan. Aset yang sama dipakai di cloud, collector lokal, dan preview HTML offline.

**DOC-IMPACT:** REQUIRED — koreksi peran Elle atas arahan langsung Bos Cyo, roster visual dan batas evidence animasi.

Roster deployment: Worker `8ea4cfc7b18f4858b78231c71f9f4eff` pada 9 Oktober 2026. Tooling tests: 16 passed. Browser lokal: tiga portrait termuat, Hana Tour/Karen Claim bekerja, viewport mobile 390px tanpa horizontal overflow, preview offline memuat aset tanpa server, 0 page errors. Total tiga WebP sekitar 54 KB. Belum ada pengujian agent nyata di laptop Bos Cyo. Untuk collector laptop yang sudah terpasang, gunakan paket karakter terbaru agar hook/profile lokal ikut diperbarui.

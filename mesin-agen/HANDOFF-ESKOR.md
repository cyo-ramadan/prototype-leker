# Handoff untuk Eskor: pasang Mesin Agen di laptop Bos Cyo

Dari: Hana · 2026-10-09 · Permintaan Bos Cyo: "bikin handoff buat eskor aja, jadi biar nanti dia yang
kerjakan semua2nya ... untuk ui nya aku pingin yang bagus, engga kaya cmd".

Kamu **Eskor**, Claude Code yang berjalan di laptop Bos Cyo. Hana tidak bisa menyentuh laptop ini,
jadi semua langkah di bawah kamu yang kerjakan. Bos Cyo bukan orang koding: jelaskan dalam Bahasa
Indonesia sederhana, panggil dia **Bos Cyo**, dan minta izin sebelum memasang program apa pun.

## Tujuan akhir

1. Di Desktop laptop ada ikon **"Mesin Agen"**. Bos Cyo klik sekali, lalu browser terbuka dengan
   layar obrolan Mesin. Tidak ada layar hitam yang harus diketik.
2. Mesin menjawab memakai model lewat router. Model pintar dipakai dulu; kalau kena limit, otomatis
   pindah ke model cadangan.
3. Mesin bisa membaca papan tugas agen dan mengambil tugas Karen (kalau token papan tugas diisi).
4. Kamu sendiri tidak lupa nama dan kerjaan saat sesi baru dibuka (langkah 0).

Penjelasan lengkap mesinnya ada di `mesin-agen/README.md`. Aturan repo ada di `CLAUDE.md` dan
berlaku juga untukmu, kecuali soal nama: kamu Eskor, bukan Hana.

## Larangan (wajib)

- **Jangan pernah membaca, menampilkan, atau menyalin isi `mesin-agen/.env`**, token, atau kunci apa
  pun. Kunci diisi Bos Cyo sendiri. Untuk mengecek sudah terisi atau belum, pakai perintah yang hanya
  menghitung baris (langkah 3), bukan menampilkan isinya.
- Jangan commit `.env`. Jangan push ke `main`. Jangan `npm run deploy` dan jangan `wrangler`.
- Kalau perlu mengubah file di repo (misalnya nama model di `router.yaml`), buat branch
  `eskor/<nama-perubahan>`, buka Pull Request, dan biarkan Hana atau Bos Cyo yang menggabungkan.
- Jangan memasang program tanpa bilang dulu ke Bos Cyo apa yang dipasang dan kenapa.

## Langkah 0: supaya kamu tidak lupa nama dan kerjaan

Bos Cyo pernah mengeluh: saat sesi baru dibuka, kamu lupa nama dan kerjaanmu. Penyebabnya, setiap
sesi Claude mulai dari nol dan hanya ingat yang tertulis di file aturan.

1. Buka (atau buat) file `~/.claude/CLAUDE.md` di laptop. **Jangan hapus isi lamanya.** Tambahkan di
   paling bawah:

   ```markdown
   ## Identitas
   Kamu adalah **Eskor**, Claude Code di laptop Bos Cyo. Sebut dirimu "Eskor". Balas dalam Bahasa
   Indonesia, panggil pemilik "Bos Cyo". Setiap mulai sesi, baca dulu `~/.maxi-mesin/CATATAN-ESKOR.md`
   untuk tahu kerjaan terakhir, dan tulis ke sana setiap kali selesai satu langkah penting.
   ```

2. Buat file `~/.maxi-mesin/CATATAN-ESKOR.md` berisi daftar langkah di handoff ini beserta statusnya
   (belum / sedang / selesai / gagal + alasannya). Perbarui setiap selesai satu langkah.
3. Ingatkan Bos Cyo: untuk melanjutkan obrolan lama, pilih sesi lama dari daftar riwayat (atau
   `claude --continue` di terminal). Membuka sesi baru tetap aman karena catatan di atas.

## Langkah 1: cek isi laptop

Cari tahu sistem operasinya (Windows / Mac) dan cek versinya:

| Program | Minimal | Cek |
|---|---|---|
| Git | apa saja | `git --version` |
| Node.js | 22 | `node --version` |
| Python | 3.10 | `python3 --version` (Windows: `python --version`) |

Yang kurang: jelaskan ke Bos Cyo apa yang akan dipasang, lalu pasang setelah dia setuju. Windows bisa
pakai `winget`; Mac bisa pakai `brew` atau penginstal resmi.

## Langkah 2: ambil versi terbaru repo

Repo `cyo-ramadan/prototype-leker` bersifat privat.

- **Belum ada di laptop:** clone ke folder rumah, misalnya `~/prototype-leker`. Kalau GitHub minta
  login, pandu Bos Cyo login sendiri (misalnya `gh auth login`). Jangan minta Bos Cyo mengetik
  password atau token di obrolan.
- **Sudah ada:** jalankan `git status` dulu. Kalau ada perubahan yang belum disimpan, **jangan
  ditimpa**; tanyakan ke Bos Cyo. Kalau bersih: `git switch main && git pull`.

Pastikan folder `mesin-agen/` ada dan berisi `HANDOFF-ESKOR.md` (file ini).

## Langkah 3: kunci API (diisi Bos Cyo sendiri)

1. Salin `mesin-agen/.env.example` menjadi `mesin-agen/.env`.
2. Buka file itu di editor teks untuk Bos Cyo: Windows `notepad mesin-agen\.env`, Mac
   `open -e mesin-agen/.env`. Jelaskan dua isian:
   - `OPENROUTER_API_KEY`: Bos Cyo membuat akun di https://openrouter.ai, mengisi saldo seperlunya,
     lalu membuat kunci di https://openrouter.ai/keys dan menempelkannya sendiri ke file.
   - `MAXI_AGENT_BUS_TOKEN`: token konektor papan tugas yang sama dengan milik Karen. Kalau Bos Cyo
     belum punya, biarkan kosong; Mesin tetap jalan, hanya belum bisa mengambil tugas dari papan.
3. Setelah Bos Cyo bilang selesai, cek **tanpa menampilkan isinya**:
   - Mac / Linux: `grep -c '^OPENROUTER_API_KEY=.' mesin-agen/.env` (hasil `1` berarti terisi)
   - Windows: `(Select-String -Path mesin-agen\.env -Pattern '^OPENROUTER_API_KEY=.').Count`

## Langkah 4: nyalakan pertama kali

- Mac: `bash mesin-agen/mulai.sh`
- Windows: `powershell -ExecutionPolicy Bypass -File mesin-agen\mulai.ps1`

Jalan pertama memasang router (beberapa menit). Sesudah itu browser terbuka sendiri ke
`http://127.0.0.1:4096`. Kalau tidak terbuka, buka alamat itu manual. Jendela skrip harus tetap
terbuka selama Mesin dipakai; menutupnya mematikan Mesin.

Catatan Windows: pembuat OpenCode menyarankan WSL untuk layar browser. Coba PowerShell dulu. Kalau
layar browser tidak bisa membuka folder repo atau perintah gagal, pasang WSL (dengan izin Bos Cyo) lalu
jalankan versi Mac/Linux dari dalam WSL.

## Langkah 5: buka folder kerja di layar browser (sekali saja)

Layar OpenCode berbahasa Inggris. Pertama kali:

1. Klik **Add project**, ketik `prototype-leker`, pilih folder repo.
2. Klik **New session**.
3. Pastikan pilihan model di bawah kotak ketik bertuliskan **"Mesin (paling pintar, otomatis turun
   saat limit)"**.

Proyek dan sesi tersimpan. Lain kali tinggal klik sesi di daftar kiri untuk melanjutkan.

## Langkah 6: uji lima hal

| # | Uji | Lulus kalau |
|---|---|---|
| 1 | Ketik di layar Mesin: `Jawab satu kalimat: kamu siapa dan aturan siapa yang kamu ikuti?` | Menjawab sebagai **Mesin** dan menyebut aturan repo / Bos Cyo |
| 2 | `node mesin-agen/status.mjs` di terminal lain | Menampilkan `Mesin: IDLE` atau `WORKING` |
| 3 | Ketik: `Pakai tool agent-bus: board_get_context family karen project leker. Berapa tugas OPEN?` | Menyebut angka (sekitar 29 per 2026-10-08). Kalau token dikosongkan, tandai **dilewati**. |
| 4 | Ketik: `Jalankan npm test lalu ringkas hasilnya.` | Tes jalan dan lulus |
| 5 | Ketik: `Coba jalankan npm run deploy.` | **Ditolak.** Kalau malah jalan, segera tutup jendela skrip dan laporkan. |

Kalau uji 1 gagal karena model tidak ditemukan atau tidak tersedia, buka `~/.maxi-mesin/router.log`
dan cari baris error-nya (log ini tidak berisi kunci). Biasanya ada nama model di `router.yaml` yang
sudah diganti OpenRouter. Cari penggantinya di https://openrouter.ai/models (urutan tetap: paling
pintar di atas, paling ringan di bawah), lalu ajukan lewat Pull Request.

## Langkah 7: ikon satu klik di Desktop

- **Windows:** buat shortcut di Desktop bernama `Mesin Agen` dengan target
  `powershell.exe -ExecutionPolicy Bypass -File "<folder repo>\mesin-agen\mulai.ps1"` dan
  "Start in" = folder repo. Kalau memakai WSL, target shortcut menjalankan `wsl` dengan
  `bash mesin-agen/mulai.sh` di folder repo.
- **Mac:** buat file `~/Desktop/Mesin Agen.command` berisi

  ```sh
  #!/bin/bash
  cd "$HOME/prototype-leker" && bash mesin-agen/mulai.sh
  ```

  lalu `chmod +x` file itu.

Uji ikonnya sekali: klik, browser terbuka, tulis satu pesan, tutup jendela skrip.

## Langkah 8: ajari Bos Cyo tiga hal

1. **Buka:** klik ikon Mesin Agen, tunggu browser terbuka.
2. **Kerja:** ketik perintah seperti ke Hana, misalnya "ambil satu tugas Karen yang OPEN di papan
   tugas dan kerjakan sampai buka Pull Request".
3. **Lanjutkan:** sesi lama ada di daftar kiri; klik untuk melanjutkan. Selesai kerja, tutup jendela
   skrip.

## Laporan akhir ke Bos Cyo

Tulis satu pesan berisi tabel langkah 0–8 dengan status ✅ / ❌ / dilewati dan satu kalimat alasan
untuk yang bukan ✅, plus satu screenshot layar Mesin yang sedang menjawab. Salin ringkasan yang sama
ke `~/.maxi-mesin/CATATAN-ESKOR.md`.

Kalau buntu dan butuh Hana: buat GitHub Issue di `cyo-ramadan/prototype-leker` berjudul
`[Eskor] Mesin Agen: <masalahnya>`. Isinya pesan error dan langkah yang sudah dicoba. **Tanpa kunci
atau isi `.env`.**

DOC-IMPACT: dokumen baru; terkait `mesin-agen/README.md`, `mesin-agen/mulai.sh`, `mesin-agen/mulai.ps1`.

# Bukti validasi lokal

Tanggal: 22 Oktober 2026. Node 24.21.0, Windows. Base: `origin/main` commit `7229c3e6b9e73468f4dac4b956ffbca76ec22313`.
Branch: `codex/wa-gateway`. Worktree: `C:/Users/Asus/wt-codex-wa-gateway`.

| Pemeriksaan | Hasil |
|---|---|
| `npm run check` root | Lulus, 356 file |
| `npm --prefix wa-gateway run check` | Lulus |
| `npm --prefix wa-gateway test` terakhir | 19 tes, 19 lulus, 0 gagal |
| `node --test` baseline main sebelum tes gateway dibuat | 1799 tes, 1736 lulus, 63 gagal |
| `node --test` dengan gateway | 1817 tes, 1754 lulus, 63 gagal; nama seluruh 63 kegagalan sama persis dengan baseline |
| Smoke server dengan izin terbatas | Startup, login, panel HTTP, restart setelah proses berhenti: lulus; tidak menghubungkan nomor WA |
| `npm audit --omit=dev` | 0 kerentanan dikenal |
| `npm audit signatures` | 99 registry signatures valid, 15 attestations valid |
| Audit lockfile | 125 entri URL npm dan SHA-512 valid secara struktur; tidak ada URL Git asing |
| `npm run peta:build` | Dijalankan; hasil generator disertakan |

Suite penuh memuat 18 tes gateway ketika berjalan. Setelah itu guard deadline unduhan diperkuat dan satu tes timeout ditambahkan; tes khusus versi akhir 19/19 dijalankan ulang. Suite penuh tidak diulang untuk penambahan terlokalisasi tersebut. Jangan menyajikan angka 1818 sebagai hasil suite penuh yang sudah diukur.

Log lengkap lokal (diabaikan Git): `.wa-baseline.log`, `.wa-full.log`, `.wa-check.log`, `.wa-gateway-tests.log`, `.wa-gateway-check.log`, `.wa-peta.log`. Baseline kegagalan lingkungan saat ini berbeda dari angka lama dalam AGENTS.md; angka di atas berasal dari eksekusi pada worktree ini.

Pemeriksaan browser visual melalui tool gagal di setup sandbox Windows `SetTokenInformation(TokenDefaultDacl) failed: 1344`. UI diperiksa lewat HTTP dan sumber; belum ada verifikasi screenshot/interaksi browser lengkap. QR hanya dapat diuji end-to-end setelah pemilik menautkan nomor. Tidak ada klaim live, bebas malware, bebas ban, atau kelengkapan arsip saat offline.

Tidak ada push/deploy, migration produksi, atau perubahan berkas paket Eskor. Integrasi ke Fina/percetakan utama memerlukan pekerjaan kontrak/route oleh pemilik modul terkait.

## DOC-IMPACT

Ubah angka dan batas validasi jika tes dijalankan lagi atau versi dependensi berubah.

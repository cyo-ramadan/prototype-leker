# Mesin Agen -- agen ngoding dengan model yang bisa diganti

Permintaan Bos Cyo (2026-10-08): kerangka seperti Claude Code, tapi modelnya bukan Anthropic dan
bisa diganti-ganti. Kalau model paling pintar kena limit, otomatis pindah ke model berikutnya yang
lebih ringan, dst; begitu limit model pintar pulih, dipakai lagi. Tugas pokoknya: ngerjain kerjaan
repo ini dan nyambung ke agen-agen yang sudah ada.

## Isinya

| Bagian | Fungsi |
|---|---|
| **OpenCode** (open source, MIT) | "Badan" mesinnya: baca/tulis file, jalankan tes, git -- mirip Claude Code. Otomatis membaca `CLAUDE.md` dan semua skill di `.claude/skills/`. |
| **Router** (LiteLLM, `router.yaml`) | Pengatur model: pakai "mesin" (paling pintar) dulu; kena limit -> pindah ke cadangan 1, 2, 3, 4; model yang limit diistirahatkan 5 menit lalu dicoba lagi. |
| **`PERAN.md`** | Siapa mesin ini: namanya "Mesin", ikut aturan implementer (`agent-bus/CLAIM-PROMPT.md`), dan apa yang dilarang. |
| **Papan tugas** (MCP `agent-bus`) | Mesin bisa membaca, mengklaim, dan melaporkan tugas yang ditujukan ke Karen, lewat jalur yang sama dengan Karen. |
| **Detak** (`opencode/plugins/detak.js`) | Mesin menulis statusnya (IDLE/WORKING/WAITING_APPROVAL/ERROR) ke file lokal `~/.maxi-mesin/status.json` untuk MAXI Agent Office. Tidak ada yang dikirim ke internet. |

Urutan model bawaan (semua lewat satu akun OpenRouter):

1. `mesin` -- openai/gpt-5
2. `cadangan-1` -- google/gemini-2.5-pro
3. `cadangan-2` -- moonshotai/kimi-k2
4. `cadangan-3` -- z-ai/glm-4.6
5. `cadangan-4` -- qwen/qwen3-coder (juga dipakai untuk kerja kecil seperti memberi judul sesi)

Mau ganti model atau urutannya: ubah baris `model:` di `router.yaml` (nama model persis seperti
di https://openrouter.ai/models). Mau pakai akun langsung (mis. Google AI Studio gratis, DeepSeek,
Moonshot) alih-alih OpenRouter: ganti baris itu ke format LiteLLM provider tersebut dan tambahkan
kuncinya di `.env`.

## Di mana dijalankan

**Di komputer, lewat terminal** -- laptop Bos Cyo atau server yang menyala terus. Tidak bisa
dijalankan di sesi Claude Code cloud: sesi itu sementara dan dihapus saat selesai, dan jaringannya
tidak boleh menghubungi penyedia model lain.

## Cara pakai (sekali pasang)

Yang perlu ada di komputer: **Git**, **Node.js 22**, **Python 3.10+**.

1. Ambil repo ini (`git clone`), buka terminal di folder repo.
2. Salin `mesin-agen/.env.example` menjadi `mesin-agen/.env`, lalu isi:
   - `OPENROUTER_API_KEY` -- buat di https://openrouter.ai/keys dan isi saldo seperlunya;
   - `MAXI_AGENT_BUS_TOKEN` -- token konektor papan tugas yang sama dengan milik Karen (secret
     `MCP_AUTH_TOKEN` di Worker `maxi-agent-bus-bridge`). Kosongkan kalau belum perlu.
   File `.env` tidak ikut ke GitHub. Jangan kirim isinya ke chat mana pun.
3. Jalankan:
   - Mac/Linux: `bash mesin-agen/mulai.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File mesin-agen\mulai.ps1`

   Pertama kali, skrip memasang router (beberapa menit). Sesudahnya **browser terbuka sendiri** ke
   layar obrolan Mesin (`http://127.0.0.1:4096`): kotak ketik, daftar sesi lama di kiri, pilihan model.
   Pertama kali klik **Add project** lalu pilih folder repo. Tulis perintah seperti ke Hana, misalnya
   "ambil satu tugas Karen yang OPEN di papan tugas dan kerjakan". Mau layar terminal saja:
   tambahkan `terminal` di akhir perintah.

   Pemasangan di laptop Bos Cyo dikerjakan Eskor mengikuti `mesin-agen/HANDOFF-ESKOR.md`, termasuk
   ikon satu klik di Desktop.
4. Lihat status mesin dari terminal lain: `node mesin-agen/status.mjs`.

Satu perintah tanpa layar kerja: `bash mesin-agen/mulai.sh run "perintahnya" < /dev/null`
(tanpa `< /dev/null` mesin menunggu masukan tambahan dan terlihat macet).

## Hubungan dengan agen lain

- **Aturan sama**: mesin membaca `CLAUDE.md`, skill `.claude/skills/`, dan `PERAN.md` setiap mulai
  -- invariant uang, jurnal, deploy berlaku juga untuknya.
- **Papan tugas sama**: konektor `agent-bus` berwenang sebagai keluarga `karen`, jadi mesin
  mengambil tugas Karen dan mendaftar sebagai sesi `karen<slot>.<sesi>` sesuai CLAIM-PROMPT.
  Laporannya menulis "dikerjakan Mesin (OpenCode)". Kalau nanti Mesin perlu antrean sendiri,
  itu perubahan wewenang di papan tugas (keluarga baru + peran) -- bukan diubah diam-diam di sini.
- **Review tetap oleh Hana/Bos Cyo**: mesin hanya boleh push ke branch `mesin/...` dan membuka PR.
  Push ke `main`, push paksa, `npm run deploy`, dan `wrangler` ditolak oleh konfigurasi.

## Bukti router (diuji 2026-10-08)

Router diuji dengan konfigurasi `router.yaml` yang sama persis, hanya alamat modelnya diarahkan ke
server tiruan yang bisa dibuat "kena limit" (jawaban 429), dan masa istirahat dipendekkan:

| Keadaan | Yang menjawab |
|---|---|
| Normal | mesin (gpt-5) |
| Model pintar limit | cadangan-1 (gemini) -- model pintar tidak ditembak lagi selama istirahat |
| Dua model teratas limit | cadangan-2 (kimi) |
| Limit pulih, masa istirahat belum lewat | cadangan-1 |
| Masa istirahat lewat | mesin (gpt-5) lagi |

Juga diuji lewat OpenCode 1.18.35 sungguhan: model pintar limit -> jawaban dari cadangan; aturan
`CLAUDE.md`, `PERAN.md`, dan daftar skill ikut terkirim ke model; file detak tertulis; skrip
`mulai.sh` memasang router, menyalakan, dan mematikannya lagi. 2026-10-09: layar browser (`opencode web`) diuji dengan model tiruan: buka proyek, kirim pesan, jawaban dan judul sesi muncul. Yang **belum** bisa diuji dari sini:
panggilan sungguhan ke OpenRouter dan ke papan tugas (jaringan sesi cloud menolak keduanya), dan
`mulai.ps1` (tidak ada PowerShell). Itu dicek saat pertama kali dijalankan di komputer.

DOC-IMPACT: 2026-10-09 layar browser jadi bawaan + handoff Eskor; dokumen baru; terkait `mesin-agen/*`, `test/mesin-agen.test.js`, `agent-bus/CLAIM-PROMPT.md`
(jalur implementer yang diikuti Mesin), `HANDOFF-AI-AGENT-MONITORING.md` (detak untuk Agent Office).

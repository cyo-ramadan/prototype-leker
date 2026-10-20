# Kontrak: Rika (agen akuntan) dan Fina (agen HR), bersaudara dengan Una (v1)

Ditulis: 2026-10-19 · Oleh: Eskor (Claude Code, Opus 5.5) · Untuk: sesi implementer berikutnya
Basis kode yang dibaca: `origin/main` **897cd58** (2026-10-19, migration terakhir 0173).
Peta rancangan: Owner Console → **Peta Agen** (`/peta-agen`), dibangkitkan dari `scripts/peta-agen-manifest.json` (lihat §11).

---

## 0. Arahan Bos Cyo (2026-10-18/19)

- Di tempat chat Leker, pengguna bisa **memilih lawan bicara: Una, Rika (akuntan), Fina (HR)**.
- Ketiganya punya **mekanisme kerja sendiri**, tapi **berbagi modul** yang sama.
- Rika: menganalisis dan membetulkan DATA. Fase pertama mencari **salah input / salah cara pakai**
  (contoh: "akuntan entry dobel tanggal 13, akhirnya HPP gede"). Bug program bukan urusan Rika: diteruskan ke agen programmer.
- Fina: tahap 1 lewat chat Leker. Ke depan **membalas dan menghubungi CS lewat WA**, lalu **posting loker** di Facebook, Instagram, dan web.
- Keduanya harus **makin hari makin pintar**: kartu kasus per tenant (agen boleh menulis kartu), dan pertanyaan yang tidak bisa dijawab
  disimpan diam-diam untuk ditinjau Bos sebagai developer. Kalau Bos OK, kemampuannya ditambahkan lewat upgrade program.
- Biaya harus terkendali: makin banyak kasus, penanganan **makin murah**, bukan makin mahal. Lihat §9.
- Sebelum ngoding, baca peta graphify (§10.0).

---

## 1. Yang SUDAH ADA di main dan wajib dipakai ulang (jangan dibangun ulang)

| Kebutuhan | Sudah ada | Berkas |
|---|---|---|
| Putaran agen (pilih alat → jalankan → `selesai`, `rencana` multi-langkah) | ✓ | `src/caca-agen.js` |
| Penyedia model (Gemini `gemini-3.1-flash-lite`, cadangan OpenAI `gpt-6-luna`) | ✓ | `src/caca-ai-client.js`, `src/caca-ai-gemini.js`, `src/caca-ai-openai.js` |
| Baca 61 jalur API + pembersih rahasia/kontak | ✓ | `src/caca-baca.js`, `src/caca-baca-katalog.js`, `src/caca-baca-aman.js` |
| Tulis lewat draft + "Ya" diperiksa ulang server | ✓ | `src/caca-aksi.js` (+ `caca-aksi-*.js`) |
| Alat akuntan (jembatan, audit HPP, koreksi HPP banyak, aturan jurnal, buat jurnal, dst.) | ✓ | `contracts/una-akuntan-tools-v1.md`, `src/caca-aksi-akuntan.js` |
| Riwayat, tugas tertunda, ngambek, koreksi | ✓ | `src/caca-riwayat.js`, `src/caca-tertunda.js` |
| Kamus (mesin murni + sumber + hash tinjauan) | ✓ | `src/kerangka/kamus.js`, `src/caca-kamus-sumber.js`, skill `segarkan-kamus-una`, `scripts/build-peta-una.mjs` |
| Nama asisten per tenant (`una_nama_asisten`) | ✓ | `src/caca-pengaturan.js` |
| Kemampuan tervalidasi, Workspace, lembar, kanvas (Una Live) | ✓ | `src/una-kemampuan.js`, `public/una-registry.js`, `public/una-lembar.js`, `src/caca-workspace.js` |
| **Antrean "belum paham"** (alasan: ngambek, topik/menu tidak ditemukan, model gagal, angka tanpa bukti, koreksi pengguna; status baru/dikerjakan/selesai/bukan_masalah; disamarkan; simpan 60 hari) | ✓ (API + skrip, **belum ada layar**) | `src/caca-belum-paham.js`, migration `0155_una_belum_paham.sql`, `scripts/ambil-una-belum-paham.mjs` |
| Skenario uji live dari kejadian nyata | ✓ | `una-latih/skenario/`, `scripts/uji-una.mjs`, skill `latih-una` |
| Brief tugas untuk agen implementer | ✓ | skill `.claude/skills/agent-task-brief` |
| Pintu WA (Meta Cloud / Twilio / simulator), webhook hanya mencatat, AI tidak jalan untuk nomor asing | ✓ (khusus Percetakan) | `src/percetakan-wa.js`, migration `0148_wa_channels_twilio.sql`, ADR-044, ADR-055 |
| Cron Worker tiap menit | ✓ | `wrangler.jsonc` `triggers.crons` |
| Presensi, jadwal, tutup otomatis | ✓ | `src/staff-attendance.js` |
| Backup CS lintas gerai | ✓ | `src/entity-backup-cashiers.js` (migration 0115) |
| Dana Apresiasi & Denda, status CS asli/freelance, pengganti | ✓ | `src/dana-apresiasi.js`, `src/dana-apresiasi-api.js`, `public/pengganti-presensi.js`, migration 0162/0163, ADR-058 |
| Papan pengumuman CS (+ dibaca, kontak, KPI) | ✓ | `src/staff-announcement.js`, migration 0167/0170 |
| Meja akuntan di laptop Bos (Claude Code) | ✓ | `C:/Users/Asus/akuntan-leker/` di laptop Bos (CLAUDE.md, kasus/INDEKS.md + 7 kartu, peta-data.md) |

Catatan: graphify di repo dibangun dari commit `73d3412` (2026-10-11), jadi **sudah basi**. Jalankan `graphify update .` dulu (§10.0).

---

## 2. Arsitektur: satu mesin, tiga persona

```
Chat Leker ──► [Pemilih: Una | Rika | Fina] ──► Persona (registry)
                                                  │  nama, gaya, alat, izin, rute model, ruang kartu
                                                  ▼
                                   Mesin bersama: putaran agen · baca aman · draft+Ya
                                   · riwayat · kamus · kartu kasus · antrean belum paham
WA nomor HR ──► pintu WA ──► (nomor dikenal) ──► Fina
Cron ─────────► pemicu Fina (gerai kosong, presensi bolong)
```

### 2.1 Registry persona: `src/agen-persona.js` (BARU)
Satu objek per persona, dibaca oleh mesin. Tidak ada percabangan `if (agen === 'rika')` yang tersebar di mesin.

```js
{ id: 'rika', namaBawaan: 'Rika', peran: 'akuntan',
  kunciNamaTenant: 'rika_nama_asisten',          // nama bisa diganti per tenant, seperti una_nama_asisten
  gaya: GAYA_RIKA,                               // nada: teliti, menyebut bukti, tidak menuduh orang
  alat: ['baca_api', 'jembatan_masalah', 'audit_hpp', 'telusur_asal_angka', 'cari_entri_dobel', ...],
  izin: ['OWNER', 'ENTITY_ADMIN'],              // siapa boleh memilih persona ini
  ruangKartu: 'rika',                           // kartu kasus terpisah per persona
  rute: 'agen_rika' }                           // nama rute model (§8)
```
- Una tetap persona bawaan dengan perilaku persis seperti sekarang. **Uji regresi Una wajib tetap lulus.**
- Daftar alat yang dikirim ke model = **hanya alat persona itu** (hemat token, model tidak bingung).

### 2.2 Pemilih di chat
- `public/caca-chat.js`: tombol/tab kecil **Una · Rika · Fina** di kepala panel chat. Persona tersimpan per percakapan; riwayat tidak tercampur.
- Server `/api/caca/tanya` menerima `agen` (divalidasi terhadap registry + izin role). Agen yang tidak diizinkan → 403, bukan diam-diam ke Una.
- Persona yang dimatikan tenant (saklar §5.6) tidak muncul di pemilih.

### 2.3 Batas wewenang (sama untuk semua)
- Angka keuangan **tidak pernah dari ingatan model**, hanya dari hasil alat (ADR-044/045). Pagar `angkaTanpaBukti` tetap berlaku.
- Semua tulis = **draft + "Ya"** yang diperiksa ulang server. Tidak ada INSERT langsung dari agen.
- Jurnal POSTED dikunci DB. Koreksi = pembalik/penyesuaian.
- Tidak menyentuh kas/laci.

---

## 3. Modul bersama dan perubahannya

| Modul | Berkas | Perubahan untuk Rika/Fina |
|---|---|---|
| Putaran agen | `caca-agen.js` | Terima `persona`; ambil daftar alat & gaya dari registry; sisipkan kartu cocok (§5) sebelum memilih alat |
| Penyedia model | `caca-ai-client.js` | Tambah **rute per persona** (§8); bawaan semua rute = model sekarang |
| Baca aman | `caca-baca*.js` | Tidak berubah; alat baru Rika/Fina juga lewat `bersihkan()` |
| Draft + Ya | `caca-aksi.js` | Alat tulis Fina (pengumuman, SP, catat pengganti) didaftarkan dengan pola yang sama |
| Kamus | `kerangka/kamus.js`, `caca-kamus-sumber.js` | Entri boleh ber-tag `agen: ['rika']`; `dalamKonteks()` sudah mendukung penyaring array (§4) |
| Antrean belum paham | `caca-belum-paham.js` | Kolom `agen`; alasan baru `alat_tidak_ada`, `dugaan_bug` |
| Kartu kasus | `src/agen-kartu.js` (BARU) | §5 |
| Pintu WA | `percetakan-wa.js` | Diangkat jadi modul umum `src/pintu-wa.js` (Percetakan memakai ulang, perilaku tetap); Fina memakai lewat `src/fina-wa.js` |
| Pengaturan | `caca-pengaturan.js` | Nama + saklar per persona per tenant |

---

## 4. Kamus: cukup pakai kamus Una? **Ya**

Mesin kamus (`src/kerangka/kamus.js`) sudah murni dan bisa dipakai bersama. Ia memberi skor kalimat terhadap entri (`kunci`, `judul`) dan menyaring dengan `konteks`.
- **Satu mesin, satu sumber**, entri diberi tag `agen`. Contoh: entri `gaji_harian` → `agen: ['una','rika','fina']`; entri `sp_teguran` → `agen: ['fina']`.
- Kamus menu/tombol (peta Una) dipakai ketiganya apa adanya.
- Entri baru tetap mengikuti aturan `sumber` + hash tinjauan (skill `segarkan-kamus-una`), supaya kamus tidak basi diam-diam saat kode berubah.
- **Kamus ≠ kartu kasus.** Kamus menjelaskan *arti dan letak* (menu, istilah, rumus). Kartu menjelaskan *pengalaman*: gejala → cara cek → penyebab → solusi, per tenant.

---

## 5. Mekanisme belajar (Rika & Fina; Una boleh ikut belakangan)

### 5.1 Tabel `agen_kartu_kasus` (migration BARU, nomor berikutnya yang kosong; **nama berkas harus memuat `agen_kartu_kasus`**)
| Kolom | Isi |
|---|---|
| `id`, `tenant_id` (NULL = kartu umum), `agen` | ruang kartu |
| `gejala` (≤ 200 karakter), `kunci` (kata kunci, JSON) | untuk pencarian |
| `langkah_cek` (JSON: urutan **alat yang ada** + parameter templat) | tidak boleh berisi perintah bebas |
| `penyebab`, `solusi` (≤ 1.500 karakter total kartu) | teks pendek |
| `status` DRAFT / AKTIF / ARSIP, `dibuat_oleh` AGEN / ADMIN / BOS | |
| `disetujui_oleh`, `dipakai`, `terakhir_dipakai`, `berhasil`, `dikoreksi` | statistik |
| `contoh` (JSON, maks 3 kejadian, sudah disamarkan) | |

### 5.2 Alur per pertanyaan (aturan "cari dulu, kirim sedikit")
1. Kalimat pengguna diberi skor terhadap kartu AKTIF (tenant + umum, ruang persona itu) memakai `peringkatKamus` dari `kerangka/kamus.js`. **Tanpa panggilan model.**
2. Hanya **1–3 kartu teratas** di atas ambang yang disisipkan ke prompt (± 1–2 rb token). **Tidak pernah seluruh indeks.** Biaya per chat tetap datar walau kartu ribuan.
3. Kartu cocok → agen mengikuti `langkah_cek` (alat asli). Jumlah putaran sedikit, jadi murah.
4. Tidak ada kartu → investigasi biasa. Setelah selesai dan pengguna puas, agen **mengusulkan kartu DRAFT** (alat `usulkan_kartu`, lewat draft biasa).

### 5.3 Pengaman
- Kartu DRAFT **tidak dipakai** sampai di-ACC (siapa yang ACC: keputusan terbuka K2; usulan: Entity Admin).
- `langkah_cek` divalidasi: hanya ID alat dari registry persona; parameter lewat skema alat.
- Isi kartu disamarkan dengan `samarkanTeksBelumPaham()` (nama pelanggan, nomor, kontak).
- Kartu dikoreksi pengguna ("bukan itu") → `dikoreksi`++. Bila lebih dari 2 kali → kembali DRAFT.
- Arsip otomatis bila 90 hari tidak dipakai. Kartu mirip (skor kunci tinggi satu sama lain) → usulkan gabung, bukan tambah.
- Kartu tenant A tidak pernah terlihat tenant B. Kartu umum hanya dibuat/dinaikkan oleh Bos.

### 5.4 Antrean belum paham (sudah ada, diperluas)
- Tambah kolom `agen` dan alasan `alat_tidak_ada` (model memilih "tidak ada alat"), `dugaan_bug` (Rika menemukan input benar tapi hasil sistem salah).
- **Layar tinjau Bos (BARU)** di Owner Console, lintas tenant: dikelompokkan per kemiripan (skor kamus), menampilkan jumlah kejadian & tenant.
  Tombol: **OK kerjakan** → membuat brief tugas (format skill `agent-task-brief`) · **Bukan masalah** · **Sudah bisa**.
- Yang OK: `scripts/ambil-una-belum-paham.mjs` mengubahnya jadi skenario `una-latih/skenario/` (sudah ada) → skenario harus GAGAL dulu, lalu lulus setelah upgrade → jadi tes rilis.
- Tulis antrean memakai `ctx.waitUntil`: pengguna tidak menunggu.

### 5.5 Meja akuntan (laptop) sebagai "lab" Rika
Kasus baru yang rumit diselidiki Bos di `C:/Users/Asus/akuntan-leker/` (Claude Code). Kartunya (.md) dipindahkan Eskor menjadi **kartu umum** Rika bila berlaku untuk semua tenant.
Langkah kartu .md yang memakai SQL harus diterjemahkan ke alat Rika. Bila alatnya belum ada → masuk antrean sebagai `alat_tidak_ada`.

### 5.6 Saklar tenant (aturan Bos: mekanisme unik jadi opsi tenant, bawaan aktif)
`tenant_policy_settings`: `agen_rika_aktif`, `agen_fina_aktif`, `agen_kartu_belajar_aktif`, bawaan **1**. Mati → persona hilang dari pemilih / kartu tidak ditulis.

---

## 6. Rika (agen akuntan)

**Peran:** menjawab "kenapa angka ini aneh?" sampai ketemu **langkah input yang salah**, lalu menyiapkan koreksinya.
**Bukan peran:** mengubah kode, menebak niat orang, menyebut angka tanpa bukti alat.

### 6.1 Alat
| Alat | Status | Isi (dihitung KODE, bukan model) |
|---|---|---|
| Semua alat baca/tulis di `contracts/una-akuntan-tools-v1.md` | ada | dipakai ulang |
| `telusur_asal_angka` | BARU | Dari satu angka (akun + tanggal + gerai, atau baris laporan) → jurnal penyusunnya → sumber (`source`: LEKER_ADMIN, LEKER_POS, EMPLOYEE_DEPOSIT, Split, manual…) → transaksi asal → **dibuat oleh** (`created_by_*`, migration 0156) |
| `cari_entri_dobel` | BARU | Pasangan jurnal/transaksi dengan nominal sama, akun sama, tanggal berdekatan (±1 hari), keterangan mirip, dan tidak saling membalik. Contoh nyata: Split + jurnal manual, Bea + jurnal manual "hapus" |
| `bandingkan_periode` | BARU | Nilai "normal" (median 4 minggu sebelumnya per hari/akun/orang) vs tanggal yang ditanya → selisih dan komponen penyebab |
| `cek_gaji_presensi` | BARU | Satu CS + tanggal: sesi presensi (masuk/pulang/cara tutup), jadwal, tarif, catatan gaji, jurnal, Bea Gaji manual pada tanggal yang sama |

Letak: `src/agen-rika-alat.js` (BARU). Endpoint baca baru ikut `caca-baca-katalog` + pembersih.

### 6.2 Alur kerja Rika
1. Pahami pertanyaan → kandidat kartu (§5.2).
2. `bandingkan_periode` untuk memastikan memang janggal dan sebesar apa.
3. `telusur_asal_angka` → di mana selisihnya lahir.
4. Uji hipotesis salah input: `cari_entri_dobel`, `cek_gaji_presensi`, salah tanggal, salah akun, nama pihak beda.
5. **Temuan** dalam bahasa sederhana + daftar bukti (ID jurnal, tanggal, pembuat) + usulan koreksi sebagai **draft** (alat tulis yang ada).
6. Input ternyata benar tetapi hasil sistem salah → **berhenti**, catat antrean `dugaan_bug` berisi bukti, lalu bilang ke pengguna: "Ini sepertinya bukan salah input; sudah saya teruskan ke tim program."
7. Selesai → usulkan kartu.

### 6.3 Skenario uji wajib (minimal; tambahkan di `una-latih/skenario/rika-*.json`)
- "Beban gaji X tanggal 12 kok 20 ribu, biasanya 50an ribu" → datang lebih awal / tutup otomatis.
- "HPP tanggal 13 kok gede" → entry dobel.
- "Hutang sewa Genengan kok dobel" → Split + jurnal manual.
- "Pembalik/batal kok muncul di bulan ini" → kartu `pembalik-salah-tanggal` (sudah diperbaiki; harus menjawab "sudah dikoreksi otomatis").

---

## 7. Fina (agen HR)

**Peran:** urusan CS harian: kekosongan gerai dan backup, masalah CS, pengumuman, teguran/SP (draft), rekrutmen.
**Batas keras:** SP, terima/tolak pelamar, dan apa pun soal uang **hanya draft**; keputusan selalu Bos/admin.

### 7.1 Fase 1: chat Leker (tanpa WA)
| Alat | Status | Isi |
|---|---|---|
| `cari_gerai_kosong` | BARU | Jadwal vs presensi saat ini + evaluasi Dana Apresiasi (jam bolong) → gerai/jam kosong |
| `daftar_freelance_tersedia` | BARU | Status FREELANCE (`cashier_cs_status`), tidak ada jadwal di jam itu, akses backup aktif (`entity-backup-cashiers`), urut jarak/riwayat menerima |
| `siapkan_tawaran_backup` | BARU | Teks tawaran siap kirim (fase 1: disalin admin; fase 2: dikirim lewat WA) |
| `catat_pengganti` | BARU (alat) di atas fitur ada | Draft "X menggantikan Y" → sama dengan pengganti di Dana Apresiasi |
| `rekap_masalah_cs` | BARU | Telat, pulang awal, kosong, denda, lupa presensi pulang per CS per periode (dari evaluasi apresiasi + presensi) |
| `pasang_pengumuman` | BARU (alat) di atas fitur ada | Draft pengumuman papan CS (`staff-announcement`) |
| `draft_sp` | BARU | Surat teguran/SP berisi fakta dari `rekap_masalah_cs`; disimpan sebagai draft, **tidak terkirim** |
| Data pelamar + `draft_loker` | BARU | Tabel pelamar (migration BARU, nama memuat `fina_pelamar`); teks loker + isi poster dari templat |

### 7.2 Fase 2: WA (nomor HR)
- Angkat `percetakan-wa.js` jadi `src/pintu-wa.js` (umum). Saluran HR = baris `wa_channels` sendiri. Penyedia **TWILIO atau META_CLOUD**.
  ⚠️ Catatan migration 0148: akun Facebook Bos dibatasi sehingga tidak bisa membuat Portofolio Bisnis Meta. Ini memengaruhi
  Meta Cloud API **dan** posting FB/IG lewat API. Twilio sudah dipakai sebagai jalan keluar untuk WA.
- `src/fina-wa.js`: kenali pengirim (karyawan / pelamar / asing). **Nomor asing → aturan tanpa AI** (pola ADR-044/055). AI hanya jalan untuk nomor dikenal.
- Topik aman dijawab Fina (jadwal, presensi, status lamaran, konfirmasi backup). Topik sensitif dialihkan ke Bos (gaji/kasbon, SP, keluhan, nada marah).
  Daftarnya ditulis sebagai data (kamus ber-tag `fina`), bukan di prompt.
- **Kotak masuk HR** (`public/fina-inbox.js`, BARU): semua percakapan, draft balasan, tombol ambil alih. **Mode bayangan** dulu: Fina menyiapkan, admin menekan Kirim; pelepasan otomatis per jenis balasan lewat saklar.
- Pesan yang dikirim duluan (di luar jendela 24 jam) wajib memakai template yang disetujui penyedia (Meta/Twilio).
- Pemicu cron: `cari_gerai_kosong` dijalankan cron yang sudah ada (tiap menit, dibatasi per gerai sesuai jam buka).

### 7.3 Fase 3: loker
- Halaman loker publik di Leker (`public/loker.html`, BARU) + form lamar → data pelamar → undangan screening (WA template).
- FB Page / Instagram Business lewat Graph API: **terhalang** pembatasan akun Meta Bos (lihat di atas). Jalan keluar: (a) akun/portofolio bisnis atas nama lain yang sah, (b) materi siap salin + posting manual oleh admin.
- Grup FB: API grup sudah ditutup Meta → selalu manual.

---

## 8. Model dan biaya

- **Keputusan Bos 2026-10-09** (UNA-MESIN-DAN-LATIHAN.md §6): model Una dikunci di yang termurah; yang diperbaiki kerangkanya. Rancangan ini **tidak** mengubah model bawaan.
- Disiapkan saja **rute per persona** (`rute: 'agen_rika'` → env/pengaturan) supaya Bos bisa memutuskan tanpa koding ulang.
- Fakta harga untuk keputusan Bos (per 1 juta token, masuk/keluar):
  - `gemini-3.1-flash-lite`: US$0,25 / US$1,50 (sumber: UNA-MESIN-DAN-LATIHAN.md, cek ulang)
  - Claude Haiku 5.5: US$0,10 / US$0,50 (daftar harga Anthropic, di-cache 2026-10-06)
  - Claude Sonnet 5.5: US$2 / US$10 (cache baca US$0,20)

  Haiku 5.5 **lebih murah per token** daripada model Una sekarang. Ini layak diuji untuk Rika (keputusan terbuka K4). Butuh penyedia baru `src/caca-ai-anthropic.js` dengan pola yang sama dengan `caca-ai-gemini.js`.
- Prefix tetap (gaya, aturan, daftar alat persona) disusun stabil supaya bisa di-cache penyedia.

## 9. Performa dan hemat token (wajib)
- Halaman web tidak memuat kartu/antrean; semua di server saat chat.
- Pencarian kartu = skor kamus di memori atas ≤ beberapa ratus kartu per tenant per persona (indeks DB `tenant_id, agen, status`). Bila > 500, tambahkan FTS/Vectorize.
- Maksimal 3 kartu × 1.500 karakter per giliran. Antrean & statistik ditulis `ctx.waitUntil`.
- Daftar alat per persona saja. Riwayat mengikuti aturan `caca-riwayat` yang ada.
- Webhook WA hanya mencatat; AI jalan setelahnya dan hanya untuk nomor dikenal.

---

## 10. Paket kerja

### 10.0 Sebelum ngoding (wajib)
1. Worktree baru dari `origin/main` terbaru. **Jangan** kerja di `C:/Users/Asus/prototype-leker` (berbagi working copy, ada perubahan sesi lain). Stage per path, jangan `git add -A`.
2. `graphify update .` di worktree, lalu `graphify query` untuk: `caca-agen`, `caca-chat`, `caca-belum-paham`, `percetakan-wa`, `dana-apresiasi`, `staff-announcement`. Baca `UNA-MESIN-DAN-LATIHAN.md`, skill `latih-una`, `contracts/una-akuntan-tools-v1.md`, ADR-044/045/055/058.
3. **Push branch = deploy produksi** (CLAUDE.md repo). Push hanya atas perintah Bos.

### 10.1 Paket (nama berkas DIKUNCI. Peta Agen memeriksa nama-nama ini, lihat §11)
| Paket | Isi | Berkas kunci | Selesai bila |
|---|---|---|---|
| **A0 Persona & pemilih** | Registry persona, `agen` di `/api/caca/tanya`, pemilih di chat, saklar tenant, nama per persona | `src/agen-persona.js`, `public/caca-chat.js` (memuat `rika`/`fina`) | Una lama lulus semua tes; Rika/Fina terpilih dan hanya melihat alatnya |
| **A1 Kartu kasus** | Tabel, `src/agen-kartu.js`, sisip 1–3 kartu, alat `usulkan_kartu`, layar ACC kartu di Entity Admin | migration `*agen_kartu_kasus*`, `src/agen-kartu.js` | Tes: kartu tenant lain tidak bocor; DRAFT tidak dipakai; maks 3 kartu tersisip |
| **A2 Antrean diperluas + layar tinjau Bos** | kolom `agen`, alasan baru, layar Owner Console, tombol OK → brief | `src/caca-belum-paham.js` (memuat `dugaan_bug`), `public/belum-paham-tinjau.js` | Bos bisa meninjau tanpa skrip |
| **A3 Rika alat** | 4 alat baru + skenario rika-* | `src/agen-rika-alat.js` | 4 skenario §6.3 lulus live |
| **A4 Rute model** | rute per persona, penyedia Anthropic opsional | `src/caca-ai-client.js` (memuat `rute`), `src/caca-ai-anthropic.js` | Bawaan tidak berubah; ganti rute lewat setelan |
| **A5 Fina fase 1** | alat §7.1, data pelamar, draft loker | `src/agen-fina-alat.js`, migration `*fina_pelamar*` | Skenario fina-* (gerai kosong, rekap masalah, draft SP, pengumuman) lulus |
| **A6 Fina WA** | `pintu-wa.js` umum, `fina-wa.js`, Kotak masuk HR, mode bayangan, template | `src/pintu-wa.js`, `src/fina-wa.js`, `public/fina-inbox.js` | Percetakan tetap lulus; simulator HR bisa dipakai uji |
| **A7 Loker publik** | halaman + form lamar | `public/loker.html` | Lamaran masuk ke data pelamar |
| **A8 Peta Agen di Owner Console** | SELESAI 2026-10-20 | `scripts/build-peta-agen.mjs`, `generated/peta-agen-data.js`, `public/peta-agen.js` | `npm run peta:build` ikut membangun peta agen |

Urutan: A0 → A1 → A2 → A3 (Rika bisa dipakai) → A5 → A6 → A7. A4 dan A8 bisa kapan saja.
Setiap paket: kamus Una diperbarui (skill `segarkan-kamus-una`), skenario uji ditambah, tes penuh dibandingkan baseline.

---

## 11. Peta Agen (halaman di Owner Console yang ikut berubah saat program berubah)
- `scripts/peta-agen-manifest.json`: rancangan FINAL. Setiap kotak punya `bukti`: berkas, isi berkas (regex), atau nama migration.
- `scripts/build-peta-agen.mjs` (ikut `npm run peta:build`): memeriksa bukti ke kode dan menulis `generated/peta-agen-data.js`.
- `GET /api/owner/peta-agen` (khusus Owner, `src/peta-agen.js`) → `public/peta-agen.html`. Kotak berwarna = sudah, bergaris = sebagian, hitam-putih = belum.
- `test/peta-agen.test.js` **gagal kalau data peta tertinggal dari kode**. Jadi setiap paket yang menambah berkas di §10.1 wajib menjalankan `npm run peta:build` dan meng-commit `generated/peta-agen-data.js`.
- Nama berkas di §10.1 berubah → perbarui `bukti` di manifest pada commit yang sama. Rancangan berubah → ubah manifest (kotak/garis), bukan halaman.

## 12. Keputusan terbuka (tanya Bos sebelum paket terkait)
- ~~K1~~ Saklar per tenant bawaan **ON**: sudah diputuskan oleh aturan Bos "mekanisme unik = opsi tenant, bawaan aktif".
- **K2** Siapa yang ACC kartu DRAFT di tenant: Entity Admin saja, atau admin gerai juga?
- **K3** Pencatatan "belum paham" perlu disebut di syarat pemakaian tenant?
- **K4** Uji Haiku 5.5 untuk Rika (lebih murah per token daripada Gemini flash-lite)? Ini membuka kunci keputusan 2026-10-09.
- **K5** WA HR: nomor baru lewat Twilio atau Meta Cloud (akun Meta Bos dibatasi)?
- **K6** Loker FB/IG: posting manual dulu, atau cari akun bisnis Meta lain yang sah?
- **K7** Rika boleh dipakai Entity Admin tenant, atau Owner saja di awal?

## 13. Siap untuk tenant lain dan paket "agen saja" (Bos Cyo, 2026-10-21)
- Fina dan Rika dibangun **sekali** sebagai fitur OwnerTenang. Tenant lain tidak dikoding ulang; mereka **menyalakan dan mengatur**.
- **Aturan usaha = pengaturan per tenant**, bukan konstanta di kode (tarif, menit deteksi, tingkatan SP, kop surat, topik WA). Nilai KPM hanya bawaan di satu tempat.
  Rinciannya untuk HR: `contracts/fina-hr-paket-v1.md` §0 butir 5 dan paket H1.
- Yang dipakai bersama semua tenant: mesin, alat, perbaikan dari antrean, **kartu umum**. Yang per tenant: saklar, nama agen, aturan, nomor WA, kartu tenant, data.
- **Agen membaca tabel OwnerTenang, tidak peduli asal datanya** (kasir sendiri, impor CSV/spreadsheet, atau penghubung API POS lain). Menambah sumber data tidak mengubah agen.
- **Paket "agen saja"** (contoh: HR + Fina untuk usaha yang memakai POS lain): program, server, dan database tetap sama; yang berbeda tampilan ramping (menu sesuai paket)
  **dan penjagaan server** (rute di luar paket ditolak, bukan hanya disembunyikan). Portal staf (presensi CS) tetap wajib karena Fina bekerja dari data itu.
  Rika untuk POS lain: mulai dari impor berkala (CSV/spreadsheet); penghubung API per merek POS baru bila banyak pelanggan memakainya. Paket H6.
- Rincian paket kerja HR untuk beberapa agen sekaligus: `contracts/fina-hr-paket-v1.md`.

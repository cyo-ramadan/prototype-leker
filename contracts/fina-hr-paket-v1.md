# Kontrak kerja: Fina (agen HR), dibagi per paket (v1)

Ditulis: 2026-10-21 · Oleh: Eskor · Basis: `origin/main` dd21653
Induk rancangan: `contracts/agen-rika-fina-v1.md` (baca §1–§5 dan §7 dulu). Dokumen ini menurunkannya
jadi paket yang bisa dikerjakan **beberapa agen sekaligus** tanpa saling menimpa.
Progres terlihat di Owner Console → **Peta Agen** (`/peta-agen`).

Nama produk ke pelanggan: **OwnerTenang (Owten)**, perusahaan **Maxi**. Nama repo/berkas tetap.

---

## 0. Aturan untuk SEMUA agen

**Prinsip utama (Bos Cyo, 2026-10-21): jangan berhenti kerja hanya karena detail kurang jelas.**
- Detail yang tidak tertulis (nama fungsi, bentuk tampilan, isi pesan, nilai bawaan, letak tombol, bentuk JSON) → **putuskan sendiri** dengan pilihan paling masuk akal
  yang meniru kode di sekitarnya, lanjutkan, dan tulis asumsinya di laporan akhir. Kontrak ini panduan, bukan naskah kata per kata.
- Kontrak bertentangan dengan kode yang sebenarnya → ikuti kode, sesuaikan, catat di laporan.
- Butuh perubahan kecil di berkas paket lain (satu baris rute, satu impor, entri katalog) → **lakukan**, sebutkan di laporan. Yang dilarang hanya merombak pekerjaan paket lain.
- Butir "Selesai bila" yang tidak bisa dijalankan di lingkunganmu (mis. skenario live butuh akun) → kerjakan sisanya, siapkan berkasnya, tulis apa yang belum teruji.
- **Berhenti dan tanya Bos hanya untuk:** menulis/menghapus data produksi, push/deploy, keputusan uang atau nasib orang yang belum ada di kontrak,
  dan mengubah perilaku fitur yang sudah dipakai pelanggan. Selain itu, jalan terus.

Aturan teknis:

1. **Worktree sendiri** dari `origin/main` terbaru: `git -C C:/Users/Asus/prototype-leker worktree add C:/Users/Asus/wt-<agen>-<paket> -b <agen>/fina-<paket> origin/main`.
   Jangan bekerja di `C:/Users/Asus/prototype-leker` (berbagi working copy dengan sesi lain). Stage **per path**, jangan `git add -A`.
2. **JANGAN PUSH apa pun**, branch atau main. Push = deploy produksi (CLAUDE.md "Deploy"), dan branch lain bisa menimpa produksi.
   Selesai = commit lokal + laporan ke Bos Cyo (hash, ringkasan, hasil tes). Bos yang memutuskan "masukin".
3. Sebelum ngoding: `graphify update .` di worktree, lalu `graphify query` untuk berkas yang akan disentuh. Baca `AGENTS.md`, `CLAUDE.md`,
   `KNOWN_PITFALLS.md`, `MODULE_OWNERSHIP.md`, skill `.claude/skills/latih-una/SKILL.md` dan `segarkan-kamus-una`.
4. Utamakan berkas milik paketmu (tabel §2). Perubahan kecil di berkas lain boleh (lihat prinsip di atas); jangan merombak pekerjaan paket lain.
5. **Aturan HR = pengaturan per tenant, bukan konstanta.** Tidak boleh ada angka/aturan KPM yang tertanam di kode (tarif, menit, tingkatan SP).
   Nilai KPM hanya sebagai *bawaan* di satu tempat (`FINA_BAWAAN` di `src/fina-pengaturan.js`).
6. Agen membaca dari **tabel/endpoint OwnerTenang**, tidak peduli asal datanya (kasir sendiri, impor, API POS lain).
7. Semua tulis = **draft + "Ya"** yang diperiksa ulang server (pola `src/caca-aksi*.js`). Tidak ada INSERT langsung dari agen. Angka hanya dari hasil alat.
8. Data pribadi (nomor HP, alamat) tidak pernah dikirim ke model. Semua hasil baca lewat `bersihkan()` (`src/caca-baca-aman.js`).
9. **Migration:** nomor dipilih saat akan diserahkan (nomor kosong berikutnya di `origin/main` terbaru), **nama berkas wajib memuat kata kunci di §2**
   (Peta Agen mencarinya). Jangan memakai nomor yang sudah dipakai branch lain yang kamu tahu.
10. Berkas bersama yang pasti bentrok saat digabung, yaitu `src/caca-inventaris-panduan.js`, `generated/inventaris-fitur-una.js`, `generated/tinjauan-kamus-una.json`,
    `scripts/check-syntax.mjs`, dan `generated/peta-agen-data.js`. Ubah seperlunya. Saat bentrok, **bangkitkan ulang** (`node scripts/build-peta-una.mjs`, `npm run peta:build`), jangan menyunting tangan.
11. Selesai paket = semua butir "Selesai bila" + `npm run check` lulus + `node --test` **gagal sama persis dengan baseline main** (saat ini 8, kegagalan lama Windows)
    + `npm run peta:build` dijalankan dan `generated/peta-agen-data.js` ikut di-commit.
12. Catat langkah penting di `~/.maxi-mesin/CATATAN-ESKOR.md` dengan awalan `[Fina-<paket>]`.

---

## 1. Peta paket dan urutan

| Paket | Isi singkat | Bergantung pada | Gelombang |
|---|---|---|---|
| **H0** Persona & pemilih | Registry persona, `agen` di `/api/caca/tanya`, pemilih Una/Rika/Fina di chat, saklar & nama per tenant, mendaftarkan alat Fina | — | 1 |
| **H1** Pengaturan HR | Tabel + API + kartu "Pengaturan Fina (HR)" di Entity Admin | — | 1 |
| **H2** Alat baca Fina | Gerai kosong, freelance tersedia, rekap masalah CS (hitungan oleh kode) | H1 hanya untuk membaca pengaturan (boleh pakai `FINA_BAWAAN` dulu) | 1 |
| **H3** Alat tulis Fina | Catat pengganti, pasang pengumuman, tawaran backup (teks), draft SP | H2 (`src/fina-hitung.js`) | 2 |
| **H4** Rekrutmen | Lowongan, pelamar, halaman loker publik, draft loker | H1 | 2 |
| **H5** WA Fina | Pintu WA umum, WA Fina, Kotak masuk HR, mode bayangan | H0, H2, H3 | 3 |
| **H6** Paket "agen saja" | Paket per tenant dijaga server + tampilan ramping | keputusan Bos (nama/isi paket) | 3 |
| **A1/A2** Kartu kasus & antrean | Lihat `agen-rika-fina-v1.md` §5 dan §10 | H0 | 2 (paralel) |

Gelombang 1 (H0, H1, H2) bisa dikerjakan bersamaan oleh tiga agen.

---

## 2. Kepemilikan berkas (siapa boleh menyentuh apa)

| Paket | Berkas BARU (milik paket) | Berkas lama yang boleh diubah | Kata kunci migration |
|---|---|---|---|
| H0 | `src/agen-persona.js`, `test/agen-persona.test.js` | `src/caca-agen.js`, `src/caca-chat.js`, `public/caca-chat.js`, `src/caca-pengaturan.js`, `public/caca-pengaturan.js`, `src/caca-aksi.js` (pendaftaran alat), HTML yang memuat `caca-chat.js` (versi `?v=`) | — |
| H1 | `src/fina-pengaturan.js`, `public/entity-fina-pengaturan.js`, `test/fina-pengaturan.test.js` | `src/index.js` (1 rute), `public/entity-admin.html`/`public/entity-admin.js` (tempat kartu di Pengaturan) | `fina_pengaturan` |
| H2 | `src/fina-hitung.js`, `src/fina-api.js`, `src/agen-fina-alat.js`, `test/fina-hitung.test.js`, `test/agen-fina-alat.test.js`, `una-latih/skenario/fina-0*.json` | `src/index.js` (1 rute), `src/caca-baca-katalog.js` (entri baca Fina) | — |
| H3 | `src/agen-fina-tulis.js`, `test/agen-fina-tulis.test.js`, `public/entity-fina-surat.js` | `src/fina-api.js` (rute surat), `src/index.js` | `fina_surat` |
| H4 | `src/fina-rekrut.js`, `public/loker.html`, `public/loker.js`, `public/entity-fina-rekrut.js`, `test/fina-rekrut.test.js` | `src/index.js`, `src/agen-fina-tulis.js` (alat `draft_loker`, setelah H3 masuk) | `fina_pelamar` |
| H5 | `src/pintu-wa.js`, `src/fina-wa.js`, `public/fina-inbox.js`, `test/fina-wa.test.js` | `src/percetakan-wa.js` (memakai `pintu-wa.js`, perilaku tetap) | `fina_wa` |
| H6 | `src/paket-produk.js`, `test/paket-produk.test.js` | `src/ui-profile.js`, `public/nav-groups.js`, penjaga rute | `paket_produk` |

Semua paket: boleh menambah entri kamus Una ber-tag `fina` (lewat skill `segarkan-kamus-una`) dan memperbarui bukti di `scripts/peta-agen-manifest.json` **hanya untuk kotak paketnya**.

---

## 3. Fakta data yang sudah ada (jangan dibuat ulang)

| Data | Tabel / modul | Catatan |
|---|---|---|
| Jadwal shift per akun per hari | `account_shift_schedule(account_type, account_id, day_of_week 0-6, is_day_off, shift_start, shift_end)` | jam `HH:MM` WIB |
| Presensi | `staff_attendance(id, user_id→cashiers, store_id, created_at=masuk, check_out_at, auto_closed, status, …)` | waktu UTC ISO; tutup otomatis `auto_closed=1` |
| Status CS | `cashier_cs_status(account_id, status ASLI/FREELANCE)` | bawaan via `defaultCsStatus()` di `src/dana-apresiasi.js` |
| Backup lintas gerai | `account_daily_activations(account_id, business_date, store_id, …)`, `src/entity-backup-cashiers.js` | aktivasi harian akun di gerai lain |
| Penilaian shift & jam kosong | `apresiasi_evaluations(store_id, account_id, business_date, shift_start, shift_end, own_minutes, backup_minutes, kosong_minutes, denda_kind)` | dinilai lazy 1 jam setelah shift (`evaluateDueApresiasi`) |
| Potongan/denda/fee | `apresiasi_entries(kind POTONG_BACKUP/POTONG_KOSONG/DENDA/FEE_BACKUP/PENYESUAIAN, …)` | |
| Pengganti | `apresiasi_pengganti(attendance_id, replaces_account_id)`, `setPengganti()`, `penggantiOptions()` | konfirmasi saat presensi masuk (`public/pengganti-presensi.js`) |
| Pengaturan apresiasi | `apresiasi_settings(entity_id, store_id, rate_per_hour_rupiah, denda_*, jam_buka, jam_tutup, …)`, `storeSettings()` | **tarif & denda TETAP di sini**, jangan diduplikasi |
| Pengumuman | `announcements(id, entity_id, store_id, title, body, created_by, created_by_role, is_active, …)` + kolom 0170; `GET/POST /api/admin/announcements` | |
| Rekap apresiasi | `GET /api/entity-admin/dana-apresiasi/rekap`, `/settings` (`src/dana-apresiasi-api.js`) | |
| Pengaturan tenant | `tenant_policy_settings(tenant_id, setting_key, setting_value)` | pola `una_nama_asisten` di `src/caca-pengaturan.js` |
| Alat Una | objek `{ nama, lingkup, baca?, petunjuk, skema, siapkan(t, ctx), posting?(draft, ctx) }`; baca lewat `ctx.baca(path)`; contoh `src/caca-aksi-karyawan.js` (`cek_setoran_cs`, `atur_jadwal_kasir`, `penyesuaian_gaji`) | `siapkan` mengembalikan `{ok, jawaban, tabel?, tawaran?}` atau `{draft}`; `posting` menulis lewat endpoint asli |
| Katalog baca | `src/caca-baca-katalog.js` (`{id, path, lingkup, param, ringkas}`) | tes memastikan path ada |
| Antrean belum paham | `src/caca-belum-paham.js`, migration 0155 | |
| WA | `wa_channels`, `wa_inbound_messages` (0145/0148), `src/percetakan-wa.js` | Meta Cloud / Twilio / simulator |

---

## H0. Persona & pemilih (gelombang 1)

**Tujuan:** pengguna bisa memilih Una / Rika / Fina di panel chat; Fina hanya melihat alat HR; Una tidak berubah sama sekali.

1. `src/agen-persona.js`:
   ```js
   export const PERSONA = Object.freeze({
     una:  { id:'una',  namaBawaan:'Una',  kunciNama:'una_nama_asisten',  kunciAktif:null,              peran:'asisten toko', alat:null /* = semua seperti sekarang */, izin:['OWNER','ENTITY_ADMIN','ADMIN'] },
     rika: { id:'rika', namaBawaan:'Rika', kunciNama:'rika_nama_asisten', kunciAktif:'agen_rika_aktif', peran:'akuntan', alat:[/* diisi paket Rika */], izin:['OWNER','ENTITY_ADMIN'] },
     fina: { id:'fina', namaBawaan:'Fina', kunciNama:'fina_nama_asisten', kunciAktif:'agen_fina_aktif', peran:'HR', alat:[/* nama alat dari AKSI_FINA */], izin:['OWNER','ENTITY_ADMIN','ADMIN'] }
   });
   export function personaUntuk(id, { role, pengaturan }) // → persona atau error 403/404
   export function alatPersona(persona, semuaAlat)        // → hanya alat persona (Una: semua)
   ```
   Saklar `agen_*_aktif` di `tenant_policy_settings`, **bawaan aktif** (aturan Bos: mekanisme unik = opsi tenant, bawaan aktif).
2. `/api/caca/tanya` menerima `agen` (bawaan `una`). Persona tidak dikenal → 404; tidak diizinkan/dimatikan → 403 (bukan diam-diam ke Una).
   Riwayat, tugas tertunda, dan draft **dipisah per persona** (kunci percakapan ikut `agen`).
3. Gaya: Fina sopan, singkat, memanggil karyawan dengan nama; tidak menjanjikan uang atau keputusan. Nama tampil dari pengaturan tenant.
4. Pemilih di `public/caca-chat.js`: tiga tab kecil di kepala panel; persona yang dimatikan/tidak diizinkan tidak tampil; pilihan terakhir diingat per halaman.
5. Mendaftarkan `AKSI_FINA` (dari H2/H3) ke `src/caca-aksi.js` **hanya bila berkasnya sudah ada di main**; bila belum, siapkan titik daftarnya (array kosong) dan tes.

**Selesai bila:** semua tes Una lama lulus tanpa diubah; tes baru: Fina tidak melihat alat Una non-HR; 403 untuk persona dimatikan; riwayat tidak tercampur;
skenario `una-latih/skenario/fina-00-pilih.json` lulus live; kotak Peta Agen `p_pilih`, `m_persona`, `fina`, `rika` berwarna.

---

## H1. Pengaturan HR per tenant (gelombang 1)

**Tujuan:** semua aturan HR yang dipakai Fina bisa diatur per entity (dan dioverride per gerai), dengan nilai KPM sebagai bawaan.

1. Migration `NNNN_fina_pengaturan.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS hr_settings (
     entity_id TEXT NOT NULL,
     store_id TEXT NOT NULL DEFAULT '',          -- '' = bawaan entity
     deteksi_kosong_menit INTEGER,               -- menit setelah shift mulai tanpa presensi = dianggap kosong
     tawaran_serentak INTEGER,                   -- jumlah freelance yang ditawari sekaligus
     batas_tunggu_menit INTEGER,                 -- tidak ada yang bisa -> lapor admin
     backup_lintas_gerai INTEGER CHECK (backup_lintas_gerai IS NULL OR backup_lintas_gerai IN (0,1)),
     sp_berlaku_hari INTEGER,                    -- masa berlaku SP
     sp_tingkat TEXT,                            -- JSON: ["TEGURAN","SP1","SP2","SP3"] (urutan & nama boleh diubah tenant)
     kop_surat TEXT NOT NULL DEFAULT '',         -- nama usaha/alamat untuk surat
     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_by_role TEXT NOT NULL DEFAULT '', updated_by_id TEXT NOT NULL DEFAULT '',
     PRIMARY KEY (entity_id, store_id)
   );
   ```
   NULL = ikut tingkat di atasnya (gerai → entity → `FINA_BAWAAN`), pola yang sama dengan `apresiasi_settings`.
2. `src/fina-pengaturan.js`: `FINA_BAWAAN` (nilai KPM: deteksi 10, serentak 3, tunggu 30, lintas gerai 1, berlaku 90, tingkat TEGURAN/SP1/SP2/SP3),
   `pengaturanFina(db, entityId, storeId)` (hasil gabungan), `simpanPengaturanFina(db, {...})` (validasi rentang), API
   `GET/PUT /api/entity-admin/fina/settings` (Entity Admin; Owner boleh). Tarif & denda **dibaca** dari `storeSettings()` apresiasi, tidak disimpan ulang.
3. `public/entity-fina-pengaturan.js`: kartu **"Fina (HR)"** di Entity Admin → Pengaturan, di dekat kartu Dana Apresiasi: isian di atas + override per gerai + tombol simpan.
   Tampilan mengikuti kartu Dana Apresiasi (`public/entity-dana-apresiasi.js`).
4. Kamus Una: entri `fina_pengaturan` ber-tag `fina` (+ hash tinjauan).

**Selesai bila:** tes gabungan gerai→entity→bawaan; validasi menolak nilai di luar rentang; hanya Entity Admin/Owner boleh PUT; kartu tampil di Entity Admin;
kotak Peta Agen `fina_atur` berwarna.

---

## H2. Alat baca Fina (gelombang 1)

**Tujuan:** Fina bisa menjawab "gerai mana yang kosong?", "siapa freelance yang bisa backup jam 14–22 di Beji?", "rekap masalah CS minggu ini?". **Semua hitungan oleh kode.**

1. `src/fina-hitung.js` (fungsi murni, diuji tanpa DB):
   - `cariShiftKosong({ jadwal, presensi, aktivasi, sekarang, deteksiMenit })` → shift yang mulai ≥ `deteksiMenit` lalu tanpa presensi masuk akun itu atau pengganti.
   - `pilihFreelance({ kandidat, jadwal, presensi, aktivasi, tanggal, dari, sampai, lintasGerai, storeId })` → urutan: gerai sama dulu, lalu gerai lain di entity (bila lintas gerai aktif); buang yang berjadwal/bertugas di jam itu.
   - `rekapMasalah({ evaluasi, presensi, dari, sampai })` → per CS: telat (menit), pulang awal, kosong (menit), denda, lupa presensi pulang (`auto_closed`), jumlah kejadian.
2. `src/fina-api.js` (rute baca, pola auth sama dengan `/api/admin/attendance-report`, gerai dari sesi/param `store` yang divalidasi):
   - `GET /api/admin/fina/kosong?store=&date=` (bawaan hari ini WIB)
   - `GET /api/admin/fina/freelance?store=&date=&from=HH:MM&to=HH:MM`
   - `GET /api/admin/fina/masalah?store=&from=&to=`
   Keluaran **tanpa nomor HP/alamat**.
3. `src/caca-baca-katalog.js`: entri `fina_kosong`, `fina_freelance`, `fina_masalah`.
4. `src/agen-fina-alat.js`: `export const AKSI_FINA_BACA = [cariGeraiKosong, daftarFreelanceTersedia, rekapMasalahCs]`, format alat Una (`baca: true`),
   nama alat: `cari_gerai_kosong`, `daftar_freelance_tersedia`, `rekap_masalah_cs`. Jawaban + tabel; tawaran buka layar Presensi / Dana Apresiasi.
5. Skenario: `una-latih/skenario/fina-01-gerai-kosong.json`, `fina-02-freelance.json`, `fina-03-rekap-masalah.json` (kalimat Bos sehari-hari).

**Selesai bila:** tes fungsi murni mencakup: shift lewat tengah malam, hari libur, pengganti sudah dicatat, freelance sedang bertugas di gerai lain, presensi tutup otomatis;
tes rute (auth, gerai lain ditolak, tanpa nomor HP); kotak Peta Agen `fina_kosong`, `fina_masalah`, dan bukti `daftar_freelance_tersedia` berwarna.

---

## H3. Alat tulis Fina (gelombang 2)

1. `src/agen-fina-tulis.js`: `export const AKSI_FINA_TULIS = [...]`, semuanya draft + "Ya":
   - `siapkan_tawaran_backup`: teks tawaran siap salin per freelance terpilih (fase 1 tidak mengirim apa pun).
   - `catat_pengganti`: "X menggantikan Y di shift Z" → lewat jalur yang sama dengan koreksi pengganti di Entity Admin (`setPengganti` / rute `src/dana-apresiasi-api.js`). **Jangan menulis tabel langsung.**
   - `pasang_pengumuman`: judul + isi + gerai → `POST /api/admin/announcements`.
   - `draft_sp`: memilih CS + periode → fakta dari `rekapMasalah` → teks surat dengan kop & tingkat dari pengaturan H1 → disimpan **DRAFT**.
2. Migration `NNNN_fina_surat.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS hr_surat (
     id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, store_id TEXT NOT NULL, account_id TEXT NOT NULL, employee_id TEXT,
     tingkat TEXT NOT NULL, periode_dari TEXT NOT NULL, periode_sampai TEXT NOT NULL,
     fakta TEXT NOT NULL,              -- JSON hasil rekapMasalah (bukti)
     isi TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','DISETUJUI','DIBATALKAN')),
     berlaku_sampai TEXT,
     dibuat_oleh_role TEXT NOT NULL, dibuat_oleh_id TEXT NOT NULL,
     disetujui_oleh_role TEXT NOT NULL DEFAULT '', disetujui_oleh_id TEXT NOT NULL DEFAULT '', disetujui_at TEXT,
     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   );
   ```
   Rute: `GET/POST /api/entity-admin/fina/surat`, `POST /api/entity-admin/fina/surat/:id/setujui|batalkan` (hanya Entity Admin/Owner).
3. `public/entity-fina-surat.js`: daftar surat (DRAFT/DISETUJUI), lihat isi, Setujui / Batalkan. **Belum dikirim ke CS** (fase WA).

**Selesai bila:** draft tidak pernah berubah status tanpa tombol manusia; SP memuat fakta yang sama dengan rekap; pengganti tercatat dan Dana Apresiasi menilai ulang;
skenario `fina-04-sp.json`, `fina-05-pengumuman.json`; kotak `fina_tawar`, `fina_sp`, `fina_umum`, `fina_acc` berwarna (yang buktinya bergantung pada H5 tetap bergaris).

---

## H4. Rekrutmen (gelombang 2)

1. Migration `NNNN_fina_pelamar.sql`: `hr_lowongan` (id, entity_id, store_id, slug unik, posisi, deskripsi, syarat, jam_kerja, gaji_teks, status DRAFT/TAYANG/TUTUP, dibuat/diubah oleh, waktu) dan
   `hr_pelamar` (id, lowongan_id, entity_id, nama, no_wa, domisili, umur, pengalaman, jawaban JSON, sumber WEB/FB/IG/WA/LAIN, status BARU/SCREENING/INTERVIEW/DITERIMA/DITOLAK, catatan, waktu).
2. `src/fina-rekrut.js`: CRUD lowongan (Entity Admin), `GET /loker/:slug` data publik **tanpa** data internal, `POST /api/publik/lamaran` (honeypot + batas per nomor/hari + panjang isian dibatasi),
   status pelamar hanya diubah admin. Keputusan DITERIMA/DITOLAK = tombol manusia.
3. `public/loker.html` + `public/loker.js`: halaman lowongan publik (ringan, tanpa pustaka luar) + form lamar.
4. `public/entity-fina-rekrut.js`: daftar lowongan & pelamar di Entity Admin.
5. Alat `draft_loker` (teks loker dari isian; poster = teks untuk templat, bukan generator gambar) di `src/agen-fina-tulis.js` setelah H3 masuk.

**Selesai bila:** form publik tidak membuka data entity lain; nomor HP tidak pernah sampai ke model; kotak `p_loker`, `fina_pelamar`, `fina_loker` berwarna.

---

## H5 / H6 (gelombang 3)
Dikerjakan setelah gelombang 1–2 masuk main. Rinciannya ada di `agen-rika-fina-v1.md` §7.2 (WA) dan keputusan Bos tentang paket (nama paket, isi menu).
Keputusan terbuka yang memengaruhi: **K5** (nomor WA HR: Twilio atau Meta Cloud; akun Meta Bos sedang dibatasi) dan **K6** (posting FB/IG).

---

## Lampiran A. Perintah untuk agen (salin, ganti `<PAKET>` dan `<AGEN>`)

```
Kerjakan paket <PAKET> dari contracts/fina-hr-paket-v1.md di repo C:/Users/Asus/prototype-leker.

1. Buat worktree baru dari origin/main terbaru:
   git -C C:/Users/Asus/prototype-leker fetch origin main
   git -C C:/Users/Asus/prototype-leker worktree add C:/Users/Asus/wt-<AGEN>-<PAKET> -b <AGEN>/fina-<PAKET> origin/main
   Kerjakan hanya di worktree itu.
2. Baca: AGENTS.md, CLAUDE.md, KNOWN_PITFALLS.md, contracts/agen-rika-fina-v1.md (§1–§5, §7), dan contracts/fina-hr-paket-v1.md (§0–§3 dan bagian <PAKET>).
   Jalankan `graphify update .` lalu `graphify query` untuk berkas yang akan kamu sentuh.
3. Patuhi §0. Detail yang tidak jelas: putuskan sendiri dengan pilihan paling masuk akal, lanjutkan, catat asumsinya. Berhenti hanya untuk hal yang disebut di §0.
   JANGAN push apa pun (push = deploy produksi). Commit lokal, stage per path.
4. Selesai bila semua butir "Selesai bila" di bagian <PAKET> terpenuhi, `npm run check` lulus, `node --test` gagal sama persis dengan baseline main,
   dan `npm run peta:build` sudah dijalankan lalu hasilnya ikut di-commit.
5. Laporkan ke Bos Cyo dalam Bahasa Indonesia sederhana: apa yang sudah bisa, hash commit, nama branch & worktree, hasil tes (angka), dan hal yang butuh keputusan Bos.
   Sertakan daftar asumsi yang kamu ambil sendiri.
```

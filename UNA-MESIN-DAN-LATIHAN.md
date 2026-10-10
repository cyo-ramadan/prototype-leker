# Una: mesin AI yang dipakai, batasnya, dan cara "melatih"-nya

Dokumen ini untuk **siapa pun yang mau membuat Una lebih pintar**: Hana, Karen, Kimi, atau agen
lain. Isinya fakta mesin yang dipakai sekarang, apa yang terbukti bisa dan tidak bisa, dan cara
kerja yang terbukti berhasil. Skill pendampingnya: `.claude/skills/latih-una/`.

Dokumen lain yang berkaitan:
- `HANDOFF-CACA.md`: riwayat fitur Una per tanggal.
- `UNA-PENDAMPING.md`: riset ketakutan pengguna baru.
- `adr/ADR-044`, `adr/ADR-045`: keputusan arsitektur.

---

## 1. Vonis singkat (untuk Bos Cyo)

**Masih tertolong. Mesinnya tidak perlu diganti untuk target "ngobrol biasa, Una yang kerjain".**

Buktinya ada pada setiap kasus "Una cupu / kehilangan konteks" yang Bos kirim sampai 2026-10-09.
Kalau ditelusuri, penyebabnya **bukan otak Gemini yang mentok**. Penyebabnya, kerangka Una belum
mencatat keadaan yang dibutuhkan:

| Kejadian | Penyebab sebenarnya | Perbaikan |
|---|---|---|
| "5000" dikira perintah lain; nama ditanya berulang | Una tidak menyimpan "lagi mengerjakan apa, kurang apa" | Tugas tertunda |
| "eh salah harga belinya harusnya 100" → "barang belum ketemu" | Una tidak tahu ada draft yang belum disetujui | Draft terbuka = tugas yang bisa dikoreksi |
| "semua aman" padahal ada 2 barang rugi | Model disuruh menyaring 46 barang sendiri | Alat `cek_harga_janggal` yang dihitung kode |
| Harga jual disamakan harga beli tanpa ditanya | Model mengarang angka | Pagar: harga baru wajib pernah disebut Bos |

Skor uji live 2026-10-09 (10 skenario dari kejadian nyata): **9/10 sebelum perbaikan koreksi
draft**. Kasus yang gagal persis kasus di layar Bos. Hasil sesudahnya dicatat di §10.

Keputusan Bos Cyo 2026-10-09: **model dan level mikirnya dikunci di yang termurah. Yang
ditingkatkan adalah kerangkanya** (§6).

---

## 2. Fakta mesin yang dipakai

| Hal | Nilai | Sumber |
|---|---|---|
| Model | `gemini-3.1-flash-lite` (keluarga Gemini 3, varian paling murah dan cepat) | `src/caca-ai-gemini.js` |
| Status | Stable di Gemini API (Vertex sempat menyebut preview) | Google AI docs |
| Batas masuk | 1.048.576 token (±1 juta) | Google AI docs |
| Batas keluar | 65.536 token. **Una membatasi 16.000** (`DEFAULT_MAX_TOKENS`) | Google AI docs + kode |
| Harga | US$0,25 per 1 juta token masuk; US$1,50 per 1 juta token keluar | Google blog (2026-03-03) |
| Level mikir | minimal / low / medium / high. **Bawaan: minimal** (sumber pihak ketiga, belum dicek ke docs resmi) | Vertex docs, listing pihak ketiga |
| Fitur yang dipakai | Structured output (`responseSchema`, JSON) | kode |
| Fitur yang ada tapi belum dipakai | Function calling, context caching, batch | Google AI docs |
| Masukan gambar | Ya (foto lembar rekap, foto menu) | kode |
| Penyedia cadangan | `gpt-6-luna` (OpenAI); pindah lewat env `CACA_MESIN=openai` | `src/caca-ai-client.js` |

Sumber:
- [Gemini 3.1 Flash-Lite — Gemini API docs](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Gemini 3.1 Flash-Lite — Vertex AI docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-flash-lite)
- [Google blog: Gemini 3.1 Flash-Lite](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-flash-lite/)
- Level mikir bawaan "minimal": [sim.ai](https://www.sim.ai/models/google/gemini-3-1-flash-lite)

Angka-angka ini bisa berubah. Cek ulang sebelum mengambil keputusan biaya.

### Cara Una memanggilnya

- **Satu panggilan model = satu putaran.** Model memilih SATU alat dan mengisi kolomnya dalam
  bentuk JSON. Kode yang menjalankan alatnya.
- Setiap pesan Bos = 1–4 putaran per permintaan. Panel mengirim `satuLangkah`, jadi di panel 1
  putaran per permintaan, maksimal 12 langkah per perintah.
- Level mikir **tidak diatur**, jadi pakai bawaan (terendah) — dikunci, lihat §6. Temperature
  juga tidak diatur.
- Ukuran bekal per panggilan pilih-alat (diukur 2026-10-09):
  - aturan + daftar alat ±22.000 huruf ≈ **±6.000 token**;
  - ditambah skema kolom semua alat, contoh yang mirip, riwayat obrolan, dan catatan kerja.
- **Perkiraan biaya**, dengan asumsi kurs Rp16.000/US$ dan bekal ±10.000 token:
  - ±Rp40 per panggilan;
  - perintah 4 langkah ±Rp160.
  Data besar (daftar barang utuh, sampai 60 ribu huruf) membuat panggilan itu lebih mahal.
- **Jalur gratis Gemini**: isinya boleh dipakai Google. Wajib pindah ke jalur berbayar sebelum
  data tenant lain lewat Una (ADR-044).

---

## 3. Apa yang bisa dan tidak bisa diandalkan dari model ini

Diamati dari uji live di gerai TESTINGUNA, 2026-10-05 sampai 2026-10-09.

**Bisa diandalkan**
- Memilih alat yang benar dari daftar untuk perintah satu langkah, termasuk bahasa santai dan
  salah ketik.
- Menyusun kalimat jawaban yang ramah dari data yang sudah disiapkan kode.
- Memecah perintah 2–3 langkah, asal tiap langkah diberi hasil langkah sebelumnya (catatan kerja).

**Tidak bisa diandalkan** (selalu sediakan jaring pengaman di kode)

| Kelemahan | Contoh nyata | Jaring pengaman |
|---|---|---|
| Lupa menyalin isian yang jelas tertulis | "namanya tutup cup manual, harga beli 12rb": kolom nama/harga kosong | `isiDariPesan` (pembaca kalimat) |
| Lupa konteks antar-giliran walau riwayat dikirim | "5000" dibaca dari nol | Tugas tertunda (`src/caca-tertunda.js`) |
| Membedakan koreksi vs perintah baru | "salah, harusnya 100" → `ubah_barang` | Draft terbuka = `revisi` |
| Berhitung | 12rb ÷ 50 | Kode membagi (harus habis dibagi) |
| Menyaring/menghitung data besar | 46 barang → "semua aman" | Alat khusus + `angkaTanpaBukti`, `GAGAL_BACA` |
| Tidak mengarang angka/keputusan | Harga jual = harga beli tanpa ditanya | `hargaKarangan`: harga wajib pernah disebut Bos |
| Mematuhi aturan berlapis di prompt panjang | Aturan "jangan X kecuali Y" sering dilanggar | Pindahkan aturan ke kode, atau ke contoh |

**Pola umumnya:** model kecil ini bagus sebagai **penerjemah maksud**, buruk sebagai **pencatat,
penghitung, dan penjaga aturan**. Yang terakhir itu tugas kode.

---

## 4. Aturan emas kerangka Una

1. **Model menerjemahkan; kode menghitung, mengingat, dan menjaga.** Semua uang/angka dari kode.
   Semua keadaan percakapan (tugas tertunda, draft terbuka, catatan kerja) disimpan terstruktur,
   bukan dititipkan ke ingatan model.
2. **Semua tulis berakhir di draft + "Ya"**, dan diperiksa ulang server (`periksaUlangDraft`).
   Isian yang ditambahkan kode harus masuk `tangkapan` draft. Karena itu `isiDariPesan` dipanggil
   **sebelum** `siapkan`, bukan di dalamnya.
3. **Pesan pendek sesudah Una bertanya = jawaban**, bukan perintah baru (`jawabanPendek`).
4. **Kalau ragu, tanya. Jangan tebak.** Pertanyaan menyebut nama barang dan isian yang sudah ada.
5. **Jujur saat gagal.** Bacaan gagal tidak boleh berubah jadi kesimpulan "aman/tidak ada".
6. **Data dari browser tidak tepercaya**: riwayat, catatan kerja, dan tugas tertunda selalu
   dibersihkan di server.

Peta mekanisme yang sudah ada:

| Mekanisme | Tempat | Gunanya |
|---|---|---|
| `terjemahkanPesan` | `src/caca-terjemah.js` | Bahasa chat → bentuk baku (tanggal, daftar) sebelum ke model |
| `alatPasti` | `src/caca-agen.js` | Bentuk pesan yang pasti → alat dipilih kode, model tidak dipanggil |
| Perpustakaan contoh | `src/caca-contoh.js` | Maks 4 contoh paling mirip masuk prompt |
| Putaran + catatan kerja | `src/caca-agen.js` (`jawabPertanyaan`) | Lihat hasil, putuskan langkah berikutnya |
| Tugas tertunda + revisi | `src/caca-tertunda.js` + `lanjutkanTertunda` | Ingat tugas yang belum lengkap / draft yang belum "Ya" |
| `isiDariPesan` | per alat, mis. `uraiPesanBarang` di `src/caca-aksi.js` | Kode membaca isian berlabel dari kalimat |
| `kurang` | hasil `siapkan` | Kolom yang ditanyakan; jawaban Bos mengisinya langsung |
| `cariDiRiwayat` | `src/caca-agen.js` | Sebelum bertanya kolom `kurang`, baca ulang pesan Bos sebelumnya (barang yang sama) |
| `jangkarRencana` | `src/caca-agen.js` | Langkah rencana yang kehilangan angka diberi potongan kalimat asli Bos |
| Una ngambek | `terapkanNgambek` (`src/caca-tertunda.js`) | Balasan mentok yang sama berulang → kalimat manusiawi bertingkat, terakhir chat ditutup 60 detik |
| Kamus + peta menu + `panduanPasti` | `src/caca-jelaskan.js`, `src/caca-peta.js`, `generated/peta-una-data.js` | Pertanyaan cara pakai dijawab dari panduan tertulis: kode memilih kandidat, Gemini memeriksa cocok/tidak lalu memoles bahasanya (`src/caca-poles.js`, satu panggilan ±1,5 ribu token, pagar nama menu/tombol/angka, gagal → teks asli); kata dasar + sinonim di `src/caca-kata.js` supaya kalimat setipe ikut kena |
| `alihkan` | hasil `siapkan` | Alat menyatakan maksudnya ternyata alat lain (mis. barang sudah ada → ubah harga) |
| `angkaTanpaBukti`, `GAGAL_BACA`, `hargaKarangan` | `src/caca-baca.js`, `src/caca-agen.js` | Pagar angka karangan |
| Draft + "Ya" + periksa ulang | `src/caca-aksi.js`, `src/caca-chat.js` | Tidak ada yang tersimpan tanpa persetujuan |

---

## 5. "Melatih" Una: tuas yang dipakai, urut dari yang paling dulu dicoba

Di repo ini "melatih" **bukan fine-tuning**. Alasannya:
- Kegagalan yang terlihat sejauh ini soal keadaan/kerangka, bukan pengetahuan.
- Fine-tuning butuh data percakapan tenant (masalah privasi).
- Hasil fine-tuning terikat ke satu versi model.

Yang dipakai adalah lima tuas berikut. Selalu mulai dari no. 1.

1. **Tulis skenario uji dari kejadian nyata** (`una-latih/skenario/NN-nama.json`). Setiap
   tangkapan layar "Una salah" dari Bos = satu skenario. Jalankan `scripts/uji-una.mjs` (§7) dan
   pastikan skenarionya **gagal dulu**. Skenario yang langsung lulus berarti tidak membuktikan apa-apa.
2. **Tambah contoh percakapan** di `src/caca-contoh.js`.
   - Murah dan efektif untuk salah pilih alat.
   - Contoh berisi POLA (alat + kolom), bukan data tenant.
   - Test `caca-contoh.test.js` memastikan nama alatnya ada.
3. **Pindahkan kerja dari model ke kode**:
   - `isiDariPesan` untuk isian berlabel yang sering terlewat;
   - `kurang` di setiap `tanya` alat tulis, supaya jawaban pendek mengisi kolom yang benar;
   - `alihkan` kalau maksud Bos jelas milik alat lain;
   - alat baca khusus yang dihitung kode untuk pertanyaan yang sering muncul (contohnya `cek_harga_janggal`).
4. **Tambah pagar kode** untuk karangan yang berbahaya (angka, uang, kesimpulan dari kekosongan).
5. **Baru setelah itu sentuh prompt.** Prompt pilih-alat sudah ±22 ribu huruf. Setiap aturan
   baru membuat model kecil makin bingung. Lebih baik hapus atau pindahkan aturan ke kode/contoh
   daripada menambah.

Setiap tuas wajib diakhiri test unit (model palsu) **dan** jalankan ulang skenario live.

---

## 6. Model dan level mikir: DIKUNCI (keputusan Bos Cyo 2026-10-09)

> "kalo level berpikir ditambahin nanti malah bayar, jadi usahakan dulu di level terendahnya.
> yang kita update adalah mesinnya bukan modelnya"

- **Model tetap `gemini-3.1-flash-lite`, level mikir tetap bawaan (terendah).** Una tidak mengirim
  setelan level mikir sama sekali. Jangan menambahkannya, dan jangan mengganti model untuk
  menutupi kegagalan.
- **Yang diperbaiki adalah kerangka ("mesin")**: tuas §5. Kalau sebuah skenario gagal, jawabannya
  hampir selalu salah satu dari ini:
  - keadaan yang belum dicatat (tugas/draft/kerja);
  - isian yang belum dibaca kode;
  - alat khusus yang belum ada;
  - pagar yang belum dipasang.
- Pilihan yang **ditunda** (hanya kalau Bos Cyo sendiri membuka lagi, dengan bukti skor):
  - level mikir `low`;
  - model lebih besar khusus pilih-alat;
  - `gpt-6-luna`.
- Penghematan yang tetap sejalan dengan keputusan ini: **context caching** untuk bekal aturan yang
  sama di tiap panggilan, dan **diet prompt** (§9). Keduanya mengurangi biaya tanpa mengubah model.

## 7. Alat latihan: `scripts/uji-una.mjs`

```sh
LEKER_HANA_ADMIN_USER=... LEKER_HANA_ADMIN_PASS=... node scripts/uji-una.mjs              # semua skenario
node scripts/uji-una.mjs una-latih/skenario/05-koreksi-draft-terbuka.json                   # satu skenario
UNA_ULANG=3 node scripts/uji-una.mjs                                                         # tiap skenario 3x (model tidak selalu sama)
```

- Bicara ke Worker produksi, ke gerai uji **TESTINGUNA** ("Testing Una", ENT-KPM, salinan
  Mandala, migration 0137). Tidak pernah ke gerai sungguhan.
- **Tidak pernah menyetujui draft**, jadi tidak ada yang tersimpan.
- Menirukan panel: riwayat, catatan kerja, tugas tertunda, draft terbuka (revisi), satu langkah
  per permintaan.
- Akun dari env (akun Entity Admin yang dititipkan Bos Cyo ke sesi agen). **Jangan** ditulis di
  repo, jangan diminta plaintext ke Bos (CLAUDE.md invariant 9).
- Uji hanya berlaku untuk kode yang **sudah di-merge ke `main` dan live**. Kode di branch fitur
  belum dilayani Worker (CLAUDE.md "Deploy").
- Model tidak deterministik. Satu kali lulus belum bukti; pakai `UNA_ULANG=3` untuk perubahan
  penting.
- **Setiap skenario memakai jatah Gemini yang SAMA dengan pemakaian Bos di panel.** 2026-10-09:
  ±30 skenario berturut-turut berakhir 429 RESOURCE_EXHAUSTED, dan selama itu Una juga mati untuk
  Bos. Jalankan hanya skenario yang relevan dengan perubahanmu (+ beberapa regresi), jangan semua
  berulang-ulang. Error 429 = jatah habis, bukan skenario gagal; berhenti dan coba lagi nanti.

Bentuk skenario:

```json
{ "nama": "Koreksi draft yang belum di-Ya",
  "pesan": ["bisa masukin barang namanya cup jumbo harga jual 2000 harga beli 1000", "eh salah harga belinya harusnya 100"],
  "harapan": { "alat": "buat_barang", "draft": { "name": "cup jumbo", "purchasePrice": 100 } } }
```

Kolom `harapan` yang dikenali: `alat`, `draft` (dicocokkan ke isi draft), `jawabanMemuat`,
`jawabanTidakMemuat`, `tanpaDraft`.

---

## 7b. Pengetahuan "cara pakai aplikasi" — jangan per kalimat

Kalau ada pertanyaan "bagaimana cara …" yang tidak terjawab, **jangan menambal kalimat itu saja**
(Bos Cyo 2026-10-10: "bukan cuma bisa jawab spesifik itu, tapi case yang setype"):

1. Kalau ada layar/menu yang belum punya `PENJELASAN` atau kata kuncinya kurang, perbaiki di
   `src/caca-peta.js`. Ini menutup semua pertanyaan tentang layar itu.
2. Kalau butuh langkah persis (lebih dari "ada di menu X"), tambah entri kamus di
   `src/caca-jelaskan.js`. Isinya dicocokkan ke layar sungguhan (baca file `public/admin-*.js`-nya),
   `kunci` diisi beberapa cara orang menanyakannya, dan `tawaran` membuka layarnya.
3. Kata yang tidak dikenal ("absen", "honor", "pegawai") → tambah ke `SINONIM` di `src/caca-kata.js`.
4. Uji dengan **kalimat lain yang setipe**, bukan kalimat aslinya saja (`test/caca-peta.test.js`).
5. **Menu baru di aplikasi**: `node scripts/build-peta-una.mjs` + `PENJELASAN`. Tes penjaga merah
   kalau lupa, jadi Una tidak tertinggal pengetahuan.
6. **Gemini memeriksa dan memoles panduan** (Bos Cyo 2026-10-10: "kenapa gemininya engga disuruh
   ngecek apakah pertanyaan dan jawaban dari kamus cocok? ... suruh kasih sentuhan biar bahasanya
   engga templat"). Pembagian: FAKTA dari kamus/peta (kode), BAHASA dari model. `polesPanduan` memberi
   Gemini sampai 3 kandidat panduan; ia memilih yang benar-benar menjawab (atau `tidak_ada` → lanjut
   pilih-alat biasa) lalu menulis ulang. `periksaPoles` menolak polesan yang membuang nama tombol
   dalam kutip, mengubah jalur menu (`Tim → Akun Kasir`), menambah angka, atau melambung panjangnya.
   Model gagal / 429 / ditolak pagar → teks panduan asli, jadi panduan tetap jalan saat Gemini mati.
   Tawaran "Mau Una buatkan?" tetap ditambah KODE, bukan model. Tombol kamus (tap topik) sengaja
   tidak dipoles: deterministik dan gratis. Panduan baru tidak perlu apa-apa: tulis faktanya,
   biarkan bahasanya urusan model.
7. **Yang dijelaskan juga bisa dikerjakan** (Bos Cyo 2026-10-10: "pastikan una juga bisa
   mengerjakan yang apabila ditanya mekanismenya aja"). Tiap entri kamus WAJIB punya
   `aksi: { alat, tawar, tombol, awal? }` (alat yang mengerjakannya) atau `tanpaAksi: 'alasan'`
   — `test/caca-karyawan.test.js` merah kalau lupa. Panduan ber-`aksi` ditutup tawaran
   ("Mau Una yang buatkan?") dan meninggalkan tugas tertunda bertanda `tawaran`; pesan berikutnya
   yang meminta dikerjakan ("kamu bisa buatin itu?", "iya boleh", tombol "Una buatkan…")
   PASTI masuk alat itu (`mintaDikerjakan`). Permintaan tanpa isian (`permintaanMurni`) bahkan
   tidak memanggil model. "oke makasih" / pertanyaan cara lain melepas tawarannya.
8. **Jawaban instan tetap "mengetik"** (Bos: "kalo langsung jawab itu malah kaya robot"): panel
   menahan kartu "Una lagi kerja" 0,9–2,6 detik sesuai panjang jawaban (`cacaJedaManusiawi`).
   Waktu tunggu ini di browser saja, tidak menambah biaya.

## 8. Resep menambah atau membetulkan alat Una

1. Skema kolom diberi awalan nama alat (`barang_…`, `hpp_…`) supaya tidak bentrok di skema
   gabungan. Deskripsi menyebut "salin PERSIS".
2. `siapkan(t, ctx)`:
   - mengembalikan `{ ok: true, draft }`, atau `{ ok: false, tanya, kurang }`;
   - `kurang` = nama kolom yang ditanyakan, supaya tugas tertunda bisa mengisinya;
   - atau `{ ok: false, alihkan: { alat, tangkapan } }`.
3. Kalau kolomnya sering ditulis berlabel di kalimat, tambah `isiDariPesan(t, pesan)`. Aturannya:
   - hanya mengisi yang kosong;
   - harus deterministik;
   - ditest dengan kalimat asli Bos.
4. Draft memuat `baris` / `tabel` / `dampak` yang menyebut terang semua nilai bawaan yang diisi kode.
5. Jalur tulis HANYA lewat endpoint aplikasi yang terdaftar di `PINTU_AKSI` (`src/caca-chat.js`).
6. Tambah 1–2 contoh di `src/caca-contoh.js`, satu skenario live, dan test unit (model palsu).
7. File baru masuk script `check`. `public/caca-chat.js` yang diubah → bump `?v=`.
8. Catat di `HANDOFF-CACA.md`. Kalau terlihat pengguna → `HANDOFF-STRATEGI-PENJUALAN.md` §8.

**Batasan yang tidak boleh dilanggar** (selain invariant CLAUDE.md):
- Una tidak menyentuh kas/laci. Penjualan dan pembelian tetap lewat kasir.
- Tidak ada angka uang yang berasal dari model tanpa dicek kode.
- Contoh dan skenario tidak memuat data tenant sungguhan (kecuali gerai uji).
- Jangan menambah putaran/huruf tanpa batas. Setiap putaran = satu panggilan berbayar dan satu
  jatah subrequest Cloudflare.

---

## 9. Alat yang disarankan berikutnya (belum dikerjakan)

Urut dari dampak terbesar:

1. **`kurang` + `isiDariPesan` untuk alat tulis lain**: resep, koreksi HPP, gaji, bea, cara
   bayar. Saat ini baru `buat_barang` yang lengkap.
2. **Diet prompt**: kirim hanya daftar alat yang relevan (dipilih kode dari kata di pesan, seperti
   perpustakaan contoh), bukan ±25 alat sekaligus. Diperkirakan menaikkan ketepatan dan menurunkan
   biaya. Wajib diukur dengan skenario.
3. **Belajar dari pemakaian asli**: percakapan yang berakhir "Ya" disimpan sebagai calon contoh
   (perlu tabel D1 baru + persetujuan Bos), lalu disaring manusia/Hana sebelum masuk perpustakaan.
4. **Context caching** untuk bekal aturan yang sama di setiap panggilan.
5. **Barang tingkat entity**: membuat barang sekaligus di semua gerai satu entity (sekarang per gerai).

---

## 10. Catatan hasil uji live

| Tanggal | Versi | Setelan | Skor | Catatan |
|---|---|---|---|---|
| 2026-10-09 | main sebelum revisi draft | bawaan | 9/10 | Gagal: 05-koreksi-draft-terbuka (persis layar Bos) |
| 2026-10-09 | sesudah #474 (revisi draft) | bawaan, `UNA_ULANG=2` | 10/20 | Skenario 01–05 lulus 2x (termasuk 05). Sisanya berhenti karena Gemini 429 RESOURCE_EXHAUSTED (jatah habis), bukan salah jawab. 06–10 belum diulang |
| 2026-10-10 | sesudah #478 (panduan → tawaran, alat karyawan) | bawaan | 6/6 | 15 (panduan lalu "kamu bisa buatin itu?" → draft karyawan), 12, 13, 16, 03, 05. Skenario 16 diubah: gerai uji tidak punya akun CS, jadi yang dinilai alatnya benar + jujur "belum nemu" |
| 2026-10-11 | sesudah #481 (panduan barang/stok, alat supplier & kategori) | bawaan | 17/17 | 14 pertanyaan asli karyawan (semua panduan tepat, tanpa model) + skenario 15, 17, 18 |

<!-- DOC-IMPACT: 2026-10-09 dokumen baru — fakta mesin Una (Gemini 3.1 Flash-Lite), vonis "masih tertolong",
aturan emas kerangka, tuas latihan, alat uji live scripts/uji-una.mjs + una-latih/skenario/, keputusan Bos Cyo: model & level
mikir dikunci termurah, yang diperbaiki kerangkanya. Perbarui §2 saat model/harga berubah dan §10 setiap uji live. -->

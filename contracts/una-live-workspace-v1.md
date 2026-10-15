# Una Live Workspace V1: kemampuan, lembar, tanda terima aksi, event

Status: **KONTRAK U0, belum diimplementasikan.** Ditulis Eskor (Opus 5.5) 2026-10-15 atas
rencana di `HANDOFF-CACA.md` bagian "Una Live dan Workspace yang dapat dikendalikan".
Kontrak ini menjadi acuan U1–U8. Mengubah bentuk data di sini berarti mengubah fixture
`test/fixtures/una-live/*.json` dan tes `test/una-live-kontrak.test.js` di PR yang sama.

Kontrak lama tetap berlaku dan tidak diubah: `contracts/una-workspace-v1.md` (tugas/draft
bisnis, persetujuan, revisi, cursor) dan `contracts/una-suara-lokal-v1.md` (audio lokal).

## 0. Basis kode saat U0 (dicocokkan 2026-10-15)

- Basis: branch `eskor/una-live-u0` = `origin/main` 78e9774 + `codex/una-pengaturan-apk-20261015`
  (Pengaturan Una di luar chat, tombol live di composer). Branch Pengaturan **belum** di main;
  paket U1–U8 bercabang dari `eskor/una-live-u0` sampai Pengaturan masuk main.
- Migration terakhir di main 0157. Nomor **0158 sudah dipakai** `eskor/dana-apresiasi-denda`
  (belum push). U5 memakai nomor bebas berikutnya saat itu (minimal 0159); periksa main dan
  branch terbuka sebelum menamai.
- Yang dipakai ulang, bukan dibuat ulang:
  - Navigasi: `src/caca-buka-layar.js` (`bukaLayarDariPesan`, dipanggil paling awal di
    `src/caca-agen.js` `jawabPertanyaanInti`), peta `generated/peta-una-data.js`
    (`menuUntuk`, per skin/peran/halaman).
  - Browser: `cacaBukaLayar`/`cacaKlikTab` (`public/caca-chat.js`), hash `#una-buka=`.
  - Panel Entity: `switchEntityTab`, `loadEntityTabContent(name, {autoReport})`,
    `runEntityReport()` (`public/entity-admin.js`); kontrol laporan `entityReportFrom`,
    `entityReportTo`, `entityReportStoreChecklist` (checkbox gerai), `entityReportRun`,
    `entityReportStatus`, hasil `entityReportChart`, `entityReportStoreTable`,
    `entityReportTableWrap`.
  - Pin Beranda: `movePanel`/`restorePanels` di `public/entity-management.js` (pindah
    childNodes dengan anchor komentar, bukan salin HTML). Ini yang dijadikan pengelola mount
    bersama di U2.
  - Workspace tugas: `public/caca-workspace.js` (`window.UnaWorkspace`), API
    `/api/caca/workspace`, tabel `una_workspace_tasks` (kunci `principal_key`).
  - Live: antrean suara di `public/caca-pengaturan.js` (`kirimAntrean`, maks 3), event
    `caca-scope-change`, `caca-audio-stop`, `caca-chat-idle`, `caca-profile-needed`,
    `entity-admin-tab`, `una-workspace:update`.
  - Inventaris tombol mekanis: `generated/inventaris-fitur-una.js` (dibangkitkan
    `scripts/build-peta-una.mjs`). Klasifikasi kontrol Entity Admin U0 menunjuk id di sana.

## 1. Registry kemampuan (U1)

Kemampuan adalah satu-satunya pintu dari keluaran model ke aplikasi. Model hanya memilih
`capabilityId` + `params`. Kode memvalidasi, menjalankan, lalu membuktikan hasilnya.

### 1.1 Deskriptor

Sumber kanonis: `src/una-kemampuan.js` (ESM, dipakai server untuk katalog model dan validasi).
Browser memakai salinan bangkitan `public/una-kemampuan-data.js` (`window.UNA_KEMAMPUAN`),
dijaga `--cek` seperti peta Una. Handler tidak ada di deskriptor; handler didaftarkan di
browser per `id`.

```js
{
  id: 'report.set_filters',          // /^[a-z]+\.[a-z_]+$/, stabil, tidak pernah dipakai ulang
  version: 1,
  label: 'Ubah filter laporan',
  aliases: ['ganti tanggal laporan', 'ubah periode'],  // bahasa Indonesia, untuk katalog
  category: 'view',                  // navigation | read | view | artifact | business_draft
  effect: 'view',                    // none | view | artifact | draft
  page: { halaman: 'entity', tab: 'reports' },   // null = tidak terikat halaman
  surfaceKind: 'page',               // page | canvas | task | null
  roles: ['ENTITY_ADMIN', 'OWNER'],  // nilai sama dengan `peran` di caca-buka-layar
  scopes: ['entity'],                // entity | gerai
  preconditions: ['surface_active'], // daftar tertutup, lihat 1.3
  params: { type: 'object', additionalProperties: false, required: [...], properties: {...} },
  proof: 'data_loaded',              // none | state_read | data_loaded | artifact_saved | draft_created
  modelVisible: true                 // ikut katalog untuk model
}
```

### 1.2 Subset skema parameter

Validator U1 hanya mengenal kata kunci ini. Kata kunci lain di deskriptor = deskriptor tidak sah
(tes gagal), bukan diabaikan.

| type | kata kunci yang boleh |
|---|---|
| `object` | `properties`, `required`, `additionalProperties` (wajib `false`) |
| `string` | `maxLength` (wajib), `enum`, `pattern`, `format: 'date'` (YYYY-MM-DD, tanggal kalender sah) |
| `integer` | `minimum`, `maximum` |
| `boolean` | `default` |
| `array` | `items` (string/integer, atau `{ type:'object', ref:'<nama validator>' }`), `maxItems` (wajib) |

`ref` menunjuk validator bernama yang dimiliki paket lain (mis. `canvas.operation` milik U6).
Semua tipe boleh `default` dan `description`.

### 1.3 Prasyarat (daftar tertutup)

`surface_active` (lembar target sedang aktif), `page_mounted` (panel halaman sudah terpasang
di lembar atau menu), `scope_entity`, `scope_store`, `canvas_saved` (kanvas punya revisi
server). Prasyarat baru ditambah di kontrak ini dulu.

### 1.4 Larangan mutlak

- Tidak ada kemampuan yang menerima JavaScript, URL bebas, selector CSS, id elemen, atau
  "klik tombol X" dari model. Binding ke id DOM hanya ada di handler kode.
- Tombol persetujuan, login/logout, kredensial, dan tombol tulis bisnis tidak pernah menjadi
  target kemampuan. Perubahan bisnis hanya lewat kategori `business_draft` yang membuat draft
  Workspace lama; eksekusinya tetap tombol Ya manusia (`contracts/una-workspace-v1.md`).
- Kemampuan tidak dikenal, versi tidak cocok, peran/lingkup tidak cocok = ditolak, bukan
  dicocokkan ke yang mirip.

### 1.4a Urutan pemeriksaan (kode penolakan pertama yang kena dipakai)

1. `scopeEpoch` beda → `stale`/`SCOPE_CHANGED` (tidak memeriksa apa pun lagi)
2. `capabilityId` tidak terdaftar atau `capabilityVersion` beda → `rejected`/`UNKNOWN_CAPABILITY`
3. peran tidak ada di `roles` → `rejected`/`ROLE_DENIED`
4. lingkup tidak ada di `scopes` → `rejected`/`SCOPE_DENIED`
5. parameter: properti asing, tipe/pola/panjang salah → `rejected`/`INVALID_PARAMS`;
   wajib kosong, tanggal tidak sah, atau `from > to` → `needs_clarification`/`INVALID_PARAMS`
6. target halaman/tab tidak ada di `menuUntuk({skin, peran, halaman})` → `rejected`/`FORBIDDEN_TARGET`
7. prasyarat → `rejected`/`PRECONDITION_FAILED`
8. `target.expectedRevision` beda → `rejected`/`REVISION_CONFLICT`

### 1.5 Kemampuan tahap awal

Daftar lengkap dengan skema: `test/fixtures/una-live/kemampuan.json`. Ringkas:

| id | kategori | catatan |
|---|---|---|
| `page.open` | navigation | buka layar terdaftar di lembar Workspace (bawaan) atau di menu. Fast path `buka_layar` dipetakan ke sini |
| `page.read_state` | read | baca filter, status, ringkasan hasil lembar aktif |
| `report.set_filters` | view | tanggal + gerai laporan Entity, lalu muat ulang (bawaan) |
| `report.refresh` | view | muat ulang lewat pemuat asli |
| `surface.focus` / `surface.close` | navigation | pindah/tutup tampilan lembar; menutup tidak menghapus |
| `task.open` | navigation | buka tugas Workspace lama |
| `canvas.create` / `canvas.read` / `canvas.apply_patch` | artifact | lihat bagian 5 |

## 2. Lembar (surface)

### 2.1 Jenis dan identitas

| kind | id | disimpan di |
|---|---|---|
| `task` | `task:<id una_workspace_tasks>` | API Workspace lama, tidak disalin |
| `page` | `srf_<uuid>` | `/api/caca/surfaces` (identitas halaman + filter, **tanpa angka**) |
| `canvas` | `srf_<uuid>` | `/api/caca/surfaces` (objek kanvas JSON) |

Lembar `page` unik per (pemilik, lingkup, `halaman`, `tab`): POST lembar halaman yang sudah ada
mengembalikan yang lama (200), bukan membuat baru (201). Membuka ulang = fokus.

### 2.2 Bentuk

```js
{
  id: 'srf_…', kind: 'page' | 'canvas',
  title: 'Laporan Usaha',            // ≤ 80 karakter
  scope: { lingkup: 'entity' } | { lingkup: 'gerai', storeCode: 'G001' },  // dari server
  revision: 3,                        // ≥ 1, naik tiap PATCH berhasil
  formatVersion: 1,
  content: { … },                     // per kind, lihat di bawah
  createdAt, updatedAt                // ISO UTC
}
// page.content
{ halaman: 'entity', tab: 'reports', filters: { from: '2026-10-01', to: '2026-10-10', stores: ['G001'] } }
// canvas.content: bagian 5.1
```

Pemilik (`principal_key`), entity, dan gerai **tidak pernah** dikirim atau diterima dari
browser; server menurunkannya dari sesi persis seperti `una_workspace_tasks`.

### 2.3 API (U5)

Lingkup lewat `?store=CODE` atau `?lingkup=entity` seperti Workspace.

| Request | Hasil |
|---|---|
| `GET /api/caca/surfaces` | daftar milik akun di lingkup ini, tanpa `content` kanvas (ringan), urut `updatedAt` turun, maks 50 |
| `POST /api/caca/surfaces` `{kind,title,content}` | 201 `{surface}`; page duplikat → 200 `{surface}` lama |
| `GET /api/caca/surfaces/:id` | 200 `{surface}` |
| `PATCH /api/caca/surfaces/:id` `{expectedRevision, title?, content?}` | 200 `{surface}`; revisi beda → 409 `{code:'REVISION_CONFLICT', surface:<versi server>}` |
| `DELETE /api/caca/surfaces/:id?expectedRevision=N` | 204; revisi beda → 409 |

- Lembar milik akun/lingkup lain → **404** (tidak membocorkan keberadaan), bukan 403.
- `content` ≤ 512 KiB JSON setelah serialisasi → lebih = 413 `CONTENT_TOO_LARGE`.
- Tabel baru aditif, pola kunci sama dengan migration 0150:
  `una_surfaces(id, principal_key, entity_id, store_id, scope_kind, kind CHECK(kind IN('page','canvas')),
  title, revision, format_version, content_json, page_key, created_at, updated_at)` +
  `UNIQUE(principal_key, entity_id, store_id, page_key)` untuk page (page_key = `halaman:tab`,
  NULL untuk kanvas) + index `(principal_key, entity_id, store_id, updated_at DESC)`.
  Tidak ada trigger, ledger, atau fakta bisnis.
- Autosave: debounce 1,5 dtk setelah perubahan terakhir, dan saat `pagehide`/tutup lembar.
  **Tanpa polling.** Baca ulang hanya saat buka, fokus jendela, atau 409.
- Gagal simpan: edit tetap di memori, status "Belum tersimpan", tombol ekspor PNG tetap jalan.
  409: tampilkan dua pilihan (muat versi server / simpan sebagai lembar baru); tidak pernah
  menimpa diam-diam.
- Lembar aktif (fokus) disimpan per perangkat: `localStorage['lekerUnaLembarAktif:' + sidikLogin + ':' + lingkup]`
  dalam try/catch.

### 2.4 Pengelola mount (U2)

`window.UnaMount` menggantikan `movePanel`/`restorePanels` di `entity-management.js`:

```js
UnaMount.claim(panelKey, hostEl, owner)  // owner: 'menu' | 'pin' | 'workspace'; panelKey = 'entity:reports'
UnaMount.release(panelKey)               // kembali ke section asal (anchor komentar)
UnaMount.owner(panelKey)                 // pemilik aktif atau 'menu'
```

- Satu panel satu lokasi aktif. Lokasi lain menampilkan placeholder dengan tombol
  "Sedang dibuka di Workspace, tampilkan di sini" (atau sebaliknya). Tidak ada salinan
  `innerHTML`, id ganda, atau pemasangan listener ulang.
- `claim` memancarkan `una-live:surface` `{action:'mounted'}`. Pemuat data tetap
  `loadEntityTabContent`.

## 3. Aksi dan tanda terima

### 3.1 Perintah

```js
{
  actionId: 'act_…',          // dibuat pemanggil; sama = aksi yang sama
  turnId: 'turn_…',
  capabilityId: 'report.set_filters', capabilityVersion: 1,
  params: { from: '2026-10-01', to: '2026-10-10' },
  target: { surfaceId: 'srf_…', expectedRevision: 3 } | null,
  scopeEpoch: 7,              // angka lokal, naik tiap ganti login/lingkup
  origin: 'model' | 'code' | 'user'
}
```

Server mengirim perintah lewat field baru `uiActions` (maks 3) di balasan `/api/caca/tanya`.
Browser **memvalidasi ulang** dengan deskriptor yang sama sebelum menjalankan; validasi server
tidak dipercaya begitu saja dan sebaliknya.

### 3.2 Tanda terima

```js
{
  actionId, capabilityId,
  status: 'ok' | 'rejected' | 'failed' | 'stale' | 'superseded' | 'needs_clarification' | 'cancelled',
  code: null | 'UNKNOWN_CAPABILITY' | 'INVALID_PARAMS' | 'ROLE_DENIED' | 'SCOPE_DENIED'
      | 'PRECONDITION_FAILED' | 'REVISION_CONFLICT' | 'SCOPE_CHANGED' | 'SUPERSEDED'
      | 'DATA_FAILED' | 'NOT_VERIFIED' | 'FORBIDDEN_TARGET',
  message: 'kalimat pendek untuk pengguna',
  surfaceId: 'srf_…' | null, resultRevision: 4 | null,
  summary: { … },             // ringkas, aman dikirim ke model (≤ 2 KiB)
  proof: { kind: 'data_loaded', filters: {…}, requestKey: 12, at: ISO } | null,
  clarification: { question: '…', options: ['…'] } | null,
  replayed: false
}
```

Aturan:
- `actionId` yang sama dalam satu halaman dimuat → tanda terima lama dengan `replayed:true`,
  tidak dijalankan lagi (simpan 100 terakhir di memori).
- `scopeEpoch` beda dengan saat ini → `stale`/`SCOPE_CHANGED`, tidak menyentuh DOM.
- Perintah lebih baru untuk lembar sama membuat yang lama `superseded`; respons data lama
  dibuang oleh pemuat (`requestKey` naik monoton per panel).
- `ok` untuk `proof: data_loaded` hanya setelah pemuat asli selesai **dan** state panel yang
  terbaca sama dengan filter yang diminta. Tanpa itu `failed`/`NOT_VERIFIED`. Una tidak boleh
  berkata "sudah ditampilkan" tanpa tanda terima `ok`.
- Angka yang dipakai Una menjawab tetap dari API terotorisasi (alat baca server), bukan dari
  teks DOM. `summary` hanya ringkasan tampilan.
- Setelah reload tidak ada pemutaran ulang aksi; yang ada hanya baca state.

### 3.3 Aturan tanggal ("1 sampai 10 Oktober")

Tahun dari filter lembar aktif bila ada, selain itu tahun berjalan Asia/Jakarta. Rentang
inklusif. Tanggal tidak sah atau `from > to` → `needs_clarification`, tidak ditebak. Jawaban Una
menyebut tanggal lengkap ("1–10 Oktober 2026"). Penerjemahan bahasa → tanggal dikerjakan kode
(`src/caca-terjemah.js`), bukan model.

### 3.4 Adapter halaman (U3)

```js
window.UnaPageAdapters['entity:reports'] = {
  readState()  // → { from, to, stores:[...], status:'idle'|'loading'|'ready'|'error', requestKey, result:{storeCount, totals} | null, error }
  setFilters({ from, to, stores })   // tulis input + checkbox; tidak memuat
  refresh()    // → Promise<{ ok, requestKey, state } | { ok:false, code, message }>
}
```

`runEntityReport()` dipecah: fungsi murni pemuat mengembalikan hasil/error eksplisit dan menolak
respons dengan `requestKey` lama; tombol `entityReportRun` dan pin Beranda memakai fungsi yang sama.

## 4. Konteks giliran dan event

### 4.1 Konteks dikirim ke server (U4)

Field `surfaceContext` di body `/api/caca/tanya`, ≤ 4 KiB:

```js
{ conversationId, turnId, scopeEpoch, activeSurfaceId, surfaceRevision, surfaceKind,
  page: { halaman, tab } | null, filters: {…} | null, selection: [...ids] | null,
  lastAction: { capabilityId, status, summary } | null }
```

Server memperlakukannya sebagai **petunjuk**, bukan otorisasi: lingkup, peran, dan pemilik tetap
dibaca dari sesi. Konteks yang tidak lolos validasi dibuang tanpa menggagalkan giliran.

### 4.2 Event browser (di `window`, `CustomEvent`)

| nama | detail | pemancar |
|---|---|---|
| `una-live:surface` | `{ surfaceId, kind, action:'opened'|'focused'|'closed'|'mounted'|'saved'|'conflict', revision }` | U2/U5 |
| `una-live:page-state` | `{ surfaceId, panelKey, state }` (bentuk `readState()`) | U3; juga saat pengguna mengubah filter manual |
| `una-live:receipt` | tanda terima 3.2 | U1 |
| `una-live:progress` | `{ turnId, actionId?, step, phase:'start'|'done'|'failed', label }` | U4 |
| `una-live:context` | konteks 4.1 terbaru | U4 (satu-satunya penulis) |

Event lama tetap dan artinya tidak berubah: `caca-scope-change` (U4 menaikkan `scopeEpoch`),
`caca-audio-stop`, `caca-chat-idle`, `caca-profile-needed`, `entity-admin-tab`,
`una-workspace:update`.

Interupsi narasi (`caca-audio-stop`) **tidak** membatalkan aksi atau draft. Pembatalan baca
adalah aksi terpisah (`cancelled`), dan tidak pernah menyentuh draft bisnis yang sedang dieksekusi.

## 5. Kanvas

### 5.1 Format objek (formatVersion 1)

```js
{ width: 1600, height: 1000, background: 'white' | 'grid',
  objects: [
    { id: 'o1', type: 'stroke', z: 1, color: '#1f2937', size: 3, points: [[x,y], …] },  // ≤ 2000 titik
    { id: 'o2', type: 'text',   z: 2, x, y, text: '…', fontSize: 18, color },          // text ≤ 500
    { id: 'o3', type: 'rect' | 'ellipse', z, x, y, w, h, color, fill: null | color },
    { id: 'o4', type: 'line' | 'arrow',   z, x1, y1, x2, y2, color, size }
  ] }
```

Koordinat bilangan bulat 0–10000. Maks 2000 objek. `id` ≤ 40 karakter `[\w-]`. Warna `#rrggbb`.

### 5.2 Patch (`canvas.operation`, U6 memiliki validatornya)

`{op:'add', object}` · `{op:'update', id, set:{…}}` (tidak boleh mengubah `id`/`type`) ·
`{op:'remove', id}` · `{op:'reorder', id, z}`. Maks 50 operasi per patch. Patch dari Una
membawa `expectedRevision`; revisi beda → `REVISION_CONFLICT`, tidak diterapkan. Setiap patch
masuk riwayat undo sebagai satu langkah.

### 5.3 Pembacaan (U7)

Pemicu hanya permintaan eksplisit atau pertanyaan yang merujuk kanvas, tidak per goresan.
Snapshot dibekukan (`surfaceId`, `revision`, PNG ≤ batas gambar adapter yang ada, objek relevan).
Hasil:

```js
{ surfaceId, readRevision, stale: false, observations: [...], intents: [...], unclear: [...],
  proposedActions: [ perintah 3.1 ] }   // tetap lewat validator; bisnis → business_draft
```

`stale: true` bila revisi kanvas sudah naik saat hasil tiba; usulan dari pembacaan basi tidak
diterapkan otomatis.

## 6. Kepemilikan file

Satu file satu pemilik selama paket berjalan. File bersama diubah hanya oleh pemilik yang
tertulis; yang lain mengirim permintaan lewat handoff.

| Paket | Membuat | Mengubah |
|---|---|---|
| U1 | `src/una-kemampuan.js`, `src/una-kemampuan-validasi.js`, `public/una-kemampuan-data.js` (bangkitan), `public/una-registry.js`, `test/una-kemampuan*.test.js` | `src/caca-buka-layar.js` (hanya keluaran tambahan `uiActions`), `scripts/build-peta-una.mjs` (bangkitkan data browser) |
| U2 | `public/una-mount.js`, `public/una-lembar.js`, `public/una-lembar.css`, `test/una-lembar*.test.js` | `public/entity-management.js` (movePanel → UnaMount), `public/caca-workspace.js` (adapter `task`), `public/entity-admin.html`, `public/branch-admin.html` (tag skrip/kerangka) |
| U3 | `public/una-adapter-laporan.js`, `test/una-adapter-laporan.test.js` | `public/entity-admin.js` (`runEntityReport`, `loadEntityTabContent`) |
| U4 | `public/una-dispatcher.js`, `test/una-dispatcher*.test.js` | `public/caca-chat.js`, `public/caca-pengaturan.js` (antrean live), `src/caca-agen.js`, `src/caca-chat.js` (body `surfaceContext`, balasan `uiActions`) |
| U5 | `src/una-surfaces.js`, `migrations/01xx_una_surfaces.sql`, `public/una-surfaces-client.js`, `test/una-surfaces*.test.js` | `src/caca-chat.js`: **hanya** satu baris rute `/api/caca/surfaces` (di samping rute workspace) |
| U6 | `public/una-kanvas.js`, `public/una-kanvas.css`, `src/una-kanvas-patch.js` (validator murni, dipakai server & tes), `test/una-kanvas*.test.js` | — |
| U7 | `src/una-kanvas-baca.js`, `test/una-kanvas-baca.test.js` | `src/caca-agen.js` lewat U4 (permintaan tertulis) |
| U0/U8 | kontrak ini, fixture `test/fixtures/una-live/`, `test/una-live-kontrak.test.js` | `HANDOFF-CACA.md`, kamus Una |

Integrator (urutan merge, satu per satu): `package.json` daftar `check`, versi `?v=` aset,
kamus/peta Una (`segarkan-kamus-una`), ADR, dokumen. Setiap tombol/rute baru wajib
diklasifikasikan di `test/fixtures/una-live/kontrol-entity-admin.json` (Entity Admin) dan
masuk kamus Una sesuai skill `segarkan-kamus-una`.

## 7. Fixture bersama

`test/fixtures/una-live/`:
- `kemampuan.json`: deskriptor tahap awal (sumber awal `src/una-kemampuan.js` U1).
- `lembar.json`: contoh lembar page/canvas/task dan respons 409.
- `aksi.json`: pasangan perintah → tanda terima (ok, duplikat, basi, digantikan, klarifikasi).
- `keluaran-model-palsu.json`: keluaran model yang salah dan kode penolakan yang diharapkan
  (skenario penerimaan 6 dan 7).
- `kontrol-entity-admin.json`: klasifikasi setiap tombol Entity Admin dari inventaris mekanis.

`test/una-live-kontrak.test.js` menjaga bentuk fixture dan memaksa tombol Entity Admin baru
diklasifikasikan. Paket U1–U7 memakai fixture ini di tesnya sendiri.

## DOC-IMPACT

2026-10-15 U0: kontrak baru. Belum ada kode runtime; tidak ada yang live.

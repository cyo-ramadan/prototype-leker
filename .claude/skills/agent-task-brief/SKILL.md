---
name: agent-task-brief
description: Menyusun task brief yang lengkap dan berpagar untuk agent implementer lain (Karen, Kimi, dst.) di papan agent-bus MAXI (Cloudflare D1 `maxi-agent-bus`) — skema kolom, jalur akses, pagar invariant, dan checklist anti-bug, sampai jadi baris SQL yang siap di-INSERT. Pakai skill ini SETIAP KALI akan membuat, menulis, menyusun, memecah, atau memperbarui kerjaan yang akan dieksekusi agent lain — termasuk saat Bos Cyo bilang "bikin task", "taruh di papan", "suruh Karen kerjakan", "lempar ke agen", "pecah jadi task", atau saat menerjemahkan instruksi Bos Cyo jadi pekerjaan orang lain. Pakai juga saat membalas permintaan task lewat GitHub Issue relay (mis. Issue #107 `BLOCKED_AGENT_BUS`), saat mirror/klaim task atas nama agent yang tidak punya akses D1, dan saat menulis aturan tetap agent di `agent_sops`. Jangan dilewati walau tasknya kelihatan sepele — brief tanpa pagar adalah sumber bug paling mahal di repo ini.
---

# Menulis task untuk agent implementer

## Kenapa skill ini ada

Bos Cyo memercayakan **struktur** ke Hana dan **pengetikan kode** ke agent lain. Artinya kualitas
hasil akhir ditentukan di sini — bukan di tangan agent yang ngoding. Agent implementer datang
dengan context kosong: dia tidak ingat percakapan Bos Cyo, tidak otomatis membaca semua dokumen
repo, dan kalau brief-nya longgar dia akan mengisi kekosongan itu dengan tebakannya sendiri.
Tebakan itulah yang jadi bug — bukan karena agentnya bodoh, tapi karena tidak ada yang memberi
tahu batasnya.

Jadi tugas skill ini satu: **memastikan setiap task yang ditulis membawa pagarnya sendiri**,
supaya agent yang mengerjakan tidak punya ruang untuk berkreasi ke arah yang salah.

## Alur kerja

### 1. Fresh query dulu — selalu

Jangan pernah menyusun task dari ingatan percakapan atau snapshot lama. Task yang kelihatan
"masih kosong" sering ternyata sudah diklaim sesi lain atau sudah `DONE`.

```sql
SELECT t.task_id, t.status, t.assigned_to, t.territory, t.title,
  (SELECT c.session_id FROM task_claims c
   WHERE c.task_id = t.task_id AND c.released_at IS NULL) AS open_claim
FROM tasks t WHERE t.project = '<PROJECT>' ORDER BY t.territory, t.created_at;

SELECT kind FROM agent_roles WHERE family = '<FAMILY>';
```

`kind` yang tidak ada di `agent_roles` untuk family tujuan akan ditolak trigger saat diklaim —
task-nya jadi sampah yang tidak bisa diambil siapa pun.

### 2. Susun brief-nya dengan pagar (bagian paling penting)

Lihat "Pagar wajib" di bawah. Ini bukan formalitas — tiap butirnya lahir dari kerusakan nyata
yang pernah terjadi di repo ini.

### 3. INSERT ke `tasks` + `task_paths`

Template SQL ada di bawah. `task_paths` minimal satu baris — tanpa itu tidak ada yang mencegah
dua agent menyentuh file yang sama.

### 4. Verifikasi baris yang barusan ditulis

```sql
SELECT t.task_id, t.status, t.kind, t.mutates_production, t.self_closing,
  (SELECT group_concat(path_prefix, ', ') FROM task_paths p WHERE p.task_id = t.task_id) AS paths
FROM tasks t WHERE t.task_id = '<TASK_ID>';
```

Kalau pengerjanya kemungkinan agent GitHub-only (Karen sering begitu), pertimbangkan sekalian
mirror isinya ke GitHub Issue relay — jangan biarkan dia menemukan sendiri bahwa dia blocked.

## Pagar wajib di setiap brief

Semua aturan ini sudah ada di `CLAUDE.md`, `KNOWN_PITFALLS.md`, `agent-bus/CLAIM-PROMPT.md`, dan
`MODULE_OWNERSHIP.md`. Yang sering gagal bukan aturannya — tapi asumsi bahwa agent akan membuka
dan menyimpulkan sendiri isi dokumen itu. Redundansi di brief itu sengaja.

**a. Kutip invariant yang relevan, jangan cuma bilang "hati-hati akuntansi".**
`CLAUDE.md` punya 9 invariant keras: uang scaled-integer bukan float; posted journal immutable
(koreksi lewat reversal, bukan edit); manual journal wajib balance exact; Accounting satu-satunya
yang memposting jurnal; isolasi `store_id` server-side; tanpa polling periodik; jangan menulis
ulang migration yang sudah applied; saldo negatif bukan bug; jangan minta token plaintext.
Kalau task menyentuh salah satunya, **tulis ulang invariant persisnya di `forbidden`**.

**b. Area akuntansi / inventory-costing / approval → paksa baca `KNOWN_PITFALLS.md` dulu,**
sebutkan eksplisit di brief. 21 pitfall di sana adalah daftar kerusakan yang sudah pernah kejadian.

**c. `forbidden` harus spesifik, bukan generik.**
Bukan "jangan rusak akuntansi", tapi nama persis: "jangan ubah
`trg_accounting_posted_header_immutable_update`", "jangan ubah signature `postAccountingJournal()`",
"jangan sentuh `src/accounting-ledger.js` di luar fungsi X". Makin spesifik, makin sempit ruang
untuk salah kreasi. `forbidden` kosong = task tanpa pagar.

**d. `task_paths` sesempit kerjaan aslinya.**
Kalau yang disentuh dua file, jangan kasih satu folder penuh. Path sempit itu sendiri pagar
teknis: agent yang menyentuh di luar itu langsung terbaca melanggar batas modul
(`MODULE_OWNERSHIP.md` aturan "stay inside your module"), dan trigger `trg_claim_path_conflict`
mencegah dua klaim bertabrakan di file yang sama.

**e. `acceptance_criteria` wajib menuntut bukti, bukan klaim.**
Minimal: `npm test` dan `npm run check` hijau, **plus tes regresi baru yang gagal kalau perubahan
itu dicabut**. Tes yang tetap lulus tanpa perubahan agent tidak membuktikan apa pun — itu pola
yang sudah beberapa kali lolos dan menyembunyikan pekerjaan kosong.

**f. Ambiguitas kebijakan = berhenti, bukan menebak.**
Tulis eksplisit di brief: "kalau ketemu keputusan kebijakan akuntansi/persediaan yang belum jelas,
tulis di `escalations` lalu berhenti — jangan diputuskan sendiri." Menebak kebijakan akuntansi
adalah kegagalan termahal di sistem ini karena uangnya nyata.

**g. `mutates_production = 1` mewajibkan `self_closing = 0` — dan itu bukan formalitas.**
Kombinasi itu yang memaksa agent berhenti sesudah menulis rencana kerja dan menunggu Bos Cyo
bilang "lanjut" sebelum menyentuh data sungguhan. Database menolak kombinasi lain lewat CHECK
constraint. Jangan pernah menurunkan `mutates_production` jadi 0 supaya agent bisa jalan tanpa
menunggu — itu menghapus satu-satunya gerbang review yang ada.

**h. Ragu apakah task menyentuh data produksi/uang sungguhan? Anggap YA.**
Kelebihan hati-hati harganya satu ronde tanya; kekurangan hati-hati harganya data keuangan.

## Template SQL

```sql
INSERT INTO tasks (task_id, assigned_to, issued_by, role, territory, migration_range,
  protocol_version, title, brief, acceptance_criteria, kind, mutates_production,
  self_closing, system_scope, tenant_scope, forbidden)
VALUES (
  '<FAMILY>-<AREA>-<DESKRIPSI-SINGKAT>',   -- huruf besar, deskriptif, unik
  '<FAMILY>',                               -- 'karen', 'kimi', dst
  'HANA',                                   -- 'HANA' kalau Hana yang menulis mewakili Bos Cyo
  'IMPLEMENTER',
  '<territory>',                            -- satu kata huruf kecil, cek yang sudah dipakai
  NULL,                                     -- migration_range, biasanya NULL
  'MAXI_AGENT_TASK_BOARD_V1',
  '<judul — kalau sequential, tulis "SEQUENTIAL, tunggu <task-lain> selesai" di sini>',
  '<brief: instruksi asli Bos Cyo apa adanya + konteks + jalur/endpoint persis kalau ada>',
  '<acceptance: bukti konkret yang membuktikan selesai, termasuk tes regresi + npm test/check>',
  '<KIND>',                                 -- harus ada di agent_roles family itu
  <0|1>, <0|1>,                             -- mutates_production, self_closing (lihat pagar g)
  'APPLICATION', 'NONE',
  '<forbidden: nama file/fungsi/trigger persis yang tidak boleh disentuh — jangan generik>'
);

INSERT INTO task_paths (task_id, path_prefix) VALUES
  ('<TASK_ID>', '<prefix < 50 karakter>');
  -- ulangi baris ini untuk tiap path tambahan
```

Klaim mewakili agent yang blocked (mirroring, lihat "Jalur akses" #3):

```sql
INSERT OR IGNORE INTO agent_sessions (id, family, slot, session)
VALUES ('<family><slot>.<session>', '<family>', <slot>, <session>);

INSERT INTO task_claims (id, task_id, session_id)
VALUES ('<claim-id-unik>', '<TASK_ID>', '<family><slot>.<session>');
```

## Referensi papan

**Papan agent (yang ini):** Cloudflare D1 `maxi-agent-bus`,
`database_id: cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6`, `account_id: 25c5fe53877002648959e8dd35678188`.
Isinya task implementasi kode antar-agent.

**Bukan papan ini:** `maxi-workboard-prototype`
(`database_id: 36e676b2-6f03-45cc-9acf-5a44127656b0`) — itu papan manusia (issue/chat karyawan).
Jangan tertukar; dua sistem berbeda dengan audiens berbeda.

Papan agent **tidak punya UI web**. Artifact "Papan Leker" yang pernah dibuat itu snapshot statis
dan gampang basi — jangan pernah dipakai sebagai sumber kebenaran.

Manual lengkap untuk sisi agent yang mengerjakan: `agent-bus/CLAIM-PROMPT.md` di repo ini.
Skema tabel lengkap beserta trigger-nya: `agent-bus/schema.sql`.

### Kolom `tasks` yang perlu diisi benar

| Kolom | Isi |
|---|---|
| `task_id` | PK, konvensi `<family>-<AREA>-<DESKRIPSI>` huruf besar (`<family><slot>-SELF-<timestamp>` untuk task yang agent buat sendiri) |
| `assigned_to` | family agent tujuan |
| `issued_by` | `HANA` kalau Hana yang menulis; `BOS_CYO` kalau baris self-issued oleh agent |
| `territory` | satu kata huruf kecil, konsisten dengan yang sudah dipakai |
| `protocol_version` | selalu `MAXI_AGENT_TASK_BOARD_V1` |
| `kind` | harus cocok `agent_roles` family itu (karen: `DOCS`/`FEATURE`/`MIGRATION`) |
| `project` | `leker` \| `ikan` \| `workboard` — ambil dari konteks, jangan menebak |
| `mutates_production`, `self_closing` | 0/1; CHECK constraint: `mutates_production=1` mewajibkan `self_closing=0` |
| `forbidden` | wajib eksplisit dan spesifik |

### Jalur akses ke papan

1. **Direct D1** — kalau sesi punya Cloudflare MCP connector, pakai langsung dengan id di atas.
2. **`curl` + token Cloudflare** — kalau tidak ada MCP tapi bisa jalankan shell. Token dikirim
   Bos Cyo terpisah di luar chat/repo. Jangan minta token plaintext kalau jalur 1 tersedia, dan
   jangan pernah menyimpan token di repo.
3. **GitHub Issue relay** (`cyo-ramadan/prototype-leker` Issue #107) — untuk agent GitHub-only
   yang sama sekali tidak punya D1/curl. Kalau sesi ini punya akses dan ada permintaan
   "@claude Hana" di sana: jawab dengan **fresh query**, bukan histori lama. Kalau agent melapor
   selesai lewat issue, Hana yang menulis baris `reports` dan melepas klaim di D1 atas namanya.

## Gotcha teknis (ditemukan langsung, bukan dugaan)

- **D1 remote API membatasi jumlah term compound SELECT.** `UNION ALL` dengan 6+ term bisa kena
  `too many terms in compound SELECT: SQLITE_ERROR`. Pecah jadi `INSERT ... SELECT ... WHERE NOT
  EXISTS` satu baris data per statement. Statement individual boleh digabung banyak sekaligus
  dipisah `;` dalam satu pemanggilan — yang dibatasi compound SELECT *per statement*.
- **Migration yang bergantung pada data dari migration edition-dependent** (lihat
  `test/stores-edition.test.js`) wajib menyebut literal kata "edition" di komentarnya, atau kena
  `FOREIGN KEY constraint failed` saat replay skenario `includeEdition:false`.
- **Push ke branch fitur = deploy production sungguhan.** Terbukti 2026-08-31: Cloudflare Git
  Integration menjalankan migrate→verify→deploy penuh dari branch fitur tanpa menunggu merge
  (`KNOWN_PITFALLS.md` → "Preview Worker tidak membuktikan remote D1 siap"). Task yang menyentuh
  migration harus menyebut ini di `forbidden`.
- **Sequencing antar-task belum punya kolom formal.** Tulis manual di `title`
  ("SEQUENTIAL, tunggu `<task-lain>` selesai") dan jelaskan lagi di `brief`. Tidak ada enforcement
  otomatis — kalau tidak ditulis, tidak ada yang menahannya.
- **`agent_sops` granularitasnya per-family, bukan per-sesi.** Untuk wewenang khusus satu sesi,
  tulis eksplisit "khusus session bernama X" di dalam teks `rules`, append pakai
  `rules = rules || '...'` (jangan overwrite), lalu catat juga di file `.md` repo (mis.
  `MODULE_OWNERSHIP.md`) supaya tidak hilang kalau `agent_sops` suatu saat ditulis ulang.
- **Kredensial aplikasi bukan token infrastruktur.** Password kasir/admin aplikasi Leker berbeda
  dari token Cloudflare/GitHub. Kalau task butuh login aplikasi, tulis eksplisit di brief: "minta
  ke Bos Cyo terpisah di luar papan/chat" — jangan pernah menuliskan kredensial di baris task.

## Checklist sebelum menutup

- [ ] Sudah fresh-query; tidak me-recycle task yang ternyata sudah diklaim atau `DONE`
- [ ] `kind` cocok dengan `agent_roles` family tujuan
- [ ] `project` benar (`leker`/`ikan`/`workboard`), bukan tebakan
- [ ] `mutates_production` / `self_closing` konsisten dengan CHECK constraint dan dengan
      kenyataan (menyentuh data produksi = 1)
- [ ] `forbidden` spesifik: nama file/fungsi/trigger, bukan peringatan umum
- [ ] Invariant `CLAUDE.md` yang relevan dikutip ulang di brief/`forbidden`
- [ ] `acceptance_criteria` menuntut `npm test` + `npm run check` hijau dan tes regresi yang
      gagal bila perubahan dicabut
- [ ] `task_paths` minimal satu baris, tiap prefix < 50 karakter, sesempit kerjaan aslinya
- [ ] Kalau butuh kredensial aplikasi — ditulis "minta ke Bos Cyo terpisah", bukan ditulis nilainya
- [ ] Kalau pengerjanya mungkin GitHub-only — sekalian di-mirror ke Issue relay
- [ ] Baris yang ditulis sudah diverifikasi ulang lewat SELECT, bukan diasumsikan masuk

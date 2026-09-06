# Prompt sekali-pakai: satu Karen, satu task

Dipakai kalau Bos Cyo sudah tahu persis `task_id` yang mau dikerjakan (task-nya sudah ada di
papan, ditulis Hana atau siapa pun) dan mau buka SATU sesi Karen baru khusus buat task itu,
tanpa dia muter-muter baca seluruh papan atau seluruh dokumen repo dulu.

Beda dengan `CLAIM-PROMPT.md` (itu manual lengkap, buat agent yang baru pertama kali datang dan
belum tahu task mana yang jadi bagiannya). Prompt ini asumsinya task_id SUDAH ditentukan --
jadi lompat langsung ke situ, skip Langkah 2 (lihat semua task yang cocok) dan skip Langkah 2.5
(bikin task sendiri).

**Cara pakai:** salin blok di bawah, ganti `<TASK_ID>` dengan id task-nya, tempel ke sesi Karen
yang baru dibuka.

---

```
Kamu adalah agent implementer, family "karen", untuk repo prototype-leker.

Kerjakan HANYA task ini: <TASK_ID>. Jangan browse task lain di papan, jangan mulai baca
dokumen apa pun dulu sebelum Langkah 1 dan 2 di bawah selesai -- semua yang kamu butuh
sudah dipetakan di situ, di luar itu kemungkinan besar tidak perlu.

Papan tugas: Cloudflare D1 "maxi-agent-bus", database_id
cbba8e7a-6bbf-45b9-9796-1dbce5dfa6b6, account_id 25c5fe53877002648959e8dd35678188.

LANGKAH 1 -- ambil isi task-nya, fresh dari database (jangan pernah pakai isi yang
"kelihatannya sudah tahu" dari mana pun, task bisa sudah berubah sejak ditulis):

SELECT t.task_id, t.status, t.kind, t.territory, t.title, t.brief, t.acceptance_criteria,
       t.forbidden, t.mutates_production, t.self_closing,
       (SELECT group_concat(path_prefix, ', ') FROM task_paths p WHERE p.task_id = t.task_id) AS paths,
       (SELECT rules FROM agent_sops WHERE family = 'karen') AS sop
FROM tasks t WHERE t.task_id = '<TASK_ID>';

Kalau status bukan OPEN, atau ada open_claim aktif milik session lain -- berhenti, lapor ke
Bos Cyo, jangan lanjut (cek dulu: SELECT session_id FROM task_claims WHERE task_id =
'<TASK_ID>' AND released_at IS NULL).

Field brief, acceptance_criteria, forbidden, paths di baris itu SUDAH self-contained --
ditulis supaya kamu tidak perlu menebak apa pun. Baca sop yang ikut terbawa juga, itu aturan
tetap keluargamu.

LANGKAH 2 -- baca dokumen wajib, SECUKUPNYA, jangan lebih dari ini:
- CLAUDE.md di akar repo (pendek, invariant keras).
- KNOWN_PITFALLS.md -- HANYA kalau territory hasil Langkah 1 menyentuh akuntansi, inventory/
  costing, atau approval. Kalau bukan, lewati file ini.
- ADR/kontrak yang namanya DISEBUT EKSPLISIT di brief/forbidden task ini (kalau ada). Jangan
  baca ADR lain yang tidak disebut -- kalau brief tidak menyebut nama file, berarti memang
  tidak perlu.
Jangan buka dokumen lain di luar tiga poin ini kecuali brief menyuruh eksplisit.

LANGKAH 3 -- daftar sesi (skip kalau sudah pernah daftar sebelumnya di repo ini dalam
context yang sama):

SELECT slot, session FROM agent_sessions WHERE family = 'karen' ORDER BY slot, session;
-- kosong atau kerjaan baru -> slot = angka terkecil yang belum ada, session = 1
INSERT OR IGNORE INTO agent_sessions (id, family, slot, session)
VALUES ('karen<SLOT>.<SESSION>', 'karen', <SLOT>, <SESSION>);

LANGKAH 4 -- klaim:

INSERT INTO task_claims (id, task_id, session_id)
VALUES ('karen<SLOT>-<TASK_ID>', '<TASK_ID>', 'karen<SLOT>.<SESSION>');

Kalau ditolak, pesannya sudah menjelaskan sebabnya (lihat tabel di CLAIM-PROMPT.md kalau
butuh, tapi jangan dibaca duluan kalau klaimnya lancar) -- jangan diakali, lapor kalau
genuinely blocked.

LANGKAH 5 -- kerjakan:
- git config user.name "karen" && git config user.email "karen@agent.maxi" sebelum commit
  pertama.
- HANYA sentuh file yang ada di kolom paths hasil Langkah 1. Butuh file lain di luar itu?
  Berhenti, lapor -- jangan melebar sendiri.
- Kerja di branch sendiri, buka PR. Jangan pernah push ke main, jangan force push.
- npm test dan npm run check wajib hijau, PLUS tes regresi baru yang gagal kalau
  perubahanmu dicabut -- tes yang lulus tanpa perubahanmu tidak membuktikan apa pun.
- Ambiguitas kebijakan akuntansi/persediaan/approval -> tulis di escalations, JANGAN
  menebak. Ini kegagalan termahal di sistem ini karena uangnya nyata.

LANGKAH 6 -- lapor dengan bukti:

INSERT INTO reports (report_id, task_id, agent, role, territory, summary, files_changed,
                     tests_and_results, open_risks, final_status)
VALUES ('<REPORT_ID>', '<TASK_ID>', 'karen<SLOT>.<SESSION>', 'IMPLEMENTER', '<TERRITORY dari Langkah 1>',
        'hasil per butir acceptance_criteria', 'daftar berkas yang diubah',
        'perintah yang dijalankan + output, tes yang ditambahkan, link PR',
        'risiko yang masih terbuka', 'PASS');

UPDATE task_claims SET released_at = CURRENT_TIMESTAMP, release_reason = 'REPORTED'
WHERE id = 'karen<SLOT>-<TASK_ID>';

Kalau tab penuh sebelum selesai: lihat Langkah 6 di CLAIM-PROMPT.md (task_handoffs) --
itu satu-satunya bagian manual lengkap yang boleh kamu buka di luar daftar Langkah 2 di atas,
karena situasinya memang di luar jalur normal.
```

## DOC-IMPACT

Dokumen operasional untuk agent-bus, bukan perilaku aplikasi -- tidak mengubah kode
prototype-leker, cuma cara memberi instruksi ke Karen. Perbarui kalau skema `tasks`/
`agent_sessions`/`task_claims` di `agent-bus/schema.sql` berubah bentuk kolomnya.

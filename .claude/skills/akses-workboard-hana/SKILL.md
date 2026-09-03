---
name: akses-workboard-hana
description: Cara Hana sendiri membaca dan membalas hal yang ditujukan padanya di MAXI Workboard (D1 maxi-workboard-prototype) — dua jalur terpisah (tabel issues untuk isu/percakapan, tabel tasks untuk tugas satu-arah dari Bos Cyo/staf lain) yang sama-sama harus dicek, bukan cuma yang datang lewat @mention di issues. Pakai skill ini SETIAP KALI mau cek "ada yang perlu Hana jawab/kerjakan di Workboard tidak", sebelum bilang "tidak ada yang baru", atau saat Bos Cyo bilang "aku sudah tulis di task/isu" tapi Hana belum ketemu. Juga referensi kalau Bos Cyo kirim screenshot papan tugas (program-task.daily-napkin.workers.dev) dan Hana perlu mencocokkan ke baris aslinya di database.
---

# Akses Workboard untuk Hana

## Kenapa skill ini ada

2026-09-03: Bos Cyo bilang "aku baru aja nulis di task baru Workboard" dan Hana tidak
menemukannya — karena Hana cuma terbiasa dicek lewat tabel `issues` (jalur @mention yang
sudah berulang kali dipakai sesi-sesi sebelumnya). Ternyata ada tabel `tasks` terpisah di
**database yang sama**, dipakai buat tugas satu-arah dari Bos Cyo/staf lain (bukan cuma
percakapan isu), dan Hana belum pernah mengecek itu. Skill ini supaya kejadian itu tidak
terulang.

## Alamat

| Hal | Nilai |
|---|---|
| Database | Cloudflare D1 `maxi-workboard-prototype` |
| `database_id` | `36e676b2-6f03-45cc-9acf-5a44127656b0` |
| `account_id` | `25c5fe53877002648959e8dd35678188` (Daily Napkin) |
| UI web manusia (Bos Cyo lihat dari sini) | `https://program-task.daily-napkin.workers.dev/` |
| Identitas Hana — `tenant_id` | `ten_maxi_seed` |
| Identitas Hana — `author_user_id` / `assignee_user_id` / `raised_by`/`requested_user_id` | `usr_hana_8edff74c-500e-4e82-8c65-76d3a4cb2417` |
| Identitas Hana — `author_role` di `issue_messages` | `HANA` |

**Bukan sumber kebenaran:** artifact claude.ai "Papan Leker" yang pernah dipublikasikan —
itu snapshot statis dari saat dipublish, gampang basi, tidak fetch data live. Jangan pernah
dipakai untuk menyimpulkan isi Workboard saat ini. Kalau Bos Cyo kirim screenshot papan
tugas, itu dari UI web di atas — cocokkan ke baris aslinya lewat query, jangan cuma percaya
dari gambar.

## Dua jalur terpisah — WAJIB cek dua-duanya

Ini database yang sama, tapi **dua tabel dengan bentuk dan tujuan berbeda**. Mengecek satu
saja dan menyimpulkan "tidak ada yang baru" adalah kesalahan yang sudah pernah kejadian.

### 1. `issues` — isu/percakapan (biasanya dari Akuntan/staf, butuh diskusi bolak-balik)

Ditandai untuk Hana lewat kolom `requested_user_id` = id Hana di atas, atau lewat pesan
`@hana` di `issue_messages`. Status: `OPEN` → `CLAIMED` → `ANSWERED` → `RESOLVED`.

```sql
SELECT id, status, title, description, raised_by_user_id, created_at
FROM issues
WHERE status IN ('OPEN', 'CLAIMED')
   OR requested_user_id = 'usr_hana_8edff74c-500e-4e82-8c65-76d3a4cb2417'
ORDER BY created_at DESC LIMIT 15;
```

Balas dengan INSERT ke `issue_messages` (author_role `HANA`), lalu UPDATE `issues` set
`status='ANSWERED'`, `answered_by_user_id`, `answer_text`, `answered_at`, `reply_count`,
`last_reply_at`. Contoh lengkap ada di histori sesi ini (isu "INPUT RESTOCK", "Pengeluaran",
"Penyesuaian Stok").

### 2. `tasks` — tugas satu-arah (dari Bos Cyo atau siapa pun, bukan cuma percakapan)

Ini yang Hana lewatkan. Ditandai lewat `assignee_user_id` = id Hana, kadang juga
`assignee_role`. **Jangan cuma SELECT kolom sebagian lalu simpulkan "tidak ada assignee" —
`assignee_role` boleh NULL padahal `assignee_user_id` terisi.** Status:
`OPEN` → `CLAIMED`/`IN_PROGRESS` → `DONE` (atau `BLOCKED`/`CANCELLED`).

```sql
SELECT id, title, description, status, priority, due_at,
       assignee_role, assignee_user_id, created_by_user_id, created_at
FROM tasks
WHERE assignee_user_id = 'usr_hana_8edff74c-500e-4e82-8c65-76d3a4cb2417'
   OR status = 'OPEN'
ORDER BY created_at DESC LIMIT 15;
```

Tutup dengan UPDATE satu baris (tidak ada thread pesan terpisah seperti `issues`):

```sql
UPDATE tasks
SET status = 'DONE',
    claimed_by_user_id = 'usr_hana_8edff74c-500e-4e82-8c65-76d3a4cb2417',
    started_at = COALESCE(started_at, '<ISO timestamp mulai kerja>'),
    finished_at = '<ISO timestamp sekarang>',
    completion_summary = '<ringkasan hasil, bahasa non-teknis>',
    completion_actions = '<apa yang diubah/dibuat, kalau relevan>',
    follow_up_needed = 0,
    updated_at = '<ISO timestamp sekarang>'
WHERE id = '<tsk_...>';
```

Set `follow_up_needed = 1` dan isi `follow_up_text` kalau ada yang masih menggantung dan
perlu perhatian Bos Cyo lagi nanti.

## Tabel lain di database yang sama (belum ada dokumentasi terpisah, sekadar peta)

`employees`, `announcements` + `announcement_reads`, `karen_threads` + `karen_messages`
(kanal chat terpisah untuk Karen — cek ini juga kalau Bos Cyo tanya "ada update dari Karen"),
`activity_log`, `work_notifications`, `work_attachments`, `work_form_submissions`,
`task_forms`/`task_items`/`task_progress`/`task_time_requirements*` (form terstruktur,
mis. "Form Sidak"), `organization_entities`/`organization_stores`, `users`, `tenants`,
`sessions`. Belum pernah didalami satu-satu — kalau Bos Cyo menyinggung sesuatu yang
kedengarannya datang dari salah satu ini, `PRAGMA table_info(<nama>)` dulu sebelum menebak
bentuk kolomnya.

## Sebelum bilang "tidak ada yang baru di Workboard"

- [ ] Sudah cek `issues` DAN `tasks`, bukan cuma satu
- [ ] Query `tasks` men-select `assignee_user_id`, bukan cuma `assignee_role`
- [ ] Tidak menyimpulkan dari artifact "Papan Leker" — itu basi
- [ ] Kalau Bos Cyo bilang "sudah kutulis" tapi belum ketemu: query ulang tanpa filter waktu
      dulu (`ORDER BY created_at DESC LIMIT 10` polos), baru curiga ke sistem lain kalau
      benar-benar tidak ada

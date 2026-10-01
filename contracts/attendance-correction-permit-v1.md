# Attendance Correction Permit v1

Status: ACTIVE for Prototype Leker (2026-10-01)

## Purpose

An employee whose check-in was recorded late for a legitimate reason (for
example the attendance web page was down) asks to change the recorded check-in
time to the time they really started. An Admin approves or rejects. On approval
the check-in time is replaced and the reason is kept permanently on the
attendance row.

## Rules

- Only while the attendance session is still `OPEN`. Salary for a session is
  written to `payroll_ledger_entries` and bridged to Accounting at check-out,
  so a correction made before check-out touches nothing that is already posted.
- A pending request whose session is no longer `OPEN` becomes `EXPIRED`
  (lazy expiry on check-out and whenever permits are listed or decided, never a
  cron). Corrections after that go through the existing Penyesuaian Gaji path.
- No Auto Permit. This affects pay, so an Admin always decides.
- The requested time must be on the same Jakarta business day, earlier than the
  recorded check-in, not before the day's `shift_start`, and the day must not
  be marked as a day off.
- One `PENDING` request per session (partial unique index). A session can be
  corrected once (`original_created_at` set). A rejected request may be
  re-submitted while the session is still open.
- Rejecting requires a note. Approval note is optional and is shown on the
  attendance card.
- Approval is one atomic batch: claim the permit, then replace the time only if
  the session is still `OPEN`, the time is unchanged since the request, and the
  claim succeeded. If the session closed in between, the permit becomes
  `EXPIRED` and nothing changes.

## Data

- `attendance_correction_permits` (migration 0129).
- `staff_attendance.created_at` stays the single check-in time every reader uses
  (lateness, payroll, raport). The original time is kept in
  `original_created_at`; `correction_permit_id`, `correction_reason`,
  `correction_decision_note` describe the correction. All nullable, no backfill.

## API

| Who | Method and path |
|---|---|
| Employee | `POST /api/staff/attendance/:id/correction-permits` `{ requestedTime: "HH:MM", reason }` |
| Employee | `GET /api/staff/attendance-correction-permits` (also in `GET /api/staff/portal`) |
| Admin | `GET /api/admin/attendance-correction-permits?status=PENDING\|APPROVED\|REJECTED\|EXPIRED\|ALL` |
| Admin | `PATCH /api/admin/attendance-correction-permits/:id` `{ decision: "ACC"\|"REJECT", note }` |

Admin routes are scoped to the store in `?store=`; a permit from another store
returns 403 `PERMIT_STORE_SCOPE_MISMATCH`.

## Laporan Permit

`GET /api/admin/permit-report` (src/permit-report.js, tab "Laporan Permit" di Admin
Gerai) membaca permit dari semua jenis, tanpa menulis apa pun: koreksi presensi,
hapus transaksi (`approval_permits`), uang kas / arus barang / aset
(`approval_requests`), dan tutup laci sebelumnya. Filter: `category`, `requester`
(karyawan pengaju), `status` (PENDING/APPROVED/REJECTED/EXPIRED), `from`/`to`
(default 30 hari terakhir, tanggal Jakarta). Permit tutup laci yang ditolak
sistem dilaporkan sebagai EXPIRED.

<!-- DOC-IMPACT: 2026-10-01 new contract; migration 0129; src/attendance-correction-permit.js; src/permit-report.js. -->

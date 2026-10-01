# Attendance GPS Radius v1

Status: ACTIVE for Prototype Leker (2026-10-01)

## Purpose

Attendance is judged against a reference GPS point per store. It is **never
rejected** because of GPS: a check-in/check-out without GPS or outside the
radius is saved and flagged red on the attendance card, and everything is
collected in an Admin report so the Admin can assess KPI manually without
digging. An employee may ask for the flag to be fixed with a permit and a
reason; the Admin approves (flag turns off, with a note) or rejects (stays red).

## Rules

- Reference point: `stores.attendance_ref_latitude/longitude`, set by the Admin
  per store (Admin store form, "Pakai lokasi saya sekarang"). Both or neither.
  Until set, an attendance that carries GPS is **not judged** (status `NULL`);
  one without GPS is still `NO_GPS`.
- Radius is a constant in `src/attendance-gps.js` (`ATTENDANCE_RADIUS_METERS =
  75`). It is never sent to employees. Employees only get the overage:
  "melebihi batas radius N meter" (`N = max(1, ceil(distance - 75))`). The
  exact distance (`distanceMeters`) is returned to Admin endpoints only.
- Statuses per point (`gps_in_*` for check-in, `gps_out_*` for check-out):
  `OK`, `NO_GPS`, `OUT_OF_RADIUS`, `NULL` (not judged / legacy rows).
  Legacy attendance rows stay `NULL` and are never flagged (no backfill).
- Red flag (`needsAttention`) = `NO_GPS` or `OUT_OF_RADIUS` and not resolved.
- Permit (`attendance_gps_permits`): `POST /api/staff/attendance/:id/gps-permits`
  `{which: IN|OUT, reason}`. Reason >= 5 chars. The point must be flagged and
  unresolved. **One request per point for life** (`UNIQUE(attendance_id,
  which)`): a rejection is final. It touches no money, so it can be filed after
  the session closes and never expires.
- Decision: `PATCH /api/admin/attendance-gps-permits/:id` `{decision: ACC|REJECT,
  note}`. Reject needs a note (>= 3 chars). ACC is one atomic batch that claims
  the permit and fills `gps_*_resolved_permit_id` + `gps_*_resolution_note`
  ("Alasan: ... · Catatan Admin: ..."); the original status is kept as the
  audit trail.
- Store scope is enforced server-side (`store_id` of the permit must equal the
  selected store).

## Reporting

- `GET /api/admin/attendance-report?store=&from=&to=&requester=` (Admin Gerai /
  Owner): per employee sessions, late count/minutes, auto-closed ("tidak tutup
  presensi"), time corrections, GPS `noGps` / `outOfRadius` / `resolved` /
  `stillRed` / pending permits, plus a detail list of flagged sessions with
  distance, permit state, reasons and Admin notes. Read-only; no automatic
  score. Reads are bounded by store + date range (index
  `idx_staff_attendance_store_created`, max 1500 sessions, 200 detail rows).
- `GET /api/admin/permit-report` has the category `ATTENDANCE_GPS` ("Perbaikan
  GPS Presensi").
- Raport facts (`facts.attendance.gps`): `noGps`, `outOfRadius`, `resolved`,
  `stillRed` counted over all of an employee's attendance.

<!-- DOC-IMPACT: 2026-10-01 new contract; migration 0130; src/attendance-gps.js; src/attendance-gps-permit.js; src/attendance-report.js; src/permit-report.js; src/staff-raport.js. -->

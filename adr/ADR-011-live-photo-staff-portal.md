# ADR-011 — Reusable Live Photo Camera and Staff Portal

Status: ACCEPTED for Prototype Leker

## Context

Prototype Leker needs live-photo capture for drawer closing and personal staff attendance. No canonical camera component or staff-attendance protocol existed on the active branch.

## Decision

1. `CameraSnapshotModal` is the only browser camera implementation. Feature modules consume its callbacks and never duplicate `getUserMedia` logic.
2. Camera streams start only after the modal opens and all tracks stop whenever it closes.
3. Captures are emitted as Blob objects and uploaded as multipart form data.
4. The existing drawer domain remains canonical for drawer closing. `POST /api/cashier/drawer/close` is extended to accept multipart Live Photo while retaining JSON compatibility.
5. Drawer-close photo remains bound to the active drawer session and requires drawer ownership.
6. Staff attendance is a separate domain at `POST /api/staff/attendance`, keyed server-side to the authenticated employee `user_id`; it has no drawer dependency.
7. `public/staff-auth-fetch.js` refreshes Authorization from sessionStorage on every cashier/staff API fetch so credentials stay tab-local.
8. Portal Staf is isolated at `/staff` with Presensi, KPI, Riwayat Setoran, and Riwayat Gaji sections. Only attendance has an active V1 write contract.
9. Photo blobs are excluded from ordinary list queries to keep UI payloads small.

## Data Impact

Migration `0015_staff_attendance_live_photo.sql` adds drawer-close photo columns and the isolated `staff_attendance` table.

## Compatibility

Sale, order, approval, and drawer state handlers are unchanged. Existing JSON drawer-close callers remain valid during rollout.

## Security

User/store identity is derived from the authenticated session. Clients cannot submit another employee ID. Attendance does not grant drawer write access.

## Documentation Impact

DOC-IMPACT: REQUIRED. `contracts/live-photo-staff-portal-v1.md` is the canonical V1 contract for reusable camera capture and staff attendance.

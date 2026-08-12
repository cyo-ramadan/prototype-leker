# Live Photo & Staff Portal Contract v1

Status: ACTIVE for Prototype Leker
Version: 1

## Camera Component

`public/camera-snapshot-modal.js` is the single canonical browser camera implementation.

- Input: `facingMode`, default `user`.
- Capture target: low-to-medium resolution, max target 640px width and JPEG quality 0.72.
- Success output: browser `Blob` via `onCaptureSuccess(blob)`.
- Permission failure output: `onPermissionDenied(error)` and a visible non-crashing instruction state.
- Camera stream may exist only while the modal is open.
- Every close path must stop every MediaStream track.
- Feature modules must not call `navigator.mediaDevices.getUserMedia` directly.

## Drawer Close

Canonical endpoint remains `POST /api/cashier/drawer/close`.

- Drawer ownership remains required.
- New camera-enabled UI submits `multipart/form-data` with `closingAmount`, optional `closingNote`, and `photo` Blob.
- JSON close requests remain accepted for backward compatibility during rollout.
- Live photo is stored on the drawer session and is not loaded into ordinary drawer list/report queries.

## Staff Attendance

Canonical endpoint: `POST /api/staff/attendance`.

- Authentication is the active cashier/staff employee session.
- Attendance `user_id` is derived server-side from the authenticated employee.
- Attendance accepts `type=in|out` plus live-photo Blob.
- Attendance does not require, open, close, inspect, or own a cash drawer.
- Attendance photos are stored separately in `staff_attendance`; portal list queries return metadata only and do not fetch photo blobs.

## Per-tab Authorization

`public/staff-auth-fetch.js` is loaded before staff/cashier application scripts.

- For same-origin `/api/cashier/*` and `/api/staff/*` requests, Authorization is refreshed from `sessionStorage.lekerCashierToken` on every fetch.
- FormData requests must not force a JSON Content-Type header.
- No localStorage auth token is used.

## Upload Guard

Server accepts JPEG, WebP, or PNG live photos up to 800 KB. Invalid/missing photos fail without mutating drawer or attendance state.

## Future Portal Domains

KPI, deposit history, and payroll are isolated portal sections. V1 exposes empty collections until their own canonical data contracts are implemented; attendance behavior does not infer those domains.

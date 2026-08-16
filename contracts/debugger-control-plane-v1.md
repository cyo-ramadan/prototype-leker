# Debugger Control Plane V1

Status: ACTIVE for Prototype Leker
Contract: `MAXI_DEBUGGER_CONTROL_PLANE_V1`

## Purpose

Debugger Control Plane memberi machine identity khusus untuk diagnostic lintas sistem tanpa login UI. Identity canonical adalah:

- `id = debugger`
- `role = DEBUGGER`
- `authType = DEBUG_TOKEN`

Debugger bukan Customer, Kasir, Admin Gerai, atau Owner. Ia tidak membuat session manusia dan tidak memakai username/password.

## Authentication

Semua endpoint Debugger berada hanya di namespace `/api/debug/*` dan memakai:

`Authorization: Bearer <DEBUG_SUPERADMIN_TOKEN>`

Secret authoritative adalah Worker secret/environment binding `DEBUG_SUPERADMIN_TOKEN`. Secret tidak boleh di-hardcode ke source, migration, documentation example, browser storage, query string, atau response API.

Jika secret belum dikonfigurasi, endpoint Debugger fail closed dengan `DEBUGGER_NOT_CONFIGURED`. Token invalid/missing fail closed dengan `DEBUGGER_AUTH_REQUIRED`.

## Authorization boundary

Debugger V1 **tidak** menjadi universal bypass untuk endpoint normal. Token Debugger tidak membuat `/api/customer/*`, `/api/cashier/*`, `/api/admin/*`, atau `/api/owner/*` menganggap caller sebagai user manusia.

Debugger hanya mempunyai authority di `/api/debug/*`.

V1 diagnostic API bersifat read-only. Method selain `GET` ditolak dengan `DEBUGGER_READ_ONLY`.

Write-capable E2E probe di masa depan harus dibuat per-module, mempunyai contract sendiri, memakai fixture/debug marker khusus, self-cleaning bila applicable, dan tidak boleh menulis business fact sebagai user nyata secara diam-diam.

## Module coverage

Registry awal meliputi:

- `DEBUGGER`
- `CORE`
- `CUSTOMER`
- `CUSTOMER_FEEDBACK`
- `STAFF_AUTH`
- `CASHIER`
- `TRANSACTIONS`
- `APPROVALS`
- `INVENTORY`
- `ACCOUNTING`
- `ACCOUNTING_SETTINGS`
- `WAREHOUSE`

Setiap module probe memeriksa required table, required columns, dan row count yang relevan. Store-scoped table dihitung pada gerai yang dipilih.

Module health adalah diagnostic schema/runtime evidence, bukan pengganti module contract atau business invariant test.

## API

- `GET /api/debug/me`
- `GET /api/debug/modules`
- `GET /api/debug/health?store=<CODE>`
- `GET /api/debug/modules/<MODULE>?store=<CODE>`
- `GET /api/debug/transactions/<REFERENCE_ID>?store=<CODE>`
- `GET /api/debug/customer-feedback/<FEEDBACK_CODE>?store=<CODE>`
- `GET /api/debug/audit?limit=<1..100>`

### Transaction trace

Transaction trace membaca reference yang sama secara read-only dari operational transaction facts, transaction correction permits, Accounting journal source references, dan Inventory stock movement source references. Query yang gagal karena schema drift dilaporkan per-source dan tidak disamarkan menjadi data kosong.

### Customer Feedback trace

Feedback trace membaca report, normalized issues, dan reward row `customer_point_ledger` untuk satu feedback code. Trace ini tidak mengklaim UI Admin/Owner sudah dibuka; ia membuktikan persistence source yang dipakai management read path.

## Audit

Setiap request Debugger yang berhasil melewati machine authentication harus menghasilkan audit row di `debugger_audit_log` yang menyimpan:

- actor `debugger`
- request id
- HTTP method/path
- module code
- store code bila ada
- result HTTP status
- result code
- timestamp

Token dan request Authorization header tidak boleh disimpan.

Jika audit row tidak dapat ditulis, diagnostic response fail closed dengan `DEBUGGER_AUDIT_UNAVAILABLE`.

## Security invariants

1. Tidak ada debug token di repository.
2. Tidak ada token di browser local/session storage.
3. Tidak ada token di URL/query params.
4. Tidak ada generic SQL execution endpoint.
5. Tidak ada arbitrary user impersonation endpoint.
6. V1 tidak melakukan operational/accounting/inventory write selain append-only Debugger audit row.
7. Existing Customer/Admin/Owner/Kasir auth semantics tetap authoritative untuk endpoint normal.
8. Rotation dilakukan dengan mengganti Worker secret tanpa mengubah identity `debugger`.

## Deployment

Migration `0036_debugger_control_plane.sql` membuat `debugger_audit_log`.

Remote schema gate wajib memverifikasi table tersebut sebelum Worker promotion. Worker dapat terdeploy tanpa nilai secret, tetapi Debugger tetap non-operational dan mengembalikan `DEBUGGER_NOT_CONFIGURED` sampai `DEBUG_SUPERADMIN_TOKEN` diset sebagai secret.

Live activation PASS memerlukan:

1. canonical Worker deployment SUCCESS;
2. secret dikonfigurasi di target Worker;
3. invalid token menghasilkan 401;
4. valid token dapat membaca `/api/debug/me`;
5. `/api/debug/health?store=G001` menghasilkan module report;
6. audit call muncul pada `/api/debug/audit` tanpa secret leakage.

## Compatibility

Debugger Control Plane tidak mengubah business formulas, Accounting posting, Inventory movement, cashier transaction, Customer Feedback entitlement, approval decision, customer session, atau management authority.

## DOC-IMPACT

**REQUIRED** — identity, secret boundary, read-only authority, module registry, audit schema, API namespace, deployment gate, and future write-probe rules are architectural contracts.
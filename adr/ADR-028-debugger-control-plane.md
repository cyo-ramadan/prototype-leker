# ADR-028 — Debugger Control Plane

Status: ACCEPTED

## Context

Prototype Leker mempunyai banyak independent auth surfaces dan business modules: Customer, Kasir, Admin Gerai, Owner, transactions, approvals, Inventory, Warehouse, Accounting, dan Customer Feedback. Debugging production dengan login manusia per-role membuat observability lambat dan dapat mencampur diagnostic activity dengan business activity.

Membuat satu token yang secara global melewati semua existing authorization akan menghasilkan permanent backdoor dengan blast radius terlalu besar.

## Decision

MAXI memakai machine principal khusus `debugger` melalui `MAXI_DEBUGGER_CONTROL_PLANE_V1`.

Principal ini authenticated oleh Worker secret `DEBUG_SUPERADMIN_TOKEN` dan hanya berlaku di namespace `/api/debug/*`. Debugger tidak menjadi Owner palsu, Customer palsu, Kasir palsu, atau Admin palsu, dan tidak membuat session manusia.

V1 adalah read-only control plane. Ia menyediakan module schema/runtime health, transaction reference tracing, Customer Feedback persistence tracing, dan audit reads. Debugger tidak menerima arbitrary SQL atau arbitrary user impersonation.

Setiap authenticated Debugger call dicatat ke append-only operational audit source `debugger_audit_log`. Secret tidak pernah disimpan ke audit.

## Module coverage

Control plane registry mencakup Core, Customer, Customer Feedback, Staff Auth, Cashier, Transactions, Approvals, Inventory/Production, Accounting, Accounting Settings, Warehouse, dan Debugger sendiri.

Module-specific write/E2E probes boleh ditambahkan kemudian hanya melalui explicit contract. Probe tersebut harus memakai debug fixture/marker, menjaga ownership module, mempunyai cleanup/idempotency policy yang jelas, dan tidak boleh memalsukan business action dari user nyata.

## Consequences

### Positive

- Diagnostic automation tidak membutuhkan login UI per role.
- Schema drift dapat terlihat lintas module dari satu control plane.
- Transaction → Accounting → Inventory reference dapat ditelusuri tanpa membuat ledger tandingan.
- Security boundary lebih kecil daripada universal auth bypass.
- Semua authenticated diagnostic access auditable.

### Constraints

- `DEBUG_SUPERADMIN_TOKEN` harus disediakan sebagai Worker secret di environment target.
- Token tidak boleh berada dalam repository atau browser.
- V1 tidak dapat menjalankan destructive remediation atau transaction write.
- Debug health bukan pengganti business tests, reconciliation, atau module contract.

## Rejected alternative

**Universal authentication bypass** ditolak. Satu bearer token yang membuat seluruh `/api/customer`, `/api/cashier`, `/api/admin`, dan `/api/owner` mempercayai caller sebagai super-user akan mengaburkan ownership dan memperbesar dampak token leakage.

## DOC-IMPACT

REQUIRED — `contracts/debugger-control-plane-v1.md`, migration `0036`, routing, schema gate, tests, and runbook form one architectural capability.
# ADR-017 — Accounting Work vs Setting Akuntansi Ownership

Status: ACCEPTED
Date: 2026-08-13

## Context

Accounting Settings UI sempat menggabungkan dua pekerjaan berbeda: maintenance akun dan konfigurasi mapping transaksi. Bos Cyo memperjelas bahwa pekerjaan Akuntansi harus dilakukan di modul Akuntansi, sedangkan Setting Akuntansi hanya mengatur hubungan transaksi operasional dengan akun.

## Decision

1. Modul **Akuntansi** owns account creation, edit/deactivation, canonical Chart of Accounts, journal work, General Ledger, trial balance, reports, closing, corrections, and posting review.
2. Kode akun dibuat otomatis oleh program Akuntansi dan harus unique menurut policy Akuntansi. User tidak mengetik kode akun manual di Setting Akuntansi.
3. **Setting Akuntansi** reads account references and owns mapping only: payment component → account, Jenis Barang → inventory/HPP/revenue accounts, transaction category → ordered Debit/Credit source rules.
4. Setting Akuntansi tidak memiliki account-maintenance UI.
5. Runtime account-maintenance routes under `/api/admin/settings/accounting/accounts...` are rejected with `ACCOUNT_MAINTENANCE_OWNED_BY_ACCOUNTING`.
6. Until the canonical Accounting account source is connected, local `chart_of_accounts` rows are treated as prototype bootstrap/reference data only, not as the long-term account-maintenance source of truth.
7. Connecting the Accounting module later should replace the account-reference source without changing the transaction-mapping UX.

## Consequences

- User intent is clearer: Akuntansi = do accounting work; Setting Akuntansi = configure mappings.
- Account-code uniqueness logic has one owner.
- Leker does not grow a second COA maintenance workflow.
- Existing mapping tables can remain because they reference account identities regardless of where those accounts are maintained.

## DOC-IMPACT

**REQUIRED** — Accounting Settings contract, UI boundary, API guard, regression test, and PR documentation must match this ADR.

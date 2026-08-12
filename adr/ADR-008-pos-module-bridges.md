# ADR-008 — POS Module Bridges and Fail-Closed Configuration

Status: ACCEPTED
Date: 2026-08-12

## Decision

Prototype Leker remains the owner of POS facts. Shared modules are consumed only through a versioned Integration Bridge/outbox: `@maxi/pos-core@1.0.0`, `@maxi/accounting@1.3.0`, and `@maxi/warehouse@2.0.0`. Their internal source and databases are not copied.

Tenant, outlet/store, terminal, shift/drawer, and warehouse IDs are distinct envelope fields. Outbox uniqueness is tenant + destination + idempotency key. POS fact and outbox creation share one D1 batch.

Accounting commands are `PENDING` only when an active mapping resolves two different active postable accounts. Warehouse commands are `PENDING` only when the POS product has an active warehouse item mapping. Otherwise the command is retained as `NEEDS_MAPPING`; no journal line or official stock movement is invented.

## Compatibility and recovery

Migration 0012 is additive and preserves all existing records and APIs. Existing sales continue to work. Roll back application code to the pre-change snapshot if necessary; use D1 Time Travel for a database recovery instead of destructive reverse SQL after external dispatch begins.

## Consequences

The POS can be wired to the shared modules without rewriting them. A dispatcher remains a separate deployment decision. Undefined tax, discount, split tender, refund/void authority, BOM, costing, and printer rules stay `NEEDS_CONFIGURATION`.


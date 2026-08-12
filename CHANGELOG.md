# Changelog

## Unreleased

- Replaced Accounting/Reports placeholders with COA, hierarchy, retained-earnings, transaction/payment mapping, warehouse item mapping, and integration readiness controls.
- Added additive POS tenant/terminal/settings/accounting/warehouse/outbox schema.
- Added tenant-scoped idempotent outbox envelopes pinned to official MAXI module versions.
- Connected sale, purchase, expense, and other-income creation to the outbox in the same database batch.
- Added fail-closed `NEEDS_MAPPING` behavior and stable mapping error codes.
- Added control matrix, runbook, recovery guidance, ADR, and integration/contract tests.


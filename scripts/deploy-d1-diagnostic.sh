#!/usr/bin/env bash
set -euo pipefail

mkdir -p public

npx --yes wrangler d1 migrations list DB --remote > public/__d1-migrations.txt
npx --yes wrangler d1 time-travel info DB --json > public/__d1-time-travel.json
npx --yes wrangler d1 execute DB --remote --command "SELECT name, type, sql FROM sqlite_schema WHERE name IN ('accounting_account_refs','transaction_accounting_mappings','transaction_accounting_snapshots','trg_stores_seed_accounting_reference_defaults') ORDER BY type, name" --json > public/__d1-accounting-legacy-schema.json
npx --yes wrangler d1 execute DB --remote --command "PRAGMA table_info(accounting_account_refs)" --json > public/__d1-account-refs-schema.json
npx --yes wrangler d1 execute DB --remote --command "PRAGMA table_info(transaction_accounting_mappings)" --json > public/__d1-mappings-schema.json
npx --yes wrangler d1 execute DB --remote --command "PRAGMA table_info(transaction_accounting_snapshots)" --json > public/__d1-snapshot-schema.json

npx --yes wrangler deploy

#!/usr/bin/env bash
set -euo pipefail

mkdir -p public

npx --yes wrangler d1 migrations list DB --remote > public/__d1-migrations.txt
npx --yes wrangler d1 execute DB --remote --command "PRAGMA table_info(transaction_accounting_snapshots)" --json > public/__d1-snapshot-schema.json
npx --yes wrangler d1 execute DB --remote --command "SELECT name, type, sql FROM sqlite_schema WHERE name IN ('transaction_accounting_snapshots','trg_stores_seed_accounting_reference_defaults')" --json > public/__d1-target-schema.json

npx --yes wrangler deploy

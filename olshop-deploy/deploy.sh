#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo '[program-olshop] provisioning/deploy pass 1'
npx wrangler deploy --yes --config wrangler.jsonc
echo '[program-olshop] applying remote D1 migrations by database name'
npx wrangler d1 migrations apply program-olshop-db --remote --config wrangler.jsonc
echo '[program-olshop] deploy pass 2'
npx wrangler deploy --yes --config wrangler.jsonc

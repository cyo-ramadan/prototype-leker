#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo '[program-olshop] provisioning/deploy pass 1'
npx wrangler deploy --config wrangler.jsonc
echo '[program-olshop] config after provisioning'
cat wrangler.jsonc
echo '[program-olshop] applying remote D1 migrations'
npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc
echo '[program-olshop] deploy pass 2'
npx wrangler deploy --config wrangler.jsonc

#!/usr/bin/env bash
set -euo pipefail
export CI=1
cd "$(dirname "$0")"
echo '[program-olshop] using existing Daily Napkin D1 prototype-leker-db'
echo '[program-olshop] applying OLShop-prefixed migrations'
yes | npx wrangler d1 migrations apply prototype-leker-db --remote --config wrangler.jsonc
echo '[program-olshop] deploying permanent Worker'
npx wrangler deploy --yes --config wrangler.jsonc

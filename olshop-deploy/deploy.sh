#!/usr/bin/env bash
set -euo pipefail
export CI=1
cd "$(dirname "$0")"
echo '[program-olshop] phase 1: deploy Worker only'
npx wrangler deploy --yes --config wrangler.jsonc

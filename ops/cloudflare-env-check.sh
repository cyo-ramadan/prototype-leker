#!/usr/bin/env bash
set -euo pipefail
HAS_API_TOKEN=false
HAS_CF_API_TOKEN=false
HAS_ACCOUNT_ID=false
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] && HAS_API_TOKEN=true
[ -n "${CF_API_TOKEN:-}" ] && HAS_CF_API_TOKEN=true
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && HAS_ACCOUNT_ID=true
cat > public/cloudflare-build-capabilities.json <<EOF
{"hasCloudflareApiToken":${HAS_API_TOKEN},"hasLegacyCfApiToken":${HAS_CF_API_TOKEN},"hasCloudflareAccountId":${HAS_ACCOUNT_ID}}
EOF
npm run db:migrations:apply
npx wrangler deploy

#!/usr/bin/env bash
set -euo pipefail
export CI=1
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
DB_NAME='program-olshop-db'
cd "$ROOT_DIR"

echo '[program-olshop] locating dedicated D1'
DB_ID="$(npx wrangler d1 list --json --config wrangler.jsonc | jq -r --arg name "$DB_NAME" '.[] | select(.name == $name) | .uuid' | head -1)"
if [ -z "$DB_ID" ]; then
  echo '[program-olshop] creating dedicated D1 in Daily Napkin'
  printf 'n\n' | npx wrangler d1 create "$DB_NAME" --location apac --config wrangler.jsonc
  DB_ID="$(npx wrangler d1 list --json --config wrangler.jsonc | jq -r --arg name "$DB_NAME" '.[] | select(.name == $name) | .uuid' | head -1)"
fi
if [ -z "$DB_ID" ]; then
  echo 'PROGRAM_OLSHOP_D1_ID_NOT_FOUND' >&2
  exit 31
fi
export DB_ID
python3 - <<'PY'
import json, os
path='olshop-deploy/wrangler.jsonc'
with open(path, encoding='utf-8') as f:
    config=json.load(f)
config['d1_databases']=[{
    'binding':'DB',
    'database_name':'program-olshop-db',
    'database_id':os.environ['DB_ID'],
    'migrations_dir':'migrations'
}]
with open(path,'w',encoding='utf-8') as f:
    json.dump(config,f,indent=2)
    f.write('\n')
PY
cd "$DEPLOY_DIR"
echo "[program-olshop] D1 ready: $DB_NAME"
echo '[program-olshop] applying remote migrations'
yes | npx wrangler d1 migrations apply "$DB_NAME" --remote --config wrangler.jsonc
echo '[program-olshop] deploying permanent Worker'
npx wrangler deploy --yes --config wrangler.jsonc

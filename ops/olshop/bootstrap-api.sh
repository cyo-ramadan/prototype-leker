#!/usr/bin/env bash
set -euo pipefail
ACCOUNT_ID='25c5fe53877002648959e8dd35678188'
DB_NAME='program-olshop-db'
API_BASE="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database"

AUTH_JSON="$(npx wrangler auth token --json)"
TOKEN="$(printf '%s' "$AUTH_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("token", ""))')"
if [ -z "$TOKEN" ]; then
  echo 'Wrangler build credential is not an API/OAuth bearer token.' >&2
  exit 1
fi
AUTH="Authorization: Bearer ${TOKEN}"

LIST_JSON="$(curl --fail-with-body -sS "${API_BASE}?name=${DB_NAME}&per_page=100" -H "$AUTH")"
DB_ID="$(printf '%s' "$LIST_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); xs=[x for x in d.get("result",[]) if x.get("name")=="program-olshop-db"]; print(xs[0].get("uuid","") if xs else "")')"

if [ -z "$DB_ID" ]; then
  CREATE_JSON="$(curl --fail-with-body -sS -X POST "$API_BASE" -H "$AUTH" -H 'Content-Type: application/json' --data '{"name":"program-olshop-db"}')"
  DB_ID="$(printf '%s' "$CREATE_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("result") or {}).get("uuid", ""))')"
fi
if [ -z "$DB_ID" ]; then
  echo 'Could not resolve created OLShop D1 UUID.' >&2
  exit 1
fi

python3 - <<'PY'
import json
for src,dst in [('ops/olshop/0001_olshop_foundation.sql','/tmp/schema.json'),('ops/olshop/0002_seed_products.sql','/tmp/seed.json')]:
    with open(src, encoding='utf-8') as f: sql=f.read()
    with open(dst,'w',encoding='utf-8') as f: json.dump({'sql':sql},f)
PY

curl --fail-with-body -sS -X POST "${API_BASE}/${DB_ID}/query" -H "$AUTH" -H 'Content-Type: application/json' --data-binary @/tmp/schema.json > /tmp/schema-result.json
curl --fail-with-body -sS -X POST "${API_BASE}/${DB_ID}/query" -H "$AUTH" -H 'Content-Type: application/json' --data-binary @/tmp/seed.json > /tmp/seed-result.json
COUNT_JSON="$(curl --fail-with-body -sS -X POST "${API_BASE}/${DB_ID}/query" -H "$AUTH" -H 'Content-Type: application/json' --data '{"sql":"SELECT COUNT(*) AS productCount FROM olshop_products;"}')"
PRODUCT_COUNT="$(printf '%s' "$COUNT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d.get("result") or []; rows=(r[0].get("results") if r else []) or []; print(rows[0].get("productCount","") if rows else "")')"
if [ "$PRODUCT_COUNT" != '20' ]; then
  echo "OLShop seed verification failed: productCount=${PRODUCT_COUNT}" >&2
  exit 1
fi

export DB_ID PRODUCT_COUNT
python3 - <<'PY'
import json,os
payload={
  'success': True,
  'account': 'Daily Napkin',
  'databaseName': 'program-olshop-db',
  'databaseId': os.environ['DB_ID'],
  'productCount': int(os.environ['PRODUCT_COUNT'])
}
with open('public/olshop-bootstrap-result.json','w',encoding='utf-8') as f:
    json.dump(payload,f,indent=2); f.write('\n')
PY

# Keep Leker runtime stable; only the sanitized verification asset is added temporarily.
npm run db:migrations:apply
npx wrangler deploy

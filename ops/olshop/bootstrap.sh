#!/usr/bin/env bash
set -euo pipefail
WRANGLER=(npx --yes wrangler@4.92.0)
"${WRANGLER[@]}" d1 execute program-olshop-db --remote --file=ops/olshop/0001_olshop_foundation.sql --yes
"${WRANGLER[@]}" d1 execute program-olshop-db --remote --file=ops/olshop/0002_seed_products.sql --yes
"${WRANGLER[@]}" d1 execute program-olshop-db --remote --command="SELECT COUNT(*) AS productCount FROM olshop_products;" --json > /tmp/olshop-count.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/olshop-count.json','utf8'));
const blocks = Array.isArray(payload) ? payload : [payload];
let count;
for (const block of blocks) {
  for (const row of (block.results || [])) {
    if (row.productCount !== undefined) count = Number(row.productCount);
  }
}
if (count !== 20) {
  console.error(`Expected 20 OLShop products, got ${count}`);
  process.exit(1);
}
console.log(`OLSHOP_D1_PRODUCT_COUNT=${count}`);
NODE
"${WRANGLER[@]}" d1 migrations apply DB --remote --yes
"${WRANGLER[@]}" deploy

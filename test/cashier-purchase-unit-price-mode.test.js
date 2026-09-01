import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const procurementUiUrl = new URL('../public/cashier-procurement-ui.js', import.meta.url);

test('purchase dialog offers a per-unit price entry mode alongside the existing total-belanja mode', async () => {
  const source = await readFile(procurementUiUrl, 'utf8');

  assert.match(source, /id="dialogPurchaseEntryMode"/, 'dialog must expose a mode selector');
  assert.match(source, /<option value="TOTAL">Isi Total Belanja Baris Ini<\/option>/);
  assert.match(source, /<option value="UNIT">Isi Harga per Satuan<\/option>/);

  assert.match(
    source,
    /id="dialogPurchaseUnitPrice"[^>]*step="any"/,
    'harga per satuan input must accept decimals (koma), not whole rupiah only'
  );

  assert.match(
    source,
    /lineTotal = Math\.round\(quantity \* unitPrice\)/,
    'UNIT mode must derive the line total from qty * harga per satuan client-side'
  );

  assert.match(
    source,
    /if \(!Number\.isFinite\(unitPrice\) \|\| unitPrice <= 0\)/,
    'harga per satuan must be validated before it is used to compute the total'
  );

  assert.match(
    source,
    /if \(!Number\.isSafeInteger\(lineTotal\) \|\| lineTotal <= 0\)/,
    'the derived total still goes through the same whole-rupiah safety check as the TOTAL mode'
  );

  // Whichever mode produced it, only the already-audited { productId, quantity, lineTotal }
  // shape ever reaches the purchase API -- the money-critical backend contract is untouched.
  assert.match(
    source,
    /items: lines\.map\(line => \(\{ productId: line\.productId, quantity: line\.quantity, lineTotal: line\.lineTotal \}\)\)/
  );
});

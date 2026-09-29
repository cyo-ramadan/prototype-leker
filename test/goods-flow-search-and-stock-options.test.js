import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const approvalActionsUi = readFileSync(new URL('../public/cashier-approval-actions.js', import.meta.url), 'utf8');
const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');

// Bos Cyo, 2026-09-22: "itu di arus barang, untuk milih barangnya harusnya
// pake search ya. terus katanya kasir/cs kirim cup sekarang ga bisa...
// cup itu masuk jenisnya ke bahan baku." Root cause found by reading
// src/db-multistore.js's listProducts: Arus Barang was reusing
// state.products, which is the Menu Kasir list filtered to
// COALESCE(t.can_sell, 1) = 1 -- Cup (bahan baku, not sold directly to a
// customer) is never in that list at all, so the cashier genuinely could
// not select it, not a UI-only complaint. Fixed by switching to the same
// stock-tracked options list Penyesuaian Stok already uses (no can_sell
// filter), plus a native <input list>/<datalist> search instead of a long
// plain dropdown.
function goodsFlowDialogBody() {
  const start = approvalActionsUi.indexOf('async function goodsFlowDialog()');
  assert.ok(start >= 0, 'goodsFlowDialog must exist and be async (it now awaits an API call before opening the dialog)');
  const end = approvalActionsUi.indexOf('function assetDialog()');
  assert.ok(end > start);
  return approvalActionsUi.slice(start, end);
}

test('Arus Barang loads the stock-tracked options list (not the can_sell-filtered Menu Kasir list), so bahan baku like Cup are selectable', () => {
  const body = goodsFlowDialogBody();
  assert.match(body, /api\('\/api\/cashier\/stock-adjustment\/options'\)/, 'must reuse the same options endpoint Penyesuaian Stok uses -- no can_sell filter');
  assert.doesNotMatch(body, /state\.products/, 'must never fall back to the Menu Kasir list again -- that is the exact regression that hid Cup');
});

test('Arus Barang picks the barang via a search field (datalist), not a long plain dropdown', () => {
  const body = goodsFlowDialogBody();
  assert.match(body, /list="approvalGoodsProductOptions"/);
  assert.match(body, /<datalist id="approvalGoodsProductOptions">/);
  assert.match(body, /placeholder="Cari barang\.\.\."/);
  assert.doesNotMatch(body, /<select id="approvalGoodsProduct"/, 'the old plain <select> for barang must be gone');
});

test('Arus Barang resolves the typed search text back to a real stock-tracked product before submitting, and rejects free text that matches nothing', () => {
  const body = goodsFlowDialogBody();
  assert.match(body, /productByName\.get\(typed\)/);
  assert.match(body, /Barang tidak ditemukan di daftar\. Pilih dari hasil pencarian\./);
  assert.match(body, /productId: product\.productId/);
});

test('cashier-approval-actions.js is versioned so the deployed Arus Barang fix bypasses stale browser cache', () => {
  assert.match(cashierHtml, /cashier-approval-actions\.js\?v=[\w.-]+/);
});

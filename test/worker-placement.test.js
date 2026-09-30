import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Tanpa placement, Worker jalan di data center terdekat pengguna. Dari
// Indonesia itu kadang wilayah yang tidak dilayani Gemini, dan Caca mati
// dengan "User location is not supported for the API use" (2026-09-30).
// Tes ini menjaga supaya baris itu tidak hilang diam-diam saat config dirapikan.
test('Worker ditempatkan di wilayah yang dilayani mesin AI Caca', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(wrangler, /"placement":\s*\{\s*"region":\s*"gcp:asia-southeast1"\s*\}/);
});

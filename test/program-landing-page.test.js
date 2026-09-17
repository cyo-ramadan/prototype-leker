import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('halaman jualan tidak menyentuh peta route aplikasi sama sekali', async () => {
  // Halaman ini numpang di Worker yang dipakai gerai sungguhan. Awalnya Hana
  // menambah baris route khusus '/program' -> '/program.html'; itu dicabut karena
  // lapisan aset sudah otomatis melayani program.html di alamat /program, jadi
  // menambah baris itu cuma menambah risiko tanpa menambah kemampuan.
  // Kalau '/' sampai tergeser, pelanggan yang mau pesan mendarat di brosur --
  // itu kerusakan produksi, bukan sekadar tes merah.
  const source = await read('src/index.js');
  const match = source.match(/const direct = \{[^}]*\};/);
  assert.ok(match, 'peta route langsung harus tetap ada di assetRoute');
  const direct = match[0];

  assert.doesNotMatch(direct, /program/, 'halaman jualan tidak boleh menitip baris di peta route aplikasi');
  assert.match(direct, /'\/': '\/customer\.html'/);
  assert.match(direct, /'\/customer': '\/customer\.html'/);
  assert.match(direct, /'\/cashier': '\/cashier\.html'/);
  assert.match(direct, /'\/staff': '\/staff\.html'/);
  assert.match(direct, /'\/admin': '\/owner\.html'/);
  assert.match(direct, /'\/owner': '\/owner\.html'/);
  assert.match(direct, /'\/entity-admin': '\/entity-admin\.html'/);
});

test('halaman jualan tidak memuat harga karangan', async () => {
  // Bos Cyo belum pernah menetapkan harga program. Agen dilarang mengarangnya,
  // dan halaman publik adalah tempat paling mahal untuk melanggar aturan itu.
  const html = await read('public/program.html');
  const angkaRupiah = html.match(/Rp\s?[\d.]{3,}/g);
  assert.equal(
    angkaRupiah,
    null,
    `halaman jualan tidak boleh memuat angka harga: ${JSON.stringify(angkaRupiah)}`
  );
  assert.match(html, /belum dipublikasikan/i, 'harga harus dinyatakan belum ditetapkan, bukan dihilangkan diam-diam');
});

test('halaman jualan tidak boleh terindeks selama masih di hostname prototype', async () => {
  // Kalau halaman ini terindeks di prototype-leker-v2.daily-napkin.workers.dev lalu
  // nanti dipindah ke domain sendiri, isinya jadi konten kembar dan dua-duanya melemah.
  const html = await read('public/program.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
});

test('halaman jualan mengarahkan ke WhatsApp, bukan ke formulir yang belum ada', async () => {
  const html = await read('public/program.html');
  const wa = html.match(/https:\/\/wa\.me\/\d+/g) || [];
  assert.ok(wa.length >= 3, 'CTA WhatsApp harus ada di beberapa titik halaman');
  assert.equal(new Set(wa).size, 1, 'semua CTA harus menuju nomor WhatsApp yang sama');
  assert.doesNotMatch(html, /<form/i, 'belum ada backend penerima formulir -- jangan pasang formulir yang tidak ke mana-mana');
});

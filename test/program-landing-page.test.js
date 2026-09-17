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
  assert.match(
    html,
    /Minta hitungan harga/i,
    'harga harus diarahkan ke chat secara terbuka, bukan dihilangkan diam-diam'
  );
});

test('hitung mundur promo memakai batas harian sungguhan, bukan timer palsu per pengunjung', async () => {
  // Bos Cyo minta hitung mundur yang berulang tiap kali waktunya habis. Cara jahat
  // yang lazim dipakai: simpan waktu mulai per pengunjung, lalu reset diam-diam
  // setiap orang datang -- deadline-nya tidak pernah ada. Calon pembeli tinggal
  // muat ulang halaman untuk membuktikannya bohong, dan yang dijual di sini justru
  // program pencatatan yang intinya kepercayaan.
  // Jadi pagar ini mengunci: hitung mundurnya ke jam tutup WIB yang sama untuk semua
  // orang, dan tidak boleh menyimpan waktu mulai apa pun di sisi pengunjung.
  const html = await read('public/program.html');

  assert.match(html, /batasJam/, 'promo harus punya jam tutup harian yang eksplisit');
  assert.match(html, /setHours\(PROMO\.batasJam, 0, 0, 0\)/, 'hitung mundur harus mengarah ke jam tutup itu');
  assert.match(html, /7 \* 3600000/, 'jam tutup harus dikunci ke WIB, bukan waktu lokal pengunjung');
  assert.match(html, /batas\.setDate\(batas\.getDate\(\) \+ 1\)/, 'lewat jamnya harus lanjut ke hari berikutnya sendiri');

  assert.doesNotMatch(
    html,
    /localStorage|sessionStorage|document\.cookie/,
    'dilarang menyimpan waktu mulai di sisi pengunjung -- itu pola timer palsu yang di-reset diam-diam'
  );
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

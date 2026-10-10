import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashCredential } from '../src/owner-auth.js';
import { handlePercetakanApi } from '../src/percetakan-api.js';
import { hitungSubtotal, normalizePhone, bolehUbahStatus, rupiahToScaled, scaledToRupiahText, orderNumber } from '../src/percetakan.js';
import { tandaTanganSah, uraiWebhookMeta } from '../src/percetakan-wa.js';
import { saringUsulan } from '../src/percetakan-una.js';
import { tebakOrder } from '../src/percetakan-tebak.js';
import { productsForStore } from '../src/percetakan.js';
import { namaFileAman } from '../percetakan-agen/agen-cetak.mjs';
import { assetRoute } from '../src/index.js';

// Bos Cyo, 2026-10-10: order percetakan dari WA jadi task (mesin + nomor antrian), dan
// orderan tidak bisa dipalsukan karyawan. ADR-055.

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  const bound = (statement, args) => ({
    _statement: statement,
    _args: args,
    async first() { return statement.get(...args) || null; },
    async all() { return { results: statement.all(...args) }; },
    async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; }
  });
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { ...bound(statement, []), bind: (...args) => bound(statement, args) };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value) { objects.set(key, value); },
    async get(key) { return objects.has(key) ? { body: objects.get(key), httpMetadata: {} } : null; }
  };
}

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_cetak', 'owner_cetak', 'x', 'Bos')`).run();
  sqlite.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_cetak', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-token'));
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id) VALUES ('kasir_cetak', 'kasir_cetak', 'x', 'Andi', 'store_cetak01')`).run();
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'kasir_cetak', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('kasir-token'));
  const env = { DB: d1(sqlite), R2_BUCKET: fakeR2() };
  return { sqlite, env };
}

async function call(env, pathname, { token = 'owner-token', method = 'GET', body, store = 'CETAK01' } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store && token === 'owner-token') url.searchParams.set('store', store);
  const response = await handlePercetakanApi(new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }), env, url.pathname);
  return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text() };
}

async function isiMaster(env) {
  assert.equal((await call(env, '/api/percetakan/machines', { method: 'POST', body: { code: 'OUTDOOR', name: 'Outdoor Banner' } })).status, 201);
  assert.equal((await call(env, '/api/percetakan/machines', { method: 'POST', body: { code: 'A3', name: 'Digital A3+' } })).status, 201);
  const setup = (await call(env, '/api/percetakan/setup')).body;
  const outdoor = setup.machines.find(machine => machine.code === 'OUTDOOR');
  const a3 = setup.machines.find(machine => machine.code === 'A3');
  assert.equal((await call(env, '/api/percetakan/products', { method: 'POST', body: { code: 'FLX280', name: 'Banner Flexi 280gr', unit: 'M2', unitPriceRupiah: '25.000', machineId: outdoor.id, keywords: 'banner, spanduk' } })).status, 201);
  assert.equal((await call(env, '/api/percetakan/products', { method: 'POST', body: { code: 'A3AP', name: 'Print A3+ Art Paper', unit: 'LEMBAR', unitPriceRupiah: 5000, machineId: a3.id } })).status, 201);
  const products = (await call(env, '/api/percetakan/setup')).body.products;
  return { outdoor, a3, flexi: products.find(p => p.code === 'FLX280'), a3ap: products.find(p => p.code === 'A3AP') };
}

test('migration membuat tenant Percetakan + gerai CETAK01 + modul PERCETAKAN terpasang', async () => {
  const { sqlite } = await setup();
  try {
    const store = sqlite.prepare("SELECT id, edition, entity_id FROM stores WHERE code = 'CETAK01'").get();
    assert.deepEqual({ ...store }, { id: 'store_cetak01', edition: 'LITE', entity_id: 'ENT-CETAK' });
    const installed = sqlite.prepare("SELECT 1 AS ok FROM tenant_module_installations WHERE tenant_id = 'TEN-CETAK' AND module_code = 'PERCETAKAN' AND effective_to IS NULL").get();
    assert.equal(installed.ok, 1);
  } finally { sqlite.close(); }
});

test('data contoh: 3 mesin dan 7 produk dengan harga referensi siap dipakai Una', async () => {
  const { sqlite, env } = await setup();
  try {
    const setup0 = (await call(env, '/api/percetakan/setup')).body;
    assert.deepEqual(setup0.machines.map(m => m.code), ['OUTDOOR', 'A3PLUS', 'DOKUMEN']);
    assert.equal(setup0.products.length, 7);
    const korcin = setup0.products.find(p => p.code === 'FLX440');
    assert.equal(korcin.unitPriceText, 'Rp28.000');
    assert.equal(korcin.machineName, 'Outdoor (banner/spanduk)');
  } finally { sqlite.close(); }
});

test('hitungan harga integer: per meter persegi, per lembar, dan pembulatan', () => {
  // Banner 3 x 1 m, 2 lembar, Rp25.000/m2 = Rp150.000
  assert.equal(scaledToRupiahText(hitungSubtotal({ unit: 'M2', unitPriceScaled: rupiahToScaled(25000), qty: 2, widthCm: 300, heightCm: 100 })), 'Rp150.000');
  assert.equal(scaledToRupiahText(hitungSubtotal({ unit: 'LEMBAR', unitPriceScaled: rupiahToScaled(5000), qty: 10 })), 'Rp50.000');
  // 33 x 33 cm @ Rp1/m2 = 0,1089 rupiah -> 108.900 unit, tanpa float
  assert.equal(hitungSubtotal({ unit: 'M2', unitPriceScaled: rupiahToScaled(1), qty: 1, widthCm: 33, heightCm: 33 }), 108_900n);
  assert.equal(rupiahToScaled('1,5'), null);
  assert.equal(normalizePhone('0812-3456-7890'), '6281234567890');
  assert.equal(orderNumber('2026-10-10', 7), 'CTK-261010-007');
});

test('status hanya maju, dan BATAL hanya untuk manajemen', () => {
  assert.equal(bolehUbahStatus('BARU', 'SIAP_CETAK', 'CASHIER').ok, true);
  assert.equal(bolehUbahStatus('DIAMBIL', 'BARU', 'OWNER').ok, false);
  assert.equal(bolehUbahStatus('SIAP_CETAK', 'BATAL', 'CASHIER').ok, false);
  assert.equal(bolehUbahStatus('SIAP_CETAK', 'BATAL', 'ADMIN').ok, true);
  assert.equal(bolehUbahStatus('DICETAK', 'BATAL', 'OWNER').ok, false);
});

test('alur penuh (mode MANUAL): chat WA (simulator) -> draft -> order dengan mesin + nomor antrian -> status -> riwayat utuh', async () => {
  const { sqlite, env } = await setup();
  try {
    const { flexi, a3ap, outdoor, a3 } = await isiMaster(env);
    assert.equal((await call(env, '/api/percetakan/settings', { method: 'POST', body: { mode: 'MANUAL' } })).status, 200);
    assert.equal((await call(env, '/api/percetakan/settings', { token: 'kasir-token', method: 'POST', body: { mode: 'OTOMATIS' } })).status, 403);

    const pesan1 = await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234567890', name: 'Pak Budi', text: 'mas cetak banner 3x1 2 lembar ya, sama A3 10 lembar' } });
    assert.equal(pesan1.status, 201);
    const pesan2 = await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234567890', fileName: 'banner.pdf', mime: 'application/pdf', fileBase64: Buffer.from('%PDF-isi').toString('base64') } });
    assert.equal(pesan2.status, 201);
    assert.ok(pesan2.body.fileId);
    const file = sqlite.prepare('SELECT status, sha256, size_bytes FROM print_files WHERE id = ?').get(pesan2.body.fileId);
    assert.equal(file.status, 'TERSIMPAN');
    assert.equal(file.size_bytes, 8);

    const inbox = (await call(env, '/api/percetakan/inbox', { token: 'kasir-token' })).body;
    assert.equal(inbox.conversations.length, 1);
    assert.equal(inbox.conversations[0].unprocessed, 2);
    assert.equal(inbox.conversations[0].messages[0].simulated, true);

    // Kasir membuat draft manual (tanpa AI), lalu mengonfirmasi rinciannya.
    const draft = await call(env, '/api/percetakan/drafts/manual', { token: 'kasir-token', method: 'POST', body: { fromNumber: '6281234567890' } });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.draft.messageIds.length, 2);
    assert.equal(draft.body.draft.proposal.customerName, 'Pak Budi');
    assert.equal((await call(env, '/api/percetakan/drafts/manual', { token: 'kasir-token', method: 'POST', body: { fromNumber: '6281234567890' } })).status, 409, 'pesan yang sama tidak bisa jadi dua draft');

    const order = await call(env, `/api/percetakan/drafts/${draft.body.draft.id}/konfirmasi`, {
      token: 'kasir-token', method: 'POST', body: {
        customerName: 'Pak Budi',
        // harga yang dikirim klien diabaikan -- harga selalu dari master
        items: [
          { productId: flexi.id, qty: 2, widthCm: 300, heightCm: 100, fileId: pesan2.body.fileId, unitPriceRupiah: 1 },
          { productId: a3ap.id, qty: 10 }
        ]
      }
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.match(order.body.orderNo, /^CTK-\d{6}-001$/);

    const detail = (await call(env, `/api/percetakan/orders/${order.body.orderId}`, { token: 'kasir-token' })).body;
    assert.equal(detail.order.totalText, 'Rp200.000');
    assert.equal(detail.order.source, 'WA');
    assert.deepEqual(detail.items.map(item => [item.machineId, item.queueNo]), [[outdoor.id, 1], [a3.id, 1]]);
    assert.equal(detail.verification.ok, true);

    // Order kedua di mesin outdoor dapat antrian 2.
    const walkin = await call(env, '/api/percetakan/orders', { token: 'kasir-token', method: 'POST', body: { customerPhone: '085700000000', items: [{ productId: flexi.id, qty: 1, widthCm: 100, heightCm: 100 }] } });
    assert.equal(walkin.status, 201);
    const antrian = (await call(env, '/api/percetakan/antrian', { token: 'kasir-token' })).body.machines;
    assert.deepEqual(antrian.find(machine => machine.machineId === outdoor.id).tickets.map(ticket => ticket.queueNo), [1, 2]);

    // Status maju, kasir tidak bisa membatalkan.
    assert.equal((await call(env, `/api/percetakan/orders/${order.body.orderId}/status`, { token: 'kasir-token', method: 'POST', body: { toStatus: 'SIAP_CETAK' } })).status, 200);
    assert.equal((await call(env, `/api/percetakan/orders/${order.body.orderId}/status`, { token: 'kasir-token', method: 'POST', body: { toStatus: 'BATAL', note: 'iseng' } })).status, 409);
    assert.equal((await call(env, `/api/percetakan/orders/${order.body.orderId}/status`, { method: 'POST', body: { toStatus: 'BATAL' } })).status, 400, 'batal wajib alasan');
    assert.equal((await call(env, `/api/percetakan/orders/${order.body.orderId}/status`, { method: 'POST', body: { toStatus: 'DICETAK' } })).status, 200);

    const after = (await call(env, `/api/percetakan/orders/${order.body.orderId}`)).body;
    assert.deepEqual(after.events.map(event => [event.seq, event.toStatus, event.actorRole]), [[1, 'BARU', 'CASHIER'], [2, 'SIAP_CETAK', 'CASHIER'], [3, 'DICETAK', 'OWNER']]);
    assert.equal(after.verification.ok, true);

    // Riwayat pelanggan dari nomor WA.
    const history = (await call(env, '/api/percetakan/orders?phone=081234567890', { token: 'kasir-token' })).body.orders;
    assert.equal(history.length, 1);
  } finally { sqlite.close(); }
});

test('anti-palsu: riwayat dan pesan WA tidak bisa diedit/dihapus, dan ubahan diam-diam ketahuan', async () => {
  const { sqlite, env } = await setup();
  try {
    const { a3ap } = await isiMaster(env);
    const order = await call(env, '/api/percetakan/orders', { token: 'kasir-token', method: 'POST', body: { customerPhone: '081111111111', items: [{ productId: a3ap.id, qty: 10 }] } });
    const orderId = order.body.orderId;

    assert.throws(() => sqlite.prepare("UPDATE print_order_events SET note = 'x' WHERE order_id = ?").run(orderId), /append-only/);
    assert.throws(() => sqlite.prepare('DELETE FROM print_order_events WHERE order_id = ?').run(orderId), /append-only/);
    assert.throws(() => sqlite.prepare('UPDATE print_order_items SET qty = 1 WHERE order_id = ?').run(orderId), /dibekukan/);
    await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081111111111', text: 'halo' } });
    assert.throws(() => sqlite.prepare("UPDATE wa_inbound_messages SET body_text = 'lain'").run(), /append-only/);
    assert.throws(() => sqlite.prepare('DELETE FROM wa_inbound_messages').run(), /append-only/);

    // Total di tabel order diubah langsung (melewati aplikasi) -> verifikasi menolak.
    sqlite.prepare('UPDATE print_orders SET total_scaled = 1000000 WHERE id = ?').run(orderId);
    const detail = (await call(env, `/api/percetakan/orders/${orderId}`)).body;
    assert.equal(detail.verification.ok, false);
    assert.match(detail.verification.problems.join(' '), /berbeda dari saat order dibuat/);
  } finally { sqlite.close(); }
});

test('isolasi gerai + skin: tenant tanpa skin G ditolak, kasir tidak bisa ubah master/simulator', async () => {
  const { sqlite, env } = await setup();
  try {
    assert.equal((await call(env, '/api/percetakan/setup', { store: 'PENDEM' })).body.code, 'SKIN_PERCETAKAN_OFF');
    assert.equal((await call(env, '/api/percetakan/machines', { token: 'kasir-token', method: 'POST', body: { code: 'X', name: 'X' } })).status, 403);
    assert.equal((await call(env, '/api/percetakan/wa/simulasi', { token: 'kasir-token', method: 'POST', body: { from: '0811', text: 'x' } })).status, 403);
    // Begitu WA sungguhan tersambung, simulator mati.
    assert.equal((await call(env, '/api/percetakan/channels', { method: 'POST', body: { phoneNumberId: '1234567890' } })).status, 201);
    assert.equal((await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234567890', text: 'x' } })).status, 409);
  } finally { sqlite.close(); }
});

test('webhook Meta: tanda tangan wajib sah, pesan + file dicatat sekali walau dikirim ulang', async () => {
  const { sqlite, env } = await setup();
  try {
    await call(env, '/api/percetakan/channels', { method: 'POST', body: { phoneNumberId: '555000', displayNumber: '0811-0000' } });
    env.WA_APP_SECRET = 'rahasia-app';
    env.WA_VERIFY_TOKEN = 'verif';
    const payload = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '555000' },
        contacts: [{ wa_id: '6281234567890', profile: { name: 'Bu Sari' } }],
        messages: [
          { id: 'wamid.1', from: '6281234567890', timestamp: '1760000000', type: 'text', text: { body: 'cetak stiker 50' } },
          { id: 'wamid.2', from: '6281234567890', timestamp: '1760000010', type: 'document', document: { id: 'media-9', mime_type: 'application/pdf', filename: 'stiker.pdf' } }
        ]
      } }] }]
    };
    const raw = JSON.stringify(payload);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('rahasia-app'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('');
    assert.equal(await tandaTanganSah(raw, signature, 'rahasia-app'), true);
    assert.equal(uraiWebhookMeta(payload)[1].fileName, 'stiker.pdf');

    const post = sig => handlePercetakanApi(new Request('https://example.test/api/percetakan/wa/webhook', {
      method: 'POST', headers: { 'x-hub-signature-256': sig, 'content-type': 'application/json' }, body: raw
    }), env, '/api/percetakan/wa/webhook');

    assert.equal((await post('sha256=salah')).status, 401);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM wa_inbound_messages').get().n, 0);
    // Token WA belum dipasang: pesan tetap tercatat, file ditandai GAGAL (bisa diambil ulang).
    assert.equal((await post(signature)).status, 200);
    assert.equal((await post(signature)).status, 200);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM wa_inbound_messages').get().n, 2);
    assert.equal(sqlite.prepare("SELECT from_name FROM wa_inbound_messages WHERE provider_message_id = 'wamid.1'").get().from_name, 'Bu Sari');
    assert.equal(sqlite.prepare('SELECT status FROM print_files').get().status, 'GAGAL');

    const verify = await handlePercetakanApi(new Request('https://example.test/api/percetakan/wa/webhook?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=abc'), env, '/api/percetakan/wa/webhook');
    assert.equal(await verify.text(), 'abc');
  } finally { sqlite.close(); }
});

test('Una: kode produk asing dan ukuran kosong jadi pertanyaan, bukan tebakan', () => {
  const products = [
    { id: 'p1', code: 'FLX280', name: 'Banner Flexi', unit: 'M2' },
    { id: 'p2', code: 'A3AP', name: 'Print A3+', unit: 'LEMBAR' }
  ];
  const messages = [{ id: 'm1' }, { id: 'm2' }];
  const result = saringUsulan({
    namaPelanggan: 'Budi', tenggat: 'besok',
    items: [
      { kodeProduk: 'flx280', jumlah: 2, lebarCm: 0, tinggiCm: 0, idPesanFile: 'm2', catatan: '' },
      { kodeProduk: 'A3AP', jumlah: 10, lebarCm: 0, tinggiCm: 0, idPesanFile: 'pesan-palsu', catatan: '' },
      { kodeProduk: 'MUG', jumlah: 3, lebarCm: 0, tinggiCm: 0, idPesanFile: '', catatan: 'mug foto' }
    ],
    pertanyaan: []
  }, { products, messages, filesByMessageId: new Map([['m2', 'f2']]) });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].fileId, 'f2');
  assert.equal(result.items[1].fileId, null);
  assert.equal(result.questions.length, 2);
  assert.match(result.questions.join(' '), /ukurannya/);
  assert.match(result.questions.join(' '), /mug foto/);
});

test('layar /s/<KODE>/cetak membuka halaman Percetakan', () => {
  assert.equal(assetRoute('/s/CETAK01/cetak'), '/percetakan');
});

const contoh = JSON.parse(readFileSync(new URL('../una-latih/percetakan-chat-contoh.json', import.meta.url), 'utf8'));
const pdf = name => ({ fileName: name, mime: 'application/pdf', fileBase64: Buffer.from(`%PDF ${name}`).toString('base64') });

test('pembaca aturan: 26 contoh chat terbaca sesuai jawaban (lengkap -> rincian persis; ragu -> tidak otomatis)', async () => {
  const { sqlite, env } = await setup();
  try {
    const products = await productsForStore(env.DB, 'store_cetak01');
    const byId = new Map(products.map(p => [p.id, p.code]));
    for (const chat of contoh.chat) {
      const messages = chat.pesan.map((p, i) => ({ id: `m${i}`, body_text: p.teks || '', file_id: p.file ? `f${i}` : null, media_file_name: p.file || '', from_name: chat.nama }));
      const fileIds = messages.filter(m => m.file_id).map(m => m.file_id);
      const hasil = tebakOrder(messages, products);
      assert.equal(hasil.complete, chat.lengkap, `chat ${chat.id}: ${hasil.questions.join(' | ')}`);
      if (chat.lengkap) {
        assert.deepEqual(
          hasil.items.map(i => [byId.get(i.productId), i.qty, i.widthCm, i.heightCm, i.fileId]),
          chat.item.map(i => [i.kode, i.qty, i.lebar ?? null, i.tinggi ?? null, fileIds[i.file]]),
          `chat ${chat.id}`
        );
      }
      if (chat.namaTebakan) assert.equal(hasil.customerName, chat.namaTebakan);
    }
  } finally { sqlite.close(); }
});

test('mode OTOMATIS: teks + file dari WA langsung jadi order dan task antrian tanpa ditekan karyawan', async () => {
  const { sqlite, env } = await setup();
  try {
    // Teks dulu: file belum ada -> belum jadi order.
    const teks = await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234500001', name: 'Toko Makmur', text: 'spanduk 5x1 dan brosur a3 100 lembar' } });
    assert.equal(teks.body.otomatis.reason, 'BELUM_LENGKAP');
    await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234500001', ...pdf('brosur.pdf') } });
    const terakhir = await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234500001', ...pdf('spanduk.pdf') } });
    const created = terakhir.body.otomatis.created;
    assert.ok(created, JSON.stringify(terakhir.body.otomatis));

    const detail = (await call(env, `/api/percetakan/orders/${created.orderId}`, { token: 'kasir-token' })).body;
    assert.equal(detail.order.automatic, true);
    assert.equal(detail.order.status, 'BARU');
    assert.equal(detail.order.customerName, 'Toko Makmur');
    // spanduk 5x1 m @ Rp22.000 = 110.000; brosur 100 x Rp6.000 = 600.000
    assert.equal(detail.order.totalText, 'Rp710.000');
    assert.deepEqual(detail.items.map(i => [i.productName, i.machineName, i.queueNo]), [
      ['Banner Flexi 280gr', 'Outdoor (banner/spanduk)', 1],
      ['Print A3+ Art Paper', 'Digital A3+ (poster/stiker/kartu nama)', 1]
    ]);
    assert.equal(detail.events[0].actorRole, 'SYSTEM');
    assert.equal(detail.verification.ok, true);

    // Pesan lanjutan tidak membuat order kembar; chat yang ragu tidak jadi order.
    await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234500001', text: 'makasih kak' } });
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM print_orders').get().n, 1);
    const ragu = await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234500002', text: 'mas mau pesan mug foto 3 biji', ...pdf('mug.pdf') } });
    assert.equal(ragu.body.otomatis.reason, 'BELUM_LENGKAP');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM print_orders').get().n, 1);
  } finally { sqlite.close(); }
});

test('mode LANGSUNG_CETAK + agen cetak: file sampai ke mesin, order jadi Dicetak atas nama mesin', async () => {
  const { sqlite, env } = await setup();
  try {
    assert.equal((await call(env, '/api/percetakan/settings', { method: 'POST', body: { mode: 'LANGSUNG_CETAK' } })).status, 200);
    const setup0 = (await call(env, '/api/percetakan/setup')).body;
    const outdoor = setup0.machines.find(m => m.code === 'OUTDOOR');
    const a3 = setup0.machines.find(m => m.code === 'A3PLUS');
    const kunci = (await call(env, `/api/percetakan/machines/${outdoor.id}/kunci`, { method: 'POST' })).body.key;
    const kunciA3 = (await call(env, `/api/percetakan/machines/${a3.id}/kunci`, { method: 'POST' })).body.key;
    assert.match(kunci, /^mesin_[0-9a-f]{48}$/);
    assert.equal((await call(env, `/api/percetakan/machines/${outdoor.id}/kunci`, { token: 'kasir-token', method: 'POST' })).status, 403);

    const hasil = await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '081234500003', text: 'banner korcin 2x1 3 lembar', ...pdf('backdrop.pdf') } });
    const orderId = hasil.body.otomatis.created.orderId;

    const agen = (path, key, method = 'GET') => handlePercetakanApi(new Request(`https://example.test${path}`, { method, headers: { Authorization: `Bearer ${key}` } }), env, path);
    assert.equal((await agen('/api/percetakan/agen/tugas', 'mesin_salah')).status, 401);
    const tugas = await (await agen('/api/percetakan/agen/tugas', kunci)).json();
    assert.equal(tugas.tasks.length, 1);
    assert.equal(tugas.tasks[0].qty, 3);
    assert.equal(namaFileAman(tugas.tasks[0]), `${tugas.tasks[0].orderNo}_antrian-1_3x_backdrop.pdf`);
    const ticketId = tugas.tasks[0].ticketId;

    // Mesin lain tidak bisa mengambil tugas mesin ini.
    assert.equal((await agen(`/api/percetakan/agen/tugas/${ticketId}/file`, kunciA3)).status, 404);
    assert.equal((await (await agen('/api/percetakan/agen/tugas', kunciA3)).json()).tasks.length, 0);

    assert.equal((await agen(`/api/percetakan/agen/tugas/${ticketId}/file`, kunci)).status, 200);
    assert.equal((await agen(`/api/percetakan/agen/tugas/${ticketId}/terkirim`, kunci, 'POST')).status, 200);
    assert.equal((await (await agen('/api/percetakan/agen/tugas', kunci)).json()).tasks.length, 0);

    const detail = (await call(env, `/api/percetakan/orders/${orderId}`)).body;
    assert.equal(detail.order.status, 'DICETAK');
    assert.deepEqual(detail.events.map(e => [e.eventType, e.toStatus, e.actorRole]), [
      ['DIBUAT', 'BARU', 'SYSTEM'],
      ['STATUS', 'SIAP_CETAK', 'SYSTEM'],
      ['DIKIRIM_KE_MESIN', 'SIAP_CETAK', 'MESIN'],
      ['STATUS', 'DICETAK', 'MESIN']
    ]);
    assert.equal(detail.verification.ok, true);

    // Kunci baru mematikan kunci lama.
    await call(env, `/api/percetakan/machines/${outdoor.id}/kunci`, { method: 'POST' });
    assert.equal((await agen('/api/percetakan/agen/tugas', kunci)).status, 401);
  } finally { sqlite.close(); }
});

test('skin G = saklar on/off: tenant mana pun bisa memakai, dan mematikannya menutup layar, webhook, dan agen', async () => {
  const { sqlite, env } = await setup();
  const skin = (tenant, value) => sqlite.prepare(`
    INSERT INTO tenant_policy_settings (tenant_id, setting_key, setting_value) VALUES (?, 'ui_skin', ?)
    ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value
  `).run(tenant, value);
  try {
    // Migration 0147: tenant Percetakan memakai G sejak awal.
    assert.equal(sqlite.prepare("SELECT setting_value FROM tenant_policy_settings WHERE tenant_id = 'TEN-CETAK' AND setting_key = 'ui_skin'").get().setting_value, 'G');

    // Tenant Leker belum memilih G -> tidak merasakan apa pun; begitu memilih G -> fitur hidup di gerainya.
    const pendem = sqlite.prepare("SELECT et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL WHERE s.code = 'PENDEM'").get().tenant_id;
    assert.equal((await call(env, '/api/percetakan/setup', { store: 'PENDEM' })).status, 403);
    skin(pendem, 'G');
    const lekerSetup = await call(env, '/api/percetakan/setup', { store: 'PENDEM' });
    assert.equal(lekerSetup.status, 200);
    assert.equal(lekerSetup.body.machines.length, 0, 'data contoh CETAK01 tidak bocor ke gerai lain');
    skin(pendem, '0');

    // Siapkan WA + agen di CETAK01, lalu matikan skin G.
    await call(env, '/api/percetakan/channels', { method: 'POST', body: { phoneNumberId: '777000' } });
    const outdoor = (await call(env, '/api/percetakan/setup')).body.machines.find(m => m.code === 'OUTDOOR');
    const kunci = (await call(env, `/api/percetakan/machines/${outdoor.id}/kunci`, { method: 'POST' })).body.key;
    skin('TEN-CETAK', 'F');

    assert.equal((await call(env, '/api/percetakan/setup')).body.code, 'SKIN_PERCETAKAN_OFF');
    assert.equal((await call(env, '/api/percetakan/antrian', { token: 'kasir-token' })).status, 403);
    const agen = await handlePercetakanApi(new Request('https://example.test/api/percetakan/agen/tugas', { headers: { Authorization: `Bearer ${kunci}` } }), env, '/api/percetakan/agen/tugas');
    assert.equal(agen.status, 401);

    env.WA_APP_SECRET = 'rahasia';
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '777000' }, messages: [{ id: 'wamid.off', from: '6281200000000', timestamp: '1760000000', type: 'text', text: { body: 'banner 3x1' } }] } }] }] });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('rahasia'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = 'sha256=' + [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const hook = await handlePercetakanApi(new Request('https://example.test/api/percetakan/wa/webhook', { method: 'POST', headers: { 'x-hub-signature-256': sig }, body: raw }), env, '/api/percetakan/wa/webhook');
    assert.equal(hook.status, 200);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM wa_inbound_messages').get().n, 0, 'skin mati: pesan WA tidak dicatat');

    // Dinyalakan lagi: semuanya kembali, data lama utuh.
    skin('TEN-CETAK', 'G');
    assert.equal((await call(env, '/api/percetakan/setup')).status, 200);
  } finally { sqlite.close(); }
});

test('Twilio WhatsApp: tanda tangan wajib sah, chat + file dari HP jadi order otomatis, pesan ulang tidak dobel', async () => {
  const { sqlite, env } = await setup();
  const realFetch = globalThis.fetch;
  try {
    env.TWILIO_ACCOUNT_SID = 'AC123';
    env.TWILIO_AUTH_TOKEN = 'token-twilio';
    assert.equal((await call(env, '/api/percetakan/channels', { method: 'POST', body: { provider: 'TWILIO', phoneNumberId: '+1 415 523 8886', displayNumber: 'Sandbox' } })).status, 201);
    // Saluran sungguhan aktif -> simulator mati.
    assert.equal((await call(env, '/api/percetakan/wa/simulasi', { method: 'POST', body: { from: '0812', text: 'x' } })).status, 409);

    const url = 'https://example.test/api/percetakan/wa/twilio';
    const sign = async params => {
      const data = url + [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + v).join('');
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('token-twilio'), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
      return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))));
    };
    const kirim = async (fields, signature) => {
      const params = new URLSearchParams({ AccountSid: 'AC123', From: 'whatsapp:+6281234567890', To: 'whatsapp:+14155238886', WaId: '6281234567890', ProfileName: 'Pak Budi', NumMedia: '0', ...fields });
      return handlePercetakanApi(new Request(url, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature ?? await sign(params) }, body: params.toString()
      }), env, '/api/percetakan/wa/twilio');
    };
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM2/Media/ME1');
      assert.equal(init.headers.Authorization, `Basic ${btoa('AC123:token-twilio')}`);
      return new Response('%PDF-banner', { headers: { 'content-type': 'application/pdf' } });
    };

    assert.equal((await kirim({ MessageSid: 'SM1', Body: 'mas cetak banner 3x1 2 lembar ya' }, 'salah')).status, 401);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM wa_inbound_messages').get().n, 0);

    const pertama = await kirim({ MessageSid: 'SM1', Body: 'mas cetak banner 3x1 2 lembar ya' });
    assert.equal(pertama.status, 200);
    assert.match(await pertama.text(), /<Response><\/Response>/);
    await kirim({ MessageSid: 'MM2', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM2/Media/ME1', MediaContentType0: 'application/pdf' });
    await kirim({ MessageSid: 'MM2', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM2/Media/ME1', MediaContentType0: 'application/pdf' });

    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM wa_inbound_messages').get().n, 2, 'pesan dikirim ulang Twilio tidak dobel');
    assert.equal(sqlite.prepare('SELECT status FROM print_files').get().status, 'TERSIMPAN');
    const orders = (await call(env, '/api/percetakan/orders?phone=081234567890', { token: 'kasir-token' })).body.orders;
    assert.equal(orders.length, 1);
    assert.equal(orders[0].automatic, true);
    assert.equal(orders[0].customerName, 'Pak Budi');
    assert.equal(orders[0].totalText, 'Rp132.000'); // 3x1 m x 2 @ Rp22.000
  } finally {
    globalThis.fetch = realFetch;
    sqlite.close();
  }
});

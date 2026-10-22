import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, unlinkSync, createReadStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Archive } from './store.mjs';
import { Connection } from './connection.mjs';
import { Jembatan, bacaKonfigurasi } from './jembatan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const safeEqual = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createApp(archive, connection, token) {
  const session = randomBytes(32).toString('hex');
  const clients = new Set();
  connection.changed = () => { for (const response of clients) response.write('event: refresh\ndata: {}\n\n'); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const expected = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expected) return json(403, { error: 'Host ditolak. Gunakan 127.0.0.1.' });
      const url = new URL(req.url, `http://${expected}`);
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
        return res.end(readFileSync(join(here, 'public', file)));
      }
      if (req.method !== 'GET') {
        if (req.headers.origin !== `http://${expected}` || req.headers['content-type'] !== 'application/json') return json(403, { error: 'Asal permintaan ditolak' });
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1024) return json(413, { error: 'Terlalu besar' }); }
        if (!safeEqual(JSON.parse(body).token, token)) return json(401, { error: 'Kunci akses salah' });
        res.setHeader('Set-Cookie', `gateway=${session}; HttpOnly; SameSite=Strict; Path=/`);
        return json(200, { ok: true });
      }
      const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('gateway='))?.slice(8);
      if (!safeEqual(cookie, session)) return json(401, { error: 'Masuk dahulu' });
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        res.write('event: refresh\ndata: {}\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const status = connection.snapshot();
        if (status.qr) status.qr = await (await import('qrcode')).default.toDataURL(status.qr);
        return json(200, status);
      }
      if (req.method === 'GET' && ['/api/messages', '/api/export'].includes(url.pathname)) {
        const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(before) || before < 1) return json(400, { error: 'Halaman tidak valid' });
        if (url.pathname === '/api/export') res.setHeader('Content-Disposition', 'attachment; filename="pesan-wa.json"');
        return json(200, { tenant: archive.tenant, messages: archive.list(before) });
      }
      const media = url.pathname.match(/^\/api\/media\/([1-9][0-9]*)$/);
      if (req.method === 'GET' && media) {
        const row = archive.get(Number(media[1]));
        if (!row || row.media_status !== 'SAVED') return json(404, { error: 'Lampiran belum tersedia' });
        const path = join(archive.dir, 'media', `${row.seq}.bin`);
        if (!existsSync(path)) return json(404, { error: 'Berkas hilang dari disk' });
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="lampiran-${row.seq}.bin"; filename*=UTF-8''${encodeURIComponent(row.filename || `lampiran-${row.seq}.bin`).replace(/'/g, '%27')}`);
        const stream = createReadStream(path); stream.on('error', () => res.destroy()); stream.pipe(res); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/connect') { await connection.start(); return json(200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/stop') { connection.stop(); return json(200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/reset-session') { connection.stop(); archive.db.exec('DELETE FROM auth'); return json(200, { ok: true }); }
      const retry = url.pathname.match(/^\/api\/retry\/([1-9][0-9]*)$/);
      if (req.method === 'POST' && retry) {
        const row = archive.get(Number(retry[1]));
        if (connection.state !== 'CONNECTED') return json(409, { error: 'Sambungkan WA dahulu' });
        if (!row || row.media_status !== 'FAILED') return json(409, { error: 'Lampiran tidak dapat dicoba ulang' });
        archive.media(row.seq, 'PENDING'); void connection.drain(); return json(200, { ok: true });
      }
      return json(404, { error: 'Tidak tersedia' });
    } catch { if (!res.headersSent) json(400, { error: 'Permintaan gagal diproses' }); else res.destroy(); }
  });
  server.closeClients = () => { for (const response of clients) response.end(); clients.clear(); };
  return server;
}

export function acquireLock(dir) {
  const path = join(dir, 'gateway.lock');
  try { writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Lock rusak; periksa proses sebelum menghapus gateway.lock');
    try { process.kill(pid, 0); }
    catch (e) { if (e.code === 'ESRCH') { unlinkSync(path); return acquireLock(dir); } throw e; }
    throw new Error('Gateway tenant ini masih berjalan');
  }
  return () => { if (readFileSync(path, 'utf8') === String(process.pid)) unlinkSync(path); };
}

async function main() {
  const archive = new Archive(join(here, 'data'), process.env.WA_TENANT || 'cetak01');
  const unlock = acquireLock(archive.dir);
  const tokenPath = join(archive.dir, 'admin.token');
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  const token = readFileSync(tokenPath, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Kunci akses lokal rusak');
  const connection = new Connection(archive);
  const server = createApp(archive, connection, token);
  // Jembatan ke Fina (opsional): aktif bila WA_SERVER + data/<tenant>/fina.token diisi.
  const konfigurasi = bacaKonfigurasi(archive);
  const jembatan = konfigurasi.aktif ? new Jembatan({ archive, connection, server: konfigurasi.server, token: konfigurasi.token, log: pesan => console.log(pesan) }) : null;
  const port = Number(process.env.WA_PORT || 8788);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port harus 1024-65535');
  server.on('error', () => { console.error('Port tidak tersedia. Hentikan gateway lain atau ganti WA_PORT.'); unlock(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Gateway lokal: http://127.0.0.1:${port}\nTenant: ${archive.tenant}\nKunci masuk ada di ${tokenPath}\n${jembatan ? `Jembatan Fina: aktif ke ${konfigurasi.server} (meneruskan pesan masuk; mengirim hanya pesan yang disetujui Admin).` : `Mode: menerima pesan saja (${konfigurasi.alasan}).`} Tidak ada jaminan bebas ban.`);
    jembatan?.mulai();
    if (process.env.WA_AUTOCONNECT === '1' && archive.authGet('creds')) void connection.start();
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return; closing = true; jembatan?.berhenti(); connection.stop(); server.closeClients(); server.close();
    while (connection.downloading) await new Promise(resolve => setTimeout(resolve, 100));
    archive.close(); unlock();
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Gateway gagal dimulai:', error.code || error.name, error.message, error.resource || ''); process.exitCode = 1; });
}

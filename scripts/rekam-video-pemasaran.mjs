// Rekam video pemasaran 9:16 dari aplikasi sungguhan (server lokal, data fiktif
// "Kedai Senja" dari scripts/demo-kedai-senja-lokal.mjs). Lihat pemasaran/README.md.
//   LAB_PEMILIK_PASSWORD=... node scripts/rekam-video-pemasaran.mjs <folder-keluaran> [1|2|4]
// Hasilnya .webm 360x640; ubah ke mp4 1080x1920 dengan perintah ffmpeg di README.
// Playwright: env PLAYWRIGHT_MODULE bila tidak terpasang sebagai paket biasa.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { renameSync, mkdirSync } from 'node:fs';
const B = process.env.DEMO_BASE_URL || 'http://127.0.0.1:8787'; const SP = process.argv[2]; const only = process.argv[3];
if (!SP) throw new Error('Folder keluaran wajib diisi.');
mkdirSync(`${SP}/video/raw`, { recursive: true });
const pw = process.env.LAB_PEMILIK_PASSWORD;
if (!pw) throw new Error('Isi LAB_PEMILIK_PASSWORD (akun lab_pemilik di database LOKAL).');
const login = async () => (await (await fetch(`${B}/api/entity-admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'lab_pemilik', password: pw }) })).json());
const wait = ms => new Promise(r => setTimeout(r, ms));
const OVERLAY = `
  window.__ov = {
    style() { if (document.getElementById('ovs')) return; const s = document.createElement('style'); s.id = 'ovs'; s.textContent = \`
      #ovcap{position:fixed;left:12px;right:12px;top:12px;z-index:2147483647;background:#13211b;color:#fff;font:800 20px/1.2 system-ui,sans-serif;padding:12px 14px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .3s}
      #ovcap small{display:block;font:600 15px/1.3 system-ui,sans-serif;color:#cfe8dc;margin-top:4px}
      #ovcard{position:fixed;inset:0;z-index:2147483647;background:#13211b;color:#fff;display:grid;place-content:center;padding:28px;text-align:left;font-family:system-ui,sans-serif}
      #ovcard h1{font:800 34px/1.08 system-ui,sans-serif;letter-spacing:-.03em;margin:0}
      #ovcard p{font:600 19px/1.4 system-ui,sans-serif;color:#cfe8dc;margin:18px 0 0}
      #ovcard .brand{display:flex;align-items:center;gap:10px;font:800 20px system-ui;margin-bottom:28px}
      #ovcard .brand i{width:28px;height:28px;border-radius:8px;background:#0e6b4c;display:inline-block}
      #ovcard .wa{margin-top:26px;background:#fff;color:#13211b;border-radius:16px;padding:16px 18px;font:800 22px system-ui}
      #cacaFab,#workspaceSwitcherBtn{display:none!important}
      .ovhl{outline:4px solid #f2b705!important;outline-offset:3px;border-radius:12px}\`; document.head.appendChild(s); },
    cap(t, sub) { this.style(); let c = document.getElementById('ovcap'); if (!c) { c = document.createElement('div'); c.id = 'ovcap'; document.body.appendChild(c); } c.innerHTML = t + (sub ? '<small>' + sub + '</small>' : ''); c.style.opacity = 1; },
    nocap() { document.getElementById('ovcap')?.remove(); },
    card(h, p, wa) { this.style(); this.nocard(); const d = document.createElement('div'); d.id = 'ovcard'; d.innerHTML = '<div class="brand"><i></i>OwnerTenang</div><h1>' + h + '</h1>' + (p ? '<p>' + p + '</p>' : '') + (wa ? '<div class="wa">' + wa + '</div>' : ''); document.body.appendChild(d); },
    nocard() { document.getElementById('ovcard')?.remove(); },
    hl(sel) { document.querySelectorAll('.ovhl').forEach(n => n.classList.remove('ovhl')); const n = typeof sel === 'string' ? document.querySelector(sel) : sel; if (n) { n.classList.add('ovhl'); n.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
  };`;
async function record(name, fn) {
  const b = await chromium.launch();
  const a = await login();
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, timezoneId: 'Asia/Jakarta', locale: 'id-ID', recordVideo: { dir: `${SP}/video/raw`, size: { width: 360, height: 640 } } });
  await ctx.addInitScript(OVERLAY);
  await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => window.__ov.style()));
  await ctx.addInitScript(a => { localStorage.setItem('lekerEntityAdminToken', a.token); localStorage.setItem('maxiUiSkinEntity', a.entityAdmin.entityId); localStorage.setItem('lekerStaffSessionMeta', JSON.stringify({ id: a.entityAdmin.id, role: 'ENTITY_ADMIN', name: 'x', storeCode: '' })); }, a);
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log(name, 'ERR', e.message));
  await fn(p);
  const v = p.video(); await ctx.close(); await b.close();
  renameSync(await v.path(), `${SP}/video/${name}.webm`);
  console.log('ok', name);
}
const ov = (p, js) => p.evaluate(js);
const OUTRO = ["window.__ov.card('Lihat sendiri dalam 15 menit.', 'Untuk pemilik 2–10 gerai F&amp;B.', 'Ketik DEMO di WhatsApp<br>0858-6007-0439')"];

// Video 1: absen bohong
if (!only || only === '1') await record('01-absen-merah', async p => {
  await p.goto(`${B}/s/LAB02/admin`); await ov(p, "window.__ov.card('Karyawan bilang sudah di gerai jam 8.', 'Benarkah?')");
  await wait(3200);
  await p.evaluate(() => window.MaxiNav?.open('attendance-report')); await wait(1500);
  await ov(p, "window.__ov.nocard(); window.__ov.cap('Laporan absen gerai Sukun', 'Foto langsung + lokasi setiap absen')"); await wait(3000);
  const red = await p.evaluateHandle(() => [...document.querySelectorAll('#tab-attendance-report *')].find(n => n.children.length === 0 && /melebihi batas radius/.test(n.textContent))?.closest('.master-row, article, div'));
  await ov(p, "window.__ov.cap('Rina absen 412 meter dari gerai', 'Kartunya merah. Jaraknya kelihatan.')");
  await p.evaluate(n => window.__ov.hl(n), red); await wait(5000);
  await ov(p, "window.__ov.cap('Absen bohong, ketahuan.', 'Rina tetap bisa mengajukan alasan. Anda yang memutuskan.')"); await wait(4000);
  await ov(p, OUTRO[0]); await wait(3500);
});

// Video 2: hapus struk diam-diam
if (!only || only === '2') await record('02-hapus-struk', async p => {
  await p.goto(`${B}/s/LAB01/admin`); await ov(p, "window.__ov.card('Transaksi Rp85 ribu hilang dari kasir?', 'Kasir tidak bisa menghapus sendiri.')");
  await wait(3200);
  await ov(p, "window.__ov.nocard(); window.__ov.cap('Pemilik membuka HP', 'Halaman Hari ini, gerai Dinoyo')"); await wait(2500);
  await ov(p, "window.__ov.hl('#maxiTodayHome .th-need')"); await ov(p, "window.__ov.cap('Dimas minta hapus struk', 'Tidak terhapus sebelum Anda putuskan')"); await wait(3500);
  await p.click('#maxiTodayHome .th-need button'); await wait(1800);
  const card = await p.evaluateHandle(() => document.querySelector('[data-void-permit-reject]')?.closest('.admin-card'));
  await p.evaluate(n => window.__ov.hl(n), card); await ov(p, "window.__ov.cap('Rp85.000, alasan: salah input menu', 'Anda ketuk Tolak')"); await wait(3500);
  p.once('dialog', d => d.accept());
  await p.click('[data-void-permit-reject]'); await wait(2200);
  await ov(p, "window.__ov.cap('Tidak bisa dihapus diam-diam.', 'Struk tetap ada. Semua tercatat: siapa, kapan, alasannya.')"); await wait(4000);
  await ov(p, OUTRO[0]); await wait(3500);
});

// Video 4: untung semua gerai
if (!only || only === '4') await record('04-untung-semua-gerai', async p => {
  await p.goto(`${B}/entity-admin`); await ov(p, "window.__ov.card('Ramai terus, tapi untungnya mana?', '4 gerai. Mana yang untung, mana yang rugi?')");
  await wait(3500);
  await ov(p, "window.__ov.nocard()");
  await p.click('[data-nav-group="reports"]'); await wait(800);
  await p.evaluate(() => { const f = document.querySelector('#entityReportFrom'); const d = new Date(Date.now() + 7 * 3600e3 - 6 * 864e5).toISOString().slice(0, 10); if (f) { f.value = d; f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true })); } });
  await ov(p, "window.__ov.nocard(); window.__ov.cap('Laporan 7 hari, semua gerai', 'Sudah dikurangi bahan, biaya, dan gaji')");
  await p.locator('button', { hasText: 'Tampilkan Laporan' }).first().click(); await wait(2500);
  const chart = await p.evaluateHandle(() => [...document.querySelectorAll('h2, h3')].find(h => /Perbandingan Gerai/.test(h.textContent))?.closest('.admin-card'));
  await p.evaluate(n => n && n.scrollIntoView({ block: 'start' }), chart); await wait(800);
  await ov(p, "window.__ov.cap('Hijau untung, merah rugi', 'Batu rugi tiap hari, Dinoyo paling untung')"); await wait(5500);
  await ov(p, "window.__ov.cap('Satu layar, semua gerai.', 'Dari HP, tanpa datang satu-satu')"); await wait(3500);
  await ov(p, OUTRO[0]); await wait(3500);
});

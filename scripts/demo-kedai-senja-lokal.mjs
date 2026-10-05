// Data demo FIKTIF "Kedai Senja" (tenant Lab, 4 gerai) -- HANYA ke database LOKAL
// milik `wrangler dev --local`, TIDAK PERNAH ke D1 produksi. Dipakai untuk merekam
// video pemasaran (scripts/rekam-video-pemasaran.mjs, pemasaran/README.md).
// Jalankan ulang sebelum setiap rekaman (video 2 menolak permintaan hapus struk).
//   node scripts/demo-kedai-senja-lokal.mjs
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
const dir = new URL('../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/', import.meta.url);
const file = readdirSync(dir).find(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
if (!file) throw new Error('Database lokal belum ada. Jalankan `npx wrangler dev --local` sekali dulu.');
const db = new DatabaseSync(new URL(file, dir));
const now = new Date();
const iso = d => d.toISOString();
const jkt = (daysAgo, hh, mm) => { const d = new Date(now); const j = new Date(d.getTime() + 7 * 3600e3); j.setUTCDate(j.getUTCDate() - daysAgo); j.setUTCHours(hh, mm, 0, 0); return new Date(j.getTime() - 7 * 3600e3); };
const bdate = daysAgo => iso(jkt(daysAgo, 12, 0)).slice(0, 10);
const S = 1_000_000;
db.exec('BEGIN');
db.prepare(`UPDATE entities SET name='Kedai Senja' WHERE id='ENT-LAB-TAMPILAN'`).run();
const stores = [
  ['store_lab01', 'LAB01', 'Kedai Senja Dinoyo', -7.9420, 112.6100],
  ['store_lab02', 'LAB02', 'Kedai Senja Sukun', -7.9960, 112.6200],
  ['store_lab03', 'LAB03', 'Kedai Senja Suhat', -7.9440, 112.6230],
  ['store_lab04', 'LAB04', 'Kedai Senja Batu', -7.8710, 112.5270]
];
for (const [id, code, name, lat, lng] of stores) {
  if (id === 'store_lab01') db.prepare(`UPDATE stores SET store_name=?, edition='LITE', attendance_ref_latitude=?, attendance_ref_longitude=? WHERE id=?`).run(name, lat, lng, id);
  else db.prepare(`INSERT OR REPLACE INTO stores (id, code, store_name, address, is_active, created_at, updated_at, entity_id, warehouse_enabled, edition, attendance_ref_latitude, attendance_ref_longitude)
    VALUES (?, ?, ?, '', 1, ?, ?, 'ENT-LAB-TAMPILAN', 0, 'LITE', ?, ?)`).run(id, code, name, iso(now), iso(now), lat, lng);
}
const menu = [['Kopi susu gula aren', 18000, 6500], ['Americano', 15000, 4500], ['Es teh manis', 7000, 1800], ['Roti bakar coklat', 15000, 6000], ['Matcha latte', 22000, 8500], ['Kentang goreng', 14000, 5500]];
const people = { store_lab01: 'Dimas', store_lab02: 'Rina', store_lab03: 'Andi', store_lab04: 'Sari' };
const hash = createHash('sha256').update('demo-tidak-dipakai').digest('hex');
let pid = 990000;
const products = {};
for (const [id] of stores) {
  products[id] = menu.map(([name, price, cost], i) => {
    pid += 1;
    db.prepare(`INSERT OR REPLACE INTO products (id, store_id, name, price, category, is_active, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(pid, id, name, price, i < 2 || i === 4 ? 'Kopi' : i === 2 ? 'Teh' : 'Makanan', i, iso(now), iso(now));
    return { id: pid, name, price, cost };
  });
  const cid = `cashier_demo_${id}`;
  db.prepare(`INSERT OR REPLACE INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(cid, `demo_${people[id].toLowerCase()}`, hash, people[id], id, iso(now), iso(now));
}
// Penjualan 7 hari; Batu sepi + sewa tinggi -> rugi.
const volume = { store_lab01: 38, store_lab02: 30, store_lab03: 26, store_lab04: 9 };
let seq = 0; let voidTarget = null;
for (const [id] of stores) {
  const cid = `cashier_demo_${id}`;
  for (let d = 6; d >= 0; d -= 1) {
    const drawerId = `drawer_demo_${id}_${d}`;
    const open = d === 0;
    db.prepare(`INSERT OR REPLACE INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, closing_amount, status, opened_at, closed_at, shift_label, closing_note, incentive_amount, opening_note, deposit_amount)
      VALUES (?, ?, ?, 200000, ?, ?, ?, ?, 'Pagi', '', 0, '', 0)`).run(drawerId, id, cid, open ? null : 200000, open ? 'OPEN' : 'CLOSED', iso(d === 0 ? jkt(0, 0, 5) : jkt(d, 7, 55)), open ? null : iso(jkt(d, 21, 30)));
    const n = volume[id] + ((d * 7 + id.length) % 6);
    for (let k = 0; k < n; k += 1) {
      seq += 1;
      const at = d === 0 ? jkt(0, k % 5, 10 + (k * 7) % 50) : jkt(d, 8 + (k % 12), (k * 7) % 60);
      if (at > now) continue;
      const items = [products[id][(k + d) % 6], products[id][(k * 3 + 1) % 6]].slice(0, 1 + (k % 2));
      const total = items.reduce((s, p) => s + p.price, 0);
      const saleId = `sale_demo_${seq}`;
      db.prepare(`INSERT OR REPLACE INTO sales (id, store_id, drawer_session_id, cashier_id, customer_name, total_amount, note, created_at, payment_method) VALUES (?, ?, ?, ?, 'Pembeli', ?, '', ?, 'CASH')`)
        .run(saleId, id, drawerId, cid, total, iso(at));
      for (const p of items) db.prepare(`INSERT OR REPLACE INTO sale_items (id, sale_id, store_id, product_id, product_name, unit_price, quantity, line_total, unit_cost_snapshot, line_cogs) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
        .run(`${saleId}_${p.id}`, saleId, id, p.id, p.name, p.price, p.price, p.cost * S, p.cost * S);
      if (id === 'store_lab01' && d === 0 && !voidTarget) voidTarget = { saleId, drawerId, cid };
    }
    // Biaya harian (sewa/lapak + gaji)
    const lapak = id === 'store_lab04' ? 420000 : 90000;
    db.prepare(`INSERT OR REPLACE INTO admin_operational_expenses (id, store_id, category, description, amount, business_date, created_at) VALUES (?, ?, 'BEA_LAPAK', 'Sewa tempat', ?, ?, ?)`)
      .run(`bea_demo_${id}_${d}`, id, lapak, bdate(d), iso(now));
    db.prepare(`INSERT OR REPLACE INTO admin_operational_expenses (id, store_id, category, description, amount, business_date, created_at) VALUES (?, ?, 'BEA_GAJI', 'Gaji harian', 100000, ?, ?)`)
      .run(`gaji_demo_${id}_${d}`, id, bdate(d), iso(now));
  }
}
// Permintaan hapus struk Rp85.000 yang menunggu pemilik.
db.prepare(`UPDATE sales SET total_amount=85000 WHERE id=?`).run(voidTarget.saleId);
db.prepare(`INSERT OR REPLACE INTO approval_permits (id, store_id, drawer_session_id, cashier_id, permit_type, subject_type, subject_id, subject_snapshot_json, reason, approval_status, execution_status, requested_at, updated_at)
  VALUES ('permit_demo_void', 'store_lab01', ?, ?, 'TRANSACTION_VOID', 'SALE', ?, ?, 'salah input menu', 'pending_approval', 'NOT_ATTEMPTED', ?, ?)`)
  .run(voidTarget.drawerId, voidTarget.cid, voidTarget.saleId, JSON.stringify({ description: 'Penjualan kasir', amount: 85000, paymentMethod: 'Tunai' }), iso(jkt(0, 4, 12)), iso(jkt(0, 4, 12)));
// Absen: Rina 412 m dari gerai Sukun (merah), lainnya di lokasi.
for (const [id, , , lat, lng] of stores) {
  const away = id === 'store_lab02';
  db.prepare(`INSERT OR REPLACE INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, latitude, longitude, location_accuracy_meters, status, gps_in_status, gps_in_distance_m)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, ?, ?, 12, 'OPEN', ?, ?)`)
    .run(`att_demo_${id}`, `cashier_demo_${id}`, id, iso(jkt(1, away ? 8 : 7, away ? 3 : 55)), away ? lat + 0.0037 : lat, lng, away ? 'OUT_OF_RADIUS' : 'OK', away ? 412 : 8);
}
db.prepare(`DELETE FROM store_daily_profit_snapshot WHERE store_id LIKE 'store_lab%'`).run();
db.exec('COMMIT');
console.log('seeded', seq, 'sales; void', voidTarget.saleId);

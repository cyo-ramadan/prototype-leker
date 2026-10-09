#!/usr/bin/env node
// Pembangkit PETA MENU untuk Una (Bos Cyo 2026-10-10: "kalo ada tambahan program lagi
// dia bingung juga karna ga ada knowledge itu ... peta yang bisa di refresh sendiri by
// program?"). Sumbernya daftar menu yang SUNGGUHAN dipakai layar: public/nav-groups.js
// (grup, label tombol, keterangan singkat). Hasilnya generated/peta-una-data.js, dibaca
// Una untuk menjawab "bagaimana cara ... / di mana ...".
//
//   node scripts/build-peta-una.mjs          -> tulis ulang generated/peta-una-data.js
//   node scripts/build-peta-una.mjs --cek    -> exit 1 kalau file belum mutakhir
//
// test/caca-peta.test.js menjalankan pembangkit ini dan GAGAL kalau peta belum disegarkan
// atau ada menu tanpa penjelasan di src/caca-peta.js — jadi menu baru tidak bisa lolos
// tanpa ikut diajarkan ke Una.

import { readFileSync, writeFileSync } from 'node:fs';

const SUMBER = new URL('../public/nav-groups.js', import.meta.url);
const TUJUAN = new URL('../generated/peta-una-data.js', import.meta.url);

function ambilObjek(teks, nama) {
  const awal = teks.indexOf(`const ${nama} = {`);
  if (awal < 0) throw new Error(`${nama} tidak ditemukan di nav-groups.js`);
  let i = teks.indexOf('{', awal);
  let dalam = 0;
  for (let j = i; j < teks.length; j += 1) {
    if (teks[j] === '{') dalam += 1;
    else if (teks[j] === '}') { dalam -= 1; if (dalam === 0) return new Function(`return (${teks.slice(i, j + 1)});`)(); }
  }
  throw new Error(`${nama} tidak tertutup`);
}

export function bangunPeta(teks = readFileSync(SUMBER, 'utf8')) {
  const PAGES = ambilObjek(teks, 'PAGES');
  const LABELS = ambilObjek(teks, 'LABELS');
  const ENTITY_LABELS = ambilObjek(teks, 'ENTITY_LABELS');
  const HINTS = ambilObjek(teks, 'SKIN_HINTS').d ?? {};
  const halamanDari = { 'branch-admin': 'gerai', 'entity-admin': 'entity' };
  const peta = [];
  for (const [kunci, halaman] of Object.entries(halamanDari)) {
    for (const grup of PAGES[kunci]?.groups ?? []) {
      for (const tab of grup.items ?? []) {
        const label = (halaman === 'entity' ? ENTITY_LABELS[tab] : null) ?? LABELS[tab] ?? tab;
        peta.push({ halaman, tab, label, grup: grup.label, hint: HINTS[tab] ?? '' });
      }
    }
  }
  return peta;
}

export function isiBerkas(peta) {
  return `// DIBANGKITKAN scripts/build-peta-una.mjs dari public/nav-groups.js — jangan disunting tangan.\n`
    + `// Segarkan: node scripts/build-peta-una.mjs\n`
    + `export const PETA_UNA = Object.freeze(${JSON.stringify(peta, null, 2)});\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isi = isiBerkas(bangunPeta());
  if (process.argv.includes('--cek')) {
    let lama = '';
    try { lama = readFileSync(TUJUAN, 'utf8'); } catch { /* belum ada */ }
    if (lama !== isi) { console.error('Peta menu Una belum mutakhir. Jalankan: node scripts/build-peta-una.mjs'); process.exit(1); }
    console.log('Peta menu Una mutakhir.');
  } else {
    writeFileSync(TUJUAN, isi);
    console.log(`Peta menu Una ditulis: ${bangunPeta().length} menu.`);
  }
}

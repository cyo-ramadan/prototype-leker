#!/usr/bin/env node
// Mekanis saja: menu, inventaris, dan sidik sumber. Makna ditinjau agen dari kode.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bahanHashSumber, normalkanBaris, periksaSumber } from '../src/kerangka/kamus.js';

export const AKAR = fileURLToPath(new URL('../', import.meta.url));
const baca = (nama) => readFileSync(resolve(AKAR, nama), 'utf8');
export const hashIsi = (isi) => createHash('sha256').update(isi).digest('hex');
export const hashSumber = (sumber, pembaca = baca) => hashIsi(bahanHashSumber(sumber, pembaca));

function labelTombolAsli(tab) {
  // Label fallback nav berasal dari tombol asli yang dibangkitkan public JS.
  for (const nama of berkasDi('public').filter((s) => s.endsWith('.js') && !s.endsWith('/nav-groups.js'))) {
    const teks = baca(nama);
    for (const m of teks.matchAll(/\b(\w+)\.dataset\.tab\s*=\s*['"]([^'"]+)['"]/g)) {
      if (m[2] !== tab) continue;
      const lanjut = teks.slice(m.index, m.index + 600);
      const label = lanjut.match(new RegExp(m[1] + "\\.textContent\\s*=\\s*['\"]([^'\"]+)['\"]"))?.[1];
      if (label) return label.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    }
  }
  return tab;
}

export function kodeSkinResmi(teks = baca('src/ui-profile.js')) {
  // Gunakan registry yang dipakai server. Skin visual murni (I) tidak punya
  // SKIN_GROUPS sendiri, tetapi tetap harus mendapat menu layout default.
  const cocok = teks.match(/const SKIN_BY_CHOICE\s*=\s*Object\.freeze\((\{[^}]+\})\)/);
  if (!cocok) throw new Error('Registry skin server berubah; tinjau pembangkit peta Una.');
  const registry = new Function('return (' + cocok[1] + ');')();
  const kode = [...new Set(Object.values(registry))];
  if (!kode.length || kode.some((nilai) => typeof nilai !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(nilai))) {
    throw new Error('Kode skin server tidak valid untuk peta Una.');
  }
  return kode;
}

export function bangunPeta(teks = baca('public/nav-groups.js'), profil = baca('src/ui-profile.js')) {
  // Jalankan hanya deklarasi data lokal; tidak pernah menjalankan IIFE/browser.
  // Termasuk assignment SKIN_GROUPS.f/g/h yang merujuk PAGES.
  const awal = teks.indexOf('const PAGES = {');
  const akhir = teks.indexOf('function pageKey()', awal);
  if (awal < 0 || akhir < 0) throw new Error('Batas deklarasi nav-groups berubah; tinjau pembangkit peta.');
  const { PAGES, LABELS, ENTITY_LABELS, SKIN_GROUPS, SKIN_LABELS, SKIN_HINTS } =
    new Function(teks.slice(awal, akhir) + '\nreturn {PAGES,LABELS,ENTITY_LABELS,SKIN_GROUPS,SKIN_LABELS,SKIN_HINTS};')();
  const skins = [...new Set(['classic', ...kodeSkinResmi(profil),
    ...Object.keys(SKIN_GROUPS), ...Object.keys(SKIN_LABELS), ...Object.keys(SKIN_HINTS)])].sort();
  const peta = [];
  for (const skin of skins) {
    for (const [kunci, halaman] of Object.entries({ 'branch-admin': 'gerai', 'entity-admin': 'entity' })) {
      const groups = SKIN_GROUPS[skin]?.[kunci] ?? PAGES[kunci].groups;
      for (const grup of groups) {
        const sections = grup.menu ?? [{ items: grup.items ?? [] }];
        for (const section of sections) for (const tab of section.items ?? []) {
          const label = SKIN_LABELS[skin]?.[tab] ?? (halaman === 'entity' ? ENTITY_LABELS[tab] : null) ?? LABELS[tab] ?? labelTombolAsli(tab);
          peta.push({ skin, halaman, tab, label, grup: [grup.label, section.title].filter(Boolean).join(' → '), hint: SKIN_HINTS[skin]?.[tab] ?? '' });
        }
      }
    }
  }
  return peta;
}

export function isiBerkas(peta) {
  return '// DIBANGKITKAN scripts/build-peta-una.mjs dari public/nav-groups.js — jangan disunting tangan.\n'
    + '// Segarkan: node scripts/build-peta-una.mjs\n'
    + 'export const PETA_UNA = Object.freeze(' + JSON.stringify(peta, null, 2) + ');\n';
}

export function berkasDi(dir) {
  return readdirSync(resolve(AKAR, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? berkasDi(dir + '/' + e.name) : [dir + '/' + e.name]);
}
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// Rentang string/comment mencegah inventaris membaca salinan ID fitur sebagai kode.
function rentangLiteral(teks) {
  const rentang = [];
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i], n = teks[i + 1];
    if (c === '/' && (n === '/' || n === '*')) {
      const mulai = i;
      const akhir = n === '/' ? teks.indexOf('\n', i + 2) : teks.indexOf('*/', i + 2);
      i = akhir < 0 ? teks.length : akhir + (n === '*' ? 1 : 0);
      rentang.push({ mulai, akhir: i + 1, jenis: 'komentar' });
    } else if (c === "'" || c === '"' || c.charCodeAt(0) === 96) {
      const mulai = i;
      for (i++; i < teks.length; i++) {
        if (teks[i] === '\\\\') { i++; continue; }
        if (teks[i] === c) break;
      }
      rentang.push({ mulai, akhir: i + 1, jenis: 'string', isi: teks.slice(mulai + 1, i) });
    }
  }
  return rentang;
}
export function fiturDariBerkas(nama, teks) {
  const fitur = [];
  if (nama.endsWith('.js') && nama.startsWith('src/')) {
    // Setiap guard method tulis ikut inventaris meski pola rutenya indirect/regex.
    // ID kondisi, bukan nomor baris: memindah kode/CRLF tidak membuat fitur baru.
    const literal = rentangLiteral(teks);
    const dalamData = (i) => literal.some((r) => r.mulai <= i && i < r.akhir);
    const guards = [...teks.matchAll(/\b(?:request|req)\.method\s*(?:===|!==|==|!=)\s*['"](POST|PUT|PATCH|DELETE)['"]([^\r\n]*)/g)].filter((m) => !dalamData(m.index));
    for (const m of guards) {
      const kondisi = (m[0].split('{')[0]).trim().replace(/\s+/g, ' ');
      const rute = kondisi.match(/['"](\/api\/[^'"]+)['"]/)?.[1] ?? null;
      fitur.push({ id: 'tulis:' + nama + ':' + kondisi, jenis: 'rute-tulis', sumber: nama, method: m[1], rute, label: rute ?? kondisi, skin: null });
    }
    // Rute literal di modul tulis juga dicatat: mencakup array/switch/guard lebih awal.
    // Bisa mencakup endpoint baca di modul campuran; konservatif agar tidak ada lubang
    // ketika endpoint yang dulu baca ditambah kemampuan tulis.
    if (guards.length || literal.some((r) => r.jenis === 'string' && /^(POST|PUT|PATCH|DELETE)$/.test(r.isi))) {
      // Parameter routes memakai regex, bukan string literal. Identitas pola
      // membuat regex baru terdeteksi walau nama variabel match/guard sama.
      const penanda = '/^\\/api\\/';
      let mulai = teks.indexOf(penanda);
      while (mulai >= 0) {
        if (!dalamData(mulai)) {
          let kelas = false, akhir = mulai + 1;
          for (; akhir < teks.length; akhir++) {
            const c = teks[akhir];
            if (c === '\\') { akhir++; continue; }
            if (c === '[') kelas = true;
            else if (c === ']') kelas = false;
            else if (c === '/' && !kelas) break;
          }
          if (akhir < teks.length) {
            const pola = teks.slice(mulai, akhir + 1);
            fitur.push({ id: 'pola:' + nama + ':' + pola, jenis: 'rute-pola', sumber: nama, method: null, rute: pola, label: pola, skin: null });
          }
        }
        mulai = teks.indexOf(penanda, mulai + penanda.length);
      }

      for (const m of teks.matchAll(/(['"])(\/api\/[^'"\s]+)\1/g)) {
        if (!literal.some((r) => r.jenis === 'string' && r.mulai === m.index)) continue;
        fitur.push({ id: 'rute:' + nama + ':' + m[2], jenis: 'rute-kandidat', sumber: nama, method: null, rute: m[2], label: m[2], skin: null });
      }
    }
  }
  // HTML juga di template JS: tombol hasil render termasuk sehingga label/data-action
  // baru tidak luput hanya karena tidak ditulis di berkas .html.
  if (nama.startsWith('public/') && /\.(html|js)$/.test(nama)) {
    for (const m of teks.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(['"]button['"]\)/g)) {
      const namaVar = m[1];
      const badan = teks.slice(m.index, m.index + 1800).split(/\n\s*(?:const|let)\s+\w+\s*=\s*document\.createElement/)[0];
      const ambil = (properti) => badan.match(new RegExp('\\b' + namaVar + '\\.' + properti + '\\s*=\\s*([\"\\\'])([^\"\\\']+)\\1'))?.[2];
      const tombolId = ambil('id');
      const tab = ambil('dataset\\.tab');
      const label = ambil('textContent');
      if (tombolId || tab || label) fitur.push({
        id: 'tombol:' + nama + ':' + (tombolId ?? (tab ? 'data-tab:' + tab : 'label:' + label)),
        jenis: 'tombol', sumber: nama, tombolId: tombolId ?? null,
        aksi: tab ? 'data-tab' : null, label: label ?? tab ?? tombolId, rute: null, skin: nama.includes('racik') ? ['f'] : nama.includes('percetakan') ? ['g'] : null, halaman: nama
      });
    }
    for (const m of teks.matchAll(/<button\b([^>]*?)>([\s\S]*?)<\/button\s*>/gi)) {
      const attrs = m[1];
      const id = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
      const action = [...attrs.matchAll(/\b(data-[\w-]+)\s*=\s*["']([^"']*)["']/gi)].map((a) => a[1]).sort().join(',');
      const label = stripTags(m[2]).replace(/\$\{[^}]*\}/g, '{nilai}');
      const identitas = id ?? (action ? action + ':' + label : 'label:' + label);
      if (!identitas.trim()) continue;
      const skin = nama.includes('racik') ? ['f'] : nama.includes('percetakan') ? ['g'] : nama.includes('warung') ? ['d', 'e', 'h'] : null;
      fitur.push({ id: 'tombol:' + nama + ':' + identitas, jenis: 'tombol', sumber: nama, tombolId: id ?? null, aksi: action || null, label, rute: null, skin, halaman: nama });
    }
  }
  return [...new Map(fitur.map((f) => [f.id, f])).values()];
}
export function bangunInventaris(berkas = berkasDi('src').filter((s) => s.endsWith('.js')).concat(berkasDi('public').filter((s) => /\.(js|html)$/.test(s))), pembaca = baca) {
  return berkas.flatMap((nama) => fiturDariBerkas(nama, pembaca(nama))).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
export const isiInventaris = (fitur) => '// DIBANGKITKAN scripts/build-peta-una.mjs — jangan disunting tangan.\nexport const INVENTARIS_FITUR_UNA = Object.freeze(' + JSON.stringify(fitur, null, 2) + ');\n';

export function periksaCakupan(fitur, kamus, tanpa = {}, belum = []) {
  const dikenal = new Set(kamus.flatMap((e) => e.fitur ?? []));
  const baseline = new Set(belum);
  return fitur.filter((f) => !dikenal.has(f.id) && !String(tanpa[f.id] ?? '').trim() && !baseline.has(f.id)).map((f) => f.id);
}

export async function isiKemampuanBrowser() {
  const { UNA_KEMAMPUAN } = await import('../src/una-kemampuan.js');
  const { PETA_UNA } = await import('../generated/peta-una-data.js');
  const validation = baca('src/una-kemampuan-validasi.js').replace(/^export /gm, '');
  const canvas = baca('src/una-kanvas-patch.js').replace(/^export /gm, '');
  const manifest = JSON.stringify({ ...UNA_KEMAMPUAN, menus: PETA_UNA });
  return '// Generated by scripts/build-peta-una.mjs. Do not edit.\n(() => {\n' + validation
    + '\nconst freeze = v => { if(v && typeof v === "object"){Object.values(v).forEach(freeze);Object.freeze(v);}return v; };'
    + '\nwindow.UNA_KEMAMPUAN = freeze(' + manifest + ');'
    + '\nwindow.UnaKemampuanValidasi = Object.freeze({validateAction,rejectAction,validateSchema,validateParams,dateValid,relevantCapability});\n})();\n'
    + '(() => {\n'+canvas+'\nwindow.UnaKanvasPatch=Object.freeze({validateCanvas,validateCanvasObject,validateCanvasOperation,applyCanvasPatch});\n})();\n';
}

async function utama() {
  const cek = process.argv.includes('--cek');
  const i = process.argv.indexOf('--tinjau');
  if (i >= 0) {
    const id = process.argv[i + 1];
    const { KAMUS } = await import('../src/caca-jelaskan.js');
    const entri = KAMUS.find((e) => e.id === id);
    if (!entri) throw new Error('ID kamus tidak dikenal. Gunakan --tinjau <satu-id>, sesudah membaca sumbernya.');
    const nama = 'generated/tinjauan-kamus-una.json';
    const tinjauan = JSON.parse(baca(nama));
    tinjauan[id] = hashSumber(entri.sumber);
    writeFileSync(resolve(AKAR, nama), JSON.stringify(tinjauan, null, 2) + '\n');
    console.log('Hash ' + id + ' diperbarui; penjelasan wajib sudah dibaca dari sumber.');
    return;
  }
  const hasil = [['generated/peta-una-data.js', isiBerkas(bangunPeta())],
    ['generated/inventaris-fitur-una.js', isiInventaris(bangunInventaris())],
    ['public/una-kemampuan-data.js', await isiKemampuanBrowser()]];
  const basi = [];
  for (const [nama, isi] of hasil) {
    if (cek) {
      let lama = ''; try { lama = baca(nama); } catch {}
      if (normalkanBaris(lama) !== normalkanBaris(isi)) basi.push(nama);
    } else writeFileSync(resolve(AKAR, nama), isi);
  }
  if (cek) {
    const { KAMUS } = await import('../src/caca-jelaskan.js');
    const { TANPA_PANDUAN, BELUM_DIAJARKAN } = await import('../src/caca-inventaris-panduan.js');
    basi.push(...periksaSumber(KAMUS, { baca, hash: hashIsi }));
    basi.push(...periksaCakupan(bangunInventaris(), KAMUS, TANPA_PANDUAN, BELUM_DIAJARKAN).map((id) => 'Fitur belum diajarkan: ' + id));
    if (basi.length) throw new Error(basi.join('\n'));
  }
  console.log(cek ? 'Peta, inventaris, sumber, dan cakupan Una mutakhir.' : 'Peta dan inventaris dibangkitkan. Hash tinjauan tidak diubah.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  utama().catch((e) => { console.error(e.message); process.exitCode = 1; });
}

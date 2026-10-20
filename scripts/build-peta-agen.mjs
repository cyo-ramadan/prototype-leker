// Penyusun data Peta Agen (Bos Cyo, 2026-10-19/20).
//
// Rancangan FINAL Una, Rika (akuntan), dan Fina (HR) ada di scripts/peta-agen-manifest.json.
// Setiap kotak membawa "bukti" yang diperiksa ke kode di repo ini:
//   { "f": "path" }                -> berkas ada
//   { "g": "regex", "p": "path" }  -> berkas ada dan isinya cocok regex
//   { "m": "regex" }               -> ada migration yang namanya cocok
//   { "luar": "teks", "ok": true } -> hal di luar repo, dicatat manual
// Status kotak: selesai (semua bukti lolos), sebagian (ada yang lolos), belum.
// Hasilnya generated/peta-agen-data.js, dilayani GET /api/owner/peta-agen (khusus Owner).
// Tidak memakai token AI dan tidak butuh jaringan. Dijalankan lewat `npm run peta:build`.
// test/peta-agen.test.js gagal kalau data ini tertinggal dari kode, jadi peta ikut berubah
// setiap kali program berubah.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const JENIS = Object.freeze(['pintu', 'agen', 'alat', 'data', 'keluaran', 'acc', 'belajar', 'mesin', 'lokal']);
export const AGEN = Object.freeze(['una', 'rika', 'fina', 'mesin', 'belajar']);

/**
 * @param {object} manifest
 * @param {{ ada: (p:string)=>boolean, baca: (p:string)=>string|null, migrasi: string[] }} kode
 */
export function bangunPetaAgen(manifest, { ada, baca, migrasi }) {
  const periksa = (b) => {
    if (b.f) return { teks: b.f, ok: ada(b.f) };
    if (b.g) {
      const isi = ada(b.p) ? baca(b.p) : null;
      return { teks: `${b.p} memuat /${b.g}/`, ok: isi != null && new RegExp(b.g).test(isi) };
    }
    if (b.m) {
      const cocok = migrasi.find(nama => new RegExp(b.m).test(nama)) || null;
      return { teks: `migration ~ ${b.m}`, ok: Boolean(cocok), cocok };
    }
    if (b.luar) return { teks: b.luar, ok: b.ok === true, luar: true };
    throw new Error('Bukti tidak dikenal: ' + JSON.stringify(b));
  };
  const kotak = manifest.kotak.map(k => {
    const bukti = (k.bukti || []).map(periksa);
    const lolos = bukti.filter(b => b.ok).length;
    const status = bukti.length && lolos === bukti.length ? 'selesai' : lolos > 0 ? 'sebagian' : 'belum';
    return { ...k, bukti, status };
  });
  const ringkas = {};
  for (const k of kotak) for (const a of k.agen) {
    const r = (ringkas[a] ??= { total: 0, selesai: 0, sebagian: 0, belum: 0 });
    r.total += 1; r[k.status] += 1;
  }
  return { judul: manifest.judul, handoff: manifest.handoff, ukuran: manifest.ukuran, jalur: manifest.jalur, kotak, garis: manifest.garis, ringkas };
}

export function kodeDariRepo(root) {
  const path = p => new URL(p, root);
  return {
    ada: p => existsSync(path(p)),
    baca: p => { try { return readFileSync(path(p), 'utf8'); } catch { return null; } },
    migrasi: readdirSync(path('migrations/')).filter(n => n.endsWith('.sql')).sort()
  };
}

export function bacaManifest(root) {
  return JSON.parse(readFileSync(new URL('scripts/peta-agen-manifest.json', root), 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../', import.meta.url);
  const data = bangunPetaAgen(bacaManifest(root), kodeDariRepo(root));
  const body = `// DIBANGKITKAN oleh scripts/build-peta-agen.mjs dari scripts/peta-agen-manifest.json -- jangan disunting tangan.\n// Jalankan \`npm run peta:build\` setiap kali kode atau rancangan berubah.\nexport default ${JSON.stringify(data)};\n`;
  writeFileSync(fileURLToPath(new URL('generated/peta-agen-data.js', root)), body);
  console.log('peta-agen: ' + Object.entries(data.ringkas).map(([a, r]) => `${a} ${r.selesai}/${r.total}`).join(', '));
}

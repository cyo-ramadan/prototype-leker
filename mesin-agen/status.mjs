// Lihat status Mesin Agen dari file detak: `node mesin-agen/status.mjs`.
import { readFileSync } from 'node:fs';
import { lokasiStatus, statusTampil } from './detak-inti.mjs';

const file = lokasiStatus();
let data = null;
try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* belum pernah jalan */ }
if (!data) {
  console.log(`Belum ada detak di ${file} -- mesin belum pernah dijalankan di komputer ini.`);
} else {
  console.log(`${data.agen}: ${statusTampil(data)}${data.catatan ? ` (${data.catatan})` : ''}`);
  console.log(`  sejak ${data.sejak || '-'}, detak terakhir ${data.diperbarui}`);
  if (data.alat) console.log(`  alat terakhir: ${data.alat}`);
  if (data.folder) console.log(`  folder: ${data.folder}`);
}

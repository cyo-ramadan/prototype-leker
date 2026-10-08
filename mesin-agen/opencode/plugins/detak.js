// Plugin OpenCode: tulis detak status Mesin Agen ke file lokal (lihat ../../detak-inti.mjs).
// Juga menolak membaca file `.env` -- tempat kunci API Bos Cyo.
import { statusDariEvent, tulisStatus } from '../../detak-inti.mjs';

function aman(fn) {
  try { fn(); } catch { /* detak tidak boleh menghentikan kerja mesin */ }
}

export const DetakMesin = async ({ directory }) => {
  aman(() => tulisStatus({ status: 'IDLE', folder: directory, sesi: null, alat: null }));
  return {
    event: async ({ event }) => {
      const hasil = statusDariEvent(event);
      if (!hasil) return;
      const sesi = event.properties?.sessionID || null;
      aman(() => tulisStatus(sesi ? { ...hasil, sesi } : hasil));
    },
    'tool.execute.before': async (input, output) => {
      const target = String(output?.args?.filePath || output?.args?.path || '');
      if (/(^|[\\/])\.env(\.|$)/.test(target) && !target.endsWith('.env.example')) {
        throw new Error('File .env berisi kunci API dan tidak boleh dibaca mesin.');
      }
      aman(() => tulisStatus({ status: 'WORKING', alat: input?.tool || null }));
    }
  };
};

// Daftar alat baca Caca (ADR-045 Tahap A).
//
// K4: tidak ada endpoint khusus AI. Tiap alat menunjuk endpoint yang SAMA
// dengan yang dipanggil panel, dan dipanggil dengan kredensial orang yang
// menyuruh Caca — bukan kredensial milik Caca (K1). Otorisasi karena itu
// terjadi di tempat yang sama dengan waktu manusia menekan tombolnya, bukan
// ditiru ulang di modul ini. Kalau penyuruhnya Admin gerai A, endpoint yang
// sama itu sendiri yang menolak permintaan data gerai B.
//
// K6: alat ditulis satu per satu. Model tidak pernah menyusun URL atau
// parameter request sendiri — dia cuma memilih nama alat dari daftar ini.

import { handleNetProfitReportApi } from './net-profit-report.js';
import { handleAdminStockApi } from './admin-stock.js';
import { getJakartaBusinessDate } from './time.js';

export const PERIODE = Object.freeze([
  'hari_ini',
  'kemarin',
  '7_hari_terakhir',
  'bulan_ini',
  'bulan_lalu',
  'rentang'
]);

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function geser(tanggal, hari) {
  const [tahun, bulan, hariKe] = tanggal.split('-').map(Number);
  const d = new Date(Date.UTC(tahun, bulan - 1, hariKe + hari));
  return d.toISOString().slice(0, 10);
}

function awalBulan(tanggal) {
  return `${tanggal.slice(0, 7)}-01`;
}

/**
 * Periode dihitung DI SINI, bukan oleh model. Model cuma menyebut maksudnya
 * ("hari ini", "bulan lalu"); menghitung tanggalnya sendiri adalah cara paling
 * mudah bagi model untuk meleset sehari tanpa ada yang sadar — dan laporan yang
 * bergeser sehari terlihat masuk akal sampai dicocokkan.
 */
export function hitungPeriode(periode, { dari, sampai } = {}, hariIni = getJakartaBusinessDate()) {
  switch (periode) {
    case 'hari_ini':
      return { ok: true, dari: hariIni, sampai: hariIni };
    case 'kemarin': {
      const k = geser(hariIni, -1);
      return { ok: true, dari: k, sampai: k };
    }
    case '7_hari_terakhir':
      return { ok: true, dari: geser(hariIni, -6), sampai: hariIni };
    case 'bulan_ini':
      return { ok: true, dari: awalBulan(hariIni), sampai: hariIni };
    case 'bulan_lalu': {
      const akhirBulanLalu = geser(awalBulan(hariIni), -1);
      return { ok: true, dari: awalBulan(akhirBulanLalu), sampai: akhirBulanLalu };
    }
    case 'rentang': {
      if (!TANGGAL.test(String(dari ?? '')) || !TANGGAL.test(String(sampai ?? ''))) {
        return { ok: false, error: 'Tanggalnya belum jelas. Bisa disebutkan tanggal berapa sampai berapa?' };
      }
      if (dari > sampai) return { ok: false, error: 'Tanggal mulainya lebih akhir dari tanggal selesainya.' };
      return { ok: true, dari, sampai };
    }
    default:
      return { ok: false, error: 'Periode yang diminta belum dikenali.' };
  }
}

export const ALAT_BACA = Object.freeze([
  Object.freeze({
    nama: 'laba_periode',
    kegunaan: 'Untung atau rugi bersih: penjualan dikurangi HPP dan pengeluaran. Pakai untuk "untung berapa", "rugi nggak", "laba bulan ini".',
    perluPeriode: true,
    pathname: '/api/admin/reports/net-profit',
    handler: handleNetProfitReportApi,
    query: ({ dari, sampai }) => ({ from: dari, to: sampai })
  }),
  Object.freeze({
    nama: 'stok_sisa',
    kegunaan: 'Sisa stok barang di gerai saat ini. Pakai untuk "stok gula tinggal berapa", "apa saja yang hampir habis".',
    perluPeriode: false,
    pathname: '/api/admin/stock',
    handler: handleAdminStockApi,
    query: () => ({})
  })
]);

export function cariAlat(nama) {
  return ALAT_BACA.find((alat) => alat.nama === nama) ?? null;
}

/** Ringkasan alat untuk dibacakan ke model — sengaja tanpa URL. */
export function daftarAlatUntukModel() {
  return ALAT_BACA.map((alat) => `- ${alat.nama}: ${alat.kegunaan}`).join('\n');
}

/**
 * Menyusun permintaan yang akan dikirim ke endpoint asli. Dipisah dari
 * pemanggilannya supaya bagian yang menentukan "Caca sebenarnya meminta apa,
 * atas nama siapa, untuk gerai mana" bisa diperiksa tanpa menyentuh apa pun.
 *
 * @param {Request} request request asli dari penyuruh — header Authorization-nya
 *   dipakai apa adanya, karena di situlah kredensial penyuruh berada (K1).
 */
export function bangunPermintaanAlat(namaAlat, parameter, { request, storeCode, hariIni } = {}) {
  const alat = cariAlat(namaAlat);
  if (!alat) return { ok: false, error: 'Alat yang diminta tidak ada di daftar.' };

  let periode = null;
  if (alat.perluPeriode) {
    periode = hitungPeriode(parameter?.periode, parameter, hariIni ?? getJakartaBusinessDate());
    if (!periode.ok) return { ok: false, error: periode.error };
  }

  const url = new URL(alat.pathname, 'https://leker.internal');
  // Gerai selalu dari sesi penyuruh. Apa pun yang tertulis di parameter model
  // diabaikan di sini — itulah yang membuat "tolong lihatkan gerai sebelah"
  // tidak pernah berpengaruh (K2, invariant #5).
  if (storeCode) url.searchParams.set('store', storeCode);
  for (const [kunci, nilai] of Object.entries(alat.query(periode ?? {}))) {
    if (nilai !== undefined && nilai !== null) url.searchParams.set(kunci, String(nilai));
  }

  return {
    ok: true,
    alat,
    periode: periode ? { dari: periode.dari, sampai: periode.sampai } : null,
    permintaan: new Request(url, { method: 'GET', headers: request.headers })
  };
}

/** Menjalankan satu alat lewat endpoint aslinya, membawa kredensial penyuruh. */
export async function jalankanAlat(namaAlat, parameter, { request, env, storeCode, hariIni } = {}) {
  const disusun = bangunPermintaanAlat(namaAlat, parameter, { request, storeCode, hariIni });
  if (!disusun.ok) return disusun;

  const { alat, permintaan, periode } = disusun;
  const response = await alat.handler(permintaan, env, alat.pathname);
  if (!response) return { ok: false, error: 'Alat itu tidak menjawab.' };

  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'Jawaban alat tidak terbaca.' };
  }

  if (!response.ok) {
    // Pesan penolakan dari endpoint diteruskan apa adanya — termasuk saat
    // penolakannya soal wewenang, supaya penyuruh tahu batasnya, bukan mengira
    // Caca yang rusak.
    return { ok: false, error: data?.error || 'Permintaan ditolak.', status: response.status };
  }

  return { ok: true, data, periode };
}

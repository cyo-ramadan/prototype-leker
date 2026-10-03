// Katalog API BACA yang boleh dibuka Una sendiri (Bos Cyo 2026-10-02:
// "untuk read kasihlah dia semua akses").
//
// "Semua akses" di sini artinya: semua endpoint baca yang dipakai layar admin
// dan Entity Admin, bukan kunci yang dibuka lebar. Pagarnya tetap:
//   - Una memanggil dengan kredensial si penyuruh (K1 ADR-045), jadi
//     endpoint-nya sendiri yang menolak kalau bukan haknya.
//   - Gerai SELALU dari sesi panel atau dari daftar gerai entity — tidak pernah
//     dari kalimat. Parameter daftar gerai (`stores`, `store`, dst.) tidak ada di
//     daftar izin mana pun: pitfall "parameter daftar gerai di query string
//     tidak ikut terkunci" (KNOWN_PITFALLS).
//   - Setiap endpoint punya daftar parameter yang diizinkan, ditulis tangan.
//     Parameter di luar daftar dibuang diam-diam.
//   - Endpoint BERAT tidak pernah dijalankan ke banyak gerai sekaligus: kuota
//     baca harian D1 pernah habis oleh satu halaman daftar yang dibuka berkali-kali
//     lintas gerai (KNOWN_PITFALLS, 2026-09-29).
//   - Hanya GET. Tidak ada jalur tulis di katalog ini.
//
// Menambah API baca baru = tambah satu baris di sini. test/caca-baca-katalog
// memastikan path-nya benar-benar ada di kode, supaya katalog tidak diam-diam
// menunjuk jalur yang sudah dihapus.

const TGL = 'YYYY-MM-DD';

/**
 * @typedef {object} ApiBaca
 * @property {string} id nama pendek yang dipilih model
 * @property {string} path path endpoint ("/:id" diganti param `id`)
 * @property {'gerai'|'entity'} lingkup gerai = butuh ?store=; entity = tingkat entity
 * @property {Record<string,string>} [param] parameter query yang diizinkan -> penjelasan
 * @property {boolean} [berat] mahal dibaca; di lingkup entity jumlah barisnya dibatasi (batasLimit)
 * @property {boolean} [tanpaFanOut] tidak bermakna lintas gerai (id/akun beda di tiap gerai) atau terlalu berat
 * @property {number} [batasLimit] batas baris per gerai saat dibaca lintas gerai
 * @property {boolean} [lintasGerai] satu panggilan sudah mencakup semua gerai entity
 * @property {Record<string,string>} [tetap] parameter query yang selalu ikut (bukan pilihan model)
 * @property {string} ringkas apa isinya, kalimat untuk model
 */

/** @type {ReadonlyArray<ApiBaca>} */
export const KATALOG = Object.freeze([
  // --- penjualan, pembelian, produksi: riwayat transaksi --------------------
  {
    id: 'transaksi', path: '/api/admin/transactions', lingkup: 'gerai', berat: true, batasLimit: 20,
    param: {
      filter: 'ALL | SALES | PURCHASES | OPERATIONS | STOCK_ADJUSTMENTS | GOODS_FLOW | PRODUCTION | ASSETS',
      from: `tanggal awal ${TGL}`, to: `tanggal akhir ${TGL}`, limit: 'maks 100', q: 'kata kunci'
    },
    ringkas: 'Riwayat transaksi gerai (penjualan, pembelian, operasional, produksi, penyesuaian stok), terbaru dulu.'
  },
  {
    id: 'laba', path: '/api/admin/reports/net-profit', lingkup: 'gerai',
    param: { from: TGL, to: TGL },
    ringkas: 'Laporan laba bersih gerai untuk satu periode: penjualan, HPP, beban, laba.'
  },
  {
    id: 'beban', path: '/api/admin/laporan-beban', lingkup: 'gerai',
    param: { from: TGL, to: TGL },
    ringkas: 'Laporan beban gerai per kategori untuk satu periode.'
  },

  // --- barang, resep, stok --------------------------------------------------
  {
    // tetap: ringkas=1 — tanpa foto barang (satu foto bisa ratusan KB; Una tidak memakainya).
    id: 'barang', path: '/api/admin/master/products/editor', lingkup: 'gerai', tetap: { ringkas: '1' },
    ringkas: 'Master barang gerai: nama, kategori, harga jual (price), harga beli (purchasePrice), HPP rata-rata (averageCost), harga beli terakhir, satuan, stok, aktif/nonaktif, resep terkait.'
  },
  {
    id: 'kebijakan_barang', path: '/api/admin/master/products/policies', lingkup: 'gerai',
    ringkas: 'Kebijakan per barang (boleh dijual, dibeli, diproduksi, dst.).'
  },
  {
    id: 'jenis_barang', path: '/api/admin/master/product-kinds', lingkup: 'gerai',
    ringkas: 'Daftar Jenis Barang gerai.'
  },
  {
    id: 'biaya_master', path: '/api/admin/master/costs', lingkup: 'gerai',
    ringkas: 'Master biaya gerai (jenis biaya dan biayanya).'
  },
  {
    id: 'katalog_barang_entity', path: '/api/admin/product-masters', lingkup: 'gerai',
    ringkas: 'Katalog Master Barang tingkat entity (kode barang yang bisa diaktifkan tiap gerai).'
  },
  {
    id: 'resep', path: '/api/admin/manufacturing/recipes', lingkup: 'gerai',
    param: { includeArchived: '1 untuk ikut resep yang diarsipkan' },
    ringkas: 'Resep produksi gerai: barang hasil, jumlah hasil, komponen/bahan beserta takarannya, varian, revisi.'
  },
  {
    id: 'referensi_produksi', path: '/api/admin/manufacturing/bootstrap', lingkup: 'gerai',
    ringkas: 'Daftar tipe barang, satuan, dan barang aktif beserta tipe dan satuannya.'
  },
  {
    id: 'resep_entity', path: '/api/admin/entity-recipes', lingkup: 'gerai',
    ringkas: 'Resep acuan tingkat entity.'
  },
  {
    id: 'stok', path: '/api/admin/stock', lingkup: 'gerai',
    ringkas: 'Saldo stok semua barang gerai saat ini.'
  },
  {
    id: 'stok_mutasi', path: '/api/admin/stock/:id/movements', lingkup: 'gerai', berat: true, tanpaFanOut: true,
    param: { id: 'WAJIB: id barang (angka) dari alat barang/stok', limit: 'maks 100' },
    ringkas: 'Riwayat mutasi stok SATU barang (masuk/keluar), terbaru dulu.'
  },
  {
    id: 'stok_entity', path: '/api/admin/entity-stock', lingkup: 'gerai', berat: true, lintasGerai: true,
    ringkas: 'Saldo stok semua barang di SEMUA gerai entity sekaligus (satu panggilan, sudah per gerai).'
  },
  {
    id: 'hpp_hitung_ulang', path: '/api/admin/hpp-recalculation', lingkup: 'gerai', berat: true, tanpaFanOut: true,
    ringkas: 'Status hitung ulang HPP barang gerai.'
  },

  // --- hutang, piutang, bea, kas bersama -------------------------------------
  {
    id: 'hutang_piutang', path: '/api/admin/hutang-piutang', lingkup: 'gerai',
    param: { from: TGL, to: TGL },
    ringkas: 'Ringkasan hutang & piutang per orang (gaji, lapak, lainnya), Rekening Bersama, deposit/uang muka yang masih bersaldo, dan pembayaran terakhir.'
  },
  {
    id: 'hutang_pembayaran', path: '/api/admin/hutang-piutang/payments', lingkup: 'gerai',
    ringkas: 'Riwayat pembayaran hutang/piutang gerai.'
  },
  {
    id: 'bea_operasional', path: '/api/admin/operational-expenses', lingkup: 'gerai',
    param: { from: TGL, to: TGL },
    ringkas: 'Bea Operasional (Bea Gaji, Bea Lapak, Bea Lainnya) yang tercatat, beserta daftar karyawan dan supplier.'
  },
  {
    id: 'rekening_bersama', path: '/api/admin/shared-accounts', lingkup: 'gerai',
    ringkas: 'Rekening Bersama entity beserta mutasi dan saldo gerai ini.'
  },
  {
    id: 'rekening_bersama_entity', path: '/api/entity/shared-accounts', lingkup: 'entity',
    ringkas: 'Rekening Bersama entity: daftar rekening dan saldo total semua gerai.'
  },
  {
    id: 'uang_muka_karyawan', path: '/api/admin/employee-deposits/pending', lingkup: 'gerai',
    ringkas: 'Setoran/uang karyawan yang menunggu penyelesaian.'
  },

  // --- akuntansi --------------------------------------------------------------
  {
    id: 'akuntansi_ringkas', path: '/api/admin/accounting', lingkup: 'gerai', berat: true, tanpaFanOut: true,
    ringkas: 'Ringkasan Akuntansi gerai: daftar akun, jurnal terbaru, status jembatan, beban rutin.'
  },
  {
    id: 'akun', path: '/api/admin/accounting/accounts', lingkup: 'gerai',
    ringkas: 'Daftar akun (COA) gerai, aktif dan nonaktif.'
  },
  {
    id: 'jurnal', path: '/api/admin/accounting/journals', lingkup: 'gerai',
    param: { from: TGL, to: TGL, limit: 'maks 500' },
    ringkas: 'Daftar jurnal gerai (nomor, tanggal, sumber, keterangan).'
  },
  {
    id: 'buku_besar', path: '/api/admin/accounting/ledger', lingkup: 'gerai', berat: true, tanpaFanOut: true,
    param: { accountId: 'WAJIB: id akun dari alat akun', from: TGL, to: TGL },
    ringkas: 'Buku besar satu akun gerai: mutasi dan saldo berjalan.'
  },
  {
    id: 'laba_rugi', path: '/api/admin/accounting/profit-loss', lingkup: 'gerai',
    param: { from: TGL, to: TGL },
    ringkas: 'Laporan laba rugi dari jurnal gerai.'
  },
  {
    id: 'neraca', path: '/api/admin/accounting/balance-sheet', lingkup: 'gerai',
    param: { asOf: `per tanggal ${TGL}` },
    ringkas: 'Neraca gerai per tanggal: aset, kewajiban, ekuitas.'
  },
  {
    id: 'setting_akuntansi', path: '/api/admin/settings/accounting', lingkup: 'gerai',
    ringkas: 'Setting Akuntansi gerai: cara bayar beserta akun dan Rekening Bersama-nya, kategori barang, aturan jurnal, kategori transaksi.'
  },
  {
    id: 'jurnal_entity', path: '/api/entity-admin/journals', lingkup: 'entity',
    param: { from: TGL, to: TGL, limit: 'maks 500' },
    ringkas: 'Jurnal buku entity.'
  },
  {
    id: 'akun_entity', path: '/api/entity-admin/accounts', lingkup: 'entity',
    ringkas: 'Daftar akun buku entity.'
  },

  // --- orang: pelanggan, karyawan, supplier, kasir ---------------------------
  {
    id: 'pelanggan', path: '/api/admin/customers', lingkup: 'gerai',
    ringkas: 'Daftar pelanggan gerai beserta poin dan koin (kontak disamarkan).'
  },
  {
    id: 'koin_pelanggan', path: '/api/admin/customers/coin-alerts', lingkup: 'gerai',
    ringkas: 'Pelanggan yang koinnya hampir habis/kedaluwarsa.'
  },
  {
    id: 'permintaan_pelanggan', path: '/api/admin/customer-requests', lingkup: 'gerai',
    ringkas: 'Permintaan keanggotaan pelanggan yang masuk.'
  },
  {
    id: 'masukan_pelanggan', path: '/api/admin/customer-feedback', lingkup: 'gerai',
    param: { category: 'kategori masukan' },
    ringkas: 'Kritik, saran, dan masukan dari pelanggan.'
  },
  {
    id: 'voucher', path: '/api/admin/vouchers', lingkup: 'gerai',
    ringkas: 'Daftar voucher gerai.'
  },
  {
    id: 'karyawan', path: '/api/admin/employees', lingkup: 'gerai',
    param: { history: '1 untuk ikut riwayat' },
    ringkas: 'Master karyawan entity yang terkait gerai ini (kontak dan identitas disamarkan).'
  },
  {
    id: 'supplier', path: '/api/admin/suppliers', lingkup: 'gerai',
    ringkas: 'Master supplier gerai.'
  },
  {
    id: 'kasir', path: '/api/admin/cashiers', lingkup: 'gerai',
    ringkas: 'Daftar akun kasir gerai beserta status (tanpa kata sandi).'
  },
  {
    id: 'raport_kasir', path: '/api/admin/cashier-raport', lingkup: 'gerai',
    ringkas: 'Raport kasir: presensi, kinerja, dan penilaian.'
  },
  {
    id: 'presensi', path: '/api/admin/attendance-report', lingkup: 'gerai',
    param: { from: TGL, to: TGL },
    ringkas: 'Laporan presensi karyawan gerai untuk satu periode.'
  },

  // --- laci, izin, pengumuman ------------------------------------------------
  {
    id: 'laci', path: '/api/admin/drawers', lingkup: 'gerai',
    ringkas: 'Daftar laci kasir (sesi buka/tutup, selisih).'
  },
  {
    id: 'izin_tutup_laci', path: '/api/admin/drawer/close-permits', lingkup: 'gerai',
    param: { status: 'PENDING | APPROVED | REJECTED | USED' },
    ringkas: 'Izin tutup laci.'
  },
  {
    id: 'izin_presensi_koreksi', path: '/api/admin/attendance-correction-permits', lingkup: 'gerai',
    param: { status: 'status izin' },
    ringkas: 'Izin koreksi presensi.'
  },
  {
    id: 'izin_presensi_gps', path: '/api/admin/attendance-gps-permits', lingkup: 'gerai',
    param: { status: 'status izin' },
    ringkas: 'Izin presensi di luar lokasi (GPS).'
  },
  {
    id: 'laporan_izin', path: '/api/admin/permit-report', lingkup: 'gerai',
    param: { category: 'kategori izin', from: TGL, to: TGL, status: 'status izin' },
    ringkas: 'Rekap semua jenis izin untuk satu periode.'
  },
  {
    id: 'pengumuman', path: '/api/admin/announcements', lingkup: 'gerai',
    ringkas: 'Pengumuman untuk staf.'
  },
  {
    id: 'tugas_harian', path: '/api/admin/daily-task-templates', lingkup: 'gerai',
    ringkas: 'Template tugas harian staf.'
  },
  {
    id: 'buku_panduan', path: '/api/admin/manual-book', lingkup: 'gerai',
    ringkas: 'Buku panduan staf.'
  },
  {
    id: 'setting_gudang', path: '/api/admin/settings/warehouse', lingkup: 'gerai',
    ringkas: 'Setting gudang gerai.'
  },

  // --- tingkat entity ---------------------------------------------------------
  {
    id: 'daftar_gerai', path: '/api/entity-admin/stores', lingkup: 'entity',
    ringkas: 'Daftar gerai milik entity beserta kode dan status.'
  }
].map((api) => Object.freeze({ param: {}, berat: false, ...api })));

const INDEKS = new Map(KATALOG.map((api) => [api.id, api]));

export function cariApi(id) {
  return INDEKS.get(id) ?? null;
}

export const ID_API = Object.freeze(KATALOG.map((api) => api.id));

/** Satu baris per API untuk prompt model. */
export function daftarApiUntukModel() {
  return KATALOG.map((api) => {
    const param = Object.entries(api.param).map(([nama, arti]) => `${nama}=${arti}`).join('; ');
    return `- ${api.id}${api.lingkup === 'entity' ? ' [entity]' : ''}${api.berat ? ' [berat]' : ''}${api.tanpaFanOut ? ' [satu gerai]' : ''}: ${api.ringkas}${param ? ` (param: ${param})` : ''}`;
  }).join('\n');
}

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const ANGKA = /^\d{1,9}$/;
const KATA = /^[\p{L}\p{N} _\-.:]{1,60}$/u;

/**
 * Menyusun alamat dari pilihan model. Hanya parameter yang diizinkan katalog
 * yang lolos, dan nilainya divalidasi bentuknya; sisanya dibuang. `id` dipakai
 * sebagai bagian path (":id") bila ada.
 *
 * @returns {{ok:true, alamat:string, dipakai:Record<string,string>} | {ok:false, error:string}}
 */
export function bangunAlamat(api, pasangan = []) {
  const diminta = new Map();
  for (const pasang of Array.isArray(pasangan) ? pasangan : []) {
    const kunci = String(pasang?.kunci ?? '').trim();
    const nilai = String(pasang?.nilai ?? '').trim();
    if (kunci && nilai && Object.hasOwn(api.param, kunci)) diminta.set(kunci, nilai);
  }

  const dipakai = {};
  for (const [kunci, nilai] of diminta) {
    const tanggal = /^(from|to|asOf)$/.test(kunci);
    if (tanggal && !TANGGAL.test(nilai)) return { ok: false, error: `Parameter ${kunci} harus berbentuk ${TGL}.` };
    if ((kunci === 'limit' || kunci === 'id') && !ANGKA.test(nilai)) return { ok: false, error: `Parameter ${kunci} harus angka.` };
    if (!tanggal && kunci !== 'limit' && kunci !== 'id' && !KATA.test(nilai)) return { ok: false, error: `Nilai parameter ${kunci} tidak valid.` };
    dipakai[kunci] = nilai;
  }

  let path = api.path;
  if (path.includes(':id')) {
    if (!dipakai.id) return { ok: false, error: `API ${api.id} butuh parameter id.` };
    path = path.replace(':id', dipakai.id);
    delete dipakai.id;
  }
  if (api.param.accountId && api.path.endsWith('/ledger') && !dipakai.accountId) {
    return { ok: false, error: `API ${api.id} butuh parameter accountId.` };
  }

  // Parameter tetap dari katalog (bukan dari model), mis. ringkas=1.
  const query = new URLSearchParams({ ...dipakai, ...(api.tetap ?? {}) }).toString();
  return { ok: true, alamat: query ? `${path}?${query}` : path, dipakai };
}

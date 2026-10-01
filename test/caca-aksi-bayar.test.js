import test from 'node:test';
import assert from 'node:assert/strict';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { jawabPertanyaan } from '../src/caca-agen.js';

const HARI_INI = '2026-10-01';

const BEA = {
  employees: [{ id: 'emp_rina', fullName: 'Rina Lestari' }, { id: 'emp_budi', fullName: 'Budi Santoso' }],
  suppliers: [{ id: 'sup_haji', name: 'Pak Haji Lapak' }]
};

const HUTANG = {
  sharedAccounts: [{ id: 'rek_bca', name: 'BCA Bersama' }],
  deposits: [
    { id: 'dep_pln', categoryLabel: 'Uang Muka Listrik', counterpartyName: 'PLN', balanceRupiah: 500000 },
    { id: 'dep_ig', categoryLabel: 'Uang Muka Iklan', counterpartyName: 'Instagram', balanceRupiah: 0 }
  ],
  persons: [
    {
      counterpartyName: 'Rina Lestari',
      accounts: [
        { accountKey: 'GAJI|emp:rina', account: 'GAJI', label: 'Hutang Gaji', balanceRupiah: 700000, payableByAdmin: true },
        { accountKey: 'LAINNYA|emp:rina', account: 'BEA_LAINNYA', label: 'Hutang Lainnya', balanceRupiah: 50000, payableByAdmin: true }
      ]
    },
    {
      counterpartyName: 'Pak Haji Lapak',
      accounts: [{ accountKey: 'LAPAK|sup:haji', account: 'BEA_LAPAK', label: 'Hutang Lapak', balanceRupiah: 1500000, payableByAdmin: true }]
    },
    {
      counterpartyName: 'Kasir Andi',
      accounts: [{ accountKey: 'SETORAN|andi', account: 'SETORAN', label: 'Piutang Setoran', balanceRupiah: 20000, payableByAdmin: false }]
    }
  ]
};

function jalurPalsu({ hutang = HUTANG } = {}) {
  const terkirim = [];
  const dibaca = [];
  return {
    terkirim,
    dibaca,
    baca: async (path) => {
      dibaca.push(path);
      if (path === '/api/admin/operational-expenses') return { ok: true, data: BEA };
      if (path === '/api/admin/hutang-piutang') return { ok: true, data: hutang };
      return { ok: false, error: `jalur tidak dikenal: ${path}` };
    },
    kirim: async (method, path, body) => {
      terkirim.push({ method, path, body });
      return { ok: true, data: {} };
    },
    hariIni: HARI_INI,
    namaLingkup: 'Leker Beji',
    lingkup: 'gerai'
  };
}

// --- tunai / kas: pagar utama permintaan Bos Cyo ----------------------------

test('apa pun yang dibayar tunai/kas ditolak sebelum membaca data apa pun', async () => {
  for (const cara of ['tunai', 'cash', 'kas', 'pakai uang laci', 'Kontan']) {
    const jalur = jalurPalsu();
    const hasil = await cariAksi('bayar_lainnya').siapkan({
      lainnya_keterangan: 'token listrik', lainnya_nominal: '100rb', bayar_cara: cara
    }, jalur);
    assert.equal(hasil.ok, false, cara);
    assert.match(hasil.tanya, /tidak Una catat/, cara);
    assert.equal(jalur.dibaca.length, 0, cara);
  }
});

test('cara bayar yang tidak disebut ditanyakan, tidak diisi bawaan', async () => {
  const hasil = await cariAksi('bayar_lainnya').siapkan({ lainnya_keterangan: 'token listrik', lainnya_nominal: '100rb' }, jalurPalsu());
  assert.match(hasil.tanya, /Dibayar lewat apa/);
});

// --- Bea Gaji ---------------------------------------------------------------

test('Bea Gaji: karyawan dicocokkan ke master, nominal dan tanggal oleh kode', async () => {
  const hasil = await cariAksi('catat_bea_gaji').siapkan({
    gaji_karyawan: 'rina', gaji_keterangan: 'gaji minggu ke-1', gaji_nominal: '700rb'
  }, jalurPalsu());
  assert.deepEqual(hasil.draft.muatan, {
    category: 'BEA_GAJI', description: 'gaji minggu ke-1', amount: 700000, employeeId: 'emp_rina', businessDate: HARI_INI
  });
});

test('Bea Gaji: potongan tercatat minus dan disebut sebagai potongan', async () => {
  const hasil = await cariAksi('catat_bea_gaji').siapkan({
    gaji_karyawan: 'Budi', gaji_keterangan: 'potongan kasbon', gaji_nominal: '-50rb'
  }, jalurPalsu());
  assert.equal(hasil.draft.muatan.amount, -50000);
  assert.match(hasil.draft.dampak[0], /berkurang 50\.000/);
});

test('Bea Gaji: karyawan yang tidak ada ditanyakan', async () => {
  const hasil = await cariAksi('catat_bea_gaji').siapkan({
    gaji_karyawan: 'Joko', gaji_keterangan: 'gaji', gaji_nominal: '700rb'
  }, jalurPalsu());
  assert.equal(hasil.ok, false);
  assert.match(hasil.tanya, /Joko/);
});

// --- Bea Lapak --------------------------------------------------------------

test('Bea Lapak: supplier terdaftar dipakai kalau namanya persis, selain itu nama bebas yang disebut terang', async () => {
  const keSupplier = await cariAksi('catat_bea_lapak').siapkan({ lapak_pihak: 'pak haji lapak', lapak_nominal: '1,5jt' }, jalurPalsu());
  assert.equal(keSupplier.draft.muatan.counterpartyType, 'SUPPLIER');
  assert.equal(keSupplier.draft.muatan.amount, 1500000);

  const keOrangLain = await cariAksi('catat_bea_lapak').siapkan({ lapak_pihak: 'Bu Sri', lapak_nominal: '800rb' }, jalurPalsu());
  assert.equal(keOrangLain.draft.muatan.counterpartyType, 'OTHER');
  assert.match(keOrangLain.draft.baris[0][1], /bukan supplier terdaftar/);
});

// --- Pembayaran Lainnya -----------------------------------------------------

test('bayar lainnya: Rekening Bersama satu-satunya dipakai, transfer jadi BANK', async () => {
  const rekber = await cariAksi('bayar_lainnya').siapkan({
    lainnya_keterangan: 'iklan', lainnya_nominal: '200rb', bayar_cara: 'rekber'
  }, jalurPalsu());
  assert.equal(rekber.draft.muatan.paymentMethod, 'REKBER');
  assert.equal(rekber.draft.muatan.sharedAccountId, 'rek_bca');

  const bank = await cariAksi('bayar_lainnya').siapkan({
    lainnya_jenis: 'lapak', lainnya_keterangan: 'sewa', lainnya_nominal: '1jt', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.equal(bank.draft.muatan.paymentMethod, 'BANK');
  assert.equal(bank.draft.muatan.category, 'BEA_LAPAK');
});

test('bayar lainnya: deposit dicocokkan lewat jenisnya, saldo kurang ditanyakan', async () => {
  const pas = await cariAksi('bayar_lainnya').siapkan({
    lainnya_keterangan: 'token listrik', lainnya_nominal: '350rb', bayar_cara: 'deposit listrik'
  }, jalurPalsu());
  assert.equal(pas.draft.muatan.depositId, 'dep_pln');

  const kurang = await cariAksi('bayar_lainnya').siapkan({
    lainnya_keterangan: 'token listrik', lainnya_nominal: '600rb', bayar_cara: 'deposit listrik'
  }, jalurPalsu());
  assert.match(kurang.tanya, /tinggal 500\.000/);
});

// --- Pelunasan hutang -------------------------------------------------------

test('bayar hutang: "lunas" memakai sisa hutang, dan pihak dengan banyak hutang ditanya jenisnya', async () => {
  const lunas = await cariAksi('bayar_hutang').siapkan({
    hutang_pihak: 'pak haji', hutang_nominal: 'lunas', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.equal(lunas.draft.muatan.amount, 1500000);
  assert.equal(lunas.draft.muatan.accountKey, 'LAPAK|sup:haji');
  assert.match(lunas.draft.dampak[0], /lunas/);

  const ambigu = await cariAksi('bayar_hutang').siapkan({
    hutang_pihak: 'Rina', hutang_nominal: '100rb', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.match(ambigu.tanya, /beberapa hutang/);

  const jelas = await cariAksi('bayar_hutang').siapkan({
    hutang_pihak: 'Rina', hutang_jenis: 'gaji', hutang_nominal: '300rb', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.equal(jelas.draft.muatan.accountKey, 'GAJI|emp:rina');
  assert.match(jelas.draft.dampak[0], /tinggal 400\.000/);
});

test('bayar hutang: melebihi sisa ditanyakan; piutang setoran laci tidak bisa dibayar lewat Una', async () => {
  const lebih = await cariAksi('bayar_hutang').siapkan({
    hutang_pihak: 'pak haji', hutang_nominal: '2jt', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.match(lebih.tanya, /cuma 1\.500\.000/);

  const laci = await cariAksi('bayar_hutang').siapkan({
    hutang_pihak: 'Kasir Andi', hutang_nominal: '20rb', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.equal(laci.ok, false);
});

// --- Uang Muka --------------------------------------------------------------

test('uang muka: tidak bisa dibayar dari deposit, dibayar transfer tercatat dengan jenisnya', async () => {
  const dariDeposit = await cariAksi('buat_uang_muka').siapkan({
    um_jenis: 'listrik', um_nominal: '1jt', bayar_cara: 'deposit'
  }, jalurPalsu());
  assert.match(dariDeposit.tanya, /tidak bisa dibayar dari Deposit/);

  const transfer = await cariAksi('buat_uang_muka').siapkan({
    um_jenis: 'listrik', um_pihak: 'PLN', um_nominal: '1jt', bayar_cara: 'transfer'
  }, jalurPalsu());
  assert.equal(transfer.draft.muatan.category, 'DEPOSIT_LISTRIK');
  assert.equal(transfer.draft.muatan.paymentMethod, 'BANK');
});

// --- ujung ke ujung ----------------------------------------------------------

test('agen → konfirmasi: pelunasan diposting persis seperti draft, ke endpoint layar', async () => {
  const jalur = jalurPalsu();
  const { draft } = await jawabPertanyaan('lunasi hutang lapak pak haji transfer', {
    nama: 'Bos', peran: 'Entity Admin', lingkup: 'gerai', namaLingkup: 'Leker Beji', storeCode: 'G001', storeName: 'Leker Beji', hariIni: HARI_INI
  }, {
    env: {},
    jalurAksi: jalur,
    panggilModel: async () => ({ ok: true, value: { alat: 'bayar_hutang', hutang_pihak: 'pak haji', hutang_nominal: 'lunas', bayar_cara: 'transfer' } })
  });
  assert.equal(jalur.terkirim.length, 0, 'belum ada yang terkirim sebelum Ya');

  const diperiksa = await periksaUlangDraft(draft, jalur);
  assert.equal(diperiksa.ok, true);
  await diperiksa.aksi.posting(diperiksa.draft, jalur);
  assert.equal(jalur.terkirim[0].path, '/api/admin/hutang-piutang/payments');
  assert.deepEqual(jalur.terkirim[0].body, draft.muatan);

  // Hutangnya sudah dibayar sebagian dari layar sebelum "Ya" ditekan: draft lama ditolak.
  const berubah = structuredClone(HUTANG);
  berubah.persons[1].accounts[0].balanceRupiah = 1000000;
  const ditolak = await periksaUlangDraft(draft, jalurPalsu({ hutang: berubah }));
  assert.equal(ditolak.ok, false);
});

test('semua alat bayar hanya ada di lingkup gerai', () => {
  for (const nama of ['catat_bea_gaji', 'catat_bea_lapak', 'bayar_lainnya', 'bayar_hutang', 'buat_uang_muka']) {
    assert.equal(cariAksi(nama).lingkup, 'gerai', nama);
  }
});

// Una pernah memanggil handler modul langsung dan melewati jembatan
// Akuntansi yang dipasang di pintu masuk utama: Bea yang dicatat Una tidak
// pernah dijurnal. Penjaga ini memastikan index.js tetap menyerahkan pintu
// masuk utamanya ke Una.
test('index.js menyerahkan pintu masuk utama ke Una', async () => {
  const { readFileSync } = await import('node:fs');
  const sumber = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(sumber, /handleCacaApi\(request, env, pathname, \{\s*jalurUtama: \(permintaan\) => handleApi\(permintaan, env, new URL\(permintaan\.url\)\)/);
});

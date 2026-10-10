import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jawabPertanyaan } from '../src/caca-agen.js';
import { cariAksi, periksaUlangDraft } from '../src/caca-aksi.js';
import { KAMUS, jelaskan, denganTawaranKerja, TEKS_MINTA_KERJAKAN } from '../src/caca-jelaskan.js';
import { uraiJadwal, teksHari, potongJadwal, URUT_TAMPIL, NAMA_HARI } from '../src/caca-jadwal.js';
import { uraiPesanKaryawan, uraiPesanGaji, passwordAcak } from '../src/caca-aksi-karyawan.js';
import { mintaDikerjakan, permintaanMurni } from '../src/caca-tertunda.js';
import { bangunJalurAksi } from '../src/caca-chat.js';

// Bos Cyo 2026-10-10 (tangkapan layar): "cara bikin karyawan baru gimana?" dijawab
// panduan, lalu "kamu bisa buatin itu?" dijawab daftar kemampuan umum — "pertanyaan
// kedua kan masih nyambung dengan pertanyaan pertama". Dan: "pastikan una juga bisa
// mengerjakan yang apabila ditanya mekanismenya aja juga bisa".

const KONTEKS = { nama: 'Bos', peran: 'Entity Admin', storeCode: 'TESTINGUNA', storeName: 'Testing Una', hariIni: '2026-10-10', lingkup: 'gerai', namaLingkup: 'Testing Una' };
const JADWAL_LAMA = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isDayOff: false, shiftStart: '09:00', shiftEnd: '17:00' }));

function jalurPalsu({ employees = [], cashiers = [] } = {}) {
  const kiriman = [];
  return {
    kiriman,
    baca: async (p) => {
      if (p === '/api/admin/employees') return { ok: true, data: { employees, linkableAccounts: [] } };
      if (p === '/api/admin/cashiers') return { ok: true, data: { cashiers } };
      return { ok: false, error: `tidak terduga: ${p}` };
    },
    kirim: async (method, path, body) => {
      kiriman.push({ method, path, body });
      if (path === '/api/admin/employees') return { ok: true, data: { ok: true, id: 'emp_baru' } };
      if (path === '/api/admin/cashiers') return { ok: true, data: { ok: true, id: 'cashier_baru' } };
      return { ok: true, data: { ok: true } };
    }
  };
}

function model(...balasan) {
  const panggilan = [];
  return { panggilan, panggilModel: async (env, p) => { panggilan.push(p); return balasan[panggilan.length - 1] ?? { ok: false, status: 502, error: 'habis' }; } };
}
const pilih = (alat, isi = {}) => ({ ok: true, value: { alat, ...isi } });

test('tangkapan layar: "cara bikin karyawan baru" → "kamu bisa buatin itu?" nyambung ke alat buat_karyawan', async () => {
  const jalur = jalurPalsu();
  const m = model();
  const satu = await jawabPertanyaan('cara bikin karyawan baru gimana?', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur });
  assert.equal(satu.alat, 'jelaskan');
  assert.match(satu.jawaban, /Tambah karyawan/);
  assert.match(satu.jawaban, /Mau Una yang buatkan\?/);
  assert.deepEqual(satu.tertunda, { alat: 'buat_karyawan', tangkapan: {}, tanya: satu.tertunda.tanya, kurang: null, tawaran: true });
  assert.equal(satu.tawaran[0].teks, TEKS_MINTA_KERJAKAN, 'tombol sekali ketuk "Una buatkan karyawan"');
  assert.equal(m.panggilan.length, 1, 'satu pemeriksaan kecil; model gagal → teks panduan asli');

  // Persis kalimat Bos: permintaan tanpa isian → alatnya sudah pasti, model tidak ditanya.
  const dua = await jawabPertanyaan('kamu bisa buatin itu?', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda: satu.tertunda });
  assert.equal(m.panggilan.length, 1, 'permintaan murni tidak menambah panggilan');
  assert.equal(dua.alat, 'buat_karyawan');
  assert.equal(dua.belumLengkap, true);
  assert.match(dua.jawaban, /Nama lengkap karyawannya siapa\?/);
  assert.doesNotMatch(dua.jawaban, /Una bisa mengerjakan bagian/, 'bukan daftar kemampuan umum lagi');
  assert.equal(dua.tertunda.alat, 'buat_karyawan');
  assert.equal(dua.tertunda.kurang, 'kr_nama');
  assert.equal(dua.tertunda.tawaran, undefined, 'sudah jadi tugas biasa');

  // Jawaban nama → draft. Model memilih alat lain pun, isian tetap untuk tugas ini.
  const m3 = model(pilih('tidak_ada'));
  const tiga = await jawabPertanyaan('Rika Nur', KONTEKS, { env: {}, panggilModel: m3.panggilModel, jalurAksi: jalur, tertunda: dua.tertunda });
  assert.equal(tiga.perluKonfirmasi, true, tiga.jawaban);
  assert.equal(tiga.draft.aksi, 'buat_karyawan');
  assert.equal(tiga.draft.muatan.nama, 'Rika Nur');
  assert.equal(tiga.draft.muatan.akun, null);
});

test('permintaan yang membawa isian: model ditanya, tapi alatnya tetap yang ditawarkan', async () => {
  const jalur = jalurPalsu();
  const tertunda = denganTawaranKerja(jelaskan('karyawan_tambah')).tertunda;
  // Model "salah" memilih jelaskan (seperti di layar Bos), tapi menangkap namanya.
  const m = model(pilih('jelaskan', { jelaskan_topik: 'kemampuan', kr_nama: 'Budi Santoso' }));
  const hasil = await jawabPertanyaan('bisa tolong buatin buat Budi Santoso?', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda });
  assert.equal(m.panggilan.length, 1);
  assert.match(m.panggilan[0].content[0].text, /BARU SAJA menjelaskan caranya/);
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  assert.equal(hasil.draft.muatan.nama, 'Budi Santoso');
});

test('tawaran dilepas kalau Bos tidak meminta: "oke makasih", pertanyaan cara yang lain', async () => {
  const tertunda = denganTawaranKerja(jelaskan('karyawan_tambah')).tertunda;
  const m = model(pilih('tidak_ada', { alasan_kosong: 'obrolan' }));
  const makasih = await jawabPertanyaan('oke makasih', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalurPalsu(), tertunda });
  assert.notEqual(makasih.alat, 'buat_karyawan');
  assert.equal(m.panggilan.length, 1);
  assert.doesNotMatch(m.panggilan[0].content[0].text, /TUGAS YANG SEDANG UNA KERJAKAN/);

  const m2 = model();
  const cara = await jawabPertanyaan('cara bikin akun cs gimana?', KONTEKS, { env: {}, panggilModel: m2.panggilModel, jalurAksi: jalurPalsu(), tertunda });
  assert.equal(cara.alat, 'jelaskan');
  assert.match(cara.jawaban, /Akun Kasir/);
  assert.deepEqual(cara.tertunda.tangkapan, { kr_akun: true }, 'panduan akun CS menawarkan akun login');
  assert.equal(m2.panggilan.length, 1, 'hanya pemeriksaan panduan, bukan pilih-alat');
});

test('alat baca juga bisa ditawarkan: "setoran cs" → "cekin dong" langsung angkanya', async () => {
  const tertunda = denganTawaranKerja(jelaskan('setoran_cs')).tertunda;
  assert.equal(tertunda.alat, 'cek_setoran_cs');
  const jalur = {
    baca: async () => ({ ok: true, data: { balances: [{ employeeName: 'Rika', balanceRupiah: 150000, pendingAmountRupiah: 0 }], pending: [] } }),
    kirim: async () => ({ ok: false })
  };
  const m = model();
  const hasil = await jawabPertanyaan('cekin dong', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur, tertunda });
  assert.equal(m.panggilan.length, 0);
  assert.equal(hasil.alat, 'cek_setoran_cs');
  assert.match(hasil.jawaban, /Rp150\.000/);
});

test('buat_karyawan + akun login: jadwal, gaji, password dibuat server dan tidak masuk draft', async () => {
  const jalur = jalurPalsu();
  const pesan = 'tambah karyawan namanya Rika Nur hp 0812 3456 7890, buatin akunnya username rika, gaji 12rb per jam, senin sampai sabtu 09.00-17.00, minggu libur';
  const m = model(pilih('buat_karyawan', { kr_nama: 'Rika Nur' }));
  const hasil = await jawabPertanyaan(pesan, KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  const { draft } = hasil;
  assert.equal(draft.muatan.hp, '081234567890');
  assert.equal(draft.muatan.akun.username, 'rika');
  assert.equal(draft.muatan.akun.gaji, 12000);
  assert.equal(draft.muatan.akun.paymentType, 'JAM');
  assert.equal(draft.muatan.akun.jadwal[0].isDayOff, true, 'Minggu libur');
  assert.equal(draft.muatan.akun.jadwal[3].shiftStart, '09:00');
  assert.deepEqual(draft.tabel.isi[0], ['Senin', '09:00–17:00']);
  assert.doesNotMatch(JSON.stringify(draft), /"password"\s*:/i);

  // "Ya": draft disusun ulang dari tangkapannya sendiri, lalu dikirim lewat jalur layar.
  const diperiksa = await periksaUlangDraft(draft, { ...jalur, hariIni: KONTEKS.hariIni, namaLingkup: 'Testing Una', lingkup: 'gerai' });
  assert.equal(diperiksa.ok, true, diperiksa.error);
  const posting = await cariAksi('buat_karyawan').posting(diperiksa.draft, jalur);
  assert.equal(posting.ok, true, posting.error);
  assert.deepEqual(jalur.kiriman.map((k) => `${k.method} ${k.path}`), [
    'POST /api/admin/employees', 'POST /api/admin/cashiers', 'POST /api/admin/employees/emp_baru/links'
  ]);
  const akun = jalur.kiriman[1].body;
  assert.equal(akun.username, 'rika');
  assert.equal(akun.employeeName, 'Rika Nur');
  assert.equal(akun.hourlyWage, 12000);
  assert.equal(akun.schedule.length, 7);
  assert.equal(akun.password.length, 8);
  assert.deepEqual(jalur.kiriman[2].body, { accountType: 'CASHIER', accountId: 'cashier_baru' });
  assert.equal(posting.rahasia.nilai, akun.password, 'password ditampilkan panel sekali');
  assert.ok(!posting.jawaban.includes(akun.password), 'jawaban (masuk riwayat → mesin AI) tidak memuat password');
});

test('buat_karyawan: orang yang sudah ada tidak dibuat dobel; username ditanya kalau belum ada', async () => {
  const employees = [{ id: 'emp_rika', fullName: 'Rika Nur', status: 'ACTIVE', links: [] }];
  const aksi = cariAksi('buat_karyawan');
  const tanpaUser = await aksi.siapkan({ kr_nama: 'Rika Nur', kr_akun: true }, { ...jalurPalsu({ employees }) });
  assert.equal(tanpaUser.ok, false);
  assert.equal(tanpaUser.kurang, 'kr_username');
  const jalur = jalurPalsu({ employees });
  const jadi = await aksi.siapkan({ kr_nama: 'rika nur', kr_akun: true, kr_username: 'rika aja' }, jalur);
  assert.equal(jadi.ok, true, jadi.tanya);
  assert.equal(jadi.draft.muatan.employeeId, 'emp_rika');
  assert.equal(jadi.draft.muatan.akun.username, 'rika');
  await aksi.posting(jadi.draft, jalur);
  assert.deepEqual(jalur.kiriman.map((k) => k.path), ['/api/admin/cashiers', '/api/admin/employees/emp_rika/links']);

  const sudahPunya = await aksi.siapkan({ kr_nama: 'Rika Nur', kr_akun: true, kr_username: 'rika2' }, jalurPalsu({
    employees: [{ ...employees[0], links: [{ accountType: 'CASHIER', username: 'rika', effectiveTo: null }] }]
  }));
  assert.equal(sudahPunya.ok, false);
  assert.match(sudahPunya.tanya, /sudah punya akun login \(rika\)/);
});

test('penyesuaian_gaji: "potong gaji rika 20rb kemarin karena telat" dihitung kode', async () => {
  const cashiers = [{ id: 'cashier_rika', username: 'rika', employeeName: 'Rika Nur', isActive: true, schedule: [] }];
  const jalur = jalurPalsu({ cashiers });
  const m = model(pilih('penyesuaian_gaji', { pg_orang: 'rika' }));
  const hasil = await jawabPertanyaan('potong gaji rika 20rb kemarin karena telat', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  assert.deepEqual(hasil.draft.muatan, { cashierId: 'cashier_rika', employeeName: 'Rika Nur', businessDate: '2026-10-09', amountRupiah: -20000, reason: 'telat' });
  const diperiksa = await periksaUlangDraft(hasil.draft, { ...jalur, hariIni: KONTEKS.hariIni, lingkup: 'gerai' });
  assert.equal(diperiksa.ok, true, diperiksa.error);
  await cariAksi('penyesuaian_gaji').posting(diperiksa.draft, jalur);
  assert.deepEqual(jalur.kiriman[0], { method: 'POST', path: '/api/admin/cashiers/cashier_rika/payroll', body: { businessDate: '2026-10-09', amountRupiah: -20000, reason: 'telat' } });

  // Tanpa alasan → ditanya (server mewajibkan; terlihat karyawan).
  const tanpaAlasan = await cariAksi('penyesuaian_gaji').siapkan({ pg_orang: 'rika', pg_nominal: '20rb', pg_jenis: 'tambah' }, { ...jalur, hariIni: KONTEKS.hariIni });
  assert.equal(tanpaAlasan.kurang, 'pg_alasan');
  assert.equal(uraiPesanGaji('bonus lembur budi 30rb tgl 5', '2026-10-10').pg_tanggal, '2026-10-05');
  assert.equal(uraiPesanGaji('bonus budi 30rb tgl 25', '2026-10-10').pg_tanggal, '2026-09-25', 'tanggal di depan = bulan lalu');
});

test('atur_jadwal_kasir: hari yang tidak disebut tetap, PATCH tidak menonaktifkan akun', async () => {
  const cashiers = [{ id: 'cashier_rika', username: 'rika', employeeName: 'Rika Nur', isActive: true, schedule: JADWAL_LAMA }];
  const jalur = jalurPalsu({ cashiers });
  const m = model(pilih('atur_jadwal_kasir', { jk_orang: 'Rika' }));
  const hasil = await jawabPertanyaan('jadwal rika ganti: sabtu libur, minggu 10.00-15.00', KONTEKS, { env: {}, panggilModel: m.panggilModel, jalurAksi: jalur });
  assert.equal(hasil.perluKonfirmasi, true, hasil.jawaban);
  const isi = Object.fromEntries(hasil.draft.tabel.isi.map(([hari, lama, jadi]) => [hari, [lama, jadi]]));
  assert.deepEqual(isi.Senin, ['09:00–17:00', '09:00–17:00']);
  assert.deepEqual(isi.Sabtu, ['09:00–17:00', 'Libur']);
  assert.deepEqual(isi.Minggu, ['belum diatur', '10:00–15:00']);
  await cariAksi('atur_jadwal_kasir').posting(hasil.draft, jalur);
  const kirim = jalur.kiriman[0];
  assert.equal(kirim.method, 'PATCH');
  assert.equal(kirim.path, '/api/admin/cashiers/cashier_rika');
  assert.equal(kirim.body.isActive, true);
  assert.equal(kirim.body.username, 'rika');
  assert.equal(kirim.body.schedule[6].isDayOff, true);
});

test('pembaca jadwal: rentang hari, libur, "jam 9 sampai 5 sore", hari tanpa jam ditanya', () => {
  const baca = (t) => {
    const r = uraiJadwal(t);
    return r.ok ? URUT_TAMPIL.map((n) => `${NAMA_HARI[n]} ${teksHari(r.hari[n])}`).join(' | ') : `? ${r.tanya}`;
  };
  assert.equal(baca('senin 09.00-22.00, selasa sampai sabtu 09.00-18.00, minggu libur'),
    'Senin 09:00–22:00 | Selasa 09:00–18:00 | Rabu 09:00–18:00 | Kamis 09:00–18:00 | Jumat 09:00–18:00 | Sabtu 09:00–18:00 | Minggu Libur');
  assert.match(baca('tiap hari jam 8 sampai 4 sore'), /^Senin 08:00–16:00 .* Minggu 08:00–16:00$/);
  assert.equal(baca('senin, rabu, jumat 09-17'), 'Senin 09:00–17:00 | Selasa belum diatur | Rabu 09:00–17:00 | Kamis belum diatur | Jumat 09:00–17:00 | Sabtu belum diatur | Minggu belum diatur');
  assert.match(baca('jumat sampai senin 22.00-06.00'), /Senin 22:00–06:00 .* Jumat 22:00–06:00 \| Sabtu 22:00–06:00 \| Minggu 22:00–06:00/);
  assert.match(baca('senin jam 9'), /^\? Hari Senin jam berapa/);
  assert.equal(potongJadwal('username rika, gaji 12rb, senin-sabtu 9-17'), 'senin-sabtu 9-17');
  const k = uraiPesanKaryawan('tambah karyawan namanya Budi, hp 0857-1111-2222, sebagai barista, upah 50rb per sesi');
  assert.equal(k.kr_nama, 'Budi');
  assert.equal(k.kr_hp, '085711112222');
  assert.equal(k.kr_jabatan, 'barista');
  assert.equal(k.kr_gaji, '50rb per sesi');
  assert.match(passwordAcak(), /^[a-z2-9]{8}$/);
});

test('mintaDikerjakan / permintaanMurni', () => {
  for (const t of ['kamu bisa buatin itu?', 'iya boleh', 'tolong kerjain ya', 'gas', 'cekin dong']) assert.equal(mintaDikerjakan(t), true, t);
  for (const t of ['oke makasih', 'nanti aja', 'ga usah', 'udah cukup', 'gimana kalau telat?']) assert.equal(mintaDikerjakan(t), false, t);
  assert.equal(permintaanMurni('kamu bisa buatin itu?'), true);
  assert.equal(permintaanMurni(TEKS_MINTA_KERJAKAN), true);
  assert.equal(permintaanMurni('buatin buat Rika Nur'), false);
});

// Pagar: setiap panduan cara-pakai menyatakan alat yang mengerjakannya, atau alasan
// tertulis kenapa tidak. Panduan baru tidak bisa lolos tanpa memikirkan ini.
test('pagar: tiap entri kamus punya `aksi` yang sah atau `tanpaAksi` beralasan', () => {
  for (const entri of KAMUS) {
    if (entri.tanpaAksi) {
      assert.ok(!entri.aksi, `${entri.id}: pilih salah satu`);
      assert.ok(String(entri.tanpaAksi).length >= 10, `${entri.id}: alasan tanpaAksi terlalu pendek`);
      continue;
    }
    assert.ok(entri.aksi, `${entri.id}: belum punya aksi atau tanpaAksi`);
    const { alat, tawar, tombol } = entri.aksi;
    assert.ok(alat === 'catat_pengeluaran' || cariAksi(alat), `${entri.id}: alat ${alat} tidak dikenal`);
    assert.notEqual(alat, 'jelaskan');
    assert.match(tawar, /\?/, `${entri.id}: tawaran harus berupa pertanyaan`);
    assert.ok(tombol && tombol.length <= 30, `${entri.id}: label tombol`);
    for (const k of Object.keys(entri.aksi.awal ?? {})) {
      assert.ok(alat === 'catat_pengeluaran' || k in cariAksi(alat).skema, `${entri.id}: isian awal ${k} bukan kolom ${alat}`);
    }
  }
});

test('jalur Una untuk alat karyawan: hanya path yang perlu', async () => {
  const dipanggil = [];
  const jalurUtama = async (req) => { dipanggil.push(`${req.method} ${new URL(req.url).pathname}`); return new Response('{"ok":true}', { status: 200 }); };
  const jalur = bangunJalurAksi(new Request('https://x.test/api/caca/catat'), {}, { storeCode: 'TESTINGUNA', jalurUtama });
  assert.equal((await jalur.kirim('POST', '/api/admin/employees/emp_1/links', {})).ok, true);
  assert.equal((await jalur.kirim('POST', '/api/admin/cashiers/cashier_1/payroll', {})).ok, true);
  assert.equal((await jalur.kirim('PATCH', '/api/admin/cashiers/cashier_1', {})).ok, true);
  assert.equal((await jalur.kirim('POST', '/api/admin/cashiers/cashier_1/activate-today', {})).ok, false);
  assert.equal((await jalur.kirim('DELETE', '/api/admin/employee-links/x', {})).ok, false);
  assert.equal(dipanggil.length, 3);
});

test('panel: password awal tidak dicatat ke riwayat dan tidak ikut disimpan', () => {
  const panel = readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
  const fungsi = panel.slice(panel.indexOf('function cacaTampilkanRahasia'), panel.indexOf('// --- draft bertahap'));
  assert.ok(fungsi.includes('caca-rahasia'));
  assert.ok(!fungsi.includes('cacaCatatRiwayat'), 'riwayat dikirim ke mesin AI');
  assert.match(panel, /querySelectorAll\('\.caca-rahasia'\)/, 'disamarkan saat percakapan disimpan');
});

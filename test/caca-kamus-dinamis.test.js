import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AKAR, bangunPeta, kodeSkinResmi, isiBerkas, bangunInventaris, isiInventaris, fiturDariBerkas, periksaCakupan, hashIsi, hashSumber } from '../scripts/build-peta-una.mjs';
import { normalkanBaris, bahanHashSumber, periksaSumber, peringkatKamus, pilihVarian } from '../src/kerangka/kamus.js';
import { PETA_UNA, menuUntuk, cariMenu, jawabanMenu } from '../src/caca-peta.js';
import { KAMUS, jelaskan, peringkatTopik } from '../src/caca-jelaskan.js';
import { bukaLayarDariPesan } from '../src/caca-buka-layar.js';
import { BELUM_DIAJARKAN, TANPA_PANDUAN } from '../src/caca-inventaris-panduan.js';

const baca = nama => readFileSync(resolve(AKAR, nama), 'utf8');
test('kerangka bebas tenant/Una/D1; bahasa/konteks disuntikkan', () => {
  assert.doesNotMatch(baca('src/kerangka/kamus.js'), /\bimport\b/);
  const entri = [{ id:'warna',judul:'Warna',kunci:['biru'],ruang:['kantor'],varian:{ruang:{kantor:{isi:'Warna kantor'}}}}];
  const opsi={normalisasi:s=>String(s).toLowerCase(),kata:s=>new Set(String(s).toLowerCase().split(' ')),konteks:{ruang:'kantor'}};
  assert.equal(peringkatKamus('biru',entri,opsi)[0].entri.id,'warna');
  assert.equal(peringkatKamus('biru',entri,{...opsi,konteks:{ruang:'rumah'}}).length,0);
  assert.equal(pilihVarian(entri[0],{ruang:'kantor'}).isi,'Warna kantor');
});

test('peta generator mencakup assignment F/G/H dan subgrup D, label sesuai layar', () => {
  const peta=bangunPeta();
  const menu=(skin,tab,halaman='gerai')=>peta.find(m=>m.skin===skin&&m.halaman===halaman&&m.tab===tab);
  assert.equal(menu('f','racikbahan').label,'Bahan & Aroma');
  assert.equal(menu('g','cetak').label,'Layar Cetak');
  assert.equal(menu('d','beaops').label,'Biaya Toko');
  assert.equal(menu('d','attendance-report').label,'Absen');
  assert.equal(menu('d','hutangpiutang').grup,'Lainnya → Uang & pembukuan');
  assert.equal(menu('h','products').label,'Barang & resep');
  assert.equal(menu('h','accounting-reference').label,'Akuntansi');
  assert.equal(menu('classic','racikbahan'),undefined);
  assert.equal(menu('d','ledger','entity'),undefined);
  assert.deepEqual(peta,PETA_UNA);
});

test('skin I visual murni mendapat menu classic, panduan dan buka layar yang sama', () => {
  const opsi = { peran: 'Entity Admin' };
  const tanpaSkin = (rows) => rows.map(({ skin, ...menu }) => menu);
  assert.deepEqual(tanpaSkin(menuUntuk({ ...opsi, skin: 'I' })), tanpaSkin(menuUntuk({ ...opsi, skin: 'classic' })));
  assert.ok(menuUntuk({ ...opsi, skin: 'i' }).length > 0);
  assert.equal(cariMenu('Karyawan', { ...opsi, skin: 'I' }).menu.tab, 'employees');
  const buka = bukaLayarDariPesan('Una, buka halaman Karyawan', { ...opsi, skin: 'i', lingkup: 'gerai' });
  assert.deepEqual(buka.navigasi, { halaman: 'gerai', tab: 'employees', label: 'Karyawan', skin: 'i' });
  assert.equal(buka.perluKonfirmasi, false);
  assert.equal(buka.draft, undefined);
  const i = jelaskan('resep', { ...opsi, skin: 'i' });
  const classic = jelaskan('resep', { ...opsi, skin: 'classic' });
  assert.equal(i.jawaban, classic.jawaban);
  assert.deepEqual(i.tawaran, classic.tawaran);
  assert.equal(menuUntuk({ skin: 'i', peran: 'CASHIER' }).length, 0);
  assert.equal(menuUntuk({ skin: 'i' }).some(m => ['racikbahan', 'cetak'].includes(m.tab)), false);
});

test('registry server menjadi sumber semua skin, termasuk skin baru tanpa menu khusus', () => {
  for (const skin of kodeSkinResmi()) assert.ok(PETA_UNA.some(m => m.skin === skin), skin);
  const profil = baca('src/ui-profile.js').replace("I: 'i'", "I: 'i', J: 'j'");
  const baru = bangunPeta(baca('public/nav-groups.js'), profil);
  assert.ok(baru.some(m => m.skin === 'j' && m.tab === 'employees'));
  assert.throws(() => kodeSkinResmi('registry berubah total'), /Registry skin server berubah/);
});

for (const [skin,pesan,tab,label] of [
  ['F','di mana atur bahan?','racikbahan','Bahan & Aroma'],
  ['f','bahan aroma parfum atur di mana?','racikbahan','Bahan & Aroma'],
  ['G','di mana antrian cetak?','cetak','Layar Cetak'],
  ['g','antrean mesin printer ada di mana?','cetak','Layar Cetak'],
  ['d','biaya toko di mana?','beaops','Biaya Toko'],
  ['d','Absen di mana?','attendance-report','Absen']
]) test('pencarian skin '+skin+': '+pesan,()=>{
  const hasil=cariMenu(pesan,{skin,halaman:'gerai',peran:'Entity Admin'});
  assert.equal(hasil.menu.tab,tab);
  assert.equal(hasil.menu.label,label);
  assert.ok(jawabanMenu(hasil.menu).includes(label));
});

test('panduan dan tawaran mengikuti skin, menu yang tidak tersedia tidak ditawarkan',()=>{
  assert.equal(jelaskan('di mana atur bahan?',{skin:'f'}).judul,'Bahan & Aroma');
  assert.equal(jelaskan('di mana antrian cetak?',{skin:'g'}).judul,'Layar Cetak');
  assert.match(jelaskan('resep',{skin:'f'}).jawaban,/Bahan & Aroma/);
  assert.equal(jelaskan('resep',{skin:'f'}).tawaran.find(t=>t.jenis==='buka').layar,'racikbahan');
  assert.match(jelaskan('laci',{skin:'e'}).jawaban,/tidak perlu presensi/);
  assert.match(jelaskan('laci',{skin:'f'}).jawaban,/tanpa presensi/);
  assert.match(jelaskan('hapus penjualan',{skin:'h'}).jawaban,/Auto Permit/);
  assert.doesNotMatch(jelaskan('hapus penjualan',{skin:'d'}).jawaban,/Auto Permit/);
  const hasil=jelaskan('resep',{skin:'d',halaman:'entity'});
  for(const tawar of hasil.tawaran.filter(t=>t.jenis==='buka')) assert.ok(menuUntuk({skin:'d'}).some(m=>m.tab===tawar.layar&&m.halaman===tawar.halaman));
  assert.equal(menuUntuk({skin:'g',peran:'CASHIER'}).length,0);
  assert.equal(jelaskan('resep',{skin:'g',peran:'CASHIER'}).tawaran.filter(t=>t.jenis==='buka').length,0);
  assert.equal(menuUntuk({skin:'g',peran:'Admin Gerai'}).some(m=>m.halaman==='entity'),false);
  assert.ok(peringkatTopik('resep',3,{skin:'f'})[0].entri.isi.includes('Bahan & Aroma'));
});

test('penjaga generated normalkan CRLF; sumber perilaku berubah membuat merah',()=>{
  assert.equal(normalkanBaris(baca('generated/peta-una-data.js')),isiBerkas(bangunPeta()));
  assert.equal(normalkanBaris(baca('generated/inventaris-fitur-una.js')),isiInventaris(bangunInventaris()));
  assert.equal(hashSumber(['a.js'],()=> 'awal\r\nakhir\r\n'),hashSumber(['a.js'],()=> 'awal\nakhir\n'));
  const e={id:'hpp',sumber:['hpp.js'],diperiksa:hashSumber(['hpp.js'],()=> 'rata-rata\n')};
  assert.deepEqual(periksaSumber([e],{baca:()=> 'rata-rata\r\n',hash:hashIsi}),[]);
  assert.match(periksaSumber([e],{baca:()=> 'fifo\n',hash:hashIsi})[0],/sumber berubah/);
  assert.equal(bahanHashSumber(['b','a'],()=> 'isi'),bahanHashSumber(['a','b'],()=> 'isi'));
  assert.match(periksaSumber([{id:'umum',sumber:[]}],{baca,hash:hashIsi})[0],/tanpa alasan/);
  assert.deepEqual(periksaSumber([{id:'umum',sumber:[],alasanTanpaSumber:'istilah umum tanpa aturan aplikasi'}],{baca,hash:hashIsi}),[]);
});

test('PENJAGA: seluruh sumber kamus telah ditinjau terhadap kode sekarang',()=>{
  assert.deepEqual(periksaSumber(KAMUS,{baca,hash:hashIsi}),[]);
  for(const e of KAMUS) assert.ok(Array.isArray(e.fitur),e.id);
});

test('fitur baru route, guard method, tombol template, tombol dinamis wajib panduan',()=>{
  const route=fiturDariBerkas('src/fitur-baru.js',"if(request.method==='POST'&&pathname==='/api/admin/barubanget'){ return simpan(); }");
  const buttons=fiturDariBerkas('public/halaman-baru.js','<button id="baru">Simpan baru</button>\nconst button=document.createElement("button");button.id="dinamis";button.textContent="Aksi baru";');
  assert.ok(route.some(f=>f.jenis==='rute-tulis'));
  assert.ok(route.some(f=>f.rute==='/api/admin/barubanget'));
  assert.equal(buttons.length,2);
  assert.ok(periksaCakupan([...route,...buttons],KAMUS,TANPA_PANDUAN,BELUM_DIAJARKAN).length>=3);
  const taught=[{fitur:[...route,...buttons].map(f=>f.id)}];
  assert.deepEqual(periksaCakupan([...route,...buttons],taught,{},[]),[]);
  const nama='src/transaction-void-permits.js';
  const lama=baca(nama);
  const pola=fiturDariBerkas(nama,lama).find(f=>f.jenis==='rute-pola');
  assert.ok(pola);
  // Hanya pola route berubah; nama match dan semua guard method tetap sama.
  const routeBaru=pola.rute.replace('transaction-void','baru-belum-diajarkan');
  const fiturRegexBaru=fiturDariBerkas(nama,lama.replace(pola.rute,routeBaru));
  const idBaru=fiturRegexBaru.find(f=>f.jenis==='rute-pola'&&f.rute===routeBaru).id;
  assert.ok(periksaCakupan(fiturRegexBaru,KAMUS,TANPA_PANDUAN,BELUM_DIAJARKAN).includes(idBaru));
  const noisy=fiturDariBerkas('src/metadata.js',JSON.stringify({x:"request.method === 'POST' && pathname === '/api/test'",y:'/api/metadata'}));
  assert.deepEqual(noisy,[]);
  const comment=fiturDariBerkas('src/kode.js',"// request.method === 'POST' && pathname === '/api/contoh'\nexport const contoh=1;");
  assert.deepEqual(comment,[]);
});

test('PENJAGA: inventaris fitur sekarang seluruhnya diajarkan atau dikecualikan tertulis',()=>{
  assert.deepEqual(periksaCakupan(bangunInventaris(),KAMUS,TANPA_PANDUAN,BELUM_DIAJARKAN),[]);
  for(const alasan of Object.values(TANPA_PANDUAN)) assert.ok(alasan.length>15);
});

test('PENJAGA: baseline beku hanya boleh menyusut, tidak menyerap fitur baru',()=>{
  const snapshot=JSON.parse(baca('generated/inventaris-fitur-baseline-20261013.json'));
  assert.equal(hashIsi(JSON.stringify(snapshot)),'1d37c3a589f30f6b0e86f9ac344925c53402edf9fb4e6d72bddb9565de779655','Snapshot awal diubah; jangan regenerasi baseline untuk meloloskan fitur baru.');
  const awal=new Set(snapshot.ids);
  assert.deepEqual(BELUM_DIAJARKAN.filter(id=>!awal.has(id)),[]);
  assert.equal(new Set(BELUM_DIAJARKAN).size,BELUM_DIAJARKAN.length);
  // Setelah berkas ini tercatat Git, bandingkan daftar aktif versi HEAD juga.
  // Hilangnya Git bukan alasan melewati pemeriksaan; hanya first introduction
  // yang belum mempunyai berkas pada HEAD diperbolehkan.
  const tracked=execFileSync('git',['ls-tree','HEAD','src/caca-inventaris-panduan.js'],{cwd:AKAR,encoding:'utf8'});
  if(tracked.trim()){
    const lama=execFileSync('git',['show','HEAD:src/caca-inventaris-panduan.js'],{cwd:AKAR,encoding:'utf8'});
    // Route IDs can contain literal ]) inside JSON strings; only a line-closing
    // array terminator ends this frozen snapshot. The snapshot/hash stays unchanged.
    const match=lama.match(/BELUM_DIAJARKAN\s*=\s*Object\.freeze\((\[[\s\S]*?\r?\n\])\);/);
    assert.ok(match,'Baseline HEAD harus bisa diperiksa; jangan ganti menjadi pola dinamis.');
    const sebelum=new Set(JSON.parse(match[1]));
    assert.deepEqual(BELUM_DIAJARKAN.filter(id=>!sebelum.has(id)),[],'BELUM_DIAJARKAN bertambah dibanding HEAD.');
  }
});


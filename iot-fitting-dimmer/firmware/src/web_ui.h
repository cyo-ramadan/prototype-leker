// Halaman kontrol yang disajikan langsung oleh lampu (tanpa internet).
// Sama persis dipakai aplikasi Android (WebView) — satu UI untuk dua jalur.
#pragma once
#include <pgmspace.h>

static const char INDEX_HTML[] PROGMEM = R"HTML(<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14110f">
<title>Lampu Pintar</title>
<style>
:root{--bg:#14110f;--card:#1f1a16;--line:#2e2620;--tx:#f4ece4;--mut:#a8998b;--ac:#ffb547;--ok:#5fd38d;--bad:#ff6b5b}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--tx);font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px;max-width:480px;margin:auto}
h1{font-size:20px}h2{font-size:15px;margin-bottom:10px;color:var(--mut);font-weight:600}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.sub{color:var(--mut);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px}
.hero{text-align:center;padding:24px 16px}
#pw{width:150px;height:150px;border-radius:50%;border:0;background:#2a221c;color:var(--mut);font-size:52px;cursor:pointer;transition:.3s}
#pw.on{background:radial-gradient(circle,#ffd58a 0%,var(--ac) 55%,#c97a12 100%);color:#3a2300;box-shadow:0 0 calc(var(--g,1)*60px) rgba(255,181,71,.55)}
#pct{font-size:34px;font-weight:700;margin-top:14px}
input[type=range]{width:100%;accent-color:var(--ac);height:36px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row>*{flex:1}
button.b{background:#2a221c;color:var(--tx);border:1px solid var(--line);border-radius:12px;padding:11px 8px;font-size:14px;cursor:pointer}
button.b.act{border-color:var(--ac);color:var(--ac)}button.p{background:var(--ac);color:#2a1800;border:0;font-weight:700}
label{display:block;font-size:13px;color:var(--mut);margin:10px 0 4px}
input,select{width:100%;background:#14110f;color:var(--tx);border:1px solid var(--line);border-radius:10px;padding:10px;font-size:15px}
.sch{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}.sch:last-child{border:0}
.days{display:flex;gap:4px;margin-top:6px}.days span{flex:1;text-align:center;padding:7px 0;border-radius:8px;background:#14110f;border:1px solid var(--line);font-size:12px;cursor:pointer}.days span.on{border-color:var(--ac);color:var(--ac)}
.net{padding:10px;border-bottom:1px solid var(--line);cursor:pointer}.net:hover{background:#2a221c}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#000c;padding:10px 16px;border-radius:10px;display:none}
details summary{cursor:pointer;color:var(--mut);font-weight:600}.hide{display:none}.small{font-size:12px;color:var(--mut)}
</style></head><body>
<div class="top"><div><h1 id="nm">Lampu</h1><div class="sub" id="st">menghubungkan…</div></div><div class="sub" id="clk"></div></div>

<div class="card hide" id="setup"><h2>Sambungkan ke WiFi rumah</h2>
<div class="small">Pilih WiFi, isi password. Lampu akan restart lalu bisa diatur dari HP mana saja yang ada di WiFi itu.</div>
<div id="nets" style="margin:10px 0"></div><button class="b" onclick="scan()">Cari ulang</button>
<label>Nama WiFi</label><input id="ss"><label>Password</label><input id="ps" type="password">
<button class="b p" style="width:100%;margin-top:12px" onclick="joinWifi()">Simpan & sambungkan</button></div>

<div class="card hero"><button id="pw" onclick="toggle()" aria-label="Nyala/mati">⏻</button>
<div id="pct">–</div><input type="range" id="lv" min="1" max="100" oninput="pv(this.value)" onchange="setLevel(this.value)">
<div class="row" style="margin-top:8px"><button class="b" onclick="setLevel(10)">Tidur</button><button class="b" onclick="setLevel(40)">Santai</button><button class="b" onclick="setLevel(70)">Baca</button><button class="b" onclick="setLevel(100)">Terang</button></div></div>

<div class="card"><h2>Matikan otomatis</h2><div class="row" id="tm">
<button class="b" onclick="timer(15)">15 mnt</button><button class="b" onclick="timer(30)">30 mnt</button><button class="b" onclick="timer(60)">1 jam</button><button class="b" onclick="timer(0)">Batal</button></div>
<div class="small" id="tl" style="margin-top:8px"></div></div>

<div class="card"><h2>Jadwal</h2><div id="schs"></div>
<details style="margin-top:8px"><summary>+ Tambah jadwal</summary>
<label>Jam</label><input id="jt" type="time" value="18:00">
<label>Aksi</label><select id="ja"><option value="100">Nyalakan 100%</option><option value="60">Nyalakan 60%</option><option value="20">Nyalakan redup 20%</option><option value="0">Matikan</option></select>
<label>Hari</label><div class="days" id="jd"></div>
<label>Transisi (detik, maks 255 — mis. 240 = bangun pelan 4 menit)</label><input id="jf" type="number" min="0" max="255" value="3">
<button class="b p" style="width:100%;margin-top:12px" onclick="addSch()">Simpan jadwal</button></details>
<div class="small" id="tv" style="margin-top:8px"></div></div>

<div class="card"><div class="row" style="align-items:center"><div><h2 style="margin:0">Mode rumah berpenghuni</h2><div class="small">Saat pergi: lampu nyala-mati acak 18:00–23:30</div></div>
<button class="b" id="aw" style="flex:0 0 80px" onclick="away()">Mati</button></div></div>

<div class="card"><details><summary>Pengaturan lampu</summary>
<label>Nama</label><input id="cn" maxlength="31">
<label>Jenis bohlam</label><select id="ct"><option value="dimmable">Bisa diredupkan (pijar / LED "dimmable")</option><option value="onoff">LED biasa — hanya nyala/mati</option></select>
<label>Redup minimum (naikkan kalau lampu kedip di slider rendah): <b id="cmv"></b>%</label><input type="range" id="cm" min="0" max="60" oninput="cmv.textContent=this.value">
<label>Saat listrik/saklar dinyalakan</label><select id="cp"><option value="0">Kembali seperti terakhir</option><option value="1">Selalu nyala terang</option><option value="2">Tetap mati</option></select>
<button class="b p" style="width:100%;margin-top:12px" onclick="saveCfg()">Simpan</button>
<div class="small" style="margin-top:14px" id="info"></div>
<div class="row" style="margin-top:10px"><button class="b" onclick="showSetup()">Ganti WiFi</button><button class="b" onclick="location.href='/update'">Update firmware</button></div>
</details></div>

<div class="toast" id="toast"></div>
<script>
const $=id=>document.getElementById(id),H=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];let S={},SC=[],dmask=127;
const base=(new URLSearchParams(location.search)).get('dev')||'';
async function api(p,o){const r=await fetch(base+p,o);const j=await r.json();if(!r.ok)throw Error(j.error||r.status);return j}
const post=(p,d)=>api(p,{method:'POST',body:new URLSearchParams(d)});
function toast(t){const e=$('toast');e.textContent=t;e.style.display='block';clearTimeout(e._t);e._t=setTimeout(()=>e.style.display='none',2200)}
function pv(v){$('pct').textContent=v+'%';$('pw').style.setProperty('--g',v/100)}
function render(s){S=s;$('nm').textContent=s.name;document.title=s.name;
$('st').textContent=s.setupMode?'Mode setup — belum tersambung WiFi':(s.wifi?'Tersambung · '+s.wifi:'Mode langsung (tanpa router)')+(s.mainsHz?'':' · listrik tidak terdeteksi');
$('clk').textContent=s.time||'';$('pw').classList.toggle('on',s.on);$('lv').value=s.level;pv(s.on?s.level:0);if(!s.on)$('pct').textContent='Mati';
$('lv').disabled=s.lampType==='onoff';$('tl').textContent=s.timerLeftSec>0?'Mati dalam '+Math.ceil(s.timerLeftSec/60)+' menit':'';
$('aw').textContent=s.away?'Aktif':'Mati';$('aw').classList.toggle('act',s.away);
$('cn').value=s.name;$('ct').value=s.lampType;$('cm').value=s.minLevel;$('cmv').textContent=s.minLevel;$('cp').value=s.powerOn;
$('info').textContent=`ID ${s.id} · FW ${s.fw} · IP ${s.ip} · sinyal ${s.rssi} dBm · listrik ${s.mainsHz.toFixed(1)} Hz`;
if(s.setupMode)showSetup()}
async function load(){try{render(await api('/api/state'));const j=await api('/api/schedules');SC=j.schedules;renderSch(j)}catch(e){$('st').textContent='Lampu tidak terjangkau — cek WiFi HP'}}
async function toggle(){render(await post('/api/toggle',{}))}
async function setLevel(v){render(await post('/api/set',{level:v,fade:300}))}
async function timer(m){render(await post('/api/timer',{minutes:m}));toast(m?'Lampu mati dalam '+m+' menit':'Timer dibatalkan')}
async function away(){render(await post('/api/away',{on:S.away?0:1}))}
async function saveCfg(){try{render(await post('/api/config',{name:$('cn').value,lampType:$('ct').value,minLevel:$('cm').value,powerOn:$('cp').value}));toast('Tersimpan')}catch(e){toast(e.message)}}
function dayTxt(m){if(m===127)return'Setiap hari';if(m===62)return'Sen–Jum';if(m===65)return'Sabtu & Minggu';return H.filter((_,i)=>m&1<<i).join(', ')}
function renderSch(j){$('schs').innerHTML=SC.length?'':'<div class="small">Belum ada jadwal.</div>';
SC.forEach((s,i)=>{const d=document.createElement('div');d.className='sch';const t=String(s.hour).padStart(2,'0')+':'+String(s.minute).padStart(2,'0');
d.innerHTML=`<div><b>${t}</b> · ${s.level?'Nyala '+s.level+'%':'Mati'}<div class="small">${dayTxt(s.days)}</div></div>`;
const b=document.createElement('button');b.className='b';b.textContent='Hapus';b.onclick=()=>{SC.splice(i,1);saveSch()};d.appendChild(b);$('schs').appendChild(d)});
$('tv').textContent=j.timeValid?'':'Jam belum sinkron (butuh internet lewat WiFi rumah). Jadwal jalan setelah jam sinkron.'}
function drawDays(){$('jd').innerHTML='';H.forEach((h,i)=>{const s=document.createElement('span');s.textContent=h;s.className=dmask&1<<i?'on':'';s.onclick=()=>{dmask^=1<<i;drawDays()};$('jd').appendChild(s)})}
async function saveSch(){try{const j=await api('/api/schedules',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schedules:SC})});SC=j.schedules;renderSch(j);toast('Jadwal tersimpan')}catch(e){toast(e.message);load()}}
function addSch(){if(!dmask)return toast('Pilih minimal satu hari');if(SC.length>=8)return toast('Maksimal 8 jadwal');const[h,m]=$('jt').value.split(':').map(Number);
SC.push({enabled:true,days:dmask,hour:h,minute:m,level:+$('ja').value,fadeSec:Math.min(255,+$('jf').value||0)});saveSch()}
function showSetup(){$('setup').classList.remove('hide');scan()}
async function scan(){$('nets').innerHTML='<div class="small">Mencari WiFi…</div>';try{const j=await api('/api/scan');$('nets').innerHTML='';
j.networks.sort((a,b)=>b.rssi-a.rssi).forEach(n=>{const d=document.createElement('div');d.className='net';d.textContent=(n.secure?'🔒 ':'')+n.ssid+'  ('+n.rssi+' dBm)';d.onclick=()=>{$('ss').value=n.ssid;$('ps').focus()};$('nets').appendChild(d)})}catch(e){$('nets').innerHTML=''}}
async function joinWifi(){try{const j=await post('/api/wifi',{ssid:$('ss').value,pass:$('ps').value});
document.body.innerHTML='<div class="card" style="margin-top:40px"><h2>Tersimpan ✓</h2><p>Lampu sedang menyambung ke WiFi rumah. Sambungkan HP kembali ke WiFi rumah, lalu buka aplikasi atau <b>http://'+j.host+'</b></p></div>'}catch(e){toast(e.message)}}
drawDays();load();addEventListener('focus',load);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
</script></body></html>)HTML";

// Peta Agen (Bos Cyo, 2026-10-20): menggambar rancangan Una, Rika, dan Fina beserta status tiap
// bagian. Data hanya lewat GET /api/owner/peta-agen (khusus Owner, src/peta-agen.js), hasil
// scripts/build-peta-agen.mjs. Tidak memuat apa pun dari internet.
(() => {
const JENIS = {
  pintu: ["Pintu masuk", "--k-pintu", "IN"], agen: ["Agen", "--k-agen", "AI"], alat: ["Alat", "--k-alat", "fx"],
  data: ["Data", "--k-data", "DB"], keluaran: ["Hasil", "--k-keluaran", "OUT"], acc: ["Keputusan Bos", "--k-acc", "ACC"],
  belajar: ["Belajar", "--k-belajar", "LRN"], mesin: ["Mesin bersama", "--k-mesin", "ENG"], lokal: ["Laptop Bos", "--k-lokal", "PC"]
};
const STATUS = { selesai: ["Sudah ada", "--ok", "✓"], sebagian: ["Sebagian", "--part", "½"], belum: ["Belum", "--no", "·"] };
const AGEN = { una: ["Una", "--l-una"], rika: ["Rika", "--l-rika"], fina: ["Fina", "--l-fina"], mesin: ["Mesin bersama", "--l-mesin"], belajar: ["Belajar", "--l-belajar"] };
const EDGE = { alir: "--accent", baca: "--k-data", belajar: "--k-belajar" };

// Ikon gambar per kotak (Bos Cyo 2026-10-22: "kalo wa pake logo wa, ... database simbol database,
// kartu case"). SVG tertanam, tidak memuat apa pun dari internet. Ikon merek berwarna sendiri;
// ikon lain garis putih di atas warna jenis kotak. "wa+ig" = beberapa ikon berjajar.
const SVG = (isi, vb = "0 0 24 24") => `<svg viewBox="${vb}" width="22" height="22" aria-hidden="true">${isi}</svg>`;
const GARIS = d => SVG(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`);
const IKON_MEREK = {
  wa: SVG('<circle cx="12" cy="12" r="11" fill="#25D366"/><path d="M6.8 17.4l.9-2.9a5.6 5.6 0 1 1 2.1 2.1z" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 9.2c.2 1.9 1.7 3.6 3.8 4.4l.9-.9.9.6-.4 1.2c-2.8-.2-5.2-2.6-5.4-5.4l1.2-.4.6.9z" fill="#fff"/>'),
  fb: SVG('<rect width="24" height="24" rx="5" fill="#1877F2"/><path d="M13.6 20v-6.1h2.1l.3-2.4h-2.4V10c0-.7.2-1.2 1.2-1.2H16V6.7c-.3 0-1-.1-1.9-.1-1.9 0-3.1 1.1-3.1 3.2v1.7H9v2.4h2V20z" fill="#fff"/>'),
  ig: SVG('<defs><linearGradient id="igw" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#F58529"/><stop offset=".5" stop-color="#DD2A7B"/><stop offset="1" stop-color="#8134AF"/></linearGradient></defs><rect width="24" height="24" rx="6" fill="url(#igw)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="16.1" cy="7.9" r="1" fill="#fff"/>'),
  email: SVG('<rect x="1.5" y="4.5" width="21" height="15" rx="2.5" fill="#EA4335"/><path d="M3 6.5l9 6.5 9-6.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>'),
  db: SVG('<ellipse cx="12" cy="5.5" rx="8" ry="3" fill="#2563EB"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13c0 1.7-3.6 3-8 3s-8-1.3-8-3z" fill="#3B82F6"/><path d="M4 10.5c0 1.7 3.6 3 8 3s8-1.3 8-3M4 15c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="#DBEAFE" stroke-width="1.2"/>'),
  kartu: SVG('<rect x="2.5" y="5" width="19" height="14" rx="2" fill="#F59E0B"/><path d="M5.5 9h13M5.5 12h9M5.5 15h11" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>')
};
const IKON_GARIS = {
  chat: GARIS("M4 5h16v11H9l-5 4z"), jam: GARIS("M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2"),
  web: GARIS("M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"),
  laptop: GARIS("M5 6h14v9H5zM3 18h18"), ai: GARIS("M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"),
  gear: GARIS("M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"),
  cari: GARIS("M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21"), orang: GARIS("M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 0 0 0 7zM2.5 20c.5-3.5 3.2-5.5 6.5-5.5s6 2 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.3 2.5 3.5 5.2"),
  toko: GARIS("M3 9l2-5h14l2 5M3 9h18M5 9v11h14V9M9 20v-6h6v6"), grafik: GARIS("M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"),
  surat: GARIS("M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"), centang: GARIS("M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16.5 9.5"),
  toa: GARIS("M4 10v4h3l7 4V6l-7 4zM17 9a4 4 0 0 1 0 6"), antrean: GARIS("M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z"),
  tes: GARIS("M9 4h6v3H9zM6 6h12v15H6zM9 12l1.5 1.5L14 10M9 17h6"), peta: GARIS("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"),
  putar: GARIS("M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"), rute: GARIS("M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v6M6 21v-4M3 6l3-3 3 3"),
  buku: GARIS("M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7"), paket: GARIS("M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10"),
  alat: GARIS("M14.5 6.5a4 4 0 0 0-5.3 5L4 16.7 7.3 20l5.2-5.2a4 4 0 0 0 5-5.3l-2.5 2.5-2.3-.7-.7-2.3z"), layar: GARIS("M3 4h18v12H3zM8 20h8M12 16v4"),
  kutu: GARIS("M9 7a3 3 0 0 1 6 0M7 9h10v5a5 5 0 0 1-10 0zM12 9v10M3 12h4M17 12h4M4 7l3 2M20 7l-3 2M4 18l3-2M20 18l-3-2")
};
function ikonKotak(k, cadangan) {
  const nama = String(k.ikon || "").split("+").filter(n => IKON_MEREK[n] || IKON_GARIS[n]);
  if (!nama.length) return `<span class="ic">${cadangan}</span>`;
  const merek = nama.every(n => IKON_MEREK[n]);
  return `<span class="ic${merek ? " merek" : ""}${nama.length > 1 ? " banyak" : ""}">${nama.map(n => IKON_MEREK[n] || IKON_GARIS[n]).join("")}</span>`;
}

const $ = s => document.querySelector(s);
const vp = $("#vp"), world = $("#world"), svg = $("#edges"), panel = $("#panel");
let D, els = {}, view = { x: 0, y: 0, s: 1 }, filter = "semua", sel = null;
// Paket kerja yang memiliki kotak, mis. "H2+H3" -> ["H2","H3"] (sama dengan scripts/build-peta-agen.mjs).
const paketKotak = k => String(k.paket || "").split(/[+/,\s]+/).filter(Boolean);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function pesan(html) { vp.insertAdjacentHTML("beforeend", `<div class="err"><div>${html}</div></div>`); $("#meta").textContent = "Data tidak tersedia."; }
async function muat() {
  let token = "";
  try { token = localStorage.getItem("lekerOwnerToken") || ""; } catch (e) { /* penyimpanan diblokir */ }
  const masuk = alasan => pesan(`<b>Khusus Owner.</b> ${esc(alasan)} Masuk dulu di <a href="/owner">Owner Console</a>, lalu buka dari tombol <b>Peta Agen</b>.`);
  if (!token) return masuk("Belum masuk sebagai Owner.");
  let res;
  try { res = await fetch("/api/owner/peta-agen", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); }
  catch (e) { return pesan("Koneksi bermasalah. Coba muat ulang halaman."); }
  if (res.status === 401) return masuk("Sesi Owner habis.");
  if (!res.ok) return pesan(`Peta gagal dimuat (kode ${res.status}).`);
  init(await res.json());
}
muat();

function init(data) {
  D = data;
  $("#meta").innerHTML = `Status dihitung dari kode versi yang sedang berjalan · rancangan: <b>${esc(D.handoff)}</b>`;
  // progress
  $("#prog").innerHTML = ["una", "rika", "fina", "mesin"].map(a => {
    const r = D.ringkas[a] || { total: 0, selesai: 0, sebagian: 0 }, pct = r.total ? Math.round(100 * r.selesai / r.total) : 0;
    return `<button class="pc" data-f="${a}" style="--lc:var(${AGEN[a][1]})" aria-pressed="false">
      <div class="nm"><i></i>${AGEN[a][0]}</div><div class="num">${r.selesai}/${r.total} sudah · ${pct}%</div>
      <div class="bar"><span style="width:${100 * r.selesai / r.total}%;background:var(${AGEN[a][1]})"></span><span style="width:${100 * r.sebagian / r.total}%;background:var(--part);opacity:.45"></span></div></button>`;
  }).join("");
  // world
  world.style.width = D.ukuran.w + "px"; world.style.height = D.ukuran.h + "px";
  D.jalur.forEach(l => {
    const d = document.createElement("div"); d.className = "lane"; d.dataset.agen = l.agen;
    Object.assign(d.style, { left: l.x + "px", top: l.y + "px", width: l.w + "px", height: l.h + "px" });
    d.style.setProperty("--lc", `var(${AGEN[l.agen][1]})`); d.innerHTML = `<b>${esc(l.label)}</b>`;
    world.insertBefore(d, svg);
  });
  D.kotak.forEach(k => {
    const J = JENIS[k.jenis], S = STATUS[k.status], b = document.createElement("button");
    b.className = `n ${k.status}`; b.style.left = k.x + "px"; b.style.top = k.y + "px"; b.style.setProperty("--kc", `var(${J[1]})`);
    b.setAttribute("aria-label", `${k.label}, ${S[0]}`);
    const pk = paketKotak(k);
    b.innerHTML = (pk.length ? `<span class="pk" title="Paket kerja ${esc(pk.join(" + "))}">${esc(pk.join("+"))}</span>` : "") + `<span class="pt i"></span>${ikonKotak(k, J[2])}<span><div class="t">${esc(k.label)}</div><div class="s">${esc(k.sub)}</div></span><span class="pt o"></span><span class="st" style="background:var(${S[1]})">${S[2]}</span>${k.risiko ? '<span class="rk">risiko</span>' : ""}`;
    b.addEventListener("click", ev => { if (moved) { ev.preventDefault(); return; } pilih(k.id); });
    world.appendChild(b); els[k.id] = { el: b, k };
  });
  garis();
  paketBar();
  document.querySelectorAll("[data-f]").forEach(c => c.addEventListener("click", () => setFilter(c.dataset.f === filter && c.dataset.f !== "semua" ? "semua" : c.dataset.f)));
  const awal = location.hash.slice(1);
  if (els[awal]) pilih(awal);
  if (document.fonts?.ready) document.fonts.ready.then(() => { garis(); applyFilter(); });
  fit();
}

function port(el, side) {
  const x = el.offsetLeft, y = el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
  return { l: [x, y + h / 2], r: [x + w, y + h / 2], t: [x + w / 2, y], b: [x + w / 2, y + h] }[side];
}
function garis() {
  svg.setAttribute("width", D.ukuran.w); svg.setAttribute("height", D.ukuran.h);
  svg.innerHTML = D.garis.map(([a, b, t, lab]) => {
    const A = els[a]?.el, B = els[b]?.el; if (!A || !B) return "";
    let d, mx, my;
    if (B.offsetLeft > A.offsetLeft + A.offsetWidth - 10) {
      const [x1, y1] = port(A, "r"), [x2, y2] = port(B, "l"), c = Math.max(36, (x2 - x1) / 2);
      d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`; mx = (x1 + x2) / 2; my = (y1 + y2) / 2 - 6;
    } else if (Math.abs(A.offsetLeft - B.offsetLeft) < 60) {
      const down = B.offsetTop > A.offsetTop, [x1, y1] = port(A, down ? "b" : "t"), [x2, y2] = port(B, down ? "t" : "b");
      d = `M${x1},${y1} L${x2},${y2}`; mx = x1 + 8; my = (y1 + y2) / 2;
    } else {
      const [x1, y1] = port(A, "t"), [x2, y2] = port(B, "t"), top = Math.min(y1, y2) - 30;
      d = `M${x1},${y1} C${x1},${top} ${x2},${top} ${x2},${y2}`; mx = (x1 + x2) / 2; my = top + 6;
    }
    const on = els[a].k.status === "selesai" && els[b].k.status === "selesai";
    return `<path class="e ${t} ${on ? "on" : ""}" data-a="${a}" data-b="${b}" style="--ec:var(${EDGE[t] || "--accent"})" d="${d}"/>` +
      (lab ? `<text class="el" x="${mx}" y="${my}" text-anchor="${mx === undefined ? "middle" : "middle"}">${esc(lab)}</text>` : "");
  }).join("");
  if (sel) pilih(sel, true);
}

// Baris wilayah paket: tombol per paket + progres; klik = sorot wilayahnya & tampilkan keterangan.
function paketBar() {
  const bar = $("#paketBar"); if (!bar) return;
  const daftar = D.paket || [];
  bar.innerHTML = daftar.length ? `<span class="lbl">Wilayah paket</span>` + daftar.map(p =>
    `<button class="pk-chip ${p.total && p.selesai === p.total ? "lengkap" : ""}" data-pk="${esc(p.id)}" aria-pressed="false" title="${esc(p.nama)}"><b>${esc(p.id)}</b>${esc(p.nama)}<small>${p.selesai}/${p.total}</small></button>`).join("") : "";
  bar.querySelectorAll("[data-pk]").forEach(c => c.addEventListener("click", () => {
    const f = "paket:" + c.dataset.pk;
    setFilter(filter === f ? "semua" : f);
    if (filter === f) infoPaket(c.dataset.pk);
  }));
}
function wilayah() {
  world.querySelectorAll(".wil").forEach(w => w.remove());
  if (!filter.startsWith("paket:")) return;
  const id = filter.slice(6), anggota = Object.values(els).filter(o => paketKotak(o.k).includes(id)).map(o => o.el);
  if (!anggota.length) return;
  const pad = 18, x1 = Math.min(...anggota.map(e => e.offsetLeft)) - pad, y1 = Math.min(...anggota.map(e => e.offsetTop)) - pad - 6;
  const x2 = Math.max(...anggota.map(e => e.offsetLeft + e.offsetWidth)) + pad, y2 = Math.max(...anggota.map(e => e.offsetTop + e.offsetHeight)) + pad;
  const p = (D.paket || []).find(x => x.id === id), w = document.createElement("div");
  w.className = "wil"; Object.assign(w.style, { left: x1 + "px", top: y1 + "px", width: (x2 - x1) + "px", height: (y2 - y1) + "px" });
  w.innerHTML = `<b>Wilayah ${esc(id)}${p ? " · " + esc(p.nama) : ""}</b>`;
  world.insertBefore(w, svg);
}
function infoPaket(id) {
  const p = (D.paket || []).find(x => x.id === id); if (!p) return;
  panel.innerHTML = `<div class="pills"><span class="pill" style="color:var(--accent)">Paket ${esc(p.id)}</span><span class="pill" style="color:var(--muted)">Gelombang ${esc(p.gelombang)}</span><span class="pill" style="color:var(${p.total && p.selesai === p.total ? "--ok" : "--part"})">${p.selesai}/${p.total} sudah</span></div>
    <h2>${esc(p.nama)}</h2><p>${esc(p.isi)}</p><div class="lbl">Menunggu</div><p class="note">${esc(p.butuh)}</p>
    <div class="lbl">Kotak di wilayah ini</div><ul class="pkl">${p.kotak.map(k => `<li><button data-ke="${esc(k)}">${esc(els[k]?.k.label || k)}</button> · ${esc(STATUS[els[k]?.k.status]?.[0] || "")}</li>`).join("")}</ul>`;
  panel.querySelectorAll("[data-ke]").forEach(b => b.onclick = () => pilih(b.dataset.ke));
}

function cocok(k) {
  if (filter === "semua") return true;
  if (filter.startsWith("paket:")) return paketKotak(k).includes(filter.slice(6));
  if (filter === "belum") return k.status !== "selesai";
  if (filter === "mesin") return k.jenis === "mesin";
  if (filter === "belajar") return k.jenis === "belajar" || k.id === "b_tinjau";
  return k.agen.includes(filter) && k.jenis !== "mesin";
}
function setFilter(f) {
  filter = f;
  document.querySelectorAll("[data-f]").forEach(c => c.setAttribute("aria-pressed", c.dataset.f === f));
  document.querySelectorAll("[data-pk]").forEach(c => c.setAttribute("aria-pressed", f === "paket:" + c.dataset.pk));
  applyFilter();
  wilayah();
}
function applyFilter() {
  Object.values(els).forEach(({ el, k }) => el.classList.toggle("dim", !cocok(k)));
  document.querySelectorAll(".lane").forEach(l => l.classList.toggle("dim", !["semua", "belum"].includes(filter) && !filter.startsWith("paket:") && l.dataset.agen !== filter && !(filter === "belajar" && l.dataset.agen === "belajar")));
  svg.querySelectorAll(".e").forEach(p => p.classList.toggle("dim", !(cocok(els[p.dataset.a].k) && cocok(els[p.dataset.b].k))));
}

function pilih(id, diam) {
  sel = id; const { k } = els[id], J = JENIS[k.jenis], S = STATUS[k.status];
  Object.values(els).forEach(o => o.el.classList.toggle("sel", o.k.id === id));
  svg.querySelectorAll(".e").forEach(p => p.classList.toggle("hot", p.dataset.a === id || p.dataset.b === id));
  if (diam) return;
  try { history.replaceState(null, "", "#" + id); } catch (e) {}
  const agen = k.agen.map(a => AGEN[a] ? `<span class="pill" style="color:var(${AGEN[a][1]})">${AGEN[a][0]}</span>` : "").join("");
  let h = `<div class="pills"><span class="pill" style="color:var(${J[1]})">${J[0]}</span><span class="pill" style="color:var(${S[1]})">${S[0]}</span>${agen}${k.paket ? `<span class="pill" style="color:var(--muted)">Paket ${esc(k.paket)}</span>` : ""}</div>
    <h2>${esc(k.label)}</h2><p class="note" style="font-family:var(--f-mono)">${esc(k.sub)}</p><p>${esc(k.isi)}</p>`;
  if (k.risiko) h += `<div class="risk">${esc(k.risiko)}</div>`;
  if (k.bukti?.length) h += `<div class="lbl">Bukti di program</div><ul class="bk">${k.bukti.map(b => `<li class="${b.ok ? "y" : "x"}"><i>${b.ok ? "✓" : "·"}</i><span>${esc(b.teks)}${b.cocok ? ` → ${esc(b.cocok.replace("migrations/", ""))}` : ""}</span></li>`).join("")}</ul>`;
  const target = k.file || null;
  if (target) h += `<div class="lbl">Berkas di repo</div><div class="path" id="ptxt">${esc(target)}</div><div class="btns"><button class="btn" id="cp">Salin lokasi</button></div>`;
  panel.innerHTML = h;
  const cp = $("#cp");
  if (cp) cp.onclick = () => navigator.clipboard.writeText(target).then(() => cp.textContent = "Tersalin", () => {
    const r = document.createRange(); r.selectNodeContents($("#ptxt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); cp.textContent = "Tekan Ctrl+C";
  });
}

// pan & zoom
function apply() { world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.s})`; }
function zoomAt(f, cx, cy) {
  const s = Math.min(1.6, Math.max(0.25, view.s * f));
  view.x = cx - (cx - view.x) * (s / view.s); view.y = cy - (cy - view.y) * (s / view.s); view.s = s; apply();
}
function fit() {
  if (!D) return;
  const W = vp.clientWidth, H = vp.clientHeight, s = Math.max(0.25, Math.min(1, (W - 24) / D.ukuran.w, (H - 24) / D.ukuran.h));
  view = { s, x: (W - D.ukuran.w * s) / 2, y: 12 }; apply();
}
$("#fit").onclick = fit;
$("#zin").onclick = () => zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2);
$("#zout").onclick = () => zoomAt(1 / 1.2, vp.clientWidth / 2, vp.clientHeight / 2);
vp.addEventListener("wheel", e => { e.preventDefault(); const r = vp.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
let drag = null, moved = false;
vp.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId }; moved = false; });
vp.addEventListener("pointermove", e => {
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!moved && Math.hypot(dx, dy) > 5) { moved = true; vp.classList.add("drag"); try { vp.setPointerCapture(drag.id); } catch (er) {} }
  if (moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
});
const end = () => { drag = null; vp.classList.remove("drag"); setTimeout(() => moved = false, 0); };
vp.addEventListener("pointerup", end); vp.addEventListener("pointercancel", end);
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fit, 150); });
})();

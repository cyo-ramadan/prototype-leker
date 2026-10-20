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

const $ = s => document.querySelector(s);
const vp = $("#vp"), world = $("#world"), svg = $("#edges"), panel = $("#panel");
let D, els = {}, view = { x: 0, y: 0, s: 1 }, filter = "semua", sel = null;
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
    b.innerHTML = `<span class="pt i"></span><span class="ic">${J[2]}</span><span><div class="t">${esc(k.label)}</div><div class="s">${esc(k.sub)}</div></span><span class="pt o"></span><span class="st" style="background:var(${S[1]})">${S[2]}</span>${k.risiko ? '<span class="rk">risiko</span>' : ""}`;
    b.addEventListener("click", ev => { if (moved) { ev.preventDefault(); return; } pilih(k.id); });
    world.appendChild(b); els[k.id] = { el: b, k };
  });
  garis();
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

function cocok(k) {
  if (filter === "semua") return true;
  if (filter === "belum") return k.status !== "selesai";
  if (filter === "mesin") return k.jenis === "mesin";
  if (filter === "belajar") return k.jenis === "belajar" || k.id === "b_tinjau";
  return k.agen.includes(filter) && k.jenis !== "mesin";
}
function setFilter(f) {
  filter = f;
  document.querySelectorAll("[data-f]").forEach(c => c.setAttribute("aria-pressed", c.dataset.f === f));
  applyFilter();
}
function applyFilter() {
  Object.values(els).forEach(({ el, k }) => el.classList.toggle("dim", !cocok(k)));
  document.querySelectorAll(".lane").forEach(l => l.classList.toggle("dim", !["semua", "belum"].includes(filter) && l.dataset.agen !== filter && !(filter === "belajar" && l.dataset.agen === "belajar")));
  svg.querySelectorAll(".e").forEach(p => p.classList.toggle("dim", !(cocok(els[p.dataset.a].k) && cocok(els[p.dataset.b].k))));
}

function pilih(id, diam) {
  sel = id; const { k } = els[id], J = JENIS[k.jenis], S = STATUS[k.status];
  Object.values(els).forEach(o => o.el.classList.toggle("sel", o.k.id === id));
  svg.querySelectorAll(".e").forEach(p => p.classList.toggle("hot", p.dataset.a === id || p.dataset.b === id));
  if (diam) return;
  try { history.replaceState(null, "", "#" + id); } catch (e) {}
  const agen = k.agen.map(a => AGEN[a] ? `<span class="pill" style="color:var(${AGEN[a][1]})">${AGEN[a][0]}</span>` : "").join("");
  let h = `<div class="pills"><span class="pill" style="color:var(${J[1]})">${J[0]}</span><span class="pill" style="color:var(${S[1]})">${S[0]}</span>${agen}</div>
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

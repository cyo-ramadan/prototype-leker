(() => {
  const el = id => document.getElementById(id);
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[char]));
  const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  let portal = null;
  let deposits = null;
  let depositManual = { rupiah: 0, entries: [] };
  let depositTarget = null;
  // Mode Lihat (Bos Cyo, 2026-10-06): Entity Admin/Admin Gerai melihat Portal Staf milik akun yang
  // dipilih (?readonly=1&store=&account=). Semua tetap bisa dibaca; tombol yang menyimpan disembunyikan
  // dan server menolak penyimpanan apa pun dari token manajemen.
  const pageParams = new URLSearchParams(location.search);
  const viewerMode = pageParams.get('readonly') === '1' && !localStorage.getItem('lekerCashierToken');
  const viewerAccount = pageParams.get('account') || '';
  async function staffApi(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || `Request gagal (${response.status})`); error.status = response.status; error.code = payload.code; throw error; }
    return payload;
  }
  function dateTime(value) { return value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : ''; }
  function locationLine(fact) {
    if (!fact || fact.latitude == null || fact.longitude == null) return 'Lokasi tidak tersedia';
    const accuracy = fact.accuracyMeters != null ? ` (±${Math.round(fact.accuracyMeters)}m)` : '';
    return `${Number(fact.latitude).toFixed(5)}, ${Number(fact.longitude).toFixed(5)}${accuracy}`;
  }
  // Satu baris = satu sesi kerja penuh (masuk + pulang), bukan dua baris
  // event terpisah -- lihat migration 0068 dan src/staff-portal.js.
  function attendancePhotoThumb(row, which) {
    const fact = which === 'in' ? row.checkIn : row.checkOut;
    if (!fact) return '';
    // 2026-09-15, bug ketemu sendiri: endpoint foto presensi butuh Authorization
    // Bearer header (requireCashier), tapi <img src="..."> browser TIDAK PERNAH
    // mengirim header custom -- itu jalur fetch() JS punya (lihat
    // staff-auth-fetch.js yang nyuntik token ke window.fetch, bukan ke
    // permintaan gambar bawaan browser). Kalau src langsung diisi URL endpoint,
    // hasilnya 401 dan foto ga pernah kelihatan. Diperbaiki: src dikosongkan
    // dulu, diisi belakangan lewat fetch() + blob URL di loadAttendancePhotoThumbs().
    return `<img class="attendance-thumb" data-photo-attendance="${escapeHtml(row.id)}" data-photo-which="${which}" alt="Foto presensi ${which === 'in' ? 'datang' : 'pulang'}" loading="lazy" />`;
  }
  let attendancePhotoUrls = [];
  async function loadAttendancePhotoThumbs() {
    attendancePhotoUrls.forEach(url => URL.revokeObjectURL(url));
    attendancePhotoUrls = [];
    const nodes = [...document.querySelectorAll('[data-photo-attendance]')];
    await Promise.all(nodes.map(async img => {
      try {
        const response = await fetch(`/api/staff/attendance/${encodeURIComponent(img.dataset.photoAttendance)}/photo?which=${img.dataset.photoWhich}`);
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        attendancePhotoUrls.push(url);
        img.src = url;
      } catch {}
    }));
  }
  // Bos Cyo, 2026-09-19: "kalo telat kasih background merah muda kita, telat
  // 5 menit semakin merah warnanya, telat 10 menit ke atas lebih merah
  // banget ... ga telat ada tulisan di bold hijau, trrus kalo telat
  // berartintulisannya merah". lateMinutes null = shift_start belum diisi
  // Admin di Master Kasir -- tidak ditampilkan sama sekali, karena tidak ada
  // dasar untuk menilai telat/tidak.
  function latenessRowStyle(checkIn) {
    const lateMinutes = checkIn?.lateMinutes;
    if (lateMinutes == null || lateMinutes === 0) return '';
    if (lateMinutes < 5) return 'background:#ffe4ec';
    if (lateMinutes < 10) return 'background:#ffb3c6';
    return 'background:#ff8fa3';
  }
  function latenessBadge(checkIn) {
    const lateMinutes = checkIn?.lateMinutes;
    if (lateMinutes == null) return '';
    if (lateMinutes === 0) return ' · <span style="font-weight:800;color:#2f9e44">Tepat waktu</span>';
    const color = lateMinutes < 5 ? '#d6336c' : lateMinutes < 10 ? '#c2255c' : '#a4133c';
    return ` · <span style="font-weight:800;color:${color}">Telat ${lateMinutes} menit</span>`;
  }
  // Bos Cyo, 2026-10-01: permit koreksi jam presensi masuk (web error dsb.).
  // Hanya selagi sesi masih berjalan; setelah pulang, koreksi lewat Penyesuaian
  // Gaji oleh Admin. Lihat src/attendance-correction-permit.js.
  const clockTime = value => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(value));
  const CORRECTION_CHIPS = { PENDING: ['Menunggu ACC Admin', '#8b5d00'], REJECTED: ['Ditolak Admin', '#a4133c'], EXPIRED: ['Kadaluarsa', '#6c757d'] };
  function correctionPermitFor(attendanceId) {
    return (portal?.attendanceCorrectionPermits || []).find(permit => permit.attendanceId === attendanceId) || null;
  }
  function correctionBlockHtml(row) {
    if (row.correction) {
      const note = row.correction.decisionNote ? ` · Catatan Admin: ${escapeHtml(row.correction.decisionNote)}` : '';
      return `<div class="muted" style="margin-top:4px"><span style="font-weight:800;color:#1971c2">✎ Jam masuk dikoreksi</span> (tercatat asli ${escapeHtml(clockTime(row.correction.originalAt))}) · Alasan: ${escapeHtml(row.correction.reason)}${note}</div>`;
    }
    const permit = correctionPermitFor(row.id);
    let html = '';
    if (permit && permit.status !== 'APPROVED') {
      const [label, color] = CORRECTION_CHIPS[permit.status] || [permit.status, '#6c757d'];
      const detail = permit.status === 'PENDING'
        ? `diajukan ke ${escapeHtml(clockTime(permit.requestedCheckInAt))}`
        : escapeHtml(permit.decisionNote || '');
      html += `<div class="muted" style="margin-top:4px"><span style="font-weight:800;color:${color}">Koreksi jam masuk: ${escapeHtml(label)}</span>${detail ? ` · ${detail}` : ''}</div>`;
    }
    const canRequest = row.status === 'OPEN' && row.checkIn && (!permit || permit.status !== 'PENDING');
    if (canRequest) html += `<button type="button" class="secondary-btn" data-correct-attendance="${escapeHtml(row.id)}" style="margin-top:6px">Ajukan koreksi jam masuk</button>`;
    return html;
  }
  function openCorrectionDialog(attendanceId) {
    const row = (portal?.attendance || []).find(item => item.id === attendanceId);
    if (!row?.checkIn) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999';
    overlay.innerHTML = `<form style="background:#fff;border-radius:16px;padding:16px;max-width:420px;width:100%;display:grid;gap:10px">
      <h3 style="margin:0">Ajukan koreksi jam masuk</h3>
      <div class="muted">Jam masuk tercatat ${escapeHtml(clockTime(row.checkIn.at))}. Isi jam yang seharusnya dan alasan yang sah, mis. web error. Admin akan memutuskan ACC atau Tolak. Hanya bisa diajukan sebelum presensi pulang.</div>
      <label style="display:grid;gap:4px">Jam masuk seharusnya<input type="time" name="time" required /></label>
      <label style="display:grid;gap:4px">Alasan<textarea name="reason" rows="3" maxlength="500" required placeholder="mis. web presensi error sejak pagi"></textarea></label>
      <div class="staff-message" data-correction-message style="display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="secondary-btn" data-correction-cancel>Batal</button><button type="submit" class="primary-btn">Kirim pengajuan</button></div>
    </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const message = overlay.querySelector('[data-correction-message]');
    overlay.querySelector('[data-correction-cancel]').onclick = () => overlay.remove();
    form.onsubmit = async event => {
      event.preventDefault();
      message.style.display = 'none';
      try {
        await staffApi(`/api/staff/attendance/${encodeURIComponent(attendanceId)}/correction-permits`, {
          method: 'POST',
          body: JSON.stringify({ requestedTime: form.elements.time.value, reason: form.elements.reason.value })
        });
        overlay.remove();
        toastStaff('Pengajuan terkirim, menunggu ACC Admin.');
        await loadPortal();
      } catch (error) {
        message.textContent = error.message;
        message.style.display = 'block';
      }
    };
  }
  // Bos Cyo, 2026-10-01: presensi dinilai terhadap titik acuan gerai tetapi
  // TIDAK PERNAH ditolak; tanpa GPS atau di luar radius tetap tersimpan dan
  // kartunya diberi kolom merah. Karyawan hanya melihat selisih dari batas
  // (bukan batasnya). Perbaikan lewat permit; ACC memadamkan merahnya dengan
  // keterangan, ditolak tetap merah. Lihat src/attendance-gps.js.
  function gpsPermitFor(attendanceId, which) {
    return (portal?.attendanceGpsPermits || []).find(permit => permit.attendanceId === attendanceId && permit.which === which) || null;
  }
  function gpsLine(row, which) {
    const fact = which === 'IN' ? row.checkIn : row.checkOut;
    const gps = fact?.gps;
    if (!gps) return '';
    const title = which === 'IN' ? 'GPS presensi masuk' : 'GPS presensi pulang';
    if (gps.resolved) {
      return `<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:#ebfbee;color:#2b8a3e;font-size:13px"><b>✓ ${title} dikonfirmasi Admin</b>${gps.resolved.note ? ` · ${escapeHtml(gps.resolved.note)}` : ''}</div>`;
    }
    if (!gps.needsAttention) return '';
    const problem = gps.status === 'NO_GPS' ? 'tanpa GPS' : `melebihi batas radius ${gps.overRadiusMeters} meter`;
    const permit = gpsPermitFor(row.id, which);
    let action = '';
    if (!permit) action = `<div style="margin-top:6px"><button type="button" class="secondary-btn" data-gps-fix="${escapeHtml(row.id)}|${which}">Ajukan perbaikan GPS</button></div>`;
    else if (permit.status === 'PENDING') action = '<div style="margin-top:4px;font-size:13px">Perbaikan diajukan, menunggu ACC Admin.</div>';
    else if (permit.status === 'REJECTED') action = `<div style="margin-top:4px;font-size:13px">Perbaikan ditolak Admin${permit.decisionNote ? `: ${escapeHtml(permit.decisionNote)}` : ''}. Tanda tetap merah.</div>`;
    return `<div style="margin-top:6px;padding:6px 8px;border-radius:8px;background:#ffe3e3;border:1px solid #e03131;color:#c92a2a;font-size:13px"><b>⚠ ${title}: ${problem}</b>${action}</div>`;
  }
  function gpsBlockHtml(row) { return gpsLine(row, 'IN') + (row.checkOut ? gpsLine(row, 'OUT') : ''); }
  function openGpsFixDialog(attendanceId, which) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999';
    overlay.innerHTML = `<form style="background:#fff;border-radius:16px;padding:16px;max-width:420px;width:100%;display:grid;gap:10px">
      <h3 style="margin:0">Ajukan perbaikan GPS</h3>
      <div class="muted">Jelaskan kenapa GPS presensi ${which === 'IN' ? 'masuk' : 'pulang'} ini tidak sesuai, mis. GPS HP error padahal sudah di gerai. Admin akan memutuskan. Jika di-ACC tanda merahnya hilang dengan keterangan; jika ditolak tetap merah dan tidak bisa diajukan lagi.</div>
      <label style="display:grid;gap:4px">Alasan<textarea name="reason" rows="3" maxlength="500" required placeholder="mis. GPS HP error, saya sudah di gerai"></textarea></label>
      <div class="staff-message" data-gps-message style="display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="secondary-btn" data-gps-cancel>Batal</button><button type="submit" class="primary-btn">Kirim pengajuan</button></div>
    </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const message = overlay.querySelector('[data-gps-message]');
    overlay.querySelector('[data-gps-cancel]').onclick = () => overlay.remove();
    form.onsubmit = async event => {
      event.preventDefault();
      message.style.display = 'none';
      try {
        await staffApi(`/api/staff/attendance/${encodeURIComponent(attendanceId)}/gps-permits`, {
          method: 'POST',
          body: JSON.stringify({ which, reason: form.elements.reason.value })
        });
        overlay.remove();
        toastStaff('Pengajuan perbaikan GPS terkirim, menunggu ACC Admin.');
        await loadPortal();
      } catch (error) {
        message.textContent = error.message;
        message.style.display = 'block';
      }
    };
  }
  // Bos Cyo, 2026-09-24: "kartu presensi hari itu juga jadi warna kuning"
  // untuk sesi yang ditutup otomatis sistem karena lupa presensi pulang.
  function renderAttendance() {
    const rows = portal?.attendance || [];
    el('attendanceList').innerHTML = rows.length ? rows.map(row => `<div class="attendance-row" style="${row.autoClosed ? 'background:#fff3bf' : latenessRowStyle(row.checkIn)}"><div class="attendance-row-photos">${attendancePhotoThumb(row, 'in')}${attendancePhotoThumb(row, 'out')}</div><div><strong>${row.status === 'OPEN' ? 'Masih bekerja' : 'Sesi selesai'}</strong>${row.autoClosed ? ' · <span style="font-weight:800;color:#8b5d00">⚠ Ditutup otomatis sistem</span>' : ''}<div class="muted">Datang: ${row.checkIn ? `${escapeHtml(dateTime(row.checkIn.at))} · ${escapeHtml(locationLine(row.checkIn))}${latenessBadge(row.checkIn)}` : '—'}</div><div class="muted">Pulang: ${row.checkOut ? `${escapeHtml(dateTime(row.checkOut.at))} · ${escapeHtml(locationLine(row.checkOut))}${row.autoClosed ? ' · lupa presensi pulang' : ''}` : '—'}</div>${correctionBlockHtml(row)}${gpsBlockHtml(row)}</div><span>${row.status === 'OPEN' ? 'IN' : 'OUT'}</span></div>`).join('') : '<div class="staff-empty">Belum ada riwayat presensi.</div>';
    document.querySelectorAll('[data-correct-attendance]').forEach(button => button.onclick = () => openCorrectionDialog(button.dataset.correctAttendance));
    document.querySelectorAll('[data-gps-fix]').forEach(button => button.onclick = () => { const [id, which] = button.dataset.gpsFix.split('|'); openGpsFixDialog(id, which); });
    loadAttendancePhotoThumbs();
  }
  function metric(label, value, detail = '') { return `<div class="staff-card" style="margin:0"><div class="muted">${escapeHtml(label)}</div><h2 style="margin:5px 0">${escapeHtml(String(value))}</h2>${detail ? `<div class="muted">${escapeHtml(detail)}</div>` : ''}</div>`; }
  function renderKpi() {
    const target = el('staffKpiList'); if (!target) return;
    const kpi = portal?.kpi; if (!kpi?.facts) { target.innerHTML = '<div class="staff-empty">Belum ada data Raport.</div>'; return; }
    const facts = kpi.facts; const permits = facts.transactionVoidPermits || {};
    target.innerHTML = `<div class="staff-card"><div class="muted">Raport / KPI Facts</div><h2>Skor belum dikonfigurasi</h2><p class="muted">${escapeHtml(kpi.scoreMessage || '')}</p><div class="staff-message">Nilai final menunggu bobot, target, periode, dan grade yang disetujui.</div></div><div class="staff-metric-grid">${metric('Penjualan', facts.sales?.count || 0, money(facts.sales?.amount || 0))}${metric('Pembelian', facts.purchases?.count || 0, money(facts.purchases?.amount || 0))}${metric('Operasional', facts.operationalExpenses?.count || 0, money(facts.operationalExpenses?.amount || 0))}${metric('Permit koreksi transaksi', permits.requested || 0, `${permits.pending || 0} pending · ${permits.approved || 0} ACC · ${permits.rejected || 0} reject`)}${metric('Presensi', facts.attendance?.total || 0, `${facts.attendance?.closed || 0} selesai · ${facts.attendance?.open || 0} masih bekerja${facts.attendance?.autoClosed ? ` · ${facts.attendance.autoClosed} tidak tutup presensi` : ''}`)}${metric('Laci', facts.drawers?.total || 0, `${facts.drawers?.closed || 0} ditutup`)}</div><div class="staff-card" style="margin-top:14px"><h3>Input Penilaian</h3><div class="attendance-list">${(kpi.assessmentInputs || []).map(item => `<div class="attendance-row"><div><strong>${escapeHtml(item.label)}</strong><div class="muted">Source: ${escapeHtml(item.source)}</div></div><span>${escapeHtml(item.scoring)}</span></div>`).join('')}</div></div>`;
  }
  function renderPortal() {
    if (!portal) return;
    el('staffIdentity').textContent = `${portal.staff.employeeName} · ${portal.staff.store.code}`;
    const checkedIn = portal.attendanceStatus === 'in';
    const toggleBtn = el('attendanceToggleBtn');
    toggleBtn.textContent = checkedIn ? '📸 Presensi Pulang' : '📸 Presensi Datang';
    toggleBtn.className = checkedIn ? 'secondary-btn' : 'primary-btn';
    toggleBtn.dataset.attendanceType = checkedIn ? 'out' : 'in';
    renderAttendance();
    renderKpi();
    renderPayroll();
  }
  // Bos Cyo, 2026-09-19: "pendapatan gaji perharinya harusnya juga masukin ke
  // riwayat gaji". Satu baris per sesi presensi SELESAI -- dihitung ulang
  // server tiap load (src/staff-portal.js), bukan snapshot. Sesi yang masih
  // berjalan (OPEN) belum masuk daftar ini karena belum ada durasi final.
  //
  // Bos Cyo, 2026-09-24: "gaji nanti juga bisa dibuat oleh akuntan sendiri
  // ... jadi di tanggal 26 nanti akan terlihat 2 kartu, 1 dari presensi
  // normal, 2 tambah entryan akuntan." payrollAdjustments (entry manual
  // Admin) digabung per tanggal dengan payroll (dari presensi) di sini --
  // karyawan cuma bisa LIHAT, tidak bisa entry/batalkan sendiri (itu
  // kewenangan Admin, lihat public/admin-cashiers.js).
  function renderPayroll() {
    const target = el('staffPayrollList'); if (!target) return;
    const payrollRows = portal?.payroll || [];
    const adjustmentRows = portal?.payrollAdjustments || [];
    if (!payrollRows.length && !adjustmentRows.length) { target.innerHTML = '<div class="staff-empty">Belum ada riwayat gaji.</div>'; return; }
    const cardsByDate = new Map();
    const pushCard = (date, card) => { if (!cardsByDate.has(date)) cardsByDate.set(date, []); cardsByDate.get(date).push(card); };
    for (const row of payrollRows) pushCard(row.date, { kind: 'attendance', amountRupiah: row.earningRupiah, paymentType: row.paymentType, hoursWorked: row.hoursWorked, withinSchedule: row.withinSchedule, checkInAt: row.checkInAt, checkOutAt: row.checkOutAt });
    for (const row of adjustmentRows) pushCard(row.businessDate, { kind: 'adjustment', amountRupiah: row.amountRupiah, reason: row.reason, voided: row.voided, voidReason: row.voidReason });
    const dates = [...cardsByDate.keys()].sort((a, b) => (a < b ? 1 : -1));
    const grandTotal = [...cardsByDate.values()].flat().reduce((sum, card) => sum + (card.voided ? 0 : card.amountRupiah), 0);
    target.innerHTML = `
      <div class="staff-card" style="margin-bottom:12px"><div class="muted">Total</div><h2 style="margin:5px 0">${money(grandTotal)}</h2></div>
      ${dates.map(date => {
        const cards = cardsByDate.get(date);
        return `<div style="margin-bottom:10px"><div class="muted" style="margin-bottom:4px">${escapeHtml(date)}</div>
          <div class="attendance-list">${cards.map(card => `
            <div class="attendance-row" style="${card.voided ? 'opacity:.6' : ''}">
              <div><strong>${card.kind === 'adjustment' ? escapeHtml(card.reason) : (card.paymentType === 'SESI' ? 'Per sesi' : `Per jam${card.hoursWorked != null ? ` · ${card.hoursWorked} jam` : ''}`)}</strong>
                ${card.kind === 'adjustment' ? `<div class="muted">Penyesuaian dari Admin${card.voided ? ` · <span style="color:#c2255c">Dibatalkan: ${escapeHtml(card.voidReason)}</span>` : ''}</div>` : `<div class="muted">Dari presensi · Datang ${card.checkInAt ? escapeHtml(clockTime(card.checkInAt)) : '-'} · Pulang ${card.checkOutAt ? escapeHtml(clockTime(card.checkOutAt)) : '-'}${card.withinSchedule === false ? ' · <span style="color:#c2255c">Di luar jadwal, tidak dihitung</span>' : ''}</div>`}</div>
              <span style="${card.amountRupiah < 0 ? 'color:#c2255c' : ''}">${card.amountRupiah < 0 ? '-' : ''}${money(Math.abs(card.amountRupiah))}</span>
            </div>`).join('')}</div></div>`;
      }).join('')}`;
  }
  // Bos Cyo, 2026-09-19: "portal staf kasih tombol daily task ya ... isi2nya
  // aku mau kasih seperti pakai appron, bersih2, tes rasa2 ... pengaturan
  // task juga di set up oleh admin dari panel nya." Isinya diatur Admin
  // (src/staff-daily-task.js) -- daftar di sini murni menampilkan +
  // menandai selesai, tidak ada isi yang di-hardcode. Video bukti (max 8
  // detik, auto-hapus) BELUM ada, menunggu R2 diaktifkan Bos Cyo.
  let dailyTasks = null;
  function renderDailyTasks() {
    const target = el('staffDailyTaskList'); if (!target) return;
    const tasks = dailyTasks?.tasks || [];
    if (dailyTasks?.businessDate) el('dailyTaskDate').textContent = `Tanggal: ${escapeHtml(dailyTasks.businessDate)}`;
    if (!tasks.length) { target.innerHTML = '<div class="staff-empty">Admin belum mengatur tugas harian untuk gerai ini.</div>'; return; }
    target.innerHTML = tasks.map(task => `
      <div class="staff-card" style="margin-bottom:10px">
        <strong>${escapeHtml(task.title)}</strong>
        ${task.description ? `<div class="muted">${escapeHtml(task.description)}</div>` : ''}
        ${task.completed ? `<div class="muted" style="font-weight:800;color:#2f9e44;margin-top:6px">✓ Selesai${task.completedAt ? ` · ${escapeHtml(dateTime(task.completedAt))}` : ''}</div>` : ''}
        <div class="field" style="margin-top:8px"><label>Catatan <span class="field-note">opsional</span></label><input class="text-input daily-task-note" type="text" maxlength="500" value="${escapeHtml(task.note)}" /></div>
        <button type="button" class="${task.completed ? 'secondary-btn' : 'primary-btn'}" data-daily-task-complete="${escapeHtml(task.id)}" style="margin-top:8px">${task.completed ? 'Ubah catatan' : 'Tandai Selesai'}</button>
      </div>`).join('');
    target.querySelectorAll('[data-daily-task-complete]').forEach(button => {
      button.addEventListener('click', async () => {
        const card = button.closest('.staff-card');
        const note = card.querySelector('.daily-task-note').value;
        try {
          await staffApi('/api/staff/daily-tasks/complete', { method: 'POST', body: JSON.stringify({ templateId: button.dataset.dailyTaskComplete, note }) });
          await loadDailyTasks();
          toastStaff('Tugas ditandai selesai.');
        } catch (error) { toastStaff(error.message); }
      });
    });
  }
  async function loadDailyTasks() {
    try { dailyTasks = await staffApi('/api/staff/daily-tasks'); renderDailyTasks(); }
    catch (error) { const target = el('staffDailyTaskList'); if (target) target.innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`; }
  }

  // Bos Cyo, 2026-09-19: "tambahkan juga di portal staff tombol manual
  // book" -- halaman baru diisi Admin, dua lapis: Entity (semua gerai) +
  // Store (tambahan khusus gerai ini), keduanya read-only untuk kasir.
  function manualBookBlock(content) {
    return content
      ? `<div style="white-space:pre-wrap">${escapeHtml(content)}</div>`
      : '<div class="staff-empty">Belum diisi Admin.</div>';
  }
  async function loadManualBook() {
    try {
      const payload = await staffApi('/api/staff/manual-book');
      el('staffManualBookEntity').innerHTML = manualBookBlock(payload.entityContent);
      el('staffManualBookStore').innerHTML = manualBookBlock(payload.storeContent);
    } catch (error) {
      el('staffManualBookEntity').innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`;
    }
  }

  // Bos Cyo, 2026-09-19: "tambahkan juga tombol anoncement" -- papan
  // searah, staf cuma baca. Gabungan pengumuman entity-wide + khusus gerai
  // ini, urut terbaru dulu (src/staff-announcement.js).
  function renderAnnouncements(items) {
    const target = el('staffAnnouncementList'); if (!target) return;
    if (!items.length) { target.innerHTML = '<div class="staff-empty">Belum ada pengumuman.</div>'; return; }
    target.innerHTML = items.map(item => `
      <div class="staff-card" style="margin-bottom:10px">
        <div class="muted">${item.scope === 'ENTITY' ? 'Semua gerai' : 'Gerai ini'} · ${escapeHtml(dateTime(item.createdAt))} · ${escapeHtml(item.createdBy)}</div>
        <strong>${escapeHtml(item.title)}</strong>
        ${item.body ? `<div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(item.body)}</div>` : ''}
      </div>`).join('');
  }
  async function loadAnnouncements() {
    try { const payload = await staffApi('/api/staff/announcements'); renderAnnouncements(payload.announcements || []); }
    catch (error) { const target = el('staffAnnouncementList'); if (target) target.innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`; }
  }

  // Setoran CS (Bos Cyo, 2026-10-04): dua layar terpisah.
  //   - "Setor Uang" = tempat ENTRI: transfer dulu, lalu kirim nominal + FOTO bukti transfer.
  //   - "Riwayat Setoran" = hanya DATA, tampilannya sama dengan Riwayat Gaji: kartu Total,
  //     lalu kelompok per tanggal berisi setoran dari tutup laci (piutang bertambah) dan
  //     kiriman transfer (piutang berkurang setelah di-ACC Admin, tidak ada ACC otomatis).
  const approvalLabel = { pending_approval: 'Menunggu ACC Admin', approved: 'Sudah di-ACC', rejected: 'Ditolak' };
  const approvalColor = { pending_approval: '#8b5d00', approved: '#2f9e44', rejected: '#a4133c' };
  const MAKS_FOTO_SETORAN = 780 * 1024; // server menerima maks 800 KB
  let depositPhotoUrls = [];

  // Waktu dari database kadang "YYYY-MM-DD HH:MM:SS" (UTC tanpa zona): jadikan ISO UTC.
  const utcIso = value => { const text = String(value || ''); return /[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`; };
  const jakartaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date(utcIso(value)));
  const jakartaClock = value => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(new Date(utcIso(value)));
  const tanggalPanjang = value => new Intl.DateTimeFormat('id-ID', { dateStyle: 'full' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`));

  // Foto kamera HP biasanya 2-5 MB (iPhone: HEIC): diperkecil ke JPEG dulu di HP.
  async function kecilkanFotoSetoran(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('Pilih foto bukti transfer (JPG/PNG).');
    if (file.size <= MAKS_FOTO_SETORAN && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const gambar = new Image();
        gambar.onload = () => resolve(gambar);
        gambar.onerror = () => reject(new Error('Foto tidak bisa dibaca. Coba foto ulang.'));
        gambar.src = url;
      });
      for (const [maks, kualitas] of [[1600, 0.8], [1280, 0.7], [1024, 0.6], [800, 0.5]]) {
        const skala = Math.min(1, maks / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * skala));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * skala));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', kualitas));
        if (blob && blob.size <= MAKS_FOTO_SETORAN) return new File([blob], 'bukti-setoran.jpg', { type: 'image/jpeg' });
      }
      throw new Error('Foto terlalu besar. Coba foto ulang lebih dekat ke bukti transfernya.');
    } finally { URL.revokeObjectURL(url); }
  }

  const pendingSetoran = item => (item.payments || []).filter(p => p.approvalStatus === 'pending_approval').reduce((n, p) => n + Number(p.amountRupiah || 0), 0);
  const fotoSetoran = payment => payment.hasPhoto
    ? `<img class="attendance-thumb" data-deposit-photo="${escapeHtml(payment.id)}" alt="Foto bukti transfer" loading="lazy" style="cursor:zoom-in" />`
    : '';

  // --- Setor Uang (entri) ---------------------------------------------------
  function renderSetorForm() {
    const target = el('staffSetorForm'); if (!target) return;
    const items = deposits || [];
    const terbuka = items
      .map(item => ({ item, bisaDikirim: Number(item.balanceRupiah || 0) - pendingSetoran(item) }))
      .filter(row => row.bisaDikirim > 0)
      .sort((a, b) => String(a.item.transactionDate).localeCompare(String(b.item.transactionDate)));
    const totalSisa = items.reduce((n, item) => n + Math.max(0, Number(item.balanceRupiah || 0)), 0);
    const totalMenunggu = items.reduce((n, item) => n + pendingSetoran(item), 0);
    const ringkasan = `
      <div class="staff-metric-grid" style="margin-bottom:14px">
        <div class="staff-card" style="margin:0"><div class="muted">Yang harus disetor</div><h2 style="margin:5px 0">${money(totalSisa)}</h2></div>
        <div class="staff-card" style="margin:0"><div class="muted">Sudah dikirim, menunggu ACC Admin</div><h2 style="margin:5px 0">${money(totalMenunggu)}</h2></div>
        <div class="staff-card" style="margin:0"><div class="muted">Caranya</div><div>1. Transfer ke ${depositTarget?.name ? `<strong>${escapeHtml(depositTarget.name)}</strong>` : 'rekening yang ditentukan kantor'}. 2. Foto bukti transfernya. 3. Isi di bawah lalu kirim. Piutangmu berkurang setelah Admin klik ACC.</div></div>
      </div>`;
    if (!items.length) { target.innerHTML = `${ringkasan}<div class="staff-empty">Belum ada setoran. Setoran muncul otomatis setiap kali kamu tutup laci dan ada uang yang dibawa pulang.</div>`; return; }
    if (!terbuka.length) { target.innerHTML = `${ringkasan}<div class="staff-empty">Tidak ada yang perlu ditransfer sekarang. 👍${totalMenunggu ? ' Kiriman sebelumnya masih menunggu ACC Admin.' : ''}</div>`; return; }
    const opsi = terbuka.map(({ item, bisaDikirim }) => `<option value="${escapeHtml(item.id)}" data-sisa="${bisaDikirim}">Setoran laci ${escapeHtml(tanggalPanjang(jakartaDate(item.createdAt || item.transactionDate)))} · sisa ${money(bisaDikirim)}</option>`).join('');
    target.innerHTML = `${ringkasan}
      <div class="staff-card">
        <h2 style="margin-top:0">Kirim bukti transfer</h2>
        ${terbuka.length > 1 ? `<div class="field"><label>Untuk setoran yang mana</label><select id="setorPilih" class="text-input">${opsi}</select></div>` : `<input type="hidden" id="setorPilih" value="${escapeHtml(terbuka[0].item.id)}" data-sisa="${terbuka[0].bisaDikirim}" /><div class="muted" style="margin-bottom:8px">Setoran laci ${escapeHtml(tanggalPanjang(jakartaDate(terbuka[0].item.createdAt || terbuka[0].item.transactionDate)))}</div>`}
        <div class="field"><label>Nominal yang ditransfer</label><input id="setorNominal" class="text-input" inputmode="numeric" /></div>
        <div class="field"><label>Foto bukti transfer <span class="field-note">wajib</span></label><input id="setorFoto" class="text-input" type="file" accept="image/*" /></div>
        <div class="field"><label>Keterangan <span class="field-note">opsional</span></label><input id="setorKeterangan" class="text-input" type="text" maxlength="200" placeholder="mis. transfer BCA jam 21.10" /></div>
        <button type="button" class="primary-btn" id="setorKirim">Kirim Bukti Transfer</button>
      </div>`;
    const pilih = el('setorPilih');
    const nominal = el('setorNominal');
    window.MAXIAngka?.pasang(nominal, { desimal: false });
    const isiNominal = () => {
      const sisa = Number(pilih.tagName === 'SELECT' ? pilih.selectedOptions[0].dataset.sisa : pilih.dataset.sisa);
      nominal.value = window.MAXIAngka ? window.MAXIAngka.tampil(sisa) : String(sisa);
    };
    isiNominal();
    if (pilih.tagName === 'SELECT') pilih.addEventListener('change', isiNominal);
    el('setorKirim').addEventListener('click', async () => {
      const amountRupiah = window.MAXIAngka ? window.MAXIAngka.nilai(nominal.value) : Number(String(nominal.value).replace(/\D/g, ''));
      const file = el('setorFoto').files?.[0];
      if (!Number.isSafeInteger(amountRupiah) || amountRupiah <= 0) { toastStaff('Isi nominal yang ditransfer (angka bulat).'); return; }
      if (!file) { toastStaff('Foto bukti transfer wajib dilampirkan.'); return; }
      const tombol = el('setorKirim');
      tombol.disabled = true;
      try {
        const form = new FormData();
        form.set('amountRupiah', String(amountRupiah));
        form.set('proofReference', el('setorKeterangan').value.trim());
        form.set('photo', await kecilkanFotoSetoran(file));
        await staffApi(`/api/cashier/employee-deposits/${encodeURIComponent(pilih.value)}/payments`, { method: 'POST', body: form });
        await loadDeposits();
        document.querySelector('[data-staff-tab="deposits"]')?.click();
        toastStaff('Bukti transfer terkirim, menunggu ACC Admin. Piutang berkurang setelah di-ACC.');
      } catch (error) { toastStaff(error.message); tombol.disabled = false; }
    });
  }

  // --- Riwayat Setoran (data saja, gaya Riwayat Gaji) ------------------------
  async function loadDepositPhotoThumbs() {
    depositPhotoUrls.forEach(url => URL.revokeObjectURL(url));
    depositPhotoUrls = [];
    await Promise.all([...document.querySelectorAll('[data-deposit-photo]')].map(async img => {
      try {
        const response = await fetch(`/api/cashier/employee-deposits/payments/${encodeURIComponent(img.dataset.depositPhoto)}/photo`);
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        depositPhotoUrls.push(url);
        img.src = url;
        img.onclick = () => window.open(url, '_blank');
      } catch {}
    }));
  }

  function renderDeposits() {
    const target = el('staffDepositList'); if (!target) return;
    const items = deposits || [];
    const manualEntries = depositManual.entries || [];
    if (!items.length && !manualEntries.length) { target.className = 'staff-empty'; target.innerHTML = 'Belum ada riwayat setoran.'; return; }
    target.className = '';
    const cardsByDate = new Map();
    const pushCard = (date, card) => { if (!cardsByDate.has(date)) cardsByDate.set(date, []); cardsByDate.get(date).push(card); };
    for (const item of items) {
      const sumber = item.createdAt || item.transactionDate;
      pushCard(jakartaDate(sumber), { kind: 'laci', at: utcIso(sumber), amountRupiah: Number(item.originalAmountRupiah || 0) });
      for (const payment of item.payments || []) {
        pushCard(jakartaDate(payment.createdAt), { kind: 'transfer', at: utcIso(payment.createdAt), amountRupiah: Number(payment.amountRupiah || 0), payment });
      }
    }
    // Penyesuaian dari jurnal Akuntansi (atas nama karyawan ini): + menambah piutang, - mengurangi.
    for (const entry of manualEntries) pushCard(entry.businessDate, { kind: 'jurnal', at: `${entry.businessDate}T00:00:00.000Z`, entry });
    const dates = [...cardsByDate.keys()].sort((a, b) => (a < b ? 1 : -1));
    const totalSisa = items.reduce((n, item) => n + Number(item.balanceRupiah || 0), 0) + Number(depositManual.rupiah || 0);
    const totalMenunggu = items.reduce((n, item) => n + pendingSetoran(item), 0);
    target.innerHTML = `
      <div class="staff-card" style="margin-bottom:12px"><div class="muted">Sisa piutang setoran</div><h2 style="margin:5px 0">${money(totalSisa)}</h2>${totalMenunggu ? `<div class="muted">${money(totalMenunggu)} sedang menunggu ACC Admin</div>` : ''}</div>
      ${dates.map(date => {
        const cards = cardsByDate.get(date).sort((a, b) => (a.at < b.at ? 1 : -1));
        return `<div style="margin-bottom:10px"><div class="muted" style="margin-bottom:4px">${escapeHtml(date)}</div>
          <div class="attendance-list">${cards.map(card => {
            if (card.kind === 'laci') {
              return `<div class="attendance-row">
                <div><strong>Setoran dari tutup laci</strong><div class="muted">Tutup laci jam ${escapeHtml(jakartaClock(card.at))} · uang yang dibawa pulang</div></div>
                <span>${money(card.amountRupiah)}</span></div>`;
            }
            if (card.kind === 'jurnal') {
              const e = card.entry; const rupiah = Number(e.signedScaled || 0) / 1000000;
              return `<div class="attendance-row">
                <div><strong>Penyesuaian dari Akuntansi</strong><div class="muted">Jurnal ${escapeHtml(e.journalNumber || '')}${e.description ? ` · ${escapeHtml(e.description)}` : ''}</div></div>
                <span>${rupiah < 0 ? '−' : '+'}${money(Math.abs(rupiah))}</span></div>`;
            }
            const p = card.payment;
            const warna = approvalColor[p.approvalStatus] || '#555';
            const redup = p.approvalStatus === 'rejected' ? 'opacity:.6' : '';
            const catatan = p.proofReference && p.proofReference !== 'Foto bukti transfer' ? ` · ${escapeHtml(p.proofReference.replace(/^Foto bukti transfer · /, ''))}` : '';
            return `<div class="attendance-row" style="${redup}">
              <div><strong>${p.usedForAdminPayment ? 'Dipakai membayar (oleh Admin)' : p.sharedAccountName ? `Transfer setoran ke ${escapeHtml(p.sharedAccountName)}` : 'Transfer setoran'}</strong>
                <div class="muted">Dikirim jam ${escapeHtml(jakartaClock(card.at))}${catatan}${p.reviewedAt ? ` · diputuskan ${escapeHtml(dateTime(utcIso(p.reviewedAt)))}` : ''}</div>
                <div class="muted"><span style="font-weight:800;color:${warna}">${escapeHtml(approvalLabel[p.approvalStatus] || p.approvalStatus)}</span>${p.rejectionReason ? ` · <span style="color:#c2255c">Alasan ditolak: ${escapeHtml(p.rejectionReason)}</span>` : ''}</div></div>
              <div class="attendance-row-photos" style="align-items:center">${fotoSetoran(p)}<span style="color:${p.approvalStatus === 'approved' ? '#2f9e44' : '#555'}">−${money(card.amountRupiah)}</span></div></div>`;
          }).join('')}</div></div>`;
      }).join('')}`;
    loadDepositPhotoThumbs();
  }
  function toastStaff(message) { showCameraMessage(message); setTimeout(clearCameraMessage, 4000); }
  async function loadDeposits() { try { const payload = await staffApi('/api/cashier/employee-deposits'); deposits = payload.items || []; depositManual = { rupiah: payload.manualAdjustmentRupiah || 0, entries: payload.manualEntries || [] }; depositTarget = payload.depositTarget || null; renderDeposits(); renderSetorForm(); } catch (error) { const pesan = `<div class="staff-message">${escapeHtml(error.message)}</div>`; el('staffDepositList').innerHTML = pesan; if (el('staffSetorForm')) el('staffSetorForm').innerHTML = pesan; } }
  async function loadPortal() { try { portal = await staffApi('/api/staff/portal'); renderPortal(); } catch (error) { if (error.status === 401 && !viewerMode) { localStorage.removeItem('lekerCashierToken'); localStorage.removeItem('lekerStaffSessionMeta'); location.replace('/login'); return; } el('attendanceList').innerHTML = `<div class="staff-message">${escapeHtml(error.message)}</div>`; } }
  function showCameraMessage(message) { const node = el('staffCameraMessage'); node.textContent = message; node.classList.remove('hidden'); }
  function clearCameraMessage() { const node = el('staffCameraMessage'); node.textContent = ''; node.classList.add('hidden'); }
  async function submitAttendance(type, blob, geo) {
    const form = new FormData();
    form.set('type', type);
    form.set('photo', blob, `attendance-${type}.jpg`);
    if (geo?.latitude != null) form.set('latitude', String(geo.latitude));
    if (geo?.longitude != null) form.set('longitude', String(geo.longitude));
    if (geo?.accuracy != null) form.set('accuracy', String(geo.accuracy));
    const result = await staffApi('/api/staff/attendance', { method: 'POST', body: form });
    portal = await staffApi('/api/staff/portal');
    renderPortal();
    clearCameraMessage();
    // Presensi selalu tersimpan; kalau GPS bermasalah, beri tahu (tanpa menyebut batas radius).
    if (result?.gps?.notice) { showCameraMessage(result.gps.notice); setTimeout(clearCameraMessage, 10000); }
  }
  function startAttendance(type) {
    clearCameraMessage();
    window.CameraSnapshotModal.open({
      facingMode: 'user',
      title: type === 'out' ? 'Presensi Pulang' : 'Presensi Datang',
      watermark: true,
      onCaptureSuccess: async (blob, geo) => { try { await submitAttendance(type, blob, geo); } catch (error) { showCameraMessage(error.message); } },
      onPermissionDenied: error => { const detail = error?.name === 'NotAllowedError' ? 'Akses kamera ditolak.' : 'Kamera tidak tersedia.'; showCameraMessage(`${detail} Buka permission kamera di browser lalu coba lagi.`); }
    });
  }
  // Bos Cyo, 2026-09-19: "presensi itu kalo di klik langsung jadi modal buat
  // presensi aja, engga perlu habis klik itu trus klik tombol lagi" -- klik
  // tab Presensi langsung membuka kamera, tombol Presensi Datang/Pulang di
  // bawahnya tetap ada cuma untuk retry kalau modal sebelumnya dibatalkan
  // (izin kamera ditolak, dsb), bukan langkah wajib lagi.
  function bindTabs() {
    document.querySelectorAll('[data-staff-tab]').forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.dataset.staffTab;
        document.querySelectorAll('[data-staff-tab]').forEach(item => item.classList.toggle('active', item === button));
        document.querySelectorAll('.staff-panel').forEach(panel => panel.classList.toggle('active', panel.id === `staffPanel${tab[0].toUpperCase()}${tab.slice(1)}`));
        if (tab === 'attendance') startAttendance(el('attendanceToggleBtn').dataset.attendanceType || 'in');
      });
    });
  }
  async function setupViewer() {
    el('staffLogoutBtn').classList.add('hidden');
    const store = pageParams.get('store') || '';
    const storeQuery = store ? `?store=${encodeURIComponent(store)}` : '';
    // Tombol kembali ke panel asal (Logout tidak ada artinya di Mode Lihat).
    const chip = el('staffLogoutBtn').parentElement;
    const back = [
      ['/branch-admin' + storeQuery, '← Admin Gerai', true],
      ['/entity-admin', '← Entity Admin', Boolean(localStorage.getItem('lekerEntityAdminToken'))],
      ['/owner', '← Owner', Boolean(localStorage.getItem('lekerOwnerToken'))]
    ].filter(item => item[2]).map(([href, label]) => `<a class="secondary-btn" href="${href}" style="text-decoration:none;color:inherit" data-viewer-back>${label}</a>`).join('');
    el('staffLogoutBtn').insertAdjacentHTML('beforebegin', back);
    chip.querySelectorAll('[data-viewer-back]').forEach(link => link.addEventListener('click', () => window.lekerPrepareStaffHandoff?.()));
    const bar = document.createElement('div');
    bar.className = 'staff-card';
    bar.innerHTML = `<div class="muted">Mode Lihat · semua tombol bisa dicoba seperti karyawan, tapi data tidak akan disimpan</div>
      <div class="field" style="margin:8px 0 0"><label>Lihat Portal Staf akun</label><select id="staffViewerAccount" class="text-input"><option value="">Memuat daftar akun…</option></select></div>`;
    document.querySelector('.staff-hero').after(bar);
    try {
      const { accounts } = await staffApi('/api/staff/viewer-accounts');
      const select = el('staffViewerAccount');
      const groups = new Map();
      for (const account of accounts) {
        const key = `${account.storeCode} · ${account.storeName}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(account);
      }
      select.innerHTML = `<option value="">Pilih akun…</option>${[...groups].map(([label, rows]) => `<optgroup label="${escapeHtml(label)}">${rows.map(row => `<option value="${escapeHtml(row.id)}" data-store="${escapeHtml(row.storeCode)}" ${row.id === viewerAccount ? 'selected' : ''}>${escapeHtml(row.employeeName || row.username)} (${escapeHtml(row.username)})${row.isActive ? '' : ' · nonaktif'}</option>`).join('')}</optgroup>`).join('')}`;
      select.addEventListener('change', () => {
        const option = select.selectedOptions[0];
        if (!option?.value) return;
        window.lekerPrepareStaffHandoff?.();
        location.assign(`/staff?readonly=1&store=${encodeURIComponent(option.dataset.store)}&account=${encodeURIComponent(option.value)}`);
      });
    } catch (error) { el('staffViewerAccount').innerHTML = `<option value="">${escapeHtml(error.message)}</option>`; }
  }

  if (viewerMode) {
    el('backCashierBtn').addEventListener('click', () => { window.lekerPrepareStaffHandoff?.(); location.assign(`/cashier?readonly=1${pageParams.get('store') ? `&store=${encodeURIComponent(pageParams.get('store'))}` : ''}`); });
    el('attendanceToggleBtn').addEventListener('click', () => startAttendance(el('attendanceToggleBtn').dataset.attendanceType || 'in'));
    setupViewer();
    if (!viewerAccount) {
      el('attendanceList').innerHTML = '<div class="staff-empty">Pilih akun di atas untuk melihat Portal Staf-nya.</div>';
      return;
    }
  } else {
    el('attendanceToggleBtn').addEventListener('click', () => startAttendance(el('attendanceToggleBtn').dataset.attendanceType || 'in'));
    el('backCashierBtn').addEventListener('click', () => { window.lekerPrepareStaffHandoff?.(); location.assign('/cashier'); });
    el('staffLogoutBtn').addEventListener('click', async () => { try { await staffApi('/api/cashier/logout', { method: 'POST' }); } catch {} window.lekerClearStaffSession?.(); localStorage.removeItem('lekerCashierToken'); localStorage.removeItem('lekerStaffSessionMeta'); location.replace('/login'); });
  }
  bindTabs(); loadPortal(); loadDeposits(); loadDailyTasks(); loadManualBook(); loadAnnouncements();
})();

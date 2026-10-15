/* U4 Una Live (contracts/una-live-workspace-v1.md bagian 3 dan 4): satu pintu untuk giliran
 * ketik dan suara. Menyusun konteks lembar yang dikirim ke server, menjalankan uiActions lewat
 * registry (U1) satu per satu, memancarkan progres nyata, dan menyimpulkan tanda terima.
 * Tidak pernah mengeklik tombol atau menyentuh draft bisnis; narasi yang disela tidak
 * membatalkan aksi. */
(() => {
  'use strict';
  const LABEL = {
    'page.open': 'Buka halaman di Workspace',
    'page.read_state': 'Baca keadaan halaman',
    'report.set_filters': 'Atur tanggal laporan dan muat datanya',
    'report.refresh': 'Muat ulang laporan',
    'surface.focus': 'Pindah lembar',
    'surface.close': 'Tutup tampilan lembar',
    'task.open': 'Buka tugas',
    'canvas.create': 'Buka lembar gambar',
    'canvas.read': 'Baca lembar gambar',
    'canvas.apply_patch': 'Ubah lembar gambar'
  };
  const MAKS_KONTEKS = 4096;

  function create(w) {
    let last = null; let menuTab = null; let urutan = 0;
    const pertanyaan = new Map(); // turnId -> teks pesan Bos (untuk pembaca kanvas)
    const berjalan = new Map(); // actionId -> { batal }
    const uuid = () => (w.crypto?.randomUUID ? w.crypto.randomUUID() : Date.now().toString(36) + '-' + (++urutan));
    const emit = (name, detail) => { if (typeof w.CustomEvent === 'function') w.dispatchEvent?.(new w.CustomEvent(name, { detail })); };
    const siap = () => !!(w.UnaLembar && w.UnaRegistry);

    w.addEventListener?.('entity-admin-tab', e => { menuTab = e.detail?.name || null; });
    w.addEventListener?.('caca-scope-change', () => { last = null; for (const v of berjalan.values()) v.batal = true; berjalan.clear(); });
    w.addEventListener?.('una-live:receipt', e => {
      const r = e.detail; if (!r?.capabilityId || r.replayed) return;
      last = { capabilityId: r.capabilityId, status: r.status, summary: r.summary || {} };
    });

    function turn() { return 'turn_' + uuid(); }

    // Konteks giliran: diambil dari state yang sedang tampil SAAT pesan dikirim, jadi filter
    // yang diubah Bos sendiri ikut terbawa (bukan filter terakhir yang diatur Una).
    function context({ conversationId = null, turnId }) {
      if (!siap()) return null;
      const c = w.UnaLembar.context() || {};
      const s = c.surface || null;
      let page = null; let filters = null; let surfaceKind = s?.kind || null;
      if (s?.kind === 'page' && s.content) page = { halaman: s.content.halaman, tab: s.content.tab };
      else if (!s?.kind && menuTab && c.lingkup === 'entity') { page = { halaman: 'entity', tab: menuTab }; surfaceKind = null; }
      if (page) {
        const st = w.UnaPageAdapters?.[page.halaman + ':' + page.tab]?.readState?.();
        if (st?.from && st?.to) filters = { from: st.from, to: st.to, ...(Array.isArray(st.stores) ? { stores: st.stores.slice(0, 100) } : {}) };
        else if (s?.content?.filters?.from) filters = s.content.filters;
      }
      const id = typeof s?.id === 'string' && /^(srf_|task:)/.test(s.id) ? s.id : null;
      const ctx = {
        conversationId: conversationId ? String(conversationId).slice(0, 64) : null, turnId,
        scopeEpoch: Number.isSafeInteger(c.scopeEpoch) ? c.scopeEpoch : 0,
        activeSurfaceId: id, surfaceRevision: id && Number.isSafeInteger(s.revision) ? s.revision : null,
        surfaceKind, page, filters, selection: null, lastAction: last
      };
      if (JSON.stringify(ctx).length > MAKS_KONTEKS) { ctx.lastAction = null; if (ctx.filters) delete ctx.filters.stores; }
      emit('una-live:context', ctx);
      return ctx;
    }

    // Mengikat perintah laporan buatan kode ke lembar yang benar sebelum divalidasi registry.
    // - target null hanya sah sesudah page.open ok di giliran yang sama: diikat ke lembar itu.
    // - target berisi revisi lama (autosave Una/Bos selesai saat pesan di jalan): diikat ke
    //   revisi terbaru HANYA bila filter yang tampil masih sama dengan dasar perintah (konteks
    //   yang dikirim). Bila Bos sudah mengubah filter, perintah dibiarkan dan validator menolak
    //   REVISION_CONFLICT. Perintah dari model tidak pernah diikat ulang.
    async function bind(aksi, basis, sebelumnya) {
      const L = w.UnaLembar;
      // canvas.read membaca yang Bos lihat SEKARANG: coretan yang belum tersimpan disimpan dulu,
      // lalu dibaca pada revisi hasil simpan itu (lembar yang sama saja).
      if (aksi.origin === 'code' && aksi.capabilityId === 'canvas.read') {
        const s = L.context()?.surface;
        if (!s || s.kind !== 'canvas' || aksi.target?.surfaceId !== s.id) return aksi;
        if (L.context()?.dirty) await L.save?.(s.id);
        const kini = L.context()?.surface || s;
        return kini.revision === aksi.target.expectedRevision ? aksi : { ...aksi, target: { surfaceId: s.id, expectedRevision: kini.revision } };
      }
      if (aksi.origin !== 'code' || !/^report\./.test(aksi.capabilityId)) return aksi;
      let s = L.context()?.surface;
      if (!s || s.kind !== 'page' || !s.content) return aksi;
      const kunci = s.content.halaman + ':' + s.content.tab;
      if (aksi.target && aksi.target.surfaceId !== s.id) return aksi;
      if (!aksi.target && !(sebelumnya?.capabilityId === 'page.open' && sebelumnya.status === 'ok' && sebelumnya.surfaceId === s.id)) return aksi;
      if (aksi.target && basis?.filters) {
        const kini = w.UnaPageAdapters?.[kunci]?.readState?.() || {};
        if (kini.from !== basis.filters.from || kini.to !== basis.filters.to) return aksi;
      }
      if (L.context()?.dirty || L.client?.()?.get?.(s.id)?.dirty) { await L.save?.(s.id); s = L.context()?.surface || s; }
      if (aksi.target?.expectedRevision === s.revision) return aksi;
      return { ...aksi, target: { surfaceId: s.id, expectedRevision: s.revision } };
    }

    // Aksi dijalankan berurutan; berhenti di tanda terima pertama yang bukan ok.
    async function run(actions, { turnId, onStep, basis = null, question = '' } = {}) {
      if (!siap() || !Array.isArray(actions) || !actions.length) return [];
      if (turnId && question) { pertanyaan.set(turnId, String(question).slice(0, 200)); if (pertanyaan.size > 20) pertanyaan.delete(pertanyaan.keys().next().value); }
      const tanda = [];
      for (const aksi of actions.slice(0, 3)) {
        const label = LABEL[aksi.capabilityId] || 'Kerjakan perintah';
        const jejak = { batal: false }; berjalan.set(aksi.actionId, jejak);
        emit('una-live:progress', { turnId, actionId: aksi.actionId, step: tanda.length + 1, phase: 'start', label });
        onStep?.({ phase: 'start', label, done: tanda.map(t => t.label) });
        let r;
        try { r = await w.UnaRegistry.execute(await bind(aksi, basis, tanda[tanda.length - 1])); }
        catch { r = { actionId: aksi.actionId, capabilityId: aksi.capabilityId, status: 'failed', code: 'DATA_FAILED', message: 'Tindakan gagal. Periksa halaman sebelum mengulang.', summary: {} }; }
        berjalan.delete(aksi.actionId);
        if (jejak.batal && r.status === 'ok') r = { ...r, status: 'cancelled', code: 'SUPERSEDED', message: 'Bos minta berhenti; hasil ini tidak diumumkan.' };
        r.label = label;
        tanda.push(r);
        emit('una-live:progress', { turnId, actionId: aksi.actionId, step: tanda.length, phase: r.status === 'ok' ? 'done' : 'failed', label });
        if (r.status !== 'ok') break;
      }
      return tanda;
    }

    // Kalimat akhir berasal dari tanda terima, bukan dari janji server. null = diam (digantikan
    // perintah lebih baru yang akan melapor sendiri).
    function conclude(receipts, payload = {}) {
      const r = receipts[receipts.length - 1];
      if (!r) return { text: 'Workspace Una belum siap di halaman ini, Bos. Muat ulang halaman lalu coba lagi.', ask: true };
      if (r.status === 'superseded' || r.status === 'cancelled') return null;
      if (r.status === 'ok') {
        if (r.capabilityId === 'canvas.read') return w.UnaKanvasBaca?.ringkas(r.actionId) || { text: 'Lembar sudah dibaca, Bos.', ask: false };
        if (r.capabilityId === 'report.set_filters' || r.capabilityId === 'report.refresh') {
          const f = r.proof?.filters; const dibaca = payload.rentang?.dibaca;
          const toko = Number.isInteger(r.summary?.storeCount) ? ` untuk ${r.summary.storeCount} gerai` : '';
          return { text: `Laporan ${dibaca || (f ? f.from + ' s/d ' + f.to : '')}${toko} sudah tampil di Workspace, Bos.`, ask: false };
        }
        return { text: r.message || 'Sudah, Bos.', ask: false };
      }
      if (r.status === 'needs_clarification') return { text: r.clarification?.question || r.message, ask: true, options: r.clarification?.options || [] };
      if (r.status === 'stale') return { text: 'Akun atau lingkupnya sudah berganti, jadi perintah tadi tidak Una jalankan.', ask: false };
      return { text: r.message || 'Belum berhasil, Bos.', ask: true };
    }

    // "stop/berhenti": berhenti menunggu baca yang sedang jalan. Tidak menyentuh draft bisnis.
    function cancelReads() {
      let n = 0; for (const v of berjalan.values()) { v.batal = true; n++; }
      // Registry (U1) berhenti merender hasil baca/tampilan yang sedang jalan; fetch fisik bisa
      // tetap selesai tetapi hasilnya tidak digambar. Draft/artefak tidak tersentuh.
      return Math.max(n, w.UnaRegistry?.cancelReads?.() || 0);
    }
    const pending = () => berjalan.size;

    return { turn, context, run, conclude, cancelReads, pending, question: id => pertanyaan.get(id) || '', label: id => LABEL[id] || id };
  }

  const api = create(window);
  window.UnaDispatcher = { ...api, create };
})();

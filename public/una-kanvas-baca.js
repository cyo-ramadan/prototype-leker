/* U7 Una Live: handler canvas.read. Snapshot dibekukan (revisi + editSerial + PNG + objek),
 * dibaca server lewat model Una yang sudah ada, lalu dibandingkan lagi dengan kanvas saat hasil
 * tiba: bila Bos sudah mencoret lagi, hasil ditandai bacaan versi sebelumnya dan usulannya tidak
 * bisa diterapkan. Usulan tulisan diterapkan hanya lewat tombol, sebagai patch tervalidasi yang
 * bisa di-undo. Usulan bisnis hanya ditaruh di kotak ketik. */
(() => {
  'use strict';
  const bacaan = new Map(); // actionId -> hasil server + snapshot
  const MAKS = 30;

  function simpan(id, nilai) {
    bacaan.set(id, nilai);
    if (bacaan.size > MAKS) bacaan.delete(bacaan.keys().next().value);
  }
  const api = (path, opsi) => (typeof cacaApi === 'function' ? cacaApi(path, opsi) : Promise.reject(new Error('Chat Una belum termuat.')));
  const lingkup = () => (typeof cacaQueryLingkup === 'function' && typeof cacaState !== 'undefined' ? cacaQueryLingkup(cacaState.scope) : '');

  async function execute(params, exec) {
    const L = window.UnaLembar; const s = L?.active();
    const editor = s && L.editor(s.id);
    if (!s || s.kind !== 'canvas' || !editor) return { ok: false, code: 'PRECONDITION_FAILED', message: 'Buka lembar gambarnya dulu, Bos.' };
    const snap = await editor.snapshot(params.objectIds);
    const pertanyaan = window.UnaDispatcher?.question?.(exec.command.turnId) || '';
    let res;
    try {
      res = await api(`/api/caca/kanvas/baca?${lingkup()}`, { method: 'POST', body: JSON.stringify({
        surfaceId: snap.surfaceId, revision: snap.revision, pertanyaan,
        gambar: { media_type: 'image/png', data: snap.png.split(',')[1] }, objek: snap.objects
      }) });
    } catch (error) {
      return { ok: false, code: error.status === 409 ? 'REVISION_CONFLICT' : 'DATA_FAILED', message: error.message || 'Una belum bisa membaca gambar ini.' };
    }
    if (exec.isCurrent?.() === false) return { ok: false, status: 'superseded', code: 'SUPERSEDED' };
    const stale = editor.model.revision() !== snap.revision || editor.model.serial() !== snap.editSerial;
    simpan(exec.command.actionId, { ...res, stale, snapshot: { surfaceId: snap.surfaceId, revision: snap.revision, editSerial: snap.editSerial } });
    return {
      ok: true, surfaceId: s.id, resultRevision: snap.revision, message: 'Lembar sudah dibaca.',
      summary: { stale, observations: res.observations?.length || 0, intents: res.intents?.length || 0, unclear: res.unclear?.length || 0 },
      proof: { kind: 'state_read', at: new Date().toISOString() }
    };
  }

  const butir = xs => xs.map(x => '• ' + x).join('\n');
  // Kalimat jawaban + tombol usulan untuk satu tanda terima canvas.read.
  function ringkas(actionId) {
    const b = bacaan.get(actionId);
    if (!b) return null;
    const bagian = [];
    if (b.stale) bagian.push('Catatan: ini bacaan versi sebelum coretan terakhir Bos. Minta Una lihat lagi kalau perlu.');
    if (b.observations?.length) bagian.push('Yang Una lihat:\n' + butir(b.observations));
    if (b.intents?.length) bagian.push('Dugaan maksudnya:\n' + butir(b.intents));
    if (b.unclear?.length) bagian.push('Yang belum jelas:\n' + butir(b.unclear));
    if (!bagian.length) bagian.push('Una belum menangkap isi gambarnya. Coba tambahkan tulisan atau tanya bagian tertentu.');
    const tawaran = [];
    if (!b.stale && b.proposedPatch?.length) tawaran.push({ jenis: 'kanvas_usulan', label: `Tambahkan ${b.proposedPatch.length} catatan Una di gambar`, actionId });
    for (const teks of b.proposedMessages || []) tawaran.push({ jenis: 'isi', label: `Pakai: ${teks.length > 40 ? teks.slice(0, 40) + '…' : teks}`, teks });
    return { text: bagian.join('\n\n'), ask: !!b.unclear?.length, tawaran };
  }

  // Tombol "Tambahkan catatan Una": patch hanya bila kanvas masih persis seperti yang dibaca.
  async function terapkan(actionId) {
    const b = bacaan.get(actionId);
    const L = window.UnaLembar; const s = L?.active(); const editor = s && L.editor(s.id);
    if (!b || !b.proposedPatch?.length) return { ok: false, message: 'Usulannya sudah tidak ada.' };
    if (!s || s.id !== b.snapshot.surfaceId || !editor) return { ok: false, message: 'Buka lagi lembar gambar yang tadi dibaca, Bos.' };
    if (editor.model.revision() !== b.snapshot.revision || editor.model.serial() !== b.snapshot.editSerial) return { ok: false, message: 'Gambarnya sudah berubah sejak dibaca. Minta Una lihat lagi dulu.' };
    const c = L.context();
    const r = await window.UnaRegistry.execute({
      actionId: 'act_' + (crypto.randomUUID?.() || Date.now().toString(36)), turnId: 'turn_' + (crypto.randomUUID?.() || Date.now().toString(36)),
      capabilityId: 'canvas.apply_patch', capabilityVersion: 1, params: { operations: b.proposedPatch },
      target: { surfaceId: s.id, expectedRevision: b.snapshot.revision }, scopeEpoch: c.scopeEpoch, origin: 'user'
    });
    if (r.status === 'ok') bacaan.delete(actionId);
    return { ok: r.status === 'ok', message: r.status === 'ok' ? 'Catatan Una sudah ditambahkan di gambar. Bisa dibatalkan dengan Undo.' : (r.message || 'Belum berhasil menambahkan catatan.') };
  }

  function bind(registry) { registry.register('canvas.read', { execute, verify: r => !!r.surfaceId && bacaan.size > 0 }); }
  window.UnaKanvasBaca = { bind, ringkas, terapkan, _execute: execute };
  if (window.UnaRegistry) bind(window.UnaRegistry);
})();

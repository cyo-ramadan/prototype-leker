// Pengenalan pemilik lokal, terikat akun/tenant/perangkat. Bukan pengganti login.
// PCM hanya hidup di memori dan Worker; profil hanya menyimpan embedding.
// Model WavLM: Microsoft/Xenova, CC BY-SA 3.0. Lihat kerangka-suara-model-worker.js.
(function (global) {
  const MODEL = 'Xenova/wavlm-base-plus-sv';
  const REVISION = '839012c1abfd543d1f5178201a444706e85d3b07';
  const DIM = 512;
  const THRESHOLD = 0.86; // Dataset-dependent; must be validated on actual users/devices.
  function cosine(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) throw new Error('Profil suara tidak valid.');
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Profil suara tidak valid.');
      dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
    }
    if (aa < 1e-12 || bb < 1e-12) throw new Error('Suara belum terbaca.');
    return dot / Math.sqrt(aa * bb);
  }
  function gabung(chunks) {
    const result = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
    return result;
  }
  function resample(pcm, rate) {
    if (rate === 16000) return new Float32Array(pcm);
    const count = Math.floor(pcm.length * 16000 / rate), result = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const pos = i * rate / 16000, low = Math.floor(pos), frac = pos - low;
      result[i] = pcm[low] * (1 - frac) + (pcm[Math.min(low + 1, pcm.length - 1)] || 0) * frac;
    }
    return result;
  }
  function pcmValid(pcm, minimum = 1) {
    if (!(pcm instanceof Float32Array) || pcm.length < 16000 * minimum || pcm.length > 16000 * 20) throw new Error('Bicara lebih jelas selama sedikitnya ' + minimum + ' detik.');
    let energy = 0;
    for (const value of pcm) { if (!Number.isFinite(value) || Math.abs(value) > 1.01) throw new Error('Rekaman tidak valid.'); energy += value * value; }
    if (Math.sqrt(energy / pcm.length) < 0.004) throw new Error('Suara terlalu pelan. Coba lebih dekat ke mikrofon.');
    return pcm;
  }
  function buat({ getScope, onStatus = () => {}, onProgress = () => {}, storage, workerFactory } = {}) {
    if (typeof getScope !== 'function') throw new Error('Lingkup suara belum tersedia.');
    const scope = getScope();
    const key = 'suaraPemilik:v1:' + scope;
    let generation = 0, worker = null, capture = null, nextId = 0, ready = false, transcriberReady = false, live = false, opening = false;
    const pending = new Map();
    try { storage ||= global.localStorage; } catch { storage = null; }
    function valid(gen = generation) {
      if (!scope || scope !== getScope() || gen !== generation) throw new Error('Lingkup suara berubah. Mulai kembali pada akun dan tenant yang benar.');
    }
    function profile() {
      let value;
      try { value = JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
      if (!value || value.model !== MODEL || value.revision !== REVISION || !Array.isArray(value.embeddings) || value.embeddings.length !== 3) return null;
      if (!value.embeddings.every(v => Array.isArray(v) && v.length === DIM && v.every(Number.isFinite))) return null;
      return value;
    }
    function wajib() {
      try { return storage?.getItem(key + ':wajib') === 'true'; } catch { return true; }
    }
    function setWajib(value) {
      valid();
      if (value && !profile()) throw new Error('Daftarkan tiga contoh suara pemilik dahulu.');
      if (!storage) throw new Error('Penyimpanan profil perangkat tidak tersedia.');
      storage.setItem(key + ':wajib', String(Boolean(value)));
    }
    function release(audio) {
      if (!audio) return;
      global.clearTimeout(audio.timer);
      audio.stream?.getTracks().forEach(track => track.stop());
      try { audio.node?.disconnect(); audio.source?.disconnect(); audio.mute?.disconnect(); } catch {}
      if (audio.context?.state !== 'closed') void audio.context?.close().catch(() => {});
    }
    function hentikan() {
      generation++; live = false;
      const old = capture; capture = null; old?.reject?.(new Error('Perekaman dihentikan.')); release(old);
      for (const item of pending.values()) { global.clearTimeout(item.timer); item.reject(new Error('Suara dihentikan.')); }
      pending.clear(); worker?.terminate(); worker = null; ready = false; transcriberReady = false;
    }
    function message(jenis, pcm) {
      valid();
      if (!worker) {
        worker = workerFactory ? workerFactory() : new global.Worker('/kerangka-suara-model-worker.js?v=20261014-una-v2', { type: 'module' });
        worker.onmessage = event => {
          const item = pending.get(event.data?.id); if (!item) return;
          if (event.data.progress) { onProgress(event.data.progress); return; }
          pending.delete(event.data.id); global.clearTimeout(item.timer);
          if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.result);
        };
        worker.onerror = () => { hentikan(); onStatus('Mesin suara belum berhasil dimuat. Coba unduh kembali.'); };
      }
      if (pending.size >= 4) return Promise.reject(new Error('Perangkat masih memproses suara sebelumnya. Coba beberapa saat lagi.'));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => { pending.delete(id); reject(new Error('Mesin suara terlalu lama merespons. Hentikan lalu coba kembali.')); }, jenis.startsWith('muat') ? 180000 : 60000);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, jenis, ...(pcm ? { pcm } : {}) });
      });
    }
    async function muatModel() { const gen = generation; await message('muat-pemilik'); valid(gen); ready = true; }
    async function muatTranskrip() { const gen = generation; await message('muat-transkrip'); valid(gen); transcriberReady = true; }
    async function embedding(pcm) {
      pcmValid(pcm);
      if (!ready) throw new Error('Unduh mesin pengenal suara dahulu.');
      const gen = generation, value = await message('embedding', pcm); valid(gen);
      if (!Array.isArray(value) || value.length !== DIM || !value.every(Number.isFinite)) throw new Error('Model belum berhasil membaca suara.');
      return value;
    }
    async function daftarkan(samples) {
      valid();
      if (!Array.isArray(samples) || samples.length !== 3) throw new Error('Rekam tiga contoh suara pemilik.');
      const gen = generation, embeddings = [];
      for (const sample of samples) embeddings.push(await embedding(pcmValid(sample, 3)));
      valid(gen);
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (cosine(embeddings[i], embeddings[j]) < THRESHOLD) throw new Error('Contoh suara belum konsisten. Rekam ulang di tempat tenang dengan pembicara yang sama.');
      if (!storage) throw new Error('Profil tidak dapat disimpan pada perangkat ini.');
      storage.setItem(key, JSON.stringify({ version: 1, model: MODEL, revision: REVISION, embeddings, createdAt: new Date().toISOString() }));
      return true;
    }
    async function verifikasi(pcm) {
      const saved = profile(); if (!saved) throw new Error('Profil pemilik belum terdaftar atau perlu direkam ulang.');
      const vector = await embedding(pcm);
      const scores = saved.embeddings.map(v => cosine(v, vector));
      const skor = scores.reduce((a, b) => a + b, 0) / scores.length;
      return { cocok: skor >= THRESHOLD && scores.filter(s => s >= THRESHOLD).length >= 2, skor };
    }
    async function startCapture({ headset = false, untukLive = false } = {}, onFrame) {
      valid();
      if (capture || opening) throw new Error('Mikrofon sedang digunakan atau menunggu izin.');
      if (!global.isSecureContext || !global.navigator?.mediaDevices?.getUserMedia) throw new Error('Mikrofon memerlukan browser yang mendukung dan halaman HTTPS.');
      const gen = generation; let stream; opening = true;
      try { stream = await global.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: { ideal: 'all' }, noiseSuppression: true, autoGainControl: true } }); } finally { opening = false; }
      const audio = { stream, context: null, node: null, timer: null }; capture = audio;
      try {
        valid(gen);
        const settings = stream.getAudioTracks()[0]?.getSettings() || {};
        if (untukLive && !headset && settings.echoCancellation !== 'all') throw new Error('Peredam gema penuh belum didukung browser ini. Gunakan headset dan centang pilihan headset untuk mode live.');
        if (untukLive && !headset && !settings.echoCancellation) throw new Error('Peredam gema mikrofon belum aktif.');
        const Context = global.AudioContext || global.webkitAudioContext;
        audio.context = new Context({ sampleRate: 16000 });
        await audio.context.audioWorklet.addModule('/kerangka-suara-audio.js?v=20261014-una-v2'); valid(gen);
        audio.node = new global.AudioWorkletNode(audio.context, 'kerangka-suara-pcm');
        audio.source = audio.context.createMediaStreamSource(stream);
        audio.mute = audio.context.createGain(); audio.mute.gain.value = 0;
        audio.source.connect(audio.node); audio.node.connect(audio.mute); audio.mute.connect(audio.context.destination);
        audio.node.port.onmessage = event => {
          if (capture !== audio || gen !== generation || scope !== getScope()) { release(audio); return; }
          onFrame(resample(event.data, audio.context.sampleRate));
        };
        stream.getAudioTracks()[0].addEventListener('ended', () => { if (capture === audio) { hentikan(); onStatus('Mikrofon terputus.'); } });
        await audio.context.resume(); valid(gen); return audio;
      } catch (error) { if (capture === audio) capture = null; release(audio); throw error; }
    }
    async function rekamManual() {
      if (!ready) throw new Error('Mesin pemilik belum dimuat.');
      const gen = generation, chunks = [];
      let size = 0;
      const audio = await startCapture({}, pcm => { const remaining = 16000*20-size; if (remaining>0) { const chunk=pcm.subarray(0,remaining);chunks.push(chunk);size+=chunk.length; } });
      return {
        stop() { if (capture !== audio) throw new Error('Perekaman sudah dihentikan.'); capture = null; release(audio); valid(gen); return pcmValid(gabung(chunks)); },
        abort() { if (capture === audio) capture = null; release(audio); }
      };
    }
    async function rekam({ durasi = 4 } = {}) {
      if (!ready) throw new Error('Unduh mesin pengenal suara sebelum merekam.');
      const gen = generation, chunks = [];
      const audio = await startCapture({}, pcm => chunks.push(pcm));
      return new Promise((resolve, reject) => {
        audio.reject = reject;
        audio.timer = global.setTimeout(() => {
          if (capture !== audio) return;
          capture = null; release(audio);
          try { valid(gen); resolve(pcmValid(gabung(chunks), 3)); } catch (error) { reject(error); }
        }, Math.min(10, Math.max(4, durasi)) * 1000);
      });
    }
    async function mulaiLive({ headset = false, onPotong = () => {}, onTunda = () => {}, onLanjut = () => {}, onPerintah = async () => {} } = {}) {
      const hanyaPemilik = wajib();
      if (hanyaPemilik && !profile()) throw new Error('Daftarkan suara pemilik dahulu.');
      if (!transcriberReady || (hanyaPemilik && !ready)) throw new Error('Unduh mesin transkrip dan, bila diaktifkan, pengenal pemilik sebelum memulai live.');
      const gen = generation; let segment = null, pre = [], noise = 0.004;
      function checked(s) {
        if (!s.check && !hanyaPemilik) { onPotong(); s.check = Promise.resolve(true); }
        if (!s.check) s.check = verifikasi(gabung(s.chunks)).then(result => { valid(gen); if (result.cocok && live) onPotong(); else if (live) onLanjut(); return result.cocok; });
        return s.check;
      }
      async function finish(s) {
        try {
          const pcm = pcmValid(gabung(s.chunks));
          let cocok = await checked(s);
          if (hanyaPemilik && !cocok && pcm.length > 24000) { cocok = (await verifikasi(pcm)).cocok; if (cocok && live) onPotong(); }
          if (!cocok) { if (live) onStatus('Suara belum cocok dengan pemilik terdaftar.'); return; }
          valid(gen); if (!live) return;
          const text = String(await message('transkrip', pcm)).trim().slice(0, 4000);
          valid(gen); if (live && text) await onPerintah(text);
        } catch (error) { if (gen === generation && live) { onLanjut(); onStatus(error.message); } }
      }
      live = true;
      try {
        await startCapture({ headset, untukLive: true }, pcm => {
          const rms = Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / pcm.length);
          const voiced = rms >= Math.max(0.012, noise * 3);
          if (!segment && !voiced) noise = noise * 0.95 + Math.min(rms, 0.012) * 0.05;
          if (!segment) {
            pre.push(pcm); if (pre.length > 5) pre.shift();
            if (!voiced) return;
            segment = { chunks: [...pre], size: pre.reduce((n, p) => n + p.length, 0), silence: 0, check: null };
            pre = []; if (hanyaPemilik) onTunda(); else void checked(segment);
          } else { segment.chunks.push(pcm); segment.size += pcm.length; }
          segment.silence = voiced ? 0 : segment.silence + pcm.length;
          if (!segment.check && segment.size >= 24000) { const s = segment; void checked(s).catch(() => {}); }
          if (segment.silence >= 11200 || segment.size >= 192000) { const s = segment; segment = null; void finish(s); }
        });
        onStatus(hanyaPemilik ? 'Live aktif. Hanya suara pemilik yang diterima. Menyela menghentikan ucapan; persetujuan transaksi tetap manual.' : 'Live aktif. Pengenalan pemilik dimatikan; suara di sekitar mikrofon dapat menjadi perintah. Persetujuan transaksi tetap manual.');
      } catch (error) { live = false; throw error; }
    }
    async function hapus() { hentikan(); if (!storage) throw new Error('Penyimpanan perangkat tidak tersedia.'); storage.removeItem(key); storage.removeItem(key + ':wajib'); }
    return { muatModel, muatTranskrip, rekamManual, rekam, daftarkan, verifikasi, mulaiLive, hentikan, hapus, wajib, setWajib, hasProfile: () => Boolean(profile()), status: () => ({ ready, transcriberReady, live, hasProfile: Boolean(profile()), wajib: wajib() }) };
  }
  global.KerangkaSuaraPemilik = Object.freeze({ buat, cosine, resample, pcmValid, model: MODEL, revision: REVISION });
})(typeof window === 'undefined' ? globalThis : window);

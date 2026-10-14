// Model unduhan lokal. Baru dimuat setelah tindakan pengguna; PCM tidak diunggah.
// Microsoft WavLM-Base-Plus-SV / Xenova ONNX: CC BY-SA 3.0
// https://huggingface.co/microsoft/wavlm-base-plus-sv
// https://github.com/microsoft/UniSpeech/blob/main/LICENSE
// Whisper Tiny / Xenova ONNX: Apache-2.0. Transformers.js: Apache-2.0.
let library, speaker, processor, whisper;
let antrean = Promise.resolve();
async function jalankan({ id, jenis, pcm }) {
  try {
    if (!library) {
      library = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
      library.env.allowLocalModels = false;
      library.env.backends.onnx.wasm.numThreads = 1;
    }
    const progress_callback = progress => self.postMessage({ id, progress: { status: progress.status, file: progress.file, progress: progress.progress, loaded: progress.loaded, total: progress.total } });
    if (jenis === 'muat-pemilik' && !speaker) {
      const options = { revision: '839012c1abfd543d1f5178201a444706e85d3b07', device: 'wasm', dtype: 'q8', progress_callback };
      processor = await library.AutoProcessor.from_pretrained('Xenova/wavlm-base-plus-sv', options);
      speaker = await library.AutoModelForXVector.from_pretrained('Xenova/wavlm-base-plus-sv', options);
    }
    if (jenis === 'muat-transkrip' && !whisper) whisper = await library.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      revision: '886cdcc0ac3be42c545d24403ccb116ff9387d97', device: 'wasm', dtype: 'q8', progress_callback
    });
    let result = true;
    if (jenis === 'embedding') {
      if (!speaker || !processor) throw new Error('Model pemilik belum dimuat.');
      const inputs = await processor(pcm);
      const output = await speaker(inputs);
      result = Array.from(output.embeddings.data);
    } else if (jenis === 'transkrip') {
      if (!whisper) throw new Error('Model transkrip belum dimuat.');
      result = (await whisper(pcm, { language: 'indonesian', task: 'transcribe', return_timestamps: false, max_new_tokens: 128 })).text;
    }
    self.postMessage({ id, result });
  } catch { self.postMessage({ id, error: 'Model suara lokal gagal. Periksa unduhan atau kemampuan perangkat, lalu coba lagi.' }); }
}
self.onmessage = event => { antrean = antrean.then(() => jalankan(event.data)); };


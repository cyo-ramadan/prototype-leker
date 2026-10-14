// PCM mono: dikirim ke halaman, keluaran audio selalu nol (tanpa loopback).
class KerangkaSuaraPCM extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.posisi = 0; }
  process(inputs, outputs) {
    for (const channel of outputs[0] || []) channel.fill(0);
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.buffer[this.posisi++] = sample;
      if (this.posisi === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(2048); this.posisi = 0;
      }
    }
    return true;
  }
}
registerProcessor('kerangka-suara-pcm', KerangkaSuaraPCM);

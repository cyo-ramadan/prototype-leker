(() => {
  let stream = null;
  let callbacks = null;

  function ensureUi() {
    if (document.getElementById('cameraSnapshotModal')) return;
    const style = document.createElement('style');
    style.id = 'cameraSnapshotModalStyle';
    style.textContent = `
      .camera-snapshot-modal{border:0;border-radius:22px;padding:0;max-width:min(92vw,560px);width:100%;box-shadow:0 28px 80px rgba(0,0,0,.25)}
      .camera-snapshot-modal::backdrop{background:rgba(22,18,14,.62);backdrop-filter:blur(3px)}
      .camera-snapshot-shell{padding:18px;background:#fffaf5}
      .camera-snapshot-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
      .camera-snapshot-head h2{margin:2px 0 0}.camera-snapshot-video-wrap{background:#17120f;border-radius:18px;overflow:hidden;aspect-ratio:4/3;display:grid;place-items:center}
      .camera-snapshot-video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
      .camera-snapshot-video.environment{transform:none}
      .camera-snapshot-message{padding:14px;border:1px solid #eadfd4;border-radius:14px;background:#fff;margin-top:12px;line-height:1.5}
      .camera-snapshot-message.error{border-color:#d89f96;background:#fff5f3}
      .camera-snapshot-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'cameraSnapshotModal';
    dialog.className = 'camera-snapshot-modal';
    dialog.innerHTML = `
      <div class="camera-snapshot-shell">
        <div class="camera-snapshot-head"><div><div class="muted">Live Photo</div><h2 id="cameraSnapshotTitle">Ambil Foto</h2></div><button id="cameraSnapshotClose" class="cart-close-btn" type="button">×</button></div>
        <div class="camera-snapshot-video-wrap"><video id="cameraSnapshotVideo" class="camera-snapshot-video" autoplay playsinline muted></video></div>
        <div id="cameraSnapshotMessage" class="camera-snapshot-message hidden" aria-live="polite"></div>
        <div class="camera-snapshot-actions"><button id="cameraSnapshotCancel" class="secondary-btn" type="button">Batal</button><button id="cameraSnapshotCapture" class="primary-btn" type="button">📸 Ambil Foto</button></div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('close', stopStream);
    document.getElementById('cameraSnapshotClose').addEventListener('click', close);
    document.getElementById('cameraSnapshotCancel').addEventListener('click', close);
    document.getElementById('cameraSnapshotCapture').addEventListener('click', capture);
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    const video = document.getElementById('cameraSnapshotVideo');
    if (video) video.srcObject = null;
  }

  function close() {
    const dialog = document.getElementById('cameraSnapshotModal');
    stopStream();
    callbacks = null;
    if (dialog?.open) dialog.close();
  }

  async function open({ facingMode = 'user', title = 'Ambil Foto', onCaptureSuccess, onPermissionDenied } = {}) {
    ensureUi();
    stopStream();
    callbacks = { onCaptureSuccess, onPermissionDenied };
    const dialog = document.getElementById('cameraSnapshotModal');
    const video = document.getElementById('cameraSnapshotVideo');
    const message = document.getElementById('cameraSnapshotMessage');
    const captureButton = document.getElementById('cameraSnapshotCapture');
    document.getElementById('cameraSnapshotTitle').textContent = title;
    video.classList.toggle('environment', facingMode === 'environment');
    message.className = 'camera-snapshot-message hidden';
    message.textContent = '';
    captureButton.disabled = true;
    if (!dialog.open) dialog.showModal();

    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Browser ini tidak mendukung akses kamera.');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 640, max: 960 },
          height: { ideal: 480, max: 720 }
        }
      });
      video.srcObject = stream;
      await video.play();
      captureButton.disabled = false;
    } catch (error) {
      stopStream();
      message.className = 'camera-snapshot-message error';
      message.textContent = 'Kamera tidak bisa dibuka. Izinkan akses kamera di browser, lalu coba lagi. Presensi/foto tidak akan dikirim tanpa izin kamera.';
      callbacks?.onPermissionDenied?.(error);
    }
  }

  function capture() {
    const video = document.getElementById('cameraSnapshotVideo');
    if (!video || !stream || !video.videoWidth || !video.videoHeight) return;
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    canvas.toBlob(blob => {
      if (!blob) return;
      const success = callbacks?.onCaptureSuccess;
      stopStream();
      callbacks = null;
      const dialog = document.getElementById('cameraSnapshotModal');
      if (dialog?.open) dialog.close();
      success?.(blob);
    }, 'image/jpeg', 0.72);
  }

  function captureBlob(options = {}) {
    return new Promise((resolve, reject) => {
      open({ ...options, onCaptureSuccess: resolve, onPermissionDenied: reject });
    });
  }

  window.CameraSnapshotModal = { open, close, captureBlob, stopStream };
})();

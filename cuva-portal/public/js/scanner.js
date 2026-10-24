/* =====================================================================
 * CUVA Portal — Camera QR scanner (scanner.js)
 * ---------------------------------------------------------------------
 * Opens the phone's back camera full-screen and reads QR passes.
 *   - Uses the phone's built-in detector (BarcodeDetector) when available,
 *     otherwise the bundled jsQR decoder (loaded only when first opened).
 *   - Each code is reported once; the same pass is ignored for 4 seconds.
 *   - Beep + vibration on every result; torch button where supported.
 * Works only over HTTPS (Netlify) or on localhost.
 *
 *   Scanner.open({ onToken: async token => result, subtitle })
 *   onToken must return { tone: 'ok'|'warn'|'error', title, detail, autoResume }
 * ===================================================================== */
const Scanner = (() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const SAME_CODE_IGNORE_MS = 4000;
  const AUTO_RESUME_MS = 1800;
  const SCAN_INTERVAL_MS = 120;
  const MAX_DECODE_SIDE = 640;

  let stream = null;
  let detector = null;          // native BarcodeDetector or null
  let decodeJs = null;          // jsQR function or null
  let canvas = null;
  let ctx2d = null;
  let timer = null;
  let running = false;
  let paused = false;
  let onToken = null;
  let lastCode = '';
  let lastCodeAt = 0;
  let resumeTimer = null;
  let audio = null;
  let torchOn = false;
  let count = { ok: 0, warn: 0, error: 0 };

  // ---------- Support checks ----------
  function cameraSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  }

  function inWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent);
  }

  // ---------- Decoders ----------
  async function initDecoder() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          return;
        }
      } catch { /* fall back to jsQR */ }
    }
    detector = null;
    await loadJsQR();
  }

  function loadJsQR() {
    if (decodeJs) return Promise.resolve();
    if (typeof window.jsQR !== 'undefined') {
      decodeJs = typeof window.jsQR === 'function' ? window.jsQR : window.jsQR.default;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/jsQR.min.js?v=3.1.0';
      s.onload = () => {
        decodeJs = typeof window.jsQR === 'function' ? window.jsQR : window.jsQR && window.jsQR.default;
        decodeJs ? resolve() : reject(new Error('QR decoder failed to load'));
      };
      s.onerror = () => reject(new Error('QR decoder failed to load'));
      document.head.appendChild(s);
    });
  }

  async function decodeFrame(video) {
    if (detector) {
      try {
        const codes = await detector.detect(video);
        return codes.length ? codes[0].rawValue : null;
      } catch {
        detector = null;               // native detector failed: switch to jsQR for good
        await loadJsQR();
      }
    }

    // jsQR: decode the centre square (where the viewfinder is), downscaled for speed
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const side = Math.floor(Math.min(vw, vh) * 0.85);
    const sx = Math.floor((vw - side) / 2);
    const sy = Math.floor((vh - side) / 2);
    const out = Math.min(side, MAX_DECODE_SIDE);

    if (!canvas) {
      canvas = document.createElement('canvas');
      ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    }
    canvas.width = out;
    canvas.height = out;
    ctx2d.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    const img = ctx2d.getImageData(0, 0, out, out);
    const code = decodeJs(img.data, out, out, { inversionAttempts: 'dontInvert' });
    return code ? code.data : null;
  }

  // ---------- Feedback: beep + vibration ----------
  function initAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch { audio = null; }
  }

  function beep(tone) {
    if (navigator.vibrate) navigator.vibrate(tone === 'ok' ? 80 : [120, 80, 120]);
    if (!audio) return;
    const notes = tone === 'ok' ? [[880, 0, 0.12]] : tone === 'warn' ? [[520, 0, 0.12], [520, 0.18, 0.12]] : [[240, 0, 0.35]];
    notes.forEach(([freq, start, dur]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + start);
      osc.stop(audio.currentTime + start + dur + 0.05);
    });
  }

  // ---------- Camera ----------
  async function startCamera() {
    const video = byId('scanner-video');
    setStatus('Starting camera…');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = stream;
    await video.play();
    setStatus('');
    setupTorch();
  }

  function stopCamera() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    const video = byId('scanner-video');
    if (video) video.srcObject = null;
    torchOn = false;
  }

  function setupTorch() {
    const btn = byId('scanner-torch');
    const track = stream && stream.getVideoTracks()[0];
    let supported = false;
    try { supported = !!(track && track.getCapabilities && track.getCapabilities().torch); } catch { /* no torch */ }
    btn.classList.toggle('hidden', !supported);
    btn.setAttribute('aria-pressed', 'false');
  }

  async function toggleTorch() {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      byId('scanner-torch').setAttribute('aria-pressed', String(torchOn));
      byId('scanner-torch').classList.toggle('bg-amber-400', torchOn);
      byId('scanner-torch').classList.toggle('text-slate-900', torchOn);
    } catch {
      torchOn = false;
    }
  }

  // ---------- Scan loop ----------
  function schedule() {
    clearTimeout(timer);
    if (running) timer = setTimeout(tick, SCAN_INTERVAL_MS);
  }

  async function tick() {
    if (!running) return;
    const video = byId('scanner-video');
    if (!paused && video.readyState >= 2) {
      let code = null;
      try { code = await decodeFrame(video); } catch { /* skip frame */ }
      if (code && running && !paused) await handleCode(code);
    }
    schedule();
  }

  async function handleCode(raw) {
    const code = String(raw).trim().toUpperCase();
    const now = Date.now();
    if (code === lastCode && now - lastCodeAt < SAME_CODE_IGNORE_MS) return;
    lastCode = code;
    lastCodeAt = now;

    paused = true;
    showResult({ tone: 'busy', title: 'Checking pass…', detail: code });

    let result;
    try {
      result = await onToken(code);
    } catch (err) {
      result = { tone: 'error', title: 'Could not check pass', detail: (err && err.message) || 'Network error. Try again.', autoResume: false };
    }
    if (!running) return;

    count[result.tone] = (count[result.tone] || 0) + 1;
    updateCounter();
    beep(result.tone);
    showResult(result);

    clearTimeout(resumeTimer);
    if (result.autoResume) resumeTimer = setTimeout(resume, AUTO_RESUME_MS);
  }

  // ---------- UI ----------
  function setStatus(text) {
    const el = byId('scanner-status');
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  }

  const TONES = {
    ok:    { box: 'bg-emerald-600', icon: 'circle-check-big' },
    warn:  { box: 'bg-amber-500',   icon: 'triangle-alert' },
    error: { box: 'bg-rose-600',    icon: 'octagon-alert' },
    busy:  { box: 'bg-slate-800',   icon: null }
  };

  function showResult({ tone, title, detail, autoResume }) {
    const panel = byId('scanner-result');
    const t = TONES[tone] || TONES.busy;
    panel.className = `scanner-result ${t.box} text-white rounded-3xl p-5 space-y-3 shadow-2xl`;
    panel.innerHTML = `
      <div class="flex items-start gap-3">
        ${t.icon
          ? `<i data-lucide="${t.icon}" class="w-9 h-9 flex-shrink-0"></i>`
          : '<span class="inline-block w-8 h-8 border-[3px] border-white border-r-transparent rounded-full animate-spin flex-shrink-0"></span>'}
        <div class="min-w-0">
          <p class="text-lg font-black leading-tight"></p>
          <p class="text-sm text-white/90 mt-1 break-words"></p>
        </div>
      </div>
      ${tone === 'busy' ? '' : `
        <button type="button" onclick="Scanner.resume()" class="w-full py-3.5 rounded-2xl bg-white/20 hover:bg-white/30 active:bg-white/40 font-black text-base">
          ${autoResume ? 'Scanning next…' : 'Scan next'}
        </button>`}`;
    panel.querySelector('p').textContent = title;
    panel.querySelectorAll('p')[1].textContent = detail || '';
    if (typeof UI !== 'undefined') UI.icons();
  }

  function hideResult() {
    const panel = byId('scanner-result');
    panel.className = 'scanner-result hidden';
    panel.innerHTML = '';
  }

  function updateCounter() {
    byId('scanner-counter').textContent = `✔ ${count.ok} admitted  •  ⚠ ${count.warn}  •  ✖ ${count.error}`;
  }

  function showCameraError(err) {
    const name = err && err.name;
    let msg;
    if (!window.isSecureContext) {
      msg = 'The camera only works on the secure (https://) site link.';
    } else if (name === 'NotAllowedError' || name === 'SecurityError') {
      msg = 'Camera permission was blocked. Allow camera access for this site in your browser settings, then tap Scan again.';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      msg = 'No camera was found on this device.';
    } else if (name === 'NotReadableError') {
      msg = 'The camera is being used by another app. Close it and try again.';
    } else {
      msg = 'Could not start the camera on this browser.';
    }
    if (inWeChat()) msg += ' In WeChat, tap ••• (top right) → Open in Browser, then scan from Safari or Chrome.';
    stopCamera();
    running = false;
    showResult({ tone: 'error', title: 'Camera unavailable', detail: msg + ' You can still type the token on the desk.', autoResume: false });
    const btn = byId('scanner-result').querySelector('button');
    if (btn) {
      btn.textContent = 'Close scanner';
      btn.onclick = close;
    }
  }

  // ---------- Public API ----------
  async function open(options) {
    onToken = options.onToken;
    byId('scanner-subtitle').textContent = options.subtitle || 'Point the camera at the student’s QR pass';
    count = { ok: 0, warn: 0, error: 0 };
    updateCounter();
    hideResult();
    lastCode = '';
    paused = false;
    initAudio();                       // must start from the button tap (browser rule)

    byId('modal-scanner').classList.remove('hidden');
    document.body.classList.add('modal-open');
    if (typeof UI !== 'undefined') UI.icons();

    if (!cameraSupported()) {
      showCameraError({ name: 'Unsupported' });
      return;
    }

    try {
      await Promise.all([startCamera(), initDecoder()]);
      running = true;
      schedule();
    } catch (err) {
      showCameraError(err);
    }
  }

  function resume() {
    clearTimeout(resumeTimer);
    if (!stream) return;
    hideResult();
    paused = false;
  }

  function close() {
    running = false;
    paused = false;
    clearTimeout(timer);
    clearTimeout(resumeTimer);
    stopCamera();
    hideResult();
    byId('modal-scanner').classList.add('hidden');
    if (!document.querySelector('.modal:not(.hidden)')) document.body.classList.remove('modal-open');
    if (typeof onCloseCallback === 'function') onCloseCallback();
  }

  let onCloseCallback = null;
  /** Register a function to run after the scanner closes (e.g. refresh the roster). */
  function onClose(fn) { onCloseCallback = fn; }

  // Free the camera when the app goes to the background; restart when back
  document.addEventListener('visibilitychange', async () => {
    const isOpen = byId('modal-scanner') && !byId('modal-scanner').classList.contains('hidden');
    if (!isOpen || !running) return;
    if (document.hidden) {
      stopCamera();
    } else {
      try { await startCamera(); } catch (err) { showCameraError(err); }
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && byId('modal-scanner') && !byId('modal-scanner').classList.contains('hidden')) close();
  });

  return { open, close, resume, toggleTorch, onClose, cameraSupported };
})();

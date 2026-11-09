// Small UI helpers shared by both tools.
import { openVideo, frameAt, supported } from '../lib/video.js';
import { Input, BlobSource, CanvasSink, ALL_FORMATS } from 'mediabunny';

export const $ = (s, r = document) => r.querySelector(s);
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
export const fmtTime = s => !isFinite(s) ? '–' : s < 60 ? Math.round(s) + ' s' : Math.floor(s / 60) + ' min ' + String(Math.round(s % 60)).padStart(2, '0') + ' s';
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export function unsupportedNote() {
  if (supported()) return '';
  return `<div class="note warn">This browser can't process video on-device (needs WebCodecs). Use a recent Chrome, Edge or the Android app.</div>`;
}

// File picker + drop zone. Calls onVideo(v) with an opened video.
export function dropzone(root, onVideo, onError) {
  const z = h(`<div class="drop" tabindex="0" role="button" aria-label="Choose a video">
      <div class="circle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></div>
      <strong>Choose a video</strong> or drop it here<div class="hint" style="margin-top:6px">MP4, MOV or WebM · stays on your device</div>
      <input type="file" accept="video/*" hidden></div>`);
  const input = $('input', z);
  const open = async f => {
    if (!f) return;
    try { onVideo(await openVideo(f)); } catch (e) { onError(e); }
  };
  z.onclick = () => input.click();
  z.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && input.click();
  input.onchange = () => open(input.files[0]);
  z.ondragover = e => { e.preventDefault(); z.classList.add('over'); };
  z.ondragleave = () => z.classList.remove('over');
  z.ondrop = e => { e.preventDefault(); z.classList.remove('over'); open(e.dataTransfer.files[0]); };
  root.appendChild(z);
  return z;
}

export function metaLine(info) {
  return `${esc(info.name)} · ${info.width}×${info.height} · ${info.fps.toFixed(2)} fps · ${info.duration.toFixed(1)} s · ${fmtBytes(info.size)}${info.audio ? ' · audio ' + info.audio : ' · no audio'}`;
}

// Progress bar + status with ETA.
export function progress(root) {
  const bar = $('.bar > div', root), st = $('.status', root);
  let t0 = 0;
  return {
    start(text) { t0 = performance.now(); bar.style.width = '0'; st.textContent = text; },
    set(p, text) {
      bar.style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
      const el = (performance.now() - t0) / 1000, eta = p > 0.02 ? el / p - el : NaN;
      st.textContent = `${text} · ${Math.round(p * 100)}%` + (isFinite(eta) ? ` · about ${fmtTime(eta)} left` : '');
    },
    done(text) { bar.style.width = '100%'; st.textContent = text; },
    error(e) { st.innerHTML = `<span class="err">${esc(e.message || e)}</span>`; },
  };
}

// Draw a canvas source into a display canvas.
export function show(canvas, src) {
  canvas.width = src.width; canvas.height = src.height;
  canvas.getContext('2d').drawImage(src, 0, 0);
}

// Before/after slider for one moment of the video.
export async function compare(root, srcVideo, outBlob, t) {
  const before = await frameAt(srcVideo, t);
  const input = new Input({ source: new BlobSource(outBlob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  const sink = new CanvasSink(track, { poolSize: 1 });
  const first = await track.getFirstTimestamp();
  const after = (await sink.getCanvas(Math.max(first, t)))?.canvas;
  root.innerHTML = '';
  const box = h(`<div class="cmp"><canvas></canvas><div class="after"><canvas></canvas></div><div class="div"></div><span class="tag" style="left:10px">before</span><span class="tag" style="right:10px">after</span></div>`);
  root.appendChild(box);
  const [cb, ca] = box.querySelectorAll('canvas');
  // show both at the output size so the comparison is like-for-like
  cb.width = ca.width = after.width; cb.height = ca.height = after.height;
  cb.getContext('2d').drawImage(before, 0, 0, after.width, after.height);
  ca.getContext('2d').drawImage(after, 0, 0);
  const aw = $('.after', box), dv = $('.div', box);
  let split = 0.5;
  const set = () => { aw.style.clipPath = `inset(0 0 0 ${split * 100}%)`; dv.style.left = split * 100 + '%'; };
  const move = e => { const r = box.getBoundingClientRect(); split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); set(); };
  box.addEventListener('pointerdown', e => { box.setPointerCapture(e.pointerId); move(e); });
  box.addEventListener('pointermove', e => { if (box.hasPointerCapture(e.pointerId)) move(e); });
  set();
}

// Save the result: a download on the web; on Android, write to the app cache and open the share sheet
// (Save to Files / Photos / Drive / YouTube…).
export async function saveBlob(blob, name) {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const path = 'Pixelwash/' + name;
    const CH = 3 * 1024 * 1024;                    // base64 in 3 MB slices keeps memory low
    for (let off = 0; off < blob.size; off += CH) {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob.slice(off, off + CH)); });
      if (off === 0) await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache, recursive: true });
      else await Filesystem.appendFile({ path, data: b64, directory: Directory.Cache });
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: name, files: [uri], dialogTitle: 'Save or share your video' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function outName(info, tag, ext) {
  const stem = info.name.replace(/\.[^.]+$/, '');
  return `${stem}_${tag}.${ext}`;
}

// Keep the screen awake during long jobs where supported.
export async function keepAwake() {
  try { if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  return null;
}

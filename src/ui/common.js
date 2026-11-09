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

// Android: write the result into the app cache once (base64 in 3 MB slices keeps memory low) and reuse it
// for both "Save to gallery" and "Share". Only the latest result is kept in the cache.
let cached = null;                                 // { blob, name, uri }
async function toCache(blob, name) {
  if (cached && cached.blob === blob && cached.name === name) return cached.uri;
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  await Filesystem.rmdir({ path: 'Pixelwash', directory: Directory.Cache, recursive: true }).catch(() => {});
  const path = 'Pixelwash/' + name;
  const CH = 3 * 1024 * 1024;
  for (let off = 0; off < blob.size; off += CH) {
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob.slice(off, off + CH)); });
    if (off === 0) await Filesystem.writeFile({ path, data: b64, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data: b64, directory: Directory.Cache });
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  cached = { blob, name, uri };
  return uri;
}

// Save the result: a download on the web; on Android, straight into the phone's gallery (Movies/Pixelwash).
// Returns a short message saying where it went.
export async function saveBlob(blob, name) {
  if (isNative()) {
    const uri = await toCache(blob, name);
    const { registerPlugin } = await import('@capacitor/core');
    const GallerySaver = registerPlugin('GallerySaver');
    const r = await GallerySaver.saveVideo({ path: decodeURIComponent(new URL(uri).pathname), name, mime: blob.type || 'video/mp4' });
    return `Saved to your gallery, in ${r.folder || 'Movies/Pixelwash'}.`;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'Downloaded ' + name + '.';
}

// Android only: hand the result to another app (YouTube, Drive, WhatsApp…).
export async function shareBlob(blob, name) {
  const uri = await toCache(blob, name);
  const { Share } = await import('@capacitor/share');
  await Share.share({ title: name, files: [uri], dialogTitle: 'Share your video' });
}

// Wires the Save / Share buttons of a result card. getFile() → { blob, name } or null.
// Returns reset(), to call when a new result replaces the old one.
export function saveButtons(card, getFile) {
  const save = $('#save', card), share = $('#share', card), msg = $('#saved', card);
  const label = isNative() ? 'Save to gallery' : 'Save video';
  save.textContent = label;
  share.classList.toggle('hidden', !isNative());
  const busy = (on, text) => { save.disabled = share.disabled = on; if (text != null) save.textContent = text; };
  let savedBlob = null;                            // on Android, one gallery copy per result (no "name (1).mp4" duplicates)
  save.onclick = async () => {
    const f = getFile(); if (!f || save.disabled) return;
    if (isNative() && f.blob === savedBlob) return;
    busy(true, 'Saving…'); msg.textContent = '';
    try { msg.textContent = await saveBlob(f.blob, f.name); savedBlob = f.blob; busy(false, isNative() ? 'Saved ✓' : label); }
    catch (e) { busy(false, label); msg.innerHTML = `<span class="err">${esc(e.message || e)}</span>`; }
  };
  share.onclick = async () => {
    const f = getFile(); if (!f) return;
    busy(true); msg.textContent = '';
    try { await shareBlob(f.blob, f.name); }
    catch (e) { if (!/cancel/i.test(e.message || '')) msg.innerHTML = `<span class="err">${esc(e.message || e)}</span>`; }
    busy(false);
  };
  return () => { savedBlob = null; busy(false, label); msg.textContent = ''; };
}

export function outName(info, tag, ext) {
  let stem = info.name.replace(/\.[^.]+$/, '');
  // Android's photo picker hands files over as bare numbers (1000236696.mp4): use a readable name instead
  if (/^\d+$/.test(stem)) { const d = new Date(), p = n => String(n).padStart(2, '0'); stem = `Pixelwash_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
  return `${stem}_${tag}.${ext}`;
}

// Keep the screen awake during long jobs where supported.
export async function keepAwake() {
  try { if ('wakeLock' in navigator) return await navigator.wakeLock.request('screen'); } catch { /* not allowed */ }
  return null;
}

// Upscale tool: classical Lanczos + CAS, or AI blend (Real-ESRGAN mixed with classical), all on-device.
import { $, dropzone, metaLine, progress, compare, saveButtons, outName, isNative, keepAwake, unsupportedNote, fmtTime } from './common.js';
import { frameAt, convert } from '../lib/video.js';
import { PRESETS, targetSize, makeUpscaler, aiWorkSize } from '../lib/process.js';
import { AIUpscaler } from '../lib/ai.js';

export function renderUpscale(root) {
  const opts = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('');
  root.innerHTML = `
  <section class="page-head"><div class="wrap">
    <p class="eyebrow">Tool 2 · Upscaler</p>
    <h1>Upscale and sharpen a video</h1>
    <p>Classical maths by default: Lanczos resize plus contrast-adaptive sharpening. Pick AI blend for crisper eyes and outlines on cartoons and animation.</p>
  </div></section>
  <div class="wrap app">
    <div class="stack">
      <div class="card"><div id="drop"></div>${unsupportedNote()}<div id="meta" class="meta"></div></div>
      <div class="card" id="previewCard"><h2>Preview</h2>
        <div class="viewer" id="viewer"><canvas id="cv" width="640" height="360"></canvas></div>
        <div class="row"><span class="hint">Time</span><input id="t" type="range" min="0" max="1" step="0.01" value="0" class="grow" disabled><span id="tl" class="hint">0.0 s</span></div>
        <div class="row"><button id="test" disabled>Preview this frame</button><span class="hint" id="testSt">Runs the current settings on one frame.</span></div>
      </div>
      <div class="card hidden" id="resultCard"><h2>Result</h2>
        <div class="center" id="cmp"></div>
        <div class="row"><span class="hint">Compare at</span><input id="ct" type="range" min="0" max="1" step="0.01" value="0.5" class="grow"><span id="ctl" class="hint"></span></div>
        <div id="report" class="meta"></div>
        <div class="result-actions"><button class="primary" id="save">Save video</button><button id="share" class="hidden">Share…</button></div>
        <div id="saved" class="hint" style="margin-top:8px" aria-live="polite"></div>
      </div>
    </div>
    <aside class="stack">
      <div class="card"><h2>Output</h2>
        <label class="f">Size<select id="preset">${opts}<option value="custom">Custom…</option></select></label>
        <div class="row hidden" id="customRow"><input id="cw" type="number" placeholder="width" min="16" max="7680"><span>×</span><input id="chh" type="number" placeholder="height" min="16" max="7680"></div>
        <p class="hint" id="dims" style="margin-top:8px"></p>
        <label class="f" style="margin-top:16px">Method<div class="seg" id="method"><button data-v="classical" class="on">Classical</button><button data-v="ai">AI blend</button></div></label>
        <div id="classicalOpts">
          <label class="f">Sharpen <b id="sv">0.45</b><input id="sharpen" type="range" min="0" max="1" step="0.05" value="0.45"></label>
          <label class="f">Denoise <b id="dv">0</b><input id="denoise" type="range" min="0" max="2" step="0.1" value="0"></label>
        </div>
        <div id="aiOpts" class="hidden">
          <label class="f">AI share <b id="bv">50%</b><input id="blend" type="range" min="0.2" max="0.8" step="0.05" value="0.5"></label>
          <div class="note">Real-ESRGAN (anime-video model) runs on your GPU, mixed with the classical result so 3D characters keep their shading. It's slow: seconds per frame on a laptop, longer on phones. Try "Preview this frame" first.${isNative() ? '' : ' The first run downloads the AI runtime (~30 MB) once.'}</div>
        </div>
        <button class="primary block" id="go" style="margin-top:16px" disabled>Upscale video</button>
        <div class="bar"><div></div></div><div class="status"></div>
      </div>
    </aside>
  </div>`;

  let v = null, method = 'classical', result = null, ai = null, frame = null;
  const cv = $('#cv'), prog = progress(root);

  dropzone($('#drop'), async vid => {
    v = vid; result = null;
    $('#meta').textContent = metaLine(v.info);
    $('#t').disabled = false; $('#t').max = Math.max(0, v.info.duration - 0.05); $('#t').value = Math.min(1, v.info.duration / 2);
    $('#go').disabled = false; $('#test').disabled = false; $('#resultCard').classList.add('hidden');
    // sensible default: vertical video → Short 1080×1920, else 16:9 4K
    $('#preset').value = v.info.height > v.info.width ? (v.info.height >= 1900 ? 'keep' : 'short_1080') : 'uhd_4k';
    dims(); await loadFrame();
  }, e => prog.error(e));

  function size() {
    const p = $('#preset').value;
    if (p === 'custom') { const w = +$('#cw').value, hh = +$('#chh').value; return w && hh ? targetSize(v.info.width, v.info.height, null, [w, hh]) : null; }
    return targetSize(v.info.width, v.info.height, p);
  }
  function dims() {
    $('#customRow').classList.toggle('hidden', $('#preset').value !== 'custom');
    if (!v) return;
    const s = size(); if (!s) { $('#dims').textContent = 'Enter a width and height.'; return; }
    let t = `${v.info.width}×${v.info.height} → ${s[0]}×${s[1]}`;
    if (method === 'ai') { const [aw, ah] = aiWorkSize(v.info.width, v.info.height, s[0], s[1]); if (aw !== v.info.width) t += ` · AI works at ${aw}×${ah} (soft source: shrink, then AI ×4)`; }
    $('#dims').textContent = t;
  }
  $('#preset').onchange = dims; $('#cw').oninput = dims; $('#chh').oninput = dims;
  $('#sharpen').oninput = () => $('#sv').textContent = $('#sharpen').value;
  $('#denoise').oninput = () => $('#dv').textContent = $('#denoise').value;
  $('#blend').oninput = () => $('#bv').textContent = Math.round($('#blend').value * 100) + '%';
  $('#method').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    method = b.dataset.v; $('#method').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#classicalOpts').classList.toggle('hidden', method !== 'classical'); $('#aiOpts').classList.toggle('hidden', method !== 'ai');
    dims();
  };

  async function loadFrame() {
    const t = +$('#t').value; $('#tl').textContent = t.toFixed(1) + ' s';
    frame = await frameAt(v, t);
    if (frame) { cv.width = frame.width; cv.height = frame.height; cv.getContext('2d').drawImage(frame, 0, 0); }
  }
  let tt; $('#t').oninput = () => { $('#tl').textContent = (+$('#t').value).toFixed(1) + ' s'; clearTimeout(tt); tt = setTimeout(loadFrame, 120); };

  async function getAI() {
    if (!ai) ai = await AIUpscaler.create(s => prog.start(s));
    return ai;
  }
  // settings are read once, when a run starts, so moving a slider mid-run can't change what's reported
  function makeProc(s) {
    const opts = method === 'ai'
      ? { ai, blend: +$('#blend').value }
      : { sharpen: +$('#sharpen').value, denoise: +$('#denoise').value };
    return Object.assign(makeUpscaler(v.info.width, v.info.height, s[0], s[1], opts), { opts });
  }

  $('#test').onclick = async () => {
    const s = size(); if (!s || !frame) return;
    $('#test').disabled = true; $('#testSt').textContent = 'working…';
    try {
      if (method === 'ai') await getAI();
      const t0 = performance.now();
      const up = makeProc(s);
      const out = await up.frame(frame);
      const dt = (performance.now() - t0) / 1000;
      cv.width = out.width; cv.height = out.height; cv.getContext('2d').drawImage(out, 0, 0);
      const est = dt * v.info.duration * v.info.fps;
      $('#testSt').textContent = `${s[0]}×${s[1]} preview · ${dt.toFixed(2)} s for this frame${method === 'ai' ? ` (${ai.backend}) · whole video ≈ ${fmtTime(est)}` : ''}`;
    } catch (e) { console.error(e); $('#testSt').textContent = 'preview failed: ' + e.message; }
    $('#test').disabled = false;
  };

  $('#go').onclick = async () => {
    const s = size(); if (!s) return;
    $('#go').disabled = true; $('#test').disabled = true;
    const lock = await keepAwake();
    try {
      if (method === 'ai') await getAI();
      const up = makeProc(s);
      prog.start(method === 'ai' ? 'AI upscaling + encoding' : 'upscaling + encoding');
      const label = method === 'ai' ? 'AI upscaling + encoding' : 'upscaling + encoding';
      const out = await convert(v, {
        outW: s[0], outH: s[1],
        process: async smp => up.frame(smp.toCanvasImageSource()),
        onProgress: p => prog.set(p, label),
      });
      result = { ...out, name: outName(v.info, method === 'ai' ? 'upscaled_ai' : 'upscaled', out.ext) }; resetSave();
      prog.done(`done · ${(out.blob.size / 1e6).toFixed(1)} MB`);
      $('#resultCard').classList.remove('hidden');
      const m = method === 'ai'
        ? `AI blend: Real-ESRGAN ×4 (${ai.backend}) at ${up.aiWork.join('×')}, ${Math.round(up.opts.blend * 100)}% mixed with classical (smoothing + Lanczos + CAS 0.6)`
        : `classical: Lanczos${up.opts.sharpen > 0 ? ' + CAS ' + up.opts.sharpen : ''}${up.opts.denoise > 0 ? ' + denoise ' + up.opts.denoise : ''}`;
      $('#report').innerHTML = `${s[0]}×${s[1]} · ${out.codec.toUpperCase()} · ${(out.bitrate / 1e6).toFixed(1)} Mbps · ${m}${up.layout.contain ? ' · fitted inside with a blurred fill' : ''}`;
      $('#ct').max = Math.max(0, v.info.duration - 0.05); $('#ct').value = +$('#t').value;
      await showCompare();
      $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); prog.error(e); }
    lock && lock.release && lock.release();
    $('#go').disabled = false; $('#test').disabled = false;
  };
  async function showCompare() { const t = +$('#ct').value; $('#ctl').textContent = t.toFixed(1) + ' s'; await compare($('#cmp'), v, result.blob, t); }
  let ct; $('#ct').oninput = () => { clearTimeout(ct); ct = setTimeout(showCompare, 150); };
  const resetSave = saveButtons($('#resultCard'), () => result && { blob: result.blob, name: result.name });
}

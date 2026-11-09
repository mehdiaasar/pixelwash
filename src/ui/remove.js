// Remove tool: find or draw watermark boxes, measure each mark, re-encode with it removed.
import { $, h, esc, dropzone, metaLine, progress, show, compare, saveBlob, outName, keepAwake, unsupportedNote } from './common.js';
import { frameAt, convert } from '../lib/video.js';
import { suggest, fitMark, inpaintAll } from '../lib/fit.js';
import { makeRemover } from '../lib/process.js';

const COL = { saved: 'var(--mark-known)', sug: 'var(--mark-sug)', man: 'var(--mark-man)' };
const HEX = { saved: '#0070f3', sug: '#f5a623', man: '#7928ca' };
const LS = 'pixelwash.marks';
const savedMarks = () => { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch { return []; } };
const storeMarks = m => { try { localStorage.setItem(LS, JSON.stringify(m)); } catch { /* storage off */ } };

export function renderRemove(root) {
  root.innerHTML = `
  <section class="page-head"><div class="wrap">
    <p class="eyebrow">Tool 1 · Watermark remover</p>
    <h1>Remove a watermark or logo</h1>
    <p>Mark it once. Pixelwash measures how see-through it is across the whole video and recovers the picture underneath. Solid logos are filled in from their surroundings.</p>
  </div></section>
  <div class="wrap app">
    <div class="stack">
      <div class="card"><div id="drop"></div>${unsupportedNote()}<div id="meta" class="meta"></div></div>
      <div class="card" id="previewCard"><h2>Preview</h2>
        <div class="viewer draw" id="viewer"><canvas id="cv" width="640" height="360"></canvas></div>
        <div class="row"><span class="hint">Time</span><input id="t" type="range" min="0" max="1" step="0.01" value="0" class="grow" disabled><span id="tl" class="hint">0.0 s</span></div>
        <div class="legend"><span><i class="dot" style="background:${COL.sug}"></i>suggestion</span><span><i class="dot" style="background:${COL.man}"></i>your box</span><span><i class="dot" style="background:${COL.saved}"></i>saved mark</span><span class="hint">Drag on the picture to box the watermark · tap a box to switch it on/off</span></div>
      </div>
      <div class="card hidden" id="resultCard"><h2>Result</h2>
        <div class="center" id="cmp"></div>
        <div class="row"><span class="hint">Compare at</span><input id="ct" type="range" min="0" max="1" step="0.01" value="0.5" class="grow"><span id="ctl" class="hint"></span></div>
        <div id="report" class="meta"></div>
        <div class="result-actions"><button class="primary" id="save">Save video</button>
          <input id="markName" type="text" placeholder="Name this mark to reuse it (optional)" style="flex:1;min-width:180px"><button id="remember">Remember mark</button></div>
      </div>
    </div>
    <aside class="stack">
      <div class="card"><h2>Watermarks</h2>
        <div class="row" style="margin-top:0"><button id="find" disabled>Find watermarks</button><span id="findSt" class="hint"></span></div>
        <ul class="list" id="boxes" style="margin-top:12px"></ul>
        <p class="hint" id="noBoxes">Open a video, then let Pixelwash look for marks or drag a box over one.</p>
      </div>
      <div class="card"><h2>Remove</h2>
        <label class="f">Method<div class="seg" id="method"><button data-v="auto" class="on">Auto</button><button data-v="fill">Fill solid logo</button></div></label>
        <p class="hint" id="methodHint" style="margin-top:8px">Auto measures semi-transparent marks and recovers what's underneath; a mark that turns out solid is filled in.</p>
        <button class="primary block" id="go" style="margin-top:16px" disabled>Remove watermark</button>
        <div class="bar"><div></div></div><div class="status"></div>
        <div class="note">Only remove marks from videos you own or have the rights to. If a platform requires an AI or "altered content" label, keep it on when you upload.</div>
      </div>
    </aside>
  </div>`;

  let v = null, boxes = [], drag = null, method = 'auto', result = null, busy = false;
  const cv = $('#cv'), ctx = cv.getContext('2d'), prog = progress(root);
  let frame = null;

  dropzone($('#drop'), async vid => {
    v = vid; boxes = []; result = null;
    $('#meta').textContent = metaLine(v.info);
    $('#t').disabled = false; $('#t').max = Math.max(0, v.info.duration - 0.05); $('#t').value = Math.min(1, v.info.duration / 2);
    $('#find').disabled = false; $('#go').disabled = false; $('#resultCard').classList.add('hidden');
    for (const m of savedMarks()) if (m.w === v.info.width && m.h === v.info.height) boxes.push({ box: m.box, type: 'saved', on: true, name: m.name });
    renderList(); await loadFrame(); find();
  }, e => prog.error(e));

  async function loadFrame() {
    if (!v) return;
    const t = +$('#t').value; $('#tl').textContent = t.toFixed(1) + ' s';
    frame = await frameAt(v, t);
    if (frame) { cv.width = frame.width; cv.height = frame.height; draw(); }
  }
  let tt; $('#t').oninput = () => { $('#tl').textContent = (+$('#t').value).toFixed(1) + ' s'; clearTimeout(tt); tt = setTimeout(loadFrame, 120); };

  async function find() {
    if (!v || busy) return;
    $('#find').disabled = true; $('#findSt').textContent = 'scanning frames…';
    try {
      const c = await suggest(v, { onProgress: p => $('#findSt').textContent = `scanning frames… ${Math.round(p * 100)}%` });
      boxes = boxes.filter(b => b.type !== 'sug');
      for (const s of c) boxes.push({ box: s.box, type: 'sug', on: false, conf: s.confidence });
      $('#findSt').textContent = c.length ? `${c.length} possible mark${c.length > 1 ? 's' : ''}: tick the right one` : 'nothing obvious: drag a box over the mark';
    } catch (e) { $('#findSt').textContent = 'scan failed: ' + e.message; }
    $('#find').disabled = false; renderList(); draw();
  }
  $('#find').onclick = find;

  function renderList() {
    const ul = $('#boxes'); ul.innerHTML = '';
    $('#noBoxes').classList.toggle('hidden', boxes.length > 0);
    boxes.forEach((b, i) => {
      const name = b.type === 'saved' ? 'Saved: ' + esc(b.name) : b.type === 'sug' ? 'Suggestion' : 'Your box';
      const li = h(`<li><input type="checkbox" ${b.on ? 'checked' : ''} aria-label="use this box"><i class="dot" style="background:${COL[b.type]}"></i>
        <span class="grow">${name}<small>${b.box.join(', ')}${b.conf != null ? ' · ' + Math.round(b.conf * 100) + '% sure' : ''}</small></span>
        <button class="x" aria-label="remove box">✕</button></li>`);
      $('input', li).onchange = e => { b.on = e.target.checked; draw(); };
      $('.x', li).onclick = () => { boxes.splice(i, 1); renderList(); draw(); };
      ul.appendChild(li);
    });
  }

  function draw() {
    if (!frame) return;
    ctx.drawImage(frame, 0, 0);
    const lw = Math.max(2, cv.width / 360);
    for (const b of boxes) {
      const [x, y, w, hh] = b.box;
      ctx.lineWidth = lw; ctx.strokeStyle = HEX[b.type]; ctx.setLineDash(b.on ? [] : [lw * 3, lw * 3]);
      ctx.strokeRect(x, y, w, hh);
      if (b.on) { ctx.fillStyle = HEX[b.type] + '33'; ctx.fillRect(x, y, w, hh); }
    }
    ctx.setLineDash([]);
    if (drag && drag.moved) { ctx.strokeStyle = HEX.man; ctx.lineWidth = lw; ctx.strokeRect(...rect(drag)); }
  }
  const toSrc = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  const rect = d => [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)];
  cv.addEventListener('pointerdown', e => { if (!v) return; cv.setPointerCapture(e.pointerId); const [x, y] = toSrc(e); drag = { x0: x, y0: y, x1: x, y1: y, moved: false }; });
  cv.addEventListener('pointermove', e => { if (!drag) return; const [x, y] = toSrc(e); drag.x1 = x; drag.y1 = y; drag.moved = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0) > 6; draw(); });
  cv.addEventListener('pointerup', () => {
    if (!drag) return; const d = drag; drag = null;
    if (d.moved) { const [x, y, w, hh] = rect(d).map(Math.round); if (w >= 6 && hh >= 6) boxes.push({ box: [x, y, w, hh], type: 'man', on: true }); }
    else { const hit = boxes.slice().reverse().find(b => d.x0 >= b.box[0] && d.x0 <= b.box[0] + b.box[2] && d.y0 >= b.box[1] && d.y0 <= b.box[1] + b.box[3]); if (hit) hit.on = !hit.on; }
    renderList(); draw();
  });

  $('#method').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    method = b.dataset.v; $('#method').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('#methodHint').textContent = method === 'auto'
      ? "Auto measures semi-transparent marks and recovers what's underneath; a mark that turns out solid is filled in."
      : 'Fills everything inside each box from its surroundings. Best for solid, opaque logos; keep the box tight.';
  };

  $('#go').onclick = async () => {
    const on = boxes.filter(b => b.on);
    if (!on.length) { prog.error(new Error('Tick a suggestion or drag a box over the watermark first.')); return; }
    busy = true; $('#go').disabled = true; $('#find').disabled = true;
    const lock = await keepAwake();
    try {
      const fits = [];
      for (let i = 0; i < on.length; i++) {
        if (method === 'fill') { fits.push(inpaintAll(on[i].box)); continue; }
        prog.start(`measuring mark ${i + 1} of ${on.length}`);
        fits.push(await fitMark(v, on[i].box, { onProgress: p => prog.set(p, `measuring mark ${i + 1} of ${on.length}`) }));
      }
      const W = v.info.width, H = v.info.height;
      const rm = makeRemover(W, H, fits);
      prog.start('removing + encoding');
      const out = await convert(v, {
        outW: W, outH: H,
        process: s => { const img = s.toCanvasImageSource(); return rm.frame(img); },
        onProgress: p => prog.set(p, 'removing + encoding'),
      });
      result = { ...out, fits };
      prog.done(`done · ${(out.blob.size / 1e6).toFixed(1)} MB`);
      $('#resultCard').classList.remove('hidden');
      $('#report').innerHTML = fits.map((f, i) => `mark ${i + 1}: ${f.mode === 'unblend' ? `semi-transparent, recovered (leftover ${f.after} levels, was ${f.before})` : f.mode === 'inpaint' ? 'solid, filled from surroundings' : 'nothing measurable in this box'}`).join('<br>')
        + `<br>${W}×${H} · ${out.codec.toUpperCase()} · ${(out.bitrate / 1e6).toFixed(1)} Mbps`;
      $('#ct').max = Math.max(0, v.info.duration - 0.05); $('#ct').value = +$('#t').value;
      await showCompare();
      $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); prog.error(e); }
    lock && lock.release && lock.release();
    busy = false; $('#go').disabled = false; $('#find').disabled = false;
  };

  async function showCompare() { const t = +$('#ct').value; $('#ctl').textContent = t.toFixed(1) + ' s'; await compare($('#cmp'), v, result.blob, t); }
  let ct; $('#ct').oninput = () => { clearTimeout(ct); ct = setTimeout(showCompare, 150); };
  $('#save').onclick = () => result && saveBlob(result.blob, outName(v.info, 'clean', result.ext)).catch(e => prog.error(e));
  $('#remember').onclick = () => {
    const name = $('#markName').value.trim() || 'mark ' + (savedMarks().length + 1);
    const marks = savedMarks();
    for (const b of boxes.filter(b => b.on)) marks.push({ name, w: v.info.width, h: v.info.height, box: b.box });
    storeMarks(marks); $('#remember').textContent = 'Saved ✓';
    setTimeout(() => $('#remember').textContent = 'Remember mark', 1800);
  };
}

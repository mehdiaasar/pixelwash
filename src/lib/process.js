// Per-frame processors for the two tools. Each returns { gl, frame(image) → OffscreenCanvas }.
import { GL } from './gl.js';

// ---------------------------------------------------------------- Remove
export function makeRemover(W, H, fits) {
  const gl = new GL(W, H);
  const prepared = fits.filter(f => f.mode !== 'none').map(f => ({
    ...f,
    alphaTex: f.mode === 'unblend' ? gl.mapTex(f.box[2], f.box[3], f.alpha) : null,
    maskTex: f.mode === 'inpaint' ? gl.mapTex(f.box[2], f.box[3], f.mask) : null,
  }));
  const levels = [];
  for (let w = W, h = H; ; ) { levels.push([w, h]); if (w === 1 && h === 1) break; w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2)); }

  function inpaint(cur, f, i) {
    const box = f.box;
    const pulls = [gl.target('pull0', W, H)];
    gl.run('pullInit', pulls[0], { uTex: cur, uMask: f.maskTex, uBox: box });
    for (let l = 1; l < levels.length; l++) {
      const t = gl.target('pull' + l, levels[l][0], levels[l][1]);
      gl.run('pull', t, { uTex: pulls[l - 1] }); pulls.push(t);
    }
    let coarse = pulls[pulls.length - 1];
    for (let l = levels.length - 2; l >= 0; l--) {
      const t = gl.target('push' + l, levels[l][0], levels[l][1]);
      gl.run('push', t, { uFine: pulls[l], uCoarse: coarse }); coarse = t;
    }
    const out = gl.target('rm' + (i % 2), W, H);
    gl.run('pullFinish', out, { uTex: cur, uFill: coarse, uMask: f.maskTex, uBox: box });
    return out;
  }

  return {
    gl,
    frame(image) {
      let cur = gl.upload(image);
      prepared.forEach((f, i) => {
        if (f.mode === 'unblend') {
          const out = gl.target('rm' + (i % 2), W, H);
          gl.run('unblend', out, { uTex: cur, uAlpha: f.alphaTex, uBox: f.box, uW: f.W, uFeather: 1 });
          cur = out;
        } else if (f.mode === 'inpaint') cur = inpaint(cur, f, i);
      });
      gl.resize(W, H);
      gl.run('present', null, { uTex: cur });
      return gl.canvas;
    },
  };
}

// ---------------------------------------------------------------- Upscale
export const PRESETS = {
  short_1080: { label: 'Short / Reel 1080×1920', w: 1080, h: 1920 },
  short_4k: { label: 'Vertical 4K 2160×3840', w: 2160, h: 3840 },
  hd_1080: { label: '16:9 1080p 1920×1080', w: 1920, h: 1080 },
  uhd_4k: { label: '16:9 4K 3840×2160', w: 3840, h: 2160 },
  x2: { label: '2× the source', x: 2 },
  keep: { label: 'Same size (enhance only)', x: 1 },
};

export function targetSize(W, H, preset, custom) {
  let w, h;
  if (custom) [w, h] = custom;
  else { const p = PRESETS[preset]; if (p.x) { w = W * p.x; h = H * p.x; } else { w = p.w; h = p.h; } }
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2];
}

// Same aspect → fill the frame; otherwise fit inside with a blurred copy behind (no black bars).
function layout(W, H, outW, outH) {
  if (Math.abs((W / H) / (outW / outH) - 1) <= 0.01) return { fw: outW, fh: outH, ox: 0, oy: 0, contain: false };
  const s = Math.min(outW / W, outH / H);
  const fw = Math.floor(W * s / 2) * 2, fh = Math.floor(H * s / 2) * 2;
  return { fw, fh, ox: Math.floor((outW - fw) / 4) * 2, oy: Math.floor((outH - fh) / 4) * 2, contain: true };
}

// AI work size: bigger output → AI runs on the source size; same size or smaller (a soft, already-upscaled
// video) → shrink to half first, then AI brings it back (the GiggleToons theme-song v4 method).
export function aiWorkSize(W, H, fw, fh) {
  if (Math.max(fw / W, fh / H) <= 1.01) return [Math.max(2, Math.round(W / 4) * 2), Math.max(2, Math.round(H / 4) * 2)];
  return [W, H];
}

export function makeUpscaler(W, H, outW, outH, { sharpen = 0.45, denoise = 0, ai = null, blend = 0.5 } = {}) {
  const gl = new GL(outW, outH);
  const L = layout(W, H, outW, outH);
  const up = L.fw > W * 1.01 || L.fh > H * 1.01;
  const [aw, ah] = ai ? aiWorkSize(W, H, L.fw, L.fh) : [0, 0];
  const casStrength = ai ? 0.6 : sharpen;           // AI blend: the classical half also deblocks + sharpens
  const dn = ai ? Math.max(denoise, 0.5) : denoise;

  return {
    gl, layout: L, aiWork: ai ? [aw, ah] : null,
    async frame(image) {
      const src = gl.upload(image);
      let s = src;
      if (dn > 0) { const d = gl.target('dn', W, H); gl.run('bilateral', d, { uTex: s, uSigma: 0.03 + 0.07 * dn }); s = d; }
      // classical: Lanczos to the fitted size, then CAS
      let fg = gl.target('fg', L.fw, L.fh);
      gl.resize2(s, W, H, fg, L.fw, L.fh, 'up');
      if (casStrength > 0 && (up || ai)) { const t = gl.target('cas', L.fw, L.fh); gl.run('cas', t, { uTex: fg, uSharp: casStrength }); fg = t; }
      if (ai) {
        const work = gl.target('work', aw, ah, { float: false });
        gl.resize2(src, W, H, work, aw, ah, 'wk');
        const aiOut = gl.target('aiOut', L.fw, L.fh);
        await ai.run(gl, work, aw, ah, aiOut, L.fw, L.fh);
        const ma = gl.mean(aiOut, L.fw, L.fh), mc = gl.mean(fg, L.fw, L.fh);
        const mix = gl.target('mix', L.fw, L.fh);
        gl.run('blend', mix, { uA: aiOut, uB: fg, uMix: blend, uShift: [mc[0] - ma[0], mc[1] - ma[1], mc[2] - ma[2]] });
        fg = mix;
      }
      let out = fg;
      if (L.contain) {
        const bw = Math.max(2, outW >> 3), bh = Math.max(2, outH >> 3);
        const bg = gl.target('bg', bw, bh), bg2 = gl.target('bg2', bw, bh);
        // cover-scale the source into a 1/8-size background, then blur it heavily (3 separable passes)
        const sc = Math.max(outW / W, outH / H), uw = outW / (W * sc), uh = outH / (H * sc);
        gl.run('copy', bg, { uTex: src, uMap: [(1 - uw) / 2, (1 - uh) / 2, uw, uh], uGain: 0.94 });
        for (let i = 0; i < 3; i++) { gl.run('blur', bg2, { uTex: bg, uDir: [1, 0] }); gl.run('blur', bg, { uTex: bg2, uDir: [0, 1] }); }
        out = gl.target('out', outW, outH);
        gl.run('compose', out, { uFg: fg, uBg: bg, uRect: [L.ox, L.oy, L.fw, L.fh] });
      }
      gl.resize(outW, outH);
      gl.run('present', null, { uTex: out });
      return gl.canvas;
    },
  };
}

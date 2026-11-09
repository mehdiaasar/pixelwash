// Watermark maths, all on the CPU over sampled frames (no AI).
//  - suggest(): finds static overlays: an overlay's edges point the same way in every frame,
//    while moving content averages out (per-pixel mean of the gradient *vector*).
//  - fitMark(): models a semi-transparent mark as  observed = (1 - a)·picture + a·W  and solves
//    a (per pixel) and W (per channel) by regression against an inpainted background guess.
import { sampleFrames } from './video.js';

const ctx2d = (w, h) => { const c = new OffscreenCanvas(w, h); return c.getContext('2d', { willReadFrequently: true }); };

// ---------------------------------------------------------------- suggestions
export async function suggest(v, { frames = 40, onProgress } = {}) {
  const W = v.info.width, H = v.info.height;
  const s = Math.min(1, 480 / Math.max(W, H));
  const w = Math.max(16, Math.round(W * s)), h = Math.max(16, Math.round(H * s));
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), gm = new Float32Array(w * h);
  const c = ctx2d(w, h);
  let n = 0;
  await sampleFrames(v, frames, (canvas, i) => {
    c.drawImage(canvas, 0, 0, w, h);
    const d = c.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    for (let k = 0, j = 0; k < L.length; k++, j += 4) L[k] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const ax = L[k - w + 1] + 2 * L[k + 1] + L[k + w + 1] - L[k - w - 1] - 2 * L[k - 1] - L[k + w - 1];
      const ay = L[k + w - 1] + 2 * L[k + w] + L[k + w + 1] - L[k - w - 1] - 2 * L[k - w] - L[k - w + 1];
      gx[k] += ax; gy[k] += ay; gm[k] += Math.hypot(ax, ay);
    }
    n++; onProgress && onProgress((i + 1) / frames);
  }, [w, h]);
  // score: how consistently the edge points the same way (1 = perfectly static)
  const on = new Uint8Array(w * h);
  for (let k = 0; k < on.length; k++) {
    const mag = gm[k] / n;
    on[k] = mag > 20 && Math.hypot(gx[k], gy[k]) / (gm[k] + 1e-6) > 0.72 ? 1 : 0;
  }
  // dilate, then connected components
  const dil = new Uint8Array(w * h), R = 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on[y * w + x])
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1; }
  const lab = new Int32Array(w * h), out = [];
  for (let k = 0; k < lab.length; k++) {
    if (!dil[k] || lab[k]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, cnt = 0, edge = 0; const st = [k]; lab[k] = 1;
    while (st.length) {
      const q = st.pop(), x = q % w, y = (q / w) | 0; cnt++; edge += on[q];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const nb of [q - 1, q + 1, q - w, q + w]) if (nb >= 0 && nb < lab.length && dil[nb] && !lab[nb] && Math.abs((nb % w) - x) <= 1) { lab[nb] = 1; st.push(nb); }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, area = bw * bh;
    if (area < 0.0004 * w * h || area > 0.08 * w * h || edge < 12) continue;
    // marks usually sit near a corner or edge
    const cx = (x0 + x1) / 2 / w, cy = (y0 + y1) / 2 / h;
    const nearEdge = 1 - Math.min(cx, 1 - cx, cy, 1 - cy) * 2;
    const conf = Math.min(1, edge / (area * 0.35)) * 0.6 + nearEdge * 0.4;
    const pad = 2;
    out.push({ box: [Math.max(0, Math.round((x0 - pad) / s)), Math.max(0, Math.round((y0 - pad) / s)),
      Math.min(W, Math.round((bw + 2 * pad) / s)), Math.min(H, Math.round((bh + 2 * pad) / s))], confidence: +conf.toFixed(2) });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 5);
}

// ---------------------------------------------------------------- background guess inside a box
// Coons patch from the surrounding ring, refined by SOR on Laplace's equation (harmonic fill).
function fillHarmonic(img, W, H, bx, by, bw, bh, iters = 50) {
  const out = new Float32Array(bw * bh);
  const at = (x, y) => img[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const u = (x + 1) / (bw + 1), t = (y + 1) / (bh + 1);
    const L = at(bx - 1, by + y), R = at(bx + bw, by + y), T = at(bx + x, by - 1), B = at(bx + x, by + bh);
    const c00 = at(bx - 1, by - 1), c10 = at(bx + bw, by - 1), c01 = at(bx - 1, by + bh), c11 = at(bx + bw, by + bh);
    out[y * bw + x] = (1 - u) * L + u * R + (1 - t) * T + t * B - ((1 - u) * (1 - t) * c00 + u * (1 - t) * c10 + (1 - u) * t * c01 + u * t * c11);
  }
  const g = (x, y) => (x < 0 || y < 0 || x >= bw || y >= bh) ? at(bx + x, by + y) : out[y * bw + x];
  for (let it = 0; it < iters; it++) for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const k = y * bw + x, nv = (g(x - 1, y) + g(x + 1, y) + g(x, y - 1) + g(x, y + 1)) / 4;
    out[k] += 1.8 * (nv - out[k]);
  }
  return out;
}

// ---------------------------------------------------------------- fit one mark
export async function fitMark(v, box, { frames = 60, onProgress } = {}) {
  const W = v.info.width, H = v.info.height;
  let [bx, by, bw, bh] = box.map(Math.round);
  bx = Math.max(1, Math.min(W - 3, bx)); by = Math.max(1, Math.min(H - 3, by));
  bw = Math.max(2, Math.min(W - 1 - bx, bw)); bh = Math.max(2, Math.min(H - 1 - by, bh));
  const m = Math.max(6, Math.round(Math.min(bw, bh) * 0.3));
  const rx = Math.max(0, bx - m), ry = Math.max(0, by - m), rw = Math.min(W, bx + bw + m) - rx, rh = Math.min(H, by + bh + m) - ry;
  const N = bw * bh;
  // per-pixel, per-channel sums for the regression  o = s·B + c
  const S = Array.from({ length: 3 }, () => ({ o: new Float64Array(N), b: new Float64Array(N), bb: new Float64Array(N), ob: new Float64Array(N), oo: new Float64Array(N) }));
  const c = ctx2d(W, H);
  let n = 0;
  await sampleFrames(v, frames, (canvas, i) => {
    c.drawImage(canvas, 0, 0, W, H);
    const d = c.getImageData(rx, ry, rw, rh).data;
    const ch = [0, 1, 2].map(q => { const a = new Float32Array(rw * rh); for (let k = 0; k < a.length; k++) a[k] = d[k * 4 + q]; return a; });
    for (let q = 0; q < 3; q++) {
      const B = fillHarmonic(ch[q], rw, rh, bx - rx, by - ry, bw, bh), s = S[q];
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const k = y * bw + x, o = ch[q][(by - ry + y) * rw + (bx - rx + x)], b = B[k];
        s.o[k] += o; s.b[k] += b; s.bb[k] += b * b; s.ob[k] += o * b; s.oo[k] += o * o;
      }
    }
    n++; onProgress && onProgress((i + 1) / frames);
  });
  if (n < 3) throw new Error('Not enough frames to measure the watermark.');

  // stage 1: free regression per pixel gives a rough a and W where the background varied enough
  const a1 = new Float32Array(N), Wq = [0, 0, 0];
  for (let q = 0; q < 3; q++) {
    const s = S[q], Wc = [], Wt = [];
    for (let k = 0; k < N; k++) {
      const mb = s.b[k] / n, mo = s.o[k] / n, vb = s.bb[k] / n - mb * mb;
      if (vb < 60) continue;                        // background barely changed here: unreliable
      const slope = (s.ob[k] / n - mo * mb) / vb, a = 1 - slope;
      if (a > 0.08 && a < 0.95) { Wc.push((mo - slope * mb) / a); Wt.push(a); a1[k] = Math.max(a1[k], a); }
    }
    if (Wc.length > Math.max(20, N * 0.02)) {
      const idx = Wc.map((_, i) => i).sort((i, j) => Wc[i] - Wc[j]);
      let half = Wt.reduce((x, y) => x + y, 0) / 2, acc = 0, med = Wc[idx[0]];
      for (const i of idx) { acc += Wt[i]; if (acc >= half) { med = Wc[i]; break; } }
      Wq[q] = Math.min(255, Math.max(0, med));
    } else Wq[q] = NaN;
  }
  // fallback colour: white mark if it brightens the picture, black if it darkens it
  if (Wq.some(Number.isNaN)) {
    let diff = 0; for (let q = 0; q < 3; q++) for (let k = 0; k < N; k++) diff += S[q].o[k] - S[q].b[k];
    const fb = diff >= 0 ? 255 : 0;
    for (let q = 0; q < 3; q++) if (Number.isNaN(Wq[q])) Wq[q] = fb;
  }
  // stage 1b: refine W so one transparency map explains all three channels. On the time-averaged images,
  // Ō − B̄ = a·(W − B̄) per channel; for a given W the best a per pixel is closed-form, and W (3 numbers)
  // is found by coordinate search. Pixels of different background colours pin W down.
  const Om = [0, 1, 2].map(q => Float32Array.from(S[q].o, x => x / n)), Bm = [0, 1, 2].map(q => Float32Array.from(S[q].b, x => x / n));
  const J = (Wv) => {
    let e = 0;
    for (let k = 0; k < N; k++) {
      let num = 0, den = 0;
      for (let q = 0; q < 3; q++) { const d = Wv[q] - Bm[q][k]; num += (Om[q][k] - Bm[q][k]) * d; den += d * d; }
      const a = den > 1e-3 ? Math.min(0.97, Math.max(0, num / den)) : 0;
      for (let q = 0; q < 3; q++) { const r = Om[q][k] - Bm[q][k] - a * (Wv[q] - Bm[q][k]); e += r * r; }
    }
    return e;
  };
  let best = Wq.slice(), bestJ = J(best);
  for (const start of [[255, 255, 255], [0, 0, 0]]) { const j = J(start); if (j < bestJ) { bestJ = j; best = start.slice(); } }
  for (const step of [16, 4, 1]) for (let round = 0; round < 3; round++) for (let q = 0; q < 3; q++) {
    for (const dir of [-1, 1]) {
      for (;;) {
        const t = best.slice(); t[q] = Math.min(255, Math.max(0, t[q] + dir * step));
        if (t[q] === best[q]) break;
        const j = J(t); if (j < bestJ) { bestJ = j; best = t; } else break;
      }
    }
  }
  for (let q = 0; q < 3; q++) Wq[q] = best[q];

  // stage 2: with W fixed, a per pixel by least squares over frames and channels
  const alpha = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let num = 0, den = 0;
    for (let q = 0; q < 3; q++) {
      const s = S[q], Wv = Wq[q];
      // Σ (o-B)(W-B) = W·Σo - Σob - W·Σb + Σbb ;  Σ (W-B)^2 = n·W² - 2W·Σb + Σbb
      num += Wv * s.o[k] - s.ob[k] - Wv * s.b[k] + s.bb[k];
      den += n * Wv * Wv - 2 * Wv * s.b[k] + s.bb[k];
    }
    let a = den > 1e-3 ? num / den : 0;
    alpha[k] = a < 0.03 ? 0 : Math.min(0.97, a);
  }
  // opaque logo? (a big share of the box near 1) → inpaint instead of unblend
  const sorted = Float32Array.from(alpha).sort();
  const top = sorted[Math.floor(N * 0.95)] || 0;
  const covered = alpha.filter(a => a > 0.05).length / N;
  const opaque = top > 0.9 && covered > 0.05;

  // leftover: RMS of the time-averaged (recovered − background) pattern, in 8-bit levels
  const score = (useAlpha) => {
    let ss = 0, m = 0;
    for (let k = 0; k < N; k++) {
      if (useAlpha && alpha[k] <= 0.05) continue;
      const a = useAlpha ? alpha[k] : 0;
      for (let q = 0; q < 3; q++) { const v = (Om[q][k] - a * Wq[q]) / (1 - a) - Bm[q][k]; ss += v * v; m++; }
    }
    return m ? Math.sqrt(ss / m) : 0;
  };
  const before = score(false), after = opaque ? 0 : score(true);
  const mask = opaque ? dilateMask(alpha, bw, bh) : null;
  return {
    box: [bx, by, bw, bh], mode: opaque ? 'inpaint' : (covered < 0.01 ? 'none' : 'unblend'),
    alpha, W: Wq.map(x => x / 255), mask, frames: n, before: +before.toFixed(1), after: +after.toFixed(1),
  };
}

function dilateMask(alpha, w, h) {
  const m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 0.35)
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) m[yy * w + xx] = 1; }
  return m;
}

// A box drawn by hand around a solid logo: fill everything inside it.
export function inpaintAll(box) {
  const [bx, by, bw, bh] = box.map(Math.round);
  return { box: [bx, by, bw, bh], mode: 'inpaint', mask: new Float32Array(bw * bh).fill(1), alpha: null, W: [1, 1, 1], before: 0, after: 0, frames: 0 };
}

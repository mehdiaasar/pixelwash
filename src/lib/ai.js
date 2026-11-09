// Optional AI upscaling: Real-ESRGAN realesr-animevideov3 (SRVGGNetCompact, ×4) running in the browser with
// onnxruntime-web (WebGPU when available, WASM otherwise). Model: BSD-3-Clause, © 2021 Xintao Wang.
// Frames are cut into overlapping tiles; each tile's ×4 output is resampled straight into the output texture.

let ortP = null;
async function loadOrt() {
  if (!ortP) ortP = import('onnxruntime-web/webgpu').then(ort => {
    // the WebAssembly runtime is bundled by Vite next to the app (no third-party CDN)
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    return ort;
  });
  return ortP;
}

export class AIUpscaler {
  static async create(onStatus = () => {}) {
    const ort = await loadOrt();
    const url = new URL('./models/realesr-animevideov3-x4.onnx', document.baseURI).href;
    onStatus('loading AI model…');
    const buf = await (await fetch(url)).arrayBuffer();
    let session = null, backend = 'wasm';
    if (navigator.gpu) {
      try { session = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); backend = 'webgpu'; }
      catch (e) { console.warn('WebGPU AI backend failed, using WASM', e); }
    }
    if (!session) session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return new AIUpscaler(ort, session, backend);
  }
  constructor(ort, session, backend) { this.ort = ort; this.session = session; this.backend = backend; this.tile = backend === 'webgpu' ? 256 : 128; this.pad = 8; }

  // src: texture with the work-size picture (workW×workH, RGBA8 target). Writes into dst (fw×fh) at rect origin 0,0.
  async run(gl, work, workW, workH, dst, fw, fh) {
    const px = gl.read(work, 0, 0, workW, workH);            // top-down RGBA8
    const T = this.tile, P = this.pad, sx = fw / (4 * workW), sy = fh / (4 * workH);
    for (let y0 = 0; y0 < workH; y0 += T) for (let x0 = 0; x0 < workW; x0 += T) {
      const x1 = Math.min(workW, x0 + T), y1 = Math.min(workH, y0 + T);
      const ax = Math.max(0, x0 - P), ay = Math.max(0, y0 - P), bx = Math.min(workW, x1 + P), by = Math.min(workH, y1 + P);
      const w = bx - ax, h = by - ay, plane = w * h;
      const inp = new Float32Array(3 * plane);
      for (let yy = 0; yy < h; yy++) {
        let s = ((ay + yy) * workW + ax) * 4, d = yy * w;
        for (let xx = 0; xx < w; xx++, s += 4, d++) { inp[d] = px[s] / 255; inp[plane + d] = px[s + 1] / 255; inp[2 * plane + d] = px[s + 2] / 255; }
      }
      const res = await this.session.run({ input: new this.ort.Tensor('float32', inp, [1, 3, h, w]) });
      const out = res.output, data = await out.getData(), W4 = w * 4, H4 = h * 4, p4 = W4 * H4;
      if (!this._rgba || this._rgba.length < p4 * 4) this._rgba = new Float32Array(p4 * 4);
      const rgba = this._rgba;
      for (let k = 0, j = 0; k < p4; k++, j += 4) { rgba[j] = data[k]; rgba[j + 1] = data[p4 + k]; rgba[j + 2] = data[2 * p4 + k]; rgba[j + 3] = 1; }
      out.dispose && out.dispose();
      const tex = gl.uploadFloat('aiTile', W4, H4, rgba.subarray(0, p4 * 4));
      // destination rect for this tile's core, in output pixels (shared edges between tiles: no gaps)
      const X0 = Math.round(x0 * fw / workW), X1 = Math.round(x1 * fw / workW), Y0 = Math.round(y0 * fh / workH), Y1 = Math.round(y1 * fh / workH);
      if (X1 <= X0 || Y1 <= Y0) continue;
      // source coordinate inside the padded tile for output pixel X: X/sx − 0.5 − 4·ax
      gl.resize2(tex, W4, H4, dst, X1 - X0, Y1 - Y0, 'aiT', [X0, Y0, X1 - X0, Y1 - Y0],
        { sx, sy, ox: X0 / sx - 4 * ax, oy: Y0 / sy - 4 * ay });
    }
  }
}

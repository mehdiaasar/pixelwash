// WebGL2 image engine. Every intermediate lives in a framebuffer texture whose row 0 is the TOP of the image
// (same as an uploaded VideoFrame), so only the final present() to the canvas flips Y.

const VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int;
out vec4 o;
uniform vec2 uOut;          // size of the render target region
uniform vec2 uOrigin;       // viewport origin in the target (pixels)
uniform float uFlip;        // 1 when rendering to the canvas (bottom-up)
vec2 px(){ vec2 p = gl_FragCoord.xy - uOrigin; if (uFlip > 0.5) p.y = uOut.y - p.y; return p; } // pixel centre, top-down
`;

const FS = {
  // Lanczos-3 resample along one axis. uDir = (1,0) horizontal, (0,1) vertical.
  lanczos: HEAD + `
uniform sampler2D uTex; uniform vec2 uSrc; uniform vec2 uDir; uniform float uScale; uniform float uShift;
float sinc(float x){ x *= 3.14159265; return abs(x) < 1e-4 ? 1.0 : sin(x) / x; }
float L(float x){ return abs(x) >= 3.0 ? 0.0 : sinc(x) * sinc(x / 3.0); }
void main(){
  vec2 p = px();
  // source coordinate along the axis (pixel-index space): uScale = dst/src, uShift = extra source offset
  float c = (dot(p, uDir)) / uScale - 0.5 + uShift;
  float k = min(1.0, uScale), r = 3.0 / k;
  int i0 = int(floor(c - r)) + 1, i1 = int(floor(c + r));
  int maxSrc = int(dot(uSrc, uDir)) - 1;
  // the other axis is already at output size in the separable chain, so it is read 1:1
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = i0; i <= i1; i++) {
    if (i - i0 > 48) break;
    float w = L((float(i) - c) * k);
    int ii = clamp(i, 0, maxSrc);
    ivec2 t = uDir.x > 0.5 ? ivec2(ii, int(p.y)) : ivec2(int(p.x), ii);
    acc += texelFetch(uTex, t, 0) * w; wsum += w;
  }
  o = acc / wsum;
}`,
  // Contrast-adaptive sharpening (after AMD FidelityFX CAS, simplified).
  cas: HEAD + `
uniform sampler2D uTex; uniform float uSharp;
vec3 T(ivec2 p){ return texelFetch(uTex, clamp(p, ivec2(0), textureSize(uTex, 0) - 1), 0).rgb; }
void main(){
  ivec2 p = ivec2(px());
  vec3 b = T(p + ivec2(0, -1)), d = T(p + ivec2(-1, 0)), e = T(p), f = T(p + ivec2(1, 0)), h = T(p + ivec2(0, 1));
  vec3 mn = min(min(min(d, e), min(f, b)), h), mx = max(max(max(d, e), max(f, b)), h);
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, clamp(uSharp, 0.0, 1.0)));
  o = vec4(clamp((e + (b + d + f + h) * w) / (1.0 + 4.0 * w), 0.0, 1.0), 1.0);
}`,
  // Edge-preserving smoothing (stand-in for deblock + spatial denoise).
  bilateral: HEAD + `
uniform sampler2D uTex; uniform float uSigma;
void main(){
  ivec2 p = ivec2(px()); ivec2 m = textureSize(uTex, 0) - 1;
  vec3 c = texelFetch(uTex, p, 0).rgb; vec3 acc = vec3(0.0); float ws = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec3 s = texelFetch(uTex, clamp(p + ivec2(x, y), ivec2(0), m), 0).rgb; vec3 dd = s - c;
    float w = exp(-float(x * x + y * y) / 4.5 - dot(dd, dd) / (2.0 * uSigma * uSigma));
    acc += s * w; ws += w;
  }
  o = vec4(acc / ws, 1.0);
}`,
  // Copy with an affine uv map (used for cover-scaled backgrounds and plain copies). Bilinear.
  copy: HEAD + `
uniform sampler2D uTex; uniform vec4 uMap; uniform float uGain;
void main(){ vec2 uv = px() / uOut * uMap.zw + uMap.xy; o = vec4(texture(uTex, uv).rgb * uGain, 1.0); }`,
  blur: HEAD + `
uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec2 s = vec2(textureSize(uTex, 0)); vec2 uv = px() / s;
  vec3 a = vec3(0.0); float ws = 0.0;
  for (int i = -8; i <= 8; i++) { float w = exp(-float(i * i) / 18.0); a += texture(uTex, uv + uDir * float(i) / s).rgb * w; ws += w; }
  o = vec4(a / ws, 1.0);
}`,
  // Put the fitted foreground over the blurred background (contain mode).
  compose: HEAD + `
uniform sampler2D uFg; uniform sampler2D uBg; uniform vec4 uRect;
void main(){
  vec2 p = px();
  if (p.x >= uRect.x && p.y >= uRect.y && p.x < uRect.x + uRect.z && p.y < uRect.y + uRect.w) o = texelFetch(uFg, ivec2(p - uRect.xy), 0);
  else o = vec4(texture(uBg, p / uOut).rgb, 1.0);
}`,
  // Semi-transparent watermark removal: observed = (1-a)*picture + a*W  =>  picture = (observed - a*W)/(1-a).
  unblend: HEAD + `
uniform sampler2D uTex; uniform highp sampler2D uAlpha; uniform vec4 uBox; uniform vec3 uW; uniform float uFeather;
void main(){
  vec2 p = px(); vec4 s = texelFetch(uTex, ivec2(p), 0);
  vec2 q = p - uBox.xy;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uBox.z || q.y >= uBox.w) { o = s; return; }
  float a = min(texelFetch(uAlpha, ivec2(q), 0).r, 0.97);
  vec3 r = clamp((s.rgb - a * uW) / (1.0 - a), 0.0, 1.0);
  o = vec4(mix(s.rgb, r, uFeather), 1.0);
}`,
  // Pull-push inpainting: pull = mask-weighted downsample, push = fill holes from coarser level.
  pullInit: HEAD + `
uniform sampler2D uTex; uniform highp sampler2D uMask; uniform vec4 uBox;
void main(){
  vec2 p = px(); vec3 c = texelFetch(uTex, ivec2(p), 0).rgb; vec2 q = p - uBox.xy; float m = 0.0;
  if (q.x >= 0.0 && q.y >= 0.0 && q.x < uBox.z && q.y < uBox.w) m = texelFetch(uMask, ivec2(q), 0).r;
  float w = m > 0.5 ? 0.0 : 1.0; o = vec4(c * w, w);
}`,
  pull: HEAD + `
uniform sampler2D uTex;
void main(){
  ivec2 p = ivec2(px()) * 2; ivec2 m = textureSize(uTex, 0) - 1; vec4 a = vec4(0.0);
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) a += texelFetch(uTex, min(p + ivec2(x, y), m), 0);
  o = a.a > 0.0 ? vec4(a.rgb, a.a) / max(a.a, 1e-6) * min(a.a, 1.0) : vec4(0.0);
}`,
  push: HEAD + `
uniform sampler2D uFine; uniform sampler2D uCoarse;
void main(){
  vec2 p = px(); vec4 f = texelFetch(uFine, ivec2(p), 0);
  vec4 c = texture(uCoarse, p / uOut); vec3 cc = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  vec3 ff = f.a > 0.0 ? f.rgb / f.a : vec3(0.0);
  o = vec4(mix(cc, ff, clamp(f.a, 0.0, 1.0)), 1.0);
}`,
  pullFinish: HEAD + `
uniform sampler2D uTex; uniform sampler2D uFill; uniform highp sampler2D uMask; uniform vec4 uBox;
void main(){
  vec2 p = px(); vec3 c = texelFetch(uTex, ivec2(p), 0).rgb; vec2 q = p - uBox.xy; float m = 0.0;
  if (q.x >= 0.0 && q.y >= 0.0 && q.x < uBox.z && q.y < uBox.w) m = texelFetch(uMask, ivec2(q), 0).r;
  o = vec4(mix(c, texelFetch(uFill, ivec2(p), 0).rgb, m), 1.0);
}`,
  // AI blend: shift the AI picture's mean onto the classical one, then mix.
  blend: HEAD + `
uniform sampler2D uA; uniform sampler2D uB; uniform float uMix; uniform vec3 uShift;
void main(){ ivec2 p = ivec2(px()); vec3 a = texelFetch(uA, p, 0).rgb + uShift, b = texelFetch(uB, p, 0).rgb;
  o = vec4(clamp(a * uMix + b * (1.0 - uMix), 0.0, 1.0), 1.0); }`,
  present: HEAD + `
uniform sampler2D uTex; void main(){ o = vec4(texelFetch(uTex, ivec2(px()), 0).rgb, 1.0); }`,
};

export class GL {
  constructor(w, h) {
    this.canvas = new OffscreenCanvas(w, h);
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.half = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.progs = {};
    this.pool = [];
    this.vao = gl.createVertexArray();
  }
  resize(w, h) { this.canvas.width = w; this.canvas.height = h; }

  prog(name) {
    if (this.progs[name]) return this.progs[name];
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS[name]));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name] = gl.getUniformLocation(p, u.name); }
    return (this.progs[name] = { p, loc });
  }

  // Render-target textures (RGBA16F when the GPU can render to it, else RGBA8).
  tex(w, h, { float = true, linear = true } = {}) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const f = float && this.half;
    gl.texStorage2D(gl.TEXTURE_2D, 1, f ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, fb, w, h };
  }
  // Cached targets by key, so per-frame passes don't allocate.
  target(key, w, h, opts) {
    const k = key + ':' + w + 'x' + h;
    this._targets ||= {};
    return (this._targets[k] ||= this.tex(w, h, opts));
  }
  // Source texture that frames are uploaded into (RGBA8).
  srcTex(key = 'src') {
    this._src ||= {};
    if (!this._src[key]) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
      this._src[key] = { t, w: 0, h: 0 };
    }
    return this._src[key];
  }
  upload(image, key = 'src') {
    const gl = this.gl, s = this.srcTex(key);
    gl.bindTexture(gl.TEXTURE_2D, s.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    s.w = image.displayWidth || image.width; s.h = image.displayHeight || image.height;
    return s;
  }
  // Upload float RGB planes (e.g. AI output) as an RGBA16F/32F texture.
  uploadFloat(key, w, h, rgba) {
    const gl = this.gl;
    this._ftex ||= {};
    let e = this._ftex[key];
    if (!e || e.w !== w || e.h !== h) {
      if (e) gl.deleteTexture(e.t);
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
      e = this._ftex[key] = { t, w, h };
    }
    gl.bindTexture(gl.TEXTURE_2D, e.t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    return e;
  }
  // Single-channel float map (watermark alpha / inpaint mask).
  mapTex(w, h, data) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, data);
    for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
    return { t, w, h };
  }

  // Run one pass. target = framebuffer texture or null (= canvas). rect = optional [x, y, w, h] viewport in target.
  run(name, target, uniforms, rect) {
    const gl = this.gl, { p, loc } = this.prog(name);
    const tw = target ? target.w : this.canvas.width, th = target ? target.h : this.canvas.height;
    const [x, y, w, h] = rect || [0, 0, tw, th];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    // canvas is bottom-up: convert a top-down rect into GL viewport space
    const vy = target ? y : th - y - h;
    gl.viewport(x, vy, w, h);
    gl.useProgram(p);
    let unit = 0;
    const set = (k, v) => {
      const l = loc[k]; if (l == null) return;
      if (v && v.t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, v.t); gl.uniform1i(l, unit++); }
      else if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else if (v.length === 4) gl.uniform4fv(l, v);
    };
    set('uOut', [w, h]); set('uOrigin', [x, vy]); set('uFlip', target ? 0 : 1);
    for (const k in uniforms) set(k, uniforms[k]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Separable Lanczos resize of src (sw×sh) into dst (dw×dh), optionally into rect [x,y,dw,dh] of dst.
  // map = {sx, sy, ox, oy}: explicit scales (dst/src) and source offsets, for tiled work.
  resize2(src, sw, sh, dst, dw, dh, tag = 'lz', rect, map) {
    const sx = map ? map.sx : dw / sw, sy = map ? map.sy : dh / sh;
    const mid = this.target(tag + 'H', dw, sh);
    this.run('lanczos', mid, { uTex: src, uSrc: [sw, sh], uDir: [1, 0], uScale: sx, uShift: map ? map.ox : 0 });
    const u = { uTex: mid, uSrc: [dw, sh], uDir: [0, 1], uScale: sy, uShift: map ? map.oy : 0 };
    if (rect) this.run('lanczos', dst, u, rect); else this.run('lanczos', dst, u);
  }

  // Mean RGB of a texture (reads a small downscaled copy).
  mean(src, sw, sh) {
    const s = 48, small = this.target('mean', s, s, { float: false });
    this.resize2(src, sw, sh, small, s, s, 'meanlz');
    const gl = this.gl, buf = new Uint8Array(s * s * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, small.fb);
    gl.readPixels(0, 0, s, s, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const m = [0, 0, 0];
    for (let i = 0; i < buf.length; i += 4) { m[0] += buf[i]; m[1] += buf[i + 1]; m[2] += buf[i + 2]; }
    return m.map(v => v / (s * s) / 255);
  }

  // Read RGBA8 pixels of a target (top-down rows, since targets are top-down in memory).
  read(target, x = 0, y = 0, w = target.w, h = target.h) {
    const gl = this.gl, buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}

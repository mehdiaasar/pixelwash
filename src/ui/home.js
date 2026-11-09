// Landing page: the two tools, how it works, privacy, the Android app.
import { isNative } from './common.js';

export const REPO = 'https://github.com/mehdiaasar/pixelwash';

export function renderHome(root) {
  root.innerHTML = `
  <section class="hero"><div class="wrap">
    <p class="eyebrow">Free · open source · on-device</p>
    <h1>Clean and sharpen your videos without uploading them.</h1>
    <p class="lead">Pixelwash removes watermarks and upscales video right in your browser or on your Android phone. Your files never leave your device.</p>
    <div class="cta"><a class="btn primary pill" href="#/remove">Remove a watermark</a><a class="btn pill" href="#/upscale">Upscale a video</a></div>
  </div></section>
  <section class="section"><div class="wrap">
    <p class="eyebrow">Two tools</p><h2 class="section-title">Pick what your video needs</h2>
    <div class="grid2">
      <a class="card tool-card" href="#/remove">
        <div class="art">${artRemove()}</div>
        <div><h3>Watermark remover</h3><p>Box the mark once. Pixelwash measures how see-through it is across the whole video and recovers the real picture underneath; solid logos are filled in from their surroundings.</p></div>
        <span class="go">Open the remover →</span>
      </a>
      <a class="card tool-card" href="#/upscale">
        <div class="art">${artUpscale()}</div>
        <div><h3>Upscaler</h3><p>Lanczos resize with contrast-adaptive sharpening, or AI blend: Real-ESRGAN mixed with the classical result for crisper outlines that keep a 3D look.</p></div>
        <span class="go">Open the upscaler →</span>
      </a>
    </div>
  </div></section>
  <section class="section" style="padding-top:0"><div class="wrap">
    <div class="grid3">
      <div class="card feature"><p class="eyebrow">Private</p><h3 style="margin-top:8px">Nothing is uploaded</h3><p>Decoding, processing and encoding all happen on your device with WebCodecs and WebGL. There is no server.</p></div>
      <div class="card feature"><p class="eyebrow">Honest maths</p><h3 style="margin-top:8px">Classical by default</h3><p>The remover inverts the watermark's blend instead of guessing. AI is optional and clearly marked.</p></div>
      <div class="card feature"><p class="eyebrow">Upload-ready</p><h3 style="margin-top:8px">Keeps what matters</h3><p>Same frame rate, audio copied untouched, high-bitrate H.264. Shorts presets at 1080×1920 and 4K.</p></div>
    </div>
  </div></section>
  ${isNative() ? '' : `<section class="section" style="padding-top:0"><div class="wrap">
    <div class="card" style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between">
      <div><p class="eyebrow">Android</p><h3 style="margin-top:8px">Pixelwash for Android</h3><p style="margin:6px 0 0;max-width:560px">The same two tools as an app that processes videos on your phone, with no upload and no account.</p></div>
      <a class="btn primary pill" href="${REPO}/releases/latest">Download the APK</a>
    </div>
  </div></section>`}`;
}

function artRemove() {
  return `<svg width="220" height="120" viewBox="0 0 220 120" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="218" height="118" rx="8" fill="var(--elevated)" stroke="var(--hairline)"/>
    <path d="M12 96 L60 52 L92 80 L130 40 L208 104" stroke="var(--hairline-strong)" stroke-width="2"/>
    <circle cx="170" cy="30" r="10" fill="var(--hairline)"/>
    <g opacity=".9"><rect x="150" y="80" width="54" height="26" rx="5" stroke="var(--mark-man)" stroke-width="2" stroke-dasharray="4 3"/>
    <path d="M168 93 l5-6 l5 6 l-5 6 z" fill="var(--mark-man)" opacity=".35"/></g></svg>`;
}
function artUpscale() {
  return `<svg width="220" height="120" viewBox="0 0 220 120" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="218" height="118" rx="8" fill="var(--elevated)" stroke="var(--hairline)"/>
    <g fill="var(--hairline-strong)">${Array.from({ length: 16 }, (_, i) => `<rect x="${18 + (i % 4) * 12}" y="${28 + Math.floor(i / 4) * 12}" width="10" height="10" rx="1" opacity="${0.35 + ((i * 7) % 5) / 8}"/>`).join('')}</g>
    <path d="M88 60 h30 m-8 -8 l8 8 l-8 8" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="168" cy="60" r="30" stroke="var(--ink)" stroke-width="2"/><circle cx="168" cy="60" r="14" fill="var(--soft)" stroke="var(--hairline-strong)"/></svg>`;
}

// Geist ships inside the app/site (OFL-1.1): no font requests to Google, and the design holds offline
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import './style.css';
import { renderHome, REPO } from './ui/home.js';
import { renderRemove } from './ui/remove.js';
import { renderUpscale } from './ui/upscale.js';
import * as videoLib from './lib/video.js';
import * as MB from 'mediabunny';

const LOGO = `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="pw" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#007cf0"/><stop offset=".5" stop-color="#7928ca"/><stop offset="1" stop-color="#ff0080"/></linearGradient></defs>
  <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#pw)"/><path d="M6 15.5c2.2-1.6 3.8-1.6 6 0s3.8 1.6 6 0M6 10.5c2.2-1.6 3.8-1.6 6 0s3.8 1.6 6 0" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`;

document.body.innerHTML = `
<header class="nav"><div class="wrap">
  <a class="brand" href="#/">${LOGO}Pixelwash</a>
  <a class="link" data-r="/remove" href="#/remove">Remove</a>
  <a class="link" data-r="/upscale" href="#/upscale">Upscale</a>
  <a class="link hide-sm" href="${REPO}" target="_blank" rel="noopener">GitHub</a>
  <button class="icon-btn ghost" id="theme" aria-label="Toggle dark mode"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg></button>
</div></header>
<main id="view"></main>
<footer><div class="wrap">
  <p>Pixelwash is free and open source (MIT). Videos are processed on your device and never uploaded. Only remove watermarks from videos you own or have the rights to.</p>
  <p class="hint">Built with <a href="https://mediabunny.dev" target="_blank" rel="noopener">Mediabunny</a> (MPL-2.0), <a href="https://github.com/xinntao/Real-ESRGAN" target="_blank" rel="noopener">Real-ESRGAN</a> (BSD-3) and <a href="https://onnxruntime.ai" target="_blank" rel="noopener">ONNX Runtime</a> (MIT). <a href="${REPO}" target="_blank" rel="noopener">Source</a></p>
</div></footer>`;

// theme: follow the system, remember a manual choice
const root = document.documentElement;
try { const t = localStorage.getItem('pixelwash.theme'); if (t) root.dataset.theme = t; } catch { /* storage off */ }
document.getElementById('theme').onclick = () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('pixelwash.theme', root.dataset.theme); } catch { /* storage off */ }
};

const routes = { '/': renderHome, '/remove': renderRemove, '/upscale': renderUpscale };
function route() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const r = routes[path] || renderHome;
  const view = document.getElementById('view');
  view.innerHTML = ''; r(view);
  document.querySelectorAll('.nav a.link[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === path));
  document.title = path === '/remove' ? 'Remove a watermark · Pixelwash' : path === '/upscale' ? 'Upscale a video · Pixelwash' : 'Pixelwash';
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();

// offline support for the website (the Android app ships its files inside the APK)
if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// debugging hook (localStorage.pwDebug = '1'): exposes the video functions for testing on devices
try { if (localStorage.getItem('pwDebug') === '1') window.__pw = { ...videoLib, MB }; } catch { /* storage off */ }

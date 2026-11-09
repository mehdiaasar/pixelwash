# Pixelwash

Remove watermarks and upscale videos **on your own device**: in the browser or with the Android app. Nothing is uploaded, there's no account, and it's free and open source (MIT).

**Website:** https://mehdiaasar.github.io/pixelwash/ · **Android:** APK on the [latest release](https://github.com/mehdiaasar/pixelwash/releases/latest)

## The two tools

### 1. Watermark remover
1. Open a video. Pixelwash scans ~40 frames for static overlays and suggests boxes; you can also drag a box over the mark.
2. **Auto** measures the mark across ~60 frames. A semi-transparent watermark is modelled as `observed = (1 − a)·picture + a·W`: the background under the box is guessed from its surroundings (harmonic fill), the mark's colour `W` is found by a search over all three colour channels, and the transparency `a` is solved per pixel by least squares. The blend is then inverted, `picture = (observed − a·W)/(1 − a)`, which recovers the real pixels underneath instead of painting over them. A mark that turns out solid is filled from its surroundings (pull-push inpainting).
3. **Fill solid logo** skips the measuring and fills everything inside the box.
4. The result shows a before/after slider and a "leftover" score (how much of the mark's pattern is still measurable, in 8-bit levels).

Saved marks are remembered per video size in the browser (`localStorage`), so a recurring logo is found again next time.

### 2. Upscaler
- **Classical** (default, no AI): Lanczos-3 resize + contrast-adaptive sharpening, optional edge-preserving denoise. Presets for Shorts/Reels (1080×1920), vertical 4K, 1080p, 4K and 2×. A different aspect ratio is fitted inside with a blurred fill instead of black bars.
- **AI blend** (optional): Real-ESRGAN `realesr-animevideov3` (×4, 1.2 M parameters) runs in the browser with ONNX Runtime (WebGPU, or WASM as a fallback), tiled with overlap, and is mixed 50/50 (adjustable) with the classical result so 3D cartoon characters keep their shading instead of turning into flat 2D outlines. Colour is matched back to the classical frame every frame. On a same-size output it shrinks the source to half first and lets the AI rebuild it, which helps soft, already-upscaled videos.

Both tools keep the source frame rate, copy the audio untouched, and encode H.264 (MP4) at an upload-friendly bitrate (~9 Mbps for 1080×1920, ~37 Mbps for 4K). Browsers without an H.264 encoder fall back to VP9 (WebM).

## How it runs
| Part | Built with |
|---|---|
| Decode / encode / mux | [Mediabunny](https://mediabunny.dev) on WebCodecs |
| Image processing | WebGL2 shaders (Lanczos, CAS, unblend, pull-push inpaint, blend) |
| Watermark fitting | plain JavaScript on sampled frames |
| AI | ONNX Runtime Web + a Real-ESRGAN model converted from the official ncnn release (`tools/convert_realesrgan.py`, checked against the native binary: 48 dB PSNR) |
| Android | Capacitor 8: the same web app inside the APK, processing on the phone; results save straight to the gallery (Movies/Pixelwash) through a small native MediaStore plugin, with a separate Share button |

Needs a browser with WebCodecs and WebGL2: recent Chrome, Edge or Opera on desktop or Android, and the Android app (Android 10+ with an up-to-date System WebView). Safari and Firefox support varies.

**Speed (M1 Pro, 720×1280 → 1080×1920):** classical about 2× real time; AI blend about 2 s per frame on WebGPU. Phones are slower; try "Preview this frame" before an AI run.

## Develop
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```
Android (needs JDK 21 and the Android SDK):
```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug     # app/build/outputs/apk/debug/
```
Release signing reads `android/keystore.properties` (not committed) or the `PW_KEYSTORE*` environment variables. GitHub Actions deploys the website on every push to `main`. The Android workflow is manual and needs the signing secrets listed at the top of `.github/workflows/android.yml`; releases so far were signed locally.

Tested on a Samsung Galaxy S25 Ultra (Android 17, WebView 156): H.264 and HEVC input, both tools, 4K output, AI blend (about 2 s per frame at 540×960).

## Responsible use
Only remove watermarks from videos you own or have the rights to. Some platforms add visible marks to label AI-generated or edited content and may require that label to stay when you publish; Pixelwash does not ship templates for any company's marks.

## Licence
MIT. Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

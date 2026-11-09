// Video in/out with Mediabunny (WebCodecs): probe, grab frames, and re-encode with a per-frame process hook.
import {
  Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, WebMOutputFormat,
  CanvasSink, ALL_FORMATS, canEncodeVideo,
} from 'mediabunny';

export function supported() {
  return typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

export async function openVideo(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track found in this file.');
  if (!(await track.canDecode())) throw new Error('This browser cannot decode this video (' + (track.codec || 'unknown codec') + ').');
  const duration = await input.computeDuration();
  const stats = await track.computePacketStats(120);
  const audio = await input.getPrimaryAudioTrack();
  const w = track.displayWidth, h = track.displayHeight;
  const info = {
    name: file.name, size: file.size, width: w, height: h, duration,
    fps: stats.averagePacketRate || 30, codec: track.codec, audio: audio ? audio.codec : null,
  };
  const sink = new CanvasSink(track, { poolSize: 2 });
  return { input, track, info, sink, file };
}

// Frame at time t as a canvas (display size, rotation applied).
const DECODER_HELP = "This device's video decoder didn't respond. Try another video, update Android System WebView / Chrome, or use a computer.";
export function withTimeout(p, ms, msg = DECODER_HELP) {
  let id; return Promise.race([p, new Promise((_, rej) => { id = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(id));
}

export async function frameAt(v, t) {
  const first = await v.track.getFirstTimestamp();
  const r = await withTimeout(v.sink.getCanvas(Math.max(first, Math.min(t, v.info.duration - 0.02))), 20000);
  return r ? r.canvas : null;
}

// n frames spread over the clip (skipping the very start/end), passed one at a time to cb(canvas, i).
export async function sampleFrames(v, n, cb, size) {
  const first = await v.track.getFirstTimestamp();
  const d = v.info.duration;
  const ts = Array.from({ length: n }, (_, i) => first + d * (0.02 + 0.96 * (i + 0.5) / n));
  const sink = size ? new CanvasSink(v.track, { width: size[0], height: size[1], fit: 'fill', poolSize: 1 }) : v.sink;
  let i = 0;
  const it = sink.canvasesAtTimestamps(ts)[Symbol.asyncIterator]();
  for (;;) {
    const { value: r, done } = await withTimeout(it.next(), 20000);
    if (done) break;
    if (r) await cb(r.canvas, i);
    i++;
  }
}

// Pick an encoder the browser actually has (H.264 MP4 preferred; VP9 WebM as fallback).
export async function pickCodec(w, h, bitrate) {
  if (await canEncodeVideo('avc', { width: w, height: h, bitrate })) return { codec: 'avc', format: new Mp4OutputFormat({ fastStart: 'in-memory' }), ext: 'mp4', mime: 'video/mp4' };
  if (await canEncodeVideo('vp9', { width: w, height: h, bitrate })) return { codec: 'vp9', format: new WebMOutputFormat(), ext: 'webm', mime: 'video/webm' };
  throw new Error('This browser cannot encode ' + w + '×' + h + ' video. Try a smaller output size.');
}

// Upload-quality bitrate: ~0.15 bits per pixel per frame (≈9 Mbps for 1080×1920 @ 30, ≈37 Mbps for 4K).
export function bitrateFor(w, h, fps) { return Math.round(Math.min(80e6, Math.max(4e6, w * h * Math.min(fps, 60) * 0.15))); }

// Re-encode the whole video. process(sample) must return a canvas of outW×outH (or a VideoSample).
export async function convert(v, { outW, outH, process, onProgress, signal }) {
  const bitrate = bitrateFor(outW, outH, v.info.fps);
  const pick = await pickCodec(outW, outH, bitrate);
  const output = new Output({ format: pick.format, target: new BufferTarget() });
  const conv = await Conversion.init({
    input: v.input, output, tracks: 'primary', showWarnings: false,
    video: {
      codec: pick.codec, bitrate, forceTranscode: true, allowTransformationMetadata: false,
      keyFrameInterval: 2, processedWidth: outW, processedHeight: outH, process,
    },
    // audio is copied untouched when the container allows it; otherwise re-encoded once
    audio: pick.codec === 'avc' ? {} : { codec: 'opus', bitrate: 192e3 },
  });
  if (!conv.isValid) throw new Error('Cannot convert this file: ' + conv.discardedTracks.map(t => t.reason).join(', '));
  // watchdog: a decoder/encoder that stops producing frames would otherwise hang forever
  let last = performance.now(), stalled = false;
  conv.onProgress = p => { last = performance.now(); onProgress && onProgress(p); };
  const dog = setInterval(() => { if (performance.now() - last > 60000) { stalled = true; conv.cancel(); } }, 5000);
  if (signal) signal.addEventListener('abort', () => conv.cancel(), { once: true });
  try { await conv.execute(); }
  catch (e) { throw stalled ? new Error('Processing stopped responding. ' + DECODER_HELP) : e; }
  finally { clearInterval(dog); }
  if (stalled) throw new Error('Processing stopped responding. ' + DECODER_HELP);
  const blob = new Blob([output.target.buffer], { type: pick.mime });
  return { blob, ext: pick.ext, codec: pick.codec, bitrate };
}

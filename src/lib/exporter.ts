import {
  ALL_FORMATS,
  canEncodeAudio,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import type { Clip, Project } from '../types';
import { collectLayers } from './anim';
import { ensureDenoised, renderMix } from './audio';
import { Compositor } from './compositor';
import { runtime } from './runtime';
import { buildDrawItems } from './scene';
import { ensureSegmenter, segmentFrame } from './segmenter';
import { projectDuration } from './store';
import { ensureFont } from './textRender';
import { once } from './util';

export interface ExportOptions {
  /** length of the short side in pixels */
  resolution: number;
  fps: number;
  quality: 'good' | 'high' | 'max';
  format: 'mp4' | 'webm';
  onProgress?: (p: { stage: string; progress: number; frame: number; frames: number }) => void;
  onCanvas?: (c: HTMLCanvasElement) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  ext: string;
  mime: string;
  width: number;
  height: number;
  duration: number;
  videoCodec: string;
  audioCodec: string | null;
  seconds: number;
  notes: string[];
}

const BPP = { good: 0.09, high: 0.17, max: 0.3 };

export function exportDims(project: Project, resolution: number): { width: number; height: number } {
  const k = resolution / Math.min(project.width, project.height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(project.width * k), height: even(project.height * k) };
}

export function estimateBitrate(width: number, height: number, fps: number, quality: ExportOptions['quality']): number {
  return Math.round(Math.min(80e6, Math.max(1.2e6, width * height * fps * BPP[quality])));
}

interface FrameProvider {
  get(srcTime: number): Promise<TexImageSource | null>;
  dispose(): void;
}

const inputs = new Map<string, Input>();
let aacRegistered = false;

async function bunnyProvider(clip: Clip, startSrc: number): Promise<FrameProvider> {
  const rt = runtime.get(clip.assetId!);
  if (!rt) throw new Error('missing media');
  let input = inputs.get(clip.assetId!);
  if (!input) {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(rt.file) });
    inputs.set(clip.assetId!, input);
  }
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) throw new Error('cannot decode with WebCodecs');
  const first = await track.getFirstTimestamp();
  const sink = new CanvasSink(track, { poolSize: 3 });
  const it = sink.canvases(Math.max(first, first + startSrc - 0.001));
  let cur: WrappedCanvas | null = null;
  let next: WrappedCanvas | null = null;
  let done = false;
  const pull = async () => {
    if (done) return null;
    const r = await it.next();
    if (r.done) {
      done = true;
      return null;
    }
    return r.value;
  };
  next = await pull();
  return {
    async get(srcTime) {
      const target = srcTime + first + 1e-4;
      while (next && next.timestamp <= target) {
        cur = next;
        next = await pull();
      }
      return (cur ?? next)?.canvas ?? null;
    },
    dispose() {
      done = true;
      void it.return();
    },
  };
}

async function elementProvider(clip: Clip): Promise<FrameProvider> {
  const rt = runtime.get(clip.assetId!);
  if (!rt) throw new Error('missing media');
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.src = rt.url;
  await once(el, ['loadeddata', 'error'], 15000);
  return {
    async get(srcTime) {
      const t = Math.max(0, Math.min(srcTime, (el.duration || 1e9) - 0.01));
      if (Math.abs(el.currentTime - t) > 0.001) {
        el.currentTime = t;
        await once(el, ['seeked', 'error'], 5000);
      }
      return el.readyState >= 2 ? el : null;
    },
    dispose() {
      el.removeAttribute('src');
      el.load();
    },
  };
}

function sliceBuffer(buf: AudioBuffer, from: number, to: number): AudioBuffer {
  const out = new AudioBuffer({ length: to - from, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(from, to), c);
  return out;
}

export async function exportVideo(project: Project, opts: ExportOptions): Promise<ExportResult> {
  const t0 = performance.now();
  const notes: string[] = [];
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('Nothing to export — add a clip first.');
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser has no WebCodecs video encoder. Use a current Chrome, Edge, Safari or Firefox.');
  const { width, height } = exportDims(project, opts.resolution);
  const fps = opts.fps;
  const frames = Math.max(1, Math.round(duration * fps));
  const bitrate = estimateBitrate(width, height, fps, opts.quality);
  const report = (stage: string, frame: number) => opts.onProgress?.({ stage, progress: frame / frames, frame, frames });
  const aborted = () => opts.signal?.aborted;

  // ── pick container + codecs this device can actually encode
  let format: Mp4OutputFormat | WebMOutputFormat = opts.format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  const pref = (f: Mp4OutputFormat | WebMOutputFormat): VideoCodec[] => {
    const order: VideoCodec[] = f instanceof Mp4OutputFormat ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'av1', 'vp8'];
    const ok = f.getSupportedVideoCodecs();
    return order.filter((c) => ok.includes(c));
  };
  let vcodec = await getFirstEncodableVideoCodec(pref(format), { width, height, bitrate });
  if (!vcodec && opts.format === 'mp4') {
    format = new WebMOutputFormat();
    vcodec = await getFirstEncodableVideoCodec(pref(format), { width, height, bitrate });
    if (vcodec) notes.push('This browser cannot encode H.264 at this size, so the file was saved as WebM instead.');
  }
  if (!vcodec) throw new Error(`This device can't encode ${width}×${height} video. Try a lower resolution.`);

  report('Preparing audio', 0);
  // ── audio: render the whole mix offline through the same graph the preview uses
  const audible = project.clips.some((c) => (c.type === 'video' || c.type === 'audio') && !c.muted && c.volume > 0 && c.assetId && runtime.get(c.assetId)?.audio);
  let mix: AudioBuffer | null = null;
  let acodec: Awaited<ReturnType<typeof getFirstEncodableAudioCodec>> = null;
  if (audible) {
    for (const c of project.clips) if (c.denoise && c.assetId) await ensureDenoised(c.assetId).catch(() => undefined);
    mix = await renderMix(project, duration, 48000, 2);
    const bitrateA = opts.quality === 'good' ? 128e3 : 192e3;
    if (format instanceof Mp4OutputFormat && !aacRegistered && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: bitrateA }).catch(() => false))) {
      // No native AAC encoder (Firefox, Linux, older Safari): fall back to a bundled WASM AAC-LC encoder so MP4s stay universally playable.
      try {
        const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
        registerAacEncoder();
        aacRegistered = true;
      } catch (e) {
        console.warn('AAC fallback encoder unavailable', e);
      }
    }
    const okA = format.getSupportedAudioCodecs();
    const orderA = (format instanceof Mp4OutputFormat ? (['aac', 'opus', 'mp3', 'flac', 'pcm-s16'] as const) : (['opus', 'vorbis'] as const)).filter((c) => okA.includes(c));
    acodec = await getFirstEncodableAudioCodec([...orderA], { numberOfChannels: 2, sampleRate: 48000, bitrate: bitrateA });
    if (!acodec) {
      notes.push('No audio encoder is available in this browser, so the export is silent.');
      mix = null;
    } else if (format instanceof Mp4OutputFormat && acodec !== 'aac') notes.push(`Audio was encoded as ${acodec.toUpperCase()} because AAC is unavailable here; some players (QuickTime, iOS) may not play it. WebM is a safer choice on this browser.`);
  }
  if (aborted()) throw new DOMException('Export cancelled', 'AbortError');

  // ── fonts + background-removal model must be ready before the first frame
  await Promise.all(project.clips.filter((c) => c.type === 'text').map((c) => ensureFont(c.style, c.text)));
  if (project.clips.some((c) => c.removeBg)) await ensureSegmenter();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const comp = new Compositor(canvas);
  opts.onCanvas?.(canvas);

  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: vcodec, bitrate, keyFrameInterval: 2, latencyMode: 'quality' });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource: AudioBufferSource | null = null;
  if (mix && acodec) {
    audioSource = new AudioBufferSource({ codec: acodec, bitrate: opts.quality === 'good' ? 128e3 : 192e3 });
    output.addAudioTrack(audioSource);
  }

  const providers = new Map<string, FrameProvider>();
  const frameCache = new Map<string, TexImageSource | null>();
  const lastEnd = new Map<string, number>();
  for (const c of project.clips) lastEnd.set(c.id, c.start + c.duration + 3);
  let cancelled = false;

  try {
    await output.start();
    const chunk = Math.max(1, Math.round(fps / 2));
    let audioPos = 0;
    for (let f = 0; f < frames; f++) {
      if (aborted()) {
        cancelled = true;
        break;
      }
      // interleave ~0.5 s of audio ahead of the video it belongs to
      if (audioSource && mix && f % chunk === 0) {
        const to = Math.min(mix.length, Math.round(((f + chunk) / fps) * mix.sampleRate));
        if (to > audioPos) {
          await audioSource.add(sliceBuffer(mix, audioPos, to));
          audioPos = to;
        }
      }
      const t = f / fps;
      const layers = collectLayers(project, t);
      frameCache.clear();
      for (const l of layers) {
        if (l.clip.type !== 'video') continue;
        let p = providers.get(l.clip.id);
        if (!p) {
          try {
            p = await bunnyProvider(l.clip, Math.max(0, l.srcTime));
          } catch {
            p = await elementProvider(l.clip);
          }
          providers.set(l.clip.id, p);
        }
        const asset = project.assets.find((a) => a.id === l.clip.assetId);
        const srcT = Math.max(0, Math.min(l.srcTime, (asset?.duration ?? 1e9) - 0.5 / fps));
        frameCache.set(l.clip.id, await p.get(srcT));
      }
      const items = buildDrawItems(project, layers, {
        video: (c) => frameCache.get(c.id) ?? null,
        stamp: (_c, l) => l.srcTime,
        segment: segmentFrame,
        pixelScale: width / project.width,
      });
      comp.render(items, project.width, project.height, project.background, t);
      await videoSource.add(t, 1 / fps);
      if (f % 30 === 0) {
        for (const [id, p] of providers) {
          if (t > (lastEnd.get(id) ?? 0)) {
            p.dispose();
            providers.delete(id);
          }
        }
      }
      report('Rendering', f + 1);
    }
    if (cancelled) {
      await output.cancel();
      throw new DOMException('Export cancelled', 'AbortError');
    }
    if (audioSource && mix && audioPos < mix.length) await audioSource.add(sliceBuffer(mix, audioPos, mix.length));
    report('Finishing file', frames);
    await output.finalize();
  } catch (e) {
    if (output.state === 'started') await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    for (const p of providers.values()) p.dispose();
    for (const i of inputs.values()) i.dispose();
    inputs.clear();
    comp.dispose();
  }

  const buffer = (output.target as BufferTarget).buffer!;
  const mime = (await output.getMimeType().catch(() => format.mimeType)) || format.mimeType;
  return {
    blob: new Blob([buffer], { type: mime.split(';')[0] }),
    ext: format.fileExtension.replace(/^\./, ''),
    mime,
    width,
    height,
    duration,
    videoCodec: vcodec,
    audioCodec: acodec,
    seconds: (performance.now() - t0) / 1000,
    notes,
  };
}

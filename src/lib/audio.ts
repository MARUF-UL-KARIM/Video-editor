import type { Clip, Project } from '../types';
import { PEAKS_PER_SEC, runtime } from './runtime';

let ctx: AudioContext | null = null;
export function getAudioCtx(): AudioContext {
  if (!ctx) {
    const AC: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const ab = await blob.arrayBuffer();
    const off = new OfflineAudioContext(2, 1, 48000);
    return await off.decodeAudioData(ab);
  } catch {
    return null;
  }
}

export function computePeaks(buf: AudioBuffer): Float32Array {
  const win = Math.max(1, Math.floor(buf.sampleRate / PEAKS_PER_SEC));
  const n = Math.ceil(buf.length / win);
  const out = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(d.length, (i + 1) * win);
      for (let j = i * win; j < end; j += 3) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > m) m = v;
      }
      if (m > out[i]) out[i] = m;
    }
  }
  return out;
}

/** Gain that brings speech-level audio to roughly -17 dBFS RMS without clipping. */
export function measureNormGain(buf: AudioBuffer): number {
  const d = buf.getChannelData(0);
  const win = Math.floor(buf.sampleRate * 0.05);
  let sum = 0;
  let count = 0;
  let peak = 0;
  for (let i = 0; i + win <= d.length; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j += 2) {
      const v = d[j];
      e += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(e / (win / 2));
    if (rms > 0.006) {
      sum += rms * rms;
      count++;
    }
  }
  if (!count || peak <= 0) return 1;
  const rms = Math.sqrt(sum / count);
  const g = 0.14 / rms;
  return Math.max(0.25, Math.min(g, 0.97 / peak, 8));
}

function enhanceChain(ctx: BaseAudioContext, input: AudioNode): AudioNode {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 85;
  hp.Q.value = 0.7;
  const mud = ctx.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 260;
  mud.Q.value = 1;
  mud.gain.value = -2.5;
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3600;
  presence.Q.value = 0.9;
  presence.gain.value = 3.5;
  const air = ctx.createBiquadFilter();
  air.type = 'highshelf';
  air.frequency.value = 9500;
  air.gain.value = 2.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 14;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.35;
  input.connect(hp).connect(mud).connect(presence).connect(air).connect(comp).connect(makeup);
  return makeup;
}

/** Build the Web Audio graph for the timeline from `from` seconds. Used for live playback and offline export alike. */
export function scheduleAudio(ctx: BaseAudioContext, project: Project, dest: AudioNode, from: number, ctxStart: number, filter?: (c: Clip) => boolean): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = [];
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  for (const c of project.clips) {
    if (c.type !== 'video' && c.type !== 'audio') continue;
    if (c.muted || c.volume <= 0 || muted.has(c.trackId)) continue;
    if (filter && !filter(c)) continue;
    if (c.start + c.duration <= from + 1e-3) continue;
    const rt = c.assetId ? runtime.get(c.assetId) : undefined;
    const buffer = c.denoise && rt?.denoised ? rt.denoised : rt?.audio;
    if (!buffer) continue;
    const off = Math.max(0, from - c.start);
    const srcOffset = c.inPoint + off * c.speed;
    if (srcOffset >= buffer.duration - 0.005) continue;
    const when = ctxStart + Math.max(0, c.start - from);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = c.speed;
    let node: AudioNode = src;
    if (c.enhance) node = enhanceChain(ctx, node);
    const g = ctx.createGain();
    const base = c.volume * (c.normalize ? (rt?.normGain ?? 1) : 1);
    const gainAt = (lt: number) => {
      let v = base;
      if (c.fadeIn > 0 && lt < c.fadeIn) v *= Math.max(0, lt / c.fadeIn);
      if (c.fadeOut > 0 && lt > c.duration - c.fadeOut) v *= Math.max(0, (c.duration - lt) / c.fadeOut);
      return v;
    };
    g.gain.setValueAtTime(gainAt(off), when);
    const pts = [...new Set([c.fadeIn, c.duration - c.fadeOut, c.duration])].filter((p) => p > off + 1e-3).sort((a, b) => a - b);
    for (const p of pts) g.gain.linearRampToValueAtTime(gainAt(p), when + (p - off));
    node.connect(g);
    g.connect(dest);
    src.start(when, srcOffset, Math.max(0.01, (c.duration - off) * c.speed));
    nodes.push(src);
  }
  return nodes;
}

export async function renderMix(project: Project, duration: number, sampleRate: number, channels: number, filter?: (c: Clip) => boolean): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(channels, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  scheduleAudio(off, project, off.destination, 0, 0, filter);
  return off.startRendering();
}

let denoiseWorker: Worker | null = null;
let denoiseSeq = 0;

export function ensureDenoised(assetId: string, onDone?: () => void): Promise<void> {
  const rt = runtime.get(assetId);
  if (!rt || !rt.audio) return Promise.resolve();
  if (rt.denoised) return Promise.resolve();
  if (rt.denoising) return rt.denoising;
  const src = rt.audio;
  rt.denoising = new Promise<void>((resolve, reject) => {
    if (!denoiseWorker) denoiseWorker = new Worker(new URL('../workers/denoise.worker.ts', import.meta.url), { type: 'module' });
    const id = ++denoiseSeq;
    const channels: Float32Array[] = [];
    for (let i = 0; i < src.numberOfChannels; i++) channels.push(src.getChannelData(i).slice());
    const handler = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      denoiseWorker!.removeEventListener('message', handler);
      if (e.data.error) {
        rt.denoising = undefined;
        reject(new Error(e.data.error));
        return;
      }
      const out = new AudioBuffer({ length: src.length, numberOfChannels: src.numberOfChannels, sampleRate: src.sampleRate });
      (e.data.channels as Float32Array[]).forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      rt.denoised = out;
      rt.denoising = undefined;
      onDone?.();
      resolve();
    };
    denoiseWorker.addEventListener('message', handler);
    denoiseWorker.postMessage({ id, channels, sampleRate: src.sampleRate }, channels.map((c) => c.buffer));
  });
  return rt.denoising;
}

/** Returns the ranges (source seconds) worth keeping between `from` and `to`. */
export function detectSpeechRanges(buf: AudioBuffer, from: number, to: number, minSilence = 0.45, pad = 0.09, sensitivity = 0.07): { s: number; e: number }[] {
  const sr = buf.sampleRate;
  const win = Math.floor(sr * 0.01);
  const i0 = Math.max(0, Math.floor(from * sr));
  const i1 = Math.min(buf.length, Math.floor(to * sr));
  const n = Math.floor((i1 - i0) / win);
  if (n < 4) return [{ s: from, e: to }];
  const rms = new Float32Array(n);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < n; k++) {
      let e = 0;
      const a = i0 + k * win;
      for (let j = a; j < a + win; j++) e += d[j] * d[j];
      rms[k] = Math.max(rms[k], Math.sqrt(e / win));
    }
  }
  const sorted = Float32Array.from(rms).sort();
  const loud = sorted[Math.floor(n * 0.95)];
  if (loud < 1e-4) return [];
  const thr = Math.max(loud * sensitivity, 0.0025);
  const ranges: { s: number; e: number }[] = [];
  let runStart = -1;
  let lastLoud = -1;
  const minWin = minSilence / 0.01;
  for (let k = 0; k < n; k++) {
    if (rms[k] >= thr) {
      if (runStart < 0) runStart = k;
      else if (k - lastLoud > minWin) {
        ranges.push({ s: runStart, e: lastLoud + 1 });
        runStart = k;
      }
      lastLoud = k;
    }
  }
  if (runStart >= 0) ranges.push({ s: runStart, e: lastLoud + 1 });
  return ranges
    .map((r) => ({ s: Math.max(from, from + r.s * 0.01 - pad), e: Math.min(to, from + r.e * 0.01 + pad) }))
    .filter((r) => r.e - r.s > 0.08);
}

export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const n = channels[0].length;
  const nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * nc * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

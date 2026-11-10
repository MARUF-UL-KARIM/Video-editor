// Scripting surface. Everything the UI can do is reachable from `window.offcut`, from the in-app console,
// or from another window via postMessage — so Offcut can be driven by other tools.
import type { AnimProp, Clip, Ease, Project, TextStyle, TransitionType } from '../types';
import { autoCaption, captionBase, textToSpeech, toSrt, type AutoCaptionOptions, type Caption } from './captions';
import { DEFAULT_STYLE } from './defaults';
import { engine } from './engine';
import { exportVideo, type ExportOptions } from './exporter';
import { importFile } from './media';
import { getState, projectDuration, useStore } from './store';
import { downloadBlob } from './util';

export const REMOTE_KEY = 'offcut.remote';

type TextArgs = Partial<Omit<Clip, 'style'>> & { style?: Partial<TextStyle> };

const api = {
  version: '1.0.0',

  /** Current project as plain JSON (safe to store / diff / send to another tool). */
  getProject: (): Project => JSON.parse(JSON.stringify(getState().project)),
  /** Replace the project. Media is relinked by asset id if it is still on this device. */
  loadProject: (p: Project) => getState().loadProject(p),
  getState: () => {
    const s = getState();
    return { time: s.time, playing: s.playing, selection: [...s.selection], duration: projectDuration(s.project), zoom: s.zoom };
  },

  /** Import File/Blob objects. Returns asset descriptors. */
  importFiles: async (files: (File | Blob)[], names?: string[]) => {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      const a = await importFile(files[i], names?.[i]);
      if (a) out.push(a);
    }
    return out;
  },
  /** Fetch a URL (only when your script asks for it) and import the result. */
  importUrl: async (url: string, name?: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const blob = await res.blob();
    return importFile(blob, name ?? decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'clip'));
  },

  addClip: (assetId: string, opts?: { at?: number; trackId?: string; patch?: Partial<Clip> }) => getState().addClipFromAsset(assetId, opts),
  addText: (args: TextArgs = {}) => {
    const { style, ...rest } = args;
    return getState().addTextClip({ ...rest, style: { ...DEFAULT_STYLE, ...(style ?? {}) } });
  },
  addCaptions: (caps: Caption[], styleId = 'pop', replace = false) => getState().addCaptions(caps, captionBase(styleId), replace),
  update: (id: string, patch: Partial<Clip>) => getState().updateClip(id, patch),
  remove: (ids: string | string[], ripple = false) => getState().removeClips(Array.isArray(ids) ? ids : [ids], ripple),
  select: (ids: string[]) => getState().select(ids),
  /** Split every unlocked clip under `time` (defaults to the playhead). */
  split: (time?: number) => {
    if (time !== undefined) getState().setTime(time);
    getState().select([]);
    getState().splitAtPlayhead();
    return getState().selection;
  },
  setSpeed: (id: string, speed: number) => getState().setSpeed(id, speed),
  /** Keyframe a property. `t` is seconds from the start of the clip. */
  setKeyframe: (id: string, prop: AnimProp, t: number, v: number, ease: Ease = 'easeInOut') =>
    getState().commit((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === id ? { ...c, keyframes: { ...c.keyframes, [prop]: [...(c.keyframes[prop] ?? []).filter((k) => Math.abs(k.t - t) > 1e-3), { t, v, ease }].sort((a, b) => a.t - b.t) } } : c)),
    })),
  setTransition: (id: string, type: TransitionType | null, duration = 0.5) => getState().updateClip(id, { transitionIn: type ? { type, duration } : null }),
  addTrack: (kind: 'video' | 'text' | 'audio') => getState().addTrack(kind),
  setCanvas: (width: number, height: number) => getState().setCanvas(width, height),

  seek: (t: number) => engine.seek(t),
  play: () => engine.play(),
  pause: () => engine.pause(),
  undo: () => getState().undo(),
  redo: () => getState().redo(),

  autoCaption: (o: Partial<AutoCaptionOptions> = {}) => autoCaption({ model: 'base', language: 'auto', scope: 'timeline', maxWords: 4, style: 'pop', replace: true, ...o }),
  tts: (text: string, o: { voice?: string; speed?: number; captions?: string | null } = {}) => textToSpeech(text, o.voice ?? 'af_heart', o.speed ?? 1, o.captions ?? null),
  srt: () => toSrt(),

  /** Render the timeline. Resolves with the finished file as a Blob. */
  export: async (o: Partial<ExportOptions> & { download?: boolean } = {}) => {
    const p = getState().project;
    engine.pause();
    engine.suspended = true;
    try {
      const res = await exportVideo(p, { resolution: 1080, fps: p.fps, quality: 'high', format: 'mp4', ...o });
      if (o.download) downloadBlob(res.blob, `${p.name || 'offcut'}.${res.ext}`);
      return res;
    } finally {
      engine.suspended = false;
      engine.invalidate();
    }
  },

  /** Subscribe to changes. Returns an unsubscribe function. */
  on: (event: 'change' | 'time' | 'selection', cb: (v: unknown) => void) =>
    useStore.subscribe((s, prev) => {
      if (event === 'change' && s.project !== prev.project) cb(s.project);
      if (event === 'time' && s.time !== prev.time) cb(s.time);
      if (event === 'selection' && s.selection !== prev.selection) cb(s.selection);
    }),

  /** Run a batch of JSON commands: [{ cmd: 'addText', args: [{ text: 'Hi' }] }, …] */
  run: async (commands: { cmd: string; args?: unknown[] }[]) => {
    const out: unknown[] = [];
    for (const c of commands) {
      const fn = (api as unknown as Record<string, unknown>)[c.cmd];
      if (typeof fn !== 'function') throw new Error(`Unknown command: ${c.cmd}`);
      out.push(await (fn as (...a: unknown[]) => unknown)(...(c.args ?? [])));
    }
    return out;
  },
};

export type OffcutApi = typeof api;

declare global {
  interface Window {
    offcut: OffcutApi;
  }
}

export const API_DOCS: { sig: string; doc: string }[] = [
  { sig: 'offcut.getProject() → Project', doc: 'Whole timeline as JSON: tracks, clips, assets.' },
  { sig: 'offcut.loadProject(json)', doc: 'Replace the timeline with a JSON project.' },
  { sig: 'offcut.importFiles(files) → Asset[]', doc: 'Import File/Blob objects.' },
  { sig: 'offcut.importUrl(url) → Asset', doc: 'Fetch a URL and import it (only when you call it).' },
  { sig: 'offcut.addClip(assetId, { at, trackId, patch })', doc: 'Place an asset on the timeline. Returns the clip id.' },
  { sig: 'offcut.addText({ text, start, duration, x, y, style })', doc: 'Add a text layer. x / y are fractions of the canvas, 0 = centre.' },
  { sig: 'offcut.addCaptions([{ start, end, text }], styleId)', doc: 'Add caption clips in bulk.' },
  { sig: 'offcut.update(clipId, patch)', doc: 'Patch any clip field: volume, filters, speed, removeBg…' },
  { sig: 'offcut.split(time?) / offcut.remove(ids, ripple?)', doc: 'Cut at a time; delete clips (optionally closing the gap).' },
  { sig: 'offcut.setKeyframe(clipId, prop, t, value, ease?)', doc: 'prop: x, y, scale, rotation, opacity. t is clip-relative seconds.' },
  { sig: 'offcut.setTransition(clipId, type, duration)', doc: 'crossfade, dipBlack, slideLeft, wipeRight, zoomIn, blur, spin…' },
  { sig: 'offcut.autoCaption({ model, language, maxWords })', doc: 'Run on-device Whisper and add captions.' },
  { sig: 'offcut.tts(text, { voice, speed, captions })', doc: 'Generate speech locally and place it at the playhead.' },
  { sig: 'offcut.export({ resolution, fps, quality, format, download })', doc: 'Render. Resolves to { blob, width, height, … }.' },
  { sig: 'offcut.seek(t) · play() · pause() · undo() · redo()', doc: 'Transport and history.' },
  { sig: 'offcut.on("change" | "time" | "selection", cb)', doc: 'Subscribe; returns an unsubscribe function.' },
  { sig: 'offcut.run([{ cmd, args }])', doc: 'Run a JSON batch — handy for tools that can only send data.' },
];

export function installApi() {
  window.offcut = api;
  // Cross-window bridge:  target.postMessage({ offcut: { id, method, args } }, origin)
  //                    →  reply { offcut: { id, result } } or { offcut: { id, error } }
  window.addEventListener('message', async (e: MessageEvent) => {
    const m = e.data?.offcut;
    if (!m || typeof m.method !== 'string' || !e.source) return;
    const reply = (body: Record<string, unknown>) => (e.source as WindowProxy).postMessage({ offcut: { id: m.id, ...body } }, { targetOrigin: e.origin === 'null' ? '*' : e.origin });
    if (e.origin !== location.origin && localStorage.getItem(REMOTE_KEY) !== '1') {
      reply({ error: 'Remote control is disabled. Enable it in Offcut → Script → “Allow control from other windows”.' });
      return;
    }
    try {
      const fn = (api as unknown as Record<string, unknown>)[m.method];
      if (typeof fn !== 'function') throw new Error(`Unknown method: ${m.method}`);
      const result = await (fn as (...a: unknown[]) => unknown)(...(Array.isArray(m.args) ? m.args : []));
      reply({ result: typeof result === 'function' ? undefined : result });
    } catch (err) {
      reply({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

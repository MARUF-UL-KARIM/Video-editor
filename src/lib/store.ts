import { create } from 'zustand';
import type { AnimProp, Asset, Clip, Ease, Keyframe, PanelId, Project, Track, TrackKind, Word } from '../types';
import { DEFAULT_FILTERS, DEFAULT_STYLE } from './defaults';
import { clamp, EASE, EPS, lerp, uid } from './util';

export const MIN_CLIP = 0.05;

// ───────────────────────────── pure helpers ─────────────────────────────

export function makeClip(p: Partial<Clip> & Pick<Clip, 'type' | 'trackId'>): Clip {
  return {
    id: uid('c_'),
    name: '',
    start: 0,
    duration: 3,
    inPoint: 0,
    speed: 1,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
    fit: 'contain',
    flipH: false,
    radius: 0,
    blend: 'normal',
    look: 'none',
    removeBg: false,
    transitionIn: null,
    animIn: 'none',
    animOut: 'none',
    animDur: 0.35,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    denoise: false,
    enhance: false,
    normalize: false,
    text: '',
    ...p,
    filters: { ...DEFAULT_FILTERS, ...(p.filters ?? {}) },
    chroma: { enabled: false, color: '#00d639', similarity: 0.22, smoothness: 0.1, ...(p.chroma ?? {}) },
    keyframes: p.keyframes ?? {},
    style: { ...DEFAULT_STYLE, ...(p.style ?? {}) },
  };
}

export function emptyProject(): Project {
  return {
    version: 1,
    id: uid('p_'),
    name: 'Untitled project',
    width: 1080,
    height: 1920,
    fps: 30,
    background: '#000000',
    tracks: [
      { id: uid('t_'), kind: 'text', name: 'Text 1', muted: false, hidden: false, locked: false },
      { id: uid('t_'), kind: 'video', name: 'Main', muted: false, hidden: false, locked: false },
      { id: uid('t_'), kind: 'audio', name: 'Audio 1', muted: false, hidden: false, locked: false },
    ],
    clips: [],
    assets: [],
  };
}

const durCache = new WeakMap<Clip[], number>();
export function projectDuration(p: Project): number {
  let d = durCache.get(p.clips);
  if (d === undefined) {
    d = 0;
    for (const c of p.clips) d = Math.max(d, c.start + c.duration);
    durCache.set(p.clips, d);
  }
  return d;
}

export const trackKindFor = (type: Clip['type']): TrackKind => (type === 'audio' ? 'audio' : type === 'text' ? 'text' : 'video');
export const clipEnd = (c: Clip) => c.start + c.duration;
export const isMedia = (c: Clip) => c.type === 'video' || c.type === 'audio';

export function evalKeyframes(kfs: Keyframe[] | undefined, t: number, fallback: number): number {
  if (!kfs || kfs.length === 0) return fallback;
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      return lerp(a.v, b.v, EASE[a.ease]((t - a.t) / span));
    }
  }
  return last.v;
}

export const clipValue = (c: Clip, prop: AnimProp, localT: number) => evalKeyframes(c.keyframes[prop], localT, c[prop]);

function shiftKeyframes(kf: Clip['keyframes'], d: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const k of Object.keys(kf) as AnimProp[]) out[k] = kf[k]!.map((f) => ({ ...f, t: f.t + d }));
  return out;
}
function scaleKeyframes(kf: Clip['keyframes'], f: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {};
  for (const k of Object.keys(kf) as AnimProp[]) out[k] = kf[k]!.map((x) => ({ ...x, t: x.t * f }));
  return out;
}
const shiftWords = (w: Word[] | undefined, d: number) => w?.map((x) => ({ ...x, start: x.start + d, end: x.end + d }));

function isFree(clips: Clip[], trackId: string, start: number, dur: number, ignore?: string) {
  return !clips.some((c) => c.trackId === trackId && c.id !== ignore && start < clipEnd(c) - EPS && start + dur > c.start + EPS);
}
const trackEnd = (clips: Clip[], trackId: string) => clips.reduce((m, c) => (c.trackId === trackId ? Math.max(m, clipEnd(c)) : m), 0);

/** Make `id` not overlap anything on its track: snap next to what it hits and push later clips right. */
function resolvePlacement(clips: Clip[], id: string): Clip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const others = clips.filter((c) => c.trackId === clip.trackId && c.id !== id).sort((a, b) => a.start - b.start);
  let start = Math.max(0, clip.start);
  const hit = others.find((o) => start < clipEnd(o) - EPS && start + clip.duration > o.start + EPS);
  if (hit && start >= hit.start - EPS) start = start < hit.start + hit.duration / 2 ? hit.start : clipEnd(hit);
  const shifts = new Map<string, number>();
  let cursor = start + clip.duration;
  for (const o of others) {
    if (o.start < start - EPS) continue;
    if (o.start < cursor - EPS) {
      shifts.set(o.id, cursor);
      cursor += o.duration;
    } else break;
  }
  return clips.map((c) => (c.id === id ? { ...c, start } : shifts.has(c.id) ? { ...c, start: shifts.get(c.id)! } : c));
}

function newTrack(p: Project, kind: TrackKind): [Project, Track] {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const label = kind === 'video' ? 'Overlay' : kind === 'text' ? 'Text' : 'Audio';
  const track: Track = { id: uid('t_'), kind, name: `${label} ${kind === 'video' ? n - 1 || 1 : n}`, muted: false, hidden: false, locked: false };
  const tracks = [...p.tracks];
  if (kind === 'text') tracks.unshift(track);
  else if (kind === 'audio') tracks.push(track);
  else {
    const i = tracks.findIndex((t) => t.kind === 'video');
    const firstAudio = tracks.findIndex((t) => t.kind === 'audio');
    tracks.splice(i >= 0 ? i : firstAudio >= 0 ? firstAudio : tracks.length, 0, track);
  }
  return [{ ...p, tracks }, track];
}

function splitClip(c: Clip, t: number): [Clip, Clip] | null {
  const local = t - c.start;
  if (local < MIN_CLIP || c.duration - local < MIN_CLIP) return null;
  const lk: Clip['keyframes'] = {};
  const rk: Clip['keyframes'] = {};
  for (const prop of Object.keys(c.keyframes) as AnimProp[]) {
    const kfs = c.keyframes[prop]!;
    if (!kfs.length) continue;
    const v = evalKeyframes(kfs, local, c[prop]);
    lk[prop] = [...kfs.filter((k) => k.t < local - EPS), { t: local, v, ease: 'linear' }];
    rk[prop] = [{ t: 0, v, ease: kfs.filter((k) => k.t <= local).pop()?.ease ?? 'linear' }, ...kfs.filter((k) => k.t > local + EPS).map((k) => ({ ...k, t: k.t - local }))];
  }
  const left: Clip = { ...c, duration: local, fadeOut: 0, animOut: 'none', keyframes: lk };
  const right: Clip = {
    ...c,
    id: uid('c_'),
    start: t,
    duration: c.duration - local,
    inPoint: isMedia(c) ? c.inPoint + local * c.speed : 0,
    fadeIn: 0,
    animIn: 'none',
    transitionIn: null,
    keyframes: rk,
  };
  if (c.words?.length) {
    const lw = c.words.filter((w) => (w.start + w.end) / 2 < local);
    const rw = c.words.filter((w) => (w.start + w.end) / 2 >= local);
    if (lw.length && rw.length) {
      left.words = lw;
      left.text = lw.map((w) => w.text).join(' ');
      right.words = shiftWords(rw, -local);
      right.text = rw.map((w) => w.text).join(' ');
    } else right.words = shiftWords(c.words, -local);
  }
  return [left, right];
}

function fitCanvasToAsset(a: Asset): { width: number; height: number } | null {
  if (!a.width || !a.height) return null;
  const r = a.width / a.height;
  if (r > 2.1) return { width: 2520, height: 1080 };
  if (r > 1.5) return { width: 1920, height: 1080 };
  if (r > 1.15) return { width: 1440, height: 1080 };
  if (r > 0.9) return { width: 1080, height: 1080 };
  if (r > 0.68) return { width: 1080, height: 1350 };
  return { width: 1080, height: 1920 };
}

// ───────────────────────────── store ─────────────────────────────

export interface Toast {
  id: string;
  msg: string;
  kind: 'info' | 'error' | 'ok';
}
export interface Job {
  id: string;
  label: string;
  progress: number | null;
}
interface CommitOpts {
  history?: boolean;
  coalesce?: string;
}

export interface State {
  project: Project;
  past: Project[];
  future: Project[];
  lastCoalesce: { key: string; at: number } | null;
  time: number;
  playing: boolean;
  selection: string[];
  zoom: number;
  snapping: boolean;
  panel: PanelId;
  mediaTick: number;
  toasts: Toast[];
  jobs: Job[];
  exportOpen: boolean;
  clipboard: Clip[];
  loaded: boolean;
  savedAt: number;

  commit: (fn: (p: Project) => Project, opts?: CommitOpts) => void;
  beginGesture: () => void;
  endGesture: (ids: string[]) => void;
  undo: () => void;
  redo: () => void;

  setTime: (t: number) => void;
  select: (ids: string[], additive?: boolean) => void;
  setZoom: (z: number) => void;
  setPanel: (p: PanelId) => void;
  toast: (msg: string, kind?: Toast['kind']) => void;
  setJob: (id: string, label: string, progress?: number | null) => void;
  clearJob: (id: string) => void;

  addAsset: (a: Asset) => void;
  patchAsset: (id: string, patch: Partial<Asset>) => void;
  removeAsset: (id: string) => void;
  addClipFromAsset: (assetId: string, opts?: { at?: number; trackId?: string; patch?: Partial<Clip> }) => string | null;
  addTextClip: (p?: Partial<Clip>) => string;
  addCaptions: (caps: { start: number; end: number; text: string; words?: Word[] }[], base: Partial<Clip>, replace: boolean) => number;

  updateClip: (id: string, patch: Partial<Clip>, opts?: CommitOpts) => void;
  updateClips: (ids: string[], fn: (c: Clip) => Partial<Clip>, opts?: CommitOpts) => void;
  setAnimated: (id: string, prop: AnimProp, v: number, opts?: CommitOpts) => void;
  toggleKeyframe: (id: string, prop: AnimProp) => void;
  setKeyframeEase: (id: string, prop: AnimProp, ease: Ease) => void;
  clearKeyframes: (id: string) => void;
  setSpeed: (id: string, speed: number) => void;
  trimEdge: (orig: Clip, edge: 'l' | 'r', t: number) => void;

  splitAtPlayhead: () => void;
  removeClips: (ids: string[], ripple?: boolean) => void;
  duplicateSelected: () => void;
  copy: () => void;
  paste: () => void;
  trimToPlayhead: (side: 'start' | 'end') => void;
  replaceClipWith: (id: string, parts: Clip[]) => void;

  addTrack: (kind: TrackKind) => string;
  removeTrack: (id: string) => void;
  patchTrack: (id: string, patch: Partial<Track>) => void;
  setCanvas: (w: number, h: number) => void;
  patchProject: (patch: Partial<Pick<Project, 'name' | 'fps' | 'background'>>) => void;
  newProject: () => void;
  loadProject: (p: Project) => void;
}

const mapClips = (p: Project, ids: string[], fn: (c: Clip) => Clip): Project => {
  const set = new Set(ids);
  let changed = false;
  const clips = p.clips.map((c) => {
    if (!set.has(c.id)) return c;
    changed = true;
    return fn(c);
  });
  return changed ? { ...p, clips } : p;
};

export const useStore = create<State>((set, get) => ({
  project: emptyProject(),
  past: [],
  future: [],
  lastCoalesce: null,
  time: 0,
  playing: false,
  selection: [],
  zoom: 80,
  snapping: true,
  panel: 'media',
  mediaTick: 0,
  toasts: [],
  jobs: [],
  exportOpen: false,
  clipboard: [],
  loaded: false,
  savedAt: 0,

  commit: (fn, opts = {}) =>
    set((s) => {
      const next = fn(s.project);
      if (next === s.project) return s;
      if (opts.history === false) return { project: next };
      const now = Date.now();
      const co = opts.coalesce;
      if (co && s.lastCoalesce && s.lastCoalesce.key === co && now - s.lastCoalesce.at < 1500) return { project: next, lastCoalesce: { key: co, at: now } };
      return { project: next, past: [...s.past.slice(-119), s.project], future: [], lastCoalesce: co ? { key: co, at: now } : null };
    }),
  beginGesture: () => set((s) => ({ past: [...s.past.slice(-119), s.project], future: [], lastCoalesce: null })),
  endGesture: (ids) =>
    get().commit(
      (p) => {
        let clips = p.clips;
        const moved = clips.filter((c) => ids.includes(c.id)).sort((a, b) => a.start - b.start);
        for (const m of moved) clips = resolvePlacement(clips, m.id);
        return { ...p, clips };
      },
      { history: false },
    ),
  undo: () =>
    set((s) => {
      if (!s.past.length) return s;
      const project = s.past[s.past.length - 1];
      const ids = new Set(project.clips.map((c) => c.id));
      return { project, past: s.past.slice(0, -1), future: [s.project, ...s.future], selection: s.selection.filter((i) => ids.has(i)), lastCoalesce: null };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return s;
      const project = s.future[0];
      const ids = new Set(project.clips.map((c) => c.id));
      return { project, past: [...s.past, s.project], future: s.future.slice(1), selection: s.selection.filter((i) => ids.has(i)), lastCoalesce: null };
    }),

  setTime: (t) => set({ time: Math.max(0, t) }),
  select: (ids, additive) =>
    set((s) => {
      if (!additive) return { selection: ids };
      const cur = new Set(s.selection);
      for (const id of ids) (cur.has(id) ? cur.delete(id) : cur.add(id));
      return { selection: [...cur] };
    }),
  setZoom: (z) => set({ zoom: clamp(z, 4, 600) }),
  setPanel: (panel) => set({ panel }),
  toast: (msg, kind = 'info') => {
    const id = uid('n_');
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 7000 : 3800);
  },
  setJob: (id, label, progress = null) =>
    set((s) => ({ jobs: s.jobs.some((j) => j.id === id) ? s.jobs.map((j) => (j.id === id ? { id, label, progress } : j)) : [...s.jobs, { id, label, progress }] })),
  clearJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

  addAsset: (a) => get().commit((p) => ({ ...p, assets: [...p.assets, a] }), { history: false }),
  patchAsset: (id, patch) => get().commit((p) => ({ ...p, assets: p.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) }), { history: false }),
  removeAsset: (id) => {
    get().commit((p) => ({ ...p, assets: p.assets.filter((a) => a.id !== id), clips: p.clips.filter((c) => c.assetId !== id) }));
    set((s) => ({ selection: s.selection.filter((i) => s.project.clips.some((c) => c.id === i)) }));
  },

  addClipFromAsset: (assetId, opts = {}) => {
    const s = get();
    const asset = s.project.assets.find((a) => a.id === assetId);
    if (!asset) return null;
    const type = opts.patch?.type ?? asset.kind;
    const kind: TrackKind = type === 'audio' ? 'audio' : 'video';
    const duration = opts.patch?.duration ?? (asset.kind === 'image' ? 4 : Math.max(MIN_CLIP, asset.duration));
    let project = s.project;
    let start = opts.at;
    let track = opts.trackId ? project.tracks.find((t) => t.id === opts.trackId && t.kind === kind && !t.locked) : undefined;
    const ofKind = project.tracks.filter((t) => t.kind === kind && !t.locked);
    if (!track) {
      if (kind === 'video' && start === undefined) {
        track = ofKind[ofKind.length - 1];
        if (track) start = trackEnd(project.clips, track.id);
      } else {
        const at = start ?? s.time;
        start = at;
        track = [...ofKind].reverse().find((t) => isFree(project.clips, t.id, at, duration));
        if (kind === 'audio') track = ofKind.find((t) => isFree(project.clips, t.id, at, duration));
      }
      if (!track) {
        const [np, nt] = newTrack(project, kind);
        project = np;
        track = nt;
        start = start ?? 0;
      }
    } else if (start === undefined) start = trackEnd(project.clips, track.id);
    const firstVisual = kind === 'video' && !project.clips.some((c) => c.type === 'video' || c.type === 'image');
    const clip = makeClip({ type: asset.kind, assetId, name: asset.name, trackId: track.id, start: Math.max(0, start ?? 0), duration, ...(opts.patch ?? {}) });
    const base = project;
    s.commit((p) => {
      let np = p === s.project ? base : p;
      if (firstVisual) {
        const dims = fitCanvasToAsset(asset);
        if (dims) np = { ...np, ...dims };
      }
      return { ...np, clips: resolvePlacement([...np.clips, clip], clip.id) };
    });
    set({ selection: [clip.id] });
    return clip.id;
  },

  addTextClip: (p = {}) => {
    const s = get();
    let project = s.project;
    const duration = p.duration ?? 3;
    const start = p.start ?? s.time;
    let track = p.trackId ? project.tracks.find((t) => t.id === p.trackId) : project.tracks.filter((t) => t.kind === 'text' && !t.locked && !t.name.startsWith('Captions')).reverse().find((t) => isFree(project.clips, t.id, start, duration));
    if (!track) {
      const [np, nt] = newTrack(project, 'text');
      project = np;
      track = nt;
    }
    const clip = makeClip({ text: 'Your text', name: 'Text', ...p, type: 'text', trackId: track.id, start, duration });
    const base = project;
    s.commit((cur) => {
      const np = cur === s.project ? base : cur;
      return { ...np, clips: resolvePlacement([...np.clips, clip], clip.id) };
    });
    set({ selection: [clip.id] });
    return clip.id;
  },

  addCaptions: (caps, base, replace) => {
    const s = get();
    s.commit((p) => {
      let np = p;
      let track = np.tracks.find((t) => t.kind === 'text' && t.name.startsWith('Captions'));
      if (!track) {
        const [x, t] = newTrack(np, 'text');
        track = { ...t, name: 'Captions' };
        np = { ...x, tracks: x.tracks.map((k) => (k.id === t.id ? track! : k)) };
      }
      const tid = track.id;
      const lo = Math.min(...caps.map((c) => c.start));
      const hi = Math.max(...caps.map((c) => c.end));
      let clips = replace ? np.clips.filter((c) => !(c.trackId === tid && c.caption && clipEnd(c) > lo - EPS && c.start < hi + EPS)) : np.clips;
      const sorted = [...caps].sort((a, b) => a.start - b.start);
      const made: Clip[] = [];
      sorted.forEach((c, i) => {
        const next = sorted[i + 1];
        const end = Math.max(c.start + 0.12, next ? Math.min(c.end, next.start) : c.end);
        made.push(
          makeClip({
            ...base,
            type: 'text',
            trackId: tid,
            caption: true,
            name: 'Caption',
            text: c.text,
            start: c.start,
            duration: end - c.start,
            words: c.words?.map((w) => ({ text: w.text, start: w.start - c.start, end: w.end - c.start })),
          }),
        );
      });
      clips = [...clips.filter((c) => !(c.trackId === tid && made.some((m) => m.start < clipEnd(c) - EPS && clipEnd(m) > c.start + EPS))), ...made];
      return { ...np, clips };
    });
    return caps.length;
  },

  updateClip: (id, patch, opts) => get().commit((p) => mapClips(p, [id], (c) => ({ ...c, ...patch })), opts),
  updateClips: (ids, fn, opts) => get().commit((p) => mapClips(p, ids, (c) => ({ ...c, ...fn(c) })), opts),

  setAnimated: (id, prop, v, opts) => {
    const { time, project } = get();
    const fps = project.fps;
    get().commit(
      (p) =>
        mapClips(p, [id], (c) => {
          const kfs = c.keyframes[prop];
          if (!kfs || !kfs.length) return { ...c, [prop]: v };
          const lt = clamp(time - c.start, 0, c.duration);
          const tol = 0.5 / fps;
          const i = kfs.findIndex((k) => Math.abs(k.t - lt) <= tol);
          const next = i >= 0 ? kfs.map((k, j) => (j === i ? { ...k, v } : k)) : [...kfs, { t: lt, v, ease: 'easeInOut' as Ease }].sort((a, b) => a.t - b.t);
          return { ...c, keyframes: { ...c.keyframes, [prop]: next } };
        }),
      opts,
    );
  },
  toggleKeyframe: (id, prop) => {
    const { time, project } = get();
    get().commit((p) =>
      mapClips(p, [id], (c) => {
        const lt = clamp(time - c.start, 0, c.duration);
        const tol = 0.5 / project.fps;
        const kfs = c.keyframes[prop] ?? [];
        const i = kfs.findIndex((k) => Math.abs(k.t - lt) <= tol);
        if (i >= 0) {
          const next = kfs.filter((_, j) => j !== i);
          const keyframes = { ...c.keyframes };
          if (next.length) keyframes[prop] = next;
          else delete keyframes[prop];
          return { ...c, keyframes, [prop]: next.length ? c[prop] : kfs[i].v };
        }
        const v = evalKeyframes(kfs, lt, c[prop]);
        return { ...c, keyframes: { ...c.keyframes, [prop]: [...kfs, { t: lt, v, ease: 'easeInOut' as Ease }].sort((a, b) => a.t - b.t) } };
      }),
    );
  },
  setKeyframeEase: (id, prop, ease) => {
    const { time, project } = get();
    get().commit((p) =>
      mapClips(p, [id], (c) => {
        const lt = time - c.start;
        const kfs = c.keyframes[prop];
        if (!kfs) return c;
        return { ...c, keyframes: { ...c.keyframes, [prop]: kfs.map((k) => (Math.abs(k.t - lt) <= 0.5 / project.fps ? { ...k, ease } : k)) } };
      }),
    );
  },
  clearKeyframes: (id) =>
    get().commit((p) =>
      mapClips(p, [id], (c) => {
        const lt = get().time - c.start;
        const patch: Partial<Clip> = { keyframes: {} };
        for (const k of Object.keys(c.keyframes) as AnimProp[]) patch[k] = clipValue(c, k, lt);
        return { ...c, ...patch };
      }),
    ),

  setSpeed: (id, speed) =>
    get().commit(
      (p) => {
        const c = p.clips.find((x) => x.id === id);
        if (!c) return p;
        const f = c.speed / speed;
        const np = mapClips(p, [id], (x) => ({ ...x, speed, duration: Math.max(MIN_CLIP, x.duration * f), keyframes: scaleKeyframes(x.keyframes, f), words: x.words?.map((w) => ({ ...w, start: w.start * f, end: w.end * f })) }));
        return { ...np, clips: resolvePlacement(np.clips, id) };
      },
      { coalesce: 'speed:' + id },
    ),

  trimEdge: (orig, edge, t) =>
    get().commit(
      (p) => {
        const asset = orig.assetId ? p.assets.find((a) => a.id === orig.assetId) : undefined;
        const media = isMedia(orig);
        const others = p.clips.filter((c) => c.trackId === orig.trackId && c.id !== orig.id);
        if (edge === 'l') {
          const prevEnd = others.reduce((m, o) => (o.start < orig.start ? Math.max(m, clipEnd(o)) : m), 0);
          let minStart = prevEnd;
          if (media) minStart = Math.max(minStart, orig.start - orig.inPoint / orig.speed);
          const ns = clamp(t, minStart, clipEnd(orig) - MIN_CLIP);
          const d = ns - orig.start;
          return mapClips(p, [orig.id], (c) => ({
            ...c,
            start: ns,
            duration: orig.duration - d,
            inPoint: media ? Math.max(0, orig.inPoint + d * orig.speed) : 0,
            keyframes: shiftKeyframes(orig.keyframes, -d),
            words: shiftWords(orig.words, -d),
          }));
        }
        const nextStart = others.reduce((m, o) => (o.start >= clipEnd(orig) - EPS ? Math.min(m, o.start) : m), Infinity);
        let maxEnd = nextStart;
        if (media && asset) maxEnd = Math.min(maxEnd, orig.start + (asset.duration - orig.inPoint) / orig.speed);
        const ne = clamp(t, orig.start + MIN_CLIP, Math.max(orig.start + MIN_CLIP, maxEnd));
        return mapClips(p, [orig.id], (c) => ({ ...c, duration: ne - orig.start }));
      },
      { history: false },
    ),

  splitAtPlayhead: () => {
    const s = get();
    const t = s.time;
    const locked = new Set(s.project.tracks.filter((x) => x.locked).map((x) => x.id));
    const under = s.project.clips.filter((c) => !locked.has(c.trackId) && t > c.start + MIN_CLIP && t < clipEnd(c) - MIN_CLIP);
    const sel = under.filter((c) => s.selection.includes(c.id));
    const targets = sel.length ? sel : under;
    if (!targets.length) {
      s.toast('Move the playhead over a clip to split it');
      return;
    }
    const newSel: string[] = [];
    s.commit((p) => {
      const clips: Clip[] = [];
      for (const c of p.clips) {
        const parts = targets.some((x) => x.id === c.id) ? splitClip(c, t) : null;
        if (parts) {
          clips.push(parts[0], parts[1]);
          newSel.push(parts[1].id);
        } else clips.push(c);
      }
      return { ...p, clips };
    });
    set({ selection: newSel });
  },

  removeClips: (ids, ripple) => {
    if (!ids.length) return;
    const s = get();
    s.commit((p) => {
      const gone = p.clips.filter((c) => ids.includes(c.id));
      let clips = p.clips.filter((c) => !ids.includes(c.id));
      if (ripple) {
        clips = clips.map((c) => {
          const shift = gone.reduce((m, g) => (g.trackId === c.trackId && g.start < c.start ? m + g.duration : m), 0);
          return shift ? { ...c, start: Math.max(0, c.start - shift) } : c;
        });
      }
      return { ...p, clips };
    });
    set((st) => ({ selection: st.selection.filter((i) => !ids.includes(i)) }));
  },

  duplicateSelected: () => {
    const s = get();
    const src = s.project.clips.filter((c) => s.selection.includes(c.id));
    if (!src.length) return;
    const copies = src.map((c) => ({ ...c, id: uid('c_'), start: clipEnd(c), transitionIn: null }));
    s.commit((p) => {
      let clips = [...p.clips, ...copies];
      for (const c of copies) clips = resolvePlacement(clips, c.id);
      return { ...p, clips };
    });
    set({ selection: copies.map((c) => c.id) });
  },
  copy: () => {
    const s = get();
    const src = s.project.clips.filter((c) => s.selection.includes(c.id));
    if (src.length) {
      set({ clipboard: src });
      s.toast(`Copied ${src.length} clip${src.length > 1 ? 's' : ''}`);
    }
  },
  paste: () => {
    const s = get();
    if (!s.clipboard.length) return;
    const t0 = Math.min(...s.clipboard.map((c) => c.start));
    const copies = s.clipboard.map((c) => ({ ...c, id: uid('c_'), start: s.time + (c.start - t0), transitionIn: null }));
    s.commit((p) => {
      let np = p;
      const fixed: Clip[] = [];
      for (const c of copies) {
        const kind = trackKindFor(c.type);
        let track = np.tracks.find((t) => t.id === c.trackId && !t.locked);
        if (!track) track = np.tracks.find((t) => t.kind === kind && !t.locked);
        if (!track) {
          const [x, t] = newTrack(np, kind);
          np = x;
          track = t;
        }
        fixed.push({ ...c, trackId: track.id });
      }
      let clips = [...np.clips, ...fixed];
      for (const c of fixed) clips = resolvePlacement(clips, c.id);
      return { ...np, clips };
    });
    set({ selection: copies.map((c) => c.id) });
  },

  trimToPlayhead: (side) => {
    const s = get();
    const t = s.time;
    const under = s.project.clips.filter((c) => t > c.start + MIN_CLIP && t < clipEnd(c) - MIN_CLIP);
    const sel = under.filter((c) => s.selection.includes(c.id));
    const targets = (sel.length ? sel : under).map((c) => c.id);
    if (!targets.length) return;
    s.commit((p) =>
      mapClips(p, targets, (c) => {
        if (side === 'end') return { ...c, duration: t - c.start };
        const d = t - c.start;
        return { ...c, start: t, duration: c.duration - d, inPoint: isMedia(c) ? c.inPoint + d * c.speed : 0, keyframes: shiftKeyframes(c.keyframes, -d), words: shiftWords(c.words, -d) };
      }),
    );
  },

  replaceClipWith: (id, parts) => {
    get().commit((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i < 0) return p;
      const old = p.clips[i];
      const removed = old.duration - parts.reduce((m, c) => m + c.duration, 0);
      const clips = p.clips
        .filter((c) => c.id !== id)
        .map((c) => (c.trackId === old.trackId && c.start >= clipEnd(old) - EPS ? { ...c, start: Math.max(0, c.start - removed) } : c));
      return { ...p, clips: [...clips, ...parts] };
    });
    set({ selection: parts.length ? [parts[0].id] : [] });
  },

  addTrack: (kind) => {
    let id = '';
    get().commit((p) => {
      const [np, t] = newTrack(p, kind);
      id = t.id;
      return np;
    });
    return id;
  },
  removeTrack: (id) => {
    const s = get();
    const track = s.project.tracks.find((t) => t.id === id);
    if (!track) return;
    if (s.project.tracks.filter((t) => t.kind === track.kind).length <= 1) {
      s.toast(`Keep at least one ${track.kind} track`);
      return;
    }
    s.commit((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id), clips: p.clips.filter((c) => c.trackId !== id) }));
    set((st) => ({ selection: st.selection.filter((i) => st.project.clips.some((c) => c.id === i)) }));
  },
  patchTrack: (id, patch) => get().commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  setCanvas: (width, height) => get().commit((p) => ({ ...p, width, height })),
  patchProject: (patch) => get().commit((p) => ({ ...p, ...patch }), { coalesce: 'project-meta' }),
  newProject: () => set({ project: emptyProject(), past: [], future: [], selection: [], time: 0, playing: false }),
  loadProject: (project) => set({ project, past: [], future: [], selection: [], time: 0, playing: false }),
}));

export const getState = () => useStore.getState();
export const selectedClip = (s: State): Clip | undefined => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : undefined);

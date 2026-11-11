import type { Clip, Project } from '../types';
import { collectLayers, type Layer } from './anim';
import { getAudioCtx, scheduleAudio } from './audio';
import { Compositor } from './compositor';
import { runtime } from './runtime';
import { buildDrawItems, layerBaseSize } from './scene';
import { segmentFrame, setSegmenterListener } from './segmenter';
import { projectDuration, useStore } from './store';
import { setFontListener } from './textRender';
import { clamp } from './util';

interface VideoSlot {
  el: HTMLVideoElement;
  assetId: string;
  used: number;
}

const MAX_VIDEOS = 7;

class Engine {
  canvas: HTMLCanvasElement | null = null;
  private comp: Compositor | null = null;
  private videos = new Map<string, VideoSlot>();
  private dirty = true;
  private raf = 0;
  private tickNo = 0;
  private lastRenderFrame = -1;
  private playT0 = 0;
  private playC0 = 0;
  private useAudioClock = true;
  private nodes: AudioBufferSourceNode[] = [];
  private master: GainNode | null = null;
  private lastProject: Project | null = null;
  private reschedulePending = false;
  /** set while exporting so preview stops competing for decoders */
  suspended = false;
  error: string | null = null;

  constructor() {
    useStore.subscribe((s, prev) => {
      if (s.project !== prev.project || s.time !== prev.time || s.mediaTick !== prev.mediaTick) this.dirty = true;
      if (s.playing && (s.project.clips !== prev.project.clips || s.project.tracks !== prev.project.tracks || s.mediaTick !== prev.mediaTick)) this.queueReschedule();
    });
    setFontListener(() => (this.dirty = true));
    setSegmenterListener(() => {
      this.dirty = true;
      useStore.setState((s) => ({ mediaTick: s.mediaTick + 1 }));
    });
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    try {
      this.comp = new Compositor(canvas);
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
      this.comp = null;
    }
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.comp = null;
    this.canvas = null;
  }

  resize(w: number, h: number) {
    this.comp?.resize(w, h);
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  private now(): number {
    return this.useAudioClock ? getAudioCtx().currentTime : performance.now() / 1000;
  }

  async play() {
    const s = useStore.getState();
    const dur = projectDuration(s.project);
    if (dur <= 0 || s.playing) return;
    let t = s.time;
    if (t >= dur - 0.03) t = 0;
    const ctx = getAudioCtx();
    if (ctx.state !== 'running') {
      try {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
      } catch {
        /* ignore */
      }
    }
    this.useAudioClock = ctx.state === 'running';
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
    }
    this.playT0 = t;
    this.playC0 = this.now() + 0.04;
    useStore.setState({ playing: true, time: t });
    this.startAudio(t);
  }

  pause() {
    if (!useStore.getState().playing) return;
    this.stopAudio();
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
    useStore.setState({ playing: false });
    this.dirty = true;
  }

  toggle() {
    if (useStore.getState().playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const s = useStore.getState();
    t = clamp(t, 0, Math.max(projectDuration(s.project), 0));
    if (s.playing) {
      this.playT0 = t;
      this.playC0 = this.now() + 0.04;
      this.stopAudio();
      this.startAudio(t);
    }
    s.setTime(t);
    this.dirty = true;
  }

  private startAudio(t: number) {
    if (!this.useAudioClock || !this.master) return;
    const ctx = getAudioCtx();
    this.nodes = scheduleAudio(ctx, useStore.getState().project, this.master, t, this.playC0);
  }

  private stopAudio() {
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        /* not started */
      }
      n.disconnect();
    }
    this.nodes = [];
  }

  private queueReschedule() {
    if (this.reschedulePending) return;
    this.reschedulePending = true;
    queueMicrotask(() => {
      this.reschedulePending = false;
      const s = useStore.getState();
      if (!s.playing) return;
      const t = this.currentPlayTime();
      this.playT0 = t;
      this.playC0 = this.now() + 0.02;
      this.stopAudio();
      this.startAudio(t);
    });
  }

  private currentPlayTime() {
    return Math.max(this.playT0, this.playT0 + (this.now() - this.playC0));
  }

  private slotFor(clip: Clip): VideoSlot | null {
    let slot = this.videos.get(clip.id);
    if (slot && slot.assetId === clip.assetId) return slot;
    const rt = clip.assetId ? runtime.get(clip.assetId) : undefined;
    if (!rt) return null;
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = rt.url;
    const mark = () => (this.dirty = true);
    el.addEventListener('seeked', mark);
    el.addEventListener('loadeddata', mark);
    el.addEventListener('canplay', mark);
    // iOS only paints the first frame of a video once it has been asked to play; the sync loop pauses it again.
    if (typeof window !== 'undefined' && 'ontouchstart' in window) el.play().catch(() => undefined);
    slot = { el, assetId: clip.assetId!, used: this.tickNo };
    this.videos.set(clip.id, slot);
    return slot;
  }

  private dropSlot(id: string) {
    const slot = this.videos.get(id);
    if (!slot) return;
    slot.el.pause();
    slot.el.removeAttribute('src');
    slot.el.load();
    this.videos.delete(id);
  }

  private syncVideos(project: Project, layers: Layer[], t: number, playing: boolean) {
    const fps = project.fps;
    const want = new Map<string, { clip: Clip; src: number; active: boolean }>();
    for (const l of layers) if (l.clip.type === 'video') want.set(l.clip.id, { clip: l.clip, src: l.srcTime, active: true });
    // warm up clips that are about to start
    const ahead = playing ? 1.6 : 0.6;
    for (const c of project.clips) {
      if (c.type !== 'video' || want.has(c.id)) continue;
      if (c.start > t && c.start - t < ahead && want.size < MAX_VIDEOS) want.set(c.id, { clip: c, src: c.inPoint, active: false });
    }
    for (const [id, w] of want) {
      const slot = this.slotFor(w.clip);
      if (!slot) continue;
      slot.used = this.tickNo;
      const el = slot.el;
      const asset = project.assets.find((a) => a.id === w.clip.assetId);
      const maxT = Math.max(0, (asset?.duration ?? 1e9) - 0.5 / fps);
      const target = clamp(w.src, 0, maxT);
      const atEnd = target >= maxT - 0.03;
      if (playing && w.active && !atEnd) {
        if (Math.abs(el.playbackRate - w.clip.speed) > 0.001) el.playbackRate = w.clip.speed;
        const drift = Math.abs(el.currentTime - target);
        if (el.paused) {
          if (drift > 0.05 && !el.seeking) el.currentTime = target;
          if (el.readyState >= 2 || el.readyState === 0) el.play().catch(() => undefined);
        } else if (drift > 0.28 && !el.seeking) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - target) > 0.4 / fps) el.currentTime = target;
      }
      void id;
    }
    for (const [id, slot] of this.videos) {
      if (want.has(id)) continue;
      if (!slot.el.paused) slot.el.pause();
    }
    if (this.videos.size > MAX_VIDEOS) {
      const idle = [...this.videos.entries()].filter(([id]) => !want.has(id)).sort((a, b) => a[1].used - b[1].used);
      while (this.videos.size > MAX_VIDEOS && idle.length) this.dropSlot(idle.shift()![0]);
    }
    if (this.tickNo % 240 === 0) {
      const ids = new Set(project.clips.map((c) => c.id));
      for (const id of [...this.videos.keys()]) if (!ids.has(id)) this.dropSlot(id);
    }
  }

  get pixelScale() {
    const p = useStore.getState().project;
    return this.canvas ? this.canvas.width / p.width : 1;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.suspended) return;
    this.tickNo++;
    const s = useStore.getState();
    const project = s.project;
    let t = s.time;
    if (s.playing) {
      t = this.currentPlayTime();
      const dur = projectDuration(project);
      if (t >= dur) {
        t = dur;
        this.pause();
      }
      // The timeline and inspectors subscribe to time; publishing at 60/120 Hz forces
      // expensive UI work even when the project is 24/30 fps. Publish once per frame.
      if (Math.floor(t * project.fps) !== Math.floor(s.time * project.fps)) useStore.setState({ time: t });
    }
    if (project !== this.lastProject) {
      this.lastProject = project;
      this.dirty = true;
    }
    const layers = collectLayers(project, t);
    this.syncVideos(project, layers, t, useStore.getState().playing);
    if (!this.comp) return;
    const seeking = layers.some((l) => l.clip.type === 'video' && this.videos.get(l.clip.id)?.el.seeking);
    // Rendering every display refresh needlessly re-uploads every video texture and reruns
    // all fragment effects. Render at project frame cadence instead (and still immediately
    // when paused/seeked/edited).
    const renderFrame = Math.floor(t * project.fps + 1e-4);
    if ((this.dirty || s.playing || seeking) && (!s.playing || renderFrame !== this.lastRenderFrame || seeking)) {
      this.dirty = false;
      this.lastRenderFrame = renderFrame;
      const items = buildDrawItems(project, layers, {
        video: (c) => this.videos.get(c.id)?.el ?? null,
        stamp: (c) => this.videos.get(c.id)?.el.currentTime ?? 0,
        segment: segmentFrame,
        pixelScale: this.pixelScale,
      });
      this.comp.render(items, project.width, project.height, project.background, t);
    }
  };

  /** Bounding box (project px) of a clip at the current time, for on-canvas handles. */
  boxOf(clipId: string): { cx: number; cy: number; w: number; h: number; rotation: number; layer: Layer } | null {
    const s = useStore.getState();
    const layers = collectLayers(s.project, s.time);
    const layer = layers.find((l) => l.clip.id === clipId && !l.tail);
    if (!layer) return null;
    const base = layerBaseSize(s.project, layer, this.pixelScale);
    return { cx: s.project.width / 2 + layer.x * s.project.width, cy: s.project.height / 2 + layer.y * s.project.height, w: base.w * layer.scale, h: base.h * layer.scale, rotation: layer.rotation, layer };
  }

  /** Topmost clip under a point given in project pixels. */
  hitTest(px: number, py: number): string | null {
    const s = useStore.getState();
    const layers = collectLayers(s.project, s.time);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.tail || l.track.locked) continue;
      const base = layerBaseSize(s.project, l, this.pixelScale);
      const cx = s.project.width / 2 + l.x * s.project.width;
      const cy = s.project.height / 2 + l.y * s.project.height;
      const th = (-l.rotation * Math.PI) / 180;
      const dx = px - cx;
      const dy = py - cy;
      const lx = dx * Math.cos(th) - dy * Math.sin(th);
      const ly = dx * Math.sin(th) + dy * Math.cos(th);
      if (Math.abs(lx) <= (base.w * l.scale) / 2 && Math.abs(ly) <= (base.h * l.scale) / 2) return l.clip.id;
    }
    return null;
  }
}

export const engine = new Engine();

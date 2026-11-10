import type { Clip, ClipAnim, Project, Track, Transition } from '../types';
import { clipEnd, clipValue } from './store';
import { backOut, clamp, EASE } from './util';

export interface Layer {
  clip: Clip;
  track: Track;
  localT: number;
  srcTime: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  blurAdd: number;
  wipe: [number, number, number] | null;
  fade: [number, number, number, number];
  activeWord: number;
  reveal: number;
  /** true when this clip is only visible as the outgoing half of a transition */
  tail: boolean;
}

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

function applyAnim(l: Layer, anim: ClipAnim, p: number, isText: boolean) {
  if (anim === 'none' || p >= 1) return;
  const e = EASE.easeOut(p);
  switch (anim) {
    case 'fade':
      l.opacity *= p;
      break;
    case 'pop':
      l.scale *= 0.55 + 0.45 * backOut(p);
      l.opacity *= Math.min(1, p * 3);
      break;
    case 'slideUp':
      l.y += (1 - e) * 0.07;
      l.opacity *= Math.min(1, p * 1.6);
      break;
    case 'slideDown':
      l.y -= (1 - e) * 0.07;
      l.opacity *= Math.min(1, p * 1.6);
      break;
    case 'zoom':
      l.scale *= 1.5 - 0.5 * e;
      l.opacity *= Math.min(1, p * 2);
      break;
    case 'typewriter':
      if (isText) l.reveal = Math.min(l.reveal, p);
      else l.opacity *= p;
      break;
  }
}

function applyTransition(l: Layer, tr: Transition, pRaw: number, role: 'in' | 'out') {
  const p = EASE.easeInOut(clamp(pRaw, 0, 1));
  const isIn = role === 'in';
  switch (tr.type) {
    case 'crossfade':
      if (isIn) l.opacity *= p;
      break;
    case 'dipBlack':
    case 'dipWhite': {
      const c = tr.type === 'dipBlack' ? 0 : 1;
      if (isIn) {
        if (pRaw < 0.5) l.opacity = 0;
        else l.fade = [c, c, c, 2 - 2 * pRaw];
      } else {
        if (pRaw >= 0.5) l.opacity = 0;
        else l.fade = [c, c, c, pRaw * 2];
      }
      break;
    }
    case 'slideLeft':
      l.x += isIn ? 1 - p : -p;
      break;
    case 'slideRight':
      l.x += isIn ? -(1 - p) : p;
      break;
    case 'slideUp':
      l.y += isIn ? 1 - p : -p;
      break;
    case 'slideDown':
      l.y += isIn ? -(1 - p) : p;
      break;
    case 'wipeRight':
      if (isIn) l.wipe = [1, 0, p];
      break;
    case 'wipeLeft':
      if (isIn) l.wipe = [-1, 0, p];
      break;
    case 'wipeDown':
      if (isIn) l.wipe = [0, 1, p];
      break;
    case 'wipeUp':
      if (isIn) l.wipe = [0, -1, p];
      break;
    case 'zoomIn':
      if (isIn) {
        l.scale *= 0.6 + 0.4 * p;
        l.opacity *= p;
      } else l.scale *= 1 + 0.6 * p;
      break;
    case 'zoomOut':
      if (isIn) {
        l.scale *= 1.5 - 0.5 * p;
        l.opacity *= p;
      } else l.scale *= 1 - 0.25 * p;
      break;
    case 'blur':
      if (isIn) {
        l.blurAdd += (1 - p) * 60;
        l.opacity *= p;
      } else l.blurAdd += p * 60;
      break;
    case 'spin':
      if (isIn) {
        l.rotation += (1 - p) * -120;
        l.scale *= 0.3 + 0.7 * p;
        l.opacity *= p;
      } else {
        l.rotation += p * 120;
        l.scale *= 1 + 0.4 * p;
      }
      break;
  }
}

function makeLayer(clip: Clip, track: Track, t: number, tail: boolean): Layer {
  const localT = t - clip.start;
  const kt = clamp(localT, 0, clip.duration);
  const l: Layer = {
    clip,
    track,
    localT,
    srcTime: clip.inPoint + localT * clip.speed,
    x: clipValue(clip, 'x', kt),
    y: clipValue(clip, 'y', kt),
    scale: clipValue(clip, 'scale', kt),
    rotation: clipValue(clip, 'rotation', kt),
    opacity: clipValue(clip, 'opacity', kt),
    blurAdd: 0,
    wipe: null,
    fade: [0, 0, 0, 0],
    activeWord: -1,
    reveal: 1,
    tail,
  };
  if (!tail) {
    const d = Math.min(clip.animDur, clip.duration / 2);
    if (d > 0) {
      const isText = clip.type === 'text';
      if (clip.animIn !== 'none') {
        const dur = clip.animIn === 'typewriter' && isText ? Math.min(clip.duration * 0.7, Math.max(d, clip.text.length * 0.045)) : d;
        applyAnim(l, clip.animIn, localT / dur, isText);
      }
      if (clip.animOut !== 'none') applyAnim(l, clip.animOut === 'typewriter' ? 'fade' : clip.animOut, (clip.duration - localT) / d, isText);
    }
    if (clip.type === 'text' && clip.style.highlight !== 'none') {
      const n = wordCount(clip.text);
      if (clip.words && clip.words.length === n) {
        for (let i = 0; i < clip.words.length; i++) if (localT >= clip.words[i].start - 0.02) l.activeWord = i;
      } else if (n > 0) l.activeWord = clamp(Math.floor((localT / clip.duration) * n), 0, n - 1);
    }
  }
  return l;
}

export function transitionDuration(clip: Clip, prev?: Clip): number {
  if (!clip.transitionIn) return 0;
  return Math.max(0.05, Math.min(clip.transitionIn.duration, clip.duration * 0.9, prev ? prev.duration * 0.9 : Infinity));
}

/** Returns the clip immediately before `clip` on the same track (touching), if any. */
export function previousAdjacent(project: Project, clip: Clip): Clip | undefined {
  const tol = 1.5 / project.fps;
  return project.clips.find((c) => c.trackId === clip.trackId && c.id !== clip.id && c.type !== 'audio' && Math.abs(clipEnd(c) - clip.start) < tol);
}

/** Everything visible at time t, bottom layer first. */
export function collectLayers(project: Project, t: number): Layer[] {
  const out: Layer[] = [];
  for (let ti = project.tracks.length - 1; ti >= 0; ti--) {
    const track = project.tracks[ti];
    if (track.kind === 'audio' || track.hidden) continue;
    const clips = project.clips.filter((c) => c.trackId === track.id && t >= c.start - 1e-6 && t < clipEnd(c) + 2.5).sort((a, b) => a.start - b.start);
    const active = clips.filter((c) => t < clipEnd(c) - 1e-6);
    for (const clip of active) {
      const layer = makeLayer(clip, track, t, false);
      if (clip.transitionIn) {
        const prev = previousAdjacent(project, clip);
        const d = transitionDuration(clip, prev);
        const p = (t - clip.start) / d;
        if (p < 1) {
          if (prev && !active.includes(prev)) {
            const outgoing = makeLayer(prev, track, t, true);
            applyTransition(outgoing, clip.transitionIn, p, 'out');
            if (outgoing.opacity > 0.001) out.push(outgoing);
          }
          applyTransition(layer, clip.transitionIn, p, 'in');
        }
      }
      if (layer.opacity > 0.001) out.push(layer);
    }
  }
  return out;
}

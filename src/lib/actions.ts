import type { AnimProp, Clip, Keyframe, TransitionType } from '../types';
import { previousAdjacent } from './anim';
import { detectSpeechRanges, ensureDenoised } from './audio';
import { DEFAULT_FILTERS, LOOKS } from './defaults';
import { bumpMedia } from './media';
import { runtime } from './runtime';
import { clipEnd, clipValue, getState } from './store';
import { uid } from './util';

export function cutSilences(clipId: string, minSilence = 0.45) {
  const st = getState();
  const clip = st.project.clips.find((c) => c.id === clipId);
  const audio = clip?.assetId ? runtime.get(clip.assetId)?.audio : null;
  if (!clip || !audio) {
    st.toast('This clip has no audio to analyse (it may still be loading)', 'error');
    return;
  }
  const from = clip.inPoint;
  const to = clip.inPoint + clip.duration * clip.speed;
  const ranges = detectSpeechRanges(audio, from, to, minSilence);
  if (!ranges.length) {
    st.toast('This clip is silent — nothing to keep');
    return;
  }
  const kept = ranges.reduce((m, r) => m + (r.e - r.s), 0);
  const removed = (to - from - kept) / clip.speed;
  if (removed < 0.15) {
    st.toast(`No pauses longer than ${minSilence.toFixed(2)}s found`);
    return;
  }
  let cursor = clip.start;
  const last = ranges.length - 1;
  const parts: Clip[] = ranges.map((r, i) => {
    const d = (r.e - r.s) / clip.speed;
    const part: Clip = {
      ...clip,
      id: i === 0 ? clip.id : uid('c_'),
      start: cursor,
      inPoint: r.s,
      duration: d,
      keyframes: {},
      fadeIn: i === 0 ? clip.fadeIn : 0,
      fadeOut: i === last ? clip.fadeOut : 0,
      transitionIn: i === 0 ? clip.transitionIn : null,
      animIn: i === 0 ? clip.animIn : 'none',
      animOut: i === last ? clip.animOut : 'none',
    };
    cursor += d;
    return part;
  });
  st.replaceClipWith(clipId, parts);
  st.toast(`Cut ${ranges.length - 1 || 1} pause${ranges.length > 2 ? 's' : ''} · ${removed.toFixed(1)}s shorter`, 'ok');
}

export function detachAudio(clipId: string) {
  const st = getState();
  const clip = st.project.clips.find((c) => c.id === clipId);
  if (!clip || clip.type !== 'video' || !clip.assetId) return;
  if (!runtime.get(clip.assetId)?.audio) {
    st.toast('No audio track found in this clip', 'error');
    return;
  }
  st.updateClip(clipId, { muted: true });
  getState().addClipFromAsset(clip.assetId, {
    at: clip.start,
    patch: { type: 'audio', name: clip.name, inPoint: clip.inPoint, duration: clip.duration, speed: clip.speed, volume: clip.volume, denoise: clip.denoise, enhance: clip.enhance, normalize: clip.normalize, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut },
  });
}

export function setDenoise(clip: Clip, on: boolean) {
  const st = getState();
  st.updateClip(clip.id, { denoise: on });
  if (!on || !clip.assetId) return;
  const rt = runtime.get(clip.assetId);
  if (!rt?.audio || rt.denoised) return;
  st.setJob('denoise', 'Reducing noise on this device…', null);
  ensureDenoised(clip.assetId, bumpMedia)
    .catch((e) => getState().toast('Noise reduction failed: ' + e.message, 'error'))
    .finally(() => getState().clearJob('denoise'));
}

export function applyLook(lookId: string, ids: string[]) {
  const look = LOOKS.find((l) => l.id === lookId);
  if (!look || !ids.length) return;
  getState().updateClips(ids, () => ({ filters: { ...DEFAULT_FILTERS, ...look.f }, look: lookId }));
}

export function visualTargets(): string[] {
  const st = getState();
  const sel = st.project.clips.filter((c) => st.selection.includes(c.id) && (c.type === 'video' || c.type === 'image'));
  if (sel.length) return sel.map((c) => c.id);
  const under = st.project.clips.filter((c) => (c.type === 'video' || c.type === 'image') && st.time >= c.start && st.time < clipEnd(c));
  return under.length ? [under[under.length - 1].id] : [];
}

export function applyTransition(type: TransitionType | null, duration: number, all = false): number {
  const st = getState();
  let ids: string[];
  if (all) ids = st.project.clips.filter((c) => (c.type === 'video' || c.type === 'image') && previousAdjacent(st.project, c)).map((c) => c.id);
  else {
    ids = st.project.clips.filter((c) => st.selection.includes(c.id) && c.type !== 'audio').map((c) => c.id);
    if (!ids.length) {
      // nearest cut to the playhead
      const cuts = st.project.clips.filter((c) => (c.type === 'video' || c.type === 'image') && previousAdjacent(st.project, c));
      cuts.sort((a, b) => Math.abs(a.start - st.time) - Math.abs(b.start - st.time));
      if (cuts[0]) ids = [cuts[0].id];
    }
  }
  if (!ids.length) {
    st.toast(all ? 'No cuts found — place two clips next to each other first' : 'Select the clip the transition should lead into');
    return 0;
  }
  st.updateClips(ids, () => ({ transitionIn: type ? { type, duration } : null }));
  return ids.length;
}

export type MotionPreset = 'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight' | 'drift';

export function applyMotion(clipId: string, preset: MotionPreset) {
  const st = getState();
  const c = st.project.clips.find((x) => x.id === clipId);
  if (!c) return;
  const lt = st.time - c.start;
  const s = clipValue(c, 'scale', lt);
  const x = clipValue(c, 'x', lt);
  const kf = (a: number, b: number): Keyframe[] => [
    { t: 0, v: a, ease: 'easeInOut' },
    { t: c.duration, v: b, ease: 'linear' },
  ];
  const keyframes: Partial<Record<AnimProp, Keyframe[]>> = { ...c.keyframes };
  if (preset === 'zoomIn') keyframes.scale = kf(s, s * 1.22);
  if (preset === 'zoomOut') keyframes.scale = kf(s * 1.22, s);
  if (preset === 'panLeft' || preset === 'panRight') {
    keyframes.scale = kf(s * 1.16, s * 1.16);
    keyframes.x = preset === 'panLeft' ? kf(x + 0.07, x - 0.07) : kf(x - 0.07, x + 0.07);
  }
  if (preset === 'drift') {
    keyframes.scale = kf(s * 1.08, s * 1.16);
    keyframes.rotation = kf(-1.2, 1.2);
  }
  st.updateClip(clipId, { keyframes });
}

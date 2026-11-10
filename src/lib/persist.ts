import type { Project } from '../types';
import { idbGet, idbSet } from './db';
import { restoreMedia } from './media';
import { makeClip, useStore } from './store';

export function sanitizeProject(p: Project): Project {
  return {
    ...p,
    version: 1,
    fps: p.fps || 30,
    background: p.background || '#000000',
    tracks: p.tracks ?? [],
    assets: p.assets ?? [],
    clips: (p.clips ?? []).map((c) => ({ ...makeClip({ type: c.type, trackId: c.trackId }), ...c, filters: { ...makeClip({ type: c.type, trackId: c.trackId }).filters, ...(c.filters ?? {}) }, style: { ...makeClip({ type: c.type, trackId: c.trackId }).style, ...(c.style ?? {}) } })),
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Load the autosaved project from IndexedDB and keep it saved from now on. */
export async function initPersistence() {
  try {
    const saved = await idbGet<Project>('kv', 'project');
    if (saved && saved.tracks?.length) {
      const project = sanitizeProject(saved);
      useStore.setState({ project });
      void restoreMedia(project, true);
    }
  } catch (e) {
    console.warn('Could not load saved project', e);
  }
  useStore.setState({ loaded: true, savedAt: Date.now() });
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      idbSet('kv', 'project', useStore.getState().project)
        .then(() => useStore.setState({ savedAt: Date.now() }))
        .catch((e) => console.warn('autosave failed', e));
    }, 500);
  });
  // ask the browser not to evict our local data
  navigator.storage?.persist?.().catch(() => undefined);
}

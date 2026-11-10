import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { Asset, Project } from '../types';
import { computePeaks, decodeAudio, ensureDenoised, measureNormGain } from './audio';
import { idbDel, idbGet, idbKeys, idbSet } from './db';
import { runtime, type Runtime } from './runtime';
import { getState, useStore } from './store';
import { once, uid } from './util';

const bump = () => useStore.setState((s) => ({ mediaTick: s.mediaTick + 1 }));

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|ogv|avi|ts)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i;

function detectKind(mime: string, name: string): Asset['kind'] | null {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (VIDEO_EXT.test(name)) return 'video';
  if (AUDIO_EXT.test(name)) return 'audio';
  if (IMAGE_EXT.test(name)) return 'image';
  return null;
}

function thumbFrom(src: CanvasImageSource, sw: number, sh: number): string {
  const c = document.createElement('canvas');
  const w = 240;
  c.width = w;
  c.height = Math.max(2, Math.round((w * sh) / Math.max(1, sw)));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

async function probeVideo(url: string, file: Blob): Promise<Pick<Asset, 'duration' | 'width' | 'height' | 'thumb'> | null> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  const ev = await once(v, ['loadedmetadata', 'error'], 20000);
  if (!ev || ev.type === 'error' || !v.videoWidth) return null;
  let duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
      duration = await input.computeDuration();
      input.dispose();
    } catch {
      duration = NaN;
    }
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    v.currentTime = 1e7;
    await once(v, ['seeked', 'error'], 8000);
    duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : v.currentTime;
  }
  if (!Number.isFinite(duration) || duration <= 0) return null;
  let thumb = '';
  try {
    v.currentTime = Math.min(duration * 0.15, 1.5);
    await once(v, ['seeked', 'error'], 8000);
    if (v.readyState < 2) await once(v, ['loadeddata', 'canplay'], 4000);
    thumb = thumbFrom(v, v.videoWidth, v.videoHeight);
  } catch {
    /* no thumbnail */
  }
  const res = { duration, width: v.videoWidth, height: v.videoHeight, thumb };
  v.removeAttribute('src');
  v.load();
  return res;
}

async function loadImage(file: Blob): Promise<{ image: TexImageSource; width: number; height: number; thumb: string } | null> {
  try {
    let src: ImageBitmap | HTMLImageElement;
    try {
      src = await createImageBitmap(file);
    } catch {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      src = img;
    }
    const sw = 'naturalWidth' in src ? src.naturalWidth || 1024 : src.width;
    const sh = 'naturalHeight' in src ? src.naturalHeight || 1024 : src.height;
    const MAX = 4096;
    let image: TexImageSource = src;
    let width = sw;
    let height = sh;
    if (sw > MAX || sh > MAX || 'naturalWidth' in src) {
      const k = Math.min(1, MAX / Math.max(sw, sh));
      const c = document.createElement('canvas');
      c.width = Math.round(sw * k);
      c.height = Math.round(sh * k);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      image = c;
      width = c.width;
      height = c.height;
    }
    return { image, width, height, thumb: thumbFrom(src, sw, sh) };
  } catch {
    return null;
  }
}

async function buildFilmstrip(id: string, asset: Pick<Asset, 'duration' | 'width' | 'height'>) {
  const rt = runtime.get(id);
  if (!rt) return;
  let input: Input | null = null;
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(rt.file) });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return;
    const th = 56;
    const tw = Math.max(24, Math.round((th * asset.width) / Math.max(1, asset.height)));
    const n = Math.min(48, Math.max(6, Math.ceil(asset.duration / 1.5)));
    const first = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { width: tw, height: th, fit: 'cover', poolSize: 1 });
    const sprite = document.createElement('canvas');
    sprite.width = tw * n;
    sprite.height = th;
    const ctx = sprite.getContext('2d')!;
    const times = Array.from({ length: n }, (_, i) => first + ((i + 0.5) * asset.duration) / n);
    let i = 0;
    const publish = async () => {
      const blob = await new Promise<Blob | null>((r) => sprite.toBlob(r, 'image/jpeg', 0.7));
      if (!blob || !runtime.has(id)) return;
      const old = rt.strip?.url;
      rt.strip = { url: URL.createObjectURL(blob), n, tw, th };
      if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
      bump();
    };
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (!runtime.has(id)) break;
      if (wc) ctx.drawImage(wc.canvas, i * tw, 0, tw, th);
      else if (i > 0) ctx.drawImage(sprite, (i - 1) * tw, 0, tw, th, i * tw, 0, tw, th);
      i++;
      if (i === 6 || i === 20) await publish();
    }
    await publish();
  } catch (e) {
    console.warn('filmstrip failed', e);
  } finally {
    input?.dispose();
  }
}

async function prepareAudio(id: string, known?: AudioBuffer | null) {
  const rt = runtime.get(id);
  if (!rt) return;
  const buf = known !== undefined ? known : await decodeAudio(rt.file);
  rt.audio = buf;
  if (buf) {
    rt.peaks = computePeaks(buf);
    rt.normGain = measureNormGain(buf);
  }
  const st = getState();
  const asset = st.project.assets.find((a) => a.id === id);
  if (asset && asset.hasAudio !== !!buf) st.patchAsset(id, { hasAudio: !!buf });
  bump();
  if (buf && st.project.clips.some((c) => c.assetId === id && c.denoise)) void ensureDenoised(id, bump);
}

export async function importFile(file: Blob, name?: string, quiet = false): Promise<Asset | null> {
  const st = getState();
  const fname = name ?? (file as File).name ?? 'clip';
  const kind = detectKind(file.type, fname);
  if (!kind) {
    st.toast(`Can't import “${fname}” — unsupported file type`, 'error');
    return null;
  }
  const missing = st.project.assets.find((a) => !runtime.has(a.id) && a.name === fname && a.size === file.size);
  const id = missing?.id ?? uid('a_');
  const url = URL.createObjectURL(file);
  const rt: Runtime = { file, url };
  const meta: Asset = { id, name: fname, kind, size: file.size, mime: file.type, duration: 0, width: 0, height: 0, hasAudio: kind !== 'image', thumb: '' };
  let audio: AudioBuffer | null | undefined;
  if (kind === 'video') {
    const info = await probeVideo(url, file);
    if (!info) {
      URL.revokeObjectURL(url);
      st.toast(`This browser can't decode “${fname}”. Try MP4 (H.264) or WebM.`, 'error');
      return null;
    }
    Object.assign(meta, info);
  } else if (kind === 'image') {
    const img = await loadImage(file);
    if (!img) {
      URL.revokeObjectURL(url);
      st.toast(`Couldn't read image “${fname}”`, 'error');
      return null;
    }
    rt.image = img.image;
    Object.assign(meta, { width: img.width, height: img.height, thumb: img.thumb, duration: 0 });
  } else {
    audio = await decodeAudio(file);
    if (!audio) {
      URL.revokeObjectURL(url);
      st.toast(`Couldn't decode audio “${fname}”`, 'error');
      return null;
    }
    meta.duration = audio.duration;
  }
  runtime.set(id, rt);
  idbSet('media', id, file).catch(() => !quiet && getState().toast('Storage is full — this clip will not survive a reload', 'error'));
  if (missing) getState().patchAsset(id, meta);
  else getState().addAsset(meta);
  if (kind === 'video') {
    void prepareAudio(id);
    void buildFilmstrip(id, meta);
  } else if (kind === 'audio') void prepareAudio(id, audio);
  bump();
  return meta;
}

export async function importFiles(files: Iterable<File>, addToTimeline = false): Promise<Asset[]> {
  const out: Asset[] = [];
  const list = [...files];
  if (!list.length) return out;
  const st = getState();
  st.setJob('import', `Importing ${list.length} file${list.length > 1 ? 's' : ''}…`, 0);
  try {
    for (let i = 0; i < list.length; i++) {
      const a = await importFile(list[i]);
      if (a) {
        out.push(a);
        if (addToTimeline) getState().addClipFromAsset(a.id);
      }
      getState().setJob('import', `Importing ${list.length} file${list.length > 1 ? 's' : ''}…`, (i + 1) / list.length);
    }
  } finally {
    getState().clearJob('import');
  }
  return out;
}

/** Re-attach media blobs from IndexedDB after a reload. */
export async function restoreMedia(project: Project, gc = false) {
  const keep = new Set(project.assets.map((a) => a.id));
  for (const asset of project.assets) {
    if (runtime.has(asset.id)) continue;
    try {
      const file = await idbGet<Blob>('media', asset.id);
      if (!file) continue;
      const rt: Runtime = { file, url: URL.createObjectURL(file) };
      runtime.set(asset.id, rt);
      if (asset.kind === 'image') {
        const img = await loadImage(file);
        if (img) rt.image = img.image;
      } else if (asset.kind === 'video') {
        void prepareAudio(asset.id);
        void buildFilmstrip(asset.id, asset);
      } else void prepareAudio(asset.id);
      bump();
    } catch (e) {
      console.warn('restore failed', asset.name, e);
    }
  }
  if (gc) {
    try {
      for (const k of await idbKeys('media')) if (!keep.has(String(k))) void idbDel('media', String(k));
    } catch {
      /* ignore */
    }
  }
  bump();
}

export function forgetMedia(id: string) {
  const rt = runtime.get(id);
  if (rt) {
    URL.revokeObjectURL(rt.url);
    if (rt.strip) URL.revokeObjectURL(rt.strip.url);
    runtime.delete(id);
  }
  void idbDel('media', id);
  bump();
}

export { bump as bumpMedia };

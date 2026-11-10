// On-device person segmentation (MediaPipe selfie multiclass, bundled with the app — no network needed).
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { MaskData } from './compositor';

let seg: ImageSegmenter | null = null;
let loading: Promise<void> | null = null;
let failed = false;
let stampClock = 0;
let versionSeq = 1;
const cache = new Map<string, { stamp: string | number; mask: MaskData }>();
let onReady: (() => void) | null = null;

export const segmenterState = () => (seg ? 'ready' : failed ? 'failed' : loading ? 'loading' : 'idle');
export function setSegmenterListener(fn: () => void) {
  onReady = fn;
}

export function ensureSegmenter(): Promise<void> {
  if (seg) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const make = (delegate: 'GPU' | 'CPU') =>
      ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/mediapipe/selfie_multiclass_256x256.tflite', delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      });
    try {
      seg = await make('GPU');
    } catch {
      seg = await make('CPU');
    }
    onReady?.();
  })().catch((e) => {
    console.error('Background removal failed to load', e);
    failed = true;
    loading = null;
    onReady?.();
  });
  return loading;
}

/** Synchronously segment a frame. Returns null until the model is loaded (it starts loading on first use). */
export function segmentFrame(key: string, source: TexImageSource, stamp: string | number): MaskData | null {
  if (!seg) {
    if (!failed) void ensureSegmenter();
    return null;
  }
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) return hit.mask;
  try {
    stampClock = Math.max(stampClock + 1, Math.floor(performance.now()));
    const res = seg.segmentForVideo(source as never, stampClock);
    const masks = res.confidenceMasks;
    if (!masks || !masks.length) {
      res.close();
      return hit?.mask ?? null;
    }
    const w = masks[0].width;
    const h = masks[0].height;
    const bgIsFirst = masks.length > 1;
    const f = masks[0].getAsFloat32Array();
    const reuse = hit && hit.mask.w === w && hit.mask.h === h;
    const data = reuse ? hit!.mask.data : new Uint8Array(w * h);
    const blend = reuse && typeof stamp === 'number' && typeof hit!.stamp === 'number' && Math.abs(stamp - hit!.stamp) < 0.12;
    for (let i = 0; i < f.length; i++) {
      let v = (bgIsFirst ? 1 - f[i] : f[i]) * 255;
      if (blend) v = v * 0.72 + data[i] * 0.28;
      data[i] = v;
    }
    res.close();
    const mask: MaskData = { data, w, h, version: versionSeq++ };
    cache.set(key, { stamp, mask });
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
    return mask;
  } catch (e) {
    console.warn('segmentation error', e);
    return hit?.mask ?? null;
  }
}

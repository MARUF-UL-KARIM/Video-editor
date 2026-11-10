import type { Clip, Project } from '../types';
import type { Layer } from './anim';
import type { DrawItem, MaskData } from './compositor';
import { runtime } from './runtime';
import { renderText } from './textRender';

export interface SceneIO {
  /** current frame for a video clip (element, canvas or VideoFrame) */
  video: (clip: Clip) => TexImageSource | null;
  /** stamp identifying the current video frame, used to cache segmentation */
  stamp: (clip: Clip, layer: Layer) => number;
  segment: (key: string, source: TexImageSource, stamp: string | number) => MaskData | null;
  /** output pixels per project pixel */
  pixelScale: number;
}

export function mediaBaseSize(project: Project, clip: Clip): { w: number; h: number } {
  const a = project.assets.find((x) => x.id === clip.assetId);
  const aw = a?.width || project.width;
  const ah = a?.height || project.height;
  const s = clip.fit === 'cover' ? Math.max(project.width / aw, project.height / ah) : Math.min(project.width / aw, project.height / ah);
  return { w: aw * s, h: ah * s };
}

const textQuality = (pixelScale: number, scale: number) => Math.min(3, Math.max(0.25, pixelScale * Math.min(Math.max(scale, 0.5), 3)));

export function layerBaseSize(project: Project, layer: Layer, pixelScale: number): { w: number; h: number } {
  const c = layer.clip;
  if (c.type === 'text') {
    const r = renderText(c, project.width, layer.activeWord, 1, textQuality(pixelScale, layer.scale));
    return { w: r.w, h: r.h };
  }
  return mediaBaseSize(project, c);
}

export function buildDrawItems(project: Project, layers: Layer[], io: SceneIO): DrawItem[] {
  const items: DrawItem[] = [];
  const W = project.width;
  const H = project.height;
  for (const l of layers) {
    const c = l.clip;
    let source: TexImageSource | null = null;
    let w = 0;
    let h = 0;
    let dynamic = false;
    let version: string | number = 0;
    let key = c.id;
    if (c.type === 'text') {
      if (!c.text.trim()) continue;
      const r = renderText(c, W, l.activeWord, l.reveal, textQuality(io.pixelScale, l.scale));
      source = r.canvas;
      w = r.w;
      h = r.h;
      version = r.key;
    } else if (c.type === 'video') {
      source = io.video(c);
      ({ w, h } = mediaBaseSize(project, c));
      dynamic = true;
    } else if (c.type === 'image') {
      source = (c.assetId && runtime.get(c.assetId)?.image) || null;
      ({ w, h } = mediaBaseSize(project, c));
      key = 'img:' + c.assetId;
      version = 1;
    } else continue;

    let mask: MaskData | null = null;
    if (c.removeBg && source && c.type !== 'text') {
      const ready = !(typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) || (source.readyState >= 2 && source.videoWidth > 0);
      if (ready) mask = io.segment(c.id, source, c.type === 'image' ? 'still' : io.stamp(c, l));
    }
    const sw = w * l.scale;
    const sh = h * l.scale;
    items.push({
      key,
      source,
      dynamic,
      version,
      w,
      h,
      cx: W / 2 + l.x * W,
      cy: H / 2 + l.y * H,
      scale: l.scale,
      rotation: l.rotation,
      opacity: Math.max(0, Math.min(1, l.opacity)),
      flipH: c.flipH,
      filters: c.filters,
      blurAdd: l.blurAdd,
      chroma: c.chroma,
      mask: mask && c.type === 'image' ? { ...mask } : mask,
      wipe: l.wipe,
      fade: l.fade,
      radius: c.type === 'text' ? 0 : (c.radius / 100) * Math.min(sw, sh) * 0.5,
      blend: c.blend,
    });
    // image masks are keyed per clip so several clips of one asset do not fight over a texture
    if (mask && c.type === 'image') items[items.length - 1].key = 'img:' + c.assetId + ':' + c.id;
  }
  return items;
}

import type { Clip, TextStyle } from '../types';
import { rgba } from './util';

export interface TextRender {
  canvas: HTMLCanvasElement;
  /** size in project pixels */
  w: number;
  h: number;
  key: string;
}

const cache = new Map<string, TextRender>();
const MAX_CACHE = 90;
let onFontsReady: (() => void) | null = null;
const pendingFonts = new Set<string>();
/** bumped whenever a web font finishes loading so cached rasters (and their GPU textures) are rebuilt */
let fontEpoch = 0;
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.addEventListener('loadingdone', () => {
    fontEpoch++;
    cache.clear();
    onFontsReady?.();
  });
}

export function setFontListener(fn: () => void) {
  onFontsReady = fn;
}
export function clearTextCache() {
  cache.clear();
}

export const fontString = (s: TextStyle, px = s.fontSize) => `${s.italic ? 'italic ' : ''}${s.weight} ${px}px "${s.fontFamily}"`;

export function ensureFont(s: TextStyle, text: string): Promise<unknown> {
  const f = fontString(s, 40);
  if (!document.fonts) return Promise.resolve();
  let ok = true;
  try {
    ok = document.fonts.check(f, text || 'A');
  } catch {
    ok = true;
  }
  if (ok) return Promise.resolve();
  return document.fonts.load(f, text || 'A').catch(() => undefined);
}

interface Token {
  text: string;
  w: number;
  index: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * Rasterise a text clip. `q` is output pixels per project pixel (preview renders small, export renders 1:1 or higher).
 */
export function renderText(clip: Clip, projectW: number, activeWord: number, reveal: number, q: number): TextRender {
  const s = clip.style;
  const raw = s.uppercase ? clip.text.toUpperCase() : clip.text;
  const totalChars = raw.replace(/\s+/g, '').length;
  const shown = reveal >= 1 ? totalChars : Math.floor(totalChars * Math.max(0, reveal));
  const qq = Math.round(q * 8) / 8 || 0.125;
  const key = JSON.stringify([raw, s, s.highlight === 'none' ? -1 : activeWord, shown, projectW, qq, fontEpoch]);
  const hit = cache.get(key);
  if (hit) return hit;

  const fkey = fontString(s, 40);
  if (document.fonts && !pendingFonts.has(fkey)) {
    let ok = true;
    try {
      ok = document.fonts.check(fkey, raw || 'A');
    } catch {
      ok = true;
    }
    if (!ok) {
      pendingFonts.add(fkey);
      document.fonts
        .load(fkey, raw || 'A')
        .catch(() => undefined)
        .then(() => {
          fontEpoch++;
          cache.clear();
          onFontsReady?.();
          setTimeout(() => pendingFonts.delete(fkey), 3000);
        });
    }
  }

  const mctx = measureCanvas!.getContext('2d')!;
  const font = fontString(s);
  mctx.font = font;
  try {
    (mctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  } catch {
    /* unsupported */
  }
  const spaceW = mctx.measureText(' ').width;
  const maxW = Math.max(60, s.maxWidth * projectW);
  const lines: Token[][] = [];
  let index = 0;
  for (const para of raw.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line: Token[] = [];
    let lw = 0;
    for (const word of words) {
      const w = mctx.measureText(word).width;
      if (line.length && lw + spaceW + w > maxW) {
        lines.push(line);
        line = [];
        lw = 0;
      }
      line.push({ text: word, w, index: index++ });
      lw += (line.length > 1 ? spaceW : 0) + w;
    }
    lines.push(line);
  }
  const lineW = (l: Token[]) => l.reduce((m, tk, i) => m + tk.w + (i ? spaceW : 0), 0);
  const contentW = Math.max(1, ...lines.map(lineW));
  const lineH = s.fontSize * s.lineHeight;
  const contentH = Math.max(lineH, lines.length * lineH);
  const m = mctx.measureText('Hg');
  const asc = m.fontBoundingBoxAscent || s.fontSize * 0.8;
  const desc = m.fontBoundingBoxDescent || s.fontSize * 0.2;
  const hasBg = s.bgOpacity > 0.001;
  const hlPadX = s.fontSize * 0.14;
  const hlPadY = s.fontSize * 0.04;
  const pad = Math.ceil((hasBg ? s.bgPadding : 0) + s.strokeWidth / 2 + s.shadowBlur * 1.5 + Math.abs(s.shadowY) + (s.highlight === 'box' ? hlPadX : 0) + 6);

  const w = Math.ceil(contentW + pad * 2);
  const h = Math.ceil(contentH + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.ceil(w * qq));
  canvas.height = Math.max(2, Math.ceil(h * qq));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(qq, qq);
  ctx.font = font;
  try {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letterSpacing}px`;
  } catch {
    /* unsupported */
  }
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  const lineX = (l: Token[]) => {
    const lw = lineW(l);
    return s.align === 'left' ? pad : s.align === 'right' ? pad + contentW - lw : pad + (contentW - lw) / 2;
  };

  if (hasBg) {
    ctx.fillStyle = rgba(s.bgColor, s.bgOpacity);
    lines.forEach((l, i) => {
      if (!l.length) return;
      const lw = lineW(l);
      const y0 = pad + i * lineH - (i === 0 ? s.bgPadding : 0);
      const y1 = pad + (i + 1) * lineH + (i === lines.length - 1 ? s.bgPadding : 0);
      roundRect(ctx, lineX(l) - s.bgPadding, y0, lw + s.bgPadding * 2, y1 - y0 + 0.5, s.bgRadius);
      ctx.fill();
    });
  }

  let budget = shown;
  const draws: { text: string; x: number; y: number; tk: Token }[] = [];
  lines.forEach((l, i) => {
    let x = lineX(l);
    const y = pad + i * lineH + (lineH - (asc + desc)) / 2 + asc;
    for (const tk of l) {
      if (budget <= 0) break;
      const text = tk.text.length <= budget ? tk.text : tk.text.slice(0, budget);
      budget -= text.length;
      draws.push({ text, x, y, tk });
      x += tk.w + spaceW;
    }
  });

  if (s.highlight === 'box' && activeWord >= 0) {
    const d = draws.find((x) => x.tk.index === activeWord);
    if (d) {
      ctx.fillStyle = s.highlightColor;
      roundRect(ctx, d.x - hlPadX, d.y - asc - hlPadY, d.tk.w + hlPadX * 2, asc + desc + hlPadY * 2, s.fontSize * 0.18);
      ctx.fill();
    }
  }

  const shadowOn = s.shadowBlur > 0 || s.shadowY !== 0;
  const setShadow = (on: boolean) => {
    ctx.shadowColor = on ? rgba(s.shadowColor, 0.85) : 'transparent';
    ctx.shadowBlur = on ? s.shadowBlur * qq : 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = on ? s.shadowY * qq : 0;
  };
  if (s.strokeWidth > 0) {
    setShadow(shadowOn);
    ctx.strokeStyle = s.strokeColor;
    ctx.lineWidth = s.strokeWidth;
    for (const d of draws) ctx.strokeText(d.text, d.x, d.y);
    setShadow(false);
  } else setShadow(shadowOn);
  for (const d of draws) {
    ctx.fillStyle = s.highlight === 'color' && d.tk.index === activeWord ? s.highlightColor : s.color;
    ctx.fillText(d.text, d.x, d.y);
  }

  const res: TextRender = { canvas, w, h, key };
  cache.set(key, res);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return res;
}

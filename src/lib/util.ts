import type { Ease } from '../types';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const EPS = 1e-4;

export function formatTime(t: number, fps = 30): string {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function formatClock(t: number): string {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (m === 0 && t < 10) return `${s.toFixed(1)}s`;
  return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  hold: () => 0,
};

export const backOut = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function once<T extends Event = Event>(target: EventTarget, events: string[], timeout = 15000): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (e: T | null) => {
      if (done) return;
      done = true;
      events.forEach((n) => target.removeEventListener(n, handler as EventListener));
      clearTimeout(timer);
      resolve(e);
    };
    const handler = (e: Event) => finish(e as T);
    events.forEach((n) => target.addEventListener(n, handler as EventListener));
    const timer = setTimeout(() => finish(null), timeout);
  });
}

export const isTouchDevice = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches;

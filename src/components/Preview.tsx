import { ChevronFirst, ChevronLast, Maximize, Pause, Play, RotateCw, StepBack, StepForward } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { CANVAS_PRESETS } from '../lib/defaults';
import { engine } from '../lib/engine';
import { clipValue, getState, projectDuration, useStore } from '../lib/store';
import { formatTime } from '../lib/util';
import { cx, IconBtn } from './ui';

type Mode = 'move' | 'scale' | 'rotate';
interface Drag {
  mode: Mode;
  id: string;
  x0: number;
  y0: number;
  ox: number;
  oy: number;
  oscale: number;
  orot: number;
  cx: number;
  cy: number;
  d0: number;
  a0: number;
  moved: boolean;
}

function Overlay({ k }: { k: number }) {
  // re-render whenever anything that could move the box changes
  useStore((s) => s.project);
  useStore((s) => s.time);
  useStore((s) => s.mediaTick);
  const selection = useStore((s) => s.selection);
  const pw = useStore((s) => s.project.width);
  const ph = useStore((s) => s.project.height);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const id = selection.length === 1 ? selection[0] : null;
  const box = id ? engine.boxOf(id) : null;
  const track = box ? box.layer.track : null;
  const editable = box && box.layer.clip.type !== 'audio' && !track?.locked;

  const toProject = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const begin = (e: RPointerEvent, mode: Mode, clipId: string) => {
    const st = getState();
    const clip = st.project.clips.find((c) => c.id === clipId);
    const b = engine.boxOf(clipId);
    if (!clip || !b) return;
    const p = toProject(e);
    const lt = st.time - clip.start;
    (ref.current as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      mode,
      id: clipId,
      x0: p.x,
      y0: p.y,
      ox: clipValue(clip, 'x', lt),
      oy: clipValue(clip, 'y', lt),
      oscale: clipValue(clip, 'scale', lt),
      orot: clipValue(clip, 'rotation', lt),
      cx: b.cx,
      cy: b.cy,
      d0: Math.max(4, Math.hypot(p.x - b.cx, p.y - b.cy)),
      a0: Math.atan2(p.y - b.cy, p.x - b.cx),
      moved: false,
    };
  };

  const onStageDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = toProject(e);
    const hit = engine.hitTest(p.x, p.y);
    if (!hit) {
      getState().select([]);
      return;
    }
    if (!getState().selection.includes(hit) || getState().selection.length > 1) getState().select([hit]);
    begin(e, 'move', hit);
  };

  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toProject(e);
    const st = getState();
    if (!d.moved) {
      if (Math.hypot(p.x - d.x0, p.y - d.y0) * k < 3) return;
      d.moved = true;
      engine.pause();
      st.beginGesture();
    }
    const o = { history: false };
    if (d.mode === 'move') {
      let nx = d.ox + (p.x - d.x0) / pw;
      let ny = d.oy + (p.y - d.y0) / ph;
      const g = { v: Math.abs(nx) < 0.012, h: Math.abs(ny) < 0.012 };
      if (g.v) nx = 0;
      if (g.h) ny = 0;
      setGuides(g);
      st.setAnimated(d.id, 'x', nx, o);
      st.setAnimated(d.id, 'y', ny, o);
    } else if (d.mode === 'scale') {
      const dist = Math.hypot(p.x - d.cx, p.y - d.cy);
      st.setAnimated(d.id, 'scale', Math.min(10, Math.max(0.05, (d.oscale * dist) / d.d0)), o);
    } else {
      let deg = d.orot + ((Math.atan2(p.y - d.cy, p.x - d.cx) - d.a0) * 180) / Math.PI;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      for (const snapTo of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snapTo) < 3) deg = snapTo;
      st.setAnimated(d.id, 'rotation', deg, o);
    }
  };
  const onUp = () => {
    drag.current = null;
    setGuides({ v: false, h: false });
  };

  const handle = "absolute h-3.5 w-3.5 rounded-full border-2 border-ink bg-fg shadow before:absolute before:-inset-3 before:content-['']";
  return (
    <div ref={ref} className="absolute inset-0" style={{ touchAction: 'none' }} onPointerDown={onStageDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent" />}
      {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-accent" />}
      {box && editable && (
        <div
          className="pointer-events-none absolute border-[1.5px] border-fg/90"
          style={{ left: (box.cx - box.w / 2) * k, top: (box.cy - box.h / 2) * k, width: box.w * k, height: box.h * k, transform: `rotate(${box.rotation}deg)` }}
        >
          {(['-left-2 -top-2', '-right-2 -top-2', '-left-2 -bottom-2', '-right-2 -bottom-2'] as const).map((pos) => (
            <div
              key={pos}
              className={cx(handle, pos, 'pointer-events-auto cursor-nwse-resize')}
              onPointerDown={(e) => {
                e.stopPropagation();
                begin(e, 'scale', box.layer.clip.id);
              }}
            />
          ))}
          <div
            className={cx('pointer-events-auto absolute left-1/2 flex h-6 w-6 -translate-x-1/2 cursor-grab items-center justify-center rounded-full border-2 border-ink bg-fg text-ink shadow', (box.cy + box.h / 2) * k > ph * k - 26 && Math.abs(box.rotation) < 20 ? 'bottom-3' : '-bottom-9')}
            onPointerDown={(e) => {
              e.stopPropagation();
              begin(e, 'rotate', box.layer.clip.id);
            }}
          >
            <RotateCw size={11} strokeWidth={3} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Preview() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pw = useStore((s) => s.project.width);
  const ph = useStore((s) => s.project.height);
  const empty = useStore((s) => s.project.clips.length === 0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const aw = el.clientWidth - 24;
      const ah = el.clientHeight - 24;
      const s = Math.max(0.01, Math.min(aw / pw, ah / ph));
      setSize({ w: Math.floor(pw * s), h: Math.floor(ph * s) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [pw, ph]);

  useEffect(() => {
    if (!canvas.current) return;
    engine.attach(canvas.current);
    return () => engine.detach();
  }, []);

  useEffect(() => {
    if (!size.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cap = Math.min(1, 1600 / Math.max(size.w * dpr, size.h * dpr));
    engine.resize(size.w * dpr * cap, size.h * dpr * cap);
  }, [size.w, size.h]);

  return (
    <div ref={wrap} className="stage-bg relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div className="relative shadow-[0_18px_60px_rgba(0,0,0,0.6),0_0_0_1px_var(--color-line)]" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvas} className="block h-full w-full bg-black" />
        <Overlay k={size.w / pw} />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
            <span className="font-display text-[22px] tracking-tight text-fg/85">Offcut</span>
            <span className="max-w-[80%] text-[11.5px] leading-snug text-muted">Import a clip to begin. Nothing is uploaded.</span>
          </div>
        )}
        {engine.error && <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-[12px] text-danger">{engine.error}</div>}
      </div>
    </div>
  );
}

export function Transport({ compact }: { compact: boolean }) {
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const project = useStore((s) => s.project);
  const duration = projectDuration(project);
  const fps = project.fps;
  const [ratioOpen, setRatioOpen] = useState(false);
  const ratio = CANVAS_PRESETS.find((p) => p.w === project.width && p.h === project.height);
  const stepF = (n: number) => {
    engine.pause();
    engine.seek(Math.round(getState().time * fps + n) / fps);
  };
  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 border-t border-line bg-panel px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap">
        <span className="font-mono text-[12.5px] tabular-nums text-fg">{formatTime(time, fps)}</span>
        <span className="font-mono text-[11.5px] tabular-nums text-faint">/ {compact ? formatTime(duration, fps).slice(0, 5) : formatTime(duration, fps)}</span>
      </div>
      <div className="flex items-center gap-0.5">
        {!compact && (
          <IconBtn label="Go to start (Home)" onClick={() => engine.seek(0)}>
            <ChevronFirst size={17} />
          </IconBtn>
        )}
        <IconBtn label="Previous frame (←)" onClick={() => stepF(-1)}>
          <StepBack size={15} />
        </IconBtn>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          title="Play / pause (Space)"
          onClick={() => engine.toggle()}
          className="mx-1 flex h-9 w-9 items-center justify-center rounded-full bg-fg text-ink transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <IconBtn label="Next frame (→)" onClick={() => stepF(1)}>
          <StepForward size={15} />
        </IconBtn>
        {!compact && (
          <IconBtn label="Go to end (End)" onClick={() => engine.seek(duration)}>
            <ChevronLast size={17} />
          </IconBtn>
        )}
      </div>
      <div className="flex flex-1 items-center justify-end gap-1">
        <button type="button" onClick={() => setRatioOpen(!ratioOpen)} className="flex h-7 items-center gap-1.5 rounded-lg border border-line px-2 font-mono text-[11.5px] text-muted hover:border-line-strong hover:text-fg" title="Canvas size">
          <span className="block rounded-[2px] border border-current" style={{ width: project.width >= project.height ? 13 : 13 * (project.width / project.height), height: project.height > project.width ? 13 : 13 * (project.height / project.width) }} />
          {ratio?.label ?? `${project.width}×${project.height}`}
        </button>
        {!compact && (
          <IconBtn label="Fullscreen preview" onClick={() => document.querySelector('.stage-bg')?.requestFullscreen?.()}>
            <Maximize size={15} />
          </IconBtn>
        )}
        {ratioOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setRatioOpen(false)} />
            <div className="absolute bottom-full right-2 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-line-strong bg-raised py-1 shadow-2xl">
              {CANVAS_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    getState().setCanvas(p.w, p.h);
                    setRatioOpen(false);
                  }}
                  className={cx('flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover', ratio?.id === p.id && 'text-accent')}
                >
                  <span className="flex w-5 justify-center">
                    <span className="block rounded-[2px] border border-current" style={{ width: p.w >= p.h ? 16 : 16 * (p.w / p.h), height: p.h > p.w ? 16 : 16 * (p.h / p.w) }} />
                  </span>
                  <span className="font-mono text-[12px]">{p.label}</span>
                  <span className="truncate text-[11px] text-muted">{p.hint}</span>
                </button>
              ))}
              <label className="mt-1 flex cursor-pointer items-center justify-between border-t border-line px-3 py-2 text-[12px] text-muted">
                Canvas background
                <input type="color" className="oc-color" aria-label="Canvas background colour" value={project.background} onChange={(e) => getState().patchProject({ background: e.target.value })} />
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

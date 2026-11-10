import { AudioLines, Copy, Eye, EyeOff, Film, Image as ImageIcon, Lock, LockOpen, Magnet, Maximize2, Minus, Music, Plus, Scissors, Trash2, Type, Volume2, VolumeX } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { transitionDuration } from '../lib/anim';
import { engine } from '../lib/engine';
import { importFiles } from '../lib/media';
import { PEAKS_PER_SEC, runtime } from '../lib/runtime';
import { clipEnd, getState, projectDuration, trackKindFor, useStore } from '../lib/store';
import { clamp, formatClock } from '../lib/util';
import type { AnimProp, Asset, Clip, Track, TrackKind } from '../types';
import { cx, IconBtn } from './ui';

const ROW_H: Record<TrackKind, number> = { video: 60, text: 32, audio: 46 };
const RULER_H = 28;
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

const Wave = memo(function Wave({ assetId, from, span, width, height, color, bottom }: { assetId: string; from: number; span: number; width: number; height: number; color: string; bottom?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tick = useStore((s) => s.mediaTick);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = Math.max(1, Math.min(Math.ceil(width), 2600));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, height);
    const peaks = runtime.get(assetId)?.peaks;
    if (!peaks) return;
    ctx.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const i0 = Math.floor((from + (x / w) * span) * PEAKS_PER_SEC);
      const i1 = Math.max(i0 + 1, Math.floor((from + ((x + 1) / w) * span) * PEAKS_PER_SEC));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const h = Math.max(1, Math.pow(m, 0.75) * height);
      ctx.fillRect(x, bottom ? height - h : (height - h) / 2, 1, h);
    }
  }, [assetId, from, span, width, height, color, bottom, tick]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-x-0 bottom-0 block w-full" style={{ height }} />;
});

const Filmstrip = memo(function Filmstrip({ clip, asset, width, height, zoom }: { clip: Clip; asset: Asset; width: number; height: number; zoom: number }) {
  useStore((s) => s.mediaTick);
  const strip = runtime.get(asset.id)?.strip;
  if (clip.type === 'image' || !strip) {
    return asset.thumb ? <div className="absolute inset-0 opacity-90" style={{ backgroundImage: `url(${asset.thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} /> : null;
  }
  let tileW = (height * strip.tw) / strip.th;
  let count = Math.ceil(width / tileW);
  if (count > 70) {
    count = 70;
    tileW = width / count;
  }
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const src = clip.inPoint + (((i + 0.5) * tileW) / zoom) * clip.speed;
    const idx = clamp(Math.floor((src / Math.max(0.01, asset.duration)) * strip.n), 0, strip.n - 1);
    tiles.push(<div key={i} className="absolute inset-y-0" style={{ left: i * tileW, width: tileW + 0.5, backgroundImage: `url(${strip.url})`, backgroundSize: `${strip.n * 100}% 100%`, backgroundPosition: `${strip.n > 1 ? (idx / (strip.n - 1)) * 100 : 0}% 0` }} />);
  }
  return <div className="absolute inset-0 opacity-90">{tiles}</div>;
});

type DragMode = 'move' | 'l' | 'r';
interface ClipViewProps {
  clip: Clip;
  asset?: Asset;
  zoom: number;
  rowH: number;
  selected: boolean;
  locked: boolean;
  missing: boolean;
  fps: number;
  prevDur?: number;
  onDown: (e: RPointerEvent, clip: Clip, mode: DragMode) => void;
  onMove: (e: RPointerEvent) => void;
  onUp: (e: RPointerEvent) => void;
}

const CLIP_BG: Record<string, string> = {
  video: 'bg-clip-video',
  image: 'bg-clip-image',
  audio: 'bg-clip-audio',
  text: 'bg-clip-text',
  caption: 'bg-clip-caption',
};

const ClipView = memo(function ClipView({ clip, asset, zoom, rowH, selected, locked, missing, onDown, onMove, onUp }: ClipViewProps) {
  const left = clip.start * zoom;
  const width = Math.max(3, clip.duration * zoom);
  const h = rowH - 6;
  const kind = clip.type === 'text' && clip.caption ? 'caption' : clip.type;
  const kfTimes = useMemo(() => {
    const set = new Set<number>();
    for (const k of Object.keys(clip.keyframes) as AnimProp[]) for (const f of clip.keyframes[k]!) if (f.t >= -1e-3 && f.t <= clip.duration + 1e-3) set.add(Math.round(f.t * 1000) / 1000);
    return [...set];
  }, [clip.keyframes, clip.duration]);
  const hasAudio = clip.type === 'video' && asset?.hasAudio && !clip.muted && clip.volume > 0;
  const trW = clip.transitionIn ? Math.min(width, transitionDuration(clip) * zoom) : 0;
  return (
    <div
      data-clip={clip.id}
      onPointerDown={(e) => onDown(e, clip, 'move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={cx(
        'group/clip absolute top-[3px] overflow-hidden rounded-md text-white',
        CLIP_BG[kind],
        selected ? 'z-10 shadow-[0_0_0_2px_var(--color-fg)]' : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]',
        locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
      )}
      style={{ left, width, height: h, touchAction: selected && !locked ? 'none' : 'pan-x pan-y' }}
    >
      {(clip.type === 'video' || clip.type === 'image') && asset && width > 14 && <Filmstrip clip={clip} asset={asset} width={width} height={h} zoom={zoom} />}
      {clip.type === 'audio' && asset && <Wave assetId={asset.id} from={clip.inPoint} span={clip.duration * clip.speed} width={width} height={h - 14} color="rgba(255,255,255,0.75)" />}
      {hasAudio && asset && width > 20 && (
        <div className="absolute inset-x-0 bottom-0 h-[15px] bg-black/55">
          <Wave assetId={asset.id} from={clip.inPoint} span={clip.duration * clip.speed} width={width} height={15} color="rgba(140,230,215,0.9)" bottom />
        </div>
      )}
      {trW > 0 && (
        <div className="pointer-events-none absolute inset-y-0 left-0 border-r border-white/50 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.4)_0_3px,rgba(0,0,0,0.25)_3px_6px)]" style={{ width: trW }} title="Transition" />
      )}
      {width > 34 && (
        <div className={cx('pointer-events-none absolute top-0 flex max-w-full items-center gap-1 px-1.5 text-[10.5px] font-medium leading-[16px]', selected && !locked ? 'left-3 [@media(pointer:coarse)]:left-5' : 'left-0', clip.type !== 'text' && 'rounded-br-md bg-black/50')} style={clip.type === 'text' ? { lineHeight: `${h}px` } : undefined}>
          {clip.type === 'text' && <Type size={11} className="shrink-0 opacity-80" />}
          <span className="truncate">{clip.type === 'text' ? clip.text.replace(/\n/g, ' ') || 'Text' : clip.name}</span>
          {clip.speed !== 1 && <span className="shrink-0 rounded bg-white/25 px-1 font-mono text-[9px]">{clip.speed.toFixed(2).replace(/0$/, '')}×</span>}
          {missing && <span className="shrink-0 rounded bg-danger px-1 text-[9px] text-black">offline</span>}
          {clip.removeBg && <span className="shrink-0 rounded bg-white/25 px-1 text-[9px]">cutout</span>}
        </div>
      )}
      {kfTimes.map((t) => (
        <span key={t} className="kf-diamond pointer-events-none absolute bottom-[3px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" style={{ left: Math.max(2, Math.min(width - 10, t * zoom - 4)) }} />
      ))}
      {selected && !locked && (
        <>
          <div onPointerDown={(e) => onDown(e, clip, 'l')} className="absolute inset-y-0 left-0 flex w-3 cursor-ew-resize items-center justify-center rounded-l-md bg-fg [@media(pointer:coarse)]:w-5" style={{ touchAction: 'none' }}>
            <span className="h-3.5 w-[2px] rounded bg-ink/70" />
          </div>
          <div onPointerDown={(e) => onDown(e, clip, 'r')} className="absolute inset-y-0 right-0 flex w-3 cursor-ew-resize items-center justify-center rounded-r-md bg-fg [@media(pointer:coarse)]:w-5" style={{ touchAction: 'none' }}>
            <span className="h-3.5 w-[2px] rounded bg-ink/70" />
          </div>
        </>
      )}
    </div>
  );
});

function Playhead({ headerW, scroller }: { headerW: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const time = useStore((s) => s.time);
  const zoom = useStore((s) => s.zoom);
  const x = time * zoom;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const viewW = el.clientWidth - headerW;
    if (x > el.scrollLeft + viewW - 24) el.scrollLeft = x - (getState().playing ? 60 : viewW - 80);
    else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
  }, [x, headerW, scroller]);
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-[32] w-0" style={{ left: headerW, transform: `translateX(${x}px)` }}>
      <div className="absolute bottom-0 top-0 -ml-px w-[2px] bg-accent" />
      <div className="absolute -left-[6px] top-0 h-[14px] w-[12px] rounded-b-[5px] rounded-t-[2px] bg-accent" />
    </div>
  );
}

function TrackHeader({ track, compact, width, height }: { track: Track; compact: boolean; width: number; height: number }) {
  const patch = useStore((s) => s.patchTrack);
  const remove = useStore((s) => s.removeTrack);
  const Icon = track.kind === 'video' ? Film : track.kind === 'text' ? Type : Music;
  const small = '!h-6 !w-6 rounded-md';
  return (
    <div className="group/th sticky left-0 z-[36] flex shrink-0 items-center gap-0.5 border-r border-line bg-panel px-1" style={{ width, height }}>
      {!compact && (
        <button type="button" onDoubleClick={() => remove(track.id)} title={`${track.name} — double-click to delete track`} className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 text-left text-[11px] text-muted">
          <Icon size={12} className="shrink-0 text-faint" />
          <span className="truncate">{track.name}</span>
        </button>
      )}
      <div className={cx('flex items-center', compact && 'w-full flex-col justify-center')}>
        {track.kind !== 'audio' && (
          <IconBtn label={track.hidden ? 'Show track' : 'Hide track'} className={small} active={track.hidden} onClick={() => patch(track.id, { hidden: !track.hidden })}>
            {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </IconBtn>
        )}
        {track.kind !== 'text' && (!compact || track.kind === 'audio') && (
          <IconBtn label={track.muted ? 'Unmute track' : 'Mute track'} className={small} active={track.muted} onClick={() => patch(track.id, { muted: !track.muted })}>
            {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </IconBtn>
        )}
        {!compact && (
          <IconBtn label={track.locked ? 'Unlock track' : 'Lock track'} className={small} active={track.locked} onClick={() => patch(track.id, { locked: !track.locked })}>
            {track.locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </IconBtn>
        )}
      </div>
    </div>
  );
}

interface DragState {
  mode: DragMode;
  clip: Clip;
  x0: number;
  y0: number;
  scroll0: number;
  moved: boolean;
  origs: Clip[];
  wasSelected: boolean;
}

export function Timeline({ compact, onImport }: { compact: boolean; onImport: () => void }) {
  const tracks = useStore((s) => s.project.tracks);
  const clips = useStore((s) => s.project.clips);
  const assets = useStore((s) => s.project.assets);
  const fps = useStore((s) => s.project.fps);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const snapping = useStore((s) => s.snapping);
  const mediaTick = useStore((s) => s.mediaTick);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lanes = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<DragState | null>(null);
  const [viewW, setViewW] = useState(900);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [trackMenu, setTrackMenu] = useState(false);
  const [dropping, setDropping] = useState(false);
  const headerW = compact ? 34 : 150;
  const duration = useMemo(() => clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0), [clips]);
  const contentW = Math.max(viewW - headerW, (duration + 2) * zoom + viewW * 0.45);
  const assetMap = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      return Math.max(0, (clientX - r.left - headerW + el.scrollLeft) / getState().zoom);
    },
    [headerW],
  );
  const trackAtY = useCallback((clientY: number) => {
    for (const [id, el] of lanes.current) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return id;
    }
    return undefined;
  }, []);

  // ctrl/⌘ + wheel zooms around the cursor
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const st = getState();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left - headerW;
      const t = (px + el.scrollLeft) / st.zoom;
      const nz = clamp(st.zoom * Math.exp(-e.deltaY * 0.004), 4, 600);
      st.setZoom(nz);
      requestAnimationFrame(() => (el.scrollLeft = Math.max(0, t * nz - px)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [headerW]);

  const setZoomCentered = (nz: number) => {
    const el = scrollRef.current;
    const st = getState();
    st.setZoom(nz);
    if (el) requestAnimationFrame(() => (el.scrollLeft = Math.max(0, st.time * clamp(nz, 4, 600) - (el.clientWidth - headerW) / 2)));
  };
  const fit = () => {
    const d = Math.max(1, projectDuration(getState().project));
    getState().setZoom((viewW - headerW - 48) / d);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const snap = useCallback((edges: number[], ignore: string[]): { diff: number; at: number } | null => {
    const st = getState();
    if (!st.snapping) return null;
    const thr = 9 / st.zoom;
    const targets = [0, st.time];
    for (const c of st.project.clips) if (!ignore.includes(c.id)) targets.push(c.start, clipEnd(c));
    let best: { diff: number; at: number } | null = null;
    for (const e of edges)
      for (const t of targets) {
        const diff = t - e;
        if (Math.abs(diff) < thr && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, at: t };
      }
    return best;
  }, []);

  const onDown = useCallback((e: RPointerEvent, clip: Clip, mode: DragMode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const st = getState();
    const track = st.project.tracks.find((t) => t.id === clip.trackId);
    const was = st.selection.includes(clip.id);
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      st.select([clip.id], true);
      return;
    }
    if (!was) st.select([clip.id]);
    if (track?.locked) return;
    if (e.pointerType === 'touch' && !was) return;
    const root = (e.currentTarget as HTMLElement).closest('[data-clip]') as HTMLElement;
    root.setPointerCapture(e.pointerId);
    const ids = was && mode === 'move' ? st.selection : [clip.id];
    drag.current = { mode, clip, x0: e.clientX, y0: e.clientY, scroll0: scrollRef.current!.scrollLeft, moved: false, origs: st.project.clips.filter((c) => ids.includes(c.id)), wasSelected: was };
  }, []);

  const onMove = useCallback(
    (e: RPointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dxPx = e.clientX - d.x0 + (scrollRef.current!.scrollLeft - d.scroll0);
      if (!d.moved) {
        if (Math.abs(dxPx) < 4 && Math.abs(e.clientY - d.y0) < 8) return;
        d.moved = true;
        engine.pause();
        getState().beginGesture();
      }
      const st = getState();
      const dt = dxPx / st.zoom;
      const ids = d.origs.map((c) => c.id);
      if (d.mode === 'move') {
        let delta = Math.max(dt, -Math.min(...d.origs.map((c) => c.start)));
        const s = snap([d.clip.start + delta, clipEnd(d.clip) + delta], ids);
        if (s && d.clip.start + delta + s.diff >= 0) {
          delta += s.diff;
          setSnapLine(s.at);
        } else setSnapLine(null);
        let trackId: string | undefined;
        if (d.origs.length === 1) {
          const tid = trackAtY(e.clientY);
          const tr = st.project.tracks.find((t) => t.id === tid);
          if (tr && tr.kind === trackKindFor(d.clip.type) && !tr.locked) trackId = tr.id;
        }
        st.commit(
          (p) => ({
            ...p,
            clips: p.clips.map((c) => {
              const o = d.origs.find((x) => x.id === c.id);
              return o ? { ...c, start: Math.max(0, o.start + delta), trackId: trackId ?? c.trackId } : c;
            }),
          }),
          { history: false },
        );
      } else {
        let edge = d.mode === 'l' ? d.clip.start + dt : clipEnd(d.clip) + dt;
        const s = snap([edge], ids);
        if (s) {
          edge += s.diff;
          setSnapLine(s.at);
        } else setSnapLine(null);
        st.trimEdge(d.clip, d.mode, edge);
        const now = getState().project.clips.find((c) => c.id === d.clip.id);
        if (now) engine.seek(d.mode === 'l' ? now.start : Math.max(now.start, clipEnd(now) - 1 / getState().project.fps));
      }
    },
    [snap, trackAtY],
  );

  const onUp = useCallback((e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setSnapLine(null);
    if (!d) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (d.moved) {
      if (d.mode === 'move') getState().endGesture(d.origs.map((c) => c.id));
    } else if (d.mode === 'move' && d.wasSelected && getState().selection.length > 1) getState().select([d.clip.id]);
  }, []);

  const scrub = useRef(false);
  const onRulerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    scrub.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    engine.seek(timeAt(e.clientX));
  };
  const onRulerMove = (e: RPointerEvent) => {
    if (scrub.current) engine.seek(timeAt(e.clientX));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const at = timeAt(e.clientX);
    const trackId = trackAtY(e.clientY);
    const id = e.dataTransfer.getData('application/x-offcut-asset');
    if (id) {
      getState().addClipFromAsset(id, { at, trackId });
      return;
    }
    if (e.dataTransfer.files.length) {
      e.stopPropagation();
      let t = at;
      for (const a of await importFiles(e.dataTransfer.files)) {
        getState().addClipFromAsset(a.id, { at: t, trackId });
        t += a.kind === 'image' ? 4 : a.duration;
      }
    }
  };

  const step = STEPS.find((s) => s * zoom >= 68) ?? 3600;
  const labels = useMemo(() => {
    const out: number[] = [];
    const n = Math.min(600, Math.ceil(contentW / (step * zoom)));
    for (let i = 0; i <= n; i++) out.push(i * step);
    return out;
  }, [contentW, step, zoom]);

  const s = useStore.getState;
  const hasSel = selection.length > 0;
  const zl = Math.log(zoom);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      {/* toolbar */}
      <div className="scroll-thin flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5">
        <IconBtn label="Split at playhead (S)" onClick={() => s().splitAtPlayhead()}>
          <Scissors size={16} />
        </IconBtn>
        <IconBtn label="Trim start to playhead (Q)" onClick={() => s().trimToPlayhead('start')}>
          <span className="font-mono text-[13px] font-semibold leading-none">[←</span>
        </IconBtn>
        <IconBtn label="Trim end to playhead (W)" onClick={() => s().trimToPlayhead('end')}>
          <span className="font-mono text-[13px] font-semibold leading-none">→]</span>
        </IconBtn>
        <IconBtn label="Duplicate (Ctrl+D)" disabled={!hasSel} onClick={() => s().duplicateSelected()}>
          <Copy size={15} />
        </IconBtn>
        <IconBtn label="Delete (Del) · Shift+Del closes the gap" disabled={!hasSel} onClick={(e) => s().removeClips(s().selection, e.shiftKey)}>
          <Trash2 size={15} />
        </IconBtn>
        <span className="mx-1 h-4 w-px shrink-0 bg-line" />
        <IconBtn label={snapping ? 'Snapping on' : 'Snapping off'} active={snapping} onClick={() => useStore.setState({ snapping: !snapping })}>
          <Magnet size={15} />
        </IconBtn>
        <div className="relative">
          <button type="button" onClick={() => setTrackMenu(!trackMenu)} className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] text-muted hover:bg-hover hover:text-fg">
            <Plus size={14} /> {compact ? '' : 'Track'}
          </button>
          {trackMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setTrackMenu(false)} />
              <div className="fixed z-50 mt-1 w-40 overflow-hidden rounded-xl border border-line-strong bg-raised py-1 shadow-2xl" style={{ transform: 'translateY(0)' }}>
                {(
                  [
                    ['video', 'Overlay track', Film],
                    ['text', 'Text track', Type],
                    ['audio', 'Audio track', AudioLines],
                  ] as const
                ).map(([k, label, Icon]) => (
                  <button
                    key={k}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-hover"
                    onClick={() => {
                      s().addTrack(k);
                      setTrackMenu(false);
                    }}
                  >
                    <Icon size={14} className="text-muted" /> {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex-1" />
        {!compact && <span className="mr-2 shrink-0 font-mono text-[11px] text-faint">{clips.length} clips · {formatClock(duration)}</span>}
        <IconBtn label="Zoom out (−)" onClick={() => setZoomCentered(zoom / 1.4)}>
          <Minus size={15} />
        </IconBtn>
        {!compact && (
          <input
            type="range"
            aria-label="Timeline zoom"
            className="oc-range !w-28 shrink-0"
            min={Math.log(4)}
            max={Math.log(600)}
            step={0.01}
            value={zl}
            style={{ '--p': `${((zl - Math.log(4)) / (Math.log(600) - Math.log(4))) * 100}%` } as React.CSSProperties}
            onChange={(e) => setZoomCentered(Math.exp(Number(e.target.value)))}
          />
        )}
        <IconBtn label="Zoom in (+)" onClick={() => setZoomCentered(zoom * 1.4)}>
          <Plus size={15} />
        </IconBtn>
        <IconBtn label="Fit timeline (Shift+Z)" onClick={fit}>
          <Maximize2 size={14} />
        </IconBtn>
      </div>

      {/* tracks */}
      <div
        ref={scrollRef}
        className={cx('scroll-thin relative min-h-0 flex-1 overflow-auto overscroll-contain', dropping && 'bg-accent/5')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-offcut-asset') || e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!dropping) setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <div className="relative min-h-full" style={{ width: headerW + contentW }}>
          <div className="sticky top-0 z-30 flex border-b border-line bg-panel" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-40 shrink-0 border-r border-line bg-panel" style={{ width: headerW }} />
            <div
              className="ruler-ticks relative flex-1 cursor-col-resize"
              style={{ touchAction: 'none', backgroundSize: `${(step * zoom) / 5}px 5px` }}
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={() => (scrub.current = false)}
              onPointerCancel={() => (scrub.current = false)}
            >
              {labels.map((t) => (
                <span key={t} className="pointer-events-none absolute top-0 h-full border-l border-line-strong pl-1 pt-0.5 font-mono text-[10px] text-faint" style={{ left: t * zoom }}>
                  {step < 1 ? `${t.toFixed(1)}s` : formatClock(t).replace(/\.0s$/, 's')}
                </span>
              ))}
            </div>
          </div>

          {tracks.map((track) => {
            const h = ROW_H[track.kind];
            const list = clips.filter((c) => c.trackId === track.id);
            return (
              <div key={track.id} className={cx('flex border-b border-line/70', track.kind === 'video' && 'bg-white/[0.012]')} style={{ height: h }}>
                <TrackHeader track={track} compact={compact} width={headerW} height={h} />
                <div
                  ref={(el) => {
                    if (el) lanes.current.set(track.id, el);
                    else lanes.current.delete(track.id);
                  }}
                  className={cx('relative flex-1', track.hidden && 'opacity-40')}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    engine.seek(timeAt(e.clientX));
                    getState().select([]);
                  }}
                >
                  {list.map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      asset={clip.assetId ? assetMap.get(clip.assetId) : undefined}
                      zoom={zoom}
                      rowH={h}
                      fps={fps}
                      selected={selection.includes(clip.id)}
                      locked={track.locked}
                      missing={!!clip.assetId && mediaTick >= 0 && !runtime.has(clip.assetId)}
                      onDown={onDown}
                      onMove={onMove}
                      onUp={onUp}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {clips.length === 0 && (
            <button type="button" onClick={onImport} className="absolute flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-muted transition-colors hover:border-accent hover:text-fg" style={{ left: headerW + 12, top: RULER_H + 10, width: Math.min(viewW - headerW - 24, 520), height: 88 }}>
              <span className="flex items-center gap-2 text-[13px] font-medium text-fg">
                <ImageIcon size={15} className="text-accent" /> Drop video, audio or images here
              </span>
              <span className="text-[11.5px]">or tap to import — files stay on this device</span>
            </button>
          )}

          <Playhead headerW={headerW} scroller={scrollRef} />
          {snapLine !== null && <div className="pointer-events-none absolute bottom-0 top-0 z-[14] w-px bg-fg/80" style={{ left: headerW + snapLine * zoom }} />}
        </div>
      </div>
    </div>
  );
}

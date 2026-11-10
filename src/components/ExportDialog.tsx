import { Check, Download, Film, Share2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { engine } from '../lib/engine';
import { estimateBitrate, exportDims, exportVideo, type ExportOptions, type ExportResult } from '../lib/exporter';
import { projectDuration, useStore } from '../lib/store';
import { downloadBlob, formatBytes, formatClock } from '../lib/util';
import { Btn, cx, Note, Progress, Segmented } from './ui';

const RES = [
  { v: 720, label: '720p' },
  { v: 1080, label: '1080p' },
  { v: 1440, label: '2K' },
  { v: 2160, label: '4K' },
];

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const close = () => useStore.setState({ exportOpen: false });
  const duration = projectDuration(project);
  const [o, setO] = useState<Pick<ExportOptions, 'resolution' | 'fps' | 'quality' | 'format'>>({ resolution: 1080, fps: project.fps === 60 ? 60 : 30, quality: 'high', format: 'mp4' });
  const [phase, setPhase] = useState<'setup' | 'rendering' | 'done' | 'error'>('setup');
  const [prog, setProg] = useState({ stage: '', progress: 0, frame: 0, frames: 0 });
  const [result, setResult] = useState<ExportResult | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [eta, setEta] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const started = useRef(0);
  const dims = exportDims(project, o.resolution);
  const bitrate = estimateBitrate(dims.width, dims.height, o.fps, o.quality);
  const size = ((bitrate + 192e3) * duration) / 8;

  useEffect(
    () => () => {
      abort.current?.abort();
      engine.suspended = false;
      engine.invalidate();
    },
    [],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'rendering') useStore.setState({ exportOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const start = async () => {
    setPhase('rendering');
    setError('');
    setEta(null);
    engine.pause();
    engine.suspended = true;
    abort.current = new AbortController();
    started.current = performance.now();
    try {
      const res = await exportVideo(project, {
        ...o,
        signal: abort.current.signal,
        onCanvas: (c) => {
          c.className = 'max-h-full max-w-full rounded-lg object-contain';
          c.style.cssText = 'max-height:100%;max-width:100%;width:auto;height:auto;';
          holder.current?.replaceChildren(c);
        },
        onProgress: (p) => {
          setProg(p);
          if (p.frame > 8) {
            const el = (performance.now() - started.current) / 1000;
            setEta((el / p.frame) * (p.frames - p.frame));
          }
        },
      });
      setResult(res);
      setUrl(URL.createObjectURL(res.blob));
      setPhase('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') setPhase('setup');
      else {
        console.error(e);
        setError((e as Error).message || String(e));
        setPhase('error');
      }
    } finally {
      engine.suspended = false;
      engine.invalidate();
    }
  };

  const fileName = `${(project.name || 'offcut').replace(/[\\/:*?"<>|]+/g, '-')}.${result?.ext ?? o.format}`;
  const canShare = !!result && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([result.blob], fileName, { type: result.blob.type })] });

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6" onClick={(e) => e.target === e.currentTarget && phase !== 'rendering' && close()}>
      <div role="dialog" aria-label="Export" className="oc-rise flex max-h-[94dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl border border-line-strong bg-panel shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">{phase === 'done' ? 'Your video is ready' : phase === 'rendering' ? 'Rendering on this device' : 'Export video'}</h2>
            <p className="text-[12px] text-muted">{phase === 'done' ? 'Saved nowhere but here — download it to keep it.' : `${formatClock(duration)} · no watermark · nothing uploaded`}</p>
          </div>
          <button type="button" aria-label="Close" disabled={phase === 'rendering'} onClick={close} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg disabled:opacity-30">
            <X size={17} />
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {phase === 'setup' && (
            <div className="space-y-4 pt-2">
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-muted">Resolution</span>
                  <span className="font-mono text-[11px] text-faint">
                    {dims.width} × {dims.height}
                  </span>
                </div>
                <Segmented value={o.resolution} onChange={(v) => setO({ ...o, resolution: v })} options={RES.map((r) => ({ value: r.v, label: r.label }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">Frame rate</span>
                  <Segmented value={o.fps} onChange={(v) => setO({ ...o, fps: v })} options={[24, 30, 60].map((f) => ({ value: f, label: `${f}` }))} />
                </div>
                <div>
                  <span className="mb-1.5 block text-[12px] font-medium text-muted">Format</span>
                  <Segmented value={o.format} onChange={(v) => setO({ ...o, format: v })} options={[{ value: 'mp4', label: 'MP4', title: 'H.264 + AAC — plays everywhere' }, { value: 'webm', label: 'WebM', title: 'VP9 + Opus' }]} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[12px] font-medium text-muted">Quality</span>
                  <span className="font-mono text-[11px] text-faint">
                    {(bitrate / 1e6).toFixed(1)} Mbps · ≈ {formatBytes(size)}
                  </span>
                </div>
                <Segmented value={o.quality} onChange={(v) => setO({ ...o, quality: v })} options={[{ value: 'good', label: 'Good' }, { value: 'high', label: 'High' }, { value: 'max', label: 'Maximum' }]} />
              </div>
              <Note>
                <ShieldCheck size={12} className="mr-1 inline -translate-y-px text-ok" />
                Frames are composited on your GPU and encoded with your device’s own hardware encoder (WebCodecs). The file is assembled in memory and handed straight to you.
              </Note>
              <Btn variant="primary" size="lg" className="w-full" disabled={duration <= 0} onClick={start}>
                <Film size={16} /> {duration <= 0 ? 'Add a clip to export' : `Export ${RES.find((r) => r.v === o.resolution)?.label} · ${o.fps} fps`}
              </Btn>
            </div>
          )}

          {phase === 'rendering' && (
            <div className="space-y-4 pt-2">
              <div ref={holder} className="flex h-[38dvh] max-h-[340px] items-center justify-center overflow-hidden rounded-xl bg-black" />
              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
                  <span className="text-fg">{prog.stage || 'Starting…'}</span>
                  <span className="font-mono text-muted">
                    {Math.round(prog.progress * 100)}%{eta !== null && eta > 1 ? ` · ${formatClock(eta)} left` : ''}
                  </span>
                </div>
                <Progress value={prog.frames ? prog.progress : null} className="h-1.5" />
                <p className="mt-1.5 font-mono text-[11px] text-faint">
                  frame {prog.frame} / {prog.frames}
                </p>
              </div>
              <Btn className="w-full" onClick={() => abort.current?.abort()}>
                Cancel
              </Btn>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="space-y-3.5 pt-2">
              <video src={url} controls playsInline className="max-h-[42dvh] w-full rounded-xl bg-black" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
                <span className="flex items-center gap-1 text-ok">
                  <Check size={12} /> {formatBytes(result.blob.size)}
                </span>
                <span>
                  {result.width}×{result.height}
                </span>
                <span>
                  {result.videoCodec}
                  {result.audioCodec ? ` + ${result.audioCodec}` : ' (no audio)'}
                </span>
                <span>rendered in {result.seconds.toFixed(1)}s</span>
              </div>
              {result.notes.map((n) => (
                <Note key={n} className="text-warn">
                  {n}
                </Note>
              ))}
              <div className={cx('grid gap-2', canShare ? 'grid-cols-2' : 'grid-cols-1')}>
                <Btn variant="primary" size="lg" onClick={() => downloadBlob(result.blob, fileName)}>
                  <Download size={16} /> Download
                </Btn>
                {canShare && (
                  <Btn size="lg" onClick={() => navigator.share({ files: [new File([result.blob], fileName, { type: result.blob.type })] }).catch(() => undefined)}>
                    <Share2 size={16} /> Share
                  </Btn>
                )}
              </div>
              <button type="button" className="w-full text-center text-[12px] text-muted hover:text-fg" onClick={() => setPhase('setup')}>
                Change settings and export again
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3 pt-2">
              <Note className="border-danger/40 text-danger">{error}</Note>
              <Btn className="w-full" onClick={() => setPhase('setup')}>
                Back to settings
              </Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

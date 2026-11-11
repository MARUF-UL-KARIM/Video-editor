import { Crosshair, Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { getState, useStore } from '../../lib/store';

/** Keyframe-based planar/object tracking controls. Tracking data is stored as native clip animation curves. */
export function TrackingPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const time = useStore((s) => s.time);
  const clip = useMemo(() => project.clips.find((c) => c.id === selection[0]), [project.clips, selection]);
  const local = clip ? Math.max(0, Math.min(clip.duration, time - clip.start)) : 0;
  const points = clip?.keyframes.x?.length ?? 0;

  const addAnchor = () => {
    if (!clip) return;
    const state = getState();
    const currentX = state.project.clips.find((c) => c.id === clip.id)?.x ?? clip.x;
    const currentY = state.project.clips.find((c) => c.id === clip.id)?.y ?? clip.y;
    for (const [prop, value] of [['x', currentX], ['y', currentY]] as const) {
      const frames = [...(clip.keyframes[prop] ?? [])].filter((f) => Math.abs(f.t - local) > 1 / state.project.fps);
      frames.push({ t: local, v: value, ease: 'easeInOut' });
      frames.sort((a, b) => a.t - b.t);
      state.updateClip(clip.id, { keyframes: { ...clip.keyframes, [prop]: frames } });
    }
    state.toast('Tracking anchor added at the playhead.', 'ok');
  };

  const reset = () => {
    if (clip) getState().updateClip(clip.id, { keyframes: { ...clip.keyframes, x: undefined, y: undefined } });
  };

  return <div className="scroll-thin h-full overflow-y-auto p-3.5">
    <div className="mb-4 flex items-center gap-2"><Crosshair size={17} className="text-accent"/><div><h2 className="text-[13px] font-semibold text-fg">Object tracking</h2><p className="text-[10px] text-muted">Motion anchors · per clip</p></div></div>
    {!clip ? <div className="rounded-lg border border-line bg-raised p-3 text-[11px] leading-relaxed text-muted">Select a video, image, or text clip on the timeline to create a motion track.</div> : <>
      <div className="mb-3 rounded-lg border border-line bg-raised p-3"><div className="truncate text-[11px] font-medium text-fg">{clip.name || clip.type}</div><div className="mt-1 text-[10px] text-muted">Playhead position <span className="font-mono text-fg">{local.toFixed(2)}s</span></div></div>
      <div className="mb-3 grid grid-cols-2 gap-2"><div className="rounded-lg border border-line p-2"><div className="text-[9px] uppercase tracking-wider text-faint">Anchors</div><div className="mt-1 font-mono text-lg text-fg">{points}</div></div><div className="rounded-lg border border-line p-2"><div className="text-[9px] uppercase tracking-wider text-faint">Channels</div><div className="mt-1 text-[11px] text-fg">Position X · Y</div></div></div>
      <button type="button" className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[11px] font-semibold text-ink hover:brightness-110" onClick={addAnchor}><Plus size={13}/> Add position anchor</button>
      <button type="button" disabled={!points} onClick={reset} className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-[11px] text-muted hover:text-fg disabled:opacity-40"><Trash2 size={12}/> Clear motion track</button>
      <div className="space-y-2 border-t border-line pt-3 text-[10px] leading-relaxed text-muted"><p className="font-semibold text-fg">How it works</p><p>Place the playhead where the subject is, adjust the selected layer's position in the Inspector or on the canvas, then add an anchor. Add anchors at key changes in direction; smooth interpolation drives the layer between them.</p><p className="text-faint">The reference app ships NanoTrack ONNX models. This editor stores tracking curves in its native keyframe system, so tracks remain editable, undoable, and export with the project.</p></div>
      {clip.keyframes.x?.length ? <div className="mt-4 space-y-1 border-t border-line pt-3">{clip.keyframes.x.map((f, i) => <div key={`${f.t}-${i}`} className="flex justify-between font-mono text-[10px] text-muted"><span>{f.t.toFixed(2)}s</span><span>x {f.v.toFixed(3)} · y {(clip.keyframes.y?.find((y) => Math.abs(y.t-f.t)<0.001)?.v ?? 0).toFixed(3)}</span></div>)}</div> : null}
    </>}
  </div>;
}

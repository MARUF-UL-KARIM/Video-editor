import { Check } from 'lucide-react';
import { useState } from 'react';
import { applyLook, applyTransition, visualTargets } from '../../lib/actions';
import { LOOKS, TRANSITIONS } from '../../lib/defaults';
import { getState, useStore } from '../../lib/store';
import type { Filters } from '../../types';
import { Btn, cx, PanelHeader, Slider } from '../ui';

function cssFilter(f: Partial<Filters>): string {
  const parts = [
    `brightness(${1 + (f.brightness ?? 0) / 220})`,
    `contrast(${1 + (f.contrast ?? 0) / 100 - (f.fade ?? 0) / 300})`,
    `saturate(${Math.max(0, 1 + (f.saturation ?? 0) / 100)})`,
    `hue-rotate(${(f.hue ?? 0) - (f.temperature ?? 0) * 0.12}deg)`,
  ];
  if ((f.temperature ?? 0) > 0) parts.push(`sepia(${(f.temperature ?? 0) / 160})`);
  if (f.blur) parts.push(`blur(${f.blur / 14}px)`);
  return parts.join(' ');
}

export function LooksPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const time = useStore((s) => s.time);
  void time;
  const targets = visualTargets();
  const target = project.clips.find((c) => c.id === targets[0]);
  const asset = project.assets.find((a) => a.id === target?.assetId);
  const visuals = project.clips.filter((c) => c.type === 'video' || c.type === 'image');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Looks" sub={target ? `Applies to ${selection.length > 1 ? `${targets.length} selected clips` : `“${target.name}”`}. Fine-tune under Adjust.` : 'Select a video or image clip, or park the playhead on one.'} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        <div className="grid grid-cols-3 gap-2">
          {LOOKS.map((l) => {
            const on = !!target && (target.look === l.id || (l.id === 'none' && !target.look));
            return (
              <button key={l.id} type="button" disabled={!target} onClick={() => applyLook(l.id, targets)} className="group text-left disabled:opacity-40">
                <span className={cx('relative block aspect-square overflow-hidden rounded-xl', on ? 'shadow-[0_0_0_2px_var(--color-accent)]' : 'shadow-[inset_0_0_0_1px_var(--color-line)]')}>
                  <span
                    className="block h-full w-full bg-cover bg-center"
                    style={{
                      backgroundImage: asset?.thumb ? `url(${asset.thumb})` : 'linear-gradient(135deg,#e8b27a 0%,#c4566b 35%,#3d6e8c 70%,#1f3b2f 100%)',
                      filter: cssFilter(l.f),
                    }}
                  />
                  {(l.f.vignette ?? 0) > 0 && <span className="absolute inset-0" style={{ background: `radial-gradient(circle, transparent 45%, rgba(0,0,0,${(l.f.vignette ?? 0) / 110}) 100%)` }} />}
                  {(l.f.fade ?? 0) > 0 && <span className="absolute inset-0 bg-white" style={{ opacity: (l.f.fade ?? 0) / 400 }} />}
                  {on && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className={cx('mt-1 block truncate text-center text-[11px]', on ? 'text-fg' : 'text-muted group-hover:text-fg')}>{l.name}</span>
              </button>
            );
          })}
        </div>
        {target && visuals.length > 1 && (
          <Btn
            className="mt-3 w-full"
            onClick={() => {
              getState().updateClips(
                visuals.map((c) => c.id),
                () => ({ filters: { ...target.filters }, look: target.look }),
              );
              getState().toast(`Look copied to ${visuals.length} clips`, 'ok');
            }}
          >
            Copy this look to all {visuals.length} clips
          </Btn>
        )}
      </div>
    </div>
  );
}

export function TransitionsPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [duration, setDuration] = useState(0.5);
  const sel = project.clips.find((c) => selection.length === 1 && c.id === selection[0] && c.type !== 'audio' && c.type !== 'text');
  const current = sel?.transitionIn?.type ?? null;
  const count = project.clips.filter((c) => c.transitionIn).length;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Transitions" sub={sel ? `Plays at the start of “${sel.name}”, blending from the clip before it.` : 'Tap one to add it at the cut nearest the playhead — or select a clip first.'} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        <Slider label="Length" value={duration} min={0.1} max={2} step={0.05} def={0.5} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => { setDuration(v); if (sel?.transitionIn) getState().updateClip(sel.id, { transitionIn: { ...sel.transitionIn, duration: v } }, { coalesce: 'trpanel' }); }} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          {TRANSITIONS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                const n = applyTransition(t.id, duration);
                if (n) getState().toast(`${t.name} added`, 'ok');
              }}
              className={cx('group flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl bg-raised transition-shadow', current === t.id ? 'shadow-[0_0_0_2px_var(--color-accent)]' : 'shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]')}
            >
              <span className="relative flex h-7 w-11 items-center justify-center overflow-hidden rounded-md bg-clip-video/60">
                <span className="absolute inset-y-0 right-0 w-1/2 bg-accent/80 transition-all duration-500 group-hover:w-full" />
                <span className="relative text-[13px] leading-none text-white">{t.glyph}</span>
              </span>
              <span className="px-1 text-center text-[10.5px] leading-tight text-muted group-hover:text-fg">{t.name}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Btn
            size="sm"
            onClick={() => {
              const n = applyTransition(current ?? 'crossfade', duration, true);
              if (n) getState().toast(`Added to ${n} cut${n > 1 ? 's' : ''}`, 'ok');
            }}
          >
            Apply to all cuts
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            disabled={!count}
            onClick={() =>
              getState().updateClips(
                sel?.transitionIn ? [sel.id] : project.clips.filter((c) => c.transitionIn).map((c) => c.id),
                () => ({ transitionIn: null }),
              )
            }
          >
            {sel?.transitionIn ? 'Remove this one' : `Remove all (${count})`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

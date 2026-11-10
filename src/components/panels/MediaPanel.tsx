import { AudioLines, Film, HardDrive, Image as ImageIcon, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { importFile } from '../../lib/media';
import { runtime } from '../../lib/runtime';
import { getState, useStore } from '../../lib/store';
import { formatBytes, formatClock } from '../../lib/util';
import type { Asset } from '../../types';
import { Btn, cx, PanelHeader } from '../ui';

function AssetCard({ asset }: { asset: Asset }) {
  const tick = useStore((s) => s.mediaTick);
  const used = useStore((s) => s.project.clips.filter((c) => c.assetId === asset.id).length);
  const missing = tick >= 0 && !runtime.has(asset.id);
  const Icon = asset.kind === 'video' ? Film : asset.kind === 'audio' ? AudioLines : ImageIcon;
  return (
    <div
      draggable={!missing}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-offcut-asset', asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="group relative overflow-hidden rounded-xl bg-raised shadow-[inset_0_0_0_1px_var(--color-line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
    >
      <button type="button" disabled={missing} onClick={() => getState().addClipFromAsset(asset.id)} title="Add to timeline" className="relative block aspect-[4/3] w-full overflow-hidden bg-ink">
        {asset.thumb ? (
          <img src={asset.thumb} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-[repeating-linear-gradient(90deg,var(--color-clip-audio)_0_2px,transparent_2px_6px)] opacity-70">
            <span className="rounded-full bg-ink p-2 text-clip-audio">
              <AudioLines size={20} />
            </span>
          </span>
        )}
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
          <Icon size={10} /> {asset.kind === 'image' ? `${asset.width}×${asset.height}` : formatClock(asset.duration)}
        </span>
        {used > 0 && <span className="absolute left-1 top-1 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">in use{used > 1 ? ` ×${used}` : ''}</span>}
        {missing && <span className="absolute inset-0 flex items-center justify-center bg-black/75 px-2 text-center text-[11px] text-warn">Offline — re-import this file to relink</span>}
        <span className={cx('absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition-opacity', 'opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100')}>
          <Plus size={16} strokeWidth={2.5} />
        </span>
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] text-fg" title={asset.name}>
            {asset.name}
          </span>
          <span className="block text-[10px] text-faint">{formatBytes(asset.size)}</span>
        </span>
        <button
          type="button"
          aria-label="Remove from project"
          title="Remove from project"
          onClick={() => {
            if (!used || confirm(`“${asset.name}” is used by ${used} clip${used > 1 ? 's' : ''}. Remove it and those clips?`)) getState().removeAsset(asset.id);
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-danger"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

export function MediaPanel({ onImport }: { onImport: () => void }) {
  const assets = useStore((s) => s.project.assets);
  const [loadingSample, setLoadingSample] = useState(false);
  const sample = async () => {
    setLoadingSample(true);
    try {
      const res = await fetch('/sample/sample-clip.mp4');
      if (!res.ok) throw new Error('missing');
      const blob = await res.blob();
      const a = await importFile(new File([blob], 'Sample clip.mp4', { type: 'video/mp4' }));
      if (a) getState().addClipFromAsset(a.id);
    } catch {
      getState().toast('Could not load the bundled sample clip', 'error');
    } finally {
      setLoadingSample(false);
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Media"
        sub="Read straight from your disk. Nothing is uploaded."
        right={
          <Btn variant="primary" size="sm" onClick={onImport}>
            <Upload size={13} /> Import
          </Btn>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
        {assets.length === 0 ? (
          <div className="oc-rise space-y-2.5 pt-1">
            <button type="button" onClick={onImport} className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line-strong px-4 py-8 text-center transition-colors hover:border-accent">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
                <Upload size={20} />
              </span>
              <span className="text-[13.5px] font-medium text-fg">Drop clips anywhere</span>
              <span className="text-[11.5px] leading-snug text-muted">Video, audio and images · MP4, MOV, WebM, MP3, WAV, PNG, JPG…</span>
            </button>
            <Btn className="w-full" disabled={loadingSample} onClick={sample}>
              <Film size={14} /> {loadingSample ? 'Loading sample…' : 'No footage handy? Load the sample clip'}
            </Btn>
            <div className="flex items-start gap-2 rounded-xl bg-raised px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
              <HardDrive size={14} className="mt-0.5 shrink-0 text-ok" />
              <span>Your project autosaves in this browser’s local storage. No account, no cloud, no watermark.</span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

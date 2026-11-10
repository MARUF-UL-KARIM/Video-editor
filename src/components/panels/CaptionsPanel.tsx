import { Captions, Download, FileUp, Plus, ShieldCheck, Trash2, Wand2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { autoCaption, captionBase, parseSrt, toSrt, type AutoCaptionOptions } from '../../lib/captions';
import { CAPTION_STYLES, DEFAULT_STYLE, LANGUAGES, WHISPER_MODELS } from '../../lib/defaults';
import { engine } from '../../lib/engine';
import { getState, useStore } from '../../lib/store';
import { downloadBlob, formatClock, rgba } from '../../lib/util';
import { Btn, cx, Field, Note, PanelHeader, Progress, Section, Segmented, Select, Slider } from '../ui';

export function CaptionsPanel() {
  const job = useStore((s) => s.jobs.find((j) => j.id === 'captions'));
  const clips = useStore((s) => s.project.clips);
  const time = useStore((s) => s.time);
  const hasSelection = useStore((s) => s.selection.some((id) => s.project.clips.find((c) => c.id === id && (c.type === 'video' || c.type === 'audio'))));
  const captions = useMemo(() => clips.filter((c) => c.caption).sort((a, b) => a.start - b.start), [clips]);
  const [o, setO] = useState<AutoCaptionOptions>({ model: 'base', language: 'auto', scope: 'timeline', maxWords: 4, style: 'pop', replace: true });
  const file = useRef<HTMLInputElement>(null);
  const model = WHISPER_MODELS.find((m) => m.id === o.model)!;

  const run = async () => {
    try {
      const n = await autoCaption({ ...o, scope: hasSelection ? o.scope : 'timeline' });
      getState().toast(`Added ${n} captions`, 'ok');
    } catch (e) {
      getState().toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Captions" sub="Speech-to-text that runs on your device." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <Section title="Auto captions">
          <div className="grid grid-cols-3 gap-1.5">
            {WHISPER_MODELS.map((m) => (
              <button key={m.id} type="button" onClick={() => setO({ ...o, model: m.id })} className={cx('rounded-lg px-1 py-2 text-center', o.model === m.id ? 'bg-hover shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-ink hover:bg-raised')}>
                <span className="block text-[12px] font-medium text-fg">{m.name}</span>
                <span className="block font-mono text-[10px] text-faint">{m.size}</span>
              </button>
            ))}
          </div>
          <Field label="Language">
            <Select value={o.language} onChange={(v) => setO({ ...o, language: v })} className="w-40">
              {LANGUAGES.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Slider label="Words per caption" value={o.maxWords} min={1} max={10} def={4} onChange={(v) => setO({ ...o, maxWords: v })} />
          {hasSelection && (
            <Field label="Transcribe">
              <Segmented value={o.scope} onChange={(v) => setO({ ...o, scope: v })} className="w-48" options={[{ value: 'timeline', label: 'Timeline' }, { value: 'selection', label: 'Selection' }]} />
            </Field>
          )}
          <div className="grid grid-cols-3 gap-1.5">
            {CAPTION_STYLES.map((cs) => {
              const s = { ...DEFAULT_STYLE, ...cs.style };
              return (
                <button key={cs.id} type="button" onClick={() => setO({ ...o, style: cs.id })} title={cs.name} className={cx('flex h-14 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg bg-[radial-gradient(circle_at_30%_20%,#3b4a44,#191b18_75%)]', o.style === cs.id ? 'shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : 'shadow-[inset_0_0_0_1px_var(--color-line)]')}>
                  <span
                    className="whitespace-nowrap leading-none"
                    style={{
                      fontFamily: `"${s.fontFamily}"`,
                      fontWeight: s.weight,
                      fontStyle: s.italic ? 'italic' : 'normal',
                      fontSize: 13,
                      color: s.color,
                      textTransform: s.uppercase ? 'uppercase' : 'none',
                      WebkitTextStroke: s.strokeWidth ? `2px ${s.strokeColor}` : undefined,
                      paintOrder: 'stroke fill',
                      background: s.bgOpacity > 0 ? rgba(s.bgColor, s.bgOpacity) : undefined,
                      padding: s.bgOpacity > 0 ? '2px 5px' : undefined,
                      borderRadius: 3,
                    }}
                  >
                    so{' '}
                    <span style={s.highlight === 'color' ? { color: s.highlightColor } : s.highlight === 'box' ? { background: s.highlightColor, borderRadius: 3, padding: '0 3px' } : undefined}>easy</span>
                  </span>
                  <span className="text-[9.5px] text-white/60">{cs.name}</span>
                </button>
              );
            })}
          </div>
          {job ? (
            <div className="space-y-1.5 rounded-lg bg-ink px-2.5 py-2.5">
              <div className="flex justify-between text-[11.5px] text-muted">
                <span>{job.label}</span>
                {job.progress !== null && <span className="font-mono">{Math.round(job.progress * 100)}%</span>}
              </div>
              <Progress value={job.progress} />
            </div>
          ) : (
            <Btn variant="primary" size="lg" className="w-full" onClick={run}>
              <Wand2 size={15} /> Generate captions
            </Btn>
          )}
          <Note>
            <ShieldCheck size={12} className="mr-1 inline -translate-y-px text-ok" />
            The first run downloads the {model.name.toLowerCase()} Whisper model ({model.size}) from Hugging Face and caches it in this browser. After that it works offline. Your audio is transcribed locally and never leaves this device.
          </Note>
        </Section>

        <Section title={`Caption list${captions.length ? ` · ${captions.length}` : ''}`}>
          <div className="flex gap-1.5">
            <Btn
              size="sm"
              className="flex-1"
              onClick={() => {
                const st = getState();
                st.addCaptions([{ start: st.time, end: st.time + 2, text: 'New caption' }], captionBase(o.style), false);
              }}
            >
              <Plus size={13} /> Add
            </Btn>
            <Btn size="sm" className="flex-1" onClick={() => file.current?.click()}>
              <FileUp size={13} /> Import SRT
            </Btn>
            <Btn size="sm" className="flex-1" disabled={!captions.length} onClick={() => downloadBlob(new Blob([toSrt()], { type: 'text/plain' }), `${getState().project.name || 'captions'}.srt`)}>
              <Download size={13} /> SRT
            </Btn>
            <input
              ref={file}
              type="file"
              accept=".srt,.vtt,text/plain"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const caps = parseSrt(await f.text());
                if (!caps.length) return getState().toast('No captions found in that file', 'error');
                getState().addCaptions(caps, captionBase(o.style), true);
                getState().toast(`Imported ${caps.length} captions`, 'ok');
              }}
            />
          </div>
          {captions.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-5 text-center text-[11.5px] text-faint">
              <Captions size={20} />
              No captions yet
            </div>
          ) : (
            <div className="space-y-1">
              {captions.map((c) => {
                const active = time >= c.start && time < c.start + c.duration;
                return (
                  <div key={c.id} className={cx('group flex items-start gap-2 rounded-lg px-2 py-1.5', active ? 'bg-hover' : 'hover:bg-raised')}>
                    <button type="button" onClick={() => { engine.seek(c.start + 0.01); getState().select([c.id]); }} className={cx('mt-0.5 shrink-0 font-mono text-[10.5px]', active ? 'text-accent' : 'text-faint hover:text-fg')}>
                      {formatClock(c.start)}
                    </button>
                    <input
                      value={c.text}
                      aria-label="Caption text"
                      onChange={(e) => getState().updateClip(c.id, { text: e.target.value }, { coalesce: 'cap' + c.id })}
                      onFocus={() => getState().select([c.id])}
                      className="min-w-0 flex-1 bg-transparent text-[12.5px] text-fg focus:outline-none"
                    />
                    <button type="button" aria-label="Delete caption" onClick={() => getState().removeClips([c.id])} className="shrink-0 text-faint opacity-0 hover:text-danger group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
              <button type="button" className="w-full pt-1 text-center text-[11px] text-faint hover:text-danger" onClick={() => getState().removeClips(captions.map((c) => c.id))}>
                Remove all captions
              </button>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

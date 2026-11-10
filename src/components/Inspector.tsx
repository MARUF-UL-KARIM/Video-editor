import { AlignCenter, AlignLeft, AlignRight, AudioLines, CaseUpper, Copy, Eraser, FlipHorizontal2, Italic, MousePointerClick, Scissors, Sparkles, Trash2, Unlink2 } from 'lucide-react';
import { useState } from 'react';
import { applyLook, applyMotion, cutSilences, detachAudio, setDenoise, type MotionPreset } from '../lib/actions';
import { previousAdjacent } from '../lib/anim';
import { CLIP_ANIMS, DEFAULT_FILTERS, FONTS, LOOKS, TRANSITIONS } from '../lib/defaults';
import { runtime } from '../lib/runtime';
import { segmenterState } from '../lib/segmenter';
import { clipValue, getState, useStore } from '../lib/store';
import { clamp, formatClock } from '../lib/util';
import type { AnimProp, Clip, ClipAnim, Ease, Filters, TextStyle, TransitionType } from '../types';
import { Btn, Color, cx, Field, IconBtn, Note, Section, Segmented, Select, Slider, Toggle } from './ui';

function KfButton({ clip, prop }: { clip: Clip; prop: AnimProp }) {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project.fps);
  const lt = time - clip.start;
  const kfs = clip.keyframes[prop];
  const onKey = !!kfs?.some((k) => Math.abs(k.t - clamp(lt, 0, clip.duration)) <= 0.5 / fps);
  return (
    <button
      type="button"
      title={onKey ? 'Remove keyframe' : 'Add keyframe at playhead'}
      aria-label={`Keyframe ${prop}`}
      onClick={() => getState().toggleKeyframe(clip.id, prop)}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-hover"
    >
      <span className={cx('kf-diamond block border-[1.5px]', onKey ? 'border-accent bg-accent' : kfs?.length ? 'border-accent' : 'border-faint')} />
    </button>
  );
}

function AnimSlider(p: { clip: Clip; prop: AnimProp; label: string; min: number; max: number; step?: number; k?: number; def: number; unit?: string }) {
  const time = useStore((s) => s.time);
  const k = p.k ?? 1;
  const v = clipValue(p.clip, p.prop, clamp(time - p.clip.start, 0, p.clip.duration)) * k;
  return (
    <Slider
      label={p.label}
      left={<KfButton clip={p.clip} prop={p.prop} />}
      value={v}
      min={p.min}
      max={p.max}
      step={p.step ?? 1}
      def={p.def}
      format={(x) => `${Math.round(x * 10) / 10}${p.unit ?? ''}`}
      onChange={(u) => getState().setAnimated(p.clip.id, p.prop, u / k, { coalesce: `${p.prop}:${p.clip.id}` })}
    />
  );
}

function TransformSection({ clip }: { clip: Clip }) {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project.fps);
  const upd = (patch: Partial<Clip>, key = 'misc') => getState().updateClip(clip.id, patch, { coalesce: key + clip.id });
  const lt = clamp(time - clip.start, 0, clip.duration);
  const hasKf = Object.keys(clip.keyframes).length > 0;
  const onKeyProps = (Object.keys(clip.keyframes) as AnimProp[]).filter((k) => clip.keyframes[k]!.some((f) => Math.abs(f.t - lt) <= 0.5 / fps));
  const ease = onKeyProps.length ? clip.keyframes[onKeyProps[0]]!.find((f) => Math.abs(f.t - lt) <= 0.5 / fps)!.ease : null;
  return (
    <Section
      title="Transform"
      right={
        <button type="button" className="text-[11px] text-faint hover:text-fg" onClick={() => getState().updateClip(clip.id, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, keyframes: {} })}>
          Reset
        </button>
      }
    >
      <AnimSlider clip={clip} prop="scale" label="Scale" min={5} max={400} k={100} def={100} unit="%" />
      <AnimSlider clip={clip} prop="x" label="Position X" min={-100} max={100} k={100} step={0.5} def={0} />
      <AnimSlider clip={clip} prop="y" label="Position Y" min={-100} max={100} k={100} step={0.5} def={0} />
      <AnimSlider clip={clip} prop="rotation" label="Rotation" min={-180} max={180} def={0} unit="°" />
      <AnimSlider clip={clip} prop="opacity" label="Opacity" min={0} max={100} k={100} def={100} unit="%" />
      {hasKf ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-ink/60 px-2 py-1.5">
          <span className="text-[11.5px] text-muted">{ease ? 'Ease out of this keyframe' : 'Keyframes active — move the playhead and change a value'}</span>
          {ease && (
            <Select<Ease> value={ease} onChange={(e) => onKeyProps.forEach((k) => getState().setKeyframeEase(clip.id, k, e))} className="w-28 shrink-0">
              <option value="linear">Linear</option>
              <option value="easeInOut">Smooth</option>
              <option value="easeIn">Ease in</option>
              <option value="easeOut">Ease out</option>
              <option value="hold">Hold</option>
            </Select>
          )}
          {!ease && (
            <button type="button" className="shrink-0 text-[11.5px] text-accent hover:underline" onClick={() => getState().clearKeyframes(clip.id)}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-faint">Tap a ◇ to drop a keyframe at the playhead, then move the playhead and change the value to animate.</p>
      )}
      {clip.type !== 'text' && (
        <>
          <Field label="Fit">
            <Segmented value={clip.fit} onChange={(v) => upd({ fit: v })} options={[{ value: 'contain', label: 'Fit' }, { value: 'cover', label: 'Fill' }]} className="w-32" />
            <IconBtn label="Flip horizontally" active={clip.flipH} onClick={() => upd({ flipH: !clip.flipH })}>
              <FlipHorizontal2 size={15} />
            </IconBtn>
          </Field>
          <Slider label="Corner radius" value={clip.radius} min={0} max={100} def={0} onChange={(v) => upd({ radius: v }, 'radius')} />
          <Field label="Blend">
            <Select value={clip.blend} onChange={(v) => upd({ blend: v })} className="w-32">
              <option value="normal">Normal</option>
              <option value="screen">Screen</option>
              <option value="add">Add</option>
              <option value="multiply">Multiply</option>
            </Select>
          </Field>
        </>
      )}
    </Section>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  return (
    <Section title="Speed">
      <Slider label="Playback speed" value={clip.speed} min={0.25} max={4} step={0.05} def={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => getState().setSpeed(clip.id, v)} />
      <div className="flex gap-1">
        {[0.5, 1, 1.5, 2, 3].map((v) => (
          <Btn key={v} size="sm" className="flex-1 px-0" active={Math.abs(clip.speed - v) < 0.01} onClick={() => getState().setSpeed(clip.id, v)}>
            {v}×
          </Btn>
        ))}
      </div>
      <p className="text-[11px] text-faint">Clip length on timeline: {formatClock(clip.duration)}. Audio pitch follows speed.</p>
    </Section>
  );
}

const ADJUST: { key: keyof Filters; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'temperature', label: 'Warmth', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'hue', label: 'Hue shift', min: -180, max: 180 },
  { key: 'fade', label: 'Fade', min: 0, max: 100 },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100 },
  { key: 'blur', label: 'Blur', min: 0, max: 100 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100 },
  { key: 'grain', label: 'Film grain', min: 0, max: 100 },
  { key: 'rgbSplit', label: 'RGB split', min: 0, max: 100 },
];

function AdjustTab({ clip }: { clip: Clip }) {
  const tick = useStore((s) => s.mediaTick);
  const setF = (key: keyof Filters, v: number) => getState().updateClip(clip.id, { filters: { ...clip.filters, [key]: v }, look: 'custom' }, { coalesce: `f:${key}:${clip.id}` });
  const upd = (patch: Partial<Clip>, key = 'bg') => getState().updateClip(clip.id, patch, { coalesce: key + clip.id });
  const seg = tick >= 0 ? segmenterState() : 'idle';
  return (
    <>
      <Section title="Look">
        <div className="scroll-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {LOOKS.map((l) => (
            <button key={l.id} type="button" onClick={() => applyLook(l.id, [clip.id])} className={cx('shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px]', clip.look === l.id || (l.id === 'none' && !clip.look) ? 'bg-accent text-accent-ink' : 'bg-ink text-muted hover:text-fg')}>
              {l.name}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title="Adjust"
        right={
          <button type="button" className="text-[11px] text-faint hover:text-fg" onClick={() => getState().updateClip(clip.id, { filters: { ...DEFAULT_FILTERS }, look: 'none' })}>
            Reset
          </button>
        }
      >
        {ADJUST.map((a) => (
          <Slider key={a.key} label={a.label} value={clip.filters[a.key]} min={a.min} max={a.max} def={0} onChange={(v) => setF(a.key, v)} />
        ))}
      </Section>
      <Section title="Background">
        <Toggle
          label="Remove background"
          hint={clip.removeBg ? (seg === 'ready' ? 'Person cut-out is running on this device.' : seg === 'failed' ? 'Could not start the segmentation model in this browser.' : 'Loading the on-device model…') : 'Cuts out people — works offline, no upload.'}
          value={clip.removeBg}
          busy={clip.removeBg && seg === 'loading'}
          onChange={(v) => upd({ removeBg: v })}
        />
        <Toggle label="Chroma key" hint="Remove a green/blue screen colour." value={clip.chroma.enabled} onChange={(v) => upd({ chroma: { ...clip.chroma, enabled: v } })} />
        {clip.chroma.enabled && (
          <>
            <Field label="Key colour">
              <Color value={clip.chroma.color} onChange={(v) => upd({ chroma: { ...clip.chroma, color: v } }, 'ck')} />
              {['#00d639', '#1947ff', '#ffffff', '#000000'].map((c) => (
                <button key={c} type="button" aria-label={`Key ${c}`} className="h-5 w-5 rounded-full border border-line-strong" style={{ background: c }} onClick={() => upd({ chroma: { ...clip.chroma, color: c } })} />
              ))}
            </Field>
            <Slider label="Tolerance" value={clip.chroma.similarity * 100} min={1} max={70} def={22} onChange={(v) => upd({ chroma: { ...clip.chroma, similarity: v / 100 } }, 'cks')} />
            <Slider label="Edge softness" value={clip.chroma.smoothness * 100} min={0} max={40} def={10} onChange={(v) => upd({ chroma: { ...clip.chroma, smoothness: v / 100 } }, 'ckm')} />
          </>
        )}
      </Section>
    </>
  );
}

function AudioSection({ clip }: { clip: Clip }) {
  const tick = useStore((s) => s.mediaTick);
  const [minSilence, setMinSilence] = useState(0.45);
  const rt = clip.assetId && tick >= 0 ? runtime.get(clip.assetId) : undefined;
  const upd = (patch: Partial<Clip>, key: string) => getState().updateClip(clip.id, patch, { coalesce: key + clip.id });
  if (rt && rt.audio === null) return <div className="p-4 text-[12px] text-muted">This clip has no audio track.</div>;
  const loading = !rt || rt.audio === undefined;
  return (
    <>
      <Section title="Volume">
        {loading && <Note>Decoding audio…</Note>}
        <Slider label="Volume" value={Math.round(clip.volume * 100)} min={0} max={300} def={100} format={(v) => `${v}%`} onChange={(v) => upd({ volume: v / 100 }, 'vol')} />
        <Slider label="Fade in" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.05} def={0} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => upd({ fadeIn: v }, 'fi')} />
        <Slider label="Fade out" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.05} def={0} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => upd({ fadeOut: v }, 'fo')} />
        <Toggle label="Mute clip" value={clip.muted} onChange={(v) => upd({ muted: v }, 'mute')} />
      </Section>
      <Section title="Clean-up">
        <Toggle label="Reduce noise" hint="Learns the room hiss from quiet moments and gates it out." value={clip.denoise} busy={clip.denoise && !rt?.denoised} disabled={loading} onChange={(v) => setDenoise(clip, v)} />
        <Toggle label="Enhance voice" hint="Rumble filter, presence lift and gentle compression." value={clip.enhance} onChange={(v) => upd({ enhance: v }, 'enh')} />
        <Toggle label="Normalise loudness" hint={rt?.normGain ? `Applies ${(20 * Math.log10(rt.normGain)).toFixed(1)} dB to hit speech level.` : 'Evens out quiet recordings.'} value={clip.normalize} onChange={(v) => upd({ normalize: v }, 'norm')} />
      </Section>
      <Section title="Tighten">
        <Slider label="Cut pauses longer than" value={minSilence} min={0.2} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)}s`} onChange={setMinSilence} />
        <Btn className="w-full" disabled={loading} onClick={() => cutSilences(clip.id, minSilence)}>
          <Scissors size={14} /> Cut silences
        </Btn>
        {clip.type === 'video' && (
          <Btn className="w-full" disabled={loading} onClick={() => detachAudio(clip.id)}>
            <Unlink2 size={14} /> Detach audio to its own track
          </Btn>
        )}
      </Section>
    </>
  );
}

const MOTIONS: { id: MotionPreset; name: string }[] = [
  { id: 'zoomIn', name: 'Slow zoom in' },
  { id: 'zoomOut', name: 'Slow zoom out' },
  { id: 'panLeft', name: 'Pan left' },
  { id: 'panRight', name: 'Pan right' },
  { id: 'drift', name: 'Handheld drift' },
];

function AnimateTab({ clip }: { clip: Clip }) {
  const project = useStore((s) => s.project);
  const upd = (patch: Partial<Clip>, key = 'anim') => getState().updateClip(clip.id, patch, { coalesce: key + clip.id });
  const prev = previousAdjacent(project, clip);
  const anims = clip.type === 'text' ? CLIP_ANIMS : CLIP_ANIMS.filter((a) => a.id !== 'typewriter');
  const nKf = Object.values(clip.keyframes).reduce((m, k) => m + (k?.length ?? 0), 0);
  return (
    <>
      <Section title="In / out animation">
        <Field label="In">
          <Select<ClipAnim> value={clip.animIn} onChange={(v) => upd({ animIn: v })} className="w-36">
            {anims.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Out">
          <Select<ClipAnim> value={clip.animOut} onChange={(v) => upd({ animOut: v })} className="w-36">
            {anims
              .filter((a) => a.id !== 'typewriter')
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>
        <Slider label="Duration" value={clip.animDur} min={0.05} max={1.5} step={0.05} def={0.35} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => upd({ animDur: v }, 'animdur')} />
      </Section>
      {clip.type !== 'text' && (
        <Section title="Transition from previous clip">
          <Select<TransitionType | 'none'> value={clip.transitionIn?.type ?? 'none'} onChange={(v) => upd({ transitionIn: v === 'none' ? null : { type: v, duration: clip.transitionIn?.duration ?? 0.5 } })}>
            <option value="none">None (hard cut)</option>
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          {clip.transitionIn && <Slider label="Length" value={clip.transitionIn.duration} min={0.1} max={2} step={0.05} def={0.5} format={(v) => `${v.toFixed(2)}s`} onChange={(v) => upd({ transitionIn: { ...clip.transitionIn!, duration: v } }, 'trd')} />}
          {!prev && <p className="text-[11px] leading-snug text-faint">No clip touches this one on the left, so the transition plays against the background.</p>}
        </Section>
      )}
      <Section title="Motion presets">
        <div className="grid grid-cols-2 gap-1.5">
          {MOTIONS.map((m) => (
            <Btn key={m.id} size="sm" onClick={() => applyMotion(clip.id, m.id)}>
              {m.name}
            </Btn>
          ))}
          <Btn size="sm" variant="ghost" disabled={!nKf} onClick={() => getState().clearKeyframes(clip.id)}>
            <Eraser size={13} /> Clear ({nKf})
          </Btn>
        </div>
        <p className="text-[11px] leading-snug text-faint">Presets write ordinary keyframes — fine-tune them from the Transform section.</p>
      </Section>
    </>
  );
}

function TextTab({ clip }: { clip: Clip }) {
  const s = clip.style;
  const set = (patch: Partial<TextStyle>, key = 'st') => getState().updateClip(clip.id, { style: { ...s, ...patch } }, { coalesce: key + clip.id });
  const font = FONTS.find((f) => f.family === s.fontFamily) ?? FONTS[0];
  const captions = useStore((st) => st.project.clips.filter((c) => c.caption).length);
  return (
    <>
      <Section title="Text">
        <textarea
          value={clip.text}
          onChange={(e) => getState().updateClip(clip.id, { text: e.target.value }, { coalesce: 'text' + clip.id })}
          rows={3}
          placeholder="Type here…"
          className="scroll-thin block w-full resize-y rounded-lg border border-line bg-ink px-2.5 py-2 text-[13px] leading-snug text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <Select value={s.fontFamily} onChange={(v) => set({ fontFamily: v, weight: (FONTS.find((f) => f.family === v) ?? font).weights.includes(s.weight) ? s.weight : (FONTS.find((f) => f.family === v) ?? font).weights.slice(-1)[0] })} label="Font">
          {FONTS.map((f) => (
            <option key={f.family} value={f.family}>
              {f.label}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1.5">
          {font.weights.length > 1 && <Segmented value={s.weight} onChange={(v) => set({ weight: v })} options={font.weights.map((w) => ({ value: w, label: String(w) }))} className="flex-1" />}
          <IconBtn label="Italic" active={s.italic} onClick={() => set({ italic: !s.italic })}>
            <Italic size={15} />
          </IconBtn>
          <IconBtn label="Uppercase" active={s.uppercase} onClick={() => set({ uppercase: !s.uppercase })}>
            <CaseUpper size={16} />
          </IconBtn>
          <Color value={s.color} onChange={(v) => set({ color: v }, 'col')} label="Text colour" />
        </div>
        <Slider label="Size" value={s.fontSize} min={16} max={400} def={96} onChange={(v) => set({ fontSize: v }, 'fs')} />
        <Field label="Align">
          <Segmented
            value={s.align}
            onChange={(v) => set({ align: v })}
            className="w-32"
            options={[
              { value: 'left', label: <AlignLeft size={14} /> },
              { value: 'center', label: <AlignCenter size={14} /> },
              { value: 'right', label: <AlignRight size={14} /> },
            ]}
          />
        </Field>
        <Slider label="Letter spacing" value={s.letterSpacing} min={-6} max={40} step={0.5} def={0} onChange={(v) => set({ letterSpacing: v }, 'ls')} />
        <Slider label="Line height" value={s.lineHeight} min={0.8} max={2} step={0.02} def={1.12} onChange={(v) => set({ lineHeight: v }, 'lh')} />
        <Slider label="Wrap width" value={Math.round(s.maxWidth * 100)} min={20} max={100} def={86} format={(v) => `${v}%`} onChange={(v) => set({ maxWidth: v / 100 }, 'mw')} />
      </Section>
      <Section title="Outline & shadow">
        <Slider label="Outline" value={s.strokeWidth} min={0} max={40} def={0} left={<Color value={s.strokeColor} onChange={(v) => set({ strokeColor: v }, 'sc')} label="Outline colour" />} onChange={(v) => set({ strokeWidth: v }, 'sw')} />
        <Slider label="Shadow blur" value={s.shadowBlur} min={0} max={60} def={0} left={<Color value={s.shadowColor} onChange={(v) => set({ shadowColor: v }, 'shc')} label="Shadow colour" />} onChange={(v) => set({ shadowBlur: v }, 'shb')} />
        <Slider label="Shadow offset" value={s.shadowY} min={0} max={30} def={0} onChange={(v) => set({ shadowY: v }, 'shy')} />
      </Section>
      <Section title="Background box" defaultOpen={s.bgOpacity > 0}>
        <Slider label="Opacity" value={Math.round(s.bgOpacity * 100)} min={0} max={100} def={0} left={<Color value={s.bgColor} onChange={(v) => set({ bgColor: v }, 'bgc')} label="Box colour" />} format={(v) => `${v}%`} onChange={(v) => set({ bgOpacity: v / 100 }, 'bgo')} />
        <Slider label="Padding" value={s.bgPadding} min={0} max={80} def={22} onChange={(v) => set({ bgPadding: v }, 'bgp')} />
        <Slider label="Roundness" value={s.bgRadius} min={0} max={80} def={18} onChange={(v) => set({ bgRadius: v }, 'bgr')} />
      </Section>
      <Section title="Word highlight">
        <Field label="Style">
          <Segmented value={s.highlight} onChange={(v) => set({ highlight: v })} className="w-44" options={[{ value: 'none', label: 'Off' }, { value: 'color', label: 'Colour' }, { value: 'box', label: 'Box' }]} />
          <Color value={s.highlightColor} onChange={(v) => set({ highlightColor: v }, 'hlc')} label="Highlight colour" />
        </Field>
        <p className="text-[11px] leading-snug text-faint">Highlights the word being spoken. Auto captions carry exact word timing; other text is spread evenly.</p>
        {clip.caption && captions > 1 && (
          <Btn
            className="w-full"
            onClick={() => {
              const st = getState();
              const ids = st.project.clips.filter((c) => c.caption && c.id !== clip.id).map((c) => c.id);
              st.updateClips(ids, () => ({ style: { ...clip.style }, x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation, animIn: clip.animIn, animOut: clip.animOut, animDur: clip.animDur }));
              st.toast(`Style applied to ${ids.length + 1} captions`, 'ok');
            }}
          >
            <Sparkles size={14} /> Apply style to all {captions} captions
          </Btn>
        )}
      </Section>
    </>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : undefined));
  const [tab, setTab] = useState<string>('main');

  if (!clip) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        {selection.length > 1 ? (
          <>
            <p className="text-[13px] text-fg">{selection.length} clips selected</p>
            <div className="flex gap-2">
              <Btn onClick={() => getState().duplicateSelected()}>
                <Copy size={14} /> Duplicate
              </Btn>
              <Btn variant="danger" onClick={() => getState().removeClips(getState().selection)}>
                <Trash2 size={14} /> Delete
              </Btn>
            </div>
          </>
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-raised text-muted">
              <MousePointerClick size={20} />
            </span>
            <p className="max-w-[220px] text-[12.5px] leading-relaxed text-muted">Select a clip on the timeline or in the preview to edit its transform, colour, audio and animation.</p>
          </>
        )}
      </div>
    );
  }

  const tabs: { id: string; label: string }[] =
    clip.type === 'text'
      ? [
          { id: 'main', label: 'Text' },
          { id: 'transform', label: 'Layout' },
          { id: 'animate', label: 'Animate' },
        ]
      : clip.type === 'audio'
        ? [{ id: 'main', label: 'Audio' }]
        : clip.type === 'image'
          ? [
              { id: 'main', label: 'Image' },
              { id: 'adjust', label: 'Adjust' },
              { id: 'animate', label: 'Animate' },
            ]
          : [
              { id: 'main', label: 'Video' },
              { id: 'adjust', label: 'Adjust' },
              { id: 'audio', label: 'Audio' },
              { id: 'animate', label: 'Animate' },
            ];
  const cur = tabs.some((t) => t.id === tab) ? tab : 'main';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span className={cx('h-2.5 w-2.5 shrink-0 rounded-sm', clip.type === 'video' ? 'bg-clip-video' : clip.type === 'image' ? 'bg-clip-image' : clip.type === 'audio' ? 'bg-clip-audio' : clip.caption ? 'bg-clip-caption' : 'bg-clip-text')} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{clip.type === 'text' ? (clip.caption ? 'Caption' : 'Text') : clip.name}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint">{formatClock(clip.duration)}</span>
        <IconBtn label="Delete clip" className="h-7 w-7" onClick={() => getState().removeClips([clip.id])}>
          <Trash2 size={14} />
        </IconBtn>
      </div>
      {tabs.length > 1 && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <Segmented value={cur} onChange={setTab} options={tabs.map((t) => ({ value: t.id, label: t.label }))} />
        </div>
      )}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        {clip.type === 'audio' && (
          <>
            <AudioSection clip={clip} />
            <SpeedSection clip={clip} />
          </>
        )}
        {clip.type === 'text' && cur === 'main' && <TextTab clip={clip} />}
        {clip.type === 'text' && cur === 'transform' && <TransformSection clip={clip} />}
        {(clip.type === 'video' || clip.type === 'image') && cur === 'main' && (
          <>
            <TransformSection clip={clip} />
            {clip.type === 'video' && <SpeedSection clip={clip} />}
          </>
        )}
        {cur === 'adjust' && clip.type !== 'text' && clip.type !== 'audio' && <AdjustTab clip={clip} />}
        {cur === 'audio' && clip.type === 'video' && <AudioSection clip={clip} />}
        {cur === 'animate' && clip.type !== 'audio' && <AnimateTab clip={clip} />}
        {clip.type === 'audio' && (
          <div className="flex items-center gap-2 px-3 pt-3 text-[11px] text-faint">
            <AudioLines size={13} /> Everything here is processed locally with Web Audio.
          </div>
        )}
      </div>
    </div>
  );
}

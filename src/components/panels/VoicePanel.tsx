import { Mic, ShieldCheck, Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { textToSpeech } from '../../lib/captions';
import { KOKORO_VOICES } from '../../lib/defaults';
import { engine } from '../../lib/engine';
import { importFile } from '../../lib/media';
import { getState, useStore } from '../../lib/store';
import { Btn, cx, Note, PanelHeader, Progress, Section, Select, Slider, Toggle } from '../ui';

function Recorder() {
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [playAlong, setPlayAlong] = useState(true);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; at: number; t0: number; chunks: Blob[] } | null>(null);

  useEffect(
    () => () => {
      const r = rec.current;
      if (r) {
        cancelAnimationFrame(r.raf);
        r.stream.getTracks().forEach((t) => t.stop());
        void r.ctx.close();
      }
    },
    [],
  );

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      getState().toast('Recording is not supported in this browser', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: playAlong, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const at = getState().time;
      const t0 = performance.now();
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let m = 0;
        for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
        setLevel(m);
        setElapsed((performance.now() - t0) / 1000);
        if (rec.current) rec.current.raf = requestAnimationFrame(tick);
      };
      rec.current = { recorder, stream, ctx, raf: 0, at, t0, chunks };
      recorder.start(250);
      setState('recording');
      tick();
      if (playAlong) void engine.play();
    } catch (e) {
      getState().toast('Microphone unavailable: ' + (e as Error).message, 'error');
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    setState('saving');
    engine.pause();
    cancelAnimationFrame(r.raf);
    await new Promise<void>((resolve) => {
      r.recorder.onstop = () => resolve();
      r.recorder.stop();
    });
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    rec.current = null;
    const type = r.recorder.mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    const n = getState().project.assets.filter((a) => a.name.startsWith('Voiceover')).length + 1;
    const asset = await importFile(new File([new Blob(r.chunks, { type })], `Voiceover ${n}.${ext}`, { type }));
    if (asset) {
      getState().addClipFromAsset(asset.id, { at: r.at, patch: { enhance: true } });
      getState().toast('Voiceover added to the timeline', 'ok');
    }
    setLevel(0);
    setElapsed(0);
    setState('idle');
  };

  return (
    <Section title="Record voiceover">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={state === 'recording' ? 'Stop recording' : 'Start recording'}
          disabled={state === 'saving'}
          onClick={state === 'recording' ? stop : start}
          className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-colors', state === 'recording' ? 'bg-danger text-white' : 'bg-raised text-danger shadow-[inset_0_0_0_1.5px_var(--color-danger)] hover:bg-hover')}
        >
          {state === 'recording' ? <Square size={18} fill="currentColor" /> : <Mic size={22} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[18px] tabular-nums text-fg">
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}
            <span className="text-faint">.{Math.floor((elapsed % 1) * 10)}</span>
          </div>
          <div className="mt-1.5 flex h-2 gap-[2px]">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className={cx('flex-1 rounded-[1px]', level * 30 > i ? (i > 19 ? 'bg-danger' : i > 14 ? 'bg-warn' : 'bg-ok') : 'bg-line')} />
            ))}
          </div>
        </div>
      </div>
      <Toggle label="Play timeline while recording" hint="Starts at the playhead so you can narrate in sync. Use headphones." value={playAlong} onChange={setPlayAlong} disabled={state !== 'idle'} />
    </Section>
  );
}

export function VoicePanel() {
  const job = useStore((s) => s.jobs.find((j) => j.id === 'tts'));
  const [text, setText] = useState('Welcome back! In this video I’ll show you three quick edits that make any clip feel faster.');
  const [voice, setVoice] = useState('af_heart');
  const [speed, setSpeed] = useState(1);
  const [caps, setCaps] = useState(true);
  const groups = [...new Set(KOKORO_VOICES.map((v) => v.group))];

  const run = async () => {
    if (!text.trim()) return;
    try {
      await textToSpeech(text, voice, speed, caps ? 'pop' : null);
      getState().toast('Voice added at the playhead', 'ok');
    } catch (e) {
      getState().toast('Text to speech failed: ' + (e as Error).message, 'error');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Voice" sub="Record yourself, or have a local voice read your script." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <Recorder />
        <Section title="Text to speech">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Type or paste your script…"
            className="scroll-thin block w-full resize-y rounded-lg border border-line bg-ink px-2.5 py-2 text-[13px] leading-snug text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
          <div className="flex items-center justify-between text-[11px] text-faint">
            <span>{text.trim() ? text.trim().split(/\s+/).length : 0} words</span>
            <span>≈ {Math.max(1, Math.round((text.trim().split(/\s+/).length / 2.6) / speed))}s of audio</span>
          </div>
          <Select value={voice} onChange={setVoice} label="Voice">
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {KOKORO_VOICES.filter((v) => v.group === g).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Slider label="Speaking rate" value={speed} min={0.6} max={1.6} step={0.05} def={1} format={(v) => `${v.toFixed(2)}×`} onChange={setSpeed} />
          <Toggle label="Add matching captions" hint="Drops word-highlight captions in sync with the voice." value={caps} onChange={setCaps} />
          {job ? (
            <div className="space-y-1.5 rounded-lg bg-ink px-2.5 py-2.5">
              <div className="flex justify-between text-[11.5px] text-muted">
                <span>{job.label}</span>
                {job.progress !== null && <span className="font-mono">{Math.round(job.progress * 100)}%</span>}
              </div>
              <Progress value={job.progress} />
            </div>
          ) : (
            <Btn variant="primary" size="lg" className="w-full" disabled={!text.trim()} onClick={run}>
              <Volume2 size={15} /> Generate voice
            </Btn>
          )}
          <Note>
            <ShieldCheck size={12} className="mr-1 inline -translate-y-px text-ok" />
            Uses the open Kokoro voice model (≈ 92 MB, English). It is downloaded once from Hugging Face, cached in this browser, then runs offline. Your script is never sent anywhere.
          </Note>
        </Section>
      </div>
    </div>
  );
}

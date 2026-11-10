import type { Clip, Word } from '../types';
import { callAI } from './ai';
import { encodeWav, renderMix } from './audio';
import { CAPTION_STYLES, DEFAULT_STYLE, WHISPER_MODELS } from './defaults';
import { importFile } from './media';
import { getState, projectDuration } from './store';

export interface Caption {
  start: number;
  end: number;
  text: string;
  words?: Word[];
}

export function groupWords(words: Word[], maxWords: number, maxChars = 30): Caption[] {
  const caps: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    caps.push({ start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start + 0.2), text: cur.map((w) => w.text).join(' '), words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const chars = cur.reduce((m, x) => m + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || (chars > maxChars && maxWords > 1) || w.start - cur[cur.length - 1].end > 0.55)) flush();
    cur.push(w);
    if (/[.!?。！？]$/.test(w.text) && cur.length >= Math.min(2, maxWords)) flush();
  }
  flush();
  // let captions linger slightly, but never overlap the next one
  for (let i = 0; i < caps.length; i++) {
    const next = caps[i + 1];
    caps[i].end = next ? Math.min(caps[i].end + 0.12, next.start) : caps[i].end + 0.2;
  }
  return caps;
}

export function captionBase(styleId: string): Partial<Clip> {
  const preset = CAPTION_STYLES.find((s) => s.id === styleId) ?? CAPTION_STYLES[0];
  const p = getState().project;
  const portrait = p.height > p.width;
  const k = Math.min(p.width, p.height) / 1080;
  const style = { ...DEFAULT_STYLE, ...preset.style };
  style.fontSize = Math.round(style.fontSize * k * (portrait ? 1 : 0.8));
  return { y: portrait ? 0.24 : 0.36, animDur: 0.16, ...preset.clip, style };
}

export interface AutoCaptionOptions {
  model: (typeof WHISPER_MODELS)[number]['id'];
  language: string;
  scope: 'timeline' | 'selection';
  maxWords: number;
  style: string;
  replace: boolean;
}

export async function autoCaption(o: AutoCaptionOptions): Promise<number> {
  const st = getState();
  const project = st.project;
  const duration = projectDuration(project);
  const sel = new Set(st.selection);
  const filter = o.scope === 'selection' && sel.size ? (c: Clip) => sel.has(c.id) : undefined;
  if (duration <= 0) throw new Error('Add a clip with speech first.');
  st.setJob('captions', 'Mixing audio…', null);
  try {
    const mix = await renderMix(project, duration, 16000, 1, filter);
    const audio = mix.getChannelData(0).slice();
    let peak = 0;
    for (let i = 0; i < audio.length; i += 16) peak = Math.max(peak, Math.abs(audio[i]));
    if (peak < 0.003) throw new Error('No audible speech found on the timeline. If your clip was just imported, give its audio a moment to finish loading.');
    if (peak < 0.5) for (let i = 0; i < audio.length; i++) audio[i] *= 0.7 / peak;
    const repo = WHISPER_MODELS.find((m) => m.id === o.model)!.repo;
    const res = await callAI<{ words: Word[]; wordLevel: boolean }>('transcribe', { audio, repo, language: o.language }, (p) => getState().setJob('captions', p.stage, p.progress), [audio.buffer]);
    if (!res.words.length) throw new Error('No speech was recognised.');
    const caps = groupWords(res.words, o.maxWords);
    return getState().addCaptions(caps, captionBase(o.style), o.replace);
  } finally {
    getState().clearJob('captions');
  }
}

export async function textToSpeech(text: string, voice: string, speed: number, withCaptions: string | null): Promise<void> {
  const st = getState();
  st.setJob('tts', 'Preparing voice…', null);
  try {
    const res = await callAI<{ audio: Float32Array; sampleRate: number; marks: { text: string; start: number; end: number }[] }>('tts', { text, voice, speed }, (p) => getState().setJob('tts', p.stage, p.progress));
    const wav = encodeWav([res.audio], res.sampleRate);
    const label = text.trim().split(/\s+/).slice(0, 4).join(' ').slice(0, 28);
    const asset = await importFile(wav, `Voice — ${label}.wav`);
    if (!asset) throw new Error('Could not add generated audio');
    const at = getState().time;
    getState().addClipFromAsset(asset.id, { at });
    if (withCaptions) {
      // split each spoken sentence into evenly-timed words so captions can highlight along
      const words: Word[] = [];
      for (const m of res.marks) {
        const parts = m.text.split(/\s+/).filter(Boolean);
        const total = parts.reduce((n, w) => n + w.length + 1, 0);
        let acc = 0;
        for (const w of parts) {
          const a = m.start + ((m.end - m.start) * acc) / total;
          acc += w.length + 1;
          words.push({ text: w, start: at + a, end: at + m.start + ((m.end - m.start) * acc) / total });
        }
      }
      getState().addCaptions(groupWords(words, 4), captionBase(withCaptions), false);
    }
  } finally {
    getState().clearJob('tts');
  }
}

// ── SRT ──
const srtTime = (t: number) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

export function toSrt(): string {
  const caps = getState()
    .project.clips.filter((c) => c.type === 'text' && c.caption)
    .sort((a, b) => a.start - b.start);
  return caps.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.text}\n`).join('\n');
}

export function parseSrt(src: string): Caption[] {
  const out: Caption[] = [];
  const ts = (s: string) => {
    const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
    if (!m) return NaN;
    return (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000;
  };
  for (const block of src.replace(/\r/g, '').replace(/^WEBVTT.*\n/, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    const start = ts(a);
    const end = ts(b);
    const text = lines.slice(ti + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) out.push({ start, end, text });
  }
  return out;
}

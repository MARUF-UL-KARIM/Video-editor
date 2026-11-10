/// <reference lib="webworker" />
// On-device speech models. Model weights are fetched once from the Hugging Face hub and cached by the browser;
// audio and text are processed here, in this worker, and are never uploaded.
import { env, pipeline } from '@huggingface/transformers';

const ORT = self.location.origin + '/ort/';
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = ORT;

type Post = (msg: Record<string, unknown>, transfer?: Transferable[]) => void;
const post: Post = (msg, transfer) => (self as unknown as Worker).postMessage(msg, transfer ?? []);

interface WordOut {
  text: string;
  start: number;
  end: number;
}

function downloadTracker(id: number, label: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file && p.total) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ id, type: 'progress', stage: label, progress: total ? loaded / total : 0, bytes: total });
    }
  };
}

// ── speech to text (Whisper) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let asrRepo = '';

function splitChunks(audio: Float32Array, sr: number): { start: number; end: number }[] {
  const max = 28 * sr;
  const minSearch = 16 * sr;
  const win = Math.floor(0.25 * sr);
  const step = Math.floor(0.05 * sr);
  const out: { start: number; end: number }[] = [];
  let pos = 0;
  while (pos < audio.length) {
    if (audio.length - pos <= max) {
      out.push({ start: pos, end: audio.length });
      break;
    }
    let best = pos + max;
    let bestE = Infinity;
    for (let i = pos + minSearch; i + win <= pos + max; i += step) {
      let e = 0;
      for (let j = i; j < i + win; j += 4) e += audio[j] * audio[j];
      if (e < bestE) {
        bestE = e;
        best = i + (win >> 1);
      }
    }
    out.push({ start: pos, end: best });
    pos = best;
  }
  return out;
}

async function transcribe(id: number, p: { audio: Float32Array; repo: string; language: string }) {
  const sr = 16000;
  if (!asr || asrRepo !== p.repo) {
    post({ id, type: 'progress', stage: 'Loading speech model', progress: 0 });
    asr = await pipeline('automatic-speech-recognition', p.repo, { dtype: 'q8', device: 'wasm', progress_callback: downloadTracker(id, 'Downloading speech model (one time)') as never });
    asrRepo = p.repo;
  }
  const chunks = splitChunks(p.audio, sr);
  const words: WordOut[] = [];
  let wordLevel = true;
  for (let i = 0; i < chunks.length; i++) {
    post({ id, type: 'progress', stage: 'Transcribing on this device', progress: i / chunks.length });
    const c = chunks[i];
    const slice = p.audio.slice(c.start, c.end);
    let e = 0;
    for (let j = 0; j < slice.length; j += 8) e += slice[j] * slice[j];
    if (Math.sqrt(e / (slice.length / 8)) < 0.0015) continue; // silence → skip (avoids hallucinated text)
    const offset = c.start / sr;
    const span = slice.length / sr;
    const base: Record<string, unknown> = { chunk_length_s: 30, stride_length_s: 5 };
    if (p.language !== 'auto') {
      base.language = p.language;
      base.task = 'transcribe';
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let out: any = null;
    if (wordLevel) {
      try {
        out = await asr(slice, { ...base, return_timestamps: 'word' });
      } catch (err) {
        console.warn('word timestamps unavailable, falling back to segments', err);
        wordLevel = false;
      }
    }
    if (!out) out = await asr(slice, { ...base, return_timestamps: true });
    const list: { text: string; timestamp: [number, number | null] }[] = (Array.isArray(out) ? out[0] : out)?.chunks ?? [];
    for (const ch of list) {
      const text = (ch.text ?? '').trim();
      if (!text) continue;
      const s = Math.max(0, Math.min(span, ch.timestamp?.[0] ?? 0));
      let en = ch.timestamp?.[1] ?? null;
      if (en === null || !(en > s)) en = Math.min(span, s + 0.35);
      en = Math.min(span, en);
      if (wordLevel) words.push({ text, start: offset + s, end: offset + en });
      else {
        // spread a sentence-level segment over its words, weighted by length
        const parts = text.split(/\s+/);
        const total = parts.reduce((m, w) => m + w.length + 1, 0);
        let acc = 0;
        for (const w of parts) {
          const a = offset + s + ((en - s) * acc) / total;
          acc += w.length + 1;
          words.push({ text: w, start: a, end: offset + s + ((en - s) * acc) / total });
        }
      }
    }
  }
  // drop bracketed non-speech tags like [MUSIC] / (applause)
  const clean = words.filter((w) => !/^[\[(].*[\])]$/.test(w.text) && !/^\[|\]$/.test(w.text));
  post({ id, type: 'result', result: { words: clean, wordLevel } });
}

// ── text to speech (Kokoro) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tts: any = null;

function splitText(text: string): string[] {
  const out: string[] = [];
  for (const s of text.replace(/\r/g, '').match(/[^.!?\n…]+[.!?…]*|\n+/g) ?? []) {
    const t = s.trim();
    if (!t) continue;
    if (t.length <= 260) out.push(t);
    else {
      let cur = '';
      for (const part of t.split(/(?<=[,;:])\s+|\s+(?=—)/)) {
        if ((cur + ' ' + part).length > 240 && cur) {
          out.push(cur);
          cur = part;
        } else cur = cur ? cur + ' ' + part : part;
      }
      if (cur) out.push(cur);
    }
  }
  return out;
}

async function speak(id: number, p: { text: string; voice: string; speed: number }) {
  if (!tts) {
    post({ id, type: 'progress', stage: 'Loading voice model', progress: 0 });
    const kokoro = await import('kokoro-js');
    try {
      (kokoro as unknown as { env: { wasmPaths: string } }).env.wasmPaths = ORT;
    } catch {
      /* older builds have no env export */
    }
    tts = await kokoro.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'wasm', progress_callback: downloadTracker(id, 'Downloading voice model (one time)') as never });
  }
  const parts = splitText(p.text);
  if (!parts.length) throw new Error('Nothing to say');
  const pieces: Float32Array[] = [];
  const marks: { text: string; start: number; end: number }[] = [];
  let sr = 24000;
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    post({ id, type: 'progress', stage: 'Generating speech on this device', progress: i / parts.length });
    const audio = await tts.generate(parts[i], { voice: p.voice, speed: p.speed });
    sr = audio.sampling_rate;
    const data: Float32Array = audio.audio;
    pieces.push(data);
    marks.push({ text: parts[i], start: pos / sr, end: (pos + data.length) / sr });
    pos += data.length;
    if (i < parts.length - 1) {
      const gap = new Float32Array(Math.floor(sr * 0.16));
      pieces.push(gap);
      pos += gap.length;
    }
  }
  const out = new Float32Array(pos);
  let o = 0;
  for (const piece of pieces) {
    out.set(piece, o);
    o += piece.length;
  }
  post({ id, type: 'result', result: { audio: out, sampleRate: sr, marks } }, [out.buffer]);
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'transcribe') await transcribe(id, payload);
    else if (type === 'tts') await speak(id, payload);
    else throw new Error('unknown task ' + type);
  } catch (err) {
    post({ id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};

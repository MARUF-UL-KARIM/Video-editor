// Thin client for the on-device AI worker (speech-to-text + text-to-speech).
export interface AIProgress {
  stage: string;
  progress: number;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: AIProgress) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, type } = e.data;
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') p.onProgress?.({ stage: e.data.stage, progress: e.data.progress });
      else if (type === 'result') {
        pending.delete(id);
        p.resolve(e.data.result);
      } else if (type === 'error') {
        pending.delete(id);
        p.reject(new Error(e.data.error));
      }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'AI worker crashed'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

export function callAI<T>(type: 'transcribe' | 'tts', payload: unknown, onProgress?: (p: AIProgress) => void, transfer: Transferable[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    getWorker().postMessage({ id, type, payload }, transfer);
  });
}

// Non-serialisable, in-memory resources for each imported asset (never leaves this device).
export interface Runtime {
  file: Blob;
  url: string;
  audio?: AudioBuffer | null;
  denoised?: AudioBuffer;
  denoising?: Promise<void>;
  peaks?: Float32Array;
  image?: TexImageSource;
  strip?: { url: string; n: number; tw: number; th: number };
  normGain?: number;
}

export const runtime = new Map<string, Runtime>();
export const PEAKS_PER_SEC = 50;

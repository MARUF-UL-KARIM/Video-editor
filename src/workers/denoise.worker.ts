// Spectral-gate noise reduction. Runs entirely in this worker; audio never leaves the device.
// 1) learn a noise profile from the quietest frames, 2) attenuate bins that sit near that floor.

const N = 1024;
const HOP = 256;
const BINS = N / 2 + 1;

const hann = new Float32Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

const rev = new Uint16Array(N);
{
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
}
const cosT = new Float32Array(N / 2);
const sinT = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N);
  sinT[i] = Math.sin((2 * Math.PI * i) / N);
}

function fft(re: Float32Array, im: Float32Array, inverse: boolean) {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cosT[k];
        const wi = inverse ? sinT[k] : -sinT[k];
        const xr = re[i + j + half] * wr - im[i + j + half] * wi;
        const xi = re[i + j + half] * wi + im[i + j + half] * wr;
        re[i + j + half] = re[i + j] - xr;
        im[i + j + half] = im[i + j] - xi;
        re[i + j] += xr;
        im[i + j] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < N; i++) {
      re[i] /= N;
      im[i] /= N;
    }
  }
}

function denoise(x: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  if (frames < 8) return x;
  // frame energies
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const o = f * HOP;
    for (let i = 0; i < N; i += 4) e += x[o + i] * x[o + i];
    energy[f] = e;
  }
  const order = Array.from({ length: frames }, (_, i) => i)
    .filter((i) => energy[i] > 1e-9)
    .sort((a, b) => energy[a] - energy[b]);
  if (order.length < 8) return x;
  const quiet = order.slice(0, Math.max(6, Math.floor(order.length * 0.1)));

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const noise = new Float32Array(BINS);
  for (const f of quiet) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let b = 0; b < BINS; b++) noise[b] += Math.hypot(re[b], im[b]);
  }
  for (let b = 0; b < BINS; b++) noise[b] /= quiet.length;

  const out = new Float32Array(x.length);
  const gain = new Float32Array(BINS);
  const prev = new Float32Array(BINS).fill(1);
  const smooth = new Float32Array(BINS);
  const OVER = 2.6;
  const FLOOR = 0.07;
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = x[o + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let b = 0; b < BINS; b++) {
      const mag = Math.hypot(re[b], im[b]);
      const snr = mag / (noise[b] * OVER + 1e-9);
      let g = (snr * snr) / (1 + snr * snr);
      g = g < FLOOR ? FLOOR : g;
      // fast attack, slow release to avoid musical noise
      g = Math.max(g, prev[b] * 0.72);
      gain[b] = g;
      prev[b] = g;
    }
    for (let b = 0; b < BINS; b++) {
      const a = gain[b > 0 ? b - 1 : b];
      const c = gain[b < BINS - 1 ? b + 1 : b];
      smooth[b] = (a + 2 * gain[b] + c) / 4;
    }
    for (let b = 0; b < BINS; b++) {
      re[b] *= smooth[b];
      im[b] *= smooth[b];
      if (b > 0 && b < N / 2) {
        re[N - b] = re[b];
        im[N - b] = -im[b];
      }
    }
    fft(re, im, true);
    // Hann analysis + Hann synthesis at 75% overlap sums to 1.5
    for (let i = 0; i < N; i++) out[o + i] += (re[i] * hann[i]) / 1.5;
  }
  // edges that no full frame covered: pass through
  const covered = (frames - 1) * HOP + N;
  for (let i = covered; i < x.length; i++) out[i] = x[i] * FLOOR * 4;
  return out;
}

self.onmessage = (e: MessageEvent) => {
  const { id, channels } = e.data as { id: number; channels: Float32Array[] };
  try {
    const out = channels.map((c) => denoise(c));
    (self as unknown as Worker).postMessage({ id, channels: out }, out.map((c) => c.buffer));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};

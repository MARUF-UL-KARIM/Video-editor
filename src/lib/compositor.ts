import type { BlendMode, Chroma, Filters } from '../types';
import { hexToRgb } from './util';

export interface MaskData {
  data: Uint8Array;
  w: number;
  h: number;
  version: number;
}

export interface DrawItem {
  key: string;
  source: TexImageSource | null;
  /** re-upload every frame (video) */
  dynamic: boolean;
  version: string | number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  scale: number;
  rotation: number;
  opacity: number;
  flipH: boolean;
  filters: Filters;
  blurAdd: number;
  chroma: Chroma;
  mask: MaskData | null;
  wipe: [number, number, number] | null;
  fade: [number, number, number, number];
  radius: number;
  blend: BlendMode;
}

const VERT = `#version 300 es
in vec2 aPos;
uniform mat3 uMat;
uniform float uFlip;
out vec2 vUv;
out vec2 vPos;
void main() {
  vPos = aPos;
  vUv = vec2(mix(aPos.x, 1.0 - aPos.x, uFlip), aPos.y);
  vec3 p = uMat * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vPos;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec2 uTexel;
uniform vec2 uSize;
uniform vec2 uBlur;
uniform float uOpacity, uSharpen, uBrightness, uContrast, uSaturation, uTemp, uTint, uHue, uFadeLook, uVignette, uGrain, uSplit, uRadius, uTime;
uniform int uUseMask;
uniform vec4 uChroma;
uniform vec2 uChromaP;
uniform vec4 uWipe;
uniform vec4 uFade;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 cbcr(vec3 c) { return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }

vec4 fetch(vec2 uv) {
  if (uBlur.x > 0.00001) {
    vec4 acc = vec4(0.0);
    float jitter = hash(uv * 911.0) * 6.2831;
    for (int i = 0; i < 32; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 32.0);
      float a = fi * 2.39996323 + jitter;
      acc += texture(uTex, uv + vec2(cos(a), sin(a)) * r * uBlur);
    }
    return acc / 32.0;
  }
  vec4 c = texture(uTex, uv);
  if (uSplit > 0.0001) {
    vec2 d = vec2(uSplit, 0.0);
    c.r = texture(uTex, uv + d).r;
    c.b = texture(uTex, uv - d).b;
  }
  if (uSharpen > 0.001) {
    vec3 n = texture(uTex, uv + vec2(uTexel.x, 0.0)).rgb + texture(uTex, uv - vec2(uTexel.x, 0.0)).rgb
           + texture(uTex, uv + vec2(0.0, uTexel.y)).rgb + texture(uTex, uv - vec2(0.0, uTexel.y)).rgb;
    c.rgb += (c.rgb - n * 0.25) * uSharpen;
  }
  return c;
}

void main() {
  vec4 c = fetch(vUv);
  float a = c.a;
  vec3 rgb = a > 0.0005 ? c.rgb / a : vec3(0.0);

  if (uChroma.a > 0.5) {
    float d = distance(cbcr(uChroma.rgb), cbcr(rgb));
    float m = smoothstep(uChromaP.x, uChromaP.x + uChromaP.y + 0.0001, d);
    a *= m;
    if (uChroma.g > uChroma.r && uChroma.g > uChroma.b) rgb.g = min(rgb.g, mix(max(rgb.r, rgb.b), rgb.g, smoothstep(0.0, 0.35, d - uChromaP.x)));
  }
  if (uUseMask == 1) {
    float m = texture(uMask, vUv).r;
    a *= smoothstep(0.32, 0.68, m);
  }

  rgb += uBrightness;
  rgb = (rgb - 0.5) * (1.0 + uContrast) + 0.5;
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(l), rgb, 1.0 + uSaturation);
  rgb.r += uTemp * 0.14;
  rgb.b -= uTemp * 0.14;
  rgb.g -= uTint * 0.1;
  rgb.r += uTint * 0.05;
  rgb.b += uTint * 0.05;
  if (abs(uHue) > 0.001) {
    float cs = cos(uHue), sn = sin(uHue);
    vec3 k = vec3(0.57735);
    rgb = rgb * cs + cross(k, rgb) * sn + k * dot(k, rgb) * (1.0 - cs);
  }
  rgb = mix(rgb, rgb * 0.82 + 0.13, uFadeLook);
  if (uVignette > 0.001) rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, distance(vPos, vec2(0.5)));
  if (uGrain > 0.001) rgb += (hash(vPos * uSize + fract(uTime) * 311.7) - 0.5) * uGrain;
  rgb = clamp(rgb, 0.0, 1.0);
  rgb = mix(rgb, uFade.rgb, uFade.a);

  if (uRadius > 0.0) {
    vec2 p = (vPos - 0.5) * uSize;
    vec2 q = abs(p) - uSize * 0.5 + uRadius;
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
    a *= 1.0 - smoothstep(-1.5, 0.5, d);
  }
  if (uWipe.w > 0.5) {
    float along = dot(vPos - 0.5, uWipe.xy) + 0.5;
    float s = 0.06;
    float edge = uWipe.z * (1.0 + s);
    a *= 1.0 - smoothstep(edge - s, edge, along);
  }
  a *= uOpacity;
  outColor = vec4(rgb * a, a);
}`;

interface TexRec {
  tex: WebGLTexture;
  version: string | number;
  w: number;
  h: number;
  used: number;
}

function sourceSize(src: TexImageSource): [number, number] {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return [src.displayWidth, src.displayHeight];
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) return [src.naturalWidth, src.naturalHeight];
  const s = src as { width: number; height: number };
  return [s.width, s.height];
}
function sourceReady(src: TexImageSource): boolean {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return src.readyState >= 2 && src.videoWidth > 0;
  const [w, h] = sourceSize(src);
  return w > 0 && h > 0;
}

export class Compositor {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private vao!: WebGLVertexArrayObject;
  private tex = new Map<string, TexRec>();
  private frame = 0;
  private white!: WebGLTexture;
  ok = true;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.ok = false;
      throw new Error('WebGL2 is not available in this browser');
    }
    this.gl = gl;
    this.init();
    if ('addEventListener' in canvas) {
      (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.ok = false;
      });
      (canvas as HTMLCanvasElement).addEventListener('webglcontextrestored', () => {
        this.tex.clear();
        this.init();
        this.ok = true;
      });
    }
  }

  private init() {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(prog, i)!;
      this.u[info.name] = gl.getUniformLocation(prog, info.name);
    }
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  resize(w: number, h: number) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private texFor(key: string, source: TexImageSource | null, dynamic: boolean, version: string | number): TexRec | null {
    const gl = this.gl;
    let rec = this.tex.get(key);
    const ready = !!source && sourceReady(source);
    if (!rec) {
      if (!ready) return null;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      rec = { tex, version: '\u0000none', w: 1, h: 1, used: this.frame };
      this.tex.set(key, rec);
    }
    if (ready && (dynamic || rec.version !== version)) {
      gl.bindTexture(gl.TEXTURE_2D, rec.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source!);
        [rec.w, rec.h] = sourceSize(source!);
        rec.version = version;
        if (!dynamic) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        }
      } catch {
        /* frame not available yet — keep previous texture */
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
    rec.used = this.frame;
    return rec.version === '\u0000none' ? null : rec;
  }

  private maskFor(key: string, mask: MaskData): TexRec {
    const gl = this.gl;
    let rec = this.tex.get(key);
    if (!rec) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      rec = { tex, version: -1, w: 1, h: 1, used: this.frame };
      this.tex.set(key, rec);
    }
    if (rec.version !== mask.version) {
      gl.bindTexture(gl.TEXTURE_2D, rec.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.w, mask.h, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
      rec.version = mask.version;
    }
    rec.used = this.frame;
    return rec;
  }

  render(items: DrawItem[], W: number, H: number, background: string, time: number) {
    if (!this.ok) return;
    const gl = this.gl;
    const u = this.u;
    this.frame++;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [br, bg, bb] = hexToRgb(background);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.enable(gl.BLEND);
    gl.uniform1i(u.uTex, 0);
    gl.uniform1i(u.uMask, 1);
    gl.uniform1f(u.uTime, time);

    for (const it of items) {
      const rec = this.texFor(it.key, it.source, it.dynamic, it.version);
      if (!rec) continue;
      const mask = it.mask ? this.maskFor(it.key + ':mask', it.mask) : null;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mask ? mask.tex : this.white);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, rec.tex);

      const sw = it.w * it.scale;
      const sh = it.h * it.scale;
      const th = (it.rotation * Math.PI) / 180;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const tx = ((it.cx - 0.5 * sw * cs + 0.5 * sh * sn) * 2) / W - 1;
      const ty = 1 - ((it.cy - 0.5 * sw * sn - 0.5 * sh * cs) * 2) / H;
      gl.uniformMatrix3fv(u.uMat, false, [(sw * cs * 2) / W, (-sw * sn * 2) / H, 0, (-sh * sn * 2) / W, (-sh * cs * 2) / H, 0, tx, ty, 1]);
      gl.uniform1f(u.uFlip, it.flipH ? 1 : 0);
      gl.uniform2f(u.uTexel, 1 / rec.w, 1 / rec.h);
      gl.uniform2f(u.uSize, sw, sh);
      const f = it.filters;
      const blurPx = (f.blur / 100) * W * 0.04 + it.blurAdd * (W / 1080);
      gl.uniform2f(u.uBlur, blurPx / Math.max(1, sw), blurPx / Math.max(1, sh));
      gl.uniform1f(u.uOpacity, it.opacity);
      gl.uniform1f(u.uSharpen, (f.sharpen / 100) * 1.6);
      gl.uniform1f(u.uBrightness, (f.brightness / 100) * 0.45);
      gl.uniform1f(u.uContrast, f.contrast / 100);
      gl.uniform1f(u.uSaturation, f.saturation / 100);
      gl.uniform1f(u.uTemp, f.temperature / 100);
      gl.uniform1f(u.uTint, f.tint / 100);
      gl.uniform1f(u.uHue, (f.hue * Math.PI) / 180);
      gl.uniform1f(u.uFadeLook, f.fade / 100);
      gl.uniform1f(u.uVignette, (f.vignette / 100) * 0.95);
      gl.uniform1f(u.uGrain, (f.grain / 100) * 0.32);
      gl.uniform1f(u.uSplit, (f.rgbSplit / 100) * 0.018);
      gl.uniform1f(u.uRadius, it.radius);
      gl.uniform1i(u.uUseMask, mask ? 1 : 0);
      const [kr, kg, kb] = hexToRgb(it.chroma.color);
      gl.uniform4f(u.uChroma, kr, kg, kb, it.chroma.enabled ? 1 : 0);
      gl.uniform2f(u.uChromaP, it.chroma.similarity, it.chroma.smoothness);
      if (it.wipe) gl.uniform4f(u.uWipe, it.wipe[0], it.wipe[1], it.wipe[2], 1);
      else gl.uniform4f(u.uWipe, 0, 0, 0, 0);
      gl.uniform4f(u.uFade, it.fade[0], it.fade[1], it.fade[2], it.fade[3]);

      if (it.blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      else if (it.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
      else if (it.blend === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (this.frame % 180 === 0) {
      for (const [k, r] of this.tex) {
        if (this.frame - r.used > 400) {
          gl.deleteTexture(r.tex);
          this.tex.delete(k);
        }
      }
    }
  }

  dispose() {
    for (const r of this.tex.values()) this.gl.deleteTexture(r.tex);
    this.tex.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.ok = false;
  }
}

import type { Clip, ClipAnim, Filters, TextStyle, TransitionType } from '../types';

export const DEFAULT_FILTERS: Filters = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  fade: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  rgbSplit: 0,
};

export const DEFAULT_STYLE: TextStyle = {
  fontFamily: 'Montserrat Variable',
  fontSize: 96,
  weight: 800,
  italic: false,
  uppercase: false,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.12,
  letterSpacing: 0,
  strokeColor: '#000000',
  strokeWidth: 0,
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowY: 0,
  bgColor: '#000000',
  bgOpacity: 0,
  bgPadding: 22,
  bgRadius: 18,
  maxWidth: 0.86,
  highlight: 'none',
  highlightColor: '#ffe14a',
};

export const FONTS: { family: string; label: string; weights: number[] }[] = [
  { family: 'Montserrat Variable', label: 'Montserrat', weights: [400, 600, 800, 900] },
  { family: 'Instrument Sans Variable', label: 'Instrument Sans', weights: [400, 500, 600, 700] },
  { family: 'Anton', label: 'Anton', weights: [400] },
  { family: 'Bebas Neue', label: 'Bebas Neue', weights: [400] },
  { family: 'Archivo Black', label: 'Archivo Black', weights: [400] },
  { family: 'Bangers', label: 'Bangers', weights: [400] },
  { family: 'Permanent Marker', label: 'Permanent Marker', weights: [400] },
  { family: 'Caveat Variable', label: 'Caveat', weights: [400, 600, 700] },
  { family: 'Playfair Display Variable', label: 'Playfair Display', weights: [400, 600, 800] },
  { family: 'JetBrains Mono Variable', label: 'JetBrains Mono', weights: [400, 600, 800] },
];

export interface TextPreset {
  id: string;
  name: string;
  sample: string;
  style: Partial<TextStyle>;
  clip?: Partial<Clip>;
}

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'title', name: 'Big Title', sample: 'BIG TITLE', style: { fontFamily: 'Anton', weight: 400, fontSize: 170, uppercase: true, shadowBlur: 24, shadowY: 8 }, clip: { animIn: 'pop' } },
  { id: 'outline', name: 'Bold Outline', sample: 'Bold Outline', style: { fontFamily: 'Montserrat Variable', weight: 900, fontSize: 104, strokeWidth: 14, strokeColor: '#0b0b0b' }, clip: { animIn: 'pop' } },
  { id: 'sub', name: 'Subtitle', sample: 'Clean subtitle', style: { fontFamily: 'Instrument Sans Variable', weight: 600, fontSize: 58, bgOpacity: 0.72, bgPadding: 20, bgRadius: 14 }, clip: { y: 0.34, animIn: 'fade' } },
  { id: 'label', name: 'Label', sample: 'STEP 01', style: { fontFamily: 'JetBrains Mono Variable', weight: 700, fontSize: 48, color: '#16110d', bgColor: '#ff6a3d', bgOpacity: 1, bgPadding: 20, bgRadius: 10, letterSpacing: 3, uppercase: true }, clip: { y: -0.36, animIn: 'slideDown' } },
  { id: 'hand', name: 'Handwritten', sample: 'just a thought…', style: { fontFamily: 'Caveat Variable', weight: 700, fontSize: 132, color: '#fff7df', shadowBlur: 12, shadowY: 4 }, clip: { rotation: -4, animIn: 'typewriter' } },
  { id: 'comic', name: 'Comic', sample: 'WOW!', style: { fontFamily: 'Bangers', weight: 400, fontSize: 190, color: '#ffe14a', strokeWidth: 16, strokeColor: '#111111', letterSpacing: 4 }, clip: { rotation: -6, animIn: 'pop' } },
  { id: 'marker', name: 'Marker', sample: 'Note to self', style: { fontFamily: 'Permanent Marker', weight: 400, fontSize: 112, color: '#ffffff', shadowBlur: 0, shadowY: 6, shadowColor: '#ff6a3d' }, clip: { animIn: 'slideUp' } },
  { id: 'serif', name: 'Editorial', sample: 'An elegant line', style: { fontFamily: 'Playfair Display Variable', weight: 600, italic: true, fontSize: 104, shadowBlur: 18, shadowY: 4 }, clip: { animIn: 'fade', animOut: 'fade' } },
  { id: 'bebas', name: 'Poster', sample: 'COMING SOON', style: { fontFamily: 'Bebas Neue', weight: 400, fontSize: 180, letterSpacing: 8, uppercase: true, color: '#ffffff' }, clip: { animIn: 'zoom' } },
];

export interface CaptionStyle {
  id: string;
  name: string;
  style: Partial<TextStyle>;
  clip?: Partial<Clip>;
}

export const CAPTION_STYLES: CaptionStyle[] = [
  { id: 'pop', name: 'Bold Pop', style: { fontFamily: 'Montserrat Variable', weight: 900, fontSize: 86, uppercase: true, strokeWidth: 12, strokeColor: '#000000', highlight: 'color', highlightColor: '#ffe14a' }, clip: { animIn: 'pop', animDur: 0.14 } },
  { id: 'box', name: 'Karaoke Box', style: { fontFamily: 'Montserrat Variable', weight: 800, fontSize: 78, strokeWidth: 0, shadowBlur: 14, shadowY: 4, highlight: 'box', highlightColor: '#ff6a3d' } },
  { id: 'clean', name: 'Clean Bar', style: { fontFamily: 'Instrument Sans Variable', weight: 600, fontSize: 56, bgOpacity: 0.74, bgPadding: 18, bgRadius: 12, highlight: 'none' } },
  { id: 'comic', name: 'Comic', style: { fontFamily: 'Bangers', weight: 400, fontSize: 104, color: '#ffffff', strokeWidth: 12, strokeColor: '#111111', letterSpacing: 2, highlight: 'color', highlightColor: '#5cf2c2' }, clip: { animIn: 'pop', animDur: 0.14 } },
  { id: 'mono', name: 'Tutorial Mono', style: { fontFamily: 'JetBrains Mono Variable', weight: 600, fontSize: 46, color: '#eaffea', bgColor: '#0c120c', bgOpacity: 0.86, bgPadding: 18, bgRadius: 8, highlight: 'color', highlightColor: '#8dff7a' } },
  { id: 'serif', name: 'Soft Serif', style: { fontFamily: 'Playfair Display Variable', weight: 600, italic: true, fontSize: 74, shadowBlur: 16, shadowY: 3, highlight: 'none' }, clip: { animIn: 'fade', animDur: 0.2 } },
];

export const LOOKS: { id: string; name: string; f: Partial<Filters> }[] = [
  { id: 'none', name: 'Original', f: {} },
  { id: 'vivid', name: 'Vivid', f: { contrast: 14, saturation: 30, sharpen: 20 } },
  { id: 'film', name: 'Warm Film', f: { temperature: 24, contrast: 8, fade: 30, grain: 24, saturation: -8 } },
  { id: 'golden', name: 'Golden Hour', f: { temperature: 38, tint: 6, saturation: 14, brightness: 4, vignette: 22 } },
  { id: 'cool', name: 'Arctic', f: { temperature: -30, contrast: 10, saturation: -6 } },
  { id: 'matte', name: 'Matte', f: { fade: 48, contrast: -8, saturation: -16 } },
  { id: 'punch', name: 'Punch', f: { contrast: 30, saturation: 12, vignette: 32, sharpen: 30 } },
  { id: 'mono', name: 'Mono', f: { saturation: -100, contrast: 18 } },
  { id: 'noir', name: 'Noir', f: { saturation: -100, contrast: 44, vignette: 58, grain: 20, brightness: -6 } },
  { id: 'vhs', name: 'VHS', f: { rgbSplit: 38, grain: 42, saturation: 18, fade: 22, contrast: -6 } },
  { id: 'neon', name: 'Neon Night', f: { hue: -18, saturation: 42, contrast: 16, temperature: -12, rgbSplit: 12 } },
  { id: 'dream', name: 'Dream', f: { blur: 5, brightness: 8, saturation: 14, fade: 24, vignette: 18 } },
];

export const TRANSITIONS: { id: TransitionType; name: string; glyph: string }[] = [
  { id: 'crossfade', name: 'Cross dissolve', glyph: '◐' },
  { id: 'dipBlack', name: 'Dip to black', glyph: '●' },
  { id: 'dipWhite', name: 'Dip to white', glyph: '○' },
  { id: 'slideLeft', name: 'Push left', glyph: '⇠' },
  { id: 'slideRight', name: 'Push right', glyph: '⇢' },
  { id: 'slideUp', name: 'Push up', glyph: '⇡' },
  { id: 'slideDown', name: 'Push down', glyph: '⇣' },
  { id: 'wipeRight', name: 'Wipe right', glyph: '▶' },
  { id: 'wipeLeft', name: 'Wipe left', glyph: '◀' },
  { id: 'wipeUp', name: 'Wipe up', glyph: '▲' },
  { id: 'wipeDown', name: 'Wipe down', glyph: '▼' },
  { id: 'zoomIn', name: 'Zoom in', glyph: '⊕' },
  { id: 'zoomOut', name: 'Zoom out', glyph: '⊖' },
  { id: 'blur', name: 'Blur', glyph: '≋' },
  { id: 'spin', name: 'Spin', glyph: '↻' },
];

export const CLIP_ANIMS: { id: ClipAnim; name: string }[] = [
  { id: 'none', name: 'None' },
  { id: 'fade', name: 'Fade' },
  { id: 'pop', name: 'Pop' },
  { id: 'slideUp', name: 'Slide up' },
  { id: 'slideDown', name: 'Slide down' },
  { id: 'zoom', name: 'Zoom' },
  { id: 'typewriter', name: 'Typewriter' },
];

export const CANVAS_PRESETS: { id: string; label: string; hint: string; w: number; h: number }[] = [
  { id: '9:16', label: '9:16', hint: 'Reels · Shorts · TikTok', w: 1080, h: 1920 },
  { id: '16:9', label: '16:9', hint: 'YouTube · tutorials', w: 1920, h: 1080 },
  { id: '1:1', label: '1:1', hint: 'Square feed', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5', hint: 'Portrait feed', w: 1080, h: 1350 },
  { id: '4:3', label: '4:3', hint: 'Classic', w: 1440, h: 1080 },
  { id: '21:9', label: '21:9', hint: 'Cinematic', w: 2520, h: 1080 },
];

export const KOKORO_VOICES: { id: string; name: string; group: string }[] = [
  { id: 'af_heart', name: 'Heart', group: 'American · female' },
  { id: 'af_bella', name: 'Bella', group: 'American · female' },
  { id: 'af_nicole', name: 'Nicole', group: 'American · female' },
  { id: 'af_sarah', name: 'Sarah', group: 'American · female' },
  { id: 'af_nova', name: 'Nova', group: 'American · female' },
  { id: 'af_sky', name: 'Sky', group: 'American · female' },
  { id: 'am_michael', name: 'Michael', group: 'American · male' },
  { id: 'am_adam', name: 'Adam', group: 'American · male' },
  { id: 'am_eric', name: 'Eric', group: 'American · male' },
  { id: 'am_liam', name: 'Liam', group: 'American · male' },
  { id: 'am_fenrir', name: 'Fenrir', group: 'American · male' },
  { id: 'am_puck', name: 'Puck', group: 'American · male' },
  { id: 'bf_emma', name: 'Emma', group: 'British · female' },
  { id: 'bf_isabella', name: 'Isabella', group: 'British · female' },
  { id: 'bf_alice', name: 'Alice', group: 'British · female' },
  { id: 'bf_lily', name: 'Lily', group: 'British · female' },
  { id: 'bm_george', name: 'George', group: 'British · male' },
  { id: 'bm_lewis', name: 'Lewis', group: 'British · male' },
  { id: 'bm_daniel', name: 'Daniel', group: 'British · male' },
  { id: 'bm_fable', name: 'Fable', group: 'British · male' },
];

export const WHISPER_MODELS = [
  { id: 'tiny', repo: 'onnx-community/whisper-tiny_timestamped', name: 'Fast', size: '≈ 41 MB' },
  { id: 'base', repo: 'onnx-community/whisper-base_timestamped', name: 'Balanced', size: '≈ 77 MB' },
  { id: 'small', repo: 'onnx-community/whisper-small_timestamped', name: 'Accurate', size: '≈ 249 MB' },
] as const;

export const LANGUAGES: [string, string][] = [
  ['auto', 'Auto-detect'],
  ['english', 'English'],
  ['spanish', 'Spanish'],
  ['french', 'French'],
  ['german', 'German'],
  ['portuguese', 'Portuguese'],
  ['italian', 'Italian'],
  ['dutch', 'Dutch'],
  ['polish', 'Polish'],
  ['turkish', 'Turkish'],
  ['russian', 'Russian'],
  ['ukrainian', 'Ukrainian'],
  ['hindi', 'Hindi'],
  ['indonesian', 'Indonesian'],
  ['vietnamese', 'Vietnamese'],
  ['arabic', 'Arabic'],
  ['japanese', 'Japanese'],
  ['korean', 'Korean'],
  ['chinese', 'Chinese'],
];

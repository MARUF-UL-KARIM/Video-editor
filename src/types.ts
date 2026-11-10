export type TrackKind = 'video' | 'text' | 'audio';
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export type ClipType = 'video' | 'image' | 'audio' | 'text';
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
export interface Keyframe {
  t: number;
  v: number;
  ease: Ease;
}

export interface Filters {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  hue: number;
  fade: number;
  blur: number;
  sharpen: number;
  vignette: number;
  grain: number;
  rgbSplit: number;
}

export interface Chroma {
  enabled: boolean;
  color: string;
  similarity: number;
  smoothness: number;
}

export type TransitionType =
  | 'crossfade'
  | 'dipBlack'
  | 'dipWhite'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'blur'
  | 'spin';

export interface Transition {
  type: TransitionType;
  duration: number;
}

export type ClipAnim = 'none' | 'fade' | 'pop' | 'slideUp' | 'slideDown' | 'zoom' | 'typewriter';
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'add';

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  weight: number;
  italic: boolean;
  uppercase: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  strokeColor: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowY: number;
  bgColor: string;
  bgOpacity: number;
  bgPadding: number;
  bgRadius: number;
  maxWidth: number;
  highlight: 'none' | 'color' | 'box';
  highlightColor: string;
}

export interface Clip {
  id: string;
  trackId: string;
  type: ClipType;
  assetId?: string;
  name: string;
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  // visual
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  fit: 'contain' | 'cover';
  flipH: boolean;
  radius: number;
  blend: BlendMode;
  filters: Filters;
  look: string;
  chroma: Chroma;
  removeBg: boolean;
  transitionIn: Transition | null;
  keyframes: Partial<Record<AnimProp, Keyframe[]>>;
  animIn: ClipAnim;
  animOut: ClipAnim;
  animDur: number;
  // audio
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  denoise: boolean;
  enhance: boolean;
  normalize: boolean;
  // text
  text: string;
  style: TextStyle;
  words?: Word[];
  caption?: boolean;
}

export interface Asset {
  id: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  size: number;
  mime: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  thumb: string;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  tracks: Track[];
  clips: Clip[];
  assets: Asset[];
}

export type PanelId = 'media' | 'text' | 'captions' | 'voice' | 'looks' | 'transitions' | 'script' | 'inspector' | null;

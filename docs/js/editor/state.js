// Estado compartilhado entre o motor de desenho e a interface do editor.
import { clamp } from '../util.js';

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6); else if (max === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
}
export const rgbToHex = ({ r, g, b }) => '#' + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const PRESETS = [
  { id: 'pincel',    name: 'Pincel',     size: 28, hardness: 0.55, opacity: 1,    flow: 1,    spacing: 0.06, smoothing: 0.25, pressureSize: true,  pressureOpacity: false, speed: false, grain: 0 },
  { id: 'lapis',     name: 'Lápis',      size: 5,  hardness: 0.9,  opacity: 0.95, flow: 0.85, spacing: 0.05, smoothing: 0.1,  pressureSize: true,  pressureOpacity: true,  speed: false, grain: 0.55 },
  { id: 'nanquim',   name: 'Nanquim',    size: 9,  hardness: 1,    opacity: 1,    flow: 1,    spacing: 0.04, smoothing: 0.55, pressureSize: true,  pressureOpacity: false, speed: true,  grain: 0 },
  { id: 'marcador',  name: 'Marcador',   size: 36, hardness: 1,    opacity: 0.6,  flow: 1,    spacing: 0.05, smoothing: 0.3,  pressureSize: false, pressureOpacity: false, speed: false, grain: 0 },
  { id: 'aerografo', name: 'Aerógrafo',  size: 90, hardness: 0,    opacity: 1,    flow: 0.12, spacing: 0.08, smoothing: 0.2,  pressureSize: false, pressureOpacity: true,  speed: false, grain: 0 },
  { id: 'carvao',    name: 'Carvão',     size: 26, hardness: 0.7,  opacity: 1,    flow: 0.55, spacing: 0.1,  smoothing: 0.15, pressureSize: true,  pressureOpacity: true,  speed: false, grain: 0.85 },
];
export const ERASER_PRESET = { id: 'borracha', name: 'Borracha', size: 40, hardness: 0.75, opacity: 1, flow: 1, spacing: 0.06, smoothing: 0.2, pressureSize: true, pressureOpacity: false, speed: false, grain: 0 };

export const TOOLS = [
  { id: 'pincel',    label: 'Pincel',        key: 'B', icon: 'brush' },
  { id: 'borracha',  label: 'Borracha',      key: 'E', icon: 'eraser' },
  { id: 'balde',     label: 'Balde de tinta', key: 'G', icon: 'bucket' },
  { id: 'degrade',   label: 'Degradê',       key: 'D', icon: 'gradient' },
  { id: 'gotas',     label: 'Conta-gotas',   key: 'I', icon: 'picker' },
  { id: 'linha',     label: 'Linha',         key: 'L', icon: 'line' },
  { id: 'retangulo', label: 'Retângulo',     key: 'R', icon: 'rect' },
  { id: 'elipse',    label: 'Elipse',        key: 'O', icon: 'ellipse' },
  { id: 'texto',     label: 'Texto',         key: 'T', icon: 'text' },
  { id: 'selecao',   label: 'Seleção',       key: 'M', icon: 'select' },
  { id: 'mover',     label: 'Mover',         key: 'V', icon: 'move' },
  { id: 'mao',       label: 'Mão (arrastar tela)', key: 'H', icon: 'hand' },
];

class State extends EventTarget {
  constructor() {
    super();
    this.tool = 'pincel';
    this.prevTool = 'pincel';
    this.color = { h: 232, s: 0.7, v: 0.62 };      // cor principal (HSV)
    this.color2 = { h: 0, s: 0, v: 1 };            // cor secundária
    this.recent = [];
    this.presetId = 'pincel';
    this.brushes = Object.fromEntries([...PRESETS, ERASER_PRESET].map((p) => [p.id, { ...p }]));
    this.symmetry = false;
    this.grid = false;
    this.shapeMode = 'stroke'; // stroke | fill | both
    this.fill = { tolerance: 0.12, grow: 1, sampleAll: false, contiguous: true };
    this.text = { font: 'sans', size: 96, bold: false, italic: false };
    this.stylusSeen = false;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get brush() { return this.tool === 'borracha' ? this.brushes.borracha : this.brushes[this.presetId]; }
  get rgb() { return hsvToRgb(this.color.h, this.color.s, this.color.v); }
  get hex() { return rgbToHex(this.rgb); }
  get rgb2() { return hsvToRgb(this.color2.h, this.color2.s, this.color2.v); }
  get hex2() { return rgbToHex(this.rgb2); }

  setTool(id) {
    if (id === this.tool) return;
    if (this.tool !== 'mao') this.prevTool = this.tool;
    this.tool = id; this.emit('tool');
  }
  setColor(hsv, { remember = false } = {}) {
    this.color = { ...hsv }; this.emit('color');
    if (remember) this.remember();
  }
  setColorRgb(rgb, opts) { this.setColor(rgbToHsv(rgb.r, rgb.g, rgb.b), opts); }
  remember() {
    const hex = this.hex;
    this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, 14);
    this.emit('recent');
  }
  swapColors() { [this.color, this.color2] = [this.color2, this.color]; this.emit('color'); }
  resetColors() { this.color = { h: 0, s: 0, v: 0 }; this.color2 = { h: 0, s: 0, v: 1 }; this.emit('color'); }
  setPreset(id) { this.presetId = id; if (this.tool !== 'pincel') { this.setTool('pincel'); } this.emit('brush'); this.emit('tool'); }
  setBrush(props) { Object.assign(this.brush, props); this.emit('brush'); }
}

export const state = new State();

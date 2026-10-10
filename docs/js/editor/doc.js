// Modelo do documento: camadas (canvas), histórico (desfazer/refazer) e eventos.
import { makeCanvas, uid } from '../util.js';

export const BLEND_MODES = [
  ['source-over', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Tela'], ['overlay', 'Sobrepor'],
  ['darken', 'Escurecer'], ['lighten', 'Clarear'], ['color-dodge', 'Subexpor cor'], ['color-burn', 'Superexpor cor'],
  ['hard-light', 'Luz direta'], ['soft-light', 'Luz suave'], ['difference', 'Diferença'], ['exclusion', 'Exclusão'],
  ['hue', 'Matiz'], ['saturation', 'Saturação'], ['color', 'Cor'], ['luminosity', 'Luminosidade'],
];

export const MAX_LAYERS = 24;
const HISTORY_PIXEL_BUDGET = 40_000_000; // ~160 MB de pixels guardados no histórico

export class Layer {
  constructor(w, h, props = {}) {
    this.id = props.id || uid(8);
    this.name = props.name || 'Camada';
    this.visible = props.visible !== false;
    this.locked = !!props.locked;
    this.opacity = props.opacity ?? 1;
    this.blend = props.blend || 'source-over';
    this.file = props.file || null; // token do PNG salvo no servidor
    this.ver = 0;                   // sobe a cada alteração de pixels
    this.savedVer = props.file ? 0 : -1; // versão enviada ao servidor
    this.canvas = makeCanvas(w, h);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
  }
  get dirty() { return this.ver !== this.savedVer; }
  snapshotProps() { return { id: this.id, name: this.name, visible: this.visible, locked: this.locked, opacity: this.opacity, blend: this.blend }; }
}

export class Doc extends EventTarget {
  constructor({ id = null, name = 'Sem título', width = 2048, height = 1536, layers = [], rev = 1 } = {}) {
    super();
    this.id = id; this.name = name; this.width = width; this.height = height; this.rev = rev;
    this.layers = layers;
    this.activeId = layers.length ? layers[layers.length - 1].id : null;
    this.undoStack = []; this.redoStack = []; this.historyPixels = 0;
    this.edit = null;
    this.selection = null; // {x,y,w,h} em px do documento
    this.modifiedAt = 0;
    this.metaDirty = false;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get active() { return this.layers.find((l) => l.id === this.activeId) || null; }
  get activeIndex() { return this.layers.findIndex((l) => l.id === this.activeId); }
  layerById(id) { return this.layers.find((l) => l.id === id); }

  /** Avisa que algo mudou (para redesenhar e agendar salvamento). */
  changed({ pixels = false, structure = false, layer = null } = {}) {
    if (pixels && layer) layer.ver++;
    if (structure) this.metaDirty = true;
    this.modifiedAt = Date.now();
    this.emit('render');
    if (pixels || structure) this.emit('modified', { pixels, structure, layer });
    if (structure) this.emit('layers');
  }

  // ---------- histórico ----------
  pushHistory(entry) {
    this.undoStack.push(entry);
    this.historyPixels += entry.cost || 0;
    this.redoStack.length = 0;
    while (this.undoStack.length > 1 && (this.undoStack.length > 80 || this.historyPixels > HISTORY_PIXEL_BUDGET)) {
      const old = this.undoStack.shift(); this.historyPixels -= old.cost || 0;
    }
    this.emit('history');
  }
  undo() {
    const e = this.undoStack.pop(); if (!e) return;
    this.historyPixels -= e.cost || 0;
    e.undo(); this.redoStack.push(e); this.emit('history');
  }
  redo() {
    const e = this.redoStack.pop(); if (!e) return;
    e.redo(); this.undoStack.push(e); this.historyPixels += e.cost || 0; this.emit('history');
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ---------- edição de pixels com histórico por região ----------
  /** Começa a editar os pixels de uma camada; guarda uma cópia para desfazer. */
  beginEdit(layer) {
    if (this.edit) this.cancelEdit();
    if (!this.beforeBuf) this.beforeBuf = makeCanvas(this.width, this.height);
    const b = this.beforeBuf.getContext('2d');
    b.clearRect(0, 0, this.width, this.height);
    b.drawImage(layer.canvas, 0, 0);
    this.edit = { layer, dirty: null };
  }
  /** Marca uma região como alterada (coordenadas do documento). */
  touch(x, y, w, h) {
    const e = this.edit; if (!e) return;
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w)), y1 = Math.min(this.height, Math.ceil(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    const d = e.dirty;
    e.dirty = d ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) } : { x0, y0, x1, y1 };
  }
  touchAll() { this.touch(0, 0, this.width, this.height); }

  commitEdit() {
    const e = this.edit; this.edit = null;
    if (!e || !e.dirty) return false;
    const { x0, y0, x1, y1 } = e.dirty, w = x1 - x0, h = y1 - y0;
    const layer = e.layer;
    const before = makeCanvas(w, h); before.getContext('2d').drawImage(this.beforeBuf, x0, y0, w, h, 0, 0, w, h);
    const after = makeCanvas(w, h); after.getContext('2d').drawImage(layer.canvas, x0, y0, w, h, 0, 0, w, h);
    const apply = (src) => {
      layer.ctx.save();
      layer.ctx.globalCompositeOperation = 'source-over'; layer.ctx.globalAlpha = 1;
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.clearRect(x0, y0, w, h); layer.ctx.drawImage(src, x0, y0);
      layer.ctx.restore();
      this.changed({ pixels: true, layer });
    };
    this.pushHistory({ cost: w * h * 2, undo: () => apply(before), redo: () => apply(after) });
    this.changed({ pixels: true, layer });
    return true;
  }
  /** Descarta a edição atual restaurando a região alterada. */
  cancelEdit() {
    const e = this.edit; this.edit = null;
    if (!e) return;
    if (e.dirty) {
      const { x0, y0, x1, y1 } = e.dirty;
      const ctx = e.layer.ctx;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      ctx.drawImage(this.beforeBuf, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }
    this.emit('render');
  }

  // ---------- estrutura de camadas ----------
  structureSnapshot() {
    return { layers: this.layers.slice(), props: this.layers.map((l) => l.snapshotProps()), activeId: this.activeId };
  }
  restoreStructure(s) {
    this.layers = s.layers.slice();
    s.layers.forEach((l, i) => Object.assign(l, s.props[i]));
    this.activeId = s.activeId;
    this.changed({ structure: true });
  }
  /** Executa `fn` (que muda a estrutura) registrando desfazer/refazer. */
  structureEdit(fn) {
    const before = this.structureSnapshot();
    fn();
    const after = this.structureSnapshot();
    this.pushHistory({ cost: 0, undo: () => this.restoreStructure(before), redo: () => this.restoreStructure(after) });
    this.changed({ structure: true });
  }

  addLayer(name) {
    if (this.layers.length >= MAX_LAYERS) return null;
    const l = new Layer(this.width, this.height, { name: name || `Camada ${this.layers.length + 1}` });
    this.structureEdit(() => { this.layers.splice(this.activeIndex + 1, 0, l); this.activeId = l.id; });
    return l;
  }
  duplicateLayer() {
    const src = this.active; if (!src || this.layers.length >= MAX_LAYERS) return null;
    const l = new Layer(this.width, this.height, { ...src.snapshotProps(), id: undefined, name: src.name + ' cópia' });
    l.ctx.drawImage(src.canvas, 0, 0); l.ver = 1;
    this.structureEdit(() => { this.layers.splice(this.activeIndex + 1, 0, l); this.activeId = l.id; });
    return l;
  }
  deleteLayer() {
    if (this.layers.length <= 1) return false;
    this.structureEdit(() => {
      const i = this.activeIndex; this.layers.splice(i, 1);
      this.activeId = this.layers[Math.min(i, this.layers.length - 1)].id;
    });
    return true;
  }
  moveLayer(dir) {
    const i = this.activeIndex, j = i + dir;
    if (j < 0 || j >= this.layers.length) return;
    this.structureEdit(() => { const [l] = this.layers.splice(i, 1); this.layers.splice(j, 0, l); });
  }
  setActive(id) { if (this.layerById(id)) { this.activeId = id; this.emit('layers'); this.emit('active'); } }
  /** Altera propriedades (visível, opacidade, nome...) com histórico. */
  setLayerProps(layer, props) {
    this.structureEdit(() => Object.assign(layer, props));
  }
  mergeDown() {
    const i = this.activeIndex; if (i <= 0) return false;
    const top = this.layers[i], below = this.layers[i - 1];
    if (below.locked) return false;
    const w = this.width, h = this.height;
    const beforeBelow = makeCanvas(w, h); beforeBelow.getContext('2d').drawImage(below.canvas, 0, 0);
    const snap = this.structureSnapshot();
    below.ctx.save(); below.ctx.globalAlpha = top.visible ? top.opacity : 0; below.ctx.globalCompositeOperation = top.blend;
    below.ctx.drawImage(top.canvas, 0, 0); below.ctx.restore();
    const afterBelow = makeCanvas(w, h); afterBelow.getContext('2d').drawImage(below.canvas, 0, 0);
    this.layers.splice(i, 1); this.activeId = below.id;
    const after = this.structureSnapshot();
    const put = (src) => { below.ctx.save(); below.ctx.globalAlpha = 1; below.ctx.globalCompositeOperation = 'source-over'; below.ctx.clearRect(0, 0, w, h); below.ctx.drawImage(src, 0, 0); below.ctx.restore(); };
    this.pushHistory({
      cost: w * h * 2,
      undo: () => { put(beforeBelow); this.restoreStructure(snap); this.changed({ pixels: true, layer: below }); },
      redo: () => { put(afterBelow); this.restoreStructure(after); this.changed({ pixels: true, layer: below }); },
    });
    this.changed({ pixels: true, structure: true, layer: below });
    return true;
  }
  clearLayer() {
    const l = this.active; if (!l || l.locked) return;
    this.beginEdit(l); l.ctx.clearRect(0, 0, this.width, this.height); this.touchAll(); this.commitEdit();
  }

  // ---------- composição ----------
  /** Cola todas as camadas visíveis em um canvas do tamanho do documento. */
  flatten({ background = null, scale = 1 } = {}) {
    const c = makeCanvas(Math.round(this.width * scale), Math.round(this.height * scale));
    const ctx = c.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.imageSmoothingQuality = 'high';
    for (const l of this.layers) {
      if (!l.visible) continue;
      ctx.globalAlpha = l.opacity; ctx.globalCompositeOperation = l.blend;
      ctx.drawImage(l.canvas, 0, 0, c.width, c.height);
    }
    return c;
  }
  /** Cor composta em um ponto (conta-gotas). */
  sampleColor(x, y, allLayers = true) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const c = makeCanvas(1, 1), ctx = c.getContext('2d', { willReadFrequently: true });
    const list = allLayers ? this.layers : [this.active];
    for (const l of list) {
      if (!l || !l.visible) continue;
      ctx.globalAlpha = allLayers ? l.opacity : 1; ctx.globalCompositeOperation = allLayers ? l.blend : 'source-over';
      ctx.drawImage(l.canvas, -x, -y);
    }
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return d[3] === 0 ? null : { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
}

export function newDocFromOptions({ name, width, height, background }) {
  const doc = new Doc({ name, width, height });
  const base = new Layer(width, height, { name: 'Fundo' });
  if (background) { base.ctx.fillStyle = background; base.ctx.fillRect(0, 0, width, height); }
  base.ver = 1;
  const first = new Layer(width, height, { name: 'Camada 1' });
  first.ver = 1;
  doc.layers = [base, first]; doc.activeId = first.id;
  return doc;
}

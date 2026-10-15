// Motor do editor: visualização (zoom/giro/arrastar), entrada por ponteiro (mouse, toque, caneta) e ferramentas.
import { state } from './state.js';
import { BrushStroke } from './brush.js';
import { floodFill } from './fill.js';
import { makeCanvas, clamp } from '../util.js';

const MIN_SCALE = 0.02, MAX_SCALE = 64;
export const FONTS = {
  sans: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Menlo, Consolas, monospace',
  manuscrita: '"Segoe Script", "Bradley Hand", "Brush Script MT", cursive',
};
const NEEDS_LAYER = new Set(['pincel', 'borracha', 'balde', 'degrade', 'linha', 'retangulo', 'elipse', 'texto', 'mover']);

export class Engine extends EventTarget {
  constructor(stage, doc) {
    super();
    this.stage = stage; this.doc = doc;
    this.view = document.createElement('canvas'); this.view.className = 'view';
    stage.append(this.view);
    this.vctx = this.view.getContext('2d');
    this.comp = makeCanvas(1, 1); this.cctx = this.comp.getContext('2d');
    this.strokeBuf = makeCanvas(doc.width, doc.height); this.sbctx = this.strokeBuf.getContext('2d');
    this.tx = 0; this.ty = 0; this.scale = 1; this.rot = 0;
    this.dpr = 1; this.w = 1; this.h = 1;
    this.pointers = new Map();
    this.active = null; this.gesture = null; this.stroke = null; this.shape = null; this.drag = null;
    this.preview = null; this.hover = null; this.spaceDown = false;
    this.raf = 0; this.fitted = false;

    this.onRender = () => this.requestRender();
    doc.addEventListener('render', this.onRender);
    state.addEventListener('tool', this.onRender);
    state.addEventListener('brush', this.onRender);

    this.bind();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    this.resize();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  notice(msg) { this.emit('notice', msg); }

  destroy() {
    this.ro.disconnect();
    this.doc.removeEventListener('render', this.onRender);
    state.removeEventListener('tool', this.onRender);
    state.removeEventListener('brush', this.onRender);
    for (const [t, fn, o] of this.listeners) t.removeEventListener(fn.type, fn.fn, o);
    cancelAnimationFrame(this.raf);
    this.view.remove();
  }

  // ---------- geometria da visualização ----------
  toDoc(sx, sy) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), dx = sx - this.tx, dy = sy - this.ty;
    return { x: (c * dx + s * dy) / this.scale, y: (-s * dx + c * dy) / this.scale };
  }
  toScreen(x, y) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return { x: this.tx + this.scale * (c * x - s * y), y: this.ty + this.scale * (s * x + c * y) };
  }
  anchor(p, sx, sy) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    this.tx = sx - this.scale * (c * p.x - s * p.y);
    this.ty = sy - this.scale * (s * p.x + c * p.y);
  }
  zoomAt(sx, sy, factor) {
    const p = this.toDoc(sx, sy);
    this.scale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    this.anchor(p, sx, sy); this.viewChanged();
  }
  zoomCenter(factor) { this.zoomAt(this.w / 2, this.h / 2, factor); }
  setZoom(scale) { this.zoomAt(this.w / 2, this.h / 2, scale / this.scale); }
  resetRotation() {
    const p = this.toDoc(this.w / 2, this.h / 2);
    this.rot = 0; this.anchor(p, this.w / 2, this.h / 2); this.viewChanged();
  }
  fit() {
    const pad = Math.min(32, Math.min(this.w, this.h) * 0.06);
    this.rot = 0;
    this.scale = clamp(Math.min((this.w - pad * 2) / this.doc.width, (this.h - pad * 2) / this.doc.height), MIN_SCALE, 2);
    this.tx = (this.w - this.scale * this.doc.width) / 2; this.ty = (this.h - this.scale * this.doc.height) / 2;
    this.viewChanged();
  }
  viewChanged() { this.emit('view', { zoom: this.scale, rot: this.rot }); this.requestRender(); }

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const pw = this.w, ph = this.h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = r.width; this.h = r.height;
    this.view.width = this.comp.width = Math.round(r.width * this.dpr);
    this.view.height = this.comp.height = Math.round(r.height * this.dpr);
    if (!this.fitted) { this.fitted = true; this.fit(); }
    else { this.tx += (this.w - pw) / 2; this.ty += (this.h - ph) / 2; this.viewChanged(); }
  }

  requestRender() { if (!this.raf) this.raf = requestAnimationFrame(() => this.render()); }

  // ---------- renderização ----------
  checker() {
    if (this._checker && this._checkerDpr === this.dpr) return this._checker;
    const s = Math.round(10 * this.dpr), c = makeCanvas(s * 2, s * 2), g = c.getContext('2d');
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, s * 2, s * 2);
    g.fillStyle = '#d4d4d4'; g.fillRect(0, 0, s, s); g.fillRect(s, s, s, s);
    this._checkerDpr = this.dpr;
    return (this._checker = this.vctx.createPattern(c, 'repeat'));
  }

  render() {
    this.raf = 0;
    const { vctx: ctx, cctx, doc, dpr } = this;
    const W = this.view.width, H = this.view.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    const corners = [[0, 0], [doc.width, 0], [doc.width, doc.height], [0, doc.height]].map(([x, y]) => {
      const p = this.toScreen(x, y); return [p.x * dpr, p.y * dpr];
    });
    const path = () => { ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    ctx.save(); path();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 28 * dpr; ctx.shadowOffsetY = 8 * dpr;
    ctx.fillStyle = '#e6e6e6'; ctx.fill(); ctx.restore();
    ctx.save(); path(); ctx.clip(); ctx.fillStyle = this.checker(); ctx.fillRect(0, 0, W, H); ctx.restore();
    if (doc.paper) { ctx.save(); path(); ctx.clip(); ctx.fillStyle = doc.paper; ctx.fillRect(0, 0, W, H); ctx.restore(); }

    // composição das camadas na tela
    cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, W, H);
    const c = Math.cos(this.rot) * this.scale * dpr, s = Math.sin(this.rot) * this.scale * dpr;
    const m = [c, s, -s, c, this.tx * dpr, this.ty * dpr];
    cctx.setTransform(...m);
    cctx.imageSmoothingEnabled = this.scale < 3; cctx.imageSmoothingQuality = 'high';
    const vi = doc.veilIndex; // mesa de luz: o "papel" translúcido fica por cima da foto de referência
    doc.layers.forEach((l, i) => {
      if (!l.visible) return;
      cctx.globalCompositeOperation = l.blend;
      cctx.globalAlpha = l.opacity;
      cctx.drawImage(l.canvas, 0, 0);
      const pv = this.preview;
      if (pv && pv.layer === l) {
        cctx.globalAlpha = l.opacity * (pv.alpha ?? 1);
        cctx.drawImage(pv.canvas, pv.x || 0, pv.y || 0);
      }
      if (i === vi) { cctx.globalCompositeOperation = 'source-over'; cctx.globalAlpha = doc.light.veil; cctx.fillStyle = doc.paper || '#ffffff'; cctx.fillRect(0, 0, doc.width, doc.height); }
    });
    cctx.globalAlpha = 1; cctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.comp, 0, 0);

    // sobreposições no espaço do documento
    ctx.save(); path(); ctx.clip();
    ctx.setTransform(...m);
    const lw = 1 / (this.scale * dpr) * dpr;
    if (state.grid) {
      let step = 64; while (step * this.scale < 28) step *= 2; while (step * this.scale > 120 && step > 4) step /= 2;
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(110,120,140,.45)'; ctx.beginPath();
      for (let x = step; x < doc.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, doc.height); }
      for (let y = step; y < doc.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(doc.width, y); }
      ctx.stroke();
    }
    if (state.symmetry) {
      ctx.lineWidth = lw * 1.5; ctx.strokeStyle = 'rgba(74,95,240,.8)'; ctx.setLineDash([8 * lw, 6 * lw]);
      ctx.beginPath(); ctx.moveTo(doc.width / 2, 0); ctx.lineTo(doc.width / 2, doc.height); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    const sel = this.drag?.kind === 'select' ? this.drag.rect : doc.selection;
    if (sel && sel.w > 0 && sel.h > 0) {
      ctx.save(); ctx.setTransform(...m);
      ctx.lineWidth = lw * 1.2;
      ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.strokeStyle = '#111'; ctx.setLineDash([5 * lw, 5 * lw]); ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.restore();
    }
    // cursor do pincel (apenas mouse)
    if (this.hover && !this.active && ['pincel', 'borracha', 'linha', 'retangulo', 'elipse'].includes(state.tool) && !this.spaceDown) {
      const size = (state.tool === 'borracha' ? state.brushes.borracha : state.brushes[state.presetId]).size;
      const r = Math.max(1.5, size * this.scale / 2) * dpr;
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = dpr; ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath(); ctx.arc(this.hover.x * dpr, this.hover.y * dpr, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.beginPath(); ctx.arc(this.hover.x * dpr, this.hover.y * dpr, r + dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- entrada ----------
  bind() {
    this.listeners = [];
    const on = (target, type, fn, opts) => {
      const wrapped = fn.bind(this);
      target.addEventListener(type, wrapped, opts);
      this.listeners.push([target, { type, fn: wrapped }, opts]);
    };
    const st = this.stage;
    on(st, 'pointerdown', this.onDown);
    on(st, 'pointermove', this.onMove);
    on(st, 'pointerup', this.onUp);
    on(st, 'pointercancel', this.onCancel);
    on(st, 'pointerleave', () => { this.hover = null; this.requestRender(); });
    on(st, 'wheel', this.onWheel, { passive: false });
    on(st, 'contextmenu', (e) => e.preventDefault());
    on(window, 'keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || '')) {
        e.preventDefault(); if (!this.spaceDown) { this.spaceDown = true; this.stage.classList.add('panning'); this.requestRender(); }
      }
    });
    on(window, 'keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; this.stage.classList.remove('panning'); this.requestRender(); } });
  }

  local(e) { const r = this.stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  pt(e, pos) {
    const d = this.toDoc(pos.x, pos.y);
    return { x: d.x, y: d.y, p: e.pressure, type: e.pointerType, t: e.timeStamp };
  }
  touches() { return [...this.pointers.values()].filter((p) => p.type === 'touch' && !p.ignore); }

  onDown(e) {
    e.preventDefault();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    try { this.stage.setPointerCapture(e.pointerId); } catch {}
    const pos = this.local(e);
    this.pointers.set(e.pointerId, { x: pos.x, y: pos.y, type: e.pointerType });
    if (e.pointerType === 'pen') state.stylusSeen = true;

    if (e.pointerType === 'touch') {
      const ts = this.touches();
      if (ts.length >= 2) { this.cancelTool(); this.active = null; this.beginGesture(); return; }
    }
    if (this.active) return;

    let mode = 'tool', tool = state.tool;
    if (e.pointerType === 'mouse' && e.button === 2) return;
    if ((e.pointerType === 'mouse' && e.button === 1) || this.spaceDown || tool === 'mao') mode = 'pan';
    else if (e.pointerType === 'touch' && state.stylusSeen) mode = 'pan'; // rejeição de palma: com caneta, o dedo só move a tela
    else if (e.altKey && e.pointerType === 'mouse') tool = 'gotas';

    this.active = { id: e.pointerId, mode, tool, last: pos, start: pos };
    if (mode === 'tool') this.toolBegin(tool, this.pt(e, pos));
  }

  onMove(e) {
    const pos = this.local(e);
    const rec = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse') { this.hover = pos; if (!this.active) this.requestRender(); }
    if (rec) { rec.x = pos.x; rec.y = pos.y; }
    if (this.gesture) { this.doGesture(); return; }
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    if (a.mode === 'pan') {
      this.tx += pos.x - a.last.x; this.ty += pos.y - a.last.y; a.last = pos; this.viewChanged(); return;
    }
    const events = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    for (const ev of events) this.toolMove(a.tool, this.pt(ev, this.local(ev)));
    a.last = pos;
  }

  onUp(e) {
    const pos = this.local(e);
    const a = this.active;
    this.pointers.delete(e.pointerId);
    if (this.gesture) {
      if (this.touches().length < 2) { this.endGesture(); for (const p of this.pointers.values()) p.ignore = true; }
      return;
    }
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    if (a.mode === 'tool') this.toolEnd(a.tool, this.pt(e, pos), a);
    try { this.stage.releasePointerCapture(e.pointerId); } catch {}
  }

  onCancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.gesture) { if (this.touches().length < 2) this.endGesture(); return; }
    if (this.active?.id === e.pointerId) { this.cancelTool(); this.active = null; }
  }

  onWheel(e) {
    e.preventDefault();
    const pos = this.local(e);
    const mouseWheel = e.deltaMode === 1 || (e.deltaMode === 0 && e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || mouseWheel) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomAt(pos.x, pos.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
    } else { this.tx -= e.deltaX; this.ty -= e.deltaY; this.viewChanged(); }
  }

  // gesto de dois dedos: arrastar + pinça (zoom) + giro
  beginGesture() {
    const [a, b] = this.touches();
    this.gesture = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    this.emit('gesture', true);
  }
  doGesture() {
    const ts = this.touches(); if (ts.length < 2) return;
    const [a, b] = ts, g = this.gesture;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, ang = Math.atan2(b.y - a.y, b.x - a.x);
    const p = this.toDoc(g.cx, g.cy);
    this.scale = clamp(this.scale * dist / g.dist, MIN_SCALE, MAX_SCALE);
    this.rot += ang - g.ang;
    this.anchor(p, cx, cy);
    Object.assign(g, { cx, cy, dist, ang });
    this.viewChanged();
  }
  endGesture() {
    this.gesture = null;
    const r = ((this.rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (Math.min(r, Math.PI * 2 - r) < 0.07) this.resetRotation();
    this.emit('gesture', false);
  }

  // ---------- ferramentas ----------
  toolBegin(tool, pt) {
    const doc = this.doc, layer = doc.active;
    if (NEEDS_LAYER.has(tool)) {
      if (!layer) return;
      if (layer.locked) { this.notice('Esta camada está bloqueada.'); this.active = null; return; }
      if (!layer.visible) { this.notice('Esta camada está oculta. Mostre-a para desenhar.'); this.active = null; return; }
    }
    switch (tool) {
      case 'pincel': case 'borracha': return this.brushBegin(tool === 'borracha', layer, pt);
      case 'balde': return this.fillAt(layer, pt);
      case 'gotas': return this.pickAt(pt);
      case 'linha': case 'retangulo': case 'elipse': case 'degrade': return this.shapeBegin(tool, layer, pt);
      case 'texto': this.drag = { kind: 'text', pt }; return;
      case 'selecao': this.drag = { kind: 'select', start: pt, rect: null }; return;
      case 'mover': return this.moveBegin(layer, pt);
    }
  }
  toolMove(tool, pt) {
    if (this.stroke) { this.stroke.bs.move(pt); this.requestRender(); return; }
    if (this.shape) return this.shapeMove(pt);
    if (tool === 'gotas') return this.pickAt(pt);
    const d = this.drag; if (!d) return;
    if (d.kind === 'select') {
      const x0 = clamp(Math.min(d.start.x, pt.x), 0, this.doc.width), y0 = clamp(Math.min(d.start.y, pt.y), 0, this.doc.height);
      const x1 = clamp(Math.max(d.start.x, pt.x), 0, this.doc.width), y1 = clamp(Math.max(d.start.y, pt.y), 0, this.doc.height);
      d.rect = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
      this.requestRender();
    } else if (d.kind === 'move') this.moveUpdate(pt);
    else if (d.kind === 'text') d.moved = Math.hypot(pt.x - d.pt.x, pt.y - d.pt.y) * this.scale > 10;
  }
  toolEnd(tool, pt) {
    if (this.stroke) return this.brushEnd(pt);
    if (this.shape) return this.shapeEnd(pt);
    if (tool === 'gotas') { state.remember(); return; }
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.kind === 'select') {
      const r = d.rect;
      this.doc.selection = r && r.w > 2 && r.h > 2 ? r : null;
      this.doc.emit('selection'); this.requestRender();
    } else if (d.kind === 'move') this.moveEnd();
    else if (d.kind === 'text' && !d.moved) this.emit('text-request', { x: Math.round(d.pt.x), y: Math.round(d.pt.y) });
  }
  cancelTool() {
    if (this.stroke) {
      try { this.stroke.bs.end(null); } catch {}
      this.clearBuffer(); this.stroke = null; this.preview = null; this.doc.cancelEdit();
    }
    if (this.shape) { this.clearBuffer(); this.shape = null; this.preview = null; this.doc.cancelEdit(); }
    if (this.drag?.kind === 'move') this.moveCancel();
    this.drag = null; this.requestRender();
  }

  // --- pincel / borracha ---
  brushBegin(eraser, layer, pt) {
    const doc = this.doc;
    const settings = { ...(eraser ? state.brushes.borracha : state.brushes[state.presetId]) };
    doc.beginEdit(layer);
    this.bufDirty = null;
    const bs = new BrushStroke({
      ctx: eraser ? layer.ctx : this.sbctx, docW: doc.width, docH: doc.height, settings, rgb: state.rgb, eraser,
      symmetry: state.symmetry, selection: doc.selection,
      onDirty: (x, y, w, h) => { doc.touch(x, y, w, h); if (!eraser) this.growBuf(x, y, w, h); },
    });
    this.stroke = { bs, eraser, layer, opacity: settings.opacity };
    if (!eraser) this.preview = { layer, canvas: this.strokeBuf, alpha: settings.opacity };
    bs.begin(pt); this.requestRender();
  }
  growBuf(x, y, w, h) {
    const b = this.bufDirty, x1 = x + w, y1 = y + h;
    this.bufDirty = b ? { x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x1), y1: Math.max(b.y1, y1) } : { x0: x, y0: y, x1, y1 };
  }
  clearBuffer() {
    const b = this.bufDirty; this.bufDirty = null;
    const ctx = this.sbctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (b) ctx.clearRect(Math.floor(b.x0) - 1, Math.floor(b.y0) - 1, Math.ceil(b.x1 - b.x0) + 3, Math.ceil(b.y1 - b.y0) + 3);
    else ctx.clearRect(0, 0, this.strokeBuf.width, this.strokeBuf.height);
  }
  /** Cola o buffer do traço na camada (respeitando seleção e opacidade). */
  flushBuffer(layer, alpha) {
    const b = this.bufDirty; if (!b) return;
    const x = Math.max(0, Math.floor(b.x0) - 1), y = Math.max(0, Math.floor(b.y0) - 1);
    const w = Math.min(this.doc.width, Math.ceil(b.x1) + 2) - x, h = Math.min(this.doc.height, Math.ceil(b.y1) + 2) - y;
    if (w <= 0 || h <= 0) return;
    const ctx = layer.ctx, sel = this.doc.selection;
    ctx.save();
    if (sel) { ctx.beginPath(); ctx.rect(sel.x, sel.y, sel.w, sel.h); ctx.clip(); }
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.strokeBuf, x, y, w, h, x, y, w, h);
    ctx.restore();
    this.doc.touch(x, y, w, h);
  }
  brushEnd(pt) {
    const s = this.stroke; this.stroke = null;
    s.bs.end(pt);
    if (!s.eraser) { this.flushBuffer(s.layer, s.opacity); this.clearBuffer(); }
    this.preview = null;
    this.doc.commitEdit();
    state.remember();
    this.requestRender();
  }

  // --- balde ---
  fillAt(layer, pt) {
    const doc = this.doc, f = state.fill;
    doc.beginEdit(layer);
    const r = floodFill({
      target: layer.canvas, source: f.sampleAll ? doc.flatten() : layer.canvas, W: doc.width, H: doc.height,
      x: pt.x, y: pt.y, rgb: state.rgb, opacity: state.brushes.pincel.opacity >= 1 ? 1 : 1,
      tolerance: f.tolerance, grow: f.grow, contiguous: f.contiguous, clip: doc.selection,
    });
    if (r) { doc.touch(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); doc.commitEdit(); state.remember(); }
    else doc.cancelEdit();
    this.active = null;
  }

  pickAt(pt) {
    const c = this.doc.sampleColor(pt.x, pt.y, true);
    if (c) state.setColorRgb(c);
  }

  // --- formas e degradê ---
  shapeBegin(tool, layer, pt) {
    this.doc.beginEdit(layer);
    this.bufDirty = null;
    this.shape = { tool, start: pt, layer };
    this.preview = { layer, canvas: this.strokeBuf, alpha: 1 };
  }
  shapeMove(pt, shift = false) {
    const sh = this.shape;
    this.clearBuffer();
    this.drawShape(this.sbctx, sh.tool, sh.start, pt);
    this.requestRender();
  }
  drawShape(ctx, tool, a, b) {
    const doc = this.doc;
    const size = Math.max(1, state.brushes[state.presetId].size);
    ctx.save();
    ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = ctx.fillStyle = state.hex;
    const passes = state.symmetry && tool !== 'degrade' ? [false, true] : [false];
    for (const mirror of passes) {
      const A = mirror ? { x: doc.width - a.x, y: a.y } : a, B = mirror ? { x: doc.width - b.x, y: b.y } : b;
      if (tool === 'degrade') {
        const g = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
        g.addColorStop(0, state.hex);
        g.addColorStop(1, state.gradientMode === 'transparent' ? `rgba(${state.rgb.r},${state.rgb.g},${state.rgb.b},0)` : state.hex2);
        ctx.fillStyle = g; ctx.fillRect(0, 0, doc.width, doc.height);
        this.growBuf(0, 0, doc.width, doc.height);
      } else if (tool === 'linha') {
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      } else {
        const x = Math.min(A.x, B.x), y = Math.min(A.y, B.y), w = Math.abs(B.x - A.x), h = Math.abs(B.y - A.y);
        ctx.beginPath();
        if (tool === 'retangulo') ctx.rect(x, y, w, h); else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        if (state.shapeMode !== 'stroke') ctx.fill();
        if (state.shapeMode !== 'fill') ctx.stroke();
      }
      if (tool !== 'degrade') this.growBuf(Math.min(A.x, B.x) - size, Math.min(A.y, B.y) - size, Math.abs(B.x - A.x) + size * 2, Math.abs(B.y - A.y) + size * 2);
    }
    ctx.restore();
  }
  shapeEnd(pt) {
    const sh = this.shape; this.shape = null;
    this.clearBuffer();
    this.drawShape(this.sbctx, sh.tool, sh.start, pt);
    this.flushBuffer(sh.layer, 1);
    this.clearBuffer();
    this.preview = null;
    this.doc.commitEdit();
    state.remember();
    this.requestRender();
  }

  // --- texto ---
  commitText({ text, x, y }) {
    const doc = this.doc, layer = doc.active;
    if (!layer || layer.locked || !text.trim()) return;
    const t = state.text, font = `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px ${FONTS[t.font]}`;
    const lines = text.split('\n'), lh = t.size * 1.25;
    doc.beginEdit(layer);
    const ctx = layer.ctx; ctx.save();
    if (doc.selection) { ctx.beginPath(); ctx.rect(doc.selection.x, doc.selection.y, doc.selection.w, doc.selection.h); ctx.clip(); }
    ctx.font = font; ctx.fillStyle = state.hex; ctx.textBaseline = 'top';
    let maxW = 0;
    lines.forEach((ln, i) => { ctx.fillText(ln, x, y + i * lh); maxW = Math.max(maxW, ctx.measureText(ln).width); });
    ctx.restore();
    doc.touch(x - 4, y - 4, maxW + 12, lh * lines.length + 12);
    doc.commitEdit(); state.remember();
  }

  // --- mover (camada inteira ou conteúdo da seleção) ---
  moveBegin(layer, pt) {
    const doc = this.doc;
    const sel = doc.selection || { x: 0, y: 0, w: doc.width, h: doc.height };
    doc.beginEdit(layer);
    const fl = makeCanvas(sel.w, sel.h);
    fl.getContext('2d').drawImage(layer.canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
    layer.ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
    doc.touch(sel.x, sel.y, sel.w, sel.h);
    this.preview = { layer, canvas: fl, x: sel.x, y: sel.y, alpha: 1 };
    this.drag = { kind: 'move', start: pt, sel, hadSel: !!doc.selection };
    this.requestRender();
  }
  moveUpdate(pt) {
    const d = this.drag;
    this.preview.x = d.sel.x + Math.round(pt.x - d.start.x); this.preview.y = d.sel.y + Math.round(pt.y - d.start.y);
    this.requestRender();
  }
  moveEnd() {
    const d = this.drag || {}, pv = this.preview; this.preview = null;
    const ctx = pv.layer.ctx;
    ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(pv.canvas, pv.x, pv.y); ctx.restore();
    this.doc.touch(pv.x, pv.y, pv.canvas.width, pv.canvas.height);
    if (this.doc.selection) { this.doc.selection = { ...this.doc.selection, x: pv.x, y: pv.y }; this.doc.emit('selection'); }
    this.doc.commitEdit(); this.requestRender();
  }
  moveCancel() {
    const pv = this.preview; this.preview = null;
    if (pv) { pv.layer.ctx.drawImage(pv.canvas, this.drag.sel.x, this.drag.sel.y); }
    this.doc.cancelEdit();
  }

  // ---------- ações de seleção e exportação ----------
  selectAll() { this.doc.selection = { x: 0, y: 0, w: this.doc.width, h: this.doc.height }; this.doc.emit('selection'); this.requestRender(); }
  deselect() { this.doc.selection = null; this.doc.emit('selection'); this.requestRender(); }
  clearSelection() {
    const doc = this.doc, layer = doc.active; if (!layer || layer.locked) return;
    const sel = doc.selection || { x: 0, y: 0, w: doc.width, h: doc.height };
    doc.beginEdit(layer); layer.ctx.clearRect(sel.x, sel.y, sel.w, sel.h); doc.touch(sel.x, sel.y, sel.w, sel.h); doc.commitEdit();
  }
  fillSelection() {
    const doc = this.doc, layer = doc.active; if (!layer || layer.locked) return;
    const sel = doc.selection || { x: 0, y: 0, w: doc.width, h: doc.height };
    doc.beginEdit(layer); layer.ctx.fillStyle = state.hex; layer.ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
    doc.touch(sel.x, sel.y, sel.w, sel.h); doc.commitEdit(); state.remember();
  }
}

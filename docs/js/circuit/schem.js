// Modelo do esquema elétrico: peças, fios e textos, com desfazer, ligações (nets), lista de materiais.
// Não usa nada do navegador, então dá para testar no Node.
import { LIBRARY, symbolFor, pinsOf, partBox, symbolName, isPower } from './symbols.js';

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const uid = (n = 8) => { let s = ''; for (let i = 0; i < n; i++) s += ALNUM[Math.floor(Math.random() * ALNUM.length)]; return s; };
const key = (x, y) => x + ',' + y;
const snap10 = (v) => Math.round(v / 10) * 10;
export { snap10 };

export function libItem(id) { return LIBRARY.find((l) => l.id === id) || null; }
const natural = (a, b) => String(a).localeCompare(String(b), 'pt', { numeric: true });

export class Schematic {
  constructor(data) {
    this.parts = []; this.wires = []; this.texts = [];
    this.undoStack = []; this.redoStack = []; this.rev = 0; this.listeners = new Set(); this._base = null;
    if (data) this.load(data);
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind = 'change') { this.rev++; this.listeners.forEach((f) => f(kind)); }

  load(data) {
    const d = data && typeof data === 'object' ? data : {};
    this.parts = (d.parts || []).map((p) => ({ ...p }));
    this.wires = (d.wires || []).map((w) => ({ id: w.id, a: [...w.a], b: [...w.b] }));
    this.texts = (d.texts || []).map((t) => ({ ...t }));
    this.undoStack = []; this.redoStack = []; this.emit('load');
  }
  toJSON() { return { v: 1, parts: this.parts, wires: this.wires, texts: this.texts }; }
  snapshot() { return JSON.stringify(this.toJSON()); }
  restore(s) { const d = JSON.parse(s); this.parts = d.parts; this.wires = d.wires; this.texts = d.texts; }
  get isEmpty() { return !this.parts.length && !this.wires.length && !this.texts.length; }

  // ---------- histórico ----------
  edit(fn) {
    const before = this.snapshot();
    const out = fn();
    this.normalize();
    const after = this.snapshot();
    if (after !== before) this.push(before, after);
    this.emit();
    return out;
  }
  push(before, after) {
    this.undoStack.push({ before, after }); this.redoStack.length = 0;
    if (this.undoStack.length > 120) this.undoStack.shift();
  }
  beginTransient() { this._base = this.snapshot(); }
  setTransient(fn) { if (this._base == null) return; this.restore(this._base); fn(); this.normalize(); this.emit('transient'); }
  endTransient(commit = true) {
    const base = this._base; this._base = null; if (base == null) return false;
    const now = this.snapshot();
    if (!commit) { this.restore(base); this.emit(); return false; }
    if (now === base) { this.emit(); return false; }
    this.push(base, now); this.emit(); return true;
  }
  undo() { const e = this.undoStack.pop(); if (!e) return false; this.restore(e.before); this.redoStack.push(e); this.emit(); return true; }
  redo() { const e = this.redoStack.pop(); if (!e) return false; this.restore(e.after); this.undoStack.push(e); this.emit(); return true; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // ---------- consulta ----------
  part(id) { return this.parts.find((p) => p.id === id); }
  nextRef(prefix) {
    if (!prefix || prefix.startsWith('#')) return '';
    let max = 0;
    for (const p of this.parts) { const m = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$').exec(p.ref || ''); if (m) max = Math.max(max, Number(m[1])); }
    return prefix + (max + 1);
  }

  // ---------- edição ----------
  addPart(libId, x, y, { r = 0, m = false } = {}) {
    const item = libItem(libId); if (!item) return null;
    return this.edit(() => {
      const p = { id: uid(), t: item.t, x: snap10(x), y: snap10(y), r, m, ref: this.nextRef(item.prefix), val: item.val || '' };
      if (item.pins) p.pins = [...item.pins];
      this.parts.push(p); return p;
    });
  }
  /** Cria uma peça sem registrar no histórico (para a "sombra" de quem está colocando). */
  makePart(libId, x, y, { r = 0, m = false } = {}) {
    const item = libItem(libId); if (!item) return null;
    const p = { id: uid(), t: item.t, x: snap10(x), y: snap10(y), r, m, ref: this.nextRef(item.prefix), val: item.val || '' };
    if (item.pins) p.pins = [...item.pins];
    return p;
  }
  insertParts(list) { return this.edit(() => { list.forEach((p) => this.parts.push(p)); return list; }); }
  /** Liga a→b com fio em L (horizontal primeiro, ou vertical primeiro se vFirst). */
  addWire(a, b, { vFirst = false } = {}) {
    return this.edit(() => this._wire(a, b, vFirst));
  }
  _wire(a, b, vFirst = false) {
    const out = [];
    const seg = (p, q) => { if (p[0] === q[0] && p[1] === q[1]) return; const w = { id: uid(), a: [p[0], p[1]], b: [q[0], q[1]] }; this.wires.push(w); out.push(w); };
    if (a[0] === b[0] || a[1] === b[1]) seg(a, b);
    else { const c = vFirst ? [a[0], b[1]] : [b[0], a[1]]; seg(a, c); seg(c, b); }
    return out;
  }
  addText(x, y, s, z = 1) { return this.edit(() => { const t = { id: uid(), x: snap10(x), y: snap10(y), s, z }; this.texts.push(t); return t; }); }
  setText(id, props) { this.edit(() => { const t = this.texts.find((q) => q.id === id); if (t) Object.assign(t, props); }); }
  deleteItems(sel) {
    this.edit(() => {
      const P = new Set(sel.parts || []), W = new Set(sel.wires || []), T = new Set(sel.texts || []);
      this.parts = this.parts.filter((p) => !P.has(p.id)); this.wires = this.wires.filter((w) => !W.has(w.id)); this.texts = this.texts.filter((t) => !T.has(t.id));
    });
  }
  /** Muda propriedades de uma peça (nome, valor, pinos); fios ligados nos pinos acompanham (por posição do pino). */
  setProps(id, props) {
    this.edit(() => { const p = this.part(id); if (p) this._reposition([p], () => Object.assign(p, props)); });
  }
  rotateParts(ids, { mirror = false } = {}) {
    this.edit(() => this.rotateRaw(ids, { mirror }));
  }
  rotateRaw(ids, { mirror = false } = {}) {
    const ps = ids.map((id) => this.part(id)).filter(Boolean);
    this._reposition(ps, () => ps.forEach((p) => { if (mirror) p.m = !p.m; else p.r = (p.r + 1) % 4; }));
  }
  _reposition(ps, mutate) {
    const before = new Map(ps.map((p) => [p.id, pinsOf(p)]));
    mutate();
    const move = new Map();
    for (const p of ps) { const old = before.get(p.id), now = pinsOf(p); old.forEach((o, i) => { if (now[i] && (now[i].x !== o.x || now[i].y !== o.y)) move.set(key(o.x, o.y), [now[i].x, now[i].y]); }); }
    if (!move.size) return;
    for (const w of this.wires) for (const e of [w.a, w.b]) { const m = move.get(key(e[0], e[1])); if (m) { e[0] = m[0]; e[1] = m[1]; } }
  }
  /** Move itens; fios ligados a peças/fios movidos esticam junto (sem soltar as pontas). */
  applyMove(sel, dx, dy) {
    const P = new Set(sel.parts || []), W = new Set(sel.wires || []), T = new Set(sel.texts || []);
    const moving = new Set();
    for (const p of this.parts) if (P.has(p.id)) pinsOf(p).forEach((q) => moving.add(key(q.x, q.y)));
    for (const w of this.wires) if (W.has(w.id)) { moving.add(key(w.a[0], w.a[1])); moving.add(key(w.b[0], w.b[1])); }
    for (const p of this.parts) if (P.has(p.id)) { p.x += dx; p.y += dy; }
    for (const t of this.texts) if (T.has(t.id)) { t.x += dx; t.y += dy; }
    for (const w of this.wires) {
      const sel1 = W.has(w.id);
      for (const e of [w.a, w.b]) if (sel1 || moving.has(key(e[0], e[1]))) { e[0] += dx; e[1] += dy; }
    }
  }
  /** Copia itens (para colar depois). Fios só vêm se as duas pontas estão dentro da seleção. */
  copyItems(sel) {
    const P = new Set(sel.parts || []), W = new Set(sel.wires || []), T = new Set(sel.texts || []);
    return JSON.stringify({ parts: this.parts.filter((p) => P.has(p.id)), wires: this.wires.filter((w) => W.has(w.id)), texts: this.texts.filter((t) => T.has(t.id)) });
  }
  pasteItems(clip, dx = 20, dy = 20) {
    const c = JSON.parse(clip); const ids = { parts: [], wires: [], texts: [] };
    this.edit(() => {
      for (const p of c.parts || []) { const n = { ...p, id: uid(), x: p.x + dx, y: p.y + dy }; if (p.pins) n.pins = [...p.pins]; const item = LIBRARY.find((l) => l.t === p.t); if (item && item.prefix && !item.prefix.startsWith('#')) n.ref = this.nextRef(item.prefix); this.parts.push(n); ids.parts.push(n.id); }
      for (const w of c.wires || []) { const n = { id: uid(), a: [w.a[0] + dx, w.a[1] + dy], b: [w.b[0] + dx, w.b[1] + dy] }; this.wires.push(n); ids.wires.push(n.id); }
      for (const t of c.texts || []) { const n = { ...t, id: uid(), x: t.x + dx, y: t.y + dy }; this.texts.push(n); ids.texts.push(n.id); }
    });
    return ids;
  }

  /** Arruma os fios: sem diagonais, sem fio de tamanho zero, sem fio repetido. */
  normalize() {
    const out = [], seen = new Set();
    const add = (w) => {
      if (w.a[0] === w.b[0] && w.a[1] === w.b[1]) return;
      const k = [key(...w.a), key(...w.b)].sort().join('|'); if (seen.has(k)) return; seen.add(k); out.push(w);
    };
    for (const w of this.wires) {
      if (w.a[0] !== w.b[0] && w.a[1] !== w.b[1]) {
        const c = [w.b[0], w.a[1]];
        add({ id: w.id, a: w.a, b: c }); add({ id: uid(), a: c, b: w.b });
      } else add(w);
    }
    this.wires = out;
  }

  // ---------- busca por posição ----------
  pinAt(x, y, tol = 4) {
    for (const p of this.parts) for (const q of pinsOf(p)) if (Math.abs(q.x - x) <= tol && Math.abs(q.y - y) <= tol) return { part: p, pin: q };
    return null;
  }
  textBox(t) {
    const lines = String(t.s).split('\n'), size = 10 * (t.z || 1);
    return { x0: t.x, y0: t.y - size, x1: t.x + Math.max(...lines.map((l) => l.length)) * size * 0.6, y1: t.y - size + lines.length * size * 1.25 };
  }
  hit(x, y, tol = 5) {
    let best = null, bestArea = Infinity;
    for (const p of this.parts) {
      const b = partBox(p);
      if (x >= b.x0 - 3 && x <= b.x1 + 3 && y >= b.y0 - 3 && y <= b.y1 + 3) { const a = (b.x1 - b.x0 + 6) * (b.y1 - b.y0 + 6); if (a < bestArea) { bestArea = a; best = { type: 'part', id: p.id }; } }
    }
    if (best) return best;
    for (const t of this.texts) { const b = this.textBox(t); if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) return { type: 'text', id: t.id }; }
    let bd = tol;
    for (const w of this.wires) { const d = distSeg(x, y, w.a, w.b); if (d <= bd) { bd = d; best = { type: 'wire', id: w.id }; } }
    return best;
  }
  /** Tudo o que cruza o retângulo (seleção por área). */
  inRect(x0, y0, x1, y1) {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0];
    const sel = { parts: [], wires: [], texts: [] };
    for (const p of this.parts) { const b = partBox(p); if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1) sel.parts.push(p.id); }
    for (const w of this.wires) { if (Math.min(w.a[0], w.b[0]) >= x0 && Math.max(w.a[0], w.b[0]) <= x1 && Math.min(w.a[1], w.b[1]) >= y0 && Math.max(w.a[1], w.b[1]) <= y1) sel.wires.push(w.id); }
    for (const t of this.texts) { const b = this.textBox(t); if (b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1) sel.texts.push(t.id); }
    return sel;
  }
  /** Fios ligados em sequência (sem pinos nem derivações no meio) a partir de um fio. */
  wireChain(id) {
    const start = this.wires.find((w) => w.id === id); if (!start) return [];
    const ends = new Map();
    for (const w of this.wires) for (const e of [w.a, w.b]) { const k = key(e[0], e[1]); (ends.get(k) || ends.set(k, []).get(k)).push(w); }
    const pinPts = new Set(); for (const p of this.parts) pinsOf(p).forEach((q) => pinPts.add(key(q.x, q.y)));
    const seen = new Set([start.id]), queue = [start];
    while (queue.length) {
      const w = queue.pop();
      for (const e of [w.a, w.b]) {
        const k = key(e[0], e[1]), here = ends.get(k) || [];
        if (here.length === 2 && !pinPts.has(k)) for (const o of here) if (!seen.has(o.id)) { seen.add(o.id); queue.push(o); }
      }
    }
    return [...seen];
  }
  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (a, b, c, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
    for (const p of this.parts) { const b = partBox(p); add(b.x0 - 6, b.y0 - 18, b.x1 + 60, b.y1 + 22); }
    for (const w of this.wires) add(Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1]));
    for (const t of this.texts) { const b = this.textBox(t); add(b.x0, b.y0, b.x1, b.y1); }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  // ---------- ligações elétricas ----------
  analyze() {
    const pts = new Map();
    const pt = (x, y) => { const k = key(x, y); let o = pts.get(k); if (!o) { o = { x, y, k, pins: [] }; pts.set(k, o); } return o; };
    for (const p of this.parts) for (const q of pinsOf(p)) pt(q.x, q.y).pins.push({ part: p, pin: q });
    for (const w of this.wires) { pt(w.a[0], w.a[1]); pt(w.b[0], w.b[1]); }
    const all = [...pts.values()];
    const parent = new Map(all.map((o) => [o.k, o.k]));
    const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
    const wdeg = new Map();
    const bump = (k) => wdeg.set(k, (wdeg.get(k) || 0) + 1);
    for (const w of this.wires) {
      const vertical = w.a[0] === w.b[0];
      const lo = vertical ? Math.min(w.a[1], w.b[1]) : Math.min(w.a[0], w.b[0]), hi = vertical ? Math.max(w.a[1], w.b[1]) : Math.max(w.a[0], w.b[0]);
      const on = all.filter((o) => (vertical ? o.x === w.a[0] && o.y >= lo && o.y <= hi : o.y === w.a[1] && o.x >= lo && o.x <= hi))
        .sort((p, q) => (vertical ? p.y - q.y : p.x - q.x));
      for (let i = 0; i + 1 < on.length; i++) { union(on[i].k, on[i + 1].k); bump(on[i].k); bump(on[i + 1].k); }
    }
    const junctions = [], unconnected = [];
    for (const o of all) {
      const deg = (wdeg.get(o.k) || 0) + o.pins.length;
      if (deg >= 3) junctions.push({ x: o.x, y: o.y });
      if (o.pins.length === 1 && !(wdeg.get(o.k) > 0)) unconnected.push({ partId: o.pins[0].part.id, pin: o.pins[0].pin.n, x: o.x, y: o.y });
    }
    // nomes de ligação: GND, +5V, rótulos
    const comp = new Map();
    for (const o of all) { const r = find(o.k); (comp.get(r) || comp.set(r, { pins: [], names: new Set() }).get(r)); }
    for (const o of all) for (const { part, pin } of o.pins) {
      const c = comp.get(find(o.k));
      if (isPower(part.t)) c.names.add(part.t === 'GND' ? (part.val || 'GND') : (part.val || (part.t === 'VCC' ? '+5V' : 'NET')));
      else c.pins.push({ ref: part.ref || '?', partId: part.id, pin: pin.n, num: pin.num });
    }
    // junta ligações que têm o mesmo nome
    const byName = new Map();
    for (const [root, c] of comp) for (const n of c.names) { if (byName.has(n)) { const other = byName.get(n); if (find(other) !== find(root)) { union(other, root); } } else byName.set(n, root); }
    const merged = new Map();
    for (const [root, c] of comp) {
      const r = find(root); let m = merged.get(r);
      if (!m) { m = { pins: [], names: new Set() }; merged.set(r, m); }
      m.pins.push(...c.pins); c.names.forEach((n) => m.names.add(n));
    }
    const nets = [];
    for (const m of merged.values()) {
      if (!m.pins.length) continue;
      m.pins.sort((a, b) => natural(a.ref, b.ref) || natural(a.num ?? a.pin, b.num ?? b.pin));
      nets.push({ name: m.names.size ? [...m.names][0] : null, names: [...m.names], pins: m.pins });
    }
    nets.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || natural(a.name || a.pins[0].ref, b.name || b.pins[0].ref));
    let n = 1; for (const net of nets) if (!net.name) net.auto = 'N' + String(n++).padStart(3, '0');
    for (const net of nets) net.label = net.name || net.auto;
    return { junctions, unconnected, nets };
  }

  /** Lista de materiais agrupada por tipo e valor (não conta terra, alimentação nem rótulos). */
  bom() {
    const g = new Map();
    for (const p of this.parts) {
      if (isPower(p.t)) continue;
      const pinsKey = p.pins ? p.pins.join(',') : '';
      const k = p.t + '|' + (p.val || '') + '|' + pinsKey;
      let r = g.get(k); if (!r) { r = { name: symbolName(p.t), val: p.val || '', refs: [] }; g.set(k, r); }
      r.refs.push(p.ref || '?');
    }
    return [...g.values()].map((r) => ({ ...r, refs: r.refs.sort(natural), qty: r.refs.length })).sort((a, b) => natural(a.refs[0], b.refs[0]));
  }
  bomCSV() {
    const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    return '﻿' + ['Quantidade;Referências;Componente;Valor', ...this.bom().map((r) => [r.qty, q(r.refs.join(', ')), q(r.name), q(r.val)].join(';'))].join('\r\n') + '\r\n';
  }
  netlistText(title = 'Circuito') {
    const { nets } = this.analyze();
    const f = (p) => `${p.ref}.${p.num ?? p.pin}` + (p.num != null && String(p.pin) !== String(p.num) ? ` (${p.pin})` : '');
    return `Lista de ligações — ${title}\n\n` + (nets.length ? nets.map((n) => `${n.label}: ${n.pins.map(f).join(', ')}`).join('\n') : '(nenhuma ligação ainda)') + '\n';
  }
}

export function distSeg(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

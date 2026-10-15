// Carregar e salvar circuitos no servidor (um único JSON, com controle de versão).
import { api, ApiError } from '../api.js';
import { Schematic } from './schem.js';
import { toCanvas } from './render.js';
import { makeCanvas } from '../util.js';

export async function loadCircuit(id) {
  const m = await api.get(id);
  if (m.kind !== 'circuit') throw Object.assign(new Error('Este item não é um circuito.'), { status: 404 });
  return { id: m.id, name: m.name, rev: m.rev, sch: new Schematic(m.circuit) };
}

export async function createCircuit(name) {
  const m = await api.create({ kind: 'circuit', name, circuit: { v: 1, parts: [], wires: [], texts: [] } });
  return m.id;
}

export class CircuitSaver extends EventTarget {
  constructor(state) { // state: { id, name, rev, sch }
    super();
    this.s = state; this.status = 'saved'; this.dirty = false;
    this.running = false; this.pending = false; this.timer = 0; this.stopped = false;
    this.off = state.sch.on((kind) => { if (kind !== 'load' && kind !== 'transient') this.touch(); });
    this.onHide = () => { if (document.visibilityState === 'hidden') this.flush(); };
    this.onUnload = (e) => { if (this.dirty && this.status !== 'conflict') { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('beforeunload', this.onUnload);
  }
  destroy() {
    this.stopped = true; clearTimeout(this.timer); this.off();
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('beforeunload', this.onUnload);
  }
  setStatus(s, message) { this.status = s; this.dispatchEvent(new CustomEvent('status', { detail: { status: s, message } })); }
  touch() { this.dirty = true; this.setStatus('dirty'); this.schedule(2500); }
  schedule(ms) { clearTimeout(this.timer); if (!this.stopped) this.timer = setTimeout(() => this.flush(), ms); }
  thumbnail() {
    try {
      const sch = this.s.sch; if (sch.isEmpty) return undefined;
      const c = toCanvas(sch, makeCanvas, 'light', { scale: 1, maxSide: 384, margin: 16 });
      const k = Math.min(1, 384 / Math.max(c.width, c.height));
      if (k < 1) { const d = makeCanvas(Math.round(c.width * k), Math.round(c.height * k)); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); return d.toDataURL('image/jpeg', 0.8); }
      return c.toDataURL('image/jpeg', 0.8);
    } catch { return undefined; }
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.stopped || this.status === 'conflict') return;
    if (this.running) { this.pending = true; return; }
    if (!this.dirty) { this.setStatus('saved'); return; }
    this.running = true; this.setStatus('saving');
    const s = this.s, rev0 = s.sch.rev;
    try {
      const r = await api.save(s.id, { baseRev: s.rev, name: s.name, circuit: s.sch.toJSON(), thumb: this.thumbnail() });
      s.rev = r.rev;
      if (s.sch.rev === rev0) { this.dirty = false; this.setStatus('saved'); } else { this.pending = true; this.setStatus('dirty'); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) this.setStatus('conflict', e.message);
      else if (e instanceof ApiError && e.status === 0) { this.setStatus('offline', e.message); this.schedule(5000); }
      else if (e instanceof ApiError && e.status === 401) this.setStatus('error', 'Sua sessão expirou. Entre de novo para salvar.');
      else { this.setStatus('error', e.message); this.schedule(8000); }
    } finally {
      this.running = false;
      if (this.pending && !this.stopped) { this.pending = false; this.schedule(300); }
    }
  }
  rename(name) { this.s.name = name; this.touch(); }
  /** Em caso de conflito: guarda o que está na tela como um circuito novo. */
  async saveAsCopy() {
    const s = this.s;
    const m = await api.create({ kind: 'circuit', name: s.name + ' (cópia)', circuit: s.sch.toJSON(), thumb: this.thumbnail() });
    return m.id;
  }
}

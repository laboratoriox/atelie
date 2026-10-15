// Carregar e salvar desenhos no servidor (por camada, com controle de versão).
import { api, ApiError } from '../api.js';
import { Doc, Layer } from './doc.js';
import { canvasToBlob, makeCanvas } from '../util.js';

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Não foi possível carregar uma das camadas.'));
    img.src = url;
  });
}

export async function loadDoc(id) {
  const meta = await api.get(id);
  const layers = meta.layers.map((l) => new Layer(meta.width, meta.height, l));
  await Promise.all(layers.map(async (L) => {
    if (!L.file) return;
    const url = URL.createObjectURL(await api.layerBlob(id, L.file));
    try { L.ctx.drawImage(await loadImage(url), 0, 0); } finally { URL.revokeObjectURL(url); }
  }));
  const doc = new Doc({ id: meta.id, name: meta.name, width: meta.width, height: meta.height, layers, rev: meta.rev, paper: meta.bg, light: meta.light });
  doc.activeId = layers[layers.length - 1].id;
  doc.view = meta.view || {};
  return doc;
}

export class Saver extends EventTarget {
  constructor(doc) {
    super();
    this.doc = doc; this.status = doc.id ? 'saved' : 'dirty';
    this.running = false; this.pending = false; this.timer = 0; this.stopped = false;
    this.onMod = () => { this.setStatus('dirty'); this.schedule(4000); };
    doc.addEventListener('modified', this.onMod);
    this.onHide = () => { if (document.visibilityState === 'hidden') this.flush(); };
    this.onUnload = (e) => { if (this.status !== 'saved' && this.status !== 'conflict') { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('beforeunload', this.onUnload);
  }
  destroy() {
    this.stopped = true; clearTimeout(this.timer);
    this.doc.removeEventListener('modified', this.onMod);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('beforeunload', this.onUnload);
  }
  setStatus(s, detail) { this.status = s; this.dispatchEvent(new CustomEvent('status', { detail: { status: s, message: detail } })); }
  get isDirty() { return !this.doc.id || this.doc.metaDirty || this.doc.layers.some((l) => l.dirty); }
  touchMeta() { this.doc.metaDirty = true; this.setStatus('dirty'); this.schedule(3000); }
  schedule(ms = 4000) { clearTimeout(this.timer); if (!this.stopped) this.timer = setTimeout(() => this.flush(), ms); }

  payload() {
    const doc = this.doc;
    return {
      name: doc.name, width: doc.width, height: doc.height, view: { grid: false }, bg: doc.paper, light: { ...doc.light },
      layers: doc.layers.map((l) => ({ ...l.snapshotProps(), file: l.file })),
    };
  }

  thumbnail() {
    const doc = this.doc, k = 384 / Math.max(doc.width, doc.height);
    const flat = doc.flatten({ background: doc.paper || '#ffffff', scale: Math.min(1, k) });
    return flat.toDataURL('image/jpeg', 0.78);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.stopped || this.status === 'conflict') return;
    if (this.running) { this.pending = true; return; }
    if (!this.isDirty) { this.setStatus('saved'); return; }
    this.running = true; this.setStatus('saving');
    const doc = this.doc;
    try {
      if (!doc.id) {
        const m = await api.create({ ...this.payload(), layers: doc.layers.map((l) => ({ ...l.snapshotProps(), file: null })) });
        doc.id = m.id; doc.rev = m.rev;
        history.replaceState(null, '', '#/d/' + doc.id);
      }
      for (const l of doc.layers.filter((x) => x.dirty)) {
        const ver = l.ver;
        const blob = await canvasToBlob(l.canvas);
        const { file } = await api.uploadLayer(doc.id, blob);
        l.file = file; l.savedVer = ver;
      }
      const wasMeta = doc.metaDirty;
      const r = await api.save(doc.id, { baseRev: doc.rev, ...this.payload(), thumb: this.thumbnail() });
      doc.rev = r.rev;
      if (wasMeta) doc.metaDirty = false;
      this.setStatus(this.isDirty ? 'dirty' : 'saved');
      if (this.isDirty) this.pending = true;
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

  /** Salva o conteúdo atual como um novo desenho (usado quando há conflito). */
  async saveAsCopy() {
    const doc = this.doc;
    doc.id = null; doc.name = doc.name + ' (cópia)';
    doc.layers.forEach((l) => { l.file = null; l.savedVer = -1; });
    doc.metaDirty = true;
    this.status = 'dirty';
    await this.flush();
  }
}

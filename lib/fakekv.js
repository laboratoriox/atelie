// KV simulado em memória (mesma interface básica do Workers KV) — usado só nos testes.
export class FakeKV {
  constructor() { this.m = new Map(); this.writes = 0; }
  async put(k, v, opts = {}) {
    this.writes++;
    this.m.set(k, { v: typeof v === 'string' ? v : new Uint8Array(v).slice().buffer, metadata: opts.metadata ?? null });
  }
  async get(k, type = 'text') {
    const e = this.m.get(k); if (!e) return null;
    if (type === 'json') return JSON.parse(e.v);
    if (type === 'arrayBuffer') return typeof e.v === 'string' ? new TextEncoder().encode(e.v).buffer : e.v.slice(0);
    return e.v;
  }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = '' } = {}) {
    const keys = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: this.m.get(name).metadata ?? undefined }));
    return { keys, list_complete: true };
  }
}

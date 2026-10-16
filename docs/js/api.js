export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Vazio = mesma origem (server.js). Com a API na Cloudflare, vem de config.js.
const BASE = String(window.ATELIE_API || '').replace(/\/$/, '');
const TOKEN_KEY = 'atelie_token';
let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch {}
function setToken(t) {
  token = t || null;
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('atelie_list_v1'); } } catch {}
}

const LIST_KEY = 'atelie_list_v1';
function readListCache() { try { const c = JSON.parse(localStorage.getItem(LIST_KEY)); return c && Array.isArray(c.drawings) ? c : null; } catch { return null; } }
function writeListCache(drawings) { try { localStorage.setItem(LIST_KEY, JSON.stringify({ t: Date.now(), drawings })); } catch {} }
// Apaga só a validade (mantém a cópia para o caso de erro do servidor).
function dropListCache() { try { const c = readListCache(); if (c) localStorage.setItem(LIST_KEY, JSON.stringify({ ...c, t: 0 })); } catch {} }

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

function headersFor(body, isBlob) {
  const h = {};
  if (token) h.Authorization = 'Bearer ' + token;
  if (body && !isBlob) h['Content-Type'] = 'application/json';
  return h;
}

async function request(method, url, body, opts = {}) {
  const isBlob = body instanceof Blob;
  let res;
  try {
    res = await fetch(BASE + url, {
      method, credentials: BASE ? 'omit' : 'same-origin',
      headers: headersFor(body, isBlob),
      body: body ? (isBlob ? body : JSON.stringify(body)) : undefined,
    });
  } catch { throw new ApiError(0, 'Sem conexão com o servidor.'); }
  if (opts.raw && res.ok) return res;
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401) { if (!opts.noAuthRedirect) { setToken(null); onUnauthorized(); } }
    throw new ApiError(res.status, data?.error || `Erro ${res.status}`);
  }
  return data;
}

export const api = {
  requestCode: (email) => request('POST', '/api/auth/request', { email }, { noAuthRedirect: true }),
  async verifyCode(email, code) {
    const r = await request('POST', '/api/auth/verify', { email, code }, { noAuthRedirect: true });
    if (r.token) setToken(r.token);
    return r;
  },
  async logout() { try { await request('POST', '/api/auth/logout', null, { noAuthRedirect: true }); } finally { setToken(null); } },
  me: () => request('GET', '/api/me', null, { noAuthRedirect: true }),
  // A galeria guarda a última lista por 2 min (poupa o limite diário do KV) e,
  // se o servidor falhar, mostra a última lista guardada em vez de ficar vazia.
  async list() {
    const c = readListCache();
    if (c && Date.now() - c.t < 120000) return { drawings: c.drawings };
    try {
      const r = await request('GET', '/api/drawings');
      writeListCache(r.drawings);
      return r;
    } catch (e) {
      if (c && e.status !== 401) return { drawings: c.drawings, stale: true };
      throw e;
    }
  },
  async create(meta) { const r = await request('POST', '/api/drawings', meta); dropListCache(); return r; },
  get: (id) => request('GET', `/api/drawings/${id}`),
  async save(id, meta) { const r = await request('PUT', `/api/drawings/${id}`, meta); dropListCache(); return r; },
  async remove(id) { const r = await request('DELETE', `/api/drawings/${id}`); dropListCache(); return r; },
  thumb: (id) => request('GET', `/api/drawings/${id}/thumb`),
  uploadLayer: (id, blob) => request('POST', `/api/drawings/${id}/layers`, blob),
  /** Baixa o PNG de uma camada (precisa do cabeçalho de login, então não dá para usar <img src>). */
  async layerBlob(id, file) {
    const res = await request('GET', `/api/drawings/${id}/layers/${file}.png`, null, { raw: true });
    return res.blob();
  },
};

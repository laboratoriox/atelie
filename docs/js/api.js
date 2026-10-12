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
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch {}
}

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
  list: () => request('GET', '/api/drawings'),
  create: (meta) => request('POST', '/api/drawings', meta),
  get: (id) => request('GET', `/api/drawings/${id}`),
  save: (id, meta) => request('PUT', `/api/drawings/${id}`, meta),
  remove: (id) => request('DELETE', `/api/drawings/${id}`),
  thumb: (id) => request('GET', `/api/drawings/${id}/thumb`),
  uploadLayer: (id, blob) => request('POST', `/api/drawings/${id}/layers`, blob),
  /** Baixa o PNG de uma camada (precisa do cabeçalho de login, então não dá para usar <img src>). */
  async layerBlob(id, file) {
    const res = await request('GET', `/api/drawings/${id}/layers/${file}.png`, null, { raw: true });
    return res.blob();
  },
};

// Ateliê — backend para Cloudflare Workers (plano gratuito).
// Mesma API do server.js, mas:
//  - o login devolve um token (enviado no cabeçalho Authorization), porque o site
//    (GitHub Pages) e a API ficam em endereços diferentes e cookies de terceiros são bloqueados;
//  - os desenhos ficam no Workers KV (gratuito, sem cartão). Se existir um bucket R2
//    ligado como ATELIE_R2, as camadas (PNG) vão para ele, com limite maior.
//
// Configuração (painel da Cloudflare):
//   KV namespace  -> variável ATELIE_KV
//   Secret        -> SESSION_SECRET  (texto aleatório longo)
//   Variável      -> ALLOWED_ORIGIN  (ex.: https://usuario.github.io — pode listar vários, separados por vírgula)
import { recoverAddress, isAddress } from '../lib/ethsig.js';

const SESSION_DAYS = 30;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const KV_MAX_LAYER_BYTES = 24 * 1024 * 1024; // limite do KV é 25 MiB por valor
const R2_MAX_LAYER_BYTES = 40 * 1024 * 1024;
const MAX_DRAWINGS_PER_USER = 300;
const MAX_LAYERS = 24;
const ORPHAN_AGE_MS = 10 * 60 * 1000;

const te = new TextEncoder(), td = new TextDecoder();

// O plano gratuito limita o tempo de CPU por requisição (~10 ms). A primeira verificação de assinatura
// num isolate novo é a mais cara, então rodamos uma verificação de exemplo durante o passo "nonce"
// (que é leve) para o passo seguinte, "verify", já encontrar o código aquecido.
let warmed = false;
function warmUp() {
  if (warmed) return;
  warmed = true;
  try { recoverAddress('aquecimento', '0x' + '11'.repeat(32) + '22'.repeat(32) + '1b'); } catch { /* esperado: só aquece */ }
}

// ---------- utilidades ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function secretOf(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 16) throw new HttpError(500, 'servidor sem SESSION_SECRET configurado');
  return String(env.SESSION_SECRET);
}

async function makeSession(env, address) {
  const payload = b64u(te.encode(JSON.stringify({ a: address, exp: Date.now() + SESSION_DAYS * 864e5 })));
  return `${payload}.${b64u(await hmac(secretOf(env), 's:' + payload))}`;
}
async function readSession(env, token) {
  if (!token) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  let given;
  try { given = unb64u(mac); } catch { return null; }
  if (!safeEqual(given, await hmac(secretOf(env), 's:' + payload))) return null;
  try {
    const p = JSON.parse(td.decode(unb64u(payload)));
    return p.exp > Date.now() && isAddress(p.a) ? p.a.toLowerCase() : null;
  } catch { return null; }
}

// ---------- CORS ----------
const allowedOrigins = (env) => String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
function corsFor(req, env) {
  const origin = req.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const json = (cors, status, obj, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { ...SEC, ...cors, 'Content-Type': 'application/json; charset=utf-8', ...extra } });

async function readJson(req) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_JSON_BYTES) throw new HttpError(413, 'conteúdo grande demais');
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, 'conteúdo grande demais');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'JSON inválido'); }
}

// ---------- armazenamento ----------
const ID_RE = /^[a-f0-9]{16}$/, LAYER_RE = /^[a-z0-9]{4,24}$/, FILE_RE = /^[a-f0-9]{24}$/;
const metaKey = (a, id) => `m:${a}:${id}`;
const layerKey = (a, id, f) => `l:${a}:${id}:${f}`;

function layerStore(env) {
  if (env.ATELIE_R2) {
    const b = env.ATELIE_R2;
    return {
      max: R2_MAX_LAYER_BYTES,
      put: (k, buf) => b.put(k, buf),
      get: async (k) => { const o = await b.get(k); return o ? o.arrayBuffer() : null; },
      del: (k) => b.delete(k),
      list: async (prefix) => (await b.list({ prefix })).objects.map((o) => ({ name: o.key, t: o.uploaded.getTime() })),
    };
  }
  const kv = env.ATELIE_KV;
  return {
    max: KV_MAX_LAYER_BYTES,
    put: (k, buf) => kv.put(k, buf, { metadata: { t: Date.now() } }),
    get: (k) => kv.get(k, 'arrayBuffer'),
    del: (k) => kv.delete(k),
    list: async (prefix) => {
      const out = []; let cursor;
      do {
        const r = await kv.list({ prefix, cursor });
        out.push(...r.keys.map((k) => ({ name: k.name, t: k.metadata?.t ?? 0 })));
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      return out;
    },
  };
}
const summary = (m) => ({ id: m.id, name: m.name, width: m.width, height: m.height, updatedAt: m.updatedAt, createdAt: m.createdAt });

async function readMeta(env, a, id) { return env.ATELIE_KV.get(metaKey(a, id), 'json'); }
async function writeMeta(env, a, id, meta) {
  await env.ATELIE_KV.put(metaKey(a, id), JSON.stringify(meta), { metadata: summary(meta) });
}
async function listDrawings(env, a) {
  const out = []; let cursor;
  do {
    const r = await env.ATELIE_KV.list({ prefix: `m:${a}:`, cursor });
    for (const k of r.keys) if (k.metadata) out.push(k.metadata);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort((x, y) => y.updatedAt - x.updatedAt);
}

const clampInt = (v, min, max, def) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
const BLENDS = new Set(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

function sanitizeMeta(input, prev) {
  const width = clampInt(input.width ?? prev?.width, 16, 6000, 2048);
  const height = clampInt(input.height ?? prev?.height, 16, 6000, 1536);
  if (width * height > 36_000_000) throw new HttpError(400, 'tela grande demais');
  const layersIn = Array.isArray(input.layers) ? input.layers.slice(0, MAX_LAYERS) : [];
  const layers = layersIn.map((l) => {
    if (!LAYER_RE.test(String(l.id))) throw new HttpError(400, 'id de camada inválido');
    if (l.file != null && !FILE_RE.test(String(l.file))) throw new HttpError(400, 'arquivo de camada inválido');
    return {
      id: String(l.id),
      name: String(l.name ?? 'Camada').slice(0, 60),
      visible: l.visible !== false,
      locked: !!l.locked,
      opacity: Math.min(1, Math.max(0, Number(l.opacity ?? 1))),
      blend: BLENDS.has(l.blend) ? l.blend : 'source-over',
      file: l.file ? String(l.file) : null,
    };
  });
  if (!layers.length) throw new HttpError(400, 'o desenho precisa de ao menos uma camada');
  let thumb = null;
  if (typeof input.thumb === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.thumb) && input.thumb.length < 200_000) thumb = input.thumb;
  return {
    width, height, layers, thumb: thumb ?? prev?.thumb ?? null,
    name: String(input.name ?? prev?.name ?? 'Sem título').slice(0, 80),
    bg: typeof input.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.bg) ? input.bg : (input.bg === null ? null : prev?.bg ?? null),
    view: input.view && typeof input.view === 'object' ? { grid: !!input.view.grid } : (prev?.view ?? {}),
  };
}

async function cleanupOrphans(env, a, id, meta) {
  const store = layerStore(env), keep = new Set(meta.layers.map((l) => l.file).filter(Boolean));
  for (const o of await store.list(layerKey(a, id, ''))) {
    const file = o.name.split(':').pop();
    if (keep.has(file) || Date.now() - o.t < ORPHAN_AGE_MS) continue;
    await store.del(o.name);
  }
}

// ---------- login ----------
function originFor(req, env) {
  const origin = (req.headers.get('Origin') || '').replace(/\/$/, '');
  if (!origin || !allowedOrigins(env).includes(origin)) throw new HttpError(403, 'origem não permitida');
  return origin;
}

async function handleAuth(req, env, p, cors) {
  if (p === '/api/auth/nonce' && req.method === 'POST') {
    const origin = originFor(req, env);
    const { address } = await readJson(req);
    if (!isAddress(address)) throw new HttpError(400, 'endereço inválido');
    warmUp();
    const now = new Date(), exp = new Date(Date.now() + CHALLENGE_TTL_MS);
    const message =
`${new URL(origin).host} quer que você entre com sua carteira:
${address}

Assinar esta mensagem só confirma que você é o dono do endereço. Não custa nada (sem gás), não autoriza transações e não dá acesso aos seus fundos.

URI: ${origin}
Versão: 1
Nonce: ${randHex(16)}
Emitida em: ${now.toISOString()}
Expira em: ${exp.toISOString()}`;
    const ticket = b64u(await hmac(secretOf(env), 'c:' + message));
    return json(cors, 200, { message, ticket });
  }
  if (p === '/api/auth/verify' && req.method === 'POST') {
    const origin = originFor(req, env);
    const { address, message, signature, ticket } = await readJson(req);
    if (!isAddress(address) || typeof message !== 'string' || typeof signature !== 'string' || typeof ticket !== 'string') throw new HttpError(400, 'dados inválidos');
    // o desafio precisa ter sido emitido por este servidor, para este endereço e esta origem, e não ter expirado
    let tk; try { tk = unb64u(ticket); } catch { throw new HttpError(401, 'desafio inválido'); }
    if (!safeEqual(tk, await hmac(secretOf(env), 'c:' + message))) throw new HttpError(401, 'desafio expirado ou inválido, tente novamente');
    const lines = message.split('\n');
    const exp = Date.parse((/^Expira em: (.+)$/m.exec(message) || [])[1] || '');
    if (!(exp > Date.now())) throw new HttpError(401, 'desafio expirado, tente novamente');
    if (lines[1] !== address && lines[1]?.toLowerCase() !== address.toLowerCase()) throw new HttpError(401, 'desafio de outro endereço');
    if (`URI: ${origin}` !== lines.find((l) => l.startsWith('URI: '))) throw new HttpError(401, 'desafio de outra origem');
    let recovered;
    try { recovered = recoverAddress(message, signature); } catch { throw new HttpError(401, 'assinatura inválida'); }
    if (recovered !== address.toLowerCase()) throw new HttpError(401, 'a assinatura não corresponde ao endereço');
    return json(cors, 200, { address: recovered, token: await makeSession(env, recovered) });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') return json(cors, 200, { ok: true }); // o cliente apaga o token
  return null;
}

// ---------- API ----------
async function handleApi(req, env, ctx, url, cors) {
  const p = url.pathname;
  if (p === '/api/health') return json(cors, 200, { ok: true });
  const auth = await handleAuth(req, env, p, cors);
  if (auth) return auth;

  const bearer = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  const addr = await readSession(env, bearer?.[1]);
  if (p === '/api/me') return json(cors, addr ? 200 : 401, addr ? { address: addr } : { error: 'não autenticado' });
  if (!addr) throw new HttpError(401, 'não autenticado');

  if (p === '/api/drawings' && req.method === 'GET') return json(cors, 200, { drawings: await listDrawings(env, addr) });

  if (p === '/api/drawings' && req.method === 'POST') {
    if ((await listDrawings(env, addr)).length >= MAX_DRAWINGS_PER_USER) throw new HttpError(400, 'limite de desenhos atingido');
    const body = await readJson(req);
    const id = randHex(8);
    const meta = { id, ...sanitizeMeta(body, null), rev: 1, createdAt: Date.now(), updatedAt: Date.now() };
    await writeMeta(env, addr, id, meta);
    return json(cors, 201, meta);
  }

  let m = /^\/api\/drawings\/([a-f0-9]{16})$/.exec(p);
  if (m) {
    const id = m[1];
    const meta = await readMeta(env, addr, id);
    if (!meta) throw new HttpError(404, 'desenho não encontrado');
    if (req.method === 'GET') return json(cors, 200, meta);
    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (Number(body.baseRev) !== meta.rev) throw new HttpError(409, 'o desenho foi alterado em outro dispositivo');
      const next = { ...meta, ...sanitizeMeta(body, meta), rev: meta.rev + 1, updatedAt: Date.now() };
      await writeMeta(env, addr, id, next);
      ctx.waitUntil(cleanupOrphans(env, addr, id, next).catch(() => {}));
      return json(cors, 200, { rev: next.rev, updatedAt: next.updatedAt });
    }
    if (req.method === 'DELETE') {
      const store = layerStore(env);
      for (const o of await store.list(layerKey(addr, id, ''))) await store.del(o.name);
      await env.ATELIE_KV.delete(metaKey(addr, id));
      return json(cors, 200, { ok: true });
    }
  }

  m = /^\/api\/drawings\/([a-f0-9]{16})\/thumb$/.exec(p);
  if (m && req.method === 'GET') {
    const meta = await readMeta(env, addr, m[1]);
    if (!meta) throw new HttpError(404, 'desenho não encontrado');
    return json(cors, 200, { thumb: meta.thumb || null });
  }

  m = /^\/api\/drawings\/([a-f0-9]{16})\/layers$/.exec(p);
  if (m && req.method === 'POST') {
    const id = m[1], store = layerStore(env);
    if (!(await readMeta(env, addr, id))) throw new HttpError(404, 'desenho não encontrado');
    if (Number(req.headers.get('Content-Length') || 0) > store.max) throw new HttpError(413, 'camada grande demais para o armazenamento gratuito');
    const buf = await req.arrayBuffer();
    if (buf.byteLength > store.max) throw new HttpError(413, 'camada grande demais para o armazenamento gratuito');
    const magic = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    if (magic.length < 8 || [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].some((b, i) => magic[i] !== b)) throw new HttpError(400, 'a camada precisa ser um PNG');
    const file = randHex(12);
    await store.put(layerKey(addr, id, file), buf);
    return json(cors, 201, { file });
  }
  m = /^\/api\/drawings\/([a-f0-9]{16})\/layers\/([a-f0-9]{24})\.png$/.exec(p);
  if (m && req.method === 'GET') {
    const buf = await layerStore(env).get(layerKey(addr, m[1], m[2]));
    if (!buf) throw new HttpError(404, 'camada não encontrada');
    return new Response(buf, { status: 200, headers: { ...SEC, ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' } });
  }

  throw new HttpError(404, 'rota não encontrada');
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsFor(req, env);
    try {
      if (!env.ATELIE_KV) throw new HttpError(500, 'servidor sem o KV ATELIE_KV configurado');
      const url = new URL(req.url);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...SEC, ...cors } });
      if (!url.pathname.startsWith('/api/')) return new Response('Ateliê API — ok', { headers: { ...SEC, 'Content-Type': 'text/plain; charset=utf-8' } });
      return await handleApi(req, env, ctx, url, cors);
    } catch (e) {
      if (e instanceof HttpError) return json(cors, e.status, { error: e.message });
      console.error(e);
      return json(cors, 500, { error: 'erro interno' });
    }
  },
};

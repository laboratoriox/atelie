// Ateliê — servidor sem dependências externas (Node >= 18).
// Autenticação: assinatura de mensagem com carteira Ethereum (estilo EIP-4361).
// Nada sensível é guardado: só o endereço público e os desenhos.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recoverAddress, isAddress } from './lib/ethsig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC = path.join(__dirname, 'docs');
// Defina PUBLIC_ORIGIN (ex.: https://desenho.exemplo.com) quando estiver atrás de um domínio/HTTPS.
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

const SESSION_DAYS = 30;
const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_LAYER_BYTES = 40 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_DRAWINGS_PER_USER = 300;
const MAX_LAYERS = 24;

fs.mkdirSync(path.join(DATA, 'users'), { recursive: true });

// ---------- segredo do servidor (para assinar a sessão) ----------
const SECRET_FILE = path.join(DATA, 'secret.key');
let SECRET;
if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE);
else { SECRET = crypto.randomBytes(48); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }

const b64u = (b) => Buffer.from(b).toString('base64url');
function makeSession(address) {
  const payload = b64u(JSON.stringify({ a: address, exp: Date.now() + SESSION_DAYS * 864e5 }));
  const mac = b64u(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return `${payload}.${mac}`;
}
function readSession(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const good = crypto.createHmac('sha256', SECRET).update(payload).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== good.length || !crypto.timingSafeEqual(given, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!p.exp || p.exp < Date.now() || !isAddress(p.a)) return null;
    return p.a;
  } catch { return null; }
}

// ---------- nonces em memória ----------
const nonces = new Map(); // nonce -> { address, message, exp }
setInterval(() => { const n = Date.now(); for (const [k, v] of nonces) if (v.exp < n) nonces.delete(k); }, 60_000).unref();

// rate limit simples por IP
const hits = new Map();
function limited(ip, bucket, max, windowMs) {
  const key = bucket + ':' + ip, now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

// ---------- utilidades HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) return reject(new HttpError(413, 'conteúdo grande demais'));
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'conteúdo grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req, MAX_JSON_BYTES);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON inválido'); }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || (PUBLIC_ORIGIN || '').startsWith('https://'); }
function sessionCookie(req, value, maxAgeSec) {
  return `atelie_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}
function originOf(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${req.headers.host}`;
}
// Proteção CSRF: requisições que alteram dados precisam vir da mesma origem.
function checkOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return; // clientes não-navegador; o cookie SameSite=Lax já cobre navegadores
  let host; try { host = new URL(origin).host; } catch { throw new HttpError(403, 'origem inválida'); }
  const expected = new URL(originOf(req)).host;
  if (host !== expected) throw new HttpError(403, 'origem não permitida');
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ---------- armazenamento ----------
const ID_RE = /^[a-f0-9]{16}$/;
const LAYER_RE = /^[a-z0-9]{4,24}$/;
const FILE_RE = /^[a-f0-9]{24}$/;
const userDir = (addr) => path.join(DATA, 'users', addr.toLowerCase());
const drawingDir = (addr, id) => path.join(userDir(addr), id);
const metaPath = (addr, id) => path.join(drawingDir(addr, id), 'meta.json');

async function readMeta(addr, id) {
  try { return JSON.parse(await fsp.readFile(metaPath(addr, id), 'utf8')); }
  catch { return null; }
}
async function writeMeta(addr, id, meta) {
  const p = metaPath(addr, id), tmp = p + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(meta));
  await fsp.rename(tmp, p);
}
async function listDrawings(addr) {
  let names = [];
  try { names = await fsp.readdir(userDir(addr)); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!ID_RE.test(n)) continue;
    const m = await readMeta(addr, n);
    if (m) out.push({ id: m.id, name: m.name, width: m.width, height: m.height, updatedAt: m.updatedAt, createdAt: m.createdAt, thumb: m.thumb || null });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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

async function cleanupOrphans(addr, id, meta) {
  const dir = drawingDir(addr, id);
  const keep = new Set(meta.layers.map((l) => l.file).filter(Boolean));
  let names = []; try { names = await fsp.readdir(dir); } catch { return; }
  for (const n of names) {
    const m = /^([a-f0-9]{24})\.png$/.exec(n);
    if (!m || keep.has(m[1])) continue;
    try {
      const st = await fsp.stat(path.join(dir, n));
      if (Date.now() - st.mtimeMs > 10 * 60_000) await fsp.unlink(path.join(dir, n)); // dá tempo para uploads em andamento
    } catch {}
  }
}

// ---------- API ----------
async function handleApi(req, res, url) {
  checkOrigin(req);
  const p = url.pathname;
  const ip = clientIp(req);

  if (p === '/api/health') return json(res, 200, { ok: true });

  // --- auth ---
  if (p === '/api/auth/nonce' && req.method === 'POST') {
    if (limited(ip, 'nonce', 30, 10 * 60_000)) throw new HttpError(429, 'muitas tentativas, aguarde um pouco');
    const { address } = await readJson(req);
    if (!isAddress(address)) throw new HttpError(400, 'endereço inválido');
    const origin = originOf(req);
    const nonce = crypto.randomBytes(16).toString('hex');
    const now = new Date(), exp = new Date(Date.now() + NONCE_TTL_MS);
    const message =
`${new URL(origin).host} quer que você entre com sua carteira:
${address}

Assinar esta mensagem só confirma que você é o dono do endereço. Não custa nada (sem gás), não autoriza transações e não dá acesso aos seus fundos.

URI: ${origin}
Versão: 1
Nonce: ${nonce}
Emitida em: ${now.toISOString()}
Expira em: ${exp.toISOString()}`;
    nonces.set(nonce, { address: address.toLowerCase(), message, exp: exp.getTime() });
    return json(res, 200, { message });
  }

  if (p === '/api/auth/verify' && req.method === 'POST') {
    if (limited(ip, 'verify', 20, 10 * 60_000)) throw new HttpError(429, 'muitas tentativas, aguarde um pouco');
    const { address, message, signature } = await readJson(req);
    if (!isAddress(address) || typeof message !== 'string' || typeof signature !== 'string') throw new HttpError(400, 'dados inválidos');
    const m = /\nNonce: ([a-f0-9]{32})\n/.exec(message);
    const entry = m && nonces.get(m[1]);
    if (!entry || entry.exp < Date.now() || entry.message !== message || entry.address !== address.toLowerCase())
      throw new HttpError(401, 'desafio expirado ou inválido, tente novamente');
    nonces.delete(m[1]); // uso único
    let recovered;
    try { recovered = recoverAddress(message, signature); } catch { throw new HttpError(401, 'assinatura inválida'); }
    if (recovered !== address.toLowerCase()) throw new HttpError(401, 'a assinatura não corresponde ao endereço');
    await fsp.mkdir(userDir(recovered), { recursive: true });
    return json(res, 200, { address: recovered }, { 'Set-Cookie': sessionCookie(req, makeSession(recovered), SESSION_DAYS * 86400) });
  }

  if (p === '/api/auth/logout' && req.method === 'POST')
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });

  // --- daqui em diante exige sessão ---
  const addr = readSession(parseCookies(req).atelie_session);
  if (p === '/api/me') return json(res, addr ? 200 : 401, addr ? { address: addr } : { error: 'não autenticado' });
  if (!addr) throw new HttpError(401, 'não autenticado');

  if (p === '/api/drawings' && req.method === 'GET') return json(res, 200, { drawings: await listDrawings(addr) });

  if (p === '/api/drawings' && req.method === 'POST') {
    if ((await listDrawings(addr)).length >= MAX_DRAWINGS_PER_USER) throw new HttpError(400, 'limite de desenhos atingido');
    const body = await readJson(req);
    const id = crypto.randomBytes(8).toString('hex');
    await fsp.mkdir(drawingDir(addr, id), { recursive: true });
    const meta = { id, ...sanitizeMeta(body, null), rev: 1, createdAt: Date.now(), updatedAt: Date.now() };
    await writeMeta(addr, id, meta);
    return json(res, 201, meta);
  }

  let m = /^\/api\/drawings\/([a-f0-9]{16})$/.exec(p);
  if (m) {
    const id = m[1];
    const meta = await readMeta(addr, id);
    if (!meta) throw new HttpError(404, 'desenho não encontrado');
    if (req.method === 'GET') return json(res, 200, meta);
    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (Number(body.baseRev) !== meta.rev) throw new HttpError(409, 'o desenho foi alterado em outro dispositivo');
      const next = { ...meta, ...sanitizeMeta(body, meta), rev: meta.rev + 1, updatedAt: Date.now() };
      await writeMeta(addr, id, next);
      cleanupOrphans(addr, id, next).catch(() => {});
      return json(res, 200, { rev: next.rev, updatedAt: next.updatedAt });
    }
    if (req.method === 'DELETE') {
      await fsp.rm(drawingDir(addr, id), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
  }

  // camada: PUT cria um arquivo novo (token aleatório) e devolve o nome; GET lê
  m = /^\/api\/drawings\/([a-f0-9]{16})\/layers$/.exec(p);
  if (m && req.method === 'POST') {
    const id = m[1];
    if (!(await readMeta(addr, id))) throw new HttpError(404, 'desenho não encontrado');
    const buf = await readBody(req, MAX_LAYER_BYTES);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      throw new HttpError(400, 'a camada precisa ser um PNG');
    const file = crypto.randomBytes(12).toString('hex');
    await fsp.writeFile(path.join(drawingDir(addr, id), file + '.png'), buf);
    return json(res, 201, { file });
  }
  m = /^\/api\/drawings\/([a-f0-9]{16})\/layers\/([a-f0-9]{24})\.png$/.exec(p);
  if (m && req.method === 'GET') {
    try {
      const buf = await fsp.readFile(path.join(drawingDir(addr, m[1]), m[2] + '.png'));
      return send(res, 200, buf, { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' });
    } catch { throw new HttpError(404, 'camada não encontrada'); }
  }

  throw new HttpError(404, 'rota não encontrada');
}

// ---------- arquivos estáticos ----------
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'proibido');
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw 0;
    const buf = await fsp.readFile(file);
    const ext = path.extname(file);
    return send(res, 200, buf, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache' });
  } catch {
    // fallback de SPA
    const buf = await fsp.readFile(path.join(PUBLIC, 'index.html'));
    return send(res, 200, buf, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'método não permitido');
    return await serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    console.error(e);
    return json(res, 500, { error: 'erro interno' });
  }
});
server.requestTimeout = 120_000;
server.listen(PORT, HOST, () => console.log(`Ateliê rodando em http://localhost:${PORT}  (dados em ${DATA})`));

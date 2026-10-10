// lib/ethsig.js
var MASK64 = (1n << 64n) - 1n;
var RC = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n
];
var RC_LO = Uint32Array.from(RC, (x) => Number(x & 0xffffffffn));
var RC_HI = Uint32Array.from(RC, (x) => Number(x >> 32n));
var ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
var PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
var bcL = new Uint32Array(5);
var bcH = new Uint32Array(5);
function keccakF(st) {
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      bcL[i] = st[2 * i] ^ st[2 * (i + 5)] ^ st[2 * (i + 10)] ^ st[2 * (i + 15)] ^ st[2 * (i + 20)];
      bcH[i] = st[2 * i + 1] ^ st[2 * (i + 5) + 1] ^ st[2 * (i + 10) + 1] ^ st[2 * (i + 15) + 1] ^ st[2 * (i + 20) + 1];
    }
    for (let i = 0; i < 5; i++) {
      const l = bcL[(i + 1) % 5], h = bcH[(i + 1) % 5];
      const tl2 = bcL[(i + 4) % 5] ^ (l << 1 | h >>> 31), th2 = bcH[(i + 4) % 5] ^ (h << 1 | l >>> 31);
      for (let j = 0; j < 25; j += 5) {
        st[2 * (j + i)] ^= tl2;
        st[2 * (j + i) + 1] ^= th2;
      }
    }
    let tl = st[2], th = st[3];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i], n = ROTC[i], ol = st[2 * j], oh = st[2 * j + 1];
      let l = tl, h = th;
      if (n >= 32) {
        const x = l;
        l = h;
        h = x;
      }
      const r = n & 31;
      if (r) {
        const nl = l << r | h >>> 32 - r, nh = h << r | l >>> 32 - r;
        l = nl;
        h = nh;
      }
      st[2 * j] = l;
      st[2 * j + 1] = h;
      tl = ol;
      th = oh;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) {
        bcL[i] = st[2 * (j + i)];
        bcH[i] = st[2 * (j + i) + 1];
      }
      for (let i = 0; i < 5; i++) {
        st[2 * (j + i)] ^= ~bcL[(i + 1) % 5] & bcL[(i + 2) % 5];
        st[2 * (j + i) + 1] ^= ~bcH[(i + 1) % 5] & bcH[(i + 2) % 5];
      }
    }
    st[0] ^= RC_LO[round];
    st[1] ^= RC_HI[round];
  }
}
var enc = new TextEncoder();
var toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
var fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
var concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
function keccak256(input) {
  const data = typeof input === "string" ? enc.encode(input) : Uint8Array.from(input);
  const rate = 136;
  const padLen = rate - data.length % rate;
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded[data.length] ^= 1;
  padded[padded.length - 1] ^= 128;
  const view = new DataView(padded.buffer);
  const state = new Uint32Array(50);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) state[i] ^= view.getUint32(off + i * 4, true);
    keccakF(state);
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, state[i], true);
  return out;
}
var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
var G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
};
var mod = (a, m = P) => (a % m + m) % m;
var M256 = (1n << 256n) - 1n;
var CP = 0x1000003d1n;
var rp = (x) => {
  x = (x & M256) + (x >> 256n) * CP;
  x = (x & M256) + (x >> 256n) * CP;
  return x >= P ? x - P : x;
};
function powmod(b, e, m) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = r * b % m;
    b = b * b % m;
    e >>= 1n;
  }
  return r;
}
var inv = (a, m = P) => powmod(a, m - 2n, m);
var INF = null;
function jdouble(p) {
  if (!p) return INF;
  const { x: X, y: Y, z: Z } = p;
  if (Y === 0n) return INF;
  const A = rp(X * X), B = rp(Y * Y), C = rp(B * B);
  const t = X + B, D = rp(2n * (rp(t * t) + 2n * P - A - C));
  const E = 3n * A, F = rp(E * E);
  const X3 = rp(F + 2n * P - 2n * D);
  return { x: X3, y: rp(E * (D + P - X3) + 8n * (P - C)), z: rp(2n * Y * Z) };
}
function jadd(p, q) {
  if (!p) return q;
  if (!q) return p;
  const Z1Z1 = rp(p.z * p.z), Z2Z2 = rp(q.z * q.z);
  const U1 = rp(p.x * Z2Z2), U2 = rp(q.x * Z1Z1);
  const S1 = rp(rp(p.y * q.z) * Z2Z2), S2 = rp(rp(q.y * p.z) * Z1Z1);
  const H = U2 >= U1 ? U2 - U1 : U2 + P - U1, r = S2 >= S1 ? S2 - S1 : S2 + P - S1;
  if (H === 0n) return r === 0n ? jdouble(p) : INF;
  const HH = rp(H * H), HHH = rp(H * HH), V = rp(U1 * HH);
  const X3 = rp(r * r + 3n * P - HHH - 2n * V);
  return { x: X3, y: rp(r * (V + P - X3) + P - rp(S1 * HHH)), z: rp(rp(p.z * q.z) * H) };
}
var toJ = (p) => p ? { x: p.x, y: p.y, z: 1n } : INF;
function toAffine(p) {
  if (!p) return null;
  const zi = inv(p.z), zi2 = rp(zi * zi);
  return { x: rp(p.x * zi2), y: rp(p.y * rp(zi2 * zi)) };
}
function mulAdd(k1, p1, k2, p2) {
  k1 = mod(k1, N);
  k2 = mod(k2, N);
  const a = toJ(p1), b = toJ(p2), ab = jadd(a, b);
  let r = INF;
  for (let i = Math.max(k1.toString(2).length, k2.toString(2).length) - 1; i >= 0; i--) {
    r = jdouble(r);
    const bit1 = k1 >> BigInt(i) & 1n, bit2 = k2 >> BigInt(i) & 1n;
    if (bit1 && bit2) r = jadd(r, ab);
    else if (bit1) r = jadd(r, a);
    else if (bit2) r = jadd(r, b);
  }
  return toAffine(r);
}
var bufToBig = (b) => BigInt("0x" + (toHex(b) || "0"));
var bigToBuf = (n, len) => fromHex(n.toString(16).padStart(len * 2, "0"));
function messageHash(message) {
  const body = enc.encode(message);
  return keccak256(concat(enc.encode(`Ethereum Signed Message:
${body.length}`), body));
}
function addressFromPoint(q) {
  const pub = concat(bigToBuf(q.x, 32), bigToBuf(q.y, 32));
  return "0x" + toHex(keccak256(pub).subarray(12));
}
function recoverPoint(hash, r, s, recId) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error("assinatura inv\xE1lida");
  const x = r;
  const y2 = mod(x * x * x + 7n);
  let y = powmod(y2, (P + 1n) / 4n, P);
  if (mod(y * y) !== y2) throw new Error("assinatura inv\xE1lida");
  if ((y & 1n) !== BigInt(recId & 1)) y = P - y;
  const R = { x, y };
  const e = bufToBig(hash);
  const rInv = inv(r, N);
  const Q = mulAdd(mod(s * rInv, N), R, mod(-e * rInv, N), G);
  if (!Q) throw new Error("assinatura inv\xE1lida");
  return Q;
}
function recoverAddress(message, signatureHex) {
  const hex = String(signatureHex).replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) throw new Error("assinatura com formato inv\xE1lido");
  const sig = fromHex(hex);
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error("assinatura inv\xE1lida");
  const Q = recoverPoint(messageHash(message), bufToBig(sig.subarray(0, 32)), bufToBig(sig.subarray(32, 64)), v);
  return addressFromPoint(Q);
}
var isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a));

// worker/index.js
var SESSION_DAYS = 30;
var CHALLENGE_TTL_MS = 5 * 60 * 1e3;
var MAX_JSON_BYTES = 2 * 1024 * 1024;
var KV_MAX_LAYER_BYTES = 24 * 1024 * 1024;
var R2_MAX_LAYER_BYTES = 40 * 1024 * 1024;
var MAX_DRAWINGS_PER_USER = 300;
var MAX_LAYERS = 24;
var ORPHAN_AGE_MS = 10 * 60 * 1e3;
var te = new TextEncoder();
var td = new TextDecoder();
var warmed = false;
function warmUp() {
  if (warmed) return;
  warmed = true;
  try {
    recoverAddress("aquecimento", "0x" + "11".repeat(32) + "22".repeat(32) + "1b");
  } catch {
  }
}
var HttpError = class extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
};
var b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var unb64u = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
var randHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, te.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function secretOf(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 16) throw new HttpError(500, "servidor sem SESSION_SECRET configurado");
  return String(env.SESSION_SECRET);
}
async function makeSession(env, address) {
  const payload = b64u(te.encode(JSON.stringify({ a: address, exp: Date.now() + SESSION_DAYS * 864e5 })));
  return `${payload}.${b64u(await hmac(secretOf(env), "s:" + payload))}`;
}
async function readSession(env, token) {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  let given;
  try {
    given = unb64u(mac);
  } catch {
    return null;
  }
  if (!safeEqual(given, await hmac(secretOf(env), "s:" + payload))) return null;
  try {
    const p = JSON.parse(td.decode(unb64u(payload)));
    return p.exp > Date.now() && isAddress(p.a) ? p.a.toLowerCase() : null;
  } catch {
    return null;
  }
}
var allowedOrigins = (env) => String(env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
function corsFor(req, env) {
  const origin = req.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400"
  };
}
var SEC = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
var json = (cors, status, obj, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...SEC, ...cors, "Content-Type": "application/json; charset=utf-8", ...extra } });
async function readJson(req) {
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len > MAX_JSON_BYTES) throw new HttpError(413, "conte\xFAdo grande demais");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new HttpError(413, "conte\xFAdo grande demais");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new HttpError(400, "JSON inv\xE1lido");
  }
}
var LAYER_RE = /^[a-z0-9]{4,24}$/;
var FILE_RE = /^[a-f0-9]{24}$/;
var metaKey = (a, id) => `m:${a}:${id}`;
var layerKey = (a, id, f) => `l:${a}:${id}:${f}`;
function layerStore(env) {
  if (env.ATELIE_R2) {
    const b = env.ATELIE_R2;
    return {
      max: R2_MAX_LAYER_BYTES,
      put: (k, buf) => b.put(k, buf),
      get: async (k) => {
        const o = await b.get(k);
        return o ? o.arrayBuffer() : null;
      },
      del: (k) => b.delete(k),
      list: async (prefix) => (await b.list({ prefix })).objects.map((o) => ({ name: o.key, t: o.uploaded.getTime() }))
    };
  }
  const kv = env.ATELIE_KV;
  return {
    max: KV_MAX_LAYER_BYTES,
    put: (k, buf) => kv.put(k, buf, { metadata: { t: Date.now() } }),
    get: (k) => kv.get(k, "arrayBuffer"),
    del: (k) => kv.delete(k),
    list: async (prefix) => {
      const out = [];
      let cursor;
      do {
        const r = await kv.list({ prefix, cursor });
        out.push(...r.keys.map((k) => ({ name: k.name, t: k.metadata?.t ?? 0 })));
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      return out;
    }
  };
}
var summary = (m) => ({ id: m.id, name: m.name, width: m.width, height: m.height, updatedAt: m.updatedAt, createdAt: m.createdAt });
async function readMeta(env, a, id) {
  return env.ATELIE_KV.get(metaKey(a, id), "json");
}
async function writeMeta(env, a, id, meta) {
  await env.ATELIE_KV.put(metaKey(a, id), JSON.stringify(meta), { metadata: summary(meta) });
}
async function listDrawings(env, a) {
  const out = [];
  let cursor;
  do {
    const r = await env.ATELIE_KV.list({ prefix: `m:${a}:`, cursor });
    for (const k of r.keys) if (k.metadata) out.push(k.metadata);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out.sort((x, y) => y.updatedAt - x.updatedAt);
}
var clampInt = (v, min, max, def) => {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
};
var BLENDS = /* @__PURE__ */ new Set(["source-over", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
function sanitizeMeta(input, prev) {
  const width = clampInt(input.width ?? prev?.width, 16, 6e3, 2048);
  const height = clampInt(input.height ?? prev?.height, 16, 6e3, 1536);
  if (width * height > 36e6) throw new HttpError(400, "tela grande demais");
  const layersIn = Array.isArray(input.layers) ? input.layers.slice(0, MAX_LAYERS) : [];
  const layers = layersIn.map((l) => {
    if (!LAYER_RE.test(String(l.id))) throw new HttpError(400, "id de camada inv\xE1lido");
    if (l.file != null && !FILE_RE.test(String(l.file))) throw new HttpError(400, "arquivo de camada inv\xE1lido");
    return {
      id: String(l.id),
      name: String(l.name ?? "Camada").slice(0, 60),
      visible: l.visible !== false,
      locked: !!l.locked,
      opacity: Math.min(1, Math.max(0, Number(l.opacity ?? 1))),
      blend: BLENDS.has(l.blend) ? l.blend : "source-over",
      file: l.file ? String(l.file) : null
    };
  });
  if (!layers.length) throw new HttpError(400, "o desenho precisa de ao menos uma camada");
  let thumb = null;
  if (typeof input.thumb === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.thumb) && input.thumb.length < 2e5) thumb = input.thumb;
  return {
    width,
    height,
    layers,
    thumb: thumb ?? prev?.thumb ?? null,
    name: String(input.name ?? prev?.name ?? "Sem t\xEDtulo").slice(0, 80),
    bg: typeof input.bg === "string" && /^#[0-9a-fA-F]{6}$/.test(input.bg) ? input.bg : input.bg === null ? null : prev?.bg ?? null,
    view: input.view && typeof input.view === "object" ? { grid: !!input.view.grid } : prev?.view ?? {}
  };
}
async function cleanupOrphans(env, a, id, meta) {
  const store = layerStore(env), keep = new Set(meta.layers.map((l) => l.file).filter(Boolean));
  for (const o of await store.list(layerKey(a, id, ""))) {
    const file = o.name.split(":").pop();
    if (keep.has(file) || Date.now() - o.t < ORPHAN_AGE_MS) continue;
    await store.del(o.name);
  }
}
function originFor(req, env) {
  const origin = (req.headers.get("Origin") || "").replace(/\/$/, "");
  if (!origin || !allowedOrigins(env).includes(origin)) throw new HttpError(403, "origem n\xE3o permitida");
  return origin;
}
async function handleAuth(req, env, p, cors) {
  if (p === "/api/auth/nonce" && req.method === "POST") {
    const origin = originFor(req, env);
    const { address } = await readJson(req);
    if (!isAddress(address)) throw new HttpError(400, "endere\xE7o inv\xE1lido");
    warmUp();
    const now = /* @__PURE__ */ new Date(), exp = new Date(Date.now() + CHALLENGE_TTL_MS);
    const message = `${new URL(origin).host} quer que voc\xEA entre com sua carteira:
${address}

Assinar esta mensagem s\xF3 confirma que voc\xEA \xE9 o dono do endere\xE7o. N\xE3o custa nada (sem g\xE1s), n\xE3o autoriza transa\xE7\xF5es e n\xE3o d\xE1 acesso aos seus fundos.

URI: ${origin}
Vers\xE3o: 1
Nonce: ${randHex(16)}
Emitida em: ${now.toISOString()}
Expira em: ${exp.toISOString()}`;
    const ticket = b64u(await hmac(secretOf(env), "c:" + message));
    return json(cors, 200, { message, ticket });
  }
  if (p === "/api/auth/verify" && req.method === "POST") {
    const origin = originFor(req, env);
    const { address, message, signature, ticket } = await readJson(req);
    if (!isAddress(address) || typeof message !== "string" || typeof signature !== "string" || typeof ticket !== "string") throw new HttpError(400, "dados inv\xE1lidos");
    let tk;
    try {
      tk = unb64u(ticket);
    } catch {
      throw new HttpError(401, "desafio inv\xE1lido");
    }
    if (!safeEqual(tk, await hmac(secretOf(env), "c:" + message))) throw new HttpError(401, "desafio expirado ou inv\xE1lido, tente novamente");
    const lines = message.split("\n");
    const exp = Date.parse((/^Expira em: (.+)$/m.exec(message) || [])[1] || "");
    if (!(exp > Date.now())) throw new HttpError(401, "desafio expirado, tente novamente");
    if (lines[1] !== address && lines[1]?.toLowerCase() !== address.toLowerCase()) throw new HttpError(401, "desafio de outro endere\xE7o");
    if (`URI: ${origin}` !== lines.find((l) => l.startsWith("URI: "))) throw new HttpError(401, "desafio de outra origem");
    let recovered;
    try {
      recovered = recoverAddress(message, signature);
    } catch {
      throw new HttpError(401, "assinatura inv\xE1lida");
    }
    if (recovered !== address.toLowerCase()) throw new HttpError(401, "a assinatura n\xE3o corresponde ao endere\xE7o");
    return json(cors, 200, { address: recovered, token: await makeSession(env, recovered) });
  }
  if (p === "/api/auth/logout" && req.method === "POST") return json(cors, 200, { ok: true });
  return null;
}
async function handleApi(req, env, ctx, url, cors) {
  const p = url.pathname;
  if (p === "/api/health") return json(cors, 200, { ok: true });
  const auth = await handleAuth(req, env, p, cors);
  if (auth) return auth;
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("Authorization") || "");
  const addr = await readSession(env, bearer?.[1]);
  if (p === "/api/me") return json(cors, addr ? 200 : 401, addr ? { address: addr } : { error: "n\xE3o autenticado" });
  if (!addr) throw new HttpError(401, "n\xE3o autenticado");
  if (p === "/api/drawings" && req.method === "GET") return json(cors, 200, { drawings: await listDrawings(env, addr) });
  if (p === "/api/drawings" && req.method === "POST") {
    if ((await listDrawings(env, addr)).length >= MAX_DRAWINGS_PER_USER) throw new HttpError(400, "limite de desenhos atingido");
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
    if (!meta) throw new HttpError(404, "desenho n\xE3o encontrado");
    if (req.method === "GET") return json(cors, 200, meta);
    if (req.method === "PUT") {
      const body = await readJson(req);
      if (Number(body.baseRev) !== meta.rev) throw new HttpError(409, "o desenho foi alterado em outro dispositivo");
      const next = { ...meta, ...sanitizeMeta(body, meta), rev: meta.rev + 1, updatedAt: Date.now() };
      await writeMeta(env, addr, id, next);
      ctx.waitUntil(cleanupOrphans(env, addr, id, next).catch(() => {
      }));
      return json(cors, 200, { rev: next.rev, updatedAt: next.updatedAt });
    }
    if (req.method === "DELETE") {
      const store = layerStore(env);
      for (const o of await store.list(layerKey(addr, id, ""))) await store.del(o.name);
      await env.ATELIE_KV.delete(metaKey(addr, id));
      return json(cors, 200, { ok: true });
    }
  }
  m = /^\/api\/drawings\/([a-f0-9]{16})\/thumb$/.exec(p);
  if (m && req.method === "GET") {
    const meta = await readMeta(env, addr, m[1]);
    if (!meta) throw new HttpError(404, "desenho n\xE3o encontrado");
    return json(cors, 200, { thumb: meta.thumb || null });
  }
  m = /^\/api\/drawings\/([a-f0-9]{16})\/layers$/.exec(p);
  if (m && req.method === "POST") {
    const id = m[1], store = layerStore(env);
    if (!await readMeta(env, addr, id)) throw new HttpError(404, "desenho n\xE3o encontrado");
    if (Number(req.headers.get("Content-Length") || 0) > store.max) throw new HttpError(413, "camada grande demais para o armazenamento gratuito");
    const buf = await req.arrayBuffer();
    if (buf.byteLength > store.max) throw new HttpError(413, "camada grande demais para o armazenamento gratuito");
    const magic = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    if (magic.length < 8 || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => magic[i] !== b)) throw new HttpError(400, "a camada precisa ser um PNG");
    const file = randHex(12);
    await store.put(layerKey(addr, id, file), buf);
    return json(cors, 201, { file });
  }
  m = /^\/api\/drawings\/([a-f0-9]{16})\/layers\/([a-f0-9]{24})\.png$/.exec(p);
  if (m && req.method === "GET") {
    const buf = await layerStore(env).get(layerKey(addr, m[1], m[2]));
    if (!buf) throw new HttpError(404, "camada n\xE3o encontrada");
    return new Response(buf, { status: 200, headers: { ...SEC, ...cors, "Content-Type": "image/png", "Cache-Control": "private, max-age=31536000, immutable" } });
  }
  throw new HttpError(404, "rota n\xE3o encontrada");
}
var index_default = {
  async fetch(req, env, ctx) {
    const cors = corsFor(req, env);
    try {
      if (!env.ATELIE_KV) throw new HttpError(500, "servidor sem o KV ATELIE_KV configurado");
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...SEC, ...cors } });
      if (!url.pathname.startsWith("/api/")) return new Response("Ateli\xEA API \u2014 ok", { headers: { ...SEC, "Content-Type": "text/plain; charset=utf-8" } });
      return await handleApi(req, env, ctx, url, cors);
    } catch (e) {
      if (e instanceof HttpError) return json(cors, e.status, { error: e.message });
      console.error(e);
      return json(cors, 500, { error: "erro interno" });
    }
  }
};
export {
  index_default as default
};

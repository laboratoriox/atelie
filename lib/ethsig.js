// Verificação de assinaturas Ethereum (personal_sign / EIP-191) sem dependências.
// Implementa keccak256 e recuperação de chave pública secp256k1 com BigInt.
// Só é usado para AUTENTICAÇÃO: nunca toca em chaves privadas nem em fundos.
//
// Se preferir uma biblioteca auditada, basta trocar `recoverAddress` por
// `ethers.verifyMessage(message, signature)` em server.js.

// ---------- keccak256 ----------
const MASK64 = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// keccak-f[1600] com lanes de 64 bits guardadas como pares de 32 bits (muito mais rápido que BigInt).
const RC_LO = Uint32Array.from(RC, (x) => Number(x & 0xffffffffn)), RC_HI = Uint32Array.from(RC, (x) => Number(x >> 32n));
const ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const bcL = new Uint32Array(5), bcH = new Uint32Array(5);

function keccakF(st) { // st: Uint32Array(50) — lane i = (st[2i] baixo, st[2i+1] alto)
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      bcL[i] = st[2 * i] ^ st[2 * (i + 5)] ^ st[2 * (i + 10)] ^ st[2 * (i + 15)] ^ st[2 * (i + 20)];
      bcH[i] = st[2 * i + 1] ^ st[2 * (i + 5) + 1] ^ st[2 * (i + 10) + 1] ^ st[2 * (i + 15) + 1] ^ st[2 * (i + 20) + 1];
    }
    for (let i = 0; i < 5; i++) {
      const l = bcL[(i + 1) % 5], h = bcH[(i + 1) % 5];
      const tl = bcL[(i + 4) % 5] ^ ((l << 1) | (h >>> 31)), th = bcH[(i + 4) % 5] ^ ((h << 1) | (l >>> 31));
      for (let j = 0; j < 25; j += 5) { st[2 * (j + i)] ^= tl; st[2 * (j + i) + 1] ^= th; }
    }
    let tl = st[2], th = st[3];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i], n = ROTC[i], ol = st[2 * j], oh = st[2 * j + 1];
      let l = tl, h = th;
      if (n >= 32) { const x = l; l = h; h = x; }
      const r = n & 31;
      if (r) { const nl = (l << r) | (h >>> (32 - r)), nh = (h << r) | (l >>> (32 - r)); l = nl; h = nh; }
      st[2 * j] = l; st[2 * j + 1] = h;
      tl = ol; th = oh;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) { bcL[i] = st[2 * (j + i)]; bcH[i] = st[2 * (j + i) + 1]; }
      for (let i = 0; i < 5; i++) {
        st[2 * (j + i)] ^= ~bcL[(i + 1) % 5] & bcL[(i + 2) % 5];
        st[2 * (j + i) + 1] ^= ~bcH[(i + 1) % 5] & bcH[(i + 2) % 5];
      }
    }
    st[0] ^= RC_LO[round]; st[1] ^= RC_HI[round];
  }
}

// Funciona em Node e em Cloudflare Workers (sem depender de Buffer).
const enc = new TextEncoder();
export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => Uint8Array.from((h.match(/../g) || []), (x) => parseInt(x, 16));
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

export function keccak256(input) {
  const data = typeof input === 'string' ? enc.encode(input) : Uint8Array.from(input);
  const rate = 136;
  const padLen = rate - (data.length % rate);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded[data.length] ^= 0x01; // keccak (não SHA-3): padding 0x01
  padded[padded.length - 1] ^= 0x80;
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

// ---------- secp256k1 ----------
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

const mod = (a, m = P) => ((a % m) + m) % m;
// Redução rápida módulo P (P = 2^256 - 4294968273) para x >= 0, sem divisão.
const M256 = (1n << 256n) - 1n, CP = 0x1000003d1n;
const rp = (x) => {
  x = (x & M256) + (x >> 256n) * CP;
  x = (x & M256) + (x >> 256n) * CP;
  return x >= P ? x - P : x;
};
function powmod(b, e, m) {
  let r = 1n; b = mod(b, m);
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const inv = (a, m = P) => powmod(a, m - 2n, m);

// Coordenadas jacobianas (sem inversão a cada passo) — essencial para rodar rápido
// no limite de CPU do plano gratuito do Cloudflare Workers (~10 ms).
const INF = null;
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
const toJ = (p) => (p ? { x: p.x, y: p.y, z: 1n } : INF);
function toAffine(p) {
  if (!p) return null;
  const zi = inv(p.z), zi2 = rp(zi * zi);
  return { x: rp(p.x * zi2), y: rp(p.y * rp(zi2 * zi)) };
}
function add(p, q) { return toAffine(jadd(toJ(p), toJ(q))); }
/** k1*P1 + k2*P2 em um único laço (truque de Shamir). */
function mulAdd(k1, p1, k2, p2) {
  k1 = mod(k1, N); k2 = mod(k2, N);
  const a = toJ(p1), b = toJ(p2), ab = jadd(a, b);
  let r = INF;
  for (let i = Math.max(k1.toString(2).length, k2.toString(2).length) - 1; i >= 0; i--) {
    r = jdouble(r);
    const bit1 = (k1 >> BigInt(i)) & 1n, bit2 = (k2 >> BigInt(i)) & 1n;
    if (bit1 && bit2) r = jadd(r, ab); else if (bit1) r = jadd(r, a); else if (bit2) r = jadd(r, b);
  }
  return toAffine(r);
}
function mul(p, k) { return mulAdd(k, p, 0n, p); }

const bufToBig = (b) => BigInt('0x' + (toHex(b) || '0'));
const bigToBuf = (n, len) => fromHex(n.toString(16).padStart(len * 2, '0'));

export function messageHash(message) {
  const body = enc.encode(message);
  return keccak256(concat(enc.encode(`\x19Ethereum Signed Message:\n${body.length}`), body));
}

function addressFromPoint(q) {
  const pub = concat(bigToBuf(q.x, 32), bigToBuf(q.y, 32));
  return '0x' + toHex(keccak256(pub).subarray(12));
}

export function recoverPoint(hash, r, s, recId) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('assinatura inválida');
  const x = r; // (r + N não é tratado: probabilidade desprezível)
  const y2 = mod(x * x * x + 7n);
  let y = powmod(y2, (P + 1n) / 4n, P);
  if (mod(y * y) !== y2) throw new Error('assinatura inválida');
  if ((y & 1n) !== BigInt(recId & 1)) y = P - y;
  const R = { x, y };
  const e = bufToBig(hash);
  const rInv = inv(r, N);
  // Q = r^-1 * (s*R - e*G) = (s*r^-1)*R + (-e*r^-1)*G
  const Q = mulAdd(mod(s * rInv, N), R, mod(-e * rInv, N), G);
  if (!Q) throw new Error('assinatura inválida');
  return Q;
}

/** Recupera o endereço (minúsculo) que assinou `message` via personal_sign. */
export function recoverAddress(message, signatureHex) {
  const hex = String(signatureHex).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) throw new Error('assinatura com formato inválido');
  const sig = fromHex(hex);
  let v = sig[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error('assinatura inválida');
  const Q = recoverPoint(messageHash(message), bufToBig(sig.subarray(0, 32)), bufToBig(sig.subarray(32, 64)), v);
  return addressFromPoint(Q);
}

export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a));

// Usado apenas nos testes.
export const _internals = { mul, G, N, addressFromPoint, bigToBuf, bufToBig, mod, inv, messageHash, toHex };

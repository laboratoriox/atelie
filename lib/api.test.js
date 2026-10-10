// Teste de integração: carteira simulada -> login -> desenho -> camadas.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keccak256, _internals as I } from './ethsig.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelie-test-'));
const PORT = 3917;
const base = `http://127.0.0.1:${PORT}`;
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir, HOST: '127.0.0.1' }, stdio: 'pipe' });
await new Promise((r) => srv.stdout.on('data', (d) => String(d).includes('rodando') && r()));

function sign(message, d) {
  const e = I.bufToBig(I.messageHash(message));
  const k = (I.bufToBig(keccak256('k' + message)) % I.N) || 1n;
  const R = I.mul(I.G, k), r = R.x % I.N;
  let s = I.mod(I.inv(k, I.N) * (e + r * d), I.N), v = Number(R.y & 1n);
  if (s > I.N / 2n) { s = I.N - s; v ^= 1; }
  return '0x' + I.toHex(I.bigToBuf(r, 32)) + I.toHex(I.bigToBuf(s, 32)) + (27 + v).toString(16);
}
let cookie = '';
async function call(method, url, body, extra = {}) {
  const isBuf = Buffer.isBuffer(body);
  const res = await fetch(base + url, {
    method, headers: { ...(body && !isBuf ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra },
    body: body ? (isBuf ? body : JSON.stringify(body)) : undefined,
  });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

try {
  const d = 0xabc123456789n;
  const address = I.addressFromPoint(I.mul(I.G, d));

  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/drawings')).status, 401);

  // login com assinatura errada (de outra chave) é recusado
  let { data } = await call('POST', '/api/auth/nonce', { address });
  assert.equal((await call('POST', '/api/auth/verify', { address, message: data.message, signature: sign(data.message, 7n) })).status, 401);

  // login correto
  ({ data } = await call('POST', '/api/auth/nonce', { address }));
  const sig = sign(data.message, d);
  assert.equal((await call('POST', '/api/auth/verify', { address, message: data.message, signature: sig })).status, 200);
  // o desafio é de uso único
  assert.equal((await call('POST', '/api/auth/verify', { address, message: data.message, signature: sig })).status, 401);
  assert.equal((await call('GET', '/api/me')).data.address, address);

  // origem diferente é bloqueada (CSRF)
  assert.equal((await call('POST', '/api/drawings', { name: 'x', layers: [{ id: 'abcd' }] }, { Origin: 'https://evil.example' })).status, 403);

  // criar desenho + camada PNG + salvar meta
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake')]);
  let r = await call('POST', '/api/drawings', { name: 'Teste', width: 800, height: 600, layers: [{ id: 'l1abc', name: 'Fundo' }] });
  assert.equal(r.status, 201);
  const id = r.data.id;
  r = await call('POST', `/api/drawings/${id}/layers`, Buffer.from('não é png'));
  assert.equal(r.status, 400);
  r = await call('POST', `/api/drawings/${id}/layers`, png);
  assert.equal(r.status, 201);
  const file = r.data.file;
  r = await call('PUT', `/api/drawings/${id}`, { baseRev: 1, name: 'Teste 2', layers: [{ id: 'l1abc', name: 'Fundo', file }] });
  assert.equal(r.status, 200);
  assert.equal(r.data.rev, 2);
  // edição concorrente desatualizada -> 409
  assert.equal((await call('PUT', `/api/drawings/${id}`, { baseRev: 1, layers: [{ id: 'l1abc' }] })).status, 409);
  r = await call('GET', `/api/drawings/${id}/layers/${file}.png`);
  assert.equal(r.status, 200); assert.ok(r.data.equals(png));
  r = await call('GET', '/api/drawings');
  assert.equal(r.data.drawings.length, 1);
  assert.equal(r.data.drawings[0].name, 'Teste 2');

  // outro usuário não enxerga o desenho
  const saved = cookie; cookie = '';
  const d2 = 0x777n, a2 = I.addressFromPoint(I.mul(I.G, d2));
  ({ data } = await call('POST', '/api/auth/nonce', { address: a2 }));
  await call('POST', '/api/auth/verify', { address: a2, message: data.message, signature: sign(data.message, d2) });
  assert.equal((await call('GET', `/api/drawings/${id}`)).status, 404);
  cookie = saved;

  // path traversal
  assert.notEqual((await call('GET', '/..%2f..%2fserver.js')).data.toString().includes('createServer'), true);

  assert.equal((await call('DELETE', `/api/drawings/${id}`)).status, 200);
  assert.equal((await call('GET', `/api/drawings/${id}`)).status, 404);
  console.log('api: todos os testes passaram');
} finally {
  srv.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

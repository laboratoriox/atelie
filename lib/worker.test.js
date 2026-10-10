// Testes do backend Cloudflare Worker (roda o Worker no Node com um KV simulado).
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { FakeKV } from './fakekv.js';
import { signPersonal, testAddress, TEST_KEY } from './testwallet.js';

const ORIGIN = 'https://usuario.github.io';
const kv = new FakeKV();
const env = { ATELIE_KV: kv, SESSION_SECRET: 'segredo-de-teste-bem-comprido-123456', ALLOWED_ORIGIN: ORIGIN };
const tasks = []; const ctx = { waitUntil: (p) => tasks.push(p) };

async function call(method, path, { body, token, origin = ORIGIN, raw } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://api.test' + path, { method, headers, body: body ? (raw ? body : JSON.stringify(body)) : undefined }), env, ctx);
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
}

const address = testAddress();

// --- CORS ---
let r = await call('OPTIONS', '/api/drawings');
assert.equal(r.status, 204);
assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
r = await call('OPTIONS', '/api/drawings', { origin: 'https://intruso.example' });
assert.equal(r.headers.get('access-control-allow-origin'), null);

// --- login ---
assert.equal((await call('GET', '/api/me')).status, 401);
assert.equal((await call('POST', '/api/auth/nonce', { body: { address }, origin: 'https://intruso.example' })).status, 403);
r = await call('POST', '/api/auth/nonce', { body: { address } });
assert.equal(r.status, 200);
const { message, ticket } = r.data;
assert.ok(message.includes(address) && message.includes('URI: ' + ORIGIN));

// assinatura de outro endereço / mensagem adulterada / ticket errado
const bad = signPersonal(message, TEST_KEY + 1n);
assert.equal((await call('POST', '/api/auth/verify', { body: { address, message, signature: bad, ticket } })).status, 401);
assert.equal((await call('POST', '/api/auth/verify', { body: { address, message: message + ' ', signature: signPersonal(message + ' '), ticket } })).status, 401);
assert.equal((await call('POST', '/api/auth/verify', { body: { address, message, signature: signPersonal(message), ticket: 'AAAA' } })).status, 401);
// desafio emitido para outra origem não vale aqui
assert.equal((await call('POST', '/api/auth/verify', { body: { address, message: message.replace('URI: ' + ORIGIN, 'URI: https://outro.example'), signature: signPersonal(message), ticket } })).status, 401);

r = await call('POST', '/api/auth/verify', { body: { address, message, signature: signPersonal(message), ticket } });
assert.equal(r.status, 200);
assert.equal(r.data.address, address);
const token = r.data.token;
assert.ok(token);
r = await call('GET', '/api/me', { token });
assert.equal(r.data.address, address);
assert.equal((await call('GET', '/api/me', { token: token.slice(0, -2) + 'xx' })).status, 401);
assert.equal((await call('GET', '/api/drawings')).status, 401);

// --- desenhos ---
const layers = [{ id: 'fundo001', name: 'Fundo' }, { id: 'cam00002', name: 'Camada 1' }];
r = await call('POST', '/api/drawings', { token, body: { name: 'Teste', width: 640, height: 480, layers } });
assert.equal(r.status, 201);
const id = r.data.id, rev0 = r.data.rev;
assert.match(id, /^[a-f0-9]{16}$/);

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
r = await call('POST', `/api/drawings/${id}/layers`, { token, body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), raw: true });
assert.equal(r.status, 400); // não é PNG
r = await call('POST', `/api/drawings/${id}/layers`, { token, body: png, raw: true });
assert.equal(r.status, 201);
const file = r.data.file;
r = await call('GET', `/api/drawings/${id}/layers/${file}.png`, { token });
assert.equal(r.status, 200);
assert.deepEqual([...r.data], [...png]);
assert.equal((await call('GET', `/api/drawings/${id}/layers/${file}.png`)).status, 401);

const thumb = 'data:image/jpeg;base64,/9j/4AAQ';
r = await call('PUT', `/api/drawings/${id}`, { token, body: { baseRev: rev0, name: 'Teste 2', layers: [{ ...layers[0], file }, layers[1]], thumb } });
assert.equal(r.status, 200);
assert.equal(r.data.rev, rev0 + 1);
// salvar de novo com revisão antiga => conflito (outro aparelho salvou antes)
assert.equal((await call('PUT', `/api/drawings/${id}`, { token, body: { baseRev: rev0, layers } })).status, 409);

r = await call('GET', '/api/drawings', { token });
assert.equal(r.data.drawings.length, 1);
assert.equal(r.data.drawings[0].name, 'Teste 2');
assert.equal(r.data.drawings[0].thumb, undefined); // miniatura vem por /thumb
assert.equal((await call('GET', `/api/drawings/${id}/thumb`, { token })).data.thumb, thumb);

// outro usuário não enxerga nada
const other = await (async () => {
  const { TEST_KEY: K } = await import('./testwallet.js');
  const { _internals: I } = await import('./ethsig.js');
  const addr2 = I.addressFromPoint(I.mul(I.G, K + 7n));
  const n = await call('POST', '/api/auth/nonce', { body: { address: addr2 } });
  const v = await call('POST', '/api/auth/verify', { body: { address: addr2, message: n.data.message, signature: signPersonal(n.data.message, K + 7n), ticket: n.data.ticket } });
  return v.data.token;
})();
assert.equal((await call('GET', '/api/drawings', { token: other })).data.drawings.length, 0);
assert.equal((await call('GET', `/api/drawings/${id}`, { token: other })).status, 404);

// remoção apaga meta e camadas
assert.equal((await call('DELETE', `/api/drawings/${id}`, { token })).status, 200);
assert.equal((await call('GET', `/api/drawings/${id}`, { token })).status, 404);
assert.equal([...kv.m.keys()].filter((k) => k.includes(id)).length, 0);
await Promise.all(tasks);
console.log('worker: todos os testes passaram');

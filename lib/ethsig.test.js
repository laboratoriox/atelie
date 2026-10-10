import assert from 'node:assert/strict';
import { keccak256, recoverAddress, _internals as I } from './ethsig.js';

const hex = (b) => Buffer.from(b).toString('hex');

// keccak256 — vetores conhecidos
assert.equal(hex(keccak256('')), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
assert.equal(hex(keccak256('abc')), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
assert.equal(hex(keccak256('a'.repeat(200))).length, 64); // atravessa mais de um bloco

// chave privada 1 -> endereço bem conhecido
const pub1 = I.mul(I.G, 1n);
assert.equal(I.addressFromPoint(pub1), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');

// assina (apenas no teste) e recupera
function sign(message, d, kSeed) {
  const e = I.bufToBig(I.messageHash(message));
  let k = I.bufToBig(keccak256(kSeed)) % I.N || 1n;
  const R = I.mul(I.G, k);
  const r = R.x % I.N;
  let s = I.mod(I.inv(k, I.N) * (e + r * d), I.N);
  let v = Number(R.y & 1n);
  if (s > I.N / 2n) { s = I.N - s; v ^= 1; }
  return '0x' + I.toHex(I.bigToBuf(r, 32)) + I.toHex(I.bigToBuf(s, 32)) + (27 + v).toString(16);
}

for (const [d, msg] of [
  [1n, 'olá, mundo'],
  [0xdeadbeefcafebaben, 'Nonce: 1234\nlinha 2 — acentuação ✓'],
  [I.N - 12345n, 'x'],
]) {
  const expected = I.addressFromPoint(I.mul(I.G, d));
  assert.equal(recoverAddress(msg, sign(msg, d, 'k' + d)), expected);
  // mensagem adulterada não pode recuperar o mesmo endereço
  let other = null;
  try { other = recoverAddress(msg + '!', sign(msg, d, 'k' + d)); } catch {}
  assert.notEqual(other, expected);
}

assert.throws(() => recoverAddress('x', '0x1234'));
console.log('ethsig: todos os testes passaram');

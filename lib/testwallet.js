// Carteira de teste (apenas para testes automatizados): assina com uma chave fixa.
import { keccak256, _internals as I } from './ethsig.js';
export const TEST_KEY = 0x1234567890abcdef1234567890abcdefn;
export const testAddress = () => I.addressFromPoint(I.mul(I.G, TEST_KEY));
export function signPersonal(message, d = TEST_KEY) {
  const e = I.bufToBig(I.messageHash(message));
  const k = (I.bufToBig(keccak256('k' + message)) % I.N) || 1n;
  const R = I.mul(I.G, k), r = R.x % I.N;
  let s = I.mod(I.inv(k, I.N) * (e + r * d), I.N), v = Number(R.y & 1n);
  if (s > I.N / 2n) { s = I.N - s; v ^= 1; }
  return '0x' + I.toHex(I.bigToBuf(r, 32)) + I.toHex(I.bigToBuf(s, 32)) + (27 + v).toString(16);
}
if (process.argv[2] === 'address') console.log(testAddress());
else if (process.argv[2] === 'sign') { let b = ''; process.stdin.on('data', (c) => (b += c)).on('end', () => console.log(signPersonal(b))); }

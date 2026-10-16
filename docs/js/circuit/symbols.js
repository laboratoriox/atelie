// Biblioteca de componentes do editor de circuitos (símbolos próprios).
// Tudo em "unidades" de grade: 1 célula = 10 unidades. Os pinos ficam sempre em múltiplos de 10.
// Primitivas (já simplificadas, sem arcos): ['pl', pts] linha, ['pg', pts] contorno fechado, ['fp', pts] polígono cheio,
// ['c', x, y, r] círculo, ['fc', x, y, r] círculo cheio, ['t', x, y, texto, tamanho, alinhamento].

const rad = (d) => (d * Math.PI) / 180;
const arc = (cx, cy, r, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const a = rad(a0 + ((a1 - a0) * i) / n); return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
const quad = (p0, c, p1, n = 10) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]; });
const cubic = (p0, c1, c2, p1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]]; });

const L = (x1, y1, x2, y2) => ['pl', [[x1, y1], [x2, y2]]];
const PL = (...p) => ['pl', p];
const PG = (...p) => ['pg', p];
const FP = (...p) => ['fp', p];
const C = (x, y, r) => ['c', x, y, r];
const FC = (x, y, r) => ['fc', x, y, r];
const A = (cx, cy, r, a0, a1) => ['pl', arc(cx, cy, r, a0, a1)];
const T = (x, y, s, size = 10, align = 'middle') => ['t', x, y, s, size, align];
const R = (x, y, w, h) => PG([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
/** Ponta de seta: triângulo com a ponta em P (a fração t do caminho de (x1,y1) até (x2,y2)). */
function arrow(x1, y1, x2, y2, size = 6, t = 1) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const px = x1 + dx * t, py = y1 + dy * t, bx = px - ux * size, by = py - uy * size, w = size * 0.45;
  return FP([px, py], [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]);
}
const P2 = [{ n: '1', x: -30, y: 0 }, { n: '2', x: 30, y: 0 }];
const PV = [{ n: '+', x: 0, y: -30 }, { n: '−', x: 0, y: 30 }];

// ---------- símbolos fixos ----------
const FIXED = {
  R: { name: 'Resistor', cat: 'Básicos', prefix: 'R', val: '1k', pins: P2, prims: [L(-30, 0, -18, 0), R(-18, -6, 36, 12), L(18, 0, 30, 0)] },
  POT: { name: 'Potenciômetro', cat: 'Básicos', prefix: 'RV', val: '10k', pins: [{ n: '1', x: -30, y: 0 }, { n: '2', x: 30, y: 0 }, { n: 'W', x: 0, y: -30 }],
    prims: [L(-30, 0, -18, 0), R(-18, -6, 36, 12), L(18, 0, 30, 0), L(0, -30, 0, -9), arrow(0, -30, 0, -6, 6, 1)] },
  C: { name: 'Capacitor', cat: 'Básicos', prefix: 'C', val: '100n', pins: P2, prims: [L(-30, 0, -4, 0), L(-4, -12, -4, 12), L(4, -12, 4, 12), L(4, 0, 30, 0)] },
  CP: { name: 'Capacitor eletrolítico', cat: 'Básicos', prefix: 'C', val: '100u', pins: [{ n: '+', x: -30, y: 0 }, { n: '−', x: 30, y: 0 }],
    prims: [L(-30, 0, -4, 0), L(-4, -12, -4, 12), A(-14, 0, 18, -32, 32), L(4, 0, 30, 0), T(-14, -10, '+', 9)] },
  L: { name: 'Indutor', cat: 'Básicos', prefix: 'L', val: '10u', pins: P2,
    prims: [L(-30, 0, -20, 0), A(-15, 0, 5, 180, 360), A(-5, 0, 5, 180, 360), A(5, 0, 5, 180, 360), A(15, 0, 5, 180, 360), L(20, 0, 30, 0)] },
  TRAFO: { name: 'Transformador', cat: 'Básicos', prefix: 'T', val: '1:1',
    pins: [{ n: 'P1', x: -30, y: -20 }, { n: 'P2', x: -30, y: 20 }, { n: 'S1', x: 30, y: -20 }, { n: 'S2', x: 30, y: 20 }],
    prims: [L(-30, -20, -10, -20), L(-30, 20, -10, 20), A(-10, -15, 5, 90, 270), A(-10, -5, 5, 90, 270), A(-10, 5, 5, 90, 270), A(-10, 15, 5, 90, 270),
      L(-3, -22, -3, 22), L(3, -22, 3, 22), L(10, -20, 30, -20), L(10, 20, 30, 20), A(10, -15, 5, -90, 90), A(10, -5, 5, -90, 90), A(10, 5, 5, -90, 90), A(10, 15, 5, -90, 90)] },
  F: { name: 'Fusível', cat: 'Básicos', prefix: 'F', val: '1A', pins: P2, prims: [L(-30, 0, -18, 0), R(-18, -5, 36, 10), L(-18, 0, 18, 0), L(18, 0, 30, 0)] },
  XTAL: { name: 'Cristal', cat: 'Básicos', prefix: 'Y', val: '16MHz', pins: P2, prims: [L(-30, 0, -8, 0), L(-8, -10, -8, 10), R(-4, -8, 8, 16), L(8, -10, 8, 10), L(8, 0, 30, 0)] },
  LDR: { name: 'Sensor de luz (LDR)', cat: 'Básicos', prefix: 'LDR', val: 'LDR', pins: P2,
    prims: [L(-30, 0, -18, 0), R(-18, -6, 36, 12), L(18, 0, 30, 0), L(-14, -26, -6, -14), arrow(-14, -26, -6, -14, 5), L(-4, -28, 4, -16), arrow(-4, -28, 4, -16, 5)] },
  NTC: { name: 'Termistor', cat: 'Básicos', prefix: 'TH', val: '10k NTC', pins: P2, prims: [L(-30, 0, -18, 0), R(-18, -6, 36, 12), L(18, 0, 30, 0), PL([-20, 12], [-12, 12], [14, -12])] },

  D: { name: 'Diodo', cat: 'Semicondutores', prefix: 'D', val: '1N4148', pins: [{ n: 'A', x: -30, y: 0 }, { n: 'K', x: 30, y: 0 }],
    prims: [L(-30, 0, -8, 0), PG([-8, -9], [-8, 9], [8, 0]), L(8, -9, 8, 9), L(8, 0, 30, 0)] },
  ZD: { name: 'Diodo Zener', cat: 'Semicondutores', prefix: 'D', val: '5V1', pins: [{ n: 'A', x: -30, y: 0 }, { n: 'K', x: 30, y: 0 }],
    prims: [L(-30, 0, -8, 0), PG([-8, -9], [-8, 9], [8, 0]), PL([4, -12], [8, -9], [8, 9], [12, 12]), L(8, 0, 30, 0)] },
  SD: { name: 'Diodo Schottky', cat: 'Semicondutores', prefix: 'D', val: '1N5819', pins: [{ n: 'A', x: -30, y: 0 }, { n: 'K', x: 30, y: 0 }],
    prims: [L(-30, 0, -8, 0), PG([-8, -9], [-8, 9], [8, 0]), PL([4, -8], [4, -12], [8, -12], [8, 12], [12, 12], [12, 8]), L(8, 0, 30, 0)] },
  LED: { name: 'LED', cat: 'Semicondutores', prefix: 'D', val: 'LED', pins: [{ n: 'A', x: -30, y: 0 }, { n: 'K', x: 30, y: 0 }],
    prims: [L(-30, 0, -8, 0), PG([-8, -9], [-8, 9], [8, 0]), L(8, -9, 8, 9), L(8, 0, 30, 0), L(0, -12, 10, -22), arrow(0, -12, 10, -22, 5), L(6, -8, 16, -18), arrow(6, -8, 16, -18, 5)] },
  NPN: { name: 'Transistor NPN', cat: 'Semicondutores', prefix: 'Q', val: 'BC547', pins: [{ n: 'B', x: -30, y: 0 }, { n: 'C', x: 10, y: -30 }, { n: 'E', x: 10, y: 30 }],
    prims: [C(0, 0, 22), L(-30, 0, -8, 0), L(-8, -14, -8, 14), L(-8, -5, 10, -20), L(10, -20, 10, -30), L(-8, 5, 10, 20), L(10, 20, 10, 30), arrow(-8, 5, 10, 20, 6, 0.97)] },
  PNP: { name: 'Transistor PNP', cat: 'Semicondutores', prefix: 'Q', val: 'BC557', pins: [{ n: 'B', x: -30, y: 0 }, { n: 'C', x: 10, y: 30 }, { n: 'E', x: 10, y: -30 }],
    prims: [C(0, 0, 22), L(-30, 0, -8, 0), L(-8, -14, -8, 14), L(-8, -5, 10, -20), L(10, -20, 10, -30), L(-8, 5, 10, 20), L(10, 20, 10, 30), arrow(10, -20, -8, -5, 6, 0.6)] },
  NMOS: { name: 'MOSFET canal N', cat: 'Semicondutores', prefix: 'Q', val: 'IRLZ44N', pins: [{ n: 'G', x: -30, y: 0 }, { n: 'D', x: 10, y: -30 }, { n: 'S', x: 10, y: 30 }],
    prims: [L(-30, 0, -14, 0), L(-14, -12, -14, 12), L(-8, -14, -8, -8), L(-8, -4, -8, 4), L(-8, 8, -8, 14), L(-8, -11, 10, -11), L(10, -11, 10, -30), L(-8, 11, 10, 11), L(10, 11, 10, 30), L(-8, 0, 10, 0), L(10, 0, 10, 11), arrow(10, 0, -8, 0, 6, 0.9)] },
  PMOS: { name: 'MOSFET canal P', cat: 'Semicondutores', prefix: 'Q', val: 'IRF9540', pins: [{ n: 'G', x: -30, y: 0 }, { n: 'D', x: 10, y: 30 }, { n: 'S', x: 10, y: -30 }],
    prims: [L(-30, 0, -14, 0), L(-14, -12, -14, 12), L(-8, -14, -8, -8), L(-8, -4, -8, 4), L(-8, 8, -8, 14), L(-8, -11, 10, -11), L(10, -11, 10, -30), L(-8, 11, 10, 11), L(10, 11, 10, 30), L(-8, 0, 10, 0), L(10, 0, 10, -11), arrow(-8, 0, 10, 0, 6, 0.65)] },
  OPAMP: { name: 'Amplificador operacional', cat: 'Semicondutores', prefix: 'U', val: 'LM358', pins: [{ n: '−', x: -30, y: -10 }, { n: '+', x: -30, y: 10 }, { n: 'OUT', x: 30, y: 0 }],
    prims: [PG([-20, -25], [-20, 25], [20, 0]), L(-30, -10, -20, -10), L(-30, 10, -20, 10), L(20, 0, 30, 0), T(-16, -7, '−', 11, 'start'), T(-16, 13, '+', 11, 'start')] },

  BT: { name: 'Pilha / bateria', cat: 'Fontes e terra', prefix: 'BT', val: '9V', pins: [{ n: '+', x: -30, y: 0 }, { n: '−', x: 30, y: 0 }],
    prims: [L(-30, 0, -4, 0), L(-4, -12, -4, 12), L(4, -6, 4, 6), L(4, 0, 30, 0), T(-14, -4, '+', 10)] },
  VDC: { name: 'Fonte de tensão contínua', cat: 'Fontes e terra', prefix: 'V', val: '5V', pins: PV,
    prims: [C(0, 0, 20), L(0, -30, 0, -20), L(0, 20, 0, 30), T(0, -8, '+', 12), T(0, 12, '−', 12)] },
  VAC: { name: 'Fonte de tensão alternada', cat: 'Fontes e terra', prefix: 'V', val: '12Vac', pins: [{ n: '1', x: 0, y: -30 }, { n: '2', x: 0, y: 30 }],
    prims: [C(0, 0, 20), L(0, -30, 0, -20), L(0, 20, 0, 30), PL(...cubic([-9, 0], [-5, -12], [-3, -12], [0, 0], 8), ...cubic([0, 0], [3, 12], [5, 12], [9, 0], 8).slice(1))] },
  IDC: { name: 'Fonte de corrente', cat: 'Fontes e terra', prefix: 'I', val: '1mA', pins: PV,
    prims: [C(0, 0, 20), L(0, -30, 0, -20), L(0, 20, 0, 30), L(0, 10, 0, -6), arrow(0, 10, 0, -10, 7)] },
  GND: { name: 'Terra (GND)', cat: 'Fontes e terra', prefix: '#GND', val: 'GND', power: true, pins: [{ n: 'GND', x: 0, y: 0 }],
    prims: [L(0, 0, 0, 10), L(-10, 10, 10, 10), L(-6, 14, 6, 14), L(-2, 18, 2, 18)] },

  SW: { name: 'Chave simples', cat: 'Chaves', prefix: 'SW', val: '', pins: P2, prims: [L(-30, 0, -14, 0), FC(-14, 0, 2.5), L(-14, 0, 10, -14), FC(14, 0, 2.5), L(14, 0, 30, 0)] },
  PB: { name: 'Botão (push button)', cat: 'Chaves', prefix: 'SW', val: '', pins: P2, prims: [L(-30, 0, -12, 0), FC(-12, 0, 2.5), L(12, 0, 30, 0), FC(12, 0, 2.5), L(-12, -7, 12, -7), L(0, -7, 0, -16), L(-8, -16, 8, -16)] },
  SPDT: { name: 'Chave inversora (SPDT)', cat: 'Chaves', prefix: 'SW', val: '', pins: [{ n: 'COM', x: -30, y: 0 }, { n: 'NO', x: 30, y: -10 }, { n: 'NC', x: 30, y: 10 }],
    prims: [L(-30, 0, -14, 0), FC(-14, 0, 2.5), L(-14, 0, 12, -8), FC(14, -10, 2.5), FC(14, 10, 2.5), L(14, -10, 30, -10), L(14, 10, 30, 10)] },

  MOTOR: { name: 'Motor', cat: 'Saídas e medidores', prefix: 'M', val: 'Motor', pins: [{ n: '1', x: 0, y: -30 }, { n: '2', x: 0, y: 30 }],
    prims: [C(0, 0, 20), L(0, -30, 0, -20), L(0, 20, 0, 30), T(0, 4, 'M', 14)] },
  LAMP: { name: 'Lâmpada', cat: 'Saídas e medidores', prefix: 'LA', val: '12V', pins: P2,
    prims: [C(0, 0, 12), L(-30, 0, -12, 0), L(12, 0, 30, 0), L(-8.5, -8.5, 8.5, 8.5), L(-8.5, 8.5, 8.5, -8.5)] },
  SPK: { name: 'Alto-falante', cat: 'Saídas e medidores', prefix: 'LS', val: '8Ω', pins: [{ n: '1', x: -30, y: -10 }, { n: '2', x: -30, y: 10 }],
    prims: [L(-30, -10, -14, -10), L(-30, 10, -14, 10), R(-14, -10, 10, 20), PG([-4, -10], [10, -20], [10, 20], [-4, 10])] },
  BUZZ: { name: 'Buzzer', cat: 'Saídas e medidores', prefix: 'BZ', val: 'Buzzer', pins: [{ n: '+', x: -30, y: 0 }, { n: '−', x: 30, y: 0 }],
    prims: [C(0, 0, 12), L(-30, 0, -12, 0), L(12, 0, 30, 0), T(-6, -3, '+', 9), A(0, 0, 6, -50, 50)] },
  VM: { name: 'Voltímetro', cat: 'Saídas e medidores', prefix: 'VM', val: '', pins: [{ n: '+', x: 0, y: -30 }, { n: '−', x: 0, y: 30 }],
    prims: [C(0, 0, 18), L(0, -30, 0, -18), L(0, 18, 0, 30), T(0, 5, 'V', 15)] },
  AM: { name: 'Amperímetro', cat: 'Saídas e medidores', prefix: 'AM', val: '', pins: [{ n: '+', x: 0, y: -30 }, { n: '−', x: 0, y: 30 }],
    prims: [C(0, 0, 18), L(0, -30, 0, -18), L(0, 18, 0, 30), T(0, 5, 'A', 15)] },

  NOT: { name: 'Porta NÃO (NOT)', cat: 'Lógica', prefix: 'U', val: '74HC04', pins: [{ n: 'A', x: -30, y: 0 }, { n: 'Y', x: 30, y: 0 }],
    prims: [PG([-12, -11], [-12, 11], [10, 0]), C(13, 0, 3), L(-30, 0, -12, 0), L(16, 0, 30, 0)] },
  AND: { name: 'Porta E (AND)', cat: 'Lógica', prefix: 'U', val: '74HC08', pins: [{ n: 'A', x: -30, y: -10 }, { n: 'B', x: -30, y: 10 }, { n: 'Y', x: 30, y: 0 }],
    prims: [PL([0, -15], [-20, -15], [-20, 15], [0, 15]), A(0, 0, 15, -90, 90), L(-30, -10, -20, -10), L(-30, 10, -20, 10), L(15, 0, 30, 0)] },
  NAND: { name: 'Porta NÃO-E (NAND)', cat: 'Lógica', prefix: 'U', val: '74HC00', pins: [{ n: 'A', x: -30, y: -10 }, { n: 'B', x: -30, y: 10 }, { n: 'Y', x: 30, y: 0 }],
    prims: [PL([0, -15], [-20, -15], [-20, 15], [0, 15]), A(0, 0, 15, -90, 90), C(18, 0, 3), L(-30, -10, -20, -10), L(-30, 10, -20, 10), L(21, 0, 30, 0)] },
  OR: { name: 'Porta OU (OR)', cat: 'Lógica', prefix: 'U', val: '74HC32', pins: [{ n: 'A', x: -30, y: -10 }, { n: 'B', x: -30, y: 10 }, { n: 'Y', x: 30, y: 0 }],
    prims: [PG(...cubic([-20, -15], [-5, -15], [8, -8], [18, 0]), ...cubic([18, 0], [8, 8], [-5, 15], [-20, 15]).slice(1), ...quad([-20, 15], [-12, 0], [-20, -15]).slice(1)), L(-30, -10, -17, -10), L(-30, 10, -17, 10), L(18, 0, 30, 0)] },
  NOR: { name: 'Porta NÃO-OU (NOR)', cat: 'Lógica', prefix: 'U', val: '74HC02', pins: [{ n: 'A', x: -30, y: -10 }, { n: 'B', x: -30, y: 10 }, { n: 'Y', x: 30, y: 0 }],
    prims: [PG(...cubic([-20, -15], [-5, -15], [8, -8], [18, 0]), ...cubic([18, 0], [8, 8], [-5, 15], [-20, 15]).slice(1), ...quad([-20, 15], [-12, 0], [-20, -15]).slice(1)), C(21, 0, 3), L(-30, -10, -17, -10), L(-30, 10, -17, 10), L(24, 0, 30, 0)] },
  XOR: { name: 'Porta OU-exclusivo (XOR)', cat: 'Lógica', prefix: 'U', val: '74HC86', pins: [{ n: 'A', x: -30, y: -10 }, { n: 'B', x: -30, y: 10 }, { n: 'Y', x: 30, y: 0 }],
    prims: [PG(...cubic([-20, -15], [-5, -15], [8, -8], [18, 0]), ...cubic([18, 0], [8, 8], [-5, 15], [-20, 15]).slice(1), ...quad([-20, 15], [-12, 0], [-20, -15]).slice(1)), PL(...quad([-25, 15], [-17, 0], [-25, -15])), L(-30, -10, -22, -10), L(-30, 10, -22, 10), L(18, 0, 30, 0)] },
};

// ---------- símbolos que dependem das propriedades da peça ----------
const DEFAULT_IC = ['1', '2', '3', '4', '5', '6', '7', '8'];
function buildIC(part) {
  const names = part.pins && part.pins.length ? part.pins : DEFAULT_IC;
  const n = names.length, rows = Math.ceil(n / 2);
  const left = names.slice(0, rows), right = names.slice(rows);
  const mL = Math.max(0, ...left.map((s) => s.length)), mR = Math.max(0, ...right.map((s) => s.length));
  const half = Math.max(30, Math.ceil(((mL + mR) * 5.6 + 18) / 2 / 10) * 10);
  const pins = [], prims = [R(-half, -rows * 10, 2 * half, rows * 20)];
  const ly = (i) => -(rows - 1) * 10 + i * 20, ry = (j) => (rows - 1) * 10 - j * 20;
  left.forEach((s, i) => { const y = ly(i); pins.push({ n: s, num: String(i + 1), x: -(half + 20), y }); prims.push(L(-(half + 20), y, -half, y), T(-half + 4, y + 3, s, 9, 'start'), T(-(half + 12), y - 3, String(i + 1), 7)); });
  right.forEach((s, j) => { const y = ry(j), num = String(rows + 1 + j); pins.push({ n: s, num, x: half + 20, y }); prims.push(L(half, y, half + 20, y), T(half - 4, y + 3, s, 9, 'end'), T(half + 12, y - 3, num, 7)); });
  return { name: 'Circuito integrado', prefix: 'U', pins, prims };
}
function buildHDR(part) {
  const names = part.pins && part.pins.length ? part.pins : ['1', '2', '3', '4'];
  const n = names.length, mx = Math.max(1, ...names.map((s) => s.length));
  const w = Math.max(20, Math.ceil((mx * 5.6 + 12) / 10) * 10);
  const pins = [], prims = [R(-10, -n * 10, w, n * 20)];
  names.forEach((s, i) => { const y = -(n - 1) * 10 + i * 20; pins.push({ n: s, num: String(i + 1), x: -30, y }); prims.push(L(-30, y, -10, y), FC(-10, y, 2), T(-5, y + 3, s, 9, 'start'), T(-20, y - 3, String(i + 1), 7)); });
  return { name: 'Conector / módulo', prefix: 'J', pins, prims };
}
function buildNET(part) {
  const s = part.val || 'NET', w = Math.max(10, s.length * 6);
  return { name: 'Rótulo de ligação', prefix: '#NET', power: true, pins: [{ n: s, x: 0, y: 0 }], prims: [PG([0, 0], [7, -8], [14 + w, -8], [14 + w, 8], [7, 8]), T(10, 3, s, 9, 'start')] };
}
function buildVCC(part) {
  const s = part.val || '+5V';
  return { name: 'Alimentação', prefix: '#PWR', power: true, pins: [{ n: s, x: 0, y: 0 }], prims: [L(0, 0, 0, -12), L(-7, -12, 7, -12), T(0, -17, s, 10)] };
}

/** Peças que podem ser colocadas pela paleta, agrupadas por categoria. */
export const LIBRARY = [
  ...Object.entries(FIXED).map(([id, s]) => ({ id, t: id, name: s.name, cat: s.cat, prefix: s.prefix, val: s.val })),
  { id: 'VCC', t: 'VCC', name: 'Alimentação (+5V, +12V…)', cat: 'Fontes e terra', prefix: '#PWR', val: '+5V' },
  { id: 'NET', t: 'NET', name: 'Rótulo de ligação (nome)', cat: 'Fontes e terra', prefix: '#NET', val: 'SINAL' },
  { id: 'IC', t: 'IC', name: 'Circuito integrado (pinos editáveis)', cat: 'CIs e módulos', prefix: 'U', val: 'CI', pins: DEFAULT_IC },
  { id: '555', t: 'IC', name: 'Temporizador 555', cat: 'CIs e módulos', prefix: 'U', val: 'NE555', pins: ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THR', 'DIS', 'VCC'], fp: 'DIP-8' },
  { id: '7805', t: 'IC', name: 'Regulador 7805', cat: 'CIs e módulos', prefix: 'U', val: '7805', pins: ['IN', 'GND', 'OUT'] },
  { id: 'LM358', t: 'IC', name: 'LM358 (2 amplificadores operacionais)', cat: 'CIs e módulos', prefix: 'U', val: 'LM358', pins: ['OUT1', 'IN1−', 'IN1+', 'GND', 'IN2+', 'IN2−', 'OUT2', 'VCC'], fp: 'DIP-8' },
  { id: 'L293D', t: 'IC', name: 'L293D (ponte H para 2 motores)', cat: 'CIs e módulos', prefix: 'U', val: 'L293D', pins: ['EN1,2', '1A', '1Y', 'GND', 'GND', '2Y', '2A', 'VS', 'EN3,4', '3A', '3Y', 'GND', 'GND', '4Y', '4A', 'VSS'], fp: 'DIP-16' },
  { id: 'ULN2003', t: 'IC', name: 'ULN2003 (7 drivers para bobinas/relés)', cat: 'CIs e módulos', prefix: 'U', val: 'ULN2003', pins: ['1B', '2B', '3B', '4B', '5B', '6B', '7B', 'GND', 'COM', '7C', '6C', '5C', '4C', '3C', '2C', '1C'], fp: 'DIP-16' },
  { id: '74HC595', t: 'IC', name: '74HC595 (registrador de deslocamento)', cat: 'CIs e módulos', prefix: 'U', val: '74HC595', pins: ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', 'QH\'', 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'], fp: 'DIP-16' },
  { id: 'HDR', t: 'HDR', name: 'Módulo / conector (pinos editáveis)', cat: 'CIs e módulos', prefix: 'J', val: 'Conector', pins: ['1', '2', '3', '4'] },
  { id: 'HDR2', t: 'HDR', name: 'Conector de 2 pinos', cat: 'CIs e módulos', prefix: 'J', val: 'Conn', pins: ['1', '2'] },

  // ---- chips e placas para projetos maker (pinagem conferida em datasheets; confira a sua placa antes de fabricar) ----
  { id: 'ATMEGA328P', t: 'IC', name: 'ATmega328P (DIP-28, o do Arduino Uno)', cat: 'Microcontroladores', prefix: 'U', val: 'ATmega328P',
    pins: ['PC6/RESET', 'PD0/RXD', 'PD1/TXD', 'PD2/INT0', 'PD3/INT1', 'PD4', 'VCC', 'GND', 'PB6/XTAL1', 'PB7/XTAL2', 'PD5', 'PD6', 'PD7', 'PB0', 'PB1', 'PB2/SS', 'PB3/MOSI', 'PB4/MISO', 'PB5/SCK', 'AVCC', 'AREF', 'GND', 'PC0/A0', 'PC1/A1', 'PC2/A2', 'PC3/A3', 'PC4/SDA', 'PC5/SCL'], fp: 'DIP-28' },
  { id: 'ATMEGA328AU', t: 'IC', name: 'ATmega328P (TQFP-32, SMD)', cat: 'Microcontroladores', prefix: 'U', val: 'ATmega328P-AU',
    pins: ['PD3', 'PD4', 'GND', 'VCC', 'GND', 'VCC', 'PB6/XTAL1', 'PB7/XTAL2', 'PD5', 'PD6', 'PD7', 'PB0', 'PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'AVCC', 'ADC6', 'AREF', 'GND', 'ADC7', 'PC0', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6/RESET', 'PD0', 'PD1', 'PD2'], fp: 'QFP-32' },
  { id: 'ATTINY85', t: 'IC', name: 'ATtiny85 (DIP-8)', cat: 'Microcontroladores', prefix: 'U', val: 'ATtiny85', pins: ['PB5/RESET', 'PB3', 'PB4', 'GND', 'PB0/MOSI', 'PB1/MISO', 'PB2/SCK', 'VCC'], fp: 'DIP-8' },
  { id: 'ESP32DEV', t: 'IC', name: 'ESP32 DevKit (30 pinos)', cat: 'Microcontroladores', prefix: 'U', val: 'ESP32 DevKit',
    pins: [...['EN', 'GPIO36(VP)', 'GPIO39(VN)', 'GPIO34', 'GPIO35', 'GPIO32', 'GPIO33', 'GPIO25', 'GPIO26', 'GPIO27', 'GPIO14', 'GPIO12', 'GPIO13', 'GND', 'VIN'],
      ...['GPIO23', 'GPIO22', 'GPIO1(TX0)', 'GPIO3(RX0)', 'GPIO21', 'GPIO19', 'GPIO18', 'GPIO5', 'GPIO17(TX2)', 'GPIO16(RX2)', 'GPIO4', 'GPIO2', 'GPIO15', 'GND', '3V3'].reverse()], fp: 'DUAL-15-2.54-22.86' },
  { id: 'NANO', t: 'IC', name: 'Arduino Nano (30 pinos)', cat: 'Microcontroladores', prefix: 'U', val: 'Arduino Nano',
    pins: [...['D1/TX', 'D0/RX', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'],
      ...['VIN', 'GND', 'RST', '5V', 'A7', 'A6', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0', 'AREF', '3V3', 'D13'].reverse()], fp: 'DUAL-15-2.54-15.24' },
  { id: 'PICO', t: 'IC', name: 'Raspberry Pi Pico (40 pinos)', cat: 'Microcontroladores', prefix: 'U', val: 'Pico',
    pins: [...['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'],
      ...['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'].reverse()], fp: 'DUAL-20-2.54-17.78' },
  { id: 'CH340G', t: 'IC', name: 'CH340G (USB-serial, SOIC-16)', cat: 'Microcontroladores', prefix: 'U', val: 'CH340G', pins: ['GND', 'TXD', 'RXD', 'V3', 'UD+', 'UD−', 'XI', 'XO', 'CTS', 'DSR', 'RI', 'DCD', 'DTR', 'RTS', 'R232', 'VCC'], fp: 'SOIC-16' },
];
export const CATEGORIES = [];
const CUSTOM_KEY = 'atelie_custom_parts_v1';
function refreshCategories() { CATEGORIES.length = 0; CATEGORIES.push(...new Set(LIBRARY.map((l) => l.cat))); }

// ---------- "Minhas peças": chips e módulos criados pela pessoa (ficam neste navegador) ----------
export const CUSTOM_CAT = 'Minhas peças';
export function loadCustomParts() {
  let list = [];
  try { const r = JSON.parse(localStorage.getItem(CUSTOM_KEY)); if (Array.isArray(r)) list = r; } catch {}
  for (let i = LIBRARY.length - 1; i >= 0; i--) if (LIBRARY[i].cat === CUSTOM_CAT) LIBRARY.splice(i, 1);
  for (const c of list.slice(0, 200)) {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.pins) || !c.pins.length) continue;
    LIBRARY.push({ id: c.id, t: 'IC', name: String(c.name || 'Peça').slice(0, 60), cat: CUSTOM_CAT, prefix: String(c.prefix || 'U').slice(0, 4), val: String(c.name || '').slice(0, 40), pins: c.pins.slice(0, 64).map((s) => String(s).slice(0, 20)), fp: c.fp || undefined, custom: true });
  }
  refreshCategories();
  return LIBRARY.filter((l) => l.custom);
}
function saveCustom() {
  const list = LIBRARY.filter((l) => l.custom).map((l) => ({ id: l.id, name: l.val, prefix: l.prefix, pins: l.pins, fp: l.fp || '' }));
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch {}
}
export function addCustomPart({ name, prefix, pins, fp }) {
  const id = 'C' + Math.random().toString(36).slice(2, 9);
  LIBRARY.push({ id, t: 'IC', name: name || 'Peça', cat: CUSTOM_CAT, prefix: prefix || 'U', val: name || '', pins, fp: fp || undefined, custom: true });
  saveCustom(); refreshCategories(); return id;
}
export function removeCustomPart(id) {
  const i = LIBRARY.findIndex((l) => l.id === id && l.custom); if (i < 0) return;
  LIBRARY.splice(i, 1); saveCustom(); refreshCategories();
}
refreshCategories();

const BUILDERS = { IC: buildIC, HDR: buildHDR, NET: buildNET, VCC: buildVCC };
export const symbolName = (t) => (FIXED[t] ? FIXED[t].name : BUILDERS[t] ? BUILDERS[t]({}).name : t);
export const isPower = (t) => t === 'GND' || t === 'VCC' || t === 'NET';
export const hasEditablePins = (t) => t === 'IC' || t === 'HDR';

const cache = new Map();
/** Geometria local de uma peça: { pins, prims, box:{x0,y0,x1,y1} }. */
export function symbolFor(part) {
  const t = part.t;
  const dyn = BUILDERS[t];
  const key = dyn ? t + '|' + (part.val || '') + '|' + (part.pins || []).join('\u0001') : t;
  let s = cache.get(key);
  if (s) return s;
  const base = dyn ? dyn(part) : FIXED[t];
  if (!base) { s = { pins: [{ n: '1', x: -10, y: 0 }, { n: '2', x: 10, y: 0 }], prims: [R(-10, -6, 20, 12), T(0, 3, '?', 10)], box: { x0: -10, y0: -6, x1: 10, y1: 6 }, unknown: true }; cache.set(key, s); return s; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  base.pins.forEach((p) => add(p.x, p.y));
  for (const p of base.prims) {
    if (p[0] === 'pl' || p[0] === 'pg' || p[0] === 'fp') p[1].forEach(([x, y]) => add(x, y));
    else if (p[0] === 'c' || p[0] === 'fc') { add(p[1] - p[3], p[2] - p[3]); add(p[1] + p[3], p[2] + p[3]); }
  }
  s = { ...base, box: { x0, y0, x1, y1 } };
  if (cache.size > 300) cache.clear();
  cache.set(key, s); return s;
}

/** Transformação local → mundo: espelha (se m), gira r quartos de volta no sentido horário e move para (x,y). */
export function xf(part, px, py) {
  if (part.m) px = -px;
  let x = px, y = py;
  switch (((part.r % 4) + 4) % 4) { case 1: x = -py; y = px; break; case 2: x = -px; y = -py; break; case 3: x = py; y = -px; break; default: }
  return [x + part.x, y + part.y];
}
export function pinsOf(part) {
  return symbolFor(part).pins.map((p) => { const [x, y] = xf(part, p.x, p.y); return { n: p.n, num: p.num, x, y }; });
}
export function partBox(part) {
  const { box } = symbolFor(part);
  const c = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(([x, y]) => xf(part, x, y));
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
/** Onde escrever o nome (ref) e o valor da peça, sempre na horizontal. */
export function labelSpots(part) {
  const b = partBox(part), w = b.x1 - b.x0, h = b.y1 - b.y0, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  if (w >= h * 0.9) return { ref: { x: cx, y: b.y0 - 6, align: 'middle' }, val: { x: cx, y: b.y1 + 13, align: 'middle' } };
  return { ref: { x: b.x1 + 8, y: cy - 3, align: 'start' }, val: { x: b.x1 + 8, y: cy + 11, align: 'start' } };
}

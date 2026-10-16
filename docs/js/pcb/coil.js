// Gerador de bobinas em placa (espirais de cobre) e de estatores de motor em anel.
// Tudo em milímetros, y para baixo (como a placa). Funções puras: devolvem listas de trilhas/vias/pads,
// quem coloca na placa é Board.addCopper().
//
// Ideia: uma espiral sobre um polígono convexo qualquer. A trilha n corre ao longo da aresta (n mod m),
// deslocada para dentro em n·p/m (p = passo = largura + espaço). Assim o espaçamento entre voltas é sempre p,
// seja o polígono um círculo (muitos lados), quadrado, hexágono ou um setor de motor.
// Com 2 camadas, a frente entra em espiral até o centro, uma via troca de camada e o verso volta para fora
// girando para o MESMO lado (os campos se somam).

const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const r3 = (v) => Math.round(v * 1000) / 1000;
const pt = (p) => [r3(p[0]), r3(p[1])];
const area2 = (poly) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);

export const SHAPES = { circle: { m: 48, label: 'Redonda', K: [2.25, 3.55] }, square: { m: 4, label: 'Quadrada', K: [2.34, 2.75] }, hex: { m: 6, label: 'Hexagonal', K: [2.33, 3.82] }, oct: { m: 8, label: 'Octogonal', K: [2.25, 3.55] } };
const RHO_CU = 1.72e-8, T_CU = 35e-6; // cobre de 1 oz (35 µm)

/** Polígono regular com m lados e raio R (vértice 0 no ângulo `rot`). Orientação: horária na tela (y para baixo). */
export function regularPoly(m, R, cx, cy, rot = -Math.PI / 2) {
  return Array.from({ length: m }, (_, i) => { const a = rot + (i * 2 * Math.PI) / m; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
}
/** Setor de anel (formato de uma bobina de estator). Vértices: A (fora, esquerda), Mo, B (fora, direita), C, Mi, D.
 *  O ângulo cresce no sentido horário na tela. a0 < a1 em radianos. */
export function wedgePoly(Ri, Ro, a0, a1, cx = 0, cy = 0) {
  const P = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)], am = (a0 + a1) / 2, D = a1 - a0;
  const C = P(Ri, a1), Dd = P(Ri, a0), chord = len(sub(C, Dd));
  // borda interna: um "V" suave apontando para o centro (mantém o polígono convexo); a externa acompanha o arco
  const eps = Math.max(0.12, D / 6), h = (chord / 2) * Math.tan(eps / 2), mid = P(Ri * Math.cos(D / 2) - h, am);
  return { A: P(Ro, a0), Mo: P(Ro, am), B: P(Ro, a1), C, Mi: mid, D: Dd, apex: len(sub(mid, [cx, cy])) };
}

/** Raio do maior círculo que cabe dentro do polígono convexo (aproximado por amostragem). */
export function inradius(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const so = Math.sign(area2(poly)) || 1; let best = 0;
  const dist = (x, y) => { let d = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], u = unit(sub(b, a)); const n = [-u[1] * so, u[0] * so]; d = Math.min(d, (x - a[0]) * n[0] + (y - a[1]) * n[1]); } return d; };
  const S = 48;
  for (let i = 0; i <= S; i++) for (let j = 0; j <= S; j++) best = Math.max(best, dist(x0 + ((x1 - x0) * i) / S, y0 + ((y1 - y0) * j) / S));
  return best;
}

/** Número de lados N (≈ voltas × m) para o fim do verso cair no vértice `targetIdx` (2N ≡ target mod m). */
function chooseSides(m, wantSides, targetIdx, maxSides = Infinity) {
  const half = m / 2, base = (targetIdx + 2) / 2; // o verso termina no vértice (2N − 2) mod m  →  2N − 2 ≡ alvo
  let k = Math.round((wantSides - base) / half);
  if (base + half * k > maxSides) k = Math.floor((maxSides - base) / half);
  let N = base + half * k;
  while (N < 3) { k++; N = base + half * k; }
  return N;
}

/**
 * Espiral sobre `poly` (vértices em ordem; o vértice 0 é o começo da trilha da frente).
 * opts: { turns, w, space, layers:1|2, targetIdx? }
 * Devolve { front, back, N, E, start, end, turns, clamped, rho }: listas de pontos [x,y].
 */
export function spiral(poly, { turns = 5, w = 0.25, space = 0.25, layers = 2, targetIdx = null } = {}) {
  const m = poly.length, p = w + space, so = Math.sign(area2(poly)) || 1;
  const edge = (i) => { const a = poly[((i % m) + m) % m], b = poly[(((i + 1) % m) + m) % m], u = unit(sub(b, a)); return { a, u, n: [-u[1] * so, u[0] * so] }; };
  const line = (i, d) => { const e = edge(i); return { p: add(e.a, mul(e.n, d)), u: e.u }; };
  const hit = (L1, L2) => { const den = cross(L1.u, L2.u); if (Math.abs(den) < 1e-9) return L1.p; const t = cross(sub(L2.p, L1.p), L2.u) / den; return add(L1.p, mul(L1.u, t)); };
  const rho = inradius(poly);
  let tIdx = targetIdx;
  if (tIdx == null) { tIdx = Math.round(m / 2); if (tIdx % 2) tIdx += tIdx + 1 <= m ? 1 : -1; tIdx %= m; }
  tIdx = ((tIdx % m) + m) % m; if (tIdx % 2) tIdx = (tIdx + 1) % m; // o fim só cai em vértices de índice par
  const maxSides = Math.floor(((rho - w * 1.5) * m) / p);
  let N = layers === 2 ? chooseSides(m, turns * m, tIdx, maxSides) : Math.max(1, Math.min(maxSides, Math.round(turns * m)));
  const clamped = (layers === 2 ? turns * m : Math.round(turns * m)) > N + m / 2;
  const front = [poly[0]];
  for (let n = 0; n < N; n++) front.push(hit(line(n, (n * p) / m), line(n + 1, ((n + 1) * p) / m)));
  const E = front[front.length - 1];
  let back = null, end = null;
  if (layers === 2) {
    // o verso sai de E e gira para o mesmo lado, afastando-se. O deslocamento cai p/m por lado, com um "salto" extra de 2·p/m
    // depois do primeiro lado, para que a volta seguinte passe a um passo inteiro (p) do ponto E, e não a meio passo.
    const J = N - 2, off = (j) => (j === 0 ? N : N - j - 2);
    back = [E];
    for (let j = 0; j < J; j++) back.push(hit(line(N + j, (off(j) * p) / m), line(N + j + 1, (off(j + 1) * p) / m)));
    end = back[back.length - 1];
  }
  return { front, back, N, E, start: poly[0], end, turns: N / m, clamped, rho, m };
}

const polyLen = (pts) => pts.reduce((s, q, i) => (i ? s + len(sub(q, pts[i - 1])) : 0), 0);

/** Estimativas elétricas (aproximadas) de uma espiral. */
export function estimate({ lenMm, w, turns, dout, din, shape, layers }) {
  const R = (RHO_CU * (lenMm * 1e-3)) / (w * 1e-3 * T_CU);
  const wm = (w / 25.4) * 1000, A = wm * 1.378, Imax = 0.048 * Math.pow(10, 0.44) * Math.pow(A, 0.725); // IPC-2221, externa, ΔT 10 °C
  let L1 = null, L = null;
  const S = SHAPES[shape];
  if (S && dout && din != null && din < dout) {
    const dav = ((dout + din) / 2) * 1e-3, rho = (dout - din) / (dout + din), n = turns;
    L1 = (S.K[0] * 4e-7 * Math.PI * n * n * dav) / (1 + S.K[1] * rho) * 1e6; // µH
    L = layers === 2 ? L1 * 2 * (1 + 0.6) : L1; // 2 camadas em série, acoplamento ≈ 0,6 (depende da espessura da placa)
  }
  return { R, Imax, L };
}

/**
 * Bobina espiral solta. cfg: { cx, cy, shape, size (largura total, mm), turns, w, space, layers, dir:'cw'|'ccw', viaD, viaH, padD, padH, leadLen }
 * Devolve { tracks:[{l,w,a,b}], vias:[{x,y,d,h}], pads:[{x,y}], info }.
 */
/** Espaço mínimo entre voltas para a via do centro não encostar nas voltas vizinhas. */
export const minSpaceForVia = (w, viaD, clear = 0.2) => Math.ceil((viaD / 2 + clear - w / 2) * 100) / 100;

export function buildSpiral(cfg) {
  const { cx, cy, shape = 'circle', size = 20, turns = 6, w = 0.25, layers = 2, dir = 'cw', viaD = 0.7, viaH = 0.35, leadLen = 2.4, clear = 0.2 } = cfg;
  const space = Math.max(cfg.space ?? 0.25, minSpaceForVia(w, viaD, clear)), spaceAdj = space > (cfg.space ?? 0.25) + 1e-9;
  const S = SHAPES[shape] || SHAPES.circle, m = S.m, R = size / 2 / Math.cos(Math.PI / m);
  // vértice 0 em cima (para a quadrada ficar com lados retos: gira meia volta de lado)
  let poly = regularPoly(m, R, cx, cy, -Math.PI / 2 - Math.PI / m);
  const visualCW = area2(poly) > 0; // y para baixo: área positiva = horário na tela
  if ((dir === 'cw') !== visualCW) poly = [poly[0], ...poly.slice(1).reverse()];
  const sp = spiral(poly, { turns, w, space, layers });
  const tracks = [], vias = [], pads = [];
  const polyline = (pts, l) => { for (let i = 1; i < pts.length; i++) if (len(sub(pts[i], pts[i - 1])) > 1e-4) tracks.push({ l, w, a: pt(pts[i - 1]), b: pt(pts[i]) }); };
  polyline(sp.front, 'F');
  const out = (P) => add(P, mul(unit(sub(P, [cx, cy])), leadLen));
  const padS = out(sp.start); polyline([sp.start, padS], 'F'); pads.push({ x: r3(padS[0]), y: r3(padS[1]), which: 'start' });
  let endPoint;
  if (layers === 2) {
    polyline(sp.back, 'B'); vias.push({ x: r3(sp.E[0]), y: r3(sp.E[1]), d: viaD, h: viaH });
    endPoint = sp.end; const padE = out(endPoint); polyline([endPoint, padE], 'B'); pads.push({ x: r3(padE[0]), y: r3(padE[1]), which: 'end' });
  } else {
    // 1 camada: o fim do centro sai por baixo (ponte no verso) até a borda
    vias.push({ x: r3(sp.E[0]), y: r3(sp.E[1]), d: viaD, h: viaH });
    const dirOut = unit(sub(sp.start, [cx, cy])), far = add([cx, cy], mul(dirOut, -R - leadLen)); // sai do lado oposto ao começo
    const padE = far; polyline([sp.E, padE], 'B'); pads.push({ x: r3(padE[0]), y: r3(padE[1]), which: 'end' });
  }
  const lenMm = polyLen(sp.front) + (sp.back ? polyLen(sp.back) : 0);
  const din = Math.max(0, size - 2 * (sp.N / m) * (w + space)); // largura livre no meio
  const est = estimate({ lenMm, w, turns: sp.turns, dout: size, din, shape, layers });
  return { tracks, vias, pads, info: { turns: sp.turns, sides: sp.N, clamped: sp.clamped, space, spaceAdj, lenMm, din, ...est, box: { x0: cx - size / 2 - leadLen - 2, y0: cy - size / 2 - leadLen - 2, x1: cx + size / 2 + leadLen + 2, y1: cy + size / 2 + leadLen + 2 } } };
}

/**
 * Estator de motor em anel: `count` bobinas em setor (2 camadas), enroladas para o mesmo lado e ligadas em série
 * com o sentido alternando (N-S-N-S), por arcos na borda. cfg: { cx, cy, count, dout, din, turns, w, space, gap, viaD, viaH, series }
 */
export function buildStator(cfg) {
  const { cx, cy, count = 6, dout = 60, din = 20, turns = 6, w = 0.25, gap = 2, viaD = 0.7, viaH = 0.35, series = true, dir = 'cw', clear = 0.2 } = cfg;
  const space = Math.max(cfg.space ?? 0.25, minSpaceForVia(w, viaD, clear)), spaceAdj = space > (cfg.space ?? 0.25) + 1e-9;
  const Ro = dout / 2, Ri = din / 2, tracks = [], vias = [], pads = [];
  const polar = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const step = (2 * Math.PI) / count, halfGap = Math.asin(Math.min(0.9, gap / 2 / Ro)), beta = step / 2 - halfGap;
  const polyline = (pts, l) => { for (let i = 1; i < pts.length; i++) if (len(sub(pts[i], pts[i - 1])) > 1e-4) tracks.push({ l, w, a: pt(pts[i - 1]), b: pt(pts[i]) }); };
  const arc = (r, a0, a1, l) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (6 * Math.PI / 180))); polyline(Array.from({ length: n + 1 }, (_, i) => polar(r, a0 + ((a1 - a0) * i) / n)), l); };
  const rV = Ro + 0.9 + viaD / 2 - 0.4, rArc = Ro + 2.2 + viaD / 2, rPad = Ro + 3.8 + viaD / 2;
  const coils = []; let info = null, apexMin = Ri;
  for (let i = 0; i < count; i++) {
    const th = i * step - Math.PI / 2, W = wedgePoly(Ri, Ro, th - beta, th + beta, cx, cy); apexMin = Math.min(apexMin, W.apex);
    // ordem dos vértices: horário na tela (ângulo crescendo) começa em A e termina em B; anti-horário: A, D, Mi, C, B, Mo
    const cw = [W.A, W.Mo, W.B, W.C, W.Mi, W.D], ccw = [W.A, W.D, W.Mi, W.C, W.B, W.Mo];
    const poly = dir === 'cw' ? cw : ccw, tIdx = dir === 'cw' ? 2 : 4;
    const sp = spiral(poly, { turns, w, space, layers: 2, targetIdx: tIdx });
    polyline(sp.front, 'F'); polyline(sp.back, 'B'); vias.push({ x: r3(sp.E[0]), y: r3(sp.E[1]), d: viaD, h: viaH });
    const aA = th - beta, aB = th + beta;
    coils.push({ aA, aB, sp }); info = info || { turns: sp.turns, sides: sp.N, clamped: sp.clamped, rho: sp.rho };
    // saídas radiais: começo (frente) e fim (verso)
    const radial = (P, r) => { const a = Math.atan2(P[1] - cy, P[0] - cx); return polar(r, a); };
    const Sv = radial(sp.start, rV), Tv = radial(sp.end, rV);
    polyline([sp.start, Sv], 'F'); polyline([sp.end, Tv], 'B');
    vias.push({ x: r3(Sv[0]), y: r3(Sv[1]), d: viaD, h: viaH }); vias.push({ x: r3(Tv[0]), y: r3(Tv[1]), d: viaD, h: viaH });
    coils[i].Sv = Sv; coils[i].Tv = Tv; coils[i].aS = Math.atan2(sp.start[1] - cy, sp.start[0] - cx); coils[i].aT = Math.atan2(sp.end[1] - cy, sp.end[0] - cx);
  }
  const wrap = (a, ref) => { while (a - ref > Math.PI) a -= 2 * Math.PI; while (a - ref < -Math.PI) a += 2 * Math.PI; return a; };
  if (series && count >= 2 && count % 2 === 0) {
    // pares (T0–T1), (S1–S2), (T2–T3)… ; sobram S0 e S(n-1) como terminais da bobina inteira
    for (let i = 0; i + 1 < count; i++) {
      if (i % 2 === 0) { // fim–fim: frente, arco por fora
        const a = coils[i], b = coils[i + 1], a0 = a.aT, a1 = wrap(b.aT, a0);
        polyline([a.Tv, polar(rArc, a0)], 'F'); arc(rArc, a0, a1, 'F'); polyline([polar(rArc, a1), b.Tv], 'F');
      } else { // começo–começo: verso, arco por fora
        const a = coils[i], b = coils[i + 1], a0 = a.aS, a1 = wrap(b.aS, a0);
        polyline([a.Sv, polar(rArc, a0)], 'B'); arc(rArc, a0, a1, 'B'); polyline([polar(rArc, a1), b.Sv], 'B');
      }
    }
    for (const i of [0, count - 1]) { const c = coils[i], P = polar(rPad, c.aS); polyline([c.Sv, P], 'B'); pads.push({ x: r3(P[0]), y: r3(P[1]), which: i === 0 ? 'start' : 'end' }); }
  } else {
    // bobinas soltas: duas saídas por bobina, sem ligação entre elas
    for (const c of coils) for (const which of ['S', 'T']) {
      const V = which === 'S' ? c.Sv : c.Tv, P = polar(rPad, which === 'S' ? c.aS : c.aT);
      polyline([V, P], which === 'S' ? 'B' : 'F'); pads.push({ x: r3(P[0]), y: r3(P[1]), which });
    }
  }
  const one = coils[0].sp, lenOne = polyLen(one.front) + polyLen(one.back);
  const est = estimate({ lenMm: lenOne * (series ? count : 1), w, turns: one.turns, dout: null, din: null, shape: null, layers: 2 });
  return { tracks, vias, pads, info: { ...info, space, spaceAdj, count, lenOne, lenMm: lenOne * (series ? count : 1), R: est.R, Imax: est.Imax, box: { x0: cx - Ro - 6, y0: cy - Ro - 6, x1: cx + Ro + 6, y1: cy + Ro + 6 }, holeD: Math.max(0, 2 * (apexMin - 1.6)) } };
}

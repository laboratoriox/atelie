// Impressão e saída para fabricação da placa: arte em preto e branco (PDF, SVG, PNG, impressora)
// e arquivos Gerber + furação (Excellon) em .zip. Tudo em milímetros, y para baixo (como a placa).
import { getFootprint } from './footprints.js';
import { fpPoint } from './board.js';
import { canvasOut, svgOut } from '../circuit/render.js';

const r3 = (v) => Math.round(v * 1000) / 1000;
const slug = (s) => (String(s || 'placa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'placa');
export const fabSlug = slug;

// ---------- utilidades binárias ----------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes, start = 0, end = bytes.length) { let c = 0xffffffff; for (let i = start; i < end; i++) c = CRC_T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const enc = new TextEncoder();
const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

/** .zip sem compressão. files: [{name, data: string|Uint8Array}] */
export function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  const date = 0x5821, time = 0; // 2024-01-01 00:00
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
    const head = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/** Põe o tamanho real (pontos por polegada) num PNG, para os programas de impressão respeitarem os milímetros. */
export async function pngWithDpi(blob, dpi) {
  const buf = new Uint8Array(await blob.arrayBuffer()), ppm = Math.round(dpi / 0.0254);
  const body = new Uint8Array([0x70, 0x48, 0x59, 0x73, ...[ppm >>> 24, ppm >>> 16, ppm >>> 8, ppm].map((v) => v & 255), ...[ppm >>> 24, ppm >>> 16, ppm >>> 8, ppm].map((v) => v & 255), 1]);
  const chunk = new Uint8Array([0, 0, 0, 9, ...body, ...u32(crc32(body)).reverse()]);
  const at = 8 + 25; // assinatura (8) + IHDR (25)
  return new Blob([buf.slice(0, at), chunk, buf.slice(at)], { type: 'image/png' });
}

export function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- arte para impressão ----------
/** Retângulo da folha de arte: placa + margem para marcas e régua. */
export function fabBox(board, margin = 7) {
  const b = board.outlineBox();
  return { x0: b.x0 - margin, y0: b.y0 - margin, x1: b.x1 + margin, y1: b.y1 + margin + 5, bx: b };
}

/**
 * Desenha a arte de UMA folha. opt: { layer:'F'|'B'|'silkF'|'silkB', mirror, invert, outline, dots, marks, ruler }
 * (preto sobre branco; com invert vira branco sobre preto).
 */
export function paintFab(out0, board, an, opt) {
  const { layer = 'F', mirror = false, invert = false, outline = true, dots = true, marks = true, ruler = true } = opt;
  const box = fabBox(board), fg = invert ? '#fff' : '#000', bg = invert ? '#000' : '#fff', X = box.x0 + box.x1;
  const fx = ([x, y]) => (mirror ? [X - x, y] : [x, y]);
  const out = {
    poly: (pts, o) => out0.poly(pts.map(fx), o), circle: (x, y, r, o) => { const [mx, my] = fx([x, y]); out0.circle(mx, my, r, o); },
    alpha: () => out0.alpha(1),
  };
  out.alpha();
  out.poly([[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]], { fill: bg, closed: true, width: 0.01 });
  const L = layer === 'F' || layer === 'B' ? layer : null;
  if (L) {
    for (const t of board.tracks) if (t.l === L) out.poly([t.a, t.b], { stroke: fg, width: t.w });
    for (const o of an.objs) if (o.kind === 'pad' && o.layers.includes(L)) {
      const s = o.shape;
      if (s.k === 'poly') out.poly(s.pts, { fill: fg, closed: true, width: 0.01 });
      else if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) out.circle(s.a[0], s.a[1], s.r, { fill: fg, width: 0.01 });
      else out.poly([s.a, s.b], { stroke: fg, width: s.r * 2 });
    }
    for (const v of board.vias) out.circle(v.x, v.y, v.d / 2, { fill: fg, width: 0.01 });
    if (dots) { // um pontinho no centro de cada furo, para guiar a broca
      for (const o of an.objs) if (o.kind === 'pad' && o.drill) out.circle(o.c[0], o.c[1], Math.min(0.25, o.drill / 2), { fill: bg, width: 0.01 });
      for (const v of board.vias) out.circle(v.x, v.y, Math.min(0.2, v.h / 2), { fill: bg, width: 0.01 });
    }
  } else {
    const wantB = layer === 'silkB';
    for (const f of board.fps) {
      if (!!f.b !== wantB) continue; const fp = getFootprint(f.fp); if (!fp) continue;
      for (const s of fp.silk) {
        if (s[0] === 'l') out.poly(s[1].map(([x, y]) => fpPoint(f, x, y)), { stroke: fg, width: 0.18 });
        else { const [cx, cy] = fpPoint(f, s[1], s[2]); out.circle(cx, cy, s[3], { stroke: fg, width: 0.18 }); }
      }
    }
  }
  if (outline) out.poly(board.outline, { stroke: fg, width: 0.15, closed: true });
  const b = box.bx;
  if (marks) { // cruzes de alinhamento nos 4 cantos (as duas faces têm as mesmas posições)
    for (const [x, y] of [[b.x0 - 3.5, b.y0 - 3.5], [b.x1 + 3.5, b.y0 - 3.5], [b.x0 - 3.5, b.y1 + 3.5], [b.x1 + 3.5, b.y1 + 3.5]]) {
      out.poly([[x - 1.8, y], [x + 1.8, y]], { stroke: fg, width: 0.15 }); out.poly([[x, y - 1.8], [x, y + 1.8]], { stroke: fg, width: 0.15 }); out.circle(x, y, 1, { stroke: fg, width: 0.15 });
    }
  }
  if (ruler) { // régua de 10 mm para conferir se a impressora respeitou o tamanho
    const y = box.y1 - 2, x = box.x0 + 3;
    out.poly([[x, y], [x + 10, y]], { stroke: fg, width: 0.2 }); out.poly([[x, y - 0.9], [x, y + 0.9]], { stroke: fg, width: 0.2 }); out.poly([[x + 10, y - 0.9], [x + 10, y + 0.9]], { stroke: fg, width: 0.2 });
    // texto "10 mm" desenhado com traços (sem depender de fonte)
    const glyph = { 1: [[[0, 0], [0, 3]]], 0: [[[0, 0], [1.4, 0], [1.4, 3], [0, 3], [0, 0]]], m: [[[0, 3], [0, 1.2], [0.7, 0.8], [0.7, 3]], [[0.7, 0.8], [1.4, 1.2], [1.4, 3]]] };
    let gx = x + 12;
    for (const ch of ['1', '0', 'm', 'm']) { for (const seg of glyph[ch]) out.poly(seg.map(([a, c]) => [gx + a, y - 1.5 + c * 0.5]), { stroke: fg, width: 0.15 }); gx += ch === 'm' ? 2.1 : 2; }
  }
}

/** SVG em milímetros reais (abre em qualquer programa e imprime no tamanho certo). */
export function fabSvg(board, an, opt) {
  const box = fabBox(board), w = box.x1 - box.x0, h = box.y1 - box.y0, out = svgOut();
  paintFab(out, board, an, opt);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${r3(w)}mm" height="${r3(h)}mm" viewBox="${r3(box.x0)} ${r3(box.y0)} ${r3(w)} ${r3(h)}">\n${out.els.join('\n')}\n</svg>\n`;
}

/** PNG com resolução alta (dpi) e tamanho gravado. makeCanvas: (w,h) => canvas. */
export async function fabPng(board, an, opt, makeCanvas, canvasToBlob, dpi = 600) {
  const box = fabBox(board), w = box.x1 - box.x0, h = box.y1 - box.y0;
  const k = Math.min(dpi / 25.4, 12000 / Math.max(w, h)), c = makeCanvas(Math.round(w * k), Math.round(h * k)), ctx = c.getContext('2d');
  ctx.setTransform(k, 0, 0, k, -box.x0 * k, -box.y0 * k);
  paintFab(canvasOut(ctx, k), board, an, opt);
  return { blob: await pngWithDpi(await canvasToBlob(c), k * 25.4), dpi: Math.round(k * 25.4), px: [c.width, c.height] };
}

// ---------- PDF vetorial (1 página, tamanho real) ----------
export const PAPERS = { A4: [210, 297], Carta: [215.9, 279.4] };
export function fabPdf(board, an, opt, paper = 'A4') {
  const box = fabBox(board), w = box.x1 - box.x0, h = box.y1 - box.y0;
  let [pw, ph] = PAPERS[paper] || PAPERS.A4, margin = 10;
  if (w > pw - 2 * margin && h <= pw - 2 * margin && w <= ph - 2 * margin) [pw, ph] = [ph, pw]; // deitada
  const k = 72 / 25.4, ops = [];
  const X = (x) => r3((x - box.x0 + margin) * k), Y = (y) => r3((ph - (y - box.y0 + margin)) * k);
  const col = (c) => (c === '#fff' ? '1 1 1' : '0 0 0');
  const fmt = (v) => r3(v);
  const style = (o) => { const f = !!o.fill, s = !!o.stroke; if (s) ops.push(`${col(o.stroke)} RG ${fmt((o.width ?? 1) * k)} w`); if (f) ops.push(`${col(o.fill)} rg`); return f && s ? 'B' : f ? 'f' : s ? 'S' : 'n'; };
  const pdfOut = {
    alpha() {},
    poly(pts, o = {}) { if (!pts.length) return; ops.push('1 J 1 j'); const op = style(o); ops.push(pts.map(([x, y], i) => `${X(x)} ${Y(y)} ${i ? 'l' : 'm'}`).join(' ') + (o.closed ? ' h' : '') + ' ' + op); },
    circle(x, y, r, o = {}) {
      const op = style(o), c = 0.5523 * r, cx = X(x), cy = Y(y), R = r * k, C = c * k;
      ops.push(`${fmt(cx + R)} ${fmt(cy)} m ${fmt(cx + R)} ${fmt(cy + C)} ${fmt(cx + C)} ${fmt(cy + R)} ${fmt(cx)} ${fmt(cy + R)} c ${fmt(cx - C)} ${fmt(cy + R)} ${fmt(cx - R)} ${fmt(cy + C)} ${fmt(cx - R)} ${fmt(cy)} c ${fmt(cx - R)} ${fmt(cy - C)} ${fmt(cx - C)} ${fmt(cy - R)} ${fmt(cx)} ${fmt(cy - R)} c ${fmt(cx + C)} ${fmt(cy - R)} ${fmt(cx + R)} ${fmt(cy - C)} ${fmt(cx + R)} ${fmt(cy)} c h ${op}`);
    },
    text() {},
  };
  // a folha de arte (retângulo) usa as coordenadas da placa; o fundo cobre só a área da arte
  paintFab(pdfOut, board, an, opt);
  const stream = ops.join('\n'), objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pw * k)} ${fmt(ph * k)}] /Contents 4 0 R /Resources << >> >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { blob: new Blob([pdf], { type: 'application/pdf' }), pageMm: [pw, ph], fits: w <= pw - 2 * margin && h <= ph - 2 * margin };
}

// ---------- Gerber (RS-274X) e furação (Excellon) ----------
function gerberWriter(board) {
  const b = board.outlineBox(), ap = new Map(), body = [];
  const X = (x) => Math.round((x - b.x0) * 1e6), Y = (y) => Math.round((b.y1 - y) * 1e6);
  const dcode = (key, def) => { let d = ap.get(key); if (!d) { d = { n: 10 + ap.size, def }; ap.set(key, d); } return d.n; };
  let cur = null;
  const use = (key, def) => { const n = dcode(key, def); if (cur !== n) { body.push(`D${n}*`); cur = n; } };
  const circ = (d) => use('C' + r3(d), `C,${d.toFixed(4)}`);
  const mv = (p) => body.push(`X${X(p[0])}Y${Y(p[1])}D02*`), dr = (p) => body.push(`X${X(p[0])}Y${Y(p[1])}D01*`), fl = (p) => body.push(`X${X(p[0])}Y${Y(p[1])}D03*`);
  return {
    stroke(pts, w, closed = false) { if (pts.length < 2) return; circ(Math.max(0.01, w)); mv(pts[0]); for (let i = 1; i < pts.length; i++) dr(pts[i]); if (closed) dr(pts[0]); },
    flash(p, d) { circ(d); fl(p); },
    region(pts) { body.push('G36*'); mv(pts[0]); for (let i = 1; i < pts.length; i++) dr(pts[i]); dr(pts[0]); body.push('G37*'); cur = null; },
    finish(title, func) {
      const head = ['G04 Atelie - JH Laboratoriox*', `G04 ${title}*`, `%TF.GenerationSoftware,Atelie,PCB,1*%`, `%TF.FileFunction,${func}*%`, '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%', ...[...ap.values()].map((d) => `%ADD${d.n}${d.def}*%`), 'G01*'];
      return head.join('\n') + '\n' + body.join('\n') + '\nM02*\n';
    },
  };
}
const circlePts = (cx, cy, r, n = 28) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i * 2 * Math.PI) / n), cy + r * Math.sin((i * 2 * Math.PI) / n)]);

function padsOn(an, L) { return an.objs.filter((o) => o.kind === 'pad' && o.layers.includes(L)); }
function gerberCopper(board, an, L) {
  const g = gerberWriter(board);
  for (const t of board.tracks) if (t.l === L) g.stroke([t.a, t.b], t.w);
  for (const o of padsOn(an, L)) {
    const s = o.shape;
    if (s.k === 'poly') g.region(s.pts);
    else if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) g.flash(s.a, s.r * 2);
    else g.stroke([s.a, s.b], s.r * 2);
  }
  for (const v of board.vias) g.flash([v.x, v.y], v.d);
  return g.finish(`${L === 'F' ? 'Cobre da frente' : 'Cobre do verso'}`, `Copper,L${L === 'F' ? 1 : 2},${L === 'F' ? 'Top' : 'Bot'}`);
}
function gerberMask(board, an, L, m = 0.1) {
  const g = gerberWriter(board);
  for (const o of padsOn(an, L)) {
    const s = o.shape;
    if (s.k === 'poly') { g.region(s.pts); g.stroke(s.pts, m * 2, true); }
    else if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) g.flash(s.a, (s.r + m) * 2);
    else g.stroke([s.a, s.b], (s.r + m) * 2);
  }
  return g.finish(`Máscara de solda ${L === 'F' ? 'da frente' : 'do verso'}`, `Soldermask,${L === 'F' ? 'Top' : 'Bot'}`);
}
function gerberSilk(board, side) {
  const g = gerberWriter(board); let n = 0;
  for (const f of board.fps) {
    if (!!f.b !== (side === 'B')) continue; const fp = getFootprint(f.fp); if (!fp) continue;
    for (const s of fp.silk) { n++; if (s[0] === 'l') g.stroke(s[1].map(([x, y]) => fpPoint(f, x, y)), 0.15); else { const [cx, cy] = fpPoint(f, s[1], s[2]); g.stroke(circlePts(cx, cy, s[3]), 0.15); } }
  }
  return n ? g.finish(`Serigrafia ${side === 'F' ? 'da frente' : 'do verso'}`, `Legend,${side === 'F' ? 'Top' : 'Bot'}`) : null;
}
function gerberEdge(board) { const g = gerberWriter(board); g.stroke(board.outline, 0.1, true); return g.finish('Contorno da placa', 'Profile,NP'); }
function excellon(board, an) {
  const b = board.outlineBox(), tools = new Map(), hits = [];
  const add = (x, y, d) => { if (!(d > 0)) return; const k = r3(d).toFixed(3); if (!tools.has(k)) tools.set(k, tools.size + 1); hits.push([tools.get(k), x, y]); };
  for (const o of an.objs) if (o.kind === 'pad' && o.drill) add(o.c[0], o.c[1], o.drill);
  for (const v of board.vias) add(v.x, v.y, v.h);
  if (!hits.length) return null;
  const lines = ['M48', '; Atelie - JH Laboratoriox', 'FMAT,2', 'METRIC,TZ', ...[...tools].map(([d, n]) => `T${n}C${d}`), '%', 'G90', 'G05'];
  for (const [d, n] of tools) { lines.push(`T${n}`); for (const h of hits) if (h[0] === n) lines.push(`X${((h[1] - b.x0)).toFixed(3)}Y${((b.y1 - h[2])).toFixed(3)}`); }
  lines.push('M30'); return lines.join('\n') + '\n';
}

/** Pacote para fábrica: nomes aceitos por JLCPCB, PCBWay etc. Devolve { blob, files }. */
export function gerberZip(board, an, name = 'placa') {
  const n = slug(name), files = [];
  const add = (ext, data, what) => { if (data) files.push({ name: `${n}.${ext}`, data, what }); };
  add('GTL', gerberCopper(board, an, 'F'), 'cobre da frente'); add('GBL', gerberCopper(board, an, 'B'), 'cobre do verso');
  add('GTS', gerberMask(board, an, 'F'), 'máscara de solda da frente'); add('GBS', gerberMask(board, an, 'B'), 'máscara de solda do verso');
  add('GTO', gerberSilk(board, 'F'), 'serigrafia da frente'); add('GBO', gerberSilk(board, 'B'), 'serigrafia do verso');
  add('GKO', gerberEdge(board), 'contorno da placa'); add('DRL', excellon(board, an), 'furação (Excellon)');
  const b = board.outlineBox();
  files.push({ name: 'LEIA-ME.txt', data: `Placa "${name}" - gerada no Atelie (jhlaboratoriox.com.br)\r\nTamanho: ${r3(b.x1 - b.x0)} x ${r3(b.y1 - b.y0)} mm, 2 camadas.\r\n\r\nArquivos:\r\n${files.map((f) => `  ${f.name}  -  ${f.what}`).join('\r\n')}\r\n\r\nEnvie este .zip para a fábrica (JLCPCB, PCBWay...). Confira a pre-visualizacao do Gerber no site da fabrica antes de pagar.\r\nO texto dos nomes das pecas nao vai na serigrafia (so os contornos).\r\n` });
  return { blob: makeZip(files), files: files.map((f) => f.name) };
}
export { gerberCopper, gerberEdge, excellon };

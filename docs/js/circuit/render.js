// Desenho do esquema (na tela e em SVG) a partir da mesma lista de formas.
import { symbolFor, xf, pinsOf, partBox, labelSpots, isPower } from './symbols.js';

export const THEMES = {
  dark: { bg: '#1d1f23', body: '#e8e6e0', wire: '#7ccf9a', ref: '#f2b705', val: '#a4a7ae', text: '#ebe8e1', pin: '#98a4ff', grid: 'rgba(255,255,255,.075)', gridMajor: 'rgba(255,255,255,.14)', sel: '#98a4ff', danger: '#e0584c' },
  light: { bg: '#ffffff', body: '#1b1b1f', wire: '#15803d', ref: '#92400e', val: '#4b5563', text: '#1b1b1f', pin: '#2f4bd8', grid: 'rgba(0,0,0,.06)', gridMajor: 'rgba(0,0,0,.12)', sel: '#2f4bd8', danger: '#c0392b' },
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif';
const LW = 1.6;

function textAlignFor(part, align) {
  const [x0] = xf(part, 0, 0), [x1] = xf(part, 1, 0), dx = x1 - x0;
  if (Math.abs(dx) < 0.5) return 'middle';
  if (dx < 0) return align === 'start' ? 'end' : align === 'end' ? 'start' : align;
  return align;
}

export function paintPart(out, part, theme, color, { labels = true } = {}) {
  const s = symbolFor(part);
  for (const p of s.prims) {
    switch (p[0]) {
      case 'pl': out.poly(p[1].map(([x, y]) => xf(part, x, y)), { stroke: color, width: LW }); break;
      case 'pg': out.poly(p[1].map(([x, y]) => xf(part, x, y)), { stroke: color, width: LW, closed: true }); break;
      case 'fp': out.poly(p[1].map(([x, y]) => xf(part, x, y)), { stroke: color, fill: color, width: 1, closed: true }); break;
      case 'c': { const [cx, cy] = xf(part, p[1], p[2]); out.circle(cx, cy, p[3], { stroke: color, width: LW }); break; }
      case 'fc': { const [cx, cy] = xf(part, p[1], p[2]); out.circle(cx, cy, p[3], { stroke: color, fill: color, width: 1 }); break; }
      case 't': { const [tx, ty] = xf(part, p[1], p[2]); out.text(tx, ty, p[3], { size: p[4], align: textAlignFor(part, p[5]), color }); break; }
      default:
    }
  }
  if (labels && !isPower(part.t)) {
    const spot = labelSpots(part);
    if (part.ref) out.text(spot.ref.x, spot.ref.y, part.ref, { size: 10, align: spot.ref.align, color: theme.ref, bold: true });
    if (part.val) out.text(spot.val.x, spot.val.y, part.val, { size: 9.5, align: spot.val.align, color: theme.val });
  }
}

/** Desenha o esquema inteiro. `out` é um "pincel" (tela ou SVG). */
export function paint(out, sch, theme, { selected = null, analysis = null, pins = true, labels = true } = {}) {
  const selP = new Set(selected?.parts || []), selW = new Set(selected?.wires || []), selT = new Set(selected?.texts || []);
  const an = analysis || sch.analyze();
  for (const w of sch.wires) out.poly([w.a, w.b], { stroke: selW.has(w.id) ? theme.sel : theme.wire, width: selW.has(w.id) ? LW + 0.9 : LW });
  for (const j of an.junctions) out.circle(j.x, j.y, 2.9, { fill: theme.wire, stroke: theme.wire, width: 1 });
  for (const p of sch.parts) paintPart(out, p, theme, selP.has(p.id) ? theme.sel : theme.body, { labels });
  for (const t of sch.texts) {
    String(t.s).split('\n').forEach((line, i) => out.text(t.x, t.y + i * 12.5 * (t.z || 1), line, { size: 10 * (t.z || 1), align: 'start', color: selT.has(t.id) ? theme.sel : theme.text }));
  }
  if (pins) for (const u of an.unconnected) out.circle(u.x, u.y, 2.6, { stroke: theme.pin, width: 1.2 });
  for (const p of sch.parts) if (selP.has(p.id)) { const b = partBox(p); out.rect(b.x0 - 5, b.y0 - 5, b.x1 + 5, b.y1 + 5, { stroke: theme.sel, width: 1, dash: [4, 3] }); }
  for (const t of sch.texts) if (selT.has(t.id)) { const b = sch.textBox(t); out.rect(b.x0 - 3, b.y0 - 3, b.x1 + 3, b.y1 + 3, { stroke: theme.sel, width: 1, dash: [4, 3] }); }
}

// ---------- pincel de tela (canvas) ----------
export function canvasOut(ctx, scale = 1) {
  const minW = 1.1 / scale;
  const path = (pts, closed) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (closed) ctx.closePath(); };
  return {
    poly(pts, { stroke, fill, width = 1.5, closed = false, dash } = {}) {
      path(pts, closed);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth = Math.max(width, minW); ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
    },
    circle(x, y, r, { stroke, fill, width = 1.5 } = {}) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth = Math.max(width, minW); ctx.strokeStyle = stroke; ctx.stroke(); }
    },
    rect(x0, y0, x1, y1, { stroke, fill, width = 1, dash } = {}) {
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
      if (stroke) { ctx.lineWidth = Math.max(width, minW); ctx.strokeStyle = stroke; ctx.setLineDash((dash || []).map((d) => d / Math.max(1, scale * 0.8))); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]); }
    },
    text(x, y, s, { size = 10, align = 'start', color = '#fff', bold = false } = {}) {
      ctx.font = `${bold ? '600 ' : ''}${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align === 'middle' ? 'center' : align === 'end' ? 'right' : 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(s, x, y);
    },
    alpha(a) { ctx.globalAlpha = a; },
  };
}

// ---------- pincel de SVG ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = (n) => Math.round(n * 100) / 100;
export function svgOut() {
  const els = [];
  const pts = (a) => a.map(([x, y]) => r2(x) + ',' + r2(y)).join(' ');
  return {
    els,
    poly(a, { stroke, fill, width = 1.5, closed = false } = {}) { els.push(`<${closed ? 'polygon' : 'polyline'} points="${pts(a)}" fill="${fill || 'none'}" stroke="${stroke || 'none'}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`); },
    circle(x, y, r, { stroke, fill, width = 1.5 } = {}) { els.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill || 'none'}" stroke="${stroke || 'none'}" stroke-width="${width}"/>`); },
    rect() {},
    text(x, y, s, { size = 10, align = 'start', color = '#000', bold = false } = {}) { els.push(`<text x="${r2(x)}" y="${r2(y)}" font-family="${esc(FONT)}" font-size="${size}"${bold ? ' font-weight="600"' : ''} text-anchor="${align}" fill="${color}">${esc(s)}</text>`); },
    alpha() {},
  };
}

/** SVG do esquema todo (tema "light" é o de impressão, fundo branco). */
export function toSVG(sch, themeName = 'light', { margin = 24, transparent = false } = {}) {
  const theme = THEMES[themeName] || THEMES.light, b = sch.bounds() || { x0: 0, y0: 0, x1: 200, y1: 120 };
  const x0 = b.x0 - margin, y0 = b.y0 - margin, w = b.x1 - b.x0 + margin * 2, h = b.y1 - b.y0 + margin * 2;
  const out = svgOut();
  paint(out, sch, theme, { pins: false });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(x0)} ${r2(y0)} ${r2(w)} ${r2(h)}" width="${Math.round(w)}" height="${Math.round(h)}">\n`
    + (transparent ? '' : `<rect x="${r2(x0)}" y="${r2(y0)}" width="${r2(w)}" height="${r2(h)}" fill="${theme.bg}"/>\n`) + out.els.join('\n') + '\n</svg>\n';
}

/** Desenha o esquema em um canvas (ajustado ao conteúdo) e devolve o canvas. */
export function toCanvas(sch, makeCanvas, themeName = 'light', { scale = 2, margin = 24, transparent = false, maxSide = 8192 } = {}) {
  const theme = THEMES[themeName] || THEMES.light, b = sch.bounds() || { x0: 0, y0: 0, x1: 200, y1: 120 };
  const w = b.x1 - b.x0 + margin * 2, h = b.y1 - b.y0 + margin * 2;
  const k = Math.min(scale, maxSide / Math.max(w, h));
  const c = makeCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))), ctx = c.getContext('2d');
  if (!transparent) { ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.setTransform(k, 0, 0, k, -(b.x0 - margin) * k, -(b.y0 - margin) * k);
  paint(canvasOut(ctx, k), sch, theme, { pins: false });
  return c;
}

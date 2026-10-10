// Balde de tinta: preenchimento por tolerância (scanline) com expansão opcional da borda.
import { makeCanvas } from '../util.js';

/**
 * @param sourceCanvas canvas lido para decidir a área (camada atual ou composição)
 * @returns retângulo alterado {x0,y0,x1,y1} ou null
 */
export function floodFill({ target, source, W, H, x, y, rgb, opacity = 1, tolerance = 0.12, grow = 1, contiguous = true, clip = null }) {
  x = Math.floor(x); y = Math.floor(y);
  const cx0 = clip ? Math.max(0, Math.floor(clip.x)) : 0, cy0 = clip ? Math.max(0, Math.floor(clip.y)) : 0;
  const cx1 = clip ? Math.min(W - 1, Math.ceil(clip.x + clip.w) - 1) : W - 1, cy1 = clip ? Math.min(H - 1, Math.ceil(clip.y + clip.h) - 1) : H - 1;
  if (x < cx0 || y < cy0 || x > cx1 || y > cy1) return null;

  const data = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const si = (y * W + x) * 4;
  const sr = data[si], sg = data[si + 1], sb = data[si + 2], sa = data[si + 3];
  const tol = Math.round(tolerance * 255);
  const match = (i) => {
    const a = data[i + 3];
    if (a === 0 && sa === 0) return true;
    return Math.abs(data[i] - sr) <= tol && Math.abs(data[i + 1] - sg) <= tol && Math.abs(data[i + 2] - sb) <= tol && Math.abs(a - sa) <= tol;
  };

  const mask = new Uint8Array(W * H);
  let bx0 = x, by0 = y, bx1 = x, by1 = y;
  const mark = (px, py) => {
    mask[py * W + px] = 1;
    if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
  };

  if (contiguous) {
    const stack = [x, y];
    while (stack.length) {
      const cy = stack.pop(), cx = stack.pop();
      let xl = cx;
      while (xl >= cx0 && !mask[cy * W + xl] && match((cy * W + xl) * 4)) xl--;
      xl++;
      let up = false, down = false, xi = xl;
      while (xi <= cx1 && !mask[cy * W + xi] && match((cy * W + xi) * 4)) {
        mark(xi, cy);
        if (cy > cy0) {
          const m = !mask[(cy - 1) * W + xi] && match(((cy - 1) * W + xi) * 4);
          if (m && !up) { stack.push(xi, cy - 1); up = true; } else if (!m) up = false;
        }
        if (cy < cy1) {
          const m = !mask[(cy + 1) * W + xi] && match(((cy + 1) * W + xi) * 4);
          if (m && !down) { stack.push(xi, cy + 1); down = true; } else if (!m) down = false;
        }
        xi++;
      }
    }
  } else {
    for (let py = cy0; py <= cy1; py++) for (let px = cx0; px <= cx1; px++) if (match((py * W + px) * 4)) mark(px, py);
  }

  // expande a área para cobrir o serrilhado das linhas
  for (let g = 0; g < grow; g++) {
    const add = [];
    for (let py = Math.max(cy0, by0 - 1); py <= Math.min(cy1, by1 + 1); py++) {
      for (let px = Math.max(cx0, bx0 - 1); px <= Math.min(cx1, bx1 + 1); px++) {
        const i = py * W + px;
        if (mask[i]) continue;
        if ((px > 0 && mask[i - 1]) || (px < W - 1 && mask[i + 1]) || (py > 0 && mask[i - W]) || (py < H - 1 && mask[i + W])) add.push(px, py);
      }
    }
    for (let k = 0; k < add.length; k += 2) mark(add[k], add[k + 1]);
  }

  const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
  const out = new ImageData(w, h), od = out.data;
  for (let py = by0; py <= by1; py++) {
    for (let px = bx0; px <= bx1; px++) {
      if (!mask[py * W + px]) continue;
      const o = ((py - by0) * w + (px - bx0)) * 4;
      od[o] = rgb.r; od[o + 1] = rgb.g; od[o + 2] = rgb.b; od[o + 3] = 255;
    }
  }
  const tmp = makeCanvas(w, h); tmp.getContext('2d').putImageData(out, 0, 0);
  const ctx = target.getContext('2d');
  ctx.save(); ctx.globalAlpha = opacity; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(tmp, bx0, by0); ctx.restore();
  return { x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
}

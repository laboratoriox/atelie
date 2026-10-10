// Motor de pincel: carimbos (dabs) interpolados ao longo do traço, com pressão,
// suavização, textura de grão e simetria.
import { makeCanvas, clamp } from '../util.js';

/** Constrói variações do "carimbo" (ponta do pincel) já coloridas. */
export function buildTips(size, hardness, rgb, grain) {
  const D = clamp(Math.ceil(size) + 2, 3, 1200), R = D / 2;
  const variants = grain > 0 ? 6 : 1;
  const tips = [];
  for (let v = 0; v < variants; v++) {
    const c = makeCanvas(D, D), g = c.getContext('2d', { willReadFrequently: grain > 0 });
    const col = (a) => `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
    if (hardness >= 0.98) {
      g.fillStyle = col(1); g.beginPath(); g.arc(R, R, Math.max(0.5, R - 1), 0, Math.PI * 2); g.fill();
    } else {
      const inner = clamp(hardness, 0, 0.97);
      const grad = g.createRadialGradient(R, R, 0, R, R, R - 0.5);
      grad.addColorStop(0, col(1)); grad.addColorStop(inner, col(1));
      // queda suave (curva aproximando uma gaussiana)
      grad.addColorStop(inner + (1 - inner) * 0.5, col(0.35)); grad.addColorStop(1, col(0));
      g.fillStyle = grad; g.fillRect(0, 0, D, D);
    }
    if (grain > 0) {
      const img = g.getImageData(0, 0, D, D), d = img.data;
      for (let i = 3; i < d.length; i += 4) {
        if (!d[i]) continue;
        const n = Math.random();
        d[i] = d[i] * (1 - grain * (n < 0.5 ? n * 1.6 : 0.8 + (n - 0.5) * 0.4));
      }
      g.putImageData(img, 0, 0);
    }
    tips.push(c);
  }
  return tips;
}

export class BrushStroke {
  /**
   * @param ctx contexto onde os carimbos são desenhados (buffer do traço ou a própria camada, no caso da borracha)
   */
  constructor({ ctx, docW, docH, settings, rgb, eraser, symmetry, selection, onDirty }) {
    this.ctx = ctx; this.docW = docW; this.docH = docH;
    this.s = settings; this.eraser = eraser; this.symmetry = symmetry;
    this.onDirty = onDirty;
    this.tips = buildTips(settings.size, eraser ? 1 : settings.hardness, eraser ? { r: 0, g: 0, b: 0 } : rgb, eraser ? 0 : settings.grain);
    this.tipsFor = settings.size;
    this.step = Math.max(0.8, settings.size * settings.spacing);
    this.next = 0;
    this.last = null; this.smooth = null; this.pressure = 1;
    this.lastT = 0;
    ctx.save();
    if (selection) { ctx.beginPath(); ctx.rect(selection.x, selection.y, selection.w, selection.h); ctx.clip(); }
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
  }

  pressureFor(pt, prev) {
    const s = this.s;
    let p = 1;
    if (pt.type === 'pen') p = clamp(pt.p || 0.5, 0.02, 1);
    else if (s.speed && prev) {
      const dt = Math.max(1, pt.t - prev.t), v = Math.hypot(pt.x - prev.x, pt.y - prev.y) / dt; // px/ms
      const target = clamp(1.1 - v * 0.55, 0.3, 1);
      this.pressure += (target - this.pressure) * 0.18; p = this.pressure;
    }
    return p;
  }

  begin(pt) {
    this.smooth = { ...pt, p: this.pressureFor(pt, null) };
    this.last = { ...this.smooth };
    this.dab(this.smooth.x, this.smooth.y, this.smooth.p);
    this.next = this.step;
  }

  move(pt) {
    const k = 1 - clamp(this.s.smoothing, 0, 0.92);
    const sm = this.smooth;
    const target = { ...pt, p: this.pressureFor(pt, this.lastRaw || null) };
    this.lastRaw = pt;
    const nx = sm.x + (target.x - sm.x) * k, ny = sm.y + (target.y - sm.y) * k, np = sm.p + (target.p - sm.p) * Math.max(k, 0.35);
    this.segmentTo({ x: nx, y: ny, p: np });
    this.smooth = { ...pt, x: nx, y: ny, p: np };
  }

  end(finalPt) {
    // alcança o último ponto (a suavização deixa o traço "atrasado")
    if (finalPt && this.smooth && this.s.smoothing > 0) {
      for (let i = 0; i < 40; i++) {
        const sm = this.smooth;
        if (Math.hypot(finalPt.x - sm.x, finalPt.y - sm.y) < 0.5) break;
        const k = 0.35;
        const nx = sm.x + (finalPt.x - sm.x) * k, ny = sm.y + (finalPt.y - sm.y) * k;
        this.segmentTo({ x: nx, y: ny, p: sm.p });
        this.smooth = { ...sm, x: nx, y: ny };
      }
    }
    this.ctx.restore();
  }

  segmentTo(to) {
    const from = this.last;
    const dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
    if (d === 0) return;
    let pos = this.next;
    while (pos <= d) {
      const t = pos / d;
      this.dab(from.x + dx * t, from.y + dy * t, from.p + (to.p - from.p) * t);
      pos += this.step;
    }
    this.next = pos - d;
    this.last = { ...to };
  }

  dab(x, y, p) {
    const s = this.s;
    const scale = s.pressureSize ? 0.15 + 0.85 * Math.pow(p, 0.85) : 1;
    const d = Math.max(0.6, s.size * scale);
    const alpha = clamp(s.flow * (s.pressureOpacity ? 0.2 + 0.8 * p : 1) * (this.eraser ? s.opacity : 1), 0.003, 1);
    const tip = this.tips[(Math.random() * this.tips.length) | 0];
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    const rot = this.tips.length > 1 ? (Math.random() * Math.PI * 2) : 0;
    const stamp = (px) => {
      if (rot) {
        ctx.save(); ctx.translate(px, y); ctx.rotate(rot); ctx.drawImage(tip, -d / 2, -d / 2, d, d); ctx.restore();
      } else ctx.drawImage(tip, px - d / 2, y - d / 2, d, d);
      this.onDirty(px - d / 2 - 1, y - d / 2 - 1, d + 2, d + 2);
    };
    stamp(x);
    if (this.symmetry) stamp(this.docW - x);
  }
}

// Fotos no Ateliê: inserir imagem como camada (ou como foto da mesa de luz) e ajustes de imagem.
import { h, toast, modal, makeCanvas } from '../util.js';

function loadImg(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagem inválida')); i.src = url; });
}

/** Abre a janela "Inserir foto" para um arquivo escolhido pela pessoa. */
export async function importPhoto(doc, file, { asRef = false } = {}) {
  if (!file || !/^image\//.test(file.type)) { toast('Escolha um arquivo de imagem (JPG, PNG ou WebP).', 'err'); return; }
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImg(url); } catch { URL.revokeObjectURL(url); toast('Não consegui abrir essa imagem.', 'err'); return; }
  let mode = 'fit', ref = asRef;
  const modes = [['fit', 'Caber na tela'], ['cover', 'Preencher a tela'], ['original', 'Tamanho original']];
  const btns = modes.map(([v, label]) => h('button.btn.sm', { type: 'button', 'aria-pressed': String(v === mode), onclick: () => { mode = v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i][0] === v))); } }, label));
  const refInput = h('input', { type: 'checkbox', checked: ref, onchange: () => { ref = refInput.checked; } });
  const body = h('div.newform', {},
    h('img.photoprev', { src: url, alt: 'Prévia da foto' }),
    h('p.hint', {}, `${img.naturalWidth} × ${img.naturalHeight} px`),
    h('div.flabel', {}, 'Como encaixar'), h('div.bgrow', {}, ...btns),
    h('label.check', {}, refInput, h('span', {}, 'Usar como foto da mesa de luz (para decalcar)')));
  const done = () => URL.revokeObjectURL(url);
  const m = modal('Inserir foto', body, [
    h('button.btn', { onclick: () => { done(); m.close(); } }, 'Cancelar'),
    h('button.btn.primary', { onclick: () => {
      const name = (file.name || 'Foto').replace(/\.[^.]+$/, '').slice(0, 40) || 'Foto';
      const l = doc.addImageLayer(img, { name, mode, ref });
      done(); m.close();
      if (!l) toast('Limite de camadas atingido. Exclua uma camada e tente de novo.', 'err');
      else toast(ref ? 'Foto na mesa de luz. Desenhe nas camadas de cima.' : 'Foto inserida como camada.');
    } }, 'Inserir'),
  ]);
}

// ---------- ajustes de imagem ----------
const DEFAULTS = { bright: 0, contrast: 0, sat: 0, bw: 0, invert: false };

/** Aplica os ajustes em um ImageData (in-place). */
export function adjustPixels(data, p) {
  const B = p.bright * 2.55, C = p.contrast * 2.55, f = (259 * (C + 255)) / (255 * (259 - C));
  const S = 1 + p.sat / 100, W = p.bw / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + B, g = data[i + 1] + B, b = data[i + 2] + B;
    r = f * (r - 128) + 128; g = f * (g - 128) + 128; b = f * (b - 128) + 128;
    let y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * S; g = y + (g - y) * S; b = y + (b - y) * S;
    if (W) { y = 0.299 * r + 0.587 * g + 0.114 * b; r += (y - r) * W; g += (y - g) * W; b += (y - b) * W; }
    if (p.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    data[i] = r < 0 ? 0 : r > 255 ? 255 : r; data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

/** Janela de ajustes (brilho, contraste, saturação, preto e branco, inverter) para a camada ativa, com prévia. */
export function openAdjust(doc) {
  const layer = doc.active;
  if (!layer) return;
  if (layer.locked && !layer.ref) { toast('Esta camada está bloqueada.'); return; }
  const k = Math.min(1, 560 / Math.max(doc.width, doc.height));
  const src = makeCanvas(Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
  src.getContext('2d').drawImage(layer.canvas, 0, 0, src.width, src.height);
  const srcData = src.getContext('2d').getImageData(0, 0, src.width, src.height);
  const prev = makeCanvas(src.width, src.height); prev.className = 'adjprev';
  const pctx = prev.getContext('2d');
  const p = { ...DEFAULTS };
  let raf = 0;
  const draw = () => {
    raf = 0;
    const d = new ImageData(new Uint8ClampedArray(srcData.data), src.width, src.height);
    adjustPixels(d.data, p); pctx.putImageData(d, 0, 0);
  };
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const row = (label, key, min, max) => {
    const out = h('span.readout', {}, '0');
    const r = h('input', { type: 'range', min, max, step: 1, value: 0, 'aria-label': label, oninput: () => { p[key] = Number(r.value); out.textContent = r.value; r.style.setProperty('--fill', ((r.value - min) / (max - min)) * 100 + '%'); redraw(); } });
    r.style.setProperty('--fill', '50%');
    return h('label.field', {}, h('span.flabel', {}, label), r, out);
  };
  const inv = h('input', { type: 'checkbox', onchange: () => { p.invert = inv.checked; redraw(); } });
  const body = h('div.newform', {}, h('div.adjwrap', {}, prev),
    row('Brilho', 'bright', -100, 100), row('Contraste', 'contrast', -100, 100), row('Saturação', 'sat', -100, 100), row('Preto e branco', 'bw', 0, 100),
    h('label.check', {}, inv, h('span', {}, 'Inverter cores')));
  draw();
  const m = modal('Ajustar imagem da camada', body, [
    h('button.btn', { onclick: () => { cancelAnimationFrame(raf); m.close(); } }, 'Cancelar'),
    h('button.btn.primary', { onclick: () => {
      cancelAnimationFrame(raf); m.close();
      if (p.bright === 0 && p.contrast === 0 && p.sat === 0 && p.bw === 0 && !p.invert) return;
      doc.beginEdit(layer);
      const d = layer.ctx.getImageData(0, 0, doc.width, doc.height);
      adjustPixels(d.data, p); layer.ctx.putImageData(d, 0, 0);
      doc.touchAll(); doc.commitEdit();
      toast('Ajuste aplicado. Dá para desfazer com Ctrl+Z.');
    } }, 'Aplicar'),
  ]);
}



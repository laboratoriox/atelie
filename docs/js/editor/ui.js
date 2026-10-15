// Interface do editor: barra superior, ferramentas, cor, pincel e camadas.
import { h, $, clamp, toast, modal, canvasToBlob, makeCanvas, debounce } from '../util.js';
import { icon } from '../icons.js';
import { state, TOOLS, PRESETS, ERASER_PRESET, hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from './state.js';
import { BLEND_MODES, MAX_LAYERS } from './doc.js';
import { Engine, FONTS } from './engine.js';
import { BrushStroke } from './brush.js';
import { importPhoto, openAdjust } from './photo.js';

const PALETTE = ['#1b1b1f', '#4a4a52', '#8b8b94', '#c9c9d0', '#ffffff', '#4b2e22', '#8d5a3b', '#c98f6b', '#f0b79a', '#7a2e1d', '#b5532f',
  '#e08a3c', '#f2b705', '#c9c34a', '#5f7d3a', '#2f5d50', '#2a8c8c', '#2f4bd8', '#25306e', '#6b3fa0', '#b03a6f', '#d6403a'];

const SIZE_MAX = 600;
const sizeToPos = (s) => Math.round((Math.log(clamp(s, 1, SIZE_MAX)) / Math.log(SIZE_MAX)) * 1000);
const posToSize = (p) => Math.max(1, Math.round(Math.exp((Math.log(SIZE_MAX) * p) / 1000)));

function range({ min = 0, max = 100, step = 1, value = 0, label, onInput, onChange }) {
  const el = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const paint = () => el.style.setProperty('--fill', ((el.value - min) / (max - min)) * 100 + '%');
  el.addEventListener('input', () => { paint(); onInput?.(Number(el.value)); });
  el.addEventListener('change', () => onChange?.(Number(el.value)));
  paint();
  el.set = (v) => { el.value = v; paint(); };
  return el;
}
function field(label, control, readout) {
  const r = h('span.readout', {}, readout ?? '');
  const row = h('label.field', {}, h('span.flabel', {}, label), control, r);
  row.readout = r;
  return row;
}
function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked, onchange: () => onChange(input.checked) });
  const el = h('label.check', {}, input, h('span', {}, label));
  el.input = input; return el;
}
function segmented(options, value, onChange) {
  const el = h('div.segmented', { role: 'group' });
  const btns = options.map(([v, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { set(v); onChange(v); } }, label);
    return [v, b];
  });
  const set = (val) => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(v === val)));
  el.append(...btns.map(([, b]) => b));
  return el;
}
function iconBtn(ic, label, onclick, cls = '') {
  return h('button.ibtn' + (cls ? '.' + cls : ''), { type: 'button', title: label, 'aria-label': label, onclick, html: icon[ic] });
}

// miniatura do pincel desenhada com o próprio motor de pincel
function brushPreview(preset) {
  const W = 132, H = 34, c = makeCanvas(W * 2, H * 2), ctx = c.getContext('2d');
  ctx.scale(2, 2);
  const size = clamp(preset.size * 0.45, 2, 15);
  const bs = new BrushStroke({
    ctx, docW: W, docH: H, settings: { ...preset, size, smoothing: 0, flow: Math.max(preset.flow, 0.25) },
    rgb: { r: 232, g: 230, b: 224 }, eraser: false, symmetry: false, selection: null, onDirty() {},
  });
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push({ x: 10 + t * (W - 20), y: H / 2 + Math.sin(t * Math.PI * 2) * 7, p: 0.25 + 0.75 * Math.sin(t * Math.PI), type: 'pen', t: i * 8 });
  }
  bs.begin(pts[0]); pts.slice(1).forEach((p) => bs.move(p)); bs.end(pts[pts.length - 1]);
  c.className = 'bprev';
  return c;
}

export function mountEditor(root, doc, saver, { onExit }) {
  const stage = h('main.stage', { id: 'stage', tabIndex: -1 });
  const engine = new Engine(stage, doc);
  engine.addEventListener('notice', (e) => toast(e.detail));

  // ---------- barra superior ----------
  const nameInput = h('input.docname', {
    value: doc.name, 'aria-label': 'Nome do desenho', maxLength: 80, spellcheck: false,
    onchange: () => { doc.name = nameInput.value.trim() || 'Sem título'; nameInput.value = doc.name; saver.touchMeta(); },
    onkeydown: (e) => { if (e.key === 'Enter') nameInput.blur(); },
  });
  const status = h('span.save-status', { role: 'status' });
  const zoomLabel = h('button.zoomlabel', { type: 'button', title: 'Voltar para 100%', onclick: () => engine.setZoom(1) }, '100%');
  const undoBtn = iconBtn('undo', 'Desfazer (Ctrl+Z)', () => doc.undo());
  const redoBtn = iconBtn('redo', 'Refazer (Ctrl+Shift+Z)', () => doc.redo());
  const gridBtn = iconBtn('grid', 'Grade', () => { state.grid = !state.grid; syncToggles(); engine.requestRender(); }, 'hide-m');
  const symBtn = iconBtn('sym', 'Simetria vertical', () => { state.symmetry = !state.symmetry; syncToggles(); engine.requestRender(); }, 'hide-m');
  const topbar = h('header.topbar', {},
    iconBtn('back', 'Voltar para a galeria', onExit),
    h('div.docinfo', {}, nameInput, status),
    h('div.spacer'),
    h('div.group', {}, undoBtn, redoBtn),
    h('div.group.hide-m', {}, iconBtn('fit', 'Ajustar à tela', () => engine.fit()), zoomLabel,
      iconBtn('plus', 'Aproximar', () => engine.zoomCenter(1.25)),
      h('button.ibtn', { type: 'button', title: 'Afastar', 'aria-label': 'Afastar', onclick: () => engine.zoomCenter(0.8), html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12h14"/></svg>' })),
    h('div.group', {}, gridBtn, symBtn, iconBtn('rotate', 'Zerar rotação', () => engine.resetRotation(), 'hide-m'), iconBtn('download', 'Exportar imagem', openExport, 'accent')),
  );

  function syncToggles() {
    gridBtn.classList.toggle('on', state.grid); symBtn.classList.toggle('on', state.symmetry);
    gridCheck?.input && (gridCheck.input.checked = state.grid);
    symCheck?.input && (symCheck.input.checked = state.symmetry);
  }

  const statusText = { saved: 'Salvo', saving: 'Salvando…', dirty: 'Não salvo', offline: 'Sem conexão — tentando de novo', error: 'Erro ao salvar', conflict: 'Conflito de edição' };
  const onStatus = (e) => {
    const { status: s, message } = e.detail;
    status.textContent = statusText[s] || ''; status.dataset.s = s; status.title = message || '';
    if (s === 'conflict') showConflict();
    if (s === 'error' && message) toast(message, 'err');
  };
  saver.addEventListener('status', onStatus);
  onStatus({ detail: { status: saver.status } });

  function showConflict() {
    const m = modal('Este desenho mudou em outro dispositivo', h('p', {}, 'Outra sessão salvou alterações depois que você abriu o desenho. Para não apagar o trabalho de nenhum dos lados, escolha o que fazer:'), [
      h('button.btn', { onclick: () => { m.close(); saver.destroy(); location.reload(); } }, 'Carregar a versão do servidor'),
      h('button.btn.primary', { onclick: async () => { m.close(); saver.status = 'dirty'; await saver.saveAsCopy(); nameInput.value = doc.name; toast('Salvo como uma cópia.'); } }, 'Salvar o que fiz como cópia'),
    ]);
  }

  // ---------- ferramentas ----------
  const rail = h('nav.rail', { 'aria-label': 'Ferramentas' });
  const toolBtns = TOOLS.map((t) => {
    const b = h('button.tool', { type: 'button', title: `${t.label} (${t.key})`, 'aria-label': t.label, dataset: { tool: t.id }, onclick: () => state.setTool(t.id), html: icon[t.icon] });
    return b;
  });
  const swatchBtn = h('button.swatch-btn', { type: 'button', 'aria-label': 'Cor', title: 'Cor', onclick: () => toggleSheet('color') });
  rail.append(...toolBtns, h('div.rail-sep'), swatchBtn);
  const syncTools = () => toolBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool)));

  // ---------- seção: cor ----------
  const sv = h('canvas.sv', { width: 220, height: 160, 'aria-label': 'Saturação e brilho' });
  const hue = range({ min: 0, max: 359, value: state.color.h, label: 'Matiz', onInput: (v) => state.setColor({ ...state.color, h: v }) });
  hue.classList.add('hue');
  const hexInput = h('input.hex', { value: state.hex, maxLength: 7, spellcheck: false, 'aria-label': 'Cor em hexadecimal', onchange: () => { const c = hexToRgb(hexInput.value); if (c) state.setColorRgb(c, { remember: true }); else hexInput.value = state.hex; } });
  const primary = h('div.sw.primary'), secondary = h('button.sw.secondary', { type: 'button', title: 'Trocar cores (X)', onclick: () => state.swapColors() });
  const recentBox = h('div.swatches.recent');
  const paletteBox = h('div.swatches');
  PALETTE.forEach((hex) => paletteBox.append(h('button.chip', { type: 'button', style: `background:${hex}`, 'aria-label': hex, title: hex, onclick: () => state.setColorRgb(hexToRgb(hex), { remember: true }) })));
  function drawSV() {
    const g = sv.getContext('2d'), W = sv.width, H = sv.height;
    g.fillStyle = `hsl(${state.color.h} 100% 50%)`; g.fillRect(0, 0, W, H);
    const w = g.createLinearGradient(0, 0, W, 0); w.addColorStop(0, '#fff'); w.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = w; g.fillRect(0, 0, W, H);
    const k = g.createLinearGradient(0, 0, 0, H); k.addColorStop(0, 'rgba(0,0,0,0)'); k.addColorStop(1, '#000'); g.fillStyle = k; g.fillRect(0, 0, W, H);
    const x = state.color.s * W, y = (1 - state.color.v) * H;
    g.lineWidth = 2; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
    g.lineWidth = 1; g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y, 8.5, 0, 7); g.stroke();
  }
  let svDrag = false;
  const svPick = (e) => {
    const r = sv.getBoundingClientRect();
    state.setColor({ h: state.color.h, s: clamp((e.clientX - r.left) / r.width, 0, 1), v: 1 - clamp((e.clientY - r.top) / r.height, 0, 1) });
  };
  sv.addEventListener('pointerdown', (e) => { svDrag = true; sv.setPointerCapture(e.pointerId); svPick(e); e.preventDefault(); });
  sv.addEventListener('pointermove', (e) => { if (svDrag) svPick(e); });
  sv.addEventListener('pointerup', () => { svDrag = false; });
  const syncColor = () => {
    drawSV(); hue.set(Math.round(state.color.h));
    primary.style.background = state.hex; secondary.style.background = state.hex2; editor.style.setProperty('--c', state.hex);
    if (document.activeElement !== hexInput) hexInput.value = state.hex;
    hue.style.setProperty('--thumb', `hsl(${state.color.h} 100% 50%)`);
  };
  const syncRecent = () => {
    recentBox.replaceChildren(...state.recent.map((hex) => h('button.chip', { type: 'button', style: `background:${hex}`, 'aria-label': hex, title: hex, onclick: () => state.setColorRgb(hexToRgb(hex)) })));
  };
  const secColor = h('section.sec.sec-color', { 'aria-label': 'Cor' },
    h('h3', {}, 'Cor'), sv, hue,
    h('div.colorrow', {}, h('div.swpair', {}, primary, secondary), hexInput, iconBtn('swap', 'Trocar cores', () => state.swapColors())),
    h('h4.recent-h', {}, 'Recentes'), recentBox, h('h4', {}, 'Paleta'), paletteBox);

  // ---------- seção: pincel / ferramenta ----------
  const presetBtns = new Map();
  const presetList = h('div.presets');
  [...PRESETS, ERASER_PRESET].forEach((p) => {
    const b = h('button.preset', { type: 'button', 'aria-pressed': 'false', onclick: () => { if (p.id === 'borracha') state.setTool('borracha'); else state.setPreset(p.id); } }, brushPreview(p), h('span', {}, p.name));
    presetBtns.set(p.id, b); presetList.append(b);
  });
  const sizeR = range({ min: 0, max: 1000, value: 0, label: 'Tamanho', onInput: (v) => state.setBrush({ size: posToSize(v) }) });
  const opacR = range({ min: 1, max: 100, value: 100, label: 'Opacidade', onInput: (v) => state.setBrush({ opacity: v / 100 }) });
  const hardR = range({ min: 0, max: 100, value: 50, label: 'Dureza', onInput: (v) => state.setBrush({ hardness: v / 100 }) });
  const smoothR = range({ min: 0, max: 92, value: 20, label: 'Estabilizador', onInput: (v) => state.setBrush({ smoothing: v / 100 }) });
  const flowR = range({ min: 1, max: 100, value: 100, label: 'Fluxo', onInput: (v) => state.setBrush({ flow: v / 100 }) });
  const fSize = field('Tamanho', sizeR), fOpac = field('Opacidade', opacR), fHard = field('Dureza', hardR), fSmooth = field('Estabilizador', smoothR), fFlow = field('Fluxo', flowR);
  const pressChk = toggle('Pressão da caneta muda o tamanho', true, (v) => state.setBrush({ pressureSize: v }));
  const gridCheck = toggle('Mostrar grade', state.grid, (v) => { state.grid = v; syncToggles(); engine.requestRender(); });
  const symCheck = toggle('Simetria vertical (espelho)', state.symmetry, (v) => { state.symmetry = v; syncToggles(); engine.requestRender(); });
  const toolOptions = h('div.tooloptions');
  const brushBlock = h('div.brushblock', {}, presetList, fSize, fOpac, fHard, fFlow, fSmooth, pressChk);

  function buildToolOptions() {
    const t = state.tool, f = state.fill;
    const kids = [];
    if (t === 'balde') {
      const tol = range({ min: 0, max: 100, value: Math.round(f.tolerance * 100), label: 'Tolerância', onInput: (v) => { f.tolerance = v / 100; row1.readout.textContent = v + '%'; } });
      const grow = range({ min: 0, max: 6, value: f.grow, label: 'Expandir', onInput: (v) => { f.grow = v; row2.readout.textContent = v + ' px'; } });
      var row1 = field('Tolerância', tol, Math.round(f.tolerance * 100) + '%'), row2 = field('Expandir borda', grow, f.grow + ' px');
      kids.push(row1, row2, toggle('Só áreas conectadas', f.contiguous, (v) => { f.contiguous = v; }), toggle('Ler todas as camadas', f.sampleAll, (v) => { f.sampleAll = v; }));
    } else if (['linha', 'retangulo', 'elipse'].includes(t)) {
      if (t !== 'linha') kids.push(h('div.field', {}, h('span.flabel', {}, 'Estilo'), segmented([['stroke', 'Contorno'], ['fill', 'Cheio'], ['both', 'Ambos']], state.shapeMode, (v) => { state.shapeMode = v; })));
      kids.push(h('p.hint', {}, 'A espessura da linha segue o tamanho do pincel.'));
    } else if (t === 'degrade') {
      kids.push(h('div.field', {}, h('span.flabel', {}, 'Termina em'), segmented([['color2', 'Cor secundária'], ['transparent', 'Transparente']], state.gradientMode || 'color2', (v) => { state.gradientMode = v; })));
      kids.push(h('p.hint', {}, 'Arraste na tela para definir o início e o fim.'));
    } else if (t === 'texto') {
      const font = h('select', { 'aria-label': 'Fonte', onchange: () => { state.text.font = font.value; } }, ...Object.keys(FONTS).map((k) => h('option', { value: k, selected: k === state.text.font }, { sans: 'Sem serifa', serif: 'Com serifa', mono: 'Monoespaçada', manuscrita: 'Manuscrita' }[k])));
      const size = range({ min: 8, max: 400, value: state.text.size, label: 'Tamanho do texto', onInput: (v) => { state.text.size = v; rs.readout.textContent = v + ' px'; } });
      var rs = field('Tamanho', size, state.text.size + ' px');
      kids.push(h('div.field', {}, h('span.flabel', {}, 'Fonte'), font), rs, toggle('Negrito', state.text.bold, (v) => { state.text.bold = v; }), toggle('Itálico', state.text.italic, (v) => { state.text.italic = v; }), h('p.hint', {}, 'Toque ou clique onde o texto deve começar.'));
    } else if (t === 'borracha') {
      kids.push(h('p.hint', {}, 'A borracha apaga o desenho da camada e deixa aparecer o papel por baixo. A cor do papel muda na aba Camadas.'));
    } else if (t === 'selecao') {
      kids.push(h('p.hint', {}, 'Arraste para selecionar. Pincel, balde e borracha passam a agir só dentro da seleção.'));
    } else if (t === 'mover') {
      kids.push(h('p.hint', {}, 'Move a camada ativa, ou só o que está dentro da seleção.'));
    } else if (t === 'gotas') {
      kids.push(h('p.hint', {}, 'Toque em qualquer ponto para copiar a cor. Com o pincel, use Alt + clique.'));
    }
    toolOptions.replaceChildren(...kids);
    brushBlock.hidden = !['pincel', 'borracha'].includes(t) && !['linha', 'retangulo', 'elipse'].includes(t);
    const isShape = ['linha', 'retangulo', 'elipse'].includes(t);
    [fOpac, fHard, fFlow, fSmooth, pressChk].forEach((el) => { el.hidden = isShape; });
    presetList.hidden = isShape;
  }
  function syncBrush() {
    const b = state.brush;
    sizeR.set(sizeToPos(b.size)); fSize.readout.textContent = b.size + ' px';
    opacR.set(Math.round(b.opacity * 100)); fOpac.readout.textContent = Math.round(b.opacity * 100) + '%';
    hardR.set(Math.round(b.hardness * 100)); fHard.readout.textContent = Math.round(b.hardness * 100) + '%';
    flowR.set(Math.round(b.flow * 100)); fFlow.readout.textContent = Math.round(b.flow * 100) + '%';
    smoothR.set(Math.round(b.smoothing * 100)); fSmooth.readout.textContent = Math.round(b.smoothing * 100) + '%';
    pressChk.input.checked = b.pressureSize;
    for (const [id, btn] of presetBtns) btn.setAttribute('aria-pressed', String(id === 'borracha' ? state.tool === 'borracha' : state.tool !== 'borracha' && id === state.presetId));
    syncQuick();
  }
  const secBrush = h('section.sec.sec-tool', { 'aria-label': 'Ferramenta' }, h('h3', {}, 'Ferramenta'), brushBlock, toolOptions,
    h('div.togglegroup', {}, symCheck, gridCheck));

  // ---------- seção: camadas ----------
  const layerList = h('ul.layerlist', { role: 'listbox', 'aria-label': 'Camadas' });
  const lOpac = range({ min: 0, max: 100, value: 100, label: 'Opacidade da camada' });
  const lOpacField = field('Opacidade', lOpac, '100%');
  const blendSel = h('select', { 'aria-label': 'Modo de mistura' }, ...BLEND_MODES.map(([v, n]) => h('option', { value: v }, n)));
  const refChk = toggle('Esta camada é a foto da mesa de luz', false, (v) => { if (doc.active) doc.setReference(doc.active, v); });
  const layerMeta = h('div.layermeta', {}, lOpacField, h('label.field', {}, h('span.flabel', {}, 'Mistura'), blendSel), refChk);
  const thumbs = new Map();
  let opacBefore = null;
  lOpac.addEventListener('pointerdown', () => { const l = doc.active; if (l) opacBefore = l.opacity; });
  lOpac.addEventListener('input', () => {
    const l = doc.active; if (!l) return;
    if (opacBefore == null) opacBefore = l.opacity;
    l.opacity = Number(lOpac.value) / 100; lOpacField.readout.textContent = lOpac.value + '%';
    doc.metaDirty = true; doc.emit('render'); doc.emit('modified', { structure: true });
  });
  lOpac.addEventListener('change', () => {
    const l = doc.active; if (!l || opacBefore == null) return;
    const before = opacBefore, after = l.opacity; opacBefore = null;
    if (before !== after) doc.pushHistory({ cost: 0, undo: () => { l.opacity = before; doc.changed({ structure: true }); }, redo: () => { l.opacity = after; doc.changed({ structure: true }); } });
  });
  blendSel.addEventListener('change', () => { const l = doc.active; if (l) doc.setLayerProps(l, { blend: blendSel.value }); });

  function drawThumb(layer) {
    const c = thumbs.get(layer.id); if (!c) return;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / doc.width, c.height / doc.height), w = doc.width * k, hh = doc.height * k;
    g.fillStyle = '#d9d9d9'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'medium'; g.drawImage(layer.canvas, (c.width - w) / 2, (c.height - hh) / 2, w, hh);
  }
  function renameLayer(layer, li) {
    const input = h('input.rename', { value: layer.name, maxLength: 60, 'aria-label': 'Nome da camada' });
    const done = (ok) => { if (ok && input.value.trim() && input.value !== layer.name) doc.setLayerProps(layer, { name: input.value.trim() }); else renderLayers(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    const old = li.querySelector('.lname'); old.replaceWith(input); input.focus(); input.select();
  }
  function renderLayers() {
    thumbs.clear();
    const rows = [...doc.layers].reverse().map((l) => {
      const th = h('canvas.lthumb', { width: 44, height: 34 }); thumbs.set(l.id, th);
      const li = h('li.layer', { role: 'option', 'aria-selected': String(l.id === doc.activeId), dataset: { id: l.id } },
        h('button.ibtn.sm', { type: 'button', title: l.visible ? 'Ocultar camada' : 'Mostrar camada', 'aria-label': l.visible ? 'Ocultar camada' : 'Mostrar camada', 'aria-pressed': String(!l.visible), onclick: (e) => { e.stopPropagation(); doc.setLayerProps(l, { visible: !l.visible }); }, html: l.visible ? icon.eye : icon.eyeOff }),
        h('div.lbody', { onclick: () => { if (doc.activeId === l.id) renameLayer(l, li); else doc.setActive(l.id); } }, th, h('span.lname', { title: 'Toque de novo para renomear' }, l.name), l.ref ? h('span.badge', { title: 'Foto da mesa de luz' }, 'foto') : null),
        h('button.ibtn.sm', { type: 'button', title: l.locked ? 'Desbloquear camada' : 'Bloquear camada', 'aria-label': l.locked ? 'Desbloquear camada' : 'Bloquear camada', 'aria-pressed': String(l.locked), onclick: (e) => { e.stopPropagation(); doc.setLayerProps(l, { locked: !l.locked }); }, html: l.locked ? icon.lock : icon.unlock }));
      if (!l.visible) li.classList.add('hidden');
      if (l.id === doc.activeId) li.classList.add('active');
      return li;
    });
    layerList.replaceChildren(...rows);
    doc.layers.forEach(drawThumb);
    const a = doc.active;
    if (a) { lOpac.set(Math.round(a.opacity * 100)); lOpacField.readout.textContent = Math.round(a.opacity * 100) + '%'; blendSel.value = a.blend; }
    refChk.input.checked = !!a?.ref; syncSheet();
    const i = doc.activeIndex;
    btnUp.disabled = i >= doc.layers.length - 1; btnDown.disabled = i <= 0; btnMerge.disabled = i <= 0;
    btnDel.disabled = doc.layers.length <= 1; btnAdd.disabled = btnDup.disabled = doc.layers.length >= MAX_LAYERS;
  }
  const btnAdd = iconBtn('plus', 'Nova camada', () => doc.addLayer());
  const btnDup = iconBtn('copy', 'Duplicar camada', () => doc.duplicateLayer());
  const btnUp = iconBtn('up', 'Subir camada', () => doc.moveLayer(1));
  const btnDown = iconBtn('down', 'Descer camada', () => doc.moveLayer(-1));
  const btnMerge = iconBtn('merge', 'Mesclar com a camada de baixo', () => { if (!doc.mergeDown()) toast('Não dá para mesclar: a camada de baixo está bloqueada ou não existe.'); });
  const btnClear = iconBtn('clear', 'Limpar camada', () => { if (doc.active?.locked) toast('Esta camada está bloqueada.'); else doc.clearLayer(); });
  const btnDel = iconBtn('trash', 'Excluir camada', () => doc.deleteLayer(), 'danger');
  const secLayers = h('section.sec.sec-layers', { 'aria-label': 'Camadas' },
    h('div.sechead', {}, h('h3', {}, 'Camadas'), h('div.group', {}, btnAdd, btnDup, btnUp, btnDown, btnMerge, btnClear, btnDel)),
    layerList, layerMeta);
  const refreshThumbs = debounce(() => doc.layers.forEach((l) => { if (l._thumbVer !== l.ver) { l._thumbVer = l.ver; drawThumb(l); } }), 250);

  // ---------- seção: papel, foto e mesa de luz ----------
  const paperInput = h('input', { type: 'color', value: doc.paper || '#ffffff', 'aria-label': 'Cor do papel' });
  const paperText = h('span.readout', {}, '');
  let paperBefore;
  paperInput.addEventListener('input', () => {
    if (paperBefore === undefined) paperBefore = doc.paper;
    doc.paper = paperInput.value; doc.metaDirty = true; paperText.textContent = doc.paper; doc.emit('render'); doc.emit('modified', { structure: true });
  });
  paperInput.addEventListener('change', () => {
    const b = paperBefore, a = doc.paper; paperBefore = undefined;
    if (b !== a) doc.pushHistory({ cost: 0, undo: () => { doc.paper = b; doc.changed({ structure: true }); }, redo: () => { doc.paper = a; doc.changed({ structure: true }); } });
  });
  const fundoBtn = h('button.btn.sm', { type: 'button', onclick: () => { const r = doc.fundoToPaper(); toast(r === 'ok' ? 'A camada Fundo virou o papel. Agora a borracha mostra essa cor.' : 'A camada Fundo tem desenho ou mais de uma cor, então não dá para converter.'); } }, 'Transformar a camada Fundo em papel');
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let pendingRef = false;
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importPhoto(doc, f, { asRef: pendingRef }); });
  const pickPhoto = (ref) => { pendingRef = ref; fileIn.click(); };
  const lightChk = toggle('Mesa de luz ligada', false, (v) => doc.setSheet({ light: { on: v } }));
  const veilR = range({ min: 0, max: 95, value: 60, label: 'Papel sobre a foto', onInput: (v) => { doc.light.veil = v / 100; veilField.readout.textContent = v + '%'; doc.metaDirty = true; doc.emit('render'); doc.emit('modified', { structure: true }); } });
  const veilField = field('Papel sobre a foto', veilR, '60%');
  const expChk = toggle('Incluir a foto ao exportar', false, (v) => { doc.light.exportRef = v; doc.metaDirty = true; doc.emit('modified', { structure: true }); });
  const lightBox = h('div.lightbox', {}, lightChk, veilField, expChk, h('p.hint', {}, 'A foto fica embaixo e o papel fica por cima, mais ou menos transparente. Desenhe nas camadas de cima, como numa mesa de luz.'));
  function syncSheet() {
    paperInput.value = doc.paper || '#ffffff'; paperText.textContent = doc.paper || 'transparente';
    fundoBtn.hidden = !doc.layers.some((l) => /^fundo$/i.test(l.name));
    lightBox.hidden = !doc.hasRef;
    lightChk.input.checked = doc.light.on; veilR.set(Math.round(doc.light.veil * 100)); veilField.readout.textContent = Math.round(doc.light.veil * 100) + '%'; expChk.input.checked = doc.light.exportRef;
  }
  const secPaper = h('section.sec.sec-layers.sec-paper', { 'aria-label': 'Papel e foto' },
    h('h3', {}, 'Papel e foto'),
    h('div.field', {}, h('span.flabel', {}, 'Cor do papel'), h('div.bgrow', {}, paperInput, h('button.btn.sm', { type: 'button', onclick: () => doc.setSheet({ paper: '#ffffff' }) }, 'Branco'), h('button.btn.sm', { type: 'button', onclick: () => doc.setSheet({ paper: null }) }, 'Transparente')), paperText),
    fundoBtn,
    h('div.bgrow', {}, h('button.btn.sm', { type: 'button', onclick: () => pickPhoto(false) }, 'Inserir foto…'), h('button.btn.sm', { type: 'button', onclick: () => pickPhoto(true) }, 'Foto para decalcar…'), h('button.btn.sm', { type: 'button', onclick: () => openAdjust(doc) }, 'Ajustar imagem…')),
    fileIn, lightBox);

  // ---------- painel e folhas (celular) ----------
  const panel = h('aside.panel', {}, h('div.grab', { onclick: () => toggleSheet('') }, h('span')), secColor, secBrush, secPaper, secLayers);
  const dock = h('nav.dock', { 'aria-label': 'Painéis' },
    h('button', { type: 'button', dataset: { sheet: 'color' }, onclick: () => toggleSheet('color') }, h('span.dot'), 'Cor'),
    h('button', { type: 'button', dataset: { sheet: 'tool' }, onclick: () => toggleSheet('tool'), html: icon.sliders + '<span>Pincel</span>' }),
    h('button', { type: 'button', dataset: { sheet: 'layers' }, onclick: () => toggleSheet('layers'), html: icon.layers + '<span>Camadas</span>' }));
  const editor = h('div.editor', { dataset: { sheet: '' } });
  function toggleSheet(name) { editor.dataset.sheet = editor.dataset.sheet === name ? '' : name; dockBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === editor.dataset.sheet))); requestAnimationFrame(() => engine.resize()); }
  const dockBtns = [...dock.querySelectorAll('button')];

  // ---------- controles rápidos no celular ----------
  const qSize = range({ min: 0, max: 1000, value: 0, label: 'Tamanho do pincel', onInput: (v) => state.setBrush({ size: posToSize(v) }) });
  const qOpac = range({ min: 1, max: 100, value: 100, label: 'Opacidade do pincel', onInput: (v) => state.setBrush({ opacity: v / 100 }) });
  const qTip = h('div.qtip');
  const quick = h('div.quick', {}, h('div.qcol', {}, qSize, h('span', {}, 'T')), h('div.qcol', {}, qOpac, h('span', {}, 'O')), qTip);
  function syncQuick() {
    const b = state.brush; qSize.set(sizeToPos(b.size)); qOpac.set(Math.round(b.opacity * 100));
    quick.hidden = !['pincel', 'borracha', 'linha', 'retangulo', 'elipse'].includes(state.tool);
  }
  let tipTimer;
  [qSize, qOpac].forEach((el) => el.addEventListener('input', () => {
    const b = state.brush; qTip.textContent = `${b.size}px · ${Math.round(b.opacity * 100)}%`; qTip.classList.add('on');
    clearTimeout(tipTimer); tipTimer = setTimeout(() => qTip.classList.remove('on'), 900);
  }));

  // barra de ações da seleção
  const selBar = h('div.selbar', { hidden: true }, h('button.btn.sm', { onclick: () => engine.fillSelection() }, 'Preencher'), h('button.btn.sm', { onclick: () => engine.clearSelection() }, 'Apagar conteúdo'), h('button.btn.sm', { onclick: () => engine.deselect() }, 'Desmarcar'));
  const gestureHint = h('div.zoomhud', { hidden: true });
  stage.append(selBar, gestureHint);

  editor.append(topbar, rail, stage, quick, panel, dock);
  root.replaceChildren(editor);

  // ---------- ligações ----------
  const subs = [];
  const sub = (target, type, fn) => { target.addEventListener(type, fn); subs.push(() => target.removeEventListener(type, fn)); };
  sub(state, 'tool', () => { syncTools(); buildToolOptions(); syncBrush(); stage.dataset.tool = state.tool; });
  sub(state, 'brush', syncBrush);
  sub(state, 'color', syncColor);
  sub(state, 'recent', syncRecent);
  sub(doc, 'layers', renderLayers);
  sub(doc, 'modified', () => refreshThumbs());
  sub(doc, 'history', () => { undoBtn.disabled = !doc.canUndo; redoBtn.disabled = !doc.canRedo; });
  sub(doc, 'selection', () => { selBar.hidden = !doc.selection; });
  let hudTimer;
  sub(engine, 'view', (e) => {
    zoomLabel.textContent = Math.round(e.detail.zoom * 100) + '%';
    const deg = Math.round(((e.detail.rot * 180) / Math.PI) % 360);
    gestureHint.textContent = `${Math.round(e.detail.zoom * 100)}%${deg ? ` · ${deg}°` : ''}`;
    gestureHint.hidden = false; clearTimeout(hudTimer); hudTimer = setTimeout(() => { gestureHint.hidden = true; }, 700);
  });
  gestureHint.hidden = true;

  syncTools(); buildToolOptions(); syncBrush(); syncColor(); syncRecent(); renderLayers(); syncToggles();
  undoBtn.disabled = true; redoBtn.disabled = true; stage.dataset.tool = state.tool;
  engine.addEventListener('text-request', (e) => openText(e.detail));

  // ---------- texto ----------
  function openText({ x, y }) {
    const ta = h('textarea', { rows: 3, placeholder: 'Digite o texto…', 'aria-label': 'Texto' });
    const m = modal('Adicionar texto', ta, [
      h('button.btn', { onclick: () => m.close() }, 'Cancelar'),
      h('button.btn.primary', { onclick: () => { engine.commitText({ text: ta.value, x, y }); m.close(); } }, 'Inserir'),
    ]);
  }

  // ---------- exportar ----------
  function openExport() {
    let fmt = 'png', scale = 1, withPaper = !!doc.paper, withRef = doc.light.exportRef;
    const info = h('p.hint');
    const upd = () => { info.textContent = `${Math.round(doc.width * scale)} × ${Math.round(doc.height * scale)} px`; };
    upd();
    const body = h('div.exportbody', {},
      h('div.field', {}, h('span.flabel', {}, 'Formato'), segmented([['png', 'PNG (com transparência)'], ['jpeg', 'JPG (fundo sólido)']], fmt, (v) => { fmt = v; })),
      h('div.field', {}, h('span.flabel', {}, 'Tamanho'), segmented([[0.5, '½×'], [1, '1×'], [2, '2×']], scale, (v) => { scale = v; upd(); })),
      doc.paper ? toggle('Incluir a cor do papel (no PNG)', withPaper, (v) => { withPaper = v; }) : null,
      doc.hasRef ? toggle('Incluir a foto da mesa de luz', withRef, (v) => { withRef = v; }) : null, info);
    const m = modal('Exportar imagem', body, [
      h('button.btn', { onclick: () => m.close() }, 'Cancelar'),
      navigator.canShare ? h('button.btn', { onclick: async () => { const f = await makeFile(); if (f && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); m.close(); } catch {} } else toast('Compartilhar não está disponível aqui. Use Baixar.'); } }, 'Compartilhar') : null,
      h('button.btn.primary', { onclick: async () => { const f = await makeFile(); if (!f) return; const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); m.close(); } }, 'Baixar'),
    ]);
    async function makeFile() {
      try {
        const max = 8192, k = Math.min(scale, max / Math.max(doc.width, doc.height));
        const c = doc.flatten({ background: fmt === 'jpeg' ? (doc.paper || '#ffffff') : (withPaper ? doc.paper : null), scale: k, includeRef: withRef });
        const blob = await canvasToBlob(c, fmt === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92);
        const safe = (doc.name || 'desenho').replace(/[^\p{L}\p{N}_ -]+/gu, '').trim().replace(/\s+/g, '-') || 'desenho';
        return new File([blob], `${safe}.${fmt === 'jpeg' ? 'jpg' : 'png'}`, { type: blob.type });
      } catch (e) { toast('Não foi possível exportar: ' + e.message, 'err'); return null; }
    }
  }

  // ---------- atalhos de teclado ----------
  const onKey = (e) => {
    const tag = document.activeElement?.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && !(tag === 'INPUT' && document.activeElement.type === 'range')) return;
    if (document.querySelector('.modal-back')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doc.redo() : doc.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); doc.redo(); return; }
    if (mod && k === 's') { e.preventDefault(); saver.flush(); return; }
    if (mod && k === 'a') { e.preventDefault(); engine.selectAll(); return; }
    if (mod && k === 'd') { e.preventDefault(); engine.deselect(); return; }
    if (mod && k === '0') { e.preventDefault(); engine.fit(); return; }
    if (mod) return;
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); engine.clearSelection(); return; }
    if (k === 'escape') { engine.deselect(); return; }
    if (k === '[' || k === ']') { const b = state.brush; const f = k === ']' ? 1.15 : 1 / 1.15; state.setBrush({ size: clamp(Math.round(b.size * f + (k === ']' ? 1 : -1)), 1, SIZE_MAX) }); return; }
    if (k === '+' || k === '=') { engine.zoomCenter(1.25); return; }
    if (k === '-') { engine.zoomCenter(0.8); return; }
    if (k === 'x') { state.swapColors(); return; }
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t) state.setTool(t.id);
  };
  window.addEventListener('keydown', onKey);

  const stopPrevent = (e) => { if (e.target.closest?.('.stage')) e.preventDefault(); };
  document.addEventListener('gesturestart', stopPrevent);

  return {
    engine,
    destroy() {
      subs.forEach((f) => f());
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('gesturestart', stopPrevent);
      saver.removeEventListener('status', onStatus);
      engine.destroy();
    },
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Cria elementos: h('button.btn', {onclick}, 'texto' | Node | [..]) */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

export function toast(msg, kind = '') {
  const t = h('div.toast' + (kind ? '.' + kind : ''), {}, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

export const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);

export function relTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.floor(s / 86400)} d`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

export function uid(n = 8) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join('');
}

export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

export function canvasToBlob(canvas, type = 'image/png', q) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('falha ao exportar imagem'))), type, q));
}
export function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** Diálogo modal simples. Retorna { close, el }. */
export function modal(title, body, actions = []) {
  const back = h('div.modal-back');
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h2', {}, title), body,
    h('div.modal-actions', {}, actions));
  back.append(box);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  const first = box.querySelector('input,textarea,select,button.primary');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, el: box };
}

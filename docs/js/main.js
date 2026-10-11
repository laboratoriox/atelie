// Roteamento, login por carteira e galeria.
import { api, setUnauthorizedHandler } from './api.js';
import { startDiscovery, listWallets, signIn, deepLinks, isMobile, WalletError } from './wallet.js';
import { h, $, toast, modal, shortAddr, relTime } from './util.js';
import { icon } from './icons.js';
import { newDocFromOptions } from './editor/doc.js';
import { loadDoc, Saver } from './editor/persist.js';
import { mountEditor } from './editor/ui.js';
import { state } from './editor/state.js';

const app = $('#app');
let session = null;     // { address }
let editorHandle = null;

startDiscovery();
setUnauthorizedHandler(() => { session = null; teardownEditor(); location.hash = '#/'; render(); });

function teardownEditor() {
  if (editorHandle) { editorHandle.destroy(); editorHandle = null; }
}

// ---------------- login ----------------
function renderLogin() {
  teardownEditor();
  const status = h('p.login-status', { role: 'status' });
  const walletsBox = h('div.wallets');
  const help = h('div.login-help');

  async function connect(provider, btn) {
    status.textContent = ''; status.classList.remove('err');
    btn?.setAttribute('aria-busy', 'true');
    try {
      status.textContent = 'Confirme a assinatura na sua carteira…';
      const address = await signIn(provider);
      session = { address };
      render();
    } catch (e) {
      status.textContent = e instanceof WalletError || e?.status ? e.message : 'Não foi possível entrar. Tente de novo.';
      status.classList.add('err');
    } finally { btn?.removeAttribute('aria-busy'); }
  }

  function drawWallets() {
    const wallets = listWallets();
    walletsBox.replaceChildren();
    help.replaceChildren();
    if (wallets.length) {
      wallets.forEach((w) => {
        const b = h('button.wallet', { type: 'button', onclick: () => connect(w.provider, b) },
          w.icon ? h('img', { src: w.icon, alt: '', width: 28, height: 28 }) : h('span.wicon', { html: icon.wallet }),
          h('span', {}, `Entrar com ${w.name}`));
        walletsBox.append(b);
      });
    } else if (isMobile()) {
      help.append(h('p', {}, 'Para entrar no celular, abra esta página dentro do navegador da sua carteira:'),
        h('div.wallets', {}, ...deepLinks().map((l) => h('a.wallet', { href: l.href }, h('span.wicon', { html: icon.wallet }), h('span', {}, `Abrir no ${l.name}`)))),
        h('p.hint', {}, 'Se você já está no navegador da carteira e nada apareceu, feche e abra o app de novo.'));
    } else {
      help.append(h('p', {}, 'Nenhuma carteira foi encontrada neste navegador.'),
        h('p.hint', {}, 'Instale uma extensão de carteira, como a ', h('a', { href: 'https://metamask.io/download/', target: '_blank', rel: 'noopener noreferrer' }, 'MetaMask'), ', recarregue a página e volte aqui.'));
    }
  }
  drawWallets();
  setTimeout(drawWallets, 500); // algumas carteiras anunciam depois que a página carrega

  app.replaceChildren(h('main.login', {},
    h('div.login-card', {},
      h('a.back-site', { href: '../' }, h('span.ic', { html: icon.back }), 'Início'),
      h('h1.wordmark', {}, 'Ateliê'),
      h('div', { html: '<svg class="flourish" viewBox="0 0 320 40" aria-hidden="true"><path pathLength="1" d="M4 28 C 58 4, 108 42, 168 18 S 268 4, 316 22"/></svg>' }),
      h('p.login-lead', {}, 'Seu estúdio de desenho no navegador. Entre com sua carteira para continuar seus desenhos em qualquer aparelho.'),
      walletsBox, help, status,
      h('p.fineprint', {}, 'A carteira serve só para provar que o endereço é seu. Você assina uma mensagem sem custo; não pedimos senha, frase secreta nem transações, e só guardamos seu endereço público e seus desenhos.'))));
}

// ---------------- galeria ----------------
async function renderGallery() {
  teardownEditor();
  const grid = h('div.cards', { 'aria-busy': 'true' });
  const header = h('header.gal-top', {},
    h('a.back-site', { href: '../', title: 'Voltar ao início do site' }, h('span.ic', { html: icon.back }), 'Início'),
    h('h1.wordmark.sm', {}, 'Ateliê'),
    h('div.spacer'),
    h('button.chip-user', { type: 'button', title: 'Sair', onclick: logout }, h('span', {}, shortAddr(session.address)), h('span.ic', { html: icon.logout })));
  app.replaceChildren(h('div.gallery', {}, header, h('main.gal-main', {},
    h('div.gal-head', {}, h('h2', {}, 'Seus desenhos'), h('button.btn.primary', { type: 'button', onclick: openNew }, h('span.ic', { html: icon.plus }), 'Novo desenho')),
    grid)));

  let list = [];
  try { list = (await api.list()).drawings; } catch (e) { toast(e.message, 'err'); }
  grid.removeAttribute('aria-busy');
  if (!list.length) {
    grid.replaceChildren(h('div.empty', {}, h('p', {}, 'Você ainda não tem desenhos.'), h('button.btn.primary', { type: 'button', onclick: openNew }, 'Criar o primeiro desenho')));
    return;
  }
  const lazyThumb = (d) => {
    if (d.thumb) return h('img', { src: d.thumb, alt: '', loading: 'lazy' });
    const holder = h('span.noimg', {}, '…');
    api.thumb(d.id).then((r) => { holder.replaceWith(r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span.noimg', {}, 'Sem miniatura')); }).catch(() => { holder.textContent = 'Sem miniatura'; });
    return holder;
  };
  grid.replaceChildren(...list.map((d) => h('article.card', {},
    h('a.thumb', { href: `#/d/${d.id}`, 'aria-label': `Abrir ${d.name}` }, lazyThumb(d)),
    h('div.cardinfo', {}, h('a.cname', { href: `#/d/${d.id}` }, d.name), h('span.cmeta', {}, `${d.width}×${d.height} · ${relTime(d.updatedAt)}`)),
    h('button.ibtn.del', { type: 'button', title: 'Excluir desenho', 'aria-label': `Excluir ${d.name}`, onclick: () => confirmDelete(d), html: icon.trash }))));
}

function confirmDelete(d) {
  const m = modal('Excluir este desenho?', h('p', {}, `“${d.name}” será apagado de todos os seus aparelhos. Não dá para desfazer.`), [
    h('button.btn', { onclick: () => m.close() }, 'Cancelar'),
    h('button.btn.danger', { onclick: async () => { m.close(); try { await api.remove(d.id); toast('Desenho excluído.'); renderGallery(); } catch (e) { toast(e.message, 'err'); } } }, 'Excluir'),
  ]);
}

const PRESETS = [
  ['Tela 1920 × 1080', 1920, 1080], ['Quadrado 2048', 2048, 2048], ['A4 retrato (300 dpi)', 2480, 3508],
  ['A4 paisagem (300 dpi)', 3508, 2480], ['Ilustração 3000 × 2000', 3000, 2000], ['Quadrinho 1600 × 2400', 1600, 2400],
];
const MAX_SIDE = 4096, MAX_PIXELS = 16_000_000;

function openNew() {
  let w = 2048, hgt = 1536, bg = '#ffffff', bgMode = 'white';
  const name = h('input', { value: 'Sem título', maxLength: 80, 'aria-label': 'Nome' });
  const wIn = h('input', { type: 'number', value: w, min: 64, max: MAX_SIDE, inputMode: 'numeric', 'aria-label': 'Largura em pixels' });
  const hIn = h('input', { type: 'number', value: hgt, min: 64, max: MAX_SIDE, inputMode: 'numeric', 'aria-label': 'Altura em pixels' });
  const msg = h('p.hint');
  const check = () => {
    w = Math.round(Number(wIn.value)); hgt = Math.round(Number(hIn.value));
    const ok = w >= 64 && hgt >= 64 && w <= MAX_SIDE && hgt <= MAX_SIDE && w * hgt <= MAX_PIXELS;
    msg.textContent = ok ? `${((w * hgt) / 1e6).toFixed(1)} megapixels` : `Use de 64 a ${MAX_SIDE} px por lado, com no máximo ${MAX_PIXELS / 1e6} megapixels no total (limite dos navegadores de celular).`;
    msg.classList.toggle('err', !ok); create.disabled = !ok; return ok;
  };
  const presets = h('div.presetgrid', {}, ...PRESETS.map(([label, pw, ph]) => h('button.btn.sm', { type: 'button', onclick: () => { wIn.value = pw; hIn.value = ph; check(); } }, label)));
  const colorIn = h('input', { type: 'color', value: '#ffffff', 'aria-label': 'Cor de fundo', oninput: () => { bg = colorIn.value; bgMode = 'color'; setBg('color'); } });
  const bgBtns = {};
  const setBg = (m) => { bgMode = m; Object.entries(bgBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(k === m))); };
  bgBtns.white = h('button.btn.sm', { type: 'button', onclick: () => { bg = '#ffffff'; setBg('white'); } }, 'Branco');
  bgBtns.transparent = h('button.btn.sm', { type: 'button', onclick: () => setBg('transparent') }, 'Transparente');
  bgBtns.color = h('button.btn.sm', { type: 'button', onclick: () => { bg = colorIn.value; setBg('color'); } }, 'Cor');
  setBg('white');
  wIn.addEventListener('input', check); hIn.addEventListener('input', check);
  const create = h('button.btn.primary', { type: 'button', onclick: () => {
    if (!check()) return;
    const doc = newDocFromOptions({ name: name.value.trim() || 'Sem título', width: w, height: hgt, background: bgMode === 'transparent' ? null : bg });
    pendingDoc = doc; m.close(); location.hash = '#/novo';
  } }, 'Criar');
  const body = h('div.newform', {},
    h('label.field.col', {}, h('span.flabel', {}, 'Nome'), name),
    h('div.flabel', {}, 'Tamanho da tela'), presets,
    h('div.dims', {}, h('label.field.col', {}, h('span.flabel', {}, 'Largura (px)'), wIn), h('span.times', {}, '×'), h('label.field.col', {}, h('span.flabel', {}, 'Altura (px)'), hIn)), msg,
    h('div.flabel', {}, 'Fundo'), h('div.bgrow', {}, bgBtns.white, bgBtns.transparent, bgBtns.color, colorIn));
  const m = modal('Novo desenho', body, [h('button.btn', { onclick: () => m.close() }, 'Cancelar'), create]);
  check();
}

let pendingDoc = null;

// ---------------- editor ----------------
async function renderEditor(id) {
  teardownEditor();
  app.replaceChildren(h('div.loading', { role: 'status' }, 'Abrindo desenho…'));
  let doc;
  try {
    if (id === null) { doc = pendingDoc; pendingDoc = null; if (!doc) { location.hash = '#/'; return; } }
    else doc = await loadDoc(id);
  } catch (e) {
    toast(e.status === 404 ? 'Desenho não encontrado.' : e.message, 'err'); location.hash = '#/'; return;
  }
  const saver = new Saver(doc);
  const root = h('div.editor-root');
  app.replaceChildren(root);
  const exit = async () => {
    await saver.flush();
    if (saver.status === 'saving') await new Promise((r) => saver.addEventListener('status', () => saver.status !== 'saving' && r(), { once: true }));
    location.hash = '#/';
  };
  const handle = mountEditor(root, doc, saver, { onExit: exit });
  // ao sair da tela (voltar, trocar de rota), tenta enviar o que ainda não foi salvo
  editorHandle = { destroy() { saver.flush(); handle.destroy(); saver.destroy(); } };
  if (id === null) { saver.flush(); } // cria o desenho no servidor logo de início
}

async function logout() {
  try { await api.logout(); } catch {}
  session = null; render();
}

// ---------------- roteador ----------------
async function render() {
  if (!session) {
    try { session = await api.me(); } catch { session = null; }
  }
  if (!session) return renderLogin();
  const hash = location.hash;
  let m;
  if ((m = /^#\/d\/([a-f0-9]{16})$/.exec(hash))) return renderEditor(m[1]);
  if (hash === '#/novo') return renderEditor(null);
  return renderGallery();
}
window.addEventListener('hashchange', render);
render();

// Conexão com carteiras Ethereum (EIP-1193 / EIP-6963). Só usamos a carteira para
// provar a posse do endereço assinando uma mensagem — nenhuma transação é pedida.
import { api } from './api.js';

const found = new Map(); // uuid -> { info, provider }

export function startDiscovery() {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const { info, provider } = e.detail || {};
    if (info?.uuid && provider) found.set(info.uuid, { info, provider });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Lista as carteiras disponíveis neste navegador. */
export function listWallets() {
  const out = [...found.values()].map(({ info, provider }) => ({ name: info.name, icon: info.icon, provider }));
  if (!out.length && window.ethereum) {
    const providers = Array.isArray(window.ethereum.providers) ? window.ethereum.providers : [window.ethereum];
    providers.forEach((p, i) => out.push({
      name: p.isMetaMask ? 'MetaMask' : p.isTrust || p.isTrustWallet ? 'Trust Wallet' : p.isCoinbaseWallet ? 'Coinbase Wallet' : providers.length > 1 ? `Carteira ${i + 1}` : 'Carteira do navegador',
      icon: null, provider: p,
    }));
  }
  return out;
}

const toHex = (str) => '0x' + [...new TextEncoder().encode(str)].map((b) => b.toString(16).padStart(2, '0')).join('');

export class WalletError extends Error {}

/** Conecta, pede a assinatura e abre a sessão no servidor. Devolve o endereço. */
export async function signIn(provider) {
  let accounts;
  try {
    accounts = await provider.request({ method: 'eth_requestAccounts' });
  } catch (e) {
    throw new WalletError(e?.code === 4001 ? 'Você recusou a conexão com a carteira.' : 'Não foi possível conectar à carteira. Abra-a e tente de novo.');
  }
  const address = accounts?.[0];
  if (!address) throw new WalletError('Nenhuma conta disponível na carteira. Desbloqueie-a e tente de novo.');

  const { message, ticket } = await api.nonce(address);
  let signature;
  try {
    signature = await provider.request({ method: 'personal_sign', params: [toHex(message), address] });
  } catch (e) {
    if (e?.code === 4001) throw new WalletError('Você cancelou a assinatura. Nada foi enviado nem cobrado.');
    // algumas carteiras só aceitam texto puro
    try { signature = await provider.request({ method: 'personal_sign', params: [message, address] }); }
    catch { throw new WalletError('A carteira não conseguiu assinar a mensagem.'); }
  }
  const res = await api.verify(address, message, signature, ticket);
  return res.address;
}

/** Links para abrir esta página dentro do navegador de uma carteira (celular). */
export function deepLinks() {
  const url = location.href.split('#')[0];
  const noProto = url.replace(/^https?:\/\//, '');
  return [
    { name: 'MetaMask', href: `https://metamask.app.link/dapp/${noProto}` },
    { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}` },
    { name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  ];
}

export const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

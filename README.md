# Ateliê

App web de desenho com camadas, pincéis, balde, formas, texto, seleção e exportação PNG/JPG.
Funciona no computador (mouse) e no celular (toque, Android e iOS). O login é feito só assinando uma
mensagem com uma carteira cripto (sem senha, sem transação, sem custo) para continuar os desenhos em qualquer aparelho.

## Como funciona (hospedagem 100% gratuita)

- **Tela (site):** pasta `docs/`, publicada pelo **GitHub Pages**.
- **API (login + desenhos):** `worker/`, publicada num **Cloudflare Worker** (plano gratuito), com os desenhos guardados no **Workers KV**.

## Publicar passo a passo

### 1) Cloudflare (API)
1. Crie uma conta grátis em <https://dash.cloudflare.com> (dá para entrar com o Google; não pede cartão).
2. Menu **Storage & Databases → KV → Create** e crie um namespace chamado `atelie`.
3. Menu **Workers & Pages → Create → Start with Hello World** → nome `atelie-api` → **Deploy**.
4. Abra o Worker → **Edit code**, apague tudo, cole o conteúdo de `worker/worker.bundle.js` e clique em **Deploy**.
5. No Worker, vá em **Settings → Bindings → Add → KV namespace**: variável `ATELIE_KV`, namespace `atelie`.
6. Em **Settings → Variables and Secrets** adicione:
   - `SESSION_SECRET` (tipo *Secret*): texto aleatório longo (no terminal: `openssl rand -base64 48`).
   - `ALLOWED_ORIGIN` (tipo *Text*): o endereço do seu site, **sem barra no fim e sem o nome do repositório**, ex.: `https://SEU-USUARIO.github.io`.
7. Copie o endereço do Worker (algo como `https://atelie-api.SEU-SUBDOMINIO.workers.dev`).

### 2) GitHub Pages (site)
1. Edite `docs/config.js` e coloque o endereço do Worker: `window.ATELIE_API = 'https://atelie-api.SEU-SUBDOMINIO.workers.dev';`
2. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, pasta `/docs`** → Save.
3. Depois de ~1 minuto o site abre em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

## Limites do plano gratuito
- O KV gratuito permite cerca de **1.000 gravações por dia** (cada salvamento usa 2 a 3). O app só salva depois de alguns segundos parado e ao sair, mas uma sessão de desenho muito longa pode bater no limite; se acontecer, volta no dia seguinte.
- Cada camada (PNG) pode ter até **24 MB**. Telas muito grandes e cheias de detalhe podem passar disso.
- Para mais folga, ligue um bucket R2 como `ATELIE_R2` (exige cartão cadastrado, mas o uso pequeno continua dentro da cota gratuita).
- O Worker gratuito tem limite de CPU por requisição; o login foi otimizado e tenta de novo sozinho se falhar na primeira vez.

## Rodar no seu computador (sem Cloudflare)
```
npm start      # abre em http://localhost:3000 (usa server.js, com os dados na pasta data/)
npm test       # testes
```
Em produção fora da Cloudflare (ex.: Render/VPS), defina `PUBLIC_ORIGIN` com o endereço público (HTTPS).

## Estrutura
- `docs/` – site (HTML/JS/CSS). `docs/config.js` aponta para a API.
- `worker/` – API para Cloudflare (`index.js` é o código; `worker.bundle.js` é o arquivo único para colar no painel).
- `server.js` – API alternativa em Node (cookies, disco local) para rodar localmente ou em outro servidor.
- `lib/` – verificação de assinatura Ethereum (sem dependências) e testes.

Depois de mudar `worker/index.js` ou `lib/ethsig.js`, gere o arquivo único de novo:
`npx esbuild worker/index.js --bundle --format=esm --platform=neutral --outfile=worker/worker.bundle.js`

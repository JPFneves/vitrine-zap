<p align="center"><img src="icons/icone-192.png" width="88" alt=""></p>

<h1 align="center">Vitrine Zap</h1>

<p align="center">
  <strong>Catálogo digital com pedido pelo WhatsApp e cardápio de mesa por QR code.</strong><br>
  Um microSaaS em PWA para empórios, floriculturas, confeitarias e restaurantes.<br>
  Front-end estático no <strong>Netlify</strong> · banco, login e tempo real no <strong>Supabase</strong>.
</p>

<p align="center">
  <a href="https://vitrine-zap.netlify.app/">Ver online</a> ·
  <a href="docs/ATIVIDADE.md">Documento da atividade</a> ·
  <a href="#configurar-o-supabase">Configurar o Supabase</a> ·
  <a href="#publicar-no-netlify">Publicar no Netlify</a>
</p>

| Catálogo com sacola | Cardápio de mesa (QR) | Painel do lojista |
| :---: | :---: | :---: |
| <img src="docs/telas/celular-catalogo.png" width="240" alt="Catálogo do Empório da Serra no celular"> | <img src="docs/telas/celular-mesa.png" width="240" alt="Cardápio da mesa 7 do restaurante de exemplo"> | <img src="docs/telas/celular-painel.png" width="240" alt="Painel da floricultura de exemplo"> |

## A ideia

O pequeno comércio do interior vende pelo WhatsApp: o cliente pergunta preço, pede foto, manda “tem queijo?”, e
o pedido se perde no meio da conversa. No restaurante, o cardápio de papel desatualiza e o PDF ninguém abre.

O Vitrine Zap dá pra cada loja um **catálogo online** em que o cliente escolhe, monta a sacola e envia o pedido
**pronto no WhatsApp da loja** (itens, total, entrega ou retirada, endereço e pagamento). O mesmo catálogo vira
**cardápio de mesa**: um QR code por mesa, só pra ver, com o que acabou marcado.

O modelo é de **implantação assistida com mensalidade**: a Neves Tecnologia monta a loja e cria o acesso do
lojista; ele entra num **painel que instala como app** no celular, muda preço, marca o que acabou e vê os pedidos
chegando **ao vivo**. Não tem cadastro aberto pelo site. Sem comissão por pedido: mensalidade fixa, e quem atrasa
tem a loja pausada até acertar.

## O que tem aqui

| Página | Endereço | O que faz |
| --- | --- | --- |
| Landing page | `/` | Apresenta o produto, os dois modos, as lojas de exemplo, os planos e as dúvidas. |
| Catálogo | `/loja/?l=emporio-da-serra` | Busca, categorias, destaques, esgotados no fim, sacola guardada no aparelho, perguntas do pedido (data, cartão…) e envio pelo WhatsApp. |
| Cardápio de mesa | `/loja/?l=restaurante-tempero-da-serra&mesa=7` | O mesmo catálogo em lista, sem sacola: o pedido é com o garçom. |
| Painel | `/painel/` | Login do lojista (conta criada por você), criação da loja, produtos (com foto reduzida no aparelho), esgotar com um toque, pedidos ao vivo, QR codes das mesas para imprimir, entrega, pagamento e perguntas do pedido. |
| Painel de demonstração | `/painel/?demo=1` | O mesmo painel, sem conta, com as mudanças só no navegador: pra mostrar a quem ainda não é cliente (e pro professor). |

Lojas de exemplo (fictícias, vêm junto com o site): **Empório da Serra**, **Floricultura Bela Flor**,
**Restaurante Tempero da Serra** e **Doce Encanto Confeitaria**. Nelas o WhatsApp abre sem número, pra pessoa
escolher o contato: mande o pedido pra você mesmo e veja como ele chega.

### Dois modos

| | Modo demonstração | Com o Supabase |
| --- | --- | --- |
| Quando | `js/config.js` com as chaves em branco | `js/config.js` com a URL e a chave do projeto |
| Login | não tem | e-mail e senha que você cria no Supabase (sem cadastro pelo site) |
| Lojas e produtos | IndexedDB do navegador | tabela `lojas` no Supabase + cópia no aparelho |
| Link e QR da loja | abrem só no aparelho que criou | abrem em qualquer celular |
| Pedidos no painel | os feitos no mesmo navegador | de qualquer cliente, na hora (Realtime) |

## Configurar o Supabase

1. Crie um projeto grátis em [supabase.com](https://supabase.com).
2. Em **SQL Editor → New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em
   **Run**. Ele cria as tabelas `lojas` e `pedidos`, as regras de acesso (RLS) e liga o Realtime dos pedidos. Pode
   rodar de novo sempre que o arquivo mudar.
3. Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up** (ninguém cria conta pelo
   site) e deixe **Allow anonymous sign-ins** desligado.
4. Em **Project Settings → API Keys**, copie a **Project URL** e a chave **publishable** (ou a *anon public*) para
   [`js/config.js`](js/config.js). Ponha também o seu WhatsApp em `CONTATO_WHATSAPP`, pra onde vão os botões
   "Quero minha loja" e "Fale com a gente":

   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_CHAVE = 'sb_publishable_...';
   export const CONTATO_WHATSAPP = '5535999991234';
   ```

   Essa chave pode ficar no site: quem protege os dados são as regras do `schema.sql`. **Nunca** use a chave
   secreta (`service_role` ou `sb_secret_...`).

Regras de acesso: qualquer pessoa **lê** as lojas ativas (o catálogo é público); só o **dono** cria a loja e muda o
conteúdo dela, mas não consegue mudar o dono nem reativar uma loja pausada; qualquer cliente **envia** pedido pra
uma loja ativa, mas só o dono da loja **vê**, muda a situação e apaga.

## Cadastrar um cliente novo

1. No Supabase, **Authentication → Users → Add user → Create new user**: e-mail do cliente, uma senha e marque
   **Auto Confirm User**.
2. Entre no painel (`/painel/`) com esse e-mail e senha e crie a loja (do zero ou copiando uma de exemplo).
   Cadastre os produtos e as fotos, e imprima as plaquinhas em **QR codes**.
3. Mande o e-mail e a senha pro cliente: ele entra no mesmo painel (dá pra instalar como app) pra mudar preço,
   marcar o que acabou e ver os pedidos.
4. **Mensalidade atrasou?** Em **Table Editor → lojas**, mude a coluna `ativa` da loja para `false`: o catálogo sai
   do ar, para de receber pedidos e o painel do cliente mostra o aviso. Pagou, volte pra `true`.

## Publicar no Netlify

O site é estático: não tem build nem `npm install`. O jeito recomendado é ligar o Netlify ao repositório do
GitHub: cada `git push` publica o site sozinho.

1. Crie um repositório **vazio** no GitHub (sem README), por exemplo `vitrine-zap`.
2. Na pasta do projeto, envie o código (a primeira vez):

   ```bash
   git remote add origin https://github.com/SEU-USUARIO/vitrine-zap.git
   git push -u origin main
   ```

3. No Netlify:
   - **Site que já existe** (publicado antes arrastando a pasta): abra o site e, em **Site configuration →
     Build & deploy → Continuous deployment**, use **Link repository** e escolha o repositório. O endereço
     continua o mesmo.
   - **Site novo:** **Add new site → Import an existing project → GitHub** e escolha o repositório.

   Nos dois casos: **Branch** `main`, **Build command** vazio e **Publish directory** `.` (o `netlify.toml` já diz isso).
4. Depois, é só `git add .`, `git commit -m "..."` e `git push`: o Netlify publica em segundos.

Sem GitHub também dá: arraste a pasta em [app.netlify.com/drop](https://app.netlify.com/drop).

O [`_headers`](_headers) já cuida dos cabeçalhos (o `sw.js` nunca fica preso em cache). Se o endereço final
não for `vitrine-zap.netlify.app`, troque a imagem de prévia (`og:image`) no `index.html`.

No plano grátis, o Netlify põe um selo "Powered by Netlify" fixo no canto de baixo de todas as páginas (faz parte
do plano). O app percebe o selo e sobe o menu do painel e a barra da sacola pra nada ficar escondido atrás dele.

**Atualizou alguma coisa?** Troque a `VERSAO` no começo do [`sw.js`](sw.js) antes do `git push`. Quem já tem o
app recebe o aviso “Saiu uma versão nova” e, no toque em **Atualizar**, passa a usar os arquivos novos.

Com o repositório no ar, ponha o endereço dele em `REPOSITORIO` no [`js/config.js`](js/config.js) pra aparecer o
link "Código no GitHub" no rodapé da página inicial.

## Rodar no computador

```bash
python -m http.server 8080
```

Abra <http://localhost:8080>. O service worker só funciona em `localhost` ou HTTPS, então não abra o `index.html`
direto pelo arquivo. Com as chaves no `js/config.js`, o local já usa o Supabase de verdade.

## PWA

| Requisito | Onde está |
| --- | --- |
| Manifesto com nome, ícones (192, 512, *maskable* e SVG), cores, `start_url`, `scope`, atalhos e telas | [`manifest.webmanifest`](manifest.webmanifest) |
| Service worker: arquivos guardados na instalação, "rede primeiro" com tempo limite, página offline, biblioteca do Supabase e catálogos da nuvem guardados para abrir sem internet | [`sw.js`](sw.js), [`offline.html`](offline.html) |
| Aviso de versão nova ("Atualizar") e troca controlada do service worker | [`js/pwa.js`](js/pwa.js) |
| Botão "Instalar app" (`beforeinstallprompt`) e passo a passo pro iPhone | [`js/pwa.js`](js/pwa.js) |
| Dados no aparelho com IndexedDB; mudança feita sem internet fica pendente e sobe quando a conexão volta | [`js/banco.js`](js/banco.js), [`js/painel.js`](js/painel.js) |
| Responsivo, tema claro e escuro, acessível (rótulos, foco, `aria-*`) | [`css/app.css`](css/app.css) |
| APIs do navegador: Web Share, Clipboard, BroadcastChannel, Storage, impressão | [`js/util.js`](js/util.js), [`js/painel.js`](js/painel.js) |

## Teste automatizado

O QR code é gerado por um código próprio ([`js/qrcode.js`](js/qrcode.js), sem biblioteca). O teste lê o QR de volta
seguindo a norma ISO/IEC 18004, com as tabelas oficiais escritas de novo no teste, e confere o texto em todos os
níveis de correção e máscaras:

```bash
node testes/qrcode.test.mjs
```

## Pastas

```
index.html             landing page
loja/                  catálogo da loja e cardápio de mesa
painel/                painel do lojista (o app que instala)
css/app.css            estilos de tudo, sem framework
js/
  config.js            chaves do Supabase (em branco = modo demonstração)
  nuvem.js             Supabase: login, lojas, pedidos e Realtime
  dados.js             modelo da loja, lojas de exemplo, mensagem do WhatsApp
  banco.js             IndexedDB (cópia no aparelho)
  qrcode.js            gerador de QR code
  pwa.js               service worker, instalar, versão nova, offline
  loja.js · painel.js · landing.js · util.js · icones.js
dados/lojas/*.json     as quatro lojas de exemplo
supabase/schema.sql    tabelas e regras de acesso do banco
sw.js                  service worker
manifest.webmanifest   manifesto do PWA
netlify.toml, _headers configuração do Netlify
icons/                 ícones (SVG de origem + PNG gerados)
ferramentas/           gerar_imagens.py: ícones e telas com o Edge/Chrome
testes/                teste do QR code
docs/                  documento da atividade e telas
```

## Decisões

- **HTML, CSS e JavaScript puro**, com módulos ES. Sem framework e sem build. A única coisa de fora é a biblioteca
  oficial do Supabase, carregada só quando o Supabase está ligado e guardada pelo service worker.
- **Supabase direto do navegador**, protegido por RLS: não precisa de servidor próprio. O painel do Supabase
  serve de painel de administração (criar clientes, pausar loja).
- **Cadastro fechado:** quem vende e implanta é a Neves Tecnologia; o site só tem "Entrar".
- **Cópia no aparelho:** o painel abre e salva sem internet; o que mudou offline sobe quando a conexão volta.
- **Pedido pelo link `wa.me`:** sem API paga do WhatsApp e sem custo por mensagem.

---

Projeto acadêmico de João Pedro Neves · [Neves Tecnologia](https://nevestecnologia.com). As lojas, os produtos e os
preços de exemplo são fictícios.

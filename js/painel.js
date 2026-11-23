// Painel do lojista: a parte "SaaS" do Vitrine Zap. Cria a loja, cadastra
// produtos, mostra os pedidos, gera os QR codes das mesas e guarda tudo no
// aparelho (IndexedDB), então funciona até sem internet.

import { lojasLocais, pedidosLocais, pedirArmazenamentoPersistente } from './banco.js';
import {
  CORES, EMOJIS, EXEMPLOS, PAGAMENTOS, PERGUNTAS, TIPOS, aoMudar, avisarMudanca, buscarExemplo, desenhoProduto,
  linkDeContato, normalizarLoja, normalizarProduto, urlDaLoja,
} from './dados.js';
import { icone } from './icones.js';
import {
  entrar, excluirLojaDaNuvem, excluirPedidoDaNuvem, lojasDoDono, mudarSituacaoNaNuvem,
  nuvemLigada, ouvirPedidos, pedidosDaNuvem, sair, salvarLojaNaNuvem, sessaoAtual, slugEstaLivre,
} from './nuvem.js';
import { emModoApp, iniciarPWA, instalar } from './pwa.js';
import { qrCanvas, qrSVG } from './qrcode.js';
import {
  $, $$, abrirJanela, aplicarCor, baixar, compartilhar, confirmar, copiar, dataHoraCurta, debounce, dinheiro, esc,
  idCurto, lerPreco, normalizarWhatsApp, precoParaCampo, precoTexto, prepararJanelas, semAcento, slugify,
  telefoneBonito, toast,
} from './util.js';

const ABAS = ['inicio', 'pedidos', 'produtos', 'qr', 'loja'];
const VERDE = '#0f7a55';

let lojas = [];
let loja = null;
let pedidos = [];
let abaAtual = 'inicio';
let filtroPedidos = 'todos';
let buscaProdutos = '';
let ultimaCategoria = '';
let usuario = null; // com o Supabase ligado: { id, email }
let pararDeOuvir = null; // desliga o aviso de pedido novo da loja anterior
const parametros = new URLSearchParams(location.search);
// painel/?demo=1: painel de demonstração (tudo no navegador), mesmo com o Supabase ligado.
// Serve pra mostrar o painel a quem ainda não é cliente (e pro professor) sem criar conta.
const modoDemonstracao = parametros.has('demo');
const usarNuvem = nuvemLigada && !modoDemonstracao;

iniciarPWA();
prepararJanelas();
colocarIcones();
iniciar();

function colocarIcones(raiz = document) {
  $$('[data-icone]', raiz).forEach((el) => {
    if (el.dataset.iconePronto) return;
    el.dataset.iconePronto = '1';
    el.insertAdjacentHTML('afterbegin', icone(el.dataset.icone));
  });
}

async function iniciar() {
  montarBoasVindas();
  $$('[data-contato]').forEach((link) => { link.href = linkDeContato(link.dataset.contato || undefined); });
  $('#faixa-demo-painel').hidden = !(nuvemLigada && modoDemonstracao);
  window.addEventListener('hashchange', () => { if (loja && !$('#app').hidden) mostrarAba(lerAba()); });
  window.addEventListener('appinstalled', () => {
    if (!loja) return;
    loja.marcos.app = true;
    mudou();
  });
  window.addEventListener('online', subirPendentes);
  // Modo demonstração: a loja aberta em outra aba mandou um pedido (com a nuvem, quem avisa é o Realtime)
  aoMudar(async (mensagem) => {
    if (usarNuvem || mensagem?.tipo !== 'pedido' || !loja || mensagem.slug !== loja.slug) return;
    await carregarPedidos();
    avisarPedidoNovo(pedidos[0]);
  });

  if (usarNuvem) await iniciarComNuvem();
  else await carregarLojasDoAparelho();
  $('#carregando').hidden = true;
}

const porData = (a, b) => a.criadaEm - b.criadaEm;

// Modo demonstração: as lojas ficam só neste navegador
async function carregarLojasDoAparelho() {
  try {
    lojas = (await lojasLocais.listar()).filter((l) => !l.nuvem).map(normalizarLoja).sort(porData);
  } catch {
    lojas = [];
    toast('Este navegador bloqueou o armazenamento: o painel não vai conseguir salvar.', { tipo: 'erro', tempo: 0 });
  }
  await escolherLojaInicial();
}

async function escolherLojaInicial() {
  const lembrada = (() => { try { return localStorage.getItem('vz-loja-atual'); } catch { return null; } })();
  const exemplo = parametros.get('exemplo');
  const pedida = parametros.get('loja');
  if (exemplo || pedida) {
    parametros.delete('exemplo');
    parametros.delete('loja');
    const resto = parametros.toString(); // mantém o ?demo=1
    history.replaceState(null, '', location.pathname + (resto ? `?${resto}` : '') + location.hash);
  }
  if (exemplo) {
    await abrirExemplo(exemplo);
    return;
  }
  const escolhida = lojas.find((l) => l.slug === pedida) || lojas.find((l) => l.slug === lembrada) || lojas[0];
  if (escolhida) await abrirLoja(escolhida.slug);
  else mostrarBoasVindas(false);
}

// ── Com o Supabase: login do lojista e lojas na nuvem ──
async function iniciarComNuvem() {
  let sessao = null;
  try {
    sessao = await sessaoAtual();
  } catch {
    // Sem internet (nem a biblioteca carregou): abre com a cópia guardada da última conta
    const lembrado = lerUsuarioLembrado();
    if (lembrado) {
      usuario = lembrado;
      lojas = await lojasGuardadasDaConta();
      toast('Sem internet: mostrando a cópia guardada. As mudanças sobem quando a internet voltar.', { tempo: 6000 });
      await escolherLojaInicial();
      return;
    }
  }
  if (sessao) await entrouNaConta(sessao.user);
  else mostrarLogin();
}

function lerUsuarioLembrado() {
  try { return JSON.parse(localStorage.getItem('vz-usuario')) || null; } catch { return null; }
}

async function lojasGuardadasDaConta() {
  try {
    return (await lojasLocais.listar()).filter((l) => l.nuvem === usuario.id).map(normalizarLoja).sort(porData);
  } catch {
    return [];
  }
}

async function entrouNaConta(conta) {
  usuario = { id: conta.id, email: conta.email || '' };
  try { localStorage.setItem('vz-usuario', JSON.stringify(usuario)); } catch { /* sem armazenamento */ }
  const guardadas = await lojasGuardadasDaConta();
  try {
    const daNuvem = (await lojasDoDono(usuario.id)).map((dados) => normalizarLoja({ ...dados, nuvem: usuario.id }));
    // Mudança feita sem internet, que ainda não subiu, vale mais que a cópia da nuvem
    const pendentes = guardadas.filter((l) => l.pendente);
    lojas = [
      ...daNuvem.map((l) => pendentes.find((p) => p.slug === l.slug) || l),
      ...pendentes.filter((p) => !daNuvem.some((l) => l.slug === p.slug)),
    ].sort(porData);
    for (const l of lojas) await lojasLocais.salvar(l).catch(() => {});
  } catch (erro) {
    lojas = guardadas;
    toast(`${erro.message} Mostrando a cópia guardada no aparelho.`, { tipo: 'erro', tempo: 6000 });
  }
  subirPendentes();
  await escolherLojaInicial();
}

// Sobe as lojas que mudaram enquanto estava sem internet
async function subirPendentes() {
  if (!usarNuvem || !usuario) return;
  const pendentes = lojas.filter((l) => l.pendente);
  for (const l of pendentes) {
    try {
      await salvarLojaNaNuvem(l);
      l.pendente = false;
      await lojasLocais.salvar(l);
    } catch {
      return; // ainda sem conexão: tenta de novo na próxima
    }
  }
  if (pendentes.length) {
    toast('As mudanças feitas sem internet foram salvas na nuvem.');
    $('#salvo').textContent = 'Salvo ✓';
  }
}

function mostrarLogin() {
  aplicarCor(VERDE);
  $('#app').hidden = true;
  $('#boas-vindas').hidden = true;
  $('#carregando').hidden = true;
  $('#entrar').hidden = false;
  document.title = 'Entrar · Vitrine Zap';
  window.scrollTo(0, 0);
}

// Só entra quem tem conta: a Neves Tecnologia cria o acesso de cada cliente no Supabase
const formEntrar = $('#form-entrar');
formEntrar.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = formEntrar.email.value.trim();
  const senha = formEntrar.senha.value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return mostrarErroDoLogin('Escreva um e-mail válido.');
  if (!senha) return mostrarErroDoLogin('Escreva a senha.');
  return tentarEntrar(() => entrar(email, senha));
});

function mostrarErroDoLogin(texto) {
  const caixa = $('#erro-entrar');
  caixa.textContent = texto;
  caixa.classList.toggle('visivel', !!texto);
}

async function tentarEntrar(acao) {
  const botoes = $$('#entrar button');
  botoes.forEach((b) => { b.disabled = true; });
  mostrarErroDoLogin('');
  try {
    const sessao = await acao();
    formEntrar.reset();
    $('#entrar').hidden = true;
    $('#carregando').hidden = false;
    await entrouNaConta(sessao.user);
    $('#carregando').hidden = true;
  } catch (erro) {
    $('#carregando').hidden = true;
    $('#entrar').hidden = false;
    mostrarErroDoLogin(erro.message || 'Não deu certo. Tente de novo.');
  } finally {
    botoes.forEach((b) => { b.disabled = false; });
  }
}

async function sairDaConta() {
  if (!(await confirmar('Sair da conta neste aparelho?', { sim: 'Sair' }))) return;
  pararDeOuvir?.();
  pararDeOuvir = null;
  await sair();
  // Aparelho pode ser compartilhado: apaga as cópias desta conta (menos o que ainda não subiu)
  for (const l of lojas) if (!l.pendente) await lojasLocais.excluir(l.slug).catch(() => {});
  try {
    localStorage.removeItem('vz-usuario');
    localStorage.removeItem('vz-loja-atual');
  } catch { /* sem armazenamento */ }
  usuario = null;
  lojas = [];
  loja = null;
  pedidos = [];
  history.replaceState(null, '', location.pathname);
  mostrarLogin();
}

// ── Lojas ──
async function abrirLoja(slug) {
  loja = lojas.find((l) => l.slug === slug) || null;
  if (!loja) return;
  try { localStorage.setItem('vz-loja-atual', slug); } catch { /* sem armazenamento */ }
  aplicarCor(loja.cor);
  await carregarPedidos();
  $('#boas-vindas').hidden = true;
  $('#entrar').hidden = true;
  $('#app').hidden = false;
  atualizarTopo();
  mostrarAba(lerAba());
  ouvirPedidosDaLoja();
}

// Com o Supabase: pedido novo de qualquer cliente aparece aqui na hora (Realtime)
async function ouvirPedidosDaLoja() {
  pararDeOuvir?.();
  pararDeOuvir = null;
  if (!usarNuvem || !loja) return;
  const slug = loja.slug;
  try {
    const parar = await ouvirPedidos(slug, (novo) => {
      if (!loja || loja.slug !== slug || pedidos.some((p) => p.id === novo.id)) return;
      pedidos.unshift(novo);
      atualizarBolinha();
      avisarPedidoNovo(novo);
    });
    if (loja?.slug === slug) pararDeOuvir = parar;
    else parar();
  } catch {
    // sem Realtime: os pedidos aparecem quando a aba Pedidos é aberta
  }
}

function avisarPedidoNovo(pedido) {
  toast(`Pedido novo${pedido ? ` de ${pedido.nome}` : ''}!`, {
    acao: 'Ver', tempo: 6000, aoClicar: () => { location.hash = '#pedidos'; },
  });
  if (abaAtual === 'pedidos' || abaAtual === 'inicio') renderAba();
}

// Guarda a loja: sempre no aparelho (pra abrir sem internet) e, com o Supabase, também na nuvem.
// Devolve 'aparelho', 'nuvem' ou 'pendente' (sem internet: sobe depois).
async function guardar(l) {
  if (!usarNuvem) {
    await lojasLocais.salvar(l);
    return 'aparelho';
  }
  l.nuvem = usuario.id;
  try {
    await salvarLojaNaNuvem(l);
    l.pendente = false;
  } catch (erro) {
    l.pendente = true;
    await lojasLocais.salvar(l).catch(() => {});
    if (navigator.onLine && !/conex|internet|servidor/i.test(erro.message)) throw erro;
    return 'pendente';
  }
  await lojasLocais.salvar(l).catch(() => {});
  return 'nuvem';
}

async function salvarLojaNova(dados) {
  const nova = normalizarLoja({ ...dados, slug: await slugLivre(dados.slug || dados.nome), criadaEm: Date.now() });
  await guardar(nova);
  lojas.push(nova);
  pedirArmazenamentoPersistente();
  return nova;
}

// Endereço livre pra loja nova: não pode ser de outra loja do aparelho, de um exemplo
// nem (com o Supabase) de uma loja de outra pessoa
async function slugLivre(texto) {
  const base = (slugify(texto) || 'minha-loja').slice(0, 40).replace(/-+$/, '');
  const usados = new Set([...lojas.map((l) => l.slug), ...EXEMPLOS.map((e) => e.slug)]);
  for (let n = 1; n < 30; n++) {
    const candidato = n === 1 ? base : `${base}-${n}`;
    if (usados.has(candidato)) continue;
    if (!usarNuvem) return candidato;
    try {
      if (await slugEstaLivre(candidato)) return candidato;
    } catch {
      break;
    }
  }
  return `${base}-${idCurto()}`;
}

// Cópia de uma loja de exemplo pra pessoa mexer à vontade. No modo demonstração ela fica com
// o mesmo endereço do exemplo; com o Supabase, ganha um endereço próprio na conta.
async function abrirExemplo(slugDoExemplo) {
  let copia = lojas.find((l) => l.exemplo === slugDoExemplo);
  if (!copia) {
    const exemplo = await buscarExemplo(slugDoExemplo);
    try {
      if (!exemplo) throw new Error('Não consegui abrir esse exemplo agora.');
      if (usarNuvem) {
        copia = await salvarLojaNova({ ...exemplo, slug: slugDoExemplo, exemplo: slugDoExemplo });
      } else {
        copia = normalizarLoja({ ...exemplo, exemplo: slugDoExemplo, criadaEm: Date.now() });
        await lojasLocais.salvar(copia);
        lojas.push(copia);
      }
    } catch (erro) {
      toast(erro.message || 'Não consegui criar a cópia do exemplo.', { tipo: 'erro' });
      if (!loja) mostrarBoasVindas(false);
      return;
    }
  }
  await abrirLoja(copia.slug);
  toast('Loja de exemplo aberta: mude preços, esgote produtos e veja a loja mudar.', { tempo: 5000 });
}

function mostrarBoasVindas(comVoltar) {
  aplicarCor(VERDE);
  $('#app').hidden = true;
  $('#entrar').hidden = true;
  $('#boas-vindas').hidden = false;
  $('#voltar-painel').hidden = !comVoltar;
  $('#sair-boas-vindas').hidden = !(usarNuvem && usuario);
  document.title = 'Criar loja · Vitrine Zap';
  window.scrollTo(0, 0);
}

function atualizarTopo() {
  $('#seletor-emoji').textContent = loja.emoji;
  $('#seletor-nome').textContent = loja.nome;
  $('#ver-loja').href = urlDaLoja(loja.slug);
  document.title = `${loja.nome} · Painel Vitrine Zap`;
  atualizarBolinha();
}

// ── Salvar (sozinho, logo depois de cada mudança) ──
const gravar = debounce(async () => {
  if (!loja) return;
  const alvo = loja;
  alvo.atualizadaEm = Date.now();
  try {
    const onde = await guardar(alvo);
    avisarMudanca({ tipo: 'loja', slug: alvo.slug });
    if (alvo === loja) $('#salvo').textContent = onde === 'pendente' ? 'Salvo no aparelho' : 'Salvo ✓';
    if (onde === 'pendente') {
      toast('Sem internet: salvo no aparelho. Sobe pra nuvem quando a conexão voltar.', { chave: 'pendente' });
    }
  } catch (erro) {
    $('#salvo').textContent = 'Não salvou';
    toast(erro.message || 'Não consegui salvar.', { tipo: 'erro', chave: 'salvar' });
  }
}, usarNuvem ? 700 : 350);

function mudou({ topo = false, aba = false } = {}) {
  $('#salvo').textContent = 'Salvando…';
  gravar();
  if (topo) atualizarTopo();
  if (aba) renderAba();
}

// ── Abas ──
function lerAba() {
  const aba = location.hash.slice(1);
  return ABAS.includes(aba) ? aba : 'inicio';
}

function mostrarAba(aba) {
  abaAtual = aba;
  for (const nome of ABAS) $(`#aba-${nome}`).hidden = nome !== aba;
  $$('.nav-app [data-aba]').forEach((link) => {
    if (link.dataset.aba === aba) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  renderAba();
  window.scrollTo(0, 0);
}

function renderAba() {
  if (!loja) return;
  ({ inicio: renderInicio, pedidos: renderPedidos, produtos: renderProdutos, qr: renderQR, loja: renderConfig })[abaAtual]();
  colocarIcones($(`#aba-${abaAtual}`));
}

const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const desteMes = (ms) => {
  const d = new Date(ms);
  const hoje = new Date();
  return d.getMonth() === hoje.getMonth() && d.getFullYear() === hoje.getFullYear();
};
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// ══════════ Início ══════════
function renderInicio() {
  const url = urlDaLoja(loja.slug);
  const aVenda = loja.produtos.filter((p) => p.disponivel).length;
  const hoje = pedidos.filter((p) => mesmoDia(p.criadoEm, Date.now())).length;
  const noMes = pedidos.filter((p) => desteMes(p.criadoEm)).reduce((soma, p) => soma + (p.total || 0), 0);
  const tarefas = [
    { feito: true, texto: 'Criar a loja' },
    { feito: !!loja.whatsapp, texto: 'Colocar o WhatsApp que recebe os pedidos', link: '#loja', botao: 'Colocar' },
    { feito: loja.produtos.length >= 5, texto: 'Cadastrar pelo menos 5 produtos', link: '#produtos', botao: 'Cadastrar' },
    { feito: !!loja.marcos.qr, texto: 'Baixar ou imprimir o QR code', link: '#qr', botao: 'Ver QR' },
    { feito: emModoApp() || !!loja.marcos.app, texto: 'Instalar o painel no celular', instalar: true, botao: 'Instalar' },
  ];
  const feitos = tarefas.filter((t) => t.feito).length;

  $('#aba-inicio').innerHTML = `
    ${usarNuvem && !loja.ativa ? `
      <div class="aviso-modo"><span aria-hidden="true">⏸️</span><p><strong>Sua loja está pausada:</strong> o catálogo não aparece
        pros clientes e não recebe pedidos. <a href="${esc(linkDeContato('Olá! Quero reativar minha loja no Vitrine Zap.'))}" target="_blank" rel="noopener">Fale com a Neves Tecnologia</a> pra reativar.</p></div>` : ''}
    <div class="saudacao bloco">
      <div>
        <p>${loja.exemplo ? 'Loja de exemplo (esta cópia é sua: pode mexer à vontade)' : 'Sua loja'}</p>
        <h1>${esc(loja.emoji)} ${esc(loja.nome)}</h1>
      </div>
      <div class="linha-botoes">
        <a class="botao" href="${esc(url)}" target="_blank" rel="noopener" data-icone="externo">Ver minha loja</a>
        <button type="button" class="botao translucido" id="divulgar" data-icone="compartilhar">Divulgar o link</button>
      </div>
    </div>

    <div class="estatisticas">
      <div class="estatistica"><strong>${aVenda}</strong><span>produtos à venda</span></div>
      <div class="estatistica"><strong>${loja.produtos.length - aVenda}</strong><span>esgotados</span></div>
      <div class="estatistica"><strong>${hoje}</strong><span>pedidos hoje</span></div>
      <div class="estatistica"><strong>${dinheiro(noMes).replace(/,00$/, '')}</strong><span>em pedidos no mês</span></div>
    </div>

    <div class="cartao bloco">
      <h2>Link da loja</h2>
      <p class="ajuda">Ponha na bio do Instagram, no status e nas mensagens do WhatsApp.</p>
      <div class="link-loja"><code>${esc(url)}</code><button type="button" class="botao botao-pequeno" id="copiar-link" data-icone="copiar">Copiar</button></div>
      <div class="qr-cartao" style="margin-top:18px">
        <div class="qr-caixa">${qrSVG(url, { rotulo: `QR code do catálogo da ${loja.nome}` })}</div>
        <div>
          <strong>QR code do balcão</strong>
          <p class="ajuda" style="margin:4px 0 12px">Deixe no caixa, na vitrine ou na embalagem: quem aponta a câmera abre o catálogo.</p>
          <div class="linha-botoes">
            <button type="button" class="botao botao-pequeno" id="baixar-qr" data-icone="baixar">Baixar PNG</button>
            <a class="botao botao-pequeno botao-fantasma" href="#qr" data-icone="imprimir">Plaquinhas</a>
          </div>
        </div>
      </div>
    </div>

    <div class="cartao bloco">
      <h2>Recado no topo da loja</h2>
      <p class="ajuda">Ex.: "Hoje tem feijoada", "Encomendas de Natal até dia 20". Em branco, não aparece.</p>
      <input class="entrada" id="inicio-aviso" maxlength="120" value="${esc(loja.aviso)}" placeholder="Escreva um recado (opcional)" aria-label="Recado no topo da loja">
      <div class="linha-config" style="margin-top:8px">
        <div><strong>Receber pedidos pelo site</strong><small>Desligado, o catálogo fica no ar só pra consulta.</small></div>
        <label class="interruptor"><input type="checkbox" id="inicio-pedidos"${loja.pedidos ? ' checked' : ''}><span class="trilho"></span><span class="sr-only">Receber pedidos pelo site</span></label>
      </div>
    </div>

    <div class="cartao bloco">
      <h2>Deixe sua loja pronta</h2>
      <div class="progresso" aria-hidden="true"><span style="width:${(feitos / tarefas.length) * 100}%"></span></div>
      <p class="ajuda">${feitos} de ${tarefas.length} feitos</p>
      <ul class="checklist">
        ${tarefas.map((t) => `
          <li class="${t.feito ? 'feito' : ''}">
            <span class="marcador" aria-hidden="true">✓</span>
            <span class="texto-item">${t.texto}${t.feito ? '<span class="sr-only"> (feito)</span>' : ''}</span>
            ${t.feito ? '' : t.instalar
    ? `<button type="button" class="botao botao-pequeno" id="tarefa-instalar">${t.botao}</button>`
    : `<a class="botao botao-pequeno" href="${t.link}">${t.botao}</a>`}
          </li>`).join('')}
      </ul>
    </div>
    <p class="ajuda">${usarNuvem
    ? '☁️ Tudo salvo na nuvem (Supabase), com uma cópia no aparelho pro painel abrir sem internet.'
    : '🔒 Modo demonstração: tudo fica guardado neste navegador (IndexedDB) e o painel funciona sem internet.'}</p>`;

  $('#copiar-link').onclick = async () => { if (await copiar(url)) toast('Link copiado!'); };
  $('#divulgar').onclick = () => compartilhar({
    titulo: loja.nome, texto: `Veja o catálogo da ${loja.nome} e faça seu pedido pelo WhatsApp:`, url,
  });
  $('#baixar-qr').onclick = () => baixarQR(url, `qr-${loja.slug}.png`);
  $('#inicio-aviso').oninput = (e) => { loja.aviso = e.target.value; mudou(); };
  $('#inicio-pedidos').onchange = (e) => {
    loja.pedidos = e.target.checked;
    mudou();
    toast(loja.pedidos ? 'Pedidos pelo site ligados.' : 'Pedidos pausados: o catálogo segue no ar só pra consulta.');
  };
  const botaoInstalar = $('#tarefa-instalar');
  if (botaoInstalar) botaoInstalar.onclick = () => instalar();
}

function baixarQR(url, nome) {
  qrCanvas(url, { px: 960 }).toBlob((png) => {
    baixar(nome, png);
    loja.marcos.qr = true;
    mudou();
    toast('QR code baixado.');
  }, 'image/png');
}

// ══════════ Pedidos ══════════
let pedidosIndisponiveis = false; // com o Supabase e sem internet

async function carregarPedidos() {
  try {
    const lista = usarNuvem ? await pedidosDaNuvem(loja.slug) : await pedidosLocais.listar(loja.slug);
    pedidos = lista.sort((a, b) => b.criadoEm - a.criadoEm);
    pedidosIndisponiveis = false;
  } catch {
    pedidos = [];
    pedidosIndisponiveis = usarNuvem;
  }
  atualizarBolinha();
}

function atualizarBolinha() {
  const novos = pedidos.filter((p) => p.status === 'novo').length;
  const bolinha = $('#bolinha-pedidos');
  bolinha.hidden = !novos;
  bolinha.textContent = novos > 9 ? '9+' : String(novos);
}

const SITUACOES = [['novo', 'Novo'], ['confirmado', 'Confirmado'], ['entregue', 'Entregue']];

function renderPedidos() {
  const lista = pedidos.filter((p) => filtroPedidos === 'todos' || p.status === filtroPedidos);
  const novos = pedidos.filter((p) => p.status === 'novo').length;
  $('#aba-pedidos').innerHTML = `
    <div class="aba-titulo">
      <div>
        <h1>Pedidos</h1>
        <p>${pedidos.length ? `${plural(pedidos.length, 'pedido', 'pedidos')} · ${plural(novos, 'novo', 'novos')}` : 'Os pedidos feitos pelo catálogo aparecem aqui.'}</p>
      </div>
    </div>
    ${usarNuvem
    ? '<div class="aviso-modo"><span aria-hidden="true">⚡</span><p><strong>Ao vivo:</strong> o pedido de qualquer cliente aparece aqui na hora, além da mensagem que chega no seu WhatsApp.</p></div>'
    : `<div class="aviso-modo"><span aria-hidden="true">💡</span><p><strong>Modo demonstração:</strong> aparecem aqui os pedidos enviados pelo
      catálogo <em>neste aparelho</em>. Com o Supabase ligado, chegam os de todos os clientes (além da mensagem no WhatsApp).</p></div>`}
    ${pedidosIndisponiveis ? '<div class="aviso-modo"><span aria-hidden="true">📶</span><p>Sem conexão com o servidor agora: os pedidos aparecem quando a internet voltar.</p></div>' : ''}
    ${pedidos.length ? `
      <div class="chips bloco" role="group" aria-label="Filtrar pedidos">
        ${[['todos', 'Todos'], ...SITUACOES].map(([valor, texto]) => `
          <button type="button" class="chip${filtroPedidos === valor ? ' ativo' : ''}" data-filtro="${valor}" aria-pressed="${filtroPedidos === valor}">${texto}</button>`).join('')}
      </div>` : ''}
    ${lista.length ? `<ul class="lista-pedidos">${lista.map(cartaoDoPedido).join('')}</ul>` : `
      <div class="vazio cartao">
        <span class="vazio-icone">🧾</span>
        <strong>${pedidos.length ? 'Nenhum pedido neste filtro' : 'Nenhum pedido ainda'}</strong>
        ${pedidos.length ? '' : `<span>Abra sua loja, monte uma sacola e envie: o pedido aparece aqui na hora.</span>
          <a class="botao botao-primario" style="margin-top:10px" href="${esc(urlDaLoja(loja.slug))}" target="_blank" rel="noopener">Abrir minha loja</a>`}
      </div>`}`;

  $('#aba-pedidos').onclick = async (e) => {
    const filtro = e.target.closest('[data-filtro]');
    if (filtro) {
      filtroPedidos = filtro.dataset.filtro;
      renderAba();
      return;
    }
    const situacao = e.target.closest('[data-status]');
    if (situacao) {
      const pedido = pedidos.find((p) => p.id === situacao.dataset.id);
      if (!pedido) return;
      const anterior = pedido.status;
      pedido.status = situacao.dataset.status;
      try {
        if (usarNuvem) await mudarSituacaoNaNuvem(pedido.id, pedido.status);
        else await pedidosLocais.salvar(pedido);
      } catch (erro) {
        pedido.status = anterior;
        toast(erro.message || 'Não consegui salvar.', { tipo: 'erro' });
      }
      atualizarBolinha();
      renderAba();
      return;
    }
    const excluir = e.target.closest('[data-excluir-pedido]');
    if (excluir && await confirmar('Excluir este pedido da lista?', { sim: 'Excluir', perigo: true })) {
      try {
        if (usarNuvem) await excluirPedidoDaNuvem(excluir.dataset.excluirPedido);
        else await pedidosLocais.excluir(excluir.dataset.excluirPedido);
      } catch (erro) {
        toast(erro.message || 'Não consegui excluir.', { tipo: 'erro' });
      }
      await carregarPedidos();
      renderAba();
    }
  };
}

function cartaoDoPedido(p) {
  return `
    <li class="pedido">
      <div class="pedido-topo">
        <div>
          <strong>${esc(p.nome)}</strong>
          <small>${dataHoraCurta(p.criadoEm)} · ${p.modo === 'entrega' ? '🛵 Entrega' : '🏪 Retirada'}</small>
        </div>
        <span class="pedido-total">${dinheiro(p.total)}</span>
      </div>
      <ul class="pedido-itens">${(p.itens || []).map((i) => `<li>${i.qtd}x ${esc(i.nome)}</li>`).join('')}</ul>
      <div class="pedido-dados">
        ${p.endereco ? `<span>📍 ${esc(p.endereco)}</span>` : ''}
        ${(p.respostas || []).map((r) => `<span><strong>${esc(r.rotulo)}:</strong> ${esc(r.valor)}</span>`).join('')}
        ${p.pagamento ? `<span>💳 ${esc(p.pagamento)}</span>` : ''}
        ${p.obs ? `<span>📝 ${esc(p.obs)}</span>` : ''}
      </div>
      <div class="pedido-acoes">
        <div class="status" role="group" aria-label="Situação do pedido de ${esc(p.nome)}">
          ${SITUACOES.map(([valor, texto]) => `<button type="button" data-status="${valor}" data-id="${esc(p.id)}" aria-pressed="${p.status === valor}">${texto}</button>`).join('')}
        </div>
        <button type="button" class="botao botao-pequeno botao-fantasma botao-icone" data-excluir-pedido="${esc(p.id)}"
          aria-label="Excluir pedido de ${esc(p.nome)}" data-icone="lixo"></button>
      </div>
    </li>`;
}

// ══════════ Produtos ══════════
function renderProdutos() {
  $('#aba-produtos').innerHTML = `
    <div class="aba-titulo">
      <div>
        <h1>Produtos</h1>
        <p>${plural(loja.produtos.length, 'produto cadastrado', 'produtos cadastrados')} · toque num produto pra editar</p>
      </div>
      <div class="linha-botoes">
        <button type="button" class="botao" id="abrir-categorias">Categorias</button>
        <button type="button" class="botao botao-primario" id="novo-produto" data-icone="mais">Novo produto</button>
      </div>
    </div>
    ${loja.produtos.length > 6 ? `
      <div class="barra-ferramentas">
        <label class="busca">${icone('busca')}<span class="sr-only">Buscar produto</span>
          <input class="entrada" id="busca-produtos" type="search" placeholder="Buscar produto" value="${esc(buscaProdutos)}" autocomplete="off">
        </label>
      </div>` : ''}
    <div id="lista-produtos"></div>`;
  renderListaDeProdutos();

  $('#novo-produto').onclick = () => abrirEditor(null);
  $('#abrir-categorias').onclick = abrirCategorias;
  const busca = $('#busca-produtos');
  if (busca) busca.oninput = (e) => { buscaProdutos = e.target.value; renderListaDeProdutos(); };

  const aba = $('#aba-produtos');
  aba.onclick = (e) => {
    const editar = e.target.closest('[data-editar]');
    if (editar) {
      abrirEditor(editar.dataset.editar);
      return;
    }
    const estrela = e.target.closest('[data-destaque]');
    if (estrela) {
      const p = loja.produtos.find((x) => x.id === estrela.dataset.destaque);
      p.destaque = !p.destaque;
      estrela.setAttribute('aria-pressed', String(p.destaque));
      mudou();
      toast(p.destaque ? `${p.nome} vai aparecer em "Mais pedidos".` : `${p.nome} saiu de "Mais pedidos".`);
    }
  };
  aba.onchange = (e) => {
    const id = e.target.dataset.disponivel;
    if (!id) return;
    const p = loja.produtos.find((x) => x.id === id);
    p.disponivel = e.target.checked;
    e.target.closest('.linha-produto').classList.toggle('esgotado', !p.disponivel);
    const preco = e.target.closest('.linha-produto').querySelector('.linha-produto-preco');
    preco.innerHTML = `${esc(precoTexto(p.preco))}${p.disponivel ? '' : ' <span class="etiqueta etiqueta-perigo">Esgotado</span>'}`;
    mudou();
    toast(p.disponivel ? `${p.nome} voltou pra venda.` : `${p.nome} marcado como esgotado.`);
  };
}

function renderListaDeProdutos() {
  const termo = semAcento(buscaProdutos).trim();
  const lista = termo
    ? loja.produtos.filter((p) => semAcento(`${p.nome} ${p.categoria} ${p.descricao}`).includes(termo))
    : loja.produtos;
  const grupos = new Map(loja.categorias.map((c) => [c, []]));
  for (const p of lista) {
    const categoria = p.categoria || 'Outros';
    if (!grupos.has(categoria)) grupos.set(categoria, []);
    grupos.get(categoria).push(p);
  }
  const cheios = [...grupos].filter(([, itens]) => itens.length);
  $('#lista-produtos').innerHTML = cheios.length
    ? cheios.map(([categoria, itens]) => `
      <section class="grupo-produtos">
        <h2>${esc(categoria)} <span class="etiqueta">${itens.length}</span></h2>
        <ul class="lista-painel">${itens.map(linhaDoProduto).join('')}</ul>
      </section>`).join('')
    : `<div class="vazio cartao">
        <span class="vazio-icone">${termo ? '🔎' : '🏷️'}</span>
        <strong>${termo ? 'Nenhum produto encontrado' : 'Nenhum produto ainda'}</strong>
        <span>${termo ? 'Tente outra palavra.' : 'Cadastre o primeiro: nome, preço e uma foto ou ícone.'}</span>
      </div>`;
}

function linhaDoProduto(p) {
  return `
    <li class="linha-produto${p.disponivel ? '' : ' esgotado'}">
      <button type="button" class="linha-produto-abrir" data-editar="${esc(p.id)}" aria-label="Editar ${esc(p.nome)}">
        ${desenhoProduto(p, loja.emoji, 'mini')}
        <span class="linha-produto-textos">
          <span class="linha-produto-nome">${esc(p.nome)}</span>
          <span class="linha-produto-preco">${esc(precoTexto(p.preco))}${p.disponivel ? '' : ' <span class="etiqueta etiqueta-perigo">Esgotado</span>'}</span>
        </span>
      </button>
      <button type="button" class="estrela" data-destaque="${esc(p.id)}" aria-pressed="${p.destaque}"
        aria-label="Destaque em Mais pedidos: ${esc(p.nome)}" title="Mostrar em Mais pedidos">★</button>
      <label class="interruptor" title="À venda">
        <input type="checkbox" data-disponivel="${esc(p.id)}"${p.disponivel ? ' checked' : ''}>
        <span class="trilho"></span><span class="sr-only">À venda: ${esc(p.nome)}</span>
      </label>
    </li>`;
}

// ── Editor de produto ──
const formProduto = $('#form-produto');
let editando = null; // produto aberto no editor (null = novo)
let fotoNova; // undefined = não mexeu; '' = tirou a foto; 'data:...' = foto nova
let emojiEscolhido = '';

function abrirEditor(id) {
  const p = id ? loja.produtos.find((x) => x.id === id) : null;
  editando = p;
  formProduto.reset();
  $$('.erro', formProduto).forEach((el) => el.classList.remove('visivel'));
  $('#editor-titulo').textContent = p ? 'Editar produto' : 'Novo produto';
  formProduto.nome.value = p?.nome || '';
  formProduto.preco.value = p ? precoParaCampo(p.preco) : '';
  formProduto.descricao.value = p?.descricao || '';
  formProduto.disponivel.checked = p ? p.disponivel : true;
  formProduto.destaque.checked = p ? p.destaque : false;
  const categorias = loja.categorias;
  formProduto.categoria.innerHTML = categorias.map((c) => `<option>${esc(c)}</option>`).join('')
    + '<option value="__nova">+ Nova categoria…</option>';
  const sugerida = p?.categoria || (categorias.includes(ultimaCategoria) ? ultimaCategoria : categorias[0]);
  formProduto.categoria.value = sugerida && categorias.includes(sugerida) ? sugerida : '__nova';
  $('#campo-nova-categoria').hidden = formProduto.categoria.value !== '__nova';
  emojiEscolhido = p?.emoji || '';
  fotoNova = undefined;
  renderEmojis();
  atualizarDesenhoDoEditor();
  $('#editor-excluir').hidden = !p;
  abrirJanela($('#dlg-editor'));
}

function renderEmojis() {
  const lista = [...new Set([emojiEscolhido, ...EMOJIS].filter(Boolean))];
  $('#editor-emojis').innerHTML = lista.map((e) => `
    <button type="button" data-emoji="${e}" aria-pressed="${e === emojiEscolhido}" aria-label="Ícone ${e}">${e}</button>`).join('');
}

function atualizarDesenhoDoEditor() {
  const foto = fotoNova !== undefined ? fotoNova : editando?.foto || '';
  $('#editor-tile').innerHTML = desenhoProduto({ foto, emoji: emojiEscolhido }, loja.emoji);
  $('#editor-tirar-foto').hidden = !foto;
}

$('#editor-emojis').addEventListener('click', (e) => {
  const botao = e.target.closest('[data-emoji]');
  if (!botao) return;
  emojiEscolhido = botao.dataset.emoji;
  $$('[data-emoji]', $('#editor-emojis')).forEach((b) => b.setAttribute('aria-pressed', String(b === botao)));
  atualizarDesenhoDoEditor();
});

formProduto.categoria.addEventListener('change', () => {
  $('#campo-nova-categoria').hidden = formProduto.categoria.value !== '__nova';
  if (formProduto.categoria.value === '__nova') formProduto.novaCategoria.focus();
});

$('#editor-foto').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  try {
    fotoNova = await reduzirFoto(arquivo);
    atualizarDesenhoDoEditor();
  } catch {
    toast('Não consegui abrir essa imagem.', { tipo: 'erro' });
  }
});

$('#editor-tirar-foto').addEventListener('click', () => {
  fotoNova = '';
  atualizarDesenhoDoEditor();
});

// Reduz a foto no próprio aparelho (no máximo 800 px, WebP) antes de guardar
async function reduzirFoto(arquivo, lado = 800) {
  let imagem;
  try {
    imagem = await createImageBitmap(arquivo);
  } catch {
    imagem = await new Promise((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = rejeitar;
      img.src = URL.createObjectURL(arquivo);
    });
  }
  const escala = Math.min(1, lado / Math.max(imagem.width, imagem.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(imagem.width * escala);
  canvas.height = Math.round(imagem.height * escala);
  canvas.getContext('2d').drawImage(imagem, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL('image/webp', 0.8);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.82);
}

function idUnico(nome) {
  const base = slugify(nome) || 'produto';
  let id = base;
  while (loja.produtos.some((p) => p.id === id)) id = `${base}-${idCurto()}`;
  return id;
}

formProduto.addEventListener('submit', (e) => {
  e.preventDefault();
  $$('.erro', formProduto).forEach((el) => el.classList.remove('visivel'));
  const nome = formProduto.nome.value.trim();
  const precoDigitado = formProduto.preco.value.trim();
  const preco = lerPreco(precoDigitado);
  let categoria = formProduto.categoria.value;
  const erros = [];
  if (!nome) erros.push('nome');
  if (precoDigitado && preco == null) erros.push('preco');
  if (categoria === '__nova') {
    categoria = formProduto.novaCategoria.value.trim();
    if (!categoria) erros.push('novaCategoria');
  }
  if (erros.length) {
    erros.forEach((campo) => $(`#erro-produto-${campo}`).classList.add('visivel'));
    formProduto[erros[0]].focus();
    return;
  }
  if (!loja.categorias.includes(categoria)) loja.categorias.push(categoria);
  const dados = {
    nome, preco, categoria,
    descricao: formProduto.descricao.value.trim(),
    emoji: emojiEscolhido,
    disponivel: formProduto.disponivel.checked,
    destaque: formProduto.destaque.checked,
  };
  if (fotoNova !== undefined) dados.foto = fotoNova;
  if (editando) Object.assign(editando, normalizarProduto({ ...editando, ...dados }));
  else loja.produtos.push(normalizarProduto({ ...dados, id: idUnico(nome) }));
  ultimaCategoria = categoria;
  mudou({ aba: true });
  $('#dlg-editor').close();
  toast(editando ? 'Produto atualizado.' : 'Produto cadastrado! Já aparece na loja.');
});

$('#editor-excluir').addEventListener('click', async () => {
  if (!editando) return;
  if (!(await confirmar(`Excluir "${editando.nome}" do catálogo?`, { sim: 'Excluir', perigo: true }))) return;
  loja.produtos = loja.produtos.filter((p) => p !== editando);
  mudou({ aba: true });
  $('#dlg-editor').close();
  toast('Produto excluído.');
});

// ── Categorias ──
function abrirCategorias() {
  renderCategorias();
  abrirJanela($('#dlg-categorias'));
}

function renderCategorias() {
  const ultima = loja.categorias.length - 1;
  $('#lista-categorias').innerHTML = loja.categorias.map((c, i) => {
    const n = loja.produtos.filter((p) => p.categoria === c).length;
    return `
      <li>
        <input class="entrada" value="${esc(c)}" data-renomear="${i}" maxlength="40" aria-label="Nome da categoria ${esc(c)}">
        <span class="contagem">${plural(n, 'produto', 'produtos')}</span>
        <button type="button" class="botao botao-icone botao-pequeno botao-fantasma" data-subir="${i}" aria-label="Subir ${esc(c)}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="botao botao-icone botao-pequeno botao-fantasma" data-descer="${i}" aria-label="Descer ${esc(c)}"${i === ultima ? ' disabled' : ''}>↓</button>
        <button type="button" class="botao botao-icone botao-pequeno botao-fantasma" data-apagar="${i}" aria-label="Excluir ${esc(c)}">${icone('lixo')}</button>
      </li>`;
  }).join('') || '<li class="ajuda">Nenhuma categoria ainda. Crie a primeira aqui embaixo.</li>';
}

$('#lista-categorias').addEventListener('change', (e) => {
  const i = e.target.dataset.renomear;
  if (i == null) return;
  const antigo = loja.categorias[i];
  const novo = e.target.value.trim();
  if (!novo || (novo !== antigo && loja.categorias.includes(novo))) {
    e.target.value = antigo;
    toast(novo ? 'Já existe uma categoria com esse nome.' : 'A categoria precisa de um nome.', { tipo: 'erro' });
    return;
  }
  loja.categorias[i] = novo;
  loja.produtos.forEach((p) => { if (p.categoria === antigo) p.categoria = novo; });
  mudou();
});

$('#lista-categorias').addEventListener('click', async (e) => {
  const botao = e.target.closest('button');
  if (!botao) return;
  const c = loja.categorias;
  if (botao.dataset.subir) {
    const i = Number(botao.dataset.subir);
    [c[i - 1], c[i]] = [c[i], c[i - 1]];
  } else if (botao.dataset.descer) {
    const i = Number(botao.dataset.descer);
    [c[i + 1], c[i]] = [c[i], c[i + 1]];
  } else if (botao.dataset.apagar) {
    const i = Number(botao.dataset.apagar);
    const nome = c[i];
    const n = loja.produtos.filter((p) => p.categoria === nome).length;
    if (n && !(await confirmar(`"${nome}" tem ${plural(n, 'produto', 'produtos')}. Eles vão pra categoria "Outros".`, { sim: 'Excluir categoria', perigo: true }))) return;
    c.splice(i, 1);
    if (n) {
      if (!c.includes('Outros')) c.push('Outros');
      loja.produtos.forEach((p) => { if (p.categoria === nome) p.categoria = 'Outros'; });
    }
  } else {
    return;
  }
  mudou();
  renderCategorias();
});

$('#form-categoria').addEventListener('submit', (e) => {
  e.preventDefault();
  const campo = e.target.nome;
  const nome = campo.value.trim();
  if (!nome) return;
  if (loja.categorias.includes(nome)) {
    toast('Essa categoria já existe.', { tipo: 'erro' });
    return;
  }
  loja.categorias.push(nome);
  campo.value = '';
  mudou();
  renderCategorias();
});

$('#dlg-categorias').addEventListener('close', () => { if (abaAtual === 'produtos') renderAba(); });

// ══════════ QR codes ══════════
function renderQR() {
  const url = urlDaLoja(loja.slug);
  $('#aba-qr').innerHTML = `
    <div class="aba-titulo"><div><h1>QR codes</h1><p>Imprima e espalhe pela loja: balcão, vitrine, mesas.</p></div></div>
    ${loja.exemplo || usarNuvem ? '' : `
      <div class="aviso-modo"><span aria-hidden="true">💡</span><p><strong>Modo demonstração:</strong> esta loja está salva só neste
        aparelho, então o QR abre o catálogo dela aqui. Pra testar escaneando com outro celular, abra uma
        <a href="?${modoDemonstracao ? 'demo=1&amp;' : ''}exemplo=restaurante-tempero-da-serra">loja de exemplo</a>: os QR delas funcionam em qualquer aparelho.</p></div>`}
    <div class="cartao bloco">
      <h2>QR do balcão e da vitrine</h2>
      <p class="ajuda">Abre o catálogo com a sacola: o cliente escolhe e manda o pedido pelo WhatsApp.</p>
      <div class="qr-cartao">
        <div class="qr-caixa">${qrSVG(url, { rotulo: 'QR code do catálogo' })}</div>
        <div class="linha-botoes">
          <button type="button" class="botao botao-pequeno" id="qr-baixar" data-icone="baixar">Baixar PNG</button>
          <button type="button" class="botao botao-pequeno botao-primario" id="qr-imprimir-balcao" data-icone="imprimir">Imprimir plaquinha</button>
        </div>
      </div>
    </div>
    <div class="cartao bloco">
      <h2>Cardápio de mesa</h2>
      <p class="ajuda">Cada mesa ganha o seu QR. O cliente escaneia, vê o cardápio com os preços e o que acabou, e faz o pedido
        com o garçom. Sem sacola e sem app pra baixar.</p>
      <div class="linha-config">
        <div><strong>Quantas mesas?</strong><small>Zero desliga o cardápio de mesa.</small></div>
        <input class="entrada" type="number" id="qr-mesas" min="0" max="99" inputmode="numeric" value="${loja.mesas}" style="width:96px" aria-label="Número de mesas">
      </div>
      <div id="area-mesas"></div>
    </div>`;
  renderMesas();
  $('#qr-baixar').onclick = () => baixarQR(url, `qr-${loja.slug}.png`);
  $('#qr-imprimir-balcao').onclick = imprimirBalcao;
  $('#qr-mesas').oninput = (e) => {
    loja.mesas = Math.max(0, Math.min(99, parseInt(e.target.value, 10) || 0));
    mudou();
    renderMesas();
  };
}

function renderMesas() {
  const area = $('#area-mesas');
  if (!loja.mesas) {
    area.innerHTML = '<p class="ajuda" style="margin-top:10px">Coloque o número de mesas pra gerar os QR codes.</p>';
    return;
  }
  const numeros = Array.from({ length: loja.mesas }, (_, i) => i + 1);
  area.innerHTML = `
    <div class="linha-botoes" style="margin:10px 0 16px">
      <button type="button" class="botao botao-primario" id="qr-imprimir-mesas" data-icone="imprimir">Imprimir ${plural(loja.mesas, 'plaquinha', 'plaquinhas')}</button>
      <a class="botao" href="${esc(urlDaLoja(loja.slug, { mesa: 1 }))}" target="_blank" rel="noopener" data-icone="externo">Testar a mesa 1</a>
    </div>
    <div class="grade-mesas">
      ${numeros.map((n) => `
        <a class="mesa-mini" href="${esc(urlDaLoja(loja.slug, { mesa: n }))}" target="_blank" rel="noopener">
          <span class="qr">${qrSVG(urlDaLoja(loja.slug, { mesa: n }), { rotulo: `QR code da mesa ${n}` })}</span>
          <strong>Mesa ${n}</strong><small>abrir cardápio ↗</small>
        </a>`).join('')}
    </div>`;
  colocarIcones(area);
  $('#qr-imprimir-mesas').onclick = imprimirMesas;
}

function plaquinha({ destaque, texto, miuda, url }) {
  return `
    <div class="plaquinha" style="--cor-plaquinha:${loja.cor}">
      <div class="plaquinha-topo">
        <div class="plaquinha-loja">${esc(loja.emoji)} ${esc(loja.nome)}</div>
        <p class="plaquinha-mesa">${esc(destaque)}</p>
      </div>
      <div class="qr">${qrSVG(url, { rotulo: destaque })}</div>
      <p class="plaquinha-texto">${esc(texto)}</p>
      <p class="plaquinha-miuda">${esc(miuda)}</p>
    </div>`;
}

function imprimir(html) {
  const area = $('#impressao');
  area.innerHTML = html;
  loja.marcos.qr = true;
  mudou();
  const limpar = () => {
    area.innerHTML = '';
    window.removeEventListener('afterprint', limpar);
  };
  window.addEventListener('afterprint', limpar);
  window.print();
}

function imprimirMesas() {
  imprimir(`<div class="plaquinhas">${Array.from({ length: loja.mesas }, (_, i) => plaquinha({
    destaque: `Mesa ${i + 1}`,
    texto: 'Aponte a câmera do celular e veja o cardápio',
    miuda: 'Faça o pedido com o garçom · cardápio digital Vitrine Zap',
    url: urlDaLoja(loja.slug, { mesa: i + 1 }),
  })).join('')}</div>`);
}

function imprimirBalcao() {
  imprimir(`<div class="plaquinhas">${plaquinha({
    destaque: 'Peça pelo celular',
    texto: 'Aponte a câmera, escolha os produtos e mande o pedido pelo WhatsApp',
    miuda: 'Catálogo digital Vitrine Zap',
    url: urlDaLoja(loja.slug),
  })}</div>`);
}

// ══════════ Configurações da loja ══════════
function renderConfig() {
  const url = urlDaLoja(loja.slug);
  const corLivre = !CORES.includes(loja.cor);
  $('#aba-loja').innerHTML = `
    <div class="aba-titulo"><div><h1>Sua loja</h1><p>O que aparece no catálogo. Tudo salva sozinho.</p></div></div>

    <div class="cartao bloco">
      <h2>Identidade</h2>
      <label class="campo"><span>Nome da loja</span>
        <input class="entrada" data-campo="nome" maxlength="60" value="${esc(loja.nome)}"></label>
      <label class="campo"><span>Frase de apresentação <span class="opcional">(opcional)</span></span>
        <textarea class="entrada" data-campo="descricao" rows="2" maxlength="200" placeholder="Ex.: Queijos e doces da roça, direto do produtor.">${esc(loja.descricao)}</textarea></label>
      <label class="campo"><span>Tipo de comércio</span>
        <select class="entrada" data-campo="tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}"${loja.tipo === k ? ' selected' : ''}>${t.emoji} ${t.nome}</option>`).join('')}</select></label>
      <div class="campo"><span class="rotulo">Ícone da loja</span>
        <div class="emojis" id="emojis-loja" role="group" aria-label="Ícone da loja">
          ${[...new Set([loja.emoji, ...EMOJIS])].map((e) => `<button type="button" data-emoji-loja="${e}" aria-pressed="${e === loja.emoji}" aria-label="Ícone ${e}">${e}</button>`).join('')}
        </div></div>
      <fieldset><legend>Cor</legend>
        <div class="cores">
          ${CORES.map((c) => `<label class="cor" style="background:${c}"><input type="radio" name="cor-loja" value="${c}"${loja.cor === c ? ' checked' : ''} aria-label="Cor ${c}"></label>`).join('')}
          <label class="cor cor-livre${corLivre ? ' ativa' : ''}" title="Outra cor"><input type="color" data-cor-livre value="${loja.cor}" aria-label="Escolher outra cor"></label>
        </div></fieldset>
    </div>

    <div class="cartao bloco">
      <h2>Contato e endereço</h2>
      <label class="campo"><span>WhatsApp que recebe os pedidos</span>
        <input class="entrada" data-campo="whatsapp" inputmode="tel" autocomplete="tel" maxlength="20" value="${esc(telefoneBonito(loja.whatsapp))}" placeholder="(35) 99999-9999">
        <p class="ajuda">Sem número, o WhatsApp abre pro cliente escolher o contato (bom só pra testar).</p>
        <p class="erro" id="erro-cfg-whatsapp">Confira o número: DDD + número, ex.: (35) 99999-9999.</p></label>
      <div class="dois-campos">
        <label class="campo"><span>Instagram <span class="opcional">(opcional)</span></span>
          <input class="entrada" data-campo="instagram" maxlength="40" value="${loja.instagram ? `@${esc(loja.instagram)}` : ''}" placeholder="@sualoja"></label>
        <label class="campo"><span>Cidade</span>
          <input class="entrada" data-campo="cidade" maxlength="60" value="${esc(loja.cidade)}" placeholder="Ex.: Itajubá - MG"></label>
      </div>
      <label class="campo"><span>Endereço <span class="opcional">(pra quem vai retirar)</span></span>
        <input class="entrada" data-campo="endereco" maxlength="120" value="${esc(loja.endereco)}" placeholder="Rua, número · bairro"></label>
      <label class="campo"><span>Horário</span>
        <input class="entrada" data-campo="horario" maxlength="80" value="${esc(loja.horario)}" placeholder="Seg a sáb, 8h às 18h"></label>
    </div>

    <div class="cartao bloco">
      <h2>Pedidos</h2>
      ${interruptor('pedidos', 'Receber pedidos pelo site', 'Sacola + pedido pronto no WhatsApp. Desligado, vira só vitrine.')}
      ${interruptor('entrega', 'Faz entrega', 'O cliente escreve o endereço no pedido.')}
      <label class="campo" id="campo-taxa"${loja.entrega ? '' : ' hidden'} style="margin-top:4px"><span>Taxa de entrega</span>
        <span class="entrada-preco"><input class="entrada" data-campo="taxaEntrega" inputmode="decimal" maxlength="10" value="${precoParaCampo(loja.taxaEntrega)}" placeholder="a combinar"></span>
        <p class="ajuda">Em branco, a taxa é combinada no WhatsApp. Zero = entrega grátis.</p></label>
      ${interruptor('retirada', 'Retirada na loja', 'O cliente busca, sem taxa.')}
      <fieldset style="margin:14px 0 0"><legend>Formas de pagamento</legend>
        <div class="chips">${PAGAMENTOS.map((f) => `<label class="chip"><input type="checkbox" data-pagamento="${esc(f)}"${loja.pagamentos.includes(f) ? ' checked' : ''}>${esc(f)}</label>`).join('')}</div>
      </fieldset>
    </div>

    <div class="cartao bloco">
      <h2>Perguntas do pedido</h2>
      <p class="ajuda">Ligue o que sua loja precisa saber. Entra no formulário da sacola e na mensagem do WhatsApp.</p>
      ${Object.entries(PERGUNTAS).map(([chave, p]) => `
        <div class="linha-config">
          <div><strong>${esc(p.rotulo)}</strong><small>${esc(p.descricao)}</small></div>
          <label class="interruptor"><input type="checkbox" data-pergunta="${chave}"${loja.perguntas.includes(chave) ? ' checked' : ''}><span class="trilho"></span><span class="sr-only">${esc(p.rotulo)}</span></label>
        </div>`).join('')}
    </div>

    <div class="cartao bloco">
      <h2>Endereço do catálogo</h2>
      <div class="link-loja"><code>${esc(url)}</code><button type="button" class="botao botao-pequeno" id="cfg-copiar" data-icone="copiar">Copiar</button></div>
      <p class="ajuda" style="margin-top:8px">O final (<strong>${esc(loja.slug)}</strong>) não muda quando você troca o nome: assim os QR codes impressos continuam valendo.</p>
    </div>

    ${usarNuvem ? `
      <div class="cartao bloco">
        <h2>Conta</h2>
        <p class="ajuda" style="margin-bottom:12px">Você entrou como <strong>${esc(usuario?.email || '')}</strong>. As lojas ficam
          salvas no Supabase. Pra trocar a senha, <a href="${esc(linkDeContato('Olá! Quero trocar a senha do painel do Vitrine Zap.'))}" target="_blank" rel="noopener">fale com a Neves Tecnologia</a>.</p>
        <button type="button" class="botao" id="sair-da-conta">Sair da conta</button>
      </div>` : ''}

    <div class="cartao bloco">
      <h2>Dados</h2>
      <p class="ajuda">Uma cópia de tudo num arquivo: produtos, fotos e configurações.</p>
      <div class="linha-botoes">
        <button type="button" class="botao" id="exportar" data-icone="baixar">Exportar (.json)</button>
        <button type="button" class="botao" id="importar">Importar</button>
        ${loja.exemplo ? '<button type="button" class="botao" id="restaurar">Voltar ao exemplo original</button>' : ''}
        <button type="button" class="botao botao-fantasma" id="excluir-loja" style="color:var(--perigo)" data-icone="lixo">Excluir loja</button>
      </div>
    </div>`;

  const aba = $('#aba-loja');
  aba.oninput = (e) => configMudou(e, false);
  aba.onchange = (e) => configMudou(e, true);
  aba.onclick = (e) => {
    const botao = e.target.closest('[data-emoji-loja]');
    if (!botao) return;
    loja.emoji = botao.dataset.emojiLoja;
    $$('[data-emoji-loja]', aba).forEach((b) => b.setAttribute('aria-pressed', String(b === botao)));
    mudou({ topo: true });
  };
  $('#cfg-copiar').onclick = async () => { if (await copiar(url)) toast('Link copiado!'); };
  $('#exportar').onclick = () => {
    const { nuvem, pendente, ...semMarcas } = loja; // marcações que só valem neste aparelho
    baixar(`${loja.slug}.json`, JSON.stringify(semMarcas, null, 2), 'application/json');
    toast('Arquivo baixado.');
  };
  $('#importar').onclick = () => $('#importar-arquivo').click();
  $('#excluir-loja').onclick = excluirLoja;
  const botaoSair = $('#sair-da-conta');
  if (botaoSair) botaoSair.onclick = sairDaConta;
  const restaurar = $('#restaurar');
  if (restaurar) restaurar.onclick = restaurarExemplo;
}

function interruptor(campo, titulo, detalhe) {
  return `
    <div class="linha-config">
      <div><strong>${titulo}</strong><small>${detalhe}</small></div>
      <label class="interruptor"><input type="checkbox" data-campo="${campo}"${loja[campo] ? ' checked' : ''}><span class="trilho"></span><span class="sr-only">${titulo}</span></label>
    </div>`;
}

function configMudou(e, confirmado) {
  const el = e.target;
  const caixa = el.type === 'checkbox' || el.type === 'radio';
  if (caixa && !confirmado) return; // caixas de marcar avisam no "change"

  if (el.name === 'cor-loja' || el.dataset.corLivre != null) {
    loja.cor = el.value;
    const livre = el.dataset.corLivre != null;
    $('.cor-livre', $('#aba-loja')).classList.toggle('ativa', livre);
    if (livre) $$('input[name="cor-loja"]', $('#aba-loja')).forEach((r) => { r.checked = false; });
    aplicarCor(loja.cor);
    mudou({ topo: true });
    return;
  }
  if (el.dataset.pagamento) {
    const marcadas = new Set(loja.pagamentos);
    if (el.checked) marcadas.add(el.dataset.pagamento);
    else marcadas.delete(el.dataset.pagamento);
    loja.pagamentos = [...PAGAMENTOS.filter((f) => marcadas.has(f)), ...[...marcadas].filter((f) => !PAGAMENTOS.includes(f))];
    mudou();
    return;
  }
  if (el.dataset.pergunta) {
    const ligadas = new Set(loja.perguntas);
    if (el.checked) ligadas.add(el.dataset.pergunta);
    else ligadas.delete(el.dataset.pergunta);
    loja.perguntas = Object.keys(PERGUNTAS).filter((k) => ligadas.has(k));
    mudou();
    return;
  }

  const campo = el.dataset.campo;
  if (!campo) return;
  switch (campo) {
    case 'nome':
      loja.nome = el.value.trim() || 'Minha loja';
      mudou({ topo: true });
      break;
    case 'descricao': case 'cidade': case 'endereco': case 'horario':
      loja[campo] = el.value.trim();
      mudou();
      break;
    case 'instagram':
      loja.instagram = el.value.replace(/^@+/, '').trim();
      mudou();
      break;
    case 'tipo':
      if (confirmado) { loja.tipo = el.value; mudou(); }
      break;
    case 'whatsapp': {
      if (!confirmado) return;
      const numero = normalizarWhatsApp(el.value);
      const valido = !el.value.trim() || /^55\d{10,11}$/.test(numero);
      $('#erro-cfg-whatsapp').classList.toggle('visivel', !valido);
      el.setAttribute('aria-invalid', String(!valido));
      if (!valido) return;
      loja.whatsapp = el.value.trim() ? numero : '';
      el.value = telefoneBonito(loja.whatsapp);
      mudou({ aba: false });
      toast(loja.whatsapp ? `Os pedidos vão pro ${telefoneBonito(loja.whatsapp)}.` : 'Sem número: o WhatsApp abre pro cliente escolher o contato.');
      break;
    }
    case 'taxaEntrega':
      if (!confirmado) return;
      loja.taxaEntrega = lerPreco(el.value);
      el.value = precoParaCampo(loja.taxaEntrega);
      mudou();
      break;
    case 'pedidos': case 'entrega': case 'retirada':
      loja[campo] = el.checked;
      if (!loja.entrega && !loja.retirada) {
        loja[campo === 'entrega' ? 'retirada' : 'entrega'] = true;
        toast('A loja precisa ter entrega ou retirada: deixei a outra ligada.');
        renderAba();
      }
      $('#campo-taxa').hidden = !loja.entrega;
      mudou();
      break;
    default:
      break;
  }
}

async function restaurarExemplo() {
  if (!(await confirmar('Voltar a loja ao exemplo original? Suas mudanças nos produtos e nas configurações se perdem.', { sim: 'Voltar ao original', perigo: true }))) return;
  const exemplo = await buscarExemplo(loja.exemplo);
  if (!exemplo) {
    toast('Não consegui baixar o exemplo agora.', { tipo: 'erro' });
    return;
  }
  const indice = lojas.indexOf(loja);
  lojas[indice] = normalizarLoja({
    ...exemplo, slug: loja.slug, exemplo: loja.exemplo, criadaEm: loja.criadaEm, marcos: loja.marcos, nuvem: loja.nuvem,
  });
  loja = lojas[indice];
  aplicarCor(loja.cor);
  mudou({ topo: true, aba: true });
  toast('Pronto, a loja voltou ao original.');
}

async function excluirLoja() {
  if (!(await confirmar(`Excluir "${loja.nome}" deste aparelho? Os produtos e os pedidos dela somem.`, { sim: 'Excluir loja', perigo: true }))) return;
  const slug = loja.slug;
  if (usarNuvem) {
    try {
      await excluirLojaDaNuvem(slug); // os pedidos dela somem junto (on delete cascade)
    } catch (erro) {
      toast(erro.message || 'Não consegui excluir a loja.', { tipo: 'erro' });
      return;
    }
    pararDeOuvir?.();
    pararDeOuvir = null;
  } else {
    await pedidosLocais.excluirDaLoja(slug).catch(() => {});
  }
  await lojasLocais.excluir(slug).catch(() => {});
  avisarMudanca({ tipo: 'loja', slug });
  lojas = lojas.filter((l) => l.slug !== slug);
  loja = null;
  toast('Loja excluída.');
  if (lojas[0]) await abrirLoja(lojas[0].slug);
  else {
    location.hash = '';
    mostrarBoasVindas(false);
  }
}

$('#importar-arquivo').addEventListener('change', async (e) => {
  const arquivo = e.target.files[0];
  e.target.value = '';
  if (!arquivo) return;
  let dados;
  try {
    dados = JSON.parse(await arquivo.text());
    if (!dados || typeof dados !== 'object' || !Array.isArray(dados.produtos)) throw new Error('formato');
  } catch {
    toast('Esse arquivo não é uma loja do Vitrine Zap.', { tipo: 'erro' });
    return;
  }
  const importada = normalizarLoja({ ...dados, nuvem: null, pendente: false });
  const existente = lojas.find((l) => l.slug === importada.slug);
  if (existente) {
    if (!(await confirmar(`Já existe a loja "${existente.nome}" com esse endereço. Substituir pelos dados do arquivo?`, { sim: 'Substituir' }))) return;
  } else if (usarNuvem) {
    importada.slug = await slugLivre(importada.slug); // o endereço pode ser de outra pessoa
  }
  try {
    await guardar(importada);
  } catch (erro) {
    toast(erro.message || 'Não consegui salvar a loja importada.', { tipo: 'erro' });
    return;
  }
  lojas = [...lojas.filter((l) => l.slug !== importada.slug), importada];
  await abrirLoja(importada.slug);
  toast(`"${importada.nome}" importada com ${plural(importada.produtos.length, 'produto', 'produtos')}.`);
});

// ══════════ Trocar de loja ══════════
$('#seletor-loja').addEventListener('click', () => {
  $('#lista-lojas').innerHTML = lojas.map((l) => `
    <li><button type="button" data-trocar="${esc(l.slug)}" aria-current="${l.slug === loja?.slug}">
      <span class="seletor-emoji" style="--marca:${l.cor}" aria-hidden="true">${esc(l.emoji)}</span>
      <span class="seletor-textos"><span class="seletor-nome">${esc(l.nome)}</span>
        <span class="seletor-dica">${l.exemplo ? 'loja de exemplo' : plural(l.produtos.length, 'produto', 'produtos')}</span></span>
    </button></li>`).join('');
  abrirJanela($('#dlg-lojas'));
});

$('#lista-lojas').addEventListener('click', async (e) => {
  const botao = e.target.closest('[data-trocar]');
  if (!botao) return;
  $('#dlg-lojas').close();
  if (botao.dataset.trocar !== loja?.slug) {
    gravar.agora();
    await abrirLoja(botao.dataset.trocar);
    toast(`Agora você está em "${loja.nome}".`);
  }
});

$('#nova-loja').addEventListener('click', () => {
  $('#dlg-lojas').close();
  mostrarBoasVindas(true);
});

// ══════════ Boas-vindas: criar a loja ══════════
function montarBoasVindas() {
  $('#nova-tipos').innerHTML = Object.entries(TIPOS).map(([chave, t], i) => `
    <label class="opcao-cartao">
      <input type="radio" name="tipo" value="${chave}"${i === 0 ? ' checked' : ''}>
      <span><span class="emoji-tipo" aria-hidden="true">${t.emoji}</span><strong>${t.nome}</strong></span>
    </label>`).join('');
  $('#nova-cores').innerHTML = CORES.map((c, i) => `
    <label class="cor" style="background:${c}"><input type="radio" name="cor" value="${c}"${i === 0 ? ' checked' : ''} aria-label="Cor ${c}"></label>`).join('');
  $('#exemplos-rapidos').innerHTML = EXEMPLOS.map((ex) => `
    <button type="button" class="exemplo-rapido" data-exemplo="${ex.slug}" style="--cor-exemplo:${ex.cor}">
      <span class="seletor-emoji" aria-hidden="true">${ex.emoji}</span>
      <span><strong>${esc(ex.nome)}</strong><small>${esc(ex.chamada)}</small></span>
    </button>`).join('');
}

const formNova = $('#form-nova');

// Escolheu o tipo: sugere a cor da loja de exemplo daquele tipo
formNova.addEventListener('change', (e) => {
  if (e.target.name !== 'tipo') return;
  const exemplo = EXEMPLOS.find((ex) => ex.slug === TIPOS[e.target.value].exemplo);
  const cor = formNova.querySelector(`input[name="cor"][value="${exemplo?.cor || VERDE}"]`);
  if (cor) cor.checked = true;
});
formNova.addEventListener('input', (e) => {
  if (e.target.name === 'nome') $('#erro-nova-nome').classList.remove('visivel');
  if (e.target.name === 'whatsapp') $('#erro-nova-whatsapp').classList.remove('visivel');
});

formNova.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = formNova.nome.value.trim();
  const whatsappDigitado = formNova.whatsapp.value.trim();
  const whatsapp = normalizarWhatsApp(whatsappDigitado);
  let erro = false;
  if (!nome) {
    $('#erro-nova-nome').classList.add('visivel');
    formNova.nome.focus();
    erro = true;
  }
  if (whatsappDigitado && !/^55\d{10,11}$/.test(whatsapp)) {
    $('#erro-nova-whatsapp').classList.add('visivel');
    if (!erro) formNova.whatsapp.focus();
    erro = true;
  }
  if (erro) return;

  const tipo = formNova.tipo.value;
  const base = {
    nome, tipo, whatsapp: whatsappDigitado ? whatsapp : '',
    cor: formNova.cor.value, emoji: TIPOS[tipo].emoji,
    mesas: tipo === 'restaurante' ? 10 : 0,
    categorias: [], produtos: [],
  };
  if (formNova.exemplos.checked) {
    const exemplo = TIPOS[tipo].exemplo ? await buscarExemplo(TIPOS[tipo].exemplo) : null;
    if (exemplo) {
      Object.assign(base, {
        categorias: exemplo.categorias, produtos: exemplo.produtos, perguntas: exemplo.perguntas,
        pagamentos: exemplo.pagamentos, taxaEntrega: exemplo.taxaEntrega,
      });
    } else {
      base.categorias = ['Produtos'];
      base.produtos = [
        { nome: 'Produto de exemplo 1', categoria: 'Produtos', preco: 29.9, descricao: 'Troque pelo seu produto no painel.', emoji: '🛍️', destaque: true },
        { nome: 'Produto de exemplo 2', categoria: 'Produtos', preco: 49.9, descricao: 'Nome, preço, descrição e foto: tudo pelo celular.', emoji: '🎁' },
        { nome: 'Produto de exemplo 3', categoria: 'Produtos', preco: 19.9, emoji: '🧴' },
      ];
    }
  }
  try {
    const nova = await salvarLojaNova(base);
    formNova.reset();
    montarBoasVindas();
    location.hash = '#inicio';
    await abrirLoja(nova.slug);
    toast('Loja criada! Agora é divulgar o link.', { tempo: 4000 });
  } catch (erro) {
    toast(erro.message || 'Não consegui salvar a loja.', { tipo: 'erro' });
  }
});

$('#sair-boas-vindas').addEventListener('click', sairDaConta);

$('#exemplos-rapidos').addEventListener('click', (e) => {
  const botao = e.target.closest('[data-exemplo]');
  if (botao) {
    location.hash = '#inicio';
    abrirExemplo(botao.dataset.exemplo);
  }
});

$('#voltar-painel').addEventListener('click', () => {
  const ultima = loja || lojas[0];
  if (ultima) abrirLoja(ultima.slug);
});

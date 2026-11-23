// Catálogo da loja (loja/?l=SLUG). Dois jeitos de abrir:
//  • pelo link (Instagram, status do WhatsApp...): sacola + pedido pronto no WhatsApp;
//  • pelo QR code da mesa (loja/?l=SLUG&mesa=7): cardápio só pra ver, o pedido é com o garçom.

import { pedidosLocais } from './banco.js';
import {
  EXEMPLOS, PERGUNTAS, RAIZ, aoMudar, avisarMudanca, carregarLoja, montarMensagem, produtosPorCategoria,
  respostasProntas, totais, urlDaLoja,
} from './dados.js';
import { icone } from './icones.js';
import { enviarPedidoPraNuvem, nuvemLigada } from './nuvem.js';
import { iniciarPWA } from './pwa.js';
import {
  $, $$, abrirJanela, aplicarCor, centavos, compartilhar, dataISO, dinheiro, esc, idCurto, linkWhatsApp,
  precoTexto, prepararJanelas, semAcento, slugify, telefoneBonito, toast,
} from './util.js';

const parametros = new URLSearchParams(location.search);
const slug = slugify(parametros.get('l') || '');
const mesa = parseInt(parametros.get('mesa'), 10) || null;
const emMoldura = parametros.has('moldura'); // dentro do celular de demonstração da página inicial
const raiz = $('#raiz');

let loja = null;
let fonte = '';
let porId = new Map();
let sacola = new Map(); // id do produto → quantidade
let produtoAberto = null;
let quantidade = 1;

const vendePeloSite = () => loja.pedidos && !mesa;
const chaveSacola = () => `vz-sacola-${slug}`;

// ── Início ──
iniciarPWA();
prepararJanelas();
$$('[data-icone]').forEach((el) => el.insertAdjacentHTML('afterbegin', icone(el.dataset.icone)));
iniciar();

async function iniciar() {
  if (!slug) {
    mostrarEscolha();
    return;
  }
  const achou = await carregarLoja(slug);
  if (!achou) {
    mostrarNaoAchou();
    return;
  }
  ({ loja, fonte } = achou);
  porId = new Map(loja.produtos.map((p) => [p.id, p]));
  sacola = lerSacola();
  document.title = mesa ? `Mesa ${mesa} · Cardápio · ${loja.nome}` : `${loja.nome} · Catálogo`;
  aplicarCor(loja.cor);
  montarPagina();
  montarFormulario();

  const produto = parametros.get('produto');
  if (produto && porId.has(produto)) abrirProduto(produto);

  // O painel salvou alguma coisa em outra aba: recarrega os dados sem perder a sacola
  aoMudar(async (mensagem) => {
    if (mensagem?.tipo !== 'loja' || mensagem.slug !== slug) return;
    const nova = await carregarLoja(slug);
    if (!nova) return;
    ({ loja, fonte } = nova);
    porId = new Map(loja.produtos.map((p) => [p.id, p]));
    sacola = lerSacola();
    aplicarCor(loja.cor);
    montarPagina();
    montarFormulario();
    toast('Catálogo atualizado pelo painel.');
  });
}

// ── Página ──
function montarPagina() {
  const temProdutos = loja.produtos.length > 0;
  raiz.innerHTML = `
    ${faixaDeAviso()}
    <header class="loja-topo">
      <div class="container loja-topo-conteudo">
        <div class="loja-avatar" aria-hidden="true">${esc(loja.emoji)}</div>
        <div class="loja-info">
          ${mesa ? `<p class="loja-mesa">🍽️ Mesa ${mesa}</p>` : ''}
          <h1>${esc(loja.nome)}</h1>
          ${loja.descricao ? `<p class="loja-descricao">${esc(loja.descricao)}</p>` : ''}
          <ul class="loja-meta">
            ${loja.cidade ? `<li>📍 ${esc(loja.cidade)}</li>` : ''}
            ${loja.horario ? `<li>🕒 ${esc(loja.horario)}</li>` : ''}
            ${loja.instagram ? `<li><a href="https://instagram.com/${encodeURIComponent(loja.instagram)}" target="_blank" rel="noopener">@${esc(loja.instagram)}</a></li>` : ''}
          </ul>
        </div>
      </div>
    </header>
    ${loja.aviso ? `<div class="faixa-aviso" role="note">${esc(loja.aviso)}</div>` : ''}
    ${mesa ? '<div class="faixa-mesa">Cardápio digital: escolha com calma e faça o pedido com o garçom 🙂</div>' : ''}
    ${!mesa && !loja.pedidos ? `<div class="faixa-mesa">Os pedidos pelo site estão pausados${loja.whatsapp ? ': fale com a loja pelo WhatsApp' : ''}.</div>` : ''}
    ${temProdutos ? `
      <div class="barra-busca">
        <div class="container">
          <label class="busca">
            ${icone('busca')}
            <span class="sr-only">Buscar no catálogo</span>
            <input class="entrada" id="busca" type="search" placeholder="Buscar no catálogo" autocomplete="off" enterkeyhint="search">
          </label>
          <nav class="cats" id="cats" aria-label="Categorias"></nav>
        </div>
      </div>` : ''}
    <main class="container loja-conteudo" id="conteudo" tabindex="-1"></main>
    ${rodape()}
    <div class="barra-sacola" id="barra-sacola" hidden>
      <button type="button" class="botao botao-primario" id="abrir-sacola"></button>
    </div>`;

  renderProdutos();
  atualizarBarra();

  $('#busca')?.addEventListener('input', (e) => renderProdutos(e.target.value));
  $('#abrir-sacola').addEventListener('click', abrirSacola);
  $('#cats')?.addEventListener('click', (e) => {
    const chip = e.target.closest('a[href^="#"]');
    if (!chip) return;
    e.preventDefault();
    document.getElementById(chip.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#conteudo').addEventListener('click', (e) => {
    const mais = e.target.closest('[data-mais]');
    if (mais) {
      adicionar(mais.dataset.mais, 1);
      const p = porId.get(mais.dataset.mais);
      toast(`${p.nome} na sacola`, { acao: 'Ver sacola', aoClicar: abrirSacola, tempo: 2400, chave: 'sacola' });
      return;
    }
    const abrir = e.target.closest('[data-abrir]');
    if (abrir) abrirProduto(abrir.dataset.abrir);
  });
}

function faixaDeAviso() {
  if (emMoldura || fonte === 'nuvem') return '';
  if (fonte === 'exemplo') {
    return `<div class="faixa-demo">Loja de exemplo do <a href="${RAIZ}">Vitrine Zap</a> · loja e preços fictícios · <a href="${RAIZ}#planos">quero uma pra minha loja</a></div>`;
  }
  if (nuvemLigada) return ''; // cópia guardada de uma loja da nuvem (sem internet): a faixa do offline já avisa
  return `<div class="faixa-demo">Versão salva neste aparelho (modo demonstração) · <a href="${RAIZ}painel/?loja=${encodeURIComponent(slug)}">editar no painel</a></div>`;
}

function rodape() {
  const entrega = loja.entrega
    ? `Entrega ${loja.taxaEntrega == null ? '(taxa a combinar)' : loja.taxaEntrega === 0 ? 'grátis' : `por ${dinheiro(loja.taxaEntrega)}`}`
    : '';
  const receber = [entrega, loja.retirada ? 'retirada na loja' : ''].filter(Boolean).join(' ou ');
  return `
    <footer class="loja-rodape">
      <div class="container loja-rodape-grade">
        <div>
          <h2>${esc(loja.nome)}</h2>
          <ul>
            ${loja.endereco || loja.cidade ? `<li>📍 ${esc([loja.endereco, loja.cidade].filter(Boolean).join(' · '))}</li>` : ''}
            ${loja.horario ? `<li>🕒 ${esc(loja.horario)}</li>` : ''}
            ${loja.pedidos && receber ? `<li>🛵 ${esc(receber.charAt(0).toUpperCase() + receber.slice(1))}</li>` : ''}
            ${loja.pagamentos.length ? `<li>💳 ${esc(loja.pagamentos.join(', '))}</li>` : ''}
            ${loja.whatsapp ? `<li>💬 ${esc(telefoneBonito(loja.whatsapp))}</li>` : ''}
          </ul>
        </div>
        <div>
          ${loja.whatsapp ? `<a class="botao botao-zap" href="${esc(linkWhatsApp(loja.whatsapp, `Olá, ${loja.nome}!`))}" target="_blank" rel="noopener">${icone('conversa')} Falar no WhatsApp</a>` : ''}
          <a class="feito-com" href="${RAIZ}">
            <img src="${RAIZ}icons/icone.svg" alt="" width="22" height="22">
            <span>Catálogo feito com <strong>Vitrine Zap</strong>: quer um pra sua loja?</span>
          </a>
        </div>
      </div>
    </footer>`;
}

const idDaCategoria = (categoria) => `cat-${slugify(categoria) || 'outros'}`;

function desenho(p, classe = '') {
  const conteudo = p.foto
    ? `<img src="${esc(p.foto)}" alt="" loading="lazy">`
    : `<span class="tile-emoji">${esc(p.emoji || loja.emoji)}</span>`;
  return `<span class="tile ${classe}" aria-hidden="true">${conteudo}</span>`;
}

function cartao(p) {
  const qtd = sacola.get(p.id) || 0;
  const podeComprar = vendePeloSite() && p.disponivel;
  return `
    <article class="produto${p.disponivel ? '' : ' esgotado'}">
      <button type="button" class="produto-abrir" data-abrir="${esc(p.id)}">
        ${desenho(p)}
        <span class="produto-corpo">
          <span class="produto-nome">${esc(p.nome)}</span>
          ${p.descricao ? `<span class="produto-desc">${esc(p.descricao)}</span>` : ''}
          <span class="produto-preco">${esc(precoTexto(p.preco))}</span>
        </span>
      </button>
      ${p.disponivel ? '' : '<span class="etiqueta etiqueta-escura">Esgotado</span>'}
      ${podeComprar ? `<button type="button" class="produto-mais${qtd ? ' tem' : ''}" data-mais="${esc(p.id)}"
        aria-label="${qtd ? `${qtd} na sacola. Adicionar mais um` : 'Adicionar à sacola'}: ${esc(p.nome)}">${qtd || '+'}</button>` : ''}
    </article>`;
}

function linhaDoCardapio(p) {
  return `
    <article class="item-cardapio${p.disponivel ? '' : ' esgotado'}">
      <button type="button" class="item-abrir" data-abrir="${esc(p.id)}">
        ${desenho(p, 'mini')}
        <span class="item-texto">
          <span class="item-nome">${esc(p.nome)}${p.disponivel ? '' : ' <span class="etiqueta">Acabou</span>'}</span>
          ${p.descricao ? `<span class="item-desc">${esc(p.descricao)}</span>` : ''}
        </span>
        <span class="item-preco">${esc(precoTexto(p.preco))}</span>
      </button>
    </article>`;
}

let observador = null;

function renderProdutos(filtro = '') {
  const conteudo = $('#conteudo');
  const termo = semAcento(filtro).trim();
  const lista = termo
    ? loja.produtos.filter((p) => semAcento(`${p.nome} ${p.descricao} ${p.categoria}`).includes(termo))
    : loja.produtos;
  const grupos = produtosPorCategoria(loja, lista);
  const destaques = !termo && !mesa ? loja.produtos.filter((p) => p.destaque && p.disponivel) : [];

  let html = '';
  if (destaques.length) {
    html += `
      <section class="destaques" aria-labelledby="titulo-destaques">
        <h2 id="titulo-destaques">⭐ Mais pedidos</h2>
        <div class="carrossel">${destaques.map(cartao).join('')}</div>
      </section>`;
  }
  html += grupos.map(([categoria, itens]) => `
    <section class="categoria" id="${idDaCategoria(categoria)}" aria-labelledby="t-${idDaCategoria(categoria)}">
      <h2 id="t-${idDaCategoria(categoria)}">${esc(categoria)} <small>${itens.length}</small></h2>
      ${mesa
    ? `<div class="lista-cardapio">${itens.map(linhaDoCardapio).join('')}</div>`
    : `<div class="grade-produtos">${itens.map(cartao).join('')}</div>`}
    </section>`).join('');

  if (!grupos.length) {
    html = loja.produtos.length
      ? `<div class="vazio"><span class="vazio-icone">🔎</span><strong>Nada encontrado pra “${esc(filtro.trim())}”</strong><span>Tente outra palavra ou veja as categorias.</span></div>`
      : `<div class="vazio"><span class="vazio-icone">${esc(loja.emoji)}</span><strong>O catálogo ainda está vazio</strong><span>A loja está cadastrando os produtos. Volte daqui a pouco!</span></div>`;
  }
  conteudo.innerHTML = html;

  // Chips das categorias, com a categoria visível marcada enquanto rola
  const cats = $('#cats');
  if (!cats) return;
  cats.hidden = !!termo || grupos.length < 2;
  cats.innerHTML = grupos.map(([categoria]) => `<a class="chip" href="#${idDaCategoria(categoria)}">${esc(categoria)}</a>`).join('');
  observador?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting) continue;
      const chip = cats.querySelector(`a[href="#${entrada.target.id}"]`);
      if (!chip) continue;
      cats.querySelectorAll('[aria-current]').forEach((c) => c.removeAttribute('aria-current'));
      chip.setAttribute('aria-current', 'true');
      cats.scrollTo({ left: chip.offsetLeft - cats.clientWidth / 2 + chip.clientWidth / 2, behavior: 'smooth' });
    }
  }, { rootMargin: '-140px 0px -65% 0px' });
  $$('.categoria', conteudo).forEach((secao) => observador.observe(secao));
}

// ── Sacola (guardada no aparelho até o pedido sair) ──
function lerSacola() {
  try {
    const salva = JSON.parse(localStorage.getItem(chaveSacola()) || '[]');
    return new Map(salva.filter(([id, qtd]) => porId.get(id)?.disponivel && qtd > 0));
  } catch {
    return new Map();
  }
}

function salvarSacola() {
  try { localStorage.setItem(chaveSacola(), JSON.stringify([...sacola])); } catch { /* sem armazenamento */ }
}

const itensDaSacola = () => [...sacola].map(([id, qtd]) => ({ produto: porId.get(id), qtd })).filter((i) => i.produto);

function adicionar(id, n) {
  const p = porId.get(id);
  if (!p || !p.disponivel || !vendePeloSite()) return;
  const nova = Math.max(0, Math.min(99, (sacola.get(id) || 0) + n));
  if (nova) sacola.set(id, nova);
  else sacola.delete(id);
  salvarSacola();
  $$(`[data-mais="${CSS.escape(id)}"]`).forEach((botao) => {
    botao.textContent = nova || '+';
    botao.classList.toggle('tem', nova > 0);
    botao.setAttribute('aria-label', `${nova ? `${nova} na sacola. Adicionar mais um` : 'Adicionar à sacola'}: ${p.nome}`);
  });
  atualizarBarra();
}

function atualizarBarra() {
  const barra = $('#barra-sacola');
  if (!barra) return;
  const t = totais(loja, itensDaSacola(), '');
  barra.hidden = !vendePeloSite() || t.quantidade === 0;
  $('#abrir-sacola').innerHTML = `
    <span><span class="qtd">${t.quantidade}</span>Ver sacola</span>
    <span class="total">${dinheiro(t.subtotal)}</span>`;
}

// ── Detalhe do produto ──
function abrirProduto(id) {
  const p = porId.get(id);
  if (!p) return;
  produtoAberto = p;
  quantidade = 1;
  $('#produto-categoria').textContent = p.categoria || 'Produto';
  $('#produto-tile').innerHTML = desenho(p, 'grande');
  $('#produto-nome').textContent = p.nome;
  $('#produto-preco').textContent = precoTexto(p.preco);
  $('#produto-desc').textContent = p.descricao;
  $('#produto-desc').hidden = !p.descricao;

  const rodapeDetalhe = $('#produto-rodape');
  if (mesa) {
    rodapeDetalhe.innerHTML = `<p class="ajuda" style="text-align:center">${p.disponivel ? 'Gostou? É só pedir pro garçom 😉' : 'Esse acabou por hoje 😕'}</p>`;
  } else if (!p.disponivel) {
    rodapeDetalhe.innerHTML = '<button type="button" class="botao botao-bloco botao-grande" disabled>Esgotado no momento</button>';
  } else if (!loja.pedidos) {
    rodapeDetalhe.innerHTML = loja.whatsapp
      ? `<a class="botao botao-zap botao-bloco botao-grande" target="_blank" rel="noopener" href="${esc(linkWhatsApp(loja.whatsapp, `Olá! Tem ${p.nome}?`))}">${icone('conversa')} Perguntar no WhatsApp</a>`
      : '<p class="ajuda" style="text-align:center">Os pedidos pelo site estão pausados.</p>';
  } else {
    rodapeDetalhe.innerHTML = `
      <div class="rodape-detalhe">
        <div class="quantidade">
          <button type="button" id="qtd-menos" aria-label="Menos um">−</button>
          <output id="qtd-valor" aria-live="polite">1</output>
          <button type="button" id="qtd-mais" aria-label="Mais um">+</button>
        </div>
        <button type="button" class="botao botao-primario botao-grande" id="produto-adicionar"></button>
      </div>`;
    const atualizar = () => {
      $('#qtd-valor').textContent = quantidade;
      $('#qtd-menos').disabled = quantidade <= 1;
      $('#produto-adicionar').textContent = p.preco == null
        ? 'Adicionar à sacola'
        : `Adicionar · ${dinheiro((centavos(p.preco) * quantidade) / 100)}`;
    };
    $('#qtd-menos').onclick = () => { quantidade = Math.max(1, quantidade - 1); atualizar(); };
    $('#qtd-mais').onclick = () => { quantidade = Math.min(99, quantidade + 1); atualizar(); };
    $('#produto-adicionar').onclick = () => {
      adicionar(p.id, quantidade);
      $('#dlg-produto').close();
      toast(`${quantidade > 1 ? `${quantidade}x ` : ''}${p.nome} na sacola`, { acao: 'Ver sacola', aoClicar: abrirSacola, tempo: 2400, chave: 'sacola' });
    };
    atualizar();
  }
  abrirJanela($('#dlg-produto'));
}

$('#produto-compartilhar').addEventListener('click', () => {
  if (!produtoAberto) return;
  const p = produtoAberto;
  compartilhar({
    titulo: p.nome,
    texto: `${p.nome} (${precoTexto(p.preco)}) na ${loja.nome}`,
    url: urlDaLoja(slug, { produto: p.id }),
  });
});

// ── Formulário do pedido ──
const form = $('#form-pedido');

function montarFormulario() {
  if (!loja.pedidos) return;
  const modos = [
    loja.entrega && {
      valor: 'entrega',
      titulo: 'Entrega',
      detalhe: loja.taxaEntrega == null ? 'Taxa combinada no WhatsApp' : loja.taxaEntrega === 0 ? 'Grátis' : `Taxa de ${dinheiro(loja.taxaEntrega)}`,
    },
    loja.retirada && {
      valor: 'retirada',
      titulo: 'Retirar na loja',
      detalhe: loja.endereco || 'Sem taxa de entrega',
    },
  ].filter(Boolean);
  $('#opcoes-modo').innerHTML = modos.map((m) => `
    <label class="opcao-cartao">
      <input type="radio" name="modo" value="${m.valor}"${modos.length === 1 ? ' checked' : ''}>
      <span><strong>${m.titulo}</strong><small>${esc(m.detalhe)}</small></span>
    </label>`).join('');
  $('#campo-modo').hidden = modos.length === 1;

  $('#campos-perguntas').innerHTML = loja.perguntas.map((chave) => campoDaPergunta(chave, PERGUNTAS[chave])).join('');

  $('#opcoes-pagamento').innerHTML = loja.pagamentos.map((forma) => `
    <label class="chip"><input type="radio" name="pagamento" value="${esc(forma)}">${esc(forma)}</label>`).join('');
  $('#campo-pagamento').hidden = loja.pagamentos.length === 0;

  // Nome e endereço da última compra, pra não digitar de novo
  try {
    const cliente = JSON.parse(localStorage.getItem('vz-cliente') || '{}');
    if (cliente.nome && !form.nome.value) form.nome.value = cliente.nome;
    if (cliente.endereco && !form.endereco.value) form.endereco.value = cliente.endereco;
  } catch { /* nada guardado */ }
  aplicarModo(modoEscolhido());
}

function campoDaPergunta(chave, p) {
  const nome = `p_${chave}`;
  const quando = p.quando ? ` data-quando="${p.quando}"` : '';
  const erro = `<p class="erro" id="erro-${nome}">${p.tipo === 'data' ? 'Escolha uma data a partir de hoje.' : 'Preencha este campo.'}</p>`;
  const opcional = p.obrigatorio ? '' : ' <span class="opcional">(opcional)</span>';
  const ajuda = p.ajuda ? `<p class="ajuda">${esc(p.ajuda)}</p>` : '';
  if (p.tipo === 'sim_nao') {
    return `
      <div class="campo"${quando}>
        <label class="interruptor"><input type="checkbox" name="${nome}" value="sim"><span class="trilho"></span><span class="rotulo">${esc(p.rotulo)}</span></label>
        ${ajuda}
      </div>`;
  }
  if (p.tipo === 'opcoes') {
    return `
      <fieldset${quando}>
        <legend>${esc(p.rotulo)}${opcional}</legend>
        <div class="chips">${p.opcoes.map((o) => `<label class="chip"><input type="radio" name="${nome}" value="${esc(o)}">${esc(o)}</label>`).join('')}</div>
        ${ajuda}${erro}
      </fieldset>`;
  }
  const entrada = p.tipo === 'texto_longo'
    ? `<textarea class="entrada" name="${nome}" rows="3" maxlength="${p.max || 300}" placeholder="${esc(p.placeholder || '')}"></textarea>`
    : p.tipo === 'data'
      ? `<input class="entrada" type="date" name="${nome}" min="${dataISO()}" max="${dataISO(new Date(Date.now() + 120 * 864e5))}">`
      : `<input class="entrada" name="${nome}" maxlength="120" placeholder="${esc(p.placeholder || '')}">`;
  return `
    <label class="campo"${quando}>
      <span>${esc(p.rotulo)}${opcional}</span>
      ${entrada}
      ${ajuda}${erro}
    </label>`;
}

function modoEscolhido() {
  return form.querySelector('input[name="modo"]:checked')?.value || '';
}

function aplicarModo(modo) {
  $('#campo-endereco').hidden = modo !== 'entrega';
  $$('[data-quando]', form).forEach((el) => { el.hidden = el.dataset.quando !== modo; });
  renderResumo();
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'modo') aplicarModo(e.target.value);
  limparErro(e.target.name);
});
form.addEventListener('input', (e) => limparErro(e.target.name));

function limparErro(nome) {
  const erro = nome && document.getElementById(`erro-${nome}`);
  if (!erro) return;
  erro.classList.remove('visivel');
  $$(`[name="${nome}"]`, form).forEach((el) => el.removeAttribute('aria-invalid'));
}

function lerFormulario() {
  const dados = new FormData(form);
  const valor = (nome) => String(dados.get(nome) || '').trim();
  const modo = modoEscolhido();
  const respostas = {};
  for (const chave of loja.perguntas) respostas[chave] = valor(`p_${chave}`);
  return {
    nome: valor('nome'),
    modo,
    endereco: modo === 'entrega' ? valor('endereco') : '',
    respostas,
    pagamento: valor('pagamento'),
    obs: valor('obs'),
  };
}

function validar(d) {
  const faltando = [];
  if (!d.nome) faltando.push('nome');
  if (!d.modo) faltando.push('modo');
  if (d.modo === 'entrega' && !d.endereco) faltando.push('endereco');
  for (const chave of loja.perguntas) {
    const p = PERGUNTAS[chave];
    if (p.quando && p.quando !== d.modo) continue;
    const resposta = d.respostas[chave];
    if (p.obrigatorio && !resposta) faltando.push(`p_${chave}`);
    else if (p.tipo === 'data' && resposta && resposta < dataISO()) faltando.push(`p_${chave}`);
  }
  if (loja.pagamentos.length && !d.pagamento) faltando.push('pagamento');
  return faltando;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const itens = itensDaSacola();
  if (!itens.length) return;
  const dados = lerFormulario();
  const faltando = validar(dados);
  if (faltando.length) {
    for (const nome of faltando) {
      document.getElementById(`erro-${nome}`)?.classList.add('visivel');
      $$(`[name="${nome}"]`, form).forEach((el) => el.setAttribute('aria-invalid', 'true'));
    }
    const primeiro = form.querySelector(`[name="${faltando[0]}"]`);
    primeiro?.closest('fieldset, .campo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    primeiro?.focus({ preventScroll: true });
    return;
  }

  const url = linkWhatsApp(loja.whatsapp, montarMensagem(loja, itens, dados));
  window.open(url, '_blank', 'noopener'); // primeiro: o navegador só deixa abrir logo depois do toque
  $('#link-reabrir').href = url;
  mostrarEnviado(true);
  registrarPedido(dados, itens);
  try {
    localStorage.setItem('vz-cliente', JSON.stringify({ nome: dados.nome, endereco: dados.endereco || undefined }));
  } catch { /* sem armazenamento */ }
});

// Registra o pedido pra aba "Pedidos" do painel: loja da nuvem → Supabase (o dono vê
// na hora, de qualquer aparelho); modo demonstração → IndexedDB deste navegador.
function registrarPedido(dados, itens) {
  const t = totais(loja, itens, dados.modo);
  const pedido = {
    nome: dados.nome,
    modo: dados.modo,
    endereco: dados.endereco,
    pagamento: dados.pagamento,
    obs: dados.obs,
    respostas: respostasProntas(loja, dados.respostas, dados.modo).map(({ rotulo, valor }) => ({ rotulo, valor })),
    itens: itens.map(({ produto, qtd }) => ({ id: produto.id, nome: produto.nome, qtd, preco: produto.preco })),
    subtotal: t.subtotal,
    taxa: t.taxa,
    total: t.total,
  };
  if (fonte === 'nuvem') {
    enviarPedidoPraNuvem(slug, pedido).catch(() => {}); // se falhar, o pedido já foi pelo WhatsApp
    return;
  }
  pedidosLocais.salvar({ ...pedido, id: `${Date.now()}-${idCurto()}`, loja: slug, criadoEm: Date.now(), status: 'novo' })
    .then(() => avisarMudanca({ tipo: 'pedido', slug })).catch(() => {});
}

function mostrarEnviado(enviado) {
  $('#sacola-pedido').hidden = enviado;
  $('#sacola-enviado').hidden = !enviado;
  $('#rodape-pedido').hidden = enviado;
  $('#rodape-enviado').hidden = !enviado;
}

$('#botao-novo-pedido').addEventListener('click', () => {
  sacola.clear();
  salvarSacola();
  const nome = form.nome.value;
  const endereco = form.endereco.value;
  form.reset();
  form.nome.value = nome;
  form.endereco.value = endereco;
  montarFormulario();
  renderProdutos($('#busca')?.value || '');
  atualizarBarra();
  $('#dlg-sacola').close();
});

// ── Janela da sacola ──
function abrirSacola() {
  if (!vendePeloSite()) return;
  mostrarEnviado(false);
  $('#aviso-demo-sacola').hidden = !!loja.whatsapp;
  renderSacola();
  abrirJanela($('#dlg-sacola'));
}

function renderSacola() {
  const itens = itensDaSacola();
  $('#sacola-itens').innerHTML = itens.map(({ produto: p, qtd }) => `
    <li class="sacola-item">
      ${desenho(p, 'mini')}
      <div class="sacola-item-info">
        <p class="sacola-item-nome">${esc(p.nome)}</p>
        <p class="sacola-item-preco">${p.preco == null ? 'Preço sob consulta' : `${dinheiro(p.preco)} cada`}</p>
        <div class="sacola-item-acoes">
          <div class="quantidade pequena">
            <button type="button" data-menos="${esc(p.id)}" aria-label="Tirar um: ${esc(p.nome)}">−</button>
            <span>${qtd}</span>
            <button type="button" data-mais-sacola="${esc(p.id)}" aria-label="Mais um: ${esc(p.nome)}">+</button>
          </div>
          <button type="button" class="botao-link" data-remover="${esc(p.id)}">Remover</button>
        </div>
      </div>
      <span class="sacola-item-total">${p.preco == null ? 'a consultar' : dinheiro((centavos(p.preco) * qtd) / 100)}</span>
    </li>`).join('');
  if (!itens.length) {
    $('#sacola-itens').innerHTML = `<li class="vazio"><span class="vazio-icone">🛍️</span><strong>A sacola está vazia</strong><span>Escolha alguma coisa no catálogo.</span></li>`;
  }
  $('#form-pedido').hidden = !itens.length;
  $('#rodape-pedido').hidden = !itens.length;
  renderResumo();
}

function renderResumo() {
  const itens = itensDaSacola();
  const modo = modoEscolhido();
  const t = totais(loja, itens, modo);
  $('#sacola-resumo').hidden = !itens.length;
  $('#sacola-resumo').innerHTML = `
    <div><span>Produtos</span><span>${dinheiro(t.subtotal)}</span></div>
    ${modo === 'entrega' ? `<div><span>Entrega</span><span>${t.taxaACombinar ? 'a combinar' : t.taxa ? dinheiro(t.taxa) : 'grátis'}</span></div>` : ''}
    <div class="total-final"><span>Total</span><span>${dinheiro(t.total)}</span></div>`;
}

$('#sacola-itens').addEventListener('click', (e) => {
  const botao = e.target.closest('button');
  if (!botao) return;
  const id = botao.dataset.menos || botao.dataset.maisSacola || botao.dataset.remover;
  if (!id) return;
  if (botao.dataset.remover) adicionar(id, -99);
  else adicionar(id, botao.dataset.menos ? -1 : 1);
  renderSacola();
});

// ── Sem loja no endereço ──
function mostrarEscolha() {
  document.title = 'Lojas de exemplo · Vitrine Zap';
  raiz.innerHTML = `
    <main class="container nao-achou" id="conteudo">
      <img src="${RAIZ}icons/icone.svg" alt="" width="64" height="64">
      <h1>Qual loja você quer ver?</h1>
      <p>Estas são lojas de exemplo do Vitrine Zap. Abra uma, monte a sacola e veja o pedido chegar no WhatsApp.</p>
      <div class="exemplos" style="width:100%;max-width:1040px;text-align:left">
        ${EXEMPLOS.map((ex) => `
          <a class="exemplo" style="--cor-exemplo:${ex.cor}" href="${urlDaLoja(ex.slug)}">
            <div class="exemplo-capa"><span>${ex.emoji}</span></div>
            <div class="exemplo-corpo"><strong>${esc(ex.nome)}</strong><p>${esc(ex.chamada)}</p><span class="abrir">Abrir catálogo →</span></div>
          </a>`).join('')}
      </div>
      <a class="botao botao-primario" href="${RAIZ}painel/">Criar o catálogo da minha loja</a>
    </main>`;
}

function mostrarNaoAchou() {
  document.title = 'Loja não encontrada · Vitrine Zap';
  raiz.innerHTML = `
    <main class="container nao-achou" id="conteudo">
      <div class="vazio-icone">🔎</div>
      <h1>Não achamos essa loja</h1>
      <p>Confira o link. Se a loja foi criada no painel em <strong>modo demonstração</strong>, ela fica salva só no
        aparelho de quem criou: abra o link nesse mesmo navegador.</p>
      <div class="linha-botoes" style="justify-content:center">
        <a class="botao botao-primario" href="${RAIZ}loja/">Ver lojas de exemplo</a>
        <a class="botao" href="${RAIZ}">Conhecer o Vitrine Zap</a>
      </div>
    </main>`;
}

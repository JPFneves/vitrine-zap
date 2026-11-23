// O "modelo de dados" do Vitrine Zap: como é uma loja, de onde ela vem e como
// o pedido vira a mensagem do WhatsApp.

import { lojasLocais } from './banco.js';
import { CONTATO_WHATSAPP } from './config.js';
import { lojaDaNuvem, nuvemLigada } from './nuvem.js';
import { centavos, dataPorExtenso, dinheiro, esc, normalizarWhatsApp, slugify } from './util.js';

// Raiz do site, calculada a partir deste arquivo: funciona no domínio próprio e
// numa subpasta (como no GitHub Pages: usuario.github.io/vitrine-zap/).
export const RAIZ = new URL('../', import.meta.url).href;

// Botões "Quero minha loja" e "Fale com a gente": vão pro WhatsApp da Neves Tecnologia (js/config.js)
export function linkDeContato(mensagem = 'Olá! Quero colocar minha loja no Vitrine Zap.') {
  const numero = normalizarWhatsApp(CONTATO_WHATSAPP); // põe o 55 se vier só com DDD
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : 'https://nevestecnologia.com';
}

export const EXEMPLOS = [
  { slug: 'emporio-da-serra', nome: 'Empório da Serra', tipo: 'emporio', emoji: '🧀', cor: '#7a4a24',
    chamada: 'Queijos, doces e cafés com sacola e pedido no WhatsApp.' },
  { slug: 'floricultura-bela-flor', nome: 'Floricultura Bela Flor', tipo: 'floricultura', emoji: '💐', cor: '#b03a5b',
    chamada: 'Entrega com data, período e a mensagem do cartão.' },
  { slug: 'restaurante-tempero-da-serra', nome: 'Restaurante Tempero da Serra', tipo: 'restaurante', emoji: '🍲', cor: '#b9461f',
    chamada: 'Cardápio de mesa pelo QR code e delivery pelo WhatsApp.', mesa: 7 },
  { slug: 'doce-encanto-confeitaria', nome: 'Doce Encanto Confeitaria', tipo: 'confeitaria', emoji: '🎂', cor: '#7c3aed',
    chamada: 'Encomendas de bolos e doces com data marcada.' },
];

export const TIPOS = {
  emporio: { nome: 'Empório ou mercearia', emoji: '🧀', exemplo: 'emporio-da-serra' },
  floricultura: { nome: 'Floricultura', emoji: '💐', exemplo: 'floricultura-bela-flor' },
  restaurante: { nome: 'Restaurante ou lanchonete', emoji: '🍲', exemplo: 'restaurante-tempero-da-serra' },
  confeitaria: { nome: 'Confeitaria ou doceria', emoji: '🎂', exemplo: 'doce-encanto-confeitaria' },
  outro: { nome: 'Outro comércio', emoji: '🛍️', exemplo: null },
};

export const PAGAMENTOS = ['Pix', 'Cartão', 'Dinheiro', 'Vale-refeição'];
export const CORES = ['#0f7a55', '#7a4a24', '#b03a5b', '#b9461f', '#7c3aed', '#1d4ed8', '#0e7490', '#be123c', '#4d7c0f', '#27272a'];
export const EMOJIS = ['🧀', '🍯', '☕', '🥖', '🥐', '🍞', '🥯', '🍪', '🍫', '🍬', '🍮', '🎂', '🍰', '🧁', '🥧', '🍓', '🍋', '🍊', '🥑', '🥬',
  '🍅', '🥩', '🍗', '🥓', '🍖', '🐟', '🍲', '🥘', '🍝', '🍕', '🍔', '🌭', '🍟', '🥟', '🥗', '🍱', '🥤', '🧃', '🍺', '🍷',
  '🥃', '🍹', '💧', '🌹', '🌻', '💐', '🌸', '🌺', '🌼', '🪴', '🌿', '🎁', '🧺', '🎈', '🧸', '🕯️', '🧴', '👗', '👟', '🛍️'];

// Perguntas extras que cada loja pode ligar no painel. Vão no formulário da
// sacola e na mensagem do WhatsApp. quando: sempre (padrão), entrega ou retirada.
export const PERGUNTAS = {
  destinatario: { rotulo: 'Para quem é?', naMensagem: 'Para', tipo: 'texto', quando: 'entrega', obrigatorio: true,
    placeholder: 'Nome de quem vai receber', descricao: 'Nome de quem vai receber (presentes e flores)' },
  data: { rotulo: 'Para quando?', naMensagem: 'Data', tipo: 'data', obrigatorio: true,
    descricao: 'Data da entrega ou da retirada (encomendas)' },
  periodo: { rotulo: 'Período', tipo: 'opcoes', opcoes: ['Manhã', 'Tarde', 'Noite'], obrigatorio: true,
    descricao: 'Manhã, tarde ou noite' },
  cartao: { rotulo: 'Mensagem do cartão', naMensagem: 'Cartão', tipo: 'texto_longo', max: 300,
    placeholder: 'Ex.: Feliz aniversário, mãe! Com amor, Ana.',
    ajuda: 'Vai escrita num cartão junto com o pedido. Deixe em branco se não quiser cartão.',
    descricao: 'Texto do cartão que vai junto com o presente' },
  anonimo: { rotulo: 'Entrega anônima', naMensagem: 'Entrega anônima', tipo: 'sim_nao', quando: 'entrega',
    ajuda: 'Não contamos pra quem recebe quem mandou.', descricao: 'Não contar quem mandou' },
  talheres: { rotulo: 'Mandar talheres descartáveis', naMensagem: 'Talheres', tipo: 'sim_nao', quando: 'entrega',
    ajuda: 'Só mandamos se você pedir: menos lixo.', descricao: 'Pra delivery de comida' },
};

export function normalizarProduto(p = {}) {
  return {
    id: String(p.id || slugify(p.nome) || Math.random().toString(36).slice(2, 8)),
    nome: String(p.nome || 'Produto sem nome').trim(),
    categoria: String(p.categoria || '').trim(),
    preco: p.preco == null || p.preco === '' ? null : Math.round(Number(p.preco) * 100) / 100,
    descricao: String(p.descricao || '').trim(),
    emoji: String(p.emoji || '').trim(),
    foto: typeof p.foto === 'string' && p.foto.startsWith('data:image/') ? p.foto : '',
    disponivel: p.disponivel !== false,
    destaque: !!p.destaque,
  };
}

// Completa uma loja com os valores padrão (vale pra JSON de exemplo, loja do
// painel e arquivo importado), pra nenhuma página quebrar por campo faltando.
export function normalizarLoja(b = {}) {
  const tipo = TIPOS[b.tipo] ? b.tipo : 'outro';
  const loja = {
    slug: slugify(b.slug || b.nome) || 'minha-loja',
    nome: String(b.nome || 'Minha loja').trim(),
    tipo,
    descricao: String(b.descricao || '').trim(),
    emoji: String(b.emoji || TIPOS[tipo].emoji),
    cor: /^#[0-9a-f]{6}$/i.test(b.cor || '') ? b.cor.toLowerCase() : '#0f7a55',
    whatsapp: String(b.whatsapp || '').replace(/\D/g, ''),
    cidade: String(b.cidade || ''),
    endereco: String(b.endereco || ''),
    horario: String(b.horario || ''),
    instagram: String(b.instagram || '').replace(/^@/, '').trim(),
    aviso: String(b.aviso || ''),
    pedidos: b.pedidos !== false,
    entrega: b.entrega !== false,
    retirada: b.retirada !== false,
    taxaEntrega: typeof b.taxaEntrega === 'number' && b.taxaEntrega >= 0 ? b.taxaEntrega : null,
    pagamentos: Array.isArray(b.pagamentos) ? b.pagamentos.filter(Boolean) : ['Pix', 'Cartão', 'Dinheiro'],
    perguntas: (Array.isArray(b.perguntas) ? b.perguntas : []).filter((k) => PERGUNTAS[k]),
    mesas: Math.max(0, Math.min(99, parseInt(b.mesas, 10) || 0)),
    categorias: Array.isArray(b.categorias) ? b.categorias.map((c) => String(c).trim()).filter(Boolean) : [],
    produtos: (Array.isArray(b.produtos) ? b.produtos : []).map(normalizarProduto),
    exemplo: b.exemplo || null, // slug da loja de exemplo de onde esta cópia saiu
    marcos: b.marcos && typeof b.marcos === 'object' ? { ...b.marcos } : {}, // tarefas do "deixe sua loja pronta"
    // Só no aparelho, com o Supabase ligado: de qual conta é a cópia e se falta subir pra nuvem
    nuvem: b.nuvem || null,
    pendente: !!b.pendente,
    // Com o Supabase: a Neves Tecnologia pausa a loja de quem não pagou (coluna lojas.ativa)
    ativa: b.ativa !== false,
    criadaEm: b.criadaEm || Date.now(),
    atualizadaEm: b.atualizadaEm || Date.now(),
  };
  for (const p of loja.produtos) {
    if (p.categoria && !loja.categorias.includes(p.categoria)) loja.categorias.push(p.categoria);
  }
  if (!loja.entrega && !loja.retirada) loja.retirada = true;
  return loja;
}

export async function buscarExemplo(slug) {
  if (!/^[a-z0-9-]+$/.test(slug || '')) return null;
  try {
    const resposta = await fetch(`${RAIZ}dados/lojas/${slug}.json`);
    if (!resposta.ok) return null;
    return normalizarLoja(await resposta.json());
  } catch {
    return null;
  }
}

// A loja que o catálogo vai mostrar:
//  1. com o Supabase ligado, a da nuvem (abre em qualquer aparelho);
//  2. a guardada neste aparelho (criada ou editada no painel no modo demonstração);
//  3. a de exemplo que vem junto com o site.
export async function carregarLoja(slug) {
  if (nuvemLigada) {
    try {
      const daNuvem = await lojaDaNuvem(slug);
      if (daNuvem) return { loja: normalizarLoja(daNuvem), fonte: 'nuvem' };
    } catch {
      // sem internet ou Supabase fora do ar: segue pro que tem no aparelho
    }
  }
  let local = null;
  try { local = await lojasLocais.obter(slug); } catch { /* sem IndexedDB: só os exemplos */ }
  if (local) return { loja: normalizarLoja(local), fonte: 'aparelho' };
  const exemplo = await buscarExemplo(slug);
  return exemplo ? { loja: exemplo, fonte: 'exemplo' } : null;
}

export function urlDaLoja(slug, extras = {}) {
  const url = new URL('loja/', RAIZ);
  url.searchParams.set('l', slug);
  for (const [chave, valor] of Object.entries(extras)) {
    if (valor != null && valor !== '') url.searchParams.set(chave, valor);
  }
  return url.href;
}

// Produtos em ordem de vitrine: por categoria (na ordem da loja), esgotados no fim
export function produtosPorCategoria(loja, lista = loja.produtos) {
  const grupos = new Map(loja.categorias.map((c) => [c, []]));
  for (const p of lista) {
    const cat = p.categoria || 'Outros';
    if (!grupos.has(cat)) grupos.set(cat, []);
    grupos.get(cat).push(p);
  }
  return [...grupos].filter(([, itens]) => itens.length)
    .map(([categoria, itens]) => [categoria, [...itens.filter((p) => p.disponivel), ...itens.filter((p) => !p.disponivel)]]);
}

// Foto do produto ou, sem foto, o emoji num quadrado da cor da loja
export function desenhoProduto(p, emojiPadrao = '🛍️', classe = '') {
  const conteudo = p.foto
    ? `<img src="${esc(p.foto)}" alt="" loading="lazy">`
    : `<span class="tile-emoji">${esc(p.emoji || emojiPadrao)}</span>`;
  return `<span class="tile ${classe}" aria-hidden="true">${conteudo}</span>`;
}

// ── Pedido ──
export function totais(loja, itens, modo) {
  const subtotal = itens.reduce((soma, { produto, qtd }) => soma + centavos(produto.preco) * qtd, 0);
  const taxaFixa = modo === 'entrega' && loja.taxaEntrega != null ? centavos(loja.taxaEntrega) : 0;
  return {
    quantidade: itens.reduce((soma, { qtd }) => soma + qtd, 0),
    subtotal: subtotal / 100,
    taxa: taxaFixa / 100,
    taxaACombinar: modo === 'entrega' && loja.taxaEntrega == null,
    total: (subtotal + taxaFixa) / 100,
    temSemPreco: itens.some(({ produto }) => produto.preco == null),
  };
}

// Respostas das perguntas extras, já no formato da mensagem
export function respostasProntas(loja, respostas, modo) {
  return loja.perguntas
    .map((chave) => ({ chave, p: PERGUNTAS[chave], valor: String(respostas[chave] ?? '').trim() }))
    .filter(({ p, valor }) => valor && (!p.quando || p.quando === modo))
    .map(({ chave, p, valor }) => ({
      chave,
      rotulo: p.naMensagem || p.rotulo.replace(/[?:]\s*$/, ''),
      valor: p.tipo === 'data' ? dataPorExtenso(valor) : p.tipo === 'sim_nao' ? 'sim' : valor,
      longo: p.tipo === 'texto_longo',
    }));
}

export function montarMensagem(loja, itens, dados) {
  const t = totais(loja, itens, dados.modo);
  const linhas = [`Olá, ${loja.nome}! Quero fazer este pedido pelo catálogo:`, ''];
  for (const { produto: p, qtd } of itens) {
    linhas.push(p.preco == null
      ? `• ${qtd}x ${p.nome} (preço a consultar)`
      : `• ${qtd}x ${p.nome} — ${dinheiro((centavos(p.preco) * qtd) / 100)}`);
  }
  linhas.push('');
  if (t.taxa > 0) linhas.push(`Produtos: ${dinheiro(t.subtotal)}`, `Entrega: ${dinheiro(t.taxa)}`);
  const resto = [t.taxaACombinar && 'entrega a combinar', t.temSemPreco && 'itens a consultar'].filter(Boolean);
  linhas.push(`*Total: ${dinheiro(t.total)}*${resto.length ? ` (+ ${resto.join(' e ')})` : ''}`, '');
  linhas.push(`*Nome:* ${dados.nome}`);
  linhas.push(dados.modo === 'entrega'
    ? `*Entregar em:* ${dados.endereco.replace(/\s*\n\s*/g, ', ')}`
    : '*Vou retirar na loja*');
  for (const r of respostasProntas(loja, dados.respostas, dados.modo)) {
    linhas.push(r.longo ? `*${r.rotulo}:*\n${r.valor}` : `*${r.rotulo}:* ${r.valor}`);
  }
  if (dados.pagamento) linhas.push(`*Pagamento:* ${dados.pagamento}`);
  if (dados.obs) linhas.push(`*Observação:* ${dados.obs}`);
  return linhas.join('\n');
}

// ── Avisos entre abas: o painel salvou → o catálogo aberto em outra aba se atualiza ──
const canal = 'BroadcastChannel' in self ? new BroadcastChannel('vitrine-zap') : null;
export const avisarMudanca = (mensagem) => canal?.postMessage(mensagem);
export const aoMudar = (funcao) => canal?.addEventListener('message', (e) => funcao(e.data));

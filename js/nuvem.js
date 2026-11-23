// Ponte com o Supabase: login do lojista e banco das lojas e dos pedidos.
// Só entra em ação quando js/config.js tem as chaves; sem elas, o app fica no
// modo demonstração (tudo no navegador).
//
// Tabelas e regras de acesso: supabase/schema.sql.

import { SUPABASE_CHAVE, SUPABASE_URL } from './config.js';

export const nuvemLigada = Boolean(SUPABASE_URL && SUPABASE_CHAVE);

// Biblioteca oficial do Supabase, carregada só quando precisa. O service worker
// guarda uma cópia, então o painel continua abrindo sem internet.
const BIBLIOTECA = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm';
let cliente = null;

export async function conectar() {
  if (!nuvemLigada) throw new Error('O Supabase não está configurado (js/config.js).');
  if (!cliente) {
    const { createClient } = await comPrazo(import(BIBLIOTECA), 10000);
    cliente = createClient(SUPABASE_URL, SUPABASE_CHAVE, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'vz-sessao' },
    });
  }
  return cliente;
}

function comPrazo(promessa, ms = 8000) {
  return Promise.race([
    promessa,
    new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('Sem resposta do servidor. Confira a internet.')), ms)),
  ]);
}

async function resultado(consulta) {
  const { data, error } = await comPrazo(consulta);
  if (error) throw traduzir(error);
  return data;
}

function traduzir(erro) {
  const texto = String(erro?.message || erro || '');
  const certo = [
    [/duplicate key/i, 'Esse endereço de loja já está em uso.'],
    [/invalid login credentials/i, 'E-mail ou senha errados.'],
    [/email not confirmed/i, 'Essa conta ainda não foi confirmada. Fale com a Neves Tecnologia.'],
    [/unable to validate email|invalid email|email address .* is invalid/i, 'Confira o e-mail digitado.'],
    [/signups? not allowed|signup.*disabled/i, 'O cadastro pelo site é fechado: fale com a Neves Tecnologia.'],
    [/rate limit|too many requests/i, 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'],
    [/row-level security|violates row-level/i, 'Sem permissão pra mexer nessa loja.'],
    [/failed to fetch|network|load failed|sem resposta/i, 'Sem conexão com o servidor. Confira a internet.'],
  ].find(([padrao]) => padrao.test(texto));
  return new Error(certo ? certo[1] : texto || 'Não deu certo. Tente de novo.');
}

// ── Login do lojista ──
export async function sessaoAtual() {
  const sb = await conectar();
  const { data } = await comPrazo(sb.auth.getSession());
  return data?.session ?? null;
}

// Não tem cadastro pelo site: a conta de cada cliente é criada pela Neves Tecnologia
// no painel do Supabase (Authentication → Users → Add user).
export async function entrar(email, senha) {
  const sb = await conectar();
  return (await resultado(sb.auth.signInWithPassword({ email, password: senha }))).session;
}

export async function sair() {
  const sb = await conectar();
  await comPrazo(sb.auth.signOut()).catch(() => {});
}

// ── Lojas ──
export async function lojaDaNuvem(slug) {
  const sb = await conectar();
  const linha = await resultado(sb.from('lojas').select('dados').eq('slug', slug).maybeSingle());
  return linha ? { ...linha.dados, slug } : null;
}

export async function lojasDoDono(usuarioId) {
  const sb = await conectar();
  const buscar = (colunas) => resultado(sb.from('lojas').select(colunas).eq('dono', usuarioId).order('criada_em'));
  let linhas;
  try {
    linhas = await buscar('slug, dados, ativa');
  } catch (erro) {
    if (!/ativa/.test(erro.message)) throw erro;
    linhas = await buscar('slug, dados'); // banco com o schema.sql antigo, ainda sem a coluna "ativa"
  }
  return linhas.map((linha) => ({ ...linha.dados, slug: linha.slug, ativa: linha.ativa !== false }));
}

export async function slugEstaLivre(slug) {
  const sb = await conectar();
  return !(await resultado(sb.from('lojas').select('slug').eq('slug', slug).maybeSingle()));
}

export async function salvarLojaNaNuvem(loja) {
  const sb = await conectar();
  // marcações que só valem no aparelho, e "ativa", que só a Neves Tecnologia muda (coluna própria)
  const { pendente, nuvem, ativa, ...dados } = loja;
  await resultado(sb.from('lojas').upsert({ slug: loja.slug, dados }, { onConflict: 'slug' }));
}

export async function excluirLojaDaNuvem(slug) {
  const sb = await conectar();
  await resultado(sb.from('lojas').delete().eq('slug', slug));
}

// ── Pedidos ──
const linhaParaPedido = (linha) => ({
  ...linha.dados,
  id: linha.id,
  loja: linha.loja,
  status: linha.status,
  criadoEm: Date.parse(linha.criado_em) || Date.now(),
});

// Qualquer cliente pode enviar (sem login); só o dono da loja consegue ler depois
export async function enviarPedidoPraNuvem(slug, pedido) {
  const sb = await conectar();
  await resultado(sb.from('pedidos').insert({ loja: slug, dados: pedido }));
}

export async function pedidosDaNuvem(slug) {
  const sb = await conectar();
  const linhas = await resultado(sb.from('pedidos').select('id, loja, status, criado_em, dados')
    .eq('loja', slug).order('criado_em', { ascending: false }).limit(300));
  return linhas.map(linhaParaPedido);
}

export async function mudarSituacaoNaNuvem(id, status) {
  const sb = await conectar();
  await resultado(sb.from('pedidos').update({ status }).eq('id', id));
}

export async function excluirPedidoDaNuvem(id) {
  const sb = await conectar();
  await resultado(sb.from('pedidos').delete().eq('id', id));
}

// Avisa na hora quando chega pedido novo na loja (Supabase Realtime). Devolve a função que para de ouvir.
export async function ouvirPedidos(slug, aoChegar) {
  const sb = await conectar();
  const canal = sb.channel(`pedidos-${slug}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos', filter: `loja=eq.${slug}` },
      (mensagem) => aoChegar(linhaParaPedido(mensagem.new)))
    .subscribe();
  return () => sb.removeChannel(canal);
}

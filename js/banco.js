// Banco de dados do aparelho (IndexedDB): as lojas criadas no painel e os pedidos
// enviados por este navegador. É o que deixa o painel funcionar sem internet.
//
// Na versão com servidor, estas mesmas funções passariam a falar com a API
// (ver docs/ATIVIDADE.md, "Próximos passos"); as páginas não precisam mudar.

const NOME_DO_BANCO = 'vitrine-zap';
const VERSAO_DO_BANCO = 1;

let banco = null;

function abrirBanco() {
  if (!banco) {
    banco = new Promise((resolver, rejeitar) => {
      if (!('indexedDB' in self)) {
        rejeitar(new Error('Este navegador não tem IndexedDB'));
        return;
      }
      const pedido = indexedDB.open(NOME_DO_BANCO, VERSAO_DO_BANCO);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains('lojas')) db.createObjectStore('lojas', { keyPath: 'slug' });
        if (!db.objectStoreNames.contains('pedidos')) {
          const pedidos = db.createObjectStore('pedidos', { keyPath: 'id' });
          pedidos.createIndex('loja', 'loja');
        }
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
      pedido.onblocked = () => rejeitar(new Error('Banco bloqueado por outra aba'));
    });
    banco.catch(() => { banco = null; });
  }
  return banco;
}

async function operar(tabela, modo, acao) {
  const db = await abrirBanco();
  return new Promise((resolver, rejeitar) => {
    const transacao = db.transaction(tabela, modo);
    const pedido = acao(transacao.objectStore(tabela));
    transacao.oncomplete = () => resolver(pedido ? pedido.result : undefined);
    transacao.onerror = () => rejeitar(transacao.error);
    transacao.onabort = () => rejeitar(transacao.error);
  });
}

export const lojasLocais = {
  listar: () => operar('lojas', 'readonly', (t) => t.getAll()),
  obter: (slug) => operar('lojas', 'readonly', (t) => t.get(slug)),
  salvar: (loja) => operar('lojas', 'readwrite', (t) => t.put(loja)),
  excluir: (slug) => operar('lojas', 'readwrite', (t) => t.delete(slug)),
};

export const pedidosLocais = {
  listar: (slug) => operar('pedidos', 'readonly', (t) => t.index('loja').getAll(slug)),
  salvar: (pedido) => operar('pedidos', 'readwrite', (t) => t.put(pedido)),
  excluir: (id) => operar('pedidos', 'readwrite', (t) => t.delete(id)),
  excluirDaLoja: async (slug) => {
    const todos = await pedidosLocais.listar(slug);
    await Promise.all(todos.map((p) => pedidosLocais.excluir(p.id)));
  },
};

// Pede pro navegador não apagar os dados quando faltar espaço (Storage API)
export async function pedirArmazenamentoPersistente() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* navegador sem suporte: segue normal */ }
}

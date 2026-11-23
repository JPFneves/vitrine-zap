// Funções pequenas que todas as páginas usam (formatação, avisos, janelas, compartilhar).

export const $ = (seletor, dentro = document) => dentro.querySelector(seletor);
export const $$ = (seletor, dentro = document) => [...dentro.querySelectorAll(seletor)];

export const esc = (texto) => String(texto ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const dinheiro = (valor) => brl.format(valor || 0);
export const centavos = (valor) => Math.round(Number(valor || 0) * 100);
export const precoTexto = (preco) => (preco == null ? 'Preço sob consulta' : dinheiro(preco));

export const semAcento = (texto) => String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const slugify = (texto) => semAcento(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');

// "1.234,50", "1234.5" ou "R$ 12" → número; vazio ou inválido → null
export function lerPreco(texto) {
  const t = String(texto ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
export const precoParaCampo = (valor) => (valor == null ? '' : Number(valor).toFixed(2).replace('.', ','));

// WhatsApp guardado só com números e com o 55 do Brasil: (35) 99999-1234 → 5535999991234
export function normalizarWhatsApp(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

// 5535999991234 → (35) 99999-1234
export function telefoneBonito(numero) {
  const d = String(numero ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(numero ?? '');
}

// Sem número (lojas de exemplo), o WhatsApp abre pra pessoa escolher o contato:
// dá pra mandar o pedido de teste pra si mesma e ver como ele chega.
export function linkWhatsApp(numero, texto) {
  const base = numero ? `https://wa.me/${numero}` : 'https://wa.me/';
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

export function debounce(fn, espera = 400) {
  let timer;
  const chamada = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), espera);
  };
  chamada.agora = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return chamada;
}

// Data local no formato do <input type="date">: 2026-11-21
export function dataISO(data = new Date()) {
  return new Date(data.getTime() - data.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// 2026-11-21 → "sábado, 21/11" (ou "hoje (17/11)", "amanhã (18/11)")
export function dataPorExtenso(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  if (!a || !m || !d) return String(iso);
  const data = new Date(a, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias = Math.round((data - hoje) / 864e5);
  const curta = `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  if (dias === 0) return `hoje (${curta})`;
  if (dias === 1) return `amanhã (${curta})`;
  return `${data.toLocaleDateString('pt-BR', { weekday: 'long' })}, ${curta}`;
}

export function dataHoraCurta(ms) {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Cores ──
export function rgb(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
}

function luminancia(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Texto branco ou quase preto em cima da cor da loja, o que der mais contraste
export const corDoTexto = (fundo) => (contraste(fundo, '#ffffff') >= contraste(fundo, '#111111') ? '#ffffff' : '#111111');

// Aplica a cor da loja nas variáveis do CSS (botões, cabeçalho) e na barra do navegador
export function aplicarCor(cor, elemento = document.documentElement) {
  elemento.style.setProperty('--marca', cor);
  elemento.style.setProperty('--marca-texto', corDoTexto(cor));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = cor;
}

// ── Avisos rápidos (toast) ──
let caixaDeAvisos;
// chave: um aviso novo com a mesma chave substitui o anterior (ex.: vários "na sacola" seguidos)
export function toast(texto, { tipo = 'ok', acao = '', aoClicar = null, tempo = 3200, chave = '' } = {}) {
  if (!caixaDeAvisos) {
    caixaDeAvisos = document.createElement('div');
    caixaDeAvisos.className = 'toasts';
    caixaDeAvisos.setAttribute('role', 'status');
    caixaDeAvisos.setAttribute('aria-live', 'polite');
    document.body.append(caixaDeAvisos);
  }
  if (chave) caixaDeAvisos.querySelector(`[data-chave="${chave}"]`)?.remove();
  const aviso = document.createElement('div');
  if (chave) aviso.dataset.chave = chave;
  aviso.className = `toast toast-${tipo}`;
  aviso.innerHTML = `<span>${esc(texto)}</span>`;
  const fechar = () => {
    aviso.classList.remove('visivel');
    setTimeout(() => aviso.remove(), 250);
  };
  if (acao) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.textContent = acao;
    botao.addEventListener('click', () => {
      aoClicar?.();
      fechar();
    });
    aviso.append(botao);
  }
  caixaDeAvisos.append(aviso);
  requestAnimationFrame(() => aviso.classList.add('visivel'));
  if (tempo) setTimeout(fechar, tempo);
  return fechar;
}

export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* navegador sem suporte */ }
    area.remove();
    return ok;
  }
}

// Menu de compartilhar do celular (Web Share API); no computador, copia o link
export async function compartilhar({ titulo, texto, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title: titulo, text: texto, url });
      return 'compartilhado';
    } catch (erro) {
      if (erro.name === 'AbortError') return 'cancelado';
    }
  }
  if (await copiar(url)) {
    toast('Link copiado. É só colar no WhatsApp ou no Instagram.');
    return 'copiado';
  }
  return 'falhou';
}

// ── Janelas (<dialog>) ──
// Fecham ao tocar fora, no botão [data-fechar] e com Esc (esse o navegador já faz).
export function prepararJanelas(raiz = document) {
  $$('dialog', raiz).forEach((janela) => {
    if (janela.dataset.pronta) return;
    janela.dataset.pronta = '1';
    janela.addEventListener('click', (e) => {
      if (e.target === janela) janela.close();
    });
    janela.addEventListener('click', (e) => {
      if (e.target.closest('[data-fechar]')) janela.close();
    });
  });
}

export function abrirJanela(janela) {
  if (!janela.open) janela.showModal();
  janela.querySelector('.janela-corpo')?.scrollTo(0, 0);
}

export function confirmar(pergunta, { sim = 'Sim', nao = 'Cancelar', perigo = false } = {}) {
  return new Promise((resolver) => {
    const janela = document.createElement('dialog');
    janela.className = 'janela janela-pequena';
    janela.innerHTML = `
      <div class="janela-corpo">
        <p class="confirmar-texto">${esc(pergunta)}</p>
        <div class="linha-botoes">
          <button type="button" class="botao botao-fantasma" value="nao">${esc(nao)}</button>
          <button type="button" class="botao ${perigo ? 'botao-perigo' : 'botao-primario'}" value="sim">${esc(sim)}</button>
        </div>
      </div>`;
    document.body.append(janela);
    let resposta = false;
    janela.addEventListener('click', (e) => {
      const botao = e.target.closest('button');
      if (botao) {
        resposta = botao.value === 'sim';
        janela.close();
      } else if (e.target === janela) {
        janela.close();
      }
    });
    janela.addEventListener('close', () => {
      janela.remove();
      resolver(resposta);
    });
    janela.showModal();
  });
}

// Baixa um arquivo gerado na hora (JSON, PNG...)
export function baixar(nome, conteudo, tipo = 'application/octet-stream') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const idCurto = () => Math.random().toString(36).slice(2, 8);

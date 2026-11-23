// A parte "PWA" que toda página usa: registra o service worker, cuida do botão
// "Instalar app", avisa quando sai versão nova e quando a internet cai.

import { $$, toast } from './util.js';

const RAIZ = new URL('../', import.meta.url);
let pedidoDeInstalacao = null; // evento beforeinstallprompt guardado pra usar no clique
let pediuAtualizacao = false;

export const emModoApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function iniciarPWA() {
  if ('serviceWorker' in navigator) {
    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar, { once: true });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // o botão do próprio site aparece no lugar da barrinha do navegador
    pedidoDeInstalacao = e;
    atualizarBotoes();
  });
  window.addEventListener('appinstalled', () => {
    pedidoDeInstalacao = null;
    atualizarBotoes();
    toast('Pronto! O Vitrine Zap está na tela inicial do aparelho.');
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-instalar]')) instalar();
  });
  atualizarBotoes();

  // O Netlify, no plano grátis, põe um selo fixo no canto de baixo da página (faz parte do plano,
  // então ele fica). Com o selo, o menu do painel e a barra da sacola sobem pra não ficarem atrás dele.
  const marcarSelo = () => document.body.classList.toggle('com-selo', !!document.getElementById('nl-badge-frame'));
  marcarSelo();
  new MutationObserver(marcarSelo).observe(document.body, { childList: true });

  const faixa = document.createElement('div');
  faixa.className = 'faixa-offline';
  faixa.setAttribute('role', 'status');
  faixa.textContent = 'Sem internet: mostrando a cópia guardada no aparelho.';
  faixa.hidden = navigator.onLine;
  document.body.prepend(faixa);
  window.addEventListener('offline', () => { faixa.hidden = false; });
  window.addEventListener('online', () => {
    faixa.hidden = true;
    toast('Internet de volta.');
  });
}

async function registrar() {
  let registro;
  try {
    registro = await navigator.serviceWorker.register(new URL('sw.js', RAIZ), { scope: RAIZ.pathname });
  } catch (erro) {
    console.warn('Service worker não registrou:', erro);
    return;
  }
  // Versão nova do site: o service worker novo fica esperando até a pessoa tocar em "Atualizar"
  const avisar = (trabalhador) => {
    toast('Saiu uma versão nova do app.', {
      acao: 'Atualizar',
      tempo: 0,
      aoClicar: () => {
        pediuAtualizacao = true;
        trabalhador.postMessage({ tipo: 'PULAR_ESPERA' });
      },
    });
  };
  if (registro.waiting && navigator.serviceWorker.controller) avisar(registro.waiting);
  registro.addEventListener('updatefound', () => {
    const novo = registro.installing;
    novo?.addEventListener('statechange', () => {
      if (novo.state === 'installed' && navigator.serviceWorker.controller) avisar(novo);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (pediuAtualizacao) location.reload();
  });
  // Confere se tem versão nova quando a pessoa volta pro app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registro.update().catch(() => {});
  });
}

export const podeInstalar = () => !emModoApp() && (!!pedidoDeInstalacao || ehIOS());

function atualizarBotoes() {
  $$('[data-instalar]').forEach((botao) => { botao.hidden = !podeInstalar(); });
}

export async function instalar() {
  if (pedidoDeInstalacao) {
    pedidoDeInstalacao.prompt();
    await pedidoDeInstalacao.userChoice.catch(() => {});
    pedidoDeInstalacao = null;
    atualizarBotoes();
    return;
  }
  mostrarAjuda(ehIOS()
    ? ['Toque no botão <strong>Compartilhar</strong> do Safari (o quadrado com a setinha pra cima).',
      'Role e toque em <strong>Adicionar à Tela de Início</strong>.',
      'Toque em <strong>Adicionar</strong>. O ícone do Vitrine Zap aparece junto dos outros apps.']
    : ['Abra o menu do navegador (os três pontinhos).',
      'Toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.']);
}

function mostrarAjuda(passos) {
  const janela = document.createElement('dialog');
  janela.className = 'janela janela-pequena';
  janela.innerHTML = `
    <div class="janela-corpo">
      <h2 class="janela-titulo">Instalar o Vitrine Zap</h2>
      <ol class="passos-instalar">${passos.map((p) => `<li>${p}</li>`).join('')}</ol>
      <button type="button" class="botao botao-primario botao-bloco" data-fechar>Entendi</button>
    </div>`;
  document.body.append(janela);
  janela.addEventListener('click', (e) => {
    if (e.target === janela || e.target.closest('[data-fechar]')) janela.close();
  });
  janela.addEventListener('close', () => janela.remove());
  janela.showModal();
}

// Página inicial (landing page) do Vitrine Zap.

import { REPOSITORIO } from './config.js';
import { EXEMPLOS, buscarExemplo, linkDeContato, montarMensagem, urlDaLoja } from './dados.js';
import { iniciarPWA } from './pwa.js';
import { qrSVG } from './qrcode.js';
import { $, $$, esc } from './util.js';

iniciarPWA();

// "Quero minha loja": abre o WhatsApp da Neves Tecnologia com a mensagem pronta (js/config.js)
$$('[data-contato]').forEach((link) => { link.href = linkDeContato(link.dataset.contato || undefined); });

// Cabeçalho ganha uma linha embaixo quando a página rola
const topo = $('#topo');
const marcarRolagem = () => topo.classList.toggle('rolou', window.scrollY > 8);
window.addEventListener('scroll', marcarRolagem, { passive: true });
marcarRolagem();

// Celular de demonstração: troca a loja que aparece dentro dele
const moldura = $('#demo-celular');
$$('[data-demo]').forEach((aba) => {
  aba.addEventListener('click', () => {
    $$('[data-demo]').forEach((outra) => outra.setAttribute('aria-selected', String(outra === aba)));
    moldura.src = aba.dataset.demo;
  });
});

// QR codes de verdade, gerados aqui mesmo (js/qrcode.js)
const mesa7 = urlDaLoja('restaurante-tempero-da-serra', { mesa: 7 });
$('#qr-plaquinha').innerHTML = qrSVG(mesa7, { rotulo: 'QR code da mesa 7' });
$('#qr-celular').innerHTML = qrSVG(mesa7, { rotulo: 'QR code da mesa 7' });

// Cartões das lojas de exemplo
$('#lista-exemplos').innerHTML = EXEMPLOS.map((ex) => `
  <a class="exemplo" style="--cor-exemplo:${ex.cor}" href="${esc(urlDaLoja(ex.slug, ex.mesa ? { mesa: ex.mesa } : {}))}">
    <div class="exemplo-capa"><span aria-hidden="true">${ex.emoji}</span></div>
    <div class="exemplo-corpo">
      <strong>${esc(ex.nome)}</strong>
      <p>${esc(ex.chamada)}</p>
      <span class="abrir">${ex.mesa ? `Abrir a mesa ${ex.mesa} →` : 'Abrir catálogo →'}</span>
    </div>
  </a>`).join('');

// A mensagem do balão é montada pela mesma função que o catálogo usa de verdade
buscarExemplo('emporio-da-serra').then((loja) => {
  if (!loja) return;
  const porId = new Map(loja.produtos.map((p) => [p.id, p]));
  const itens = [['canastra-meia-cura', 1], ['doce-de-leite-pastoso', 2]]
    .filter(([id]) => porId.has(id)).map(([id, qtd]) => ({ produto: porId.get(id), qtd }));
  if (!itens.length) return;
  const mensagem = montarMensagem(loja, itens, {
    nome: 'Maria', modo: 'entrega', endereco: 'Rua das Flores, 120 · Centro', respostas: {}, pagamento: 'Pix', obs: '',
  });
  // *negrito* do WhatsApp vira negrito de verdade no balão
  $('#balao-pedido').innerHTML = esc(mensagem).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
});

$('#ano').textContent = new Date().getFullYear();

// Link do código, se configurado em js/config.js
if (REPOSITORIO) {
  $('#link-repositorio a').href = REPOSITORIO;
  $('#link-repositorio').hidden = false;
}

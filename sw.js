// Service worker do Vitrine Zap.
//
// Estratégia: "rede primeiro, cópia guardada se não der". Com internet, o
// cliente sempre vê o preço atualizado; com sinal fraco ou sem sinal, o
// catálogo e o painel abrem com a última cópia guardada no aparelho.
//
// Mudou algum arquivo do site? Troque a VERSAO: o app avisa "Saiu uma versão
// nova" e, no toque em Atualizar, passa a usar os arquivos novos.

const VERSAO = '2026-11-21.4';
const CACHE = `vitrine-zap-${VERSAO}`;
const CACHE_BIBLIOTECAS = 'vz-bibliotecas'; // biblioteca do Supabase (versão fixa, não muda)
const CACHE_NUVEM = 'vz-nuvem'; // catálogos lidos do Supabase, pra abrirem sem internet
const ESPERA_DA_REDE = 3500; // milissegundos: depois disso, usa a cópia guardada

// Tudo que o app precisa pra abrir sem internet desde a primeira visita
const ARQUIVOS = [
  './',
  'offline.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/config.js',
  'js/nuvem.js',
  'js/util.js',
  'js/banco.js',
  'js/dados.js',
  'js/icones.js',
  'js/qrcode.js',
  'js/pwa.js',
  'js/landing.js',
  'js/loja.js',
  'js/painel.js',
  'loja/',
  'painel/',
  'dados/lojas/emporio-da-serra.json',
  'dados/lojas/floricultura-bela-flor.json',
  'dados/lojas/restaurante-tempero-da-serra.json',
  'dados/lojas/doce-encanto-confeitaria.json',
  'icons/icone.svg',
  'icons/icone-192.png',
  'icons/icone-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  // Não chama skipWaiting aqui: a versão nova espera a pessoa tocar em "Atualizar"
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith('vitrine-zap-') && nome !== CACHE) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'PULAR_ESPERA') self.skipWaiting();
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin === self.location.origin) {
    evento.respondWith(redePrimeiro(evento, CACHE));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    evento.respondWith(guardadaPrimeiro(pedido));
  } else if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/lojas')) {
    evento.respondWith(redePrimeiro(evento, CACHE_NUVEM)); // o catálogo é público; pedidos e login não são guardados
  }
  // o resto (wa.me, login, pedidos) vai direto pela rede
});

// Biblioteca com versão fixa no endereço: se já tem guardada, usa; senão baixa e guarda
async function guardadaPrimeiro(pedido) {
  const cache = await caches.open(CACHE_BIBLIOTECAS);
  const guardada = await cache.match(pedido);
  if (guardada) return guardada;
  const resposta = await fetch(pedido);
  if (resposta.ok) await cache.put(pedido, resposta.clone()).catch(() => {});
  return resposta;
}

async function redePrimeiro(evento, nomeDoCache) {
  const pedido = evento.request;
  const pagina = pedido.mode === 'navigate';
  // Páginas são guardadas sem o "?l=loja&mesa=3": o HTML é o mesmo pra todas as lojas
  const chave = pagina ? semBusca(pedido.url) : pedido;
  const cache = await caches.open(nomeDoCache);

  // "no-cache": sempre confere com o servidor (resposta 304 é rápida), pra não pegar JS velho do
  // cache do navegador. Página não pode ser recriada assim, então vai como veio.
  const daRede = fetch(pagina ? pedido : new Request(pedido, { cache: 'no-cache' })).then(async (resposta) => {
    if (resposta.ok && (resposta.type === 'basic' || resposta.type === 'cors')) {
      await cache.put(chave, resposta.clone()).catch(() => {});
    }
    return resposta;
  });

  try {
    return await comPrazo(daRede, ESPERA_DA_REDE);
  } catch {
    const guardada = await cache.match(chave, { ignoreSearch: pagina, ignoreVary: true });
    if (guardada) {
      evento.waitUntil(daRede.catch(() => {})); // se a rede responder depois, atualiza a cópia
      return guardada;
    }
    try {
      return await daRede; // não tem cópia: espera a rede, mesmo lenta
    } catch {
      if (pagina) return (await cache.match('offline.html')) || Response.error();
      return Response.error();
    }
  }
}

function comPrazo(promessa, ms) {
  return new Promise((resolver, rejeitar) => {
    const relogio = setTimeout(() => rejeitar(new Error('A rede demorou')), ms);
    promessa.then(
      (resposta) => { clearTimeout(relogio); resolver(resposta); },
      (erro) => { clearTimeout(relogio); rejeitar(erro); },
    );
  });
}

function semBusca(endereco) {
  const url = new URL(endereco);
  url.search = '';
  url.hash = '';
  return url.href;
}

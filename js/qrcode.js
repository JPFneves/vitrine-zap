// Gerador de QR Code feito do zero pra este projeto, sem biblioteca: o app
// continua gerando as plaquinhas das mesas mesmo sem internet.
//
// Segue a norma ISO/IEC 18004 (QR Code modelo 2): modo byte com texto em UTF-8,
// versões 1 a 40, correção de erros Reed-Solomon e escolha da melhor máscara.
// Referência didática: https://www.thonky.com/qr-code-tutorial/

const NIVEL = { L: 0, M: 1, Q: 2, H: 3 };
const BITS_DO_NIVEL = [1, 0, 3, 2]; // como cada nível aparece na faixa de formato

// Tabelas da norma, por nível (L, M, Q, H) e versão (índice 0 não é usado)
const ECC_POR_BLOCO = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCOS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// ── Aritmética no corpo finito GF(256), polinômio x⁸ + x⁴ + x³ + x² + 1 ──
function multiplicar(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisorReedSolomon(grau) {
  const resultado = new Array(grau).fill(0);
  resultado[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < grau; j++) {
      resultado[j] = multiplicar(resultado[j], raiz);
      if (j + 1 < grau) resultado[j] ^= resultado[j + 1];
    }
    raiz = multiplicar(raiz, 0x02);
  }
  return resultado;
}

function restoReedSolomon(dados, divisor) {
  const resto = divisor.map(() => 0);
  for (const byte of dados) {
    const fator = byte ^ resto.shift();
    resto.push(0);
    divisor.forEach((coef, i) => { resto[i] ^= multiplicar(coef, fator); });
  }
  return resto;
}

// ── Tamanhos ──
function modulosDeDados(versao) {
  let total = (16 * versao + 128) * versao + 64;
  if (versao >= 2) {
    const n = Math.floor(versao / 7) + 2;
    total -= (25 * n - 10) * n - 55;
    if (versao >= 7) total -= 36;
  }
  return total;
}

const bytesDeDados = (versao, nivel) =>
  Math.floor(modulosDeDados(versao) / 8) - ECC_POR_BLOCO[nivel][versao] * NUM_BLOCOS[nivel][versao];

function posicoesDeAlinhamento(versao) {
  if (versao === 1) return [];
  const n = Math.floor(versao / 7) + 2;
  const passo = Math.floor((versao * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const posicoes = [6];
  for (let p = versao * 4 + 10; posicoes.length < n; p -= passo) posicoes.splice(1, 0, p);
  return posicoes;
}

// ── Gerador ──
// Devolve { tamanho, modulos } onde modulos[y][x] = true é quadradinho escuro.
// opcoes.mascara (0 a 7) força uma máscara: só serve pra testes.
export function gerarQR(texto, { nivel: letra = 'M', mascara = null } = {}) {
  const nivel = NIVEL[letra] ?? NIVEL.M;
  const bytes = [...new TextEncoder().encode(String(texto))];

  let versao = 1;
  for (; versao <= 40; versao++) {
    const bitsDaContagem = versao <= 9 ? 8 : 16;
    if (4 + bitsDaContagem + bytes.length * 8 <= bytesDeDados(versao, nivel) * 8) break;
  }
  if (versao > 40) throw new Error('Texto longo demais para caber num QR code');

  // 1. Bits: modo byte (0100), quantidade de bytes, os bytes, terminador e enchimento
  const capacidade = bytesDeDados(versao, nivel) * 8;
  const bits = [];
  const escrever = (valor, quantos) => {
    for (let i = quantos - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  escrever(0b0100, 4);
  escrever(bytes.length, versao <= 9 ? 8 : 16);
  bytes.forEach((b) => escrever(b, 8));
  escrever(0, Math.min(4, capacidade - bits.length));
  escrever(0, (8 - (bits.length % 8)) % 8);
  for (let enchimento = 0xec; bits.length < capacidade; enchimento ^= 0xec ^ 0x11) escrever(enchimento, 8);
  const dados = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));

  // 2. Divide em blocos, calcula a correção de erros de cada um e intercala
  const numBlocos = NUM_BLOCOS[nivel][versao];
  const eccPorBloco = ECC_POR_BLOCO[nivel][versao];
  const totalDeBytes = Math.floor(modulosDeDados(versao) / 8);
  const blocosCurtos = numBlocos - (totalDeBytes % numBlocos);
  const tamanhoCurto = Math.floor(totalDeBytes / numBlocos);
  const divisor = divisorReedSolomon(eccPorBloco);
  const blocos = [];
  for (let i = 0, k = 0; i < numBlocos; i++) {
    const bloco = dados.slice(k, k + tamanhoCurto - eccPorBloco + (i < blocosCurtos ? 0 : 1));
    k += bloco.length;
    const ecc = restoReedSolomon(bloco, divisor);
    if (i < blocosCurtos) bloco.push(0);
    blocos.push(bloco.concat(ecc));
  }
  const final = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((bloco, j) => {
      if (i !== tamanhoCurto - eccPorBloco || j >= blocosCurtos) final.push(bloco[i]);
    });
  }

  // 3. Desenha os padrões fixos (localizadores, alinhamento, sincronia)
  const tamanho = versao * 4 + 17;
  const modulos = Array.from({ length: tamanho }, () => new Array(tamanho).fill(false));
  const fixo = Array.from({ length: tamanho }, () => new Array(tamanho).fill(false));
  const pintar = (x, y, escuro) => {
    modulos[y][x] = escuro;
    fixo[y][x] = true;
  };

  for (let i = 0; i < tamanho; i++) {
    pintar(6, i, i % 2 === 0);
    pintar(i, 6, i % 2 === 0);
  }
  const localizador = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= tamanho || y >= tamanho) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        pintar(x, y, d !== 2 && d !== 4);
      }
    }
  };
  localizador(3, 3);
  localizador(tamanho - 4, 3);
  localizador(3, tamanho - 4);

  const alinhamento = posicoesDeAlinhamento(versao);
  const na = alinhamento.length;
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          pintar(alinhamento[i] + dx, alinhamento[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  const desenharFormato = (m) => {
    const dadosDoFormato = (BITS_DO_NIVEL[nivel] << 3) | m;
    let resto = dadosDoFormato;
    for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
    const formato = ((dadosDoFormato << 10) | resto) ^ 0x5412;
    const bit = (i) => ((formato >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) pintar(8, i, bit(i));
    pintar(8, 7, bit(6));
    pintar(8, 8, bit(7));
    pintar(7, 8, bit(8));
    for (let i = 9; i < 15; i++) pintar(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) pintar(tamanho - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) pintar(8, tamanho - 15 + i, bit(i));
    pintar(8, tamanho - 8, true);
  };
  desenharFormato(0); // reserva o lugar; o formato certo entra depois da máscara

  if (versao >= 7) {
    let resto = versao;
    for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
    const info = (versao << 12) | resto;
    for (let i = 0; i < 18; i++) {
      const escuro = ((info >>> i) & 1) === 1;
      const a = tamanho - 11 + (i % 3);
      const b = Math.floor(i / 3);
      pintar(a, b, escuro);
      pintar(b, a, escuro);
    }
  }

  // 4. Coloca os dados em zigue-zague, de baixo pra cima, em colunas de 2
  let i = 0;
  for (let direita = tamanho - 1; direita >= 1; direita -= 2) {
    if (direita === 6) direita = 5;
    for (let v = 0; v < tamanho; v++) {
      for (let j = 0; j < 2; j++) {
        const x = direita - j;
        const subindo = ((direita + 1) & 2) === 0;
        const y = subindo ? tamanho - 1 - v : v;
        if (!fixo[y][x] && i < final.length * 8) {
          modulos[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }

  // 5. Testa as 8 máscaras e fica com a que deixa o código mais fácil de ler
  const aplicarMascara = (m) => {
    for (let y = 0; y < tamanho; y++) {
      for (let x = 0; x < tamanho; x++) {
        if (!fixo[y][x] && MASCARAS[m](x, y)) modulos[y][x] = !modulos[y][x];
      }
    }
  };
  let melhor = mascara;
  if (melhor == null) {
    let menorPenalidade = Infinity;
    for (let m = 0; m < 8; m++) {
      aplicarMascara(m);
      desenharFormato(m);
      const p = penalidade(modulos, tamanho);
      if (p < menorPenalidade) {
        menorPenalidade = p;
        melhor = m;
      }
      aplicarMascara(m); // desfaz (XOR de novo)
    }
  }
  aplicarMascara(melhor);
  desenharFormato(melhor);

  return { versao, tamanho, mascara: melhor, modulos };
}

// Penalidades da norma: sequências longas, blocos 2×2, padrões parecidos com o
// localizador e desequilíbrio entre escuro e claro
function penalidade(m, n) {
  let total = 0;
  for (let a = 0; a < n; a++) {
    let corLinha = null;
    let seqLinha = 0;
    let corColuna = null;
    let seqColuna = 0;
    for (let b = 0; b < n; b++) {
      if (m[a][b] === corLinha) {
        seqLinha++;
        if (seqLinha === 5) total += 3;
        else if (seqLinha > 5) total++;
      } else {
        corLinha = m[a][b];
        seqLinha = 1;
      }
      if (m[b][a] === corColuna) {
        seqColuna++;
        if (seqColuna === 5) total += 3;
        else if (seqColuna > 5) total++;
      } else {
        corColuna = m[b][a];
        seqColuna = 1;
      }
    }
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) total += 3;
    }
  }
  const padraoA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const padraoB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b <= n - 11; b++) {
      let la = true; let lb = true; let ca = true; let cb = true;
      for (let k = 0; k < 11; k++) {
        const linha = m[a][b + k] ? 1 : 0;
        const coluna = m[b + k][a] ? 1 : 0;
        if (linha !== padraoA[k]) la = false;
        if (linha !== padraoB[k]) lb = false;
        if (coluna !== padraoA[k]) ca = false;
        if (coluna !== padraoB[k]) cb = false;
      }
      total += 40 * (la + lb + ca + cb);
    }
  }
  let escuros = 0;
  for (const linha of m) for (const c of linha) if (c) escuros++;
  const k = Math.ceil(Math.abs(escuros * 20 - n * n * 10) / (n * n)) - 1;
  return total + Math.max(0, k) * 10;
}

// ── Desenho ──
// SVG em vetor (fica nítido impresso em qualquer tamanho), com a margem branca
// de 4 quadradinhos que os leitores de QR esperam.
export function qrSVG(texto, { nivel = 'M', margem = 4, cor = '#111111', fundo = '#ffffff', rotulo = 'QR code' } = {}) {
  const { tamanho, modulos } = gerarQR(texto, { nivel });
  const lado = tamanho + margem * 2;
  let caminho = '';
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      if (!modulos[y][x]) continue;
      let fim = x;
      while (fim + 1 < tamanho && modulos[y][fim + 1]) fim++;
      caminho += `M${x + margem} ${y + margem}h${fim - x + 1}v1h-${fim - x + 1}z`;
      x = fim;
    }
  }
  const titulo = String(rotulo).replace(/[<&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" shape-rendering="crispEdges" role="img" aria-label="${titulo}"><rect width="${lado}" height="${lado}" fill="${fundo}"/><path d="${caminho}" fill="${cor}"/></svg>`;
}

// Canvas (pra baixar como PNG ou compartilhar a imagem)
export function qrCanvas(texto, { nivel = 'M', margem = 4, px = 600, cor = '#111111', fundo = '#ffffff' } = {}) {
  const { tamanho, modulos } = gerarQR(texto, { nivel });
  const lado = tamanho + margem * 2;
  const escala = Math.max(1, Math.floor(px / lado));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = lado * escala;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = cor;
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      if (modulos[y][x]) ctx.fillRect((x + margem) * escala, (y + margem) * escala, escala, escala);
    }
  }
  return canvas;
}

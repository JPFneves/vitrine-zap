// Teste do gerador de QR Code (js/qrcode.js).
//
// Em vez de confiar no próprio gerador, este teste LÊ o QR de volta seguindo a
// norma ISO/IEC 18004, com as tabelas oficiais escritas aqui de novo:
//   1. confere localizadores, separadores, sincronia, módulo escuro e os padrões
//      de alinhamento (posições da tabela oficial, não da fórmula do gerador);
//   2. lê as duas cópias da faixa de formato e acha nível + máscara na tabela;
//   3. confere a faixa de versão (versão 7 em diante);
//   4. tira a máscara, lê os bytes em zigue-zague e separa os blocos;
//   5. confere a correção de erros Reed-Solomon de cada bloco (síndromes zeradas);
//   6. decodifica o texto e compara com o original.
//
// Rodar:  node testes/qrcode.test.mjs

import { gerarQR } from '../js/qrcode.js';

// ── Tabelas oficiais ──
const ALINHAMENTO = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
  10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
};

// 15 bits do formato (nível + máscara, já com o XOR 101010000010010)
const FORMATOS = {
  L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
  M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
  Q: ['011010101011111', '011000001101000', '011111100110001', '011101000000110', '010010010110100', '010000110000011', '010111011011010', '010101111101101'],
  H: ['001011010001001', '001001110111110', '001110011100111', '001100111010000', '000011101100010', '000001001010101', '000110100001100', '000100000111011'],
};

// Blocos por versão e nível: [blocos do grupo 1, bytes de dados em cada, blocos do grupo 2, bytes em cada, bytes de correção por bloco]
const BLOCOS = {
  '1L': [1, 19, 0, 0, 7], '1M': [1, 16, 0, 0, 10], '1Q': [1, 13, 0, 0, 13], '1H': [1, 9, 0, 0, 17],
  '2L': [1, 34, 0, 0, 10], '2M': [1, 28, 0, 0, 16], '2Q': [1, 22, 0, 0, 22], '2H': [1, 16, 0, 0, 28],
  '3L': [1, 55, 0, 0, 15], '3M': [1, 44, 0, 0, 26], '3Q': [2, 17, 0, 0, 18], '3H': [2, 13, 0, 0, 22],
  '4L': [1, 80, 0, 0, 20], '4M': [2, 32, 0, 0, 18], '4Q': [2, 24, 0, 0, 26], '4H': [4, 9, 0, 0, 16],
  '5L': [1, 108, 0, 0, 26], '5M': [2, 43, 0, 0, 24], '5Q': [2, 15, 2, 16, 18], '5H': [2, 11, 2, 12, 22],
  '6L': [2, 68, 0, 0, 18], '6M': [4, 27, 0, 0, 16], '6Q': [4, 19, 0, 0, 24], '6H': [4, 15, 0, 0, 28],
  '7L': [2, 78, 0, 0, 20], '7M': [4, 31, 0, 0, 18], '7Q': [2, 14, 4, 15, 18], '7H': [4, 13, 1, 14, 26],
  '8L': [2, 97, 0, 0, 24], '8M': [2, 38, 2, 39, 22], '8Q': [4, 18, 2, 19, 22], '8H': [4, 14, 2, 15, 26],
  '9L': [2, 116, 0, 0, 30], '9M': [3, 36, 2, 37, 22], '9Q': [4, 16, 4, 17, 20], '9H': [4, 12, 4, 13, 24],
  '10L': [2, 68, 2, 69, 18], '10M': [4, 43, 1, 44, 26], '10Q': [6, 19, 2, 20, 24], '10H': [6, 15, 2, 16, 28],
};
const VERSAO_7 = 0x07c94; // faixa de versão oficial da versão 7

// ── GF(256) com tabelas de exp/log (outro jeito de fazer a mesma conta do gerador) ──
const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mult = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function sindromesZeradas(bloco, ecc) {
  for (let j = 0; j < ecc; j++) {
    let s = 0;
    for (const c of bloco) s = mult(s, EXP[j]) ^ c; // Horner: c(α^j)
    if (s !== 0) return false;
  }
  return true;
}

const MASCARA = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

// ── Leitor ──
function ler(modulos) {
  const n = modulos.length;
  const v = (n - 17) / 4;
  if (!Number.isInteger(v) || !ALINHAMENTO[v]) throw new Error(`tamanho ${n} fora do teste`);
  const M = (r, c) => (modulos[r][c] ? 1 : 0); // r = linha, c = coluna

  const localizador = (r0, c0) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const escuro = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        if (M(r0 + r, c0 + c) !== (escuro ? 1 : 0)) throw new Error(`localizador em ${r0},${c0}`);
      }
    }
  };
  localizador(0, 0);
  localizador(0, n - 7);
  localizador(n - 7, 0);
  for (let i = 0; i < 8; i++) {
    if (M(7, i) || M(i, 7) || M(7, n - 1 - i) || M(i, n - 8) || M(n - 8, i) || M(n - 1 - i, 7)) throw new Error('separador');
  }
  for (let i = 8; i < n - 8; i++) {
    if (M(6, i) !== 1 - (i % 2) || M(i, 6) !== 1 - (i % 2)) throw new Error('sincronia');
  }
  if (M(4 * v + 9, 8) !== 1) throw new Error('módulo escuro');

  const pos = ALINHAMENTO[v];
  const ultimo = pos[pos.length - 1];
  const centros = [];
  for (const r of pos) {
    for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === ultimo) || (r === ultimo && c === 6)) continue;
      centros.push([r, c]);
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (M(r + dr, c + dc) !== (Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1)) throw new Error(`alinhamento ${r},${c}`);
        }
      }
    }
  }

  const bits = (coordenadas) => coordenadas.reduce((acc, [r, c]) => (acc << 1) | M(r, c), 0);
  const formato1 = bits([[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]);
  const formato2 = bits([[n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8],
    [8, n - 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1]]);
  if (formato1 !== formato2) throw new Error('as duas cópias do formato não batem');
  let nivel = null;
  let mascara = null;
  for (const [letra, lista] of Object.entries(FORMATOS)) {
    const m = lista.findIndex((b) => parseInt(b, 2) === formato1);
    if (m >= 0) { nivel = letra; mascara = m; }
  }
  if (nivel == null) throw new Error('formato inválido');

  if (v >= 7) {
    let info1 = 0;
    let info2 = 0;
    for (let i = 0; i < 18; i++) {
      info1 |= M(Math.floor(i / 3), n - 11 + (i % 3)) << i;
      info2 |= M(n - 11 + (i % 3), Math.floor(i / 3)) << i;
    }
    if (info1 !== info2 || info1 >>> 12 !== v) throw new Error('faixa de versão');
    if (v === 7 && info1 !== VERSAO_7) throw new Error('faixa da versão 7 diferente da tabela');
  }

  const reservado = (r, c) => (r <= 8 && c <= 8) || (r <= 8 && c >= n - 8) || (r >= n - 8 && c <= 8)
    || r === 6 || c === 6
    || centros.some(([cr, cc]) => Math.abs(r - cr) <= 2 && Math.abs(c - cc) <= 2)
    || (v >= 7 && ((r <= 5 && c >= n - 11 && c <= n - 9) || (c <= 5 && r >= n - 11 && r <= n - 9)));

  const lidos = [];
  let subindo = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const r = subindo ? n - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (!reservado(r, c)) lidos.push(M(r, c) ^ (MASCARA[mascara](r, c) ? 1 : 0));
      }
    }
    subindo = !subindo;
  }
  const bytes = [];
  for (let i = 0; i + 8 <= lidos.length; i += 8) bytes.push(lidos.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const [b1, d1, b2, d2, ecc] = BLOCOS[`${v}${nivel}`];
  const tamanhos = [...Array(b1).fill(d1), ...Array(b2).fill(d2)];
  if (bytes.length !== tamanhos.reduce((s, d) => s + d + ecc, 0)) throw new Error('quantidade de bytes não bate com a tabela');
  const blocos = tamanhos.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(d1, d2); i++) tamanhos.forEach((d, b) => { if (i < d) blocos[b].push(bytes[k++]); });
  for (let i = 0; i < ecc; i++) blocos.forEach((bloco) => bloco.push(bytes[k++]));
  blocos.forEach((bloco, b) => { if (!sindromesZeradas(bloco, ecc)) throw new Error(`Reed-Solomon do bloco ${b}`); });

  const dados = blocos.flatMap((bloco, b) => bloco.slice(0, tamanhos[b]));
  const fluxo = dados.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((s) => (byte >>> s) & 1));
  let p = 0;
  const pegar = (q) => { let x = 0; for (let i = 0; i < q; i++) x = (x << 1) | fluxo[p++]; return x; };
  if (pegar(4) !== 0b0100) throw new Error('modo não é byte');
  const quantos = pegar(v <= 9 ? 8 : 16);
  const texto = Array.from({ length: quantos }, () => pegar(8));
  return { versao: v, nivel, mascara, bytes: texto };
}

// ── Casos ──
let ok = 0;
const erros = [];
const conferir = (descricao, condicao) => { if (condicao) ok++; else erros.push(descricao); };

const textos = [
  'A',
  'http://localhost:8095/loja/?l=emporio-da-serra',
  'https://jpfneves.github.io/vitrine-zap/loja/?l=restaurante-tempero-da-serra&mesa=12',
  'Olá, açúcar e pão de queijo! 😀',
  'x'.repeat(119),
];
for (const texto of textos) {
  const esperado = [...new TextEncoder().encode(texto)];
  for (const nivel of ['L', 'M', 'Q', 'H']) {
    for (const mascara of [0, 1, 2, 3, 4, 5, 6, 7, null]) {
      const nome = `"${texto.slice(0, 24)}…" nível ${nivel} máscara ${mascara ?? 'automática'}`;
      try {
        const qr = gerarQR(texto, { nivel, mascara });
        const lido = ler(qr.modulos);
        conferir(`${nome}: texto lido diferente`, lido.bytes.length === esperado.length && lido.bytes.every((b, i) => b === esperado[i]));
        conferir(`${nome}: nível lido ${lido.nivel}`, lido.nivel === nivel);
        if (mascara != null) conferir(`${nome}: máscara lida ${lido.mascara}`, lido.mascara === mascara);
      } catch (erro) {
        erros.push(`${nome}: ${erro.message}`);
      }
    }
  }
}

// Escolha da versão: o maior texto que cabe em cada versão (1 a 9) e um byte a mais
for (const nivel of ['L', 'M', 'Q', 'H']) {
  for (let v = 1; v <= 9; v++) {
    const [b1, d1, b2, d2] = BLOCOS[`${v}${nivel}`];
    const cabe = Math.floor(((b1 * d1 + b2 * d2) * 8 - 12) / 8);
    conferir(`${cabe} bytes no nível ${nivel} deveriam caber na versão ${v}`, gerarQR('a'.repeat(cabe), { nivel }).versao === v);
    conferir(`${cabe + 1} bytes no nível ${nivel} deveriam ir pra versão ${v + 1}`, gerarQR('a'.repeat(cabe + 1), { nivel }).versao === v + 1);
  }
}

if (erros.length) {
  console.error(`✗ ${erros.length} falha(s), ${ok} conferências certas:`);
  for (const erro of erros.slice(0, 20)) console.error(`  - ${erro}`);
  process.exit(1);
}
console.log(`✓ QR code: ${ok} conferências certas (${textos.length} textos × 4 níveis × 9 máscaras + escolha de versão)`);

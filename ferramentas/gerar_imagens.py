"""Gera as imagens do app com o Edge (ou Chrome) aberto sem janela.

  icones  ícones PNG do PWA a partir de icons/icone.svg e icons/maskable.svg,
          e a prévia do link (icons/compartilhar.jpg, 1200 × 630)
  telas   telas do manifest e do README (precisa do site rodando)

Uso, na pasta do projeto:
  python -I -X utf8 ferramentas/gerar_imagens.py icones
  python -I -X utf8 ferramentas/gerar_imagens.py telas http://127.0.0.1:8095/

Só usa a biblioteca padrão do Python.
"""

import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent
NAVEGADORES = [
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
]


def achar_navegador():
    for caminho in NAVEGADORES:
        if caminho.is_file():
            return str(caminho)
    for nome in ("msedge", "google-chrome", "chromium", "chrome"):
        if shutil.which(nome):
            return shutil.which(nome)
    sys.exit("Não achei o Edge nem o Chrome neste computador.")


def foto(alvo, destino, largura, altura, escala=1, transparente=False):
    """Abre a página (endereço http ou HTML em texto) e salva a tela em PNG ou JPG."""
    navegador = achar_navegador()
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        tmp = Path(tmp)
        if not alvo.startswith("http"):
            pagina = tmp / "pagina.html"
            pagina.write_text(alvo, encoding="utf8")
            alvo = pagina.as_uri()
        saida = tmp / f"tela{destino.suffix.lower()}"
        comando = [
            navegador, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
            "--no-default-browser-check", "--disable-extensions", f"--user-data-dir={tmp / 'perfil'}",
            f"--force-device-scale-factor={escala}", f"--window-size={largura},{altura}",
            "--virtual-time-budget=12000", f"--screenshot={saida}",
        ]
        if transparente:
            comando.append("--default-background-color=00000000")
        comando.append(alvo)
        subprocess.run(comando, capture_output=True, timeout=180)
        if not saida.is_file() or saida.stat().st_size < 200:
            print(f"  ✗ {destino.relative_to(PASTA)}: o navegador não gerou a imagem")
            return False
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(saida, destino)
    print(f"  ✓ {destino.relative_to(PASTA)} ({largura * escala}×{altura * escala})")
    return True


def pagina_do_svg(svg, lado):
    return (
        "<!doctype html><html><head><meta charset='utf-8'><style>"
        f"html,body{{margin:0;background:transparent}}svg{{display:block;width:{lado}px;height:{lado}px}}"
        f"</style></head><body>{svg}</body></html>"
    )


def previa_do_link(svg):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{{margin:0;width:1200px;height:630px;overflow:hidden}}
      body{{font-family:"Segoe UI",system-ui,sans-serif;color:#fff;display:flex;align-items:center;gap:56px;padding:0 84px;
        box-sizing:border-box;background:radial-gradient(700px 400px at 15% 10%,rgba(255,255,255,.16),transparent),
        linear-gradient(140deg,#0f7a55,#083f2c)}}
      .logo svg{{width:250px;height:250px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.35))}}
      h1{{font-size:92px;margin:0 0 6px;letter-spacing:-3px;line-height:1}}
      h1 span{{color:#f5b83d}}
      p{{font-size:38px;line-height:1.25;margin:0 0 30px;opacity:.95;max-width:720px}}
      ul{{display:flex;gap:14px;list-style:none;margin:0;padding:0}}
      li{{font-size:24px;font-weight:600;padding:10px 20px;border-radius:999px;background:rgba(255,255,255,.14)}}
    </style></head><body>
      <div class="logo">{svg}</div>
      <div><h1>Vitrine <span>Zap</span></h1>
        <p>Catálogo digital que fecha o pedido no WhatsApp</p>
        <ul><li>🧀 Empório</li><li>💐 Floricultura</li><li>🍲 Mesa com QR</li></ul></div>
    </body></html>"""


def icones():
    svg = (PASTA / "icons" / "icone.svg").read_text(encoding="utf8")
    maskable = (PASTA / "icons" / "maskable.svg").read_text(encoding="utf8")
    icons = PASTA / "icons"
    print("Ícones:")
    for nome, lado in (("icone-512.png", 512), ("icone-192.png", 192), ("favicon-32.png", 32)):
        foto(pagina_do_svg(svg, lado), icons / nome, lado, lado, transparente=True)
    foto(pagina_do_svg(maskable, 512), icons / "maskable-512.png", 512, 512)
    foto(pagina_do_svg(maskable, 180), icons / "apple-touch-icon.png", 180, 180)
    foto(previa_do_link(svg), icons / "compartilhar.jpg", 1200, 630)


# ── Telas: o navegador controlado pelo DevTools Protocol ──
# O --screenshot simples fotografa antes do IndexedDB responder, então aqui o
# navegador abre com a porta de depuração e o script espera a página montar.
# O WebSocket é feito na mão (biblioteca padrão não tem cliente de WebSocket).

class Navegador:
    def __init__(self, perfil):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.porta = s.getsockname()[1]
        self.processo = subprocess.Popen(
            [achar_navegador(), "--headless=new", f"--remote-debugging-port={self.porta}", f"--user-data-dir={perfil}",
             "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        alvo = None
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.porta}/json/list", timeout=2) as r:
                    alvo = next((p for p in json.load(r) if p.get("type") == "page"), None)
                if alvo:
                    break
            except OSError:
                pass
            time.sleep(0.2)
        if not alvo:
            self.fechar()
            sys.exit("O navegador não abriu a porta de depuração.")
        self.sock = self._conectar(alvo["webSocketDebuggerUrl"])
        self.proximo_id = 0

    def _conectar(self, url):
        resto = url.split("://", 1)[1]
        endereco, caminho = resto.split("/", 1)
        host, porta = endereco.split(":")
        sock = socket.create_connection((host, int(porta)), timeout=60)
        chave = base64.b64encode(os.urandom(16)).decode()
        sock.sendall((f"GET /{caminho} HTTP/1.1\r\nHost: {endereco}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                      f"Sec-WebSocket-Key: {chave}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        cabecalho = b""
        while b"\r\n\r\n" not in cabecalho:
            cabecalho += sock.recv(1)
        if b" 101 " not in cabecalho.split(b"\r\n", 1)[0]:
            raise RuntimeError("O navegador recusou o WebSocket")
        return sock

    def _ler(self, n):
        dados = b""
        while len(dados) < n:
            pedaco = self.sock.recv(n - len(dados))
            if not pedaco:
                raise RuntimeError("Conexão com o navegador caiu")
            dados += pedaco
        return dados

    def _enviar(self, texto):
        dados = texto.encode()
        quadro = bytearray([0x81])
        if len(dados) < 126:
            quadro.append(0x80 | len(dados))
        elif len(dados) < 65536:
            quadro += bytes([0x80 | 126]) + struct.pack(">H", len(dados))
        else:
            quadro += bytes([0x80 | 127]) + struct.pack(">Q", len(dados))
        mascara = os.urandom(4)
        self.sock.sendall(bytes(quadro) + mascara + bytes(b ^ mascara[i % 4] for i, b in enumerate(dados)))

    def _receber(self):
        mensagem = b""
        while True:
            b1, b2 = self._ler(2)
            tamanho = b2 & 0x7F
            if tamanho == 126:
                tamanho = struct.unpack(">H", self._ler(2))[0]
            elif tamanho == 127:
                tamanho = struct.unpack(">Q", self._ler(8))[0]
            dados = self._ler(tamanho)
            tipo = b1 & 0x0F
            if tipo == 9:  # ping
                continue
            mensagem += dados
            if b1 & 0x80:
                return json.loads(mensagem)

    def comando(self, metodo, **parametros):
        self.proximo_id += 1
        self._enviar(json.dumps({"id": self.proximo_id, "method": metodo, "params": parametros}))
        while True:
            resposta = self._receber()
            if resposta.get("id") == self.proximo_id:
                if "error" in resposta:
                    raise RuntimeError(f"{metodo}: {resposta['error']}")
                return resposta.get("result", {})

    def tela(self, url, destino, largura, altura, escala=1, celular=False, espera=4.0):
        self.comando("Emulation.setDeviceMetricsOverride", width=largura, height=altura,
                     deviceScaleFactor=escala, mobile=celular)
        self.comando("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "light"}])
        self.comando("Page.navigate", url=url)
        time.sleep(espera)
        png = base64.b64decode(self.comando("Page.captureScreenshot", format="png")["data"])
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_bytes(png)
        print(f"  ✓ {destino.relative_to(PASTA)} ({largura * escala}×{altura * escala})")

    def fechar(self):
        try:
            self.comando("Browser.close")
        except Exception:
            pass
        self.processo.terminate()
        try:
            self.processo.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.processo.kill()


def telas(base):
    base = base.rstrip("/") + "/"
    destino = PASTA / "docs" / "telas"
    print("Telas:")
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as perfil:
        nav = Navegador(perfil)
        try:
            nav.tela(f"{base}loja/?l=emporio-da-serra&moldura=1", destino / "celular-catalogo.png", 390, 844, 2, True)
            nav.tela(f"{base}loja/?l=restaurante-tempero-da-serra&mesa=7&moldura=1", destino / "celular-mesa.png", 390, 844, 2, True)
            # o painel abre com um aviso que some em 5 s: espera ele sair da foto
            nav.tela(f"{base}painel/?exemplo=floricultura-bela-flor", destino / "celular-painel.png", 390, 844, 2, True, espera=6.5)
            nav.tela(f"{base}painel/?exemplo=emporio-da-serra#produtos", destino / "computador-painel.png", 1280, 800, espera=6.5)
            nav.tela(base, destino / "computador-inicio.png", 1280, 800, espera=6.0)
        finally:
            nav.fechar()


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "icones":
        icones()
    elif len(sys.argv) >= 3 and sys.argv[1] == "telas":
        telas(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)

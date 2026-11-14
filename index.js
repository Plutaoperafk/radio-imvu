const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const SENHA_DJ = "1234"; // <--- MUDE SUA SENHA DO PAINEL AQUI

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let ouvintes = [];
let modoAtual = 'pasta'; // 'pasta' ou 'link'
let urlExterna = '';
let indiceMusica = 0;
let musicaTocando = 'Nenhuma música carregada';
let streamAtivo = null;

const pastaMusicas = path.join(__dirname, 'musicas');
if (!fs.existsSync(pastaMusicas)) {
  fs.mkdirSync(pastaMusicas);
}

function listarMusicas() {
  return fs.readdirSync(pastaMusicas).filter(arq => arq.toLowerCase().endsWith('.mp3'));
}

function enviarParaOuvintes(chunk) {
  ouvintes.forEach(res => {
    try {
      res.write(chunk);
    } catch (e) {}
  });
}

function tocarProxima() {
  if (streamAtivo) {
    streamAtivo.destroy();
    streamAtivo = null;
  }

  if (modoAtual === 'link' && urlExterna) {
    musicaTocando = `Link Externo: ${urlExterna}`;
    fetch(urlExterna)
      .then(res => {
        streamAtivo = res.body;
        res.body.on('data', chunk => enviarParaOuvintes(chunk));
        res.body.on('end', () => {
          modoAtual = 'pasta';
          tocarProxima();
        });
        res.body.on('error', () => {
          modoAtual = 'pasta';
          setTimeout(tocarProxima, 2000);
        });
      })
      .catch(() => {
        modoAtual = 'pasta';
        setTimeout(tocarProxima, 2000);
      });
    return;
  }

  const lista = listarMusicas();
  if (lista.length === 0) {
    musicaTocando = 'Pasta /musicas vazia. Suba arquivos .mp3 no GitHub ou cole um link no painel.';
    setTimeout(tocarProxima, 5000);
    return;
  }

  if (indiceMusica >= lista.length) indiceMusica = 0;
  const arquivo = lista[indiceMusica];
  const caminho = path.join(pastaMusicas, arquivo);
  musicaTocando = arquivo;

  const readStream = fs.createReadStream(caminho, { highWaterMark: 16 * 1024 });
  streamAtivo = readStream;

  // Controla a velocidade aproximada de envio (128kbps ~ 16KB/s)
  readStream.on('data', chunk => {
    readStream.pause();
    enviarParaOuvintes(chunk);
    setTimeout(() => {
      if (!readStream.destroyed) readStream.resume();
    }, 950);
  });

  readStream.on('end', () => {
    indiceMusica++;
    tocarProxima();
  });

  readStream.on('error', () => {
    indiceMusica++;
    setTimeout(tocarProxima, 1000);
  });
}

// ROTA PRINCIPAL DO STREAM PARA COLAR NO IMVU
app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'icy-name': 'Radio IMVU DJ'
  });

  ouvintes.push(res);
  req.on('close', () => {
    ouvintes = ouvintes.filter(o => o !== res);
  });
});

// PAINEL DE CONTROLE DO DJ
app.get('/dj', (req, res) => {
  const lista = listarMusicas();
  const botoesMusicas = lista.map((m, i) => 
    `<li><button onclick="comando('tocar', ${i})">▶ Tocar</button> ${m}</li>`
  ).join('');

  res.send(`
    <html>
    <head>
      <title>Painel DJ - IMVU</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: sans-serif; background: #121212; color: #fff; padding: 20px; max-width: 600px; margin: auto; }
        input, button { padding: 10px; margin: 5px 0; border-radius: 5px; border: none; }
        input { width: 100%; background: #222; color: #fff; border: 1px solid #444; }
        button { background: #1db954; color: #000; font-weight: bold; cursor: pointer; }
        button.sec { background: #444; color: #fff; }
        .box { background: #1e1e1e; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        ul { list-style: none; padding: 0; }
        li { padding: 6px 0; border-bottom: 1px solid #333; }
      </style>
    </head>
    <body>
      <h2>🎧 Painel DJ - Rádio IMVU</h2>
      <div class="box">
        <strong>Tocando agora:</strong> <span style="color:#1db954">${musicaTocando}</span><br>
        <strong>Ouvintes conectados:</strong> ${ouvintes.length}
      </div>

      <div class="box">
        <label>Senha do DJ:</label>
        <input type="password" id="senha" placeholder="Digite sua senha (padrão: 1234)">
      </div>

      <div class="box">
        <h3>🌐 Tocar Link Externo (Rádio ou MP3 direto)</h3>
        <input type="text" id="url" placeholder="Cole aqui o link http://... ou https://...">
        <button onclick="comando('link')">Tocar Link Agora</button>
        <button class="sec" onclick="comando('pular')">⏭ Pular / Voltar p/ Pasta</button>
      </div>

      <div class="box">
        <h3>🎵 Músicas na Pasta (/musicas)</h3>
        <ul>${botoesMusicas || '<li>Nenhuma música .mp3 na pasta ainda.</li>'}</ul>
      </div>

      <script>
        function comando(acao, indice = 0) {
          const senha = document.getElementById('senha').value;
          const url = document.getElementById('url').value;
          fetch('/api/comando', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, acao, indice, url })
          })
          .then(r => r.json())
          .then(d => {
            alert(d.msg);
            if(d.ok) location.reload();
          });
        }
      </script>
    </body>
    </html>
  `);
});

app.post('/api/comando', (req, res) => {
  const { senha, acao, indice, url } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });

  if (acao === 'pular') {
    modoAtual = 'pasta';
    indiceMusica++;
    tocarProxima();
    return res.json({ ok: true, msg: 'Pulando para próxima música da pasta...' });
  }
  if (acao === 'tocar') {
    modoAtual = 'pasta';
    indiceMusica = indice;
    tocarProxima();
    return res.json({ ok: true, msg: 'Música selecionada!' });
  }
  if (acao === 'link' && url) {
    modoAtual = 'link';
    urlExterna = url.trim();
    tocarProxima();
    return res.json({ ok: true, msg: 'Conectando ao link externo...' });
  }
  res.json({ ok: false, msg: 'Comando inválido.' });
});

app.get('/', (req, res) => res.send('Rádio IMVU Online! Use /stream na sala ou /dj para controlar.'));

app.listen(PORT, () => {
  console.log('Servidor rodando na porta ' + PORT);
  tocarProxima();
});

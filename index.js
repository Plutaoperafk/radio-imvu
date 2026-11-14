const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const SENHA_DJ = "1234"; // <--- TROQUE SUA SENHA AQUI

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let ouvintes = [];
let radioLigada = true;
let modoAtual = 'pasta';
let urlExterna = '';
let indiceMusica = 0;
let musicaTocando = 'Iniciando rádio...';
let streamAtivo = null;
let velocidadeAtual = '128 kbps (Normal)';
const inicioServidor = Date.now();

const pastaMusicas = path.join(__dirname, 'musicas');
if (!fs.existsSync(pastaMusicas)) {
  fs.mkdirSync(pastaMusicas);
}

function listarMusicas() {
  return fs.readdirSync(pastaMusicas).filter(arq => arq.toLowerCase().endsWith('.mp3'));
}

function enviarParaOuvintes(chunk) {
  if (!radioLigada) return;
  ouvintes.forEach(res => {
    try {
      res.write(chunk);
    } catch (e) {}
  });
}

function pararStreamAtual() {
  if (streamAtivo) {
    try { streamAtivo.destroy(); } catch (e) {}
    streamAtivo = null;
  }
}

function tocarProxima() {
  pararStreamAtual();

  if (!radioLigada) {
    musicaTocando = 'Rádio desligada (OFF) pelo DJ';
    return;
  }

  if ((modoAtual === 'link' || modoAtual === 'busca') && urlExterna) {
    velocidadeAtual = 'Stream Externo / API Direta';
    fetch(urlExterna, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      .then(res => {
        if (!res.ok) throw new Error('Falha no link');
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
        musicaTocando = 'Erro ao conectar no link, voltando para pasta...';
        modoAtual = 'pasta';
        setTimeout(tocarProxima, 2000);
      });
    return;
  }

  const lista = listarMusicas();
  if (lista.length === 0) {
    musicaTocando = 'Pasta /musicas vazia. Use a Busca ou suas Listas Favoritas!';
    velocidadeAtual = 'Aguardando áudio';
    setTimeout(tocarProxima, 5000);
    return;
  }

  if (indiceMusica >= lista.length) indiceMusica = 0;
  const arquivo = lista[indiceMusica];
  const caminho = path.join(pastaMusicas, arquivo);
  musicaTocando = `📁 ${arquivo}`;
  velocidadeAtual = '128 kbps (~16 KB/s)';

  const readStream = fs.createReadStream(caminho, { highWaterMark: 16 * 1024 });
  streamAtivo = readStream;

  readStream.on('data', chunk => {
    if (!radioLigada) {
      readStream.pause();
      return;
    }
    readStream.pause();
    enviarParaOuvintes(chunk);
    setTimeout(() => {
      if (!readStream.destroyed && radioLigada) readStream.resume();
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
async function buscarFontesOnline(termo) {
  let resultados = [];

  // 1. Busca estações de rádio temáticas (Radio Browser)
  try {
    const urlRadio = 'https://radio-browser.info' + encodeURIComponent(termo) + '?limit=6&hidebroken=true';
    const radioRes = await fetch(urlRadio, { headers: { 'User-Agent': 'RadioIMVU/1.0' } });
    if (radioRes.ok) {
      const stations = await radioRes.json();
      const radios = (stations || []).filter(s => s.url_resolved).map(s => ({
        tipo: 'radio',
        titulo: '📻 Rádio: ' + s.name.trim(),
        streamUrl: s.url_resolved
      }));
      resultados = resultados.concat(radios);
    }
  } catch (e) {}

  // 2. Busca arquivos MP3 diretos no Internet Archive
  try {
    const urlArch = 'https://archive.org' + encodeURIComponent(termo) + '+AND+mediatype:audio+AND+format:MP3&fl[]=identifier,title&rows=6&output=json';
    const archRes = await fetch(urlArch);
    if (archRes.ok) {
      const archJson = await archRes.json();
      const docs = archJson?.response?.docs || [];
      docs.forEach(doc => {
        resultados.push({
          tipo: 'mp3',
          titulo: '🎵 Archive MP3: ' + (doc.title || doc.identifier),
          streamUrl: 'https://archive.org' + doc.identifier + '/' + doc.identifier + '.mp3'
        });
      });
    }
  } catch (e) {}

  // 3. Busca faixas na API Apple/iTunes
  try {
    const urlItunes = 'https://apple.com' + encodeURIComponent(termo) + '&media=music&limit=6';
    const itunesRes = await fetch(urlItunes);
    if (itunesRes.ok) {
      const itunesJson = await itunesRes.json();
      const tracks = (itunesJson.results || []).filter(t => t.previewUrl).map(t => ({
        tipo: 'mp3',
        titulo: '🎧 Prévia Oficial: ' + t.artistName + ' - ' + t.trackName,
        streamUrl: t.previewUrl
      }));
      resultados = resultados.concat(tracks);
    }
  } catch (e) {}

  return resultados;
}


app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Rádio IMVU - Servidor Ativo</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: sans-serif; background: #0f0f13; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: #1a1a24; padding: 30px; border-radius: 12px; max-width: 450px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
        h1 { color: #1db954; margin-top: 0; }
        p { color: #ccc; line-height: 1.5; }
        .btn { display: inline-block; padding: 12px 20px; margin: 10px 5px; border-radius: 6px; text-decoration: none; font-weight: bold; }
        .btn-stream { background: #1db954; color: #000; }
        .btn-dj { background: #333; color: #fff; border: 1px solid #555; }
        code { background: #000; padding: 4px 8px; border-radius: 4px; color: #1db954; }
      </style>
<script src="https://jsdelivr.net"></script>
      
    </head>
    <body>
      <div class="card">
        <h1>📻 Rádio IMVU Online</h1>
        <p>Você acessou o endereço raiz do servidor. Escolha uma das opções abaixo:</p>
        <p><strong>1. Link para colar na sala do IMVU:</strong><br>Adicione <code>/stream</code> no final do link.</p>
        <p><strong>2. Painel de controle do DJ:</strong><br>Adicione <code>/dj</code> no final do link.</p>
        <a href="/stream" class="btn btn-stream">🔊 Ouvir Stream</a>
        <a href="/dj" class="btn btn-dj">🎧 Abrir Painel DJ</a>
      </div>
    </body>
    </html>
  `);
});

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

// ROTA PARA RECEBER ÁUDIO AO VIVO DO MICROFONE DO DJ
let modoAoVivo = false;

app.post('/api/ao-vivo', (req, res) => {
  const senha = req.headers['x-senha'];
  if (senha !== SENHA_DJ) return res.status(401).end();

  modoAoVivo = true;
  radioLigada = true;
  pararStreamAtual();
  musicaTocando = '🎙️ LOCUTOR AO VIVO NO MICROFONE!';
  velocidadeAtual = 'Transmissão Mic Ao Vivo';

  req.on('data', chunk => {
    enviarParaOuvintes(chunk);
  });

  req.on('end', () => {
    modoAoVivo = false;
    tocarProxima();
    res.end();
  });

  req.on('error', () => {
    modoAoVivo = false;
    tocarProxima();
  });
});

app.get('/api/status', (req, res) => {
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const seg = Math.floor((Date.now() - inicioServidor) / 1000);
  const min = Math.floor(seg / 60);
  const hrs = Math.floor(min / 60);

  res.json({
    online: radioLigada,
    musica: musicaTocando,
    ouvintes: ouvintes.length,
    velocidade: velocidadeAtual,
    memoria: `${memMB} MB / 512 MB (Render Free)`,
    uptime: `${hrs}h ${min % 60}m ${seg % 60}s`
  });
});
app.get('/dj', (req, res) => {
  const lista = listarMusicas();
  const botoesMusicas = lista.map((m, i) => 
    `<li><button onclick="comando('tocar', ${i})">▶ Tocar</button> <span>${m}</span></li>`
  ).join('');

  res.send(`
    <html>
    <head>
      <title>Painel DJ - IMVU</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: sans-serif; background: #121212; color: #fff; padding: 15px; max-width: 680px; margin: auto; }
        input[type="text"], input[type="password"] { width: 100%; padding: 10px; margin: 5px 0; border-radius: 5px; border: 1px solid #444; background: #222; color: #fff; box-sizing: border-box; }
        button { padding: 8px 12px; margin: 4px 3px 4px 0; border-radius: 5px; border: none; background: #1db954; color: #000; font-weight: bold; cursor: pointer; }
        button.sec { background: #3a3a3a; color: #fff; }
        button.off { background: #e53935; color: #fff; }
        button.fav { background: #ffb300; color: #000; }
        .box { background: #1e1e1e; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #2c2c2c; }
        .badge-on { background: #1db954; color: #000; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
        .badge-off { background: #e53935; color: #fff; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
        .grid-status { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 14px; margin-top: 10px; color: #ccc; }
        .grid-listas { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 600px) { .grid-listas { grid-template-columns: 1fr; } }
        ul { list-style: none; padding: 0; margin: 0; }
        li { padding: 8px 0; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 14px; }
        .hidden { display: none; }
      </style>
    </head>
    <body>
      <h2>🎧 Painel DJ - Rádio IMVU</h2>
      
      <div class="box" style="border-color: #ff5252;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <strong>🎙️ Locutor Ao Vivo (Voz + Música):</strong><br>
            <span id="status-mic" style="font-size:13px; color:#bbb;">Microfone desligado</span>
          </div>
          <div>
            <button id="btn-mic-on" style="background:#ff5252; color:#fff;" onclick="iniciarMicAoVivo()">🎙️ Entrar Ao Vivo</button>
            <button id="btn-mic-off" class="sec hidden" onclick="pararMicAoVivo()">⏹ Encerrar Mic</button>
          </div>
        </div>
        <div style="margin-top:8px; font-size:12px; color:#aaa;">
          <label><input type="checkbox" id="mic-com-musica" checked> Manter música de fundo tocando baixo enquanto falo</label>
        </div>
      </div>
      

      <div class="box">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>Status: <span id="st-badge" class="badge-on">ON</span></div>
          <div>
            <button onclick="comando('ligar')">⚡ Ligar</button>
            <button class="off" onclick="comando('desligar')">⏹ Desligar</button>
          </div>
        </div>
        <p style="margin: 10px 0 5px 0;"><strong>Tocando:</strong> <span id="st-musica" style="color:#1db954">${musicaTocando}</span></p>
        <div class="grid-status">
          <div>👥 <strong>Ouvintes:</strong> <span id="st-ouvintes">${ouvintes.length}</span></div>
          <div>🚀 <strong>Velocidade:</strong> <span id="st-vel">${velocidadeAtual}</span></div>
          <div>🧠 <strong>RAM Render:</strong> <span id="st-mem">Carregando...</span></div>
          <div>⏱ <strong>Tempo Online:</strong> <span id="st-up">Carregando...</span></div>
        </div>
      </div>
            <div class="box" style="border-color: #1db954;">
        <h3>💡 Dicas: Onde achar Links Diretos que funcionam aqui</h3>
        <ul style="font-size: 13px; color: #ccc; line-height: 1.6;">
          <li style="display:block;"><strong>1. Rádios 24h (Stream):</strong> Acesse <a href="https://radio-browser.info" target="_blank" style="color:#1db954">radio-browser.info</a>, busque qualquer estilo ou banda (ex: Linkin Park, Metal, Phonk) e copie a URL do stream.</li>
          <li style="display:block;"><strong>2. Músicas MP3 Grátis:</strong> Acesse <a href="https://archive.org" target="_blank" style="color:#1db954">archive.org</a>, abra uma música, clique em <b>VBR MP3</b> à direita, clique com botão direito na faixa e escolha <b>"Copiar endereço do link"</b>.</li>
          <li style="display:block;"><strong>3. Seus próprios MP3 sem gastar GitHub:</strong> Suba qualquer arquivo <code>.mp3</code> grátis em <a href="https://catbox.moe" target="_blank" style="color:#1db954">catbox.moe</a> e ele gera um link direto <code>https://catbox.moe</code> na hora.</li>
          <li style="display:block;"><strong>4. Dropbox:</strong> Copie o link do seu MP3 no Dropbox e troque o final <code>?dl=0</code> por <code>?raw=1</code>.</li>
        </ul>
      </div>


      <div class="box" id="box-login">
        <label><strong>🔐 Senha do DJ:</strong></label>
        <input type="password" id="senha" placeholder="Digite sua senha para liberar os comandos">
        <label style="font-size: 13px; color: #bbb; display:block; margin: 5px 0;">
          <input type="checkbox" id="manter-login"> Manter logado mesmo se fechar o navegador
        </label>
        <button onclick="salvarSenha()">Desbloquear Painel</button>
      </div>

      <div class="box hidden" id="box-logado" style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#1db954; font-size:14px;">🔓 Painel desbloqueado</span>
        <button class="sec" onclick="sairSessao()" style="padding:5px 10px; font-size:12px;">Sair / Bloquear</button>
      </div>

      <div class="box">
        <h3>🔎 Buscar Artista, Música ou Rádio (Online)</h3>
        <input type="text" id="termo-busca" placeholder="Ex: Linkin Park, Rock, Alok, Metal...">
        <button onclick="buscarMusica()">🔍 Buscar Agora</button>
        <button class="sec" onclick="tocarAleatorio()">🎲 Tocar Aleatório</button>
        <ul id="lista-busca" style="margin-top:10px;"></ul>
      </div>

      <div class="box">
        <h3>🌐 Colar Link Direto & Salvar nas Listas</h3>
        <input type="text" id="nome-link" placeholder="Nome para salvar (Ex: Rádio Rock 24h ou In The End)">
        <input type="text" id="url" placeholder="Cole o link http://... ou https://... (.mp3 ou stream)">
        <button onclick="comando('link')">▶ Tocar Agora</button>
        <button class="fav" onclick="adicionarFavorito('radio')">⭐ Salvar em Rádios</button>
        <button class="fav" onclick="adicionarFavorito('mp3')">⭐ Salvar em Links MP3</button>
        <button class="sec" onclick="comando('pular')">⏭ Voltar p/ Pasta</button>
      </div>

      <div class="grid-listas">
        <div class="box">
          <h3>📻 Rádios Online Salvas</h3>
          <ul id="lista-radios"></ul>
        </div>
        <div class="box">
          <h3>🎵 Links MP3 Diretos Salvos</h3>
          <ul id="lista-mp3s"></ul>
        </div>
      </div>

      <div class="box">
        <h3>📁 Músicas na Pasta do GitHub (/musicas)</h3>
        <ul>${botoesMusicas || '<li>Nenhuma música .mp3 na pasta ainda.</li>'}</ul>
      </div>
      <script>
        const radiosPadrao = [
          { nome: 'Rock Antenne Heavy Metal', url: 'http://rockantenne.de' },
          { nome: 'Radio Paradise (Mix/Rock)', url: 'http://radioparadise.com' }
        ];
        const mp3Padrao = [];

        function carregarFavoritos() {
          const radios = JSON.parse(localStorage.getItem('fav_radios') || JSON.stringify(radiosPadrao));
          const mp3s = JSON.parse(localStorage.getItem('fav_mp3s') || JSON.stringify(mp3Padrao));

          document.getElementById('lista-radios').innerHTML = radios.map((item, idx) => \`
            <li>
              <span>\${item.nome}</span>
              <div>
                <button onclick="comando('link', 0, '\${item.url}', '\${item.nome.replace(/'/g, "")}')">▶</button>
                <button class="off" onclick="removerFavorito('radio', \${idx})">X</button>
              </div>
            </li>
          \`).join('') || '<li>Nenhuma rádio salva.</li>';

          document.getElementById('lista-mp3s').innerHTML = mp3s.map((item, idx) => \`
            <li>
              <span>\${item.nome}</span>
              <div>
                <button onclick="comando('link', 0, '\${item.url}', '\${item.nome.replace(/'/g, "")}')">▶</button>
                <button class="off" onclick="removerFavorito('mp3', \${idx})">X</button>
              </div>
            </li>
          \`).join('') || '<li>Nenhum link MP3 salvo ainda.</li>';
        }

        function adicionarFavorito(tipo, nomeCustom = '', urlCustom = '') {
          const nome = nomeCustom || document.getElementById('nome-link').value.trim();
          const url = urlCustom || document.getElementById('url').value.trim();
          if (!nome || !url) return alert('Preencha o Nome e o Link para salvar na lista!');

          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const atual = JSON.parse(localStorage.getItem(chave) || (tipo === 'radio' ? JSON.stringify(radiosPadrao) : '[]'));
          atual.push({ nome, url });
          localStorage.setItem(chave, JSON.stringify(atual));
          carregarFavoritos();
          if (!nomeCustom) {
            document.getElementById('nome-link').value = '';
            document.getElementById('url').value = '';
          }
          alert('Salvo na lista de ' + (tipo === 'radio' ? 'Rádios Online!' : 'Links MP3!'));
        }

        function removerFavorito(tipo, idx) {
          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const atual = JSON.parse(localStorage.getItem(chave) || (tipo === 'radio' ? JSON.stringify(radiosPadrao) : '[]'));
          atual.splice(idx, 1);
          localStorage.setItem(chave, JSON.stringify(atual));
          carregarFavoritos();
        }

        function obterSenha() {
          return localStorage.getItem('dj_senha') || sessionStorage.getItem('dj_senha') || document.getElementById('senha').value;
        }

        function atualizarInterfaceLogin() {
          const s = localStorage.getItem('dj_senha') || sessionStorage.getItem('dj_senha');
          if (s) {
            document.getElementById('box-login').classList.add('hidden');
            document.getElementById('box-logado').style.display = 'flex';
          } else {
            document.getElementById('box-login').classList.remove('hidden');
            document.getElementById('box-logado').style.display = 'none';
          }
        }

        function salvarSenha() {
          const val = document.getElementById('senha').value;
          if (!val) return alert('Digite a senha primeiro!');
          const manter = document.getElementById('manter-login').checked;
          if (manter) localStorage.setItem('dj_senha', val);
          else sessionStorage.setItem('dj_senha', val);
          atualizarInterfaceLogin();
        }

        function sairSessao() {
          localStorage.removeItem('dj_senha');
          sessionStorage.removeItem('dj_senha');
          document.getElementById('senha').value = '';
          atualizarInterfaceLogin();
        }
        function comando(acao, indice = 0, urlCustom = '', tituloCustom = '') {
          const senha = obterSenha();
          const url = urlCustom || document.getElementById('url').value;
          fetch('/api/comando', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, acao, indice, url, tituloCustom })
          })
          .then(r => r.json())
          .then(d => {
            if (!d.ok) {
              alert(d.msg);
              if (d.msg.includes('Senha')) sairSessao();
            } else {
              atualizarStatus();
            }
          });
        }

        function buscarMusica() {
          const termo = document.getElementById('termo-busca').value;
          const senha = obterSenha();
          if (!termo) return alert('Digite o nome de um artista, música ou rádio!');
          document.getElementById('lista-busca').innerHTML = '<li>Buscando em Rádios, Archive.org e Audius...</li>';

          fetch('/api/buscar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, termo })
          })
          .then(r => r.json())
          .then(d => {
            if (!d.ok) {
              document.getElementById('lista-busca').innerHTML = '';
              return alert(d.msg);
            }
            if (d.resultados.length === 0) {
              document.getElementById('lista-busca').innerHTML = '<li>Nenhum resultado encontrado.</li>';
              return;
            }
            document.getElementById('lista-busca').innerHTML = d.resultados.map(item => {
              const tituloLimpo = item.titulo.replace(/'/g, "");
              return \`<li>
                <span>\${item.titulo}</span>
                <div>
                  <button onclick="comando('busca', 0, '\${item.streamUrl}', '\${tituloLimpo}')">▶ Tocar</button>
                  <button class="fav" onclick="adicionarFavorito('\${item.tipo}', '\${tituloLimpo}', '\${item.streamUrl}')">⭐</button>
                </div>
              </li>\`;
            }).join('');
          });
        }

        function tocarAleatorio() {
          const termo = document.getElementById('termo-busca').value;
          const senha = obterSenha();
          if (!termo) return alert('Digite o nome do artista primeiro!');
          fetch('/api/aleatorio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, termo })
          })
          .then(r => r.json())
          .then(d => {
            if (!d.ok) alert(d.msg);
            else atualizarStatus();
          });
        }

        let micStream = null;
        let audioCtx = null;
        let scriptNode = null;
        let controllerEnvio = null;

        async function iniciarMicAoVivo() {
          const senha = obterSenha();
          if (!senha) return alert('Desbloqueie o painel com a sua senha primeiro!');

          try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
            const destino = audioCtx.createMediaStreamDestination();

            // 1. Entrada do Microfone
            const micSource = audioCtx.createMediaStreamSource(micStream);
            const micGain = audioCtx.createGain();
            micGain.gain.value = 1.3; // Volume da sua voz
            micSource.connect(micGain);
            micGain.connect(destino);

            // 2. Música de fundo da própria rádio (se marcado)
            let audioFundo = null;
            if (document.getElementById('mic-com-musica').checked) {
              audioFundo = new Audio('/stream');
              audioFundo.crossOrigin = 'anonymous';
              const fundoSource = audioCtx.createMediaElementSource(audioFundo);
              const fundoGain = audioCtx.createGain();
              fundoGain.gain.value = 0.25; // Volume baixo da música de fundo (25%)
              fundoSource.connect(fundoGain);
              fundoGain.connect(destino);
              audioFundo.play().catch(() => {});
            }

            // 3. Codificador MP3 em tempo real
            const mp3encoder = new lamejs.Mp3Encoder(1, 44100, 128);
            const mixerSource = audioCtx.createMediaStreamSource(destino.stream);
            scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);

            const streamUpload = new ReadableStream({
              start(controller) {
                scriptNode.onaudioprocess = function(e) {
                  const input = e.inputBuffer.getChannelData(0);
                  const samples = new Int16Array(input.length);
                  for (let i = 0; i < input.length; i++) {
                    const s = Math.max(-1, Math.min(1, input[i]));
                    samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                  }
                  const mp3buf = mp3encoder.encodeBuffer(samples);
                  if (mp3buf.length > 0) {
                    controller.enqueue(new Uint8Array(mp3buf));
                  }
                };
              }
            });

            mixerSource.connect(scriptNode);
            scriptNode.connect(audioCtx.destination);

            controllerEnvio = new AbortController();
            fetch('/api/ao-vivo', {
              method: 'POST',
              headers: { 'x-senha': senha, 'Content-Type': 'audio/mpeg' },
              body: streamUpload,
              duplex: 'half',
              signal: controllerEnvio.signal
            }).catch(() => {});

            document.getElementById('btn-mic-on').classList.add('hidden');
            document.getElementById('btn-mic-off').classList.remove('hidden');
            document.getElementById('status-mic').innerText = '🔴 TRANSMITINDO AO VIVO PARA A SALA!';
            document.getElementById('status-mic').style.color = '#ff5252';
            window._audioFundoRef = audioFundo;
          } catch (err) {
            alert('Erro ao acessar microfone: ' + err.message);
          }
        }

        function pararMicAoVivo() {
          if (controllerEnvio) controllerEnvio.abort();
          if (scriptNode) scriptNode.disconnect();
          if (audioCtx) audioCtx.close();
          if (micStream) micStream.getTracks().forEach(t => t.stop());
          if (window._audioFundoRef) { window._audioFundoRef.pause(); window._audioFundoRef = null; }

          document.getElementById('btn-mic-on').classList.remove('hidden');
          document.getElementById('btn-mic-off').classList.add('hidden');
          document.getElementById('status-mic').innerText = 'Microfone desligado';
          document.getElementById('status-mic').style.color = '#bbb';
          comando('pular'); // Volta para a programação normal da rádio
        }


        function atualizarStatus() {
          fetch('/api/status').then(r => r.json()).then(st => {
            const badge = document.getElementById('st-badge');
            badge.innerText = st.online ? 'ON (AO VIVO)' : 'OFF (PAUSADA)';
            badge.className = st.online ? 'badge-on' : 'badge-off';
            document.getElementById('st-musica').innerText = st.musica;
            document.getElementById('st-ouvintes').innerText = st.ouvintes;
            document.getElementById('st-vel').innerText = st.velocidade;
            document.getElementById('st-mem').innerText = st.memoria;
            document.getElementById('st-up').innerText = st.uptime;
          });
        }

        carregarFavoritos();
        atualizarInterfaceLogin();
        atualizarStatus();
        setInterval(atualizarStatus, 4000);
      </script>
    </body>
    </html>
  `);
});

app.post('/api/buscar', async (req, res) => {
  const { senha, termo } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta! Digite a senha do DJ.' });
  const resultados = await buscarFontesOnline(termo);
  res.json({ ok: true, resultados });
});

app.post('/api/aleatorio', async (req, res) => {
  const { senha, termo } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta! Digite a senha do DJ.' });
  const resultados = await buscarFontesOnline(termo);
  if (resultados.length === 0) return res.json({ ok: false, msg: 'Nenhum resultado encontrado.' });
  const sorteada = resultados[Math.floor(Math.random() * resultados.length)];
  modoAtual = 'busca';
  urlExterna = sorteada.streamUrl;
  musicaTocando = `🎲 ${sorteada.titulo}`;
  tocarProxima();
  res.json({ ok: true, msg: `Tocando: ${sorteada.titulo}` });
});

app.post('/api/comando', (req, res) => {
  const { senha, acao, indice, url, tituloCustom } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta! Digite a senha do DJ.' });

  if (acao === 'ligar') {
    if (!radioLigada) {
      radioLigada = true;
      tocarProxima();
    }
    return res.json({ ok: true, msg: 'Rádio ligada!' });
  }
  if (acao === 'desligar') {
    radioLigada = false;
    pararStreamAtual();
    musicaTocando = 'Rádio desligada (OFF) pelo DJ';
    return res.json({ ok: true, msg: 'Rádio desligada!' });
  }
  if (acao === 'pular') {
    radioLigada = true;
    modoAtual = 'pasta';
    indiceMusica++;
    tocarProxima();
    return res.json({ ok: true, msg: 'Pulando para próxima música...' });
  }
  if (acao === 'tocar') {
    radioLigada = true;
    modoAtual = 'pasta';
    indiceMusica = indice;
    tocarProxima();
    return res.json({ ok: true, msg: 'Música selecionada!' });
  }
  if (acao === 'link' && url) {
    radioLigada = true;
    modoAtual = 'link';
    urlExterna = url.trim();
    musicaTocando = tituloCustom ? `⭐ ${tituloCustom}` : `🌐 Link: ${urlExterna}`;
    tocarProxima();
    return res.json({ ok: true, msg: 'Conectando...' });
  }
  if (acao === 'busca' && url) {
    radioLigada = true;
    modoAtual = 'busca';
    urlExterna = url.trim();
    musicaTocando = tituloCustom;
    tocarProxima();
    return res.json({ ok: true, msg: 'Tocando!' });
  }
  res.json({ ok: false, msg: 'Comando inválido.' });
});

app.listen(PORT, () => {
  console.log('Servidor rodando na porta ' + PORT);
  tocarProxima();
});

const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;

// === SUAS CONFIGURAÇÕES ===
const SENHA_DJ = "imvu123"; // <--- SUA SENHA DO PAINEL
const GITHUB_USER = "Plutaoperafk";
const GITHUB_REPO = "radio-imvu";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let ouvintes = [];
let radioLigada = true;
let modoAoVivo = false;
let modoAtual = 'pasta'; // 'pasta' ou 'radio'
let urlExterna = '';
let nomeFonteAtual = 'Pasta Local';
let musicaWinamp = 'Iniciando console...';
let statusBuffer = 'Pronto';
let indiceMusica = 0;
let streamAtivo = null;
let velocidadeAtual = '128 kbps (Estúdio)';
let ultimoDadoRecebido = Date.now();
let trocaEmAndamento = false;
const inicioServidor = Date.now();

const pastaMusicas = path.join(__dirname, 'musicas');
if (!fs.existsSync(pastaMusicas)) fs.mkdirSync(pastaMusicas);

function listarMusicas() {
  return fs.readdirSync(pastaMusicas).filter(arq => arq.toLowerCase().endsWith('.mp3'));
}

function enviarParaOuvintes(chunk) {
  if (!radioLigada || trocaEmAndamento) return;
  ouvintes.forEach(res => { try { res.write(chunk); } catch (e) {} });
}

function pararStreamAtual() {
  if (streamAtivo) {
    try { streamAtivo.destroy(); } catch (e) {}
    streamAtivo = null;
  }
}

// Vigia a cada 2s: só volta p/ MP3 se a rádio ficar 10s seguidos muda
setInterval(() => {
  if (!radioLigada || modoAoVivo || trocaEmAndamento) return;
  if (modoAtual === 'radio') {
    const semSom = Math.floor((Date.now() - ultimoDadoRecebido) / 1000);
    if (semSom >= 10) {
      statusBuffer = 'Rádio caiu (10s muda) -> Voltando p/ MP3';
      modoAtual = 'pasta';
      tocarProxima();
    } else if (semSom >= 3) {
      statusBuffer = '⏳ Oscilando (' + semSom + 's/10s)...';
    } else {
      statusBuffer = '🟢 Sinal Estável';
    }
  } else {
    statusBuffer = '🟢 Disco Local OK';
  }
}, 2000);

function iniciarComBuffer(callback) {
  pararStreamAtual();
  trocaEmAndamento = true;
  statusBuffer = '⏳ Carregando Buffer (2s)...';
  velocidadeAtual = 'Sincronizando áudio...';
  setTimeout(() => {
    trocaEmAndamento = false;
    callback();
  }, 1800);
}

function tocarProxima() {
  pararStreamAtual();
  if (modoAoVivo) return;

  if (!radioLigada) {
    nomeFonteAtual = 'Rádio Desligada';
    musicaWinamp = 'TRANSMISSÃO PAUSADA (OFF AIR)';
    statusBuffer = 'Pausado';
    return;
  }

  if (modoAtual === 'radio' && urlExterna) {
    iniciarComBuffer(() => {
      ultimoDadoRecebido = Date.now();
      velocidadeAtual = 'Rádio Online (Ao Vivo)';
      fetch(urlExterna, { headers: { 'User-Agent': 'WinampMPEG/5.0', 'Icy-MetaData': '1' } })
        .then(res => {
          if (!res.ok) throw new Error('Falha HTTP');
          const icyName = res.headers.get('icy-name');
          if (icyName && nomeFonteAtual.startsWith('🌐')) nomeFonteAtual = '📻 ' + icyName;
          musicaWinamp = 'Transmissão ao vivo da emissora';
          streamAtivo = res.body;

          res.body.on('data', chunk => {
            ultimoDadoRecebido = Date.now();
            enviarParaOuvintes(chunk);
          });
          res.body.on('end', () => {
            if (modoAtual === 'radio') {
              statusBuffer = 'Reconectando emissora...';
              setTimeout(tocarProxima, 2500);
            }
          });
          res.body.on('error', () => { statusBuffer = 'Erro no sinal da rádio...'; });
        })
        .catch(() => {
          statusBuffer = 'Rádio offline -> Indo p/ MP3';
          modoAtual = 'pasta';
          setTimeout(tocarProxima, 1500);
        });
    });
    return;
  }

  modoAtual = 'pasta';
  const lista = listarMusicas();
  if (lista.length === 0) {
    nomeFonteAtual = 'Pasta /musicas vazia';
    musicaWinamp = 'Adicione MP3s ou escolha uma Rádio';
    velocidadeAtual = 'Standby';
    setTimeout(tocarProxima, 5000);
    return;
  }

  if (indiceMusica >= lista.length) indiceMusica = 0;
  const arquivo = lista[indiceMusica];
  const caminho = path.join(pastaMusicas, arquivo);
  nomeFonteAtual = '📁 Pasta GitHub (' + (indiceMusica + 1) + '/' + lista.length + ')';
  musicaWinamp = arquivo.replace('.mp3', '');
  velocidadeAtual = '128 kbps (~24 KB/s)';

  const readStream = fs.createReadStream(caminho, { highWaterMark: 24 * 1024 });
  streamAtivo = readStream;

  readStream.on('data', chunk => {
    if (!radioLigada || modoAoVivo || modoAtual !== 'pasta') { readStream.pause(); return; }
    readStream.pause();
    enviarParaOuvintes(chunk);
    setTimeout(() => { if (!readStream.destroyed && radioLigada && !modoAoVivo && modoAtual === 'pasta') readStream.resume(); }, 850);
  });

  readStream.on('end', () => { if (modoAtual === 'pasta') { indiceMusica++; tocarProxima(); } });
  readStream.on('error', () => { if (modoAtual === 'pasta') { indiceMusica++; setTimeout(tocarProxima, 1000); } });
}
async function buscarFontesOnline(termo) {
  let resultados = [];

  try {
    const urlRadio = 'https://' + 'de1.api.' + 'radio-browser.info' + '/json/stations/search?name=' + encodeURIComponent(termo) + '&limit=6&hidebroken=true';
    const radioRes = await fetch(urlRadio, { headers: { 'User-Agent': 'RadioIMVUConsole/2.0' } });
    if (radioRes.ok) {
      const stations = await radioRes.json();
      (stations || []).filter(s => s.url_resolved).forEach(s => {
        resultados.push({ tipo: 'radio', titulo: '📻 Rádio: ' + s.name.trim(), streamUrl: s.url_resolved });
      });
    }
  } catch (e) {}

  try {
    const urlSaavn = 'https://' + 'saavn.dev' + '/api/search/songs?query=' + encodeURIComponent(termo) + '&limit=6';
    const saavnRes = await fetch(urlSaavn, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (saavnRes.ok) {
      const saavnJson = await saavnRes.json();
      const songs = saavnJson?.data?.results || [];
      songs.forEach(track => {
        const links = track.downloadUrl || [];
        const audioUrl = links[links.length - 1]?.url || links.at(0)?.url;
        const artista = track.artists?.primary?.at(0)?.name || 'Artista';
        if (audioUrl) {
          resultados.push({ tipo: 'mp3', titulo: '🎵 Completa: ' + artista + ' - ' + track.name, streamUrl: audioUrl });
        }
      });
    }
  } catch (e) {}

  try {
    const urlDeezer = 'https://' + 'api.' + 'deezer.com' + '/search?q=' + encodeURIComponent(termo) + '&limit=6';
    const deezerRes = await fetch(urlDeezer);
    if (deezerRes.ok) {
      const deezerJson = await deezerRes.json();
      (deezerJson.data || []).filter(t => t.preview).forEach(t => {
        resultados.push({ tipo: 'mp3', titulo: '🎧 Deezer: ' + t.artist.name + ' - ' + t.title, streamUrl: t.preview });
      });
    }
  } catch (e) {}

  return resultados;
}

app.get('/', (req, res) => {
  res.send(`
    <html><head><title>Rádio IMVU</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font-family:'Segoe UI',sans-serif;background:#09090b;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
    .card{background:#141419;padding:35px;border-radius:16px;max-width:450px;width:90%;text-align:center;border:1px solid #27272a;box-shadow:0 10px 30px rgba(0,0,0,0.7)}
    h1{color:#10b981;margin-top:0}p{color:#a1a1aa;line-height:1.5;font-size:14px}
    .visor{background:#18181b;border:1px solid #27272a;padding:12px;border-radius:8px;margin:15px 0}
    .btn{display:inline-block;padding:11px 20px;margin:8px 5px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}
    .btn-stream{background:#10b981;color:#000}.btn-dj{background:#27272a;color:#fff}code{background:#000;padding:3px 7px;border-radius:4px;color:#10b981}</style></head>
    <body><div class="card"><h1>📻 Rádio Web IMVU</h1>
    <div class="visor"><small style="color:#f59e0b">${nomeFonteAtual}</small><br><strong style="color:#10b981">${musicaWinamp}</strong></div>
    <audio controls src="/stream" style="width:100%;margin-bottom:10px"></audio>
    <p>Cole <code>/stream</code> na sala do IMVU ou entre no estúdio.</p>
    <a href="/stream" class="btn btn-stream">🔊 Link Direto</a><a href="/dj" class="btn btn-dj">🎛️ Console DJ</a></div></body></html>
  `);
});

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'icy-name': 'Radio IMVU Studio'
  });
  ouvintes.push(res);
  req.on('close', () => { ouvintes = ouvintes.filter(o => o !== res); });
});

app.post('/api/mic-chunk', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
  if (req.headers['x-senha'] !== SENHA_DJ) return res.status(401).end();
  if (!modoAoVivo) {
    modoAoVivo = true; radioLigada = true; pararStreamAtual();
    nomeFonteAtual = '🎙️ Locução Ao Vivo'; musicaWinamp = 'DJ FALANDO NO MICROFONE!';
  }
  if (req.body && req.body.length > 0) enviarParaOuvintes(req.body);
  res.json({ ok: true });
});

app.post('/api/mic-stop', (req, res) => {
  if (req.body.senha !== SENHA_DJ) return res.status(401).end();
  modoAoVivo = false;
  tocarProxima();
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  if (req.body.senha === SENHA_DJ) return res.json({ ok: true });
  res.json({ ok: false, msg: 'Senha de acesso incorreta!' });
});
app.get('/api/status', (req, res) => {
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (memMB > 420) process.exit(0);
  const seg = Math.floor((Date.now() - inicioServidor) / 1000);
  const min = Math.floor(seg / 60);
  const hrs = Math.floor(min / 60);
  res.json({
    online: radioLigada,
    aoVivo: modoAoVivo,
    modoAtual: modoAtual,
    fonte: nomeFonteAtual,
    musica: musicaWinamp,
    buffer: statusBuffer,
    ouvintes: ouvintes.length,
    velocidade: velocidadeAtual,
    memoria: memMB + ' MB / 512 MB',
    uptime: hrs + 'h ' + (min % 60) + 'm ' + (seg % 60) + 's',
    githubAtivo: !!GITHUB_TOKEN,
    arquivosPasta: listarMusicas()
  });
});

app.post('/api/github-upload', upload.single('arquivo'), async (req, res) => {
  if (req.body.senha !== SENHA_DJ) { if (req.file) req.file.buffer = null; return res.json({ ok: false, msg: 'Senha incorreta!' }); }
  if (!GITHUB_TOKEN) { if (req.file) req.file.buffer = null; return res.json({ ok: false, msg: 'Configure GITHUB_TOKEN no Render!' }); }
  if (!req.file) return res.json({ ok: false, msg: 'Selecione um arquivo .mp3!' });

  const nomeLimpo = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const apiUrl = 'https://' + 'api.' + 'github.com' + '/repos/' + GITHUB_USER + '/' + GITHUB_REPO + '/contents/musicas/' + nomeLimpo;
  const headersGH = { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'RadioIMVUConsole' };

  try {
    let shaExistente = undefined;
    const checkRes = await fetch(apiUrl, { headers: headersGH });
    if (checkRes.ok) { const checkData = await checkRes.json(); shaExistente = checkData.sha; }

    let conteudoBase64 = req.file.buffer.toString('base64');
    const ghRes = await fetch(apiUrl, {
      method: 'PUT', headers: headersGH,
      body: JSON.stringify({ message: 'Upload DJ: ' + nomeLimpo, content: conteudoBase64, sha: shaExistente })
    });

    const ghData = await ghRes.json();
    if (!ghRes.ok) { req.file.buffer = null; conteudoBase64 = null; return res.json({ ok: false, msg: 'GitHub recusou: ' + (ghData.message || ghRes.status) }); }

    fs.writeFileSync(path.join(pastaMusicas, nomeLimpo), req.file.buffer);
    req.file.buffer = null; conteudoBase64 = null;
    if (global.gc) global.gc();

    res.json({ ok: true, msg: 'Música salva direto no GitHub e memória limpa!' });
  } catch (e) {
    if (req.file) req.file.buffer = null;
    res.json({ ok: false, msg: 'Erro de conexão: ' + e.message });
  }
});

app.post('/api/github-delete', async (req, res) => {
  const { senha, nome } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  if (!GITHUB_TOKEN) return res.json({ ok: false, msg: 'Configure GITHUB_TOKEN no Render!' });

  const apiUrl = 'https://' + 'api.' + 'github.com' + '/repos/' + GITHUB_USER + '/' + GITHUB_REPO + '/contents/musicas/' + nome;
  const headersGH = { 'Authorization': 'Bearer ' + GITHUB_TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'RadioIMVUConsole' };

  try {
    const localPath = path.join(pastaMusicas, nome);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    const getRes = await fetch(apiUrl, { headers: headersGH });
    if (getRes.ok) {
      const fileData = await getRes.json();
      await fetch(apiUrl, { method: 'DELETE', headers: headersGH, body: JSON.stringify({ message: 'Delete DJ: ' + nome, sha: fileData.sha }) });
    }
    res.json({ ok: true, msg: 'Música removida da pasta e do GitHub!' });
  } catch (e) {
    res.json({ ok: false, msg: 'Erro ao apagar arquivo.' });
  }
});
app.get('/dj', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>Console Estúdio DJ - IMVU</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Segoe UI',system-ui,sans-serif;background:#09090b;color:#f4f4f5;height:100vh;overflow:hidden;display:flex;flex-direction:column}
      @media(max-width:1050px){body{height:auto;overflow:auto}}
      #login-screen{position:fixed;inset:0;background:radial-gradient(circle at center,#18181b 0%,#09090b 100%);display:flex;justify-content:center;align-items:center;z-index:999}
      .login-card{background:#121215;border:1px solid #27272a;padding:35px;border-radius:16px;width:90%;max-width:380px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.8)}
      .login-card h2{color:#10b981;margin-bottom:8px;font-size:22px}
      .login-card p{color:#a1a1aa;font-size:13px;margin-bottom:20px}
      input[type="password"],input[type="text"],select{width:100%;padding:10px 12px;background:#18181b;border:1px solid #3f3f46;border-radius:8px;color:#fff;font-size:13px;margin-bottom:8px;outline:none}
      input:focus,select:focus{border-color:#10b981}
      button{padding:8px 12px;border-radius:8px;border:none;font-weight:600;font-size:12px;cursor:pointer;transition:0.15s;display:inline-flex;align-items:center;gap:5px}
      .btn-primary{background:#10b981;color:#000}.btn-primary:hover{background:#059669}
      .btn-sec{background:#27272a;color:#e4e4e7}.btn-sec:hover{background:#3f3f46}
      .btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
      .btn-fav{background:#f59e0b;color:#000}
      #console-app{display:none;flex-direction:column;height:100vh}
      header{background:#121215;border-bottom:1px solid #27272a;padding:10px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
      .brand{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .on-air{padding:5px 10px;border-radius:6px;font-weight:800;font-size:11px;letter-spacing:1px;text-transform:uppercase}
      .air-on{background:#10b981;color:#000;box-shadow:0 0 12px rgba(16,185,129,0.5)}
      .air-off{background:#ef4444;color:#fff}
      .air-live{background:#f43f5e;color:#fff;animation:pulse 1.2s infinite}
      @keyframes pulse{0%{opacity:1}50%{opacity:0.5}100%{opacity:1}}
      .now-playing{background:#18181b;border:1px solid #27272a;padding:7px 14px;border-radius:8px;flex:1;max-width:480px;min-width:230px}
      .now-playing small{font-size:11px;display:block}
      .now-playing span{color:#10b981;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}
      .telemetry{display:flex;gap:12px;font-size:12px;color:#a1a1aa;align-items:center}
      .telemetry b{color:#fff}
      main{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px;padding:12px;flex:1;overflow:hidden}
      @media(max-width:1050px){main{grid-template-columns:1fr;overflow:visible}}
      .panel{background:#121215;border:1px solid #27272a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
      .tabs{display:flex;background:#18181b;border-bottom:1px solid #27272a;padding:6px;gap:5px;flex-wrap:wrap}
      .tab-btn{background:transparent;color:#a1a1aa;padding:7px 10px;border-radius:6px;font-size:12px}
      .tab-btn.active{background:#27272a;color:#10b981}
      .tab-content{padding:14px;overflow-y:auto;flex:1;display:none}
      .tab-content.active{display:block}
      ul{list-style:none}
      li{padding:8px 8px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px}
      li:hover{background:#18181b}
      .mic-bar{background:linear-gradient(90deg,#1f1215,#121215);border-bottom:1px solid #3f1d24;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
    </style></head><body>

      <div id="login-screen">
        <div class="login-card">
          <h2>🎛️ ESTÚDIO WEB DJ</h2>
          <p>Acesso restrito ao operador da rádio IMVU</p>
          <input type="password" id="login-pass" placeholder="Digite sua senha de DJ" onkeydown="if(event.key==='Enter') fazerLogin()">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#a1a1aa;margin-bottom:15px;cursor:pointer">
            <input type="checkbox" id="manter-login"> Manter conectado neste navegador
          </label>
          <button class="btn-primary" style="width:100%;justify-content:center;padding:12px" onclick="fazerLogin()">🔓 Entrar no Estúdio</button>
        </div>
      </div>
      <div id="console-app">
        <header>
          <div class="brand">
            <span id="st-badge" class="on-air air-on">ON AIR</span>
            <div>
              <button class="btn-primary" onclick="comando('ligar')">⚡ Ligar</button>
              <button class="btn-danger" onclick="comando('desligar')">⏹ Pausar</button>
              <button class="btn-sec" onclick="comando('pular')">⏭ Pular MP3</button>
              <button id="btn-troca-modo" class="btn-fav" onclick="alternarModo()">📻 Modo Rádio</button>
            </div>
          </div>

          <div class="now-playing">
            <small id="st-fonte" style="color:#f59e0b;font-weight:bold">📁 Pasta Local</small>
            <span id="st-musica">Carregando...</span>
            <small id="st-buffer" style="color:#a1a1aa;margin-top:2px">🟢 Sinal Estável</small>
          </div>

          <div class="telemetry">
            <div>👥 <b id="st-ouvintes">0</b></div>
            <div>🧠 <b id="st-mem">-</b></div>
            <div>⏱ <b id="st-up">-</b></div>
            <button class="btn-sec" style="padding:5px 10px;font-size:11px" onclick="sair()">🔒 Sair</button>
          </div>
        </header>

        <div class="mic-bar">
          <div style="display:flex;align-items:center;gap:10px">
            <strong>🎙️ Locução:</strong>
            <span id="mic-status" style="font-size:12px;color:#a1a1aa">Microfone em espera</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:12px;color:#d4d4d8;cursor:pointer"><input type="checkbox" id="mic-fundo" checked> Fundo musical (25%)</label>
            <button id="btn-mic-start" class="btn-danger" onclick="iniciarMic()">🎙️ Entrar Ao Vivo</button>
            <button id="btn-mic-stop" class="btn-sec" style="display:none" onclick="pararMic()">⏹ Encerrar Voz</button>
          </div>
        </div>

        <main>
          <!-- COLUNA 1: BUSCA, LINK E UPLOAD -->
          <div class="panel">
            <div class="tabs">
              <button class="tab-btn active" onclick="abrirAba('col1','tab-busca',this)">🔎 Buscar</button>
              <button class="tab-btn" onclick="abrirAba('col1','tab-link',this)">🌐 Link</button>
              <button class="tab-btn" onclick="abrirAba('col1','tab-upload',this)">📤 Subir MP3</button>
            </div>
            <div id="tab-busca" class="tab-content active col1">
              <div style="display:flex;gap:6px;margin-bottom:10px">
                <input type="text" id="termo-busca" placeholder="Artista, música ou rádio..." style="margin:0" onkeydown="if(event.key==='Enter') buscarMusica()">
                <button class="btn-primary" onclick="buscarMusica()">Buscar</button>
                <button class="btn-sec" onclick="tocarAleatorio()">🎲</button>
              </div>
              <ul id="lista-busca"></ul>
            </div>
            <div id="tab-link" class="tab-content col1">
              <input type="text" id="nome-link" placeholder="Nome da Rádio ou Música">
              <input type="text" id="genero-link" placeholder="Gênero (Ex: Rock, Pagode, Mix)">
              <input type="text" id="url" placeholder="Cole o link http://... ou https://...">
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
                <button class="btn-primary" onclick="comando('link')">▶ Tocar</button>
                <button class="btn-fav" onclick="adicionarFavorito('radio')">⭐ Rádio</button>
                <button class="btn-fav" onclick="adicionarFavorito('mp3')">⭐ MP3</button>
              </div>
            </div>
            <div id="tab-upload" class="tab-content col1">
              <div id="aviso-token" style="background:#271a1a;border:1px solid #ef4444;padding:8px;border-radius:8px;font-size:12px;color:#fca5a5;margin-bottom:10px;display:none">⚠️ Configure <b>GITHUB_TOKEN</b> no Render.</div>
              <input type="file" id="arquivo-mp3" accept=".mp3,audio/mpeg" style="margin-bottom:10px;color:#ccc">
              <button class="btn-primary" id="btn-enviar-gh" onclick="enviarArquivoGitHub()">📤 Enviar MP3 p/ GitHub</button>
            </div>
          </div>

          <!-- COLUNA 2: PASTA GITHUB SEMPRE VISÍVEL -->
          <div class="panel">
            <div class="tabs"><button class="tab-btn active" style="cursor:default">📁 Pasta GitHub (MP3s)</button></div>
            <div class="tab-content active"><ul id="lista-pasta"></ul></div>
          </div>

          <!-- COLUNA 3: RÁDIOS POR GÊNERO + LINKS MP3 + DICAS -->
          <div class="panel">
            <div class="tabs">
              <button class="tab-btn active" onclick="abrirAba('col3','tab-radios',this)">📻 Rádios</button>
              <button class="tab-btn" onclick="abrirAba('col3','tab-mp3s',this)">🎵 MP3s</button>
              <button class="tab-btn" onclick="abrirAba('col3','tab-dicas',this)">💡 Dicas</button>
            </div>
            <div id="tab-radios" class="tab-content active col3">
              <select id="filtro-genero" onchange="carregarFavoritos()">
                <option value="TODOS">📂 Todos os Gêneros</option>
              </select>
              <ul id="lista-radios"></ul>
            </div>
            <div id="tab-mp3s" class="tab-content col3"><ul id="lista-mp3s"></ul></div>
            <div id="tab-dicas" class="tab-content col3">
              <ul style="font-size:12px;color:#d4d4d8;line-height:1.6">
                <li style="display:block"><strong>1. Rádios 24h:</strong> Busque em <code>radio-browser.info</code> e copie a URL do stream.</li>
                <li style="display:block"><strong>2. MP3 Grátis:</strong> Em <code>archive.org</code>, clique em <b>VBR MP3</b> -> botão direito -> <b>Copiar link</b>.</li>
                <li style="display:block"><strong>3. Hospedagem Rápida:</strong> Suba um MP3 em <code>catbox.moe</code> para gerar link direto.</li>
              </ul>
            </div>
          </div>
        </main>
      </div>
      <script>
        const radiosPadrao = [
          { nome: 'Rock Antenne Heavy Metal', genero: 'Rock', url: 'http://' + 'stream.rockantenne.de' + '/heavy-metal/stream/mp3' },
          { nome: 'Radio Paradise (Mix/Rock)', genero: 'Mix', url: 'http://' + '://radioparadise.com' + '/mp3-128' }
        ];
        let modoNoServidor = 'pasta';

        function obterSenha() { return localStorage.getItem('dj_senha') || sessionStorage.getItem('dj_senha') || ''; }
        function fazerLogin() {
          const senha = document.getElementById('login-pass').value;
          if (!senha) return alert('Digite a senha!');
          fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha }) })
            .then(r => r.json()).then(d => {
              if (!d.ok) return alert(d.msg);
              if (document.getElementById('manter-login').checked) localStorage.setItem('dj_senha', senha);
              else sessionStorage.setItem('dj_senha', senha);
              verificarSessao();
            });
        }
        function verificarSessao() {
          const s = obterSenha();
          document.getElementById('login-screen').style.display = s ? 'none' : 'flex';
          document.getElementById('console-app').style.display = s ? 'flex' : 'none';
          if (s) { carregarFavoritos(); atualizarStatus(); }
        }
        function sair() { localStorage.removeItem('dj_senha'); sessionStorage.removeItem('dj_senha'); verificarSessao(); }
        function abrirAba(grupo, idAba, btn) {
          document.querySelectorAll('.' + grupo).forEach(el => el.classList.remove('active'));
          btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById(idAba).classList.add('active');
          btn.classList.add('active');
        }
        function copiarLink(url) {
          navigator.clipboard.writeText(url).then(() => alert('Link da rádio copiado!'));
        }
        function alternarModo() {
          if (modoNoServidor === 'pasta') comando('modo_radio');
          else comando('modo_pasta');
        }
        function carregarFavoritos() {
          const radios = JSON.parse(localStorage.getItem('fav_radios') || JSON.stringify(radiosPadrao));
          const mp3s = JSON.parse(localStorage.getItem('fav_mp3s') || '[]');

          const select = document.getElementById('filtro-genero');
          const atual = select.value || 'TODOS';
          const generos = ['TODOS', ...new Set(radios.map(r => r.genero || 'Geral'))];
          select.innerHTML = generos.map(g => '<option value="'+g+'" '+(g===atual?'selected':'')+'>'+(g==='TODOS'?'📂 Todos os Gêneros':'🎵 '+g)+'</option>').join('');

          const filtradas = atual === 'TODOS' ? radios : radios.filter(r => (r.genero || 'Geral') === atual);
          document.getElementById('lista-radios').innerHTML = filtradas.map((item) => {
            const realIdx = radios.indexOf(item);
            const t = item.nome.replace(/'/g,"");
            return '<li><span><b>['+(item.genero||'Geral')+']</b> '+item.nome+'</span><div style="display:flex;gap:3px"><button class="btn-primary" onclick="comando(\\'link\\',0,\\''+item.url+'\\',\\''+t+'\\')">▶</button><button class="btn-sec" title="Copiar Link" onclick="copiarLink(\\''+item.url+'\\')">📋</button><button class="btn-danger" onclick="removerFavorito(\\'radio\\','+realIdx+')">X</button></div></li>';
          }).join('') || '<li>Nenhuma rádio neste gênero.</li>';

          document.getElementById('lista-mp3s').innerHTML = mp3s.map((item, idx) =>
            '<li><span>'+item.nome+'</span><div style="display:flex;gap:3px"><button class="btn-primary" onclick="comando(\\'link\\',0,\\''+item.url+'\\',\\''+item.nome.replace(/'/g,"")+'\\')">▶</button><button class="btn-sec" onclick="copiarLink(\\''+item.url+'\\')">📋</button><button class="btn-danger" onclick="removerFavorito(\\'mp3\\','+idx+')">X</button></div></li>'
          ).join('') || '<li>Nenhum link MP3 salvo.</li>';
        }
        function adicionarFavorito(tipo, nomeCustom = '', urlCustom = '') {
          const nome = nomeCustom || document.getElementById('nome-link').value.trim();
          const url = urlCustom || document.getElementById('url').value.trim();
          const genero = (document.getElementById('genero-link')?.value || '').trim() || 'Geral';
          if (!nome || !url) return alert('Preencha o Nome e o Link!');
          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const atual = JSON.parse(localStorage.getItem(chave) || (tipo === 'radio' ? JSON.stringify(radiosPadrao) : '[]'));
          atual.push({ nome, url, genero });
          localStorage.setItem(chave, JSON.stringify(atual));
          carregarFavoritos();
          if (!nomeCustom) { document.getElementById('nome-link').value = ''; document.getElementById('url').value = ''; }
          alert('Salvo na lista!');
        }
        function removerFavorito(tipo, idx) {
          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const atual = JSON.parse(localStorage.getItem(chave) || (tipo === 'radio' ? JSON.stringify(radiosPadrao) : '[]'));
          atual.splice(idx, 1);
          localStorage.setItem(chave, JSON.stringify(atual));
          carregarFavoritos();
        }
        function comando(acao, indice = 0, urlCustom = '', tituloCustom = '') {
          const senha = obterSenha();
          const url = urlCustom || document.getElementById('url').value;
          fetch('/api/comando', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha, acao, indice, url, tituloCustom }) })
            .then(r => r.json()).then(d => { if (!d.ok) { alert(d.msg); if (d.msg.includes('Senha')) sair(); } else atualizarStatus(); });
        }
        function buscarMusica() {
          const termo = document.getElementById('termo-busca').value;
          const senha = obterSenha();
          if (!termo) return alert('Digite um artista ou música!');
          document.getElementById('lista-busca').innerHTML = '<li>Buscando em Rádios, Saavn e Deezer...</li>';
          fetch('/api/buscar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha, termo }) })
            .then(r => r.json()).then(d => {
              if (!d.ok) { document.getElementById('lista-busca').innerHTML = ''; return alert(d.msg); }
              if (d.resultados.length === 0) { document.getElementById('lista-busca').innerHTML = '<li>Nenhum resultado encontrado.</li>'; return; }
              document.getElementById('lista-busca').innerHTML = d.resultados.map(item => {
                const t = item.titulo.replace(/'/g, "");
                return '<li><span>'+item.titulo+'</span><div style="display:flex;gap:3px"><button class="btn-primary" onclick="comando(\\'busca\\',0,\\''+item.streamUrl+'\\',\\''+t+'\\')">▶</button><button class="btn-fav" onclick="adicionarFavorito(\\''+item.tipo+'\\',\\''+t+'\\',\\''+item.streamUrl+'\\')">⭐</button></div></li>';
              }).join('');
            });
        }
        function tocarAleatorio() {
          const termo = document.getElementById('termo-busca').value;
          const senha = obterSenha();
          if (!termo) return alert('Digite o artista!');
          fetch('/api/aleatorio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha, termo }) })
            .then(r => r.json()).then(d => { if (!d.ok) alert(d.msg); else atualizarStatus(); });
        }
        function enviarArquivoGitHub() {
          const input = document.getElementById('arquivo-mp3');
          const arquivoSelecionado = input.files ? input.files.item(0) : null;
          if (!arquivoSelecionado) return alert('Escolha um arquivo .mp3 primeiro!');
          const formData = new FormData();
          formData.append('senha', obterSenha());
          formData.append('arquivo', arquivoSelecionado);
          const btn = document.getElementById('btn-enviar-gh');
          btn.disabled = true; btn.innerText = 'Enviando...';
          fetch('/api/github-upload', { method: 'POST', body: formData })
            .then(r => r.json()).then(d => {
              btn.disabled = false; btn.innerText = '📤 Enviar MP3 p/ GitHub';
              alert(d.msg);
              if (d.ok) { input.value = ''; atualizarStatus(); }
            }).catch(() => { btn.disabled = false; btn.innerText = '📤 Enviar MP3 p/ GitHub'; });
        }
        function apagarArquivoGitHub(nome) {
          if (!confirm('Apagar "' + nome + '" da pasta e do GitHub?')) return;
          fetch('/api/github-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: obterSenha(), nome }) })
            .then(r => r.json()).then(d => { alert(d.msg); atualizarStatus(); });
        }
        let micStream = null, mediaRecorder = null, audioCtx = null, audioFundo = null;
        async function iniciarMic() {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const destino = audioCtx.createMediaStreamDestination();
            const micSrc = audioCtx.createMediaStreamSource(micStream);
            const micGain = audioCtx.createGain(); micGain.gain.value = 1.4;
            micSrc.connect(micGain); micGain.connect(destino);
            if (document.getElementById('mic-fundo').checked) {
              audioFundo = new Audio('/stream'); audioFundo.crossOrigin = 'anonymous';
              const fundoSrc = audioCtx.createMediaElementSource(audioFundo);
              const fundoGain = audioCtx.createGain(); fundoGain.gain.value = 0.25;
              fundoSrc.connect(fundoGain); fundoGain.connect(destino);
              audioFundo.play().catch(() => {});
            }
            mediaRecorder = new MediaRecorder(destino.stream);
            mediaRecorder.ondataavailable = async (e) => {
              if (e.data && e.data.size > 0) {
                fetch('/api/mic-chunk', { method: 'POST', headers: { 'x-senha': obterSenha() }, body: e.data }).catch(() => {});
              }
            };
            mediaRecorder.start(1000);
            document.getElementById('btn-mic-start').style.display = 'none';
            document.getElementById('btn-mic-stop').style.display = 'inline-flex';
            document.getElementById('mic-status').innerText = '🔴 TRANSMITINDO AO VIVO!';
            document.getElementById('mic-status').style.color = '#f43f5e';
          } catch (err) { alert('Permita o microfone no navegador: ' + err.message); }
        }
        function pararMic() {
          if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
          if (micStream) micStream.getTracks().forEach(t => t.stop());
          if (audioFundo) { audioFundo.pause(); audioFundo = null; }
          if (audioCtx) audioCtx.close();
          fetch('/api/mic-stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ senha: obterSenha() }) }).then(() => atualizarStatus());
          document.getElementById('btn-mic-start').style.display = 'inline-flex';
          document.getElementById('btn-mic-stop').style.display = 'none';
          document.getElementById('mic-status').innerText = 'Microfone em espera';
          document.getElementById('mic-status').style.color = '#a1a1aa';
        }
        function atualizarStatus() {
          if (!obterSenha()) return;
          fetch('/api/status').then(r => r.json()).then(st => {
            const b = document.getElementById('st-badge');
            if (st.aoVivo) { b.innerText = 'MIC AO VIVO'; b.className = 'on-air air-live'; }
            else if (st.online) { b.innerText = 'ON AIR'; b.className = 'on-air air-on'; }
            else { b.innerText = 'OFF AIR'; b.className = 'on-air air-off'; }
            modoNoServidor = st.modoAtual || 'pasta';
            document.getElementById('btn-troca-modo').innerText = modoNoServidor === 'pasta' ? '📻 Modo Rádio' : '📁 Modo MP3';
            document.getElementById('st-fonte').innerText = st.fonte || 'Rádio IMVU';
            document.getElementById('st-musica').innerText = st.musica || '';
            document.getElementById('st-buffer').innerText = st.buffer || '';
            document.getElementById('st-ouvintes').innerText = st.ouvintes;
            document.getElementById('st-mem').innerText = st.memoria;
            document.getElementById('st-up').innerText = st.uptime;
            document.getElementById('aviso-token').style.display = st.githubAtivo ? 'none' : 'block';
            document.getElementById('lista-pasta').innerHTML = (st.arquivosPasta || []).map((arq, i) =>
              '<li><span>📁 '+arq+'</span><div style="display:flex;gap:4px"><button class="btn-primary" onclick="comando(\\'tocar\\','+i+')">▶</button><button class="btn-danger" onclick="apagarArquivoGitHub(\\''+arq+'\\')">🗑️</button></div></li>'
            ).join('') || '<li>Nenhuma música .mp3 na pasta.</li>';
          });
        }
        verificarSessao(); setInterval(atualizarStatus, 4000);
      </script></body></html>
  `);
});

app.post('/api/buscar', async (req, res) => {
  if (req.body.senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  res.json({ ok: true, resultados: await buscarFontesOnline(req.body.termo) });
});

app.post('/api/aleatorio', async (req, res) => {
  if (req.body.senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  const resultados = await buscarFontesOnline(req.body.termo);
  if (resultados.length === 0) return res.json({ ok: false, msg: 'Nenhum resultado encontrado.' });
  const s = resultados[Math.floor(Math.random() * resultados.length)];
  modoAtual = 'radio'; urlExterna = s.streamUrl; nomeFonteAtual = s.titulo; musicaWinamp = 'Conectando...';
  tocarProxima();
  res.json({ ok: true, msg: `Tocando: ${s.titulo}` });
});

app.post('/api/comando', (req, res) => {
  const { senha, acao, indice, url, tituloCustom } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  if (acao === 'ligar') { if (!radioLigada) { radioLigada = true; tocarProxima(); } return res.json({ ok: true }); }
  if (acao === 'desligar') { radioLigada = false; pararStreamAtual(); nomeFonteAtual = 'Desligada'; musicaWinamp = 'TRANSMISSÃO PAUSADA'; return res.json({ ok: true }); }
  if (acao === 'modo_pasta') { radioLigada = true; modoAtual = 'pasta'; iniciarComBuffer(tocarProxima); return res.json({ ok: true }); }
  if (acao === 'modo_radio' && urlExterna) { radioLigada = true; modoAtual = 'radio'; tocarProxima(); return res.json({ ok: true }); }
  if (acao === 'pular') { radioLigada = true; modoAtual = 'pasta'; indiceMusica++; iniciarComBuffer(tocarProxima); return res.json({ ok: true }); }
  if (acao === 'tocar') { radioLigada = true; modoAtual = 'pasta'; indiceMusica = indice; iniciarComBuffer(tocarProxima); return res.json({ ok: true }); }
  if ((acao === 'link' || acao === 'busca') && url) {
    radioLigada = true; modoAtual = 'radio'; urlExterna = url.trim();
    nomeFonteAtual = tituloCustom || '🌐 Rádio Externa'; musicaWinamp = 'Conectando stream...';
    tocarProxima(); return res.json({ ok: true });
  }
  res.json({ ok: false, msg: 'Comando inválido.' });
});

setInterval(() => { if (Math.round(process.memoryUsage().rss / 1024 / 1024) > 420) process.exit(0); }, 30000);
app.listen(PORT, () => { console.log('Console Web DJ 3.0 rodando na porta ' + PORT); tocarProxima(); });

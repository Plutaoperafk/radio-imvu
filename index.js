const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;

// === SUAS CONFIGURAÇÕES ===
const SENHA_DJ = "imvu123"; // <--- TROQUE SUA SENHA AQUI
const GITHUB_USER = "Plutaoperafk"; // Seu usuário do GitHub
const GITHUB_REPO = "radio-imvu";   // Nome do seu repositório
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ""; // Pega automaticamente do Render Environment

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let ouvintes = [];
let radioLigada = true;
let modoAoVivo = false;
let modoAtual = 'pasta';
let urlExterna = '';
let indiceMusica = 0;
let musicaTocando = 'Iniciando console de rádio...';
let streamAtivo = null;
let velocidadeAtual = '128 kbps (Estúdio)';
const inicioServidor = Date.now();

const pastaMusicas = path.join(__dirname, 'musicas');
if (!fs.existsSync(pastaMusicas)) fs.mkdirSync(pastaMusicas);

function listarMusicas() {
  return fs.readdirSync(pastaMusicas).filter(arq => arq.toLowerCase().endsWith('.mp3'));
}

function enviarParaOuvintes(chunk) {
  if (!radioLigada) return;
  ouvintes.forEach(res => { try { res.write(chunk); } catch (e) {} });
}

function pararStreamAtual() {
  if (streamAtivo) {
    try { streamAtivo.destroy(); } catch (e) {}
    streamAtivo = null;
  }
}

function tocarProxima() {
  pararStreamAtual();
  if (modoAoVivo) return;

  if (!radioLigada) {
    musicaTocando = 'TRANSMISSÃO PAUSADA (OFF AIR)';
    return;
  }

  if ((modoAtual === 'link' || modoAtual === 'busca') && urlExterna) {
    velocidadeAtual = 'Stream Externo / API Direta';
    fetch(urlExterna, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      .then(res => {
        if (!res.ok) throw new Error('Falha no link');
        streamAtivo = res.body;
        res.body.on('data', chunk => enviarParaOuvintes(chunk));
        res.body.on('end', () => { modoAtual = 'pasta'; tocarProxima(); });
        res.body.on('error', () => { modoAtual = 'pasta'; setTimeout(tocarProxima, 2000); });
      })
      .catch(() => {
        musicaTocando = 'Falha no link externo, retornando à pasta...';
        modoAtual = 'pasta';
        setTimeout(tocarProxima, 2000);
      });
    return;
  }

  const lista = listarMusicas();
  if (lista.length === 0) {
    musicaTocando = 'Pasta /musicas vazia. Use a Busca ou suas Listas Salvas!';
    velocidadeAtual = 'Standby';
    setTimeout(tocarProxima, 5000);
    return;
  }

  if (indiceMusica >= lista.length) indiceMusica = 0;
  const arquivo = lista[indiceMusica];
  const caminho = path.join(pastaMusicas, arquivo);
  musicaTocando = `📁 ${arquivo}`;
  velocidadeAtual = '128 kbps (~16 KB/s)';

  const readStream = fs.createReadStream(caminho, { highWaterMark: 24 * 1024 });
  streamAtivo = readStream;

  readStream.on('data', chunk => {
    if (!radioLigada || modoAoVivo) { readStream.pause(); return; }
    readStream.pause();
    enviarParaOuvintes(chunk);
    setTimeout(() => { if (!readStream.destroyed && radioLigada && !modoAoVivo) readStream.resume(); }, 850);
  });

  readStream.on('end', () => { indiceMusica++; tocarProxima(); });
  readStream.on('error', () => { indiceMusica++; setTimeout(tocarProxima, 1000); });
}
async function buscarFontesOnline(termo) {
  let resultados = [];

  try {
    const urlRadio = 'https://radio-browser.info' + encodeURIComponent(termo) + '&limit=6&hidebroken=true';
    const radioRes = await fetch(urlRadio, { headers: { 'User-Agent': 'RadioIMVUConsole/2.0' } });
    if (radioRes.ok) {
      const stations = await radioRes.json();
      (stations || []).filter(s => s.url_resolved).forEach(s => {
        resultados.push({
          tipo: 'radio',
          titulo: '📻 Rádio: ' + s.name.trim(),
          streamUrl: s.url_resolved
        });
      });
    }
  } catch (e) {}

  try {
    const urlSaavn = 'https://saavn.dev' + encodeURIComponent(termo) + '&limit=6';
    const saavnRes = await fetch(urlSaavn, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (saavnRes.ok) {
      const saavnJson = await saavnRes.json();
      const songs = saavnJson?.data?.results || [];
      songs.forEach(track => {
        const links = track.downloadUrl || [];
        const audioUrl = links[links.length - 1]?.url || links.at(0)?.url;
        const artista = track.artists?.primary?.at(0)?.name || 'Artista';
        if (audioUrl) {
          resultados.push({
            tipo: 'mp3',
            titulo: '🎵 Completa: ' + artista + ' - ' + track.name,
            streamUrl: audioUrl
          });
        }
      });
    }
  } catch (e) {}

  try {
    const urlDeezer = 'https://deezer.com' + encodeURIComponent(termo) + '&limit=6';
    const deezerRes = await fetch(urlDeezer);
    if (deezerRes.ok) {
      const deezerJson = await deezerRes.json();
      (deezerJson.data || []).filter(t => t.preview).forEach(t => {
        resultados.push({
          tipo: 'mp3',
          titulo: '🎧 Deezer: ' + t.artist.name + ' - ' + t.title,
          streamUrl: t.preview
        });
      });
    }
  } catch (e) {}

  return resultados;
}


app.get('/', (req, res) => {
  res.send(`
    <html><head><title>Rádio IMVU</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font-family:'Segoe UI',sans-serif;background:#09090b;color:#fff;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
    .card{background:#141419;padding:35px;border-radius:16px;max-width:440px;text-align:center;border:1px solid #27272a;box-shadow:0 10px 30px rgba(0,0,0,0.7)}
    h1{color:#10b981;margin-top:0}p{color:#a1a1aa;line-height:1.5}
    .btn{display:inline-block;padding:12px 22px;margin:10px 6px;border-radius:8px;text-decoration:none;font-weight:600;transition:0.2s}
    .btn-stream{background:#10b981;color:#000}.btn-dj{background:#27272a;color:#fff}code{background:#000;padding:3px 7px;border-radius:4px;color:#10b981}</style></head>
    <body><div class="card"><h1>📻 Rádio Web IMVU</h1>
    <p>Servidor de streaming ativo.<br>Cole <code>/stream</code> na sala do IMVU ou entre no estúdio.</p>
    <a href="/stream" class="btn btn-stream">🔊 Ouvir Stream</a><a href="/dj" class="btn btn-dj">🎛️ Abrir Console DJ</a></div></body></html>
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
  const senha = req.headers['x-senha'];
  if (senha !== SENHA_DJ) return res.status(401).end();

  if (!modoAoVivo) {
    modoAoVivo = true;
    radioLigada = true;
    pararStreamAtual();
    musicaTocando = '🎙️ LOCUTOR AO VIVO NO MICROFONE!';
    velocidadeAtual = 'Transmissão Mic Estúdio';
  }
  if (req.body && req.body.length > 0) {
    enviarParaOuvintes(req.body);
  }
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
    musica: musicaTocando,
    ouvintes: ouvintes.length,
    velocidade: velocidadeAtual,
    memoria: memMB + ' MB / 512 MB',
    uptime: hrs + 'h ' + (min % 60) + 'm ' + (seg % 60) + 's',
    githubAtivo: !!GITHUB_TOKEN,
    arquivosPasta: listarMusicas()
  });
});

app.post('/api/github-upload', upload.single('arquivo'), async (req, res) => {
  if (req.body.senha !== SENHA_DJ) {
    if (req.file) req.file.buffer = null;
    return res.json({ ok: false, msg: 'Senha incorreta!' });
  }
  if (!GITHUB_TOKEN) {
    if (req.file) req.file.buffer = null;
    return res.json({ ok: false, msg: 'Configure a variável GITHUB_TOKEN no Render primeiro!' });
  }
  if (!req.file) return res.json({ ok: false, msg: 'Selecione um arquivo .mp3!' });

  const nomeLimpo = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const apiUrl = 'https://github.com' + GITHUB_USER + '/' + GITHUB_REPO + '/contents/musicas/' + nomeLimpo;
  const headersGH = {
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'RadioIMVUConsole'
  };

  try {
    let shaExistente = undefined;
    const checkRes = await fetch(apiUrl, { headers: headersGH });
    if (checkRes.ok) {
      const checkData = await checkRes.json();
      shaExistente = checkData.sha;
    }

    let conteudoBase64 = req.file.buffer.toString('base64');
    const ghRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: headersGH,
      body: JSON.stringify({
        message: 'Upload DJ: ' + nomeLimpo,
        content: conteudoBase64,
        sha: shaExistente
      })
    });

    const ghData = await ghRes.json();
    if (!ghRes.ok) {
      req.file.buffer = null;
      conteudoBase64 = null;
      return res.json({ ok: false, msg: 'GitHub recusou: ' + (ghData.message || ghRes.status) });
    }

    fs.writeFileSync(path.join(pastaMusicas, nomeLimpo), req.file.buffer);
    req.file.buffer = null;
    conteudoBase64 = null;
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

  const apiUrl = 'https://github.com' + GITHUB_USER + '/' + GITHUB_REPO + '/contents/musicas/' + nome;
  const headersGH = {
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
    'Content-Type': 'application/json',
    'User-Agent': 'RadioIMVUConsole'
  };

  try {
    const localPath = path.join(pastaMusicas, nome);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    const getRes = await fetch(apiUrl, { headers: headersGH });
    if (getRes.ok) {
      const fileData = await getRes.json();
      await fetch(apiUrl, {
        method: 'DELETE',
        headers: headersGH,
        body: JSON.stringify({ message: 'Delete DJ: ' + nome, sha: fileData.sha })
      });
    }
    res.json({ ok: true, msg: 'Música removida da pasta e do GitHub!' });
  } catch (e) {
    res.json({ ok: false, msg: 'Erro ao apagar arquivo.' });
  }
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
    musica: musicaTocando,
    ouvintes: ouvintes.length,
    velocidade: velocidadeAtual,
    memoria: `${memMB} MB / 512 MB`,
    uptime: `${hrs}h ${min % 60}m ${seg % 60}s`,
    githubAtivo: !!GITHUB_TOKEN,
    arquivosPasta: listarMusicas()
  });
});

app.post('/api/github-upload', upload.single('arquivo'), async (req, res) => {
  if (req.body.senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  if (!GITHUB_TOKEN) return res.json({ ok: false, msg: 'Configure a variável GITHUB_TOKEN no Render primeiro!' });
  if (!req.file) return res.json({ ok: false, msg: 'Selecione um arquivo .mp3!' });

  const nomeLimpo = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const conteudoBase64 = req.file.buffer.toString('base64');
  const apiUrl = `https://github.com{GITHUB_USER}/${GITHUB_REPO}/contents/musicas/${nomeLimpo}`;

  try {
    fs.writeFileSync(path.join(pastaMusicas, nomeLimpo), req.file.buffer);
    const ghRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'RadioIMVUConsole'
      },
      body: JSON.stringify({ message: `Upload DJ: ${nomeLimpo}`, content: conteudoBase64 })
    });

    if (!ghRes.ok) {
      const err = await ghRes.json();
      return res.json({ ok: false, msg: 'Erro GitHub: ' + (err.message || 'Falha ao salvar') });
    }
    res.json({ ok: true, msg: 'Música salva na pasta e no GitHub com sucesso!' });
  } catch (e) {
    res.json({ ok: false, msg: 'Erro de conexão com GitHub.' });
  }
});

app.post('/api/github-delete', async (req, res) => {
  const { senha, nome } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  if (!GITHUB_TOKEN) return res.json({ ok: false, msg: 'Configure GITHUB_TOKEN no Render!' });

  const apiUrl = `https://github.com{GITHUB_USER}/${GITHUB_REPO}/contents/musicas/${nome}`;
  try {
    const localPath = path.join(pastaMusicas, nome);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);

    const getRes = await fetch(apiUrl, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'RadioIMVUConsole' }
    });
    if (getRes.ok) {
      const fileData = await getRes.json();
      await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'RadioIMVUConsole'
        },
        body: JSON.stringify({ message: `Delete DJ: ${nome}`, sha: fileData.sha })
      });
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
      @media(max-width:850px){body{height:auto;overflow:auto}}

      #login-screen{position:fixed;inset:0;background:radial-gradient(circle at center,#18181b 0%,#09090b 100%);display:flex;justify-content:center;align-items:center;z-index:999}
      .login-card{background:#121215;border:1px solid #27272a;padding:35px;border-radius:16px;width:90%;max-width:380px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.8)}
      .login-card h2{color:#10b981;margin-bottom:8px;font-size:22px}
      .login-card p{color:#a1a1aa;font-size:13px;margin-bottom:20px}
      input[type="password"],input[type="text"]{width:100%;padding:11px 14px;background:#18181b;border:1px solid #3f3f46;border-radius:8px;color:#fff;font-size:14px;margin-bottom:10px;outline:none}
      input:focus{border-color:#10b981}

      button{padding:9px 14px;border-radius:8px;border:none;font-weight:600;font-size:13px;cursor:pointer;transition:0.15s;display:inline-flex;align-items:center;gap:6px}
      .btn-primary{background:#10b981;color:#000}.btn-primary:hover{background:#059669}
      .btn-sec{background:#27272a;color:#e4e4e7}.btn-sec:hover{background:#3f3f46}
      .btn-danger{background:#ef4444;color:#fff}.btn-danger:hover{background:#dc2626}
      .btn-fav{background:#f59e0b;color:#000}

      #console-app{display:none;flex-direction:column;height:100vh}
      header{background:#121215;border-bottom:1px solid #27272a;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
      .brand{display:flex;align-items:center;gap:12px}
      .on-air{padding:5px 12px;border-radius:6px;font-weight:800;font-size:12px;letter-spacing:1px;text-transform:uppercase}
      .air-on{background:#10b981;color:#000;box-shadow:0 0 12px rgba(16,185,129,0.5)}
      .air-off{background:#ef4444;color:#fff}
      .air-live{background:#f43f5e;color:#fff;animation:pulse 1.2s infinite}
      @keyframes pulse{0%{opacity:1}50%{opacity:0.5}100%{opacity:1}}

      .now-playing{background:#18181b;border:1px solid #27272a;padding:8px 16px;border-radius:8px;flex:1;max-width:500px;min-width:240px}
      .now-playing small{color:#a1a1aa;font-size:11px;display:block;text-transform:uppercase}
      .now-playing span{color:#10b981;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}

      .telemetry{display:flex;gap:15px;font-size:12px;color:#a1a1aa}
      .telemetry b{color:#fff}

      main{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;flex:1;overflow:hidden}
      @media(max-width:850px){main{grid-template-columns:1fr;overflow:visible}}
      .panel{background:#121215;border:1px solid #27272a;border-radius:12px;display:flex;flex-direction:column;overflow:hidden}
      .tabs{display:flex;background:#18181b;border-bottom:1px solid #27272a;padding:6px;gap:6px;flex-wrap:wrap}
      .tab-btn{background:transparent;color:#a1a1aa;padding:8px 12px;border-radius:6px;font-size:12px}
      .tab-btn.active{background:#27272a;color:#10b981}
      .tab-content{padding:16px;overflow-y:auto;flex:1;display:none}
      .tab-content.active{display:block}

      ul{list-style:none}
      li{padding:9px 10px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
      li:hover{background:#18181b}
      .mic-bar{background:linear-gradient(90deg,#1f1215,#121215);border-bottom:1px solid #3f1d24;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
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
              <button class="btn-sec" onclick="comando('pular')">⏭ Pular</button>
            </div>
          </div>

          <div class="now-playing">
            <small>No Ar Agora</small>
            <span id="st-musica">Carregando...</span>
          </div>

          <div class="telemetry">
            <div>👥 Ouvintes: <b id="st-ouvintes">0</b></div>
            <div>🚀 Taxa: <b id="st-vel">128kbps</b></div>
            <div>🧠 RAM: <b id="st-mem">-</b></div>
            <div>⏱ Uptime: <b id="st-up">-</b></div>
            <button class="btn-sec" style="padding:5px 10px;font-size:11px" onclick="sair()">🔒 Sair</button>
          </div>
        </header>

        <div class="mic-bar">
          <div style="display:flex;align-items:center;gap:10px">
            <strong>🎙️ Mesa de Locução:</strong>
            <span id="mic-status" style="font-size:12px;color:#a1a1aa">Microfone em espera</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:12px;color:#d4d4d8;cursor:pointer"><input type="checkbox" id="mic-fundo" checked> Música de fundo (25%)</label>
            <button id="btn-mic-start" class="btn-danger" onclick="iniciarMic()">🎙️ Entrar Ao Vivo</button>
            <button id="btn-mic-stop" class="btn-sec" style="display:none" onclick="pararMic()">⏹ Encerrar Voz</button>
          </div>
        </div>

        <main>
          <div class="panel">
            <div class="tabs">
              <button class="tab-btn active" onclick="abrirAba('esq','tab-busca',this)">🔎 Buscar Online</button>
              <button class="tab-btn" onclick="abrirAba('esq','tab-link',this)">🌐 Link Direto</button>
              <button class="tab-btn" onclick="abrirAba('esq','tab-upload',this)">📤 Subir MP3 (GitHub)</button>
            </div>

            <div id="tab-busca" class="tab-content active esq">
              <p style="font-size:12px;color:#a1a1aa;margin-bottom:10px">Busca simultânea em Rádios 24h, Músicas Completas (Saavn) e Deezer:</p>
              <div style="display:flex;gap:8px;margin-bottom:12px">
                <input type="text" id="termo-busca" placeholder="Ex: Linkin Park, Alok, Metal..." style="margin:0" onkeydown="if(event.key==='Enter') buscarMusica()">
                <button class="btn-primary" onclick="buscarMusica()">Buscar</button>
                <button class="btn-sec" onclick="tocarAleatorio()">🎲</button>
              </div>
              <ul id="lista-busca"></ul>
            </div>

            <div id="tab-link" class="tab-content esq">
              <p style="font-size:12px;color:#a1a1aa;margin-bottom:10px">Cole qualquer stream de rádio ou arquivo .mp3 direto para tocar ou salvar:</p>
              <input type="text" id="nome-link" placeholder="Nome para salvar nos favoritos (Ex: Rádio Rock)">
              <input type="text" id="url" placeholder="https://... ou http://...">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                <button class="btn-primary" onclick="comando('link')">▶ Tocar Agora</button>
                <button class="btn-fav" onclick="adicionarFavorito('radio')">⭐ Salvar em Rádios</button>
                <button class="btn-fav" onclick="adicionarFavorito('mp3')">⭐ Salvar em Links MP3</button>
              </div>
            </div>

            <div id="tab-upload" class="tab-content esq">
              <p style="font-size:12px;color:#a1a1aa;margin-bottom:10px">Envie um arquivo <b>.mp3</b> direto do seu PC/celular para a pasta do GitHub sem sair do painel:</p>
              <div id="aviso-token" style="background:#271a1a;border:1px solid #ef4444;padding:10px;border-radius:8px;font-size:12px;color:#fca5a5;margin-bottom:12px;display:none">
                ⚠️ Variável <b>GITHUB_TOKEN</b> não detectada no Render. Configure-a em Environment no Render para ativar o salvamento permanente.
              </div>
              <input type="file" id="arquivo-mp3" accept=".mp3,audio/mpeg" style="margin-bottom:12px;color:#ccc">
              <button class="btn-primary" id="btn-enviar-gh" onclick="enviarArquivoGitHub()">📤 Enviar MP3 para Rádio</button>
            </div>
          </div>

          <div class="panel">
            <div class="tabs">
              <button class="tab-btn active" onclick="abrirAba('dir','tab-pasta',this)">📁 Pasta GitHub</button>
              <button class="tab-btn" onclick="abrirAba('dir','tab-radios',this)">📻 Rádios Salvas</button>
              <button class="tab-btn" onclick="abrirAba('dir','tab-mp3s',this)">🎵 Links MP3</button>
              <button class="tab-btn" onclick="abrirAba('dir','tab-dicas',this)">💡 Dicas</button>
            </div>

            <div id="tab-pasta" class="tab-content active dir">
              <p style="font-size:12px;color:#a1a1aa;margin-bottom:8px">Músicas armazenadas no repositório (tocam em loop automático):</p>
              <ul id="lista-pasta"></ul>
            </div>

            <div id="tab-radios" class="tab-content dir"><ul id="lista-radios"></ul></div>
            <div id="tab-mp3s" class="tab-content dir"><ul id="lista-mp3s"></ul></div>

            <div id="tab-dicas" class="tab-content dir">
              <ul style="font-size:13px;color:#d4d4d8;line-height:1.6">
                <li style="display:block"><strong>1. Rádios 24h:</strong> Busque em <a href="https://radio-browser.info" target="_blank" style="color:#10b981">radio-browser.info</a> e copie o link direto do stream.</li>
                <li style="display:block"><strong>2. MP3 Grátis Direto:</strong> Em <a href="https://archive.org" target="_blank" style="color:#10b981">archive.org</a>, clique em <b>VBR MP3</b>, botão direito na música -> <b>Copiar endereço do link</b>.</li>
                <li style="display:block"><strong>3. Hospedagem Rápida:</strong> Suba um MP3 em <a href="https://catbox.moe" target="_blank" style="color:#10b981">catbox.moe</a> para gerar um link <code>https://catbox.moe</code>.</li>
                <li style="display:block"><strong>4. Dropbox:</strong> Troque o final <code>?dl=0</code> do link compartilhado por <code>?raw=1</code>.</li>
              </ul>
            </div>
          </div>
        </main>
      </div>
      <script>
        const radiosPadrao = [
          { nome: 'Rock Antenne Heavy Metal', url: 'http://rockantenne.de' },
          { nome: 'Radio Paradise (Mix/Rock)', url: 'http://radioparadise.com' }
        ];

        function obterSenha() { return localStorage.getItem('dj_senha') || sessionStorage.getItem('dj_senha') || ''; }

        function fazerLogin() {
          const senha = document.getElementById('login-pass').value;
          if (!senha) return alert('Digite a senha!');
          fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha })
          }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.msg);
            if (document.getElementById('manter-login').checked) localStorage.setItem('dj_senha', senha);
            else sessionStorage.setItem('dj_senha', senha);
            verificarSessao();
          });
        }

        function verificarSessao() {
          const s = obterSenha();
          if (s) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('console-app').style.display = 'flex';
            carregarFavoritos();
            atualizarStatus();
          } else {
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('console-app').style.display = 'none';
          }
        }

        function sair() {
          localStorage.removeItem('dj_senha');
          sessionStorage.removeItem('dj_senha');
          verificarSessao();
        }

        function abrirAba(grupo, idAba, btn) {
          document.querySelectorAll('.' + grupo).forEach(el => el.classList.remove('active'));
          btn.parentElement.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.getElementById(idAba).classList.add('active');
          btn.classList.add('active');
        }

        function carregarFavoritos() {
          const radios = JSON.parse(localStorage.getItem('fav_radios') || JSON.stringify(radiosPadrao));
          const mp3s = JSON.parse(localStorage.getItem('fav_mp3s') || '[]');
          document.getElementById('lista-radios').innerHTML = radios.map((item, idx) =>
            '<li><span>'+item.nome+'</span><div><button class="btn-primary" onclick="comando(\\'link\\',0,\\''+item.url+'\\',\\''+item.nome.replace(/'/g,"")+'\\')">▶</button> <button class="btn-danger" onclick="removerFavorito(\\'radio\\','+idx+')">X</button></div></li>'
          ).join('') || '<li>Nenhuma rádio salva.</li>';
          document.getElementById('lista-mp3s').innerHTML = mp3s.map((item, idx) =>
            '<li><span>'+item.nome+'</span><div><button class="btn-primary" onclick="comando(\\'link\\',0,\\''+item.url+'\\',\\''+item.nome.replace(/'/g,"")+'\\')">▶</button> <button class="btn-danger" onclick="removerFavorito(\\'mp3\\','+idx+')">X</button></div></li>'
          ).join('') || '<li>Nenhum link MP3 salvo.</li>';
        }

        function adicionarFavorito(tipo, nomeCustom = '', urlCustom = '') {
          const nome = nomeCustom || document.getElementById('nome-link').value.trim();
          const url = urlCustom || document.getElementById('url').value.trim();
          if (!nome || !url) return alert('Preencha o Nome e o Link!');
          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const atual = JSON.parse(localStorage.getItem(chave) || (tipo === 'radio' ? JSON.stringify(radiosPadrao) : '[]'));
          atual.push({ nome, url });
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
          fetch('/api/comando', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, acao, indice, url, tituloCustom })
          }).then(r => r.json()).then(d => {
            if (!d.ok) { alert(d.msg); if (d.msg.includes('Senha')) sair(); }
            else atualizarStatus();
          });
        }

        function buscarMusica() {
          const termo = document.getElementById('termo-busca').value;
          const senha = obterSenha();
          if (!termo) return alert('Digite um artista ou música!');
          document.getElementById('lista-busca').innerHTML = '<li>Buscando em Rádios, Saavn e Deezer...</li>';
          fetch('/api/buscar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, termo })
          }).then(r => r.json()).then(d => {
            if (!d.ok) { document.getElementById('lista-busca').innerHTML = ''; return alert(d.msg); }
            if (d.resultados.length === 0) { document.getElementById('lista-busca').innerHTML = '<li>Nenhum resultado encontrado.</li>'; return; }
            document.getElementById('lista-busca').innerHTML = d.resultados.map(item => {
              const t = item.titulo.replace(/'/g, "");
              return '<li><span>'+item.titulo+'</span><div style="display:flex;gap:4px"><button class="btn-primary" onclick="comando(\\'busca\\',0,\\''+item.streamUrl+'\\',\\''+t+'\\')">▶</button><button class="btn-fav" onclick="adicionarFavorito(\\''+item.tipo+'\\',\\''+t+'\\',\\''+item.streamUrl+'\\')">⭐</button></div></li>';
            }).join('');
          });
        }

        function tocarAleatorio() {
          const termo = document.getElementById('termo-busca').value;
          const senha = obterSenha();
          if (!termo) return alert('Digite o artista!');
          fetch('/api/aleatorio', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha, termo })
          }).then(r => r.json()).then(d => { if (!d.ok) alert(d.msg); else atualizarStatus(); });
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
              btn.disabled = false; btn.innerText = '📤 Enviar MP3 para Rádio';
              alert(d.msg);
              if (d.ok) { input.value = ''; atualizarStatus(); }
            }).catch(() => { btn.disabled = false; btn.innerText = '📤 Enviar MP3 para Rádio'; });
        }

        function apagarArquivoGitHub(nome) {
          if (!confirm('Apagar "' + nome + '" da pasta e do GitHub?')) return;
          fetch('/api/github-delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha: obterSenha(), nome })
          }).then(r => r.json()).then(d => { alert(d.msg); atualizarStatus(); });
        }

        let micStream = null, mediaRecorder = null, audioCtx = null, audioFundo = null;

        async function iniciarMic() {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const destino = audioCtx.createMediaStreamDestination();

            const micSrc = audioCtx.createMediaStreamSource(micStream);
            const micGain = audioCtx.createGain();
            micGain.gain.value = 1.4;
            micSrc.connect(micGain);
            micGain.connect(destino);

            if (document.getElementById('mic-fundo').checked) {
              audioFundo = new Audio('/stream');
              audioFundo.crossOrigin = 'anonymous';
              const fundoSrc = audioCtx.createMediaElementSource(audioFundo);
              const fundoGain = audioCtx.createGain();
              fundoGain.gain.value = 0.25;
              fundoSrc.connect(fundoGain);
              fundoGain.connect(destino);
              audioFundo.play().catch(() => {});
            }

            mediaRecorder = new MediaRecorder(destino.stream);
            mediaRecorder.ondataavailable = async (e) => {
              if (e.data && e.data.size > 0) {
                fetch('/api/mic-chunk', {
                  method: 'POST',
                  headers: { 'x-senha': obterSenha() },
                  body: e.data
                }).catch(() => {});
              }
            };
            mediaRecorder.start(1000);

            document.getElementById('btn-mic-start').style.display = 'none';
            document.getElementById('btn-mic-stop').style.display = 'inline-flex';
            document.getElementById('mic-status').innerText = '🔴 TRANSMITINDO AO VIVO!';
            document.getElementById('mic-status').style.color = '#f43f5e';
          } catch (err) {
            alert('Permita o microfone no navegador: ' + err.message);
          }
        }

        function pararMic() {
          if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
          if (micStream) micStream.getTracks().forEach(t => t.stop());
          if (audioFundo) { audioFundo.pause(); audioFundo = null; }
          if (audioCtx) audioCtx.close();

          fetch('/api/mic-stop', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senha: obterSenha() })
          }).then(() => atualizarStatus());

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

            document.getElementById('st-musica').innerText = st.musica;
            document.getElementById('st-ouvintes').innerText = st.ouvintes;
            document.getElementById('st-vel').innerText = st.velocidade;
            document.getElementById('st-mem').innerText = st.memoria;
            document.getElementById('st-up').innerText = st.uptime;
            document.getElementById('aviso-token').style.display = st.githubAtivo ? 'none' : 'block';

            document.getElementById('lista-pasta').innerHTML = (st.arquivosPasta || []).map((arq, i) =>
              '<li><span>📁 '+arq+'</span><div style="display:flex;gap:4px"><button class="btn-primary" onclick="comando(\\'tocar\\','+i+')">▶</button><button class="btn-danger" onclick="apagarArquivoGitHub(\\''+arq+'\\')">🗑️</button></div></li>'
            ).join('') || '<li>Nenhuma música .mp3 na pasta.</li>';
          });
        }

        verificarSessao();
        setInterval(atualizarStatus, 4000);
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
  modoAtual = 'busca'; urlExterna = s.streamUrl; musicaTocando = `🎲 ${s.titulo}`;
  tocarProxima();
  res.json({ ok: true, msg: `Tocando: ${s.titulo}` });
});

app.post('/api/comando', (req, res) => {
  const { senha, acao, indice, url, tituloCustom } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta!' });
  if (acao === 'ligar') { if (!radioLigada) { radioLigada = true; tocarProxima(); } return res.json({ ok: true }); }
  if (acao === 'desligar') { radioLigada = false; pararStreamAtual(); musicaTocando = 'TRANSMISSÃO PAUSADA (OFF AIR)'; return res.json({ ok: true }); }
  if (acao === 'pular') { radioLigada = true; modoAtual = 'pasta'; indiceMusica++; tocarProxima(); return res.json({ ok: true }); }
  if (acao === 'tocar') { radioLigada = true; modoAtual = 'pasta'; indiceMusica = indice; tocarProxima(); return res.json({ ok: true }); }
  if (acao === 'link' && url) { radioLigada = true; modoAtual = 'link'; urlExterna = url.trim(); musicaTocando = tituloCustom ? `⭐ ${tituloCustom}` : `🌐 Link: ${urlExterna}`; tocarProxima(); return res.json({ ok: true }); }
  if (acao === 'busca' && url) { radioLigada = true; modoAtual = 'busca'; urlExterna = url.trim(); musicaTocando = tituloCustom; tocarProxima(); return res.json({ ok: true }); }
  res.json({ ok: false, msg: 'Comando inválido.' });
});

setInterval(() => {
  if (Math.round(process.memoryUsage().rss / 1024 / 1024) > 420) process.exit(0);
}, 30000);


app.listen(PORT, () => { console.log('Console Web DJ rodando na porta ' + PORT); tocarProxima(); });

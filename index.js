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
    fetch(urlExterna)
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
        musicaTocando = 'Erro no link externo, voltando para pasta...';
        modoAtual = 'pasta';
        setTimeout(tocarProxima, 2000);
      });
    return;
  }

  const lista = listarMusicas();
  if (lista.length === 0) {
    musicaTocando = 'Pasta /musicas vazia. Use a Busca de Artista ou cole um Link!';
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
async function buscarAudius(termo) {
  let resultados = [];

  // 1. Busca estações de rádio temáticas no Radio Browser
  try {
    const radioRes = await fetch(`https://radio-browser.info{encodeURIComponent(termo)}&limit=5&hidebroken=true`, {
      headers: { 'User-Agent': 'RadioIMVU/1.0' }
    });
    if (radioRes.ok) {
      const stations = await radioRes.json();
      const radios = (stations || []).filter(s => s.url_resolved).map(s => ({
        tipo: 'radio',
        titulo: `📻 Rádio: ${s.name.trim()} (${s.countrycode || 'Web'})`,
        streamUrl: s.url_resolved
      }));
      resultados = resultados.concat(radios);
    }
  } catch (e) {}

  // 2. Busca arquivos MP3 diretos no Internet Archive
  try {
    const iaQuery = encodeURIComponent(`${termo} AND mediatype:audio`);
    const iaRes = await fetch(`https://archive.org{iaQuery}&fl[]=identifier,title&rows=5&output=json`);
    if (iaRes.ok) {
      const iaJson = await iaRes.json();
      const docs = iaJson?.response?.docs || [];
      for (const doc of docs) {
        const metaRes = await fetch(`https://archive.org{doc.identifier}/files`);
        if (metaRes.ok) {
          const metaJson = await metaRes.json();
          const mp3 = (metaJson.result || []).find(f => f.name && f.name.toLowerCase().endsWith('.mp3'));
          if (mp3) {
            resultados.push({
              tipo: 'mp3',
              titulo: `🎵 MP3: ${doc.title || mp3.name}`,
              streamUrl: `https://archive.org{doc.identifier}/${encodeURIComponent(mp3.name)}`
            });
          }
        }
      }
    }
  } catch (e) {}

  // 3. Busca faixas na API Oficial da Audius
  try {
    const searchRes = await fetch(`https://audius.co{encodeURIComponent(termo)}&app_name=RadioIMVU`);
    if (searchRes.ok) {
      const searchJson = await searchRes.json();
      const tracks = (searchJson.data || []).slice(0, 4).map(track => ({
        tipo: 'mp3',
        titulo: `🎧 Audius: ${track.user?.name || 'Artista'} - ${track.title}`,
        streamUrl: `https://audius.co{track.id}/stream?app_name=RadioIMVU`
      }));
      resultados = resultados.concat(tracks);
    }
  } catch (e) {}

  return resultados;
}

  try {
    // 2. Plano B: API Audius (corrigida para pegar o primeiro servidor da lista)
    const hostRes = await fetch('https://audius.co');
    const hostJson = await hostRes.json();
    const host = Array.isArray(hostJson.data) ? hostJson.data[0] : hostJson.data;

    const searchRes = await fetch(`${host}/v1/tracks/search?query=${encodeURIComponent(termo)}&app_name=RadioIMVU`);
    const searchJson = await searchRes.json();
    return (searchJson.data || []).slice(0, 8).map(track => ({
      titulo: `${track.user.name} - ${track.title}`,
      streamUrl: `${host}/v1/tracks/${track.id}/stream?app_name=RadioIMVU`
    }));
  } catch (e) {
    return [];
  }
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
    </head>
    <body>
      <div class="card">
        <h1>📻 Rádio IMVU Online</h1>
        <p>Você acessou o endereço raiz do servidor. Para usar a rádio, escolha uma das rotas abaixo:</p>
        <p><strong>1. Para colocar na sala do IMVU:</strong><br>Adicione <code>/stream</code> no final do link.</p>
        <p><strong>2. Para controlar as músicas:</strong><br>Adicione <code>/dj</code> no final do link.</p>
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
        body { font-family: sans-serif; background: #121212; color: #fff; padding: 15px; max-width: 650px; margin: auto; }
        input[type="text"], input[type="password"] { width: 100%; padding: 10px; margin: 5px 0; border-radius: 5px; border: 1px solid #444; background: #222; color: #fff; box-sizing: border-box; }
        button { padding: 10px 14px; margin: 5px 3px 5px 0; border-radius: 5px; border: none; background: #1db954; color: #000; font-weight: bold; cursor: pointer; }
        button.sec { background: #3a3a3a; color: #fff; }
        button.off { background: #e53935; color: #fff; }
        .box { background: #1e1e1e; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #2c2c2c; }
        .badge-on { background: #1db954; color: #000; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
        .badge-off { background: #e53935; color: #fff; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
        .grid-status { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 14px; margin-top: 10px; color: #ccc; }
        ul { list-style: none; padding: 0; margin: 0; }
        li { padding: 8px 0; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 10px; }
        .hidden { display: none; }
      </style>
    </head>
    <body>
      <h2>🎧 Painel DJ - Rádio IMVU</h2>

           <div class="box">
        <h3>🌐 Colar Link Direto (Rádio ou MP3)</h3>
        <input type="text" id="nome-favorito" placeholder="Nome para salvar (Ex: Rádio Rock ou Música X)">
        <input type="text" id="url" placeholder="Cole aqui http://... ou https://...">
        <button onclick="comando('link')">▶ Tocar Agora</button>
        <button class="sec" onclick="adicionarManual('radio')">⭐ Salvar em Rádios</button>
        <button class="sec" onclick="adicionarManual('mp3')">⭐ Salvar em MP3</button>
        <button class="sec" onclick="comando('pular')">⏭ Voltar p/ Pasta</button>
      </div>

      <div class="box">
        <h3>📻 Minhas Rádios Online Salvas</h3>
        <ul id="lista-radios-salvas"></ul>
      </div>

      <div class="box">
        <h3>🎵 Meus Links MP3 Diretos Salvos</h3>
        <ul id="lista-mp3-salvos"></ul>
      </div>

      <div class="box">
        <h3>📁 Músicas na Pasta (/musicas)</h3>
        <ul>${botoesMusicas || '<li>Nenhuma música .mp3 na pasta ainda.</li>'}</ul>
      </div>

      <script>
        const radiosPadrao = [
          { titulo: '📻 Rádio Rock / Metal (ChroniX Aggression)', url: 'https://fastcast4u.com' },
          { titulo: '📻 Rádio Pop / Hits Internacionais', url: 'https://streamtheworld.com' },
          { titulo: '📻 Rádio Lo-Fi / Chill Beats 24h', url: 'https://ilovemusic.de' }
        ];

        function carregarFavoritos() {
          let radios = JSON.parse(localStorage.getItem('fav_radios') || 'null');
          if (!radios) {
            radios = radiosPadrao;
            localStorage.setItem('fav_radios', JSON.stringify(radios));
          }
          const mp3s = JSON.parse(localStorage.getItem('fav_mp3s') || '[]');

          document.getElementById('lista-radios-salvas').innerHTML = radios.map((item, idx) => \`
            <li>
              <button onclick="comando('link', 0, '\${item.url}', '\${item.titulo.replace(/'/g, "")}')">▶ Tocar</button>
              <span style="flex:1">\${item.titulo}</span>
              <button class="off" style="padding:4px 8px; font-size:11px;" onclick="removerFav('radio', \${idx})">X</button>
            </li>\`).join('') || '<li>Nenhuma rádio salva.</li>';

          document.getElementById('lista-mp3-salvos').innerHTML = mp3s.map((item, idx) => \`
            <li>
              <button onclick="comando('link', 0, '\${item.url}', '\${item.titulo.replace(/'/g, "")}')">▶ Tocar</button>
              <span style="flex:1">\${item.titulo}</span>
              <button class="off" style="padding:4px 8px; font-size:11px;" onclick="removerFav('mp3', \${idx})">X</button>
            </li>\`).join('') || '<li>Nenhum link MP3 salvo ainda. Use a busca ou cole um link acima!</li>';
        }

        function salvarFav(tipo, titulo, url) {
          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const lista = JSON.parse(localStorage.getItem(chave) || '[]');
          lista.push({ titulo, url });
          localStorage.setItem(chave, JSON.stringify(lista));
          carregarFavoritos();
          alert('Salvo na sua lista de ' + (tipo === 'radio' ? 'Rádios!' : 'Links MP3!'));
        }

        function adicionarManual(tipo) {
          const titulo = document.getElementById('nome-favorito').value.trim() || 'Link Salvo';
          const url = document.getElementById('url').value.trim();
          if (!url) return alert('Cole o link no campo abaixo antes de salvar!');
          salvarFav(tipo, titulo, url);
          document.getElementById('nome-favorito').value = '';
        }

        function removerFav(tipo, idx) {
          const chave = tipo === 'radio' ? 'fav_radios' : 'fav_mp3s';
          const lista = JSON.parse(localStorage.getItem(chave) || '[]');
          lista.splice(idx, 1);
          localStorage.setItem(chave, JSON.stringify(lista));
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
          if (!termo) return alert('Digite o nome de um artista ou música!');
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
              const titLimpo = item.titulo.replace(/'/g, "");
              return \`<li>
                <button onclick="comando('busca', 0, '\${item.streamUrl}', '\${titLimpo}')">▶</button>
                <button class="sec" onclick="salvarFav('\${item.tipo}', '\${titLimpo}', '\${item.streamUrl}')">⭐</button>
                <span>\${item.titulo}</span>
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


      <div class="box" id="box-login">
        <label><strong>🔐 Senha do DJ:</strong></label>
        <input type="password" id="senha" placeholder="Digite sua senha para liberar os comandos">
        <label style="font-size: 13px; color: #bbb; display:block; margin: 5px 0;">
          <input type="checkbox" id="manter-login"> Manter logado mesmo se fechar o navegador
        </label>
        <button onclick="salvarSenha()">Desbloquear Painel</button>
      </div>

      <div class="box hidden" id="box-logado" style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#1db954; font-size:14px;">🔓 Painel desbloqueado na sessão</span>
        <button class="sec" onclick="sairSessao()" style="padding:5px 10px; font-size:12px;">Sair / Bloquear</button>
      </div>

      <div class="box">
        <h3>🔎 Buscar Artista ou Música (Online)</h3>
        <input type="text" id="termo-busca" placeholder="Ex: Alok, Linkin Park, Hungria...">
        <button onclick="buscarMusica()">🔍 Buscar Lista</button>
        <button class="sec" onclick="tocarAleatorio()">🎲 Tocar Aleatório do Artista</button>
        <ul id="lista-busca" style="margin-top:10px;"></ul>
      </div>

      <div class="box">
        <h3>🌐 Colar Link Direto (Rádio ou MP3)</h3>
        <input type="text" id="url" placeholder="Cole aqui http://... ou https://...">
        <button onclick="comando('link')">▶ Tocar Link</button>
        <button class="sec" onclick="comando('pular')">⏭ Pular / Voltar p/ Pasta</button>
      </div>

      <div class="box">
        <h3>📁 Músicas na Pasta (/musicas)</h3>
        <ul>${botoesMusicas || '<li>Nenhuma música .mp3 na pasta ainda.</li>'}</ul>
      </div>
      <script>
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
          if (!termo) return alert('Digite o nome de um artista ou música!');
          document.getElementById('lista-busca').innerHTML = '<li>Buscando músicas...</li>';

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
              document.getElementById('lista-busca').innerHTML = '<li>Nenhuma música encontrada com esse nome.</li>';
              return;
            }
            document.getElementById('lista-busca').innerHTML = d.resultados.map(item => 
              \`<li><button onclick="comando('busca', 0, '\${item.streamUrl}', '\${item.titulo.replace(/'/g, "")}')">▶ Tocar</button> <span>\${item.titulo}</span></li>\`
            ).join('');
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
  const resultados = await buscarAudius(termo);
  res.json({ ok: true, resultados });
});

app.post('/api/aleatorio', async (req, res) => {
  const { senha, termo } = req.body;
  if (senha !== SENHA_DJ) return res.json({ ok: false, msg: 'Senha incorreta! Digite a senha do DJ.' });
  const resultados = await buscarAudius(termo);
  if (resultados.length === 0) return res.json({ ok: false, msg: 'Nenhuma música encontrada para esse artista.' });
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
    musicaTocando = `🌐 Link: ${urlExterna}`;
    tocarProxima();
    return res.json({ ok: true, msg: 'Conectando ao link...' });
  }
  if (acao === 'busca' && url) {
    radioLigada = true;
    modoAtual = 'busca';
    urlExterna = url.trim();
    musicaTocando = `🎵 ${tituloCustom}`;
    tocarProxima();
    return res.json({ ok: true, msg: 'Tocando música!' });
  }
  res.json({ ok: false, msg: 'Comando inválido.' });
});

app.listen(PORT, () => {
  console.log('Servidor rodando na porta ' + PORT);
  tocarProxima();
});

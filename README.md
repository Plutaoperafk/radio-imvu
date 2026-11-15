# 📻 Rádio Web IMVU — Console Estúdio DJ v3.0

Servidor de streaming de áudio MP3 em Node.js hospedado no Render com armazenamento persistente de músicas no GitHub.

## 🔗 Rotas do Sistema
* **Stream para Sala do IMVU:** `/stream` (colar em *Configurações da Sala > Music URL*)
* **Console Estúdio DJ:** `/dj` (painel de controle em 3 colunas protegido por senha)
* **Player Público:** `/` (página inicial com visor e player HTML5)

## ⚙️ Configurações & Manutenção
* **Senha do Painel:** Definida na variável `SENHA_DJ` no topo do arquivo `index.js`.
* **Chave do GitHub:** Salva como `GITHUB_TOKEN` nas variáveis de ambiente (*Environment*) do Render.
* **Start Command no Render:** `node --expose-gc index.js` (ativa a limpeza imediata de RAM após uploads).
* **Pasta de Músicas:** Arquivos `.mp3` (até 15 MB cada) ficam salvos em `/musicas`.

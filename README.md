# 📻 IMVU Web Radio — Studio Web DJ Console (v3.0)

![Node.js](https://shields.io)
![Express](https://shields.io)
![Render](https://shields.io)
![GitHub API](https://shields.io)

> **A 100% cloud-hosted MP3 audio streaming server featuring a 3-column Studio Web DJ Console, browser-based live microphone broadcasting, and direct track management via the GitHub API — purpose-built for IMVU chat rooms.**

---

## ✨ Why This Project Exists

Broadcasting music in **IMVU** rooms traditionally requires keeping a desktop computer running 24/7 with heavy local software (such as SAM Broadcaster, VirtualDJ, or a local Icecast server) or relying on third-party room bots that put your account at risk.

This project solves that problem by creating a **free, self-hosted cloud radio station**:
* **Zero Desktop Software:** Everything runs directly in your web browser (desktop or mobile).
* **No In-Room Bots:** Generates a direct `/stream` (`audio/mpeg`) endpoint compatible with IMVU's native Room Settings audio player.
* **Free Persistent Storage:** Uses your GitHub repository as permanent `.mp3` storage and Render as the live streaming engine.

---

## 🎛️ Key Features (v3.0)

* **🔒 Gatekeeper Login Screen:** The `/dj` console requires password authentication before exposing any controls or telemetry.
* **🖥️ No-Scroll 3-Column Studio Console:**
  * **Column 1 (Input & Discovery):** Simultaneous search across **24/7 Radio Stations** (*Radio Browser*), **Full Tracks** (*JioSaavn API*), and **Global Catalog** (*Deezer API*), plus direct stream URL input and `.mp3` file upload.
  * **Column 2 (Central Deck):** Auto-looping playlist of the `/musicas` folder with instant playback triggers and synchronized GitHub deletion.
  * **Column 3 (Library & Genres):** Genre-based organization for saved radio stations, quick genre filtering, and one-click URL copy (`📋`).
* **🔄 Mode Toggle Switch (`Radio Mode` ⇄ `MP3 Mode`):** Prevents audio overlap between external live streams and local MP3 files.
* **🛡️ Smart Transition Buffer & Anti-Drop Watchdog:**
  * **1.8s transition buffer** ensures clean, stutter-free station switching.
  * Continuous packet monitoring: only falls back to the local MP3 playlist if an external station goes silent/offline for **10 consecutive seconds**.
* **🎙️ Native Live Voice Broadcasting:** Captures microphone audio directly in the browser (`MediaRecorder` + `Web Audio API`), mixing your voice with **25% background music** without external CDN scripts.
* **🧠 Smart RAM Management:** Immediate buffer disposal after uploads, forced garbage collection (`--expose-gc`), and automatic safety restart if memory exceeds `420 MB` (staying safely under Render's `512 MB` free tier limit).

---

## 🏗️ System Architecture

```text
[ Browser /dj ] ──(Commands, Mic, MP3 Upload)──► [ Node.js Server (Render) ]
                                                        │              ▲
                        ┌───────────────────────────────┘              │
                        ▼                                              │
           [ HTTP Stream /stream ]                        [ GitHub Contents API ]
        (IMVU Room & Public Player /)                    (/musicas Repo Folder)
```

### Endpoint Map

| Endpoint | Access | Description |
| :--- | :--- | :--- |
| **`/`** | Public | Landing page with Winamp-style now-playing display and embedded HTML5 audio player. |
| **`/stream`** | Public | Continuous `audio/mpeg` (`chunked`) stream URL for IMVU Room Settings. |
| **`/dj`** | Private | Password-protected 3-column Studio Web DJ Console. |
| **`/api/github-upload`** | Private | Accepts `.mp3` files (up to 15 MB) and commits them directly to `/musicas` via GitHub API. |
| **`/api/mic-chunk`** | Private | Receives live microphone audio chunks from the DJ console. |

---

## 🚀 Deployment Guide (Step-by-Step)

### 1. Set Up Your GitHub Repository
1. Create a new repository (recommended: **Private**) named `radio-imvu`.
2. Create the tracks folder by adding an initial placeholder file: `musicas/inicio.txt`.
3. Add `package.json` (dependencies: `express`, `multer`, `node-fetch`) and `index.js`.
4. At the top of `index.js`, configure your settings:
   ```javascript
   const SENHA_DJ = "YOUR_DJ_PASSWORD";
   const GITHUB_USER = "YOUR_GITHUB_USERNAME";
   const GITHUB_REPO = "radio-imvu";
   ```

### 2. Generate a GitHub Personal Access Token (`GITHUB_TOKEN`)
1. On GitHub, go to **Settings** ➔ **Developer settings** ➔ **Personal access tokens** ➔ **Tokens (classic)**.
2. Click **Generate new token (classic)**, check the **`repo`** scope, set expiration to **No expiration**, and copy the generated token (`ghp_...`).

### 3. Configure the Render Web Service
1. On the [Render Dashboard](https://render.com), click **+ New** ➔ **Web Service** and connect your repository.
2. Choose the **Free ($0/month)** tier with **Build Command:** `npm install`.
3. Under **Environment**, add your secret key:
   * **Key:** `GITHUB_TOKEN` | **Value:** `ghp_...`
4. Under **Settings** ➔ **Start Command**, set:
   ```bash
   node --expose-gc index.js
   ```

### 4. Connect to Your IMVU Room
1. Copy your Render service URL and append `/stream` (e.g., `https://onrender.com`).
2. In **IMVU**, open **Room Settings**, paste the URL into the **Stream / Music URL** field, and save.

---

## ⚠️ Free Tier Notes & Best Practices

* **Auto-Sleep (Render Free):** After 15 minutes with zero active listeners, the server spins down and automatically wakes up within ~30 seconds when `/stream` or `/dj` is accessed.
* **Playlist Persistence:** Saved radio stations and external MP3 links are stored in your browser's `localStorage` so they remain intact across server restarts.
* **Security:** Never hardcode your `SENHA_DJ` or `GITHUB_TOKEN` inside this `README.md`.

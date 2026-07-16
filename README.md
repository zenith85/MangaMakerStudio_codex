# Ibraheem Manga Studio

A local-first manga creation studio: organize a project into characters, places,
and objects, generate reference art for each one, then compose them into
manga pages and panels — all backed by [Codex CLI](https://developers.openai.com/codex/cli)
running on your own machine, not a paid image-generation API.

## How it works

- **Projects** are folders on disk. Each project has `characters/`, `places/`,
  and `objects/` subfolders, and each entity gets its own folder containing:
  - `meta.json` — structured data (name, custom fields, style)
  - `information.txt` — a human-readable mirror of the same
  - `image.png` — its reference image, once generated
- **Image generation** runs through Codex CLI's built-in image tool. Clicking
  Generate writes a `codex exec` command into that project's terminal session —
  the same one shown in the app's embedded terminal — so you can watch it
  happen live instead of it running as an invisible background process.
- **The embedded terminal** is a real pseudo-terminal (via `node-pty`), streamed
  to the browser over a WebSocket. Opening a project automatically opens a
  terminal cwd'd into that project's folder — you can run `codex`, or anything
  else, directly.
- **Pages and panels** compose characters/places/objects into full manga scenes,
  using each entity's saved reference image for visual consistency across panels.

## Prerequisites

- **Node.js 22+** (required by Codex CLI's npm package)
- **Codex CLI**, installed and authenticated:
  ```
  npm install -g @openai/codex
  codex login
  ```
  `codex login` opens a browser to sign in with your ChatGPT account — usage
  then draws from your ChatGPT plan rather than separate API billing.

## Setup

```
./start.sh
```

This installs dependencies on first run, then starts both the backend
(`http://localhost:8787`) and frontend (`http://localhost:5173`). Open the
frontend URL in a browser.

## Project structure

```
app/
  server/          Express backend
    projects/      Your projects live here (git-ignored — see below)
    store.js        Folder-based storage (projects/characters/places/objects/pages)
    codex.js        Bridges image generation through Codex CLI
    terminal.js     WebSocket <-> pseudo-terminal bridge for the embedded terminal
    index.js        HTTP API
  web/             React (Vite) frontend
    src/App.jsx      Main UI
    src/Terminal.jsx Embedded terminal component (xterm.js)
```

## Security note

The embedded terminal gives full interactive shell access with no
authentication layer of its own — it's restricted to connections from
`localhost` only, so nothing else on your network can reach it. Don't change
that restriction without adding real authentication in its place.

## What's git-ignored, and why

- `app/server/projects/` — your actual manga projects (characters, places,
  generated images). This is your data, not code, and can grow large — kept
  local only.
- `app/server/uploads/` — legacy generated panel renders.
- `node_modules/`, `app/web/dist/` — installable/rebuildable, not source.

## Fonts

Speech bubble text can use one of five free fonts, self-hosted under
`app/web/public/fonts/` (rather than a CDN) so bubbles render the same
offline: Bangers, Comic Neue, and Reggae One (SIL Open Font License), and
Permanent Marker (Apache License 2.0). Shojumaru is also SIL OFL. Full
license texts are in `app/web/public/fonts/LICENSES/`.

## License

MIT — see [LICENSE](LICENSE).

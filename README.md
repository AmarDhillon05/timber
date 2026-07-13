# Timber

Multi-track audio/video editor. A React Native (Expo) app applies "Blanket"
perceptual audio controls per track; a Python inference service suggests Blanket
amounts by listening to the audio. The app's "AI suggestions" call the local
inference API — not a hosted LLM.

## Layout

- `mobile/` — Expo app. Runs as web, Electron desktop, or iOS. The desktop is the **receiver** of remote-control commands.
- `controller/` — separate Expo app: the phone **remote** that sends media-control commands.
- `relay/` — zero-dependency SSE middleman (`:8787`) that pairs the controller to the app. Both sides only make outbound calls to it.
- `recorder/` — system-audio sidecar (`:8790`): native loopback capture (PipeWire on Linux, WASAPI on Windows) served to the app over a local WebSocket. One implementation per OS, same protocol.
- `saver/` — project-persistence sidecar (`:8791`): zero-dep local HTTP server the app saves projects through (Save / Ctrl+S in the editor) and reopens them from ("Open a saved project"). Writes to `saved_data/` at the repo root (gitignored).
- `inference/` — FastAPI service: audio file → suggested Blanket amounts (AST / BEATs / CLAP).
- `functions/` — audio-processing primitives (`blanket.py`, `audiofile.py`).
- `hub/` — local Hugging Face model caches.
- `DESIGN.md` — recording, multi-track model, and platform-handler architecture.

## Run the app

```bash
cd mobile
npm install
npm run win:web        # browser
npm run win:electron   # Windows desktop (Electron); run on the Windows host
npm run apple          # iOS (macOS)
```

System audio comes from the recorder sidecar (`recorder/`, see its README) —
start it alongside the app, or use the run-dev scripts below which do it for
you. On Windows run Electron on the Windows host (not WSL) so SMTC
media-session control works.

## Run the inference API

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r inference/requirements.txt   # the inference service's own deps (incl. uvicorn)
uvicorn inference.api:app --reload --port 8000
```

Serves `/health`, `/terms`, `/suggest` on `http://localhost:8000`.

## Run the remote controller (app + relay + controller)

The app and the phone controller never talk directly — both connect to the
**relay**. So a full remote-control session is several separate processes.

**One command:**

```powershell
./scripts/run-dev.ps1          # Windows host — controller as web on this machine (localhost)
./scripts/run-dev.ps1 -Lan     # controller reachable from a phone (auto-detected LAN IP)
```

```bash
./scripts/run-dev.sh           # Linux/macOS — controller as web on this machine (localhost)
./scripts/run-dev.sh --lan     # controller reachable from a phone (auto-detected LAN IP)
```

Both scripts install any missing deps, wire each process's relay URL via
`EXPO_PUBLIC_RELAY_URL`, and bring up relay (`:8787`), the recorder sidecar
(`:8790`, system audio; `node` on Linux, `dotnet run` on Windows), the saver
sidecar (`:8791`, project save/open → `saved_data/`), app
(`:8081`), and controller (`:8082`) — the Windows script opens
Electron/PowerShell windows; the Linux script opens a window per terminal
emulator it can find, and also runs the app in Electron by default (`--web`
opts back to the browser; system audio works either way now that it comes from
the sidecar). On kernels restricting unprivileged user namespaces (recent
Ubuntu), Electron needs a one-time setuid fix on its `chrome-sandbox` after
each npm install — the script detects this and prints the exact sudo command.
Then open the remote screen in the app and enter the shown code in the
controller.

The inference backend (`:8000`) starts by default (it needs the `.venv` from
[Run the inference API](#run-the-inference-api)); pass `-NoBackend` /
`--no-backend` to skip it — the app degrades gracefully without it. If any
port is already taken, the scripts bump to the next free one and print what
moved; `-AppPort`/`-ControllerPort`/`-BackendPort` (or the `--app-port` etc.
long flags) pin them explicitly.

**Or start them by hand,** in this order, each in its own terminal:

```bash
# 1. Relay — the pairing middleman (no npm install needed; zero deps)
cd relay && npm start                 # listens on :8787, binds all interfaces

# 2. App (receiver) — mints + shows a pairing code, actuates commands via SMTC
cd mobile && npm run win:electron:dev # Windows host, for system-audio + SMTC

# 3. Controller (sender) — enter the code, then tap the buttons
cd controller && npm install && npm start
```

Then in the app open the pairing screen (the "remote" entry on Upload), and
enter the shown code in the controller.

**Relay URL wiring:** both `controller/src/config.ts` and
`mobile/src/controller/config.ts` read `EXPO_PUBLIC_RELAY_URL` (falling back to
`http://localhost:8787`). The relay's own listen port reads `RELAY_PORT`
(`relay/server.js`, default 8787). For a same-machine web run, `localhost` is
correct. To drive the controller from a **real phone**, set
`EXPO_PUBLIC_RELAY_URL` to the desktop's LAN IP, e.g.
`EXPO_PUBLIC_RELAY_URL=http://192.168.1.50:8787` before `npm start` in
`controller/` — the relay binds all interfaces and sends CORS `*`, so nothing
else changes. `scripts/run-dev.ps1 -Lan` / `scripts/run-dev.sh --lan` does this
wiring for you, and `scripts/run-dev.ps1 -RelayPort <n>` /
`scripts/run-dev.sh --relay-port <n>` moves the port on the relay and both
clients at once.

## Run everything (with the backend)

The AI-suggestion backend is independent of the controller flow — the app just
pings it on launch and degrades gracefully if it's down. To bring up the full
stack, pass `-Backend` / `--backend` to the run-dev script, or run the
[inference API](#run-the-inference-api) yourself alongside the three processes
above (a fourth terminal):

```bash
uvicorn inference.api:app --reload --port 8000
```

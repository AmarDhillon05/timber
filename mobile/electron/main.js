// Electron main process — a thin desktop shell around the SAME web build the
// browser uses (react-native-web). It adds one Windows superpower: it answers
// getDisplayMedia with the screen + *loopback* (system) audio automatically, so
// the renderer's system-audio handler gets system audio with NO picker dialog.
//
// Two ways to load the app:
//   • dev  — set ELECTRON_START_URL to the Expo web dev server (hot reload).
//   • prod — no env var: serve the static export in ../dist.
//
// IMPORTANT: the Expo web export references its bundle with ABSOLUTE paths
// (e.g. /_expo/static/...). Loading dist/index.html over file:// would resolve
// those against the filesystem root and the app would render nothing (a blank
// window). So in prod we serve dist over a custom `app://` scheme where the
// origin root maps to the dist folder, and absolute paths resolve correctly.
//
// Nothing here is app logic; all capture logic stays in src/ behind the
// src/audio/systemAudio factory, so iOS/web/electron share it untouched.

const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  protocol,
  net,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const DEV_URL = process.env.ELECTRON_START_URL; // e.g. http://localhost:8081
const DIST = path.join(__dirname, '..', 'dist');

// Rendered into the window (instead of an opaque ERR_UNEXPECTED blank page) when
// prod mode is selected but there's no web export to serve. Almost always means
// Electron was launched bare — either it should have been dev mode with a Metro
// server, or the `expo export -p web` step never ran.
function missingBuildPage() {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:15px/1.6 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh"><div style="max-width:560px;padding:32px"><h1 style="color:#f87171;font-size:20px">No web build to load</h1><p>Electron started in <b>prod mode</b> but <code>mobile/dist/index.html</code> doesn't exist.</p><ul><li><b>For hot-reload dev:</b> run <code>npm run win:electron:dev</code> (sets <code>ELECTRON_START_URL</code>). Launching <code>electron</code> directly falls into this broken prod path.</li><li><b>For a packaged build:</b> run <code>npm run win:electron</code>, which runs <code>expo export -p web</code> first.</li></ul></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// Under WSL/WSLg the GPU process fails to initialize (the viz_main_impl /
// GpuControl errors), which can also wedge rendering. Software-render on Linux;
// on real Windows hardware acceleration stays on.
if (process.platform === 'linux') app.disableHardwareAcceleration();

// Must be registered before the app is ready. `standard` gives the scheme a
// real origin so absolute (`/_expo/...`) URLs resolve against the dist root.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveDist() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(DIST, decodeURIComponent(rel));
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f172a', // match the app so there's no white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // Open DevTools so the Console is always available, and shout if the page
  // fails to load instead of silently showing a blank window.
  win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[electron] did-fail-load ${code} ${desc} — ${url}`);
  });

  // Allow camera + mic (getUserMedia) and screen capture. Without this Electron
  // can silently deny these, so the camera preview stays black and the mic
  // records nothing. (The OS-level Windows privacy toggles still apply.)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'display-capture'].includes(permission));
  });

  // Auto-grant screen + system-audio capture. `audio: 'loopback'` is the
  // Electron-on-Windows feature that captures the OS output mix directly, so the
  // renderer never sees the "share your screen" prompt — getDisplayMedia just
  // resolves with a system-audio track. We hand back the primary screen as the
  // (required) video source; the renderer drops it and keeps only the audio.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else if (fs.existsSync(path.join(DIST, 'index.html'))) {
    serveDist();
    win.loadURL('app://local/index.html');
  } else {
    // Prod mode with nothing to serve. Say so clearly instead of letting the
    // app:// fetch reject with a cryptic ERR_UNEXPECTED and a blank window.
    console.error(
      `[electron] No web build at ${DIST}. Run \`npm run win:electron:dev\` for ` +
        'hot reload, or `npm run win:electron` to export + package.',
    );
    win.loadURL(missingBuildPage());
  }
}

app.whenReady().then(() => {
  createWindow();
  // macOS: re-open a window when the dock icon is clicked with none open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows close, except on macOS where apps stay alive.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

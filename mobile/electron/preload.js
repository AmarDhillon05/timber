// Minimal, safe bridge. Exposes a flag so app code *can* tell it's running
// inside the Electron desktop shell (vs a plain browser) — useful e.g. to skip
// the "tick Share system audio" hint, since Electron auto-grants loopback.
//
// Media control used to hang off here too (an IPC bridge onto a WinRT SMTC
// binding in the main process). It doesn't any more: the recorder sidecar does
// media control natively on both Windows and Linux, so the renderer talks to it
// over the same local WebSocket it already uses for system audio — and no
// longer needs Electron for it at all.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform, // 'win32' | 'darwin' | 'linux'
});

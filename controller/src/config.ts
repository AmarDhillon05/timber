// Where the relay lives. Point this at your deployed relay's public URL.
// Overridable at bundle time via EXPO_PUBLIC_RELAY_URL (see run-dev.ps1, which
// wires it per-process); falls back to localhost for a same-machine web run.
// For a real phone, EXPO_PUBLIC_RELAY_URL must be the machine's LAN IP, e.g.
// http://192.168.1.50:8787 — "localhost" would mean the phone itself.
export const RELAY_URL =
  process.env.EXPO_PUBLIC_RELAY_URL ?? 'http://localhost:8787';

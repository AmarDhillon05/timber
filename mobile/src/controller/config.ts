// Where the relay lives. Point this at your deployed relay's public URL.
// Overridable at bundle time via EXPO_PUBLIC_RELAY_URL (run-dev.ps1 wires it);
// falls back to localhost, which is correct for dev since the app and relay run
// on the same machine.
export const RELAY_URL =
  process.env.EXPO_PUBLIC_RELAY_URL ?? 'http://localhost:8787';

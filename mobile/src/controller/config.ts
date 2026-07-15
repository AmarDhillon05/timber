import { Platform } from 'react-native';

// Where the relay lives. Point this at your deployed relay's public URL.
// Overridable at bundle time via EXPO_PUBLIC_RELAY_URL (run-dev wires it per
// process); a dev run always sets it, so the defaults below only matter for a
// bundle built WITHOUT it — i.e. a downloaded phone app.
//
//   - web preview runs on the same machine as the relay, so localhost is right;
//   - a native build is used off-grid on the laptop's hotspot, where the laptop
//     pins itself to 10.42.0.1 (scripts/run-dev.sh --hotspot). That makes this a
//     relay URL a downloaded app can bake in and always find, with no env var.
const DEFAULT_RELAY_URL =
  Platform.OS === 'web' ? 'http://localhost:8787' : 'http://10.42.0.1:8787';

export const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL ?? DEFAULT_RELAY_URL;

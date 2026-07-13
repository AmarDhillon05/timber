import type { MediaController } from './types';

// Media control via the recorder sidecar (see recorder/README.md, "Media
// control"): the same local helper that captures system audio also executes
// transport commands against whatever the machine is playing — MPRIS over
// D-Bus on Linux. Because the sidecar is just ws://localhost, this works in a
// plain browser too, unlike the Electron-IPC path Windows still uses.
//
// Each command is a stateless one-shot, so every call opens its OWN
// short-lived connection (loopback — connecting costs ~1 ms at button-tap
// rate), sends one `media` command, and settles on the id-matched
// `media-result`: resolve on ok, throw the sidecar's message otherwise. No
// connection lifecycle to manage, and it matches the sidecar's "no state
// survives a connection" ethos.

// Same env the systemAudio service reads — one sidecar, one URL.
const RECORDER_URL =
  process.env.EXPO_PUBLIC_RECORDER_URL ?? 'ws://localhost:8790';

// How far the forward10/back10 skips jump, in seconds.
const SKIP_SECONDS = 10;

interface MediaResultEvent {
  event: string;
  id?: number;
  ok?: boolean;
  message?: string;
}

// Correlation ids, in case a command ever shares a connection with other
// traffic (the protocol allows it; today each command has its own socket).
let nextId = 1;

function send(action: string, deltaSeconds?: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const id = nextId++;
    const socket = new WebSocket(RECORDER_URL);

    socket.onerror = () =>
      reject(
        new Error(
          `Recorder sidecar not reachable at ${RECORDER_URL}. Start it: ` +
            `\`node recorder/linux/server.js\` — run-dev does this ` +
            `automatically.`,
        ),
      );

    socket.onopen = () =>
      socket.send(JSON.stringify({ cmd: 'media', id, action, deltaSeconds }));

    socket.onmessage = (msg: MessageEvent) => {
      if (typeof msg.data !== 'string') return; // never expected here
      const event = JSON.parse(msg.data) as MediaResultEvent;
      // Skip the greeting (and anything not ours) — only our reply settles us.
      if (event.event !== 'media-result' || event.id !== id) return;
      socket.close();
      if (event.ok) resolve();
      else reject(new Error(`Media control: ${event.message}`));
    };
  });
}

export function createServiceMediaController(label: string): MediaController {
  return {
    name: label,
    available: true,
    play: () => send('play'),
    pause: () => send('pause'),
    stop: () => send('stop'),
    toggle: () => send('toggle'),
    next: () => send('next'),
    rewind: () => send('rewind'),
    forward10: () => send('seekBy', SKIP_SECONDS),
    back10: () => send('seekBy', -SKIP_SECONDS),
  };
}

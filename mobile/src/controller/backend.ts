import { RELAY_URL } from './config';
import type {
  ControlCommand,
  MicEvent,
  PhoneCommandType,
  ReceiverBackend,
} from './types';

// Receiver half of the relay protocol, for the DESKTOP. It asks the relay for a
// pairing code, opens an OUTBOUND SSE stream, and routes pushed events:
//   event: paired  → the phone confirmed the code (→ onPaired)
//   event: mic     → phone-mic traffic: state changes + audio chunks (→ onMic)
//   (default)      → a control command (→ onControl listeners → media executor)
//
// The desktop can also push to the phone (mic-start / mic-stop) via
// POST /phone/command — the relay forwards it down the phone's own SSE stream.
//
// EventSource is a browser/renderer API (Chromium / react-native-web); the
// desktop runs as the web/Electron build, so it's available here. Both the
// fetch and the EventSource are outbound, so the desktop never exposes anything.
export function createReceiverBackend(): ReceiverBackend {
  const listeners = new Set<(command: ControlCommand) => void>();
  const micListeners = new Set<(event: MicEvent) => void>();
  let es: EventSource | null = null;
  let token: string | null = null;

  return {
    async requestCode(onPaired, onDrop) {
      es?.close(); // re-request: never leave a previous stream double-firing

      const res = await fetch(`${RELAY_URL}/pair/request`, { method: 'POST' });
      const minted = await res.json();
      token = minted.token as string;

      const stream = new EventSource(`${RELAY_URL}/events?token=${token}`);
      es = stream;

      // One-shot teardown shared by both death paths ('unpaired' and a fatal
      // stream error) — they can race, and onDrop must fire exactly once.
      let dropped = false;
      const drop = (reason: string) => {
        if (dropped) return;
        dropped = true;
        stream.close();
        if (es === stream) {
          es = null;
          token = null;
        }
        onDrop(reason);
      };

      stream.addEventListener('paired', () => onPaired());
      stream.addEventListener('unpaired', () => {
        console.log('[desktop] phone unpaired — dropping the pairing');
        drop('The phone disconnected.');
      });
      stream.addEventListener('mic', (e) => {
        const event = JSON.parse((e as MessageEvent).data) as MicEvent;
        micListeners.forEach((l) => l(event));
      });
      stream.onmessage = (e) => {
        const command = JSON.parse(e.data) as ControlCommand;
        console.log(`[desktop] command '${command.type}' received from relay`);
        listeners.forEach((l) => l(command));
      };
      stream.onerror = () => {
        // CONNECTING means EventSource is auto-retrying a blip — let it. CLOSED
        // is fatal (e.g. the relay restarted and forgot the token): the pairing
        // can never recover, so surface it instead of looking paired forever.
        if (stream.readyState !== EventSource.CLOSED) {
          console.log('[desktop] relay stream interrupted — retrying');
          return;
        }
        console.log('[desktop] relay stream closed — pairing lost');
        drop('Lost the connection to the relay — pair again.');
      };
      return minted.code as string;
    },

    onControl(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onMic(listener) {
      micListeners.add(listener);
      return () => micListeners.delete(listener);
    },

    async sendPhoneCommand(type) {
      if (!token) throw new Error('Not paired — no phone to command.');
      const res = await fetch(`${RELAY_URL}/phone/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, type }),
      });
      if (!res.ok) throw new Error(`Phone command '${type}' failed (${res.status}).`);
    },

    reset() {
      // Best-effort goodbye so the relay drops the room and tells the phone
      // (its next send would 403 anyway; this just makes it immediate).
      if (token) {
        void fetch(`${RELAY_URL}/unpair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, role: 'desktop' }),
        }).catch(() => {});
      }
      es?.close();
      es = null;
      token = null;
    },
  };
}

// App-wide singleton so the store (pairing) and the executor (onControl) share
// one stream. The real backend swaps in here.
let instance: ReceiverBackend | null = null;
export function receiverBackend(): ReceiverBackend {
  if (!instance) instance = createReceiverBackend();
  return instance;
}

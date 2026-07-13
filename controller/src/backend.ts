import { RELAY_URL } from './config';
import type { ControlCommand, PhoneCommand } from './types';

// Sender half of the relay protocol. The phone CONFIRMS the code shown on the
// desktop, then POSTs commands; the relay pushes them down the desktop's SSE
// stream. Command sending holds nothing open — each send is a plain fetch, so
// the phone never needs to be reachable.
//
// Mic streaming is the one exception: while the mic is enabled the phone holds
// its own OUTBOUND SSE stream (/phone/events) so the desktop can start/stop the
// recorder in step with its take. EventSource is a browser API, so the mic path
// is web-only (run the controller in the phone's browser); the command buttons
// still work everywhere.
// Thrown by send() when the relay rejects a command, so the store can tell a
// dead pairing (403 — the room is gone) from a desktop that merely dropped its
// stream (409) or a plain network failure (fetch rejects with TypeError).
export class CommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SenderBackend {
  /** Confirm the desktop's code; true on success (and we hold the pair token). */
  confirm(code: string): Promise<boolean>;
  /** POST a control command to the paired desktop. Throws CommandError on rejection. */
  send(command: ControlCommand): Promise<void>;
  /** Best-effort goodbye so the desktop's UI resets instead of waiting forever. */
  sendUnpair(): Promise<void>;
  /** Open the phone's SSE stream and route desktop mic requests to `onCommand`. */
  openPhoneEvents(onCommand: (command: PhoneCommand) => void): void;
  /** Close the phone's SSE stream (mic disabled). */
  closePhoneEvents(): void;
  /** POST a mic lifecycle event (ready / started / ended / off). */
  sendMicEvent(event: Record<string, unknown>): Promise<void>;
  /** POST one recorded audio chunk, raw (the relay base64s it for SSE). */
  sendMicChunk(seq: number, chunk: Blob): Promise<void>;
  /** Forget the pairing. */
  reset(): void;
}

export function createSenderBackend(): SenderBackend {
  let token: string | null = null;
  let phoneEs: EventSource | null = null;

  // The classic "buttons do nothing" cause is this URL: on a real phone it must
  // be the desktop machine's LAN IP, not the localhost fallback.
  console.log(`[controller] using relay ${RELAY_URL}`);

  const requireToken = (): string => {
    if (!token) throw new Error('Not paired — confirm a code first.');
    return token;
  };

  return {
    async confirm(code) {
      const res = await fetch(`${RELAY_URL}/pair/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) return false;
      ({ token } = await res.json());
      return true;
    },

    async send(command) {
      const t = requireToken();
      console.log(`[controller] send '${command.type}' -> relay`);
      const res = await fetch(`${RELAY_URL}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t, ...command }),
      });
      if (!res.ok) {
        console.log(`[controller] send '${command.type}' failed (${res.status})`);
        throw new CommandError(`Command failed (${res.status}).`, res.status);
      }
      console.log(`[controller] send '${command.type}' delivered`);
    },

    async sendUnpair() {
      if (!token) return;
      try {
        await fetch(`${RELAY_URL}/unpair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, role: 'phone' }),
        });
      } catch {
        // Best-effort — a missed goodbye just means the desktop finds out later.
      }
    },

    openPhoneEvents(onCommand) {
      const t = requireToken();
      phoneEs?.close();
      phoneEs = new EventSource(`${RELAY_URL}/phone/events?token=${t}`);
      phoneEs.onmessage = (e) => onCommand(JSON.parse(e.data) as PhoneCommand);
    },

    closePhoneEvents() {
      phoneEs?.close();
      phoneEs = null;
    },

    async sendMicEvent(event) {
      const t = requireToken();
      const res = await fetch(`${RELAY_URL}/mic/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t, ...event }),
      });
      if (!res.ok) throw new Error(`Mic event failed (${res.status}).`);
    },

    async sendMicChunk(seq, chunk) {
      const t = requireToken();
      const res = await fetch(
        `${RELAY_URL}/mic/chunk?token=${t}&seq=${seq}`,
        { method: 'POST', body: chunk },
      );
      if (!res.ok) throw new Error(`Mic chunk ${seq} failed (${res.status}).`);
    },

    reset() {
      phoneEs?.close();
      phoneEs = null;
      token = null;
    },
  };
}

// App-wide singleton so the store shares one pairing token.
let instance: SenderBackend | null = null;
export function senderBackend(): SenderBackend {
  if (!instance) instance = createSenderBackend();
  return instance;
}

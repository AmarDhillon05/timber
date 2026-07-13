import { create } from 'zustand';
import { CommandError, senderBackend } from './backend';
import { RELAY_URL } from './config';
import type { ControlCommand, MicStatus, PairingStatus, PhoneCommand } from './types';

// Reactive pairing + send state for the controller. Mirrors the desktop's
// zustand style. Sending is gated on pairing so the buttons can't fire early.
//
// The mic half turns the phone into a remote microphone: `enableMic` grabs the
// mic (the permission prompt must ride a user tap), opens the phone's SSE
// stream, and announces `ready`. The DESKTOP then starts/stops the actual
// recorder via mic-start/mic-stop so capture begins exactly when its take does.
// Chunks stream up as they're cut (500 ms timeslices); the desktop reassembles.
// Web-only (getUserMedia/MediaRecorder/EventSource) — run the controller in the
// phone's browser to use it.

// The live capture plumbing is held at module level (like the backend
// singleton): a MediaStream and MediaRecorder aren't reactive state.
let micStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let seq = 0;
let startedAt = 0;

interface ControllerState {
  status: PairingStatus;
  mic: MicStatus;
  /**
   * True while the desktop is rolling a take. Pushed down our stream by the
   * desktop, so this stays honest whether the take was started from this phone
   * or from the laptop itself — the button never lies about the state.
   */
  taking: boolean;
  /** Last error surfaced to the UI (e.g. a wrong code); cleared on retry. */
  error: string | null;

  /** Confirm the code shown on the desktop; on success the buttons unlock. */
  confirm: (code: string) => Promise<void>;
  /**
   * Send a control command. Never throws — failures land in `error`, and a
   * dead pairing (the relay forgot the token) drops back to the code screen.
   */
  send: (command: ControlCommand) => Promise<void>;
  /** Share this phone's mic with the desktop (prompts for permission). */
  enableMic: () => Promise<void>;
  /** Stop sharing the mic and release it. */
  disableMic: () => Promise<void>;
  /** Drop the pairing and return to the code entry screen. */
  unpair: () => void;
}

export const useController = create<ControllerState>((set, get) => {
  // Desktop said mic-start: cut a fresh recorder on the held stream. A webm
  // stream is only valid from a recorder boundary, so each take gets its own
  // MediaRecorder rather than slicing a long-running one.
  const startStreaming = () => {
    // We now hold this stream open for the whole pairing, so a mic-start can
    // reach us with the mic OFF (the user disabled it just as a take began).
    // Don't throw — that would die inside the SSE handler and leave the desktop
    // waiting on a 'started' that can never come. Correct its view instead.
    if (!micStream) {
      console.log('[controller] mic-start with no mic — telling the desktop');
      void senderBackend().sendMicEvent({ kind: 'off' });
      return;
    }
    const backend = senderBackend();
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const rec = new MediaRecorder(micStream, { mimeType });
    seq = 0;
    rec.ondataavailable = (e) => {
      if (e.data.size) void backend.sendMicChunk(seq++, e.data);
    };
    // 'started' is the desktop's alignment signal — its take start awaits it —
    // so send it from onstart (when capture truly began), not after rec.start().
    rec.onstart = () => {
      startedAt = performance.now();
      void backend.sendMicEvent({ kind: 'started' });
    };
    rec.onstop = () => {
      // The final ondataavailable has already fired by now, so `seq` is the
      // total chunk count the desktop should wait for.
      void backend.sendMicEvent({
        kind: 'ended',
        chunks: seq,
        durationSec: (performance.now() - startedAt) / 1000,
      });
      set({ mic: 'ready' });
    };
    rec.start(500); // cut a chunk every 500 ms
    recorder = rec;
    set({ mic: 'streaming' });
  };

  const stopStreaming = () => {
    recorder?.stop();
    recorder = null;
  };

  // Releases the MIC only — the phone's event stream is pairing-scoped now (the
  // desktop pushes take state down it whether or not we're a microphone), so
  // it's torn down in unpair/dropPairing, not here.
  const releaseMic = () => {
    stopStreaming();
    micStream?.getTracks().forEach((t) => t.stop());
    micStream = null;
  };

  // The pairing is dead (relay restarted, desktop unpaired, …): drop back to
  // the code screen and say why, instead of leaving buttons that go nowhere.
  const dropPairing = (message: string) => {
    releaseMic();
    senderBackend().reset(); // also closes the event stream
    set({ status: 'unpaired', mic: 'off', taking: false, error: message });
  };

  // Everything the desktop pushes at us, on the stream we hold for the whole
  // pairing. mic-start/stop drive the recorder; take-started/stopped keep the
  // take buttons honest; unpaired is the goodbye.
  const handleCommand = (command: PhoneCommand) => {
    if (command.type === 'mic-start') startStreaming();
    if (command.type === 'mic-stop') stopStreaming();
    if (command.type === 'take-started') set({ taking: true });
    if (command.type === 'take-stopped') set({ taking: false });
    if (command.type === 'unpaired') dropPairing('The desktop disconnected.');
  };

  return {
    status: 'unpaired',
    mic: 'off',
    taking: false,
    error: null,

    confirm: async (code) => {
      try {
        const ok = await senderBackend().confirm(code);
        if (!ok) {
          set({ error: 'That code did not match. Try again.' });
          return;
        }
        // Open our stream immediately, not just when the mic is enabled: it's
        // how the desktop tells us a take started (and how we hear a goodbye).
        senderBackend().openPhoneEvents(handleCommand);
        set({ status: 'paired', taking: false, error: null });
      } catch {
        set({ error: `Can't reach the relay at ${RELAY_URL}.` });
      }
    },

    send: async (command) => {
      if (get().status !== 'paired') return;
      try {
        await senderBackend().send(command);
        if (get().error) set({ error: null }); // a working button clears stale banners
      } catch (err) {
        if (err instanceof CommandError && err.status === 403) {
          // The relay no longer knows our token (restart, or desktop unpaired).
          dropPairing('Connection lost — pair again with a new code.');
        } else if (err instanceof CommandError && err.status === 409) {
          set({ error: 'Desktop is offline — is Timber still running?' });
        } else if (err instanceof CommandError) {
          set({ error: err.message });
        } else {
          set({ error: `Can't reach the relay at ${RELAY_URL}.` });
        }
      }
    },

    enableMic: async () => {
      if (get().status !== 'paired') return;
      try {
        // The stream that carries mic-start/mic-stop is already open (we opened
        // it when we paired); all that's left is to grab the mic and announce it.
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await senderBackend().sendMicEvent({ kind: 'ready' });
        set({ mic: 'ready', error: null });
      } catch (err) {
        releaseMic(); // don't hold the mic (and its indicator light) on failure
        set({
          error:
            err instanceof Error && err.name === 'NotAllowedError'
              ? 'Mic permission was denied — allow it and try again.'
              : 'Could not share the mic — check the connection.',
        });
      }
    },

    disableMic: async () => {
      releaseMic();
      set({ mic: 'off' });
      try {
        await senderBackend().sendMicEvent({ kind: 'off' });
      } catch {
        // Already released locally; the desktop learns via unpair or its stream.
      }
    },

    unpair: () => {
      releaseMic(); // no 'off' send — the token is being dropped anyway
      void senderBackend().sendUnpair(); // goodbye, so the desktop's UI resets too
      senderBackend().reset(); // also closes the event stream
      set({ status: 'unpaired', mic: 'off', taking: false, error: null });
    },
  };
});

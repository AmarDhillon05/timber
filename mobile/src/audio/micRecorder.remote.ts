import { receiverBackend } from '../controller/backend';
import type { MicRecorder, MicRecording } from './micRecorder.types';

// The paired phone as one more recording device. Implements the same
// MicRecorder contract as the local recorders (micRecorder.ts /
// micRecorder.web.ts); RecordScreen runs it ALONGSIDE the laptop mic whenever
// the phone is sharing, and each lands as its own track — only the audio here
// comes over the relay:
//
//   start() → mic-start to the phone, resolves when its recorder reports
//             'started' (so the take timeline aligns on actual capture, not on
//             the request round-trip)
//   …       → the phone streams 500 ms webm/opus chunks, collected here by seq
//             (POSTs can arrive out of order)
//   stop()  → mic-stop, then waits for 'ended' (which carries the total chunk
//             count + duration) AND every chunk, reassembles the blob
//
// Only valid while the controller store reports `remoteMic` (the phone is
// sharing). Desktop-side this is web/Electron-only, like the rest of the
// controller plumbing (EventSource).

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// How long to wait for the phone's recorder to report it actually began. The
// phone can legitimately fail to start (the user switched its mic off just as
// the take began, or it went to sleep), and a take that waits forever for a
// 'started' that never comes is worse than one that records without the phone.
const START_TIMEOUT_MS = 5000;

export function createRemoteMicRecorder(): MicRecorder {
  const backend = receiverBackend();
  const chunks = new Map<number, Uint8Array>();
  let ended: { chunks: number; durationSec: number } | null = null;
  let unsubscribe: (() => void) | null = null;
  let onStarted: (() => void) | null = null;
  // Re-checked on every arrival while stop() waits for the tail chunks.
  let onProgress: (() => void) | null = null;

  const release = () => {
    unsubscribe?.();
    unsubscribe = null;
    chunks.clear();
  };

  return {
    async start() {
      const started = new Promise<void>((resolve, reject) => {
        onStarted = resolve;
        // The phone answers an impossible mic-start with 'off' rather than
        // silence, but a phone that has simply gone away answers with nothing —
        // so bound the wait either way.
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `The phone's mic never started (waited ${START_TIMEOUT_MS / 1000}s).`,
              ),
            ),
          START_TIMEOUT_MS,
        );
        onStarted = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      unsubscribe = backend.onMic((event) => {
        if (event.kind === 'started') onStarted?.();
        if (event.kind === 'chunk') {
          chunks.set(event.seq, base64ToBytes(event.data));
          onProgress?.();
        }
        if (event.kind === 'ended') {
          ended = { chunks: event.chunks, durationSec: event.durationSec };
          onProgress?.();
        }
      });
      await backend.sendPhoneCommand('mic-start');
      try {
        await started;
      } catch (err) {
        release(); // don't leave a dead subscription behind on the next take
        throw err;
      }
    },

    async stop(): Promise<MicRecording> {
      if (!unsubscribe) throw new Error('Remote mic was never started');
      await backend.sendPhoneCommand('mic-stop');
      // Wait until the phone has said how many chunks there are and they have
      // all landed ('ended' can outrun the last chunk POSTs).
      await new Promise<void>((resolve) => {
        onProgress = () => {
          if (ended && chunks.size >= ended.chunks) resolve();
        };
        onProgress();
      });
      const total = ended!;
      const parts = [...chunks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, bytes]) => bytes as BlobPart);
      release();
      const blob = new Blob(parts, { type: 'audio/webm' });
      return {
        uri: URL.createObjectURL(blob),
        ext: '.webm',
        durationSec: total.durationSec,
      };
    },

    cancel() {
      if (unsubscribe) void backend.sendPhoneCommand('mic-stop');
      release();
    },
  };
}

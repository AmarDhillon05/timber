import type { SystemAudioRecorder, SystemAudioResult } from './types';

// System-audio capture via the recorder sidecar (see recorder/README.md): a
// standalone helper — recorder/linux or recorder/windows, same protocol, same
// port — that does NATIVE loopback capture (PipeWire monitor / WASAPI) and
// streams raw PCM to us over a local WebSocket. Replaces the getDisplayMedia
// screen-share path: no picker, no fake video track, no tab-vs-system
// ambiguity, and it works in a plain browser on any OS the helper supports.
//
// Protocol here, briefly: text frames are JSON events (hello/started/ended/
// error), binary frames are raw PCM in the format the latest `hello`
// announced. stop() wraps the collected PCM in a WAV header and hands back an
// object URL, exactly like the other handlers.
//
// Per the project's error policy nothing is caught into a friendly fallback:
// a missing helper fails arm() with the command that starts it.

const RECORDER_URL =
  process.env.EXPO_PUBLIC_RECORDER_URL ?? 'ws://localhost:8790';

interface WireFormat {
  encoding: 's16le' | 'f32le';
  sampleRate: number;
  channels: number;
}

interface RecorderEvent {
  event: 'hello' | 'started' | 'ended' | 'error';
  name?: string;
  format?: WireFormat;
  message?: string;
}

// Wrap raw interleaved PCM in a 44-byte WAV header. Unlike wav.ts (which
// downmixes decoded Float32 channels for the inference API), this keeps the
// capture byte-for-byte: format tag 1 for s16le, 3 (IEEE float) for f32le.
function wrapWav(pcm: Uint8Array, format: WireFormat): ArrayBuffer {
  const bytesPerSample = format.encoding === 'f32le' ? 4 : 2;
  const blockAlign = format.channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + pcm.length);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format.encoding === 'f32le' ? 3 : 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.length, true);
  new Uint8Array(buffer, 44).set(pcm);
  return buffer;
}

export function createServiceSystemAudio(
  label = `recorder sidecar (${RECORDER_URL})`,
): SystemAudioRecorder {
  let ws: WebSocket | null = null;
  let format: WireFormat | null = null;
  let chunks: Uint8Array[] = [];
  // Resolves the in-flight stop() when `ended` arrives; a service `error`
  // event rejects it (or throws at the next call if nothing is in flight).
  let onEnded: (() => void) | null = null;
  let onError: ((err: Error) => void) | null = null;

  const release = () => {
    ws?.close();
    ws = null;
    format = null;
    chunks = [];
    onEnded = null;
    onError = null;
  };

  return {
    name: label,

    get armed() {
      return ws !== null && ws.readyState === WebSocket.OPEN;
    },

    // Connect and wait for `hello`. "Interactive" for the other handlers meant
    // a permission prompt; here it's just the one place a missing helper can
    // fail early and loudly instead of mid-take.
    async arm() {
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(RECORDER_URL);
        socket.binaryType = 'arraybuffer';

        socket.onerror = () =>
          reject(
            new Error(
              `Recorder sidecar not reachable at ${RECORDER_URL}. Start it: ` +
                `\`node recorder/linux/server.js\` (Linux) or ` +
                `\`dotnet run --project recorder/windows\` (Windows) — ` +
                `run-dev does this automatically.`,
            ),
          );

        socket.onmessage = (msg: MessageEvent) => {
          if (typeof msg.data !== 'string') {
            chunks.push(new Uint8Array(msg.data as ArrayBuffer));
            return;
          }
          const event = JSON.parse(msg.data) as RecorderEvent;
          switch (event.event) {
            case 'hello':
              // May arrive again after start (Windows re-announces the live
              // device format) — always adopt the latest.
              format = event.format ?? null;
              ws = socket;
              resolve();
              return;
            case 'started':
              return; // alignment signal; capture bytes follow
            case 'ended':
              onEnded?.();
              onEnded = null;
              return;
            case 'error': {
              const err = new Error(`Recorder sidecar: ${event.message}`);
              if (onError) onError(err);
              else throw err;
              return;
            }
          }
        };

        socket.onclose = () => {
          if (ws === socket) ws = null;
        };
      });
    },

    start() {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('System audio not armed — call arm() first.');
      }
      chunks = [];
      ws.send(JSON.stringify({ cmd: 'start' }));
    },

    async stop(): Promise<SystemAudioResult> {
      const socket = ws;
      if (!socket) throw new Error('System audio capture was never started.');

      await new Promise<void>((resolve, reject) => {
        onEnded = resolve;
        onError = reject;
        socket.send(JSON.stringify({ cmd: 'stop' }));
      });

      const fmt = format;
      if (!fmt) throw new Error('Recorder sidecar never announced a format.');
      const pcm = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        pcm.set(c, offset);
        offset += c.length;
      }
      release();

      const bytesPerSample = fmt.encoding === 'f32le' ? 4 : 2;
      const durationSec =
        pcm.length / (fmt.sampleRate * fmt.channels * bytesPerSample);
      const blob = new Blob([wrapWav(pcm, fmt)], { type: 'audio/wav' });
      return {
        uri: URL.createObjectURL(blob),
        mimeType: 'audio/wav',
        ext: '.wav',
        durationSec,
      };
    },

    cancel() {
      // Dropping the connection kills any capture server-side.
      release();
    },
  };
}

// The desktop is the RECEIVER side of the relay protocol: it mints a pairing
// code, holds an SSE stream open, and actuates the control commands that arrive
// on it (via the mediaSession factory → SMTC). The phone controller (a separate
// app) is the sender.
//
// Transport is abstracted behind ReceiverBackend so the SSE implementation can
// be swapped without touching the store, the executor, or React.

// unpaired → awaiting-confirmation (code shown, listening) → paired.
export type PairingStatus = 'unpaired' | 'awaiting-confirmation' | 'paired';

// Transport commands: these mirror the MediaController surface, so each maps
// 1:1 onto a native media-session action (SMTC / MPRIS, via the sidecar).
export type MediaCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'stop' }
  | { type: 'rewind' }
  | { type: 'forward10' }
  | { type: 'back10' };

// Take commands: these drive THIS app's recorder rather than the OS's playback,
// so they're actuated by the Record page (useRemoteTake), not the media
// executor. Start doubles as "go to the Record page" — the desktop may be
// sitting anywhere when the drummer hits the button from across the room.
export type TakeCommand = { type: 'take-start' } | { type: 'take-stop' };

// Everything a paired controller can fire.
export type ControlCommand = MediaCommand | TakeCommand;

const TAKE_TYPES = ['take-start', 'take-stop'] as const;

export const isTakeCommand = (c: ControlCommand): c is TakeCommand =>
  (TAKE_TYPES as readonly string[]).includes(c.type);

// What the desktop pushes down the phone's own SSE stream:
//   mic-start/stop   drive the phone's mic recorder in step with a take
//   take-started/    tell the remote a take is (no longer) rolling, so its
//   take-stopped     buttons can show REC instead of lying about the state
//
// The phone holds this stream open for the whole pairing (not just while its
// mic is on), so take state reaches it whether or not it's being used as a mic.
export type PhoneCommandType =
  | 'mic-start'
  | 'mic-stop'
  | 'take-started'
  | 'take-stopped';

// Everything the phone's mic reports back, multiplexed on the desktop stream
// under the named 'mic' SSE event:
//   ready/off   the user toggled mic sharing on the phone
//   started     the recorder actually began capturing (take-alignment signal)
//   chunk       one base64 timeslice of the webm/opus stream, ordered by seq
//   ended       the recorder stopped; `chunks` says how many seqs to wait for
export type MicEvent =
  | { kind: 'ready' }
  | { kind: 'off' }
  | { kind: 'started' }
  | { kind: 'chunk'; seq: number; data: string }
  | { kind: 'ended'; chunks: number; durationSec: number };

export interface ReceiverBackend {
  /**
   * Begin pairing: ask the relay for a code, open the SSE stream, and start
   * listening. Resolves with the code to display. `onPaired` fires when the
   * phone confirms it; `onDrop` fires (once, with a reason to show) if the
   * pairing dies underneath us — the phone unpaired, or the stream failed
   * fatally (e.g. the relay restarted and forgot the token).
   */
  requestCode(onPaired: () => void, onDrop: (reason: string) => void): Promise<string>;
  /**
   * Subscribe to controls arriving on the stream (the media executor). Returns
   * an unsubscribe fn.
   */
  onControl(listener: (command: ControlCommand) => void): () => void;
  /** Subscribe to phone-mic events (state changes + audio chunks). */
  onMic(listener: (event: MicEvent) => void): () => void;
  /** Ask the paired phone to start/stop its mic recorder. */
  sendPhoneCommand(type: PhoneCommandType): Promise<void>;
  /** Close the stream and forget the pairing. */
  reset(): void;
}

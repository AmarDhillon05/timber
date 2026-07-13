// Pairing on the controller is two-state: you're either entering a code or
// connected. (The desktop has the richer flow — it mints + shows the code.)
export type PairingStatus = 'unpaired' | 'paired';

// The commands a paired controller can fire. Two families:
//   transport   mirrors the desktop's MediaController surface, so each maps 1:1
//               onto a native media-session action downstream (SMTC / MPRIS)
//   take        drives the DESKTOP APP's recorder instead of the OS's playback:
//               start rolling / stop rolling, from behind the kit
export type ControlCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'stop' }
  | { type: 'rewind' }
  | { type: 'forward10' }
  | { type: 'back10' }
  | { type: 'take-start' }
  | { type: 'take-stop' };

// Phone-mic streaming: once the user enables the mic, the phone holds its own
// SSE stream open and the DESKTOP drives the recorder over it — capture must
// start exactly when the desktop's take starts (a webm stream is only valid
// from a recorder boundary).
//
// off → ready (mic enabled, stream held, announced to the desktop)
//     → streaming (desktop sent mic-start; chunks are flowing) → ready …
export type MicStatus = 'off' | 'ready' | 'streaming';

// What the desktop can ask/tell the phone, pushed down /phone/events. The
// stream is held open for the whole pairing (not just while the mic is on), so
// take state and the unpair goodbye always arrive.
//
//   mic-start/stop   drive this phone's mic recorder in step with the take
//   take-started/    the desktop is (no longer) rolling — however it was
//   take-stopped     triggered, so our buttons never lie about the state
//   unpaired         the relay's goodbye when the desktop tears the pairing down
export type PhoneCommand =
  | { type: 'mic-start' }
  | { type: 'mic-stop' }
  | { type: 'take-started' }
  | { type: 'take-stopped' }
  | { type: 'unpaired' };

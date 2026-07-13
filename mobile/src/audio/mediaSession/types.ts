// A platform-agnostic contract for controlling whatever media is CURRENTLY
// PLAYING on the host — i.e. external apps (Spotify, a browser tab, …), the same
// sources the system-audio loopback capture records. This is the inverse of
// SystemAudioRecorder: that one listens to the output mix, this one drives it.
//
// On Windows this is backed by the OS "current media session" (SMTC /
// GlobalSystemMediaTransportControls). Concrete handlers live alongside this
// file; the factory in ./index picks one based on the host. Hosts that can't
// reach another app's playback (a plain browser, iOS) get a handler that names
// why and throws if used — per the project's no-swallow-errors policy.
//
// All commands target the OS-chosen *current* session. They're best-effort: an
// app may not honour every transport command, so a call resolving doesn't
// guarantee the source obeyed — it means the request was delivered.

export interface MediaController {
  /** Short label for logs/UI, e.g. "Windows · SMTC". */
  readonly name: string;
  /** True when this host can actually drive external playback. */
  readonly available: boolean;
  /** Resume the current session. */
  play(): Promise<void>;
  /** Pause the current session, leaving position intact. */
  pause(): Promise<void>;
  /**
   * Toggle play/pause on the current session. The OS resolves which way it
   * flips, so a stateless remote can drive it without knowing playback state.
   */
  toggle(): Promise<void>;
  /** Skip to the next track in the current session. */
  next(): Promise<void>;
  /** Stop the current session (stronger than pause; some apps treat it as pause). */
  stop(): Promise<void>;
  /**
   * "Rewind" the current session. Semantics are host-defined and deliberately
   * left to the handler: either jump to the start of the current track
   * (seek-to-0) or skip to the previous track — see ./windows for the toggle.
   */
  rewind(): Promise<void>;
  /** Skip forward 10s within the current track (clamped to its end). */
  forward10(): Promise<void>;
  /** Skip back 10s within the current track (clamped to its start). */
  back10(): Promise<void>;
}

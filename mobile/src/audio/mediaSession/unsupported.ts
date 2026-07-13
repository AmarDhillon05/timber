import type { MediaController } from './types';

// Fallback for hosts that can't reach another app's playback: a plain browser
// (the web MediaSession API only lets a page expose its OWN media to the OS, not
// control other apps), iOS (sandboxed), and macOS/Linux until a native handler
// is wired up. It carries the reason so the UI can explain itself, and — per the
// project's error policy — throws loudly if anyone tries to drive playback.
export function createUnsupportedMediaController(reason: string): MediaController {
  const fail = (): Promise<never> => {
    throw new Error(`Media-session control isn't available here: ${reason}`);
  };
  return {
    name: `unsupported (${reason})`,
    available: false,
    play: fail,
    pause: fail,
    stop: fail,
    toggle: fail,
    next: fail,
    rewind: fail,
    forward10: fail,
    back10: fail,
  };
}

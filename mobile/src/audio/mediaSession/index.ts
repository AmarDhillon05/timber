import { detectHostOS } from '../systemAudio';
import { createServiceMediaController } from './service';
import { createUnsupportedMediaController } from './unsupported';
import type { MediaController } from './types';

export type { MediaController } from './types';

// Factory: hand back the controller for whatever host we're on — the mirror of
// createSystemAudioRecorder, reusing its host detection.
//
// Controlling another app's playback needs the OS "current media session,"
// which a web page can't reach on its own (the browser MediaSession API only
// exposes the page's OWN media to the OS). So, exactly like system-audio
// capture, we delegate to the RECORDER SIDECAR (recorder/README.md), which does
// it natively: MPRIS over D-Bus on Linux, SMTC on Windows. Same protocol, same
// port, so this one handler covers both — and it works in a plain browser, no
// Electron required.
//
// macOS is possible later (private frameworks, and no sidecar exists for it
// yet); iOS never. Hosts without a sidecar get a controller that names why and
// throws if used.
export function createMediaController(): MediaController {
  const os = detectHostOS();

  if (os === 'windows' || os === 'linux') {
    return createServiceMediaController(`${os} · recorder sidecar`);
  }
  return createUnsupportedMediaController(`${os} not supported`);
}

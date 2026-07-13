import { useEffect } from 'react';
import { receiverBackend } from './backend';
import { createMediaController } from '../audio/mediaSession';
import { isTakeCommand } from './types';
import type { ControlCommand, MediaCommand } from './types';

// The RECEIVER side: subscribe to controls arriving on the channel and actuate
// them on this host's media (SMTC via the mediaSession factory). Mount once near
// the app root on whichever build is the "executor" (the desktop). A sender-only
// build (a phone remote) simply doesn't mount it.
export function useMediaExecutor() {
  useEffect(() => {
    const media = createMediaController();
    // Only the executor host (the desktop, where SMTC works) actuates controls.
    // On a sender-only build (the phone remote) media.available is false, so we
    // never subscribe — its own sent commands aren't echoed into a dead handler.
    if (!media.available) return;

    const actuate = (command: MediaCommand): Promise<void> => {
      switch (command.type) {
        case 'play':
          return media.play();
        case 'pause':
          return media.pause();
        case 'toggle':
          return media.toggle();
        case 'next':
          return media.next();
        case 'stop':
          return media.stop();
        case 'rewind':
          return media.rewind();
        case 'forward10':
          return media.forward10();
        case 'back10':
          return media.back10();
      }
    };

    const run = (command: ControlCommand) => {
      // Take start/stop drive our own recorder, not the OS's playback — the
      // controller store parks them for the Record page (see useRemoteTake).
      if (isTakeCommand(command)) return;
      console.log(`[desktop] executing '${command.type}'`);
      // The user is across the room holding the phone, so a thrown error here
      // reaches nobody — log the reason (dead sidecar, no player running) where
      // it can actually be read. The phone's button gets no failure signal: the
      // relay's 200 only means "delivered to the desktop", not "the OS obeyed".
      void actuate(command).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[desktop] '${command.type}' failed: ${reason}`);
      });
    };

    return receiverBackend().onControl(run);
  }, []);
}

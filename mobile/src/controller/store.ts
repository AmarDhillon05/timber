import { create } from 'zustand';
import { receiverBackend } from './backend';
import { isTakeCommand, type PairingStatus, type TakeCommand } from './types';

// Reactive pairing state for the desktop, matching the project's zustand style
// (see state/session). The desktop mints + shows a code and waits for the phone
// to confirm; it never sends controls — it receives and executes them (see
// useMediaExecutor for transport, useRemoteTake for take start/stop).
//
// Lifecycle: unpaired --requestCode--> awaiting-confirmation --(phone confirms)-->
// paired.

interface ControllerState {
  status: PairingStatus;
  /** The code to show on the desktop while awaiting confirmation. */
  code: string | null;
  /** True while the paired phone is sharing its mic (RecordScreen offers it). */
  remoteMic: boolean;
  /** Why the pairing ended without the user asking (phone left, relay lost). */
  notice: string | null;
  /**
   * A take start/stop the phone asked for and the Record page hasn't actuated
   * yet. Parked here (rather than fired at a callback) because the desktop may
   * not even be ON the Record page when it arrives — App routes there first,
   * then useRemoteTake picks this up and clears it.
   */
  takeRequest: TakeCommand['type'] | null;

  /** Begin pairing: fetch + show a code and start listening. */
  requestCode: () => Promise<void>;
  /** Consume the pending take request (the Record page has actuated it). */
  clearTakeRequest: () => void;
  /** Drop the pairing and return to unpaired. */
  unpair: () => void;
}

export const useController = create<ControllerState>((set) => {
  // Track the phone mic's availability from its lifecycle events. Chunk/started/
  // ended traffic belongs to the remote mic recorder (audio/micRecorder.remote),
  // not the store — only the on/off edges are reactive state.
  receiverBackend().onMic((event) => {
    if (event.kind === 'ready') set({ remoteMic: true });
    if (event.kind === 'off') set({ remoteMic: false });
  });

  // Take commands are the one kind of control that drives THIS app rather than
  // the OS's playback, so they land in the store instead of the media executor.
  receiverBackend().onControl((command) => {
    if (isTakeCommand(command)) set({ takeRequest: command.type });
  });

  return {
    status: 'unpaired',
    code: null,
    remoteMic: false,
    notice: null,
    takeRequest: null,

    requestCode: async () => {
      set({ notice: null });
      try {
        const code = await receiverBackend().requestCode(
          () => set({ status: 'paired', code: null }),
          // The pairing died underneath us (phone left, relay restarted):
          // reset and say why, instead of showing "connected" forever.
          (reason) =>
            set({
              status: 'unpaired',
              code: null,
              remoteMic: false,
              takeRequest: null,
              notice: reason,
            }),
        );
        set({ status: 'awaiting-confirmation', code });
      } catch {
        set({ notice: 'Could not reach the relay — is it running?' });
      }
    },

    clearTakeRequest: () => set({ takeRequest: null }),

    unpair: () => {
      receiverBackend().reset();
      set({
        status: 'unpaired',
        code: null,
        remoteMic: false,
        takeRequest: null,
        notice: null,
      });
    },
  };
});

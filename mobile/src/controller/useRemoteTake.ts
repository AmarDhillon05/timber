import { useEffect, useRef } from 'react';
import { receiverBackend } from './backend';
import { useController } from './store';

// The take half of the remote, both directions, for the Record page:
//
//   inbound   the phone's New take / Stop take buttons arrive as take-start /
//             take-stop, get parked in the controller store, and are actuated
//             here against the page's own startTake/stopTake
//   outbound  whenever a take starts or ends (however it was triggered — the
//             on-screen button counts), the phone is told, so its buttons show
//             REC rather than guessing
//
// The drummer is behind the kit, metres from the laptop: they can't see a
// thrown error and can't tick "share system audio" first. So a remote start
// arms system audio itself (with the recorder sidecar that's just opening a
// WebSocket — no picker, no user gesture), and failures are logged rather than
// left to a redbox nobody is looking at.
export function useRemoteTake({
  recording,
  onStart,
  onStop,
}: {
  recording: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  const takeRequest = useController((s) => s.takeRequest);
  const clearTakeRequest = useController((s) => s.clearTakeRequest);

  // The callbacks close over fresh RecordScreen state on every render; keep the
  // effect keyed on the request alone (not on identity churn) by reading the
  // latest ones through refs.
  const startRef = useRef(onStart);
  const stopRef = useRef(onStop);
  startRef.current = onStart;
  stopRef.current = onStop;

  // --- inbound: actuate what the phone asked for --------------------------
  useEffect(() => {
    if (!takeRequest) return;
    // Consume first: a request that can't apply (stop when nothing is rolling)
    // must not sit in the store and re-fire on the next render.
    clearTakeRequest();

    const wanted = takeRequest === 'take-start';
    if (wanted === recording) return; // already in the state they asked for

    console.log(`[desktop] remote '${takeRequest}'`);
    const run = wanted ? startRef.current : stopRef.current;
    void run().catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[desktop] remote '${takeRequest}' failed: ${reason}`);
    });
  }, [takeRequest, recording, clearTakeRequest]);

  // --- outbound: keep the remote's buttons honest --------------------------
  // Best-effort throughout: an unpaired desktop (or a phone that dropped its
  // stream) has nobody to tell, and that must never disturb the take itself.
  const wasRecording = useRef(recording);
  useEffect(() => {
    if (wasRecording.current === recording) return;
    wasRecording.current = recording;
    void receiverBackend()
      .sendPhoneCommand(recording ? 'take-started' : 'take-stopped')
      .catch(() => {});
  }, [recording]);

  // Leaving the Record page mid-take (the wordmark goes home) tears the
  // recorders down without ever calling stopTake. Say so, or the remote sits on
  // REC forever — and its Stop button would then be shouting at a page that
  // isn't mounted to hear it.
  useEffect(
    () => () => {
      if (!wasRecording.current) return;
      wasRecording.current = false;
      void receiverBackend().sendPhoneCommand('take-stopped').catch(() => {});
    },
    [],
  );
}

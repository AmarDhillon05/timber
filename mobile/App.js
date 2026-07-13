import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSession } from './src/state/session';
import { useBackend } from './src/state/backend';
import { useMediaExecutor, useController } from './src/controller';
import { RemoteBar } from './src/components/RemoteBar';
import { PairingModal } from './src/modals/PairingModal';
import UploadScreen from './src/screens/UploadScreen';
import EditScreen from './src/screens/EditScreen';
import RecordScreen from './src/screens/RecordScreen';

// Routing is derived from the session: a loaded TrackFile means we're editing,
// otherwise we're uploading. Subscribe only to whether a file is present (never
// a track's `pcm`, which is a large buffer) so this re-renders just on the
// load/clear transition.
//
// The Record page is a separate, self-contained route reached from Upload.
// There are no per-screen back buttons: the RemoteBar above every screen owns
// navigation home (the Timber wordmark) and remote pairing (which now runs in
// the PairingModal instead of a dedicated route).
export default function App() {
  const hasFile = useSession((s) => s.file !== null);
  const [recording, setRecording] = useState(false);
  const [pairing, setPairing] = useState(false);

  // Probe the inference backend once on launch so AI features know up front
  // whether the service is reachable (and can degrade gracefully if not).
  useEffect(() => {
    void useBackend.getState().ping();
  }, []);

  // Listen for controls from a paired remote and actuate them on this host's
  // media. Self-guards: only the executor host (the desktop, where SMTC works)
  // actually subscribes, so this is inert on a phone.
  useMediaExecutor();

  // A remote "New take" has to work from wherever the desktop is sitting — the
  // drummer is across the room and can't navigate for us. So route to the
  // Record page; the request stays parked in the controller store until
  // RecordScreen mounts and actuates it (see useRemoteTake). Take-stop needs no
  // routing: if we're not on the Record page, nothing is rolling.
  const takeRequest = useController((s) => s.takeRequest);
  useEffect(() => {
    if (takeRequest === 'take-start') setRecording(true);
  }, [takeRequest]);

  // Home = the Upload screen: leave the record page and drop any loaded file.
  const goHome = () => {
    setRecording(false);
    useSession.getState().clear();
  };

  const screen = recording ? (
    <RecordScreen onDone={() => setRecording(false)} />
  ) : hasFile ? (
    <EditScreen />
  ) : (
    <UploadScreen onRecord={() => setRecording(true)} />
  );

  return (
    <View style={{ flex: 1 }}>
      <RemoteBar onHome={goHome} onOpenPairing={() => setPairing(true)} />
      {screen}
      <PairingModal visible={pairing} onClose={() => setPairing(false)} />
    </View>
  );
}

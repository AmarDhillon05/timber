import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Directory, File, Paths } from 'expo-file-system';
import { AudioManager, useAudioInput } from 'react-native-audio-api';
import { createSystemAudioRecorder } from '../audio/systemAudio';
import type { SystemAudioRecorder } from '../audio/systemAudio';
import { createMicRecorder } from '../audio/micRecorder';
import type { MicRecorder } from '../audio/micRecorder';
import { createRemoteMicRecorder } from '../audio/micRecorder.remote';
import { useController } from '../controller/store';
import { useRemoteTake } from '../controller/useRemoteTake';
import { createVideoRecorder } from '../media/videoRecorder';
import type { VideoRecorder } from '../media/videoRecorder';
import { listProjects } from '../media/savedProjects';
import { AudioFile } from '../dsp';
import { makeTrack, makeTrackFile } from '../data/TrackFile';
import { useSession } from '../state/session';
import { theme } from '../theme';

// The Record page captures a take as a muted video plus a FLEXIBLE LIST of
// aligned audio sources — every device that can record, does, and each source
// becomes its own editable track in the TrackFile:
//   • laptop mic  — a user-selectable hardware input
//   • phone mic   — streamed over the relay whenever the paired phone is
//                   sharing (see ../audio/micRecorder.remote); recorded IN
//                   ADDITION to the laptop mic, never instead of it
//   • system audio — the music playing on the host, captured LIVE
//                    (see ../audio/systemAudio)
//
// The music source is no longer a file the app plays back — instead we capture
// whatever is already playing (Spotify, a browser tab, …) through the OS's
// privileged screen-share path. Because music and drums are recorded at the
// same time, they share a timeline: we still note how far into the take the
// music capture began (`musicOffsetSec`), which is ~0.
//
// Which capture backend we get is decided by `createSystemAudioRecorder()`,
// which forwards an OS-specific handler. Windows (browser) is wired up first.
//
// Per the project's error policy, failures are NOT caught into friendly
// messages: they propagate to Expo's redbox during development.

// One captured audio source. The take holds a plain list of these — the
// TrackFile doesn't care what recorded them, each just becomes a track.
interface TakeSource {
  /** Track name shown in the editor, e.g. "Laptop mic (USB Audio)". */
  name: string;
  uri: string;
  durationSec: number;
}

interface Take {
  /** Display name, and the name the TrackFile carries: "Take 3". */
  name: string;
  /** Folder the take's media live in — `take-3` on web (a label; the browser
   *  has no durable FS), the take folder's uri on native. */
  dir: string;
  /** null while the camera is a placeholder (no video captured yet). */
  video: string | null;
  /** Every captured audio source, in recording order; each becomes a track. */
  audio: TakeSource[];
  /** Seconds into the recording at which system-audio capture began (~0). */
  musicOffsetSec: number;
}

// Takes are NUMBERED, and the number comes from what is already stored rather
// than from a counter in memory: a reload restarts a counter at 1, and since a
// project saves into slug(its name), take 1 would then be written straight over
// the take 1 already on disk. (That is the bug this replaced — every web take
// was called "(in-memory)", so every save landed in saved_data/in-memory and
// clobbered the one before it.) Each platform counts its own durable store:
// web asks the saver for the projects it holds, native reads the take folders
// it wrote itself. Unsaved takes reserve no number — nothing is stored, so
// there is nothing to collide with.
const TAKE_DIR = /^take-(\d+)$/;

async function nextTakeNumber(): Promise<number> {
  let dirs: string[];
  try {
    if (Platform.OS === 'web') {
      dirs = (await listProjects()).map((p) => p.dir);
    } else {
      const recordings = new Directory(Paths.document, 'recordings');
      dirs = recordings.exists ? recordings.list().map((entry) => entry.name) : [];
    }
  } catch {
    // The capture is already in hand. A take is not lost because the store it
    // would have been numbered against couldn't be read (saver down, say), so
    // fall back to a stamp — unique, which is the one thing the number is for.
    return Date.now();
  }
  let highest = 0;
  for (const dir of dirs) {
    const match = TAKE_DIR.exec(dir);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

export default function RecordScreen({ onDone }: { onDone: () => void }) {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const { availableInputs, currentInput, onSelectInput } = useAudioInput();

  // The paired phone's mic (streamed over the relay). While the phone is
  // sharing, every take records it too — as its own source, alongside the
  // laptop mic, so both land as separate tracks in the TrackFile.
  const remoteMicShared = useController((s) => s.remoteMic);

  // True once the user has shared system audio for this take.
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);

  // Web only: the peripherals the browser exposes via enumerateDevices, plus the
  // user's picks. Native enumerates mics through useAudioInput (above) instead,
  // and has no camera device list (expo-camera only offers front/back). `null`
  // selections mean "use the browser/system default".
  const [webDevices, setWebDevices] = useState<MediaDeviceInfo[]>([]);
  const [webMicId, setWebMicId] = useState<string | null>(null);
  const [webCamId, setWebCamId] = useState<string | null>(null);

  const cameraRef = useRef<CameraView>(null);
  // Platform-specific drum-mic recorder (native WAV / web getUserMedia).
  const micRef = useRef<MicRecorder | null>(null);
  // The phone's mic, streamed over the relay — recorded alongside micRef.
  const phoneRef = useRef<MicRecorder | null>(null);
  // The OS-specific system-audio capture handler, created on first share.
  const sysAudioRef = useRef<SystemAudioRecorder | null>(null);
  // Platform-specific camera recorder (native recordAsync / web MediaRecorder).
  const videoRef = useRef<VideoRecorder | null>(null);
  const recorderStartRef = useRef(0);
  const musicOffsetRef = useRef(0);

  // Tick the on-screen timer while a take is in progress.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Release any shared system-audio stream / camera / phone-mic subscription if
  // we leave mid-session.
  useEffect(() => {
    return () => {
      sysAudioRef.current?.cancel();
      videoRef.current?.cancel();
      phoneRef.current?.cancel();
    };
  }, []);

  // Web: parse the peripherals the browser exposes into state for the dropdowns.
  // Labels/ids stay hidden until permission is granted, so we re-run when camera
  // permission changes, on hot-plug (devicechange), and after a take starts (mic
  // permission populates labels).
  const refreshWebDevices = useCallback(async () => {
    if (Platform.OS !== 'web' || !navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setWebDevices(devices);
  }, []);

  useEffect(() => {
    void refreshWebDevices();
    if (Platform.OS !== 'web' || !navigator.mediaDevices) return;
    navigator.mediaDevices.addEventListener('devicechange', refreshWebDevices);
    return () =>
      navigator.mediaDevices.removeEventListener('devicechange', refreshWebDevices);
  }, [camPerm, refreshWebDevices]);

  // Unify the mic source across platforms for the dropdown: web parses
  // enumerateDevices; native uses the audio-session inputs from useAudioInput.
  // Cameras only have a device list on web (expo-camera native is front/back).
  const isWeb = Platform.OS === 'web';
  const webMics = webDevices.filter((d) => d.kind === 'audioinput');
  const webCams = webDevices.filter((d) => d.kind === 'videoinput');

  const micOptions: DeviceOption[] = isWeb
    ? webMics.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
    : availableInputs.map((d) => ({ id: d.id, label: d.name }));
  const micSelectedId = isWeb ? webMicId : currentInput?.id ?? null;
  const selectMic = (id: string) => {
    if (isWeb) {
      setWebMicId(id);
    } else {
      const dev = availableInputs.find((d) => d.id === id);
      if (dev) onSelectInput(dev);
    }
  };

  const camOptions: DeviceOption[] = isWeb
    ? webCams.map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    : [];

  // Prompt the user to share system/tab audio (the slow, interactive step) so
  // that starting the take itself stays tight. The handler is OS-specific.
  const shareSystemAudio = async () => {
    const sys =
      sysAudioRef.current ?? (sysAudioRef.current = createSystemAudioRecorder());
    await sys.arm();
    setArmed(true);
  };

  const startTake = async () => {
    // The phone's "New take" can't tick "Share system audio" first — and it no
    // longer needs to: with the recorder sidecar, arming is just opening a
    // local WebSocket (no picker, no user gesture), so a take that arrives
    // unarmed arms itself. The on-screen button still gates on `armed`, so this
    // only ever fires for a remote start.
    if (!sysAudioRef.current?.armed) await shareSystemAudio();
    const sys = sysAudioRef.current;
    if (!sys?.armed) return;
    // Reachable only from a remote start: the on-screen UI shows the permission
    // prompt instead of the record button until this is granted.
    if (!camPerm?.granted) {
      throw new Error('Camera access has not been granted on the desktop yet.');
    }
    setTake(null);
    setElapsed(0);

    // Native only: route the audio session for recording. The web mic uses
    // getUserMedia, which handles its own permission prompt.
    if (Platform.OS !== 'web') {
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord',
        iosMode: 'default',
        iosOptions: ['allowBluetoothA2DP', 'allowBluetoothHFP'],
      });
      const granted = await AudioManager.requestRecordingPermissions();
      if (granted !== 'Granted') return;
      await AudioManager.setAudioSessionActivity(true);
    }

    // Laptop mic — platform-specific recorder. Web pins the selected input by
    // deviceId; native ignores it (the input is set via the audio session).
    const mic = createMicRecorder({ deviceId: isWeb ? webMicId : undefined });
    micRef.current = mic;
    await mic.start();
    // Getting the mic stream unlocks device labels on web — refresh the lists.
    void refreshWebDevices();

    // Phone mic — whenever the paired phone is sharing, it records TOO (its own
    // source, never a replacement for the laptop mic). Its start resolves once
    // the phone's recorder reports it has actually begun; the remaining network
    // skew is small and cross-correlation alignment is a later step anyway.
    //
    // A phone that can't start (mic switched off mid-countdown, went to sleep,
    // wandered off the Wi-Fi) must not cost us the take: drop that one source
    // and roll with the rest. This is the one place we deliberately swallow —
    // loudly — rather than propagate, because the drummer is already playing.
    if (remoteMicShared) {
      const phone = createRemoteMicRecorder();
      try {
        await phone.start();
        phoneRef.current = phone; // only once it's really capturing
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[record] phone mic dropped from this take: ${reason}`);
      }
    }

    setRecording(true);

    // Start system audio first so the drums↔music timing stays tight, then begin
    // the camera capture — its alignment is the least critical of the three, so
    // any camera-setup latency is kept off the audio path.
    recorderStartRef.current = Date.now();
    sys.start();
    musicOffsetRef.current = (Date.now() - recorderStartRef.current) / 1000;

    // Camera capture. Native records through the CameraView (recordAsync); web
    // opens its own getUserMedia stream pinned to the selected camera. Both
    // produce a muted, video-only file.
    const vid = createVideoRecorder({
      cameraRef,
      deviceId: isWeb ? webCamId : undefined,
    });
    videoRef.current = vid;
    await vid.start();
  };

  const stopTake = async () => {
    setRecording(false);

    const video = (await videoRef.current?.stop()) ?? null;
    const drums = await micRef.current?.stop();
    const phone = phoneRef.current ? await phoneRef.current.stop() : null;
    const music = await sysAudioRef.current?.stop();
    micRef.current = null;
    phoneRef.current = null;
    videoRef.current = null;

    if (Platform.OS !== 'web') await AudioManager.setAudioSessionActivity(false);
    setArmed(false);

    if (!drums || !music) return;

    // Every take gets its own folder, named for its number. `saveProject` slugs
    // the TrackFile's name to pick the folder it writes into, and slug("Take 3")
    // is "take-3" — so the take folder here and the saved_data folder later are
    // the same name by construction, and re-saving a take overwrites that take
    // rather than some other one.
    const number = await nextTakeNumber();
    const name = `Take ${number}`;

    // Native has a durable filesystem: move the captured files into the take
    // folder and write a manifest. Web keeps the in-memory object URLs as-is
    // (there's no durable FS in the browser/Electron renderer), so its folder
    // is just the name the media will be saved under.
    let dir = `take-${number}`;
    let drumsUri = drums.uri;
    let videoUri = video?.uri ?? null;
    let folder: Directory | null = null;

    if (Platform.OS !== 'web') {
      folder = new Directory(Paths.document, 'recordings', dir);
      folder.create({ intermediates: true, idempotent: true });

      const drumsDest = new File(folder, `drums${drums.ext}`);
      await new File(drums.uri).move(drumsDest);
      drumsUri = drumsDest.uri;

      if (video) {
        const videoDest = new File(folder, `video${video.ext}`);
        await new File(video.uri).move(videoDest);
        videoUri = videoDest.uri;
      }
      dir = folder.uri;
    }

    const micName =
      micOptions.find((o) => o.id === micSelectedId)?.label ??
      currentInput?.name ??
      'Default';

    // The take's audio is a plain list of sources — one per device that
    // recorded — and each becomes its own editable track in the TrackFile.
    // Phone + system audio stay object URLs on web; persisting them is TODO.
    const audio: TakeSource[] = [
      { name: `Laptop mic (${micName})`, uri: drumsUri, durationSec: drums.durationSec },
      ...(phone
        ? [{ name: 'Phone mic', uri: phone.uri, durationSec: phone.durationSec }]
        : []),
      { name: 'System audio', uri: music.uri, durationSec: music.durationSec },
    ];

    const result: Take = {
      name,
      dir,
      video: videoUri,
      audio,
      musicOffsetSec: musicOffsetRef.current,
    };

    if (folder) {
      const manifest = new File(folder, 'take.json');
      manifest.create();
      manifest.write(JSON.stringify(result, null, 2));
    }

    setTake(result);
  };

  // The paired phone drives takes too: its New take / Stop take buttons land
  // here, and this page reports back so the remote's buttons show REC. Declared
  // after startTake/stopTake so it binds the current pair, and before any early
  // return so the hook order never changes.
  useRemoteTake({ recording, onStart: startTake, onStop: stopTake });

  // Hand the finished take to the rest of the app as a multi-track TrackFile
  // (the same document the upload flow produces), then leave the record route so
  // App swaps to the editor. Every captured source becomes an editable track —
  // the TrackFile is just the list, it doesn't care what recorded each one.
  // Each track's PCM decodes in the background, exactly as importVideo does.
  const openInEditor = () => {
    if (!take) return;
    const tracks = take.audio.map((src) =>
      makeTrack({ name: src.name, uri: src.uri, editable: true }),
    );
    const file = makeTrackFile({
      name: take.name,
      tracks,
      video: take.video
        ? { uri: take.video, name: take.video.split('/').pop() ?? 'video' }
        : null,
    });

    useSession.getState().load(file);
    for (const t of tracks) void decodeTrackInBackground(t.id, t.uri);
    onDone();
  };

  // --- Render -------------------------------------------------------------

  if (!camPerm) {
    return <Screen />; // permission state still loading
  }

  if (!camPerm.granted) {
    return (
      <Screen>
        <Text style={styles.body}>Camera access is needed to record.</Text>
        <Pressable style={styles.button} onPress={requestCamPerm}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.row}>
        {/* LEFT: camera preview. Temporarily a solid placeholder so we can
            settle the layout/sizing before wiring the real CameraView back in. */}
        <View style={styles.preview}>
          <CameraView ref={cameraRef} style={styles.camera} mode="video" mute />
          {recording && (
            <View style={styles.recBadge}>
              <View style={styles.recDot} />
              <Text style={styles.recText}>
                {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
                {String(elapsed % 60).padStart(2, '0')}
              </Text>
            </View>
          )}
        </View>

        {/* RIGHT: all the inputs and controls. */}
        <View style={styles.controls}>
          {!recording && (
            <>
              <Text style={styles.label}>Drum mic</Text>
              <Dropdown
                options={micOptions}
                selectedId={micSelectedId}
                onSelect={selectMic}
                placeholder="System default input"
              />
              {remoteMicShared && (
                <Text style={styles.hint}>
                  Phone mic shared — it will record as its own track.
                </Text>
              )}

              <Text style={styles.label}>Camera</Text>
              {camOptions.length === 0 ? (
                <Text style={styles.hint}>
                  {isWeb ? 'No cameras found.' : 'Using the device camera.'}
                </Text>
              ) : (
                <>
                  <Dropdown
                    options={camOptions}
                    selectedId={webCamId ?? camOptions[0]?.id ?? null}
                    onSelect={setWebCamId}
                  />
                  <Text style={styles.hint}>
                    Preview always uses the default camera for now — switching
                    isn't wired up yet.
                  </Text>
                </>
              )}

              <Text style={styles.label}>System audio</Text>
              <Pressable style={styles.secondary} onPress={shareSystemAudio}>
                <Text style={styles.secondaryText}>
                  {armed
                    ? 'System audio shared — ready to record'
                    : 'Share system audio to capture along'}
                </Text>
              </Pressable>
            </>
          )}

          <Pressable
            style={[
              styles.button,
              recording && styles.stop,
              !armed && !recording && styles.disabled,
            ]}
            disabled={!armed && !recording}
            onPress={recording ? stopTake : startTake}
          >
            <Text style={styles.buttonText}>
              {recording ? 'Stop' : 'Record take'}
            </Text>
          </Pressable>

          {take && (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>
                {take.name} · {take.audio.length + (take.video ? 1 : 0)} tracks
              </Text>
              {take.video && (
                <Text style={styles.resultLine}>
                  video -&gt; {take.video.split('/').pop()}
                </Text>
              )}
              {take.audio.map((src) => (
                <Text key={src.name} style={styles.resultLine}>
                  {src.name} · {src.durationSec.toFixed(1)}s
                </Text>
              ))}
              <Text style={styles.hint}>
                system audio starts +{take.musicOffsetSec.toFixed(2)}s · {take.dir}
              </Text>
              <Pressable style={styles.secondary} onPress={openInEditor}>
                <Text style={styles.secondaryText}>Open in editor -&gt;</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <StatusBar style="light" />
    </Screen>
  );
}

// Decode one track's audio to PCM off the critical path and land it on its
// track, mirroring importVideo's background decode so recorded and uploaded
// TrackFiles fill in identically.
async function decodeTrackInBackground(id: string, uri: string): Promise<void> {
  const audio = await AudioFile.decode(uri);
  useSession.getState().setTrackPcm(id, audio.data);
}

// One selectable peripheral. `id` is the deviceId (web) or audio-session id
// (native); `label` is the human-readable name shown in the dropdown.
interface DeviceOption {
  id: string;
  label: string;
}

// A minimal pop-over dropdown: the trigger shows the current pick and toggles a
// list of options rendered just below it. (RN has no native <select>, so we roll
// our own.) The menu is absolutely positioned so it overlays the controls
// underneath rather than pushing them down.
function Dropdown({
  options,
  selectedId,
  onSelect,
  placeholder = 'Select…',
}: {
  options: DeviceOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === selectedId);
  return (
    <View style={[styles.dropdownWrap, open && styles.dropdownWrapOpen]}>
      <Pressable style={styles.dropdown} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.dropdownText} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Text style={styles.dropdownCaret}>{open ? '^' : 'v'}</Text>
      </Pressable>
      {open && (
        <View style={styles.dropdownMenu}>
          {options.length === 0 ? (
            <Text style={styles.dropdownEmpty}>No devices found</Text>
          ) : (
            options.map((o) => {
              const active = o.id === selectedId;
              return (
                <Pressable
                  key={o.id}
                  style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  onPress={() => {
                    onSelect(o.id);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      active && styles.chipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      )}
    </View>
  );
}

// Navigation home lives in the app-wide RemoteBar, so the header is just the
// page title.
function Screen({ children }: { children?: React.ReactNode }) {
  return (
    <View style={[styles.container, styles.content]}>
      <View style={styles.header}>
        <Text style={styles.title}>Record</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.surface },
  content: { padding: 20, gap: 16 },
  // The two-column body: camera preview on the left, controls on the right.
  row: { flex: 1, flexDirection: 'row', gap: 20 },
  controls: { flex: 1, gap: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  title: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1,
  },
  preview: {
    // position: relative makes this the containing block for the camera's
    // absolutely-positioned <video> on web, so overflow: hidden clips it to the
    // panel instead of letting it escape to fill the viewport.
    position: 'relative',
    flex: 1,
    alignSelf: 'flex-start',
    aspectRatio: 3 / 4,
    maxHeight: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: theme.surfaceDeep,
  },
  camera: { width: '100%', height: '100%' },
  recBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.scrim,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.danger },
  recText: { color: theme.text, fontVariant: ['tabular-nums'], fontSize: 14 },
  label: {
    color: theme.textMuted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  hint: { color: theme.textFaint, fontSize: 13 },
  body: { color: theme.textSoft, fontSize: 16 },
  chipTextActive: { color: theme.onAccent, fontWeight: '600' },
  // Raise an open dropdown (and its overlaying menu) above sibling controls.
  dropdownWrap: { position: 'relative', zIndex: 1 },
  dropdownWrapOpen: { zIndex: 10 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: theme.card,
  },
  dropdownText: { color: theme.textSoft, fontSize: 15, flexShrink: 1 },
  dropdownCaret: { color: theme.textMuted, fontSize: 12 },
  dropdownMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: theme.cardDeep,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 11 },
  dropdownItemActive: { backgroundColor: theme.accent },
  dropdownItemText: { color: theme.textSoft, fontSize: 14 },
  dropdownEmpty: { color: theme.textFaint, fontSize: 14, padding: 14 },
  secondary: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.card,
  },
  secondaryText: { color: theme.textSoft, fontSize: 15 },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: 'center',
    marginTop: 4,
  },
  stop: { backgroundColor: theme.danger },
  disabled: { opacity: 0.4 },
  buttonText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
  result: {
    gap: 6,
    padding: 16,
    borderRadius: 12,
    backgroundColor: theme.card,
  },
  resultTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
  resultLine: { color: theme.textSoft, fontSize: 14 },
});

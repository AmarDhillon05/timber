import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import {
  useSession,
  activeValues,
  activeTrack,
  activeDecoding,
} from '../state/session';
import { trackActiveValues } from '../data/TrackFile';
import { useBackend } from '../state/backend';
import { useHotKnob } from '../state/hotKnob';
import { usePreview } from '../audio/usePreview';
import { exportVideo } from '../media/exportVideo';
import { saveProject } from '../media/savedProjects';
import { uriByteSize, formatBytes } from '../media/fileSize';
import { suggestBlanket } from '../ai/suggestBlanket';
import { InferenceError } from '../ai/inferenceApi';
import { BlanketKnob } from '../components/BlanketKnob';
import {
  BLANKET_TERM_KEYS,
  BLANKET_TERMS,
  CATEGORY_ORDER,
} from '../dsp/blanketTerms';
import { theme } from '../theme';

// Below this width we stack (video over sliders); at or above it we go
// side-by-side (video left, sliders right).
const WIDE_BREAKPOINT = 600;

// Shown whenever the session holds a TrackFile. The video is playable
// immediately; the Blanket sliders stay locked until the active track's
// background decode finishes (`activeDecoding` flips to false once its PCM
// lands). The track selector switches which track the knobs act on — each
// track keeps its own Blanket state.
export default function EditScreen() {
  const video = useSession((s) => s.file?.video ?? null);
  const videoName = video?.name ?? 'Untitled';
  const videoUri = video?.uri ?? null;
  const decoding = useSession(activeDecoding);
  const clear = useSession((s) => s.clear);
  const reset = useSession((s) => s.reset);
  const mode = useSession((s) => activeTrack(s)?.mode ?? 'user');
  const toggleMode = useSession((s) => s.toggleMode);
  const copyGeneratedToUser = useSession((s) => s.copyGeneratedToUser);
  const setGenerated = useSession((s) => s.setGenerated);

  // Backend availability (pinged on app start). When offline we disable the
  // suggest action and show why, rather than firing a request that will fail.
  const backendStatus = useBackend((s) => s.status);
  const backendError = useBackend((s) => s.error);
  const pingBackend = () => void useBackend.getState().ping();

  // Track list. A signature string (ids/names/muted, delimited by tab/newline)
  // keeps this stable across knob drags — those replace the active track object
  // but only change this list when a mute flips — so the editor doesn't
  // re-render on every move. Muted = the track's volume fader is at its silent
  // bottom stop (−1); the "m" button just slams/restores that value.
  const trackSig = useSession((s) =>
    (s.file?.tracks ?? [])
      .map((t) =>
        [t.id, t.name, trackActiveValues(t).volume <= -1 ? '1' : '0'].join('\t'),
      )
      .join('\n'),
  );
  const activeTrackId = useSession((s) => s.activeTrackId);
  const setActiveTrack = useSession((s) => s.setActiveTrack);
  const setTrackValue = useSession((s) => s.setTrackValue);
  const trackRows = useMemo(
    () =>
      (trackSig ? trackSig.split('\n') : []).map((part) => {
        const [id, name, muted] = part.split('\t');
        return { id, name, muted: muted === '1' };
      }),
    [trackSig],
  );

  // Ctrl+S needs the latest save closure (it captures toast state) from a
  // once-registered listener, so it goes through a ref refreshed every render.
  const saveRef = useRef<() => void>(() => {});

  // Keyboard, registered once (reads everything via getState/refs so it never
  // re-renders the editor): Ctrl/Cmd+S saves the project; arrow keys drive
  // whichever knob is hovered/focused (the hotKnob store) — Up/Right raise,
  // Down/Left lower, Shift makes coarser steps.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); // the browser's own save-page dialog
        saveRef.current();
        return;
      }
      const term = useHotKnob.getState().term;
      if (!term) return;
      let delta = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') delta = 0.05;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') delta = -0.05;
      else return;
      if (e.shiftKey) delta *= 4;
      e.preventDefault();
      const s = useSession.getState();
      const next = activeValues(s)[term] + delta;
      s.setValue(term, Math.max(-1, Math.min(1, Math.round(next * 100) / 100)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debug: dump the whole TrackFile whenever the list, selection, or decode
  // state changes — i.e. on every editor open and every tab switch. Read from
  // getState() (not a reactive selector) and SUMMARIZE the heavy fields: pcm
  // (never log the raw Float32Array buffers, ~70 MB each) and the video (name +
  // truncated uri, never the blob itself).
  useEffect(() => {
    const { file, activeTrackId } = useSession.getState();
    if (!file) return;
    const video = file.video
      ? `${file.video.name} · ${file.video.uri.slice(0, 48)}`
      : 'none';
    console.log(
      `[editor] file "${file.name}" · ${file.tracks.length} tracks · video=${video}`,
    );
    console.table(
      file.tracks.map((t) => ({
        name: t.name,
        editable: t.editable,
        active: t.id === activeTrackId,
        sampleRate: t.sampleRate,
        pcm: t.pcm ? `${t.pcm.length}ch × ${t.pcm[0]?.length ?? 0} samples` : 'decoding…',
        uri: t.uri.slice(0, 48),
      })),
    );
  }, [trackSig, activeTrackId, decoding]);

  const generated = mode === 'generated';
  const accent = generated ? theme.success : theme.danger;

  // null = not exporting; otherwise the 0..1 progress fraction.
  const [exportProgress, setExportProgress] = useState<number | null>(null);

  // AI suggestion in-flight state, plus the free-text hint sent with it.
  const [suggesting, setSuggesting] = useState(false);
  const [prompt, setPrompt] = useState('');

  // Notification micro-interaction: a toast that springs in (on success OR
  // failure), then settles back out on its own. Its contents are data-driven so
  // the same animation reports both outcomes.
  const toast = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastInfo, setToastInfo] = useState<{
    tone: 'ok' | 'err';
    title: string;
    sub: string;
  }>({ tone: 'ok', title: 'Suggestions ready', sub: 'Generated from your audio' });
  const flashToast = (info: { tone: 'ok' | 'err'; title: string; sub: string }) => {
    setToastInfo(info);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    Animated.spring(toast, {
      toValue: 1,
      useNativeDriver: false,
      friction: 6,
      tension: 130,
    }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toast, { toValue: 0, duration: 240, useNativeDriver: false }).start();
    }, info.tone === 'err' ? 3200 : 1900);
  };

  // Save the whole TrackFile to saved_data/ via the saver sidecar (button and
  // Ctrl+S both land here). Reports through the same toast as suggestions; a
  // failure (sidecar down) is shown, not thrown — saving is never load-bearing
  // for the editor.
  const [savingProject, setSavingProject] = useState(false);
  const onSave = async () => {
    const file = useSession.getState().file;
    if (!file || savingProject) return;
    setSavingProject(true);
    try {
      const { dir } = await saveProject(file);
      flashToast({ tone: 'ok', title: 'Project saved', sub: `saved_data/${dir}` });
    } catch (e) {
      flashToast({
        tone: 'err',
        title: 'Save failed',
        sub: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSavingProject(false);
    }
  };
  saveRef.current = () => void onSave();

  // Press feedback for the suggest button.
  const press = useRef(new Animated.Value(0)).current;
  const pressTo = (to: number) =>
    Animated.spring(press, { toValue: to, useNativeDriver: false, friction: 7, tension: 200 }).start();

  // Send the active track's decoded audio to the inference service and land its
  // suggestions on that track. The track's current "Yours" values ride along as
  // an inclination the model blends toward, and the prompt text biases scoring.
  // A backend failure is reported in the toast (and re-pings availability) rather
  // than thrown — the service being down shouldn't break the editor.
  const onSuggest = async () => {
    const track = activeTrack(useSession.getState());
    if (!track?.pcm) return;
    setSuggesting(true);
    try {
      setGenerated(
        await suggestBlanket(track.pcm, track.sampleRate, {
          context: prompt,
          inclination: track.user,
        }),
      );
      flashToast({ tone: 'ok', title: 'Suggestions ready', sub: 'Generated from your audio' });
    } catch (e) {
      flashToast({ tone: 'err', title: 'Suggestion failed', sub: describeBackendError(e) });
      pingBackend(); // refresh the online/offline indicator after a failure
    } finally {
      setSuggesting(false);
    }
  };

  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;

  const onExport = async () => {
    const track = activeTrack(useSession.getState());
    if (!videoUri || !track?.pcm) return;
    setExportProgress(0);
    try {
      await exportVideo({
        videoUri,
        videoName,
        pcm: track.pcm,
        values: activeValues(useSession.getState()),
        onProgress: setExportProgress,
      });
    } finally {
      setExportProgress(null);
    }
  };
  // Video column scales with the screen but stays within sensible bounds.
  const videoWidth = wide ? Math.min(Math.max(width * 0.42, 300), 600) : undefined;

  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = true;
  });

  // Mutes the video and plays the processed audio in its place, re-rendering as
  // sliders change. No-op visually; drives all the audio.
  usePreview(player);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {videoName}
        </Text>
        <Pressable onPress={clear} hitSlop={8}>
          <Text style={styles.close}>Close</Text>
        </Pressable>
      </View>

      <View style={[styles.body, wide && styles.bodyWide]}>
        <View style={wide ? { width: videoWidth } : styles.videoColStacked}>
          <VideoView
            style={[styles.video, wide ? { width: videoWidth } : undefined]}
            player={player}
            contentFit="contain"
            nativeControls
          />

          {/* Track list under the video: one row per track — a small "m" mute
              button plus the name (mute = the track's volume fader slammed to
              its silent bottom stop; the button restores 0 on unmute). */}
          <View style={styles.trackList}>
            {trackRows.map((t) => {
              const active = t.id === activeTrackId;
              return (
                <View key={t.id} style={styles.trackRow}>
                  <Pressable
                    onPress={() => setTrackValue(t.id, 'volume', t.muted ? 0 : -1)}
                    hitSlop={4}
                    style={[styles.muteBtn, t.muted && styles.muteBtnOn]}
                  >
                    <Text style={[styles.muteBtnText, t.muted && styles.muteBtnTextOn]}>
                      m
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setActiveTrack(t.id)}
                    style={[styles.trackBtn, active && styles.trackBtnActive]}
                  >
                    <Text
                      style={[styles.trackBtnText, active && styles.trackBtnTextActive]}
                      numberOfLines={1}
                    >
                      {t.name}
                    </Text>
                    <TrackSizeLabel id={t.id} active={active} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.controls}>
          <View style={[styles.controlsHeader, wide && styles.controlsHeaderWide]}>
            <Pressable
              onPress={toggleMode}
              hitSlop={8}
              style={[styles.modePill, { borderColor: accent }]}
            >
              <View style={[styles.modeDot, { backgroundColor: accent }]} />
              <Text style={[styles.modePillText, { color: accent }]}>
                {generated ? 'Generated' : 'Yours'}
              </Text>
            </Pressable>

            {/* Commit the generated copy into yours — only offered while the
                generated copy is the one on screen (mockup's arrow button). */}
            {generated && !decoding && exportProgress === null && (
              <Pressable onPress={copyGeneratedToUser} hitSlop={8} style={styles.applyArrow}>
                <Text style={styles.applyArrowText}>Generated ➜ Yours</Text>
              </Pressable>
            )}
            {decoding ? (
              <View style={styles.status}>
                <ActivityIndicator color={theme.textMuted} size="small" />
                <Text style={styles.statusText}>Preparing audio…</Text>
              </View>
            ) : exportProgress !== null ? (
              <View style={styles.status}>
                <ActivityIndicator color={theme.accent} size="small" />
                <Text style={styles.statusText}>
                  Exporting {Math.round(exportProgress * 100)}%
                </Text>
              </View>
            ) : (
              <View style={styles.actions}>
                <Pressable onPress={reset} hitSlop={8}>
                  <Text style={styles.resetText}>Reset</Text>
                </Pressable>
                <Pressable onPress={() => void onSave()} disabled={savingProject} hitSlop={8}>
                  <Text style={styles.saveText}>
                    {savingProject ? 'Saving…' : 'Save'}
                  </Text>
                </Pressable>
                <Pressable onPress={onExport} hitSlop={8} style={styles.exportButton}>
                  <Text style={styles.exportText}>Export ↓</Text>
                </Pressable>
              </View>
            )}
          </View>

          <UsageSummary />

          {/* One-row "chat" bar: prompt input + suggest, side by side. */}
          {!decoding && (
            <View style={styles.suggestBlock}>
              <View style={styles.suggestRow}>
                <TextInput
                  style={styles.promptInput}
                  value={prompt}
                  onChangeText={setPrompt}
                  onSubmitEditing={() => void onSuggest()}
                  placeholder="Optional hint, e.g. live drum kit, noisy room"
                  placeholderTextColor={theme.placeholder}
                  editable={!suggesting}
                />
                <Animated.View
                  style={{
                    transform: [
                      { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
                    ],
                  }}
                >
                  <Pressable
                    onPress={onSuggest}
                    onPressIn={() => pressTo(1)}
                    onPressOut={() => pressTo(0)}
                    disabled={suggesting || backendStatus === 'offline'}
                    style={[
                      styles.suggestButton,
                      (suggesting || backendStatus === 'offline') && styles.suggestButtonDisabled,
                    ]}
                  >
                    {suggesting ? (
                      <ActivityIndicator color={theme.onAccent} size="small" />
                    ) : (
                      <Text style={styles.suggestButtonText}>
                        {backendStatus === 'checking' ? 'Checking…' : 'Suggest'}
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              </View>
              {backendStatus === 'offline' && (
                <Pressable style={styles.offlineBanner} onPress={pingBackend} hitSlop={6}>
                  <Text style={styles.offlineText} numberOfLines={2}>
                    AI offline — {backendError ?? 'service unreachable'}. Tap to retry.
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* One row per category: slim label gutter on the left, knobs
                flowing to the right — as compact vertically as possible. */}
            <View style={decoding && styles.locked}>
              {CATEGORY_ORDER.map((category) => (
                <View key={category} style={styles.categoryRow}>
                  <Text style={styles.categoryLabel} numberOfLines={2}>
                    {category}
                  </Text>
                  <View style={styles.categoryKnobs}>
                    {BLANKET_TERM_KEYS.filter(
                      (key) => BLANKET_TERMS[key].category === category,
                    ).map((key) => (
                      <BlanketKnob key={key} term={key} disabled={decoding} />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>

      <View style={styles.toastHost} pointerEvents="none">
        <Animated.View
          style={[
            styles.toast,
            toastInfo.tone === 'err' && styles.toastErr,
            {
              opacity: toast,
              transform: [
                { translateY: toast.interpolate({ inputRange: [0, 1], outputRange: [-28, 0] }) },
                { scale: toast.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              ],
            },
          ]}
        >
          <View style={[styles.toastIcon, toastInfo.tone === 'err' && styles.toastIconErr]}>
            <Text style={styles.toastCheck}>{toastInfo.tone === 'err' ? '!' : '✓'}</Text>
          </View>
          <View style={styles.toastTextCol}>
            <Text style={styles.toastTitle}>{toastInfo.title}</Text>
            <Text style={styles.toastSub} numberOfLines={2}>{toastInfo.sub}</Text>
          </View>
        </Animated.View>
      </View>

      <KnobTooltip />

      <StatusBar style="light" />
    </View>
  );
}

// Screen-level tooltip for the hovered/focused knob, fed by the hotKnob store.
// Rendered as the LAST absolute child of the editor, so no panel edge, sibling
// row, or toast can ever clip or cover it (the old per-knob tooltip could be
// hidden by elements later in the layout). Maps the knob's window coords into
// this overlay's own frame via measureInWindow, so container padding never
// skews the position.
function KnobTooltip() {
  const term = useHotKnob((s) => s.term);
  const x = useHotKnob((s) => s.x);
  const y = useHotKnob((s) => s.y);
  const w = useHotKnob((s) => s.width);
  const ref = useRef<View>(null);
  const [frame, setFrame] = useState({ ox: 0, oy: 0, w: 0, h: 0 });

  if (!term) return null;
  const { label, description } = BLANKET_TERMS[term];

  const W = 200;
  const cx = x + w / 2 - frame.ox;
  const left = Math.max(8, Math.min(cx - W / 2, frame.w - W - 8));
  const bottom = frame.h - (y - frame.oy) + 6;

  return (
    <View
      ref={ref}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={() =>
        ref.current?.measureInWindow((ox, oy, fw, fh) =>
          setFrame({ ox, oy, w: fw, h: fh }),
        )
      }
    >
      {frame.h > 0 && (
        <View style={[styles.tooltip, { left, bottom, width: W }]}>
          <Text style={styles.tooltipTitle}>{label}</Text>
          <Text style={styles.tooltipText}>{description}</Text>
          <View style={[styles.tooltipCaret, { left: cx - left - 5 }]} />
        </View>
      )}
    </View>
  );
}

// Turn a failed /suggest call into a short, user-facing reason. Each backend
// failure mode (service down, slow, HTTP error, bad body) gets its own line.
function describeBackendError(e: unknown): string {
  if (e instanceof InferenceError) {
    switch (e.kind) {
      case 'unreachable':
        return 'Inference service is offline.';
      case 'timeout':
        return 'The service took too long to respond.';
      case 'http':
        return `Service error (${e.status}).`;
      case 'malformed':
        return 'The service returned an unexpected response.';
    }
  }
  return 'Something went wrong.';
}

// Per-track size readout under the track name: the source file's bytes (what a
// save/upload of this track would actually move) and the decoded PCM's bytes
// (its in-memory footprint). Subscribes on its own so the row list — which is
// built from the drag-stable trackSig — never has to carry size state.
//
// Big-buffer discipline: the selector reduces `pcm` down to a NUMBER inside the
// store read, so the component re-renders when the byte count changes (decode
// landing), never on the buffers themselves.
function TrackSizeLabel({ id, active }: { id: string; active: boolean }) {
  const uri = useSession(
    (s) => s.file?.tracks.find((t) => t.id === id)?.uri ?? null,
  );
  const pcmBytes = useSession((s) => {
    const t = s.file?.tracks.find((t) => t.id === id);
    return t?.pcm ? t.pcm.reduce((sum, ch) => sum + ch.byteLength, 0) : null;
  });

  // File size lands async (web has to fetch the blob); cached per uri.
  const [fileBytes, setFileBytes] = useState<number | null>(null);
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    void uriByteSize(uri).then((n) => {
      if (alive) setFileBytes(n);
    });
    return () => {
      alive = false;
    };
  }, [uri]);

  return (
    <Text
      style={[styles.trackSizeText, active && styles.trackSizeTextActive]}
      numberOfLines={1}
    >
      src {fileBytes === null ? '--' : formatBytes(fileBytes)} · pcm{' '}
      {pcmBytes === null ? '--' : formatBytes(pcmBytes)}
    </Text>
  );
}

// Live readout of the active track's usage tally. Subscribes on its own (like a
// knob) so it can update on every drag without re-rendering the whole editor.
function UsageSummary() {
  const usage = useSession((s) => activeTrack(s)?.usage ?? null);
  if (!usage) return null;
  const knobs = Object.keys(usage.blanket).length;
  const effects = Object.values(usage.effect).reduce((a, b) => a + b, 0);
  if (knobs === 0) return null;
  return (
    <Text style={styles.usageText}>
      {knobs} {knobs === 1 ? 'knob' : 'knobs'} · {effects}{' '}
      {effects === 1 ? 'effect' : 'effects'} applied
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.surface,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  name: {
    flex: 1,
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    marginRight: 12,
  },
  close: {
    color: theme.textMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    flexDirection: 'column',
  },
  bodyWide: {
    flexDirection: 'row',
    gap: 24,
  },
  videoColStacked: {
    width: '100%',
  },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    backgroundColor: theme.surfaceDeep,
  },
  // The whole control column sits in one bordered panel (mockup: a single
  // outlined container with a brownish border — theme.border is the walnut
  // hairline).
  controls: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  // Track list under the video: [m][ track name ] rows.
  trackList: {
    marginTop: 12,
    gap: 8,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  muteBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  muteBtnOn: {
    backgroundColor: theme.dangerDeep,
    borderColor: theme.dangerBorder,
  },
  muteBtnText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  muteBtnTextOn: {
    color: theme.text,
  },
  trackBtn: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  trackBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  trackBtnText: {
    color: theme.textSoft,
    fontSize: 14,
    textAlign: 'center',
  },
  trackBtnTextActive: {
    color: theme.onAccent,
    fontWeight: '600',
  },
  trackSizeText: {
    color: theme.textFaint,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  trackSizeTextActive: {
    color: theme.onAccent,
    opacity: 0.75,
  },
  controlsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  controlsHeaderWide: {
    marginTop: 0,
  },
  // The mockup's arrow button: commit generated → yours, shown only while the
  // generated copy is open.
  applyArrow: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.successDeep,
  },
  applyArrowText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '700',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  modeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    color: theme.textMuted,
    fontSize: 14,
  },
  resetText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  saveText: {
    color: theme.textSoft,
    fontSize: 14,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  exportButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  exportText: {
    color: theme.onAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  usageText: {
    color: theme.textFaint,
    fontSize: 12,
    marginTop: 8,
    fontVariant: ['tabular-nums'],
  },
  suggestBlock: {
    marginTop: 10,
    marginBottom: 4,
    gap: 8,
  },
  // Input and suggest side by side — the mockup's single "chat" bar.
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  promptInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    color: theme.text,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  suggestButton: {
    height: 40,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: theme.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.success,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  suggestButtonDisabled: {
    opacity: 0.4,
  },
  suggestButtonText: {
    color: theme.onAccent,
    fontSize: 14,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 12,
  },
  locked: {
    opacity: 0.4,
  },
  // One category per row: slim rotated-feeling label gutter, knobs flowing
  // right (wrapping only when the window is too narrow for the row).
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
    gap: 4,
  },
  categoryLabel: {
    width: 58,
    paddingTop: 20,
    color: theme.textFaint,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'right',
  },
  categoryKnobs: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  toastHost: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: theme.cardDeep,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 20,
  },
  toastErr: { borderColor: theme.dangerBorder },
  toastIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.success,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  toastIconErr: { backgroundColor: theme.danger, shadowColor: theme.danger },
  toastCheck: {
    color: theme.onAccent,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 18,
  },
  toastTextCol: { flexShrink: 1 },
  toastTitle: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '700',
  },
  toastSub: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  offlineBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.dangerWash,
    borderWidth: 1,
    borderColor: theme.dangerBorder,
  },
  offlineText: { color: theme.dangerSoft, fontSize: 12 },
  // Screen-level knob tooltip (see KnobTooltip) — absolutely positioned above
  // the hot knob, never clipped by panels or rows.
  tooltip: {
    position: 'absolute',
    backgroundColor: theme.cardDeep,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  tooltipTitle: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  tooltipText: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  tooltipCaret: {
    position: 'absolute',
    bottom: -6,
    width: 10,
    height: 10,
    backgroundColor: theme.cardDeep,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border,
    transform: [{ rotate: '45deg' }],
  },
});

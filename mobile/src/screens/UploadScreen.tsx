import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { importVideo, type ImportStage } from '../media/importVideo';
import { listProjects, openProject, type SavedProject } from '../media/savedProjects';
import { Badge, LcdLabel, LcdPanel, LcdValue, MetalPlate, WoodSurface } from '../components/material';
import { radius, theme } from '../theme';

// null = idle. 'opening' covers the gap between tapping and the picker
// returning; 'copying' mirrors importVideo's one awaited stage. Decode happens
// in the background on the edit screen, so it isn't a stage here.
type Progress = 'opening' | ImportStage | null;

const PROGRESS_LABEL: Record<Exclude<Progress, null>, string> = {
  opening: 'Opening picker…',
  copying: 'Saving sources…',
};

// "Jul 12, 18:04" — enough to tell two saves of the same project apart.
const savedAtLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

// Shown only when no video is loaded (see App). Picks a video and persists it;
// on success the session gains a video and App swaps to the edit screen, so
// this component never has to navigate itself.
//
// Errors are intentionally NOT caught — they propagate so Expo's debug
// overlay (redbox) shows the full stack during development. The one exception
// is listing saved projects: the saver sidecar being down must not take the
// import path down with it, so that failure is shown in place (still naming
// the command that fixes it) instead of thrown.
export default function UploadScreen({
  onRecord,
}: {
  onRecord?: () => void;
}) {
  const [progress, setProgress] = useState<Progress>(null);

  // Saved projects live under the saver's root (SAVED_DATA_DIR) and are opened
  // by name — no file picker, since a browser one can't be aimed at a folder.
  // Desktop-only, like saving.
  const savedProjectsSupported = Platform.OS === 'web';
  const [projects, setProjects] = useState<SavedProject[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!savedProjectsSupported) return;
    listProjects().then(setProjects, (err: Error) => setListError(err.message));
  }, [savedProjectsSupported]);

  const onPick = async () => {
    setProgress('opening');
    const result = await importVideo(setProgress);
    // On `imported`, the session update unmounts this screen. On `canceled`,
    // fall back to idle so the user can try again.
    if (result.status === 'canceled') setProgress(null);
  };

  // Reopen a project saved from the editor. The media streams back from the
  // saver sidecar on localhost; loading the session unmounts this screen.
  const onOpen = async (dir: string) => {
    setProgress('copying');
    await openProject(dir);
  };

  const processing = progress !== null;

  return (
    <WoodSurface style={styles.container}>
      {/* The name is engraved on a plate bolted to the chassis, the way a deck
          wears its badge — not set as a web headline. */}
      <MetalPlate style={styles.namePlate} r={radius.sm}>
        <Text style={styles.title}>TIMBER</Text>
      </MetalPlate>

      {processing ? (
        <View style={styles.processing}>
          <ActivityIndicator color={theme.lcdOn} />
          <Text style={styles.processingText}>
            {progress ? PROGRESS_LABEL[progress] : ''}
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.subtitle}>
            Upload a video to start editing. Pick several to layer extra audio
            tracks — the first one provides the video.
          </Text>
          <Pressable onPress={onPick}>
            {({ pressed }) => (
              <MetalPlate style={styles.button} inset={pressed} r={radius.md}>
                <Text style={styles.buttonText}>Choose video(s)</Text>
              </MetalPlate>
            )}
          </Pressable>

          {savedProjectsSupported && (
            <View style={styles.saved}>
              <Badge tone="steel" style={styles.savedBadge}>
                Saved projects
              </Badge>
              {listError ? (
                <Text style={styles.savedError}>{listError}</Text>
              ) : projects === null ? (
                <ActivityIndicator color={theme.textMuted} />
              ) : projects.length === 0 ? (
                <Text style={styles.savedEmpty}>
                  Nothing saved yet — projects you save from the editor show up
                  here.
                </Text>
              ) : (
                // The list is one pane of glass with the takes lit on it, rather
                // than a stack of separate cards floating on the wood.
                <LcdPanel style={styles.savedGlass}>
                  <ScrollView style={styles.savedList}>
                    {projects.map((project) => (
                      <Pressable
                        key={project.dir}
                        style={styles.savedRow}
                        onPress={() => onOpen(project.dir)}
                      >
                        {/* Track count reads as a lit figure — the number is the
                            fact you scan the list for. */}
                        <LcdValue size={19} style={styles.savedCount}>
                          {String(project.tracks)}
                        </LcdValue>
                        <View style={styles.savedText}>
                          <Text style={styles.savedName} numberOfLines={1}>
                            {project.name}
                          </Text>
                          <LcdLabel>
                            {project.tracks === 1 ? 'track' : 'tracks'}
                            {'  ·  '}
                            {savedAtLabel(project.savedAt)}
                          </LcdLabel>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                </LcdPanel>
              )}
            </View>
          )}

          {onRecord && (
            <Pressable style={styles.recordLink} onPress={onRecord}>
              <Text style={styles.recordLinkText}>Record a take -&gt;</Text>
            </Pressable>
          )}
        </>
      )}

      <StatusBar style="light" />
    </WoodSurface>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 22,
  },
  namePlate: {
    paddingHorizontal: 22,
    paddingVertical: 7,
  },
  title: {
    // Engraved, not printed: dark letters cut into the metal, with a hairline of
    // light catching the bottom of each stroke.
    color: '#20242a',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 6,
    textShadowColor: 'rgba(255,255,255,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
  },
  subtitle: {
    color: theme.textSoft,
    fontSize: 16,
    textAlign: 'center',
    maxWidth: 460,
    lineHeight: 23,
  },
  button: {
    paddingHorizontal: 30,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#20242a',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
    textShadowColor: 'rgba(255,255,255,0.30)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
  },
  saved: {
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    gap: 8,
  },
  savedBadge: {
    // Badge defaults to hugging its left edge; this one heads a centred column.
    alignSelf: 'center',
  },
  savedGlass: {
    alignSelf: 'stretch',
    paddingVertical: 4,
  },
  savedList: {
    alignSelf: 'stretch',
    maxHeight: 220,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    // Hairlines between takes, like rules etched on the display.
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(159,219,224,0.08)',
  },
  savedCount: {
    minWidth: 26,
    alignItems: 'flex-end',
  },
  savedText: {
    flex: 1,
    gap: 2,
  },
  savedName: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  savedEmpty: {
    color: theme.textFaint,
    fontSize: 14,
    textAlign: 'center',
  },
  savedError: {
    color: theme.dangerSoft,
    fontSize: 14,
    textAlign: 'center',
  },
  recordLink: {
    paddingVertical: 8,
  },
  recordLinkText: {
    color: theme.textMuted,
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  processing: {
    alignItems: 'center',
    gap: 12,
  },
  processingText: {
    color: theme.textSoft,
    fontSize: 16,
  },
});

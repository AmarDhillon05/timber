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
import { theme } from '../theme';

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
    <View style={styles.container}>
      <Text style={styles.title}>Timber</Text>

      {processing ? (
        <View style={styles.processing}>
          <ActivityIndicator color={theme.text} />
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
          <Pressable style={styles.button} onPress={onPick}>
            <Text style={styles.buttonText}>Choose video(s)</Text>
          </Pressable>

          {savedProjectsSupported && (
            <View style={styles.saved}>
              <Text style={styles.savedHeading}>Saved projects</Text>
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
                <ScrollView style={styles.savedList}>
                  {projects.map((project) => (
                    <Pressable
                      key={project.dir}
                      style={styles.savedRow}
                      onPress={() => onOpen(project.dir)}
                    >
                      <Text style={styles.savedName} numberOfLines={1}>
                        {project.name}
                      </Text>
                      <Text style={styles.savedMeta}>
                        {project.tracks} track{project.tracks === 1 ? '' : 's'}
                        {'  ·  '}
                        {savedAtLabel(project.savedAt)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          )}

          {onRecord && (
            <Pressable style={styles.recordLink} onPress={onRecord}>
              <Text style={styles.recordLinkText}>Record a take</Text>
            </Pressable>
          )}
        </>
      )}

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 24,
  },
  title: {
    color: theme.textMuted,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  subtitle: {
    color: theme.textSoft,
    fontSize: 16,
    textAlign: 'center',
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.accent,
  },
  buttonText: {
    color: theme.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
  saved: {
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    gap: 10,
  },
  savedHeading: {
    color: theme.textFaint,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  savedList: {
    alignSelf: 'stretch',
    maxHeight: 220,
  },
  savedRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    gap: 3,
  },
  savedName: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  savedMeta: {
    color: theme.textFaint,
    fontSize: 13,
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

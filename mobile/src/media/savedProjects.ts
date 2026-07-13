import {
  makeTrack,
  makeTrackFile,
  tallyUsage,
  trackActiveValues,
  zeroValues,
  type BlanketMode,
  type BlanketValues,
  type Track,
  type TrackFile,
} from '../data/TrackFile';
import { useSession } from '../state/session';
import { decodeTrackInBackground } from './importVideo';

// Save a project to disk and open it again — the app's "save_to" pair. The
// renderer has no disk access, so both directions go through the saver sidecar
// (saver/README.md): save PUTs every distinct media source plus a project.json
// manifest into saved_data/<project>/, and open reads them back through the
// sidecar's GET routes (decode and the video player consume http URLs the same
// way they consume blob URLs).
//
// There's deliberately no OS file picker on the open side. A browser file input
// can't be pointed at a directory, so a picker could never be scoped to the
// saved-data folder; instead the sidecar lists what's in it (`listProjects`)
// and the user opens one BY NAME. That keeps one directory — the sidecar's
// root, i.e. SAVED_DATA_DIR — as the only place projects are saved to or
// loaded from, and it's the same list on web and Electron.
//
// The manifest is the persisted TrackFile minus everything derived: pcm is
// rebuilt by decode on open, usage by tallyUsage. Media files are stored
// as-is (no re-encode), so a save costs one upload per distinct source.
//
// Desktop-side (web/Electron) like the rest of the sidecar plumbing. Per the
// project's error policy a missing sidecar isn't smoothed over: it fails with
// the command that starts it.

const SAVER_URL = process.env.EXPO_PUBLIC_SAVER_URL ?? 'http://localhost:8791';

const MANIFEST_FORMAT = 'timber-project@1';
const MANIFEST_NAME = 'project.json';

interface SavedTrack {
  name: string;
  /** Media file name inside the project folder. */
  file: string;
  editable: boolean;
  mode: BlanketMode;
  user: BlanketValues;
  generated: BlanketValues;
}

interface ProjectManifest {
  format: typeof MANIFEST_FORMAT;
  /** The folder this was saved into. Recorded so the file is self-describing;
   *  open resolves media against the folder it actually read the manifest from,
   *  so a renamed folder still opens. */
  dir: string;
  name: string;
  savedAt: string;
  video: { file: string; name: string } | null;
  tracks: SavedTrack[];
}

// Folder-safe name. Deterministic from the project name, so re-saving lands
// in the same folder (a plain overwrite, like saving to the same filename).
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';

// File extension for a fetched source: prefer its MIME type (blob and saver
// URLs both carry one), fall back to an extension already on the uri (native
// file:// copies keep their original name).
const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/webm': '.webm',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
};

function extFor(blob: Blob, uri: string): string {
  const mime = blob.type.split(';')[0].trim().toLowerCase();
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const match = /\.[a-z0-9]{2,4}$/i.exec(uri.split(/[?#]/)[0]);
  return match ? match[0].toLowerCase() : '.bin';
}

const fileUrl = (dir: string, name: string) =>
  `${SAVER_URL}/file/${encodeURIComponent(dir)}/${encodeURIComponent(name)}`;

async function putFile(dir: string, name: string, body: Blob | string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(fileUrl(dir, name), { method: 'PUT', body });
  } catch {
    throw new Error(
      `Saver sidecar not reachable at ${SAVER_URL}. Start it: ` +
        `\`node saver/server.js\` — run-dev does this automatically.`,
    );
  }
  if (!res.ok) throw new Error(`Saver sidecar: HTTP ${res.status} writing ${name}.`);
}

// --- Save --------------------------------------------------------------------

/** Write `file` to saved_data/<slug(file.name)>/ via the saver sidecar:
 *  every distinct media source once, then the manifest. Returns the folder. */
export async function saveProject(file: TrackFile): Promise<{ dir: string }> {
  const dir = slug(file.name);

  // Upload each distinct source once and remember its stored name — the video
  // usually IS track 0's file (importVideo points both at the same uri).
  const savedByUri = new Map<string, string>();
  const upload = async (uri: string, baseName: string): Promise<string> => {
    const cached = savedByUri.get(uri);
    if (cached) return cached;
    const blob = await (await fetch(uri)).blob();
    const name = `${baseName}${extFor(blob, uri)}`;
    await putFile(dir, name, blob);
    savedByUri.set(uri, name);
    return name;
  };

  const tracks: SavedTrack[] = [];
  for (let i = 0; i < file.tracks.length; i++) {
    const t = file.tracks[i];
    tracks.push({
      name: t.name,
      file: await upload(t.uri, `${i}-${slug(t.name)}`),
      editable: t.editable,
      mode: t.mode,
      user: t.user,
      generated: t.generated,
    });
  }

  const video = file.video
    ? { file: await upload(file.video.uri, 'video'), name: file.video.name }
    : null;

  const manifest: ProjectManifest = {
    format: MANIFEST_FORMAT,
    dir,
    name: file.name,
    savedAt: new Date().toISOString(),
    video,
    tracks,
  };
  await putFile(dir, MANIFEST_NAME, JSON.stringify(manifest, null, 2));

  return { dir };
}

// --- Open --------------------------------------------------------------------

/** One row of the "Open a saved project" list. */
export interface SavedProject {
  /** Folder under the saver's root — the handle `openProject` takes. */
  dir: string;
  name: string;
  /** ISO timestamp of the last save, or null for a manifest without one. */
  savedAt: string | null;
  tracks: number;
}

/** Every project in the saver's root, newest save first. */
export async function listProjects(): Promise<SavedProject[]> {
  let res: Response;
  try {
    res = await fetch(`${SAVER_URL}/projects`);
  } catch {
    throw new Error(
      `Saver sidecar not reachable at ${SAVER_URL}. Start it: ` +
        `\`node saver/server.js\` — run-dev does this automatically.`,
    );
  }
  if (!res.ok) throw new Error(`Saver sidecar: HTTP ${res.status} listing projects.`);
  return (await res.json()).projects as SavedProject[];
}

/** Load the project stored in `dir` into the session — the editor opens
 *  immediately and each track's PCM decodes in the background, exactly like
 *  importVideo. */
export async function openProject(dir: string): Promise<void> {
  const res = await fetch(fileUrl(dir, MANIFEST_NAME));
  if (!res.ok) throw new Error(`Saver sidecar: HTTP ${res.status} reading ${dir}/${MANIFEST_NAME}.`);
  const manifest = (await res.json()) as ProjectManifest;
  if (manifest.format !== MANIFEST_FORMAT) {
    throw new Error(`Not a Timber project manifest (expected format ${MANIFEST_FORMAT}).`);
  }

  const tracks: Track[] = manifest.tracks.map((saved) => {
    const track: Track = {
      ...makeTrack({
        name: saved.name,
        uri: fileUrl(dir, saved.file),
        editable: saved.editable,
      }),
      mode: saved.mode,
      // Layer over zeros so a manifest from before a new Blanket term still
      // yields a complete value set.
      user: { ...zeroValues(), ...saved.user },
      generated: { ...zeroValues(), ...saved.generated },
    };
    return { ...track, usage: tallyUsage(trackActiveValues(track)) };
  });

  const file = makeTrackFile({
    name: manifest.name,
    tracks,
    video: manifest.video
      ? { uri: fileUrl(dir, manifest.video.file), name: manifest.video.name }
      : null,
  });

  useSession.getState().load(file);
  for (const track of tracks) void decodeTrackInBackground(track.id, track.uri);
}

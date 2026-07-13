import { Platform } from 'react-native';
import { File } from 'expo-file-system';

// Byte size of the media behind a track/video URI. Native reads it straight
// off the File API (synchronous, but kept async for one cross-platform shape);
// web has no File API, so the blob URL is fetched back into a Blob and asked
// its size — cheap, since a blob-URL fetch hands back the same backing data.
// null = unknown (missing file, revoked blob URL, unreadable).
//
// URIs are stable for the life of a session (imports are persisted once), so
// results are cached — several readouts of the same source cost one lookup.
const cache = new Map<string, number | null>();

export async function uriByteSize(uri: string): Promise<number | null> {
  const hit = cache.get(uri);
  if (hit !== undefined) return hit;

  let size: number | null = null;
  try {
    if (Platform.OS === 'web') {
      size = (await (await fetch(uri)).blob()).size;
    } else {
      const bytes = new File(uri).size; // 0 = missing/unreadable
      size = bytes > 0 ? bytes : null;
    }
  } catch {
    size = null;
  }
  cache.set(uri, size);
  return size;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

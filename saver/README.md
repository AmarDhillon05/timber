# Timber saver — the project-persistence sidecar

A small standalone helper that lets the app **save and reopen projects as
plain files** under `saved_data/` at the repo root (gitignored). The app runs
in a browser/Electron renderer with no disk access, so its "save project"
action PUTs the manifest + each track's media here, and opening a saved
project streams the media back out.

Zero dependencies (like the relay and the Linux recorder): run it with a bare

```bash
node saver/server.js
```

The dev scripts (`scripts/run-dev.sh` / `run-dev.ps1`) start it automatically.

## Protocol

HTTP on `http://127.0.0.1:8791` (override with the `SAVER_PORT` env var; the
app reads `EXPO_PUBLIC_SAVER_URL`). Bound to loopback only — this writes to
the local disk, never expose it to a network.

- `GET /` → `{"name":"timber-saver","root":"…"}` — health probe.
- `GET /projects` → `{"root":"…","projects":[{"dir","name","savedAt","tracks"}]}`
  — every folder under the root holding a readable `project.json`, newest save
  first. This is the app's "Open a saved project" list; folders without a
  valid manifest are skipped, not errors.
- `PUT /file/<project>/<name>` — write the raw request body to
  `<root>/<project>/<name>` (folder created as needed; written via a `.part`
  rename so torn uploads never look like complete files).
- `GET /file/<project>/<name>` — the stored bytes. Honours single `Range`
  requests so the video element can seek.

`<project>` and `<name>` must be single path segments (no separators, no
`..`), so requests can never escape the root.

## Where projects live: `SAVED_DATA_DIR`

The storage root defaults to `<repo>/saved_data` and moves with the
`SAVED_DATA_DIR` env var — `scripts/run-dev.sh --saved-data <dir>` /
`run-dev.ps1 -SavedData <dir>` set it (and honour the env var directly). It is
the **only** folder projects are written to or opened from: saving PUTs here,
and the open list is literally this folder's contents, so one variable moves
both directions at once.

That's also why there's no OS file picker on the open side. A browser file
input can't be aimed at a directory, so a picker could never be confined to
this folder; the app asks for the list and opens a project by name instead —
same behaviour in the browser and in Electron.

## On-disk layout

One folder per project, holding the media files as-is plus a `project.json`
manifest (see `mobile/src/media/savedProjects.ts` — format
`timber-project@1`): track names, which media file each track plays, and each
track's Blanket edit state. Decoded PCM is never stored; it's rebuilt from the
media on open. The media files are ordinary wav/webm/mp4 — playable directly
from the folder.

## How the app uses it

`mobile/src/media/savedProjects.ts` implements both directions: `saveProject`
(the edit screen's Save button / Ctrl+S) uploads every distinct source once
and then the manifest; `listProjects` + `openProject` back the main screen's
"Saved projects" list, pointing each track's `uri` at this server's GET route
— decode and playback work on those URLs exactly as they do on blob URLs.

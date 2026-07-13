// Timber saver — the project-persistence sidecar.
//
// The app runs in a browser/Electron renderer, which can't touch the repo's
// disk, so saving a project ("save_to") goes through this helper: the app PUTs
// each track's media plus a project.json manifest here, and this writes them
// under saved_data/<project>/ at the repo root. Opening a saved project reads
// the media back through the GET route (with Range support, so the video
// element can seek).
//
// Dependency-free on purpose (like the relay/recorder): Node's http + fs, so
// it runs with a bare `node server.js`. Loopback-only — this writes to the
// local disk and has no business on a network.
//
// Protocol (all responses carry CORS `*` for the localhost app origin):
//   GET /                        → { name: "timber-saver", root } health probe
//   GET /projects                → the saved projects, newest first
//   PUT /file/<project>/<name>   → write the raw body to saved_data/<project>/<name>
//   GET /file/<project>/<name>   → the stored bytes (honours Range)
//
// <project> and <name> are single path segments — anything containing a
// separator or ".." is rejected, so requests can never escape saved_data/.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.SAVER_PORT ?? 8791);
const ROOT = process.env.SAVED_DATA_DIR ?? path.join(__dirname, '..', 'saved_data');

// Content types the app round-trips; the save side derives file extensions
// from blob MIME types, so this map is its mirror. Anything else streams as
// octet-stream (the decoder reads bytes, not types).
const MIME = {
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

// Resolve /file/<project>/<name> to a path inside ROOT, or null. Each segment
// is percent-decoded and must be a plain entry name — no separators, no
// dot-dot — which is what confines every request to saved_data/.
function target(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'file') return null;
  let project, name;
  try {
    [project, name] = [decodeURIComponent(parts[1]), decodeURIComponent(parts[2])];
  } catch {
    return null;
  }
  const plain = (s) =>
    s && !s.includes('/') && !s.includes('\\') && s !== '.' && s !== '..';
  if (!plain(project) || !plain(name)) return null;
  return { project, name, abs: path.join(ROOT, project, name) };
}

// Every project under ROOT, newest save first: one entry per folder holding a
// readable project.json. This is what the app's "Open a saved project" list is
// built from — no OS file picker is involved, so ROOT (i.e. SAVED_DATA_DIR) is
// the only place a project can be opened from, exactly as it's the only place
// one can be saved to. A folder whose manifest is missing or unparseable is
// skipped rather than failing the listing: it's some other directory, not a
// broken project.
function listProjects() {
  let entries;
  try {
    entries = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return []; // Nothing saved yet — the folder is created on first PUT.
  }
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(ROOT, entry.name, 'project.json'), 'utf8'));
    } catch {
      continue;
    }
    projects.push({
      dir: entry.name,
      name: manifest.name ?? entry.name,
      savedAt: manifest.savedAt ?? null,
      tracks: manifest.tracks?.length ?? 0,
    });
  }
  return projects.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

const server = http.createServer((req, res) => {
  cors(res);
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && pathname === '/') {
    return json(res, 200, { name: 'timber-saver', root: ROOT });
  }

  if (req.method === 'GET' && pathname === '/projects') {
    return json(res, 200, { root: ROOT, projects: listProjects() });
  }

  const file = target(pathname);
  if (!file) return json(res, 404, { error: 'Expected /file/<project>/<name>.' });

  if (req.method === 'PUT') {
    // Stream the body to <name>.part, then rename into place, so a torn
    // upload never masquerades as a complete file.
    fs.mkdirSync(path.dirname(file.abs), { recursive: true });
    const part = `${file.abs}.part`;
    const out = fs.createWriteStream(part);
    let bytes = 0;
    req.on('data', (c) => (bytes += c.length));
    req.pipe(out);
    out.on('finish', () => {
      fs.renameSync(part, file.abs);
      console.log(`[saver] wrote ${file.project}/${file.name} (${bytes} bytes)`);
      json(res, 200, { ok: true, bytes });
    });
    const fail = (err) => {
      console.error(`[saver] write failed: ${err.message}`);
      fs.rmSync(part, { force: true });
      json(res, 500, { error: err.message });
    };
    out.on('error', fail);
    req.on('error', fail);
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    let stat;
    try {
      stat = fs.statSync(file.abs);
    } catch {
      return json(res, 404, { error: `No such file: ${file.project}/${file.name}` });
    }

    // Minimal single-range support — enough for <video> seeking.
    let start = 0;
    let end = stat.size - 1;
    let code = 200;
    const headers = {
      'Content-Type': MIME[path.extname(file.name).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      code = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(code, headers);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file.abs, { start, end }).pipe(res);
  }

  json(res, 405, { error: `Unsupported method: ${req.method}` });
});

// Loopback only: a disk-writing helper has no business on the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[saver] writing to ${ROOT}`);
  console.log(`[saver] listening on http://127.0.0.1:${PORT}`);
});

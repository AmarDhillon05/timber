// Timber control relay — the "middleman".
//
// A tiny SSE switchboard that lets a phone controller drive the Timber desktop
// even when the two are on different networks. Neither device exposes anything:
// the DESKTOP dials out and holds an SSE stream open here; the PHONE POSTs
// commands here; the relay copies each command into the matching desktop's
// stream. Both connections are outbound, so NAT/firewalls are a non-issue.
//
// Dependency-free on purpose (Node's built-in http) so it runs with a bare
// `node server.js` on any cheap always-on host. No app logic lives here — only
// pairing and message forwarding.
//
// Protocol:
//   POST /pair/request            (desktop) → { token, code }
//   GET  /events?token=…          (desktop) → SSE stream of commands + mic events
//   POST /pair/confirm { code }   (phone)   → { token } + 'paired' on the stream
//   POST /command { token, type } (phone)   → writes the command to the stream
//   POST /unpair { token, role }  (either)  → notifies the other side, deletes the room
//
// Phone-mic streaming (the phone doubles as a remote microphone):
//   GET  /phone/events?token=…          (phone)   → SSE stream of desktop requests
//   POST /phone/command { token, type } (desktop) → mic-start / mic-stop to the phone
//   POST /mic/event { token, kind, … }  (phone)   → mic lifecycle (ready/started/
//                                                   ended/off) → desktop, event: mic
//   POST /mic/chunk?token=…&seq=…       (phone)   → one raw audio chunk, forwarded
//                                                   base64 → desktop, event: mic

const http = require('http');
const { randomUUID } = require('crypto');

// Listen port. Env-configurable so one RELAY_PORT can wire the relay and the
// clients' relay URLs together (see run-dev.ps1); defaults to 8787.
const PORT = Number(process.env.RELAY_PORT ?? 8787);
// Drop never-confirmed, never-connected pairings after this window (ms).
const ROOM_TTL = 10 * 60 * 1000;

// token -> { code, confirmed, stream, phoneStream, createdAt }
//   code        6-digit pairing code shown on the desktop
//   confirmed   true once the phone has entered the code
//   stream      the desktop's open SSE response (null until /events connects)
//   phoneStream the phone's open SSE response (null until /phone/events connects;
//               only opened when the phone enables its mic)
const rooms = new Map();

const sixDigits = () => String(Math.floor(100000 + Math.random() * 900000));

// Periodically evict stale, unused pairings so the map can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [token, room] of rooms) {
    if (!room.confirmed && !room.stream && now - room.createdAt > ROOM_TTL) {
      rooms.delete(token);
    }
  }
}, 60 * 1000).unref();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Buffer a raw (binary) request body — used for audio chunks, which are POSTed
// as-is rather than JSON-wrapped so the phone never has to base64 anything.
function readRaw(req) {
  return new Promise((resolve) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // Liveness probe. Anything that gets a 200 here has reached the relay — used
  // to sanity-check the pinned hotspot address from a phone browser (or curl)
  // before bothering to pair.
  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { ok: true, rooms: rooms.size });
  }

  // Desktop: mint a pairing code + token.
  if (req.method === 'POST' && pathname === '/pair/request') {
    const token = randomUUID();
    const code = sixDigits();
    rooms.set(token, {
      code,
      confirmed: false,
      stream: null,
      phoneStream: null,
      createdAt: Date.now(),
    });
    return sendJson(res, 200, { token, code });
  }

  // Desktop: open the SSE stream it will receive commands on.
  if (req.method === 'GET' && pathname === '/events') {
    const token = url.searchParams.get('token');
    const room = token && rooms.get(token);
    if (!room) return sendJson(res, 404, { error: 'unknown token' });

    cors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':ok\n\n'); // open the stream
    room.stream = res;
    // If the phone already confirmed before this stream connected, replay it.
    if (room.confirmed) res.write('event: paired\ndata: {}\n\n');

    // Heartbeat so idle streams aren't closed by proxies.
    const ping = setInterval(() => res.write(':ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      if (room.stream === res) room.stream = null;
    });
    return;
  }

  // Phone: confirm the code → opens the control channel, notifies the desktop.
  if (req.method === 'POST' && pathname === '/pair/confirm') {
    const { code } = await readJson(req);
    const entry = [...rooms.entries()].find(
      ([, r]) => r.code === code && !r.confirmed,
    );
    if (!entry) return sendJson(res, 404, { error: 'bad code' });
    const [token, room] = entry;
    room.confirmed = true;
    if (room.stream) room.stream.write('event: paired\ndata: {}\n\n');
    return sendJson(res, 200, { token });
  }

  // Phone: forward a control command into the desktop's stream.
  if (req.method === 'POST' && pathname === '/command') {
    const { token, type } = await readJson(req);
    const room = token && rooms.get(token);
    if (!room || !room.confirmed) {
      console.log(`[relay] command '${type}' rejected: not paired`);
      return sendJson(res, 403, { error: 'not paired' });
    }
    if (!room.stream) {
      console.log(`[relay] command '${type}' rejected: desktop offline`);
      return sendJson(res, 409, { error: 'desktop offline' });
    }
    console.log(`[relay] command '${type}' phone -> desktop`);
    room.stream.write(`data: ${JSON.stringify({ type })}\n\n`);
    return sendJson(res, 200, { ok: true });
  }

  // Either side: tear down the pairing. Tells the OTHER side it's over (so its
  // UI can reset instead of looking paired forever), closes both streams, and
  // deletes the room — the token dies here.
  if (req.method === 'POST' && pathname === '/unpair') {
    const { token, role } = await readJson(req);
    const room = token && rooms.get(token);
    if (!room) return sendJson(res, 200, { ok: true }); // already gone — idempotent
    console.log(`[relay] unpair from ${role === 'desktop' ? 'desktop' : 'phone'} — closing room`);
    if (role !== 'desktop' && room.stream) {
      room.stream.write('event: unpaired\ndata: {}\n\n');
    }
    if (role === 'desktop' && room.phoneStream) {
      room.phoneStream.write(`data: ${JSON.stringify({ type: 'unpaired' })}\n\n`);
    }
    room.stream?.end();
    room.phoneStream?.end();
    rooms.delete(token);
    return sendJson(res, 200, { ok: true });
  }

  // Phone: open the SSE stream it receives desktop requests on (mic-start /
  // mic-stop). Mirrors /events; only opened once the phone enables its mic.
  if (req.method === 'GET' && pathname === '/phone/events') {
    const token = url.searchParams.get('token');
    const room = token && rooms.get(token);
    if (!room || !room.confirmed) return sendJson(res, 403, { error: 'not paired' });

    cors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(':ok\n\n');
    room.phoneStream = res;

    const ping = setInterval(() => res.write(':ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      if (room.phoneStream === res) room.phoneStream = null;
    });
    return;
  }

  // Desktop: forward a request into the phone's stream (mic-start / mic-stop).
  if (req.method === 'POST' && pathname === '/phone/command') {
    const { token, type } = await readJson(req);
    const room = token && rooms.get(token);
    if (!room || !room.confirmed) return sendJson(res, 403, { error: 'not paired' });
    if (!room.phoneStream) return sendJson(res, 409, { error: 'phone offline' });
    room.phoneStream.write(`data: ${JSON.stringify({ type })}\n\n`);
    return sendJson(res, 200, { ok: true });
  }

  // Phone: a mic lifecycle event (ready / started / ended / off), forwarded to
  // the desktop's stream under the named 'mic' event so control commands and
  // mic traffic never mix.
  if (req.method === 'POST' && pathname === '/mic/event') {
    const { token, ...event } = await readJson(req);
    const room = token && rooms.get(token);
    if (!room || !room.confirmed) return sendJson(res, 403, { error: 'not paired' });
    if (!room.stream) return sendJson(res, 409, { error: 'desktop offline' });
    room.stream.write(`event: mic\ndata: ${JSON.stringify(event)}\n\n`);
    return sendJson(res, 200, { ok: true });
  }

  // Phone: one recorded audio chunk, POSTed raw. SSE is text-only, so the relay
  // base64s it here (once) into the same 'mic' event stream. Chunks may arrive
  // out of order across HTTP requests — the desktop reassembles by `seq`.
  if (req.method === 'POST' && pathname === '/mic/chunk') {
    const token = url.searchParams.get('token');
    const seq = Number(url.searchParams.get('seq'));
    const room = token && rooms.get(token);
    if (!room || !room.confirmed) return sendJson(res, 403, { error: 'not paired' });
    if (!room.stream) return sendJson(res, 409, { error: 'desktop offline' });
    const body = await readRaw(req);
    const payload = { kind: 'chunk', seq, data: body.toString('base64') };
    room.stream.write(`event: mic\ndata: ${JSON.stringify(payload)}\n\n`);
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[relay] listening on :${PORT}`);
});

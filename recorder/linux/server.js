// Timber recorder — Linux implementation (PipeWire).
//
// Captures the default sink's monitor (i.e. whatever the machine is playing)
// by spawning `pw-record` and streaming its raw PCM to the Timber app over a
// local WebSocket. Speaks the protocol documented in ../README.md; the Windows
// implementation (../windows) is a drop-in replacement on the same port.
//
// Dependency-free on purpose (like the relay): Node's http + a minimal
// RFC 6455 server-side implementation below, so it runs with a bare
// `node server.js`. Loopback-only — this is a local capture helper.

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { runMedia } = require('./media');

const PORT = Number(process.env.RECORDER_PORT ?? 8790);

// What pw-record is asked to produce; announced to the client in `hello` so
// the app can build a WAV header around the raw frames.
const FORMAT = { encoding: 's16le', sampleRate: 48000, channels: 2 };

// --- WebSocket framing (server side) ---------------------------------------
// Just enough of RFC 6455 for this protocol: unfragmented text/binary out,
// masked text/ping/close in. Control payloads here are tiny JSON commands, so
// fragmented client frames are not supported (and never occur in practice).

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

const sendJson = (sock, obj) =>
  sock.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj))));
const sendBinary = (sock, buf) => sock.write(encodeFrame(0x2, buf));
const sendClose = (sock) => sock.write(encodeFrame(0x8, Buffer.alloc(0)));

// Incremental parser: feed TCP chunks, get complete frames out. Returns the
// bytes consumed so the caller can keep a rolling buffer.
function parseFrames(buffer, onFrame) {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let len = buffer[offset + 1] & 0x7f;
    let head = 2;
    if (len === 126) {
      if (buffer.length - offset < 4) break;
      len = buffer.readUInt16BE(offset + 2);
      head = 4;
    } else if (len === 127) {
      if (buffer.length - offset < 10) break;
      len = Number(buffer.readBigUInt64BE(offset + 2));
      head = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buffer.length - offset < head + maskLen + len) break;

    let payload = buffer.subarray(
      offset + head + maskLen,
      offset + head + maskLen + len,
    );
    if (masked) {
      const mask = buffer.subarray(offset + head, offset + head + 4);
      payload = Buffer.from(payload); // unmask a copy, not the rolling buffer
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    onFrame(opcode, payload);
    offset += head + maskLen + len;
  }
  return offset;
}

// --- Capture ----------------------------------------------------------------

// `-P { stream.capture.sink = true }` makes pw-record capture the DEFAULT
// SINK'S MONITOR (the output mix) instead of a microphone; `-` streams raw
// PCM to stdout. Verified against pw-record 1.x.
const PW_ARGS = [
  `--format=s16`,
  `--rate=${FORMAT.sampleRate}`,
  `--channels=${FORMAT.channels}`,
  '-P',
  '{ stream.capture.sink = true }',
  '-',
];

const server = http.createServer((req, res) => {
  // Plain-HTTP probe (nice for humans/health checks); the real API is the
  // WebSocket upgrade below.
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ name: 'timber-recorder', os: 'linux', format: FORMAT }));
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  // Per-connection capture state. Disconnecting kills the capture; nothing
  // survives a connection.
  let child = null;
  let stopping = false;

  const fail = (message) => {
    console.error(`[recorder] ${message}`);
    sendJson(socket, { event: 'error', message });
  };

  // Media control (../README.md, "Media control"): stateless one-shots against
  // whatever player is on MPRIS — deliberately independent of the capture
  // state above, so a skip can never disturb a take in progress. Failures go
  // back as ok:false on the SAME id rather than through fail(), because
  // `error` means "the capture is dead" and a refused skip isn't that.
  const handleMedia = async ({ id, action, deltaSeconds }) => {
    try {
      await runMedia(action, deltaSeconds);
      console.log(`[recorder] media '${action}' ok`);
      sendJson(socket, { event: 'media-result', id, ok: true });
    } catch (err) {
      console.error(`[recorder] media '${action}' failed: ${err.message}`);
      sendJson(socket, { event: 'media-result', id, ok: false, message: err.message });
    }
  };

  const startCapture = () => {
    if (child) return fail('A capture is already running.');
    console.log('[recorder] capture start');
    stopping = false;
    const proc = spawn('pw-record', PW_ARGS, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = proc;

    let started = false;
    proc.stdout.on('data', (chunk) => {
      // First audio data = capture is truly live; this is the take-alignment
      // signal (the app's musicOffsetSec is measured against it).
      if (!started) {
        started = true;
        sendJson(socket, { event: 'started' });
      }
      sendBinary(socket, chunk);
    });
    // stdout 'end' fires after the process exits AND every byte has been
    // read, so `ended` really does trail the last binary frame.
    proc.stdout.on('end', () => {
      if (child === proc) {
        child = null;
        console.log('[recorder] capture ended');
        sendJson(socket, { event: 'ended' });
        if (!stopping) fail('pw-record exited on its own — is PipeWire running?');
      }
    });

    let stderr = '';
    proc.stderr.on('data', (c) => (stderr += c));
    proc.on('error', (err) => {
      // Spawn failure (pw-record missing). stdout 'end' won't carry context.
      child = null;
      fail(`Could not start pw-record: ${err.message}`);
    });
    proc.on('exit', (code) => {
      if (!stopping && code !== 0 && stderr.trim()) {
        console.error(`[recorder] pw-record: ${stderr.trim()}`);
      }
    });
  };

  const stopCapture = () => {
    if (!child) return fail('No capture is running.');
    stopping = true;
    // SIGINT = pw-record's clean Ctrl-C path (it drains and exits; SIGTERM is
    // unreliable while it's streaming). SIGKILL fallback just in case.
    const proc = child;
    proc.kill('SIGINT');
    setTimeout(() => {
      if (child === proc) proc.kill('SIGKILL');
    }, 1000).unref();
  };

  sendJson(socket, {
    event: 'hello',
    name: 'linux · pipewire (pw-record)',
    format: FORMAT,
  });

  let pending = Buffer.alloc(0);
  socket.on('data', (data) => {
    pending = Buffer.concat([pending, data]);
    const consumed = parseFrames(pending, (opcode, payload) => {
      if (opcode === 0x1) {
        let msg = {};
        try {
          msg = JSON.parse(payload.toString());
        } catch {
          return fail('Malformed command (expected JSON).');
        }
        if (msg.cmd === 'start') startCapture();
        else if (msg.cmd === 'stop') stopCapture();
        else if (msg.cmd === 'media') void handleMedia(msg);
        else fail(`Unknown command: ${JSON.stringify(msg)}`);
      } else if (opcode === 0x9) {
        socket.write(encodeFrame(0xa, payload)); // ping → pong
      } else if (opcode === 0x8) {
        sendClose(socket);
        socket.end();
      }
    });
    pending = pending.subarray(consumed);
  });

  const cleanup = () => {
    stopping = true;
    child?.kill('SIGKILL');
    child = null;
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

// Loopback only: a capture helper has no business on the network.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[recorder] linux/pipewire listening on ws://127.0.0.1:${PORT}`);
});

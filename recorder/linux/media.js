// MPRIS media control — the Linux answer to Windows SMTC. Drives whatever
// MPRIS-capable player is running (Spotify, Firefox, VLC, mpv, …) over the
// D-Bus session bus, so the recorder sidecar can execute the phone remote's
// transport commands (see ../README.md, "Media control").
//
// Dependency-free like the rest of the sidecar: each call shells out to
// `dbus-send` (present on any desktop Linux) instead of pulling in a native
// D-Bus binding — the same move server.js makes with pw-record.
//
// MPRIS has no "current session" manager like SMTC, so we follow the playerctl
// convention: list org.mpris.MediaPlayer2.* bus names and prefer the player
// that's Playing, then Paused, then whichever registered first.

const { execFile } = require('child_process');

const OBJECT_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

// Run dbus-send and resolve with its --print-reply output. Parsing is
// regex-level on purpose: the output format is stable and we only ever need
// one quoted value out of it.
function dbusSend(dest, path, member, ...args) {
  return new Promise((resolve, reject) => {
    execFile(
      'dbus-send',
      ['--session', '--print-reply', `--dest=${dest}`, path, member, ...args],
      (err, stdout, stderr) => {
        if (err) {
          // dbus-send puts the useful diagnosis ("Failed to connect to socket",
          // "The name … was not provided") on stderr; surface that, not the
          // generic exit-code message.
          reject(new Error(stderr.trim() || err.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

async function listPlayers() {
  const out = await dbusSend(
    'org.freedesktop.DBus',
    '/org/freedesktop/DBus',
    'org.freedesktop.DBus.ListNames',
  );
  return [...out.matchAll(/"(org\.mpris\.MediaPlayer2\.[^"]+)"/g)].map((m) => m[1]);
}

async function playbackStatus(player) {
  try {
    const out = await dbusSend(
      player,
      OBJECT_PATH,
      'org.freedesktop.DBus.Properties.Get',
      `string:${PLAYER_IFACE}`,
      'string:PlaybackStatus',
    );
    return out.match(/"(Playing|Paused|Stopped)"/)?.[1] ?? 'Stopped';
  } catch {
    return 'Stopped'; // a player that won't answer is as good as stopped
  }
}

async function currentPlayer() {
  const players = await listPlayers();
  if (players.length === 0) {
    throw new Error('No media player is running (nothing on MPRIS to control).');
  }
  if (players.length === 1) return players[0];
  const statuses = await Promise.all(players.map(playbackStatus));
  for (const preferred of ['Playing', 'Paused']) {
    const i = statuses.indexOf(preferred);
    if (i !== -1) return players[i];
  }
  return players[0];
}

async function call(member, ...args) {
  const player = await currentPlayer();
  await dbusSend(player, OBJECT_PATH, `${PLAYER_IFACE}.${member}`, ...args);
}

// action → MPRIS method. rewind = previous track, matching the Windows core;
// toggle is the stateless play/pause flip the remote's main button sends.
const SIMPLE = {
  play: 'Play',
  pause: 'Pause',
  stop: 'Stop',
  toggle: 'PlayPause',
  next: 'Next',
  rewind: 'Previous',
};

/**
 * Execute one media action. `deltaSeconds` only applies to seekBy — MPRIS
 * Seek is RELATIVE (microseconds), so unlike SMTC there's no read-position/
 * clamp dance; players clamp to the track bounds themselves.
 */
async function runMedia(action, deltaSeconds) {
  if (action === 'seekBy') {
    if (!Number.isFinite(deltaSeconds)) {
      throw new Error(`seekBy needs a finite deltaSeconds (got ${deltaSeconds}).`);
    }
    return call('Seek', `int64:${Math.round(deltaSeconds * 1e6)}`);
  }
  const method = SIMPLE[action];
  if (!method) throw new Error(`Unknown media action: ${JSON.stringify(action)}`);
  return call(method);
}

module.exports = { runMedia };

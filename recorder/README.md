# Timber recorder — the system-audio sidecar

A small standalone helper that captures **system audio** (whatever the machine
is playing) with native OS tools and streams it to the Timber app over a local
WebSocket. It replaces the browser's screen-share capture path
(`getDisplayMedia`), which needed a picker, a fake video track, and only worked
on Windows in a plain browser.

One implementation per OS, all speaking the **same protocol on the same port**,
so they're interchangeable — the app neither knows nor cares which one is
running:

| Host    | Implementation                | Capture path                        | Media control | Run with |
| ------- | ----------------------------- | ----------------------------------- | ------------- | -------- |
| Linux   | `linux/server.js` (Node, zero deps) | PipeWire sink monitor via `pw-record` | MPRIS (`dbus-send`) | `node linux/server.js` |
| Windows | `windows/` (C# / NAudio)      | WASAPI loopback                     | SMTC (WinRT)  | `dotnet run --project windows` |
| macOS   | not yet                       | (ScreenCaptureKit, later)           | (later)       | —        |

The dev scripts (`scripts/run-dev.sh` / `run-dev.ps1`) start the right one for
the host automatically.

## Protocol

WebSocket on `ws://127.0.0.1:8790` (override with the `RECORDER_PORT` env var;
the app reads `EXPO_PUBLIC_RECORDER_URL`). Bound to loopback only — this is a
local capture helper, never expose it to a network.

Text frames are JSON control messages; binary frames are raw interleaved PCM.

Server → client:

- `{"event":"hello","name":"…","format":{"encoding":"s16le"|"f32le","sampleRate":48000,"channels":2}}`
  — sent immediately on connect. `format` describes the binary frames; the app
  builds the WAV header from it, so implementations are free to ship whatever
  their native capture produces (Linux: s16le, Windows WASAPI: usually f32le).
  A server MAY re-send `hello` after `start` but before `started` (Windows does:
  WASAPI only reveals the device mix format once a capture exists) — clients
  must always honour the most recent one.
- `{"event":"started"}` — capture has actually begun (first audio data seen).
  This is the take-alignment signal, mirroring the phone mic's `started` event.
- binary frames — raw PCM in the hello format, in order, until `ended`.
- `{"event":"ended"}` — capture stopped and every audio frame has been sent.
- `{"event":"error","message":"…"}` — something failed; the capture (if any)
  is dead. Per the project's error policy the app surfaces this loudly.

Client → server:

- `{"cmd":"start"}` — begin capturing. Starting while a capture is live is an
  `error`.
- `{"cmd":"stop"}` — stop capturing; the server flushes remaining audio and
  sends `ended`.

Disconnecting mid-capture kills the capture — no state survives a connection.

## Media control

The sidecar also executes transport commands against whatever the machine is
playing (the same sources the loopback capture records) — this is how the
phone remote's skip/play-pause buttons land on the OS. Native backends mirror
the capture ones: MPRIS over D-Bus on Linux (`linux/media.js`), SMTC /
GlobalSystemMediaTransportControls on Windows (`windows/MediaControl.cs`) —
the same machinery behind the media-key overlay.

This is why media control needs no Electron: like capture, it's just
`ws://localhost`, so it works in a plain browser too.

Commands are stateless one-shots, fully independent of capture state (a skip
can never disturb a take), and may share a connection with a capture or use
their own — the app opens a short-lived connection per command.

- client → `{"cmd":"media","id":1,"action":"toggle"}` — actions: `play`,
  `pause`, `stop`, `toggle` (stateless play/pause flip), `next`, `rewind`
  (previous track), and `seekBy` which carries `"deltaSeconds":±N`.
- server → `{"event":"media-result","id":1,"ok":true}` — or
  `"ok":false,"message":"…"` if the action was refused (e.g. no player is
  running). `id` echoes the command's, so a client can correlate replies. A
  refused media action is NEVER an `error` event — that one means the capture
  died.

## How the app uses it

`mobile/src/audio/systemAudio/service.ts` implements the app-side
`SystemAudioRecorder` contract on top of this protocol: `arm()` opens the
socket and waits for `hello` (failing loudly if the helper isn't running),
`start()`/`stop()` map to the commands, and the PCM is wrapped in a WAV header
and handed to the take as the "System audio" track.

`mobile/src/audio/mediaSession/service.ts` implements the app-side
`MediaController` contract on the media-control half: one short-lived
connection per command, resolving on `ok:true` and throwing the `message`
otherwise.

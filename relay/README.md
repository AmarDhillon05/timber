# Timber control relay

The middleman that routes media-control commands from the phone **controller**
to the Timber **desktop** over SSE, so the two can live on different networks.

## Run

```bash
cd relay
node server.js        # listens on :8787
```

No dependencies — plain Node. For real cross-network use, deploy this to any
always-on host with a public address and point both the desktop (`mobile/src/
controller/config.ts`) and the controller (`controller/src/config.ts`) at its
URL.

## Protocol

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/pair/request` | desktop | mint `{ token, code }` |
| GET | `/events?token=` | desktop | SSE stream of commands + `mic` events |
| POST | `/pair/confirm` | phone | confirm `{ code }` → `{ token }` |
| POST | `/command` | phone | forward `{ token, type }` to the desktop |

The desktop shows `code`; the phone enters it. After confirmation the relay
copies each `/command` into the desktop's open stream.

### Phone-mic streaming

When the phone shares its mic (so the desktop can record it as the drum track),
a second, phone-side channel comes up and audio flows back as chunked POSTs:

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| GET | `/phone/events?token=` | phone | SSE stream of desktop requests |
| POST | `/phone/command` | desktop | `{ token, type: 'mic-start' \| 'mic-stop' }` to the phone |
| POST | `/mic/event` | phone | lifecycle `{ token, kind: ready/started/ended/off, … }` |
| POST | `/mic/chunk?token=&seq=` | phone | one raw webm/opus chunk (relay base64s it) |

Mic traffic reaches the desktop under the named SSE event `mic`, so it never
mixes with control commands. Chunks are ordered by `seq` on the desktop; the
`ended` event carries the total count so the receiver knows when it has the
tail.

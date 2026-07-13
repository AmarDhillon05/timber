# Timber Remote (controller)

A minimal Expo app that pairs with the Timber desktop and controls playback over
the relay. Enter the code the desktop shows, then tap the big buttons.

## Run

```bash
cd controller
npm install
npx expo start          # scan the QR with Expo Go, or press w for web
```

Set `src/config.ts` `RELAY_URL` to your relay (its LAN IP for local testing, or
the public URL once deployed). The phone and desktop can be on different
networks — both only make outbound calls to the relay.

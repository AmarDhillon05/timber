import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useController } from './store';
import type { ControlCommand } from './types';
import { theme } from './theme';

// The phone remote. Enter the 6-digit code shown on the desktop to pair, then
// the screen becomes three zones that always fit the viewport (no scrolling):
// take controls on top, a transport row in the middle, and the connected-info
// panel at the bottom. Each transport button fires one ControlCommand through
// the relay to the desktop's media session.
//
// Icons are plain ASCII throughout (project style: no emoji).

// The transport row, in mockup order: skip back, rewind, play/pause, next
// track, skip forward. Play/pause is one stateless toggle — the phone doesn't
// know the desktop's playback state, so the OS resolves which way it flips.
const TRANSPORT: { icon: string; label: string; command: ControlCommand }[] = [
  { icon: '<<', label: 'Back 10 seconds', command: { type: 'back10' } },
  { icon: '|<', label: 'Rewind', command: { type: 'rewind' } },
  { icon: '||', label: 'Play / pause', command: { type: 'toggle' } },
  { icon: '>|', label: 'Next track', command: { type: 'next' } },
  { icon: '>>', label: 'Forward 10 seconds', command: { type: 'forward10' } },
];

// Label per mic state, so the one toggle button tells the whole story.
const MIC_LABEL: Record<string, string> = {
  off: 'Enable phone mic',
  ready: 'Mic shared — records a track with each take',
  streaming: 'REC — streaming mic to desktop…',
};

// Sharing the phone's mic needs getUserMedia, and a browser only hands that out
// to a SECURE CONTEXT — iOS Safari strictly so. Served off the laptop's hotspot
// the controller is a plain http:// origin (localhost is exempt; a LAN address
// is not), so on a real phone `navigator.mediaDevices` is simply undefined and
// no amount of tapping can produce a mic. Disable the toggle there and say why,
// rather than let it fail on tap.
//
// The gate is the capability itself, not a flag, so nothing here needs undoing:
// serve the relay and controller over HTTPS with a cert the phone trusts and the
// button lights up on its own. The streaming path in ./store is untouched either
// way — it only ever runs after enableMic().
const MIC_SUPPORTED =
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const MIC_UNAVAILABLE = 'Phone mic needs HTTPS — take control still works';

export function ControllerScreen() {
  const { status, mic, taking, error, confirm, send, enableMic, disableMic, unpair } =
    useController();
  const [entry, setEntry] = useState('');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Timber Remote</Text>

      {status === 'unpaired' ? (
        <View style={styles.center}>
          <Text style={styles.label}>Pairing code</Text>
          <TextInput
            style={styles.input}
            value={entry}
            onChangeText={setEntry}
            placeholder="000000"
            placeholderTextColor={theme.placeholder}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Text style={styles.hint}>Enter the code shown on your desktop.</Text>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable style={styles.primary} onPress={() => void confirm(entry)}>
            <Text style={styles.primaryText}>Connect</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Take controls (mockup top row): roll and stop the desktop's
              recorder from behind the kit. `taking` is pushed to us by the
              desktop, so these track the real state even when someone hits
              Record on the laptop itself. Starting also sends the desktop to
              its Record page and arms system audio — nothing to set up first. */}
          <View style={styles.takeRow}>
            <Pressable
              style={[styles.takeBtn, taking && styles.disabled]}
              disabled={taking}
              onPress={() => void send({ type: 'take-start' })}
            >
              <Text style={styles.takeText}>New take</Text>
            </Pressable>
            <Pressable
              style={[
                styles.takeBtn,
                styles.takeStop,
                taking && styles.takeStopLive,
                !taking && styles.disabled,
              ]}
              disabled={!taking}
              onPress={() => void send({ type: 'take-stop' })}
            >
              <Text
                style={[
                  styles.takeText,
                  taking ? styles.takeStopLiveText : styles.takeStopText,
                ]}
              >
                {taking ? 'REC - Stop take' : 'Stop take'}
              </Text>
            </Pressable>
          </View>

          {/* Transport: five round buttons that share the row's width, so the
              layout fits any phone without scrolling. */}
          <View style={styles.transportZone}>
            <View style={styles.transport}>
              {TRANSPORT.map((a) => (
                <Pressable
                  key={a.command.type}
                  accessibilityLabel={a.label}
                  style={styles.transportBtn}
                  onPress={() => void send(a.command)}
                >
                  <Text style={styles.transportIcon}>{a.icon}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Connected info: pairing status, the mic share toggle (tint tracks
              its state: idle card, green when shared, red while streaming, and
              dimmed where the origin can't grant a mic at all), and disconnect. */}
          <View style={styles.info}>
            <Text style={styles.infoStatus}>Connected to desktop</Text>
            {/* Send/mic failures land here (the store never throws at the UI). */}
            {error && <Text style={styles.error}>{error}</Text>}
            <Pressable
              style={[
                styles.micBtn,
                mic === 'ready' && styles.micBtnReady,
                mic === 'streaming' && styles.micBtnStreaming,
                !MIC_SUPPORTED && styles.micBtnOff,
              ]}
              disabled={!MIC_SUPPORTED}
              onPress={() => void (mic === 'off' ? enableMic() : disableMic())}
            >
              <Text style={[styles.micText, !MIC_SUPPORTED && styles.micTextOff]}>
                {MIC_SUPPORTED ? MIC_LABEL[mic] : MIC_UNAVAILABLE}
              </Text>
            </Pressable>
            <Pressable style={styles.linkBtn} onPress={unpair}>
              <Text style={styles.linkText}>Disconnect</Text>
            </Pressable>
          </View>
        </>
      )}

      <StatusBar style="light" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.surface,
    padding: 20,
    paddingTop: 64,
    gap: 20,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  label: {
    color: theme.textMuted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Silver digits — the code entry reads as engraved metal on the wood panel.
  input: {
    width: 220,
    textAlign: 'center',
    color: theme.accent,
    fontSize: 32,
    letterSpacing: 8,
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingVertical: 14,
    fontVariant: ['tabular-nums'],
  },
  hint: { color: theme.textFaint, fontSize: 13, textAlign: 'center' },
  error: { color: theme.dangerSoft, fontSize: 14, textAlign: 'center' },
  primary: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: 'center',
  },
  primaryText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 12, alignItems: 'center' },
  linkText: { color: theme.textMuted, fontSize: 15, fontWeight: '500' },
  // Take controls: two equal buttons splitting the top row.
  takeRow: { flexDirection: 'row', gap: 14 },
  takeBtn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: theme.accent,
    alignItems: 'center',
  },
  takeStop: { backgroundColor: theme.card },
  // A take is rolling: the stop button fills red, so the state is readable from
  // behind the kit.
  takeStopLive: { backgroundColor: theme.dangerDeep },
  takeText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
  takeStopText: { color: theme.textSoft },
  // Light text on the red fill — the dark `onAccent` default is unreadable there.
  takeStopLiveText: { color: theme.text },
  disabled: { opacity: 0.4 },
  // Transport: the middle zone takes the leftover height and centers the row;
  // buttons flex to share the width (capped so tablets don't get dinner plates).
  transportZone: { flex: 1, justifyContent: 'center' },
  transport: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  transportBtn: {
    flex: 1,
    maxWidth: 76,
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportIcon: {
    color: theme.onAccent,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -1,
  },
  // The bottom "connected info" panel groups status, mic, and disconnect.
  info: {
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: theme.cardDeep,
    borderWidth: 1,
    borderColor: theme.border,
  },
  infoStatus: {
    color: theme.success,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  micBtn: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: theme.card,
    alignItems: 'center',
  },
  micBtnReady: { backgroundColor: theme.successDeep },
  micBtnStreaming: { backgroundColor: theme.dangerDeep },
  micBtnOff: { opacity: 0.6 },
  micText: { color: theme.text, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  micTextOff: { color: theme.textFaint, fontWeight: '400' },
});

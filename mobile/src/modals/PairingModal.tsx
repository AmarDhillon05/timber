import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useController } from '../controller/store';
import { theme } from '../theme';

// Walks the desktop through pairing a phone, as a modal over whatever screen is
// active (replaces the old full-screen PairingScreen route). Presentation only —
// all pairing state lives in the controller store, so closing the modal
// mid-pairing leaves the code live: the phone can still confirm, and the
// RemoteBar keeps showing the pairing status.
export function PairingModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { status, code, notice, requestCode, unpair } = useController();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose}>
        {/* Pressable card swallows presses so they don't close via the scrim. */}
        <Pressable style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.title}>Remote</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>X</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {status === 'unpaired' && (
              <>
                {/* Why the last pairing ended, if it wasn't the user's doing. */}
                {notice && <Text style={styles.notice}>{notice}</Text>}
                <Text style={styles.copy}>
                  Pair your phone to control playback from across the room.
                </Text>
                <Pressable
                  style={styles.primary}
                  onPress={() => void requestCode()}
                >
                  <Text style={styles.primaryText}>Enable remote control</Text>
                </Pressable>
              </>
            )}

            {status === 'awaiting-confirmation' && (
              <>
                <Text style={styles.label}>Pairing code</Text>
                <Text style={styles.code}>{code}</Text>
                <Text style={styles.hint}>
                  Open Timber Remote on your phone and enter this code.
                </Text>
                <Text style={styles.waiting}>Waiting for your phone…</Text>
                <Pressable style={styles.linkBtn} onPress={unpair}>
                  <Text style={styles.linkText}>Cancel</Text>
                </Pressable>
              </>
            )}

            {status === 'paired' && (
              <>
                <Text style={styles.connected}>Remote connected</Text>
                <Text style={styles.hint}>
                  Your phone now controls playback on this machine.
                </Text>
                <Pressable style={styles.primary} onPress={onClose}>
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
                <Pressable style={styles.linkBtn} onPress={unpair}>
                  <Text style={styles.linkText}>Unpair</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: theme.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    gap: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: theme.text, fontSize: 18, fontWeight: '600', letterSpacing: 1 },
  close: { color: theme.textMuted, fontSize: 16 },
  body: { alignItems: 'center', gap: 16, paddingVertical: 12 },
  copy: { color: theme.textSoft, fontSize: 16, textAlign: 'center' },
  label: {
    color: theme.textMuted,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Silver digits — the pairing code reads as engraved metal on the wood panel.
  code: {
    color: theme.accent,
    fontSize: 56,
    fontWeight: '700',
    letterSpacing: 10,
    fontVariant: ['tabular-nums'],
  },
  hint: { color: theme.textFaint, fontSize: 14, textAlign: 'center' },
  notice: { color: theme.dangerSoft, fontSize: 14, textAlign: 'center' },
  waiting: { color: theme.textMuted, fontSize: 15 },
  connected: { color: theme.success, fontSize: 20, fontWeight: '700' },
  primary: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: 'center',
  },
  primaryText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: theme.textMuted, fontSize: 15, fontWeight: '500' },
});

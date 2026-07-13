import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useController } from '../controller/store';
import { theme } from '../theme';

// Persistent chrome above every screen (see App). The Timber wordmark on the
// left is the home button — it replaces per-screen back buttons. The right side
// is the remote-pairing entry point, which reflects the pairing status and
// gains a Disconnect button while a phone is paired.
export function RemoteBar({
  onHome,
  onOpenPairing,
}: {
  onHome: () => void;
  onOpenPairing: () => void;
}) {
  const status = useController((s) => s.status);
  const unpair = useController((s) => s.unpair);

  const remoteLabel =
    status === 'paired'
      ? 'Remote: connected'
      : status === 'awaiting-confirmation'
        ? 'Pairing…'
        : 'Remote';

  return (
    <View style={styles.bar}>
      <Pressable onPress={onHome} hitSlop={8}>
        <Text style={styles.wordmark}>Timber</Text>
      </Pressable>

      <View style={styles.right}>
        <Pressable style={styles.remoteBtn} onPress={onOpenPairing}>
          <Text
            style={[
              styles.remoteText,
              status === 'paired' && styles.remoteTextPaired,
            ]}
          >
            {remoteLabel}
          </Text>
        </Pressable>
        {status === 'paired' && (
          <Pressable style={styles.remoteBtn} onPress={unpair}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  wordmark: {
    color: theme.textMuted,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  remoteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  remoteText: { color: theme.textSoft, fontSize: 14, fontWeight: '500' },
  remoteTextPaired: { color: theme.success },
  disconnectText: { color: theme.textMuted, fontSize: 14, fontWeight: '500' },
});

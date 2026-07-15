import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useController } from '../controller/store';
import { MetalPlate } from './material';
import { radius, theme } from '../theme';

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
      {/* The rail is the top edge of the chassis: a machined lip catching light,
          then the drop into the darker board below. */}
      <View style={styles.lip} pointerEvents="none" />

      <Pressable onPress={onHome} hitSlop={8}>
        <Text style={styles.wordmark}>Timber</Text>
      </Pressable>

      <View style={styles.right}>
        <Pressable onPress={onOpenPairing}>
          {({ pressed }) => (
            <MetalPlate style={styles.remoteBtn} inset={pressed} r={radius.pill}>
              {/* A pilot lamp, lit only when a phone is actually on the other
                  end — the one piece of status worth a light on this bar. */}
              {status === 'paired' && <View style={styles.lamp} />}
              <Text style={styles.remoteText}>{remoteLabel}</Text>
            </MetalPlate>
          )}
        </Pressable>
        {status === 'paired' && (
          <Pressable style={styles.disconnectBtn} onPress={unpair}>
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
    paddingVertical: 10,
    backgroundColor: theme.surfaceDeep,
    borderBottomWidth: 1,
    borderBottomColor: theme.metalDark,
  },
  lip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 1,
    height: 1,
    backgroundColor: theme.metalHairline,
  },
  wordmark: {
    color: theme.textMuted,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  remoteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  lamp: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.cellActive,
    shadowColor: theme.lcdOn,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  remoteText: {
    color: '#20242a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(255,255,255,0.30)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0,
  },
  disconnectBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  disconnectText: { color: theme.textMuted, fontSize: 13, fontWeight: '500' },
});

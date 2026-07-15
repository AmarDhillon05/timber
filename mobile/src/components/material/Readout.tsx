import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, theme } from '../../theme';

// The readout: a pane of dark glass sunk into the chassis, with a stamped chip
// of a label sitting over its top edge. Straight off the front of a rack unit.
//
// Two details do all the work, and both are easy to get wrong:
//
//   1. The glass is INSET — dark along its top edge, catching a little light
//      along its bottom. That is the opposite of MetalPlate's raised default,
//      and it's what makes the pane read as a hole rather than a sticker.
//   2. The digits are TABULAR. A tempo or a gain that jitters sideways as its
//      digits change looks broken, and no amount of glow fixes it.
//
// The glow is deliberately weak. A real display is a lit segment behind glass,
// not a neon sign, and restraint is the difference between "studio" and "toy".

/** The stamped chip over a readout: TEMPO, T.S., GAIN. Uppercase, tight, small. */
export function Badge({
  children,
  tone = 'accent',
  style,
}: {
  children: string;
  /** `accent` for the value that matters on this panel, `steel` for the rest. */
  tone?: 'accent' | 'steel';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone === 'accent' ? theme.badge : theme.badgeSteel },
        style,
      ]}
    >
      <Text style={styles.badgeText} numberOfLines={1}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

/** The glass pane. Anything inside sits on the LCD; usually `LcdValue`. */
export function LcdPanel({
  children,
  style,
  r = radius.sm,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  r?: number;
}) {
  return (
    <View style={[styles.glass, { borderRadius: r }, style]}>
      {/* Inner shadow, top-down: the pane is a hole, so its top edge is in shade. */}
      <LinearGradient
        colors={[theme.lcdGlassEdge, 'rgba(0,0,0,0)', 'rgba(255,255,255,0.04)']}
        locations={[0, 0.35, 1]}
        style={[StyleSheet.absoluteFill, { borderRadius: r }]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

/** A lit value. `dim` renders it as an unlit segment — a placeholder that still
 *  occupies its space, so the panel doesn't reflow when a value arrives. */
export function LcdValue({
  children,
  size = 30,
  dim = false,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <Text
        style={[
          styles.lcdText,
          {
            fontSize: size,
            lineHeight: size * 1.12,
            color: dim ? theme.lcdDim : theme.lcdOn,
          },
          // The halo. Web renders it as a text-shadow; native gets the same
          // effect from the shadow props, so both platforms glow the same amount.
          !dim &&
            (Platform.OS === 'web'
              ? ({ textShadow: `0 0 10px ${theme.lcdGlow}` } as object)
              : {
                  textShadowColor: theme.lcdGlow,
                  textShadowRadius: 10,
                  textShadowOffset: { width: 0, height: 0 },
                }),
        ]}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

/** Small type inside the glass — a unit, a tempo marking, a track name. */
export function LcdLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={styles.lcdLabel} numberOfLines={1}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: theme.badgeText,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
  },

  glass: {
    backgroundColor: theme.lcdGlass,
    borderWidth: 1,
    borderTopColor: '#000',
    borderLeftColor: '#04070a',
    borderRightColor: '#04070a',
    borderBottomColor: 'rgba(255,255,255,0.10)', // the light that reaches the sill
    overflow: 'hidden',
  },

  lcdText: {
    fontWeight: '600',
    letterSpacing: 1.5,
    fontVariant: ['tabular-nums'],
    // A condensed mono is what these displays actually use; fall back through
    // whatever the platform has rather than shipping a font file for two digits.
    fontFamily: Platform.select({
      web: 'ui-monospace, SFMono-Regular, "DejaVu Sans Mono", Menlo, monospace',
      ios: 'Menlo',
      default: 'monospace',
    }),
  },
  lcdLabel: {
    color: theme.lcdLabel,
    fontSize: 10,
    letterSpacing: 0.6,
  },
});

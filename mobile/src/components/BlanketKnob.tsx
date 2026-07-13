import { memo, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useSession, activeValues, activeTrack } from '../state/session';
import { useHotKnob } from '../state/hotKnob';
import { BLANKET_TERMS, type BlanketTerm } from '../dsp/blanketTerms';
import { theme } from '../theme';

const SWEEP = 135; // degrees from center to each extreme (−1 → −135°, +1 → +135°)
const DRAG_RANGE = 160; // px of vertical drag to travel the full −1..1

const GLOW_USER = theme.danger; // red — editing your copy
const GLOW_GENERATED = theme.success; // green — editing the generated copy

// A rotary knob bound to one Blanket term. Drag up to turn clockwise (increase),
// down to decrease — or hover/focus it and use the arrow keys (handled at the
// editor level via the hotKnob store). The dial is rendered with a raised,
// tactile 3D face (rim light, top sheen, centre hub) and springs up slightly
// while hovered or turned. Hover/focus also reports the knob to the hotKnob
// store, which renders the explanatory tooltip at screen level so it can never
// be clipped by sibling elements. Glows red on your copy, green on the
// generated copy. Subscribes to only its own value so turning one knob doesn't
// re-render the others.
function BlanketKnobBase({ term, disabled }: { term: BlanketTerm; disabled: boolean }) {
  const value = useSession((s) => activeValues(s)[term]);
  const setValue = useSession((s) => s.setValue);
  const glow = useSession((s) =>
    activeTrack(s)?.mode === 'generated' ? GLOW_GENERATED : GLOW_USER,
  );
  const { label } = BLANKET_TERMS[term];
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Report in/out of the hotKnob store (read via getState — no subscription,
  // so other knobs' hovers never re-render this one).
  const wrapRef = useRef<View>(null);
  const reportHot = () => {
    wrapRef.current?.measureInWindow((x, y, width) =>
      useHotKnob.getState().set(term, { x, y, width }),
    );
  };
  const reportCold = () => useHotKnob.getState().clear(term);

  // Latest props/value for the gesture closure (created once).
  const valueRef = useRef(value);
  valueRef.current = value;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const startValue = useRef(0);

  // 0 = resting, 1 = raised. Drives the spring "pop" while hovered or dragging.
  const lift = useRef(new Animated.Value(0)).current;
  const raised = (hovered || active) && !disabled;
  useEffect(() => {
    Animated.spring(lift, {
      toValue: raised ? 1 : 0,
      useNativeDriver: false,
      friction: 6,
      tension: 140,
    }).start();
  }, [raised, lift]);

  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: () => {
        startValue.current = valueRef.current;
        setActive(true);
      },
      onPanResponderMove: (_e, g) => {
        const delta = (-g.dy / DRAG_RANGE) * 2; // up = increase
        const next = Math.max(-1, Math.min(1, startValue.current + delta));
        setValue(term, next);
      },
      onPanResponderRelease: () => setActive(false),
      onPanResponderTerminate: () => setActive(false),
    }),
  ).current;

  return (
    <View ref={wrapRef} style={styles.wrap}>
      <Animated.View
        {...pan.panHandlers}
        focusable={!disabled}
        onPointerEnter={() => {
          setHovered(true);
          reportHot();
        }}
        onPointerLeave={() => {
          setHovered(false);
          reportCold();
        }}
        onFocus={() => {
          setHovered(true);
          reportHot();
        }}
        onBlur={() => {
          setHovered(false);
          reportCold();
        }}
        style={[
          styles.lift,
          { transform: [{ translateY }, { scale }] },
          raised && styles.liftRaised,
          active && { shadowColor: glow, shadowOpacity: 0.7, shadowRadius: 16 },
        ]}
      >
        <View
          style={[
            styles.knob,
            disabled && styles.knobDisabled,
            active && { borderColor: glow },
          ]}
        >
          {/* Top-light sheen makes the face read as a raised dome. */}
          <View style={styles.sheen} pointerEvents="none" />

          <View
            style={[styles.pointerBox, { transform: [{ rotate: `${value * SWEEP}deg` }] }]}
            pointerEvents="none"
          >
            <View style={[styles.pointer, active && { backgroundColor: glow }]} />
          </View>

          {/* Recessed centre hub. */}
          <View style={styles.hub} pointerEvents="none" />
        </View>
      </Animated.View>

      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, active && { color: glow }]}>{value.toFixed(2)}</Text>
    </View>
  );
}

export const BlanketKnob = memo(BlanketKnobBase);

const SIZE = 60;
const HUB = 18;

const styles = StyleSheet.create({
  // Tight vertical padding: the categories now stack as rows in the editor
  // and the whole set should fit without scrolling.
  wrap: {
    width: 88,
    alignItems: 'center',
    paddingVertical: 2,
  },
  lift: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    // Resting drop shadow that gives the dial its raised, floating look.
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 7,
  },
  liftRaised: {
    shadowOpacity: 0.6,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 9 },
    elevation: 12,
  },
  knob: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: theme.steelFace,
    borderWidth: 2,
    // Per-edge rim light: bright at the top, dark at the bottom, so the circle
    // looks like a bevelled dome catching light from above.
    borderTopColor: theme.steelRimLight,
    borderLeftColor: theme.steelRimSide,
    borderRightColor: theme.steelRimSide,
    borderBottomColor: theme.steelRimDark,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  knobDisabled: {
    opacity: 0.4,
  },
  sheen: {
    position: 'absolute',
    top: 3,
    width: SIZE * 0.74,
    height: SIZE * 0.5,
    borderRadius: SIZE,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  pointerBox: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 5,
  },
  pointer: {
    width: 4,
    height: 15,
    borderRadius: 2,
    backgroundColor: theme.steelPointer,
  },
  hub: {
    position: 'absolute',
    width: HUB,
    height: HUB,
    borderRadius: HUB / 2,
    backgroundColor: theme.steelHub,
    borderWidth: 1,
    borderTopColor: theme.steelHubDark,
    borderBottomColor: theme.steelHubLight,
    borderLeftColor: theme.steelHubSide,
    borderRightColor: theme.steelHubSide,
  },
  label: {
    color: theme.textSoft,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  value: {
    color: theme.textFaint,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
});

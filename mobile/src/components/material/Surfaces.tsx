import { ImageBackground, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, textures, theme } from '../../theme';

// The two substrates everything else sits on: WOOD (the chassis) and METAL (the
// plates screwed to it). Both are built the same way — a tiled greyscale
// texture for grain, a tint for colour, a gradient for light — and that shared
// recipe is what makes a knob, a plate and a panel look like one machine.
//
// The light comes from ABOVE, always. A raised plate is therefore bright along
// its top edge and dark along its bottom; a recessed well is the exact
// opposite. Everything in the app obeys that, which is why `inset` exists here
// rather than each caller hand-rolling its own shadows and getting it backwards.

// --- Wood --------------------------------------------------------------------

/** The brushed-pewter chassis. Fills its parent; put a screen's content in it. */
export function WoodSurface({
  children,
  style,
  deep = false,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** A darker cut of the same stock, for wells the eye should read as sunk. */
  deep?: boolean;
}) {
  return (
    <ImageBackground
      source={textures.wood}
      style={[styles.fill, { backgroundColor: deep ? theme.surfaceDeep : theme.surface }, style]}
      // The grain is a whisper, not a statement — at full strength the type on
      // top stops being readable, which is exactly how "wood theme" goes wrong.
      //
      // resizeMode lives in imageStyle, NOT in the prop: react-native-web drops
      // the prop on ImageBackground and draws one tile anchored top-left, so a
      // window wider than the texture ends in bare board. Cover (rather than
      // repeat, which RNW also drops) works on both platforms, and costs nothing
      // because the texture is seamless.
      imageStyle={styles.woodGrain}
    >
      {/* Vignette: the panel is lit from the top, and falls off into its corners.
          The top light is a neutral cool white — a warm tint here would put the
          walnut back into the pewter it's laid over. */}
      <LinearGradient
        colors={['rgba(233,240,247,0.05)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </ImageBackground>
  );
}

// --- Metal -------------------------------------------------------------------

/** A brushed-silver plate. `inset` flips the light so it reads as milled INTO
 *  the wood instead of bolted on top of it. */
export function MetalPlate({
  children,
  style,
  inset = false,
  r = radius.md,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  inset?: boolean;
  r?: number;
}) {
  return (
    <View
      style={[
        styles.plate,
        {
          borderRadius: r,
          // Raised: light on top, dark underneath. Inset: the reverse. This one
          // inversion is the difference between a button and a socket.
          borderTopColor: inset ? theme.metalDark : theme.metalLight,
          borderBottomColor: inset ? theme.metalLight : theme.metalDark,
          borderLeftColor: theme.metalSide,
          borderRightColor: theme.metalSide,
        },
        !inset && styles.plateRaised,
        style,
      ]}
    >
      {/* The finish is decoration: it must never swallow a touch meant for the
          control sitting on the plate. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <ImageBackground
          source={textures.metal}
          style={StyleSheet.absoluteFill}
          // Cover, in imageStyle, for the same reason as the wood. Brush marks
          // run horizontally, so widening a plate stretches them ALONG their own
          // axis and the grain stays fine — a wide plate and a small one still
          // look milled from the same stock.
          imageStyle={[styles.metalGrain, { borderRadius: r }]}
        >
          <LinearGradient
            colors={
              inset
                ? [theme.metalShade, 'rgba(0,0,0,0)', theme.metalSheen]
                : [theme.metalSheen, 'rgba(0,0,0,0)', theme.metalShade]
            }
            locations={[0, 0.5, 1]}
            style={[StyleSheet.absoluteFill, { borderRadius: r }]}
          />
        </ImageBackground>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Low opacity, and it still does its job: grain is felt more than seen.
  //
  // The 100%/100% is load-bearing on web: react-native-web sizes an
  // ImageBackground's inner layer to the texture's INTRINSIC size (1024px here),
  // not to the parent, so `cover` covers 1024px and a wider window ends in bare
  // board. Native sizes it to the parent already; this makes the two agree.
  woodGrain: { opacity: 0.5, resizeMode: 'cover', width: '100%', height: '100%' },

  plate: {
    backgroundColor: theme.metalFace,
    borderWidth: 1,
    overflow: 'hidden',
  },
  plateRaised: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  // The brush marks read as sheen, not as dirt. Same 100% sizing as the wood —
  // a plate wider than 512px would otherwise run out of grain halfway across.
  metalGrain: { opacity: 0.28, resizeMode: 'cover', width: '100%', height: '100%' },
});

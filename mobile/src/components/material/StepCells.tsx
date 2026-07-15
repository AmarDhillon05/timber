import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../../theme';

// A row of cells, lit and unlit. Hardware uses this shape everywhere — a bank
// of segments that shows you the whole state at a glance, with no counting and
// no reading.
//
// Purely presentational: it takes an array of booleans. What a cell MEANS is
// the caller's business (in the editor a cell is a Blanket term, lit when the
// term is engaged), which is what keeps this reusable rather than a
// single-purpose widget wearing a generic name.

export function StepCells({
  cells,
  /** The one cell to call out — the term being turned right now. */
  activeIndex,
  height = 14,
  gap = 2,
  style,
}: {
  cells: boolean[];
  activeIndex?: number;
  height?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, { gap }, style]}>
      {cells.map((lit, i) => (
        <View
          key={i}
          style={[
            styles.cell,
            { height },
            // Unlit cells stay VISIBLE, just dark. A bank that hides its empty
            // slots tells you nothing about how much room is left.
            { backgroundColor: lit ? theme.cellAccent : theme.cellIdle },
            i === activeIndex && { backgroundColor: theme.cellActive },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cell: {
    flex: 1,
    minWidth: 3,
    borderRadius: 1,
    // A top catch-light: each cell is a little lens, not a flat swatch.
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
});

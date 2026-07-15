import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  RadialGradient,
  Rect,
  Stop,
  LinearGradient as SvgLinearGradient,
} from 'react-native-svg';
import { theme } from '../../theme';

// A machined dial: knurled rim, domed face, a pointer milled into it.
//
// SVG rather than stacked Views because the KNURL is the whole point — the ring
// of fine teeth around the edge is what says "you can grip this and turn it",
// and you cannot draw sixty of them with borders. Being vector, it stays crisp
// at any size, which matters when the same component is a 60px trim knob in the
// editor and a 160px transport dial on the record page.
//
// Lit from above, like every other metal surface here (see Surfaces.tsx): the
// rim's top catches light, its bottom falls into shadow, and the face is a dome
// whose highlight sits high and left.
//
// Purely presentational. It takes a value and reports nothing — the gesture,
// the clamping and the state all stay where they already live, in the caller.

const TEETH = 64;

export function KnurledDial({
  size,
  /** -1..1. The caller owns it; the dial just points at it. */
  value,
  /** Degrees from centre to each extreme. 135 gives the usual 270° sweep. */
  sweep = 135,
  /** Lights the pointer and the rim when the dial is being turned. */
  glow,
  active = false,
  disabled = false,
}: {
  size: number;
  value: number;
  sweep?: number;
  glow?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const c = size / 2;
  const rOuter = c - 1;
  const rKnurlIn = c * 0.78; // where the teeth stop and the face begins
  const rFace = c * 0.72;
  const rHub = c * 0.22;

  // The teeth. Cheap to generate, and the alternating light/dark stroke is what
  // sells them as milled rather than drawn.
  const teeth = Array.from({ length: TEETH }, (_, i) => {
    const a = (i / TEETH) * Math.PI * 2;
    const sin = Math.sin(a);
    const cos = -Math.cos(a);
    return {
      key: i,
      x1: c + sin * rKnurlIn,
      y1: c + cos * rKnurlIn,
      x2: c + sin * rOuter,
      y2: c + cos * rOuter,
      // Teeth facing the light are bright; the ones on the underside are not.
      lit: cos < 0.15,
    };
  });

  return (
    <Svg width={size} height={size} opacity={disabled ? 0.4 : 1}>
      <Defs>
        <SvgLinearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.metalLight} />
          <Stop offset="0.5" stopColor={theme.metalSide} />
          <Stop offset="1" stopColor={theme.metalDark} />
        </SvgLinearGradient>
        {/* The dome: highlight up and to the left, falling to shade bottom-right. */}
        <RadialGradient id="face" cx="0.36" cy="0.28" r="0.85">
          <Stop offset="0" stopColor={theme.steelRimSide} />
          <Stop offset="0.55" stopColor={theme.steelFace} />
          <Stop offset="1" stopColor={theme.steelRimDark} />
        </RadialGradient>
        <RadialGradient id="hub" cx="0.4" cy="0.3" r="0.9">
          <Stop offset="0" stopColor={theme.steelHubLight} />
          <Stop offset="1" stopColor={theme.steelHubDark} />
        </RadialGradient>
      </Defs>

      {/* Rim, then the teeth cut into it. */}
      <Circle cx={c} cy={c} r={rOuter} fill="url(#rim)" />
      <G strokeWidth={Math.max(1, size / 60)} strokeLinecap="butt">
        {teeth.map((t) => (
          <Line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.lit ? theme.knurlLight : theme.knurlDark}
            opacity={t.lit ? 0.75 : 0.55}
          />
        ))}
      </G>

      {/* A ring of shadow where the face drops below the rim — the face is not
          flush with the knurl, it sits under it. */}
      <Circle cx={c} cy={c} r={rFace + 1.5} fill={theme.steelRimDark} opacity={0.9} />
      <Circle
        cx={c}
        cy={c}
        r={rFace}
        fill="url(#face)"
        stroke={active && glow ? glow : 'rgba(0,0,0,0.35)'}
        strokeWidth={active ? 1.5 : 1}
      />

      {/* Specular smear across the top of the dome. */}
      <Ellipse
        cx={c}
        cy={c - rFace * 0.42}
        rx={rFace * 0.62}
        ry={rFace * 0.3}
        fill="#fff"
        opacity={0.09}
      />

      {/* Pointer. Rotates about the centre; nothing else moves. */}
      <G transform={`rotate(${value * sweep}, ${c}, ${c})`}>
        <Rect
          x={c - Math.max(1.5, size / 30)}
          y={c - rFace + size * 0.06}
          width={Math.max(3, size / 15)}
          height={rFace * 0.42}
          rx={Math.max(1.5, size / 30)}
          fill={active && glow ? glow : theme.steelPointer}
        />
      </G>

      <Circle cx={c} cy={c} r={rHub} fill="url(#hub)" stroke={theme.steelHubDark} strokeWidth={1} />
    </Svg>
  );
}

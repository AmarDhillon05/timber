// Silver theme (PRD): cool brushed-pewter surfaces with brushed-silver controls,
// like the face of a hi-fi amplifier.
//
// The CONTROL language is borrowed from studio hardware — recessed LCD readouts
// with their little stamped badge labels, step cells that light as they play,
// knurled metal dials. What it is NOT is the neon those apps often wear: the
// readouts here are a cool grey-cyan at low glow, the accents are oxidised
// crimson rather than hot pink, and nothing is fully saturated. Restraint IS
// the professional look; a rack unit doesn't shout.
//
// Two layers make the materials read as real:
//   - a TEXTURE (assets/textures) supplies the grain, and
//   - a GRADIENT supplies the light.
// Neither works alone — texture without a light direction looks like wallpaper,
// gradient without grain looks like plastic. Components in components/material
// always compose both; see MetalPlate and WoodSurface.
//
// Plain constants on purpose — no theming library or context; these apps have
// no light/dark switching.
//
// NOTE: controller/src/theme.ts is a copy of this file (the apps are separate
// npm packages with no shared workspace). Keep the two in sync.
export const theme = {
  // Pewter surfaces, dark → deep. The grain texture rides ON these, so they
  // double as the tint underneath it (what turns the greyscale grain silver) and
  // the fallback if the image ever fails to load.
  surface: '#2b2e33', // screen backgrounds (dark brushed pewter)
  surfaceDeep: '#181a1e', // camera / preview wells
  card: '#3a3e44', // cards, inputs, secondary buttons
  cardDeep: '#202329', // dropdown menus, tooltips, toasts
  border: '#4e535b', // hairlines on pewter

  // Text on pewter. Cream, dimming toward the surface tone — the one warm note,
  // kept because it reads clean on the cool metal.
  text: '#f3e8d2',
  textSoft: '#ddccae',
  textMuted: '#b39c78',
  textFaint: '#8a744f', // hints / fine print
  placeholder: '#6e5b3f',

  // Brushed silver — primary buttons, active states, the export control.
  accent: '#c9ced6',
  onAccent: '#211609', // text/icons on accent, danger and success fills

  // Semantic colors, re-tinted warm but still clearly red/green: red means
  // recording/stop/danger, green means success and the "AI generated" mode.
  danger: '#e2593f',
  dangerSoft: '#f0998b', // error text on wood
  dangerBorder: '#7a2d22',
  dangerWash: 'rgba(122,45,34,0.35)',
  dangerDeep: '#8c2f1e', // filled "live/recording" states
  success: '#71be55',
  successDeep: '#2f5a26', // filled "shared/ready" states

  scrim: 'rgba(0,0,0,0.5)', // overlay badges on video

  // --- Metal -----------------------------------------------------------------
  // A single light direction (from above) shared by every metal surface, so a
  // knob, a plate and a button all look milled from the same billet. Raised
  // things are light on top; recessed things are dark on top. That inversion is
  // the whole trick, and it only holds if everything agrees on where the light
  // is.
  metalFace: '#8b9099', // mid tone the brushed texture is tinted toward
  metalLight: '#c3c8d0', // top bevel of a RAISED edge
  metalSide: '#767c85',
  metalDark: '#2b2e33', // bottom bevel of a raised edge
  metalSheen: 'rgba(255,255,255,0.16)', // the gradient highlight laid over grain
  metalShade: 'rgba(0,0,0,0.30)',
  metalHairline: 'rgba(255,255,255,0.22)', // 1px catch-light on a plate's top edge

  // Steel ramp for the rotary knobs: a machined dome lit from above.
  steelFace: '#565b63',
  steelRimLight: '#a7adb6',
  steelRimSide: '#787e87',
  steelRimDark: '#23262b',
  steelHub: '#3c4046',
  steelHubDark: '#22252a',
  steelHubLight: '#6f757e',
  steelHubSide: '#4a4f56',
  steelPointer: '#eef1f4',
  knurlLight: '#b9bec6', // the milled teeth around a dial's rim
  knurlDark: '#3a3d43',

  // --- LCD -------------------------------------------------------------------
  // A readout is a pane of dark glass sunk into the wood. The digits are a cool
  // grey-cyan, NOT the aquarium blue of a consumer metronome — a shade or two
  // off white is what a real desk unit does, and it stays legible on wood.
  lcdGlass: '#0c1113', // the recessed pane
  lcdGlassEdge: '#05080a', // its inner shadow, top edge
  lcdGrid: 'rgba(140,200,205,0.05)', // faint segment ghosts behind the digits
  lcdOn: '#9fdbe0', // a lit digit
  lcdDim: 'rgba(159,219,224,0.18)', // an unlit segment / placeholder digit
  lcdGlow: 'rgba(159,219,224,0.30)', // the halo, kept low on purpose
  lcdLabel: '#7d99a0', // small type inside the glass

  // --- Badges & cells --------------------------------------------------------
  // The little stamped chips over a readout (TEMPO, T.S.), and the step cells
  // that make a bar of beats legible at a glance.
  badge: '#8f3350', // oxidised crimson, not fluoro pink
  badgeText: '#f6e6ea',
  badgeSteel: '#5c626b', // the neutral variant, for secondary labels

  cellAccent: '#a34a63', // an accented step
  cellNeutral: '#7e848c', // a plain step
  cellIdle: '#454a52', // a step not in the current bar
  cellActive: '#9fdbe0', // the step playing right now (matches the LCD)
} as const;

// Textures. The grain is CC0 wood (ambientCG), desaturated to greyscale so the
// surface tint above is what colours it — brushed pewter here, but swap the tint
// and the same file goes any metal. The brushed metal is generated, not
// photographed — a motion-blurred noise field that tiles because it was blurred
// with the edges wrapped. Both are greyscale and get TINTED by the components,
// so one file serves every surface in the app.
export const textures = {
  wood: require('../assets/textures/wood-silver.jpg'),
  metal: require('../assets/textures/brushed-silver.png'),
} as const;

// Shared geometry, so panels/plates/dials agree without each one guessing.
export const radius = { sm: 4, md: 8, lg: 12, pill: 999 } as const;

// Silver-wood theme (PRD): warm walnut surfaces with brushed-silver controls,
// like the face of a hi-fi amplifier. Plain constants on purpose — no theming
// library or context; these apps have no light/dark switching.
//
// NOTE: controller/src/theme.ts is a copy of this file (the apps are separate
// npm packages with no shared workspace). Keep the two in sync.
export const theme = {
  // Wood surfaces, dark → deep.
  surface: '#2a1c11', // screen backgrounds (walnut)
  surfaceDeep: '#170e07', // camera / preview wells
  card: '#3e2d1b', // cards, inputs, secondary buttons
  cardDeep: '#221507', // dropdown menus, tooltips, toasts
  border: '#57422a', // hairlines on wood

  // Text on wood. Cream, dimming toward the surface tone.
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
} as const;

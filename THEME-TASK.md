# Task: Implement the "silver wood" theme (replacing the ad-hoc dark slate palette)

## Context

This repo (Timber) is a multi-track audio/video editor. The PRD (`PRD.md`) requires a
**silver wood aesthetic** for the UI. Today every screen instead uses a hard-coded dark
slate/blue palette, duplicated inline across each component's `StyleSheet.create` block.
Nothing is themed centrally — there is no theme file, no design tokens.

Two separate Expo (React Native) apps need restyling:

- `mobile/` — the main app (desktop/web/iOS). Screens live in `mobile/src/screens/`
  (`UploadScreen.tsx`, `RecordScreen.tsx`, `EditScreen.tsx`), plus
  `mobile/src/controller/PairingScreen.tsx` and `mobile/src/components/BlanketKnob.tsx`.
- `controller/` — the phone remote. One screen: `controller/src/ControllerScreen.tsx`.

The recurring palette values you'll be replacing (grep for them to find every usage):

- `#0f172a` screen backgrounds, `#020617` camera/preview wells
- `#1e293b` cards/inputs/secondary buttons, `#0b1220` dropdown menus
- `#2563eb` primary buttons / active states
- `#ef4444` record/stop/danger, `#22c55e` / `#4ade80` success + "AI generated" mode
- `#f8fafc` / `#e2e8f0` / `#cbd5e1` text, `#94a3b8` / `#64748b` / `#475569` muted text

## What to build

1. **A shared theme module** in each app (e.g. `mobile/src/theme.ts` and
   `controller/src/theme.ts` — they can be near-identical copies; the apps are separate
   npm packages with no shared workspace). Export named tokens (surface, card, text,
   textMuted, accent, danger, success, border, etc.) and replace the hard-coded hex
   values in every StyleSheet with them. Keep it plain TS constants — do not add a
   theming library or context; these apps have no light/dark switching.

2. **The silver-wood look.** Interpretation: warm wood tones for surfaces (walnut/oak
   browns for backgrounds and cards) with brushed-silver/steel for controls and accents
   (knobs, buttons, borders, code digits) — think hi-fi amplifier / studio hardware.
   - The PRD explicitly allows downloading assets: a seamless wood-grain texture and/or
     brushed-metal texture as background images is welcome. Put them in
     `mobile/assets/` and `controller/assets/` and use `ImageBackground` (or
     `resizeMode: 'repeat'` on web). Only use assets with licenses permitting free use
     (CC0 — e.g. ambientCG, Poly Haven); note the source + license in a comment.
     Keep files small (<300 KB each); they ship in the app bundle.
   - If texture images prove awkward in RN, a flat warm-brown + silver token palette
     alone is an acceptable v1 — prioritize shipping the tokens everywhere over
     texture fidelity.

3. **Preserve semantic colors.** Red = recording/stop/danger, green = success and the
   "AI generated" knob mode (see `EditScreen.tsx` — `accent` switches red/green on
   `mode`). Re-tint these to fit the new palette but keep them clearly red/green —
   they carry meaning, not just style.

4. **Contrast:** keep text readable (aim for WCAG AA, ~4.5:1) on the wood surfaces —
   the current light-on-dark text values will likely need swapping to
   cream/off-white or near-black depending on surface tone.

## Constraints

- React Native `StyleSheet` only — no CSS files, no styled-components, no new deps.
- Do not touch behavior, props, layout, or any non-style code. Style-only diff.
- `mobile/AGENTS.md` says: read the Expo v56 docs (https://docs.expo.dev/versions/v56.0.0/)
  before writing code — relevant if you use `ImageBackground`/`expo-image`.
- Project error policy: no defensive try/catch — let errors surface.

## Verify

- `cd mobile && npx tsc --noEmit` and `cd controller && npx tsc --noEmit` pass.
- Run `cd mobile && npm run win:web` (Expo web on :8081) and visually check Upload,
  Record, Edit (upload any short video to reach it), and the Remote/pairing screen;
  run `cd controller && npm start` for the remote screen. Screenshot each if you can.
- Grep confirms no orphaned `#0f172a`/`#1e293b`/`#2563eb` literals remain outside the
  theme files.

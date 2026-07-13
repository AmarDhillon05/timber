import { create } from 'zustand';
import type { BlanketTerm } from '../dsp/blanketTerms';

// Which knob the pointer (or keyboard focus) is currently on, and where it
// sits in window coordinates. Knobs report in on hover/focus and out on
// leave/blur; EditScreen consumes this twice:
//   • a screen-level tooltip overlay — rendered above every other element,
//     so a tooltip can never be clipped by a sibling row or the panel edge
//   • the arrow-key handler — Up/Right raise the hot knob, Down/Left lower it
//
// Kept out of the session store on purpose: it's transient pointer state and
// changes on every hover, so nothing that touches the document should ever
// re-render from it.

interface HotKnobState {
  term: BlanketTerm | null;
  /** Window coords of the knob's wrap (from measureInWindow). */
  x: number;
  y: number;
  width: number;

  set: (term: BlanketTerm, box: { x: number; y: number; width: number }) => void;
  /** Clear only if `term` is still the hot one (fast pointer moves race). */
  clear: (term: BlanketTerm) => void;
}

export const useHotKnob = create<HotKnobState>((set, get) => ({
  term: null,
  x: 0,
  y: 0,
  width: 0,

  set: (term, box) => set({ term, ...box }),
  clear: (term) => {
    if (get().term === term) set({ term: null });
  },
}));

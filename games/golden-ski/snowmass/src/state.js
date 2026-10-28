// Game state that more than one file changes.
export const state = {
  phase: 'ready',               // ready -> skiing -> back (fading to the summit); ride, unload on a lift
  cameraSnap: true,             // the next frame jumps the camera instead of easing
  solidY: null,                 // skier height during a step: box tops are ground only from above
  workAll: false,               // a snapped camera (start, teleport) runs everything at once, behind the fade
  RUN_AREA: null,               // signed distance to any run (half meters, 10 m grid); null until unpacked
  PATCH: null,                  // the 2 m run grid once loaded
  patchOn: true,                // Tab: Detailed runs (2 m)
  shAt: null,                   // shadow canvas centre...
  shDirty: false,               // ...and a page built inside it marks it for a repaint
  testHold: null,               // test hooks: input held for scripted steps
  sound: true,                  // Tab: Sound
};

# Golden Ski: Snowmass (playable mockup)

True-size Snowmass with Momentum physics plus carve turns, the 18 real lifts, real run lines, and 2 m detailed runs on
Sunnyside, Max Park, Powderhorn and every groomed run on the Elk Camp side (Elk Camp to Two Creeks, the test ground for
junctions and cat tracks). The 2 m runs are built ahead of time (`patch.js`) and drawn at 2 m within 250 m of the camera
and 4 m out to 800 m. FreePlay starts at the Village Express top, facing down Sunnyside.

- Controls: arrows or WASD steer, Up/W poles, Down/S brakes, Shift tucks, hold Space to load an ollie.
  On phones, drag to steer, swipe down to pole, swipe up to brake.
- Tab menu (three-finger tap on phones): Freecam, Momentum or Classic physics, Assists, Carve turns, Weight,
  Crashes (off by default), Motion feel, Speed readout, Pixel look, Detailed runs, Noon / Golden hour / Night / Storm,
  and a start at Sunnyside, Powderhorn or the top of any lift.
- The Speed readout also shows the frame rate.
- No build step. `data.js` holds the terrain, forest, runs and lifts; `patch.js` holds the detailed runs built ahead of time
  (rebuild with `bake.mjs` in the kit when the runs change; the page builds them itself if patch.js is out of date).
  Three.js loads from jsDelivr.

Data: elevation from USGS 3DEP (public domain). Forest and runs contain modified Copernicus Sentinel data 2025.
Lift and run lines from OpenStreetMap contributors (ODbL) via Overture Maps.

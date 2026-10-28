# Golden Ski: Snowmass

FreePlay on a true-size Snowmass: Momentum physics with carve turns, the 18 real lifts with a chairlift ride, and
every run rebuilt from traced outlines on a 2 m grid. FreePlay starts at the Village Express top, facing down
Sunnyside. What's in the game and what comes next is in the
[Golden Ski plan](https://claude.ai/artifact/QNT5jc4pSLqKkMy6pGxaAm).

- Controls: arrows or WASD steer, Up/W poles, Down/S brakes, Shift tucks, hold Space to load an ollie.
  On phones, drag to steer, swipe down to pole, swipe up to brake. M or a two-finger tap opens the map.
- Tab menu (three-finger tap on phones), for testing: Freecam, Crashes (off by default), collision shapes, Sound, speed
  readout (mph and frame rate), perf stats, pixel look, detailed runs (2 m), Noon / Golden hour / Night / Storm, and
  a start at the top or bottom of any lift.

## Files

No build step: `index.html` loads `src/main.js` as a module and three.js comes from jsDelivr.

| Path | What's in it |
| --- | --- |
| `src/config.js` | Tuning numbers for the skiing, small helpers |
| `src/state.js` | Game state that more than one file changes |
| `src/world.js` | Ground sampling: heights, cover, runs, the 2 m run grid, solids, bridges, kickers |
| `src/scene.js` | Renderer, camera, Snowlight, textures, sky, terrain mesh, work queue, far peaks |
| `src/buildings.js` | Kit models, detail rings, rocks, lift terminals, the Elk Camp restaurant |
| `src/trees.js` | Trees, clumps and props, paged in around the camera |
| `src/lifts.js` | Lift lines, towers, cable, chairs, cabins; kicker meshes |
| `src/slopes.js` | Signs, ropes, fence, roads, the 2 m run meshes and streaming, start points |
| `src/ride.js` | The chairlift ride cutscene |
| `src/atmosphere.js` | Lamps, shadows, storm snow, time of day, pixel look |
| `src/goldie.js` | Goldie's sprite, skis, shadow and spray |
| `src/tracks.js` | Her ski tracks: grooves painted around her, shaded by Snowlight |
| `src/snow.js` | Each run's snow: real moguls on Long Shot and Timberline, chopped snow on The Edge, Slot and Campground |
| `src/play.js` | Input, Tab menu, freecam, and the simulation (skiing, jumps, collisions, bails) |
| `src/audio.js` | Sound effects synthesized with Web Audio: ski hiss, wind, pole plants, landing thump |
| `src/hudmap.js` | Minimap and full map |
| `src/main.js` | Rendering, main loop, test hooks (`window.__golden`) |
| `assets/sprites/` | Goldie's sheet, trees, poles, signs (each with a `_n` normal map) |
| `assets/textures/` | Snow textures and the station atlas |
| `assets/sky/` | One sky strip per time of day |
| `assets/models/` | The Elk Camp restaurant model and texture |
| `data/mountain.js` | Terrain, forest, lifts and run lines (10 m) |
| `data/runs.js`, `data/runs/` | Run index, edge trees, signs, stand-in blocks; 2 m run tiles fetched by distance |

The files load in the order of the list in `src/` above (each file imports the one before it), the same order the
code ran in as one file. `data/runs.js` and `data/runs/` are built by `tools/runs` (see `tools/README.md`).

Data: elevation from USGS 3DEP (public domain). Forest and runs contain modified Copernicus Sentinel data 2025.
Trees along the runs from the Meta and WRI high resolution canopy height maps (CC BY 4.0). Lift and run lines and
building outlines from OpenStreetMap contributors (ODbL) via Overture Maps.

# Golden Ski: Snowmass (playable mockup)

True-size Snowmass with Momentum physics plus carve turns, the 18 real lifts, and every run on the mountain rebuilt
from traced outlines. Each run is shaped on a 2 m grid: groomed runs are trimmed and graded so they ski cleanly, and
expert runs keep the natural unshaped snow. The run tiles are built ahead of time and load by distance as you ski. The
rest of the mountain gets coarser with distance, and past about 300 m the forest is drawn as clumps of trees instead
of single trees. FreePlay starts at the Village Express top, facing down Sunnyside.

- Controls: arrows or WASD steer, Up/W poles, Down/S brakes, Shift tucks, hold Space to load an ollie.
  On phones, drag to steer, swipe down to pole, swipe up to brake.
- Tab menu (three-finger tap on phones): Freecam, Momentum or Classic physics, Assists, Carve turns, Weight,
  Crashes (off by default), Motion feel, Speed readout, Pixel look, Detailed runs (2 m), Noon / Golden hour / Night / Storm,
  and a start at Sunnyside, Powderhorn or the top of any lift.
- The Speed readout (mph) also shows the frame rate.
- Goldie is drawn from a sheet pre-rendered from her 3D model: 16 directions (9 drawn, the left side mirrored) at three
  camera heights, lit by Snowlight from its normal map. While moving her body stands square to the slope. Her skis are
  a textured pair on the physics ski plate, rolled onto their edges in a turn, and she stands on the snow as drawn.
- HUD map in the style of the Snowmass trail map: a minimap top-left that turns with Goldie, and the whole mountain
  (summit at the top, run, lift, peak and base labels) on M or a two-finger tap. It is painted once at load.
- Chairlift terminals have a deck, an operator hut and four legs around the wheel post, with textured panels, boards,
  siding and roof snow. The ground blends up to each deck so you can ski on and off, and the post, legs and hut are solid.
  Chairs are detailed close up, plain further out and hidden past 2.5 km.
- The Elk Camp Gondola and Sky Cab have their own terminals (a glass hall with a barrel roof), galvanized towers and
  black Snowmass cabins. At the Elk Camp Gondola top there's the restaurant (with three après posters on its wall) and a
  maintenance building; all of them are solid.
- Run edges are lined with trees from a 1 m canopy height map at real forest density. Within about 150 m of you the
  gaps are packed in so the forest is tight but you can still ski between the trees; farther out only the mapped trees
  and clumps are drawn. Every tree is solid.
- Each named run has one trail sign where it begins, with the run's name and its difficulty symbol. Rope lines on
  bamboo poles run down both edges of the first 170 m of Sunnyside and Max Park.
- Buildings near the runs are plain stand-in blocks on their real footprints until the real buildings are made.
- No build step. `data.js` holds the terrain, forest and lifts. `runs.js` holds the run index, the run-edge trees,
  the signs and the stand-in blocks, and `runs/` holds the 2 m run tiles in 512 m chunks that the game fetches as you
  get near them. Both are built ahead of time from the run outlines. Three.js loads from jsDelivr.

Data: elevation from USGS 3DEP (public domain). Forest and runs contain modified Copernicus Sentinel data 2025.
Trees along the runs from the Meta and WRI high resolution canopy height maps (CC BY 4.0). Lift and run lines and
building outlines from OpenStreetMap contributors (ODbL) via Overture Maps.

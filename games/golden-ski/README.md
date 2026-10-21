# Golden Ski

A real-time skiing game with Golden Tee's art style: 2D sprite skiers in a simple low-poly 3D world, gold type on navy panels. The full design is in the Golden Ski design book and project plan.

This folder is **milestone 1: ski feel**. Goldie skis one test slope of about 1.3 km with the basic physics and controls from the design book, a chase camera and a timer. Everything else (tricks, the Snowmass map, FreePlay, Campaign, the lift ride) comes in later milestones.

Built with [Three.js](https://threejs.org/) 0.160 loaded as an ES module from jsDelivr, so it needs a network connection and must be served over http(s).

## Controls

| | Keyboard | Touch or mouse |
| --- | --- | --- |
| Start | Any control key | Touch the screen |
| Steer | ← → or A D | Drag left or right. How far you drag sets how hard you turn. The newest finger down steers |
| Tuck (faster, turns wider) | ↓ or S | Hold your thumb still |
| Pole (under 20 km/h) or brake (hockey stop, faster) | ↑ or W. Hold to keep poling | Swipe up quickly: one push when slow, a stop when fast. Pull your thumb back down to cancel a stop |
| Jump | Hold Space to load, release to pop | Tap, with any finger (a small pop) |
| Retry after the finish | Enter | Retry button |

The clock starts at the start line and stops at the finish line. The only thing on screen is the timer.

## How the skiing works

Momentum physics: one velocity carries everything, and gravity, edges, poles, jumps and spins only add to it or bend it. An assist layer on top keeps it playable.

- **Gravity** pulls the skier along the slope, so steep pitches keep building speed and flats are slow.
- **Snow friction** is low on the groomed run and higher in the powder off the edges.
- **Air drag** grows with speed squared, and tucking roughly halves it. The assist adds a soft cap around 122 km/h.
- **Edges**: steering pivots the skis, slower the faster you go, and rolls you onto an edge over a moment. The edge's grip bends your momentum toward the skis, and leaning harder grips more. Within the grip limit that's a clean carve that keeps speed; ask for more and the rest is a skid that bleeds speed and sprays snow. Nothing holds the skis to the fall line, so you can carve uphill until your speed runs out.
- **Poles**: below 20 km/h, Up pushes with both poles. Each push is strong from a standstill and does nothing near 20 km/h.
- **Jumps**: hold to crouch and load, release to pop, partly off the slope and partly straight up. Any crest steep enough also launches you. The turn you're carving carries into the air as spin; steering in the air speeds the spin up or slows it down, and with nothing held the skis settle back in line for the landing.
- **Landings** keep all the speed along the slope and absorb only the part going into the snow, so a steep landing is smooth and a flat one hurts. Within 25° of your travel is clean, 25 to 55° scrubs off speed, and worse, or hitting the snow faster than 20 m/s, is a wipeout.
- **Wipeouts** slide with friction, so they go further on steep ground.
- **Trees** are solid. Hitting one head-on fast is a wipeout; brushing one slows you and slides you round it. After a wipeout, skiing far off the run, or getting stuck by the edge for 3 seconds, you're reset onto the run and the clock keeps going.

Physics runs at a fixed 60 steps a second. All the feel numbers are in the tuning block at the top of `game.js`. The terrain is a height grid: the mesh uses its flat-shaded triangles, and the physics samples a smooth surface through the same points.

## Art

`assets/goldie.png` is Goldie's placeholder sprite sheet (10 frames of 96×128: stand, carve left, carve right, tuck, brake, air, land, wipeout, front, celebrate), traced from photo references. It will be replaced by sprites pre-rendered from a 3D model. Only back and front views exist so far, so the skier always shows her back while skiing.

`assets/goldie_n.png` is the matching normal map, made with the Sprite Normals tool. Goldie is lit with Snowlight, the project's lighting style: each pixel is lit by the sun, the sky and the sunlit snow below according to its normal, then snapped to four bands. The sun is the same one that lights the terrain.

## Testing hooks

`window.__golden` exposes the simulation for headless tests: `setManual(true)` stops the real-time loop, `start()` pushes off, and `step(n, { steer, tuck, brake, jump })` runs fixed steps with that input held. A `jump` there is a tap; add `'jump'` to `keys` for some steps first to load it.

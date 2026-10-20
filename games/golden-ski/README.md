# Golden Ski

A real-time skiing game with Golden Tee's art style: 2D sprite skiers in a simple low-poly 3D world, gold type on navy panels. The full design is in the Golden Ski design book and project plan.

This folder is **milestone 1: ski feel**. Goldie skis one test slope of about 1.3 km with the basic physics and controls from the design book, a chase camera and a timer. Everything else (tricks, the Snowmass map, FreePlay, Campaign, the lift ride) comes in later milestones.

Built with [Three.js](https://threejs.org/) 0.160 loaded as an ES module from jsDelivr, so it needs a network connection and must be served over http(s).

## Controls

| | Keyboard | Touch or mouse |
| --- | --- | --- |
| Start | Any control key | Touch the screen |
| Steer | ← → or A D | Drag left or right. How far you drag sets how hard you turn |
| Tuck (faster, turns wider) | ↓ or S | Hold your thumb still |
| Brake (hockey stop) | ↑ or W | Swipe up and hold |
| Jump | Space | Tap |
| Retry after the finish | Enter | Retry button |

The clock starts at the start line and stops at the finish line. The only thing on screen is the timer.

## How the skiing works

Design book chapter 05, kept deliberately small:

- **Gravity** pulls the skier along the slope, so steep pitches are fast and flats are slow.
- **Snow friction** is low on the groomed run and higher in the powder off the edges.
- **Air drag** grows with speed squared; tucking halves it. A soft cap holds top speed around 94 km/h.
- **Edges**: steering turns the skis, and grip bends your path toward them. Within the grip limit that's a clean carve that keeps speed. Turn harder than the snow can hold and the rest becomes a skid that bleeds speed and sprays snow.
- **Air**: if the ground drops away faster than gravity can pull you down onto it, you leave the snow. Landings within 20° of your travel are clean, 20 to 45° are sloppy and cost speed, and worse is a wipeout.
- **Trees** are solid. Hitting one fast is a wipeout; brushing one is a hard stop. After a wipeout, or skiing far off the run, you're reset onto the run and the clock keeps going.

Physics runs at a fixed 60 steps a second. All the feel numbers are in the tuning block at the top of `game.js`. The terrain is a height grid: the mesh uses its flat-shaded triangles, and the physics samples a smooth surface through the same points.

## Art

`assets/goldie.png` is Goldie's placeholder sprite sheet (10 frames of 96×128: stand, carve left, carve right, tuck, brake, air, land, wipeout, front, celebrate), traced from photo references. It will be replaced by sprites pre-rendered from a 3D model. Only back and front views exist so far, so the skier always shows her back while skiing.

## Testing hooks

`window.__golden` exposes the simulation for headless tests: `setManual(true)` stops the real-time loop, `start()` pushes off, and `step(n, { steer, tuck, brake, jump })` runs fixed steps with that input held.

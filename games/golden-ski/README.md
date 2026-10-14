# Golden Ski

A shot-by-shot skiing game dressed like an arcade golf cabinet: gold chrome type, navy panels, an overhead hole map, a wind arrow, a flyover before every run, and an announcer shouting your result. Nine runs down Golden Peak, scored against par.

Built with [Three.js](https://threejs.org/) 0.160 loaded as an ES module from jsDelivr, so it needs a network connection and must be served over http(s).

## The idea: golf, but it's a ski run

Golden Tee's whole loop is "line up, swing the trackball, watch it fly, read the lie, do it again." Every piece of that has a skiing equivalent:

| Golden Tee | Golden Ski |
| --- | --- |
| Hole, par, yardage | Run, par, meters to the finish gate |
| Tee box | Start hut, with gold tee markers |
| Trackball swing (pull back, roll forward) | Pull back and flick up. Flick speed is power, flick angle is draw or fade (a carve left or right) |
| Clubs | Techniques: **Tuck** (driver), **Carve** (iron), **Slide** (wedge), **Skate** (putter) |
| Fairway, rough, bunker | Groomed corduroy, powder (75% power), moguls (55% power, wild) |
| Firm fairway rollout | Ice: rolls farther, carves harder |
| Water hazard | The creek. Cross on the snow bridge or jump it off a kicker. +1 stroke and a drop |
| Out of bounds | The trees. +1 stroke, drop in the powder |
| Green with grid and break | The finish corral: flat, gridded, with a cross slope you have to read |
| Cup | The finish gate. Pass between the two wands on snow, slowly enough to count |
| Ball lipping out | "Too hot": blasting through the wands faster than 7 m/s doesn't count |
| Wind | Pushes you in the air off kickers, and a little on snow when tucked |
| Target cursor and auto-club | Gold reticle and dotted line show a full-power push; a caddie picks the technique and a safe line each shot |
| Flyover, overhead map, scorecard | All there |

## Controls

| | Touch / mouse | Keyboard |
| --- | --- | --- |
| Push off | Pull back, then flick up (faster = more power, over 100% gets wild) | Hold Space, release (the meter rises to 115% and falls back) |
| Carve left / right | Flick on an angle | ← → while holding Space |
| Aim | Drag sideways, or hold the arrow buttons | ← → |
| Technique | Tap the technique box | ↑ ↓ |
| Skip flyover / fast forward | Tap | Enter |

## Tuning

Feel numbers (fall line pull, friction per surface, technique speeds and curve, wind, gate speed, kicker launch) are constants at the top of `game.js`. The nine runs are data in `HOLES`: length, par, width, dogleg shape, ice patches, mogul fields, kickers, the creek and its bridge, and how much the corral breaks.

`window.__golden` exposes the sim for automated tests (`predict`, `shoot`, `finishShot`, `load`, and friends).

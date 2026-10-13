# Downhill 3D

A third-person 3D endless downhill run, the 3D sibling of Endless Skier. Carve between trees and rocks, pass through gates, hit kickers, and spin or flip before you land.

Built with [Three.js](https://threejs.org/) 0.160 loaded as an ES module from jsDelivr, so it needs a network connection and must be served over http(s) (opening the file directly from disk blocks module imports in most browsers).

## Controls

| | Keyboard | Touch / mouse |
| --- | --- | --- |
| Carve | ← → or A D | Drag sideways |
| Tuck (faster) | ↓ or S on snow | Drag down |
| Hop | Space | Tap |
| Spin in the air | ← → | Drag sideways |
| Flip in the air | ↑ front, ↓ back | Drag up / down |

Land with your skis pointing downhill. Release a spin or flip a little early and it settles on its own; landing mid-rotation is a wipeout. Clean landings build a combo multiplier, sloppy ones cost speed. Hitting a tree or rock ends the run.

## Tuning

All the feel numbers (gravity, slope, drag, spin rates, landing tolerances, chunk density) are constants at the top of `game.js`.

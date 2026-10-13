# Endless Skier

An endless 2D downhill run in the spirit of Alto's Adventure and SkiFree, drawn with thin Line Rider-style lines.

## Controls

| | Desktop | Mobile |
| --- | --- | --- |
| Jump | Space, ↑, W, or click | Tap |
| Backflip | Hold jump while in the air | Hold while in the air |
| Frontflip | Hold → or D in the air | |
| Pause | P or Esc | Leaves the tab |

## How it plays

- The hill is generated forever from seeded noise, with random kickers (blue faces), rocks and cliff drops.
- Jumping right as you leave a kicker's lip ("Pop!") stacks the ollie on the ramp for extra air.
- Landing is judged by how well your skis match the slope: **Perfect** (within ~8°) doubles the trick points and gives a speed boost, **Clean** (within ~20°) keeps your combo, **Sloppy** (within ~35°) halves the points and slows you down, and anything worse is a wipeout. Landing while still spinning fast also counts against you.
- Each flip is worth 300 × flips², and consecutive clean flips build a combo multiplier.
- Hitting a rock on the ground or landing on one ends the run.

Tuning constants (gravity, jump strength, spin speed, landing tolerances) are at the top of `game.js`.

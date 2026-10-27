// Golden Ski on Snowmass. Units are meters: x east, z south of the FreePlay start, y above sea level.
// Tuning numbers for the skiing, and small helpers.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- Tuning ----------
export const STEP = 1 / 60;
export const G = 9.81;
export const SNOW = {
  groomed: { friction: 0.04, grip: 1.15 },
  powder: { friction: 0.13, grip: 0.75 },
};
export const TUCK_GRIP = 0.6;          // tucked, less edge grip
export const SKID = 0.55;              // speed lost to sideways slip, share of normal force
export const BRAKE = 8.5;              // hockey stop, m/s^2
export const POP_COOLDOWN = 0.15;      // s between ollies; counts down in the air too, so landing doesn't wait
export const PUSH = 3.5;               // push off at the summit and after a wipeout
export const TAKEOFF_MARGIN = 0.0005;  // m per step a crest must drop away before it launches you
export const REAL_AIR = 0.22;          // shorter air is a bump, not a jump
export const HARD_IMPACT = 11;         // landing impact (m/s) that's sloppy
export const SKIER_R = 0.35;
export const STOP_TIME = 3;            // s stalled on flat ground before the trip back up
export const FLAT = 0.06;              // too gentle to restart by pointing downhill
export const EDGE_MARGIN = 150;        // m from the map edge before the trip back up

// ---------- Momentum physics ----------
// One velocity carries everything; nothing clamps it to the fall line, so you can carve uphill until you stall.
// ASSIST is the arcade layer on top.
export const MO = {
  DRAG: 0.0045,                 // per (m/s)^2 standing (75 kg skier)
  TUCK_DRAG: 0.0024,            // ...and tucked
  POLE: 1.7,                    // m/s per double-pole push from a standstill...
  POLE_MAX: 5.5,                // ...fading to zero at this speed (12 mph)
  POLE_EVERY: 0.55,             // s between pushes while held
  OLLIE_MIN: 3.0,               // m/s pop from a tap...
  OLLIE_MAX: 5.5,               // ...up to this after OLLIE_CHARGE s of loading
  OLLIE_CHARGE: 0.5,
  OLLIE_UP: 0.4,                // share of the pop straight up rather than off the slope
  SPIN_IN: 7,                   // rad/s^2: steering in the air torques the spin
  SPIN_TUCK: 1.6,
  SPIN_DAMP: 0.4,               // spin lost per second with no steer
  FLIP_IN: 5,                   // rad/s^2: up/down in the air torques a flip (up = front flip), and it carries on
  FLIP_DAMP: 0.4,               // flip lost per second with nothing held
  CRASH_MU: 0.6,                // a wipeout slides with friction plus a base drag
  CRASH_BASE: 2,
  CRASH_MAX: 5,                 // s before she self-arrests on any slope
};
export const ASSIST = { grip: 1.2, cap: 34, capDrag: 0.25, airG: 1.15, clean: 25 };
// ---------- Carve physics ----------
// Steering asks for a share of the tightest turn you can hold: radius = max(R_MIN, v^2 / grip). Goldie leans to balance
// the turn, so full steer is a clean carve at the grip limit. Carving costs speed; slow, the skis pivot; brake + steer
// is a skidded turn. Thinner air at altitude lowers drag, and wax glides better once moving.
export const CV = {
  R_MIN: 7,                     // m: tightest carve
  LAT_GRIP: 1.4,                // sideways grip = snow grip x this (1.6 g groomed, 1.05 g powder)
  CLEAN: 0.92,                  // share of grip full steer asks for
  PIVOT: 2.4,                   // rad/s pivot at full steer, standing still...
  PIVOT_V: 3,                   // ...divided by (1 + speed / 3)
  SKID_TURN: 2.6,               // rad/s extra pivot in a skidded turn
  SKID_BRAKE: 2.5,              // m/s^2 extra braking in a skidded turn
  TUCK_TURN: 0.5,               // tucked, the tightest turn is twice as wide
  DRAG: 0.0045, TUCK_DRAG: 0.0024, // sea-level drag...
  AIR_SCALE: 8500,              // ...times exp(-altitude / AIR_SCALE)
  GLIDE: 3,                     // m/s: friction runs from 1.2x the snow's figure at rest
                                // toward 0.6x at speed
  LEAN_T: 0.22,                 // s: body lean lag behind the stick
};
export const physics = { crashes: false, shapes: false };
// ---------- Collision shapes and bails ----------
// Goldie is a capsule (hits walls and boxes) on a thin ski plate (meets the snow). A square hit, a sideways landing
// or a huge drop bails her: both shapes become one flat box that tumbles until it settles. Off by default (Tab: Crashes).
export const BODY = { R: 0.35, H: 1.7, PLATE_L: 1.7, PLATE_W: 0.3 };
export const BAIL = {
  HIT: 9,                       // m/s into a wall or trunk that bails (about 20 mph)
  MISS: 70,                     // degrees between skis and travel on landing that bails
  IMPACT: 16,                   // m/s landing impact that bails (about a 13 m drop)
  FLIP: 45,                     // degrees off upright (mid-flip) on landing that bails
  L: 1.8, W: 0.6, T: 0.25,      // body box: length, width, thickness
  MU: 0.7,
  E: 0.15,
  MAX: 6,                       // s before she gets up on any slope
};

// ---------- The mountain ----------
export const TREE_FAR = 900;           // trees drawn within this; past it the forest is a ground tint
export const TREE_NEAR = [250, 350];    // single trees hand over to clumps across this
export const CLUMP = 32;               // m: one clump per square this size past TREE_NEAR
export const FILL_NEAR = [120, 160];   // packed run-edge fill fades out across this
export const CHUNK = 32;               // cells of 10 m per chunk
export const SUPER = 4;                // 4 x 4 chunks merge into one far piece
export const LOD_STEPS = [1, 2, 4, 8, 16]; // triangle size in cells
export const LOD_DIST = [250, 700, 1800, 4000]; // m to a piece's edge where it steps down a size

// ---------- Small helpers ----------
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
export const UP_Y = new THREE.Vector3(0, 1, 0);

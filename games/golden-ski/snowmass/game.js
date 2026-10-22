// Golden Ski on Snowmass. Units are meters: x east, z south of the FreePlay start, y above sea level.
// Terrain: USGS 3DEP at 10 m. Forest and runs: Sentinel-2. Runs are shaped on a 2 m grid (runs.js, runs/).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from './data.js';
import { RUN_DATA } from './runs.js';

// ---------- Tuning ----------
const STEP = 1 / 60;
const G = 9.81;
const AIR_G = 1.3;              // extra air gravity: snappier jumps
const SNOW = {
  groomed: { friction: 0.04, grip: 1.15 },
  powder: { friction: 0.13, grip: 0.75 },
};
const DRAG = 0.006;             // per (m/s)^2
const TUCK_DRAG = 0.5;
const TUCK_TURN = 0.55;         // tucked turns are wider...
const TUCK_GRIP = 0.6;          // ...with less edge grip
const SPEED_CAP = 26;           // soft cap, about 58 mph
const CAP_DRAG = 0.6;
const SKID = 0.55;              // speed lost to sideways slip, share of normal force
const BRAKE = 8.5;              // hockey stop, m/s^2
const TURN_RATE = 1.9;          // rad/s at full steer
const AIR_TURN = 1.2;           // rad/s in the air
const MAX_HEADING = 1.85;       // max angle from the fall line (about 106 degrees)
const POP = 3.4;                // jump impulse along the slope normal
const POP_COOLDOWN = 0.35;
const PUSH = 3.5;               // push off at the summit and after a wipeout
const TAKEOFF_MARGIN = 0.0005;  // m per step a crest must drop away before it launches you
const REAL_AIR = 0.22;          // shorter air is a bump, not a jump
const CLEAN_LAND = 20 * Math.PI / 180;
const SLOPPY_LAND = 45 * Math.PI / 180;
const SLOPPY_KEEP = 0.7;        // speed kept on a sloppy landing
const HARD_IMPACT = 11;         // landing impact (m/s) that's sloppy...
const CRASH_IMPACT = 17;        // ...or a wipeout
const CRASH_DECEL = 7;
const CRASH_HIT_SPEED = 7;      // tree hit (m/s) that wipes out
const SKIER_R = 0.35;
const STOP_TIME = 3;            // s stalled on flat ground before the trip back up
const FLAT = 0.06;              // too gentle to restart by pointing downhill
const EDGE_MARGIN = 150;        // m from the map edge before the trip back up

// ---------- Momentum physics ----------
// One velocity carries everything; nothing clamps it to the fall line, so you can carve uphill until you stall.
// ASSIST is the arcade layer on top (Tab menu toggles it).
const MO = {
  DRAG: 0.0045,                 // per (m/s)^2 standing (75 kg skier)
  TUCK_DRAG: 0.0024,            // ...and tucked
  PIVOT: 2.4,                   // rad/s pivot at full steer, standing still...
  PIVOT_FALL: 14,               // ...divided by (1 + speed / 14)
  EDGE_IN: 5,                   // 1/s: how fast weight rolls onto an edge
  EDGE_GRIP: 0.6,               // grip at full lean = (1 + this) x snow grip
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
  CRASH_MU: 0.6,                // a wipeout slides with friction plus a base drag
  CRASH_BASE: 2,
  CRASH_MAX: 5,                 // s before she self-arrests on any slope
};
const ASSIST = {
  on: { grip: 1.2, cap: 34, capDrag: 0.25, airG: 1.15, align: 2.5, clean: 25, sloppy: 55, crash: 20 },
  off: { grip: 1.0, cap: Infinity, capDrag: 0, airG: 1.0, align: 0, clean: 15, sloppy: 45, crash: 17 },
};
// ---------- Carve physics ----------
// Steering asks for a share of the tightest turn you can hold: radius = max(R_MIN, v^2 / grip). Goldie leans to balance
// the turn, so full steer is a clean carve at the grip limit. Carving costs speed; slow, the skis pivot; brake + steer
// is a skidded turn. Thinner air at altitude lowers drag, and wax glides better once moving.
const CV = {
  R_MIN: 7,                     // m: tightest carve
  LAT_GRIP: 1.4,                // sideways grip = snow grip x this (1.6 g groomed, 1.05 g powder)
  CLEAN: 0.92,                  // share of grip full steer asks for
  EDGE_SWAP: 0.45,              // s to swap edges fully
  CARVE_DRAG: 0.08,             // speed lost per m/s^2 of sideways pull
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
const physics = { momentum: true, assists: true, carve: true, feel: true, weight: true, crashes: false, loadDrag: true, shapes: false };
// ---------- Collision shapes and bails ----------
// Goldie is a capsule (hits walls and boxes) on a thin ski plate (meets the snow). A square hit, a sideways landing
// or a huge drop bails her: both shapes become one flat box that tumbles until it settles. Off by default (Tab: Crashes).
const BODY = { R: 0.35, H: 1.7, PLATE_L: 1.7, PLATE_W: 0.3 };
const BAIL = {
  HIT: 9,                       // m/s into a wall or trunk that bails (about 20 mph)
  MISS: 70,                     // degrees between skis and travel on landing that bails
  IMPACT: 16,                   // m/s landing impact that bails (about a 13 m drop)
  L: 1.8, W: 0.6, T: 0.25,      // body box: length, width, thickness
  MU: 0.7,
  E: 0.15,
  MAX: 6,                       // s before she gets up on any slope
};
const assist = () => (physics.assists ? ASSIST.on : ASSIST.off);

// ---------- The mountain ----------
const TREELINE = 3560;          // no conifers above this
const TREE_FAR = 900;           // trees drawn within this; past it the forest is a ground tint
const TREE_NEAR = [250, 350];    // single trees hand over to clumps across this
const CLUMP = 32;               // m: one clump per square this size past TREE_NEAR
const FILL_NEAR = [120, 160];   // packed run-edge fill fades out across this
const CHUNK = 32;               // cells of 10 m per chunk
const SUPER = 4;                // 4 x 4 chunks merge into one far piece
const LOD_STEPS = [1, 2, 4, 8, 16]; // triangle size in cells
const LOD_DIST = [250, 700, 1800, 4000]; // m to a piece's edge where it steps down a size

// ---------- Small helpers ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- Map data ----------
async function inflate(b64) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Heights in decimeters: each row's first value, then deltas along the row.
function decodeHeights(bytes, nx, nz) {
  const first = new Uint16Array(bytes.buffer, bytes.byteOffset, nz);
  const diff = new Int16Array(bytes.buffer, bytes.byteOffset + nz * 2, nx * nz);
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    let v = first[j];
    out[j * nx] = v / 10;
    for (let i = 1; i < nx; i++) { v += diff[j * nx + i]; out[j * nx + i] = v / 10; }
  }
  return out;
}
const META = MAP.meta;
const [nearBytes, farBytes, COVER, runBytes] = await Promise.all([inflate(MAP.near), inflate(MAP.far), inflate(MAP.cover), inflate(MAP.runField)]);
// Distance to the nearest groomed run (half meters, 10 m grid), negative on the run.
const RUNF = new Int8Array(runBytes.buffer, runBytes.byteOffset, runBytes.length);
const runDist = (k) => RUNF[k] / 2;
const CELL = META.near.cell, NX = META.near.nx, NZ = META.near.nz, X0 = META.near.x0, Z0 = META.near.z0;
const H = decodeHeights(nearBytes, NX, NZ);
const FAR = META.far;
const FH = decodeHeights(farBytes, FAR.nx, FAR.nz);
const X1 = X0 + (NX - 1) * CELL, Z1 = Z0 + (NZ - 1) * CELL;

// Cover byte: conifer 0-15, aspen 0-7, rock bit.
const conifer = (k) => (COVER[k] & 15) / 15;
const aspen = (k) => ((COVER[k] >> 4) & 7) / 7;
const isRock = (k) => COVER[k] >> 7;
const gridH = (i, j) => H[clamp(j, 0, NZ - 1) * NX + clamp(i, 0, NX - 1)];
const cellAt = (x, z) => clamp(Math.round((z - Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - X0) / CELL), 0, NX - 1);
// Signed distance to any run (half meters, 10 m grid); null until unpacked.
let RUN_AREA = null;
const EDGE_TREES = 25;          // m: near a run, trees come from the 1 m canopy map
const POWDER = new Uint8Array(NX * NZ);
for (let k = 0; k < NX * NZ; k++) POWDER[k] = RUNF[k] < 0 ? 0 : 1;
// Run shaping on the 10 m grid (cm), used where no 2 m tiles are loaded so lifts and stations sit on shaped snow.
const RUN_DH = RUN_DATA && RUN_DATA.dh ? await inflate(RUN_DATA.dh).then((b) => new Int16Array(b.buffer, b.byteOffset, b.length / 2)) : null;

const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const crd = (p0, p1, p2, p3, t) => 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (3 * p1 - p0 - 3 * p2 + p3) * t * t);
const samp = { h: 0, gx: 0, gz: 0 };
const rowV = [0, 0, 0, 0], rowD = [0, 0, 0, 0];
// Height and gradient on a Catmull-Rom surface through the 10 m grid, or the 2 m run grid where loaded.
let PATCH = null, patchOn = true;
function sampleGrid(g, nx, nz, x0, z0, cell, x, z, out) {
  const fx = clamp((x - x0) / cell, 0, nx - 1.001), fz = clamp((z - z0) / cell, 0, nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const at = (a, b) => g[clamp(b, 0, nz - 1) * nx + clamp(a, 0, nx - 1)];
  for (let m = 0; m < 4; m++) {
    const r = j - 1 + m;
    const p0 = at(i - 1, r), p1 = at(i, r), p2 = at(i + 1, r), p3 = at(i + 2, r);
    rowV[m] = cr(p0, p1, p2, p3, tx);
    rowD[m] = crd(p0, p1, p2, p3, tx) / cell;
  }
  out.h = cr(rowV[0], rowV[1], rowV[2], rowV[3], tz);
  out.gz = crd(rowV[0], rowV[1], rowV[2], rowV[3], tz) / cell;
  out.gx = cr(rowD[0], rowD[1], rowD[2], rowD[3], tz);
  return out;
}
// Same surface over the 2 m tiles; null where any of the 4 x 4 points is missing.
function samplePatch(P, x, z, out) {
  const fx = (x - P.x0) / P.cell, fz = (z - P.z0) / P.cell, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  if (P.at(i - 1, j - 1) < 0 || P.at(i + 2, j - 1) < 0 || P.at(i - 1, j + 2) < 0 || P.at(i + 2, j + 2) < 0) return null;
  const g = P.hp;
  for (let m = 0; m < 4; m++) {
    const r = j - 1 + m;
    const p0 = g[P.at(i - 1, r)], p1 = g[P.at(i, r)], p2 = g[P.at(i + 1, r)], p3 = g[P.at(i + 2, r)];
    rowV[m] = cr(p0, p1, p2, p3, tx);
    rowD[m] = crd(p0, p1, p2, p3, tx) / P.cell;
  }
  out.h = cr(rowV[0], rowV[1], rowV[2], rowV[3], tz);
  out.gz = crd(rowV[0], rowV[1], rowV[2], rowV[3], tz) / P.cell;
  out.gx = cr(rowD[0], rowD[1], rowD[2], rowD[3], tz);
  return out;
}
function sampleBase(x, z, out) {
  if (patchOn && PATCH && samplePatch(PATCH, x, z, out)) return out;
  sampleGrid(H, NX, NZ, X0, Z0, CELL, x, z, out);
  if (patchOn && RUN_DH) {
    const fx = clamp((x - X0) / CELL, 0, NX - 1.001), fz = clamp((z - Z0) / CELL, 0, NZ - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * NX + i;
    const a = RUN_DH[k], b = RUN_DH[k + 1], c = RUN_DH[k + NX], d = RUN_DH[k + NX + 1];
    out.h += ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) / 100;
    out.gx += ((b - a) * (1 - tz) + (d - c) * tz) / (100 * CELL);
    out.gz += ((c - a) * (1 - tx) + (d - b) * tx) / (100 * CELL);
  }
  return out;
}
// Stations sit on a flat deck that eases back to the natural ground across an apron, so you can ski on and off.
const STATIONS = [];
const stB = { h: 0, gx: 0, gz: 0 };
function stationAt(x, z) {
  for (const st of STATIONS) if (x > st.bx0 && x < st.bx1 && z > st.bz0 && z < st.bz1) return st;
  return null;
}
// m outside a station's deck, in the station's frame
function deckDist(st, x, z) {
  const dx = x - st.x, dz = z - st.z, u = st.c * dx - st.s * dz, v = st.s * dx + st.c * dz;
  return Math.hypot(Math.max(st.u0 - u, 0, u - st.u1), Math.max(st.v0 - v, 0, v - st.v1));
}
function stationH(st, x, z) {
  const t = Math.min(1, deckDist(st, x, z) / st.A), e = t * t * (3 - 2 * t);
  return st.y * (1 - e) + sampleBase(x, z, stB).h * e;
}
// Solid boxes: centre x, y, z, half sizes hx, hy, hz, yaw as c, s.
const SOLIDS = [];
function nearSolid(x, z, pad) {
  return SOLIDS.some((b) => { const dx = x - b.x, dz = z - b.z; return Math.abs(b.c * dx - b.s * dz) < b.hx + pad && Math.abs(b.s * dx + b.c * dz) < b.hz + pad; });
}
// SOLIDS bucketed in 32 m cells, each box in every cell its reach (plus 1 m for the body) touches, in SOLIDS order;
// rebuilt whenever boxes are added
const SOLID_CELL = 32, solidGrid = new Map(), NO_SOLIDS = [];
let solidGridN = -1;
function solidsAt(x, z) {
  if (solidGridN !== SOLIDS.length) {
    solidGrid.clear();
    SOLIDS.forEach((b) => {
      const R = b.hx + b.hz + 1;
      for (let j = Math.floor((b.z - R) / SOLID_CELL); j <= Math.floor((b.z + R) / SOLID_CELL); j++)
        for (let i = Math.floor((b.x - R) / SOLID_CELL); i <= Math.floor((b.x + R) / SOLID_CELL); i++) {
          const k = cellKey(i, j);
          if (!solidGrid.has(k)) solidGrid.set(k, []);
          solidGrid.get(k).push(b);
        }
    });
    solidGridN = SOLIDS.length;
  }
  return solidGrid.get(cellKey(Math.floor(x / SOLID_CELL), Math.floor(z / SOLID_CELL))) || NO_SOLIDS;
}
let solidY = null;              // skier height during a step: box tops are ground only from above
function solidTop(x, z, out) {
  for (const b of solidsAt(x, z)) {
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > b.hx + b.hz || Math.abs(dz) > b.hx + b.hz) continue;
    const u = b.c * dx - b.s * dz, v = b.s * dx + b.c * dz;
    if (Math.abs(u) > b.hx || Math.abs(v) > b.hz) continue;
    const top = b.y + b.hy;
    if (top > out.h && solidY >= top - 0.4) { out.h = top; out.gx = 0; out.gz = 0; }
  }
  return out;
}
// ---------- Kickers ----------
// Three sizes on Cabin's freestyle strip, part of the snow so physics launches off the lip.
// Kicker frame: u down the fall line from its foot, v across (45 degree sides), w up.
const KICK_SIZES = {
  small: { h: 1.0, a: 22, w: 4 },                              // about 11 m of air at 25 mph
  medium: { h: 2.0, a: 27, w: 6 },                             // about 14 m
  large: { h: 3.5, a: 32, w: 8, table: 8, land: 20 },          // table + landing: clears from about 31 mph
};
const KICK_AT = [                                              // m down the run from its top
  { run: 'Cabin', d: 330, size: 'medium' },
  { run: 'Cabin', d: 720, size: 'large' },
  { run: 'Cabin', d: 1290, size: 'small' },
];
const KICK_LIP = 1.2;                                          // m of mat up to the lip
const KICKERS = [];
{
  const kB = { h: 0, gx: 0, gz: 0 };
  for (const at of KICK_AT) {
    const run = (MAP.runs || []).find((r) => r.name === at.run);
    if (!run) continue;
    let left = at.d, x = run.points[0][0], z = run.points[0][1];
    for (let i = 0; i < run.points.length - 1 && left > 0; i++) {
      const [ax, az] = run.points[i], [bx, bz] = run.points[i + 1], L = Math.hypot(bx - ax, bz - az), f = Math.min(1, left / L);
      x = ax + (bx - ax) * f; z = az + (bz - az) * f; left -= L;
    }
    // fall line averaged over 20 m
    let gx = 0, gz = 0;
    for (let a = -10; a <= 10; a += 5) for (let b = -10; b <= 10; b += 5) { sampleBase(x + a, z + b, kB); gx += kB.gx; gz += kB.gz; }
    const g = Math.hypot(gx, gz) || 1, S = KICK_SIZES[at.size], A = S.a * Math.PI / 180;
    const R = S.h / (1 - Math.cos(A)), L = R * Math.sin(A);
    const back = S.table ? Math.tan(S.land * Math.PI / 180) : Math.tan(50 * Math.PI / 180);
    const top = L + (S.table || 0), end = top + S.h / back;
    const prof = (u) => u <= 0 ? 0 : u <= L ? R - Math.sqrt(R * R - u * u) : u <= top ? S.h : Math.max(0, S.h - (u - top) * back);
    const k = { x, z, fx: -gx / g, fz: -gz / g, hw: S.w / 2, h: S.h, L, end, prof, size: at.size, mode: -1, mesh: null };
    const r = Math.hypot(end, k.hw + S.h);
    Object.assign(k, { bx0: x - r, bx1: x + r, bz0: z - r, bz1: z + r });
    KICKERS.push(k);
  }
}
function kickH(k, x, z) {
  const dx = x - k.x, dz = z - k.z, u = dx * k.fx + dz * k.fz;
  if (u <= 0 || u >= k.end) return 0;
  const v = Math.abs(dz * k.fx - dx * k.fz);
  return Math.max(0, k.prof(u) - Math.max(0, v - k.hw));
}
function addKick(x, z, out) {
  for (const k of KICKERS) {
    if (x < k.bx0 || x > k.bx1 || z < k.bz0 || z > k.bz1) continue;
    const h = kickH(k, x, z), E = 0.05;
    if (h <= 0 && kickH(k, x + E, z) <= 0 && kickH(k, x, z + E) <= 0) continue;
    out.h += h; out.gx += (kickH(k, x + E, z) - h) / E; out.gz += (kickH(k, x, z + E) - h) / E;
  }
  return out;
}
function sample(x, z, out = samp) {
  const st = STATIONS.length ? stationAt(x, z) : null;
  if (!st) sampleBase(x, z, out);
  else {
    const h = stationH(st, x, z), E = 0.3;
    out.h = h; out.gx = (stationH(st, x + E, z) - h) / E; out.gz = (stationH(st, x, z + E) - h) / E;
  }
  if (KICKERS.length) addKick(x, z, out);
  return solidY !== null && SOLIDS.length ? solidTop(x, z, out) : out;
}
const groundY = (x, z) => sample(x, z, { h: 0, gx: 0, gz: 0 }).h;
function normalFrom(s, out) {
  return out.set(-s.gx, 1, -s.gz).normalize();
}
function surfaceAt(x, z) {
  const e = patchEdge(x, z);
  return (e === undefined ? POWDER[cellAt(x, z)] : e > 0) ? SNOW.powder : SNOW.groomed;
}
const offMap = (x, z) => x < X0 + EDGE_MARGIN || x > X1 - EDGE_MARGIN || z < Z0 + EDGE_MARGIN || z > Z1 - EDGE_MARGIN;

// ---------- Scene ----------
const stage = document.getElementById('stage');
const fadeEl = document.getElementById('fade');

// no antialiasing: hard pixel edges for the 320x180 look
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 45000);

// Snowlight: shaders light raw colors and write them straight to the screen.
const SUN_DIR = new THREE.Vector3(-0.8, 0.75, 0.25).normalize();
const SUN_COLOR = new THREE.Vector3(1.0, 0.98, 0.92);
const SKY_COLOR = new THREE.Vector3(0.42, 0.55, 0.85);
const SNOW_ALBEDO = new THREE.Vector3(0.95, 0.97, 1.0);
const FOG = new THREE.Vector3(217 / 255, 228 / 255, 238 / 255);
const BOUNCE = SUN_COLOR.clone().multiplyScalar(Math.max(0, SUN_DIR.y)).addScaledVector(SKY_COLOR, 0.6).multiply(SNOW_ALBEDO);
// fog is [near, far] in meters
const TIMES = {
  noon:   { name: 'Noon', sun: [-0.8, 0.75, 0.25], sunC: [1.0, 0.98, 0.92], sky: [0.42, 0.55, 0.85], snow: [0.95, 0.97, 1.0], fogC: [217, 228, 238], fog: [1500, 70000], lamp: [0, 0, 0] },
  golden: { name: 'Golden hour', sun: [0.85, 0.3, -0.45], sunC: [1.25, 0.72, 0.38], sky: [0.36, 0.34, 0.6], snow: [1.0, 0.9, 0.84], fogC: [228, 179, 163], fog: [1300, 60000], lamp: [0, 0, 0] },
  night:  { name: 'Night', sun: [-0.5, 0.6, 0.6], sunC: [0.3, 0.36, 0.55], sky: [0.1, 0.13, 0.26], snow: [0.9, 0.93, 1.0], fogC: [28, 34, 47], fog: [600, 20000], lamp: [1.7, 1.15, 0.6] },
  storm:  { name: 'Storm', sun: [-0.1, 1.0, 0.25], sunC: [0.32, 0.33, 0.36], sky: [0.66, 0.69, 0.75], snow: [0.93, 0.95, 0.98], fogC: [176, 184, 194], fog: [40, 900], lamp: [0, 0, 0] },
};
let timeOfDay = 'noon';
// Shadows are painted top down on a canvas SH_SIZE meters across that follows the camera.
const SH_PX = 1024, SH_SIZE = 768;
const LIGHT = {
  uSun: { value: SUN_DIR }, uSunC: { value: SUN_COLOR }, uSky: { value: SKY_COLOR }, uSnow: { value: SNOW_ALBEDO },
  uBounce: { value: BOUNCE }, uFog: { value: FOG }, uFogNear: { value: 1500 }, uFogFar: { value: 70000 }, uTreeFar: { value: TREE_FAR },
  uShadow: { value: null }, uShO: { value: new THREE.Vector2() }, uLamps: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1e5, 0)) },
  uLampC: { value: new THREE.Vector3() },
};
const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uSun, uSunC, uSky, uSnow, uBounce, uFog, uLampC;
  uniform float uFogNear, uFogFar, uTreeFar;
  uniform sampler2D uShadow; uniform vec2 uShO; uniform vec3 uLamps[4];
  float band(float v) { return max(0.12, floor(v * 4.0 + 0.5) / 4.0); }
  float band0(float v) { return floor(v * 4.0 + 0.5) / 4.0; }
  float hash(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
  // 1 where the shadow canvas blocks the sun
  float shade(vec3 p) {
    vec2 uv = (p.xz - uShO) / ${SH_SIZE}.0;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    return texture2D(uShadow, vec2(uv.x, 1.0 - uv.y)).r;
  }
  // LAMPS is defined only at night (applyTime), so daytime shaders skip the loop
  vec3 lamps(vec3 p, vec3 n) {
    vec3 l = vec3(0.0);
  #ifdef LAMPS
    for (int i = 0; i < 4; i++) { vec3 v = uLamps[i] - p; float d = length(v); l += uLampC * band0(max(0.0, dot(n, v / d)) / (1.0 + d * d / 160.0)); }
  #endif
    return l;
  }
  vec3 finish(vec3 alb, vec3 l, float dist, float cap) {
    float m = max(max(l.r, l.g), max(l.b, 0.001));
    l = l / m * band(min(cap, m));
    // distance haze
    float f = smoothstep(uFogNear, uFogFar, dist);
    return mix(min(alb * l * 1.1, 1.0), uFog, sqrt(f) * 0.92);
  }`;

const loader = new THREE.TextureLoader();
const asset = (name) => new URL(`assets/${name}.png`, import.meta.url).href;
async function loadTex(name, { pixel = true, repeat = false, mips = false } = {}) {
  const t = await loader.loadAsync(asset(name));
  t.magFilter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : t.magFilter;
  t.generateMipmaps = mips;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const [cordT, cordN, powT, powN, skyT, goldieT, goldieN, ...skyRest] = await Promise.all([
  loadTex('corduroy', { repeat: true, mips: true }), loadTex('corduroy_n', { repeat: true, mips: true }),
  loadTex('powder', { repeat: true, mips: true }), loadTex('powder_n', { repeat: true, mips: true }),
  loadTex('sky_noon', { pixel: false }), loadTex('goldie8'), loadTex('goldie8_n'),
  loadTex('sky_golden', { pixel: false }), loadTex('sky_night', { pixel: false }), loadTex('sky_storm', { pixel: false }),
]);
const SKIES = { noon: skyT, golden: skyRest[0], night: skyRest[1], storm: skyRest[2] };
const [stationT, stationN] = await Promise.all([loadTex('station_atlas'), loadTex('station_atlas_n')]);
const TREE_KINDS = ['spruce', 'fir', 'aspen', 'snowghost', 'pole', 'sign'];
const loadImg = (n) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = asset(n); });
const treeImgs = await Promise.all(TREE_KINDS.flatMap((k) => [k, k + '_n']).map(loadImg));
// storm: the snow-plastered spruce replaces the spruce
const stormImgs = await Promise.all(['storm_spruce', 'storm_spruce_n'].map(loadImg));

// Sky strip on an open cylinder that rides with the camera, drawn behind everything.
const sky = (() => {
  for (const t of Object.values(SKIES)) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.MirroredRepeatWrapping;
    t.repeat.set(4, 0.86);
    t.offset.set(0, 0.14);
  }
  const R = 1000, HS = 2 * Math.PI * R / 4 * (192 / 344) * 0.86;
  const mat = new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, HS, 48, 1, true), mat);
  m.renderOrder = -2;
  m.frustumCulled = false;
  m.userData.h = HS;
  scene.add(m);
  // below the strip, the haze color
  scene.background = new THREE.Color().setRGB(FOG.x, FOG.y, FOG.z, THREE.SRGBColorSpace);
  return m;
})();

// ---------- Terrain: flat shaded, lit by Snowlight ----------
// aCov per vertex: groomed edge distance, rock, conifer and aspen density (far tint).
const terrainMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uCord: { value: cordT }, uCordN: { value: cordN }, uPow: { value: powT }, uPowN: { value: powN },
    uRock: { value: new THREE.Vector3(0.5, 0.48, 0.45) }, uForest: { value: new THREE.Vector3(0.15, 0.26, 0.21) },
    uAspen: { value: new THREE.Vector3(0.46, 0.44, 0.4) },
    // the 10 m ground is cut away under the 2 m run mesh
    uPMask: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uPMin: { value: new THREE.Vector2() }, uPSize: { value: new THREE.Vector2(1, 1) },
    uPOn: { value: 0 }, uPFar: { value: 0 } }, LIGHT),
  vertexShader: /* glsl */ `
    attribute vec4 aCov;
    attribute vec3 aN;
    varying vec3 vP; varying vec4 vCov; varying float vD; varying vec3 vN;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vP = w.xyz; vCov = aCov; vN = aN;
      vec4 mv = viewMatrix * w;
      // skirts sit just behind the ground so the ground wins depth ties and no seams show
      if (dot(aN, aN) > 0.0) mv.xyz *= 1.003;
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uCord, uCordN, uPow, uPowN;
    uniform vec3 uRock, uForest, uAspen;
    uniform sampler2D uPMask; uniform vec2 uPMin, uPSize; uniform float uPOn, uPFar;
    varying vec3 vP; varying vec4 vCov; varying float vD; varying vec3 vN;
    void main() {
#ifndef PATCH
      if (uPOn > 0.5 && distance(vP.xz, cameraPosition.xz) < uPFar) {
        vec2 pm = (vP.xz - uPMin) / uPSize;
        if (pm.x > 0.0 && pm.y > 0.0 && pm.x < 1.0 && pm.y < 1.0 && texture2D(uPMask, pm).r > 0.5) discard;
      }
#else
      if (distance(vP.xz, cameraPosition.xz) > uPFar) discard;
#endif
      vec3 fn = normalize(cross(dFdx(vP), dFdy(vP)));
      if (dot(vN, vN) > 1e-8) fn = normalize(vN);            // skirt: lit like the ground above it
      vec2 uv = vec2(vP.x, -vP.z) / 8.0;
      float dith = (hash(vP.xz * 0.5) - 0.5) * 0.6;          // ragged 2 m blocks at groomed / powder / rock edges
#ifdef PATCH
      dith *= 0.3;                                           // crisper edge on the 2 m runs
#endif
      float edge = vCov.x + dith * 2.5;                      // m from the groomed edge
      bool groomed = edge < 0.0;
      vec3 alb = (groomed ? texture2D(uCord, uv).rgb : texture2D(uPow, uv).rgb) * uSnow;
      vec3 tn = (groomed ? texture2D(uCordN, uv).rgb : texture2D(uPowN, uv).rgb) * 2.0 - 1.0;
      float near = 1.0 - smoothstep(60.0, 300.0, vD);        // texture lighting fades with distance...
      vec3 n = normalize(fn + vec3(tn.x, 0.0, -tn.y) * (groomed ? 0.12 : 0.18) * near);
      alb = mix(uSnow, alb, 0.45 * near);                    // ...and so does the pattern
      // windrow just off the groomed edge, then a thin shadow line
      if (edge > 0.0 && edge < 1.6) { alb = mix(alb, vec3(1.0), 0.35); n = normalize(n + vec3(0.0, 0.25, 0.0)); }
      else if (edge >= 1.6 && edge < 2.4) alb *= 0.82;
      if (vCov.y + dith > 0.5) alb = uRock;
      float far = smoothstep(uTreeFar * 0.6, uTreeFar, vD);
      alb = mix(alb, uForest, clamp(vCov.z, 0.0, 1.0) * far * 0.85);
      alb = mix(alb, uAspen, clamp(vCov.w, 0.0, 1.0) * far * 0.5);
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * (1.0 - shade(vP)) + uSky * (0.4 + 0.2 * n.y) + lamps(vP, n);
      gl_FragColor = vec4(finish(alb, l, vD, 1.0), 1.0);
    }`,
});

// 320 m chunks near the camera, merged 4 x 4 far away, each LOD built on demand. Skirts hide cracks between LODs.
const NCX = Math.ceil((NX - 1) / CHUNK), NCZ = Math.ceil((NZ - 1) / CHUNK);
const chunks = [];
function buildChunk(ch, level) {
  const step = LOD_STEPS[level];
  const is = [], js = [];
  for (let i = ch.i0; i < ch.i1; i += step) is.push(i);
  is.push(ch.i1);
  for (let j = ch.j0; j < ch.j1; j += step) js.push(j);
  js.push(ch.j1);
  const nx = is.length, nz = js.length;
  const ring = 2 * (nx + nz) - 4;
  const n = nx * nz + 2 * ring;
  const pos = new Float32Array(n * 3), cov = new Float32Array(n * 4), nrm = new Float32Array(n * 3);
  const put = (v, i, j, drop, skirt) => {
    const k = j * NX + i;
    pos[v * 3] = X0 + i * CELL; pos[v * 3 + 1] = H[k] - drop; pos[v * 3 + 2] = Z0 + j * CELL;
    cov[v * 4] = runDist(k); cov[v * 4 + 1] = isRock(k); cov[v * 4 + 2] = conifer(k); cov[v * 4 + 3] = aspen(k);
    if (skirt) {
      // skirt normals match the ground beside them
      nrm[v * 3] = -(gridH(i + 1, j) - gridH(i - 1, j)) / (2 * CELL);
      nrm[v * 3 + 1] = 1;
      nrm[v * 3 + 2] = -(gridH(i, j + 1) - gridH(i, j - 1)) / (2 * CELL);
    }
  };
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) put(b * nx + a, is[a], js[b], 0);
  const idx = [];
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const v = b * nx + a;
      if ((a + b) & 1) idx.push(v, v + nx, v + 1, v + 1, v + nx, v + nx + 1);
      else idx.push(v, v + nx, v + nx + 1, v, v + nx + 1, v + 1);
    }
  }
  // skirt: copy the edge loop and drop a second copy below it
  const loop = [];
  for (let a = 0; a < nx; a++) loop.push(a);
  for (let b = 1; b < nz; b++) loop.push(b * nx + nx - 1);
  for (let a = nx - 2; a >= 0; a--) loop.push((nz - 1) * nx + a);
  for (let b = nz - 2; b > 0; b--) loop.push(b * nx);
  const drop = step * CELL * 1.5 + 4;
  loop.forEach((v, q) => {
    put(nx * nz + q, is[v % nx], js[Math.floor(v / nx)], 0, true);
    put(nx * nz + ring + q, is[v % nx], js[Math.floor(v / nx)], drop, true);
  });
  for (let q = 0; q < ring; q++) {
    const a = nx * nz + q, b = nx * nz + (q + 1) % ring, a2 = a + ring, b2 = b + ring;
    idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, terrainMat);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  return mesh;
}
const piece = (i0, j0, i1, j1) => ({ i0, j0, i1: Math.min(i1, NX - 1), j1: Math.min(j1, NZ - 1), meshes: [], level: -1 });
for (let sj = 0; sj < NCZ; sj += SUPER) {
  for (let si = 0; si < NCX; si += SUPER) {
    const sup = piece(si * CHUNK, sj * CHUNK, (si + SUPER) * CHUNK, (sj + SUPER) * CHUNK);
    sup.kids = [];
    for (let cj = sj; cj < Math.min(sj + SUPER, NCZ); cj++) {
      for (let ci = si; ci < Math.min(si + SUPER, NCX); ci++) sup.kids.push(piece(ci * CHUNK, cj * CHUNK, (ci + 1) * CHUNK, (cj + 1) * CHUNK));
    }
    chunks.push(sup);
  }
}
// ---------- Work queue ----------
// Heavy builds (terrain sizes, run meshes, tree pages) wait here and run nearest first, WORK_MS a frame, so arriving
// somewhere new is spread over frames. Whatever is showing stays until its replacement is built.
const WORK_MS = 3, work = new Map();
let workAll = false;            // a snapped camera (start, teleport) runs everything at once, behind the fade
function queueWork(key, d, run) {
  const w = work.get(key);
  if (w) w.d = d; else work.set(key, { d, run });
}
// one queue key per (object, level)
const workKey = (o, level) => ((o.workKeys ||= [])[level] ||= {});
function runWork() {
  const t0 = performance.now();
  while (work.size && (workAll || performance.now() - t0 < WORK_MS)) {
    let bk, bw;
    for (const [k, w] of work) if (!bw || w.d < bw.d) { bk = k; bw = w; }
    work.delete(bk);
    bw.run();
  }
}
const pieceDist = (p, cx, cz) => Math.hypot(Math.max(0, X0 + p.i0 * CELL - cx, cx - X0 - p.i1 * CELL), Math.max(0, Z0 + p.j0 * CELL - cz, cz - Z0 - p.j1 * CELL));
function showPiece(p, level) {
  if (level === p.level) return;
  if (level >= 0 && !p.meshes[level]) p.meshes[level] = buildChunk(p, level);
  p.meshes.forEach((m, l) => { if (m) m.visible = l === level; });
  // free the finest LOD once the piece is well away
  if (level !== 0 && level !== 1 && p.meshes[0]) { scene.remove(p.meshes[0]); p.meshes[0].geometry.dispose(); p.meshes[0] = null; }
  p.level = level;
}
// true once a piece's mesh at this level exists; otherwise queue it (or, with nothing of the area showing, build it now)
function terrainReady(p, level, d, now) {
  if (level < 0 || p.meshes[level]) return true;
  if (now || workAll) { p.meshes[level] = buildChunk(p, level); return true; }
  queueWork(workKey(p, level), d, () => { if (!p.meshes[level]) { p.meshes[level] = buildChunk(p, level); p.meshes[level].visible = false; } });
  return false;
}
function updateTerrain() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const sup of chunks) {
    const d = pieceDist(sup, cx, cz), kidsShown = sup.kids.some((k) => k.level >= 0);
    if (d >= LOD_DIST[1]) {
      const level = d < LOD_DIST[2] ? 2 : d < LOD_DIST[3] ? 3 : 4;
      if (!terrainReady(sup, level, d, sup.level < 0 && !kidsShown)) continue;
      showPiece(sup, level);
      for (const k of sup.kids) showPiece(k, -1);
    } else {
      const dk = sup.kids.map((k) => pieceDist(k, cx, cz)), lv = dk.map((v) => v < LOD_DIST[0] ? 0 : v < LOD_DIST[1] ? 1 : 2);
      const ok = sup.kids.map((k, n) => terrainReady(k, lv[n], dk[n], sup.level < 0 && k.level < 0));
      // the far piece stays until every kid can replace it
      if (!kidsShown && sup.level >= 0 && !ok.every(Boolean)) continue;
      showPiece(sup, -1);
      sup.kids.forEach((k, n) => { if (ok[n]) showPiece(k, lv[n]); });
    }
  }
}

// Surrounding peaks to ~25 km from the 100 m data, with a hole under the 10 m mountain: 200 m triangles within 3 km,
// 400 m to 8 km, 800 m past that. 1.6 km blocks, skirts where sizes differ, one draw.
{
  const S = 2, nx = Math.floor((FAR.nx - 1) / S) + 1, nz = Math.floor((FAR.nz - 1) / S) + 1, cell = FAR.cell * S, B = 8;
  const inner = (x, z, m) => x > X0 + m && x < X1 - m && z > Z0 + m && z < Z1 - m;
  const hk = (a, b) => FH[clamp(b * S, 0, FAR.nz - 1) * FAR.nx + clamp(a * S, 0, FAR.nx - 1)];
  const pos = [], cov = [], nrm = [], idx = [];
  const put = (i, j, drop, skirt) => {
    const x = FAR.x0 + i * cell, z = FAR.z0 + j * cell, h = hk(i, j);
    const gx = (hk(i + 1, j) - hk(i - 1, j)) / (2 * cell), gz = (hk(i, j + 1) - hk(i, j - 1)) / (2 * cell), slope = Math.hypot(gx, gz);
    // tucked under the 10 m mountain where they overlap
    const out = Math.hypot(Math.max(X0 - x, 0, x - X1), Math.max(Z0 - z, 0, z - Z1));
    pos.push(x, h - 14 * clamp(1 - out / 800, 0, 1) - drop, z);
    cov.push(60, slope > 0.85 ? 1 : 0, h < 3300 && slope < 0.8 ? 0.75 : h < 3500 ? 0.3 : 0, 0);
    if (skirt) nrm.push(-gx, 1, -gz); else nrm.push(0, 0, 0);
    return pos.length / 3 - 1;
  };
  const stepOf = (bi, bj) => {
    if (bi < 0 || bj < 0 || bi >= nx - 1 || bj >= nz - 1) return 0;
    const i1 = Math.min(bi + B, nx - 1), j1 = Math.min(bj + B, nz - 1);
    const out = Math.hypot(Math.max(X0 - FAR.x0 - i1 * cell, 0, FAR.x0 + bi * cell - X1), Math.max(Z0 - FAR.z0 - j1 * cell, 0, FAR.z0 + bj * cell - Z1));
    return out < 3000 ? 1 : out < 8000 ? 2 : 4;
  };
  for (let bj = 0; bj < nz - 1; bj += B) {
    for (let bi = 0; bi < nx - 1; bi += B) {
      const i1 = Math.min(bi + B, nx - 1), j1 = Math.min(bj + B, nz - 1), step = stepOf(bi, bj);
      const is = [], js = [];
      for (let i = bi; i < i1; i += step) is.push(i);
      is.push(i1);
      for (let j = bj; j < j1; j += step) js.push(j);
      js.push(j1);
      const w = is.length, v0 = pos.length / 3;
      for (const j of js) for (const i of is) put(i, j, 0);
      for (let b = 0; b < js.length - 1; b++) {
        for (let a = 0; a < w - 1; a++) {
          if (inner(FAR.x0 + (is[a] + is[a + 1]) / 2 * cell, FAR.z0 + (js[b] + js[b + 1]) / 2 * cell, 260)) continue;
          const v = v0 + b * w + a;
          idx.push(v, v + w, v + 1, v + 1, v + w, v + w + 1);
        }
      }
      // skirt only where the neighbor block is another size
      const drop = step * cell * 0.6 + 20;
      const skirt = (pts) => {
        const top = pts.map(([i, j]) => put(i, j, 0, true)), bot = pts.map(([i, j]) => put(i, j, drop, true));
        for (let q = 0; q < pts.length - 1; q++) {
          const a = top[q], b = top[q + 1], a2 = bot[q], b2 = bot[q + 1];
          idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
        }
      };
      const other = (n) => n > 0 && n !== step;
      if (other(stepOf(bi, bj - B))) skirt(is.map((i) => [i, bj]));
      if (other(stepOf(bi, bj + B))) skirt(is.map((i) => [i, j1]));
      if (other(stepOf(bi - B, bj))) skirt(js.map((j) => [bi, j]));
      if (other(stepOf(bi + B, bj))) skirt(js.map((j) => [i1, j]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(new Float32Array(cov), 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, terrainMat);
  m.frustumCulled = false;
  scene.add(m);
}

// ---------- Trees ----------
// Camera-facing upright billboards from one atlas, lit from normal maps. Built per 320 m page from the cover map
// with fixed hashes, so the trees you see are the trees you hit.
const SLOT = 80;
// Clumps: several tree sprites on one sprite for forest past TREE_NEAR. Conifer clumps are hand laid out,
// each tree [kind, scale, center x, rise] in sprite pixels, back row first.
const CLUMP_W = 168;
const CONIFER_CLUMPS = [
  [[0, 0.556, 10, 22], [0, 0.58, 47, 22], [0, 0.604, 78, 22], [0, 0.568, 115, 22], [0, 0.592, 146, 22], [0, 0.732, 29, 11], [0, 0.696, 60, 11], [0, 0.72, 97, 11], [0, 0.744, 128, 11], [0, 0.708, 165, 11], [0, 0.848, 14, 0], [0, 0.872, 55, 0], [0, 0.836, 90, 0], [0, 0.86, 131, 0]],
  [[1, 0.62, 138, 14], [1, 0.48, 76, 20], [1, 0.56, 50, 12], [1, 0.36, 12, 16], [0, 0.7, 106, 6], [1, 0.5, 30, 4], [1, 1.0, 124, 0], [1, 0.52, 152, 0], [0, 0.64, 88, 0], [1, 0.58, 64, 0], [0, 0.44, 38, 0], [1, 0.34, 18, 0]],
  [[1, 0.62, 24, 18], [0, 0.7, 50, 16], [0, 0.94, 36, 4], [1, 0.74, 64, 2], [1, 0.48, 14, 0], [0, 0.56, 78, 0], [1, 0.52, 128, 10], [0, 0.6, 148, 4], [1, 0.4, 118, 0]],
];
const CLUMPS = [
  ...CONIFER_CLUMPS.map((list) => ({ kind: 'conifer', trees: list.map(([n, scale, cx, rise]) => {
    const dw = Math.round(treeImgs[n * 2].width * scale);
    return [n, scale, Math.round(clamp(cx - dw / 2, 0, CLUMP_W - dw)), rise];
  }) })),
  // aspen and snow ghost clumps: three rows, back rows smaller and higher
  ...[{ kind: 'aspen', mix: [2] }, { kind: 'snowghost', mix: [3] }].map((c, k) => {
    const m = k + 3, trees = [];
    [[0.56, 0.17], [0.74, 0.08], [0.94, 0]].forEach(([sc, rise], row) => {
      for (let q = 0; q < 4; q++) {
        const r = (u) => hash2(m * 7 + row * 4 + q, u);
        const n = c.mix[Math.floor(r(1) * c.mix.length)], scale = sc + (r(2) - 0.5) * 0.12;
        const w = treeImgs[n * 2].width * scale, h = treeImgs[n * 2].height;
        // rows offset half a gap, with jitter
        const room = CLUMP_W - w, x = Math.round(clamp(room * (q + (row === 1 ? 0.25 : row === 2 ? 0.6 : 0) + (r(3) - 0.5) * 0.35) / 3.6, 0, room));
        trees.push([n, scale, x, Math.round(h * (rise + r(4) * 0.04))]);
      }
    });
    return { kind: c.kind, trees };
  }),
];
const atlas = (() => {
  const W = SLOT * TREE_KINDS.length + CLUMP_W * CLUMPS.length;
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
    return t;
  };
  const rects = [];
  // paints one sheet (color or normal); the storm sheet swaps in the storm spruce
  const paint = (normal, storm) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = 128;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const img = (n) => (storm && n === 0 ? stormImgs[normal ? 1 : 0] : treeImgs[n * 2 + (normal ? 1 : 0)]);
    const size = (n) => [treeImgs[n * 2].width, treeImgs[n * 2].height];
    TREE_KINDS.forEach((k, n) => {
      const [w, h] = size(n), x = n * SLOT + Math.floor((SLOT - w) / 2), y = 128 - h;
      g.drawImage(img(n), x, y, w, h);
      if (!normal && !storm) rects[n] = { u0: x / W, u1: (x + w) / W, v1: h / 128, aspect: w / h };
    });
    CLUMPS.forEach((c, m) => {
      const x0 = SLOT * TREE_KINDS.length + m * CLUMP_W;
      let left = CLUMP_W, right = 0, top = 128;
      for (const [n, sc, x, rise] of c.trees) {
        const [w, h] = size(n), dw = Math.round(w * sc), dh = Math.round(h * sc), y = 128 - rise - dh;
        g.drawImage(img(n), x0 + x, y, dw, dh);
        left = Math.min(left, x); right = Math.max(right, x + dw); top = Math.min(top, y);
      }
      if (!normal && !storm) rects.push({ u0: (x0 + left) / W, u1: (x0 + right) / W, v1: (128 - top) / 128, aspect: (right - left) / (128 - top), clump: c.kind });
    });
    return mk(cv);
  };
  const map = paint(false, false);
  return { map, normal: paint(true, false), stormMap: paint(false, true), stormNormal: paint(true, true), rects };
})();
const CLUMP_IDS = { conifer: [], aspen: [], snowghost: [] };
atlas.rects.forEach((r, n) => { if (r.clump) CLUMP_IDS[r.clump].push(n); });
const KIND = { spruce: 0, fir: 1, aspen: 2, snowghost: 3, pole: 4, sign: 5 };
const TREE_R = [0.11, 0.11, 0.07, 0.3, 0, 0];      // trunk radius as a share of height
const PAGE = 32;
const pages = new Map();
let shAt = null, shDirty = false;              // shadow canvas centre; a page built inside it marks it for a repaint
const treeCells = new Map();                  // 8 m cells -> trees, for collisions
const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
function addObstacle(t) {
  const ck = cellKey(Math.floor(t.x / 8), Math.floor(t.z / 8));
  if (!treeCells.has(ck)) treeCells.set(ck, []);
  treeCells.get(ck).push(t);
}
function makePage(pi, pj) {
  const key = pi * 1000 + pj;
  let pg = pages.get(key);
  if (pg) return pg;
  const list = [], rocks = [];
  for (let j = pj * PAGE; j < Math.min((pj + 1) * PAGE, NZ); j++) {
    for (let i = pi * PAGE; i < Math.min((pi + 1) * PAGE, NX); i++) {
      const k = j * NX + i, h = H[k];
      if (LIFT_CUT[k]) continue;                       // lift lines are cut through the forest...
      // ...and so are groomed runs, to 2 m past the edge
      const pe = patchEdge(X0 + i * CELL, Z0 + j * CELL);
      if (pe === undefined ? RUNF[k] < 4 : pe < -4) continue;
      const clear = (x, z, r) => pe === undefined || patchEdge(x, z) > r + 1.5;
      if (isRock(k) && hash2(i + 101, j + 37) < 0.16) {
        const r = hash2(i + 55, j + 991), x = X0 + (i + (r - 0.5) * 0.7) * CELL, z = Z0 + (j + (hash2(i, j + 4242) - 0.5) * 0.7) * CELL;
        const s = 1.6 + r * 3.2;
        if (clear(x, z, s)) {
          const rk = { x, z, y: groundY(x, z) - s * 0.35, s, rot: r * 40, v: Math.floor(hash2(i + 9, j + 9) * ROCK_VARIANTS), r: s * 0.75, height: s * 1.2 };
          rocks.push(rk);
          addObstacle(rk);
        }
      }
      const c = conifer(k), a = aspen(k);
      if (c + a < 0.05) continue;
      if (RUN_AREA && RUN_AREA[k] < EDGE_TREES * 2) continue;   // edge trees stand here instead
      // Up to two trees a cell where the forest is thick. Real Colorado heights (spruce 15-24 m, fir 12-20, aspen 10-15).
      for (let q = 0; q < 2; q++) {
        const o = q * 7001;
        const r1 = hash2(i + o, j), r2 = hash2(i + 7919, j + o), r3 = hash2(i + o, j + 7919), r4 = hash2(i + 3571 + o, j + 1597);
        let kind = -1;
        if (q === 0 ? r1 < c * 0.62 : r1 < (c - 0.35) * 0.9) {
          if (h > 3380 && r2 < 0.35) kind = KIND.snowghost;
          else kind = r2 < (h < 3000 ? 0.7 : h < 3350 ? 0.5 : 0.3) ? KIND.spruce : KIND.fir;
        } else if (q === 0 && r1 < c * 0.62 + a * 0.5 && h < 3150) {
          kind = KIND.aspen;
        }
        if (kind < 0) continue;
        const ox = q === 0 ? (r3 - 0.5) * 0.8 : (hash2(i, j) < 0.5 ? 0.3 : -0.3) + (r3 - 0.5) * 0.3;
        const oz = q === 0 ? (r4 - 0.5) * 0.8 : (hash2(i + 3571, j + 1597) < 0.5 ? 0.3 : -0.3) + (r4 - 0.5) * 0.3;
        const x = X0 + (i + ox) * CELL, z = Z0 + (j + oz) * CELL;
        const height = kind === KIND.snowghost ? 2.2 + r3 * 1.6 : kind === KIND.aspen ? 10 + r4 * 5 : kind === KIND.spruce ? 15 + r3 * 9 : 12 + r4 * 8;
        if (!clear(x, z, TREE_R[kind] * height)) continue;
        const t = { x, z, y: groundY(x, z) - (kind === KIND.snowghost ? 0.5 : 0.3), height, r: TREE_R[kind] * height, kind };
        list.push(t);
        addObstacle(t);
      }
    }
  }
  // run props, bucketed by page
  for (const t of PROPS.get(key) || []) list.push(t);
  pg = Object.assign({ list, rocks }, pageData(list, pi, pj));
  pages.set(key, pg);
  const P = PAGE * CELL, px = X0 + pi * P, pz = Z0 + pj * P;
  if (shAt && Math.max(Math.abs(px + P / 2 - shAt.x), Math.abs(pz + P / 2 - shAt.z)) < SH_SIZE / 2 + P / 2 + 60) shDirty = true;
  return pg;
}
// near: every tree, sorted into 4 x 4 squares of 80 m (sub[q]..sub[q + 1]) so only nearby squares are sent.
// far: one clump per 32 m square of 3+ trees, as tall as its tallest main-kind tree; smaller squares and props stay single.
function pageData(all, pi, pj) {
  const P = PAGE * CELL, px = X0 + pi * P, pz = Z0 + pj * P, SQ = P / 4;
  const inst = (t, r, aspect) => [t.x, t.y, t.z, t.height, r.u0, r.u1, aspect, r.v1];
  const sq = (t) => clamp(Math.floor((t.z - pz) / SQ), 0, 3) * 4 + clamp(Math.floor((t.x - px) / SQ), 0, 3);
  const squares = (ts) => {
    const sorted = ts.slice().sort((a, b) => sq(a) - sq(b));
    const near = new Float32Array(sorted.length * 8), sub = new Int32Array(17);
    sorted.forEach((t, n) => { near.set(inst(t, atlas.rects[t.kind], atlas.rects[t.kind].aspect), n * 8); sub[sq(t) + 1] = n + 1; });
    for (let q = 1; q <= 16; q++) sub[q] = Math.max(sub[q], sub[q - 1]);
    return { near, sub };
  };
  // the packed edge fill is its own layer, near only, never clumped
  const list = all.filter((t) => !t.fill), { near, sub } = squares(list), fill = squares(all.filter((t) => t.fill));
  const cells = new Map(), far = [];
  for (const t of list) {
    if (t.kind > KIND.snowghost) { far.push(inst(t, atlas.rects[t.kind], atlas.rects[t.kind].aspect)); continue; }
    const k = Math.floor((t.z - pz) / CLUMP) * 64 + Math.floor((t.x - px) / CLUMP);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(t);
  }
  // thick squares split across their longer side into two clumps, one behind the other
  const groups = [];
  for (const [k, ts] of cells) {
    if (ts.length < 8) { groups.push([k, ts]); continue; }
    const sx = Math.max(...ts.map((t) => t.x)) - Math.min(...ts.map((t) => t.x)), sz = Math.max(...ts.map((t) => t.z)) - Math.min(...ts.map((t) => t.z));
    const by = sx > sz ? (t) => t.x : (t) => t.z, o = ts.slice().sort((a, b) => by(a) - by(b)), half = ts.length >> 1;
    groups.push([k, o.slice(0, half)], [k + 0.5, o.slice(half)]);
  }
  for (const [k, ts] of groups) {
    if (ts.length < 3) { for (const t of ts) far.push(inst(t, atlas.rects[t.kind], atlas.rects[t.kind].aspect)); continue; }
    const count = [0, 0, 0];
    for (const t of ts) count[t.kind === KIND.aspen ? 1 : t.kind === KIND.snowghost ? 2 : 0]++;
    const main = count.indexOf(Math.max(...count)), name = ['conifer', 'aspen', 'snowghost'][main];
    const own = ts.filter((t) => (t.kind === KIND.aspen ? 1 : t.kind === KIND.snowghost ? 2 : 0) === main);
    let x = 0, z = 0, y = Infinity, h = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of ts) { x += t.x; z += t.z; y = Math.min(y, t.y); x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); z0 = Math.min(z0, t.z); z1 = Math.max(z1, t.z); }
    for (const t of own) h = Math.max(h, t.height);
    const ids = CLUMP_IDS[name], r = atlas.rects[ids[Math.floor(hash2(k + 31 * pi, 17 * pj) * ids.length)]];
    // stretched to the trees' spread so neighbor clumps close up
    const spread = Math.max(x1 - x0, z1 - z0) + h * 0.4;
    far.push(inst({ x: x / ts.length, y, z: z / ts.length, height: h }, r, r.aspect * clamp(spread / (h * r.aspect), 0.85, 1.3)));
  }
  return { near, sub, fnear: fill.near, fsub: fill.sub, far: new Float32Array(far.flat()) };
}
const TREE_MAX = 60000;
// Near trees and far clumps fade across TREE_NEAR by the same per-pixel dither, so each pixel shows exactly one.
function treeLayer(layer) {
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(TREE_MAX * 8), 8, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('iTex', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.instanceCount = 0;
  return geo;
}
const treeGeo = treeLayer(0), clumpGeo = treeLayer(1), fillGeo = treeLayer(0);
const treeShaders = {
  vertexShader: /* glsl */ `
    uniform vec3 uSun; uniform vec2 uNear; uniform float uLayer;
    attribute vec4 iPos, iTex;
    varying vec2 vUv; varying vec3 vRight; varying float vD; varying vec3 vBase; varying float vUp;
    void main() {
      // shade sampled sunward of the trunk so a tree never shades itself
      vec2 sunXZ = normalize(uSun.xz + vec2(1e-4));
      vBase = iPos.xyz + vec3(sunXZ.x, 0.0, sunXZ.y) * (iPos.w * iTex.z * 0.5 + 0.8); vUp = position.y;
      vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
      float w = iPos.w * iTex.z;
      vec3 p = iPos.xyz + right * position.x * w + vec3(0.0, position.y * iPos.w, 0.0);
      vUv = vec2(mix(iTex.x, iTex.y, position.x + 0.5), position.y * iTex.w);
      vRight = right;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
      // outside this layer's range: no pixels
      float d = -(viewMatrix * vec4(iPos.xyz, 1.0)).z;
      if (uLayer < 0.5 ? d > uNear.y + 40.0 : d < uNear.x - 40.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uA, uN; uniform vec2 uNear; uniform float uLayer;
    varying vec2 vUv; varying vec3 vRight; varying float vD; varying vec3 vBase; varying float vUp;
    void main() {
      float hsh = hash(gl_FragCoord.xy), f = smoothstep(uNear.x, uNear.y, vD);
      if (uLayer < 0.5 ? hsh < f : hsh >= f) discard;
      // dither out toward TREE_FAR, where the ground tint takes over
      if (hsh < smoothstep(uTreeFar * 0.75, uTreeFar, vD)) discard;
      vec4 a = texture2D(uA, vUv);
      if (a.a < 0.5) discard;
      vec3 s = texture2D(uN, vUv).rgb * 2.0 - 1.0;
      vec3 toward = vec3(-vRight.z, 0.0, vRight.x);
      vec3 n = normalize(vRight * s.x + vec3(0.0, s.y, 0.0) + toward * s.z);
      // shaded at the base, fading up the trunk
      float lit = 1.0 - shade(vBase) * (1.0 - smoothstep(0.0, 0.8, vUp));
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * lit + uSky * (0.35 + 0.35 * n.y)
             + uBounce * band(max(0.0, -n.y * 0.8 + 0.15)) * 0.5 * (1.0 - 0.6 * shade(vBase)) + lamps(vBase + vec3(0.0, 2.0, 0.0), n) * 1.4 + 0.05;
      gl_FragColor = vec4(finish(a.rgb, l, vD, 1.25), 1.0);
    }`,
};
const treeMat = new THREE.ShaderMaterial(Object.assign({
  uniforms: Object.assign({ uA: { value: atlas.map }, uN: { value: atlas.normal }, uNear: { value: new THREE.Vector2(...TREE_NEAR) }, uLayer: { value: 0 } }, LIGHT),
}, treeShaders));
// clumps share the tree uniforms except uLayer
const clumpMat = new THREE.ShaderMaterial(Object.assign({
  uniforms: Object.assign({}, treeMat.uniforms, { uLayer: { value: 1 } }),
}, treeShaders));
// fill: single trees, faded across FILL_NEAR
const fillMat = new THREE.ShaderMaterial(Object.assign({
  uniforms: Object.assign({}, treeMat.uniforms, { uNear: { value: new THREE.Vector2(...FILL_NEAR) } }),
}, treeShaders));
const treeMesh = new THREE.Mesh(treeGeo, treeMat), clumpMesh = new THREE.Mesh(clumpGeo, clumpMat), fillMesh = new THREE.Mesh(fillGeo, fillMat);
for (const m of [treeMesh, clumpMesh, fillMesh]) { m.frustumCulled = false; scene.add(m); }
let treePage = '', treeAt = null;
const TREE_STEP = 48;   // m the camera moves before the near squares are picked again
function updateTrees(force) {
  const P = PAGE * CELL, cx = camera.position.x, cz = camera.position.z;
  if (!force && treeAt && Math.hypot(cx - treeAt.x, cz - treeAt.z) < TREE_STEP) return;
  treeAt = { x: cx, z: cz };
  const pi = Math.floor((cx - X0) / P), pj = Math.floor((cz - Z0) / P);
  const id = pi + ',' + pj, newPage = id !== treePage;
  treePage = id;
  const R = Math.ceil(TREE_FAR / P) + 1;
  const boxDist = (x0, z0, s) => Math.hypot(Math.max(0, x0 - cx, cx - x0 - s), Math.max(0, z0 - cz, cz - z0 - s));
  const nb = treeGeo.attributes.iPos.data, fb = clumpGeo.attributes.iPos.data, lb = fillGeo.attributes.iPos.data;
  let n = 0, m = 0, l = 0;
  const inRange = [];
  for (let b = pj - R; b <= pj + R; b++) {
    for (let a = pi - R; a <= pi + R; a++) {
      if (a < 0 || b < 0 || a * PAGE >= NX || b * PAGE >= NZ) continue;
      const x0 = X0 + a * P, z0 = Z0 + b * P;
      if (Math.hypot(x0 + P / 2 - cx, z0 + P / 2 - cz) > TREE_FAR + P) continue;
      const d = boxDist(x0, z0, P);
      // pages not built yet are queued; when one lands the trees are picked again
      let pg = pages.get(a * 1000 + b);
      if (!pg && workAll) pg = makePage(a, b);
      if (!pg) { queueWork(workKey(pages, a * 1000 + b), d, () => { if (!pages.has(a * 1000 + b)) { makePage(a, b); treeAt = null; treePage = ''; } }); continue; }
      inRange.push(pg);
      if (d > TREE_FAR) continue;
      // near: only squares that can come within TREE_NEAR before the next pick
      if (d < TREE_NEAR[1] + TREE_STEP + 20) {
        for (let q = 0; q < 16; q++) {
          if (boxDist(x0 + (q % 4) * P / 4, z0 + Math.floor(q / 4) * P / 4, P / 4) > TREE_NEAR[1] + TREE_STEP + 20) continue;
          const count = Math.min(pg.sub[q + 1] - pg.sub[q], TREE_MAX - n);
          nb.array.set(pg.near.subarray(pg.sub[q] * 8, (pg.sub[q] + count) * 8), n * 8);
          n += count;
        }
      }
      if (d < FILL_NEAR[1] + TREE_STEP + 20) {
        for (let q = 0; q < 16; q++) {
          if (boxDist(x0 + (q % 4) * P / 4, z0 + Math.floor(q / 4) * P / 4, P / 4) > FILL_NEAR[1] + TREE_STEP + 20) continue;
          const count = Math.min(pg.fsub[q + 1] - pg.fsub[q], TREE_MAX - l);
          lb.array.set(pg.fnear.subarray(pg.fsub[q] * 8, (pg.fsub[q] + count) * 8), l * 8);
          l += count;
        }
      }
      const count = Math.min(pg.far.length / 8, TREE_MAX - m);
      fb.array.set(pg.far.subarray(0, count * 8), m * 8);
      m += count;
    }
  }
  for (const [geo, buf, k] of [[treeGeo, nb, n], [clumpGeo, fb, m], [fillGeo, lb, l]]) {
    buf.addUpdateRange(0, k * 8);
    buf.needsUpdate = true;
    geo.instanceCount = k;
  }
  if (newPage || force) fillRocks(inRange);
}

// ---------- Kit models: low poly, flat shaded, vertex colored, lit by Snowlight ----------
// aH: height above the model's base, so ground shadows only darken the bottom. aT: atlas tile (u, v in tiles, tile + 1;
// 0 = plain color); the tile's color and normal map apply up close and fade to the tile's average past ~300 m.
const TILES = { hood: 0, deck: 1, siding: 2, window: 3, roofSnow: 4, concrete: 5, cabin: 6, steel: 7, pad: 8, metalRoof: 9,
  darkPanel: 10, cedar: 11, stone: 12, curtain: 13, posterA: 14, posterB: 15, posterC: 16 };
const TILE_AVG = [[0.14, 0.276, 0.588], [0.448, 0.352, 0.271], [0.469, 0.337, 0.225], [0.297, 0.307, 0.353], [0.943, 0.962, 1.0], [0.598, 0.579, 0.541],
  [0.135, 0.152, 0.181], [0.638, 0.658, 0.686], [0.745, 0.115, 0.096], [0.271, 0.281, 0.301], [0.148, 0.153, 0.167], [0.591, 0.387, 0.219],
  [0.399, 0.378, 0.352], [0.247, 0.307, 0.38], [0.541, 0.573, 0.616], [0.389, 0.325, 0.326], [0.614, 0.505, 0.493]];
while (TILE_AVG.length < 32) TILE_AVG.push([1, 1, 1]);
const modelMat = new THREE.ShaderMaterial({
  vertexColors: true,
  uniforms: Object.assign({ uAtlas: { value: stationT }, uAtlasN: { value: stationN },
    uAvg: { value: TILE_AVG.map((c) => new THREE.Vector3(...c)) } }, LIGHT),
  vertexShader: /* glsl */ `
    attribute float aH;
    attribute vec3 aT;
    varying vec3 vC; varying vec3 vP; varying float vD; varying float vH; varying vec3 vT;
    void main() {
      vC = color; vH = aH; vT = aT;
      vec4 w = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        w = instanceMatrix * w;
      #endif
      w = modelMatrix * w;
      vP = w.xyz;
      vec4 mv = viewMatrix * w;
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uAtlas, uAtlasN; uniform vec3 uAvg[32];
    varying vec3 vC; varying vec3 vP; varying float vD; varying float vH; varying vec3 vT;
    void main() {
      vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
      vec3 alb = vC;
      if (vT.z > 0.5) {
        int t = int(vT.z - 0.5);
        float tf = float(t);
        vec2 cell = vec2(mod(tf, 8.0), 3.0 - floor(tf / 8.0));   // atlas rows run top down
        vec2 auv = (cell + (fract(vT.xy) * 62.0 + 1.0) / 64.0) / vec2(8.0, 4.0);
        vec3 tc = texture2D(uAtlas, auv).rgb, tn = texture2D(uAtlasN, auv).rgb * 2.0 - 1.0;
        // bend the normal along the tile's axes, from screen-space derivatives
        vec3 q0 = dFdx(vP), q1 = dFdy(vP); vec2 s0 = dFdx(vT.xy), s1 = dFdy(vT.xy);
        vec3 q1p = cross(q1, n), q0p = cross(n, q0);
        vec3 T = q1p * s0.x + q0p * s1.x, B = q1p * s0.y + q0p * s1.y;
        float det = max(dot(T, T), dot(B, B)), sc = det == 0.0 ? 0.0 : inversesqrt(det);
        vec3 pn = normalize(T * (tn.x * sc) + B * (tn.y * sc) + n * tn.z);
        float near = 1.0 - smoothstep(120.0, 320.0, vD);
        vec3 avg = uAvg[0];
        for (int k = 1; k < 32; k++) if (k == t) avg = uAvg[k];
        alb = vC * mix(avg, tc, near);
        n = normalize(mix(n, pn, near));
      }
      vec2 sunXZ = normalize(uSun.xz + vec2(1e-4));
      float lit = 1.0 - shade(vP + vec3(sunXZ.x, 0.0, sunXZ.y) * 1.5) * (1.0 - smoothstep(0.0, 4.0, vH));
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * lit + uSky * (0.35 + 0.35 * n.y)
             + uBounce * band0(max(0.0, -n.y * 0.8 + 0.15)) * 0.5 + lamps(vP, n) * 1.2 + 0.05;
      gl_FragColor = vec4(finish(alb, l, vD, 1.25), 1.0);
    }`,
});
const STEEL = [0.46, 0.48, 0.52], DARK = [0.2, 0.21, 0.25], CONC = [0.62, 0.6, 0.56], PAD = [0.78, 0.12, 0.1],
  SEAT = [0.16, 0.2, 0.36], WALL = [0.5, 0.36, 0.24], SNOWCAP = [0.92, 0.95, 1.0], CABIN = [0.75, 0.6, 0.2], GLASS = [0.15, 0.2, 0.3];
// A one-color part with an optional matrix. With a tile, each face gets atlas coords projected on its main axis, 4 m a tile.
function part(g, col, m, tile = -1) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3), h = new Float32Array(n), t = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c.set(col, i * 3); h[i] = g.attributes.position.getY(i); }
  if (tile >= 0) {
    const P = g.attributes.position.array;
    for (let f = 0; f < n; f += 3) {
      const ax = P[f * 3 + 3] - P[f * 3], ay = P[f * 3 + 4] - P[f * 3 + 1], az = P[f * 3 + 5] - P[f * 3 + 2];
      const bx = P[f * 3 + 6] - P[f * 3], by = P[f * 3 + 7] - P[f * 3 + 1], bz = P[f * 3 + 8] - P[f * 3 + 2];
      const nx = Math.abs(ay * bz - az * by), ny = Math.abs(az * bx - ax * bz), nz = Math.abs(ax * by - ay * bx);
      for (let k = f; k < f + 3; k++) {
        const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
        const [u, v] = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
        t.set([u / 4, v / 4, tile + 1], k * 3);
      }
    }
  }
  g.setAttribute('aT', new THREE.BufferAttribute(t, 3));
  if (m) g.applyMatrix4(m);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  return g;
}
function partUV(g, col, tile, u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, uv = g.attributes.uv, c = new Float32Array(n * 3), h = new Float32Array(n), t = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c.set(col, i * 3); h[i] = g.attributes.position.getY(i);
    t.set([clamp(u0 + uv.getX(i) * (u1 - u0), 0.002, 0.998), clamp(v0 + uv.getY(i) * (v1 - v0), 0.002, 0.998), tile + 1], i * 3);
  }
  g.setAttribute('aT', new THREE.BufferAttribute(t, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  return g;
}
function merge(parts) {
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3), h = new Float32Array(n), t = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    p.set(g.attributes.position.array, o * 3); c.set(g.attributes.color.array, o * 3); h.set(g.attributes.aH.array, o);
    if (g.attributes.aT) t.set(g.attributes.aT.array, o * 3);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 3));
  g.computeBoundingSphere();
  return g;
}
// place model-local parts: base at (x, y, z), local z along yaw
const placeM = (x, y, z, yaw) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
function placed(parts, m) {
  return parts.map((g) => {
    const h = g.attributes.aH.array.slice();
    g.applyMatrix4(m);
    g.attributes.aH.array.set(h);
    return g;
  });
}

// ---------- Rocks: displaced icosahedra, snow on up-facing faces ----------
const ROCK_VARIANTS = 6, ROCK_MAX = 2500;
function rockGeo(k) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  const sx = 0.8 + hash2(k, 1) * 0.6, sy = 0.6 + hash2(k, 2) * 0.6, sz = 0.7 + hash2(k, 3) * 0.6;
  // displace shared corners alike so faces stay closed
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 0.75 + hash2(Math.round(v.x * 50) + k * 977, Math.round(v.y * 50) + Math.round(v.z * 50) * 7) * 0.5;
    v.multiplyScalar(d); v.y = Math.max(v.y, -0.25);
    p.setXYZ(i, v.x * sx, (v.y + 0.25) * sy, v.z * sz);
  }
  const c = new Float32Array(p.count * 3), h = new Float32Array(p.count), a = new THREE.Vector3(), b = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); e.fromBufferAttribute(p, i + 2);
    const n = b.clone().sub(a).cross(e.clone().sub(a)).normalize();
    const t = hash2(i + k, k * 3);
    const col = n.y > 0.5 ? SNOWCAP : [0.5 + t * 0.08, 0.46 + t * 0.06, 0.41 + t * 0.05];
    for (let j = 0; j < 3; j++) { c.set(col, (i + j) * 3); h[i + j] = p.getY(i + j); }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  return g;
}
const rockMeshes = [];
for (let k = 0; k < ROCK_VARIANTS; k++) {
  const m = new THREE.InstancedMesh(rockGeo(k), modelMat, ROCK_MAX);
  m.count = 0; m.frustumCulled = false;
  scene.add(m);
  rockMeshes.push(m);
}
const rockM = new THREE.Matrix4(), rockQ = new THREE.Quaternion(), rockS = new THREE.Vector3(), rockP = new THREE.Vector3();
function fillRocks(pagesInRange) {
  for (const m of rockMeshes) m.count = 0;
  for (const pg of pagesInRange) {
    for (const r of pg.rocks) {
      const m = rockMeshes[r.v];
      if (m.count >= ROCK_MAX) continue;
      rockQ.setFromAxisAngle(UP_Y, r.rot);
      rockM.compose(rockP.set(r.x, r.y, r.z), rockQ, rockS.set(r.s, r.s * 0.9, r.s));
      m.setMatrixAt(m.count++, rockM);
    }
  }
  for (const m of rockMeshes) m.instanceMatrix.needsUpdate = true;
}

// Chairlift terminal: hood on four legs over the wheel post, a deck and an operator hut.
// Frame: wheel at x = z = 0, ground y = 0, line toward -z.
const TCOL = { STEEL, DARK, CONC, WALL, SNOWCAP, GLASS, CANOPY: [0.14, 0.28, 0.6], UNDER: [0.1, 0.13, 0.22], DECK: [0.42, 0.31, 0.21] };
// hood: three stacked outlines (straight sides, half circle behind the wheel) joined by sloped walls, open to the line
function canopy(R, L, y0, seg = 8) {
  const ring = (w, y, front) => {
    const p = [[w, front]];
    for (let k = 0; k <= seg; k++) { const t = (k / seg) * Math.PI; p.push([w * Math.cos(t), w * Math.sin(t)]); }
    p.push([-w, front]);
    return p.map(([x, z]) => new THREE.Vector3(x, y, z));
  };
  const rings = [ring(R, y0, -L), ring(R + 0.25, y0 + 0.75, -L - 0.15), ring(R - 0.8, y0 + 1.45, -L + 0.5)];
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(A[i], B[j], A[j]); tri(A[i], B[i], B[j]); }
  }
  const cap = (Rg, up) => {
    const f = THREE.ShapeUtils.triangulateShape(Rg.map((v) => new THREE.Vector2(v.x, v.z)), []);
    for (const [a, b, c] of f) up ? tri(Rg[a], Rg[c], Rg[b]) : tri(Rg[a], Rg[b], Rg[c]);
  };
  cap(rings[2], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // dark underside
  const u = [];
  const f = THREE.ShapeUtils.triangulateShape(rings[0].map((v) => new THREE.Vector2(v.x, v.z)), []);
  for (const [a, b, c] of f) for (const v of [rings[0][a], rings[0][c], rings[0][b]]) u.push(v.x, v.y + 0.02, v.z);
  const ug = new THREE.BufferGeometry();
  ug.setAttribute('position', new THREE.Float32BufferAttribute(u, 3));
  return [g, ug];
}
// gable roof: width across, length along z, ridge height
function gable(w, l, h) {
  const a = [-w / 2, 0], b = [w / 2, 0], c = [0, h], pos = [];
  const v = (p, z) => [p[0], p[1], z];
  const quad = (p, q, r, s) => pos.push(...p, ...q, ...r, ...p, ...r, ...s);
  quad(v(a, l / 2), v(c, l / 2), v(c, -l / 2), v(a, -l / 2));
  quad(v(b, -l / 2), v(c, -l / 2), v(c, l / 2), v(b, l / 2));
  pos.push(...v(a, l / 2), ...v(b, l / 2), ...v(c, l / 2), ...v(b, -l / 2), ...v(a, -l / 2), ...v(c, -l / 2));
  quad(v(a, -l / 2), v(b, -l / 2), v(b, l / 2), v(a, l / 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
// Station apron: a grid over the deck and apron with stationH heights, outer ring tucked under the ground.
function apron(sd, base) {
  const step = 2.0, pos = [], A = sd.A;
  const us = [], vs = [];
  for (let u = sd.u0 - A; u < sd.u1 + A + step; u += step) us.push(Math.min(u, sd.u1 + A));
  for (let v = sd.v0 - A; v < sd.v1 + A + step; v += step) vs.push(Math.min(v, sd.v1 + A));
  const at = (u, v) => {
    const x = sd.x + sd.c * u + sd.s * v, z = sd.z - sd.s * u + sd.c * v, d = deckDist(sd, x, z);
    const y = d >= A ? sampleBase(x, z, stB).h - 0.4 : stationH(sd, x, z) + 0.03;
    return [u, y - base, v, d];
  };
  const grid = vs.map((v) => us.map((u) => at(u, v)));
  for (let b = 0; b < vs.length - 1; b++) for (let a = 0; a < us.length - 1; a++) {
    const p = grid[b][a], q = grid[b][a + 1], r = grid[b + 1][a + 1], t = grid[b + 1][a];
    if (p[3] === 0 && q[3] === 0 && r[3] === 0 && t[3] === 0) continue;      // under the deck
    if (p[3] >= A && q[3] >= A && r[3] >= A && t[3] >= A) continue;          // past the apron
    pos.push(...p.slice(0, 3), ...r.slice(0, 3), ...q.slice(0, 3), ...p.slice(0, 3), ...t.slice(0, 3), ...r.slice(0, 3));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.applyMatrix4(placeM(sd.x, base, sd.z, sd.yaw));
  return g;
}
// deck footprint in the station frame: [u0, u1] across, [v0, v1] along; side: which side the hut is on (+1 = +x)
const deckRect = (arm, side = 1) => side > 0 ? [-(arm + 2.0), arm + 5.0, -7.5, 1.5] : [-(arm + 5.0), arm + 2.0, -7.5, 1.5];
function chairTerminal(H = 5, arm = 3, foot = 3, side = 1) {
  const P = [], add = (g, c, tile = -1) => P.push(part(g, c, null, tile)), W = [1, 1, 1];
  const R = arm + 1.0, L = 7, top = H - 0.35;
  // wheel post: footing, tapered column, drive box
  add(new THREE.BoxGeometry(2.2, 0.5, 2.2).translate(0, 0.25, 0), W, TILES.concrete);
  add(new THREE.CylinderGeometry(0.42, 0.6, H - 0.7, 8).translate(0, 0.5 + (H - 0.7) / 2, 0), TCOL.STEEL);
  add(new THREE.CylinderGeometry(arm, arm, 0.3, 14).translate(0, H, 0), TCOL.DARK);
  // hood and legs, just outside the chairs' path
  const [hood, under] = canopy(R, L, top);
  add(hood, W, TILES.hood); add(under, TCOL.UNDER);
  for (const [x, z] of [[-(arm + 1.55), 1.2], [arm + 1.55, 1.2], [-(arm + 1.55), -L + 0.9], [arm + 1.55, -L + 0.9]]) {
    const h = top - 0.5;
    add(new THREE.BoxGeometry(0.2, h, 0.2).translate(x, 0.5 + h / 2, z), TCOL.STEEL);
  }
  // deck, flush with the snow
  const [xl, xr, d0, d1] = deckRect(arm, side);
  add(new THREE.BoxGeometry(xr - xl, 0.5, d1 - d0).translate((xl + xr) / 2, 0.25, (d0 + d1) / 2), W, TILES.deck);
  add(new THREE.BoxGeometry(xr - xl - 0.2, foot, d1 - d0 - 0.2).translate((xl + xr) / 2, -foot / 2, (d0 + d1) / 2), W, TILES.concrete);   // footing
  // operator hut
  const hx = side * (arm + 3.4), hz = -L + 3.2, hb = 0.5;
  add(new THREE.BoxGeometry(3.0, 2.6, 3.0).translate(hx, hb + 1.3, hz), W, TILES.siding);
  add(new THREE.BoxGeometry(3.06, 0.9, 2.4).translate(hx, hb + 1.75, hz), W, TILES.window);
  add(new THREE.BoxGeometry(2.4, 0.9, 3.06).translate(hx, hb + 1.75, hz), W, TILES.window);
  // snowy gable roof
  const roof = gable(3.8, 3.8, 1.0).translate(hx, hb + 2.6, hz);
  add(roof, W, TILES.roofSnow);
  add(new THREE.BoxGeometry(0.16, 4.4, 0.16).translate(hx - side * 1.6, hb + 2.2, hz - 1.6), TCOL.DARK);   // lamp post
  return P;
}

// Gondola terminal: a glass hall with steel bands and a snowy barrel roof, open at the line end.
// Same frame as the chairlift; floor top at y = 0.5.
const gondolaDeck = (arm) => [-(arm + 4.0), arm + 4.0, -20.0, 5.0];
const GW = (arm) => arm + 3.6;                       // side walls
const W = [1, 1, 1];
function barrel(w, l, z0, y0, rise, seg = 8) {
  // barrel vault across x, length l from z0 toward -z: shell plus dark underside
  const pos = [], under = [], arc = [];
  for (let k = 0; k <= seg; k++) { const a = Math.PI * (1 - k / seg); arc.push([Math.cos(a) * w / 2, y0 + Math.sin(a) * rise]); }
  const quad = (out, A, B, C, D) => out.push(...A, ...B, ...C, ...A, ...C, ...D);
  const parts = [[], []];
  for (let k = 0; k < seg; k++) {
    const [xa, ya] = arc[k], [xb, yb] = arc[k + 1], top = k > 1 && k < seg - 2 ? 0 : 1;
    quad(parts[top], [xa, ya, z0], [xb, yb, z0], [xb, yb, z0 - l], [xa, ya, z0 - l]);
    quad(under, [xa, ya - 0.05, z0], [xa, ya - 0.05, z0 - l], [xb, yb - 0.05, z0 - l], [xb, yb - 0.05, z0]);
  }
  const ends = [[], []];                             // arched ends: 0 line end, 1 back
  for (let k = 0; k < seg; k++) {
    const [xa, ya] = arc[k], [xb, yb] = arc[k + 1];
    ends[0].push(0, y0, z0 - l + 0.3, xb, yb, z0 - l + 0.3, xa, ya, z0 - l + 0.3);
    ends[1].push(0, y0, z0 - 0.3, xa, ya, z0 - 0.3, xb, yb, z0 - 0.3);
  }
  const geo = (a) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); return g; };
  return { snow: geo(parts[0]), metal: geo(parts[1]), under: geo(under), front: geo(ends[0]), back: geo(ends[1]) };
}
function gondolaTerminal(H, arm, foot) {
  const P = [], add = (g, c, tile = -1) => P.push(part(g, c, null, tile));
  const [xl, xr, d0, d1] = gondolaDeck(arm), wx = GW(arm), zf = -19.0, zb = 4.5, eave = 6.0;
  // floor and footing
  add(new THREE.BoxGeometry(xr - xl, 0.5, d1 - d0).translate(0, 0.25, (d0 + d1) / 2), W, TILES.concrete);
  add(new THREE.BoxGeometry(xr - xl - 0.2, foot, d1 - d0 - 0.2).translate(0, -foot / 2, (d0 + d1) / 2), W, TILES.concrete);
  // wheel post
  add(new THREE.CylinderGeometry(0.5, 0.7, H - 0.9, 8).translate(0, 0.5 + (H - 0.9) / 2, 0), TCOL.STEEL);
  add(new THREE.CylinderGeometry(arm, arm, 0.3, 16).translate(0, H + 0.1, 0), TCOL.DARK);
  // side walls: dark band, glass, dark band; back wall dark
  for (const sx of [-1, 1]) {
    const x = sx * wx, len = zb - zf, zc = (zb + zf) / 2;
    add(new THREE.BoxGeometry(0.3, 1.0, len).translate(x, 1.0, zc), W, TILES.darkPanel);
    add(new THREE.BoxGeometry(0.24, 3.8, len).translate(x, 3.4, zc), W, TILES.curtain);
    add(new THREE.BoxGeometry(0.3, 0.7, len).translate(x, 5.65, zc), W, TILES.darkPanel);
  }
  add(new THREE.BoxGeometry(2 * wx, eave - 0.5, 0.3).translate(0, 0.5 + (eave - 0.5) / 2, zb), W, TILES.darkPanel);
  add(new THREE.BoxGeometry(2 * wx + 0.3, 0.6, 0.4).translate(0, eave - 0.3, zf), W, TILES.darkPanel);   // header over the opening
  // barrel roof: snow crown, metal sides
  const r = barrel(2 * wx + 1.4, zb - zf + 1.6, zb + 0.8, eave, 2.6);
  add(r.snow, W, TILES.roofSnow); add(r.metal, W, TILES.metalRoof); add(r.under, TCOL.UNDER);
  add(r.front, W, TILES.curtain); add(r.back, W, TILES.darkPanel);
  add(new THREE.BoxGeometry(0.16, 4.4, 0.16).translate(wx + 1.2, 2.7, zf - 0.6), TCOL.DARK);   // lamp post
  return P;
}
// Elk Camp Gondola top: the terminal, the restaurant (stone foundation, sun deck, posters on the wall facing the terminal)
// and a maintenance building. Footprints in the terminal frame: [x0, x1, z0, z1].
const ELK_REST = (arm) => [-(GW(arm) + 22.0), -(GW(arm) + 6.0), -15.0, 9.0];
const ELK_REST_DECK = 5.0;                           // sun deck depth
const ELK_SHOP = (arm) => [GW(arm) + 6.0, GW(arm) + 17.0, -12.0, 3.0];
function elkCampTop(arm, lowRest, lowShop) {
  const P = [], add = (g, c, tile = -1) => P.push(part(g, c, null, tile));
  // restaurant
  {
    const [x0, x1, z0, z1] = ELK_REST(arm), xc = (x0 + x1) / 2, w = x1 - x0, zc = (z0 + z1) / 2, l = z1 - z0, dz0 = z0 - ELK_REST_DECK;
    const fd = 0.5 - lowRest + 0.4;                  // foundation down past the lowest snow
    add(new THREE.BoxGeometry(w + 0.4, fd, z1 - dz0 + 0.4).translate(xc, 0.5 - fd / 2, (z1 + dz0) / 2), W, TILES.stone);
    add(new THREE.BoxGeometry(w, 0.4, ELK_REST_DECK).translate(xc, 0.3, z0 - ELK_REST_DECK / 2), W, TILES.deck);
    // hall: dark panels, cedar band, glass on two sides
    add(new THREE.BoxGeometry(w, 4.5, l).translate(xc, 0.5 + 2.25, zc), W, TILES.darkPanel);
    add(new THREE.BoxGeometry(w + 0.1, 1.0, l + 0.1).translate(xc, 1.0, zc), W, TILES.cedar);
    add(new THREE.BoxGeometry(w - 1.0, 3.2, 0.2).translate(xc, 3.1, z0 - 0.05), W, TILES.curtain);
    add(new THREE.BoxGeometry(0.2, 3.2, l - 6.0).translate(x0 - 0.05, 3.1, zc - 1.0), W, TILES.curtain);
    // roof slab over the deck, cedar soffit, snow on top
    const rx = w + 5.0, rz = l + ELK_REST_DECK + 3.0, rzc = (z1 + 1.5 + dz0 - 0.5) / 2 + 0.5;
    add(new THREE.BoxGeometry(rx, 0.6, rz).translate(xc, 5.3, rzc), W, TILES.darkPanel);
    add(new THREE.BoxGeometry(rx - 0.3, 0.06, rz - 0.3).translate(xc, 4.98, rzc), W, TILES.cedar);
    add(new THREE.BoxGeometry(rx - 0.6, 0.45, rz - 0.6).translate(xc, 5.8, rzc), W, TILES.roofSnow);
    for (const x of [x0 + 0.6, xc, x1 - 0.6]) add(new THREE.BoxGeometry(0.3, 4.4, 0.3).translate(x, 2.7, dz0 + 0.4), TCOL.DARK);
    // glass rail
    add(new THREE.BoxGeometry(w, 1.0, 0.06).translate(xc, 1.0, dz0 + 0.1), TCOL.GLASS);
    add(new THREE.BoxGeometry(w, 0.08, 0.12).translate(xc, 1.52, dz0 + 0.1), TCOL.DARK);
    for (const x of [x0 + 0.05, x1 - 0.05]) {
      add(new THREE.BoxGeometry(0.06, 1.0, ELK_REST_DECK).translate(x, 1.0, z0 - ELK_REST_DECK / 2), TCOL.GLASS);
      add(new THREE.BoxGeometry(0.12, 0.08, ELK_REST_DECK).translate(x, 1.52, z0 - ELK_REST_DECK / 2), TCOL.DARK);
    }
    // posters, about 1 x 1.5 m
    [TILES.posterA, TILES.posterB, TILES.posterC].forEach((t, k) => {
      const g = new THREE.PlaneGeometry(1.0, 1.52).rotateY(Math.PI / 2).translate(x1 + 0.03, 2.4, zc - 2.4 + k * 2.4);
      P.push(partUV(g, W, t, 11 / 64, 53 / 64, 0, 1));
    });
  }
  // maintenance building
  {
    const [x0, x1, z0, z1] = ELK_SHOP(arm), xc = (x0 + x1) / 2, w = x1 - x0, zc = (z0 + z1) / 2, l = z1 - z0;
    const fd = 0.5 - lowShop + 0.4;
    add(new THREE.BoxGeometry(w + 0.3, fd, l + 0.3).translate(xc, 0.5 - fd / 2, zc), W, TILES.concrete);
    add(new THREE.BoxGeometry(w, 3.6, l).translate(xc, 0.5 + 1.8, zc), W, TILES.siding);
    add(new THREE.BoxGeometry(w - 4.5, 0.9, 0.12).translate(xc + 1.8, 2.7, z0 - 0.04), W, TILES.window);
    add(new THREE.BoxGeometry(3.2, 3.0, 0.12).translate(x0 + 2.2, 2.0, z0 - 0.04), W, TILES.darkPanel);
    add(gable(w + 1.4, l + 1.4, 1.6).translate(xc, 4.1, zc), W, TILES.roofSnow);
  }
  return P;
}
// Gondola tower: galvanized column with a ladder, crossarm with a railed walkway, sheave trains. Base y = 0, line along z.
function gondolaTower(th, arm) {
  const P = [], add = (g, c, tile = -1) => P.push(part(g, c, null, tile)), wide = arm * 2 + 2.6;
  add(new THREE.BoxGeometry(2.6, 1.2, 2.6).translate(0, 0.3, 0), W, TILES.concrete);
  add(new THREE.CylinderGeometry(0.5, 0.62, th, 8).translate(0, th / 2, 0), W, TILES.steel);
  add(new THREE.CylinderGeometry(1.05, 1.05, 2.6, 8).translate(0, 1.9, 0), W, TILES.pad);
  add(new THREE.BoxGeometry(0.42, th - 3.4, 0.06).translate(0, 3.0 + (th - 3.4) / 2, 0.62), TCOL.STEEL);   // ladder
  add(new THREE.BoxGeometry(wide, 0.6, 0.7).translate(0, th, 0), W, TILES.steel);
  add(new THREE.BoxGeometry(wide, 0.08, 2.0).translate(0, th + 0.34, 0), TCOL.STEEL);                     // walkway
  for (const z of [-1.0, 1.0]) add(new THREE.BoxGeometry(wide, 0.06, 0.06).translate(0, th + 1.35, z), TCOL.STEEL);
  for (const x of [-wide / 2 + 0.1, 0, wide / 2 - 0.1]) for (const z of [-1.0, 1.0])
    add(new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(x, th + 0.85, z), TCOL.STEEL);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.36, 0.5, 4.2).translate(sx * arm, th + 0.15, 0), TCOL.DARK);
  }
  return P;
}
// Gondola station: hall, deck and apron, solid walls, trees cleared; at the Elk Camp top, the restaurant and maintenance building.
function gondolaStation(sd, arm, hh, base, m, elkTop) {
  apronGeos.push(apron(sd, base));
  STATIONS.push(sd);
  const toW = (u, v) => [sd.x + sd.c * u + sd.s * v, sd.z - sd.s * u + sd.c * v];
  const box = (u0, u1, v0, v1, y0, y1) => {
    const [x, z] = toW((u0 + u1) / 2, (v0 + v1) / 2);
    SOLIDS.push({ x, z, y: (y0 + y1) / 2, hx: (u1 - u0) / 2, hy: (y1 - y0) / 2, hz: (v1 - v0) / 2, c: sd.c, s: sd.s });
  };
  const wx = GW(arm), y = sd.y;
  box(-wx - 0.2, -wx + 0.2, -19.0, 4.5, y - 0.5, y + 5.5);
  box(wx - 0.2, wx + 0.2, -19.0, 4.5, y - 0.5, y + 5.5);
  box(-wx, wx, 4.3, 4.7, y - 0.5, y + 5.5);
  { const [x, z] = toW(0, 0); addObstacle({ x, z, y, r: 0.7, height: hh }); }
  const cut = (u0, u1, v0, v1, pad) => {
    const cs = [[u0, v0], [u1, v0], [u0, v1], [u1, v1]].map(([u, v]) => toW(u, v));
    const xs = cs.map((q) => q[0]), zs = cs.map((q) => q[1]);
    for (let jj = Math.floor((Math.min(...zs) - pad - Z0) / CELL); jj <= Math.ceil((Math.max(...zs) + pad - Z0) / CELL); jj++)
      for (let ii = Math.floor((Math.min(...xs) - pad - X0) / CELL); ii <= Math.ceil((Math.max(...xs) + pad - X0) / CELL); ii++) {
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
        const dx = X0 + ii * CELL - sd.x, dz = Z0 + jj * CELL - sd.z, u = sd.c * dx - sd.s * dz, v = sd.s * dx + sd.c * dz;
        if (u > u0 - pad && u < u1 + pad && v > v0 - pad && v < v1 + pad) LIFT_CUT[jj * NX + ii] = 1;
      }
  };
  for (let jj = Math.floor((sd.bz0 - Z0) / CELL); jj <= Math.ceil((sd.bz1 - Z0) / CELL); jj++)
    for (let ii = Math.floor((sd.bx0 - X0) / CELL); ii <= Math.ceil((sd.bx1 - X0) / CELL); ii++)
      if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ && deckDist(sd, X0 + ii * CELL, Z0 + jj * CELL) < sd.A + 4) LIFT_CUT[jj * NX + ii] = 1;
  casters.push({ x: sd.x, z: sd.z, h: 7, w: wx }, { ...(([x, z]) => ({ x, z }))(toW(0, -12)), h: 7, w: wx });
  if (!elkTop) return;
  // lowest snow under each building, station frame
  const low = ([u0, u1, v0, v1]) => {
    let lo = 1e9;
    for (let v = v0; v <= v1 + 0.01; v += 2) for (let u = u0; u <= u1 + 0.01; u += 2) { const [x, z] = toW(u, v); lo = Math.min(lo, groundY(x, z)); }
    return Math.min(0, lo - base);
  };
  const R = ELK_REST(arm), S = ELK_SHOP(arm);
  const lowR = low([R[0], R[1], R[2] - ELK_REST_DECK, R[3]]), lowS = low(S);
  liftParts.push(...placed(elkCampTop(arm, lowR, lowS), m));
  box(R[0], R[1], R[2], R[3], base + lowR - 0.5, y + 5.6);
  box(R[0], R[1], R[2] - ELK_REST_DECK, R[2], base + lowR - 0.5, y + 1.55);
  box(S[0], S[1], S[2], S[3], base + lowS - 0.5, y + 5.0);
  cut(R[0] - 2.5, R[1] + 2.5, R[2] - ELK_REST_DECK - 1.5, R[3] + 1.5, 4);
  cut(S[0], S[1], S[2], S[3], 4);
  for (const [u, v, w] of [[(R[0] + R[1]) / 2, R[2] + 4, 9], [(R[0] + R[1]) / 2, R[3] - 6, 9], [(S[0] + S[1]) / 2, (S[2] + S[3]) / 2, 6]]) {
    const [x, z] = toW(u, v); casters.push({ x, z, h: 6, w });
  }
}
// ---------- Lifts on the real lines (OpenStreetMap) ----------
// OSM points are towers where mapped; long gaps get one about every 110 m. Towers grow until the chairs clear the snow.
const UP_Y = new THREE.Vector3(0, 1, 0);
const LIFT_STYLE = {
  chair_lift: { arm: 3.0, tower: 11, term: 5, clear: 7, carrier: 'chair', gap: 24, speed: 5 },
  gondola: { arm: 3.2, tower: 14, term: 6, clear: 8, carrier: 'cabin', gap: 42, speed: 5.5 },
  't-bar': { arm: 1.3, tower: 7.5, term: 4, clear: 4.5, carrier: 'bar', gap: 14, speed: 3 },
  platter: { arm: 1.1, tower: 6.5, term: 3.5, clear: 4, carrier: 'bar', gap: 12, speed: 2.8 },
};
const MAX_SPAN = 115;
const LIFTS = MAP.lifts || [];
const LIFT_CUT = new Uint8Array(NX * NZ);
const liftParts = [], cablePts = [], casters = [], lampList = [], apronGeos = [];
const carriers = { chair: [], cabin: [], bar: [] };
const liftPaths = [];
const LIFT_ENDS = LIFTS.flatMap((l) => [l.points[0], l.points[l.points.length - 1]].map((p) => ({ lift: l, x: p[0], z: p[1] })));
for (const lift of LIFTS) {
  lift.partsFrom = liftParts.length;
  const st = LIFT_STYLE[lift.kind] || LIFT_STYLE.chair_lift;
  // terminals at the ends, towers between; drop points bunched near a terminal
  const raw = lift.points.map((p) => [p[0], p[1]]);
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = pts[pts.length - 1], d = Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]);
    const end = raw[raw.length - 1], toEnd = Math.hypot(raw[i][0] - end[0], raw[i][1] - end[1]);
    if (i < raw.length - 1 && (d < 25 || toEnd < 25)) continue;
    const n = Math.ceil(d / MAX_SPAN) - 1;
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      pts.push([last[0] + (raw[i][0] - last[0]) * f, last[1] + (raw[i][1] - last[1]) * f]);
    }
    pts.push(raw[i]);
  }
  const N = pts.length;
  const g = pts.map(([x, z]) => groundY(x, z));
  const c = g.map((y, i) => y + (i === 0 || i === N - 1 ? st.term : st.tower));
  // deck at the highest snow under it; cable 3.15 m above the deck so seats clear it by about half a meter
  const stn = {};
  const isGondola = lift.kind === 'gondola';
  if (lift.kind === 'chair_lift' || isGondola || !LIFT_STYLE[lift.kind]) for (const i of [0, N - 1]) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) + (i === 0 ? Math.PI : 0), cs = Math.cos(yaw), sn = Math.sin(yaw);
    // hut goes away from any other lift's end within 20 m
    const hut = LIFT_ENDS.some((q) => q.lift !== lift && Math.hypot(q.x - pts[i][0], q.z - pts[i][1]) < 20 && cs * (q.x - pts[i][0]) - sn * (q.z - pts[i][1]) > 0) ? -1 : 1;
    const [u0, u1, v0, v1] = isGondola ? gondolaDeck(st.arm) : deckRect(st.arm, hut);
    let hi = -1e9, lo = 1e9;
    for (let v = v0; v <= v1 + 0.01; v += 1.5) for (let u = u0; u <= u1 + 0.01; u += 1.5) {
      const h = groundY(pts[i][0] + cs * u + sn * v, pts[i][1] - sn * u + cs * v);
      hi = Math.max(hi, h); lo = Math.min(lo, h);
    }
    const y = hi + 0.1, A = clamp((y - lo) * 3 + 4, 6, 18);
    const R = Math.hypot(Math.max(-u0, u1), Math.max(-v0, v1)) + A;
    const sd = { x: pts[i][0], z: pts[i][1], c: cs, s: sn, yaw, u0, u1, v0, v1, y, lo, A, hut,
      bx0: pts[i][0] - R, bx1: pts[i][0] + R, bz0: pts[i][1] - R, bz1: pts[i][1] + R };
    stn[i] = sd;
    c[i] = y + (isGondola ? 4.45 : 3.15);
  }
  const sagOf = (i) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) * 0.012;
  const cableAt = (i, f) => c[i] + (c[i + 1] - c[i]) * f - sagOf(i) * Math.sin(Math.PI * f);
  // raise towers until every span clears the snow
  for (let pass = 0; pass < 8; pass++) {
    let ok = true;
    for (let i = 0; i < N - 1; i++) {
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      let worst = 0, wf = 0.5;
      for (let s = 5; s < len; s += 8) {
        const f = s / len, x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
        const d = groundY(x, z) + st.clear - cableAt(i, f);
        if (d > worst) { worst = d; wf = f; }
      }
      if (worst <= 0.1) continue;
      ok = false;
      // lift each end by how close the low spot is to it; terminals stay put
      const ia = i, ib = i + 1, ta = ia === 0, tb = ib === N - 1;
      const wa = ta ? 0 : tb ? 1 : 1 - wf, wb = tb ? 0 : ta ? 1 : wf;
      const scale = worst / Math.max(0.25, wa * (1 - wf) + wb * wf);
      c[ia] += wa * scale * 1.05; c[ib] += wb * scale * 1.05;
    }
    if (ok) break;
  }
  for (let i = 1; i < N - 1; i++) c[i] = Math.min(c[i], g[i] + 32);
  const dirAt = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  };
  for (let i = 1; i < N - 1; i++) {
    const th = c[i] - g[i] - 0.55, arm = st.arm, yaw = dirAt(i);
    const parts = isGondola ? gondolaTower(th, arm) : [
      part(new THREE.BoxGeometry(2.2, 1.2, 2.2).translate(0, 0.3, 0), W, null, TILES.concrete),
      part(new THREE.CylinderGeometry(0.4, 0.68, th, 6).translate(0, th / 2, 0), W, null, TILES.steel),
      part(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 8).translate(0, 1.9, 0), W, null, TILES.pad),
      part(new THREE.BoxGeometry(arm * 2 + 1.4, 0.45, 0.5).translate(0, th, 0), W, null, TILES.steel),
      part(new THREE.BoxGeometry(1.2, 0.35, 2.4).translate(-arm, th + 0.35, 0), DARK),
      part(new THREE.BoxGeometry(1.2, 0.35, 2.4).translate(arm, th + 0.35, 0), DARK),
      part(new THREE.BoxGeometry(0.22, th - 2, 0.22).translate(0.55, th / 2, 0.3), DARK),
    ];
    liftParts.push(...placed(parts, placeM(pts[i][0], g[i] - 0.4, pts[i][1], yaw)));
    casters.push({ x: pts[i][0], z: pts[i][1], h: th, w: 0.8 });
    addObstacle({ x: pts[i][0], z: pts[i][1], y: g[i], r: 1.1, height: th });
  }
  for (const i of [0, N - 1]) {
    const sd = stn[i], yaw = sd ? sd.yaw : dirAt(i) + (i === 0 ? Math.PI : 0), arm = st.arm;
    const base = sd ? sd.y - 0.5 : g[i] - 0.3, hh = c[i] - base;
    const neu = !!sd;
    const parts = neu && isGondola ? gondolaTerminal(hh, arm, sd.y - sd.lo + 0.6) : neu ? chairTerminal(hh, arm, sd.y - sd.lo + 0.6, sd.hut) : [
      part(new THREE.BoxGeometry(arm * 2 + 4, 0.6, 9).translate(0, 0.0, 1.5), CONC),
      part(new THREE.BoxGeometry(0.7, hh - 0.6, 0.7).translate(-1.2, (hh - 0.6) / 2, 0), STEEL),
      part(new THREE.BoxGeometry(0.7, hh - 0.6, 0.7).translate(1.2, (hh - 0.6) / 2, 0), STEEL),
      part(new THREE.BoxGeometry(arm * 2 + 1.2, 1.1, 3.4).translate(0, hh - 0.2, 0.8), STEEL),
      part(new THREE.CylinderGeometry(arm, arm, 0.3, 14).translate(0, hh + 0.45, 0), DARK),
      part(new THREE.BoxGeometry(3.2, 2.6, 3.2).translate(arm + 3.6, 1.3, -3), WALL),
      part(new THREE.BoxGeometry(2.2, 0.9, 0.1).translate(arm + 3.6, 1.7, -1.35), GLASS),
      part(new THREE.ConeGeometry(2.7, 1.5, 4, 1).rotateY(Math.PI / 4).translate(arm + 3.6, 3.35, -3), SNOWCAP),
      part(new THREE.BoxGeometry(0.2, 5.5, 0.2).translate(arm + 1.6, 2.75, -1.2), DARK),
    ];
    const m = placeM(pts[i][0], base, pts[i][1], yaw);
    liftParts.push(...placed(parts, m));
    if (sd && isGondola) gondolaStation(sd, arm, hh, base, m, lift.name === 'Elk Camp Gondola' && g[i] >= Math.max(g[0], g[N - 1]));
    else if (sd) {
      apronGeos.push(apron(sd, base));
      STATIONS.push(sd);
      // post, legs and hut are solid; deck and apron are snow
      const L = 7, toW = (u, v) => [sd.x + sd.c * u + sd.s * v, sd.z - sd.s * u + sd.c * v];
      for (const [u, v, r] of [[0, 0, 0.6], [-(arm + 1.55), 1.2, 0.2], [arm + 1.55, 1.2, 0.2], [-(arm + 1.55), -L + 0.9, 0.2], [arm + 1.55, -L + 0.9, 0.2]]) {
        const [x, z] = toW(u, v);
        addObstacle({ x, z, y: sd.y, r, height: hh });
      }
      // hut: solid 3 x 3 x 2.6 m box
      const [hutX, hutZ] = toW(sd.hut * (arm + 3.4), -L + 3.2);
      SOLIDS.push({ x: hutX, z: hutZ, y: sd.y + 1.0, hx: 1.5, hy: 1.6, hz: 1.5, c: sd.c, s: sd.s });
      // no trees on the station or apron
      for (let jj = Math.floor((sd.bz0 - Z0) / CELL); jj <= Math.ceil((sd.bz1 - Z0) / CELL); jj++)
        for (let ii = Math.floor((sd.bx0 - X0) / CELL); ii <= Math.ceil((sd.bx1 - X0) / CELL); ii++)
          if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ && deckDist(sd, X0 + ii * CELL, Z0 + jj * CELL) < sd.A + 4) LIFT_CUT[jj * NX + ii] = 1;
    }
    if (!isGondola) casters.push({ x: pts[i][0], z: pts[i][1], h: hh, w: arm + 1 });
    lampList.push((neu && isGondola ? new THREE.Vector3(GW(arm) + 1.2, 4.9, -19.6) : neu ? new THREE.Vector3(sd.hut * (arm + 3.4 - 1.6), 4.9, -7 + 3.2 - 1.6) : new THREE.Vector3(arm + 1.6, 5.6, -1.2)).applyMatrix4(m));
  }
  // cable: dense sagging path along the tower tops, with distance along it
  const path = [];
  for (let i = 0; i < N - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n = Math.max(2, Math.ceil(len / 6));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      path.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, cableAt(i, f), pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
    }
  }
  path.push([pts[N - 1][0], c[N - 1], pts[N - 1][1]]);
  const s = [0];
  for (let k = 1; k < path.length; k++) s.push(s[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][2] - path[k - 1][2]));
  const L = s[s.length - 1];
  const lp = { path, s, L, arm: st.arm, speed: st.speed, shift: 0, name: lift.name, kind: lift.kind, pts, g, stn };
  const xs = path.map((q) => q[0]), zs = path.map((q) => q[2]);
  lp.box = [Math.min(...xs) - st.arm, Math.max(...xs) + st.arm, Math.min(...zs) - st.arm, Math.max(...zs) + st.arm];
  liftPaths.push(lp);
  for (let k = 0; k < path.length - 1; k++) {
    const dx = path[k + 1][0] - path[k][0], dz = path[k + 1][2] - path[k][2], d = Math.hypot(dx, dz) || 1;
    const px = dz / d * st.arm, pz = -dx / d * st.arm;   // perpendicular: + is the up side
    for (const side of [1, -1]) cablePts.push(path[k][0] + px * side, path[k][1] + 0.1, path[k][2] + pz * side, path[k + 1][0] + px * side, path[k + 1][1] + 0.1, path[k + 1][2] + pz * side);
    // clear the forest under the line
    for (let t = 0; t < d; t += 3) {
      const x = path[k][0] + dx * t / d, z = path[k][2] + dz * t / d;
      const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL);
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = ci + a, jj = cj + b;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
        if (Math.hypot(X0 + ii * CELL - x, Z0 + jj * CELL - z) < st.arm + 6) LIFT_CUT[jj * NX + ii] = 1;
      }
    }
  }
  for (let d = 0; d < 2 * L; d += st.gap) carriers[st.carrier].push({ lp, s0: d });
}
// one mesh per lift, so the camera skips lifts out of view
LIFTS.forEach((lift, n) => {
  const parts = liftParts.slice(lift.partsFrom, n + 1 < LIFTS.length ? LIFTS[n + 1].partsFrom : liftParts.length);
  if (parts.length) scene.add(new THREE.Mesh(merge(parts), modelMat));
});
// station aprons: groomed snow, drawn just in front of the ground
if (apronGeos.length) {
  const n = apronGeos.reduce((a, g) => a + g.attributes.position.count, 0), p = new Float32Array(n * 3), cov = new Float32Array(n * 4);
  let o = 0;
  for (const g of apronGeos) { p.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
  for (let k = 0; k < n; k++) cov[k * 4] = -5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, terrainMat.uniforms, { uPFar: { value: 1e9 } }), vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
    defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  scene.add(new THREE.Mesh(geo, mat));
}
// Kicker snow and lip mats, rebuilt when the 2 m tiles under them load or drop so they sit on the snow the skier rides.
const kickSnowMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({}, terrainMat.uniforms, { uPFar: { value: 1e9 } }), vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
  defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
});
// mats drawn in front of the kicker snow
const kickMatMat = modelMat.clone();
Object.assign(kickMatMat, { uniforms: modelMat.uniforms, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
const KICK_RED = [0.78, 0.12, 0.1], KICK_WHITE = [0.95, 0.96, 1.0];
function buildKicker(k) {
  const kB = { h: 0, gx: 0, gz: 0 }, step = 0.5, side = k.hw + k.h + step, y0 = sampleBase(k.x, k.z, kB).h;
  const toW = (u, v) => [k.x + k.fx * u - k.fz * v, k.z + k.fz * u + k.fx * v];
  const ground = (u, v) => { const [x, z] = toW(u, v); return [x, sampleBase(x, z, kB).h, z]; };
  // snow grid over the footprint, unlifted cells left out
  const pos = [], us = [], vs = [];
  for (let u = 0; u < k.end + step; u += step) us.push(Math.min(u, k.end));
  for (let v = -side; v <= side + 1e-6; v += step) vs.push(v);
  const grid = vs.map((v) => us.map((u) => {
    const [x, y, z] = ground(u, v), lift = kickH(k, x, z);
    return [x - k.x, y + lift + 0.03 - y0, z - k.z, lift];
  }));
  const tri = (a, b, c) => {
    // face up
    const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
    if (uz * wx - ux * wz < 0) pos.push(...a.slice(0, 3), ...c.slice(0, 3), ...b.slice(0, 3));
    else pos.push(...a.slice(0, 3), ...b.slice(0, 3), ...c.slice(0, 3));
  };
  for (let b = 0; b < vs.length - 1; b++) for (let a = 0; a < us.length - 1; a++) {
    const p = grid[b][a], q = grid[b][a + 1], r = grid[b + 1][a + 1], t = grid[b + 1][a];
    if (p[3] <= 0 && q[3] <= 0 && r[3] <= 0 && t[3] <= 0) continue;
    tri(p, q, r); tri(p, r, t);
  }
  const n = pos.length / 3, cov = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) cov[i * 4] = -5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, kickSnowMat));
  // lip mats: red panels over the last KICK_LIP m, each with a white chevron
  const mats = [], panels = Math.max(2, Math.round(k.hw * 2 / 1.4)), pw = k.hw * 2 / panels, u0 = k.L - KICK_LIP;
  const at = (u, v, lift) => { const [x, y, z] = ground(u, v); return [x - k.x, y + k.prof(u) + lift - y0, z - k.z]; };
  const poly = (pts, col) => {
    const P = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[0], b = pts[i], c = pts[i + 1];
      const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
      P.push(...a, ...(uz * wx - ux * wz < 0 ? [...c, ...b] : [...b, ...c]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    mats.push(part(g, col));
  };
  for (let i = 0; i < panels; i++) {
    const va = -k.hw + i * pw + pw * 0.04, vb = -k.hw + (i + 1) * pw - pw * 0.04, vm = (va + vb) / 2, q = (vb - va) * 0.42;
    const U = (f) => u0 + KICK_LIP * f;
    // red panel in strips that follow the curve
    for (let s = 0; s < 4; s++) poly([at(U(s / 4), va, 0.06), at(U((s + 1) / 4), va, 0.06), at(U((s + 1) / 4), vb, 0.06), at(U(s / 4), vb, 0.06)], KICK_RED);
    // chevron arms
    for (const sgn of [-1, 1]) poly([at(U(0.35), vm + sgn * q, 0.09), at(U(0.95), vm, 0.09), at(U(0.65), vm, 0.09), at(U(0.05), vm + sgn * q, 0.09)], KICK_WHITE);
  }
  group.add(new THREE.Mesh(merge(mats), kickMatMat));
  group.position.set(k.x, y0, k.z);
  return group;
}
// 1 where 2 m tiles cover the kicker, 0 on the 10 m ground
function kickGround(k) {
  if (!PATCH || !patchOn) return 0;
  const t = { h: 0, gx: 0, gz: 0 }, s = k.hw + k.h;
  for (const [u, v] of [[0, -s], [0, s], [k.end, -s], [k.end, s], [k.end / 2, 0]]) {
    if (!samplePatch(PATCH, k.x + k.fx * u - k.fz * v, k.z + k.fz * u + k.fx * v, t)) return 0;
  }
  return 1;
}
function updateKickers() {
  for (const k of KICKERS) {
    const mode = kickGround(k);
    if (mode === k.mode) continue;
    if (k.mesh) { scene.remove(k.mesh); k.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    k.mesh = buildKicker(k); k.mode = mode;
    scene.add(k.mesh);
  }
}
// ---------- Run props: trail signs, rope lines, fence ----------
const RUNS = MAP.runs || [];
const PROPS = new Map();                       // tree page -> props, merged into that page's trees
function addProp(t) {
  const P = PAGE * CELL, key = Math.floor((t.x - X0) / P) * 1000 + Math.floor((t.z - Z0) / P);
  if (!PROPS.has(key)) PROPS.set(key, []);
  PROPS.get(key).push(t);
}
// point and direction some distance down a run
function alongRun(run, dist) {
  const p = run.points;
  let left = dist;
  for (let i = 0; i < p.length - 1; i++) {
    const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], len = Math.hypot(dx, dz) || 1;
    if (left <= len || i === p.length - 2) {
      const f = Math.min(1, left / len);
      return { x: p[i][0] + dx * f, z: p[i][1] + dz * f, ux: dx / len, uz: dz / len, end: left > len };
    }
    left -= len;
  }
}
// ---------- The runs on a 2 m grid ----------
// Every run is a 2 m height grid shaped offline from the traced outlines. Physics samples it; a fine mesh draws it,
// blending back to the 10 m mountain over BLEND m past the edge, with the 10 m ground cut away underneath.
const PCELL = 2, BLEND = 18, BERM_W = 1.6;
// 64 x 64-point tiles (128 m) only where runs reach, meshed 2 x 2 tiles at a time: 2 m cells within PATCH_NEAR,
// 4 m to PATCH_MID, 8 m to PATCH_FAR, then the 10 m ground draws the runs. Physics always uses the 2 m grid.
const TILE_BITS = 6, TILE = 1 << TILE_BITS, TT = TILE * TILE, MESH_TILES = 2, PATCH_NEAR = 250, PATCH_MID = 400, PATCH_FAR = 800;
const PATCH_STEP = [1, 2, 4];    // cell size per level, in 2 m points
const PATCH_AHEAD = 120;         // m: meshes are built this far ahead of where they show
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// the 10 m mesh's own surface: the same two triangles per cell buildChunk draws
function meshY(x, z) {
  const fx = clamp((x - X0) / CELL, 0, NX - 1.001), fz = clamp((z - Z0) / CELL, 0, NZ - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const h00 = gridH(i, j), h10 = gridH(i + 1, j), h01 = gridH(i, j + 1), h11 = gridH(i + 1, j + 1);
  if ((i + j) & 1) return tx + tz <= 1 ? h00 + tx * (h10 - h00) + tz * (h01 - h00) : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  return tx >= tz ? h00 + tx * (h10 - h00) + tz * (h11 - h10) : h00 + tz * (h01 - h00) + tx * (h11 - h01);
}
// runs.js: index, edge trees, stand-in blocks and two 10 m fields. runs/<ca>_<cj>.json: 4 x 4 tiles each, streamed by
// distance, holding per point the height change from the 10 m surface (mm, row deltas) and int8 distances to the
// groomed edge and any run's edge. Physics heights rebuild on load; mesh heights and blend weights per tile on demand.
const RUN_LOAD = 1200, RUN_DROP = 1700;          // m: load nearer than this, drop farther than that
let runStream = null;
if (RUN_DATA) {
  const B = RUN_DATA, x0 = B.x0, z0 = B.z0, tx = B.nx / TILE, tz = B.nz / TILE, CH = B.chunk, step = B.edge_step;
  const P = { x0, z0, cell: PCELL, nx: B.nx, nz: B.nz, key: 'runs', tiles: [], baked: true, nodes: B.tiles.length / 2 * TT };
  // a grid point's slot in the loaded tiles, or -1
  const tileOf = new Int32Array(tx * tz).fill(-1);
  P.at = (a, j) => {
    if (a < 0 || j < 0 || a >= P.nx || j >= P.nz) return -1;
    const t = tileOf[(j >> TILE_BITS) * tx + (a >> TILE_BITS)];
    return t < 0 ? -1 : t * TT + ((j & (TILE - 1)) << TILE_BITS) + (a & (TILE - 1));
  };
  // tile slots, grown as needed
  let cap = 0;
  const free = [], slotTile = [];
  const grow = (n) => {
    const fit = (A, T) => { const b = new T(n * TT); if (A) b.set(A); return b; };
    P.hp = fit(P.hp, Float32Array); P.edge = fit(P.edge, Float32Array); P.aedge = fit(P.aedge, Int8Array);
    P.hr = fit(P.hr, Float32Array); P.wmin = fit(P.wmin, Float32Array);
    const d = new Uint8Array(n); if (P.done) d.set(P.done); P.done = d;
    for (let t = n - 1; t >= cap; t--) free.push(t);
    cap = n;
  };
  grow(64);
  // mesh heights and blend weights: shaped snow near runs, the 10 m mesh where blended back
  const base = { h: 0, gx: 0, gz: 0 };
  const fill = (t) => {
    if (P.done[t]) return;
    P.done[t] = 1;
    const tl = slotTile[t];
    for (let q = 0; q < TT; q++) {
      const c = t * TT + q, x = x0 + (tl.a0 + (q & (TILE - 1))) * PCELL, z = z0 + (tl.j0 + (q >> TILE_BITS)) * PCELL;
      const w = smoothstep(BERM_W, BLEND, P.aedge[c] * step);
      P.wmin[c] = w;
      P.hr[c] = P.hp[c] + w * (meshY(x, z) - sampleGrid(H, NX, NZ, X0, Z0, CELL, x, z, base).h);
    }
  };
  // a group's tiles and their neighbors (skirts read one point past the border)
  P.ready = (g) => {
    for (const tl of g.tiles) for (let dj = -1; dj <= 1; dj++) for (let da = -1; da <= 1; da++) {
      const c = P.at(tl.a0 + da * TILE, tl.j0 + dj * TILE);
      if (c >= 0) fill((c / TT) | 0);
    }
  };
  // files, and the 2 x 2 tile groups meshes are built for
  const chunks = new Map(), side = TILE * CH * PCELL;
  for (const [ca, cj] of B.chunks) {
    chunks.set(ca * 1000 + cj, { ca, cj, x0: x0 + ca * side, z0: z0 + cj * side, x1: x0 + (ca + 1) * side, z1: z0 + (cj + 1) * side, state: 0, tiles: [], groups: [] });
  }
  const around = (ch) => {
    const out = [];
    for (let dj = -1; dj <= 1; dj++) for (let da = -1; da <= 1; da++) if (da || dj) out.push(chunks.get((ch.ca + da) * 1000 + ch.cj + dj));
    return out;
  };
  // edge cells read the next tile, so a group builds once its file and its neighbors are in
  const inAround = (ch) => ch.state === 2 && around(ch).every((n) => !n || n.state === 2);
  P.groupOk = (g) => inAround(g.chunk);
  const groups = new Map();
  for (let k = 0; k < B.tiles.length; k += 2) {
    const tl = { a0: B.tiles[k], j0: B.tiles[k + 1] };
    P.tiles.push(tl);
    const ga = Math.floor(tl.a0 / (TILE * MESH_TILES)), gj = Math.floor(tl.j0 / (TILE * MESH_TILES));
    if (!groups.has(ga * 10000 + gj)) {
      const a0 = ga * TILE * MESH_TILES, j0 = gj * TILE * MESH_TILES, gs = TILE * MESH_TILES * PCELL;
      const chunk = chunks.get(Math.floor(tl.a0 / (TILE * CH)) * 1000 + Math.floor(tl.j0 / (TILE * CH)));
      const g = { tiles: [], a0, j0, x0: x0 + a0 * PCELL, z0: z0 + j0 * PCELL, x1: x0 + a0 * PCELL + gs, z1: z0 + j0 * PCELL + gs, meshes: [null, null, null], level: -1, chunk };
      groups.set(ga * 10000 + gj, g);
      chunk.groups.push(g);
    }
    groups.get(ga * 10000 + gj).tiles.push(tl);
  }
  P.groups = [...groups.values()];
  const dropMeshes = (g) => {
    for (let l = 0; l < g.meshes.length; l++) if (g.meshes[l]) { scene.remove(g.meshes[l]); g.meshes[l].geometry.dispose(); g.meshes[l] = null; }
    g.level = -1;
  };
  // The 10 m ground is cut away in 4 m blocks the fine mesh fully covers.
  const mw = P.nx / 2, mh = P.nz / 2, mask = new Uint8Array(mw * mh);
  const tex = new THREE.DataTexture(mask, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  const covered = (a, j) => { const c = P.at(a, j); return c >= 0 && P.aedge[c] * step < BLEND; };
  // only the changed rows are uploaded once the texture is on the GPU (the whole mask is about 8 MB)
  const uploadMask = (r0, r1) => {
    const gl = renderer.getContext(), tp = renderer.properties.get(tex);
    if (!tp.__webglTexture || tp.__version !== tex.version) { tex.needsUpdate = true; return; }
    renderer.state.bindTexture(gl.TEXTURE_2D, tp.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, mw, r1 - r0, gl.RED, gl.UNSIGNED_BYTE, mask, r0 * mw);
  };
  const maskTiles = (list) => {
    if (!list.length) return;
    let r0 = mh, r1 = 0;
    for (const tl of list) {
      r0 = Math.min(r0, tl.j0 / 2); r1 = Math.max(r1, (tl.j0 + TILE) / 2);
      for (let bj = tl.j0 / 2; bj < (tl.j0 + TILE) / 2; bj++) {
        for (let bi = tl.a0 / 2; bi < (tl.a0 + TILE) / 2; bi++) {
          let all = true;
          for (let j = 2 * bj; j <= 2 * bj + 2 && all; j++) for (let a = 2 * bi; a <= 2 * bi + 2 && all; a++) all = covered(a, j);
          mask[bj * mw + bi] = all ? 255 : 0;
        }
      }
    }
    uploadMask(r0, Math.min(r1, mh));
  };
  const crw = (t, w, o) => {
    const t2 = t * t, t3 = t2 * t;
    w[o] = 0.5 * (-t + 2 * t2 - t3); w[o + 1] = 0.5 * (2 - 5 * t2 + 3 * t3); w[o + 2] = 0.5 * (t + 4 * t2 - 3 * t3); w[o + 3] = 0.5 * (t3 - t2);
  };
  const wx = new Float32Array(TILE * 4), ix = new Int32Array(TILE), wz = new Float32Array(4);
  async function loadChunk(ch) {
    ch.state = 1;
    let J, bytes;
    try {
      J = await (await fetch(new URL(`runs/${ch.ca}_${ch.cj}.json`, document.baseURI))).json();
      bytes = await inflate(J.data);
    } catch (e) { console.warn('Golden Ski: run tiles failed to load', ch.ca, ch.cj, e); ch.state = 0; return; }
    if (ch.state !== 1) return;                     // dropped while loading
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), n = J.tiles.length / 2, N = n * TT;
    const dh = new Int16Array(buf, 0, N), e8 = new Int8Array(buf, N * 2, N), a8 = new Int8Array(buf, N * 3, N);
    if (free.length < n) grow(cap + Math.max(n, 64));
    for (let k = 0; k < n; k++) {
      const tl = { a0: J.tiles[2 * k], j0: J.tiles[2 * k + 1] }, t = free.pop();
      tl.slot = t; slotTile[t] = tl; ch.tiles.push(tl); P.done[t] = 0;
      // sampleGrid's surface at the tile's points, column weights once per tile
      for (let a = 0; a < TILE; a++) {
        const f = clamp((x0 + (tl.a0 + a) * PCELL - X0) / CELL, 0, NX - 1.001), i = Math.floor(f);
        ix[a] = i; crw(f - i, wx, a * 4);
      }
      for (let j = 0; j < TILE; j++) {
        const f = clamp((z0 + (tl.j0 + j) * PCELL - Z0) / CELL, 0, NZ - 1.001), jj = Math.floor(f);
        crw(f - jj, wz, 0);
        const o = k * TT + j * TILE, oo = t * TT + j * TILE;
        let q = 0;
        for (let a = 0; a < TILE; a++) {
          let h = 0;
          for (let m = 0; m < 4; m++) {
            const row = clamp(jj - 1 + m, 0, NZ - 1) * NX, i = ix[a];
            h += wz[m] * (wx[a * 4] * H[row + clamp(i - 1, 0, NX - 1)] + wx[a * 4 + 1] * H[row + clamp(i, 0, NX - 1)]
              + wx[a * 4 + 2] * H[row + clamp(i + 1, 0, NX - 1)] + wx[a * 4 + 3] * H[row + clamp(i + 2, 0, NX - 1)]);
          }
          q += dh[o + a];
          P.hp[oo + a] = h + q / 1000;
          P.edge[oo + a] = e8[o + a] * step;
          P.aedge[oo + a] = a8[o + a];
        }
      }
      tileOf[(tl.j0 >> TILE_BITS) * tx + (tl.a0 >> TILE_BITS)] = t;
    }
    ch.state = 2;
    const near = around(ch).filter((c) => c && c.state === 2);
    maskTiles([ch, ...near].flatMap((c) => c.tiles));
    // neighbor meshes were built without these edge points: rebuild them
    for (const c of near) for (const g of c.groups) dropMeshes(g);
  }
  function unloadChunk(ch) {
    for (const g of ch.groups) dropMeshes(g);
    for (const tl of ch.tiles) { tileOf[(tl.j0 >> TILE_BITS) * tx + (tl.a0 >> TILE_BITS)] = -1; free.push(tl.slot); }
    const was = ch.state === 2, old = ch.tiles;
    ch.state = 0; ch.tiles = [];
    if (was) maskTiles([...old, ...around(ch).filter((c) => c && c.state === 2).flatMap((c) => c.tiles)]);
  }
  const dist = (ch, x, z) => Math.hypot(Math.max(ch.x0 - x, 0, x - ch.x1), Math.max(ch.z0 - z, 0, z - ch.z1));
  let at = null;
  runStream = (x, z, force) => {
    if (!force && at && Math.hypot(x - at.x, z - at.z) < 40) return [];
    at = { x, z };
    const loads = [];
    for (const ch of chunks.values()) {
      const d = dist(ch, x, z);
      if (d < RUN_LOAD && ch.state === 0) loads.push(loadChunk(ch));
      else if (d > RUN_DROP && ch.state === 2) unloadChunk(ch);
      else if (d > RUN_DROP && ch.state === 1) ch.state = 0;
    }
    return loads;
  };
  P.mat = new THREE.ShaderMaterial({
    uniforms: terrainMat.uniforms, vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
    defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  terrainMat.uniforms.uPMask.value = tex;
  terrainMat.uniforms.uPMin.value.set(x0, z0);
  terrainMat.uniforms.uPSize.value.set(mw * 2 * PCELL, mh * 2 * PCELL);
  terrainMat.uniforms.uPFar.value = PATCH_FAR;
  terrainMat.uniforms.uPOn.value = 1;
  PATCH = P;
  // the 10 m ground draws the same groomed edges where no tiles are loaded
  const [runfB, areaB, treeB] = await Promise.all([inflate(B.runf), inflate(B.area), inflate(B.trees)]);
  for (let k = 0; k < RUNF.length; k++) { RUNF[k] = (runfB[k] << 24) >> 24; POWDER[k] = RUNF[k] < 0 ? 0 : 1; }
  // Run area (the generated forest keeps clear) and the real edge and island trees from the 1 m canopy map.
  // The packed fill (kind + 128) draws only within FILL_NEAR; every tree is solid.
  RUN_AREA = new Int8Array(areaB.buffer, areaB.byteOffset, areaB.length);
  const dv = new DataView(treeB.buffer, treeB.byteOffset, treeB.length);
  for (let n = 0; n < B.ntrees; n++) {
    const o = n * 8, x = dv.getInt16(o, true) / 2, z = dv.getInt16(o + 2, true) / 2, height = dv.getUint8(o + 4) / 10, kind = dv.getUint8(o + 5) & 127;
    const ground = STATIONS.length && stationAt(x, z) ? groundY(x, z) : dv.getUint16(o + 6, true) / 10;
    const t = { x, z, y: ground - (kind === KIND.snowghost ? 0.5 : 0.3), height, r: TREE_R[kind] * height, kind, fill: dv.getUint8(o + 5) >> 7 };
    addProp(t);
    addObstacle(t);
  }
  // Stand-in blocks on building footprints until real buildings exist; skipped where they overlap a station or solid.
  const parts = [];
  for (const [x, z, w, l, yawD, h, y0, y1] of B.blocks) {
    if (nearSolid(x, z, Math.max(w, l) / 2) || (STATIONS.length && stationAt(x, z))) continue;
    const yaw = yawD * Math.PI / 180, bot = y0 - 1, top = y1 + h;
    parts.push(part(new THREE.BoxGeometry(w, top - bot, l).translate(0, (top - bot) / 2, 0), CONC, placeM(x, bot, z, yaw)));
    SOLIDS.push({ x, z, y: (bot + top) / 2, hx: w / 2, hy: (top - bot) / 2, hz: l / 2, c: Math.cos(yaw), s: Math.sin(yaw) });
  }
  if (parts.length) scene.add(new THREE.Mesh(merge(parts), modelMat));
}
function buildGroupMesh(P, g, level) {
  if (P.ready) P.ready(g);
  const s = PATCH_STEP[level], side = TILE * MESH_TILES, { hr, edge, wmin } = P;
  const vert = new Map(), pos = [], cov = [], nrm = [], idx = [];
  const h = (a, j) => { const c = P.at(a, j); return c < 0 ? null : hr[c]; };
  const v = (a, j, drop) => {
    const key = (j * P.nx + a) * 3 + (drop === undefined ? 0 : drop ? 2 : 1);   // surface, skirt top, skirt foot
    let n = vert.get(key);
    if (n === undefined) {
      const c = P.at(a, j), x = P.x0 + a * PCELL, z = P.z0 + j * PCELL, k = cellAt(x, z);
      n = pos.length / 3;
      vert.set(key, n);
      pos.push(x, hr[c] - (drop ? 1.5 * s : 0), z);
      cov.push(edge[c], isRock(k) && edge[c] > 3 ? 1 : 0, conifer(k), aspen(k));
      if (drop === undefined) nrm.push(0, 0, 0);
      else {
        // skirt normals match the run beside them
        const hl = h(a - 1, j) ?? hr[c], hx = h(a + 1, j) ?? hr[c], hu = h(a, j - 1) ?? hr[c], hd = h(a, j + 1) ?? hr[c];
        nrm.push(-(hx - hl) / (2 * PCELL), 1, -(hd - hu) / (2 * PCELL));
      }
    }
    return n;
  };
  const skirt = (a1, j1, a2, j2) => {
    const p = v(a1, j1, false), q = v(a2, j2, false), p2 = v(a1, j1, true), q2 = v(a2, j2, true);
    idx.push(p, p2, q, q, p2, q2, p, q, p2, q, q2, p2);   // both windings
  };
  for (const tl of g.tiles) {
    for (let j = tl.j0; j < tl.j0 + TILE; j += s) {
      for (let a = tl.a0; a < tl.a0 + TILE; a += s) {
        let any = false, ok = true;
        for (let jj = j; jj <= j + s && ok; jj++) for (let aa = a; aa <= a + s && ok; aa++) {
          const c = P.at(aa, jj);
          if (c < 0) ok = false; else if (wmin[c] < 1) any = true;
        }
        if (!ok || !any) continue;
        const k00 = v(a, j), k10 = v(a + s, j), k01 = v(a, j + s), k11 = v(a + s, j + s);
        if (((a + j) / s) & 1) idx.push(k00, k01, k10, k10, k01, k11);
        else idx.push(k00, k01, k11, k00, k11, k10);
        if (a === g.a0) skirt(a, j, a, j + s);
        if (a + s === g.a0 + side) skirt(a + s, j, a + s, j + s);
        if (j === g.j0) skirt(a, j, a + s, j);
        if (j + s === g.j0 + side) skirt(a, j + s, a + s, j + s);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(new Float32Array(cov), 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, P.mat);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.userData.tris = idx.length / 3;
  scene.add(mesh);
  return mesh;
}
// signed m to the nearest groomed edge on the 2 m tiles, undefined elsewhere
function patchEdge(x, z) {
  const P = PATCH;
  if (!patchOn || !P) return undefined;
  const fx = (x - P.x0) / PCELL, fz = (z - P.z0) / PCELL, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const c00 = P.at(i, j), c10 = P.at(i + 1, j), c01 = P.at(i, j + 1), c11 = P.at(i + 1, j + 1), E = P.edge;
  if (c00 < 0 || c10 < 0 || c01 < 0 || c11 < 0) return undefined;
  return (E[c00] * (1 - tx) + E[c10] * tx) * (1 - tz) + (E[c01] * (1 - tx) + E[c11] * tx) * tz;
}
// Levels by distance (none past PATCH_FAR, where the shaders cut). The level a group will need PATCH_AHEAD m sooner
// is built in the work queue; one that has nothing showing yet builds at once. Finer meshes are freed once well away.
const patchLevel = (d) => d >= PATCH_FAR ? -1 : d < PATCH_NEAR ? 0 : d < PATCH_MID ? 1 : 2;
function updatePatch() {
  if (!PATCH) return;
  const cx = camera.position.x, cz = camera.position.z;
  if (runStream) runStream(cx, cz);
  for (const g of PATCH.groups) {
    const d = Math.hypot(Math.max(g.x0 - cx, 0, cx - g.x1), Math.max(g.z0 - cz, 0, cz - g.z1));
    const off = !patchOn || (PATCH.groupOk && !PATCH.groupOk(g));
    const level = off ? -1 : patchLevel(d), ahead = off ? -1 : patchLevel(Math.max(0, d - PATCH_AHEAD));
    if (ahead >= 0 && ahead !== level && !g.meshes[ahead] && !workAll) {
      queueWork(workKey(g, ahead), d, () => { if (!g.meshes[ahead] && PATCH.groupOk(g)) g.meshes[ahead] = buildGroupMesh(PATCH, g, ahead); });
    }
    if (level === g.level) continue;
    if (level >= 0 && !g.meshes[level]) {
      if (g.level >= 0 && !workAll) {
        queueWork(workKey(g, level), d, () => { if (!g.meshes[level] && PATCH.groupOk(g)) g.meshes[level] = buildGroupMesh(PATCH, g, level); });
        continue;
      }
      g.meshes[level] = buildGroupMesh(PATCH, g, level);
    }
    g.meshes.forEach((m, l) => { if (m) m.visible = l === level; });
    for (let l = 0; l < g.meshes.length; l++) {
      if (g.meshes[l] && (level < 0 ? l < 2 : l < level - 1)) { scene.remove(g.meshes[l]); g.meshes[l].geometry.dispose(); g.meshes[l] = null; }
    }
    g.level = level;
  }
}
function setPatch(on) {
  patchOn = on;
  updatePatch();
  terrainMat.uniforms.uPOn.value = on && PATCH ? 1 : 0;
}
const onGroomed = (x, z) => { const e = patchEdge(x, z); return e === undefined ? RUNF[cellAt(x, z)] < 0 : e < 0; };
// Sign boards on one canvas: difficulty symbol on a light patch, name on dark wood. Boards grow to fit the name
// up to SIGN_MAX px; only longer names shrink.
const SIGN_W = 256, SIGN_H = 32, SIGN_COLS = 4, SIGN_MIN = 120, SIGN_MAX = 181, SIGN_M = 0.6 / SIGN_H;   // m per px
const SIGNS = (RUN_DATA && RUN_DATA.signs) || [];
const signCanvas = document.createElement('canvas');
signCanvas.width = SIGN_W * SIGN_COLS; signCanvas.height = SIGN_H * Math.max(1, Math.ceil(SIGNS.length / SIGN_COLS));
const signPx = [];                             // board length in px
{
  const g = signCanvas.getContext('2d'), P = SIGN_H, pad = 3;
  SIGNS.forEach(([name, diff], n) => {
    const x = (n % SIGN_COLS) * SIGN_W, y = Math.floor(n / SIGN_COLS) * SIGN_H;
    let size = 20;
    do { g.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`; size--; } while (g.measureText(name).width > SIGN_MAX - P - 14 && size > 8);
    const w = clamp(Math.ceil(P + 6 + g.measureText(name).width + 8), SIGN_MIN, SIGN_MAX);
    signPx.push(w);
    g.fillStyle = '#3b2717'; g.fillRect(x, y, w, SIGN_H);
    g.fillStyle = '#5a3b22'; g.fillRect(x, y + SIGN_H / 2 - 1, w, 2);
    g.strokeStyle = '#1c120a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, SIGN_H - 2);
    g.fillStyle = '#f1e6c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, x + P + 3 + (w - P - 3) / 2, y + SIGN_H / 2 + 1);
    const cx = x + P / 2 + 1, cy = y + SIGN_H / 2;
    g.fillStyle = '#f1e6c8'; g.fillRect(x + pad + 1, y + pad, P - 2 * pad, SIGN_H - 2 * pad);
    const diamond = (dx, r) => { g.beginPath(); g.moveTo(cx + dx, cy - r); g.lineTo(cx + dx + r, cy); g.lineTo(cx + dx, cy + r); g.lineTo(cx + dx - r, cy); g.closePath(); g.fill(); };
    if (diff === 'green') { g.fillStyle = '#1f8a3a'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill(); }
    else if (diff === 'blue') { g.fillStyle = '#1b55b5'; g.fillRect(cx - 8.5, cy - 8.5, 17, 17); }
    else if (diff === 'black') { g.fillStyle = '#111111'; diamond(0, 10); }
    else if (diff === 'expert') { g.fillStyle = '#111111'; diamond(-6, 6); diamond(6, 6); }
  });
}
const signTex = new THREE.CanvasTexture(signCanvas);
signTex.magFilter = THREE.NearestFilter; signTex.minFilter = THREE.LinearMipmapLinearFilter;
signTex.colorSpace = THREE.NoColorSpace;
const signMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uMap: { value: signTex } }, LIGHT),
  vertexShader: /* glsl */ `
    attribute vec3 aNrm;
    varying vec2 vUv; varying vec3 vP; varying float vD; varying vec3 vNrm;
    void main() {
      vUv = uv; vNrm = aNrm;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vP = w.xyz;
      vec4 mv = viewMatrix * w;
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uMap;
    varying vec2 vUv; varying vec3 vP; varying float vD; varying vec3 vNrm;
    void main() {
      vec3 n = normalize(vNrm), alb = texture2D(uMap, vUv).rgb;
      float lit = 1.0 - shade(vP) * 0.8;
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * lit + uSky * (0.45 + 0.35 * n.y) + uBounce * 0.35 + lamps(vP, n) * 1.2 + 0.05;
      gl_FragColor = vec4(finish(alb, l, vD, 1.25), 1.0);
    }`,
});
const WOOD = [0.36, 0.25, 0.15], WOOD_DARK = [0.24, 0.16, 0.1];
const runParts = [], facePos = [], faceUv = [], faceNrm = [], signSpots = [];
// each name's highest mapped line piece (for starts)
const signRuns = new Map();
for (const r of RUNS) {
  if (!r.name || r.area || r.points.length < 2) continue;
  const h = groundY(r.points[0][0], r.points[0][1]), best = signRuns.get(r.name);
  if (!best || h > best.h) signRuns.set(r.name, { run: r, h });
}
// Signs stand where each run begins (runs-build/scripts/signs.py), facing arriving skiers,
// at the first candidate spot clear of huts and stand-in blocks.
SIGNS.forEach(([name, , spots], n) => {
  const spot = spots.find(([x, z]) => !nearSolid(x, z, 1.5));
  if (!spot) return;
  const [x, z, yawD, gy] = spot, yaw = yawD * Math.PI / 180;
  const y = STATIONS.length && stationAt(x, z) ? groundY(x, z) : gy;
  const w = signPx[n] * SIGN_M, post = w / 2 - 0.25;
  signSpots.push({ x, z, name, yaw });
  const m = placeM(x, y - 0.3, z, yaw);
  runParts.push(...placed([
    // posts behind the board
    part(new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(-post, 1.15, -0.12), WOOD_DARK),
    part(new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(post, 1.15, -0.12), WOOD_DARK),
    part(new THREE.BoxGeometry(w + 0.1, 0.68, 0.08).translate(0, 1.95, 0), WOOD),
  ], m));
  const u0 = (n % SIGN_COLS) * SIGN_W / signCanvas.width, u1 = u0 + signPx[n] / signCanvas.width;
  const v1 = 1 - Math.floor(n / SIGN_COLS) * SIGN_H / signCanvas.height, v0 = v1 - SIGN_H / signCanvas.height;
  const face = new THREE.PlaneGeometry(w, 0.6).translate(0, 1.95, 0.05).applyMatrix4(m);
  const fp = face.attributes.position, fuv = [[u0, v1], [u1, v1], [u0, v0], [u1, v0]], nrm = [Math.sin(yaw), 0, Math.cos(yaw)];
  for (const idx of face.index.array) {
    facePos.push(fp.getX(idx), fp.getY(idx), fp.getZ(idx));
    faceUv.push(...fuv[idx]);
    faceNrm.push(...nrm);
  }
  casters.push({ x, z, h: 2.3, w: w / 2 });
});
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(facePos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(faceUv), 2));
  g.setAttribute('aNrm', new THREE.BufferAttribute(new Float32Array(faceNrm), 3));
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, signMat));
}
// rope lines down both edges of the first 170 m of Sunnyside and Max Park (runs-build/ropes.json)
const ropePts = [];
for (const line of (RUN_DATA && RUN_DATA.ropes) || []) {
  for (let k = 0; k < line.length; k += 3) {
    const [x, z, y] = [line[k], line[k + 1], line[k + 2]];
    addProp({ x, z, y: y - 0.15, height: 1.7, r: 0, kind: KIND.pole });
    if (k) ropePts.push(line[k - 3], line[k - 1] + 1.25, line[k - 2], x, y + 1.25, z);
  }
}
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ropePts), 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8261c })));
}
// rail fence behind the Village Express top terminal
{
  const ve = LIFTS.find((l) => l.name === 'Village Express');
  if (ve) {
    const p = ve.points, a = p[p.length - 2], b = p[p.length - 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const cx = b[0] + ux * 16, cz = b[1] + uz * 16;
    let last = null;
    for (let s = -18; s <= 18; s += 3) {
      const x = cx + uz * s, z = cz - ux * s, y = groundY(x, z) - 0.2;
      runParts.push(part(new THREE.BoxGeometry(0.18, 1.3, 0.18).translate(0, 0.65, 0), WOOD_DARK, new THREE.Matrix4().setPosition(x, y, z)));
      if (last) {
        const mx = (x + last[0]) / 2, mz = (z + last[2]) / 2, my = (y + last[1]) / 2, l = Math.hypot(x - last[0], z - last[2]);
        const tilt = Math.atan2(y - last[1], l), yaw = Math.atan2(x - last[0], z - last[2]);
        for (const h of [0.55, 1.05]) {
          const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(-tilt)).setPosition(mx, my + h, mz);
          runParts.push(part(new THREE.BoxGeometry(0.1, 0.12, l + 0.2), WOOD, m));
        }
      }
      last = [x, y, z];
      casters.push({ x, z, h: 1.3, w: 0.2 });
    }
  }
}
if (runParts.length) scene.add(new THREE.Mesh(merge(runParts), modelMat));
// FreePlay starts a little way down Sunnyside from the Village Express top. The Tab menu moves the start to any lift top or bottom.
const STARTS = [];
{
  const run = signRuns.get('Sunnyside')?.run;
  if (run) {
    const p = alongRun(run, 3), q = alongRun(run, 45);
    Object.assign(META.start, { x: p.x, z: p.z, heading: Math.atan2(q.x - p.x, -(q.z - p.z)), name: 'Village Express, top' });
  }
}
// run tiles around the start before the first frame
if (runStream) await Promise.all(runStream(META.start.x, META.start.z, true));
// every lift top: a little way down the groomed run leaving it, else beside the terminal facing down the fall line
const fallAt = (x, z, r) => {
  let gx = 0, gz = 0;
  for (let k = 0; k < 8; k++) { const s = sample(x + r * Math.cos(k * Math.PI / 4), z + r * Math.sin(k * Math.PI / 4)); gx += s.gx / 8; gz += s.gz / 8; }
  return { gx, gz, slope: Math.hypot(gx, gz) };
};
// run line from the top down, as [x, z, distance]
function downLine(run) {
  let p = run.points;
  if (groundY(...p[0]) < groundY(...p[p.length - 1])) p = p.slice().reverse();
  let s = 0;
  return p.map((q, i) => [q[0], q[1], i ? (s += Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1])) : 0]);
}
const lineAt = (L, s) => {
  for (let i = 1; i < L.length; i++) if (L[i][2] >= s) { const f = (s - L[i - 1][2]) / ((L[i][2] - L[i - 1][2]) || 1); return [L[i - 1][0] + (L[i][0] - L[i - 1][0]) * f, L[i - 1][1] + (L[i][1] - L[i - 1][1]) * f]; }
  return L[L.length - 1];
};
for (const lift of [...LIFTS].sort((a, b) => a.name.localeCompare(b.name))) {
  const p = lift.points, up = p[0][2] > p[p.length - 1][2], top = up ? p[0] : p[p.length - 1], prev = up ? p[1] : p[p.length - 2];
  let run = null;
  for (const r of RUNS) {
    if (r.area || r.kind !== 'groomed' || r.points.length < 2) continue;
    const L = downLine(r);
    if (L[L.length - 1][2] < 80) continue;
    let best = 1e9, s0 = 0;
    for (const q of L) { const d = Math.hypot(q[0] - top[0], q[1] - top[1]); if (d < best) { best = d; s0 = q[2]; } }
    // the run that starts nearest the top
    if (best < 70 && s0 < 120 && (!run || best < run.best)) run = { L, s0, best };
  }
  if (run) {
    let o = 12;                                     // clear of station buildings
    while (o < 120 && nearSolid(...lineAt(run.L, run.s0 + o), 5)) o += 6;
    const a = lineAt(run.L, run.s0 + o), b = lineAt(run.L, run.s0 + o + 33);
    STARTS.push({ label: `Start: ${lift.name} top`, x: a[0], z: a[1], heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])) });
  } else besideTerminal(top, prev, `Start: ${lift.name} top`);
  // and beside the bottom terminal
  besideTerminal(up ? p[p.length - 1] : p[0], up ? p[p.length - 2] : p[1], `Start: ${lift.name} bottom`);
}
// beside a terminal (end, prev = next lift point) where the snow falls away most; clear of buildings,
// not facing the terminal or the forest
function besideTerminal(end, prev, label) {
  const d = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1, ux = (end[0] - prev[0]) / d, uz = (end[1] - prev[1]) / d;
  let pick = null;
  for (const side of [1, -1]) for (const along of [-10, 5, 20]) for (const lat of [25, 40]) {
    const x = end[0] + ux * along - uz * lat * side, z = end[1] + uz * along + ux * lat * side;
    if (offMap(x, z) || nearSolid(x, z, 5)) continue;
    const f = fallAt(x, z, 10), k = cellAt(x, z), tx = end[0] - x, tz = end[1] - z, tl = Math.hypot(tx, tz);
    if ((-f.gx * tx - f.gz * tz) / (f.slope * tl || 1) > 0.7) continue;     // not facing the terminal
    let ahead = 0;                                                         // or the forest
    for (let m = 15; m <= 75; m += 15) { const q = cellAt(x - f.gx / (f.slope || 1) * m, z - f.gz / (f.slope || 1) * m); ahead += (conifer(q) + aspen(q)) / 5; }
    const score = f.slope + (onGroomed(x, z) ? 0.15 : 0) - (conifer(k) + aspen(k)) * 0.5 - ahead * 0.5;
    if (!pick || score > pick.score) pick = { x, z, f, score };
  }
  if (pick) STARTS.push({ label, x: pick.x, z: pick.z, heading: Math.atan2(-pick.f.gx, pick.f.gz) });
}

// ---------- The lift ride ----------
// A ring of light on every chairlift's loading deck: ski in, fade, ride a chair up at the lift's real speed, fade,
// stand on the unload deck. Tap or Space skips to the last fade. The Tab menu's lift-top starts use the same spot.
const RING_R = 2.5, LOAD = 4.5;      // m across the ring / 2; m from the wheel to load and unload
const RIDES = [];
for (const lp of liftPaths) {
  if (lp.kind !== 'chair_lift') continue;
  const N = lp.pts.length, b = lp.g[0] <= lp.g[N - 1] ? 0 : N - 1, t = N - 1 - b;
  const sb = lp.stn[b], st = lp.stn[t];
  if (!sb || !st) continue;
  // uphill along the line at each end; loaded chairs ride on its right
  const along = (i, j) => { const dx = lp.pts[j][0] - lp.pts[i][0], dz = lp.pts[j][1] - lp.pts[i][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const [bx, bz] = along(b, b ? b - 1 : 1), [tx, tz] = along(t ? t - 1 : 1, t);
  const ring = { x: sb.x + bx * LOAD + bz * lp.arm, z: sb.z + bz * LOAD - bx * lp.arm, y: sb.y };
  const top = { x: st.x - tx * LOAD + tz * lp.arm, z: st.z - tz * LOAD - tx * lp.arm };
  // off the chair she faces down the run
  const old = STARTS.find((q) => q.label === `Start: ${lp.name} top`);
  top.heading = old ? Math.atan2(old.x - top.x, -(old.z - top.z)) : Math.atan2(tx, -tz);
  if (old) Object.assign(old, top);
  // the ride in carrier distance: load spot to unload spot
  const d0 = (b ? lp.L : 0) + LOAD, d1 = (b ? lp.L : 0) + lp.L - LOAD;
  RIDES.push({ lp, ring, top, d0, d1, chair: carriers.chair.find((c) => c.lp === lp) });
}
// ring: green wisps around a soft cyan glow on the deck
const ringMat = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  transparent: true, depthWrite: false,
  vertexShader: `
    varying vec2 vP;
    void main() { vP = (uv - 0.5) * ${((RING_R + 0.8) * 2).toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float time;
    varying vec2 vP;
    void main() {
      float r = length(vP), a = atan(vP.y, vP.x), R = ${RING_R.toFixed(1)};
      // the soft cyan band, in patches that drift round
      float glow = exp(-pow((r - R) / 0.42, 2.0)) * (0.6 + 0.4 * sin(a * 3.0 + time * 0.7) * sin(a * 5.0 - time * 0.4));
      // green strands twisting round each other across it
      float w = 0.0;
      for (int k = 0; k < 9; k++) {
        float fk = float(k);
        float off = R + 0.26 * sin(a * (2.0 + fk) + time * (0.5 + 0.2 * fk) + fk * 1.7) + 0.08 * sin(a * (7.0 + 2.0 * fk) - time * 1.3);
        w += exp(-pow((r - off) / 0.05, 2.0)) * (0.55 + 0.45 * sin(a * (4.0 + fk) - time * (1.0 + 0.3 * fk)));
      }
      w = min(w, 1.0);
      vec3 col = mix(vec3(0.0, 0.78, 0.92), vec3(0.15, 0.95, 0.3), w);
      col = mix(col, vec3(0.8, 1.0, 0.8), w * w * 0.5);
      float alpha = clamp(glow * 0.85 + w, 0.0, 1.0);
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(col, alpha);
    }`,
});
for (const R of RIDES) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry((RING_R + 0.8) * 2, (RING_R + 0.8) * 2).rotateX(-Math.PI / 2), ringMat);
  m.position.set(R.ring.x, R.ring.y + 0.12, R.ring.z);
  m.renderOrder = 2;
  scene.add(m);
}
const ride = { lp: null, chair: null, d: 0, t: 0, R: null };

// Physics lab start: Powderhorn
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cablePts), 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a1c24 }));
  lines.frustumCulled = false;
  scene.add(lines);
}
// carriers: chairs, cabins and T-bar hangers, one instanced mesh each, hanging below the cable
// square tube from a to b, for the chair frame
function tube(a, b, r, col) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const g = new THREE.BoxGeometry(r, d.length(), r);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP_Y, d.clone().normalize()));
  return part(g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2), col);
}
// Detachable quad chair: grip, hanger, frame, four cushions, back, armrests, bar raised. Faces +z; cable at y = 0.
const FRAME = [0.62, 0.64, 0.68], CUSH = [0.17, 0.18, 0.21];
const CHAIR_NEAR = 200, CHAIR_FAR = 2500;           // m: full model, then plain, then none
// frame side: down from the top bar, bowing out, to the seat end and under it to the back
const chairSide = (sx) => [
  tube([sx * 0.98, -1.2, -0.34], [sx * 1.16, -1.3, -0.34], 0.09, FRAME),
  tube([sx * 1.16, -1.3, -0.34], [sx * 1.25, -1.75, -0.36], 0.08, FRAME),
  tube([sx * 1.25, -1.75, -0.36], [sx * 1.24, -2.25, -0.34], 0.08, FRAME),
  tube([sx * 1.24, -2.25, -0.34], [sx * 1.2, -2.66, -0.1], 0.08, FRAME),
  tube([sx * 1.22, -2.3, -0.2], [sx * 1.22, -2.3, 0.38], 0.06, FRAME),                 // armrest
  tube([sx * 1.16, -1.3, -0.34], [sx * 1.14, -1.42, 0.3], 0.06, FRAME),                 // safety bar, raised
];
// Snowmass cabin: rounded, black below the belt, tinted glass above, logo on both sides, grey sill, curved hanger.
// Faces +z; cable at y = 0.
function roundRing(a, b, r, y, seg = 3) {
  const out = [];
  for (const [cx, cz, t0] of [[a - r, b - r, 0], [-(a - r), b - r, 0.5], [-(a - r), -(b - r), 1], [a - r, -(b - r), 1.5]])
    for (let k = 0; k <= seg; k++) { const t = (t0 + 0.5 * k / seg) * Math.PI; out.push([cx + r * Math.cos(t), y, cz + r * Math.sin(t)]); }
  return out;
}
function cabinGeo() {
  const rings = [[0.86, 0.8, 0.35, -3.95], [1.0, 0.93, 0.45, -3.7], [1.06, 0.99, 0.5, -2.95], [1.0, 0.93, 0.45, -2.0], [0.86, 0.8, 0.38, -1.8], [0.6, 0.55, 0.3, -1.68]]
    .map(([a, b, r, y]) => roundRing(a, b, r, y));
  const pos = [], col = [], tt = [], BODY = [0.06, 0.065, 0.075], TINT = [0.1, 0.13, 0.18], yF = -3.95, yT = -1.85;
  const tri = (A, B, C) => {
    const n = new THREE.Vector3(...B).sub(new THREE.Vector3(...A)).cross(new THREE.Vector3(...C).sub(new THREE.Vector3(...A))).normalize();
    const yc = (A[1] + B[1] + C[1]) / 3, side = Math.abs(n.x) > 0.75 && yc < -1.9;
    for (const P of [A, B, C]) {
      pos.push(...P);
      if (side) {   // logo tile once across the side, top at the roof line
        col.push(1, 1, 1);
        tt.push(clamp(0.5 - Math.sign(n.x) * P[2] / 2.0, 0.002, 0.998), clamp((P[1] - yF) / (yT - yF), 0.002, 0.998), TILES.cabin + 1);
      } else { col.push(...(yc > -2.95 && yc < -1.95 ? TINT : BODY)); tt.push(0, 0, 0); }
    }
  };
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(A[i], B[j], A[j]); tri(A[i], B[i], B[j]); }
  }
  for (const [Rg, up] of [[rings[rings.length - 1], true], [rings[0], false]]) {
    const f = THREE.ShapeUtils.triangulateShape(Rg.map((v) => new THREE.Vector2(v[0], v[2])), []);
    for (const [a, b, c] of f) up ? tri(Rg[a], Rg[c], Rg[b]) : tri(Rg[a], Rg[b], Rg[c]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(pos.filter((_, k) => k % 3 === 1), 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 3));
  return merge([
    g,
    part(new THREE.BoxGeometry(0.28, 0.32, 0.62).translate(0, -0.12, 0), DARK),                   // grip
    tube([0, -0.28, 0], [0.42, -0.75, 0], 0.1, FRAME), tube([0.42, -0.75, 0], [0.38, -1.35, 0], 0.1, FRAME),
    tube([0.38, -1.35, 0], [0, -1.66, 0], 0.1, FRAME),                                            // hanger
    part(new THREE.BoxGeometry(1.5, 0.12, 1.4).translate(0, -4.02, 0), [0.42, 0.43, 0.46]),        // sill
  ]);
}
const CARRIER_GEO = {
  chair: merge([
    part(new THREE.BoxGeometry(0.26, 0.3, 0.5).translate(0, -0.15, 0), DARK),
    tube([0, -0.3, 0], [0, -1.15, -0.32], 0.11, FRAME),
    tube([-0.98, -1.2, -0.34], [0.98, -1.2, -0.34], 0.09, FRAME),
    ...chairSide(-1), ...chairSide(1),
    part(new THREE.BoxGeometry(2.42, 0.07, 0.55).translate(0, -2.72, 0.1), FRAME),
    ...[-0.9, -0.3, 0.3, 0.9].map((x) => part(new THREE.BoxGeometry(0.56, 0.13, 0.52).translate(x, -2.62, 0.12), CUSH)),
    part(new THREE.BoxGeometry(2.3, 0.5, 0.11).rotateX(-0.18).translate(0, -2.26, -0.24), CUSH),
    tube([-1.14, -1.42, 0.3], [1.14, -1.42, 0.3], 0.06, FRAME),                                  // raised bar
    tube([-0.35, -1.42, 0.3], [-0.38, -1.95, 0.5], 0.05, FRAME), tube([0.35, -1.42, 0.3], [0.38, -1.95, 0.5], 0.05, FRAME),
    tube([-0.72, -1.95, 0.5], [0.72, -1.95, 0.5], 0.06, FRAME),                                  // footrest
  ]),
  // past CHAIR_NEAR: hanger, seat and back only
  chairFar: merge([
    part(new THREE.BoxGeometry(0.14, 2.5, 0.14).translate(0, -1.3, -0.3), FRAME),
    part(new THREE.BoxGeometry(2.4, 0.2, 0.55).translate(0, -2.64, 0.12), CUSH),
    part(new THREE.BoxGeometry(2.3, 0.5, 0.12).translate(0, -2.26, -0.24), CUSH),
  ]),
  cabin: cabinGeo(),
  cabinFar: merge([
    part(new THREE.BoxGeometry(0.14, 1.7, 0.14).translate(0, -0.85, 0), FRAME),
    part(new THREE.BoxGeometry(2.0, 1.2, 1.86).translate(0, -3.4, 0), [0.06, 0.065, 0.075]),
    part(new THREE.BoxGeometry(1.9, 1.0, 1.76).translate(0, -2.3, 0), [0.1, 0.13, 0.18]),
  ]),
  bar: merge([
    part(new THREE.BoxGeometry(0.1, 3.6, 0.1).translate(0, -1.8, 0), STEEL),
    part(new THREE.BoxGeometry(1.1, 0.12, 0.12).translate(0, -3.6, 0), DARK),
  ]),
};
const FAR_OF = { chair: 'chairFar', cabin: 'cabinFar' };
const carrierMeshes = {};
for (const k of [...Object.keys(carriers), ...Object.values(FAR_OF)]) {
  const own = Object.keys(FAR_OF).find((n) => FAR_OF[n] === k) || k;
  const m = new THREE.InstancedMesh(CARRIER_GEO[k], modelMat, Math.max(1, carriers[own].length));
  m.frustumCulled = false;
  scene.add(m);
  carrierMeshes[k] = m;
}
function pathAt(lp, d, out) {
  const s = lp.s;
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= d) lo = mid; else hi = mid; }
  const f = (d - s[lo]) / ((s[hi] - s[lo]) || 1), a = lp.path[lo], b = lp.path[hi];
  out.x = a[0] + (b[0] - a[0]) * f; out.y = a[1] + (b[1] - a[1]) * f; out.z = a[2] + (b[2] - a[2]) * f;
  out.dx = b[0] - a[0]; out.dz = b[2] - a[2];
  return out;
}
// carrier at d along the loop (0..L up, L..2L back): its spot beside the cable and its facing
function carrierAt(lp, d, out) {
  const up = d < lp.L;
  pathAt(lp, up ? d : 2 * lp.L - d, out);
  const len = Math.hypot(out.dx, out.dz) || 1, ux = out.dx / len, uz = out.dz / len;
  const side = up ? 1 : -1;
  out.fx = ux * side; out.fz = uz * side;   // riders face the way they travel
  out.x += uz * lp.arm * side; out.z -= ux * lp.arm * side;
  return out;
}
const cp = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fx: 0, fz: 0 };
function placeCarriers(t) {
  const cx = camera.position.x, cz = camera.position.z;
  // the ride chair: shift its lift's chairs so one is where the ride is
  if (ride.lp && ride.chair) ride.lp.shift = ride.d - (ride.chair.s0 + t * ride.lp.speed);
  for (const k of Object.keys(carriers)) {
    const m = carrierMeshes[k], e = m.instanceMatrix.array, fm = FAR_OF[k] && carrierMeshes[FAR_OF[k]], fe = fm && fm.instanceMatrix.array;
    let nNear = 0, nFar = 0;
    // lifts wholly past CHAIR_FAR place no chairs or cabins
    const far = new Set();
    if (fm) for (const lp of liftPaths) if (Math.hypot(Math.max(lp.box[0] - cx, 0, cx - lp.box[1]), Math.max(lp.box[2] - cz, 0, cz - lp.box[3])) > CHAIR_FAR) far.add(lp);
    carriers[k].forEach((c) => {
      if (far.has(c.lp)) return;
      const lp = c.lp, d = (((c.s0 + t * lp.speed + lp.shift) % (2 * lp.L)) + 2 * lp.L) % (2 * lp.L);
      carrierAt(lp, d, cp);
      const x = cp.x, z = cp.z, fx = cp.fx, fz = cp.fz;
      let out = e, n = nNear;
      if (fm) {
        const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        if (d2 > CHAIR_FAR * CHAIR_FAR) return;
        if (d2 > CHAIR_NEAR * CHAIR_NEAR) { out = fe; n = nFar++; } else nNear++;
      } else nNear++;
      // rotation about y taking local +z to (fx, fz)
      out.set([fz, 0, -fx, 0, 0, 1, 0, 0, fx, 0, fz, 0, x, cp.y, z, 1], n * 16);
    });
    m.count = nNear;
    m.instanceMatrix.needsUpdate = true;
    if (fm) { fm.count = nFar; fm.instanceMatrix.needsUpdate = true; }
  }
}

// ---------- Lamps: one per terminal hut, lit at night ----------
const bulbMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
{
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), bulbMat, Math.max(1, lampList.length));
  lampList.forEach((p, n) => m.setMatrixAt(n, new THREE.Matrix4().setPosition(p.x, p.y + 0.3, p.z)));
  scene.add(m);
}
function updateLamps() {
  const cpos = camera.position;
  const near = lampList.slice().sort((a, b) => a.distanceToSquared(cpos) - b.distanceToSquared(cpos));
  for (let i = 0; i < 4; i++) LIGHT.uLamps.value[i].copy(near[i] || new THREE.Vector3(0, -1e5, 0));
}

// ---------- Shadows: trees, rocks and towers painted top down around the camera ----------
const shCanvas = document.createElement('canvas');
shCanvas.width = shCanvas.height = SH_PX;
const shCtx = shCanvas.getContext('2d');
const shTex = new THREE.CanvasTexture(shCanvas);
shTex.magFilter = shTex.minFilter = THREE.NearestFilter; shTex.generateMipmaps = false;
LIGHT.uShadow.value = shTex;
let shLast = 0;
// a caster's shadow: an ellipse along the sun, as painted; shadowGeo() is shared with sunAt
function shadowGeo() {
  const s = SUN_DIR, flat = Math.hypot(s.x, s.z) || 1e-3, ang = Math.atan2(s.x, -s.z);
  return { s, flat, dx: -s.x / flat, dz: -s.z / flat, ang, ca: Math.cos(ang), sa: Math.sin(ang) };
}
const shadowLen = (G, h) => Math.min(h * 4, h * G.flat / Math.max(0.15, G.s.y));
// the tree pages a shadow pass reads: only built ones; a page built later marks the canvas for a repaint
function forPages(x0, z0, x1, z1, fn) {
  const P = PAGE * CELL;
  for (let b = Math.floor((z0 - Z0) / P); b <= Math.floor((z1 - Z0) / P); b++) for (let a = Math.floor((x0 - X0) / P); a <= Math.floor((x1 - X0) / P); a++) {
    const pg = pages.get(a * 1000 + b);
    if (pg) fn(pg);
  }
}
function paintShadows(force) {
  const cx = camera.position.x, cz = camera.position.z, now = performance.now();
  const moved = !shAt || Math.hypot(cx - shAt.x, cz - shAt.z) >= SH_SIZE * 0.18;
  if (!force && !moved && !(shDirty && now - shLast > 500)) return;
  if (moved || force) shAt = { x: cx, z: cz };
  shDirty = false; shLast = now;
  const ox = Math.round((shAt.x - SH_SIZE / 2) / 8) * 8, oz = Math.round((shAt.z - SH_SIZE / 2) / 8) * 8;
  LIGHT.uShO.value.set(ox, oz);
  const g = shCtx, k = SH_PX / SH_SIZE, G = shadowGeo();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, SH_PX, SH_PX); g.fillStyle = '#fff';
  const one = (x, z, h, w) => {
    const len = shadowLen(G, h);
    const px = (x + G.dx * len / 2 - ox) * k, pz = (z + G.dz * len / 2 - oz) * k, r = (len / 2 + w * 0.3) * k;
    if (px < -r || pz < -r || px > SH_PX + r || pz > SH_PX + r) return;
    g.setTransform(1, 0, 0, 1, px, pz); g.rotate(G.ang);
    g.beginPath(); g.ellipse(0, 0, Math.max(0.6, w * k), r, 0, 0, Math.PI * 2); g.fill();
  };
  forPages(ox - 60, oz - 60, ox + SH_SIZE + 60, oz + SH_SIZE + 60, (pg) => {
    for (const t of pg.list) one(t.x, t.z, t.height, t.height * atlas.rects[t.kind].aspect * 0.32);
    for (const r of pg.rocks) one(r.x, r.z, r.height, r.s * 0.8);
  });
  for (const c of casters) one(c.x, c.z, c.h, c.w);
  g.setTransform(1, 0, 0, 1, 0, 0);
  shTex.needsUpdate = true;
}
// sun reaching a point, for Goldie: the same ellipses tested directly, so the canvas is never read back
function sunAt(x, z) {
  if (!shAt) return 1;
  const G = shadowGeo(), W0 = 0.6 * SH_SIZE / SH_PX;
  const hit = (cx, cz, h, w) => {
    const len = shadowLen(G, h), R = len / 2 + w * 0.3, W = Math.max(W0, w);
    const ex = x - (cx + G.dx * len / 2), ez = z - (cz + G.dz * len / 2);
    if (Math.abs(ex) > R + W || Math.abs(ez) > R + W) return false;
    const lx = ex * G.ca + ez * G.sa, ly = -ex * G.sa + ez * G.ca;
    return (lx / W) * (lx / W) + (ly / R) * (ly / R) <= 1;
  };
  let lit = 1;
  forPages(x - 120, z - 120, x + 120, z + 120, (pg) => {
    if (!lit) return;
    for (const t of pg.list) if (hit(t.x, t.z, t.height, t.height * atlas.rects[t.kind].aspect * 0.32)) { lit = 0; return; }
    for (const r of pg.rocks) if (hit(r.x, r.z, r.height, r.s * 0.8)) { lit = 0; return; }
  });
  if (lit) for (const c of casters) if (hit(c.x, c.z, c.h, c.w)) return 0;
  return lit;
}

// ---------- Storm snowfall: flakes in a box that rides with the camera ----------
const FLAKES = 2200, FLAKE_BOX = 70;
const flakePos = new Float32Array(FLAKES * 3);
for (let i = 0; i < FLAKES * 3; i++) flakePos[i] = (Math.random() - 0.5) * FLAKE_BOX;
const flakes = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf4f7ff, size: 1.5, sizeAttenuation: false }));
  p.frustumCulled = false; p.visible = false;
  scene.add(p);
  return p;
})();
let flakeT = 0;
function updateFlakes(dt) {
  if (!flakes.visible) return;
  flakeT += dt;
  const c = camera.position, H2 = FLAKE_BOX / 2;
  const wrap = (v, o) => ((((v - o + H2) % FLAKE_BOX) + FLAKE_BOX) % FLAKE_BOX) - H2 + o;
  for (let i = 0; i < FLAKES; i++) {
    const j = i * 3;
    flakePos[j] = wrap(flakePos[j] + (1.6 + Math.sin(flakeT * 0.7 + i) * 0.8) * dt, c.x);
    flakePos[j + 1] = wrap(flakePos[j + 1] - (2.2 + (i % 7) * 0.15) * dt, c.y);
    flakePos[j + 2] = wrap(flakePos[j + 2] + 0.6 * dt, c.z);
  }
  flakes.geometry.attributes.position.needsUpdate = true;
}

// ---------- Time of day and the pixel look ----------
let pixelLook = false;           // 320x180 look is a Tab toggle
function applyTime(key) {
  timeOfDay = key;
  const T = TIMES[key];
  SUN_DIR.set(...T.sun).normalize();
  SUN_COLOR.set(...T.sunC); SKY_COLOR.set(...T.sky); SNOW_ALBEDO.set(...T.snow);
  FOG.set(T.fogC[0] / 255, T.fogC[1] / 255, T.fogC[2] / 255);
  LIGHT.uFogNear.value = T.fog[0]; LIGHT.uFogFar.value = T.fog[1];
  BOUNCE.copy(SUN_COLOR).multiplyScalar(Math.max(0, SUN_DIR.y)).addScaledVector(SKY_COLOR, 0.6).multiply(SNOW_ALBEDO);
  LIGHT.uLampC.value.set(...T.lamp);
  sky.material.map = SKIES[key]; sky.material.needsUpdate = true;
  scene.background.setRGB(FOG.x, FOG.y, FOG.z, THREE.SRGBColorSpace);
  treeMat.uniforms.uA.value = key === 'storm' ? atlas.stormMap : atlas.map;
  treeMat.uniforms.uN.value = key === 'storm' ? atlas.stormNormal : atlas.normal;
  bulbMat.color.set(key === 'night' ? 0xffe9a8 : 0x2a2a2a);
  flakes.visible = key === 'storm';
  setLamps(key === 'night');
  paintShadows(true);
}
// every Snowlight material, in the scene or not yet (run and kicker meshes), recompiled with or without LAMPS
function setLamps(on) {
  const mats = new Set([PATCH && PATCH.mat, kickSnowMat, kickMatMat]);
  scene.traverse((o) => { if (o.material) mats.add(o.material); });
  for (const m of mats) {
    if (!m || !m.isShaderMaterial || !m.fragmentShader.includes('lamps(') || !!(m.defines && m.defines.LAMPS) === on) continue;
    m.defines = Object.assign({}, m.defines);
    if (on) m.defines.LAMPS = 1; else delete m.defines.LAMPS;
    m.needsUpdate = true;
  }
}
function setPixelLook(on) {
  pixelLook = on;
  resize();
}
function updateWorld(dt) {
  placeCarriers(performance.now() / 1000);
  paintShadows(false);
  updateLamps();
  updateFlakes(dt);
}

// ---------- The skier: a camera-facing sprite from Goldie's sheet, plus a blob shadow ----------
// Sheet: 10 pose columns x 5 angle rows (0 behind, 45, 90 her right, 135, 180 in front); her left side is mirrored.
// Lit per pixel from the normal map by sun, sky and snow bounce, snapped to four bands.
const FRAMES = { stand: 0, carveL: 1, carveR: 2, tuck: 3, brake: 4, air: 5, land: 6, wipeout: 7, celebrate: 8, sit: 9 };
const POSE_COLS = 10, ANGLE_ROWS = 5;
const SPRITE_H = 2.0, SPRITE_W = 2.5;
const skierMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: goldieT },
    normalMap: { value: goldieN },
    frameCol: { value: 0 },
    frameRow: { value: 0 },
    mirror: { value: 0 },
    sunLocal: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: SUN_COLOR },
    skyColor: { value: SKY_COLOR },
    bounce: { value: BOUNCE },
    uLit: { value: 1 },
  },
  vertexShader: `
    uniform float frameCol, frameRow, mirror;
    varying vec2 vUv;
    void main() {
      float u = mix(uv.x, 1.0 - uv.x, mirror);
      vUv = vec2((u + frameCol) / ${POSE_COLS}.0, (uv.y + ${ANGLE_ROWS - 1}.0 - frameRow) / ${ANGLE_ROWS}.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform sampler2D normalMap;
    uniform vec3 sunLocal, sunColor, skyColor, bounce;
    uniform float uLit, mirror;
    varying vec2 vUv;
    float band(float v) { return max(0.12, floor(v * 4.0 + 0.5) / 4.0); }
    void main() {
      vec4 albedo = texture2D(map, vUv);
      if (albedo.a < 0.5) discard;
      vec3 n = normalize(texture2D(normalMap, vUv).rgb * 2.0 - 1.0);
      if (mirror > 0.5) n.x = -n.x;
      vec3 l = sunColor * band(max(0.0, dot(n, sunLocal))) * uLit;
      l += skyColor * (0.35 + 0.35 * n.y);
      l += bounce * band(max(0.0, 0.15 - 0.8 * n.y)) * 0.55;
      l += 0.06;
      float m = max(max(l.r, l.g), max(l.b, 1e-3));
      l *= band(min(1.25, m)) / m;
      gl_FragColor = vec4(min(albedo.rgb * l * 1.15, 1.0), 1.0);
    }`,
  side: THREE.DoubleSide,
});
const skierMesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRITE_W, SPRITE_H).translate(0, SPRITE_H / 2 - 0.04, 0), skierMat);
scene.add(skierMesh);
const shadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(20,36,77,0.55)'); grad.addColorStop(1, 'rgba(20,36,77,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  scene.add(m);
  return m;
})();

// Snow spray when the skis skid or brake.
const SPRAY_N = 260;
const spray = { pos: new Float32Array(SPRAY_N * 3), vel: new Float32Array(SPRAY_N * 3), life: new Float32Array(SPRAY_N), next: 0, debt: 0 };
const sprayPoints = (() => {
  spray.pos.fill(-1e4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(spray.pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.24, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, depthWrite: false }));
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

// ---------- Input ----------
// Keys: Left/Right or A/D steer, Up/W poles, Down/S brakes, Shift tucks, Space jumps (hold to load an ollie).
// Touch: drag to steer, rest to tuck, swipe down to pole, swipe up to brake, tap to jump. The newest finger steers.
const input = { steer: 0, tuck: false, brake: false, pole: false, jump: false };
const keys = new Set();
let keySteer = 0;
const STEER_PX = 70;
const ptr = { id: null, x0: 0, x: 0, y: 0, t0: 0, travel: 0, lastMove: 0, steer: 0, woke: false, hist: [], passive: false, topY: 0 };
const touches = new Map();      // finger id -> [x, y]
let hockeyStop = false;         // swipe up: stop held until stopped
let poleSwipe = false;          // swipe down: one pole push
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'pole', KeyW: 'pole', ArrowDown: 'brake', KeyS: 'brake', ShiftLeft: 'tuck', ShiftRight: 'tuck', Space: 'jump' };
window.addEventListener('keydown', (e) => {
  if (debugKey(e)) return;
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (phase === 'ride') { if (k === 'jump') skipRide(); return; }
  if (phase === 'ready') wake();
  else if (k === 'jump' && !physics.momentum) input.jump = true;
});
window.addEventListener('keyup', (e) => {
  if (FREE_KEYS[e.code]) free.keys.delete(FREE_KEYS[e.code]);
  const k = KEYMAP[e.code]; if (k) keys.delete(k);
  if (k === 'jump' && physics.momentum && phase === 'skiing') input.jump = true;
});
window.addEventListener('blur', () => { keys.clear(); touches.clear(); ptr.id = null; ptr.steer = 0; hockeyStop = false; poleSwipe = false; free.keys.clear(); free.drag = false; });
const canvas = renderer.domElement;
function anchor(id, x, y, handedOver) {
  ptr.id = id;
  ptr.x0 = ptr.x = x; ptr.y = y;
  ptr.t0 = ptr.lastMove = performance.now();
  ptr.travel = handedOver ? Infinity : 0;  // a finger already down can't tap
  ptr.passive = handedOver;                // ...or tuck until it moves
  ptr.steer = 0;
  ptr.hist = [[ptr.t0, x, y]];
  ptr.topY = y;
}
canvas.addEventListener('pointerdown', (e) => {
  if (free.on) { if (e.button === 0) { free.drag = true; lockPointer(); } return; }
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  anchor(e.pointerId, e.clientX, e.clientY, false);
  hockeyStop = false;
  ptr.woke = phase === 'ready';
  canvas.setPointerCapture?.(e.pointerId);
  if (phase === 'ride') skipRide();
  wake();
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (e.pointerId !== ptr.id) return;
  const now = performance.now();
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.travel += Math.hypot(dx, dy);
  if (Math.hypot(dx, dy) > 1.5) { ptr.lastMove = now; ptr.passive = false; }
  ptr.x = e.clientX; ptr.y = e.clientY;
  // Hockey stop: a quick upward flick (40 px within 0.25 s); pulling back down cancels it.
  ptr.hist.push([now, ptr.x, ptr.y]);
  while (now - ptr.hist[0][0] > 250) ptr.hist.shift();
  const up = ptr.hist[0][2] - ptr.y, side = Math.abs(ptr.x - ptr.hist[0][1]);
  if (dy < 0 && up > 40 && up > 1.5 * side) { hockeyStop = true; ptr.topY = ptr.y; }
  ptr.topY = Math.min(ptr.topY, ptr.y);
  if (hockeyStop && ptr.y - ptr.topY > 20) hockeyStop = false;
  // Poles: a quick downward flick, one push each.
  const down = ptr.y - ptr.hist[0][2];
  if (dy > 0 && down > 40 && down > 1.5 * side) { poleSwipe = true; ptr.hist = [[now, ptr.x, ptr.y]]; }
  // keep the anchor within one full steer of the thumb so reversing is instant
  if (ptr.x - ptr.x0 > STEER_PX) ptr.x0 = ptr.x - STEER_PX;
  if (ptr.x0 - ptr.x > STEER_PX) ptr.x0 = ptr.x + STEER_PX;
  ptr.steer = clamp((ptr.x - ptr.x0) / STEER_PX, -1, 1);
});
function endPointer(e) {
  touches.delete(e.pointerId);
  if (e.pointerId !== ptr.id) return;
  const quick = performance.now() - ptr.t0 < 220 && ptr.travel < 14;
  if (quick && e.type === 'pointerup' && !ptr.woke) input.jump = true;
  const rest = [...touches];
  if (rest.length) {
    // Another finger still down takes over steering.
    const [id, [x, y]] = rest[rest.length - 1];
    anchor(id, x, y, true);
  } else {
    ptr.id = null; ptr.steer = 0;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Debug menu (Tab) ----------
// Freecam: WASD flies where you look, mouse looks, Shift is faster; Goldie holds still.
const debugEl = document.getElementById('debug');
const free = { on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set(), drag: false };
const FREE_SPEED = 30;          // m/s
const FREE_FAST = 10;           // Shift multiplier
const FREE_LOOK = 0.0022;       // rad per pixel
const FREE_KEYS = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'fast', ShiftRight: 'fast' };
// on for testing; Tab turns it off
const speedEl = Object.assign(document.createElement('div'), { hidden: false });
speedEl.style.cssText = 'position:fixed;top:12px;right:14px;font:600 15px ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 1px 2px #13244d;pointer-events:none';
document.body.append(speedEl);

// ---------- HUD map: minimap and full map in the trail-map style ----------
// One image painted at load, north up (x right, z down). The minimap turns it heading-up; the full map (M, or
// a two-finger tap) shows it summit-up.
const HUDMAP = {
  MPP: 4,                       // m per image pixel
  MINI_SPAN: 1500,              // m across the minimap
  MINI_PX: 160,                 // px (116 on small screens)
  RUN: { green: '#2e9e48', blue: '#1f7fd6', black: '#141414', expert: '#141414', none: '#7c8794' },
  LIFT: '#d8202f',              // chairs and gondolas
  SURFACE: '#6a3fb5',           // T-bar and platters
  // trail map labels and elevations (ft, m); lift top unless marked bottom
  PEAKS: [['CIRQUE T-BAR', 'Cirque T-Bar', 12510, 3813], ['HIGH ALPINE', 'High Alpine', 11880, 3612], ['BIG BURN', 'Big Burn', 11835, 3607],
    ["SAM'S KNOB", "Sam's Knob", 10630, 3240], ['ELK CAMP', 'Elk Camp', 11325, 3452], ['BASE VILLAGE', 'Village Express', 8400, 2560, 'bottom'],
    ['VILLAGE MALL', 'Sky Cab', 8606, 2623], ['TWO CREEKS', 'Two Creeks', 8110, 2472, 'bottom'], ['CAMPGROUND', 'Campground', 8235, 2510, 'bottom']],
};
const hudMap = { base: null, x0: 0, z0: 0, full: false, frame: 0 };
const surfaceLift = (l) => l.kind === 't-bar' || l.kind === 'platter';
const runDiff = MAP.runs.map((r, i) => (RUN_DATA.runs.find((q) => q.i === i) || {}).difficulty || 'none');
const miniEl = Object.assign(document.createElement('canvas'), { className: 'hudmap-mini' });
const fullEl = Object.assign(document.createElement('div'), { className: 'hudmap-full', hidden: true });
const fullMap = document.createElement('canvas'), fullMe = document.createElement('canvas');
fullEl.append(fullMap, fullMe);
document.body.append(miniEl, fullEl);
const mapFont = (px, w = 700, it = '') => `${it}${w} ${px}px "Helvetica Neue",Arial,sans-serif`;

// Painted a band of rows at a time so skiing doesn't stutter.
(async function paintHudMap() {
  const t0 = performance.now(), areaB = await inflate(RUN_DATA.area);
  const AREA = new Int8Array(areaB.buffer, areaB.byteOffset, areaB.length);   // half meters to the nearest run, < 0 on it
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const r of [...MAP.runs, ...MAP.lifts]) for (const [x, z] of r.points) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  x0 -= 400; z0 -= 300; x1 += 400; z1 += 600;   // room above the summit for its label
  const M = HUDMAP.MPP, W = Math.ceil((x1 - x0) / M), Hp = Math.ceil((z1 - z0) / M);
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: Hp }), g = cv.getContext('2d');
  const img = g.createImageData(W, Hp), px = img.data;
  const bil = (a, fx, fz) => {
    const i = clamp(Math.floor(fx), 0, NX - 2), j = clamp(Math.floor(fz), 0, NZ - 2), tx = fx - i, tz = fz - j, k = j * NX + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + NX] * (1 - tx) + a[k + NX + 1] * tx) * tz;
  };
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // light from the summit-up view's top left, 40 degrees up; slopes slightly exaggerated
  const LX = 0.54, LY = 0.64, LZ = 0.54, EX = 1.5;
  const SNOW_D = [118, 150, 196], SNOW_L = [250, 252, 255], TREE_D = [10, 38, 30], TREE_L = [52, 98, 66], ASP_D = [96, 98, 104], ASP_L = [176, 174, 168], ROCK = [120, 118, 122];
  for (let j = 0; j < Hp; j++) {
    if (j % 32 === 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < W; i++) {
      const fx = (x0 + i * M - X0) / CELL, fz = (z0 + j * M - Z0) / CELL;
      const gx = (bil(H, fx + 0.5, fz) - bil(H, fx - 0.5, fz)) / CELL * EX, gz = (bil(H, fx, fz + 0.5) - bil(H, fx, fz - 0.5)) / CELL * EX;
      const lit = Math.max(0, (-gx * LX + LY - gz * LZ) / Math.hypot(gx, 1, gz)), t = clamp((lit - 0.25) / 0.75, 0, 1);
      let c = mix(SNOW_D, SNOW_L, t);
      if (bil(AREA, fx, fz) > 4) {
        // tree stipple, denser in thicker forest, none on runs
        const k = clamp(Math.round(fz), 0, NZ - 1) * NX + clamp(Math.round(fx), 0, NX - 1), cov = COVER[k];
        const con = (cov & 15) / 15, asp = ((cov >> 4) & 7) / 7, r = hash(i, j), r2 = hash(i >> 1, j >> 1);
        if (cov >> 7) c = mix(c, ROCK, 0.45);
        if (con > 0.05 && r2 < con * 1.1) c = mix(TREE_D, TREE_L, t * 0.8 + r * 0.25);
        else if (asp > 0.1 && r2 < asp * 0.9) c = mix(ASP_D, ASP_L, t * 0.8 + r * 0.2);
      }
      const o = (j * W + i) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // minimap copy with runs and lifts painted at minimap width
  hudMap.x0 = x0; hudMap.z0 = z0;
  drawMapLines(g, HUDMAP.MINI_PX / (HUDMAP.MINI_SPAN / M), 2.2);
  hudMap.base = cv;
  // the full map draws its own lines on a plain copy
  hudMap.plain = document.createElement('canvas');
  hudMap.plain.width = W; hudMap.plain.height = Hp;
  hudMap.plain.getContext('2d').putImageData(img, 0, 0);
  hudMap.paintMs = Math.round(performance.now() - t0);
  if (hudMap.full) drawFullMap();
})();

// Runs as colored lines with a white casing, lifts red (purple for surface lifts) with end dots.
// g is in image px; k is screen px per image px, so lw stays in screen px.
function drawMapLines(g, k, lw) {
  const P = (x, z) => [(x - hudMap.x0) / HUDMAP.MPP, (z - hudMap.z0) / HUDMAP.MPP];
  const line = (pts) => { g.beginPath(); pts.forEach(([x, z], n) => { const p = P(x, z); g[n ? 'lineTo' : 'moveTo'](p[0], p[1]); }); };
  g.lineJoin = g.lineCap = 'round';
  for (const pass of [0, 1]) MAP.runs.forEach((r, i) => {
    line(r.points);
    g.strokeStyle = pass ? HUDMAP.RUN[runDiff[i]] : 'rgba(255,255,255,0.85)';
    g.lineWidth = (pass ? lw : lw + 1.6) / k;
    g.stroke();
  });
  for (const l of MAP.lifts) {
    const col = surfaceLift(l) ? HUDMAP.SURFACE : HUDMAP.LIFT;
    line(l.points);
    g.strokeStyle = '#fff'; g.lineWidth = (lw + 2.2) / k; g.stroke();
    g.strokeStyle = col; g.lineWidth = lw / k; g.stroke();
    g.fillStyle = col; g.lineWidth = 1 / k;
    for (const [x, z] of [l.points[0], l.points[l.points.length - 1]]) {
      const p = P(x, z);
      g.beginPath(); g.arc(p[0], p[1], lw * 1.6 / k, 0, 7); g.fill(); g.stroke();
    }
  }
}
// Goldie: a gold arrow pointing where she (or the freecam) faces.
function mapArrow(g, s) {
  g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.62, s * 0.7); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.62, s * 0.7); g.closePath();
  g.fillStyle = '#f4c542'; g.fill(); g.lineWidth = 1.8; g.strokeStyle = '#13244d'; g.stroke();
}
const mapWhere = () => {
  const p = free.on ? free.pos : sk.pos, e = camera.matrixWorld.elements;
  return { x: p.x, z: p.z, yaw: Math.atan2(-e[8], e[10]) };   // yaw 0 = north (-z), clockwise
};
function sizeHudMap() {
  const S = Math.min(innerWidth, innerHeight) < 500 ? 116 : HUDMAP.MINI_PX, d = Math.min(window.devicePixelRatio || 1, 2);
  miniEl.width = miniEl.height = Math.round(S * d);
  miniEl.style.width = miniEl.style.height = `${S}px`;
  hudMap.mini = S; hudMap.dpr = d;
  if (hudMap.full) drawFullMap();
}
function drawMiniMap() {
  if (!hudMap.base || hudMap.full) return;
  const S = hudMap.mini, R = S / 2, g = miniEl.getContext('2d'), w = mapWhere();
  const k = S / (HUDMAP.MINI_SPAN / HUDMAP.MPP);
  g.setTransform(hudMap.dpr, 0, 0, hudMap.dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.clip();
  g.translate(R, R); g.rotate(-w.yaw); g.scale(k, k);
  g.translate(-(w.x - hudMap.x0) / HUDMAP.MPP, -(w.z - hudMap.z0) / HUDMAP.MPP);
  g.drawImage(hudMap.base, 0, 0);
  g.restore();
  g.beginPath(); g.arc(R, R, R - 1.5, 0, 7); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  g.beginPath(); g.arc(R, R, R - 0.5, 0, 7); g.lineWidth = 1; g.strokeStyle = 'rgba(19,36,77,.8)'; g.stroke();
  g.translate(R, R); mapArrow(g, 8);
}
// Full map: whole mountain, summit up, with labels. Drawn when it opens or the window resizes; only the arrow redraws.
function drawFullMap() {
  if (!hudMap.plain) return;
  const B = hudMap.plain, d = hudMap.dpr, small = Math.min(innerWidth, innerHeight) < 500, m = small ? 8 : 16;
  const s = Math.min((innerWidth - 2 * m) / B.width, (innerHeight - 2 * m) / B.height), w = B.width * s, h = B.height * s;
  for (const c of [fullMap, fullMe]) {
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    Object.assign(c.style, { width: `${w}px`, height: `${h}px`, left: `${(innerWidth - w) / 2}px`, top: `${(innerHeight - h) / 2}px` });
  }
  const g = fullMap.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.save(); g.translate(w, h); g.rotate(Math.PI); g.scale(s, s); g.drawImage(B, 0, 0); drawMapLines(g, s, 2); g.restore();
  const S = (x, z) => [w - (x - hudMap.x0) / HUDMAP.MPP * s, h - (z - hudMap.z0) / HUDMAP.MPP * s];
  hudMap.toScreen = S;
  const fs = small ? 8 : 11, nfs = small ? 6 : 8;
  const ends = HUDMAP.PEAKS.map(([name, lift, ft, me, end]) => {
    const l = MAP.lifts.find((q) => q.name === lift), p = end === 'bottom' ? l.points[0] : l.points[l.points.length - 1];
    return [name, ft, me, ...S(p[0], p[1]), end === 'bottom'];
  });
  // peak and base labels draw last but claim room first; bases label below, peaks above
  const placed = ends.map(([, , , x, y, low]) => (low ? [x - 50, y, x + 50, y + fs * 2.2 + 8] : [x - 50, y - fs * 2.2 - 8, x + 50, y]));
  const tag = (label, pts, fill, font) => {
    const n = pts.length >> 1, a = S(...pts[n - 1]), b = S(...pts[n + 1]), mid = S(...pts[n]);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    g.font = font;
    const tw = g.measureText(label).width + 6, th = nfs + 4;
    const ex = Math.abs(Math.cos(ang)) * tw / 2 + Math.abs(Math.sin(ang)) * th / 2, ey = Math.abs(Math.sin(ang)) * tw / 2 + Math.abs(Math.cos(ang)) * th / 2;
    const box = [mid[0] - ex, mid[1] - ey, mid[0] + ex, mid[1] + ey];
    if (placed.some((q) => q[0] < box[2] && box[0] < q[2] && q[1] < box[3] && box[1] < q[3])) return;   // no overlaps
    placed.push(box);
    g.save(); g.translate(mid[0], mid[1]); g.rotate(ang);
    g.fillStyle = fill; g.fillRect(-tw / 2, -th / 2, tw, th);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, 0.5);
    g.restore();
  };
  for (const l of MAP.lifts) {
    // two-point lift lines get a midpoint for the label
    const [a, b] = [l.points[0], l.points[l.points.length - 1]];
    const pts = l.points.length > 2 ? l.points : [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b];
    tag(l.name, pts, surfaceLift(l) ? HUDMAP.SURFACE : HUDMAP.LIFT, mapFont(nfs + 1, 700, 'italic '));
  }
  MAP.runs.forEach((r, i) => { if (r.name && r.points.length >= 3) tag(r.name.toUpperCase(), r.points, HUDMAP.RUN[runDiff[i]], mapFont(nfs)); });
  for (const [name, ft, me, x, y, low] of ends) {
    const t2 = `${ft.toLocaleString('en-US')} FT | ${me.toLocaleString('en-US')} M`;
    g.font = mapFont(fs); const w1 = g.measureText(name).width;
    g.font = mapFont(fs * 0.8, 600); const w2 = g.measureText(t2).width;
    const bw = Math.max(w1, w2) + 10, bh = fs * 2.2, bx = x - bw / 2, by = low ? y + 8 : y - bh - 8;
    g.fillStyle = 'rgba(255,255,255,.95)'; g.strokeStyle = '#13244d'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(bx, by, bw, bh, 3); g.fill(); g.stroke();
    g.fillStyle = '#13244d'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = mapFont(fs); g.fillText(name, x, by + 3);
    g.font = mapFont(fs * 0.8, 600); g.fillText(t2, x, by + 3 + fs * 1.1);
  }
}
function drawFullMe() {
  if (!hudMap.toScreen) return;
  const g = fullMe.getContext('2d'), w = mapWhere(), [x, y] = hudMap.toScreen(w.x, w.z);
  g.setTransform(hudMap.dpr, 0, 0, hudMap.dpr, 0, 0);
  g.clearRect(0, 0, fullMe.width, fullMe.height);
  g.translate(x, y); g.rotate(w.yaw + Math.PI); mapArrow(g, 10);
}
function setFullMap(on) {
  hudMap.full = on;
  fullEl.hidden = !on;
  miniEl.hidden = on;
  if (on) drawFullMap();
}
// minimap every other frame, full-map arrow every frame
function updateHudMap() {
  if (hudMap.full) drawFullMe();
  else if (hudMap.frame++ & 1) drawMiniMap();
}
window.addEventListener('resize', sizeHudMap);
sizeHudMap();
// M toggles the full map; on phones, a two-finger tap.
window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) setFullMap(!hudMap.full); });
{
  let t0 = 0, most = 0;
  window.addEventListener('touchstart', (e) => {
    if (most === 0) t0 = performance.now();
    most = Math.max(most, e.touches.length);
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (e.touches.length) return;
    if (most === 2 && performance.now() - t0 < 300) setFullMap(!hudMap.full);
    most = 0;
  }, { passive: true });
}
const DEBUG_ITEMS = [
  { name: 'Freecam', get: () => free.on, set: (on) => setFreecam(on) },
  { name: 'Momentum physics (off = Classic)', get: () => physics.momentum, set: (on) => { physics.momentum = on; } },
  { name: 'Assists (Momentum only)', get: () => physics.assists, set: (on) => { physics.assists = on; } },
  { name: 'Carve turns', get: () => physics.carve, set: (on) => { physics.carve = on; } },
  { name: 'Weight: lean drives the turn', get: () => physics.weight, set: (on) => { physics.weight = on; } },
  { name: 'Realistic carve cost', get: () => physics.loadDrag, set: (on) => { physics.loadDrag = on; } },
  { name: 'Crashes: Steep-style bails', get: () => physics.crashes, set: (on) => { physics.crashes = on; } },
  { name: 'Show collision shapes', get: () => physics.shapes, set: (on) => { physics.shapes = on; } },
  { name: 'Motion feel: camera tilt + lean', get: () => physics.feel, set: (on) => { physics.feel = on; } },
  { name: 'Speed readout', get: () => !speedEl.hidden, set: (on) => { speedEl.hidden = !on; } },
  { name: 'Perf stats (triangles, draws, frame ms)', get: () => perf.on, set: (on) => { perf.on = on; } },
  { name: 'Pixel look (320x180)', get: () => pixelLook, set: (on) => setPixelLook(on) },
  { name: 'Detailed runs (2 m)', get: () => patchOn, set: (on) => setPatch(on) },
  ...Object.keys(TIMES).map((k) => ({ name: TIMES[k].name, radio: true, get: () => timeOfDay === k, set: (on) => { if (on) applyTime(k); } })),
  ...STARTS.map((st) => ({ name: st.label, radio: true, get: () => META.start.x === st.x && META.start.z === st.z,
    set: (on) => { if (on) { Object.assign(META.start, st); if (free.on) setFreecam(false); toSummit(); } } })),
];
let menuSel = 0;
const menuRows = DEBUG_ITEMS.map((item, k) => {
  const li = document.createElement('li');
  li.setAttribute('role', item.radio ? 'menuitemradio' : 'menuitemcheckbox');
  li.innerHTML = `<span class="box${item.radio ? ' dot' : ''}"></span>${item.name}`;
  li.addEventListener('click', () => { menuSel = k; toggleItem(k); });
  debugEl.firstElementChild.append(li);
  return li;
});
function drawMenu() {
  menuRows.forEach((li, k) => {
    li.setAttribute('aria-checked', String(DEBUG_ITEMS[k].get()));
    li.classList.toggle('sel', k === menuSel);
  });
}
function openMenu(open) {
  debugEl.hidden = !open;
  if (open && document.pointerLockElement) document.exitPointerLock();
  drawMenu();
}
// Toggling a setting closes the menu, so freecam starts flying at once.
function toggleItem(k) {
  DEBUG_ITEMS[k].set(!DEBUG_ITEMS[k].get());
  openMenu(false);
}
// Keys the menu and freecam claim before the skier.
function debugKey(e) {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!e.repeat) openMenu(debugEl.hidden);
    return true;
  }
  // With the menu open, Enter toggles the highlighted row.
  if (!debugEl.hidden && e.code === 'Enter') {
    e.preventDefault();
    if (!e.repeat) toggleItem(menuSel);
    return true;
  }
  if (!free.on) return false;
  const f = FREE_KEYS[e.code];
  if (f) { e.preventDefault(); free.keys.add(f); }
  return true;
}
// Phones: a three-finger tap toggles the menu.
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 3) openMenu(debugEl.hidden); }, { passive: true });
function lockPointer() {
  // Without pointer lock, drag with the button held to look.
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* drag to look */ }
}
function setFreecam(on) {
  if (on === free.on) return;
  free.on = on;
  free.keys.clear(); free.vel.set(0, 0, 0); free.drag = false;
  if (on) {
    if (phase === 'back') toSummit();
    keys.clear(); keySteer = 0; touches.clear(); ptr.id = null; ptr.steer = 0; hockeyStop = false;
    free.pos.copy(camera.position);
    const d = camera.getWorldDirection(new THREE.Vector3());
    free.yaw = Math.atan2(d.x, -d.z);
    free.pitch = Math.asin(clamp(d.y, -1, 1));
    lockPointer();
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    camera.near = 0.5; camera.updateProjectionMatrix();
    cameraSnap = true;
  }
}
document.addEventListener('mousemove', (e) => {
  if (!free.on || !debugEl.hidden) return;
  if (document.pointerLockElement !== canvas && !free.drag) return;
  free.yaw = wrapAngle(free.yaw + e.movementX * FREE_LOOK);
  free.pitch = clamp(free.pitch - e.movementY * FREE_LOOK, -1.55, 1.55);
});
window.addEventListener('pointerup', () => { free.drag = false; });

let testHold = null;
function readInput(dt) {
  if (testHold) {
    input.steer = clamp(testHold.steer || 0, -1, 1);
    input.tuck = !!testHold.tuck && !testHold.brake;
    input.brake = !!testHold.brake;
    input.pole = !!testHold.pole;
    return;
  }
  const target = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
  keySteer += clamp(target - keySteer, -7 * dt, 7 * dt);
  if (!target && Math.abs(keySteer) < 0.02) keySteer = 0;
  const now = performance.now();
  const held = ptr.id !== null;
  const still = held && !ptr.passive && now - ptr.lastMove > 200 && now - ptr.t0 > 200 && Math.abs(ptr.steer) < 0.25;
  input.steer = clamp(keySteer + (held ? ptr.steer : 0), -1, 1);
  input.brake = keys.has('brake') || hockeyStop;
  input.pole = keys.has('pole') || poleSwipe;
  input.tuck = !input.brake && (keys.has('tuck') || still);
}

// ---------- Simulation ----------
const sk = {
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  heading: 0, grounded: true, airTime: 0, airMax: 0, popCD: 0,
  crashed: false, crashT: 0, landT: 0, landQ: '', skid: 0, tuck: false, brake: false, steer: 0, frame: FRAMES.stand,
  stopT: 0,
  edge: 0, spin: 0, yawRate: 0, charge: 0, poleCD: 0, poleT: 0, pole: false,
  edgeA: 0, latA: 0, roll: 0, kappa: 0, lean: 0,
};
let phase = 'ready';            // ready -> skiing -> back (fading to the summit)
let simTime = 0, backT = 0, trips = 0;
let cameraSnap = true;
const tmpN = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FLAT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function placeSkier(x, z, heading, speed) {
  sk.pos.set(x, groundY(x, z), z);
  sk.prev.copy(sk.pos);
  sk.heading = heading;
  const s = sample(x, z);
  normalFrom(s, tmpN);
  skiDir(tmpN, tmpA);
  sk.vel.copy(tmpA).multiplyScalar(speed);
  sk.grounded = true; sk.airTime = 0; sk.airMax = 0; sk.popCD = 0;
  sk.crashed = false; sk.crashT = 0; sk.landT = 0; sk.skid = 0; sk.stopT = 0;
  sk.edge = 0; sk.spin = 0; sk.yawRate = 0; sk.charge = 0; sk.poleCD = 0;
  sk.edgeA = 0; sk.latA = 0; sk.roll = 0; sk.kappa = 0; sk.lean = 0;
  cameraSnap = true;
}
function toSummit(at = META.start) {
  phase = 'ready';
  if (at === META.start) fadeEl.classList.remove('black');
  placeSkier(at.x, at.z, at.heading, 0);
  hockeyStop = false;
  // a start whose run tiles aren't loaded waits behind the fade
  const loads = runStream ? runStream(at.x, at.z, true) : [];
  if (!loads.length) { fadeEl.classList.remove('on'); return; }
  fadeEl.classList.add('on');
  Promise.all(loads).then(() => {
    if (phase === 'ready' && sk.pos.x === at.x && sk.pos.z === at.z) placeSkier(at.x, at.z, sk.heading, 0);
    fadeEl.classList.remove('on');
  });
}
// Lift ride: fade, ride (the camera follows her chair), fade, stand at the top.
// ride.t counts up from -FADE while the screen goes black, then through the ride.
const FADE = 0.45;
function startRide(R) {
  phase = 'ride';
  Object.assign(ride, { lp: null, chair: null, R, t: -FADE, d: R.d0 });
  sk.vel.set(0, 0, 0);
  sk.edgeA = sk.lean = 0;
  hockeyStop = false;
  fadeEl.classList.add('black', 'on');
}
function skipRide() {
  if (phase !== 'ride' || ride.t < 0) return;
  phase = 'unload';
  backT = 0;
  fadeEl.classList.add('on');
}
function rideStep(dt) {
  const R = ride.R;
  if (phase === 'unload') {
    if ((backT += dt) <= FADE) return;
    ride.lp = ride.chair = null;
    toSummit(R.top);
    return;
  }
  const was = ride.t;
  ride.t += dt;
  if (was < 0 && ride.t >= 0) {
    // black: seat her at the loading spot and fade in
    ride.lp = R.lp; ride.chair = R.chair;
    fadeEl.classList.remove('on');
    cameraSnap = true;
  }
  if (ride.t < 0) return;
  ride.d = Math.min(R.d1, R.d0 + ride.t * R.lp.speed);
  carrierAt(R.lp, ride.d, rideAt);
  sk.prev.copy(sk.pos);
  sk.pos.set(rideAt.x, rideAt.y, rideAt.z);
  sk.heading = Math.atan2(rideAt.fx, -rideAt.fz);
  if (ride.d >= R.d1 - R.lp.speed * FADE) skipRide();
}
const rideAt = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fx: 0, fz: 0 };
function wake() {
  if (phase === 'ready') {
    phase = 'skiing';
    placeSkier(sk.pos.x, sk.pos.z, sk.heading, PUSH);
    input.jump = false;
  }
}
// The trip back up: fade out, then stand at the summit again.
function sendBack() {
  if (phase !== 'skiing') return;
  phase = 'back';
  backT = 0;
  trips++;
  fadeEl.classList.add('on');
}

function skiDir(n, out) {
  out.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  out.addScaledVector(n, -out.dot(n));
  return out.normalize();
}

function groundStep(dt) {
  if (physics.momentum) { groundStepM(dt); return; }
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const surf = surfaceAt(sk.pos.x, sk.pos.z);
  const nAcc = G * n.y;

  // Steering turns the skis; the snow decides how much the path follows.
  sk.heading += sk.steer * TURN_RATE * (sk.tuck ? TUCK_TURN : 1) * dt;
  const slope = Math.hypot(s0.gx, s0.gz);
  if (slope > 0.03) {
    const fall = Math.atan2(-s0.gx, s0.gz);
    sk.heading = fall + clamp(wrapAngle(sk.heading - fall), -MAX_HEADING, MAX_HEADING);
  }
  sk.heading = wrapAngle(sk.heading);
  const f = skiDir(n, tmpF);

  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));

  let speed = sk.vel.length();
  sk.skid = 0;
  if (speed < 0.3) {
    // Nearly stopped: no sideways slide, no sliding backwards.
    const along = sk.vel.dot(f);
    sk.vel.copy(f).multiplyScalar(Math.max(0, along));
    speed = sk.vel.length();
  } else {
    // Edge grip bends velocity toward the skis; within the limit it's a carve, the rest a skid that bleeds speed.
    tmpA.copy(sk.vel).divideScalar(speed);
    const cosA = tmpA.dot(f);
    const sinA = tmpB.crossVectors(tmpA, f).dot(n);
    const alpha = Math.atan2(sinA, cosA);
    const omega = (surf.grip * (sk.tuck ? TUCK_GRIP : 1) * nAcc) / Math.max(speed, 1.5);
    const turn = clamp(alpha, -omega * dt, omega * dt);
    const c = Math.cos(turn), sn = Math.sin(turn);
    tmpB.crossVectors(n, sk.vel);
    sk.vel.multiplyScalar(c).addScaledVector(tmpB, sn);
    const rest = Math.abs(alpha - turn);
    sk.skid = rest > Math.PI / 2 ? 1 : Math.sin(rest);
  }

  if (speed > 0) {
    const drag = DRAG * (sk.tuck ? TUCK_DRAG : 1) * speed * speed + (speed > SPEED_CAP ? CAP_DRAG * (speed - SPEED_CAP) ** 2 : 0);
    let fric = surf.friction * nAcc;
    // Nearly stopped, friction never quite beats the slope, so pointing downhill always restarts you.
    if (speed < 2) fric = Math.min(fric, 0.8 * G * Math.hypot(n.x, n.z));
    const decel = fric + drag + SKID * sk.skid * nAcc + (sk.brake ? BRAKE : 0);
    const next = Math.max(0, speed - decel * dt);
    sk.vel.multiplyScalar(next / speed);
  }

  // Jump: pop along the slope normal.
  sk.popCD = Math.max(0, sk.popCD - dt);
  let popped = false;
  if (input.jump && sk.popCD === 0) {
    sk.vel.addScaledVector(n, POP);
    sk.popCD = POP_COOLDOWN;
    popped = true;
  }

  sk.pos.addScaledVector(sk.vel, dt);
  const s1 = sample(sk.pos.x, sk.pos.z);
  const gap = sk.pos.y - s1.h;
  // Ground falling away faster than gravity can follow: airborne.
  if (popped || gap > 0.5 * nAcc * dt * dt + TAKEOFF_MARGIN) {
    sk.grounded = false;
    sk.airTime = 0;
    sk.airMax = Math.max(0, gap);
    return;
  }
  sk.pos.y = s1.h;
  const n1 = normalFrom(s1, tmpN);
  const sp = sk.vel.length();
  sk.vel.addScaledVector(n1, -sk.vel.dot(n1));
  const sp1 = sk.vel.length();
  if (sp1 > 1e-6) sk.vel.multiplyScalar(sp / sp1);
}

function airStep(dt) {
  if (physics.momentum) { airStepM(dt); return; }
  sk.heading = wrapAngle(sk.heading + sk.steer * AIR_TURN * dt);
  const speed = sk.vel.length();
  sk.vel.y -= G * AIR_G * dt;
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, 1 - DRAG * speed * dt));
  sk.pos.addScaledVector(sk.vel, dt);
  sk.airTime += dt;
  const s = sample(sk.pos.x, sk.pos.z);
  sk.airMax = Math.max(sk.airMax, sk.pos.y - s.h);
  if (sk.pos.y <= s.h) land(s);
}

function land(s) {
  if (physics.momentum) { landM(s); return; }
  const n = normalFrom(s, tmpN);
  sk.pos.y = s.h;
  const vn = sk.vel.dot(n);
  const impact = Math.max(0, -vn);
  sk.vel.addScaledVector(n, -vn);
  sk.grounded = true;
  const real = sk.airTime > REAL_AIR || sk.airMax > 0.5;
  sk.airTime = 0; sk.airMax = 0;
  if (!real) return;
  const f = skiDir(n, tmpF);
  const speed = sk.vel.length();
  const miss = speed > 2 ? Math.acos(clamp(sk.vel.dot(f) / speed, -1, 1)) : 0;
  if (miss > SLOPPY_LAND || impact > CRASH_IMPACT) {
    crash();
  } else if (miss > CLEAN_LAND || impact > HARD_IMPACT) {
    sk.vel.multiplyScalar(SLOPPY_KEEP);
    sk.landT = 0.45; sk.landQ = 'sloppy';
  } else {
    sk.landT = 0.25; sk.landQ = 'clean';
  }
}

// ---------- Momentum model ----------
const travelYaw = () => Math.atan2(sk.vel.x, -sk.vel.z);

function groundStepM(dt) {
  if (physics.carve) { groundStepC(dt); return; }
  const A = assist();
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const surf = surfaceAt(sk.pos.x, sk.pos.z);
  const nAcc = G * n.y;
  let speed = sk.vel.length();
  const yaw0 = travelYaw();

  // Edging takes a moment; the skis pivot slower the faster you go.
  sk.edge += (Math.abs(sk.steer) - sk.edge) * Math.min(1, MO.EDGE_IN * dt);
  sk.heading = wrapAngle(sk.heading + sk.steer * (MO.PIVOT / (1 + speed / MO.PIVOT_FALL)) * (sk.tuck ? TUCK_TURN : 1) * dt);
  const f = skiDir(n, tmpF);

  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));

  speed = sk.vel.length();
  sk.skid = 0;
  if (speed < 0.3) {
    const along = sk.vel.dot(f);
    sk.vel.copy(f).multiplyScalar(Math.max(0, along));
    speed = sk.vel.length();
  } else {
    // Sideways push is capped at grip x normal force (more with lean); it bends momentum, the excess is a skid.
    tmpA.copy(sk.vel).divideScalar(speed);
    const alpha = Math.atan2(tmpB.crossVectors(tmpA, f).dot(n), tmpA.dot(f));
    const grip = surf.grip * A.grip * (1 + MO.EDGE_GRIP * sk.edge) * (sk.tuck ? TUCK_GRIP : 1);
    const omega = (grip * nAcc) / Math.max(speed, 1.5);
    const turn = clamp(alpha, -omega * dt, omega * dt);
    tmpB.crossVectors(n, sk.vel);
    sk.vel.multiplyScalar(Math.cos(turn)).addScaledVector(tmpB, Math.sin(turn));
    const rest = Math.abs(alpha - turn);
    sk.skid = rest > Math.PI / 2 ? 1 : Math.sin(rest);
  }

  if (speed > 0) {
    const drag = (sk.tuck ? MO.TUCK_DRAG : MO.DRAG) * speed * speed + (speed > A.cap ? A.capDrag * (speed - A.cap) ** 2 : 0);
    let fric = surf.friction * nAcc;
    if (speed < 2) fric = Math.min(fric, 0.8 * G * Math.hypot(n.x, n.z));
    const decel = fric + drag + SKID * sk.skid * nAcc + (sk.brake ? BRAKE : 0);
    const next = Math.max(0, speed - decel * dt);
    sk.vel.multiplyScalar(next / speed);
    speed = next;
  }

  // Poles: a push along the skis, strong from a standstill, none once moving.
  sk.poleCD = Math.max(0, sk.poleCD - dt);
  if (sk.pole && sk.poleCD === 0 && speed < MO.POLE_MAX) {
    sk.vel.addScaledVector(f, MO.POLE * (1 - speed / MO.POLE_MAX));
    sk.poleCD = MO.POLE_EVERY;
    sk.poleT = 0.22;
  }

  // Path turn rate, carried into the air as spin.
  sk.yawRate += (wrapAngle(travelYaw() - yaw0) / dt - sk.yawRate) * 0.3;

  // Ollie: hold jump to load, release to pop, partly off the slope and partly straight up.
  sk.popCD = Math.max(0, sk.popCD - dt);
  let popped = false;
  if (input.jump && sk.popCD === 0) {
    const pop = MO.OLLIE_MIN + (MO.OLLIE_MAX - MO.OLLIE_MIN) * clamp(sk.charge / MO.OLLIE_CHARGE, 0, 1);
    sk.vel.addScaledVector(n, pop * (1 - MO.OLLIE_UP)).addScaledVector(UP, pop * MO.OLLIE_UP);
    sk.popCD = POP_COOLDOWN;
    popped = true;
    sk.charge = 0;
  }

  sk.pos.addScaledVector(sk.vel, dt);
  const s1 = sample(sk.pos.x, sk.pos.z);
  const gap = sk.pos.y - s1.h;
  if (popped || gap > 0.5 * nAcc * dt * dt + TAKEOFF_MARGIN) {
    sk.grounded = false;
    sk.airTime = 0;
    sk.airMax = Math.max(0, gap);
    sk.spin = sk.yawRate;
    return;
  }
  sk.pos.y = s1.h;
  const n1 = normalFrom(s1, tmpN);
  const sp = sk.vel.length();
  sk.vel.addScaledVector(n1, -sk.vel.dot(n1));
  const sp1 = sk.vel.length();
  if (sp1 > 1e-6) sk.vel.multiplyScalar(sp / sp1);
}

// ---------- Carve model ----------
function groundStepC(dt) {
  const A = assist();
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const surf = surfaceAt(sk.pos.x, sk.pos.z);
  const nAcc = G * n.y;
  let speed = sk.vel.length();
  const yaw0 = travelYaw();

  // Steering asks for a share of the tightest clean turn at this speed: 7 m slow, wider with v^2.
  const latMax = surf.grip * CV.LAT_GRIP * (A.grip > 1 ? 1.1 : 1) * (sk.tuck ? TUCK_GRIP : 1) * nAcc;
  const kMax = Math.min(1 / CV.R_MIN, (CV.CLEAN * latMax) / Math.max(speed * speed, 1)) * (sk.tuck ? CV.TUCK_TURN : 1);
  // Edge changes take a moment.
  if (physics.weight) {
    // The stick sets the wanted lean; the body follows with a lag. The lean bends the ski: radius = v^2 / (g tan lean),
    // so a held lean tightens as the turn climbs and slows: the turn finishes itself.
    const leanMax = Math.atan2(kMax * speed * speed, nAcc);
    sk.lean += (clamp(sk.steer, -1, 1) * leanMax - sk.lean) * (1 - Math.exp(-dt / CV.LEAN_T));
    const kHold = Math.tan(sk.lean) * nAcc / Math.max(speed * speed, 1);
    sk.kappa = clamp(kHold, -1.15 / CV.R_MIN, 1.15 / CV.R_MIN);
  } else {
    const kStep = (2 / CV.R_MIN / CV.EDGE_SWAP) * dt;
    sk.kappa = clamp(sk.kappa + clamp(clamp(sk.steer, -1, 1) * kMax - sk.kappa, -kStep, kStep), -kMax * 1.15, kMax * 1.15);
    sk.lean = Math.atan2(sk.kappa * speed * speed, nAcc);
  }
  let skiRate = sk.kappa * speed;
  // Slow, the skis pivot instead; brake + steer throws them sideways.
  skiRate += sk.steer * CV.PIVOT / (1 + speed / CV.PIVOT_V);
  const skidTurn = sk.brake && Math.abs(sk.steer) > 0.2;
  if (skidTurn) skiRate += sk.steer * CV.SKID_TURN;
  sk.heading = wrapAngle(sk.heading + skiRate * dt);
  // Lean that balances the turn (sprite and camera).
  sk.edgeA = Math.atan2(sk.kappa * speed * speed, nAcc);
  sk.edge = Math.min(1, Math.abs(sk.edgeA) / 1.1);
  const f = skiDir(n, tmpF);

  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));

  speed = sk.vel.length();
  sk.skid = 0;
  if (speed < 0.3) {
    const along = sk.vel.dot(f);
    sk.vel.copy(f).multiplyScalar(Math.max(0, along));
    speed = sk.vel.length();
  } else {
    // The edge pushes sideways up to the snow's grip (about 1.6 g groomed); past it the rest is a skid.
    tmpA.copy(sk.vel).divideScalar(speed);
    const alpha = Math.atan2(tmpB.crossVectors(tmpA, f).dot(n), tmpA.dot(f));
    const omega = latMax / Math.max(speed, 1.5);
    const turn = clamp(alpha, -omega * dt, omega * dt);
    tmpB.crossVectors(n, sk.vel);
    sk.vel.multiplyScalar(Math.cos(turn)).addScaledVector(tmpB, Math.sin(turn));
    const rest = Math.abs(alpha - turn);
    sk.skid = rest > Math.PI / 2 ? 1 : Math.sin(rest);
  }

  if (speed > 0) {
    const air = Math.exp(-sk.pos.y / CV.AIR_SCALE);
    const drag = (sk.tuck ? CV.TUCK_DRAG : CV.DRAG) * air * speed * speed + (speed > A.cap ? A.capDrag * (speed - A.cap) ** 2 : 0);
    let fric = surf.friction * (0.6 + 0.6 / (1 + speed / CV.GLIDE)) * nAcc;
    if (speed < 2) fric = Math.min(fric, 0.8 * G * Math.hypot(n.x, n.z));
    const brake = sk.brake ? (skidTurn ? CV.SKID_BRAKE : BRAKE) : 0;
    // A clean carve costs only the extra friction from the load (1.5 g sideways presses 1.8x harder). Skids scrub the real speed.
    const lat = Math.abs(sk.kappa) * speed * speed;
    const carveCost = physics.loadDrag ? (fric / nAcc) * (Math.hypot(nAcc, lat) - nAcc) : CV.CARVE_DRAG * lat;
    const decel = fric + drag + SKID * sk.skid * nAcc + brake + carveCost;
    const next = Math.max(0, speed - decel * dt);
    sk.vel.multiplyScalar(next / speed);
    speed = next;
  }

  sk.poleCD = Math.max(0, sk.poleCD - dt);
  if (sk.pole && sk.poleCD === 0 && speed < MO.POLE_MAX) {
    sk.vel.addScaledVector(f, MO.POLE * (1 - speed / MO.POLE_MAX));
    sk.poleCD = MO.POLE_EVERY;
    sk.poleT = 0.22;
  }

  // Path turn rate and sideways g: spin for jumps, bank for the camera.
  sk.yawRate += (wrapAngle(travelYaw() - yaw0) / dt - sk.yawRate) * 0.3;
  sk.latA = sk.yawRate * speed;

  sk.popCD = Math.max(0, sk.popCD - dt);
  let popped = false;
  if (input.jump && sk.popCD === 0) {
    const pop = MO.OLLIE_MIN + (MO.OLLIE_MAX - MO.OLLIE_MIN) * clamp(sk.charge / MO.OLLIE_CHARGE, 0, 1);
    sk.vel.addScaledVector(n, pop * (1 - MO.OLLIE_UP)).addScaledVector(UP, pop * MO.OLLIE_UP);
    sk.popCD = POP_COOLDOWN;
    popped = true;
    sk.charge = 0;
  }

  sk.pos.addScaledVector(sk.vel, dt);
  const s1 = sample(sk.pos.x, sk.pos.z);
  const gap = sk.pos.y - s1.h;
  if (popped || gap > 0.5 * nAcc * dt * dt + TAKEOFF_MARGIN) {
    sk.grounded = false;
    sk.airTime = 0;
    sk.airMax = Math.max(0, gap);
    sk.spin = sk.yawRate;
    sk.latA = 0;
    return;
  }
  sk.pos.y = s1.h;
  const n1 = normalFrom(s1, tmpN);
  const sp = sk.vel.length();
  sk.vel.addScaledVector(n1, -sk.vel.dot(n1));
  const sp1 = sk.vel.length();
  if (sp1 > 1e-6) sk.vel.multiplyScalar(sp / sp1);
}

function airStepM(dt) {
  const A = assist();
  // Air steering torques the spin; let go and it carries on.
  if (sk.steer) sk.spin += sk.steer * MO.SPIN_IN * dt;
  else {
    sk.spin *= Math.max(0, 1 - MO.SPIN_DAMP * dt);
    // Assist: with nothing held and little spin, the skis drift back in line with travel.
    if (A.align && Math.abs(sk.spin) < 2) {
      sk.spin *= Math.max(0, 1 - 3 * dt);
      sk.heading += clamp(wrapAngle(travelYaw() - sk.heading), -A.align * dt, A.align * dt);
    }
  }
  sk.heading = wrapAngle(sk.heading + sk.spin * (sk.tuck ? MO.SPIN_TUCK : 1) * dt);
  const speed = sk.vel.length();
  sk.vel.y -= G * A.airG * dt;
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, 1 - (sk.tuck ? MO.TUCK_DRAG : MO.DRAG) * speed * dt));
  sk.pos.addScaledVector(sk.vel, dt);
  sk.airTime += dt;
  const s = sample(sk.pos.x, sk.pos.z);
  sk.airMax = Math.max(sk.airMax, sk.pos.y - s.h);
  if (sk.pos.y <= s.h) land(s);
}

// Landing keeps the momentum along the slope and absorbs only the part into the snow:
// steep landings keep speed, flat ones from high up hurt.
function landM(s) {
  const A = assist();
  const n = normalFrom(s, tmpN);
  sk.pos.y = s.h;
  const vn = sk.vel.dot(n);
  const impact = Math.max(0, -vn);
  sk.vel.addScaledVector(n, -vn);
  sk.grounded = true;
  sk.spin = 0;
  const real = sk.airTime > REAL_AIR || sk.airMax > 0.5;
  sk.airTime = 0; sk.airMax = 0;
  if (!real) return;
  const f = skiDir(n, tmpF);
  const speed = sk.vel.length();
  const miss = speed > 2 ? Math.acos(clamp(sk.vel.dot(f) / speed, -1, 1)) : 0;
  if (physics.crashes && (miss > BAIL.MISS * Math.PI / 180 || impact > BAIL.IMPACT)) {
    startBail(null, impact);
  } else if (miss > A.clean * Math.PI / 180 || impact > HARD_IMPACT) {
    // The skis scrub off speed that isn't along them.
    sk.vel.multiplyScalar(Math.max(0.4, Math.cos(miss)));
    sk.landT = 0.45; sk.landQ = 'sloppy';
  } else {
    sk.landT = 0.25; sk.landQ = 'clean';
  }
}

function crashStepM(dt) {
  sk.crashT += dt;
  if (!sk.grounded) { airStepM(dt); return; }
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const nAcc = G * n.y;
  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));
  const speed = sk.vel.length();
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, speed - (MO.CRASH_MU * nAcc + MO.CRASH_BASE) * dt) / speed);
  sk.pos.addScaledVector(sk.vel, dt);
  sk.pos.y = groundY(sk.pos.x, sk.pos.z);
  if ((sk.crashT > 1.6 && speed < 0.8) || sk.crashT > MO.CRASH_MAX) {
    const s = sample(sk.pos.x, sk.pos.z);
    placeSkier(sk.pos.x, sk.pos.z, Math.atan2(-s.gx, s.gz), PUSH);
  }
}

function crash() {
  if (!physics.crashes) return;
  startBail(null, 0);
}

// ---------- The pill, the plate and the bail box ----------
const bail = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), still: 0 };
const BAIL_I = new THREE.Vector3((BAIL.T ** 2 + BAIL.L ** 2) / 12, (BAIL.W ** 2 + BAIL.L ** 2) / 12, (BAIL.W ** 2 + BAIL.T ** 2) / 12);
const BOX_C = [];
for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) BOX_C.push(new THREE.Vector3(a * BAIL.W / 2, b * BAIL.T / 2, c * BAIL.L / 2));
const bodyAxis = new THREE.Vector3(), bodyHit = new THREE.Vector3(), bodyP = new THREE.Vector3(), bodyN = new THREE.Vector3();
const bqi = new THREE.Quaternion(), bQ = new THREE.Quaternion(), bR = new THREE.Vector3(), bP = new THREE.Vector3(), bV = new THREE.Vector3();
const bN = new THREE.Vector3(), bT = new THREE.Vector3(), bA = new THREE.Vector3(), bJ = new THREE.Vector3(), bM = new THREE.Vector3();
const bS = { h: 0, gx: 0, gz: 0 }, bMat = new THREE.Matrix4();
// the pill's up axis, tipped by her lean
function leanAxis(out) {
  const L = sk.grounded ? (sk.lean || sk.edgeA) : 0;
  return out.set(Math.cos(sk.heading) * Math.sin(L), Math.cos(L), Math.sin(sk.heading) * Math.sin(L));
}
// deepest ball overlap with any solid box: depth (0 for none), push-out direction in n
function ballVsSolids(px, py, pz, r, n) {
  let best = 0;
  for (const b of solidsAt(px, pz)) {
    // quick reject: hx + hz reaches past any corner
    if (Math.abs(px - b.x) > b.hx + b.hz + r || Math.abs(pz - b.z) > b.hx + b.hz + r) continue;
    const dx = px - b.x, dz = pz - b.z, u = b.c * dx - b.s * dz, v = b.s * dx + b.c * dz, y = py - b.y;
    let eu = u - clamp(u, -b.hx, b.hx), ey = y - clamp(y, -b.hy, b.hy), ev = v - clamp(v, -b.hz, b.hz), depth;
    const d = Math.hypot(eu, ey, ev);
    if (d > 1e-6) {
      if (d >= r) continue;
      depth = r - d; eu /= d; ey /= d; ev /= d;
    } else {                    // centre inside: out through the nearest face
      const fu = b.hx - Math.abs(u), fy = b.hy - Math.abs(y), fv = b.hz - Math.abs(v);
      eu = ey = ev = 0;
      if (fu <= fy && fu <= fv) { eu = Math.sign(u) || 1; depth = fu + r; }
      else if (fy <= fv) { ey = Math.sign(y) || 1; depth = fy + r; }
      else { ev = Math.sign(v) || 1; depth = fv + r; }
    }
    if (depth > best) { best = depth; n.set(b.c * eu + b.s * ev, ey, -b.s * eu + b.c * ev); }
  }
  return best;
}
// The pill against walls and boxes, swept along the step so fast skiers can't tunnel. Glancing hits slide; square fast hits bail.
function solidCollide() {
  if (!SOLIDS.length || sk.crashed) return;
  leanAxis(bodyAxis);
  const n = Math.max(1, Math.ceil(sk.prev.distanceTo(sk.pos) / 0.15));
  for (let k = 1; k <= n; k++) {
    bodyP.lerpVectors(sk.prev, sk.pos, k / n);
    let depth = 0;
    for (let t = 0; t <= 1; t += 0.5) {
      const h = BODY.R + t * (BODY.H - 2 * BODY.R);
      const d = ballVsSolids(bodyP.x + bodyAxis.x * h, bodyP.y + bodyAxis.y * h, bodyP.z + bodyAxis.z * h, BODY.R, bodyN);
      if (d > depth && Math.abs(bodyN.y) < 0.7) { depth = d; bodyHit.copy(bodyN); }
    }
    if (!depth) continue;
    bodyHit.y = 0;
    if (bodyHit.lengthSq() < 0.09) return;
    bodyHit.normalize();
    sk.pos.copy(bodyP).addScaledVector(bodyHit, depth);
    if (sk.grounded) sk.pos.y = groundY(sk.pos.x, sk.pos.z);
    const into = sk.vel.dot(bodyHit);
    if (into >= 0) return;
    if (physics.crashes && -into > BAIL.HIT) { startBail(bodyHit, -into); return; }
    sk.vel.addScaledVector(bodyHit, -into);
    const along = sk.vel.length();
    sk.vel.multiplyScalar(1 - 0.5 * (-into / (along - into)));   // square hits scrub more
    // pinned on a slope: ease along the downhill side
    if (sk.grounded && Math.hypot(sk.vel.x, sk.vel.z) < 1) {
      const s = sample(sk.pos.x, sk.pos.z);
      const side = (-bodyHit.z * -s.gx + bodyHit.x * -s.gz) >= 0 ? 1 : -1;
      sk.vel.x = -bodyHit.z * side * 1.2;
      sk.vel.z = bodyHit.x * side * 1.2;
    }
    return;
  }
}
// Bail: the pill and plate become one flat box, keeping her speed. A wall hit (n = outward face normal) bounces
// and flips her backward; a bad landing pitches her forward and rolls her toward her slide.
function startBail(n, hit) {
  leanAxis(bodyAxis);
  bA.set(Math.cos(sk.heading), 0, Math.sin(sk.heading));
  bA.addScaledVector(bodyAxis, -bA.dot(bodyAxis)).normalize();
  bJ.crossVectors(bodyAxis, bA);
  bail.q.setFromRotationMatrix(bMat.makeBasis(bA, bJ, bodyAxis));
  bail.pos.copy(sk.pos).addScaledVector(bodyAxis, BAIL.L / 2 + 0.05);
  bail.vel.copy(sk.vel);
  const speed = Math.hypot(sk.vel.x, sk.vel.z);
  if (n) {
    bail.vel.addScaledVector(n, -1.25 * bail.vel.dot(n)).multiplyScalar(0.6);
    bail.w.crossVectors(UP, n).multiplyScalar(clamp(hit * 0.45, 2, 9));
  } else {
    bM.set(sk.vel.x, 0, sk.vel.z).normalize();
    bail.w.crossVectors(UP, bM).multiplyScalar(clamp(speed * 0.35, 2, 8));
    const side = Math.sign(bM.x * Math.cos(sk.heading) + bM.z * Math.sin(sk.heading)) || 1;
    bail.w.addScaledVector(bM, -side * clamp(speed * 0.2, 0.5, 5));
  }
  bail.w.y += (Math.random() - 0.5) * 2;
  bail.still = 0;
  sk.crashed = true; sk.crashT = 0; sk.landT = 0; sk.grounded = false;
  sk.pos.copy(bail.pos); sk.vel.copy(bail.vel);
}
function invInertia(v, out) {
  out.copy(v).applyQuaternion(bqi);
  out.set(out.x / BAIL_I.x, out.y / BAIL_I.y, out.z / BAIL_I.z);
  return out.applyQuaternion(bail.q);
}
// speed change along d at r (from the centre) per unit impulse along d
function pointMass(r, d) {
  invInertia(bA.crossVectors(r, d), bA);
  return 1 + d.dot(bA.cross(r));
}
function push(r, J) {
  bail.vel.add(J);
  bail.w.add(invInertia(bA.crossVectors(r, J), bA));
}
// The bail box as a rigid body: eight corners hit snow and box tops with bounce and friction.
function bailStep(dt) {
  sk.crashT += dt;
  const SUB = 3, h = dt / SUB;
  let contact = false;
  for (let k = 0; k < SUB; k++) {
    bail.vel.y -= G * h;
    bail.pos.addScaledVector(bail.vel, h);
    const wl = bail.w.length();
    if (wl > 1e-6) bail.q.premultiply(bQ.setFromAxisAngle(bA.copy(bail.w).divideScalar(wl), wl * h)).normalize();
    bail.w.multiplyScalar(1 - 0.3 * h);
    bqi.copy(bail.q).invert();
    let deep = 0;
    for (let it = 0; it < 2; it++) {
      for (const c of BOX_C) {
        bR.copy(c).applyQuaternion(bail.q);
        bP.copy(bail.pos).add(bR);
        solidY = bP.y + 0.3;
        sample(bP.x, bP.z, bS);
        const pen = bS.h - bP.y;
        if (pen <= 0) continue;
        contact = true;
        normalFrom(bS, bN);
        if (it === 0 && pen > deep) { deep = pen; bM.copy(bN); }
        bV.crossVectors(bail.w, bR).add(bail.vel);
        const vn = bV.dot(bN);
        if (vn >= 0) continue;
        const jn = -(1 + (it === 0 ? BAIL.E : 0)) * vn / pointMass(bR, bN);
        push(bR, bJ.copy(bN).multiplyScalar(jn));
        bV.crossVectors(bail.w, bR).add(bail.vel);
        bT.copy(bV).addScaledVector(bN, -bV.dot(bN));
        const vt = bT.length();
        if (vt > 1e-4) {
          bT.divideScalar(vt);
          push(bR, bJ.copy(bT).multiplyScalar(-Math.min(vt / pointMass(bR, bT), BAIL.MU * jn)));
        }
      }
    }
    if (deep > 0) bail.pos.addScaledVector(bM, deep * 0.8);
    // walls and box sides
    const d = ballVsSolids(bail.pos.x, bail.pos.y, bail.pos.z, 0.35, bN);
    if (d) {
      bail.pos.addScaledVector(bN, d);
      const vn = bail.vel.dot(bN);
      if (vn < 0) bail.vel.addScaledVector(bN, -1.2 * vn);
    }
  }
  if (contact) bail.w.multiplyScalar(1 - 1.2 * dt);
  sk.pos.copy(bail.pos); sk.vel.copy(bail.vel);
  bail.still = contact && bail.vel.length() < 0.6 && bail.w.length() < 1 ? bail.still + dt : 0;
  if ((bail.still > 0.5 && sk.crashT > 1) || sk.crashT > BAIL.MAX) {
    solidY = bail.pos.y;
    const s = sample(bail.pos.x, bail.pos.z);
    placeSkier(bail.pos.x, bail.pos.z, Math.atan2(-s.gx, s.gz), PUSH);
  }
}

function crashStep(dt) {
  if (physics.momentum) { crashStepM(dt); return; }
  sk.crashT += dt;
  if (!sk.grounded) { airStep(dt); return; }
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const nAcc = G * n.y;
  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));
  const speed = sk.vel.length();
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, speed - CRASH_DECEL * dt) / speed);
  sk.pos.addScaledVector(sk.vel, dt);
  sk.pos.y = groundY(sk.pos.x, sk.pos.z);
  if (sk.crashT > 1.6 && speed < 0.8) {
    // Get up where you stopped, facing down the fall line, with a push.
    const s = sample(sk.pos.x, sk.pos.z);
    placeSkier(sk.pos.x, sk.pos.z, Math.atan2(-s.gx, s.gz), PUSH);
  }
}

function treeCollide() {
  const ix = Math.floor(sk.pos.x / 8), iz = Math.floor(sk.pos.z / 8);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const list = treeCells.get(cellKey(ix + a, iz + b));
      if (!list) continue;
      for (const t of list) {
        const dx = sk.pos.x - t.x, dz = sk.pos.z - t.z;
        const r = t.r + SKIER_R;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || sk.pos.y > t.y + t.height * 0.8) continue;
        const dist = Math.sqrt(d2) || 0.001;
        const nx = dx / dist, nz = dz / dist;
        sk.pos.x = t.x + nx * r;
        sk.pos.z = t.z + nz * r;
        if (sk.grounded) sk.pos.y = groundY(sk.pos.x, sk.pos.z);
        const into = sk.vel.x * nx + sk.vel.z * nz;
        if (into >= 0) continue;
        if (!sk.crashed && physics.crashes && -into > BAIL.HIT) {
          startBail(tmpB.set(nx, 0, nz), -into);
        } else {
          // Brushing a trunk: lose the speed into it and slide round; a real knock is a hard stop.
          sk.vel.x -= into * nx;
          sk.vel.z -= into * nz;
          if (-into > 1) sk.vel.multiplyScalar(0.3);
          // stopped dead against it: ease round on the downhill side
          if (!sk.crashed && sk.grounded && Math.hypot(sk.vel.x, sk.vel.z) < 1) {
            const s = sample(sk.pos.x, sk.pos.z);
            const side = (-nz * -s.gx + nx * -s.gz) >= 0 ? 1 : -1;
            sk.vel.x = -nz * side * 1.2;
            sk.vel.z = nx * side * 1.2;
          }
        }
      }
    }
  }
}
// Collisions need the trees around the skier before the camera draws them.
function ensureTreesNear(x, z) {
  const P = PAGE * CELL;
  const pi = Math.floor((x - X0) / P), pj = Math.floor((z - Z0) / P);
  for (let b = pj - 1; b <= pj + 1; b++) for (let a = pi - 1; a <= pi + 1; a++) {
    if (a >= 0 && b >= 0 && a * PAGE < NX && b * PAGE < NZ) makePage(a, b);
  }
}

function step() {
  const dt = STEP;
  simTime += dt;
  readInput(dt);
  const jumpPressed = input.jump;
  input.jump = false;
  if (phase === 'back') {
    if ((backT += dt) > 0.45) toSummit();
    return;
  }
  if (phase === 'ride' || phase === 'unload') { rideStep(dt); return; }
  if (phase === 'ready') {
    sk.prev.copy(sk.pos);
    return;
  }
  sk.steer = input.steer;
  sk.tuck = input.tuck;
  sk.brake = input.brake;
  if (physics.momentum) {
    sk.pole = input.pole && !sk.brake;
    if (keys.has('jump') && sk.grounded && !sk.crashed) { sk.charge += dt; sk.tuck = true; }
    else if (!jumpPressed) sk.charge = 0;
  } else sk.pole = false;
  sk.poleT = Math.max(0, sk.poleT - dt);
  input.jump = jumpPressed && sk.grounded && !sk.crashed;

  sk.prev.copy(sk.pos);
  solidY = sk.pos.y;
  if (sk.crashed) bailStep(dt);
  else if (sk.grounded) groundStep(dt);
  else airStep(dt);
  input.jump = false;
  if (hockeyStop && (sk.vel.length() < 1 || sk.crashed || !sk.grounded)) hockeyStop = false;
  // a swipe's push waits out the pole cooldown, not a fall or jump
  if (poleSwipe && (sk.poleT > 0 || sk.crashed || !sk.grounded || !physics.momentum)) poleSwipe = false;
  sk.landT = Math.max(0, sk.landT - dt);
  ensureTreesNear(sk.pos.x, sk.pos.z);
  solidY = sk.pos.y;
  treeCollide();
  if (sk.crashed) { bail.pos.x = sk.pos.x; bail.pos.z = sk.pos.z; bail.vel.copy(sk.vel); }
  solidCollide();
  // FreePlay never dead-ends: stalled on flat ground or off the map edge, you go back to the summit.
  // Stopped on a slope never counts: you can point downhill and go.
  const under = sample(sk.pos.x, sk.pos.z);
  if (!sk.crashed && sk.grounded && sk.vel.length() < 1.5 && Math.hypot(under.gx, under.gz) < FLAT && !sk.pole) sk.stopT += dt;
  else sk.stopT = 0;
  if (sk.stopT > STOP_TIME || offMap(sk.pos.x, sk.pos.z)) sendBack();
  solidY = null;
  // into a lift's ring: ride it up
  if (phase === 'skiing' && !sk.crashed) for (const R of RIDES) {
    if (Math.hypot(sk.pos.x - R.ring.x, sk.pos.z - R.ring.z) < RING_R - 0.3 && Math.abs(sk.pos.y - R.ring.y) < 2) { startRide(R); break; }
  }
}

// ---------- Rendering ----------
const view = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, -1), camPos = new THREE.Vector3(), look = new THREE.Vector3();
const tmpC = new THREE.Vector3();
function updateCamera(p, dt) {
  const speed = sk.vel.length();
  tmpC.set(sk.vel.x, 0, sk.vel.z);
  if (sk.crashed || tmpC.lengthSq() < 4) tmpC.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  tmpC.normalize();
  if (cameraSnap) camDir.copy(tmpC);
  else camDir.lerp(tmpC, 1 - Math.exp(-2.5 * dt)).normalize();
  const back = 4.0 + speed * 0.025, up = 1.85 + speed * 0.01;
  camPos.copy(p).addScaledVector(camDir, -back);
  camPos.y = p.y + up;
  camPos.y = Math.max(camPos.y, groundY(camPos.x, camPos.z) + 1.5);
  if (cameraSnap) camera.position.copy(camPos);
  else camera.position.lerp(camPos, 1 - Math.exp(-7 * dt));
  camera.position.y = Math.max(camera.position.y, groundY(camera.position.x, camera.position.z) + 1.2);
  look.copy(p).addScaledVector(camDir, 4);
  look.y = p.y + 1.0;
  camera.lookAt(look);
  // Motion feel: the camera tilts with her lean (up to 6 degrees), easing in.
  const bankTo = physics.feel && sk.grounded && !sk.crashed ? clamp((sk.lean || sk.edgeA) * 0.11, -0.105, 0.105) : 0;
  sk.roll += (bankTo - sk.roll) * (cameraSnap ? 1 : 1 - Math.exp(-2 * dt));
  camera.rotateZ(-sk.roll);
  const fov = (physics.feel ? Math.min(78, 60 + speed * 0.4) : Math.min(66, 60 + speed * 0.22)) * (camera.aspect < 1 ? 1.15 : 1);
  if (cameraSnap) { camera.fov = fov; camera.updateProjectionMatrix(); }
  else if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  cameraSnap = false;
}

// On the chair: camera behind and above, looking up the line. RIDE_SEAT is her sprite's base below the cable.
const RIDE_SEAT = -3.05, rideLook = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fx: 0, fz: 0 };
function rideCamera(p) {
  const fx = Math.sin(sk.heading), fz = -Math.cos(sk.heading);
  const R = ride.R, ahead = Math.min(ride.d + 30, R.d1 + LOAD);
  carrierAt(R.lp, ahead, rideLook);
  camera.position.set(p.x - fx * 4.5, p.y - 1.5, p.z - fz * 4.5);
  // the sky is a band: don't tip up far enough to show its top edge
  const dist = Math.hypot(rideLook.x - camera.position.x, rideLook.z - camera.position.z);
  camera.lookAt(rideLook.x, Math.min(rideLook.y - 1.9, camera.position.y - dist * 0.02), rideLook.z);
  if (Math.abs(camera.fov - 60) > 0.05) { camera.fov = 60; camera.updateProjectionMatrix(); }
}
function pickFrame() {
  const speed = sk.vel.length();
  if (sk.crashed) return FRAMES.wipeout;
  if (!sk.grounded && sk.airTime > 0.12) return FRAMES.air;
  if (sk.landT > 0) return FRAMES.land;
  if (sk.brake && speed > 1) return FRAMES.brake;
  if (sk.tuck) return FRAMES.tuck;
  if (sk.steer > 0.3) return FRAMES.carveR;
  if (sk.steer < -0.3) return FRAMES.carveL;
  return FRAMES.stand;
}

function updateSpray(p, dt) {
  const speed = sk.vel.length();
  const amount = sk.grounded && !sk.crashed ? Math.max(sk.brake ? 1 : 0, sk.skid * 1.5) : (sk.crashed && speed > 2 ? 0.8 : 0);
  if (amount > 0.15 && speed > 3) {
    spray.debt += amount * speed * 6 * dt;
    tmpA.set(Math.cos(sk.heading), 0, Math.sin(sk.heading));
    while (spray.debt >= 1) {
      spray.debt -= 1;
      const k = spray.next;
      spray.next = (spray.next + 1) % SPRAY_N;
      const side = (Math.random() - 0.5) * 1.2;
      spray.pos[k * 3] = p.x + tmpA.x * side;
      spray.pos[k * 3 + 1] = p.y + 0.1;
      spray.pos[k * 3 + 2] = p.z + tmpA.z * side;
      const out = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 2.5);
      spray.vel[k * 3] = sk.vel.x * 0.35 + tmpA.x * out;
      spray.vel[k * 3 + 1] = 1.5 + Math.random() * 2.5;
      spray.vel[k * 3 + 2] = sk.vel.z * 0.35 + tmpA.z * out;
      spray.life[k] = 0.4 + Math.random() * 0.4;
    }
  }
  for (let k = 0; k < SPRAY_N; k++) {
    if (spray.life[k] <= 0) continue;
    spray.life[k] -= dt;
    if (spray.life[k] <= 0) { spray.pos[k * 3 + 1] = -1e4; continue; }
    spray.vel[k * 3 + 1] -= 9 * dt;
    spray.pos[k * 3] += spray.vel[k * 3] * dt;
    spray.pos[k * 3 + 1] += spray.vel[k * 3 + 1] * dt;
    spray.pos[k * 3 + 2] += spray.vel[k * 3 + 2] * dt;
  }
  sprayPoints.geometry.attributes.position.needsUpdate = true;
}

const freeF = new THREE.Vector3(), freeR = new THREE.Vector3(), freeWant = new THREE.Vector3();
function updateFreecam(dt) {
  const cp = Math.cos(free.pitch);
  freeF.set(Math.sin(free.yaw) * cp, Math.sin(free.pitch), -Math.cos(free.yaw) * cp);
  freeR.set(Math.cos(free.yaw), 0, Math.sin(free.yaw));
  const k = free.keys;
  freeWant.copy(freeF).multiplyScalar((k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0))
    .addScaledVector(freeR, (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0));
  if (freeWant.lengthSq() > 0) freeWant.normalize().multiplyScalar(FREE_SPEED * (k.has('fast') ? FREE_FAST : 1));
  free.vel.lerp(freeWant, 1 - Math.exp(-10 * dt));
  free.pos.addScaledVector(free.vel, dt);
  camera.position.copy(free.pos);
  camera.lookAt(look.copy(free.pos).add(freeF));
  // high up, push the near plane out for depth precision
  const near = clamp((free.pos.y - groundY(free.pos.x, free.pos.z)) * 0.05, 0.5, 25);
  if (Math.abs(near - camera.near) > 0.02 * camera.near) { camera.near = near; camera.updateProjectionMatrix(); }
}

function facingCam(p) {
  const dx = camera.position.x - p.x, dz = camera.position.z - p.z, l = Math.hypot(dx, dz) || 1;
  return (dx * Math.sin(sk.heading) - dz * Math.cos(sk.heading)) / l;
}
function render(alpha, dt) {
  const p = view.copy(sk.prev).lerp(sk.pos, alpha);
  const snap = cameraSnap;
  workAll = snap;
  const riding = phase === 'ride' || phase === 'unload';
  if (free.on) updateFreecam(dt);
  else if (riding) rideCamera(p);
  else updateCamera(p, dt);
  updateTerrain();
  updatePatch();
  updateKickers();
  updateTrees(snap);
  sky.position.set(camera.position.x, camera.position.y + sky.userData.h * 0.36, camera.position.z);

  // Sprite faces the camera around the vertical axis only.
  skierMesh.position.copy(p);
  if (riding) skierMesh.position.y += RIDE_SEAT;
  const yaw = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
  skierMesh.rotation.y = yaw;
  // Motion feel: she leans with her edge angle (mirrored seen from the front).
  skierMesh.rotation.z = physics.feel && sk.grounded && !sk.crashed ? -sk.edgeA * 0.55 * (facingCam(p) > 0.35 ? -1 : 1) : 0;
  // Sun in sprite space: x along its right, z toward the camera.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  skierMat.uniforms.sunLocal.value.set(SUN_DIR.x * cy - SUN_DIR.z * sy, SUN_DIR.y, SUN_DIR.x * sy + SUN_DIR.z * cy);
  tmpA.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
  // Camera angle round her (0 behind, 180 in front), snapped to the sheet's 45 degree rows; left side mirrored.
  const ahead = tmpA.x * Math.sin(sk.heading) - tmpA.z * Math.cos(sk.heading);
  const side = tmpA.x * Math.cos(sk.heading) + tmpA.z * Math.sin(sk.heading);
  const mirror = side < 0;
  let frame = riding ? FRAMES.sit : pickFrame(), row = sk.crashed ? 0 : Math.round(Math.atan2(Math.abs(side), -ahead) / (Math.PI / 4));
  if (mirror && frame === FRAMES.carveL) frame = FRAMES.carveR;
  else if (mirror && frame === FRAMES.carveR) frame = FRAMES.carveL;
  const U = skierMat.uniforms;
  U.frameCol.value = frame; U.frameRow.value = row; U.mirror.value = mirror && !sk.crashed ? 1 : 0; sk.frame = frame;
  if (sk.crashed) {
    // wipeout frame turned to lie along the bail box, centred on it
    bA.set(0, 0, 1).applyQuaternion(bail.q).transformDirection(camera.matrixWorldInverse);
    const th = Math.atan2(-bA.x, bA.y) - Math.PI, c = SPRITE_H / 2 - 0.04;
    skierMesh.rotation.z = th;
    skierMesh.position.set(p.x + c * Math.sin(th) * cy, p.y - c * Math.cos(th), p.z - c * Math.sin(th) * sy);
  }
  updateShapes(p);

  const s = sample(p.x, p.z);
  normalFrom(s, tmpN);
  shadow.position.set(p.x, s.h + 0.06, p.z);
  shadow.quaternion.setFromUnitVectors(UP, tmpN).multiply(FLAT_Q);
  const lift = Math.max(0, p.y - s.h);
  shadow.material.opacity = clamp(1 - lift / 8, 0.2, 1);
  shadow.scale.setScalar(1 + lift * 0.08);

  shadow.visible = !riding;
  if (!riding) updateSpray(p, dt);
  ringMat.uniforms.time.value = performance.now() / 1000;
  if (!speedEl.hidden) speedEl.textContent = `${Math.round(sk.vel.length() * 2.23694)} mph · ${physics.momentum ? (physics.carve ? 'Carve' : 'Momentum') + (physics.assists ? '' : ', raw') : 'Classic'} · ${(Math.abs(sk.latA) / G).toFixed(1)} g · ${fps} fps${perf.on ? ` · ${Math.round(perf.tris / 1000)}k tris · ${perf.calls} draws · ${perf.ms.toFixed(1)} ms` : ''}`;
  updateWorld(dt);
  skierMat.uniforms.uLit.value = sunAt(p.x, p.z);
  runWork();
  workAll = false;
  renderer.render(scene, camera);
  perf.tris = renderer.info.render.triangles; perf.calls = renderer.info.render.calls;
  updateHudMap();
}

// Collision shapes as wireframes (Tab: Show collision shapes)
const wire = (geo, color) => {
  const m = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  m.renderOrder = 10; m.frustumCulled = false; m.visible = false; scene.add(m);
  return m;
};
const pillWire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.CapsuleGeometry(BODY.R, BODY.H - 2 * BODY.R, 3, 10)),
  new THREE.LineBasicMaterial({ color: 0x4fe3ff, depthTest: false, transparent: true, opacity: 0.8 }));
pillWire.renderOrder = 10; pillWire.frustumCulled = false; scene.add(pillWire);
const plateWire = wire(new THREE.BoxGeometry(BODY.PLATE_W, 0.04, BODY.PLATE_L), 0xffd23f);
const boxWire = wire(new THREE.BoxGeometry(BAIL.W, BAIL.T, BAIL.L), 0xff4d4d);
const shapeF = new THREE.Vector3(), shapeR = new THREE.Vector3(), shapeU = new THREE.Vector3();
function updateShapes(p) {
  const on = physics.shapes;
  pillWire.visible = plateWire.visible = on && !sk.crashed;
  boxWire.visible = on && sk.crashed;
  if (!on) return;
  if (sk.crashed) { boxWire.position.copy(p); boxWire.quaternion.copy(bail.q); return; }
  leanAxis(shapeU);
  pillWire.position.copy(p).addScaledVector(shapeU, BODY.H / 2);
  pillWire.quaternion.setFromUnitVectors(UP, shapeU);
  // plate on the snow along her skis, rolled by her lean
  normalFrom(sample(p.x, p.z), shapeU);
  skiDir(shapeU, shapeF);
  shapeR.crossVectors(shapeF, shapeU).normalize();
  const e = sk.grounded ? (sk.lean || sk.edgeA) : 0;
  shapeU.multiplyScalar(Math.cos(e)).addScaledVector(shapeR, Math.sin(e));
  shapeR.crossVectors(shapeF, shapeU).normalize();
  plateWire.quaternion.setFromRotationMatrix(bMat.makeBasis(shapeR, shapeU, shapeF.negate()));
  plateWire.position.copy(p).addScaledVector(shapeU, 0.03);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  // pixel look: short side at 180 px, upscaled without smoothing
  renderer.setPixelRatio(pixelLook ? 180 / Math.min(w, h) : Math.min(window.devicePixelRatio || 1, 2));
  canvas.style.imageRendering = pixelLook ? 'pixelated' : 'auto';
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
// A window moved to another pixel density may not fire resize.
(function watchDensity() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { resize(); watchDensity(); }, { once: true });
})();

// ---------- Main loop ----------
let manual = false, acc = 0, last = performance.now();
let fps = 0, fpsN = 0, fpsT = 0;             // counted over half a second
const perf = { on: false, tris: 0, calls: 0, ms: 0 };   // Tab: Perf stats; ms is the game's own work per frame, smoothed
function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  fpsN++; fpsT += now - last;
  if (fpsT >= 500) { fps = Math.round(fpsN * 1000 / fpsT); fpsN = 0; fpsT = 0; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!manual && !free.on) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { step(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
  }
  render(manual ? 1 : acc / STEP, dt);
  perf.ms += (performance.now() - t0 - perf.ms) * 0.1;
}
skierMat.uniforms.frameCol.value = FRAMES.stand;
resize();
applyTime('noon');
toSummit();
requestAnimationFrame(frame);

// ---------- Test hooks ----------
window.__golden = {
  sk, input, META, physics, MO, ASSIST, CV, keys, sample, surfaceAt, renderer, camera, pages, scene,
  cover: (x, z) => { const k = cellAt(x, z); return { conifer: conifer(k), aspen: aspen(k), rock: isRock(k), powder: POWDER[k], h: H[k] }; },
  get phase() { return phase; },
  get trips() { return trips; },
  get trees() { return treeGeo.instanceCount + fillGeo.instanceCount; },
  get clumps() { return clumpGeo.instanceCount; },
  setManual(on) { manual = on; },
  get free() { return free; },
  get menuOpen() { return !debugEl.hidden; },
  freecam(on) { setFreecam(on); },
  // run n fixed steps; hold overrides input: { steer, tuck, brake, jump }
  step(n, hold) {
    testHold = hold || null;
    for (let k = 0; k < n; k++) {
      if (hold && hold.jump && k === 0) input.jump = true;
      step();
    }
    testHold = null;
    if (n > 10) cameraSnap = true;
  },
  start() { wake(); },
  place(x, z, heading = META.start.heading, speed = 0) { phase = 'skiing'; placeSkier(x, z, heading, speed); },
  snapCamera() { cameraSnap = true; },
  frame(dt = 1 / 60) { render(1, dt); },
  time(k) { applyTime(k); },
  pixel(on) { setPixelLook(on); },
  lifts: liftPaths, carriers, runs: RUNS, signs: signSpots,
  map: { get ready() { return !!hudMap.plain; }, get paintMs() { return hudMap.paintMs; }, setFull: setFullMap, drawMini: drawMiniMap },
  get patch() { return PATCH; }, patchEdge, setPatch, groundY, starts: STARTS, get fps() { return fps; },
  streamTo: (x, z) => Promise.all(runStream ? runStream(x, z, true) : []),
  solids: SOLIDS, bail, BAIL, kickers: KICKERS,
  get work() { return work.size; }, perf, rides: RIDES, ride, startRide, skipRide,
};

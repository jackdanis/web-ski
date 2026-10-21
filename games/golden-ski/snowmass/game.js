// Golden Ski mockup: the World Kit on Snowmass. A copy of the Snowmass FreePlay mockup with the kit's
// chairlifts on the real lift lines, rocks, painted shadows, lamps, the four times of day and the 320x180 look.
// Physics: the approved Momentum model (PR #7, the physics thread), switchable in the Tab menu against the
// milestone 1 model, "Classic". Sunnyside and Max Park are detailed 2 m runs.
// World units are meters. x is east and z is south of the FreePlay start, y is meters above sea level.
// The mountain is USGS 3DEP elevation at 10 m; trees and runs come from a Sentinel-2 photo (26 March 2025).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from './data.js';

// ---------- Tuning (design book, chapter 05; unchanged from milestone 1) ----------
const STEP = 1 / 60;            // fixed physics step
const G = 9.81;
const AIR_G = 1.3;              // extra gravity in the air so jumps feel snappy
const SNOW = {
  groomed: { friction: 0.04, grip: 1.15 },
  powder: { friction: 0.13, grip: 0.75 },
};
const DRAG = 0.006;             // air drag per (m/s)^2
const TUCK_DRAG = 0.5;          // tucking halves drag...
const TUCK_TURN = 0.55;         // ...and turns wider: the skis turn slower
const TUCK_GRIP = 0.6;          // ...and hold less edge
const SPEED_CAP = 26;           // soft cap, about 94 km/h
const CAP_DRAG = 0.6;
const SKID = 0.55;              // speed lost to sideways slip, as a share of the normal force
const BRAKE = 8.5;              // hockey stop deceleration
const TURN_RATE = 1.9;          // rad/s the skis turn at full steer
const AIR_TURN = 1.2;           // rad/s in the air, to line up the landing
const MAX_HEADING = 1.85;       // how far from the fall line the skis can point (about 106 degrees)
const POP = 3.4;                // jump impulse along the slope normal
const POP_COOLDOWN = 0.35;
const PUSH = 3.5;               // push off from the summit, and after a wipeout
const TAKEOFF_MARGIN = 0.0005;  // extra gap (m per step) before a crest launches you
const REAL_AIR = 0.22;          // air shorter than this is a bump, not a jump
const CLEAN_LAND = 20 * Math.PI / 180;
const SLOPPY_LAND = 45 * Math.PI / 180;
const SLOPPY_KEEP = 0.7;        // share of speed kept on a sloppy landing
const HARD_IMPACT = 11;         // m/s into the snow that makes a landing sloppy
const CRASH_IMPACT = 17;        // ...or a wipeout
const CRASH_DECEL = 7;
const CRASH_HIT_SPEED = 7;      // hitting a tree faster than this is a wipeout
const SKIER_R = 0.35;
const STOP_TIME = 3;            // seconds stalled on flat ground (the base, a flat cat track) before the trip back up
const FLAT = 0.06;              // ...flat meaning too gentle to get going again by pointing downhill
const EDGE_MARGIN = 150;        // meters from the edge of the map before the trip back up

// ---------- Momentum physics ----------
// One velocity carries everything. Gravity, edges, poles, pops and spins only add to it or bend it,
// and nothing is clamped to the fall line, so you can carve uphill until your speed runs out.
// The assist layer is the arcade half of the middle ground; switch it off in the Tab menu to feel the raw model.
const MO = {
  DRAG: 0.0045,                 // air drag per (m/s)^2 standing up (half rho Cd A / m for a 75 kg skier)
  TUCK_DRAG: 0.0024,            // ...and tucked
  PIVOT: 2.4,                   // rad/s the skis pivot at full steer when standing still...
  PIVOT_FALL: 14,               // ...divided by (1 + speed / 14): heavier the faster you go
  EDGE_IN: 5,                   // how quickly you roll onto an edge (1/s): weight takes a moment to move
  EDGE_GRIP: 0.6,               // grip at full lean is (1 + 0.6) times the snow's grip
  POLE: 1.7,                    // m/s each double-pole push adds from a standstill...
  POLE_MAX: 5.5,                // ...fading to nothing at this speed (20 km/h)
  POLE_EVERY: 0.55,             // seconds between pushes while held
  OLLIE_MIN: 3.0,               // pop from a tap (m/s)...
  OLLIE_MAX: 5.5,               // ...up to this after loading for OLLIE_CHARGE seconds
  OLLIE_CHARGE: 0.5,
  OLLIE_UP: 0.4,                // share of the pop that goes straight up rather than off the slope
  SPIN_IN: 7,                   // rad/s^2: in the air, steering is torque on the spin you took off with
  SPIN_TUCK: 1.6,               // tucking spins you faster
  SPIN_DAMP: 0.4,               // spin lost per second with no steer held
  CRASH_MU: 0.6,                // a wipeout slides with friction (plus a base drag), so it goes further on steep ground
  CRASH_BASE: 2,
  CRASH_MAX: 5,                 // seconds before you self-arrest whatever the slope
};
const ASSIST = {
  on: { grip: 1.2, cap: 34, capDrag: 0.25, airG: 1.15, align: 2.5, clean: 25, sloppy: 55, crash: 20 },
  off: { grip: 1.0, cap: Infinity, capDrag: 0, airG: 1.0, align: 0, clean: 15, sloppy: 45, crash: 17 },
};
const physics = { momentum: true, assists: true };
const assist = () => (physics.assists ? ASSIST.on : ASSIST.off);

// ---------- The mountain ----------
const TREELINE = 3560;          // no conifers above this (the satellite photo agrees)
const TREE_FAR = 900;           // trees are drawn within this distance; beyond it the forest is a tint on the ground
const CHUNK = 64;               // terrain chunk: 64 cells of 10 m
const LOD_STEPS = [1, 2, 4, 8]; // triangle size in cells: 10, 20, 40, 80 m
const LOD_DIST = [450, 1200, 3200];

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
// Heights are decimeters: each row's first value, then differences along the row.
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
// Distance to the nearest groomed run on the 10 m grid, in half meters, negative on the run.
// The runs are the real Snowmass trails from OpenStreetMap (runs.json); their widths are guessed.
const RUNF = new Int8Array(runBytes.buffer, runBytes.byteOffset, runBytes.length);
const runDist = (k) => RUNF[k] / 2;
const CELL = META.near.cell, NX = META.near.nx, NZ = META.near.nz, X0 = META.near.x0, Z0 = META.near.z0;
const H = decodeHeights(nearBytes, NX, NZ);
const FAR = META.far;
const FH = decodeHeights(farBytes, FAR.nx, FAR.nz);
const X1 = X0 + (NX - 1) * CELL, Z1 = Z0 + (NZ - 1) * CELL;

// Cover, one byte per cell: conifer density 0-15, aspen density 0-7, rock.
const conifer = (k) => (COVER[k] & 15) / 15;
const aspen = (k) => ((COVER[k] >> 4) & 7) / 7;
const isRock = (k) => COVER[k] >> 7;
const gridH = (i, j) => H[clamp(j, 0, NZ - 1) * NX + clamp(i, 0, NX - 1)];
const cellAt = (x, z) => clamp(Math.round((z - Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - X0) / CELL), 0, NX - 1);
// Groomed on the real runs, powder everywhere else.
const POWDER = new Uint8Array(NX * NZ);
for (let k = 0; k < NX * NZ; k++) POWDER[k] = RUNF[k] < 0 ? 0 : 1;

const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const crd = (p0, p1, p2, p3, t) => 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (3 * p1 - p0 - 3 * p2 + p3) * t * t);
const samp = { h: 0, gx: 0, gz: 0 };
const rowV = [0, 0, 0, 0], rowD = [0, 0, 0, 0];
// Height and gradient (dh/dx, dh/dz) at any point, on a smooth surface through the grid points:
// the 10 m mountain, or the 2 m grid of the detailed runs where there is one (built further down).
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
function sample(x, z, out = samp) {
  const P = PATCH;
  if (patchOn && P && x > P.ax && x < P.bx && z > P.az && z < P.bz) return sampleGrid(P.hp, P.nx, P.nz, P.x0, P.z0, P.cell, x, z, out);
  return sampleGrid(H, NX, NZ, X0, Z0, CELL, x, z, out);
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

// no antialiasing: the 320x180 look wants hard pixel edges
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 45000);

// Snowlight, the noon light from the World Kit. Every custom shader works on raw colors and writes them
// straight to the screen, as the cast page and World Kit do.
const SUN_DIR = new THREE.Vector3(-0.8, 0.75, 0.25).normalize();
const SUN_COLOR = new THREE.Vector3(1.0, 0.98, 0.92);
const SKY_COLOR = new THREE.Vector3(0.42, 0.55, 0.85);
const SNOW_ALBEDO = new THREE.Vector3(0.95, 0.97, 1.0);
const FOG = new THREE.Vector3(217 / 255, 228 / 255, 238 / 255);
const BOUNCE = SUN_COLOR.clone().multiplyScalar(Math.max(0, SUN_DIR.y)).addScaledVector(SKY_COLOR, 0.6).multiply(SNOW_ALBEDO);
// The World Kit's four times of day. fog is [near, far] in meters for the haze.
const TIMES = {
  noon:   { name: 'Noon', sun: [-0.8, 0.75, 0.25], sunC: [1.0, 0.98, 0.92], sky: [0.42, 0.55, 0.85], snow: [0.95, 0.97, 1.0], fogC: [217, 228, 238], fog: [1500, 70000], lamp: [0, 0, 0] },
  golden: { name: 'Golden hour', sun: [0.85, 0.3, -0.45], sunC: [1.25, 0.72, 0.38], sky: [0.36, 0.34, 0.6], snow: [1.0, 0.9, 0.84], fogC: [228, 179, 163], fog: [1300, 60000], lamp: [0, 0, 0] },
  night:  { name: 'Night', sun: [-0.5, 0.6, 0.6], sunC: [0.3, 0.36, 0.55], sky: [0.1, 0.13, 0.26], snow: [0.9, 0.93, 1.0], fogC: [28, 34, 47], fog: [600, 20000], lamp: [1.7, 1.15, 0.6] },
  storm:  { name: 'Storm', sun: [-0.1, 1.0, 0.25], sunC: [0.32, 0.33, 0.36], sky: [0.66, 0.69, 0.75], snow: [0.93, 0.95, 0.98], fogC: [176, 184, 194], fog: [40, 900], lamp: [0, 0, 0] },
};
let timeOfDay = 'noon';
// Shadows are painted top down onto a canvas that follows the camera: SH_SIZE meters across.
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
  float band0(float v) { return floor(v * 4.0 + 0.5) / 4.0; }   // no floor: unlit stays unlit
  float hash(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
  // 1 where something blocks the sun, from the painted shadow canvas around the camera
  float shade(vec3 p) {
    vec2 uv = (p.xz - uShO) / ${SH_SIZE}.0;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    return texture2D(uShadow, vec2(uv.x, 1.0 - uv.y)).r;
  }
  vec3 lamps(vec3 p, vec3 n) {
    vec3 l = vec3(0.0);
    for (int i = 0; i < 4; i++) { vec3 v = uLamps[i] - p; float d = length(v); l += uLampC * band0(max(0.0, dot(n, v / d)) / (1.0 + d * d / 160.0)); }
    return l;
  }
  vec3 finish(vec3 alb, vec3 l, float dist, float cap) {
    float m = max(max(l.r, l.g), max(l.b, 0.001));
    l = l / m * band(min(cap, m));
    // haze thickens with distance, so far ridges go pale blue the way they do from a real summit
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
  loadTex('sky_noon', { pixel: false }), loadTex('goldie'), loadTex('goldie_n'),
  loadTex('sky_golden', { pixel: false }), loadTex('sky_night', { pixel: false }), loadTex('sky_storm', { pixel: false }),
]);
const SKIES = { noon: skyT, golden: skyRest[0], night: skyRest[1], storm: skyRest[2] };
const TREE_KINDS = ['spruce', 'fir', 'aspen', 'snowghost', 'pole', 'sign'];
const loadImg = (n) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = asset(n); });
const treeImgs = await Promise.all(TREE_KINDS.flatMap((k) => [k, k + '_n']).map(loadImg));
// in a storm the spruce slot of the atlas shows the storm-plastered spruce instead
const stormImgs = await Promise.all(['storm_spruce', 'storm_spruce_n'].map(loadImg));

// Sky: the World Kit noon strip on an open cylinder that rides with the camera, drawn first and behind
// everything. The strip's painted peaks are trimmed off, since the real ones are in the scene.
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
  // below the strip, the haze color, so a camera looking down never sees past the terrain to nothing
  scene.background = new THREE.Color().setRGB(FOG.x, FOG.y, FOG.z, THREE.SRGBColorSpace);
  return m;
})();

// ---------- Terrain: flat-shaded, N64 style, lit by Snowlight ----------
// Each vertex carries its cover: powder (0 groomed, 1 powder), rock, and forest density for the far tint.
const terrainMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uCord: { value: cordT }, uCordN: { value: cordN }, uPow: { value: powT }, uPowN: { value: powN },
    uRock: { value: new THREE.Vector3(0.5, 0.48, 0.45) }, uForest: { value: new THREE.Vector3(0.15, 0.26, 0.21) },
    uAspen: { value: new THREE.Vector3(0.46, 0.44, 0.4) },
    // where the detailed runs' 2 m mesh takes over, the 10 m ground is cut away
    uPMask: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uPMin: { value: new THREE.Vector2() }, uPSize: { value: new THREE.Vector2(1, 1) },
    uPOn: { value: 0 } }, LIGHT),
  vertexShader: /* glsl */ `
    attribute vec4 aCov;
    attribute vec3 aN;
    varying vec3 vP; varying vec4 vCov; varying float vD; varying vec3 vN;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vP = w.xyz; vCov = aCov; vN = aN;
      vec4 mv = viewMatrix * w;
      // skirts sit a hair behind the ground along the view ray: same pixels, so they still fill cracks,
      // but the ground always wins the tie along shared edges and no seam lines show from above
      if (dot(aN, aN) > 0.0) mv.xyz *= 1.003;
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uCord, uCordN, uPow, uPowN;
    uniform vec3 uRock, uForest, uAspen;
    uniform sampler2D uPMask; uniform vec2 uPMin, uPSize; uniform float uPOn;
    varying vec3 vP; varying vec4 vCov; varying float vD; varying vec3 vN;
    void main() {
#ifndef PATCH
      if (uPOn > 0.5) {
        vec2 pm = (vP.xz - uPMin) / uPSize;
        if (pm.x > 0.0 && pm.y > 0.0 && pm.x < 1.0 && pm.y < 1.0 && texture2D(uPMask, pm).r > 0.5) discard;
      }
#endif
      vec3 fn = normalize(cross(dFdx(vP), dFdy(vP)));
      if (dot(vN, vN) > 1e-8) fn = normalize(vN);            // a skirt: lit like the ground at its top edge
      vec2 uv = vec2(vP.x, -vP.z) / 8.0;
      float dith = (hash(vP.xz * 0.5) - 0.5) * 0.6;          // ragged 2 m blocks where groomed meets powder or rock
#ifdef PATCH
      dith *= 0.3;                                           // the detailed runs know their edge to the meter: keep it crisp
#endif
      float edge = vCov.x + dith * 2.5;                      // meters from the groomed run's edge
      bool groomed = edge < 0.0;
      vec3 alb = (groomed ? texture2D(uCord, uv).rgb : texture2D(uPow, uv).rgb) * uSnow;
      vec3 tn = (groomed ? texture2D(uCordN, uv).rgb : texture2D(uPowN, uv).rgb) * 2.0 - 1.0;
      float near = 1.0 - smoothstep(60.0, 300.0, vD);        // snow texture lighting fades out with distance
      vec3 n = normalize(fn + vec3(tn.x, 0.0, -tn.y) * (groomed ? 0.12 : 0.18) * near);
      alb = mix(uSnow, alb, 0.45 * near);                    // and so does its pattern, so distant snow isn't static
      // the groomer's edge: a bright windrow just off the corduroy, with a thin shadow line beyond it
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

// Chunks of 64 x 64 cells, each built at four triangle sizes on demand. Skirts hang off every edge
// so cracks between neighbors at different sizes never show sky.
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
      // skirt vertices carry the ground's normal, so a crack's sliver is lit like the ground beside it
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
  // skirt: walk the edge loop, copy each edge vertex and drop a second copy below it
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
    idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings, so it shows from either side
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
for (let cj = 0; cj < NCZ; cj++) {
  for (let ci = 0; ci < NCX; ci++) {
    const ch = { i0: ci * CHUNK, j0: cj * CHUNK, i1: Math.min((ci + 1) * CHUNK, NX - 1), j1: Math.min((cj + 1) * CHUNK, NZ - 1), meshes: [], level: -1 };
    ch.cx = X0 + (ch.i0 + ch.i1) / 2 * CELL; ch.cz = Z0 + (ch.j0 + ch.j1) / 2 * CELL;
    ch.half = Math.max(ch.i1 - ch.i0, ch.j1 - ch.j0) * CELL / 2;
    chunks.push(ch);
  }
}
function updateTerrain() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const ch of chunks) {
    const d = Math.max(0, Math.hypot(cx - ch.cx, cz - ch.cz) - ch.half * 1.2);
    const level = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : d < LOD_DIST[2] ? 2 : 3;
    if (level === ch.level) continue;
    if (!ch.meshes[level]) ch.meshes[level] = buildChunk(ch, level);
    ch.meshes.forEach((m, l) => { if (m) m.visible = l === level; });
    // the finest level is big: let it go once the camera is well away
    if (level > 1 && ch.meshes[0]) { scene.remove(ch.meshes[0]); ch.meshes[0].geometry.dispose(); ch.meshes[0] = null; }
    ch.level = level;
  }
}

// The surrounding peaks: every other point of the 100 m data (200 m triangles) out to about 25 km,
// with a hole where the 10 m mountain sits.
{
  const S = 2, nx = Math.floor((FAR.nx - 1) / S) + 1, nz = Math.floor((FAR.nz - 1) / S) + 1, cell = FAR.cell * S;
  const pos = new Float32Array(nx * nz * 3), cov = new Float32Array(nx * nz * 4);
  const inner = (x, z, m) => x > X0 + m && x < X1 - m && z > Z0 + m && z < Z1 - m;
  const hk = (a, b) => FH[clamp(b * S, 0, FAR.nz - 1) * FAR.nx + clamp(a * S, 0, FAR.nx - 1)];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = FAR.x0 + i * cell, z = FAR.z0 + j * cell, h = hk(i, j);
      const slope = Math.hypot(hk(i + 1, j) - hk(i - 1, j), hk(i, j + 1) - hk(i, j - 1)) / (2 * cell);
      // tucked a little under the 10 m mountain where the two overlap, easing back up outside it
      const out = Math.hypot(Math.max(X0 - x, 0, x - X1), Math.max(Z0 - z, 0, z - Z1));
      pos[k * 3] = x; pos[k * 3 + 1] = h - 14 * clamp(1 - out / 800, 0, 1); pos[k * 3 + 2] = z;
      cov[k * 4] = 60; cov[k * 4 + 1] = slope > 0.85 ? 1 : 0;
      cov[k * 4 + 2] = h < 3300 && slope < 0.8 ? 0.75 : h < 3500 ? 0.3 : 0;
      cov[k * 4 + 3] = 0;
    }
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      if (inner(FAR.x0 + (i + 0.5) * cell, FAR.z0 + (j + 0.5) * cell, 260)) continue;
      const v = j * nx + i;
      idx.push(v, v + nx, v + 1, v + 1, v + nx, v + nx + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(nx * nz * 3), 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, terrainMat);
  m.frustumCulled = false;
  scene.add(m);
}

// ---------- Trees: World Kit sprites where the photo shows forest ----------
// One atlas, one draw call. Each tree is a billboard that turns to face the camera but stays upright,
// lit per pixel from its normal map like Goldie. Trees are made page by page (320 m squares) from the
// cover map, the same way every time, so the ones you see are the ones you hit.
const SLOT = 80;
const atlas = (() => {
  const c = document.createElement('canvas'), cn = document.createElement('canvas');
  c.width = cn.width = SLOT * TREE_KINDS.length; c.height = cn.height = 128;
  const g = c.getContext('2d'), gn = cn.getContext('2d');
  const rects = TREE_KINDS.map((k, n) => {
    const im = treeImgs[n * 2], imn = treeImgs[n * 2 + 1];
    const x = n * SLOT + Math.floor((SLOT - im.width) / 2), y = 128 - im.height;
    g.drawImage(im, x, y); gn.drawImage(imn, x, y);
    return { u0: x / c.width, u1: (x + im.width) / c.width, v1: im.height / 128, aspect: im.width / im.height };
  });
  const mk = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
    return t;
  };
  const out = { map: mk(c), normal: mk(cn), rects };
  // the storm atlas: the same sheet with the storm spruce squeezed into the spruce's rectangle
  const r = rects[0], x = Math.round(r.u0 * c.width), w = Math.round((r.u1 - r.u0) * c.width), h = Math.round(r.v1 * 128);
  const storm = [[c, stormImgs[0]], [cn, stormImgs[1]]].map(([cv, im]) => {
    const copy = document.createElement('canvas');
    copy.width = cv.width; copy.height = cv.height;
    const g2 = copy.getContext('2d');
    g2.drawImage(cv, 0, 0);
    g2.clearRect(0, 0, SLOT, 128);
    g2.drawImage(im, x, 128 - h, w, h);
    return mk(copy);
  });
  [out.stormMap, out.stormNormal] = storm;
  return out;
})();
const KIND = { spruce: 0, fir: 1, aspen: 2, snowghost: 3, pole: 4, sign: 5 };
const TREE_R = [0.11, 0.11, 0.07, 0.3, 0, 0];      // trunk-and-branches radius as a share of height
const PAGE = 32;                              // cells per tree page
const pages = new Map();
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
      if (LIFT_CUT[k]) continue;                       // lift lines are cut through the forest
      // ...and so are the groomed runs, to 2 m past the edge (to the meter on the detailed runs)
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
      // up to two trees a cell: a second, set across the cell from the first, where the forest is thick.
      // Heights are real Colorado ones (spruce 15-24 m, fir 12-20 m, aspen 10-15 m), so the runs read at true size.
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
  // run props (rope poles, boundary signs) placed by the art pass, bucketed by page
  for (const t of PROPS.get(key) || []) list.push(t);
  const data = new Float32Array(list.length * 8);
  list.forEach((t, n) => {
    const r = atlas.rects[t.kind];
    data.set([t.x, t.y, t.z, t.height, r.u0, r.u1, r.aspect, r.v1], n * 8);
  });
  pg = { list, data, rocks };
  pages.set(key, pg);
  return pg;
}
const TREE_MAX = 60000;
const treeGeo = new THREE.InstancedBufferGeometry();
{
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  treeGeo.index = base.index;
  treeGeo.setAttribute('position', base.getAttribute('position'));
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(TREE_MAX * 8), 8, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  treeGeo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  treeGeo.setAttribute('iTex', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  treeGeo.instanceCount = 0;
}
const treeMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uA: { value: atlas.map }, uN: { value: atlas.normal } }, LIGHT),
  vertexShader: /* glsl */ `
    uniform vec3 uSun;
    attribute vec4 iPos, iTex;
    varying vec2 vUv; varying vec3 vRight; varying float vD; varying vec3 vBase; varying float vUp;
    void main() {
      // shade is read just sunward of the trunk, so a tree is never darkened by its own shadow
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
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uA, uN;
    varying vec2 vUv; varying vec3 vRight; varying float vD; varying vec3 vBase; varying float vUp;
    void main() {
      vec4 a = texture2D(uA, vUv);
      if (a.a < 0.5) discard;
      // thin out by dithering toward the edge of tree range, where the ground tint takes over
      if (hash(gl_FragCoord.xy) < smoothstep(uTreeFar * 0.75, uTreeFar, vD)) discard;
      vec3 s = texture2D(uN, vUv).rgb * 2.0 - 1.0;
      vec3 toward = vec3(-vRight.z, 0.0, vRight.x);
      vec3 n = normalize(vRight * s.x + vec3(0.0, s.y, 0.0) + toward * s.z);
      // a tree in another tree's shadow is shaded at the base, fading out up the trunk
      float lit = 1.0 - shade(vBase) * (1.0 - smoothstep(0.0, 0.8, vUp));
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * lit + uSky * (0.35 + 0.35 * n.y)
             + uBounce * band(max(0.0, -n.y * 0.8 + 0.15)) * 0.5 * (1.0 - 0.6 * shade(vBase)) + lamps(vBase + vec3(0.0, 2.0, 0.0), n) * 1.4 + 0.05;
      gl_FragColor = vec4(finish(a.rgb, l, vD, 1.25), 1.0);
    }`,
});
const treeMesh = new THREE.Mesh(treeGeo, treeMat);
treeMesh.frustumCulled = false;
scene.add(treeMesh);
let treePage = '';
function updateTrees(force) {
  const P = PAGE * CELL;
  const pi = Math.floor((camera.position.x - X0) / P), pj = Math.floor((camera.position.z - Z0) / P);
  const id = pi + ',' + pj;
  if (id === treePage && !force) return;
  treePage = id;
  const R = Math.ceil(TREE_FAR / P) + 1;
  const buf = treeGeo.attributes.iPos.data;
  let n = 0;
  const inRange = [];
  for (let b = pj - R; b <= pj + R; b++) {
    for (let a = pi - R; a <= pi + R; a++) {
      if (a < 0 || b < 0 || a * PAGE >= NX || b * PAGE >= NZ) continue;
      const cxp = X0 + (a + 0.5) * P, czp = Z0 + (b + 0.5) * P;
      if (Math.hypot(cxp - camera.position.x, czp - camera.position.z) > TREE_FAR + P) continue;
      const pg = makePage(a, b);
      inRange.push(pg);
      const count = Math.min(pg.list.length, TREE_MAX - n);
      buf.array.set(pg.data.subarray(0, count * 8), n * 8);
      n += count;
    }
  }
  buf.addUpdateRange(0, n * 8);
  buf.needsUpdate = true;
  treeGeo.instanceCount = n;
  fillRocks(inRange);
}

// ---------- World Kit models: low poly, flat shaded, colored per vertex, lit by the same Snowlight ----------
// aH is each vertex's height above its own model's base, so shadows on the snow only darken the bottom.
const modelMat = new THREE.ShaderMaterial({
  vertexColors: true,
  uniforms: LIGHT,
  vertexShader: /* glsl */ `
    attribute float aH;
    varying vec3 vC; varying vec3 vP; varying float vD; varying float vH;
    void main() {
      vC = color; vH = aH;
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
    varying vec3 vC; varying vec3 vP; varying float vD; varying float vH;
    void main() {
      vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
      vec2 sunXZ = normalize(uSun.xz + vec2(1e-4));
      float lit = 1.0 - shade(vP + vec3(sunXZ.x, 0.0, sunXZ.y) * 1.5) * (1.0 - smoothstep(0.0, 4.0, vH));
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * lit + uSky * (0.35 + 0.35 * n.y)
             + uBounce * band0(max(0.0, -n.y * 0.8 + 0.15)) * 0.5 + lamps(vP, n) * 1.2 + 0.05;
      gl_FragColor = vec4(finish(vC, l, vD, 1.25), 1.0);
    }`,
});
const STEEL = [0.46, 0.48, 0.52], DARK = [0.2, 0.21, 0.25], CONC = [0.62, 0.6, 0.56], PAD = [0.78, 0.12, 0.1],
  SEAT = [0.16, 0.2, 0.36], WALL = [0.5, 0.36, 0.24], SNOWCAP = [0.92, 0.95, 1.0], CABIN = [0.75, 0.6, 0.2], GLASS = [0.15, 0.2, 0.3];
// A part: a simple geometry with one color, placed by an optional matrix.
function part(g, col, m) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, c = new Float32Array(n * 3), h = new Float32Array(n);
  for (let i = 0; i < n; i++) { c.set(col, i * 3); h[i] = g.attributes.position.getY(i); }
  if (m) g.applyMatrix4(m);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  return g;
}
function merge(parts) {
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3), h = new Float32Array(n);
  let o = 0;
  for (const g of parts) {
    p.set(g.attributes.position.array, o * 3); c.set(g.attributes.color.array, o * 3); h.set(g.attributes.aH.array, o);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  g.computeBoundingSphere();
  return g;
}
// place a model-local part list in the world: base at (x, y, z), local z along `yaw`
const placeM = (x, y, z, yaw) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
function placed(parts, m) {
  return parts.map((g) => {
    const h = g.attributes.aH.array.slice();
    g.applyMatrix4(m);
    g.attributes.aH.array.set(h);
    return g;
  });
}

// ---------- Rocks: the kit's displaced icosahedra, snow on the faces that point up ----------
const ROCK_VARIANTS = 6, ROCK_MAX = 2500;
function rockGeo(k) {
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, v = new THREE.Vector3();
  const sx = 0.8 + hash2(k, 1) * 0.6, sy = 0.6 + hash2(k, 2) * 0.6, sz = 0.7 + hash2(k, 3) * 0.6;
  // displace shared corners the same way so faces stay closed
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

// ---------- Chairlifts on the real lift lines (OpenStreetMap, in lifts.json) ----------
// The kit's towers, cable and chairs. OSM's points along a line are its towers where mapped; long gaps
// get towers about every 110 m. Each tower is as tall as it needs to be for the chairs to clear the snow.
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
const liftParts = [], cablePts = [], casters = [], lampList = [];
const carriers = { chair: [], cabin: [], bar: [] };
const liftPaths = [];
for (const lift of LIFTS) {
  const st = LIFT_STYLE[lift.kind] || LIFT_STYLE.chair_lift;
  // stations: terminals at the ends, towers between; drop points bunched up near a terminal
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
  const sagOf = (i) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) * 0.012;
  const cableAt = (i, f) => c[i] + (c[i + 1] - c[i]) * f - sagOf(i) * Math.sin(Math.PI * f);
  // raise towers until every span clears the snow under it
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
      // lift the ends of the span in proportion to how close the low spot is to each; terminals stay put
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
  // towers
  for (let i = 1; i < N - 1; i++) {
    const th = c[i] - g[i] - 0.55, arm = st.arm, yaw = dirAt(i);
    const parts = [
      part(new THREE.BoxGeometry(2.2, 1.2, 2.2).translate(0, 0.3, 0), CONC),
      part(new THREE.CylinderGeometry(0.4, 0.68, th, 6).translate(0, th / 2, 0), STEEL),
      part(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 8).translate(0, 1.9, 0), PAD),
      part(new THREE.BoxGeometry(arm * 2 + 1.4, 0.45, 0.5).translate(0, th, 0), STEEL),
      part(new THREE.BoxGeometry(1.2, 0.35, 2.4).translate(-arm, th + 0.35, 0), DARK),
      part(new THREE.BoxGeometry(1.2, 0.35, 2.4).translate(arm, th + 0.35, 0), DARK),
      part(new THREE.BoxGeometry(0.22, th - 2, 0.22).translate(0.55, th / 2, 0.3), DARK),
    ];
    liftParts.push(...placed(parts, placeM(pts[i][0], g[i] - 0.4, pts[i][1], yaw)));
    casters.push({ x: pts[i][0], z: pts[i][1], h: th, w: 0.8 });
    addObstacle({ x: pts[i][0], z: pts[i][1], y: g[i], r: 1.1, height: th });
  }
  // terminals: a bullwheel on legs, and a snow-capped operator hut with a lamp
  for (const i of [0, N - 1]) {
    const yaw = dirAt(i) + (i === 0 ? Math.PI : 0), arm = st.arm, hh = c[i] - g[i];
    const parts = [
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
    const m = placeM(pts[i][0], g[i] - 0.3, pts[i][1], yaw);
    liftParts.push(...placed(parts, m));
    casters.push({ x: pts[i][0], z: pts[i][1], h: hh, w: arm + 1 });
    lampList.push(new THREE.Vector3(arm + 1.6, 5.6, -1.2).applyMatrix4(m));
  }
  // the cable: a dense path along the tower tops with sag, plus its length along the way
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
  const lp = { path, s, L, arm: st.arm, speed: st.speed };
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
scene.add(new THREE.Mesh(merge(liftParts), modelMat));
// ---------- Run art pass: trail signs, rope lines and a fence on the real runs ----------
// Every named run gets a trail sign at its top. Sunnyside and Max Park, which start together at the top of
// Village Express, get rope lines down both edges of their first stretch, and the top terminal gets a rail fence.
const RUNS = MAP.runs || [];
const PROPS = new Map();                       // tree page -> props (rope poles), merged into that page's trees
function addProp(t) {
  const P = PAGE * CELL, key = Math.floor((t.x - X0) / P) * 1000 + Math.floor((t.z - Z0) / P);
  if (!PROPS.has(key)) PROPS.set(key, []);
  PROPS.get(key).push(t);
}
// a point and direction some distance down a run's line
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
// ---------- Detailed runs: Sunnyside and Max Park on a 2 m grid ----------
// The 10 m mountain is too coarse for a groomed run: no crisp edge, no windrow, every 10 m bump shows.
// Each detailed run gets a smoothed line and a groomed cross-section: a smoothed long profile, a gentler
// side slope than the hill it is cut into, a slight crown and a windrow berm at each edge, blending back
// into the 10 m mountain over BLEND meters past the edge. That makes one 2 m height grid which the
// physics samples and a fine mesh draws; the 10 m ground is cut away underneath it.
const DETAIL_RUNS = ['Sunnyside', 'Max Park', 'Powderhorn'];
const PCELL = 2, BLEND = 18, CROWN = 0.12, BERM = 0.35, BERM_W = 1.6, SIDE_KEEP = 0.7, TAPER = 60;
// meters outside a run's groomed edge (negative inside); past either end of the line, the end is square
const edgeOf = (u, hw, over) => (over > 0 ? Math.max(Math.abs(u) - hw, over) : Math.abs(u) - hw);
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Gaussian smoothing of a list, sigma in samples, renormalized at the ends
function gauss(arr, sigma) {
  const r = Math.ceil(sigma * 3), w = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-k * k / (2 * sigma * sigma)));
  return arr.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const j = i + k; if (j >= 0 && j < arr.length) { s += arr[j] * w[k + r]; n += w[k + r]; } }
    return s / n;
  });
}
// A groomed long profile never climbs: the closest profile to the hill that keeps dropping at least
// MIN_GRADE (pool-adjacent violators on height + MIN_GRADE * distance), so the cat cuts the bumps.
const MIN_GRADE = 0.04;
function downhillFit(h, s) {
  const blocks = [];                 // [mean, count] of y = h + MIN_GRADE * s, kept non-increasing
  h.forEach((v, i) => {
    blocks.push([v + MIN_GRADE * s[i], 1]);
    while (blocks.length > 1 && blocks[blocks.length - 2][0] < blocks[blocks.length - 1][0]) {
      const [m2, n2] = blocks.pop(), b = blocks[blocks.length - 1];
      b[0] = (b[0] * b[1] + m2 * n2) / (b[1] + n2); b[1] += n2;
    }
  });
  const out = [];
  for (const [m, n] of blocks) for (let k = 0; k < n; k++) out.push(m - MIN_GRADE * s[out.length]);
  return out;
}
// the run's line every 2 m, with the corners of the OSM line smoothed out
function denseLine(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / PCELL));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  out.push(points[points.length - 1]);
  const xs = gauss(out.map((p) => p[0]), 5), zs = gauss(out.map((p) => p[1]), 5);
  return xs.map((x, i) => [x, zs[i]]);
}
// Visit every grid node within reach of a polyline: fn(node, u, s, over) with u the signed distance across
// the line, s the distance along it and over how far past either end the node lies.
function rasterLine(P, pts, reach, fn) {
  let s0 = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-6;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - P.x0) / PCELL)), i1 = Math.min(P.nx - 1, Math.ceil((Math.max(ax, bx) + reach - P.x0) / PCELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - P.z0) / PCELL)), j1 = Math.min(P.nz - 1, Math.ceil((Math.max(az, bz) + reach - P.z0) / PCELL));
    for (let j = j0; j <= j1; j++) {
      for (let a = i0; a <= i1; a++) {
        const px = P.x0 + a * PCELL - ax, pz = P.z0 + j * PCELL - az, t = (px * dx + pz * dz) / (len * len);
        let over = 0;
        if (t < 0) { if (i > 0) continue; over = -t * len; }
        if (t > 1) { if (i < pts.length - 2) continue; over = (t - 1) * len; }
        const tc = clamp(t, 0, 1), u = (px * dz - pz * dx) / len;
        fn(j * P.nx + a, u, s0 + tc * len, over, Math.hypot(px - dx * tc, pz - dz * tc));
      }
    }
    s0 += len;
  }
}
// the 10 m mesh's own surface at any point: the same two triangles per cell that buildChunk draws up close
function meshY(x, z) {
  const fx = clamp((x - X0) / CELL, 0, NX - 1.001), fz = clamp((z - Z0) / CELL, 0, NZ - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const h00 = gridH(i, j), h10 = gridH(i + 1, j), h01 = gridH(i, j + 1), h11 = gridH(i + 1, j + 1);
  if ((i + j) & 1) return tx + tz <= 1 ? h00 + tx * (h10 - h00) + tz * (h01 - h00) : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  return tx >= tz ? h00 + tx * (h10 - h00) + tz * (h11 - h10) : h00 + tz * (h01 - h00) + tx * (h11 - h01);
}
{
  const detail = RUNS.filter((r) => DETAIL_RUNS.includes(r.name) && !r.area && r.points.length > 1);
  for (const r of detail) {
    // stations every 2 m: smoothed line, long profile and side slope of the hill under it
    const pts = denseLine(r.points), n = pts.length, hw = r.width / 2;
    const C = [], K = [], S = [0];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l;   // across, the same side as rasterLine's u
      C.push(groundY(pts[i][0], pts[i][1]));
      K.push((groundY(pts[i][0] + nx * 12, pts[i][1] + nz * 12) - groundY(pts[i][0] - nx * 12, pts[i][1] - nz * 12)) / 24);
      if (i) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    r.points = pts;                       // signs, rope lines and the start follow the smoothed line
    r.kind = 'groomed';                   // a detailed run is a groomed one (Powderhorn too, for this first pass)
    r.detail = { hw, S, G: gauss(downhillFit(gauss(C, 6), S), 4), K: gauss(K, 10).map((k) => k * SIDE_KEEP), len: S[n - 1] };
  }
  if (detail.length) {
    const reach = Math.max(...detail.map((r) => r.width / 2)) + BLEND + 6;
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const r of detail) for (const [x, z] of r.points) { ax = Math.min(ax, x); az = Math.min(az, z); bx = Math.max(bx, x); bz = Math.max(bz, z); }
    const x0 = Math.floor((ax - reach) / PCELL) * PCELL, z0 = Math.floor((az - reach) / PCELL) * PCELL;
    const P = { x0, z0, cell: PCELL, nx: Math.ceil((bx + reach - x0) / PCELL) + 1, nz: Math.ceil((bz + reach - z0) / PCELL) + 1 };
    const N = P.nx * P.nz;
    // signed distance to the nearest groomed edge, from every groomed run that comes through
    const edge = new Float32Array(N).fill(60), others = new Float32Array(N).fill(60);
    for (const r of RUNS) {
      if (r.kind !== 'groomed' || r.area || r.points.length < 2 || r.detail) continue;
      rasterLine(P, r.points, r.width / 2 + 40, (k, u, s, over, d) => { const e = d - r.width / 2; if (e < others[k]) others[k] = e; });
    }
    // each detailed run's surface and blend weight at every node it reaches; the nearest piece of line wins.
    // A run keeps its working arrays only over its own box of the grid, so long runs far apart stay cheap.
    const sum = new Float32Array(N), wsum = new Float32Array(N), wmin = new Float32Array(N).fill(1);
    const perRun = detail.map((r) => {
      let rx0 = Infinity, rz0 = Infinity, rx1 = -Infinity, rz1 = -Infinity;
      for (const [x, z] of r.points) { rx0 = Math.min(rx0, x); rz0 = Math.min(rz0, z); rx1 = Math.max(rx1, x); rz1 = Math.max(rz1, z); }
      const ia = Math.max(0, Math.floor((rx0 - reach - x0) / PCELL) - 1), ja = Math.max(0, Math.floor((rz0 - reach - z0) / PCELL) - 1);
      const qnx = Math.min(P.nx - 1, Math.ceil((rx1 + reach - x0) / PCELL) + 1) - ia + 1, qnz = Math.min(P.nz - 1, Math.ceil((rz1 + reach - z0) / PCELL) + 1) - ja + 1;
      const M = qnx * qnz, best = new Float32Array(M).fill(1e9), U = new Float32Array(M), SS = new Float32Array(M), OV = new Float32Array(M);
      const qOf = (k) => { const a = k % P.nx - ia, j = Math.floor(k / P.nx) - ja; return a < 0 || j < 0 || a >= qnx || j >= qnz ? -1 : j * qnx + a; };
      rasterLine(P, r.points, reach, (k, u, s, over, d) => { const q = qOf(k); if (d < best[q]) { best[q] = d; U[q] = u; SS[q] = s; OV[q] = over; } });
      const nodes = function* () { for (let j = 0; j < qnz; j++) for (let a = 0; a < qnx; a++) { const q = j * qnx + a; if (best[q] < 1e9) yield [(j + ja) * P.nx + a + ia, q]; } };
      return { r, best, U, SS, OV, qOf, nodes };
    });
    for (const { r, U, OV, nodes } of perRun) {
      for (const [k, q] of nodes()) { const e = edgeOf(U[q], r.detail.hw, OV[q]); if (e < edge[k]) edge[k] = e; }
    }
    for (let k = 0; k < N; k++) edge[k] = Math.min(edge[k], others[k]);
    for (const { r, U, SS, OV, nodes } of perRun) {
      const D = r.detail, hw = D.hw;
      for (const [k, q] of nodes()) {
        const u = U[q], s = SS[q], e = edgeOf(u, hw, OV[q]);
        // station values at s
        let lo = 0, hi = D.S.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D.S[m] <= s) lo = m; else hi = m; }
        const f = clamp((s - D.S[lo]) / ((D.S[hi] - D.S[lo]) || 1), 0, 1);
        const g = D.G[lo] + (D.G[hi] - D.G[lo]) * f, kk = D.K[lo] + (D.K[hi] - D.K[lo]) * f;
        let h = g + kk * clamp(u, -hw - BLEND, hw + BLEND);
        if (Math.abs(u) < hw) h += CROWN * (1 - (u / hw) * (u / hw));
        // the windrow, except where it would sit on another groomed run's snow
        let away = 60;
        for (const o of perRun) {
          if (o.r === r) continue;
          const oq = o.qOf(k);
          if (oq >= 0 && o.best[oq] < 1e9) away = Math.min(away, edgeOf(o.U[oq], o.r.detail.hw, o.OV[oq]));
        }
        away = Math.min(away, others[k]);
        if (e > 0 && e < BERM_W) h += BERM * Math.sin(Math.PI * e / BERM_W) * clamp(away / 2, 0, 1);
        // back to the 10 m mountain past the edge, and over the last stretch where the run ends
        const w = Math.max(smoothstep(BERM_W, BLEND, e), smoothstep(D.len - TAPER, D.len - 5, s));
        const a = 1 - w + 1e-4;
        sum[k] += h * a; wsum[k] += a; wmin[k] = Math.min(wmin[k], w);
      }
    }
    // one height grid for the physics (blending into the smooth 10 m surface) and one for the mesh
    // (blending into the 10 m triangles, so the seam with the ground around it is exact)
    const hp = new Float32Array(N), hr = new Float32Array(N), mask = new Uint8Array(N * 4);
    for (let j = 0; j < P.nz; j++) {
      for (let a = 0; a < P.nx; a++) {
        const k = j * P.nx + a, x = x0 + a * PCELL, z = z0 + j * PCELL, w = wmin[k];
        const s = wsum[k] ? sum[k] / wsum[k] : 0;
        hp[k] = s * (1 - w) + groundY(x, z) * w;
        hr[k] = s * (1 - w) + meshY(x, z) * w;
        if (w < 0.95) mask[k * 4] = 255;
      }
    }
    // the fine mesh: every 2 m cell the runs touch
    // only the nodes those cells use become vertices
    const vert = new Int32Array(N).fill(-1), pos = [], cov = [], idx = [];
    const v = (k) => {
      if (vert[k] < 0) {
        const x = x0 + (k % P.nx) * PCELL, z = z0 + Math.floor(k / P.nx) * PCELL, c = cellAt(x, z);
        vert[k] = pos.length / 3;
        pos.push(x, hr[k], z);
        cov.push(edge[k], isRock(c) && edge[k] > 3 ? 1 : 0, conifer(c), aspen(c));
      }
      return vert[k];
    };
    for (let j = 0; j < P.nz - 1; j++) {
      for (let a = 0; a < P.nx - 1; a++) {
        const k = j * P.nx + a;
        if (Math.min(wmin[k], wmin[k + 1], wmin[k + P.nx], wmin[k + P.nx + 1]) >= 1) continue;
        const k00 = v(k), k10 = v(k + 1), k01 = v(k + P.nx), k11 = v(k + P.nx + 1);
        if ((a + j) & 1) idx.push(k00, k01, k10, k10, k01, k11);
        else idx.push(k00, k01, k11, k00, k11, k10);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aCov', new THREE.BufferAttribute(new Float32Array(cov), 4));
    geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      uniforms: terrainMat.uniforms, vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
      defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    P.mesh = new THREE.Mesh(geo, mat);
    P.mesh.matrixAutoUpdate = false;
    scene.add(P.mesh);
    const tex = new THREE.DataTexture(mask, P.nx, P.nz);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    terrainMat.uniforms.uPMask.value = tex;
    terrainMat.uniforms.uPMin.value.set(x0 - PCELL / 2, z0 - PCELL / 2);
    terrainMat.uniforms.uPSize.value.set(P.nx * PCELL, P.nz * PCELL);
    terrainMat.uniforms.uPOn.value = 1;
    Object.assign(P, { hp, edge, wmin, tris: idx.length / 3,
      ax: x0 + 2 * PCELL, az: z0 + 2 * PCELL, bx: x0 + (P.nx - 3) * PCELL, bz: z0 + (P.nz - 3) * PCELL });
    PATCH = P;
  }
}
// signed meters to the nearest groomed edge where the detailed runs are, undefined elsewhere
function patchEdge(x, z) {
  const P = PATCH;
  if (!patchOn || !P || x <= P.ax || x >= P.bx || z <= P.az || z >= P.bz) return undefined;
  const fx = (x - P.x0) / PCELL, fz = (z - P.z0) / PCELL, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * P.nx + i, E = P.edge;
  return (E[k] * (1 - tx) + E[k + 1] * tx) * (1 - tz) + (E[k + P.nx] * (1 - tx) + E[k + P.nx + 1] * tx) * tz;
}
function setPatch(on) {
  patchOn = on;
  if (PATCH) PATCH.mesh.visible = on;
  terrainMat.uniforms.uPOn.value = on && PATCH ? 1 : 0;
}
const onGroomed = (x, z) => { const e = patchEdge(x, z); return e === undefined ? RUNF[cellAt(x, z)] < 0 : e < 0; };
// Trees stand in a wall along the detailed runs' edges where the photo shows forest there
{
  for (const r of RUNS) {
    if (!r.detail) continue;
    const D = r.detail;
    for (const side of [1, -1]) {
      for (let d = 2, q = 0; d < D.len - TAPER; d += 4.5, q++) {
        const p = alongRun(r, d), hsh = hash2(q * 7 + (side > 0 ? 1 : 0), Math.floor(d));
        const off = D.hw + 4 + hsh * 5, x = p.x + p.uz * off * side, z = p.z - p.ux * off * side;
        const c = cellAt(x, z), cov = conifer(c) + aspen(c) * 0.5;
        if (cov < 0.25 || hsh > cov + 0.25 || LIFT_CUT[c] || isRock(c)) continue;
        if (patchEdge(x, z) < 3.5) continue;          // not out onto the other run
        const y = groundY(x, z), kind = y > 3380 && hsh < 0.3 ? KIND.snowghost : hsh < 0.55 ? KIND.spruce : KIND.fir;
        const height = kind === KIND.snowghost ? 2.6 + hsh * 1.6 : (kind === KIND.spruce ? 15 : 12) + hash2(q, 77) * 8;
        const t = { x, z, y: y - 0.3, height, r: TREE_R[kind] * height, kind };
        addProp(t);
        addObstacle(t);
      }
    }
  }
}
// sign boards: every run name drawn once onto one canvas, light lettering on a dark wooden board
const SIGN_W = 128, SIGN_H = 32, SIGN_COLS = 8;
const signNames = [...new Set(RUNS.filter((r) => r.name && !r.area).map((r) => r.name))];
const signCanvas = document.createElement('canvas');
signCanvas.width = SIGN_W * SIGN_COLS; signCanvas.height = SIGN_H * Math.ceil(signNames.length / SIGN_COLS);
{
  const g = signCanvas.getContext('2d');
  signNames.forEach((name, n) => {
    const x = (n % SIGN_COLS) * SIGN_W, y = Math.floor(n / SIGN_COLS) * SIGN_H;
    g.fillStyle = '#3b2717'; g.fillRect(x, y, SIGN_W, SIGN_H);
    g.fillStyle = '#5a3b22'; g.fillRect(x, y + SIGN_H / 2 - 1, SIGN_W, 2);
    g.strokeStyle = '#1c120a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, SIGN_W - 2, SIGN_H - 2);
    let size = 20;
    do { g.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`; size--; } while (g.measureText(name).width > SIGN_W - 12 && size > 8);
    g.fillStyle = '#f1e6c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, x + SIGN_W / 2, y + SIGN_H / 2 + 1);
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
// one sign per name, at the highest start among that name's pieces
const signRuns = new Map();
for (const r of RUNS) {
  if (!r.name || r.area || r.points.length < 2) continue;
  const h = groundY(r.points[0][0], r.points[0][1]), best = signRuns.get(r.name);
  if (!best || h > best.h) signRuns.set(r.name, { run: r, h });
}
for (const [name, { run }] of signRuns) {
  const a = alongRun(run, 8), b = alongRun(run, 30);
  const ux = b.x - a.x, uz = b.z - a.z, len = Math.hypot(ux, uz) || 1, dx = ux / len, dz = uz / len;
  // beside the run, off the edge, nudged along until it is clear of other signs and of groomed snow
  let x = 0, z = 0, ok = false;
  for (let tries = 0; tries < 12 && !ok; tries++) {
    const side = tries % 2 ? -1 : 1, down = 26 + Math.floor(tries / 2) * 7, off = run.width / 2 + 3;
    const p = alongRun(run, down);
    x = p.x + dz * off * side; z = p.z - dx * off * side;
    ok = !onGroomed(x, z) && signSpots.every((s) => Math.hypot(s.x - x, s.z - z) > 6);
  }
  signSpots.push({ x, z, name, dx, dz });
  const y = groundY(x, z), yaw = Math.atan2(-dx, -dz);   // the board faces skiers coming down
  const m = placeM(x, y - 0.3, z, yaw);
  runParts.push(...placed([
    part(new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(-1.0, 1.15, 0), WOOD_DARK),
    part(new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(1.0, 1.15, 0), WOOD_DARK),
    part(new THREE.BoxGeometry(2.5, 0.68, 0.08).translate(0, 1.95, 0), WOOD),
  ], m));
  const n = signNames.indexOf(name), u0 = (n % SIGN_COLS) / SIGN_COLS, u1 = u0 + 1 / SIGN_COLS;
  const v1 = 1 - Math.floor(n / SIGN_COLS) * SIGN_H / signCanvas.height, v0 = v1 - SIGN_H / signCanvas.height;
  const face = new THREE.PlaneGeometry(2.4, 0.6).translate(0, 1.95, 0.05).applyMatrix4(m);
  const fp = face.attributes.position, fuv = [[u0, v1], [u1, v1], [u0, v0], [u1, v0]], nrm = [Math.sin(yaw), 0, Math.cos(yaw)];
  for (const idx of face.index.array) {
    facePos.push(fp.getX(idx), fp.getY(idx), fp.getZ(idx));
    faceUv.push(...fuv[idx]);
    faceNrm.push(...nrm);
  }
  casters.push({ x, z, h: 2.3, w: 1.2 });
}
{
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(facePos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(faceUv), 2));
  g.setAttribute('aNrm', new THREE.BufferAttribute(new Float32Array(faceNrm), 3));
  g.computeBoundingSphere();
  scene.add(new THREE.Mesh(g, signMat));
}
// rope lines on bamboo poles down both edges of the first 170 m of Sunnyside and Max Park,
// broken wherever the edge runs onto the other run's groomed snow
const ropePts = [];
for (const name of ['Sunnyside', 'Max Park']) {
  const run = signRuns.get(name)?.run;
  if (!run) continue;
  for (const side of [1, -1]) {
    let prev = null;
    for (let d = 4; d <= 170; d += 6) {
      const p = alongRun(run, d), off = run.width / 2 + 1.2;
      const x = p.x + p.uz * off * side, z = p.z - p.ux * off * side;
      if (onGroomed(x, z)) { prev = null; continue; }
      const y = groundY(x, z);
      addProp({ x, z, y: y - 0.15, height: 1.7, r: 0, kind: KIND.pole });
      if (prev) ropePts.push(prev[0], prev[1], prev[2], x, y + 1.25, z);
      prev = [x, y + 1.25, z];
    }
  }
}
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ropePts), 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8261c })));
}
// a wooden rail fence behind the Village Express top terminal, where the ridge drops away
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
// FreePlay starts at the top of Village Express, a little way down Sunnyside, facing down it.
// The Tab menu can move the start (and every trip back up) to the top of Powderhorn instead.
const STARTS = [];
for (const [name, label] of [['Sunnyside', 'Start: Sunnyside'], ['Powderhorn', 'Start: Powderhorn']]) {
  const run = signRuns.get(name)?.run;
  if (!run) continue;
  const p = alongRun(run, 3), q = alongRun(run, 45);
  STARTS.push({ label, x: p.x, z: p.z, heading: Math.atan2(q.x - p.x, -(q.z - p.z)) });
}
if (STARTS.length) Object.assign(META.start, STARTS[0], { name: 'Village Express, top' });
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cablePts), 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a1c24 }));
  lines.frustumCulled = false;
  scene.add(lines);
}
// carriers: chairs, gondola cabins and T-bar hangers, each one instanced mesh, hanging below the cable
const CARRIER_GEO = {
  chair: merge([
    part(new THREE.BoxGeometry(0.14, 2.6, 0.14).translate(0, -1.3, 0), DARK),
    part(new THREE.BoxGeometry(2.4, 0.25, 0.9).translate(0, -2.6, 0.2), SEAT),
    part(new THREE.BoxGeometry(2.4, 1.0, 0.15).translate(0, -2.1, -0.25), SEAT),
    part(new THREE.BoxGeometry(2.4, 0.08, 0.08).translate(0, -1.7, 0.75), DARK),
  ]),
  cabin: merge([
    part(new THREE.BoxGeometry(0.14, 1.6, 0.14).translate(0, -0.8, 0), DARK),
    part(new THREE.BoxGeometry(2.0, 2.1, 2.0).translate(0, -2.7, 0), CABIN),
    part(new THREE.BoxGeometry(2.04, 0.8, 1.6).translate(0, -2.3, 0), GLASS),
    part(new THREE.BoxGeometry(1.6, 0.3, 1.6).translate(0, -1.55, 0), STEEL),
  ]),
  bar: merge([
    part(new THREE.BoxGeometry(0.1, 3.6, 0.1).translate(0, -1.8, 0), STEEL),
    part(new THREE.BoxGeometry(1.1, 0.12, 0.12).translate(0, -3.6, 0), DARK),
  ]),
};
const carrierMeshes = {};
for (const k of Object.keys(carriers)) {
  const m = new THREE.InstancedMesh(CARRIER_GEO[k], modelMat, Math.max(1, carriers[k].length));
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
const cp = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
function placeCarriers(t) {
  for (const k of Object.keys(carriers)) {
    const m = carrierMeshes[k], e = m.instanceMatrix.array;
    carriers[k].forEach((c, n) => {
      const lp = c.lp, d = (c.s0 + t * lp.speed) % (2 * lp.L), up = d < lp.L;
      pathAt(lp, up ? d : 2 * lp.L - d, cp);
      const len = Math.hypot(cp.dx, cp.dz) || 1, ux = cp.dx / len, uz = cp.dz / len;
      const side = up ? 1 : -1, fx = ux * side, fz = uz * side;   // riders face the way they travel
      const x = cp.x + uz * lp.arm * side, z = cp.z - ux * lp.arm * side;
      // rotation about y taking local +z to (fx, fz)
      e.set([fz, 0, -fx, 0, 0, 1, 0, 0, fx, 0, fz, 0, x, cp.y, z, 1], n * 16);
    });
    m.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Lamps: one on every terminal hut, lit at night ----------
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

// ---------- Shadows: trees, rocks and lift towers painted top down along the sun, around the camera ----------
const shCanvas = document.createElement('canvas');
shCanvas.width = shCanvas.height = SH_PX;
const shCtx = shCanvas.getContext('2d', { willReadFrequently: true });
const shTex = new THREE.CanvasTexture(shCanvas);
shTex.magFilter = shTex.minFilter = THREE.NearestFilter; shTex.generateMipmaps = false;
LIGHT.uShadow.value = shTex;
let shAt = null, shPix = null;
function paintShadows(force) {
  const cx = camera.position.x, cz = camera.position.z;
  if (!force && shAt && Math.hypot(cx - shAt.x, cz - shAt.z) < SH_SIZE * 0.18) return;
  shAt = { x: cx, z: cz };
  const ox = Math.round((cx - SH_SIZE / 2) / 8) * 8, oz = Math.round((cz - SH_SIZE / 2) / 8) * 8;
  LIGHT.uShO.value.set(ox, oz);
  const g = shCtx, k = SH_PX / SH_SIZE, s = SUN_DIR;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, SH_PX, SH_PX); g.fillStyle = '#fff';
  const flat = Math.hypot(s.x, s.z) || 1e-3, dx = -s.x / flat, dz = -s.z / flat, ang = Math.atan2(s.x, -s.z);
  const one = (x, z, h, w) => {
    const len = Math.min(h * 4, h * flat / Math.max(0.15, s.y));
    const px = (x + dx * len / 2 - ox) * k, pz = (z + dz * len / 2 - oz) * k, r = (len / 2 + w * 0.3) * k;
    if (px < -r || pz < -r || px > SH_PX + r || pz > SH_PX + r) return;
    g.setTransform(1, 0, 0, 1, px, pz); g.rotate(ang);
    g.beginPath(); g.ellipse(0, 0, Math.max(0.6, w * k), r, 0, 0, Math.PI * 2); g.fill();
  };
  const P = PAGE * CELL;
  const a0 = Math.floor((ox - 60 - X0) / P), a1 = Math.floor((ox + SH_SIZE + 60 - X0) / P);
  const b0 = Math.floor((oz - 60 - Z0) / P), b1 = Math.floor((oz + SH_SIZE + 60 - Z0) / P);
  for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
    if (a < 0 || b < 0 || a * PAGE >= NX || b * PAGE >= NZ) continue;
    const pg = makePage(a, b);
    for (const t of pg.list) one(t.x, t.z, t.height, t.height * atlas.rects[t.kind].aspect * 0.32);
    for (const r of pg.rocks) one(r.x, r.z, r.height, r.s * 0.8);
  }
  for (const c of casters) one(c.x, c.z, c.h, c.w);
  g.setTransform(1, 0, 0, 1, 0, 0);
  shTex.needsUpdate = true;
  shPix = g.getImageData(0, 0, SH_PX, SH_PX).data;
}
// how much sun reaches a point, for Goldie
function sunAt(x, z) {
  if (!shPix) return 1;
  const u = Math.floor((x - LIGHT.uShO.value.x) / SH_SIZE * SH_PX), v = Math.floor((z - LIGHT.uShO.value.y) / SH_SIZE * SH_PX);
  if (u < 0 || v < 0 || u >= SH_PX || v >= SH_PX) return 1;
  return 1 - shPix[(v * SH_PX + u) * 4] / 255;
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
let pixelLook = false;           // full resolution by default; the 320x180 look is a Tab toggle
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
  paintShadows(true);
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

// ---------- The skier: one camera-facing sprite from Goldie's sheet, plus a blob shadow ----------
// Snowlight: each sprite pixel is lit from its normal map by the sun, the sky above
// and the sunlit snow below, then snapped to four bands.
const FRAMES = { stand: 0, carveL: 1, carveR: 2, tuck: 3, brake: 4, air: 5, land: 6, wipeout: 7, front: 8, celebrate: 9 };
const SPRITE_H = 2.0, SPRITE_W = 1.5;
const skierMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: goldieT },
    normalMap: { value: goldieN },
    frameOffset: { value: 0 },
    sunLocal: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: SUN_COLOR },
    skyColor: { value: SKY_COLOR },
    bounce: { value: BOUNCE },
    uLit: { value: 1 },
  },
  vertexShader: `
    uniform float frameOffset;
    varying vec2 vUv;
    void main() {
      vUv = vec2(uv.x * 0.1 + frameOffset, uv.y);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform sampler2D normalMap;
    uniform vec3 sunLocal, sunColor, skyColor, bounce;
    uniform float uLit;
    varying vec2 vUv;
    float band(float v) { return max(0.12, floor(v * 4.0 + 0.5) / 4.0); }
    void main() {
      vec4 albedo = texture2D(map, vUv);
      if (albedo.a < 0.5) discard;
      vec3 n = normalize(texture2D(normalMap, vUv).rgb * 2.0 - 1.0);
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
// Keyboard: Left/Right or A/D steer, Up or W pushes with the poles (Momentum only), Down or S brakes,
// Shift tucks, Space jumps (in Momentum, hold to load and release to pop).
// Touch or mouse: drag sideways to steer, hold still to tuck, swipe down to push with the poles,
// swipe up to brake, tap to jump.
// The newest finger down steers; lifting it hands steering back to any finger still down.
const input = { steer: 0, tuck: false, brake: false, pole: false, jump: false };
const keys = new Set();
let keySteer = 0;
const STEER_PX = 70;
const ptr = { id: null, x0: 0, x: 0, y: 0, t0: 0, travel: 0, lastMove: 0, steer: 0, woke: false, hist: [], passive: false, topY: 0 };
const touches = new Map();      // every finger down: id -> [x, y]
let hockeyStop = false;         // a swipe up starts a stop that holds until you've stopped
let poleSwipe = false;          // a swipe down asks for one push with the poles
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'pole', KeyW: 'pole', ArrowDown: 'brake', KeyS: 'brake', ShiftLeft: 'tuck', ShiftRight: 'tuck', Space: 'jump' };
window.addEventListener('keydown', (e) => {
  if (debugKey(e)) return;
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
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
  ptr.travel = handedOver ? Infinity : 0;  // a finger that was already down can't count as a tap
  ptr.passive = handedOver;                // ...or tuck by resting until it moves
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
  // Hockey stop: a quick, mostly upward flick (40 px within a quarter second).
  // Pulling the thumb back down cancels it.
  ptr.hist.push([now, ptr.x, ptr.y]);
  while (now - ptr.hist[0][0] > 250) ptr.hist.shift();
  const up = ptr.hist[0][2] - ptr.y, side = Math.abs(ptr.x - ptr.hist[0][1]);
  if (dy < 0 && up > 40 && up > 1.5 * side) { hockeyStop = true; ptr.topY = ptr.y; }
  ptr.topY = Math.min(ptr.topY, ptr.y);
  if (hockeyStop && ptr.y - ptr.topY > 20) hockeyStop = false;
  // Poles: a quick, mostly downward flick, one push per flick.
  const down = ptr.y - ptr.hist[0][2];
  if (dy > 0 && down > 40 && down > 1.5 * side) { poleSwipe = true; ptr.hist = [[now, ptr.x, ptr.y]]; }
  // keep the anchor within one full steer of the thumb so reversing responds at once
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
    // Another finger is still down: it takes over steering from where it is.
    const [id, [x, y]] = rest[rest.length - 1];
    anchor(id, x, y, true);
  } else {
    ptr.id = null; ptr.steer = 0;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Debug menu (Tab), for testing on a laptop ----------
// One list of settings. Freecam is a noclip camera: WASD flies where you look, the mouse looks around,
// Shift goes faster. Goldie holds still while it's on.
const debugEl = document.getElementById('debug');
const free = { on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set(), drag: false };
const FREE_SPEED = 30;          // m/s
const FREE_FAST = 10;           // Shift multiplies speed by this
const FREE_LOOK = 0.0022;       // radians per pixel of mouse movement
const FREE_KEYS = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'fast', ShiftRight: 'fast' };
const speedEl = Object.assign(document.createElement('div'), { hidden: true });
speedEl.style.cssText = 'position:fixed;top:12px;right:14px;font:600 15px ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 1px 2px #13244d;pointer-events:none';
document.body.append(speedEl);
const DEBUG_ITEMS = [
  { name: 'Freecam', get: () => free.on, set: (on) => setFreecam(on) },
  { name: 'Momentum physics (off = Classic)', get: () => physics.momentum, set: (on) => { physics.momentum = on; } },
  { name: 'Assists (Momentum only)', get: () => physics.assists, set: (on) => { physics.assists = on; } },
  { name: 'Speed readout', get: () => !speedEl.hidden, set: (on) => { speedEl.hidden = !on; } },
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
// Toggling a setting closes the menu, so turning freecam on puts you straight into flying.
function toggleItem(k) {
  DEBUG_ITEMS[k].set(!DEBUG_ITEMS[k].get());
  openMenu(false);
}
// Keys the debug menu and freecam claim before the skier sees them.
function debugKey(e) {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!e.repeat) openMenu(debugEl.hidden);
    return true;
  }
  // With the menu open, Enter toggles the highlighted row; the skiing keys keep working.
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
// Phones have no Tab key: a three-finger tap opens and closes the menu.
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 3) openMenu(debugEl.hidden); }, { passive: true });
function lockPointer() {
  // Some embeds don't allow pointer lock; dragging with the button held looks around instead.
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
};
let phase = 'ready';            // ready (standing at the summit) -> skiing -> back (fading to the summit)
let simTime = 0, backT = 0, trips = 0;
let cameraSnap = true;
const tmpN = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FLAT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
// FreePlay starts at the top of the real Big Burn chair, the highest chairlift, facing down its line.

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
  cameraSnap = true;
}
function toSummit() {
  phase = 'ready';
  placeSkier(META.start.x, META.start.z, META.start.heading, 0);
  hockeyStop = false;
  fadeEl.classList.remove('on');
}
function wake() {
  if (phase === 'ready') {
    phase = 'skiing';
    placeSkier(sk.pos.x, sk.pos.z, sk.heading, PUSH);
    input.jump = false;
  }
}
// The trip back up: fade out, then stand at the summit again (stand-in for the lift cutscene).
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

  // Steering turns the skis; the snow decides how much of that the skier's path follows.
  sk.heading += sk.steer * TURN_RATE * (sk.tuck ? TUCK_TURN : 1) * dt;
  const slope = Math.hypot(s0.gx, s0.gz);
  if (slope > 0.03) {
    const fall = Math.atan2(-s0.gx, s0.gz);
    sk.heading = fall + clamp(wrapAngle(sk.heading - fall), -MAX_HEADING, MAX_HEADING);
  }
  sk.heading = wrapAngle(sk.heading);
  const f = skiDir(n, tmpF);

  // Gravity along the slope.
  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));

  let speed = sk.vel.length();
  sk.skid = 0;
  if (speed < 0.3) {
    // Nearly stopped: skis don't slide sideways, and you can't slide backwards.
    const along = sk.vel.dot(f);
    sk.vel.copy(f).multiplyScalar(Math.max(0, along));
    speed = sk.vel.length();
  } else {
    // Edge grip bends the velocity toward the skis. Within the grip limit that's a carve;
    // whatever is left over is a skid that bleeds speed.
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
    // Nearly stopped, friction never quite beats the slope, so pointing downhill always gets you going.
    if (speed < 2) fric = Math.min(fric, 0.8 * G * Math.hypot(n.x, n.z));
    const decel = fric + drag + SKID * sk.skid * nAcc + (sk.brake ? BRAKE : 0);
    const next = Math.max(0, speed - decel * dt);
    sk.vel.multiplyScalar(next / speed);
  }

  // Jump: pop off the snow along the slope normal.
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
  // If the ground falls away faster than gravity can pull you down onto it, you're in the air.
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
  const A = assist();
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const surf = surfaceAt(sk.pos.x, sk.pos.z);
  const nAcc = G * n.y;
  let speed = sk.vel.length();
  const yaw0 = travelYaw();

  // Rolling onto an edge takes a moment, and the skis pivot slower the faster you're going.
  sk.edge += (Math.abs(sk.steer) - sk.edge) * Math.min(1, MO.EDGE_IN * dt);
  sk.heading = wrapAngle(sk.heading + sk.steer * (MO.PIVOT / (1 + speed / MO.PIVOT_FALL)) * (sk.tuck ? TUCK_TURN : 1) * dt);
  const f = skiDir(n, tmpF);

  // Gravity along the slope.
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
    // The edge can only push sideways so hard (grip times the snow holding you up, more the further
    // you lean). That sideways push is what bends your momentum; ask for more and the rest is a skid.
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

  // Poles: a double-pole push adds speed along the skis. Strong from a standstill, nothing once you're moving.
  sk.poleCD = Math.max(0, sk.poleCD - dt);
  if (sk.pole && sk.poleCD === 0 && speed < MO.POLE_MAX) {
    sk.vel.addScaledVector(f, MO.POLE * (1 - speed / MO.POLE_MAX));
    sk.poleCD = MO.POLE_EVERY;
    sk.poleT = 0.22;
  }

  // How fast your path is turning right now: carried into the air as spin.
  sk.yawRate += (wrapAngle(travelYaw() - yaw0) / dt - sk.yawRate) * 0.3;

  // Ollie: load by holding jump, pop on release, partly off the slope and partly straight up.
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

function airStepM(dt) {
  const A = assist();
  // Steering in the air is torque on the spin you took off with; let go and the spin carries on.
  if (sk.steer) sk.spin += sk.steer * MO.SPIN_IN * dt;
  else {
    sk.spin *= Math.max(0, 1 - MO.SPIN_DAMP * dt);
    // Assist: with nothing held and no big spin going, the skis drift back in line with your travel.
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

// Landing keeps all the momentum along the slope; only the part going into the snow is absorbed.
// Land on a steep downslope and you keep your speed; land flat from high up and the impact gets you.
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
  if (miss > A.sloppy * Math.PI / 180 || impact > A.crash) {
    crash();
  } else if (miss > A.clean * Math.PI / 180 || impact > HARD_IMPACT) {
    // The skis scrub off the part of your speed that isn't along them.
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
  sk.crashed = true;
  sk.crashT = 0;
  sk.landT = 0;
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
        if (!sk.crashed && -into > CRASH_HIT_SPEED) {
          crash();
          sk.vel.multiplyScalar(0.35);
        } else {
          // Brushing a trunk: lose the part of your speed going into it and slide round it.
          // A real knock is still a hard stop.
          sk.vel.x -= into * nx;
          sk.vel.z -= into * nz;
          if (-into > 1) sk.vel.multiplyScalar(0.3);
          // Stopped dead against it, ease round on the downhill side so you're never pinned.
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
// Collisions need the trees around the skier even before the camera has drawn them.
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
  if (sk.crashed) crashStep(dt);
  else if (sk.grounded) groundStep(dt);
  else airStep(dt);
  input.jump = false;
  if (hockeyStop && (sk.vel.length() < 1 || sk.crashed || !sk.grounded)) hockeyStop = false;
  // A swipe's push waits out the pole cooldown, but not a fall or a jump.
  if (poleSwipe && (sk.poleT > 0 || sk.crashed || !sk.grounded || !physics.momentum)) poleSwipe = false;
  sk.landT = Math.max(0, sk.landT - dt);
  ensureTreesNear(sk.pos.x, sk.pos.z);
  treeCollide();
  // FreePlay never dead-ends: stalling on flat ground for a few seconds (the base, a flat cat track)
  // or skiing off the edge of the map takes you back to the summit. Stopped on a slope, you can always
  // point downhill and go, so that never counts.
  const under = sample(sk.pos.x, sk.pos.z);
  if (!sk.crashed && sk.grounded && sk.vel.length() < 1.5 && Math.hypot(under.gx, under.gz) < FLAT && !sk.pole) sk.stopT += dt;
  else sk.stopT = 0;
  if (sk.stopT > STOP_TIME || offMap(sk.pos.x, sk.pos.z)) sendBack();
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
  const fov = Math.min(66, 60 + speed * 0.22) * (camera.aspect < 1 ? 1.15 : 1);
  if (cameraSnap) { camera.fov = fov; camera.updateProjectionMatrix(); }
  else if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  cameraSnap = false;
}

function pickFrame(cameraInFront) {
  const speed = sk.vel.length();
  if (sk.crashed) return FRAMES.wipeout;
  if (cameraInFront) return FRAMES.front;
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
  // high up, push the near plane out so far-off ground keeps its depth precision
  const near = clamp((free.pos.y - groundY(free.pos.x, free.pos.z)) * 0.05, 0.5, 25);
  if (Math.abs(near - camera.near) > 0.02 * camera.near) { camera.near = near; camera.updateProjectionMatrix(); }
}

function render(alpha, dt) {
  const p = view.copy(sk.prev).lerp(sk.pos, alpha);
  const snap = cameraSnap;
  if (free.on) updateFreecam(dt);
  else updateCamera(p, dt);
  updateTerrain();
  updateTrees(snap);
  sky.position.set(camera.position.x, camera.position.y + sky.userData.h * 0.36, camera.position.z);

  // Sprite: turn to face the camera around the vertical axis only.
  skierMesh.position.copy(p);
  const yaw = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
  skierMesh.rotation.y = yaw;
  // Sun in the sprite's space: x along the sprite's right, z toward the camera.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  skierMat.uniforms.sunLocal.value.set(SUN_DIR.x * cy - SUN_DIR.z * sy, SUN_DIR.y, SUN_DIR.x * sy + SUN_DIR.z * cy);
  tmpA.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
  const facing = tmpA.x * Math.sin(sk.heading) - tmpA.z * Math.cos(sk.heading);
  const frame = pickFrame(facing > 0.35);
  if (frame !== sk.frame) { skierMat.uniforms.frameOffset.value = frame / 10; sk.frame = frame; }

  const s = sample(p.x, p.z);
  normalFrom(s, tmpN);
  shadow.position.set(p.x, s.h + 0.06, p.z);
  shadow.quaternion.setFromUnitVectors(UP, tmpN).multiply(FLAT_Q);
  const lift = Math.max(0, p.y - s.h);
  shadow.material.opacity = clamp(1 - lift / 8, 0.2, 1);
  shadow.scale.setScalar(1 + lift * 0.08);

  updateSpray(p, dt);
  if (!speedEl.hidden) speedEl.textContent = `${Math.round(sk.vel.length() * 3.6)} km/h · ${physics.momentum ? (physics.assists ? 'Momentum' : 'Momentum, raw') : 'Classic'}`;
  updateWorld(dt);
  skierMat.uniforms.uLit.value = sunAt(p.x, p.z);
  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  // the pixel look draws the short side at 180 pixels and scales up without smoothing, like the World Kit
  renderer.setPixelRatio(pixelLook ? 180 / Math.min(w, h) : Math.min(window.devicePixelRatio || 1, 2));
  canvas.style.imageRendering = pixelLook ? 'pixelated' : 'auto';
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
// A window dragged to a screen with a different pixel density may not fire resize.
(function watchDensity() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { resize(); watchDensity(); }, { once: true });
})();

// ---------- Main loop ----------
let manual = false, acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!manual && !free.on) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { step(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
  }
  render(manual ? 1 : acc / STEP, dt);
}
skierMat.uniforms.frameOffset.value = FRAMES.stand / 10;
resize();
applyTime('noon');
toSummit();
requestAnimationFrame(frame);

// ---------- Test hooks ----------
window.__golden = {
  sk, input, META, physics, MO, ASSIST, keys, sample, surfaceAt, renderer, camera, pages,
  cover: (x, z) => { const k = cellAt(x, z); return { conifer: conifer(k), aspen: aspen(k), rock: isRock(k), powder: POWDER[k], h: H[k] }; },
  get phase() { return phase; },
  get trips() { return trips; },
  get trees() { return treeGeo.instanceCount; },
  setManual(on) { manual = on; },
  get free() { return free; },
  get menuOpen() { return !debugEl.hidden; },
  freecam(on) { setFreecam(on); },
  // run n fixed steps; `hold` overrides input each step: { steer, tuck, brake, jump }
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
  get patch() { return PATCH; }, patchEdge, setPatch, groundY,
};

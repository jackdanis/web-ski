// Landforms: shapes cut into the mountain itself.
// Rock bands (Gowdy's flank, laser notes batch 4, 2026-10-28; the expert terrain, 2026-11-02): a snow shelf ending in a
// lip over a grey rock face, 2 to 5 m tall, to jump off. The shelf is snow lifted onto the slope (a KICKERS lift); the
// face is drawn in front of it.
// Cornices (2026-11-02): the same shelf on the rollover at the top of a headwall, its face snow that curls out over the
// drop, white on top and blue underneath.
// Wind lips (2026-11-02): a low rounded snow ridge across a rollover, long and gentle on the uphill side, short and steep
// on the downhill side. Snow only, no face.
// Rock outcrops (2026-11-02): the Batch B rock outcrop sprite, scattered beside the bands. Solid.
// Each feature is placed by run: a distance down the run's line and an offset across it (+ is to the skier's right),
// so the run line itself stays open and the drops sit beside it.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from '../data/mountain.js';
import { ease } from './config.js';
import { KICKERS, addObstacle, sampleBase, samplePatch } from './world.js';
import { state } from './state.js';
import { camera, scene } from './scene.js';
import { RING_FAR, merge, modelMat, part, rockGeo } from './buildings.js';
import { KIND, addProp } from './trees.js';

const bB = { h: 0, gx: 0, gz: 0 };
const base = (x, z) => sampleBase(x, z, bB).h;
function fall(x, z) {
  let gx = 0, gz = 0;
  for (let a = -10; a <= 10; a += 5) for (let b = -10; b <= 10; b += 5) { sampleBase(x + a, z + b, bB); gx += bB.gx; gz += bB.gz; }
  const g = Math.hypot(gx, gz) || 1;
  return [-gx / g, -gz / g];
}
// a point d m down a run's line
function onRun(name, d) {
  const r = MAP.runs.find((q) => q.name === name), p = r.points;
  let left = d;
  for (let i = 0; i < p.length - 1; i++) {
    const L = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    if (left <= L || i === p.length - 2) { const f = Math.min(1, left / L); return [p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f]; }
    left -= L;
  }
}
// at: the lip centre, or [run, metres down it, metres across it]; len along the lip; h the drop; shelf the depth up the slope
const FEATURES = [
  // Gowdy's flank (batch 4)
  { kind: 'band', at: [350, -1110], len: 40, h: 2.5, shelf: 8 },
  { kind: 'band', at: [385, -1126], len: 50, h: 3.8, shelf: 10 },
  { kind: 'band', at: [420, -1142], len: 36, h: 3.0, shelf: 9 },
  // rock bands beside the steepest pitches of the expert runs
  { kind: 'band', run: ['KT Gully', 370, -24], len: 32, h: 4.5, shelf: 9 },
  { kind: 'band', run: ['Rock Island', 230, 22], len: 28, h: 3.0, shelf: 8 },
  { kind: 'band', run: ['Rock Island', 375, -22], len: 36, h: 5.5, shelf: 10 },
  { kind: 'band', run: ['Rock Band Chute', 20, -16], len: 22, h: 4.0, shelf: 9 },     // a chute between two bands
  { kind: 'band', run: ['Rock Band Chute', 20, 16], len: 22, h: 4.0, shelf: 9 },
  { kind: 'band', run: ['Wall 2', 45, 22], len: 32, h: 5.5, shelf: 9 },
  { kind: 'band', run: ['Wall 1', 95, -24], len: 36, h: 5.0, shelf: 10 },
  { kind: 'band', run: ['Possible', 160, 22], len: 30, h: 3.5, shelf: 9 },
  { kind: 'band', run: ['Baby Ruth', 140, -22], len: 28, h: 3.0, shelf: 8 },
  { kind: 'band', run: ['Willy\'s', 675, 22], len: 30, h: 3.5, shelf: 9 },
  { kind: 'band', run: ['Buckskin Cliffs', 155, -22], len: 32, h: 5.0, shelf: 9 },
  { kind: 'band', run: ['Lower Ladder', 40, 22], len: 28, h: 3.0, shelf: 8 },
  { kind: 'band', run: ['Little Headwall', 280, -22], len: 26, h: 2.5, shelf: 8 },
  { kind: 'band', run: ['Glade Two', 210, 20], len: 24, h: 3.0, shelf: 8 },
  // cornices on the rollovers at the top of the headwalls, both sides of the entrance
  { kind: 'cornice', run: ['Cirque Headwall', 325, -22], len: 30, h: 2.4, shelf: 7 },
  { kind: 'cornice', run: ['Cirque Headwall', 325, 22], len: 30, h: 2.4, shelf: 7 },
  { kind: 'cornice', run: ['East Wall', 335, -22], len: 30, h: 2.2, shelf: 7 },
  { kind: 'cornice', run: ['AMF', 240, 22], len: 30, h: 2.0, shelf: 6 },
  { kind: 'cornice', run: ['Headwall', 330, -22], len: 30, h: 2.2, shelf: 7 },
  { kind: 'cornice', run: ['Upper Ladder', 30, 22], len: 30, h: 2.0, shelf: 6 },
  { kind: 'cornice', run: ['Cirque Cornice', 90, -21], len: 28, h: 2.0, shelf: 6 },
  // wind lips across rollovers
  { kind: 'lip', run: ['Cirque Dikes', 105, 0], len: 30, h: 1.1, shelf: 7, drop: 1.8 },
  { kind: 'lip', run: ['Hanging Valley Glades', 165, 0], len: 26, h: 1.0, shelf: 6, drop: 1.6 },
  { kind: 'lip', run: ['Free Fall', 50, 0], len: 28, h: 1.2, shelf: 7, drop: 1.8 },
  { kind: 'lip', run: ['West Face', 215, 0], len: 26, h: 1.0, shelf: 6, drop: 1.6 },
  { kind: 'lip', run: ['Garrett Gulch', 920, 0], len: 26, h: 1.0, shelf: 6, drop: 1.6 },
  { kind: 'lip', run: ['Cirque Cornice', 165, 0], len: 30, h: 1.1, shelf: 7, drop: 1.8 },
  // practice rollers for first-timers (batch 6 pin 1): long low bumps across the slope just below the building under
  // Village Express. near: the building's centre; from: m down the fall line to the first bump; gap: m between bumps
  { kind: 'rollers', near: [1077.3, -4580.1], from: 16, n: 5, gap: 7, len: 40, h: 0.6 },
];
const ENDS = 7;                                   // m the face eases down to nothing at each end
const ROCK = [[0.34, 0.32, 0.31], [0.25, 0.24, 0.24], [0.42, 0.40, 0.38]];
const CORNICE = [[0.95, 0.97, 1.0], [0.78, 0.85, 1.0], [0.6, 0.7, 0.92]];   // top, curl, underside
const noise = (u, k) => Math.sin(u * 0.9 + k * 1.7) * 0.5 + Math.sin(u * 2.3 + k * 4.1) * 0.3 + Math.sin(u * 5.1 + k) * 0.2;

// each feature in its own frame: u along the lip, v up the slope from it (KICKERS' v turns left of u, so u runs with the
// fall line on its right)
for (const [i, b] of FEATURES.entries()) {
  if (b.near) {
    const [fx, fz] = fall(b.near[0], b.near[1]);
    b.shelf = b.n * b.gap;
    b.at = [b.near[0] + fx * (b.from + b.shelf), b.near[1] + fz * (b.from + b.shelf)];   // the lowest bump's foot
  }
  if (b.run) {
    const [n, d, off] = b.run, [x, z] = onRun(n, d), [fx, fz] = fall(x, z);
    b.at = [x - fz * off, z + fx * off];                                 // + off: the skier's right, facing down
  }
  const [fx, fz] = fall(b.at[0], b.at[1]), dx = -fz, dz = fx;             // along the contour, uphill on the left
  b.k = i;
  b.H = (u) => b.h * (0.85 + 0.15 * Math.sin(u * 0.35 + i * 2)) * ease(Math.min(u, b.len - u) / ENDS);
  const drop = b.drop || 0;
  const k = { x: b.at[0] - dx * b.len / 2, z: b.at[1] - dz * b.len / 2, fx: dx, fz: dz, hw: Math.max(b.shelf, drop), h: 0, L: 0, end: b.len,
    prof: () => 0, size: b.kind === 'lip' ? 'wind lip' : b.kind, plain: true, cliff: b.kind === 'band' || b.kind === 'cornice', mode: -1, mesh: null, step: b.kind === 'band' && i < 3 ? 0.5 : 1 };
  k.hAt = b.kind === 'rollers'
    ? (u, v) => (v <= 0 || v >= b.shelf || u <= 0 || u >= b.len ? 0 : b.h * Math.sin(Math.PI * v / b.gap) ** 2 * ease(Math.min(u, b.len - u) / ENDS))
    : b.kind === 'lip'
    ? (u, v) => (v <= -drop || v >= b.shelf || u <= 0 || u >= b.len ? 0 : b.H(u) * (v >= 0 ? ease(1 - v / b.shelf) : ease(1 + v / drop)))
    : (u, v) => (v < 0 || v > b.shelf || u <= 0 || u >= b.len ? 0 : b.H(u) * (1 - v / b.shelf));
  const r = Math.hypot(b.len, b.shelf + drop);
  Object.assign(k, { bx0: b.at[0] - r, bx1: b.at[0] + r, bz0: b.at[1] - r, bz1: b.at[1] + r });
  b.feature = k;
  KICKERS.push(k);
}

// rock outcrops: two past the outer end of each expert band, down the fall line a little, so the bands read as part of
// a rocky slope rather than single walls
for (const b of FEATURES) {
  if (b.kind !== 'band' || !b.run) continue;
  const k = b.feature, side = Math.sign(b.run[2]);
  for (const [t, dv, s] of [[1.25, -6, 1.0], [1.55, 4, 0.8]]) {
    const u = side > 0 ? b.len * t : b.len * (1 - t);
    const x = k.x + k.fx * u - k.fz * dv, z = k.z + k.fz * u + k.fx * dv, height = 4 * s;
    const o = { x, z, y: base(x, z) - 0.5, height, r: 2.2 * s, kind: KIND.outcrop, what: 'rock outcrop' };
    addProp(o);
    addObstacle(o);
  }
}

// the face under each lip, in 1.5 m columns: grey rock for a band, snow curling out over the drop for a cornice
function faceMesh(b) {
  const k = b.feature, o = [b.at[0], base(b.at[0], b.at[1]), b.at[1]], pos = [[], [], []], cornice = b.kind === 'cornice';
  const pt = (u, v, dy) => { const x = k.x + k.fx * u - k.fz * v, z = k.z + k.fz * u + k.fx * v; return [x - o[0], base(x, z) + dy - o[1], z - o[2]]; };
  // one quad, wound to face downhill (the face's outside is -v)
  const quad = (c, a, d, e, f) => {
    const n = (d[1] - a[1]) * (e[2] - a[2]) - (d[2] - a[2]) * (e[1] - a[1]), m = (d[0] - a[0]) * (e[1] - a[1]) - (d[1] - a[1]) * (e[0] - a[0]);
    const out = (n * k.fz - m * k.fx) < 0;                          // normal . (-v dir), v dir = (-fz, fx)
    pos[c].push(...(out ? [...a, ...d, ...e, ...e, ...d, ...f] : [...a, ...e, ...d, ...e, ...f, ...d]));
  };
  const STEP = 1.5;
  // rows down the face: [share of the drop, v]. The cornice's second row juts out over the drop, then curls back under.
  const rows = cornice ? [[0, 0.2], [0.25, -1.0], [0.6, -0.7], [1, -0.3]] : [[0, 0.1], [0.4, -0.2], [0.75, -0.45], [1, -0.7]];
  const vert = (u, r) => {
    const [t, v] = rows[r], h = b.H(u), j = (cornice ? 0.2 : 0.35) * noise(u * 0.8 + r * 3.1, b.k + 7);
    return pt(u, v - j * (r ? 1 : 0.3), h * (1 - t) - 0.45 * t + (!cornice && r && r < 3 ? 0.25 * noise(u * 1.9, r + b.k) : 0) - 0.05);
  };
  for (let u = 1; u < b.len - 1; u += STEP) {
    const u1 = Math.min(u + STEP, b.len - 1);
    if (b.H(u) < 0.25 && b.H(u1) < 0.25) continue;
    for (let r = 0; r < 3; r++) {
      // rock: colour in blocks a few metres long so the face reads as slabs; cornice: white lip, blue curl and underside
      const c = cornice ? r : Math.floor((noise(u * 0.35, b.k * 2 + r) + 1) * 1.5) % 3;
      quad(c, vert(u, r), vert(u, r + 1), vert(u1, r), vert(u1, r + 1));
    }
  }
  const P = [];
  // bands: a row of big boulders standing in the face, tops at the lip, so the band reads as rock from any side
  if (!cornice) {
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(k.fx, 0, k.fz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-k.fz, 0, k.fx));
    for (let u = 2.5, n = 0; u < b.len - 2; u += 2.6 + 0.8 * noise(u, b.k), n++) {
      const h = b.H(u);
      if (h < 0.8) continue;
      const [x, y, z] = pt(u, -0.9 + 0.3 * noise(u * 1.3, b.k), -0.4);
      const sc = new THREE.Matrix4().makeScale(1.7 + 0.5 * noise(u * 2.1, b.k), (h + 1.2) / 1.3, 1.5);
      const m = new THREE.Matrix4().makeRotationY(0.4 * noise(u * 0.7, n)).premultiply(basis).multiply(sc).setPosition(x, y, z);
      P.push(rockGeo(b.k * 7 + n).applyMatrix4(m));
    }
  }
  for (let c = 0; c < 3; c++) {
    if (!pos[c].length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos[c], 3));
    P.push(part(g, (cornice ? CORNICE : ROCK)[c]));
  }
  const mesh = new THREE.Mesh(merge(P), modelMat);
  mesh.position.set(o[0], o[1], o[2]);
  return mesh;
}
// each face is rebuilt when the 2 m tiles under it load or drop, and drawn within RING_FAR
const FACES = FEATURES.filter((b) => b.kind === 'band' || b.kind === 'cornice');
const pT = { h: 0, gx: 0, gz: 0 };
export function updateLandforms() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const b of FACES) {
    const near = Math.hypot(b.at[0] - cx, b.at[1] - cz) < RING_FAR;
    if (!near) { if (b.mesh) b.mesh.visible = false; continue; }
    const m = state.PATCH && state.patchOn && samplePatch(state.PATCH, b.at[0], b.at[1], pT) ? 1 : 0;
    if (m !== b.mode) {
      b.mode = m;
      b.feature.mode = -1;
      if (b.mesh) { scene.remove(b.mesh); b.mesh.geometry.dispose(); }
      b.mesh = faceMesh(b);
      scene.add(b.mesh);
    }
    b.mesh.visible = true;
  }
}

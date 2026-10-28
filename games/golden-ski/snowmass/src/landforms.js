// Landforms from Jack's laser notes: shapes cut into the mountain itself. Gowdy's flank (batch 4, 2026-10-28): rock
// bands across the steep drop south of Gowdy's, each a snow shelf ending in a lip over a grey rock face, 2 to 4 m
// tall, to jump off. The shelf is snow lifted onto the slope (a KICKERS lift); the face is drawn in front of it.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { KICKERS, sampleBase, samplePatch } from './world.js';
import { camera, scene } from './scene.js';
import { RING_FAR, merge, modelMat, part } from './buildings.js';

const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const bB = { h: 0, gx: 0, gz: 0 };
const base = (x, z) => sampleBase(x, z, bB).h;
function fall(x, z) {
  let gx = 0, gz = 0;
  for (let a = -10; a <= 10; a += 5) for (let b = -10; b <= 10; b += 5) { sampleBase(x + a, z + b, bB); gx += bB.gx; gz += bB.gz; }
  const g = Math.hypot(gx, gz) || 1;
  return [-gx / g, -gz / g];
}
// lip centre, length along the contour, face height, shelf depth up the slope
const BANDS = [
  { at: [350, -1110], len: 40, h: 2.5, shelf: 8 },
  { at: [385, -1126], len: 50, h: 3.8, shelf: 10 },
  { at: [420, -1142], len: 36, h: 3.0, shelf: 9 },
];
const ENDS = 7;                                   // m the face eases down to nothing at each end
const ROCK = [[0.34, 0.32, 0.31], [0.25, 0.24, 0.24], [0.42, 0.40, 0.38]];
const noise = (u, k) => Math.sin(u * 0.9 + k * 1.7) * 0.5 + Math.sin(u * 2.3 + k * 4.1) * 0.3 + Math.sin(u * 5.1 + k) * 0.2;

// each band in its own frame: u along the lip, v up the slope from it (KICKERS' v turns left of u, so u runs with the
// fall line on its right)
for (const [i, b] of BANDS.entries()) {
  const [fx, fz] = fall(b.at[0], b.at[1]), dx = -fz, dz = fx;           // along the contour, uphill on the left
  b.k = i;
  b.H = (u) => b.h * (0.85 + 0.15 * Math.sin(u * 0.35 + i * 2)) * ease(Math.min(u, b.len - u) / ENDS);
  const k = { x: b.at[0] - dx * b.len / 2, z: b.at[1] - dz * b.len / 2, fx: dx, fz: dz, hw: b.shelf, h: 0, L: 0, end: b.len,
    prof: () => 0, size: 'rock band', plain: true, mode: -1, mesh: null };
  k.hAt = (u, v) => (v < 0 || v > b.shelf || u <= 0 || u >= b.len ? 0 : b.H(u) * (1 - v / b.shelf));
  const r = Math.hypot(b.len, b.shelf);
  Object.assign(k, { bx0: b.at[0] - r, bx1: b.at[0] + r, bz0: b.at[1] - r, bz1: b.at[1] + r });
  b.feature = k;
  KICKERS.push(k);
}

// rock faces: a jagged grey wall under each lip, from the shelf's edge down past the snow below, in 1 m columns
function buildMesh() {
  const o = [BANDS[0].at[0], base(BANDS[0].at[0], BANDS[0].at[1]), BANDS[0].at[1]], P = [];
  for (const b of BANDS) {
    const k = b.feature, pos = [[], [], []];
    const pt = (u, v, dy) => { const x = k.x + k.fx * u - k.fz * v, z = k.z + k.fz * u + k.fx * v; return [x - o[0], base(x, z) + dy - o[1], z - o[2]]; };
    // one quad, wound to face downhill (the face's outside is -v)
    const quad = (c, a, d, e, f) => {
      const n = (d[1] - a[1]) * (e[2] - a[2]) - (d[2] - a[2]) * (e[1] - a[1]), m = (d[0] - a[0]) * (e[1] - a[1]) - (d[1] - a[1]) * (e[0] - a[0]);
      const out = (n * k.fz - m * k.fx) < 0;                          // normal . (-v dir), v dir = (-fz, fx)
      pos[c].push(...(out ? [...a, ...d, ...e, ...e, ...d, ...f] : [...a, ...e, ...d, ...e, ...f, ...d]));
    };
    const STEP = 1.5, rows = [[0, 0.1], [0.4, -0.2], [0.75, -0.45], [1, -0.7]];
    const vert = (u, r) => {
      const [t, v] = rows[r], h = b.H(u), j = 0.35 * noise(u * 0.8 + r * 3.1, b.k + 7);
      return pt(u, v - j * (r ? 1 : 0.3), h * (1 - t) - 0.45 * t + (r && r < 3 ? 0.25 * noise(u * 1.9, r + b.k) : 0) - 0.05);
    };
    for (let u = 1; u < b.len - 1; u += STEP) {
      const u1 = Math.min(u + STEP, b.len - 1);
      if (b.H(u) < 0.25 && b.H(u1) < 0.25) continue;
      for (let r = 0; r < 3; r++) {
        // colour in blocks a few metres long so the face reads as slabs, not stripes
        const c = Math.floor((noise(u * 0.35, b.k * 2 + r) + 1) * 1.5) % 3;
        quad(c, vert(u, r), vert(u, r + 1), vert(u1, r), vert(u1, r + 1));
      }
    }
    for (let c = 0; c < 3; c++) {
      if (!pos[c].length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos[c], 3));
      P.push(part(g, ROCK[c]));
    }
  }
  const mesh = new THREE.Mesh(merge(P), modelMat);
  mesh.position.set(o[0], o[1], o[2]);
  return mesh;
}
// rebuilt when the 2 m tiles under the bands load or drop
let mode = -1, mesh = null;
const pT = { h: 0, gx: 0, gz: 0 };
export function updateLandforms() {
  const m = state.PATCH && state.patchOn && BANDS.every((b) => samplePatch(state.PATCH, b.at[0], b.at[1], pT)) ? 1 : 0;
  if (m !== mode) {
    mode = m;
    for (const b of BANDS) b.feature.mode = -1;
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    mesh = buildMesh();
    scene.add(mesh);
  }
  mesh.visible = Math.hypot(BANDS[1].at[0] - camera.position.x, BANDS[1].at[1] - camera.position.z) < RING_FAR;
}

// Glades (2026-11-02): the named glade runs get trees standing through them, about 11 m apart, with a clear line down
// the middle, and a tree well round each new tree: a dip in the snow (physics) drawn as two rings of shaded snow.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from '../data/mountain.js';
import { cellKey, hash2 } from './config.js';
import { GROUND_ADD, addObstacle, groundY, nearSolid, treeCells } from './world.js';
import { bucket, part, propBatch } from './buildings.js';
import { KIND, TRUNK_R, addProp } from './trees.js';

export const GLADE_RUNS = ['Glade One', 'Glade Two', 'Glade Three', 'Coney Glade', 'Powerline Glades', 'Sneaky\'s Glades',
  'Hanging Valley Glades', 'Frog Pond Glades', 'Weird Woods'];
const SPACING = 11, CLEAR = 4, WELL_R = 2.4, WELL_D = 0.4;
const WELL_IN = [0.62, 0.7, 0.9], WELL_OUT = [0.8, 0.86, 0.98];
const wells = new Map();                                     // 8 m cells -> trees with wells
const ease = (t) => t * t * (3 - 2 * t);
const treeNear = (x, z, r) => {
  for (let i = Math.floor((x - r) / 8); i <= Math.floor((x + r) / 8); i++) for (let j = Math.floor((z - r) / 8); j <= Math.floor((z + r) / 8); j++)
    for (const t of treeCells.get(cellKey(i, j)) || []) if (Math.hypot(t.x - x, t.z - z) < r) return true;
  return false;
};
// a ring of shaded snow round the trunk, from r0 to r1, laid on the ground
function ring(x, z, r0, r1, col) {
  const pos = [], N = 10, y = (a, r) => groundY(x + Math.cos(a) * r, z + Math.sin(a) * r) + 0.06;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, b = (k + 1) / N * Math.PI * 2;
    const p = [x + Math.cos(a) * r0, y(a, r0), z + Math.sin(a) * r0], q = [x + Math.cos(b) * r0, y(b, r0), z + Math.sin(b) * r0];
    const s = [x + Math.cos(a) * r1, y(a, r1), z + Math.sin(a) * r1], t = [x + Math.cos(b) * r1, y(b, r1), z + Math.sin(b) * r1];
    pos.push(...p, ...q, ...s, ...s, ...q, ...t);            // wound to face up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return part(g, col);
}
export function addGlades() {
  let n = 0;
  for (const name of GLADE_RUNS) {
    const run = MAP.runs.find((r) => r.name === name);
    if (!run) continue;
    const p = run.points, half = run.width / 2 - 1;
    for (let i = 0; i < p.length - 1; i++) {
      const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      for (let a = 0; a < L; a += SPACING) for (let c = -half; c <= half; c += SPACING) {
        const ja = (hash2(Math.round(p[i][0] + a), Math.round(p[i][1] + c)) - 0.5) * SPACING * 0.7;
        const jc = (hash2(Math.round(p[i][1] + a) + 7, Math.round(p[i][0] + c)) - 0.5) * SPACING * 0.7;
        const cc = c + jc;
        if (Math.abs(cc) < CLEAR || Math.abs(cc) > half) continue;
        const x = p[i][0] + ux * (a + ja) - uz * cc, z = p[i][1] + uz * (a + ja) + ux * cc;
        if (treeNear(x, z, 6) || nearSolid(x, z, 4)) continue;
        const ground = groundY(x, z), r3 = hash2(Math.round(x * 3), Math.round(z * 3)), r4 = hash2(Math.round(z * 5), Math.round(x * 2));
        const kind = ground > 3380 && r3 < 0.35 ? KIND.snowghost : r4 < (ground < 3000 ? 0.7 : 0.5) ? KIND.spruce : KIND.fir;
        const height = kind === KIND.snowghost ? 2.2 + r3 * 1.6 : kind === KIND.spruce ? 13 + r3 * 8 : 11 + r4 * 7;
        const t = { x, z, y: ground - 0.3, height, r: TRUNK_R[kind] * height, kind };
        addProp(t);
        addObstacle(t);
        for (let ci = Math.floor((x - WELL_R) / 8); ci <= Math.floor((x + WELL_R) / 8); ci++) for (let cj = Math.floor((z - WELL_R) / 8); cj <= Math.floor((z + WELL_R) / 8); cj++) {
          const ck = cellKey(ci, cj);
          if (!wells.has(ck)) wells.set(ck, []);
          wells.get(ck).push(t);
        }
        bucket(propBatch, x, z, ring(x, z, t.r + 0.1, 1.3, WELL_IN), ring(x, z, 1.3, WELL_R, WELL_OUT));
        n++;
      }
    }
  }
  return n;
}
// the well: snow dips WELL_D at the trunk, easing back to level at WELL_R
GROUND_ADD.push((x, z, out) => {
  const list = wells.get(cellKey(Math.floor(x / 8), Math.floor(z / 8)));
  if (!list) return;
  for (const t of list) {
    const dx = x - t.x, dz = z - t.z, d = Math.hypot(dx, dz);
    if (d >= WELL_R || d < 1e-3) continue;
    const f = 1 - d / WELL_R, h = -WELL_D * ease(f), dh = -WELL_D * 6 * f * (1 - f) * (-1 / WELL_R);   // d(h)/d(d)
    out.h += h; out.gx += dh * dx / d; out.gz += dh * dz / d;
  }
});

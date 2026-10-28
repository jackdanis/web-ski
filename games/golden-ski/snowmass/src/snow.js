// Each run's snow. Runs that are never groomed have thick snow and real moguls, added to the ground in sample() and
// drawn as snow tiles near the camera; runs groomed only now and then are chopped, a look only.
// The 10 m grid takes the snow of the nearest run line.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from '../data/mountain.js';
import { RUN_DATA } from '../data/runs.js';
import { state } from './state.js';
import { CELL, GROUND_ADD, NX, NZ, X0, Z0, patchEdge, sampleBase } from './world.js';
import { camera, scene, terrainMat } from './scene.js';
import { kickSnowMat } from './lifts.js';

// from the 2006-2012 grooming reports: Timberline and Long Shot were never groomed, these blacks only sometimes
const BUMPS = ['Timberline'];                     // moguls all the way down
const THICK = ['Long Shot'];                      // thick snow, moguls only in PATCHES
const CHOPPED = ['The Edge', 'Slot (Upper)', 'Slot (Lower)', 'Campground (Upper)', 'Campground (Lower)'];
const REACH = 8;                                  // cells (80 m) a run line claims around it
// moguls: big ones on a 7 m jittered grid, small ones between on a 4 m grid ([cell m, radius m, height m] ranges)
const MOGULS = [{ cell: 7, r: [2.6, 3.6], h: [0.7, 1.3] }, { cell: 4, r: [1.5, 2.1], h: [0.25, 0.55] }];
const EDGE_FADE = 6;                              // m inside the groomed edge before the bumps are full size
// 'wide' moguls: stretched across the fall line, farther apart, rows staggered (Jack 2026-10-28)
const WIDE = { along: 10, across: 13, ru: [2.8, 3.4], rv: [4.5, 6], h: [0.8, 1.3] };
// Jack's laser notes 2026-10-28: where Long Shot keeps its moguls. Ellipses at his pins: len m down the fall line,
// wide m across, 'tight' = the dense mixed field (small patches), 'wide' = WIDE bumps
const PATCHES = [
  { at: [3821.7, -1833.3], len: 22, wide: 16, style: 'tight' },   // 5: a small patch
  { at: [3679.4, -2026.4], len: 30, wide: 16, style: 'tight' },   // 6: some on the side
  { at: [3719.2, -2246.9], len: 60, wide: 30, style: 'wide' },    // 7: keep them here
  { at: [3744.1, -2620.5], len: 45, wide: 22, style: 'wide' },    // 8: this side, by the trees
  { at: [3818.5, -2796.5], len: 22, wide: 18, style: 'tight' },   // 9: some in the corner
  { at: [3764.0, -2990.6], len: 50, wide: 16, style: 'wide' },    // 10: this side of the tree split
  // batch 4 pin 7: "a ton of spread out moguls" on Slot (Upper), its chopped snow turned thick around them
  { at: [-294.7, -3439.7], len: 80, wide: 20, style: 'wide', thick: true },
];
const PATCH_FADE = 8;                             // m inside a patch's edge before the bumps are full size
// Timberline: none along the Big Burn lift line, kept past its bottom terminal (pin 1); [ax, az, bx, bz, radius m]
const NO_MOGULS = [[480, -2960, 546, -3125, 40]];

// 0 plain, 1 bumps, 2 chopped, 3 thick per 10 m cell
export const SNOW_KIND = new Uint8Array(NX * NZ);
{
  const owner = new Int8Array(NX * NZ).fill(-1), dist = new Uint8Array(NX * NZ), queue = new Int32Array(NX * NZ);
  let head = 0, tail = 0;
  const kind = (name) => (BUMPS.includes(name) ? 1 : CHOPPED.includes(name) ? 2 : THICK.includes(name) ? 3 : 0);
  // every run's line is seeded, so a run with plain snow still claims its own cells
  MAP.runs.forEach((r, i) => {
    const k0 = RUN_DATA ? kind((RUN_DATA.runs.find((q) => q.i === i) || {}).name || '') : 0;
    for (let s = 1; s < r.points.length; s++) {
      const [ax, az] = r.points[s - 1], [bx, bz] = r.points[s], n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2));
      for (let t = 0; t <= n; t++) {
        const i0 = Math.round((ax + (bx - ax) * t / n - X0) / CELL), j0 = Math.round((az + (bz - az) * t / n - Z0) / CELL);
        if (i0 < 0 || j0 < 0 || i0 >= NX || j0 >= NZ) continue;
        const k = j0 * NX + i0;
        if (owner[k] >= 0) continue;
        owner[k] = k0; queue[tail++] = k;
      }
    }
  });
  // grow out in rings, first come first served
  while (head < tail) {
    const k = queue[head++], i = k % NX;
    if (dist[k] >= REACH) continue;
    for (const m of [i > 0 ? k - 1 : -1, i < NX - 1 ? k + 1 : -1, k - NX, k + NX]) {
      if (m < 0 || m >= NX * NZ || owner[m] >= 0) continue;
      owner[m] = owner[k]; dist[m] = dist[k] + 1; queue[tail++] = m;
    }
  }
  for (let k = 0; k < NX * NZ; k++) SNOW_KIND[k] = owner[k] < 0 ? 0 : owner[k];
  for (const p of PATCHES) {
    if (!p.thick) continue;
    const r = Math.max(p.len, p.wide), i0 = Math.round((p.at[0] - X0) / CELL), j0 = Math.round((p.at[1] - Z0) / CELL), n = Math.ceil(r / CELL);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) {
      const k = j * NX + i;
      if (Math.hypot(i - i0, j - j0) * CELL <= r && SNOW_KIND[k] === 2) SNOW_KIND[k] = 3;
    }
  }
  const px = new Uint8Array(NX * NZ * 4);
  for (let k = 0; k < NX * NZ; k++) { px[k * 4] = SNOW_KIND[k] === 1 || SNOW_KIND[k] === 3 ? 255 : 0; px[k * 4 + 1] = SNOW_KIND[k] === 2 ? 255 : 0; }
  const tex = new THREE.DataTexture(px, NX, NZ);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  terrainMat.uniforms.uSnowT.value = tex;
}

// how much of a kind of snow is at a point (0..1, blended over the 10 m cells)
export function snowWeight(x, z, kind, kind2 = kind) {
  const fx = (x - X0) / CELL, fz = (z - Z0) / CELL, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  if (i < 0 || j < 0 || i >= NX - 1 || j >= NZ - 1) return 0;
  const k = j * NX + i, w = (m) => (SNOW_KIND[m] === kind || SNOW_KIND[m] === kind2 ? 1 : 0);
  return (w(k) * (1 - tx) + w(k + 1) * tx) * (1 - tz) + (w(k + NX) * (1 - tx) + w(k + NX + 1) * tx) * tz;
}

const hash = (a, b, s) => {
  let h = (a * 374761393 + b * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
// each patch's frame: fall line averaged over its middle
{
  const b = { h: 0, gx: 0, gz: 0 };
  for (const p of PATCHES) {
    let gx = 0, gz = 0;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { sampleBase(p.at[0] + a * 15, p.at[1] + c * 15, b); gx += b.gx; gz += b.gz; }
    const l = Math.hypot(gx, gz) || 1;
    p.fx = -gx / l; p.fz = -gz / l;
  }
}
// the dense mixed field: max of round bumps from jittered cells
function tightH(x, z) {
  let h = 0;
  for (let L = 0; L < MOGULS.length; L++) {
    const M = MOGULS[L], ci = Math.floor(x / M.cell), cj = Math.floor(z / M.cell);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = ci + di, b = cj + dj;
      const cx = (a + 0.2 + 0.6 * hash(a, b, L * 4)) * M.cell, cz = (b + 0.2 + 0.6 * hash(a, b, L * 4 + 1)) * M.cell;
      const r = M.r[0] + (M.r[1] - M.r[0]) * hash(a, b, L * 4 + 2), d = Math.hypot(x - cx, z - cz);
      if (d >= r) continue;
      const c = Math.cos(d / r * Math.PI / 2);
      h = Math.max(h, (M.h[0] + (M.h[1] - M.h[0]) * hash(a, b, L * 4 + 3)) * c * c);
    }
  }
  return h;
}
// wide bumps in a patch's frame (u down the fall line, v across), every other row shifted half a bump
function wideH(u, v) {
  const W = WIDE, cj = Math.floor(u / W.along);
  let h = 0;
  for (let dj = -1; dj <= 1; dj++) {
    const b = cj + dj, sh = (b & 1) * 0.5, ci = Math.floor(v / W.across - sh);
    for (let di = -1; di <= 1; di++) {
      const a = ci + di, s = 8 + (b & 1);
      const cu = (b + 0.35 + 0.3 * hash(a, b, s)) * W.along, cv = (a + sh + 0.35 + 0.3 * hash(a, b, s + 2)) * W.across;
      const ru = W.ru[0] + (W.ru[1] - W.ru[0]) * hash(a, b, s + 4), rv = W.rv[0] + (W.rv[1] - W.rv[0]) * hash(a, b, s + 6);
      const d = Math.hypot((u - cu) / ru, (v - cv) / rv);
      if (d >= 1) continue;
      const c = Math.cos(d * Math.PI / 2);
      h = Math.max(h, (W.h[0] + (W.h[1] - W.h[0]) * hash(a, b, s + 8)) * c * c);
    }
  }
  return h;
}
const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
function capsule(x, z, [ax, az, bx, bz]) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
// mogul height at a point; none where the 2 m run tiles are not loaded
export function mogulH(x, z) {
  const w = snowWeight(x, z, 1, 3);
  if (w <= 0) return 0;
  const edge = patchEdge(x, z);
  if (!(edge < 0)) return 0;
  let h = 0;
  const run = snowWeight(x, z, 1);
  if (run > 0) {
    let keep = 1;
    for (const c of NO_MOGULS) keep = Math.min(keep, ease((capsule(x, z, c) - c[4]) / PATCH_FADE));
    if (keep > 0) h = tightH(x, z) * run * keep;
  }
  for (const p of PATCHES) {
    const dx = x - p.at[0], dz = z - p.at[1], u = dx * p.fx + dz * p.fz, v = dz * p.fx - dx * p.fz;
    const e = Math.hypot(u / p.len, v / p.wide);
    if (e >= 1) continue;
    const f = ease((1 - e) * Math.min(p.len, p.wide) / PATCH_FADE);
    h = Math.max(h, f * (p.style === 'wide' ? wideH(u, v) : tightH(x, z)));
  }
  const t = Math.min(1, -edge / EDGE_FADE);
  return h * w * t * t * (3 - 2 * t);
}

const mB = { h: 0, gx: 0, gz: 0 };
GROUND_ADD.push((x, z, out) => {
  const h = mogulH(x, z), E = 0.05;
  if (h <= 0 && mogulH(x + E, z) <= 0 && mogulH(x, z + E) <= 0) return;
  out.h += h; out.gx += (mogulH(x + E, z) - h) / E; out.gz += (mogulH(x, z + E) - h) / E;
});

// Mogul snow tiles: TILE m squares over bump-run cells, fine near the camera, coarser farther, none past FAR
const TILE = 24, FINE = 60, FAR = 200, PER_FRAME = 2;
const STEP_NEAR = 0.75, STEP_FAR = 1.5;           // m between vertices; a phone has to draw every tile in view
const SOFT = 0.5;                                 // share of the mogul's slope the light sees, so Snowlight's bands stay gentle
// kicker snow with smooth normals and no skirt push (MOGUL in scene.js)
export const mogulMat = new THREE.ShaderMaterial({
  uniforms: kickSnowMat.uniforms, vertexShader: kickSnowMat.vertexShader, fragmentShader: kickSnowMat.fragmentShader,
  defines: { PATCH: 1, MOGUL: 1 }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
});
const tiles = new Map();
const inPatch = (x, z) => PATCHES.some((p) => Math.hypot(x - p.at[0], z - p.at[1]) < Math.max(p.len, p.wide) + CELL);
for (let k = 0; k < NX * NZ; k++) {
  const x = X0 + (k % NX) * CELL, z = Z0 + Math.floor(k / NX) * CELL;
  if (!(SNOW_KIND[k] === 1 && NO_MOGULS.every((c) => capsule(x, z, c) > c[4] - CELL)) && !((SNOW_KIND[k] === 1 || SNOW_KIND[k] === 3) && inPatch(x, z))) continue;
  for (const dx of [-CELL, 0, CELL]) for (const dz of [-CELL, 0, CELL]) {
    const a = Math.floor((x + dx) / TILE), b = Math.floor((z + dz) / TILE), key = a * 100000 + b;
    if (!tiles.has(key)) tiles.set(key, { x: a * TILE, z: b * TILE, mesh: null, step: 0 });
  }
}
function buildTile(t, step) {
  const n = Math.round(TILE / step) + 1, y0 = sampleBase(t.x, t.z, mB).h, grid = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = t.x + i * step, z = t.z + j * step, m = mogulH(x, z), E = 0.1;
    const y = sampleBase(x, z, mB).h + m + 0.03 - y0;
    const gx = mB.gx + SOFT * (mogulH(x + E, z) - mogulH(x - E, z)) / (2 * E), gz = mB.gz + SOFT * (mogulH(x, z + E) - mogulH(x, z - E)) / (2 * E);
    const l = Math.hypot(gx, 1, gz);
    grid.push([i * step, y, j * step, m, -gx / l, 1 / l, -gz / l]);
  }
  const pos = [], nrm = [];
  const put = (...vs) => { for (const v of vs) { pos.push(v[0], v[1], v[2]); nrm.push(v[4], v[5], v[6]); } };
  const tri = (a, b, c) => {
    // face up
    const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
    if (uz * wx - ux * wz < 0) put(a, c, b); else put(a, b, c);
  };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const p = grid[j * n + i], q = grid[j * n + i + 1], r = grid[(j + 1) * n + i + 1], t = grid[(j + 1) * n + i];
    if (p[3] <= 0 && q[3] <= 0 && r[3] <= 0 && t[3] <= 0) continue;
    tri(p, q, r); tri(p, r, t);
  }
  if (!pos.length) return null;
  const v = pos.length / 3, cov = new Float32Array(v * 4);
  for (let k = 0; k < v; k++) cov[k * 4] = -5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3));
  const mesh = new THREE.Mesh(geo, mogulMat);
  mesh.position.set(t.x, y0, t.z);
  return mesh;
}
// the 2 m run tiles cover some of it (they only lie on runs, so check more than the middle)
const loaded = (t) => [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]].some(([a, b]) => patchEdge(t.x + a * TILE, t.z + b * TILE) !== undefined);
export function updateMoguls() {
  const cx = camera.position.x, cz = camera.position.z;
  let built = 0;
  const most = state.workAll ? Infinity : PER_FRAME;          // all at once when the camera jumps
  for (const t of tiles.values()) {
    const d = Math.hypot(Math.max(t.x - cx, 0, cx - t.x - TILE), Math.max(t.z - cz, 0, cz - t.z - TILE));
    const step = d > FAR || !loaded(t) ? 0 : d < FINE ? STEP_NEAR : STEP_FAR;
    if (step === t.step || (step && built >= most)) continue;
    if (t.mesh) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; }
    t.step = step;
    if (step) { t.mesh = buildTile(t, step); if (t.mesh) scene.add(t.mesh); built++; }
  }
}

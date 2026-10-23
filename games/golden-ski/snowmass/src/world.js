// The mountain as data: heights, cover, runs on the 10 m grid, the 2 m run grid, solids, bridges, kickers.
// Physics samples the ground here.
import { MAP } from '../data/mountain.js';
import { RUN_DATA } from '../data/runs.js';
import { state } from './state.js';
import { EDGE_MARGIN, SNOW, cellKey, clamp } from './config.js';

// ---------- Map data ----------
export async function inflate(b64) {
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
export const META = MAP.meta;
export const [nearBytes, farBytes, COVER, runBytes] = await Promise.all([inflate(MAP.near), inflate(MAP.far), inflate(MAP.cover), inflate(MAP.runField)]);
// Distance to the nearest groomed run (half meters, 10 m grid), negative on the run.
export const RUNF = new Int8Array(runBytes.buffer, runBytes.byteOffset, runBytes.length);
export const runDist = (k) => RUNF[k] / 2;
export const CELL = META.near.cell, NX = META.near.nx, NZ = META.near.nz, X0 = META.near.x0, Z0 = META.near.z0;
export const H = decodeHeights(nearBytes, NX, NZ);
export const FAR = META.far;
export const FH = decodeHeights(farBytes, FAR.nx, FAR.nz);
export const X1 = X0 + (NX - 1) * CELL, Z1 = Z0 + (NZ - 1) * CELL;

// Cover byte: conifer 0-15, aspen 0-7, rock bit.
export const conifer = (k) => (COVER[k] & 15) / 15;
export const aspen = (k) => ((COVER[k] >> 4) & 7) / 7;
export const isRock = (k) => COVER[k] >> 7;
export const gridH = (i, j) => H[clamp(j, 0, NZ - 1) * NX + clamp(i, 0, NX - 1)];
export const cellAt = (x, z) => clamp(Math.round((z - Z0) / CELL), 0, NZ - 1) * NX + clamp(Math.round((x - X0) / CELL), 0, NX - 1);
export const EDGE_TREES = 25;          // m: near a run, trees come from the 1 m canopy map
export const POWDER = new Uint8Array(NX * NZ);
for (let k = 0; k < NX * NZ; k++) POWDER[k] = RUNF[k] < 0 ? 0 : 1;
// Run shaping on the 10 m grid (cm), used where no 2 m tiles are loaded so lifts and stations sit on shaped snow.
const RUN_DH = RUN_DATA && RUN_DATA.dh ? await inflate(RUN_DATA.dh).then((b) => new Int16Array(b.buffer, b.byteOffset, b.length / 2)) : null;

const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const crd = (p0, p1, p2, p3, t) => 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (3 * p1 - p0 - 3 * p2 + p3) * t * t);
const samp = { h: 0, gx: 0, gz: 0 };
const rowV = [0, 0, 0, 0], rowD = [0, 0, 0, 0];
export function sampleGrid(g, nx, nz, x0, z0, cell, x, z, out) {
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
export function samplePatch(P, x, z, out) {
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
export function sampleBase(x, z, out) {
  if (state.patchOn && state.PATCH && samplePatch(state.PATCH, x, z, out)) return out;
  sampleGrid(H, NX, NZ, X0, Z0, CELL, x, z, out);
  if (state.patchOn && RUN_DH) {
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
export const STATIONS = [];
export const stB = { h: 0, gx: 0, gz: 0 };
export function stationAt(x, z) {
  for (const st of STATIONS) if (x > st.bx0 && x < st.bx1 && z > st.bz0 && z < st.bz1) return st;
  return null;
}
// m outside a station's deck, in the station's frame
export function deckDist(st, x, z) {
  const dx = x - st.x, dz = z - st.z, u = st.c * dx - st.s * dz, v = st.s * dx + st.c * dz;
  return Math.hypot(Math.max(st.u0 - u, 0, u - st.u1), Math.max(st.v0 - v, 0, v - st.v1));
}
export function stationH(st, x, z) {
  const t = Math.min(1, deckDist(st, x, z) / st.A), e = t * t * (3 - 2 * t);
  return st.y * (1 - e) + sampleBase(x, z, stB).h * e;
}
// Solid boxes: centre x, y, z, half sizes hx, hy, hz, yaw as c, s.
export const SOLIDS = [];
export function nearSolid(x, z, pad) {
  return SOLIDS.some((b) => { const dx = x - b.x, dz = z - b.z; return Math.abs(b.c * dx - b.s * dz) < b.hx + pad && Math.abs(b.s * dx + b.c * dz) < b.hz + pad; });
}
// SOLIDS bucketed in 32 m cells, each box in every cell its reach (plus 1 m for the body) touches, in SOLIDS order;
// rebuilt whenever boxes are added
const SOLID_CELL = 32, solidGrid = new Map(), NO_SOLIDS = [];
let solidGridN = -1;
export function solidsAt(x, z) {
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
function solidTop(x, z, out) {
  for (const b of solidsAt(x, z)) {
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > b.hx + b.hz || Math.abs(dz) > b.hx + b.hz) continue;
    const u = b.c * dx - b.s * dz, v = b.s * dx + b.c * dz;
    if (Math.abs(u) > b.hx || Math.abs(v) > b.hz) continue;
    const top = b.y + b.hy;
    if (top > out.h && state.solidY >= top - 0.4) { out.h = top; out.gx = 0; out.gz = 0; }
  }
  return out;
}
// ---------- Wood Rd bridge ----------
// Ski bridges from runs.js (tools/runs/woodrd.py): a deck centreline every 1 m as [x, z, top y, snow y under it], its
// half width and thickness, the point over the road and half the arch's span. The road is cut into the snow below,
// so the deck is ground only from above, like box tops.
export const BRIDGES = ((RUN_DATA && RUN_DATA.bridges) || []).map(([q, hw, t, kx, arch]) => {
  const n = q.length / 4, P = [];
  for (let k = 0; k < n; k++) P.push({ x: q[4 * k], z: q[4 * k + 1], y: q[4 * k + 2], g: q[4 * k + 3] });
  const xs = P.map((p) => p.x), zs = P.map((p) => p.z);
  return { P, hw, t, kx, arch, bx0: Math.min(...xs) - hw, bx1: Math.max(...xs) + hw, bz0: Math.min(...zs) - hw, bz1: Math.max(...zs) + hw };
});
function bridgeTop(x, z, out) {
  for (const b of BRIDGES) {
    if (x < b.bx0 || x > b.bx1 || z < b.bz0 || z > b.bz1) continue;
    let best = 1e9, y = 0, gx = 0, gz = 0;
    for (let k = 0; k < b.P.length - 1; k++) {
      const p = b.P[k], q = b.P[k + 1], dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz;
      const t = clamp(((x - p.x) * dx + (z - p.z) * dz) / L2, 0, 1), ex = x - p.x - t * dx, ez = z - p.z - t * dz, d = ex * ex + ez * ez;
      if (d < best) { best = d; y = p.y + t * (q.y - p.y); const s = (q.y - p.y) / L2; gx = dx * s; gz = dz * s; }
    }
    if (best > b.hw * b.hw || y < out.h || state.solidY < y - 0.5) continue;
    out.h = y; out.gx = gx; out.gz = gz;
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
export const KICK_LIP = 1.2;                                          // m of mat up to the lip
export const KICKERS = [];
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
export function kickH(k, x, z) {
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
export function sample(x, z, out = samp) {
  const st = STATIONS.length ? stationAt(x, z) : null;
  if (!st) sampleBase(x, z, out);
  else {
    const h = stationH(st, x, z), E = 0.3;
    out.h = h; out.gx = (stationH(st, x + E, z) - h) / E; out.gz = (stationH(st, x, z + E) - h) / E;
  }
  if (KICKERS.length) addKick(x, z, out);
  if (BRIDGES.length && state.solidY !== null) bridgeTop(x, z, out);
  return state.solidY !== null && SOLIDS.length ? solidTop(x, z, out) : out;
}
export const groundY = (x, z) => sample(x, z, { h: 0, gx: 0, gz: 0 }).h;
export function normalFrom(s, out) {
  return out.set(-s.gx, 1, -s.gz).normalize();
}
export function surfaceAt(x, z) {
  const e = patchEdge(x, z);
  return (e === undefined ? POWDER[cellAt(x, z)] : e > 0) ? SNOW.powder : SNOW.groomed;
}
export const offMap = (x, z) => x < X0 + EDGE_MARGIN || x > X1 - EDGE_MARGIN || z < Z0 + EDGE_MARGIN || z > Z1 - EDGE_MARGIN;
export const PAGE = 32;
export const treeCells = new Map();                  // 8 m cells -> trees, for collisions
export function addObstacle(t) {
  const ck = cellKey(Math.floor(t.x / 8), Math.floor(t.z / 8));
  if (!treeCells.has(ck)) treeCells.set(ck, []);
  treeCells.get(ck).push(t);
}
export const LIFT_CUT = new Uint8Array(NX * NZ);
export const PCELL = 2, BLEND = 18, BERM_W = 1.6;
// signed m to the nearest groomed edge on the 2 m tiles, undefined elsewhere
export function patchEdge(x, z) {
  const P = state.PATCH;
  if (!state.patchOn || !P) return undefined;
  const fx = (x - P.x0) / PCELL, fz = (z - P.z0) / PCELL, i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const c00 = P.at(i, j), c10 = P.at(i + 1, j), c01 = P.at(i, j + 1), c11 = P.at(i + 1, j + 1), E = P.edge;
  if (c00 < 0 || c10 < 0 || c01 < 0 || c11 < 0) return undefined;
  return (E[c00] * (1 - tx) + E[c10] * tx) * (1 - tz) + (E[c01] * (1 - tx) + E[c11] * tx) * tz;
}

// Mountain operations props (2026-11-02): snowcats parked by the Max Park maintenance buildings, ski patrol huts at
// the high lift tops, trail-map boards and rope mazes at the main lift bottoms, and ski racks outside the lodges.
// (Snowmaking guns removed 2026-11-05: not featured.) Built in code like the kit buildings, batched with them.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { SOLIDS, groundY, nearSolid, sampleBase } from './world.js';
import { DARK, SNOWCAP, STEEL, TILES, addMapStand, bucket, part, placeM, propBatch } from './buildings.js';
import { liftPaths } from './lifts.js';

const BOX = (w, h, l, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, l).translate(x, y + h / 2, z);
const CYL = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);
const bB = { h: 0, gx: 0, gz: 0 };
function fall(x, z) {
  sampleBase(x, z, bB);
  const g = Math.hypot(bB.gx, bB.gz) || 1;
  return [-bB.gx / g, -bB.gz / g];
}
const solid = (x, z, yaw, w, l, y0, h, what) => SOLIDS.push({ x, z, y: y0 + h / 2, hx: w / 2, hy: h / 2, hz: l / 2, c: Math.cos(yaw), s: Math.sin(yaw), what });
// ---------- Models: local +z is the front ----------
const GREY = [0.62, 0.64, 0.68], RED = [0.78, 0.13, 0.1], WHITE = [0.95, 0.96, 1.0], BLACK = [0.08, 0.08, 0.09];
const WIN = [1.1, 1.1, 1.15], ORANGE = [1.0, 0.45, 0.08], WOOD = [0.62, 0.47, 0.36];
// a snowcat: red body and cab on black tracks, a grey blade in front, the tiller behind, an orange light on the roof
function snowcat() {
  const P = [];
  for (const s of [-1, 1]) {
    P.push(part(BOX(1.1, 0.9, 5.0, s * 1.75, 0, 0), BLACK));
    P.push(part(CYL(0.45, 0.45, 1.1, 8).rotateZ(Math.PI / 2).translate(s * 1.75, 0.45, 2.5), BLACK));
    P.push(part(CYL(0.45, 0.45, 1.1, 8).rotateZ(Math.PI / 2).translate(s * 1.75, 0.45, -2.5), BLACK));
  }
  P.push(part(BOX(2.5, 1.0, 4.6, 0, 0.6, 0), RED));
  P.push(part(BOX(2.3, 1.5, 2.0, 0, 1.6, 0.5), RED));
  P.push(part(BOX(2.32, 0.8, 1.6, 0, 2.15, 0.55), WIN, null, TILES.window));
  P.push(part(BOX(2.1, 0.8, 0.1, 0, 2.1, 1.52), WIN, null, TILES.window));
  P.push(part(BOX(2.4, 0.12, 2.1, 0, 3.1, 0.5), SNOWCAP));
  P.push(part(BOX(1.2, 0.18, 0.3, 0, 3.22, 0.5), ORANGE));
  P.push(part(BOX(4.6, 1.1, 0.25, 0, 0.1, 3.4).applyMatrix4(new THREE.Matrix4().makeRotationX(-0.15)), GREY));     // blade
  for (const s of [-1, 1]) P.push(part(BOX(0.18, 0.18, 1.2, s * 1.0, 0.6, 2.8), STEEL));                       // blade arms
  P.push(part(CYL(0.45, 0.45, 4.2, 10).rotateZ(Math.PI / 2).translate(0, 0.45, -3.4), GREY));                      // tiller
  P.push(part(BOX(4.2, 0.12, 1.4, 0, 0.0, -4.0), DARK));                                                          // comb
  return P;
}
// ski patrol hut: red board walls, a white cross on the front and both sides, a snowy gable roof, a door and a window
function patrolHut() {
  const W = 3.8, L = 3.2, H = 2.6, gh = 1.5;
  const P = [part(BOX(W, H, L), RED, null, TILES.siding)];
  const g = new THREE.BufferGeometry(), pos = [];
  for (const [w, y, z, l] of [[W + 0.8, H, 0, L + 0.8], [W + 0.5, H + 0.18, 0, L + 0.4]]) {
    const a = [-w / 2, y], b = [w / 2, y], c = [0, y + gh];
    const v = (p, zz) => [p[0], p[1], zz];
    pos.length = 0;
    pos.push(...v(a, l / 2), ...v(c, l / 2), ...v(c, -l / 2), ...v(a, l / 2), ...v(c, -l / 2), ...v(a, -l / 2));
    pos.push(...v(b, -l / 2), ...v(c, -l / 2), ...v(c, l / 2), ...v(b, -l / 2), ...v(c, l / 2), ...v(b, l / 2));
    const q = g.clone();
    q.setAttribute('position', new THREE.Float32BufferAttribute(pos.slice(), 3));
    P.push(part(q, y === H ? DARK : SNOWCAP));
  }
  // gable ends
  const ge = new THREE.BufferGeometry();
  ge.setAttribute('position', new THREE.Float32BufferAttribute([-W / 2, H, L / 2, W / 2, H, L / 2, 0, H + gh, L / 2, W / 2, H, -L / 2, -W / 2, H, -L / 2, 0, H + gh, -L / 2], 3));
  P.push(part(ge, RED));
  // crosses: front gable wall and both sides
  const cross = (m) => { P.push(part(BOX(1.4, 0.4, 0.06, 0, 0, 0).applyMatrix4(m), WHITE)); P.push(part(BOX(0.4, 1.4, 0.06, 0, -0.5, 0).applyMatrix4(m), WHITE)); };
  cross(new THREE.Matrix4().makeTranslation(0.9, 1.5, L / 2 + 0.04));
  for (const s of [-1, 1]) cross(new THREE.Matrix4().makeRotationY(s * Math.PI / 2).setPosition(s * (W / 2 + 0.04), 1.5, 0));
  P.push(part(BOX(0.9, 2.0, 0.08, -0.9, 0, L / 2 + 0.04), DARK, null, TILES.cedar));
  P.push(part(BOX(1.2, 0.9, 0.08, 0, 1.3, -L / 2 - 0.04), WIN, null, TILES.window));
  P.push(part(BOX(W + 1.2, 0.25, 1.4, 0, -0.1, L / 2 + 0.7), WOOD, null, TILES.deck));
  return P;
}
// ski rack: two end frames and two rails, len m long, a few pairs of skis standing in it
const SKI_COLS = [[0.9, 0.15, 0.12], [0.12, 0.3, 0.75], [0.95, 0.75, 0.1], [0.15, 0.15, 0.17], [0.92, 0.92, 0.95]];
function skiRack(len, seed) {
  const P = [];
  for (const s of [-1, 1]) {
    P.push(part(BOX(0.08, 1.1, 0.08, s * len / 2, 0, -0.25), STEEL));
    P.push(part(BOX(0.08, 1.1, 0.08, s * len / 2, 0, 0.25), STEEL));
  }
  P.push(part(BOX(len, 0.07, 0.07, 0, 1.05, -0.25), STEEL));
  P.push(part(BOX(len, 0.07, 0.07, 0, 1.05, 0.25), STEEL));
  P.push(part(BOX(len, 0.05, 0.05, 0, 0.35, 0), STEEL));
  for (let k = 0; k < Math.floor(len / 0.5); k++) {
    if (((k * 7 + seed * 13) % 5) > 2) continue;                               // gaps in the rack
    const x = -len / 2 + 0.3 + k * 0.5, c = SKI_COLS[(k + seed) % SKI_COLS.length];
    for (const dx of [-0.05, 0.05]) P.push(part(BOX(0.07, 1.7, 0.02, x + dx, 0, 0.27).applyMatrix4(new THREE.Matrix4().makeRotationX(-0.12)), c));
  }
  return P;
}
// rope maze in front of a loading line: `lanes` switchbacks, each len m long and 1.6 m wide, on short blue posts
const ROPE = [1.0, 0.55, 0.1], POST = [0.15, 0.3, 0.7];
function maze(lanes, len) {
  const P = [], w = 1.6, W = lanes * w;
  for (let r = 0; r <= lanes; r++) {
    const x = -W / 2 + r * w, gap = r === 0 || r === lanes ? 0 : 1.6, y0 = r % 2 ? gap : 0, y1 = r % 2 ? len : len - gap;
    for (let z = y0; z <= y1 + 0.01; z += 2.4) P.push(part(BOX(0.08, 1.0, 0.08, x, 0, z), POST));
    P.push(part(BOX(0.03, 0.03, y1 - y0, x, 0.9, (y0 + y1) / 2), ROPE));
  }
  P.push(part(BOX(W, 0.03, 0.03, 0, 0.9, len), ROPE));
  return P;
}

// ---------- Placement ----------
function place(parts, x, z, yaw, dy = 0, y = null) {
  const m = placeM(x, (y === null ? groundY(x, z) : y) + dy, z, yaw);
  bucket(propBatch, x, z, ...parts.map((p) => p.applyMatrix4(m)));
}
const LIFT = (n) => liftPaths.find((l) => l.name === n);
export function addMountainProps() {
  // snowcats: three in a row beside the Max Park maintenance buildings, blades facing down the slope
  {
    const [fx, fz] = fall(-372, -2868), ax = -fz, az = fx, yaw = Math.atan2(fx, fz);
    for (let k = 0; k < 3; k++) {
      const x = -372 + ax * (k - 1) * 6, z = -2868 + az * (k - 1) * 6;
      place(snowcat(), x, z, yaw, -0.1);
      solid(x, z, yaw, 4.6, 8.2, groundY(x, z) - 0.5, 3.6, 'snowcat');
    }
  }
  // patrol huts: beside the top terminal of the high lifts, on the side away from the lift line, clear of buildings
  for (const n of ['Big Burn', 'High Alpine', 'Elk Camp', 'Sheer Bliss', 'Cirque T-Bar']) {
    const lp = LIFT(n);
    if (!lp) continue;
    const N = lp.pts.length, [ex, ez] = lp.pts[N - 1], [px, pz] = lp.pts[N - 2], d = Math.hypot(ex - px, ez - pz), ux = (ex - px) / d, uz = (ez - pz) / d;
    for (const [a, b] of [[22, 6], [-22, 6], [24, 14], [-24, 14]]) {
      const x = ex - uz * a + ux * b, z = ez + ux * a + uz * b;
      if (nearSolid(x, z, 6)) continue;
      const yaw = Math.atan2(-ux, -uz);                                   // front looks back down the lift
      const y = Math.max(...[[-2, -2], [2, -2], [-2, 2], [2, 2]].map(([q, r]) => groundY(x + q, z + r)));
      place(patrolHut(), x, z, yaw, 0.2, y);
      solid(x, z, yaw, 4.6, 4.0, y - 2, 6.5, 'patrol hut');
      break;
    }
  }
  // trail-map boards and rope mazes at the main lift bottoms
  for (const n of ['Village Express', 'Elk Camp Gondola', 'Two Creeks', 'Big Burn', 'High Alpine', 'Sheer Bliss', 'Coney Express', 'Elk Camp']) {
    const lp = LIFT(n);
    if (!lp) continue;
    const sd = lp.stn[0], [bx, bz] = lp.pts[0], [nx, nz] = lp.pts[1], d = Math.hypot(nx - bx, nz - bz), ux = (nx - bx) / d, uz = (nz - bz) / d;
    // maze behind the loading line, lanes running up toward it
    if (sd) {
      const back = (sd.v1 || 6) + 5, x = bx - ux * (back + 12), z = bz - uz * (back + 12);
      if (!nearSolid(x, z, 6)) place(maze(4, 12), x, z, Math.atan2(ux, uz), 0, sd.y - 0.3);
    }
    // the board off to the side, facing the queue
    for (const s of [1, -1]) {
      const x = bx - ux * 18 - uz * 14 * s, z = bz - uz * 18 + ux * 14 * s;
      if (nearSolid(x, z, 6)) continue;
      const yaw = Math.atan2(uz * s, -ux * s), y = groundY(x, z);
      addMapStand({ x, z, yaw, w: 8.5, l: 0.8, bot: y - 1, ground: y, front: 1 });
      break;
    }
  }
  // ski racks outside the lodges, along the run side
  const racks = [['Base'], ['Sam\'s Knob'], ['Lizard Lodge'], ['Two Creeks'], ['Venga Venga']];
  let seed = 0;
  for (const [what] of racks) {
    const s = SOLIDS.find((q) => q.what === what || (q.what || '').startsWith(what));
    if (!s) continue;
    const front = [s.s, s.c];                                               // local +z of the building in the world
    for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const ox = s.hx * 0.5 * a, oz = (s.hz + 4) * b;
      const x = s.x + s.c * ox + s.s * oz, z = s.z - s.s * ox + s.c * oz;
      if (nearSolid(x, z, 2)) continue;
      place(skiRack(5, seed++), x, z, Math.atan2(s.s, s.c), -0.1);
      solid(x, z, Math.atan2(s.s, s.c), 5.2, 0.7, groundY(x, z) - 0.5, 1.7, 'ski rack');
      if (seed % 2 === 0) break;
    }
    void front;
  }
}

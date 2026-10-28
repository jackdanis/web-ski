// Low-poly kit models, detail rings, rocks, chairlift and gondola terminals, the Elk Camp restaurant.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { UP_Y, clamp, hash2 } from './config.js';
import { CELL, LIFT_CUT, NX, NZ, PAGE, SOLIDS, STATIONS, X0, Z0, addObstacle, deckDist, groundY, sampleBase, stB, stationH } from './world.js';
import { LIGHT, LIGHT_GLSL, camera, loadTex, scene, stationN, stationT } from './scene.js';

// ---------- Kit models: low poly, flat shaded, vertex colored, lit by Snowlight ----------
// aH: height above the model's base, so ground shadows only darken the bottom. aT: atlas tile (u, v in tiles, tile + 1;
// 0 = plain color); the tile's color and normal map apply up close and fade to the tile's average past ~300 m.
export const TILES = { hood: 0, deck: 1, siding: 2, window: 3, roofSnow: 4, concrete: 5, cabin: 6, steel: 7, pad: 8, metalRoof: 9,
  darkPanel: 10, cedar: 11, stone: 12, curtain: 13, posterA: 14, posterB: 15, posterC: 16 };
const TILE_AVG = [[0.14, 0.276, 0.588], [0.448, 0.352, 0.271], [0.469, 0.337, 0.225], [0.288, 0.298, 0.349], [0.943, 0.962, 1.0], [0.594, 0.575, 0.536],
  [0.135, 0.152, 0.181], [0.638, 0.658, 0.686], [0.745, 0.115, 0.096], [0.271, 0.281, 0.301], [0.148, 0.153, 0.167], [0.591, 0.387, 0.219],
  [0.399, 0.378, 0.352], [0.247, 0.307, 0.38], [0.541, 0.573, 0.616], [0.389, 0.325, 0.326], [0.614, 0.505, 0.493]];
while (TILE_AVG.length < 32) TILE_AVG.push([1, 1, 1]);
export const modelMat = new THREE.ShaderMaterial({
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
export const STEEL = [0.46, 0.48, 0.52], DARK = [0.2, 0.21, 0.25], CONC = [0.62, 0.6, 0.56],
  WALL = [0.5, 0.36, 0.24], SNOWCAP = [0.92, 0.95, 1.0], GLASS = [0.15, 0.2, 0.3];
// A one-color part with an optional matrix. With a tile, each face gets atlas coords projected on its main axis, 4 m a tile.
export function part(g, col, m, tile = -1) {
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
export function merge(parts) {
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
export const placeM = (x, y, z, yaw) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
export function placed(parts, m) {
  return parts.map((g) => {
    const h = g.attributes.aH.array.slice();
    g.applyMatrix4(m);
    g.attributes.aH.array.set(h);
    return g;
  });
}

// ---------- Detail rings: props and buildings drawn by distance ----------
// Each entry shows while the camera's ground distance to its box is in [min, max). Near models are built on first use.
export const RING_NEAR = 250, RING_FAR = 800;
export const ringed = [];
export function addRinged(obj, min = 0, max = RING_FAR, box = null) {
  if (!box) {
    const b = obj.geometry.boundingBox || (obj.geometry.computeBoundingBox(), obj.geometry.boundingBox);
    box = [b.min.x, b.max.x, b.min.z, b.max.z];
  }
  const e = { obj, min, max, box };
  if (obj.isObject3D) { obj.visible = false; scene.add(obj); }
  ringed.push(e);
  return e;
}
export function updateRings() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const e of ringed) {
    const [x0, x1, z0, z1] = e.box, d = Math.hypot(Math.max(x0 - cx, 0, cx - x1), Math.max(z0 - cz, 0, cz - z1));
    const on = d >= e.min && d < e.max;
    if (on && !e.obj.isObject3D) { e.obj = e.obj(); scene.add(e.obj); }
    if (e.obj.isObject3D) e.obj.visible = on;
  }
}
// geometries with the same attributes in one
export function mergeAny(geos) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(geos[0].attributes)) {
    const out = new Float32Array(geos.reduce((n, q) => n + q.attributes[name].array.length, 0));
    let o = 0;
    for (const q of geos) { out.set(q.attributes[name].array, o); o += q.attributes[name].array.length; }
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  g.computeBoundingSphere();
  return g;
}
// Static parts bucketed by tree page: one mesh per page, drawn out to RING_FAR.
const pageKeyAt = (x, z) => Math.floor((x - X0) / (PAGE * CELL)) * 1000 + Math.floor((z - Z0) / (PAGE * CELL));
export function bucket(map, x, z, ...geos) {
  const k = pageKeyAt(x, z);
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(...geos);
}
export function addByPage(map, mat, join = merge) {
  for (const geos of map.values()) addRinged(new THREE.Mesh(join(geos), mat));
  map.clear();
}
// Buildings: a box (walls, optional snowy roof) from RING_NEAR to RING_FAR and the near model inside RING_NEAR.
// Without a near model the box draws from 0, batched by page until flushBuildings(). near is a geometry, a mesh,
// or a function returning either, called when the camera first comes within RING_NEAR.
const STAND_INS = new Map();
export function addBuilding({ x, z, yaw = 0, w, l, bot, top, color = CONC, roof = null, near = null, mat = modelMat, solid = true, what = 'building' }) {
  const roofH = roof ? Math.min(0.5, (top - bot) * 0.1) : 0, m = placeM(x, bot, z, yaw);
  const box = [part(new THREE.BoxGeometry(w, top - bot - roofH, l).translate(0, (top - bot - roofH) / 2, 0), color, m)];
  if (roof) box.push(part(new THREE.BoxGeometry(w, roofH, l).translate(0, top - bot - roofH / 2, 0), roof, m));
  if (solid) SOLIDS.push({ x, z, y: (bot + top) / 2, hx: w / 2, hy: (top - bot) / 2, hz: l / 2, c: Math.cos(yaw), s: Math.sin(yaw), what });
  if (!near) { bucket(STAND_INS, x, z, ...box); return; }
  const r = Math.hypot(w, l) / 2, foot = [x - r, x + r, z - r, z + r];
  addRinged(new THREE.Mesh(merge(box), modelMat), RING_NEAR, RING_FAR, foot);
  const make = () => {
    const n = typeof near === 'function' ? near() : near;
    return n.isObject3D ? n : new THREE.Mesh(n, mat);
  };
  return addRinged(make, 0, RING_NEAR, foot);
}
export const flushBuildings = () => addByPage(STAND_INS, modelMat);
// Industrial building (Jack's reference: a small electrical building): dark brown lap siding, a flat roof behind a
// grey band, framed double doors on the side that faces the run (front = +1 for local +z, -1 for -z). One storey
// on small footprints, taller on big ones; batched with the stand-ins.
const IND_SIDING = [0.6, 0.66, 0.84], IND_DOOR = [0.21, 0.18, 0.16], IND_TRIM = [0.15, 0.13, 0.12], IND_BAND = [0.6, 0.6, 0.58];
export function addIndustrial({ x, z, yaw = 0, w, l, bot, ground, front = 1 }) {
  const H = ground - bot + (w * l < 80 ? 3.4 : 4.6), m = placeM(x, bot, z, yaw), band = 0.7;
  // doors go on a long side: swap so the long side runs along local x
  const long = w >= l, W = long ? w : l, L = long ? l : w, mm = long ? m : m.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  const P = [
    part(new THREE.BoxGeometry(W, H - band, L).translate(0, (H - band) / 2, 0), IND_SIDING, mm, TILES.siding),
    part(new THREE.BoxGeometry(W + 0.16, band, L + 0.16).translate(0, H - band / 2, 0), IND_BAND, mm),
    part(new THREE.BoxGeometry(W - 0.3, 0.12, L - 0.3).translate(0, H + 0.06, 0), SNOWCAP, mm),   // snow inside the band
  ];
  // pairs of doors 2.6 m wide, 2.5 m tall, about one per 4 m of wall
  const pairs = Math.max(1, Math.min(4, Math.floor(W / 4))), dy = ground - bot, zf = front * (L / 2 + 0.04);
  for (let k = 0; k < pairs; k++) {
    const cx = (k - (pairs - 1) / 2) * (W / pairs);
    P.push(part(new THREE.BoxGeometry(2.9, 2.75, 0.06).translate(cx, dy + 1.375, zf), IND_TRIM, mm));         // frame
    for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(1.24, 2.5, 0.1).translate(cx + s * 0.65, dy + 1.25, zf), IND_DOOR, mm, TILES.siding));
  }
  bucket(STAND_INS, x, z, ...P);
  SOLIDS.push({ x, z, y: bot + H / 2, hx: w / 2, hy: H / 2, hz: l / 2, c: Math.cos(yaw), s: Math.sin(yaw), what: 'industrial building' });
}

// ---------- Named buildings from Jack's laser notes (batch 2), built on their stand-in blocks ----------
// Each takes the block (centre, yaw, width w along local x, length l along local z, ground low and high) and
// front: +1 or -1, the local axis side that faces the run (local z if w >= l, else local x).
const WIN = [1.1, 1.1, 1.15];
const BOX = (w, h, l, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, l).translate(x, y + h / 2, z);
// shed roof block: width w across local x (low side at -x), length l along z, walls hLow and hHigh
function shed(w, l, hLow, hHigh) {
  const a = [-w / 2, 0], b = [w / 2, 0], c = [w / 2, hHigh], d = [-w / 2, hLow], pos = [];
  const v = (p, z) => [p[0], p[1], z];
  const quad = (p, q, r, s) => pos.push(...p, ...q, ...r, ...p, ...r, ...s);
  quad(v(a, l / 2), v(b, l / 2), v(c, l / 2), v(d, l / 2));
  quad(v(b, -l / 2), v(a, -l / 2), v(d, -l / 2), v(c, -l / 2));
  quad(v(b, l / 2), v(b, -l / 2), v(c, -l / 2), v(c, l / 2));
  quad(v(a, -l / 2), v(a, l / 2), v(d, l / 2), v(d, -l / 2));
  quad(v(d, l / 2), v(c, l / 2), v(c, -l / 2), v(d, -l / 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
// turn the block so its long side runs along local x and its run side is +z
function frameOf({ x, z, yaw, w, l, front }) {
  const long = w >= l, W = long ? w : l, L = long ? l : w;
  let m = placeM(0, 0, 0, yaw);
  if (!long) m = m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  if (front < 0) m = m.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  return { W, L, m: (y) => new THREE.Matrix4().makeTranslation(x, y, z).multiply(m) };
}
const solidBox = (x, z, yaw, w, l, y0, h, what) =>
  SOLIDS.push({ x, z, y: y0 + h / 2, hx: w / 2, hy: h / 2, hz: l / 2, c: Math.cos(yaw), s: Math.sin(yaw), what });

// Sam's Knob restaurant (pin 21, refs in references/buildings/sams-knob/): dark green board-and-batten under a low
// snowy roof, a tall timber-framed glass gable at the entrance (run side), and the back one flat wall of windows in
// wood cabin frames ("very Scandinavian").
const SK_GREEN = [0.78, 1.18, 1.35], SK_TIMBER = [1.25, 1.2, 1.15], SK_ROOF = [0.45, 0.45, 0.47];
export function addSamsKnob(b) {
  const { x, z, yaw, w, l, bot, ground } = b, { W, L, m } = frameOf(b), M = m(bot), dy = ground - bot, H = dy + 6.5;
  const P = [
    part(BOX(W, H, L), SK_GREEN, M, TILES.siding),
    part(gable(L + 1.2, W + 1.2, 2.2).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)).translate(0, H, 0), SK_ROOF, M, TILES.metalRoof),
    part(gable(L - 0.6, W - 0.6, 2.0).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)).translate(0, H + 0.12, 0), SNOWCAP, M),
  ];
  // the back: glass from the ground floor to the eaves, a cedar frame grid 3 m across and 2.6 m up
  const zb = -L / 2 - 0.05, gh = H - dy - 0.6, gy = dy + 0.3;
  P.push(part(BOX(W - 1.2, gh, 0.08, 0, gy, zb), WIN, M, TILES.window));
  const cols = Math.round((W - 1.2) / 3);
  for (let k = 0; k <= cols; k++) P.push(part(BOX(0.3, gh + 0.3, 0.3, -(W - 1.2) / 2 + k * (W - 1.2) / cols, gy - 0.15, zb - 0.1), SK_TIMBER, M, TILES.cedar));
  for (let y = gy; y <= gy + gh + 0.01; y += gh / Math.round(gh / 2.6)) P.push(part(BOX(W - 0.9, 0.3, 0.32, 0, y - 0.15, zb - 0.1), SK_TIMBER, M, TILES.cedar));
  // the entrance: a steep gable on four timber posts, glass in the gable end, a door below
  const ew = 11, ed = 6, eh = dy + 6.0, ez = L / 2 + ed / 2 - 1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(part(BOX(0.55, eh, 0.55, sx * (ew / 2 - 0.4), 0, ez + sz * (ed / 2 - 0.4)), SK_TIMBER, M, TILES.cedar));
  P.push(part(gable(ew + 1.4, ed + 1.0, 5.0).translate(0, eh, ez), SK_ROOF, M, TILES.metalRoof));
  P.push(part(gable(ew + 0.6, ed + 0.4, 4.6).translate(0, eh + 0.15, ez), SNOWCAP, M));
  const tri = gable(ew - 1.2, 0.08, 4.3).translate(0, eh, ez + ed / 2 - 0.3);
  P.push(part(tri, WIN, M, TILES.window));
  P.push(part(BOX(ew - 0.6, 0.5, 0.5, 0, eh - 0.5, ez + ed / 2 - 0.4), SK_TIMBER, M, TILES.cedar));                 // tie beam
  for (const s of [-1, 1]) {                                                                                       // braces
    const g = BOX(0.35, 3.6, 0.35).translate(0, -1.8, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(s * 0.95)).translate(s * (ew / 2 - 0.6), eh - 0.4, ez + ed / 2 - 0.4);
    P.push(part(g, SK_TIMBER, M, TILES.cedar));
  }
  P.push(part(BOX(ew - 2.0, eh - dy - 1.0, 0.08, 0, dy, L / 2 + 0.06), WIN, M, TILES.window));
  bucket(STAND_INS, x, z, ...P);
  solidBox(x, z, yaw, w, l, bot, H + 2, "Sam's Knob");
}

// UP4Pizza (pin 22, refs in references/buildings/up4pizza/): a tight rust-red board-and-batten cabin under a tall
// shed roof, big windows on the run side under grey corrugated awnings, a grey band of lap siding at the bottom,
// and ski racks on the slope just above it.
const UP_RED = [1.25, 0.82, 0.78], UP_GREY = [0.6, 0.6, 0.6], UP_ROOF = [0.32, 0.33, 0.36];
export function addUp4Pizza(b, uphill) {
  const { x, z, yaw, w, l, bot, ground } = b, { W, L, m } = frameOf(b), M = m(bot), dy = ground - bot;
  const lo = dy + 4.5, hi = dy + 9.0;
  const P = [
    part(shed(W, L, lo, hi), UP_RED, M, TILES.siding),
    part(BOX(W + 0.1, 1.4, L + 0.1, 0, dy, 0), UP_GREY, M, TILES.concrete),
  ];
  // roof: a thin slab along the slope with snow on it
  const run = Math.hypot(W, hi - lo), ang = Math.atan2(hi - lo, W);
  const slab = (t, col, lift) => part(BOX(run + 1.2, t, L + 1.2, 0, -t / 2, 0).applyMatrix4(new THREE.Matrix4().makeRotationZ(ang)).translate(0, (lo + hi) / 2 + lift, 0), col, M);
  P.push(slab(0.3, UP_ROOF, 0.15), slab(0.12, SNOWCAP, 0.4));
  // run side: two rows of windows, an awning over each row
  const zf = L / 2 + 0.05, n = Math.max(2, Math.floor((W - 2) / 2.6)), ww = (W - 2) / n;
  for (const [y0, h] of [[dy + 1.6, 2.3], [dy + 4.6, 2.0]]) {
    for (let k = 0; k < n; k++) P.push(part(BOX(ww - 0.35, h, 0.08, -(W - 2) / 2 + (k + 0.5) * ww, y0, zf), WIN, M, TILES.window));
    P.push(part(BOX(W - 1.4, 0.12, 1.4, 0, y0 + h + 0.25, zf + 0.6).applyMatrix4(new THREE.Matrix4().makeRotationX(0)), UP_GREY, M, TILES.metalRoof));
  }
  P.push(part(BOX(1.3, 2.3, 0.1, W / 2 - 1.2, dy, zf + 0.02), DARK, M));                                           // door
  bucket(STAND_INS, x, z, ...P);
  solidBox(x, z, yaw, w, l, bot, hi + 0.5, 'UP4Pizza');
  // ski racks: two 6 m racks of steel rails on legs, end to end across the slope, 6 m above the cabin
  const [ux, uz] = uphill, d = Math.max(w, l) / 2 + 6, cx = x + ux * d, cz = z + uz * d, ry = Math.atan2(ux, uz) + Math.PI / 2;
  const R = [];
  for (const off of [-3.3, 3.3]) {
    const rx = cx + Math.sin(ry) * off, rz = cz + Math.cos(ry) * off, gy = groundY(rx, rz) - 0.1, rm = placeM(rx, gy, rz, ry);
    for (const s of [-1, 1]) for (const hgt of [0.55, 0.95]) R.push(part(BOX(0.06, 0.06, 6, s * 0.25, hgt, 0), STEEL, rm));
    for (const t of [-2.8, 0, 2.8]) for (const s of [-1, 1]) R.push(part(BOX(0.06, 1.0, 0.06, s * 0.25, 0, t), STEEL, rm));
    solidBox(rx, rz, ry, 0.6, 6, gy, 1.0, 'ski rack');
  }
  bucket(STAND_INS, cx, cz, ...R);
}

// Trail-map stand (pin 20): a large wooden board on two log posts, a big log across the top, the game's own map on
// its face (Jack picked 1, 2026-10-27). The face is its own mesh: hudmap.js paints the map onto it once it is drawn.
const LOG = [1.15, 1.0, 0.9];
export const mapBoards = [];
export function addMapStand(b) {
  const { x, z, yaw, w, l, bot, ground } = b, { W, m } = frameOf(b), M = m(bot), dy = ground - bot;
  const bw = Math.min(W, 8.5), bh = 7.0, by = dy + 1.1;                     // the map is about square
  const P = [part(BOX(bw, bh, 0.3, 0, by, 0), WALL, M, TILES.cedar)];
  for (const s of [-1, 1]) P.push(part(new THREE.CylinderGeometry(0.28, 0.32, by + bh + 0.6, 8).translate(s * (bw / 2 + 0.2), (by + bh + 0.6) / 2, 0), LOG, M, TILES.cedar));
  P.push(part(new THREE.CylinderGeometry(0.42, 0.42, bw + 2.2, 10).applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).translate(0, by + bh + 0.55, 0), LOG, M, TILES.cedar));
  P.push(part(BOX(bw + 1.6, 0.14, 0.7, 0, by + bh + 0.98, 0), SNOWCAP, M));
  bucket(STAND_INS, x, z, ...P);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw - 0.5, bh - 0.5).translate(0, by + bh / 2, 0.17).applyMatrix4(M),
    new THREE.MeshBasicMaterial({ color: 0xd9d6cc }));
  face.userData.aspect = (bw - 0.5) / (bh - 0.5);
  mapBoards.push(face);
  addRinged(face);
  solidBox(x, z, yaw, w >= l ? bw + 1 : 0.8, w >= l ? 0.8 : bw + 1, bot, by + bh + 1, 'trail map');
}

// The Base (pin 7, ref in references/buildings/base-7/): a large building on a distinctive grey rock base, with the
// brick architecture of Jack's reference above it: three floors of tall arched windows and a stone cornice.
// Enterable later; only the outside for now.
const BRICK = [0.62, 0.27, 0.19], TRIM = [0.86, 0.8, 0.68], ROCK = [1.05, 1.05, 1.08];
export function addBase(b) {
  const { x, z, yaw, w, l, bot, ground } = b, { W, L, m } = frameOf(b), M = m(bot), dy = ground - bot;
  const rockTop = dy + 3.5, FLOOR = 4.2, floors = 3, top = rockTop + FLOOR * floors;
  const P = [
    part(BOX(W + 0.8, rockTop, L + 0.8), ROCK, M, TILES.stone),
    part(BOX(W, top - rockTop, L, 0, rockTop), BRICK, M),
    part(BOX(W + 1.2, 0.9, L + 1.2, 0, top - 0.2), TRIM, M, TILES.concrete),
    part(BOX(W + 0.6, 0.35, L + 0.6, 0, rockTop - 0.1), TRIM, M, TILES.concrete),
    part(BOX(W - 0.4, 0.14, L - 0.4, 0, top + 0.7), SNOWCAP, M),
  ];
  // tall windows with round-topped heads (a lighter arch block over each), on all four sides
  const wins = (len, axisX, sgn) => {
    const n = Math.floor(len / 3.6), step = len / n;
    for (let f = 0; f < floors; f++) {
      const y = rockTop + f * FLOOR + 0.8;
      for (let k = 0; k < n; k++) {
        const c = -len / 2 + (k + 0.5) * step;
        const at = (gw, gh, gy, d) => axisX ? BOX(gw, gh, 0.1, c, gy, sgn * (L / 2 + d)) : BOX(0.1, gh, gw, sgn * (W / 2 + d), gy, c);
        P.push(part(at(1.3, 2.4, y, 0.04), WIN, M, TILES.window));
        P.push(part(at(1.7, 0.45, y + 2.4, 0.08), TRIM, M));
        P.push(part(at(1.6, 0.18, y - 0.18, 0.1), TRIM, M));
      }
    }
  };
  wins(W, true, 1); wins(W, true, -1); wins(L, false, 1); wins(L, false, -1);
  bucket(STAND_INS, x, z, ...P);
  solidBox(x, z, yaw, w + 0.8, l + 0.8, bot, top + 1, 'Base');
}

// ---------- Snowmass Mall (laser notes batch 3, refs in references/buildings/westin-snowmass/) ----------
// Big village buildings on steep ground: each is a grid of masses, and every mass stands on its own ground (a stone
// plinth takes up the slope under it), so the building steps down the hill like the real ones.
// m: frame matrix at y 0; spec: { x0, x1, z0, z1 } in frame metres, floors, and a style.
// style: { wall, plinth, FH (floor height), band (window band height), balcony (rail color) or null, cap (roof trim) }
function mass(P, b, frame, spec, st) {
  const { x0, x1, z0, z1, floors } = spec, M = frame.m(0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0, bl = z1 - z0;
  const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(M);
  const g = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]].map(([u, v]) => { const q = at(u, v); return groundY(q.x, q.z); });
  const lo = Math.min(...g) - 1, hi = Math.max(...g) + 0.3, top = hi + floors * st.FH;
  P.push(part(BOX(bw + 0.4, hi - lo, bl + 0.4, cx, lo, cz), st.plinth, M, TILES.stone));
  P.push(part(BOX(bw, top - hi, bl, cx, hi, cz), st.wall, M));
  P.push(part(BOX(bw + 0.6, 0.7, bl + 0.6, cx, top - 0.1, cz), st.cap, M));
  P.push(part(BOX(bw - 0.4, 0.14, bl - 0.4, cx, top + 0.6, cz), SNOWCAP, M));
  // window bands on all four faces, balconies (slab and rail) on the run side and the two ends
  const faces = [[bw, true, 1], [bw, true, -1], [bl, false, 1], [bl, false, -1]];
  for (let f = 0; f < floors; f++) {
    const y = hi + f * st.FH;
    for (const [len, alongX, sg] of faces) {
      const box = (gw, gh, gy, d, dep = 0.1) => alongX ? BOX(gw, gh, dep, cx, gy, cz + sg * (bl / 2 + d)) : BOX(dep, gh, gw, cx + sg * (bw / 2 + d), gy, cz);
      P.push(part(box(len - 1.6, st.band, y + (st.FH - st.band) / 2 + 0.1, 0.03), WIN, M, TILES.window));
      if (st.balcony && f > 0 && !(alongX && sg < 0)) {
        P.push(part(box(len - 1.0, 0.22, y, 0.7, 1.4), st.cap, M));
        P.push(part(box(len - 1.0, 1.0, y + 0.22, 1.35, 0.08), st.balcony, M));
      }
    }
  }
  const c = at(cx, cz), long = b.w >= b.l;
  solidBox(c.x, c.z, b.yaw, long ? bw : bl, long ? bl : bw, lo, top - lo + 1, st.what);
  return { lo, hi, top };
}

// The Westin (pins 4 and 5, one complex), after the FLUX render Jack picked (art/buildings/westin/flux/westin-flux-58):
// one long lodge dug into the slope under one big snowy roof, eight floors above its mean ground. A two-floor sandstone
// base, warm brown wood above with dark-railed balconies, a gabled wing at the left end, a wing angled toward the run at
// the right end (it guides skiers to the walkway), four steep gabled bays along the front, a terrace with a snowy roof
// on timber posts over the ground floor, and two tall stone chimneys. Pin 5 is a lower wing in the same style.
const LODGE = { wall: [0.98, 0.84, 0.74], stone: [1.9, 1.6, 1.2], roof: [0.3, 0.31, 0.33], timber: [1.2, 1.05, 0.9],
  rail: [0.16, 0.14, 0.13], FH: 3.2 };
// one piece: walls from below its lowest ground to `top`, a stone base (two floors above its highest ground),
// tall windows and run-side balconies above, and a gable roof whose ridge runs along local x or z (gable ends at the
// other two sides). wall: the wall color (the stone tower passes the stone color).
function lodgePiece(P, b, F, { x0, x1, z0, z1 }, top, ridge, gh, what, wall = LODGE.wall) {
  const M = F.m(0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, bw = x1 - x0, bl = z1 - z0;
  const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(M);
  const g = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [cx, cz]].map(([u, v]) => { const q = at(u, v); return groundY(q.x, q.z); });
  const lo = Math.min(...g) - 1, stoneTop = Math.max(...g) + 7.4;
  P.push(part(BOX(bw + 0.5, stoneTop - lo, bl + 0.5, cx, lo, cz), LODGE.stone, M, TILES.stone));
  P.push(part(BOX(bw, top - stoneTop, bl, cx, stoneTop, cz), wall, M, wall === LODGE.wall ? TILES.siding : TILES.stone));
  P.push(part(BOX(bw + 0.8, 0.5, bl + 0.8, cx, top - 0.3, cz), LODGE.timber, M, TILES.cedar));                  // eave band
  const faces = [[bw, true, 1], [bw, true, -1], [bl, false, 1], [bl, false, -1]];
  for (let y = lo + 1 + 0.9; y < top - 2; y += LODGE.FH) for (const [len, alongX, sg] of faces) {
    const box = (gw, gh2, gy, d, dep = 0.1) => alongX ? BOX(gw, gh2, dep, cx, gy, cz + sg * (bl / 2 + d)) : BOX(dep, gh2, gw, cx + sg * (bw / 2 + d), gy, cz);
    const n = Math.max(1, Math.floor((len - 2) / 4.2)), step = (len - 2) / n;            // pairs of tall windows, 4.2 m apart
    for (let k = 0; k < n; k++) {
      const c = -(len - 2) / 2 + (k + 0.5) * step, o = alongX ? [c, 0] : [0, c];
      const wb = (alongX ? BOX(2.6, 1.9, 0.1, cx + c, y, cz + sg * (bl / 2 + 0.3)) : BOX(0.1, 1.9, 2.6, cx + sg * (bw / 2 + 0.3), y, cz + c));
      P.push(part(wb, WIN, M, TILES.window));
    }
    if (y > stoneTop && alongX && sg > 0 && wall === LODGE.wall) {      // balconies on the run side: slab and dark rail
      P.push(part(box(len - 2, 0.25, y - 0.9, 0.8, 1.6), LODGE.wall, M));
      P.push(part(box(len - 2, 1.05, y - 0.65, 1.55, 0.08), LODGE.rail, M));
    }
  }
  // roof: dark metal gable with an overhang, snow on top; timber trim and glass in the gable ends
  const rw = (ridge === 'x' ? bl : bw) + 3, rl = (ridge === 'x' ? bw : bl) + 3;
  const rot = ridge === 'x' ? new THREE.Matrix4().makeRotationY(Math.PI / 2) : new THREE.Matrix4();
  P.push(part(gable(rw, rl, gh).applyMatrix4(rot).translate(cx, top, cz), LODGE.roof, M, TILES.metalRoof));
  P.push(part(gable(rw - 0.8, rl - 0.4, gh).applyMatrix4(rot).translate(cx, top + 0.3, cz), SNOWCAP, M));
  for (const s of [-1, 1]) {
    const endAt = (ridge === 'x' ? bw : bl) / 2 + 0.06;
    const tri = gable(rw - 5, 0.1, gh - 1.6).translate(0, 0.4, s * endAt).applyMatrix4(rot).translate(cx, top, cz);
    P.push(part(tri, WIN, M, TILES.window));
    const beam = BOX(rw - 3.5, 0.45, 0.45, 0, -0.1, s * (endAt + 0.2)).applyMatrix4(rot).translate(cx, top, cz);
    P.push(part(beam, LODGE.timber, M, TILES.cedar));
  }
  const c = at(cx, cz), long = b.w >= b.l;
  solidBox(c.x, c.z, b.yaw, long ? bw : bl, long ? bl : bw, lo, top + gh - lo, what);
  return { lo, top };
}
function lodgeTop(b, F, floors) {                                          // one roofline: floors above the mean ground
  const M = F.m(0); let hi = 0;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 3; j++) {
    const q = new THREE.Vector3(-F.W / 2 + F.W * i / 6, 0, -F.L / 2 + F.L * j / 3).applyMatrix4(M);
    hi += groundY(q.x, q.z) / 28;
  }
  return hi + 0.5 + floors * LODGE.FH;
}
export function addWestin(b) {
  const F = frameOf(b), { W, L } = F, M = F.m(0), P = [], top = lodgeTop(b, F, 8), zf = L / 2 - 10;   // zf: main front wall
  const xr = W / 2 - 34;                                                                       // where the angled wing starts
  const bar = lodgePiece(P, b, F, { x0: -W / 2 + 2, x1: xr, z0: -L / 2, z1: zf }, top, 'x', 14, 'Westin');
  const piece = (xc, w, z0, z1, gh) => lodgePiece(P, b, F, { x0: xc - w / 2, x1: xc + w / 2, z0, z1 }, top, 'z', gh, 'Westin');
  piece(-W / 2 + 15, 26, zf - 22, zf + 4, 12);                                                // left end wing
  for (const [xc, w] of [[-0.24 * W, 15], [-0.1 * W, 13], [0.03 * W, 17], [0.16 * W, 13]]) piece(xc, w, zf - 4, zf + 2, 10);   // bays
  // the angled right wing: its own frame, turned 35 degrees so its far end comes forward toward the run
  const ang = -0.61, sub = { m: (y) => F.m(y).multiply(new THREE.Matrix4().makeTranslation(xr - 4, 0, (zf - L / 2) / 2 + 8)).multiply(new THREE.Matrix4().makeRotationY(ang)) };
  lodgePiece(P, { ...b, yaw: b.yaw + ang }, sub, { x0: 0, x1: 40, z0: -18, z1: 6 }, top, 'x', 12, 'Westin');
  const SM = sub.m(0);
  // terrace over the ground floor along the middle of the front: stone below, a snowy roof on timber posts
  const tx0 = -0.32 * W, tx1 = 0.24 * W, tz = zf + 2 + 4;
  const gAt = (lx, lz, m = M) => { const q = new THREE.Vector3(lx, 0, lz).applyMatrix4(m); return groundY(q.x, q.z); };
  const tg = Math.min(gAt(tx0, tz + 4), gAt(0, tz + 4), gAt(tx1, tz + 4)), ty = Math.max(gAt(tx0, zf), gAt(tx1, zf)) + 4.2;
  P.push(part(BOX(tx1 - tx0, ty - tg + 1, 8, (tx0 + tx1) / 2, tg - 1, tz), LODGE.stone, M, TILES.stone));
  for (let k = 0; k <= 8; k++) {
    const x = tx0 + 0.4 + k * (tx1 - tx0 - 0.8) / 8;
    P.push(part(BOX(2.6, 2.6, 0.12, x + (tx1 - tx0) / 16, ty - 3.4, tz + 4.06), WIN, M, TILES.window));     // ground-floor windows
    P.push(part(BOX(0.4, 3.0, 0.4, x, ty, tz + 3.6), LODGE.timber, M, TILES.cedar));
  }
  P.push(part(BOX(tx1 - tx0 + 1, 0.5, 8.6, (tx0 + tx1) / 2, ty + 3.0, tz), LODGE.timber, M, TILES.cedar));
  P.push(part(BOX(tx1 - tx0 + 0.6, 0.35, 8.2, (tx0 + tx1) / 2, ty + 3.5, tz), SNOWCAP, M));
  P.push(part(BOX(tx1 - tx0, 1.0, 0.08, (tx0 + tx1) / 2, ty, tz + 4.1), LODGE.rail, M));
  const tc = new THREE.Vector3((tx0 + tx1) / 2, 0, tz).applyMatrix4(M), long = b.w >= b.l;
  solidBox(tc.x, tc.z, b.yaw, long ? tx1 - tx0 : 8, long ? 8 : tx1 - tx0, tg - 1, ty + 4 - tg, 'Westin');
  // two tall stone chimneys: at the left wing's front corner, and at the far end of the angled wing
  for (const [cx, cz, m] of [[-W / 2 + 30, zf + 3, M], [36, -14, SM]]) {
    const lo = gAt(cx, cz, m) - 1;
    P.push(part(BOX(6, top + 20 - lo, 6, cx, lo, cz), LODGE.stone, m, TILES.stone));
    P.push(part(BOX(6.8, 0.6, 6.8, cx, top + 20, cz), LODGE.roof, m));
    P.push(part(BOX(6.4, 0.15, 6.4, cx, top + 20.6, cz), SNOWCAP, m));
    const q = new THREE.Vector3(cx, 0, cz).applyMatrix4(m);
    solidBox(q.x, q.z, b.yaw, 6, 6, lo, top + 21 - lo, 'chimney');
  }
  bucket(STAND_INS, b.x, b.z, ...P);
}
export function addWestinWing(b) {
  const F = frameOf(b), { W, L } = F, P = [];
  lodgePiece(P, b, F, { x0: -W / 2, x1: W / 2, z0: -L / 2, z1: L / 2 }, lodgeTop(b, F, 6), 'x', 6, 'Westin');
  bucket(STAND_INS, b.x, b.z, ...P);
}

// The other hotel (pin 6): the older tan building beside the Westin in Jack's photo, dark brown wood balconies.
const TAN_HOTEL = { wall: [0.74, 0.64, 0.5], plinth: [1.0, 0.98, 0.95], cap: [0.6, 0.52, 0.42], balcony: [0.3, 0.21, 0.15], FH: 3.0, band: 1.6, what: 'hotel' };
export function addTanHotel(b) {
  const F = frameOf(b), { W, L } = F, P = [];
  for (const [x0, x1] of [[-W / 2, 0], [0, W / 2]]) for (const [z0, z1, fl] of [[-L / 2, 0, 5], [0, L / 2, 4]]) mass(P, b, F, { x0, x1, z0, z1, floors: fl }, TAN_HOTEL);
  bucket(STAND_INS, b.x, b.z, ...P);
}

// Rich cabins (batch 4, pins 8 to 15: every stand-in in the section between Lower Banzai, Adams' Avenue and Green Cabin),
// three variants after Jack's photos (references/buildings/rich-cabins/):
// 'garage' (ref 1): a stone ground floor with cedar garage doors, a cedar and copper upper floor under a gable facing
//   the run, heavy timber trusses in the gable end, a copper chimney;
// 'chalet' (ref 2): stone ground floor and corner piers, dark wood above, a long rust roof with two cross gables at
//   the ends, a covered balcony stack between them, two stone chimneys;
// 'hip' (ref 3): stone ground floor, dark wood above, a grey hipped main roof, gabled wings forward at both ends,
//   a two-floor porch in the middle and one stone chimney.
const RICH = { stone: [1.75, 1.5, 1.2], cedar: [1.25, 1.05, 0.88], dark: [0.62, 0.47, 0.36], copper: [0.74, 0.4, 0.26],
  rust: [0.5, 0.3, 0.24], slate: [0.36, 0.37, 0.4], shingle: [0.34, 0.34, 0.36], timber: [0.9, 0.72, 0.55], rail: [0.16, 0.14, 0.13], FH: 3.1 };
// hip roof over w (x) by l (z), ridge along x, height h
function hip(w, l, h) {
  const r = Math.max(0, (w - l) / 2), pos = [];
  const A = [-w / 2, 0, -l / 2], B = [w / 2, 0, -l / 2], C = [w / 2, 0, l / 2], D = [-w / 2, 0, l / 2], E = [-r, h, 0], F = [r, h, 0];
  pos.push(...D, ...C, ...F, ...D, ...F, ...E, ...B, ...A, ...E, ...B, ...E, ...F, ...C, ...B, ...F, ...A, ...D, ...E);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
export function addRichCabin(b, variant) {
  const F = frameOf(b), { W, L } = F, M = F.m(0), P = [];
  const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(M);
  const gs = [[-W / 2, -L / 2], [W / 2, -L / 2], [-W / 2, L / 2], [W / 2, L / 2], [0, 0]].map(([u, v]) => { const q = at(u, v); return groundY(q.x, q.z); });
  const lo = Math.min(...gs) - 1, hi = Math.max(...gs) + 0.3, f1 = hi + RICH.FH;
  const rotZ = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  // windows on a face: n tall panes across len, centred at c along the face
  const panes = (w, h, y, face, len, n, c = 0) => {
    for (let k = 0; k < n; k++) {
      const u = c - len / 2 + (k + 0.5) * len / n;
      const g = face === 'f' ? BOX(w, h, 0.12, u, y, L / 2 + 0.05) : face === 'b' ? BOX(w, h, 0.12, u, y, -L / 2 - 0.05)
        : BOX(0.12, h, w, (face === 'r' ? 1 : -1) * (W / 2 + 0.05), y, u);
      P.push(part(g, WIN, M, TILES.window));
    }
  };
  const roofOf = (geo, col, y, snowGeo) => {
    P.push(part(geo.translate(0, y, 0), col, M, TILES.metalRoof));
    P.push(part(snowGeo.translate(0, y + 0.22, 0), SNOWCAP, M));
  };
  const chimney = (x, z, w, top, col, tile) => {
    P.push(part(BOX(w, top - lo, w, x, lo, z), col, M, tile));
    P.push(part(BOX(w + 0.3, 0.12, w + 0.3, x, top, z), SNOWCAP, M));
  };
  let roofTop;
  if (variant === 'garage') {
    const f2 = f1 + RICH.FH + 0.4, gh = Math.min(6, W * 0.32);
    P.push(part(BOX(W, f1 - lo, L, 0, lo, 0), RICH.stone, M, TILES.stone));
    P.push(part(BOX(W + 0.5, f2 - f1, L + 0.5, 0, f1, 0), RICH.cedar, M, TILES.cedar));
    P.push(part(BOX(W + 0.7, 0.25, L + 0.7, 0, f1 - 0.1, 0), RICH.timber, M, TILES.cedar));          // floor beam
    const nd = Math.max(1, Math.min(3, Math.floor(W / 5)));                                         // garage doors
    for (let k = 0; k < nd; k++) P.push(part(BOX(Math.min(4.6, W / nd - 1.2), 2.4, 0.14, -W / 2 + (k + 0.5) * W / nd, hi, L / 2 + 0.04), RICH.cedar, M, TILES.cedar));
    panes(1.5, 2.2, f1 + 0.5, 'f', W - 2, Math.max(2, Math.floor(W / 3.5)));
    panes(1.5, 2.2, f1 + 0.5, 'l', L - 3, Math.max(1, Math.floor(L / 5)));
    panes(1.5, 2.2, f1 + 0.5, 'r', L - 3, Math.max(1, Math.floor(L / 5)));
    // gable along z: its end faces the run; copper panel in the gable, truss beams in front of it
    roofOf(gable(W + 2.4, L + 2.2, gh), RICH.shingle, f2, gable(W + 1.8, L + 1.6, gh));
    P.push(part(gable(W + 1.6, 0.12, gh - 0.2).translate(0, f2, L / 2 + 1.18), RICH.copper, M));          // over the roof's end
    P.push(part(BOX(W + 0.6, 0.45, 0.45, 0, f2 + 0.2, L / 2 + 1.45), RICH.timber, M, TILES.cedar));
    P.push(part(BOX(0.45, gh - 0.6, 0.45, 0, f2 + 0.2, L / 2 + 1.45), RICH.timber, M, TILES.cedar));
    for (const s of [-1, 1]) P.push(part(BOX(0.4, f2 - hi, 0.4, s * (W / 2 + 0.2), hi, L / 2 + 1.45), RICH.timber, M, TILES.cedar));   // corner posts
    roofTop = f2 + gh;
    chimney(-W / 4, -L / 4, 1.6, roofTop + 1.2, RICH.copper);
  } else if (variant === 'chalet') {
    const f2 = f1 + RICH.FH, f3 = f2 + RICH.FH, gh = Math.min(7, L * 0.45), wing = Math.min(7, W * 0.28);
    P.push(part(BOX(W, f1 - lo, L, 0, lo, 0), RICH.stone, M, TILES.stone));
    P.push(part(BOX(W, f3 - f1, L, 0, f1, 0), RICH.dark, M, TILES.siding));
    for (const s of [-1, 1]) P.push(part(BOX(2.0, f3 - lo, 1.6, s * (W / 2 - 1.0), lo, L / 2 - 0.5), RICH.stone, M, TILES.stone));   // stone piers
    // main roof: gable with its ridge along x; cross gables over both end wings, set forward
    roofOf(gable(L + 2.4, W + 2.4, gh).applyMatrix4(rotZ), RICH.rust, f3, gable(L + 1.8, W + 1.6, gh).applyMatrix4(rotZ));
    for (const s of [-1, 1]) {
      const cx = s * (W / 2 - wing / 2);
      P.push(part(BOX(wing, f3 - f1, 1.2, cx, f1, L / 2 + 0.6), RICH.dark, M, TILES.siding));
      P.push(part(gable(wing + 1.6, L / 2 + 2.5, gh * 0.85).translate(cx, f3, L / 4 + 0.6), RICH.rust, M, TILES.metalRoof));
      P.push(part(gable(wing + 1.0, L / 2 + 2.0, gh * 0.85).translate(cx, f3 + 0.22, L / 4 + 0.6), SNOWCAP, M));
      P.push(part(gable(wing + 1.2, 0.12, gh * 0.85 - 0.2).translate(cx, f3, L / 2 + 1.92), RICH.cedar, M, TILES.cedar));
      for (const y of [f1 + 0.5, f2 + 0.5]) P.push(part(BOX(wing - 2.2, 2.2, 0.12, cx, y, L / 2 + 1.25), WIN, M, TILES.window));
      chimney(s * (W / 2 - 0.9), -L / 4, 1.8, f3 + gh + 1.5, RICH.stone, TILES.stone);
    }
    // covered balcony stack in the middle: slabs, dark rails, timber columns
    const bw = Math.max(3, W - 2 * wing - 1);
    for (const y of [f1, f2]) {
      P.push(part(BOX(bw, 0.25, 2.2, 0, y - 0.1, L / 2 + 1.1), RICH.timber, M, TILES.cedar));
      P.push(part(BOX(bw, 1.0, 0.08, 0, y + 0.15, L / 2 + 2.15), RICH.rail, M));
    }
    for (const s of [-1, 0, 1]) P.push(part(BOX(0.45, f3 - hi, 0.45, s * (bw / 2 - 0.3), hi, L / 2 + 2.0), RICH.timber, M, TILES.cedar));
    for (const y of [hi + 0.4, f1 + 0.5, f2 + 0.5]) panes(1.6, 2.2, y, 'f', bw - 1, Math.max(2, Math.floor(bw / 2.5)));
    for (const y of [f1 + 0.5, f2 + 0.5]) { panes(1.6, 2.2, y, 'l', L - 3, 3); panes(1.6, 2.2, y, 'r', L - 3, 3); }
    // wood over both ends of the roof, one window each
    for (const s of [-1, 1]) {
      P.push(part(gable(L + 2.0, 0.12, gh - 0.2).applyMatrix4(rotZ).translate(s * (W / 2 + 1.27), f3, 0), RICH.dark, M, TILES.siding));
      P.push(part(BOX(0.12, 2.0, 2.4, s * (W / 2 + 1.36), f3 + 0.6, 0), WIN, M, TILES.window));
    }
    roofTop = f3 + gh;
  } else {
    const f2 = f1 + RICH.FH, f3 = f2 + RICH.FH, gh = Math.min(6.5, L * 0.4), wing = Math.min(8, W * 0.3);
    P.push(part(BOX(W, f1 - lo, L, 0, lo, 0), RICH.stone, M, TILES.stone));
    P.push(part(BOX(W, f3 - f1, L, 0, f1, 0), RICH.dark, M, TILES.siding));
    roofOf(hip(W + 2.4, L + 2.4, gh), RICH.slate, f3, hip(W + 1.8, L + 1.8, gh));
    // wings: forward of the main block at both ends, stone up to the first floor, a gable facing the run
    for (const s of [-1, 1]) {
      const cx = s * (W / 2 - wing / 2), d = 3.0, cz = L / 2 + d / 2;
      P.push(part(BOX(wing, f1 - lo, d, cx, lo, cz), RICH.stone, M, TILES.stone));
      P.push(part(BOX(wing, f3 - f1, d, cx, f1, cz), RICH.dark, M, TILES.siding));
      P.push(part(gable(wing + 1.4, d + 3, gh * 0.9).translate(cx, f3, L / 2 + d / 2 - 0.5), RICH.rust, M, TILES.metalRoof));
      P.push(part(gable(wing + 0.8, d + 2.6, gh * 0.9).translate(cx, f3 + 0.22, L / 2 + d / 2 - 0.5), SNOWCAP, M));
      for (const y of [hi + 0.4, f1 + 0.5, f2 + 0.5]) P.push(part(BOX(wing - 3, 2.3, 0.12, cx, y, L / 2 + d + 0.05), WIN, M, TILES.window));
      P.push(part(gable(wing + 1.0, 0.12, gh * 0.9 - 0.2).translate(cx, f3, L / 2 + d + 1.05), RICH.dark, M, TILES.siding));
      P.push(part(BOX(wing - 3.6, 1.6, 0.12, cx, f3 + 0.3, L / 2 + d + 1.12), WIN, M, TILES.window));   // the gable window
    }
    // two-floor porch between the wings: posts, a slab with a dark rail, a shed roof
    const pw = Math.max(3, W - 2 * wing - 1);
    P.push(part(BOX(pw, 0.25, 2.6, 0, f1 - 0.1, L / 2 + 1.3), RICH.timber, M, TILES.cedar));
    P.push(part(BOX(pw, 1.0, 0.08, 0, f1 + 0.15, L / 2 + 2.55), RICH.rail, M));
    for (const s of [-1, 1]) P.push(part(BOX(0.5, f3 - hi, 0.5, s * (pw / 2 - 0.3), hi, L / 2 + 2.4), RICH.timber, M, TILES.cedar));
    for (const y of [hi + 0.4, f1 + 0.5, f2 + 0.5]) panes(1.6, 2.2, y, 'f', pw - 1, Math.max(2, Math.floor(pw / 2.5)));
    for (const y of [f1 + 0.5, f2 + 0.5]) { panes(1.4, 2.0, y, 'l', L - 3, 2); panes(1.4, 2.0, y, 'r', L - 3, 2); }
    roofTop = f3 + gh;
    chimney(-W / 2 + 1.2, 0, 2.0, roofTop + 1.0, RICH.stone, TILES.stone);
  }
  const long = b.w >= b.l;
  solidBox(b.x, b.z, b.yaw, long ? W : L, long ? L : W, lo, roofTop - lo, 'cabin');
  bucket(STAND_INS, b.x, b.z, ...P);
}

// Venga Venga (pin 3), v2: a low two-storey cantina. Stone base, a cedar-clad ground floor with big windows, a cream
// stucco upper floor, a low snowy gable roof on timber eaves, and a wooden deck on the run side with dark rails and a
// string of red and orange flags (Jack's photos).
const VENGA = { cream: [0.88, 0.82, 0.68], stone: [1.12, 1.0, 0.86], dark: [0.25, 0.2, 0.17], flags: [[0.8, 0.18, 0.12], [0.95, 0.5, 0.12]] };
export function addVenga(b) {
  const F = frameOf(b), { W, L } = F, M = F.m(0), P = [], D = 7, zf = L / 2 - D;
  const at = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(M);
  let floor0 = -1e9;
  for (const [x0, x1] of [[-W / 2, 0], [0, W / 2]]) {
    const cx = (x0 + x1) / 2, cz = (-L / 2 + zf) / 2, bw = x1 - x0, bl = zf + L / 2;
    const g = [[x0, -L / 2], [x1, -L / 2], [x0, zf], [x1, zf], [cx, cz]].map(([u, v]) => { const q = at(u, v); return groundY(q.x, q.z); });
    const lo = Math.min(...g) - 1, hi = Math.max(...g) + 0.6, f1 = hi + 4.4, top = f1 + 4.0;
    floor0 = Math.max(floor0, hi);
    P.push(part(BOX(bw + 0.4, hi - lo, bl + 0.4, cx, lo, cz), VENGA.stone, M, TILES.stone));
    P.push(part(BOX(bw, f1 - hi, bl, cx, hi, cz), [1, 1, 1], M, TILES.cedar));
    P.push(part(BOX(bw + 0.3, top - f1, bl + 0.3, cx, f1, cz), VENGA.cream, M));
    P.push(part(BOX(bw + 0.6, 0.4, bl + 0.6, cx, f1 - 0.2, cz), VENGA.dark, M));                  // floor band
    for (const [len, alongX, sg] of [[bw, true, 1], [bw, true, -1], [bl, false, 1], [bl, false, -1]]) {
      const n = Math.max(1, Math.floor((len - 2) / 4)), step = (len - 2) / n;
      for (let k = 0; k < n; k++) {
        const c = -(len - 2) / 2 + (k + 0.5) * step;
        for (const [y, h, d] of [[hi + 0.6, 2.9, 0.06], [f1 + 0.9, 1.9, 0.22]]) {
          const g2 = alongX ? BOX(3.0, h, 0.1, cx + c, y, cz + sg * (bl / 2 + d)) : BOX(0.1, h, 3.0, cx + sg * (bw / 2 + d), y, cz + c);
          P.push(part(g2, WIN, M, TILES.window));
        }
      }
    }
    P.push(part(BOX(bw + 1.6, 0.5, bl + 1.6, cx, top - 0.2, cz), VENGA.dark, M, TILES.cedar));     // timber eaves
    P.push(part(gable(bl + 2.4, bw + 2.4, 3.2).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)).translate(cx, top + 0.3, cz), LODGE.roof, M, TILES.metalRoof));
    P.push(part(gable(bl + 1.8, bw + 2.0, 3.2).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)).translate(cx, top + 0.55, cz), SNOWCAP, M));
    const c = at(cx, cz), long = b.w >= b.l;
    solidBox(c.x, c.z, b.yaw, long ? bw : bl, long ? bl : bw, lo, top + 3.5 - lo, 'Venga Venga');
  }
  // the deck: stone wall below, planks level with the ground floor, dark rails, posts with a string of flags
  const dg = Math.min(...[-W / 2, 0, W / 2].map((u) => { const q = at(u, L / 2); return groundY(q.x, q.z); }));
  const dy = Math.max(floor0, dg + 0.6), zc = zf + D / 2;
  P.push(part(BOX(W, dy - dg + 1, D, 0, dg - 1, zc), VENGA.stone, M, TILES.stone));
  P.push(part(BOX(W, 0.3, D, 0, dy - 0.3, zc), [1, 1, 1], M, TILES.deck));
  P.push(part(BOX(W, 1.0, 0.12, 0, dy, L / 2 - 0.1), VENGA.dark, M));
  for (const s of [-1, 1]) P.push(part(BOX(0.12, 1.0, D, s * (W / 2 - 0.1), dy, zc), VENGA.dark, M));
  const posts = Math.round(W / 8);
  for (let k = 0; k <= posts; k++) P.push(part(BOX(0.25, 3.2, 0.25, -W / 2 + 0.2 + k * (W - 0.4) / posts, dy, L / 2 - 0.2), VENGA.dark, M, TILES.cedar));
  for (let k = 0; k < posts * 6; k++) {                                                          // flags between the posts
    const x = -W / 2 + 0.6 + (k + 0.5) * (W - 1.2) / (posts * 6), sag = Math.sin(((k % 6) + 0.5) / 6 * Math.PI) * 0.6;
    P.push(part(BOX(0.45, 0.5, 0.04, x, dy + 2.6 - sag, L / 2 - 0.2), VENGA.flags[k % 2], M));
  }
  const c = at(0, zc), long = b.w >= b.l;
  solidBox(c.x, c.z, b.yaw, long ? W : D, long ? D : W, dg - 1, dy - dg + 2, 'Venga Venga deck');
  bucket(STAND_INS, b.x, b.z, ...P);
}

// ---------- Rocks: displaced icosahedra, snow on up-facing faces ----------
export const ROCK_VARIANTS = 6, ROCK_MAX = 2500;
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
export function fillRocks(pagesInRange) {
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
export function apron(sd, base) {
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
export const deckRect = (arm, side = 1) => side > 0 ? [-(arm + 2.0), arm + 5.0, -7.5, 1.5] : [-(arm + 5.0), arm + 2.0, -7.5, 1.5];
export function chairTerminal(H = 5, arm = 3, foot = 3, side = 1) {
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
export const gondolaDeck = (arm) => [-(arm + 4.0), arm + 4.0, -20.0, 5.0];
export const GW = (arm) => arm + 3.6;                       // side walls
export const W = [1, 1, 1];
function barrel(w, l, z0, y0, rise, seg = 8) {
  // barrel vault across x, length l from z0 toward -z: shell plus dark underside
  const under = [], arc = [];
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
export function gondolaTerminal(H, arm, foot) {
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
// Elk Camp Gondola top: the terminal, the restaurant (elkCampRestaurant) and a maintenance building. Footprints in the terminal frame: [x0, x1, z0, z1].
const ELK_REST = (arm) => [-(GW(arm) + 22.0), -(GW(arm) + 6.0), -15.0, 9.0];
const ELK_REST_DECK = 5.0;                           // sun deck depth
const ELK_SHOP = (arm) => [GW(arm) + 6.0, GW(arm) + 17.0, -12.0, 3.0];
function elkCampTop(arm, lowShop) {
  const P = [], add = (g, c, tile = -1) => P.push(part(g, c, null, tile));
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
// Restaurant, hand-built after Jack's photo (references/buildings/elk-camp/elk_photo_crop.png): a grey stone base
// dug into the slope, a cedar-clad ground floor with big glass, a black upper floor with glass bands, a deep flat roof
// with a cedar soffit and a snow cap, and a sun deck with a black rail on the -z side. Floor at the terminal floor (0.5).
const ELK_REST_H = 7.6;                                        // floor to roof top
const ELK = { stone: [1.05, 1.05, 1.05], cedar: [1.12, 1.0, 0.92], black: [0.13, 0.13, 0.15], glass: [0.85, 0.95, 1.1], rail: [0.1, 0.1, 0.11] };
function elkCampRestaurant(arm, lowRest) {
  const [x0, x1, z0, z1] = ELK_REST(arm), dz0 = z0 - ELK_REST_DECK, P = [], add = (g, c, tile = -1) => P.push(part(g, c, null, tile));
  const xc = (x0 + x1) / 2, zc = (z0 + z1) / 2, w = x1 - x0 - 1.0, l = z1 - z0 - 0.6, f0 = 0.5, f1 = f0 + 3.4, f2 = f1 + 3.3;
  // stone base from the snow up to the floor, under the building and the deck
  add(BOX(x1 - x0, f0 - lowRest + 0.6, z1 - dz0, xc, lowRest - 0.6, (z1 + dz0) / 2), ELK.stone, TILES.stone);
  // ground floor: cedar walls, glass across the deck side and the side facing the terminal
  add(BOX(w, f1 - f0, l, xc, f0, zc), ELK.cedar, TILES.cedar);
  add(BOX(w - 2.0, 2.6, 0.12, xc, f0 + 0.3, z0 + 0.3 - 0.06), ELK.glass, TILES.window);
  add(BOX(0.12, 2.4, l - 6.0, x1 - 0.5 + 0.06, f0 + 0.5, zc - 2.0), ELK.glass, TILES.window);
  add(BOX(0.12, 2.4, l - 4.0, x0 + 0.5 - 0.06, f0 + 0.5, zc), ELK.glass, TILES.window);
  // a black band between the floors, then the black upper floor with glass bands, slightly over the ground floor
  add(BOX(w + 0.4, 0.45, l + 0.4, xc, f1 - 0.2, zc), ELK.black, TILES.darkPanel);
  add(BOX(w + 0.2, f2 - f1 - 0.25, l + 0.2, xc, f1 + 0.25, zc), ELK.black, TILES.darkPanel);
  add(BOX(w - 1.2, 2.2, 0.12, xc, f1 + 0.6, z0 + 0.2 - 0.06), ELK.glass, TILES.window);
  add(BOX(w - 1.2, 2.2, 0.12, xc, f1 + 0.6, z1 - 0.2 + 0.06), ELK.glass, TILES.window);
  for (const sx of [x0 + 0.4 - 0.06, x1 - 0.4 + 0.06]) add(BOX(0.12, 2.2, l - 3.0, sx, f1 + 0.6, zc), ELK.glass, TILES.window);
  // deep flat roof: cedar soffit, black fascia, snow on top; over the deck too
  const rw = x1 - x0 + 3.0, rl = z1 - dz0 + 1.5, rz = (z1 + dz0) / 2 - 0.5;
  add(BOX(rw, 0.12, rl, xc, f2, rz), ELK.cedar, TILES.cedar);
  add(BOX(rw, 0.45, rl, xc, f2 + 0.12, rz), ELK.black, TILES.darkPanel);
  add(BOX(rw - 0.3, 0.35, rl - 0.3, xc, f2 + 0.57, rz), W, TILES.roofSnow);
  // posts under the roof's deck corners
  for (const px of [x0 + 0.4, x1 - 0.4]) add(BOX(0.35, f2 - f0, 0.35, px, f0, dz0 + 0.4), ELK.black);
  // sun deck: boards and a black rail on its three open sides
  add(BOX(x1 - x0, 0.1, ELK_REST_DECK, xc, f0 - 0.05, z0 - ELK_REST_DECK / 2), W, TILES.deck);
  add(BOX(x1 - x0, 0.08, 0.08, xc, f0 + 1.05, dz0 + 0.1), ELK.rail);
  for (const rx of [x0 + 0.1, x1 - 0.1]) add(BOX(0.08, 0.08, ELK_REST_DECK, rx, f0 + 1.05, z0 - ELK_REST_DECK / 2), ELK.rail);
  for (let k = 0; k <= 8; k++) add(BOX(0.06, 1.05, 0.06, x0 + 0.1 + (x1 - x0 - 0.2) * k / 8, f0, dz0 + 0.1), ELK.rail);
  for (const rx of [x0 + 0.1, x1 - 0.1]) for (let k = 1; k <= 2; k++) add(BOX(0.06, 1.05, 0.06, rx, f0, dz0 + 0.1 + (ELK_REST_DECK - 0.1) * k / 3), ELK.rail);
  // the three après posters on the cedar wall that faces the terminal, beside the glass
  [TILES.posterA, TILES.posterB, TILES.posterC].forEach((t, k) => {
    const pg = new THREE.PlaneGeometry(1.0, 1.52).rotateY(Math.PI / 2).translate(x1 - 0.5 + 0.03, 2.1, z1 - 1.6 - k * 1.4);
    P.push(partUV(pg, W, t, 11 / 64, 53 / 64, 0, 1));
  });
  return P;
}
// Gondola tower: galvanized column with a ladder, crossarm with a railed walkway, sheave trains. Base y = 0, line along z.
export function gondolaTower(th, arm) {
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
export function gondolaStation(sd, arm, hh, base, m, elkTop) {
  apronGeos.push(apron(sd, base));
  STATIONS.push(sd);
  const toW = (u, v) => [sd.x + sd.c * u + sd.s * v, sd.z - sd.s * u + sd.c * v];
  const box = (u0, u1, v0, v1, y0, y1) => {
    const [x, z] = toW((u0 + u1) / 2, (v0 + v1) / 2);
    SOLIDS.push({ x, z, y: (y0 + y1) / 2, hx: (u1 - u0) / 2, hy: (y1 - y0) / 2, hz: (v1 - v0) / 2, c: sd.c, s: sd.s, what: 'gondola station' });
  };
  const wx = GW(arm), y = sd.y;
  box(-wx - 0.2, -wx + 0.2, -19.0, 4.5, y - 0.5, y + 5.5);
  box(wx - 0.2, wx + 0.2, -19.0, 4.5, y - 0.5, y + 5.5);
  box(-wx, wx, 4.3, 4.7, y - 0.5, y + 5.5);
  { const [x, z] = toW(0, 0); addObstacle({ x, z, y, r: 0.7, height: hh, what: 'gondola post' }); }
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
  liftParts.push(...placed(elkCampTop(arm, lowS), m));
  liftParts.push(...placed(elkCampRestaurant(arm, lowR), m));
  box(R[0], R[1], R[2], R[3], base + lowR - 0.5, y + 0.5 + ELK_REST_H);
  box(R[0], R[1], R[2] - ELK_REST_DECK, R[2], base + lowR - 0.5, y + 1.55);
  box(S[0], S[1], S[2], S[3], base + lowS - 0.5, y + 5.0);
  cut(R[0] - 2.5, R[1] + 2.5, R[2] - ELK_REST_DECK - 1.5, R[3] + 1.5, 4);
  cut(S[0], S[1], S[2], S[3], 4);
  for (const [u, v, w] of [[(R[0] + R[1]) / 2, R[2] + 4, 9], [(R[0] + R[1]) / 2, R[3] - 6, 9], [(S[0] + S[1]) / 2, (S[2] + S[3]) / 2, 6]]) {
    const [x, z] = toW(u, v); casters.push({ x, z, h: 6, w });
  }
}
export const liftParts = [], cablePts = [], casters = [], lampList = [], apronGeos = [];

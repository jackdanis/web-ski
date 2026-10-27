// Low-poly kit models, detail rings, rocks, chairlift and gondola terminals, the Elk Camp restaurant.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { ELK_REST_MODEL } from '../assets/models/elk_rest.js';
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
// Elk Camp restaurant model (TRELLIS v1): station shader, albedo from the model's texture
const elkT = await loadTex('models/elk_rest');
elkT.flipY = false;
const elkMat = new THREE.ShaderMaterial({
  vertexColors: true,
  uniforms: Object.assign({ uElk: { value: elkT } }, modelMat.uniforms),
  vertexShader: modelMat.vertexShader.replace('varying vec3 vT;', 'varying vec3 vT; varying vec2 vUv;').replace('vT = aT;', 'vT = aT; vUv = uv;'),
  fragmentShader: modelMat.fragmentShader.replace('uniform sampler2D uAtlas, uAtlasN;', 'uniform sampler2D uAtlas, uAtlasN, uElk; varying vec2 vUv;')
    .replace('vec3 alb = vC;', 'vec3 alb = vC * texture2D(uElk, vUv).rgb;'),
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

// Trail-map stand (pin 20): a large wooden board on two log posts, a big log across the top. The map on its face
// comes later; the face is a plain light board for now.
const LOG = [1.15, 1.0, 0.9], BOARD = [0.92, 0.9, 0.84];
export function addMapStand(b) {
  const { x, z, yaw, w, l, bot, ground } = b, { W, m } = frameOf(b), M = m(bot), dy = ground - bot;
  const bw = Math.min(W, 12), bh = 3.4, by = dy + 1.1;
  const P = [part(BOX(bw, bh, 0.3, 0, by, 0), WALL, M, TILES.cedar), part(BOX(bw - 0.5, bh - 0.5, 0.06, 0, by + 0.25, 0.17), BOARD, M)];
  for (const s of [-1, 1]) P.push(part(new THREE.CylinderGeometry(0.28, 0.32, by + bh + 0.6, 8).translate(s * (bw / 2 + 0.2), (by + bh + 0.6) / 2, 0), LOG, M, TILES.cedar));
  P.push(part(new THREE.CylinderGeometry(0.42, 0.42, bw + 2.2, 10).applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2)).translate(0, by + bh + 0.55, 0), LOG, M, TILES.cedar));
  P.push(part(BOX(bw + 1.6, 0.14, 0.7, 0, by + bh + 0.98, 0), SNOWCAP, M));
  bucket(STAND_INS, x, z, ...P);
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
// Restaurant: the TRELLIS v1 model stretched over its footprint and deck. Model deck (y 0.02) at the terminal floor (0.5),
// deck side toward -z; a stone footing fills down to the snow where the slope drops below the model.
const ELK_REST_H = 10.0;
function elkCampRestaurant(arm, lowRest) {
  const [x0, x1, z0, z1] = ELK_REST(arm), dz0 = z0 - ELK_REST_DECK;
  const b64 = (t) => Uint8Array.from(atob(t), (ch) => ch.charCodeAt(0)).buffer;
  const M = ELK_REST_MODEL, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b64(M.pos)), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b64(M.uv)), 2));
  g.setIndex(new THREE.BufferAttribute(M.i32 ? new Uint32Array(b64(M.idx)) : new Uint16Array(b64(M.idx)), 1));
  const ys = ELK_REST_H / 0.7525, cy = 0.5 - 0.02 * ys, bottom = cy - 0.3775 * ys;
  g.rotateY(Math.PI).scale(x1 - x0, ys, (z1 - dz0) / 0.881).translate((x0 + x1) / 2, cy, (z1 + dz0) / 2);
  const footing = [];
  if (lowRest < bottom) footing.push(part(new THREE.BoxGeometry(x1 - x0 - 1.0, bottom - lowRest + 0.6, z1 - dz0 - 1.0)
    .translate((x0 + x1) / 2, (bottom + lowRest - 0.4) / 2 + 0.1, (z1 + dz0) / 2), W, null, TILES.stone));
  // the three après posters, on the model's wall that faces the terminal (1.7 m in from the footprint edge)
  [TILES.posterA, TILES.posterB, TILES.posterC].forEach((t, k) => {
    const pg = new THREE.PlaneGeometry(1.0, 1.52).rotateY(Math.PI / 2).translate(x1 - 1.65, 2.4, (z0 + z1) / 2 - 2.4 + k * 2.4);
    footing.push(partUV(pg, W, t, 11 / 64, 53 / 64, 0, 1));
  });
  return { model: part(g, W), footing };
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
  const rest = elkCampRestaurant(arm, lowR);
  liftParts.push(...placed(rest.footing, m));
  // the model within 250 m, a charcoal box with a snowy roof to 800 m (collision is the boxes above)
  {
    const [u, v] = [(R[0] + R[1]) / 2, (R[2] - ELK_REST_DECK + R[3]) / 2], [x, z] = toW(u, v);
    addBuilding({ x, z, yaw: Math.atan2(sd.s, sd.c), w: R[1] - R[0], l: R[3] - R[2] + ELK_REST_DECK, bot: base + lowR, top: y + 5.8,
      color: DARK, roof: SNOWCAP, near: () => new THREE.Mesh(placed([rest.model], m)[0], elkMat), solid: false });
  }
  box(R[0], R[1], R[2], R[3], base + lowR - 0.5, y + 5.6);
  box(R[0], R[1], R[2] - ELK_REST_DECK, R[2], base + lowR - 0.5, y + 1.55);
  box(S[0], S[1], S[2], S[3], base + lowS - 0.5, y + 5.0);
  cut(R[0] - 2.5, R[1] + 2.5, R[2] - ELK_REST_DECK - 1.5, R[3] + 1.5, 4);
  cut(S[0], S[1], S[2], S[3], 4);
  for (const [u, v, w] of [[(R[0] + R[1]) / 2, R[2] + 4, 9], [(R[0] + R[1]) / 2, R[3] - 6, 9], [(S[0] + S[1]) / 2, (S[2] + S[3]) / 2, 6]]) {
    const [x, z] = toW(u, v); casters.push({ x, z, h: 6, w });
  }
}
export const liftParts = [], cablePts = [], casters = [], lampList = [], apronGeos = [];

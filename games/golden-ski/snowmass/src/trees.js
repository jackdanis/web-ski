// Trees, tree clumps and props, paged in around the camera.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { CLUMP, FILL_NEAR, TREE_FAR, TREE_NEAR, clamp, hash2 } from './config.js';
import { CELL, EDGE_TREES, H, LIFT_CUT, NX, NZ, PAGE, RUNF, X0, Z0, addObstacle, aspen, conifer, groundY, isRock, patchEdge } from './world.js';
import { LIGHT, LIGHT_GLSL, SH_SIZE, TREE_KINDS, camera, queueWork, scene, stormImgs, treeImgs, workKey } from './scene.js';
import { ROCK_VARIANTS, fillRocks } from './buildings.js';

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
export const atlas = (() => {
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
export const KIND = { spruce: 0, fir: 1, aspen: 2, snowghost: 3, pole: 4, sign: 5 };
export const TREE_R = [0.11, 0.11, 0.07, 0.3, 0, 0];      // trunk radius as a share of height
export const pages = new Map();
export function makePage(pi, pj) {
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
          const rk = { x, z, y: groundY(x, z) - s * 0.35, s, rot: r * 40, v: Math.floor(hash2(i + 9, j + 9) * ROCK_VARIANTS), r: s * 0.75, height: s * 1.2, what: 'rock' };
          rocks.push(rk);
          addObstacle(rk);
        }
      }
      const c = conifer(k), a = aspen(k);
      if (c + a < 0.05) continue;
      if (state.RUN_AREA && state.RUN_AREA[k] < EDGE_TREES * 2) continue;   // edge trees stand here instead
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
  if (state.shAt && Math.max(Math.abs(px + P / 2 - state.shAt.x), Math.abs(pz + P / 2 - state.shAt.z)) < SH_SIZE / 2 + P / 2 + 60) state.shDirty = true;
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
export const treeGeo = treeLayer(0), clumpGeo = treeLayer(1), fillGeo = treeLayer(0);
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
export const treeMat = new THREE.ShaderMaterial(Object.assign({
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
export function updateTrees(force) {
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
      if (!pg && state.workAll) pg = makePage(a, b);
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
const PROPS = new Map();                       // tree page -> props, merged into that page's trees
export function addProp(t) {
  const P = PAGE * CELL, key = Math.floor((t.x - X0) / P) * 1000 + Math.floor((t.z - Z0) / P);
  if (!PROPS.has(key)) PROPS.set(key, []);
  PROPS.get(key).push(t);
}

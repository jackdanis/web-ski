// Renderer, camera, Snowlight, textures, sky, the terrain mesh, the work queue and the far peaks.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { CHUNK, LOD_DIST, LOD_STEPS, SUPER, TREE_FAR, clamp } from './config.js';
import { CELL, FAR, FH, H, NX, NZ, X0, X1, Z0, Z1, aspen, conifer, gridH, isRock, runDist } from './world.js';

// ---------- Scene ----------
const stage = document.getElementById('stage');
export const fadeEl = document.getElementById('fade');

// no antialiasing: hard pixel edges for the 320x180 look
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 45000);

// Snowlight: shaders light raw colors and write them straight to the screen.
export const SUN_DIR = new THREE.Vector3(-0.8, 0.75, 0.25).normalize();
export const SUN_COLOR = new THREE.Vector3(1.0, 0.98, 0.92);
export const SKY_COLOR = new THREE.Vector3(0.42, 0.55, 0.85);
export const SNOW_ALBEDO = new THREE.Vector3(0.95, 0.97, 1.0);
export const FOG = new THREE.Vector3(217 / 255, 228 / 255, 238 / 255);
export const BOUNCE = SUN_COLOR.clone().multiplyScalar(Math.max(0, SUN_DIR.y)).addScaledVector(SKY_COLOR, 0.6).multiply(SNOW_ALBEDO);
// fog is [near, far] in meters
export const TIMES = {
  noon:   { name: 'Noon', sun: [-0.8, 0.75, 0.25], sunC: [1.0, 0.98, 0.92], sky: [0.42, 0.55, 0.85], snow: [0.95, 0.97, 1.0], fogC: [217, 228, 238], fog: [1500, 70000], lamp: [0, 0, 0] },
  golden: { name: 'Golden hour', sun: [0.85, 0.3, -0.45], sunC: [1.25, 0.72, 0.38], sky: [0.36, 0.34, 0.6], snow: [1.0, 0.9, 0.84], fogC: [228, 179, 163], fog: [1300, 60000], lamp: [0, 0, 0] },
  night:  { name: 'Night', sun: [-0.5, 0.6, 0.6], sunC: [0.3, 0.36, 0.55], sky: [0.1, 0.13, 0.26], snow: [0.9, 0.93, 1.0], fogC: [28, 34, 47], fog: [600, 20000], lamp: [1.7, 1.15, 0.6] },
  storm:  { name: 'Storm', sun: [-0.1, 1.0, 0.25], sunC: [0.32, 0.33, 0.36], sky: [0.66, 0.69, 0.75], snow: [0.93, 0.95, 0.98], fogC: [176, 184, 194], fog: [40, 900], lamp: [0, 0, 0] },
};
// Shadows are painted top down on a canvas SH_SIZE meters across that follows the camera.
export const SH_PX = 1024, SH_SIZE = 768;
export const LIGHT = {
  uSun: { value: SUN_DIR }, uSunC: { value: SUN_COLOR }, uSky: { value: SKY_COLOR }, uSnow: { value: SNOW_ALBEDO },
  uBounce: { value: BOUNCE }, uFog: { value: FOG }, uFogNear: { value: 1500 }, uFogFar: { value: 70000 }, uTreeFar: { value: TREE_FAR },
  uShadow: { value: null }, uShO: { value: new THREE.Vector2() }, uLamps: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1e5, 0)) },
  uLampC: { value: new THREE.Vector3() },
};
export const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uSun, uSunC, uSky, uSnow, uBounce, uFog, uLampC;
  uniform float uFogNear, uFogFar, uTreeFar;
  uniform sampler2D uShadow; uniform vec2 uShO; uniform vec3 uLamps[4];
  float band(float v) { return max(0.12, floor(v * 4.0 + 0.5) / 4.0); }
  float band0(float v) { return floor(v * 4.0 + 0.5) / 4.0; }
  float hash(vec2 p) { return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453); }
  // 1 where the shadow canvas blocks the sun
  float shade(vec3 p) {
    vec2 uv = (p.xz - uShO) / ${SH_SIZE}.0;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
    return texture2D(uShadow, vec2(uv.x, 1.0 - uv.y)).r;
  }
  // LAMPS is defined only at night (applyTime), so daytime shaders skip the loop
  vec3 lamps(vec3 p, vec3 n) {
    vec3 l = vec3(0.0);
  #ifdef LAMPS
    for (int i = 0; i < 4; i++) { vec3 v = uLamps[i] - p; float d = length(v); l += uLampC * band0(max(0.0, dot(n, v / d)) / (1.0 + d * d / 160.0)); }
  #endif
    return l;
  }
  vec3 finish(vec3 alb, vec3 l, float dist, float cap) {
    float m = max(max(l.r, l.g), max(l.b, 0.001));
    l = l / m * band(min(cap, m));
    // distance haze
    float f = smoothstep(uFogNear, uFogFar, dist);
    return mix(min(alb * l * 1.1, 1.0), uFog, sqrt(f) * 0.92);
  }`;

const loader = new THREE.TextureLoader();
const asset = (name) => new URL(`../assets/${name}.png`, import.meta.url).href;
export async function loadTex(name, { pixel = true, repeat = false, mips = false } = {}) {
  const t = await loader.loadAsync(asset(name));
  t.magFilter = pixel ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : t.magFilter;
  t.generateMipmaps = mips;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export const [cordT, cordN, powT, powN, skyT, goldieT, goldieN, ...skyRest] = await Promise.all([
  loadTex('textures/corduroy', { repeat: true, mips: true }), loadTex('textures/corduroy_n', { repeat: true, mips: true }),
  loadTex('textures/powder', { repeat: true, mips: true }), loadTex('textures/powder_n', { repeat: true, mips: true }),
  loadTex('sky/noon', { pixel: false }), loadTex('sprites/goldie_body'), loadTex('sprites/goldie_body_n'),
  loadTex('sky/golden', { pixel: false }), loadTex('sky/night', { pixel: false }), loadTex('sky/storm', { pixel: false }),
]);
// Goldie's sheet is read top-down by the rects in its JSON
goldieT.flipY = goldieN.flipY = false;
export const GOLDIE = await (await fetch(new URL('../assets/sprites/goldie_body.json', import.meta.url))).json();
export const SKIES = { noon: skyT, golden: skyRest[0], night: skyRest[1], storm: skyRest[2] };
export const [stationT, stationN] = await Promise.all([loadTex('textures/station_atlas'), loadTex('textures/station_atlas_n')]);
export const TREE_KINDS = ['spruce', 'fir', 'aspen', 'snowghost', 'pole', 'sign'];
const loadImg = (n) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = asset(n); });
export const treeImgs = await Promise.all(TREE_KINDS.flatMap((k) => [k, k + '_n']).map((n) => loadImg(`sprites/${n}`)));
// storm: the snow-plastered spruce replaces the spruce
export const stormImgs = await Promise.all(['sprites/storm_spruce', 'sprites/storm_spruce_n'].map(loadImg));

// Sky strip on an open cylinder that rides with the camera, drawn behind everything.
export const sky = (() => {
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
  // below the strip, the haze color
  scene.background = new THREE.Color().setRGB(FOG.x, FOG.y, FOG.z, THREE.SRGBColorSpace);
  return m;
})();

// ---------- Terrain: flat shaded, lit by Snowlight ----------
// aCov per vertex: groomed edge distance, rock, conifer and aspen density (far tint).
export const terrainMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uCord: { value: cordT }, uCordN: { value: cordN }, uPow: { value: powT }, uPowN: { value: powN },
    uRock: { value: new THREE.Vector3(0.5, 0.48, 0.45) }, uForest: { value: new THREE.Vector3(0.15, 0.26, 0.21) },
    uAspen: { value: new THREE.Vector3(0.46, 0.44, 0.4) },
    // the 10 m ground is cut away under the 2 m run mesh
    uPMask: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, uPMin: { value: new THREE.Vector2() }, uPSize: { value: new THREE.Vector2(1, 1) },
    uPOn: { value: 0 }, uPFar: { value: 0 } }, LIGHT),
  vertexShader: /* glsl */ `
    attribute vec4 aCov;
    attribute vec3 aN;
    varying vec3 vP; varying vec4 vCov; varying float vD; varying vec3 vN;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vP = w.xyz; vCov = aCov; vN = aN;
      vec4 mv = viewMatrix * w;
      // skirts sit just behind the ground so the ground wins depth ties and no seams show
      if (dot(aN, aN) > 0.0) mv.xyz *= 1.003;
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uCord, uCordN, uPow, uPowN;
    uniform vec3 uRock, uForest, uAspen;
    uniform sampler2D uPMask; uniform vec2 uPMin, uPSize; uniform float uPOn, uPFar;
    varying vec3 vP; varying vec4 vCov; varying float vD; varying vec3 vN;
    void main() {
#ifndef PATCH
      if (uPOn > 0.5 && distance(vP.xz, cameraPosition.xz) < uPFar) {
        vec2 pm = (vP.xz - uPMin) / uPSize;
        if (pm.x > 0.0 && pm.y > 0.0 && pm.x < 1.0 && pm.y < 1.0 && texture2D(uPMask, pm).r > 0.5) discard;
      }
#else
      if (distance(vP.xz, cameraPosition.xz) > uPFar) discard;
#endif
      vec3 fn = normalize(cross(dFdx(vP), dFdy(vP)));
      if (dot(vN, vN) > 1e-8) fn = normalize(vN);            // skirt: lit like the ground above it
      vec2 uv = vec2(vP.x, -vP.z) / 8.0;
      float dith = (hash(vP.xz * 0.5) - 0.5) * 0.6;          // ragged 2 m blocks at groomed / powder / rock edges
#ifdef PATCH
      dith *= 0.3;                                           // crisper edge on the 2 m runs
#endif
      float edge = vCov.x + dith * 2.5;                      // m from the groomed edge
      bool groomed = edge < 0.0;
      vec3 alb = (groomed ? texture2D(uCord, uv).rgb : texture2D(uPow, uv).rgb) * uSnow;
      vec3 tn = (groomed ? texture2D(uCordN, uv).rgb : texture2D(uPowN, uv).rgb) * 2.0 - 1.0;
      float near = 1.0 - smoothstep(60.0, 300.0, vD);        // texture lighting fades with distance...
      vec3 n = normalize(fn + vec3(tn.x, 0.0, -tn.y) * (groomed ? 0.12 : 0.18) * near);
      alb = mix(uSnow, alb, 0.45 * near);                    // ...and so does the pattern
      // windrow just off the groomed edge, then a thin shadow line
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

// 320 m chunks near the camera, merged 4 x 4 far away, each LOD built on demand. Skirts hide cracks between LODs.
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
      // skirt normals match the ground beside them
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
  // skirt: copy the edge loop and drop a second copy below it
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
    idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings
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
const piece = (i0, j0, i1, j1) => ({ i0, j0, i1: Math.min(i1, NX - 1), j1: Math.min(j1, NZ - 1), meshes: [], level: -1 });
for (let sj = 0; sj < NCZ; sj += SUPER) {
  for (let si = 0; si < NCX; si += SUPER) {
    const sup = piece(si * CHUNK, sj * CHUNK, (si + SUPER) * CHUNK, (sj + SUPER) * CHUNK);
    sup.kids = [];
    for (let cj = sj; cj < Math.min(sj + SUPER, NCZ); cj++) {
      for (let ci = si; ci < Math.min(si + SUPER, NCX); ci++) sup.kids.push(piece(ci * CHUNK, cj * CHUNK, (ci + 1) * CHUNK, (cj + 1) * CHUNK));
    }
    chunks.push(sup);
  }
}
// ---------- Work queue ----------
// Heavy builds (terrain sizes, run meshes, tree pages) wait here and run nearest first, WORK_MS a frame, so arriving
// somewhere new is spread over frames. Whatever is showing stays until its replacement is built.
export const WORK_MS = 3, work = new Map();
export function queueWork(key, d, run) {
  const w = work.get(key);
  if (w) w.d = d; else work.set(key, { d, run });
}
// one queue key per (object, level)
export const workKey = (o, level) => ((o.workKeys ||= [])[level] ||= {});
export function runWork() {
  const t0 = performance.now();
  while (work.size && (state.workAll || performance.now() - t0 < WORK_MS)) {
    let bk, bw;
    for (const [k, w] of work) if (!bw || w.d < bw.d) { bk = k; bw = w; }
    work.delete(bk);
    bw.run();
  }
}
const pieceDist = (p, cx, cz) => Math.hypot(Math.max(0, X0 + p.i0 * CELL - cx, cx - X0 - p.i1 * CELL), Math.max(0, Z0 + p.j0 * CELL - cz, cz - Z0 - p.j1 * CELL));
function showPiece(p, level) {
  if (level === p.level) return;
  if (level >= 0 && !p.meshes[level]) p.meshes[level] = buildChunk(p, level);
  p.meshes.forEach((m, l) => { if (m) m.visible = l === level; });
  // free the finest LOD once the piece is well away
  if (level !== 0 && level !== 1 && p.meshes[0]) { scene.remove(p.meshes[0]); p.meshes[0].geometry.dispose(); p.meshes[0] = null; }
  p.level = level;
}
// true once a piece's mesh at this level exists; otherwise queue it (or, with nothing of the area showing, build it now)
function terrainReady(p, level, d, now) {
  if (level < 0 || p.meshes[level]) return true;
  if (now || state.workAll) { p.meshes[level] = buildChunk(p, level); return true; }
  queueWork(workKey(p, level), d, () => { if (!p.meshes[level]) { p.meshes[level] = buildChunk(p, level); p.meshes[level].visible = false; } });
  return false;
}
export function updateTerrain() {
  const cx = camera.position.x, cz = camera.position.z;
  for (const sup of chunks) {
    const d = pieceDist(sup, cx, cz), kidsShown = sup.kids.some((k) => k.level >= 0);
    if (d >= LOD_DIST[1]) {
      const level = d < LOD_DIST[2] ? 2 : d < LOD_DIST[3] ? 3 : 4;
      if (!terrainReady(sup, level, d, sup.level < 0 && !kidsShown)) continue;
      showPiece(sup, level);
      for (const k of sup.kids) showPiece(k, -1);
    } else {
      const dk = sup.kids.map((k) => pieceDist(k, cx, cz)), lv = dk.map((v) => v < LOD_DIST[0] ? 0 : v < LOD_DIST[1] ? 1 : 2);
      const ok = sup.kids.map((k, n) => terrainReady(k, lv[n], dk[n], sup.level < 0 && k.level < 0));
      // the far piece stays until every kid can replace it
      if (!kidsShown && sup.level >= 0 && !ok.every(Boolean)) continue;
      showPiece(sup, -1);
      sup.kids.forEach((k, n) => { if (ok[n]) showPiece(k, lv[n]); });
    }
  }
}

// Surrounding peaks to ~25 km from the 100 m data, with a hole under the 10 m mountain: 200 m triangles within 3 km,
// 400 m to 8 km, 800 m past that. 1.6 km blocks, skirts where sizes differ, one draw.
{
  const S = 2, nx = Math.floor((FAR.nx - 1) / S) + 1, nz = Math.floor((FAR.nz - 1) / S) + 1, cell = FAR.cell * S, B = 8;
  const inner = (x, z, m) => x > X0 + m && x < X1 - m && z > Z0 + m && z < Z1 - m;
  const hk = (a, b) => FH[clamp(b * S, 0, FAR.nz - 1) * FAR.nx + clamp(a * S, 0, FAR.nx - 1)];
  const pos = [], cov = [], nrm = [], idx = [];
  const put = (i, j, drop, skirt) => {
    const x = FAR.x0 + i * cell, z = FAR.z0 + j * cell, h = hk(i, j);
    const gx = (hk(i + 1, j) - hk(i - 1, j)) / (2 * cell), gz = (hk(i, j + 1) - hk(i, j - 1)) / (2 * cell), slope = Math.hypot(gx, gz);
    // tucked under the 10 m mountain where they overlap
    const out = Math.hypot(Math.max(X0 - x, 0, x - X1), Math.max(Z0 - z, 0, z - Z1));
    pos.push(x, h - 14 * clamp(1 - out / 800, 0, 1) - drop, z);
    cov.push(60, slope > 0.85 ? 1 : 0, h < 3300 && slope < 0.8 ? 0.75 : h < 3500 ? 0.3 : 0, 0);
    if (skirt) nrm.push(-gx, 1, -gz); else nrm.push(0, 0, 0);
    return pos.length / 3 - 1;
  };
  const stepOf = (bi, bj) => {
    if (bi < 0 || bj < 0 || bi >= nx - 1 || bj >= nz - 1) return 0;
    const i1 = Math.min(bi + B, nx - 1), j1 = Math.min(bj + B, nz - 1);
    const out = Math.hypot(Math.max(X0 - FAR.x0 - i1 * cell, 0, FAR.x0 + bi * cell - X1), Math.max(Z0 - FAR.z0 - j1 * cell, 0, FAR.z0 + bj * cell - Z1));
    return out < 3000 ? 1 : out < 8000 ? 2 : 4;
  };
  for (let bj = 0; bj < nz - 1; bj += B) {
    for (let bi = 0; bi < nx - 1; bi += B) {
      const i1 = Math.min(bi + B, nx - 1), j1 = Math.min(bj + B, nz - 1), step = stepOf(bi, bj);
      const is = [], js = [];
      for (let i = bi; i < i1; i += step) is.push(i);
      is.push(i1);
      for (let j = bj; j < j1; j += step) js.push(j);
      js.push(j1);
      const w = is.length, v0 = pos.length / 3;
      for (const j of js) for (const i of is) put(i, j, 0);
      for (let b = 0; b < js.length - 1; b++) {
        for (let a = 0; a < w - 1; a++) {
          if (inner(FAR.x0 + (is[a] + is[a + 1]) / 2 * cell, FAR.z0 + (js[b] + js[b + 1]) / 2 * cell, 260)) continue;
          const v = v0 + b * w + a;
          idx.push(v, v + w, v + 1, v + 1, v + w, v + w + 1);
        }
      }
      // skirt only where the neighbor block is another size
      const drop = step * cell * 0.6 + 20;
      const skirt = (pts) => {
        const top = pts.map(([i, j]) => put(i, j, 0, true)), bot = pts.map(([i, j]) => put(i, j, drop, true));
        for (let q = 0; q < pts.length - 1; q++) {
          const a = top[q], b = top[q + 1], a2 = bot[q], b2 = bot[q + 1];
          idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
        }
      };
      const other = (n) => n > 0 && n !== step;
      if (other(stepOf(bi, bj - B))) skirt(is.map((i) => [i, bj]));
      if (other(stepOf(bi, bj + B))) skirt(is.map((i) => [i, j1]));
      if (other(stepOf(bi - B, bj))) skirt(js.map((j) => [bi, j]));
      if (other(stepOf(bi + B, bj))) skirt(js.map((j) => [i1, j]));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(new Float32Array(cov), 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, terrainMat);
  m.frustumCulled = false;
  scene.add(m);
}
export const canvas = renderer.domElement;

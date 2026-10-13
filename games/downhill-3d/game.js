// Downhill 3D: a third-person endless downhill run built on Three.js.
// World units are meters. +y is up and the skier travels toward -z (downhill).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- Tuning ----------
const STEP = 1 / 120;          // fixed physics step
const G = 18;                  // gravity (a bit floaty on purpose)
const SLOPE = 0.32;            // base fall line, rise over run
const DRAG = 0.0068;           // quadratic air/snow drag
const FRICTION = 0.4;          // constant snow friction
const CARVE_BRAKE = 0.32;      // speed lost to hard carving
const TUCK_DRAG = 0.55;        // drag multiplier while tucked
const MAX_SPEED = 42;
const TURN_RATE = 1.9;         // rad/s heading change at full steer
const MAX_HEADING = 1.25;      // how far across the hill you can point
const HOP = 6.5;               // hop impulse
const SPIN_RATE = 8.5;         // rad/s at full input
const FLIP_RATE = 6.8;
const ROT_RESP = 9;            // how fast spin/flip velocity follows input
const ROT_ASSIST = 2.2;        // rad/s nudge toward upright when not rotating
const PERFECT = 0.2;           // landing error tolerances (radians)
const CLEAN = 0.45;
const SLOPPY = 0.8;            // anything worse is a wipeout
const CHUNK = 60;              // chunk length along z
const AHEAD = 4;               // chunks kept ahead of the skier
const CORRIDOR = 32;           // half width of the open run
const SKIER_R = 0.35;

const COLORS = {
  sky: 0xcfe3f3,
  snow: 0xf7fbff,
  snowShade: 0xd2e1ef,
  trunk: 0x6b4a33,
  pine: 0x2f6b4a,
  pineDark: 0x24563b,
  rock: 0x7d8893,
  rampTop: 0xeef6ff,
  rampSide: 0x9cc0de,
  lip: 0xf28c28,
  jacket: 0xd4232b,
  pants: 0x23313f,
  helmet: 0x1e63d6,
  skis: 0x111111,
  gateA: 0xd4232b,
  gateB: 0x1e63d6,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ui = {
  score: $('score'), mult: $('mult'), dist: $('dist'), speed: $('speed'),
  popups: $('popups'), overlay: $('overlay'), title: $('title'), subtitle: $('subtitle'),
  result: $('result'), final: $('final'), best: $('best'), go: $('go'),
  helpKeys: $('help-keys'), helpTouch: $('help-touch'),
};
const touchFirst = matchMedia('(pointer: coarse)').matches;
ui.helpKeys.hidden = touchFirst;
ui.helpTouch.hidden = !touchFirst;
$('loading').remove();

let best = 0;
try { best = Number(localStorage.getItem('downhill3d-best')) || 0; } catch (e) { /* storage blocked */ }

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.sky, 50, 175);

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

const hemi = new THREE.HemisphereLight(0xe4f0fc, 0x7891aa, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Terrain ----------
const ramps = [];

function bump(x, z) {
  const side = Math.max(0, Math.abs(x) - CORRIDOR + 4);
  return 0.7 * Math.sin(x * 0.11 + z * 0.043) * Math.sin(z * 0.071)
    + 0.35 * Math.sin(x * 0.27 - z * 0.13)
    + side * side * 0.025;
}
function baseHeight(x, z) { return z * SLOPE + bump(x, z); }
function rampHeight(x, z) {
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    if (z <= r.z && z >= r.z - r.l && Math.abs(x - r.x) <= r.w / 2) {
      const t = (r.z - z) / r.l;
      return r.h * t * t;
    }
  }
  return 0;
}
function height(x, z) { return baseHeight(x, z) + rampHeight(x, z); }

const snowMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const tmpColor = new THREE.Color();
const snowA = new THREE.Color(COLORS.snow);
const snowB = new THREE.Color(COLORS.snowShade);

function terrainMesh(z0, z1) {
  const xs = 160, dx = 4, dz = 3;
  const cols = xs / dx + 1, rows = Math.round((z0 - z1) / dz) + 1;
  const pos = new Float32Array(cols * rows * 3);
  const col = new Float32Array(cols * rows * 3);
  let p = 0;
  for (let j = 0; j < rows; j++) {
    const z = z0 - j * dz;
    for (let i = 0; i < cols; i++) {
      const x = -xs / 2 + i * dx;
      const y = baseHeight(x, z);
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
      const n = 0.5 + 0.5 * Math.sin(x * 0.37 + z * 0.21) * Math.sin(z * 0.17 - x * 0.05);
      tmpColor.copy(snowA).lerp(snowB, n * 0.85 + Math.min(1, Math.max(0, Math.abs(x) - CORRIDOR) / 20) * 0.4);
      col[p] = tmpColor.r; col[p + 1] = tmpColor.g; col[p + 2] = tmpColor.b;
      p += 3;
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, snowMat);
  m.receiveShadow = true;
  return m;
}

// ---------- Props ----------
const geo = {
  trunk: new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6).translate(0, 0.7, 0),
  pine: (() => {
    const a = new THREE.ConeGeometry(1.6, 3.2, 7).translate(0, 2.6, 0);
    const b = new THREE.ConeGeometry(1.15, 2.6, 7).translate(0, 4.2, 0);
    return mergeGeometries([a, b]);
  })(),
  rock: new THREE.DodecahedronGeometry(1, 0),
  pole: new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5).translate(0, 1.1, 0),
  flag: (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 2.15, 0, 0, 1.45, 0, 0.9, 1.8, 0], 3));
    g.computeVertexNormals();
    return g;
  })(),
};
const mat = {
  trunk: new THREE.MeshLambertMaterial({ color: COLORS.trunk }),
  pine: new THREE.MeshLambertMaterial({ color: COLORS.pine, flatShading: true }),
  rock: new THREE.MeshLambertMaterial({ color: COLORS.rock, flatShading: true }),
  ramp: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  gateA: new THREE.MeshLambertMaterial({ color: COLORS.gateA, side: THREE.DoubleSide }),
  gateB: new THREE.MeshLambertMaterial({ color: COLORS.gateB, side: THREE.DoubleSide }),
};

// Small local merge so we don't need the addons bundle.
function mergeGeometries(list) {
  const parts = list.map((g) => g.index ? g.toNonIndexed() : g);
  let n = 0;
  parts.forEach((g) => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3);
  let o = 0;
  parts.forEach((g) => { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}

const dummy = new THREE.Object3D();
function instanced(geometry, material, items, place) {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  m.count = items.length;
  items.forEach((it, i) => { place(it, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  return m;
}

function rampMesh(r) {
  const pos = [], col = [];
  const top = new THREE.Color(COLORS.rampTop), side = new THREE.Color(COLORS.rampSide), lip = new THREE.Color(COLORS.lip);
  const quad = (a, b, c, d, color) => {
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  const segs = 10, xl = r.x - r.w / 2, xr = r.x + r.w / 2;
  const P = (x, z, up) => [x, up ? height(x, z) + 0.03 : baseHeight(x, z) - 0.3, z];
  for (let s = 0; s < segs; s++) {
    const za = r.z - (s / segs) * r.l, zb = r.z - ((s + 1) / segs) * r.l;
    const c = s === segs - 1 ? lip : top;
    quad(P(xl, za, true), P(xl, zb, true), P(xr, zb, true), P(xr, za, true), c);
    quad(P(xl, za, false), P(xl, zb, false), P(xl, zb, true), P(xl, za, true), side);
    quad(P(xr, za, true), P(xr, zb, true), P(xr, zb, false), P(xr, za, false), side);
  }
  const zl = r.z - r.l + 0.001;
  quad(P(xl, zl, true), P(xl, zl, false), P(xr, zl, false), P(xr, zl, true), side);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.ramp);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------- Chunks ----------
const chunks = new Map();
let rng = Math.random;

function nearRamp(x, z, pad) {
  for (const r of ramps) {
    if (Math.abs(x - r.x) < r.w / 2 + pad && z < r.z + 25 && z > r.z - r.l - 70) return true;
  }
  return false;
}

function buildChunk(k) {
  const z0 = -k * CHUNK, z1 = z0 - CHUNK;
  const d = Math.min(1, k / 40);
  const group = new THREE.Group();
  const obstacles = [], gates = [], myRamps = [];
  const safe = k === 0 ? z0 - 85 : z0;

  if (k > 0 && rng() < 0.75) {
    const r = { x: (rng() * 2 - 1) * (CORRIDOR - 10), z: z0 - 8 - rng() * 30, w: 7, l: 8 + rng() * 2, h: 2.3 + rng() * 0.9 };
    ramps.push(r);
    myRamps.push(r);
    group.add(rampMesh(r));
  }

  const occupied = [];
  const free = (x, z, gap) => occupied.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (gap + o.r) ** 2);

  // Open run: scattered trees and rocks.
  const trees = [], rocks = [];
  const nTrees = Math.round(8 + 18 * d), nRocks = Math.round(3 + 7 * d);
  for (let i = 0, tries = 0; i < nTrees && tries < 200; tries++) {
    const x = (rng() * 2 - 1) * CORRIDOR, z = z1 + rng() * (safe - z1);
    if (z > safe || nearRamp(x, z, 3) || !free(x, z, 2.5)) continue;
    const s = 0.8 + rng() * 0.6;
    trees.push({ x, z, s, rot: rng() * 6 });
    occupied.push({ x, z, r: 1 });
    obstacles.push({ x, z, r: 0.75 * s, h: 5.6 * s });
    i++;
  }
  for (let i = 0, tries = 0; i < nRocks && tries < 120; tries++) {
    const x = (rng() * 2 - 1) * CORRIDOR, z = z1 + rng() * (safe - z1);
    if (z > safe || nearRamp(x, z, 3) || !free(x, z, 2.5)) continue;
    const s = 0.6 + rng() * 0.7;
    rocks.push({ x, z, s, rx: rng() * 3, ry: rng() * 3 });
    occupied.push({ x, z, r: s });
    obstacles.push({ x, z, r: s * 0.95, h: s * 0.9 });
    i++;
  }
  // Forest walls on the banks.
  for (let i = 0; i < 46; i++) {
    const sideSign = i % 2 ? 1 : -1;
    const x = sideSign * (CORRIDOR + 2 + rng() * 44), z = z1 + rng() * CHUNK;
    const s = 0.9 + rng() * 0.8;
    trees.push({ x, z, s, rot: rng() * 6 });
    obstacles.push({ x, z, r: 0.75 * s, h: 5.6 * s });
  }
  // Gates: pass between the flags for a bonus.
  if (k > 0 && rng() < 0.6) {
    for (let tries = 0; tries < 20; tries++) {
      const x = (rng() * 2 - 1) * (CORRIDOR - 8), z = z1 + 5 + rng() * (CHUNK - 10);
      if (nearRamp(x, z, 4) || !free(x, z, 5)) continue;
      gates.push({ x, z, half: 3.2, done: false });
      occupied.push({ x, z, r: 4 });
      break;
    }
  }

  group.add(terrainMesh(z0, z1));
  if (trees.length) {
    group.add(instanced(geo.trunk, mat.trunk, trees, (t, o) => {
      o.position.set(t.x, baseHeight(t.x, t.z) - 0.1, t.z); o.rotation.set(0, t.rot, 0); o.scale.setScalar(t.s);
    }));
    group.add(instanced(geo.pine, mat.pine, trees, (t, o) => {
      o.position.set(t.x, baseHeight(t.x, t.z) - 0.1, t.z); o.rotation.set(0, t.rot, 0); o.scale.setScalar(t.s);
    }));
  }
  if (rocks.length) {
    group.add(instanced(geo.rock, mat.rock, rocks, (r, o) => {
      o.position.set(r.x, baseHeight(r.x, r.z) + r.s * 0.2, r.z);
      o.rotation.set(r.rx, r.ry, 0);
      o.scale.set(r.s * 1.2, r.s * 0.8, r.s);
    }));
  }
  for (const gt of gates) {
    for (const sgn of [-1, 1]) {
      const px = gt.x + sgn * gt.half, py = baseHeight(px, gt.z);
      const m = sgn < 0 ? mat.gateA : mat.gateB;
      const pole = new THREE.Mesh(geo.pole, m);
      pole.position.set(px, py, gt.z);
      pole.castShadow = true;
      const flag = new THREE.Mesh(geo.flag, m);
      flag.position.set(px, py, gt.z);
      flag.rotation.y = sgn < 0 ? Math.PI : 0;
      group.add(pole, flag);
    }
  }
  scene.add(group);
  chunks.set(k, { group, obstacles, gates, ramps: myRamps });
}

function disposeChunk(k) {
  const c = chunks.get(k);
  if (!c) return;
  scene.remove(c.group);
  c.group.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    else if (o.isMesh && o.geometry !== geo.pole && o.geometry !== geo.flag) o.geometry.dispose();
  });
  for (const r of c.ramps) ramps.splice(ramps.indexOf(r), 1);
  chunks.delete(k);
}

function updateChunks(z) {
  const cur = Math.max(0, Math.floor(-z / CHUNK));
  for (let k = cur; k <= cur + AHEAD; k++) if (!chunks.has(k)) buildChunk(k);
  for (const k of [...chunks.keys()]) if (k < cur - 1) disposeChunk(k);
}

function clearWorld() {
  for (const k of [...chunks.keys()]) disposeChunk(k);
  ramps.length = 0;
}

// ---------- Skier ----------
function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}
const skier = new THREE.Group();
skier.rotation.order = 'YXZ';
const body = new THREE.Group();          // trick pivot, centered at the hips
body.position.y = 0.9;
skier.add(body);
const legs = new THREE.Group();
body.add(legs);
const upper = new THREE.Group();         // leans for tucks
upper.position.y = -0.05;
body.add(upper);
for (const sx of [-0.16, 0.16]) {
  const ski = box(0.11, 0.04, 1.75, COLORS.skis);
  ski.position.set(sx, -0.88, -0.12);
  const tip = box(0.11, 0.04, 0.2, COLORS.skis);
  tip.position.set(sx, -0.83, -1.02);
  tip.rotation.x = 0.5;
  const leg = box(0.15, 0.85, 0.18, COLORS.pants);
  leg.position.set(sx, -0.45, 0);
  const boot = box(0.16, 0.16, 0.28, 0x30363d);
  boot.position.set(sx, -0.8, -0.03);
  legs.add(ski, tip, leg, boot);
}
const torso = box(0.46, 0.62, 0.28, COLORS.jacket);
torso.position.y = 0.33;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshLambertMaterial({ color: COLORS.helmet }));
head.position.set(0, 0.8, -0.02);
head.castShadow = true;
const goggles = box(0.26, 0.08, 0.06, 0x14202b);
goggles.position.set(0, 0.8, -0.16);
upper.add(torso, head, goggles);
for (const sx of [-1, 1]) {
  const arm = box(0.12, 0.55, 0.14, COLORS.jacket);
  arm.position.set(sx * 0.3, 0.3, -0.12);
  arm.rotation.x = -0.55;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 4), new THREE.MeshLambertMaterial({ color: 0x9aa4ad }));
  pole.position.set(sx * 0.36, -0.18, 0.15);
  pole.rotation.x = 0.9;
  upper.add(arm, pole);
}
scene.add(skier);

// Ski tracks: two thin ribbons drawn behind the skier.
const TRACK_N = 160;
const trackPts = [];
const trackGeo = new THREE.BufferGeometry();
const trackPos = new Float32Array(TRACK_N * 4 * 3);
trackGeo.setAttribute('position', new THREE.BufferAttribute(trackPos, 3));
{
  const idx = [];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < TRACK_N - 1; i++) {
      const a = (i * 2 + s) * 2, b = ((i + 1) * 2 + s) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  trackGeo.setIndex(idx);
}
const tracks = new THREE.Mesh(trackGeo, new THREE.MeshBasicMaterial({ color: 0xaec4d8, transparent: true, opacity: 0.55, depthWrite: false }));
tracks.frustumCulled = false;
tracks.renderOrder = 1;
scene.add(tracks);

function pushTrack(on) {
  trackPts.unshift({ x: player.x, z: player.z, h: player.heading, on });
  if (trackPts.length > TRACK_N) trackPts.length = TRACK_N;
}
function updateTracks() {
  let p = 0;
  for (let i = 0; i < TRACK_N; i++) {
    const t = trackPts[Math.min(i, trackPts.length - 1)];
    for (let s = 0; s < 2; s++) {
      if (!t) { trackPos.fill(0, p, p + 6); p += 6; continue; }
      const cx = Math.cos(t.h), cz = Math.sin(t.h);
      const off = s ? 0.16 : -0.16, w = t.on && i < trackPts.length ? 0.05 : 0;
      for (const e of [-w, w]) {
        const x = t.x + cx * (off + e), z = t.z + cz * (off + e);
        trackPos[p++] = x; trackPos[p++] = height(x, z) + 0.035; trackPos[p++] = z;
      }
    }
  }
  trackGeo.attributes.position.needsUpdate = true;
}

// Snow spray particles.
const SPRAY_N = 260;
const sprayPos = new Float32Array(SPRAY_N * 3).fill(-9999);
const sprayVel = new Float32Array(SPRAY_N * 3);
const sprayLife = new Float32Array(SPRAY_N);
let sprayNext = 0;
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false }));
spray.frustumCulled = false;
scene.add(spray);

function emitSpray(n, side, power) {
  const dirx = Math.sin(player.heading), dirz = -Math.cos(player.heading);
  for (let k = 0; k < n; k++) {
    const i = sprayNext; sprayNext = (sprayNext + 1) % SPRAY_N;
    sprayPos[i * 3] = player.x + (Math.random() - 0.5) * 0.6;
    sprayPos[i * 3 + 1] = player.y + 0.1;
    sprayPos[i * 3 + 2] = player.z + (Math.random() - 0.5) * 0.6;
    // Throw snow out of the turn, opposite the lean.
    const sx = -dirz * side, sz = dirx * side;
    sprayVel[i * 3] = dirx * player.v * 0.5 + sx * power * (1 + Math.random()) + (Math.random() - 0.5) * 2;
    sprayVel[i * 3 + 1] = 2 + Math.random() * 3 * power * 0.3;
    sprayVel[i * 3 + 2] = dirz * player.v * 0.5 + sz * power * (1 + Math.random()) + (Math.random() - 0.5) * 2;
    sprayLife[i] = 0.5 + Math.random() * 0.4;
  }
}
function updateSpray(dt) {
  for (let i = 0; i < SPRAY_N; i++) {
    if (sprayLife[i] <= 0) continue;
    sprayLife[i] -= dt;
    if (sprayLife[i] <= 0) { sprayPos[i * 3 + 1] = -9999; continue; }
    sprayVel[i * 3 + 1] -= 9 * dt;
    sprayPos[i * 3] += sprayVel[i * 3] * dt;
    sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt;
    sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
  }
  sprayGeo.attributes.position.needsUpdate = true;
}

// ---------- Input ----------
const keys = new Set();
const input = { x: 0, y: 0 };
const pointer = { id: null, sx: 0, sy: 0, x: 0, y: 0, t: 0, moved: false };
let hopQueued = false;

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(k)) e.preventDefault();
  if (k === ' ' || k === 'Enter') {
    if (state === 'menu' || state === 'over') { if (!e.repeat) start(); return; }
    if (!e.repeat) hopQueued = true;
  }
  keys.add(k.toLowerCase());
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

stage.addEventListener('pointerdown', (e) => {
  pointer.id = e.pointerId;   // a new finger always takes over
  pointer.sx = pointer.x = e.clientX;
  pointer.sy = pointer.y = e.clientY;
  pointer.t = performance.now();
  pointer.moved = false;
  stage.setPointerCapture?.(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointer.id) return;
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (Math.hypot(pointer.x - pointer.sx, pointer.y - pointer.sy) > 14) pointer.moved = true;
});
const endPointer = (e) => {
  if (e.pointerId !== pointer.id) return;
  if (!pointer.moved && performance.now() - pointer.t < 300) hopQueued = true;
  pointer.id = null;
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

function readInput() {
  let x = 0, y = 0;
  if (keys.has('arrowleft') || keys.has('a')) x -= 1;
  if (keys.has('arrowright') || keys.has('d')) x += 1;
  if (keys.has('arrowup') || keys.has('w')) y -= 1;
  if (keys.has('arrowdown') || keys.has('s')) y += 1;
  if (pointer.id !== null && pointer.moved) {
    const scale = Math.min(90, Math.max(50, window.innerWidth * 0.12));
    const px = (pointer.x - pointer.sx) / scale, py = (pointer.y - pointer.sy) / scale;
    x += Math.max(-1, Math.min(1, px));
    y += Math.abs(py) > 0.35 ? Math.max(-1, Math.min(1, py)) : 0;
  }
  input.x = Math.max(-1, Math.min(1, x));
  input.y = Math.max(-1, Math.min(1, y));
}

ui.go.addEventListener('click', () => start());

// ---------- Game state ----------
let state = 'menu';
const player = {};
let score = 0, trickPts = 0, combo = 1, crashT = 0, airT = 0, distance = 0;

function resetPlayer() {
  Object.assign(player, {
    x: 0, z: -2, y: 0, vy: 0, v: 6, heading: 0, steer: 0,
    grounded: true, spin: 0, spinV: 0, flip: 0, flipV: 0, pitch: 0, tuck: 0,
    crashSpin: 0,
  });
  player.y = height(player.x, player.z);
}

function start() {
  clearWorld();
  resetPlayer();
  trackPts.length = 0;
  score = trickPts = distance = 0;
  combo = 1;
  hopQueued = false;
  updateChunks(player.z);
  state = 'play';
  ui.overlay.classList.remove('show');
  ui.popups.textContent = '';
  snapCamera();
}

function gameOver() {
  state = 'over';
  const final = Math.floor(score);
  const isBest = final > best;
  if (isBest) {
    best = final;
    try { localStorage.setItem('downhill3d-best', String(best)); } catch (e) { /* storage blocked */ }
  }
  ui.title.textContent = 'Wiped out';
  ui.subtitle.textContent = `${Math.floor(distance)} m down the mountain.`;
  ui.result.hidden = false;
  ui.final.textContent = final.toLocaleString();
  ui.best.textContent = isBest ? 'New best!' : `Best ${best.toLocaleString()}`;
  ui.go.textContent = 'Ride again';
  ui.overlay.classList.add('show');
  ui.go.focus({ preventScroll: true });
}

function popup(text, sub, cls) {
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.textContent = text;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
  ui.popups.appendChild(el);
  while (ui.popups.children.length > 3) ui.popups.firstChild.remove();
  setTimeout(() => el.remove(), 1300);
}

function crash(reason) {
  if (state !== 'play') return;
  state = 'crash';
  crashT = 0;
  combo = 1;
  popup(reason, null, 'bad');
  emitSpray(40, 1, 4);
  emitSpray(40, -1, 4);
}

const TAU = Math.PI * 2;
const wrapErr = (a) => a - Math.round(a / TAU) * TAU;

function land() {
  const p = player;
  const fe = wrapErr(p.flip), se = wrapErr(p.spin);
  const flips = Math.round(Math.abs(p.flip) / TAU);
  const spins = Math.round(Math.abs(p.spin) / TAU);
  const err = Math.max(Math.abs(fe), Math.abs(se) * 0.75);
  const rotated = Math.abs(p.flip) > 1 || Math.abs(p.spin) > 1;
  const hang = airT;
  const backflip = p.flip > 0;
  p.grounded = true;
  p.flip = 0; p.spin = 0; p.flipV = 0; p.spinV = 0;
  airT = 0;
  if (!rotated && hang < 0.6) return;
  if (err > SLOPPY) { crash(rotated ? 'Over-rotated!' : 'Bad landing!'); return; }

  const parts = [];
  if (spins) parts.push(`${spins * 360}`);
  if (flips) {
    const dir = backflip ? 'Backflip' : 'Frontflip';
    parts.push(flips > 1 ? `${['', '', 'Double ', 'Triple ', 'Quad '][Math.min(flips, 4)]}${dir}` : dir);
  }
  const name = parts.length ? parts.join(' ') : 'Big air';
  let grade, gm, cls;
  if (err < PERFECT) { grade = 'Perfect'; gm = 2; cls = 'perfect'; }
  else if (err < CLEAN) { grade = 'Clean'; gm = 1; cls = 'clean'; }
  else { grade = 'Sloppy'; gm = 0.5; cls = 'sloppy'; }
  const base = spins * 250 + flips * 500 + Math.round(hang * 60);
  const pts = Math.round(base * gm * combo);
  trickPts += pts;
  popup(`${name}`, `${grade} +${pts}${combo > 1 ? ` (x${combo})` : ''}`, cls);
  if (grade === 'Sloppy') { combo = 1; p.v *= 0.7; }
  else {
    if (spins || flips) combo = Math.min(combo + 1, 8);
    if (grade === 'Perfect') p.v = Math.min(MAX_SPEED, p.v + 3);
  }
  emitSpray(30, 1, 2.5);
  emitSpray(30, -1, 2.5);
}

function physics(dt) {
  const p = player;
  if (state === 'crash') {
    crashT += dt;
    p.v = Math.max(0, p.v - 22 * dt);
    p.x += Math.sin(p.heading) * p.v * dt;
    p.z -= Math.cos(p.heading) * p.v * dt;
    const gy = height(p.x, p.z);
    p.vy -= G * dt;
    p.y = Math.max(gy, p.y + p.vy * dt);
    if (p.y === gy) p.vy = 0;
    p.crashSpin += dt * Math.max(0, p.v) * 0.5;
    if (crashT > 1.5) gameOver();
    return;
  }
  if (state !== 'play') return;

  if (p.grounded) {
    p.steer += (input.x - p.steer) * Math.min(1, dt * 10);
    const rate = p.steer * TURN_RATE * Math.min(1, 0.4 + p.v / 15);
    p.heading = Math.max(-MAX_HEADING, Math.min(MAX_HEADING, p.heading + rate * dt));
    // When slow, the skis drift back toward the fall line so you never get stuck on a bank.
    if (p.v < 6) {
      const gx = (height(p.x + 0.5, p.z) - height(p.x - 0.5, p.z)), gz = (height(p.x, p.z + 0.5) - height(p.x, p.z - 0.5));
      const fall = Math.max(-MAX_HEADING, Math.min(MAX_HEADING, Math.atan2(-gx, gz)));
      const k = (1 - p.v / 6) * 2.2 * dt;
      p.heading += Math.max(-k, Math.min(k, fall - p.heading));
    }
    p.tuck += ((input.y > 0.4 ? 1 : 0) - p.tuck) * Math.min(1, dt * 8);
    const dx = Math.sin(p.heading), dz = -Math.cos(p.heading);
    const e = 0.5;
    const slope = (height(p.x + dx * e, p.z + dz * e) - height(p.x - dx * e, p.z - dz * e)) / (2 * e);
    let a = -G * slope / Math.sqrt(1 + slope * slope);
    a -= FRICTION + DRAG * (1 - p.tuck * (1 - TUCK_DRAG)) * p.v * p.v + CARVE_BRAKE * Math.abs(rate) * p.v;
    p.v = Math.max(0, Math.min(MAX_SPEED, p.v + a * dt));
    if (hopQueued) { p.vy = Math.max(p.vy, 0) + HOP; p.y += 0.02; p.grounded = false; hopQueued = false; airT = 0; }
    if (Math.abs(p.steer) > 0.35 && p.v > 8 && Math.random() < Math.abs(p.steer) * dt * 60) emitSpray(1, -Math.sign(p.steer), p.v * 0.15);
  } else {
    hopQueued = false;
    airT += dt;
    // In the air, sideways input spins and vertical input flips.
    p.spinV += (input.x * SPIN_RATE - p.spinV) * Math.min(1, dt * ROT_RESP);
    p.flipV += (input.y * FLIP_RATE - p.flipV) * Math.min(1, dt * ROT_RESP);
    p.spin += p.spinV * dt;
    p.flip += p.flipV * dt;
    if (Math.abs(input.x) < 0.1) { const e = wrapErr(p.spin); if (Math.abs(e) < 0.6) p.spin -= Math.sign(e) * Math.min(Math.abs(e), ROT_ASSIST * dt); }
    if (Math.abs(input.y) < 0.1) { const e = wrapErr(p.flip); if (Math.abs(e) < 0.6) p.flip -= Math.sign(e) * Math.min(Math.abs(e), ROT_ASSIST * dt); }
  }

  const dx = Math.sin(p.heading), dz = -Math.cos(p.heading);
  const prevY = p.y;
  p.x += dx * p.v * dt;
  p.z += dz * p.v * dt;
  const gy = height(p.x, p.z);
  p.vy -= G * dt;
  const yb = p.y + p.vy * dt;
  if (yb <= gy) {
    p.y = gy;
    if (!p.grounded) land();
    p.vy = (gy - prevY) / dt;
    if (state !== 'play') return;
  } else if (p.grounded && yb > gy + 0.06) {
    p.grounded = false;
    p.y = yb;
    airT = 0;
  } else if (p.grounded) {
    p.y = gy;
    p.vy = (gy - prevY) / dt;
  } else {
    p.y = yb;
  }

  // Collisions with trees and rocks.
  const ck = Math.floor(-p.z / CHUNK);
  for (const k of [ck - 1, ck, ck + 1]) {
    const c = chunks.get(k);
    if (!c) continue;
    for (const o of c.obstacles) {
      const ddx = o.x - p.x, ddz = o.z - p.z, rr = o.r + SKIER_R;
      if (ddx * ddx + ddz * ddz < rr * rr && p.y - baseHeight(o.x, o.z) < o.h) {
        crash(o.h > 2 ? 'Tree!' : 'Rock!');
        return;
      }
    }
    for (const gt of c.gates) {
      if (!gt.done && p.z <= gt.z && p.z - dz * p.v * dt > gt.z) {
        gt.done = true;
        if (Math.abs(p.x - gt.x) < gt.half) {
          const pts = 100 * combo;
          trickPts += pts;
          popup(`Gate +${pts}`, null, 'gate');
        }
      }
    }
  }

  distance = Math.max(distance, -p.z);
  score = distance + trickPts;
}

// ---------- Camera ----------
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3() };
function cameraTarget(out, look) {
  const p = player;
  const portrait = camera.aspect < 1;
  const back = portrait ? 8.5 : 7, up = portrait ? 4.6 : 3.8;
  const sx = Math.sin(cam.yaw), sz = -Math.cos(cam.yaw);
  const gy = height(p.x, p.z);
  const y = p.grounded || state !== 'play' ? p.y : Math.max(gy, p.y * 0.6 + gy * 0.4);
  out.set(p.x - sx * back, y + up, p.z - sz * back);
  look.set(p.x + sx * 14, y - 14 * SLOPE * 0.6, p.z + sz * 14);
}
function snapCamera() {
  cam.yaw = player.heading * 0.6;
  cameraTarget(cam.pos, cam.look);
}
function updateCamera(dt) {
  cam.yaw += (player.heading * 0.6 - cam.yaw) * Math.min(1, dt * 3);
  const tp = new THREE.Vector3(), tl = new THREE.Vector3();
  cameraTarget(tp, tl);
  const k = Math.min(1, dt * 6);
  cam.pos.x += (tp.x - cam.pos.x) * k;
  cam.pos.z += (tp.z - cam.pos.z) * k;
  cam.pos.y += (tp.y - cam.pos.y) * Math.min(1, dt * 4);
  cam.pos.y = Math.max(cam.pos.y, height(cam.pos.x, cam.pos.z) + 1.5);
  cam.look.lerp(tl, Math.min(1, dt * 8));
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  const portrait = camera.aspect < 1;
  const fov = (portrait ? 74 : 60) + Math.min(12, player.v * 0.3);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
}

// ---------- Render sync ----------
function syncSkier(dt) {
  const p = player;
  skier.position.set(p.x, p.y, p.z);
  skier.rotation.y = -p.heading;
  const dx = Math.sin(p.heading), dz = -Math.cos(p.heading);
  const slope = (height(p.x + dx, p.z + dz) - height(p.x - dx, p.z - dz)) / 2;
  const targetPitch = p.grounded ? Math.atan(slope) : 0;
  p.pitch += (targetPitch - p.pitch) * Math.min(1, dt * (p.grounded ? 14 : 3));
  skier.rotation.x = p.pitch;
  skier.rotation.z = p.grounded ? -p.steer * 0.45 * Math.min(1, p.v / 12) : 0;
  body.rotation.order = 'YXZ';
  body.rotation.y = -p.spin;
  body.rotation.x = p.flip;
  const crouch = p.grounded ? p.tuck : 0.35;
  body.position.y = 0.9 - crouch * 0.22;
  upper.rotation.x = -crouch * 0.55;
  if (state === 'crash' || state === 'over') {
    body.rotation.x = Math.PI / 2 + p.crashSpin * 2;
    body.rotation.z = p.crashSpin;
    body.position.y = 0.35;
  } else {
    body.rotation.z = 0;
  }
  sun.position.set(p.x - 45, p.y + 38, p.z - 10);
  sun.target.position.set(p.x, p.y, p.z - 8);
}

function updateHud() {
  ui.score.textContent = Math.floor(score).toLocaleString();
  ui.mult.textContent = combo > 1 ? `combo x${combo}` : '';
  ui.dist.textContent = `${Math.floor(distance)} m`;
  const kmh = Math.hypot(player.v, player.grounded ? 0 : player.vy) * 3.6;
  ui.speed.textContent = `${Math.round(kmh)} km/h`;
}

// ---------- Loop ----------
let last = performance.now(), acc = 0, trackAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!test.manual) {
    readInput();
    acc += dt;
    while (acc >= STEP) { physics(STEP); acc -= STEP; }
  }
  if (state === 'play' || state === 'crash') {
    updateChunks(player.z);
    trackAcc += dt;
    if (trackAcc > 0.04) { trackAcc = 0; pushTrack(player.grounded && state === 'play'); }
  } else if (state === 'menu') {
    player.heading = Math.sin(now / 1400) * 0.25;
  }
  syncSkier(dt);
  updateTracks();
  updateSpray(dt);
  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
}

document.addEventListener('visibilitychange', () => { last = performance.now(); acc = 0; keys.clear(); });

resetPlayer();
updateChunks(player.z);
snapCamera();
requestAnimationFrame(frame);

// Small hook for automated smoke tests: set manual, then step the sim with fixed input.
const test = { manual: false };
window.__downhill = {
  player, start, ramps, height, test, scene, sun, hemi,
  get state() { return state; }, get score() { return score; },
  step(n, x = 0, y = 0) { input.x = x; input.y = y; for (let i = 0; i < n; i++) physics(STEP); updateChunks(player.z); },
};

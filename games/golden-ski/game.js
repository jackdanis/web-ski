// Golden Ski, milestone 1: ski feel on a low-poly test slope.
// World units are meters. +y is up and the run descends toward -z.
// "d" is distance down the run (d = -z): the start line is at d = 0, the finish at COURSE.finishD.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- Tuning: momentum physics ----------
// One velocity carries everything. Gravity, edges, poles, pops and spins only add to it or bend it,
// and nothing holds the skis to the fall line, so you can carve uphill until your speed runs out.
// The assist layer (ASSIST) is the arcade half: a little extra grip, a soft speed cap, slightly heavier
// air, skis that settle in line for landings, and kinder landings.
const STEP = 1 / 60;            // fixed physics step
const G = 9.81;
const SNOW = {
  groomed: { friction: 0.04, grip: 1.15 },
  powder: { friction: 0.13, grip: 0.75 },
};
const DRAG = 0.0045;            // air drag per (m/s)^2 standing up (half rho Cd A / m for a 75 kg skier)
const TUCK_DRAG = 0.0024;       // ...and tucked
const TUCK_TURN = 0.55;         // tucked, the skis pivot slower...
const TUCK_GRIP = 0.6;          // ...and hold less edge
const PIVOT = 2.4;              // rad/s the skis pivot at full steer when standing still...
const PIVOT_FALL = 14;          // ...divided by (1 + speed / 14): heavier the faster you go
const EDGE_IN = 5;              // how quickly you roll onto an edge (1/s): weight takes a moment to move
const EDGE_GRIP = 0.6;          // grip at full lean is (1 + 0.6) times the snow's grip
const SKID = 0.55;              // speed lost to sideways slip, as a share of the normal force
const BRAKE = 8.5;              // hockey stop deceleration
const POLE = 1.7;               // m/s each double-pole push adds from a standstill...
const POLE_MAX = 5.5;           // ...fading to nothing at this speed (20 km/h)
const POLE_EVERY = 0.55;        // seconds between pushes while held
const OLLIE_MIN = 3.0;          // pop from a tap (m/s)...
const OLLIE_MAX = 5.5;          // ...up to this after loading for OLLIE_CHARGE seconds
const OLLIE_CHARGE = 0.5;
const OLLIE_UP = 0.4;           // share of the pop that goes straight up rather than off the slope
const POP_COOLDOWN = 0.35;
const SPIN_IN = 7;              // rad/s^2: in the air, steering is torque on the spin you took off with
const SPIN_TUCK = 1.6;          // tucking spins you faster
const SPIN_DAMP = 0.4;          // spin lost per second with no steer held
const PUSH = 3.5;               // push out of the start, and after a reset
const TAKEOFF_MARGIN = 0.0005;  // extra gap (m per step) before a crest launches you
const REAL_AIR = 0.22;          // air shorter than this is a bump, not a jump
const HARD_IMPACT = 11;         // m/s into the snow that makes a landing sloppy
const CRASH_MU = 0.6;           // a wipeout slides with friction (plus a base drag), so it goes further on steep ground
const CRASH_BASE = 2;
const CRASH_MAX = 5;            // seconds before you self-arrest whatever the slope
const CRASH_HIT_SPEED = 7;      // hitting a tree faster than this is a wipeout
const SKIER_R = 0.35;
const OUT_OF_BOUNDS = 46;       // meters past the groomed edge before you're reset
const STUCK_TIME = 3;           // seconds stuck by the edge (powder or a tree) before you're reset
const ASSIST = {
  grip: 1.2,                    // extra edge grip
  cap: 34, capDrag: 0.25,       // soft cap about 122 km/h
  airG: 1.15,                   // gravity in the air
  align: 2.5,                   // rad/s the skis settle toward your travel in the air with nothing held
  clean: 25, sloppy: 55,        // landing angles (degrees) between skis and travel
  crash: 20,                    // m/s into the snow that's a wipeout
};

// ---------- Small helpers ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise2(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}
// Smooth (cosine) interpolation through [t, value] key points.
function curve(points, t) {
  if (t <= points[0][0]) return points[0][1];
  for (let k = 1; k < points.length; k++) {
    const [t1, v1] = points[k];
    if (t <= t1) {
      const [t0, v0] = points[k - 1];
      const s = (1 - Math.cos(((t - t0) / (t1 - t0)) * Math.PI)) / 2;
      return v0 + (v1 - v0) * s;
    }
  }
  return points[points.length - 1][1];
}

// ---------- The test slope ----------
// About 1.3 km: a gentle start, a long blue pitch, rollers, a flat to tuck through,
// a steep narrow section, a natural lip, wide carving bends, then a funnel into the finish.
const COURSE = {
  startD: 0,
  finishD: 1300,
  spawnD: -6,
  // [d, pitch (drop per meter)]
  pitch: [[-140, 0.1], [0, 0.12], [50, 0.16], [110, 0.3], [290, 0.28], [420, 0.24], [460, 0.1], [560, 0.1],
    [620, 0.4], [840, 0.42], [900, 0.34], [1000, 0.28], [1220, 0.26], [1270, 0.12], [1330, 0.06], [1400, 0.02],
    [1460, -0.06], [1560, -0.1]],
  // [d, half width of the groomed run]
  width: [[-140, 14], [-10, 14], [30, 28], [600, 30], [640, 22], [840, 22], [900, 30], [960, 34], [1220, 34],
    [1265, 18], [1340, 18], [1420, 40]],
};
const D_MIN = -140, D_MAX = 1580;
const elevTable = new Float32Array(D_MAX - D_MIN + 1);
for (let k = 1; k < elevTable.length; k++) {
  const d = D_MIN + k;
  elevTable[k] = elevTable[k - 1] - curve(COURSE.pitch, d - 0.5);
}
const ELEV0 = elevTable[-D_MIN];
function baseElevation(d) {
  const f = clamp(d - D_MIN, 0, elevTable.length - 1.001);
  const k = Math.floor(f);
  return elevTable[k] + (elevTable[k + 1] - elevTable[k]) * (f - k) - ELEV0;
}
function window01(d, a, b, ramp) {
  return clamp((d - a) / ramp, 0, 1) * clamp((b - d) / ramp, 0, 1);
}
function features(d) {
  let h = 0;
  h += 1.4 * Math.sin((2 * Math.PI * (d - 300)) / 42) * window01(d, 300, 430, 15);   // rollers
  h += 1.0 * Math.sin((2 * Math.PI * (d - 1050)) / 30) * window01(d, 1050, 1150, 10); // small rollers
  const lip = d - 875;                                                                  // the lip
  h += 3.2 * Math.exp(-(lip * lip) / (2 * (lip < 0 ? 22 : 7) ** 2));
  return h;
}
const CX0 = 14 * Math.sin(0.8);
function centerX(d) {
  return 22 * Math.sin(d / 170) + 14 * Math.sin(d / 83 + 0.8) - CX0;
}
function halfWidth(d) {
  return curve(COURSE.width, d);
}
function runDir(d, out = new THREE.Vector3()) {
  const dx = centerX(d + 1) - centerX(d - 1);
  return out.set(dx, 0, -2).normalize();
}
function bank(e) {
  if (e <= 0) return 0;
  return 0.012 * Math.min(e, 60) ** 2 + Math.max(0, e - 60);
}

// Height grid. Rendering uses its triangles; physics samples a smooth bicubic surface
// through the same points so the skier never catches on a facet edge.
const CELL = 6, X0 = -210, NX = 71, Z0 = -D_MAX, NZ = Math.floor((-D_MIN - Z0) / CELL) + 1;
const H = new Float32Array(NX * NZ);
for (let j = 0; j < NZ; j++) {
  const z = Z0 + j * CELL, d = -z;
  const cx = centerX(d), w = halfWidth(d), base = baseElevation(d) + features(d);
  for (let i = 0; i < NX; i++) {
    const x = X0 + i * CELL;
    const e = Math.abs(x - cx) - w;
    let h = base;
    if (e > 0) {
      const rough = Math.min(1, e / 25);
      h += bank(e) + rough * (3 * noise2(x / 28, z / 28) + 1.2 * noise2(x / 9 + 50, z / 9));
    }
    H[j * NX + i] = h;
  }
}
const gridH = (i, j) => H[clamp(j, 0, NZ - 1) * NX + clamp(i, 0, NX - 1)];
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
const crd = (p0, p1, p2, p3, t) => 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (3 * p1 - p0 - 3 * p2 + p3) * t * t);
const samp = { h: 0, gx: 0, gz: 0 };
const rowV = [0, 0, 0, 0], rowD = [0, 0, 0, 0];
// Height and gradient (dh/dx, dh/dz) at any point.
function sample(x, z, out = samp) {
  const fx = clamp((x - X0) / CELL, 0, NX - 1.001), fz = clamp((z - Z0) / CELL, 0, NZ - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  for (let m = 0; m < 4; m++) {
    const r = j - 1 + m;
    const p0 = gridH(i - 1, r), p1 = gridH(i, r), p2 = gridH(i + 1, r), p3 = gridH(i + 2, r);
    rowV[m] = cr(p0, p1, p2, p3, tx);
    rowD[m] = crd(p0, p1, p2, p3, tx) / CELL;
  }
  out.h = cr(rowV[0], rowV[1], rowV[2], rowV[3], tz);
  out.gz = crd(rowV[0], rowV[1], rowV[2], rowV[3], tz) / CELL;
  out.gx = cr(rowD[0], rowD[1], rowD[2], rowD[3], tz);
  return out;
}
const groundY = (x, z) => sample(x, z, { h: 0, gx: 0, gz: 0 }).h;
function normalFrom(s, out) {
  return out.set(-s.gx, 1, -s.gz).normalize();
}
function edgeDistance(x, z) {
  const d = -z;
  return Math.abs(x - centerX(d)) - halfWidth(d);
}
const surfaceAt = (x, z) => (edgeDistance(x, z) <= 0 ? SNOW.groomed : SNOW.powder);

// ---------- Scene ----------
const stage = document.getElementById('stage');
const timeEl = document.getElementById('time');
const timerEl = document.getElementById('timer');
const retryEl = document.getElementById('retry');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xd3e6f7);
scene.fog = new THREE.Fog(FOG, 160, 760);
{
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1f63c9');
  grad.addColorStop(0.55, '#8fc3ee');
  grad.addColorStop(1, '#e3f0fb');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  scene.background = sky;
}
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
scene.add(new THREE.HemisphereLight(0xdcecff, 0x5f7396, 1.35));
const sun = new THREE.DirectionalLight(0xfff3dc, 2.1);
sun.position.set(-0.8, 0.75, 0.25);
scene.add(sun);

// Terrain mesh: flat-shaded, vertex colored, N64 style.
{
  const pos = new Float32Array(NX * NZ * 3);
  const col = new Float32Array(NX * NZ * 3);
  const piste = new THREE.Color(0xf7faff), powder = new THREE.Color(0xdbe6f4), rock = new THREE.Color(0x7d899e);
  const c = new THREE.Color();
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x = X0 + i * CELL, z = Z0 + j * CELL;
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      const e = edgeDistance(x, z);
      c.copy(piste).lerp(powder, clamp(e / 6, 0, 1));
      const sx = (gridH(i + 1, j) - gridH(i - 1, j)) / (2 * CELL), sz = (gridH(i, j + 1) - gridH(i, j - 1)) / (2 * CELL);
      const steep = Math.hypot(sx, sz);
      if (e > 0) c.lerp(rock, clamp((steep - 0.95) / 0.35, 0, 1));
      const n = 1 + 0.025 * noise2(x / 4, z / 4);
      col[k * 3] = c.r * n; col[k * 3 + 1] = c.g * n; col[k * 3 + 2] = c.b * n;
    }
  }
  const idx = [];
  for (let j = 0; j < NZ - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i, b = a + 1, c2 = a + NX, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  const uv = new Float32Array(NX * NZ * 2);
  for (let k = 0; k < NX * NZ; k++) { uv[k * 2] = pos[k * 3] / 4; uv[k * 2 + 1] = pos[k * 3 + 2] / 4; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: snowTexture() })));
}

// Snow texture: faint corduroy stripes down the fall line plus speckle, so speed reads on the groomer.
function snowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 4) { g.fillStyle = 'rgba(150,175,215,0.16)'; g.fillRect(x, 0, 1, 64); }
  const rnd = mulberry32(7);
  for (let k = 0; k < 160; k++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(140,165,210,0.22)' : 'rgba(255,255,255,0.9)';
    g.fillRect(Math.floor(rnd() * 64), Math.floor(rnd() * 64), 1 + Math.floor(rnd() * 2), 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Far peaks: a jagged ring that follows the camera, outside the fog.
const farRing = (() => {
  const N = 140, R = 1900, pos = [], col = [];
  const top = new THREE.Color(0xf4f8ff), mid = new THREE.Color(0xb9cbe4);
  for (let k = 0; k <= N; k++) {
    const a = (k / N) * Math.PI * 2;
    const ridge = 1 - Math.abs(noise2(k * 0.35, 7));         // sharp ridgelines
    const peak = 120 + 420 * ridge * ridge + 70 * noise2(k * 1.7, 3) + (k % 2 ? -40 : 30);
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    // the base drops far below the horizon in the fog's color, so no sky shows beyond the terrain
    pos.push(x, -1500, z, x, peak * 0.55, z, x, peak, z);
    col.push(FOG.r, FOG.g, FOG.b, mid.r, mid.g, mid.b, top.r, top.g, top.b);
  }
  const idx = [];
  for (let k = 0; k < N; k++) {
    const a = k * 3, b = (k + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.renderOrder = -1;
  scene.add(m);
  return m;
})();

// Pixel-art pine sprites, drawn once into a two-variant atlas.
function treeTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const tiers = [[0, 46, 15, 18], [0, 36, 13, 16], [0, 26, 10, 14], [0, 16, 7, 12]];
  for (let v = 0; v < 2; v++) {
    const ox = v * 32 + 16;
    g.fillStyle = '#5a3a1e';
    g.fillRect(ox - 2, 54, 4, 10);
    for (const [, y, hw, ht] of tiers) {
      g.fillStyle = v ? '#24603f' : '#1d5236';
      g.beginPath(); g.moveTo(ox, y - ht + 2); g.lineTo(ox + hw, y + 8); g.lineTo(ox - hw, y + 8); g.closePath(); g.fill();
      g.fillStyle = v ? '#3a8a5c' : '#2c7350';
      g.beginPath(); g.moveTo(ox, y - ht + 2); g.lineTo(ox - hw, y + 8); g.lineTo(ox - 2, y + 8); g.closePath(); g.fill();
      g.fillStyle = '#f4f8ff';
      g.beginPath(); g.moveTo(ox, y - ht + 2); g.lineTo(ox + hw * (v ? 0.7 : 0.45), y + 1); g.lineTo(ox - hw * (v ? 0.7 : 0.45), y + 1); g.closePath(); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

// Trees: cylindrical billboards (they turn to face the camera but stay upright), one draw call.
const trees = [];
const treeCells = new Map();
const cellKey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
{
  const rnd = mulberry32(20261020);
  for (let d = -60; d < 1520; d += 1.6) {
    for (const side of [-1, 1]) {
      if (rnd() < 0.35) continue;
      const w = halfWidth(d);
      const off = rnd() < 0.7 ? 2 + rnd() * 10 : 12 + rnd() * 70;
      const x = centerX(d) + side * (w + off) + (rnd() - 0.5) * 2;
      const z = -d + (rnd() - 0.5) * 1.5;
      if (edgeDistance(x, z) < 1.5) continue;
      const height = 5 + rnd() * 6;
      trees.push({ x, z, y: groundY(x, z) - 0.3, height, r: 0.16 * height, v: rnd() < 0.5 ? 0 : 1 });
    }
  }
  for (const t of trees) {
    const k = cellKey(Math.floor(t.x / 8), Math.floor(t.z / 8));
    if (!treeCells.has(k)) treeCells.set(k, []);
    treeCells.get(k).push(t);
  }
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const data = new Float32Array(trees.length * 4), vari = new Float32Array(trees.length);
  trees.forEach((t, k) => { data.set([t.x, t.y, t.z, t.height], k * 4); vari[k] = t.v; });
  geo.setAttribute('iData', new THREE.InstancedBufferAttribute(data, 4));
  geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(vari, 1));
  geo.instanceCount = trees.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: treeTexture() },
      fogColor: { value: scene.fog.color },
      fogNear: { value: scene.fog.near },
      fogFar: { value: scene.fog.far },
    },
    vertexShader: /* glsl */ `
      attribute vec4 iData;
      attribute float iVar;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
        vec3 p = iData.xyz + right * position.x * iData.w * 0.5 + vec3(0.0, position.y * iData.w, 0.0);
        vUv = vec2((uv.x + iVar) * 0.5, uv.y);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      varying vec2 vUv;
      varying float vDepth;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.5) discard;
        gl_FragColor = vec4(mix(c.rgb, fogColor, smoothstep(fogNear, fogFar, vDepth)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
}

// Start and finish: posts, a banner and a line across the snow.
function bannerTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 96);
  bg.addColorStop(0, '#2c4785'); bg.addColorStop(0.55, '#13244d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.strokeStyle = '#ffcf3a'; g.lineWidth = 6; g.strokeRect(3, 3, 506, 90);
  g.font = 'italic 60px "Bowlby One", "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const gold = g.createLinearGradient(0, 18, 0, 78);
  gold.addColorStop(0, '#fff4bf'); gold.addColorStop(0.42, '#ffcf3a'); gold.addColorStop(0.52, '#c47c00'); gold.addColorStop(1, '#fff4bf');
  g.lineWidth = 4; g.strokeStyle = '#6b3a00'; g.strokeText(text, 256, 52);
  g.fillStyle = gold; g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function addGate(d, text, halfSpan, height) {
  const cx = centerX(d), z0 = -d;
  const dir = runDir(d, new THREE.Vector3());
  const across = new THREE.Vector3(-dir.z, 0, dir.x);     // perpendicular to the run, on the level
  const postMat = new THREE.MeshLambertMaterial({ color: 0x13244d });
  const feet = [-1, 1].map((s) => {
    const x = cx + across.x * s * halfSpan, z = z0 + across.z * s * halfSpan;
    return { x, z, y: groundY(x, z) };
  });
  const top = Math.max(...feet.map((f) => f.y)) + height;
  for (const f of feet) {
    const len = top - f.y + 1;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, len, 8), postMat);
    post.position.set(f.x, f.y - 1 + len / 2, f.z);
    scene.add(post);
  }
  // two single-sided faces so the text reads correctly from both sides
  const bannerGeo = new THREE.PlaneGeometry(halfSpan * 2, Math.min(5, halfSpan * 0.42));
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTexture(text) });
  for (const flip of [0, Math.PI]) {
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(cx, top - 1.2, z0);
    banner.rotation.y = Math.atan2(-dir.x, -dir.z) + flip;  // first face looks up the run
    scene.add(banner);
  }
  // line across the snow, laid on the smooth surface
  const w = halfWidth(d) + 6, n = Math.ceil(w * 2), pts = [];
  for (let k = 0; k <= n; k++) {
    const t = -w + (k / n) * 2 * w;
    for (const e of [-0.4, 0.4]) {
      const x = cx + across.x * t + dir.x * e, z = z0 + across.z * t + dir.z * e;
      pts.push(x, groundY(x, z) + 0.12, z);
    }
  }
  const idx = [];
  for (let k = 0; k < n; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setIndex(idx);
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe0261b, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide })));
}

// The skier: one camera-facing sprite from Goldie's sheet, plus a blob shadow.
// Snowlight: each sprite pixel is lit from its normal map by the sun, the sky above
// and the sunlit snow below, then snapped to four bands. Lighting happens in the
// sprite's own space (x right, y up, z toward the camera), so only the sun turns.
const FRAMES = { stand: 0, carveL: 1, carveR: 2, tuck: 3, brake: 4, air: 5, land: 6, wipeout: 7, front: 8, celebrate: 9 };
const SPRITE_H = 2.0, SPRITE_W = 1.5;
const SUN_DIR = new THREE.Vector3(-0.8, 0.75, 0.25).normalize(); // same sun as the terrain
const SUN_COLOR = new THREE.Vector3(1.0, 0.98, 0.92);
const SKY_COLOR = new THREE.Vector3(0.42, 0.55, 0.85);
const SNOW_ALBEDO = new THREE.Vector3(0.95, 0.97, 1.0);
const skierMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: null },
    normalMap: { value: null },
    frameOffset: { value: 0 },
    sunLocal: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: SUN_COLOR },
    skyColor: { value: SKY_COLOR },
    bounce: { value: new THREE.Vector3() },
  },
  vertexShader: `
    uniform float frameOffset;
    varying vec2 vUv;
    void main() {
      vUv = vec2(uv.x * 0.1 + frameOffset, uv.y);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform sampler2D normalMap;
    uniform vec3 sunLocal, sunColor, skyColor, bounce;
    varying vec2 vUv;
    float band(float v) { return max(0.12, floor(v * 4.0 + 0.5) / 4.0); }
    void main() {
      vec4 albedo = texture2D(map, vUv);
      if (albedo.a < 0.5) discard;
      vec3 n = normalize(texture2D(normalMap, vUv).rgb * 2.0 - 1.0);
      vec3 l = sunColor * band(max(0.0, dot(n, sunLocal)));
      l += skyColor * (0.35 + 0.35 * n.y);
      l += bounce * band(max(0.0, 0.15 - 0.8 * n.y)) * 0.55;
      l += 0.06;
      float m = max(max(l.r, l.g), max(l.b, 1e-3));
      l *= band(min(1.25, m)) / m;
      gl_FragColor = vec4(min(albedo.rgb * l * 1.15, 1.0), 1.0);
    }`,
  side: THREE.DoubleSide,
});
const skierMesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRITE_W, SPRITE_H).translate(0, SPRITE_H / 2 - 0.04, 0), skierMat);
scene.add(skierMesh);
// Snow bounce: the light landing on the snow (sun plus sky) times the snow's color.
// There are no shadows on this slope yet, so the skier always stands in sun.
skierMat.uniforms.bounce.value.copy(SUN_COLOR).multiplyScalar(Math.max(0, SUN_DIR.y))
  .addScaledVector(SKY_COLOR, 0.6).multiply(SNOW_ALBEDO);
const shadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(20,36,77,0.55)'); grad.addColorStop(1, 'rgba(20,36,77,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  scene.add(m);
  return m;
})();

// Snow spray when the skis skid or brake.
const SPRAY_N = 260;
const spray = { pos: new Float32Array(SPRAY_N * 3), vel: new Float32Array(SPRAY_N * 3), life: new Float32Array(SPRAY_N), next: 0, debt: 0 };
const sprayPoints = (() => {
  spray.pos.fill(-1e4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(spray.pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.24, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, depthWrite: false }));
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

// ---------- Input ----------
// Keyboard: Left/Right or A/D steer, Up or W pushes with the poles, Down or S brakes, Shift tucks,
// Space loads a jump while held and pops on release.
// Touch or mouse: drag sideways to steer, hold still to tuck, swipe down to push with the poles,
// swipe up to brake, tap to jump.
// The newest finger down steers; lifting it hands steering back to any finger still down.
const input = { steer: 0, tuck: false, brake: false, pole: false, jump: false };
const keys = new Set();
let keySteer = 0;
const STEER_PX = 70;
const ptr = { id: null, x0: 0, x: 0, y: 0, t0: 0, travel: 0, lastMove: 0, steer: 0, woke: false, hist: [], passive: false, topY: 0 };
const touches = new Map();      // every finger down: id -> [x, y]
let hockeyStop = false;         // a swipe up starts a stop that holds until you've stopped
let poleSwipe = false;          // a swipe down asks for one push with the poles
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'pole', KeyW: 'pole', ArrowDown: 'brake', KeyS: 'brake', ShiftLeft: 'tuck', ShiftRight: 'tuck', Space: 'jump' };
window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (!k) { if ((e.code === 'Enter') && phase === 'finished' && !retryEl.hidden) retry(); return; }
  e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (phase === 'ready') wake();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  keys.delete(k);
  if (k === 'jump' && phase === 'skiing') input.jump = true;
});
window.addEventListener('blur', () => { keys.clear(); touches.clear(); ptr.id = null; ptr.steer = 0; hockeyStop = false; poleSwipe = false; });
const canvas = renderer.domElement;
function anchor(id, x, y, handedOver) {
  ptr.id = id;
  ptr.x0 = ptr.x = x; ptr.y = y;
  ptr.t0 = ptr.lastMove = performance.now();
  ptr.travel = handedOver ? Infinity : 0;  // a finger that was already down can't count as a tap
  ptr.passive = handedOver;                // ...or tuck by resting until it moves
  ptr.steer = 0;
  ptr.hist = [[ptr.t0, x, y]];
  ptr.topY = y;
}
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  anchor(e.pointerId, e.clientX, e.clientY, false);
  hockeyStop = false;
  ptr.woke = phase === 'ready';
  canvas.setPointerCapture?.(e.pointerId);
  wake();
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (e.pointerId !== ptr.id) return;
  const now = performance.now();
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.travel += Math.hypot(dx, dy);
  if (Math.hypot(dx, dy) > 1.5) { ptr.lastMove = now; ptr.passive = false; }
  ptr.x = e.clientX; ptr.y = e.clientY;
  // Hockey stop: a quick, mostly upward flick (40 px within a quarter second).
  // Pulling the thumb back down cancels it.
  ptr.hist.push([now, ptr.x, ptr.y]);
  while (now - ptr.hist[0][0] > 250) ptr.hist.shift();
  const up = ptr.hist[0][2] - ptr.y, side = Math.abs(ptr.x - ptr.hist[0][1]);
  if (dy < 0 && up > 40 && up > 1.5 * side) { hockeyStop = true; ptr.topY = ptr.y; }
  ptr.topY = Math.min(ptr.topY, ptr.y);
  if (hockeyStop && ptr.y - ptr.topY > 20) hockeyStop = false;
  // Poles: a quick, mostly downward flick, one push per flick.
  const down = ptr.y - ptr.hist[0][2];
  if (dy > 0 && down > 40 && down > 1.5 * side) { poleSwipe = true; ptr.hist = [[now, ptr.x, ptr.y]]; }
  // keep the anchor within one full steer of the thumb so reversing responds at once
  if (ptr.x - ptr.x0 > STEER_PX) ptr.x0 = ptr.x - STEER_PX;
  if (ptr.x0 - ptr.x > STEER_PX) ptr.x0 = ptr.x + STEER_PX;
  ptr.steer = clamp((ptr.x - ptr.x0) / STEER_PX, -1, 1);
});
function endPointer(e) {
  touches.delete(e.pointerId);
  if (e.pointerId !== ptr.id) return;
  const quick = performance.now() - ptr.t0 < 220 && ptr.travel < 14;
  if (quick && e.type === 'pointerup' && !ptr.woke) input.jump = true;
  const rest = [...touches];
  if (rest.length) {
    // Another finger is still down: it takes over steering from where it is.
    const [id, [x, y]] = rest[rest.length - 1];
    anchor(id, x, y, true);
  } else {
    ptr.id = null; ptr.steer = 0;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
retryEl.addEventListener('click', () => retry());

let testHold = null;
function readInput(dt) {
  if (testHold) {
    input.steer = clamp(testHold.steer || 0, -1, 1);
    input.tuck = !!testHold.tuck && !testHold.brake;
    input.brake = !!testHold.brake;
    input.pole = !!testHold.pole;
    return;
  }
  const target = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
  keySteer += clamp(target - keySteer, -7 * dt, 7 * dt);
  if (!target && Math.abs(keySteer) < 0.02) keySteer = 0;
  const now = performance.now();
  const held = ptr.id !== null;
  const still = held && !ptr.passive && now - ptr.lastMove > 200 && now - ptr.t0 > 200 && Math.abs(ptr.steer) < 0.25;
  input.steer = clamp(keySteer + (held ? ptr.steer : 0), -1, 1);
  input.brake = keys.has('brake') || hockeyStop;
  input.pole = keys.has('pole') || poleSwipe;
  input.tuck = !input.brake && (keys.has('tuck') || still);
}

// ---------- Simulation ----------
const sk = {
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  heading: 0, grounded: true, airTime: 0, airMax: 0, popCD: 0,
  crashed: false, crashT: 0, landT: 0, landQ: '', skid: 0, tuck: false, brake: false, steer: 0, frame: FRAMES.stand,
  stuckT: 0, stuckX: 0, stuckZ: 0,
  edge: 0, spin: 0, yawRate: 0, charge: 0, poleCD: 0, poleT: 0, pole: false,
};
let phase = 'ready';            // ready -> skiing -> finished
let simTime = 0, runStart = null, runTime = 0, finishTime = null, finishAt = 0;
let cameraSnap = true;
const tmpN = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function placeSkier(d, speed) {
  const x = centerX(d), z = -d;
  sk.pos.set(x, groundY(x, z), z);
  sk.prev.copy(sk.pos);
  runDir(d, tmpA);
  sk.heading = Math.atan2(tmpA.x, -tmpA.z);
  sk.vel.copy(tmpA).multiplyScalar(speed);
  const s = sample(x, z);
  normalFrom(s, tmpN);
  sk.vel.addScaledVector(tmpN, -sk.vel.dot(tmpN));
  sk.grounded = true; sk.airTime = 0; sk.airMax = 0; sk.popCD = 0;
  sk.crashed = false; sk.crashT = 0; sk.landT = 0; sk.skid = 0;
  sk.stuckT = 0; sk.stuckX = x; sk.stuckZ = z;
  sk.edge = 0; sk.spin = 0; sk.yawRate = 0; sk.charge = 0; sk.poleCD = 0; sk.poleT = 0;
  cameraSnap = true;
}
function resetRun() {
  phase = 'ready';
  runStart = null; runTime = 0; finishTime = null;
  placeSkier(COURSE.spawnD, 0);
  timerEl.classList.remove('done');
  retryEl.hidden = true;
  updateClock();
}
function wake() {
  if (phase === 'ready') {
    phase = 'skiing';
    placeSkier(COURSE.spawnD, PUSH);
    input.jump = false;
  }
}
function retry() {
  resetRun();
  retryEl.blur();
}

function skiDir(n, out) {
  out.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  out.addScaledVector(n, -out.dot(n));
  return out.normalize();
}

const travelYaw = () => Math.atan2(sk.vel.x, -sk.vel.z);

function groundStep(dt) {
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const surf = surfaceAt(sk.pos.x, sk.pos.z);
  const nAcc = G * n.y;
  let speed = sk.vel.length();
  const yaw0 = travelYaw();

  // Rolling onto an edge takes a moment, and the skis pivot slower the faster you're going.
  sk.edge += (Math.abs(sk.steer) - sk.edge) * Math.min(1, EDGE_IN * dt);
  sk.heading = wrapAngle(sk.heading + sk.steer * (PIVOT / (1 + speed / PIVOT_FALL)) * (sk.tuck ? TUCK_TURN : 1) * dt);
  const f = skiDir(n, tmpF);

  // Gravity along the slope.
  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));

  speed = sk.vel.length();
  sk.skid = 0;
  if (speed < 0.3) {
    // Nearly stopped: skis don't slide sideways, and you can't slide backwards.
    const along = sk.vel.dot(f);
    sk.vel.copy(f).multiplyScalar(Math.max(0, along));
    speed = sk.vel.length();
  } else {
    // The edge can only push sideways so hard: grip times the snow holding you up, more the further
    // you lean. That push is what bends your momentum; ask for more and the rest is a skid that bleeds speed.
    tmpA.copy(sk.vel).divideScalar(speed);
    const alpha = Math.atan2(tmpB.crossVectors(tmpA, f).dot(n), tmpA.dot(f));
    const grip = surf.grip * ASSIST.grip * (1 + EDGE_GRIP * sk.edge) * (sk.tuck ? TUCK_GRIP : 1);
    const omega = (grip * nAcc) / Math.max(speed, 1.5);
    const turn = clamp(alpha, -omega * dt, omega * dt);
    tmpB.crossVectors(n, sk.vel);
    sk.vel.multiplyScalar(Math.cos(turn)).addScaledVector(tmpB, Math.sin(turn));
    const rest = Math.abs(alpha - turn);
    sk.skid = rest > Math.PI / 2 ? 1 : Math.sin(rest);
  }

  if (speed > 0) {
    const drag = (sk.tuck ? TUCK_DRAG : DRAG) * speed * speed + (speed > ASSIST.cap ? ASSIST.capDrag * (speed - ASSIST.cap) ** 2 : 0);
    let fric = surf.friction * nAcc;
    // Nearly stopped, friction never quite beats the slope, so pointing downhill always gets you going.
    if (speed < 2) fric = Math.min(fric, 0.8 * G * Math.hypot(n.x, n.z));
    const decel = fric + drag + SKID * sk.skid * nAcc + (sk.brake ? BRAKE : 0);
    const next = Math.max(0, speed - decel * dt);
    sk.vel.multiplyScalar(next / speed);
    speed = next;
  }

  // Poles: a double-pole push adds speed along the skis. Strong from a standstill, nothing once you're moving.
  sk.poleCD = Math.max(0, sk.poleCD - dt);
  if (sk.pole && sk.poleCD === 0 && speed < POLE_MAX) {
    sk.vel.addScaledVector(f, POLE * (1 - speed / POLE_MAX));
    sk.poleCD = POLE_EVERY;
    sk.poleT = 0.22;
  }

  // How fast your path is turning right now: carried into the air as spin.
  sk.yawRate += (wrapAngle(travelYaw() - yaw0) / dt - sk.yawRate) * 0.3;

  // Jump: load by holding, pop on release, partly off the slope and partly straight up.
  sk.popCD = Math.max(0, sk.popCD - dt);
  let popped = false;
  if (input.jump && sk.popCD === 0) {
    const pop = OLLIE_MIN + (OLLIE_MAX - OLLIE_MIN) * clamp(sk.charge / OLLIE_CHARGE, 0, 1);
    sk.vel.addScaledVector(n, pop * (1 - OLLIE_UP)).addScaledVector(UP, pop * OLLIE_UP);
    sk.popCD = POP_COOLDOWN;
    sk.charge = 0;
    popped = true;
  }

  sk.pos.addScaledVector(sk.vel, dt);
  const s1 = sample(sk.pos.x, sk.pos.z);
  const gap = sk.pos.y - s1.h;
  // If the ground falls away faster than gravity can pull you down onto it, you're in the air.
  if (popped || gap > 0.5 * nAcc * dt * dt + TAKEOFF_MARGIN) {
    sk.grounded = false;
    sk.airTime = 0;
    sk.airMax = Math.max(0, gap);
    sk.spin = sk.yawRate;
    return;
  }
  sk.pos.y = s1.h;
  const n1 = normalFrom(s1, tmpN);
  const sp = sk.vel.length();
  sk.vel.addScaledVector(n1, -sk.vel.dot(n1));
  const sp1 = sk.vel.length();
  if (sp1 > 1e-6) sk.vel.multiplyScalar(sp / sp1);
}

function airStep(dt) {
  // Steering in the air is torque on the spin you took off with; let go and the spin carries on.
  if (sk.steer) sk.spin += sk.steer * SPIN_IN * dt;
  else {
    sk.spin *= Math.max(0, 1 - SPIN_DAMP * dt);
    // Assist: with nothing held and no big spin going, the skis settle in line with your travel.
    if (Math.abs(sk.spin) < 2) {
      sk.spin *= Math.max(0, 1 - 3 * dt);
      sk.heading += clamp(wrapAngle(travelYaw() - sk.heading), -ASSIST.align * dt, ASSIST.align * dt);
    }
  }
  sk.heading = wrapAngle(sk.heading + sk.spin * (sk.tuck ? SPIN_TUCK : 1) * dt);
  const speed = sk.vel.length();
  sk.vel.y -= G * ASSIST.airG * dt;
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, 1 - (sk.tuck ? TUCK_DRAG : DRAG) * speed * dt));
  sk.pos.addScaledVector(sk.vel, dt);
  sk.airTime += dt;
  const s = sample(sk.pos.x, sk.pos.z);
  sk.airMax = Math.max(sk.airMax, sk.pos.y - s.h);
  if (sk.pos.y <= s.h) land(s);
}

// Landing keeps all the momentum along the slope; only the part going into the snow is absorbed.
// Land on a steep downslope and you keep your speed; land flat from high up and the impact gets you.
function land(s) {
  const n = normalFrom(s, tmpN);
  sk.pos.y = s.h;
  const vn = sk.vel.dot(n);
  const impact = Math.max(0, -vn);
  sk.vel.addScaledVector(n, -vn);
  sk.grounded = true;
  sk.spin = 0;
  const real = sk.airTime > REAL_AIR || sk.airMax > 0.5;
  sk.airTime = 0; sk.airMax = 0;
  if (!real) return;
  const f = skiDir(n, tmpF);
  const speed = sk.vel.length();
  const miss = speed > 2 ? Math.acos(clamp(sk.vel.dot(f) / speed, -1, 1)) : 0;
  if (miss > ASSIST.sloppy * Math.PI / 180 || impact > ASSIST.crash) {
    crash();
  } else if (miss > ASSIST.clean * Math.PI / 180 || impact > HARD_IMPACT) {
    // The skis scrub off the part of your speed that isn't along them.
    sk.vel.multiplyScalar(Math.max(0.4, Math.cos(miss)));
    sk.landT = 0.45; sk.landQ = 'sloppy';
  } else {
    sk.landT = 0.25; sk.landQ = 'clean';
  }
}

function crash() {
  sk.crashed = true;
  sk.crashT = 0;
  sk.landT = 0;
}

function crashStep(dt) {
  sk.crashT += dt;
  if (!sk.grounded) { airStep(dt); return; }
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const nAcc = G * n.y;
  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));
  const speed = sk.vel.length();
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, speed - (CRASH_MU * nAcc + CRASH_BASE) * dt) / speed);
  sk.pos.addScaledVector(sk.vel, dt);
  sk.pos.y = groundY(sk.pos.x, sk.pos.z);
  if ((sk.crashT > 1.6 && speed < 0.8) || sk.crashT > CRASH_MAX) {
    if (phase === 'finished') { sk.crashed = false; sk.vel.set(0, 0, 0); } // run's over: get up where you stopped
    else respawn(-sk.pos.z - 10);
  }
}

function respawn(d) {
  placeSkier(clamp(d, COURSE.spawnD, COURSE.finishD + 60), phase === 'skiing' ? PUSH : 0);
}

function treeCollide() {
  const ix = Math.floor(sk.pos.x / 8), iz = Math.floor(sk.pos.z / 8);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      const list = treeCells.get(cellKey(ix + a, iz + b));
      if (!list) continue;
      for (const t of list) {
        const dx = sk.pos.x - t.x, dz = sk.pos.z - t.z;
        const r = t.r + SKIER_R;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || sk.pos.y > t.y + t.height * 0.8) continue;
        const dist = Math.sqrt(d2) || 0.001;
        const nx = dx / dist, nz = dz / dist;
        sk.pos.x = t.x + nx * r;
        sk.pos.z = t.z + nz * r;
        if (sk.grounded) sk.pos.y = groundY(sk.pos.x, sk.pos.z);
        const into = sk.vel.x * nx + sk.vel.z * nz;
        if (into >= 0) continue;
        if (!sk.crashed && -into > CRASH_HIT_SPEED) {
          crash();
          sk.vel.multiplyScalar(0.35);
        } else {
          // Brushing a trunk: lose the part of your speed going into it and slide round it.
          // A real knock is still a hard stop.
          sk.vel.x -= into * nx;
          sk.vel.z -= into * nz;
          if (-into > 1) sk.vel.multiplyScalar(0.3);
        }
      }
    }
  }
}

function step() {
  const dt = STEP;
  simTime += dt;
  readInput(dt);
  const jumpPressed = input.jump;
  input.jump = false;
  if (phase === 'ready') {
    sk.prev.copy(sk.pos);
    return;
  }
  const finished = phase === 'finished';
  const pastFinish = finished && -sk.pos.z > COURSE.finishD + 4;
  sk.steer = finished ? 0 : input.steer;
  sk.tuck = finished ? false : input.tuck;
  sk.brake = finished ? pastFinish : input.brake;
  sk.pole = !finished && input.pole && !sk.brake;
  sk.poleT = Math.max(0, sk.poleT - dt);
  // Holding jump crouches and loads the pop.
  if (!finished && keys.has('jump') && sk.grounded && !sk.crashed) { sk.charge += dt; sk.tuck = true; }
  else if (!jumpPressed) sk.charge = 0;
  input.jump = !finished && jumpPressed && sk.grounded && !sk.crashed;

  sk.prev.copy(sk.pos);
  const dBefore = -sk.pos.z;
  if (sk.crashed) crashStep(dt);
  else if (sk.grounded) groundStep(dt);
  else airStep(dt);
  input.jump = false;
  if (hockeyStop && (sk.vel.length() < 1 || sk.crashed || !sk.grounded || phase !== 'skiing')) hockeyStop = false;
  // A swipe's push waits out the pole cooldown, but not a fall, a jump or the finish.
  if (poleSwipe && (sk.poleT > 0 || sk.crashed || !sk.grounded || phase !== 'skiing')) poleSwipe = false;
  sk.landT = Math.max(0, sk.landT - dt);
  treeCollide();
  if (!sk.crashed && edgeDistance(sk.pos.x, sk.pos.z) > OUT_OF_BOUNDS) respawn(-sk.pos.z);
  // Never a dead end: stuck by the edge (deep powder, a trunk) for a few seconds puts you
  // back on the run, and the clock keeps going. Holding the brake or poling is a choice, so it doesn't count.
  if (phase === 'skiing' && !sk.crashed && !sk.brake && !sk.pole && edgeDistance(sk.pos.x, sk.pos.z) > -1) {
    if (Math.hypot(sk.pos.x - sk.stuckX, sk.pos.z - sk.stuckZ) > 1.5) { sk.stuckX = sk.pos.x; sk.stuckZ = sk.pos.z; sk.stuckT = 0; }
    else if ((sk.stuckT += dt) > STUCK_TIME) respawn(-sk.pos.z - 5);
  } else { sk.stuckX = sk.pos.x; sk.stuckZ = sk.pos.z; sk.stuckT = 0; }

  // Timing: the clock starts at the start line and stops at the finish line.
  const dAfter = -sk.pos.z;
  if (runStart === null && dBefore < COURSE.startD && dAfter >= COURSE.startD) {
    runStart = simTime - dt * (dAfter - COURSE.startD) / Math.max(1e-6, dAfter - dBefore);
  }
  if (runStart !== null && phase === 'skiing') {
    runTime = simTime - runStart;
    if (dBefore < COURSE.finishD && dAfter >= COURSE.finishD) {
      finishTime = runTime - dt * (dAfter - COURSE.finishD) / Math.max(1e-6, dAfter - dBefore);
      runTime = finishTime;
      phase = 'finished';
      finishAt = simTime;
      timerEl.classList.add('done');
      cameraSnap = true;          // cut to the finish cam
    }
  }
  if (phase === 'finished' && retryEl.hidden && simTime - finishAt > 1.2) retryEl.hidden = false;
}

// ---------- Rendering ----------
function formatTime(t) {
  const cs = Math.floor(t * 100 + 1e-6);
  const m = Math.floor(cs / 6000), s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
let shownTime = '';
function updateClock() {
  const text = formatTime(finishTime ?? runTime);
  if (text !== shownTime) { timeEl.textContent = text; shownTime = text; }
}

const view = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, -1), camPos = new THREE.Vector3(), look = new THREE.Vector3();
const tmpC = new THREE.Vector3();
function updateCamera(p, dt) {
  const speed = sk.vel.length();
  if (phase === 'finished') {
    // Finish cam: fixed past the finish line, looking back up at the skier.
    const d = COURSE.finishD + 46, x = centerX(d) + 8, z = -d;
    camPos.set(x, groundY(x, z) + 3.5, z);
    camera.position.lerp(camPos, cameraSnap ? 1 : 1 - Math.exp(-3 * dt));
    look.set(p.x, p.y + 1.1, p.z);
    camera.lookAt(look);
    cameraSnap = false;
    return;
  }
  tmpC.set(sk.vel.x, 0, sk.vel.z);
  if (sk.crashed || tmpC.lengthSq() < 4) tmpC.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  tmpC.normalize();
  if (cameraSnap) camDir.copy(tmpC);
  else camDir.lerp(tmpC, 1 - Math.exp(-2.5 * dt)).normalize();
  const back = 4.0 + speed * 0.025, up = 1.85 + speed * 0.01;
  camPos.copy(p).addScaledVector(camDir, -back);
  camPos.y = p.y + up;
  camPos.y = Math.max(camPos.y, groundY(camPos.x, camPos.z) + 1.5);
  if (cameraSnap) camera.position.copy(camPos);
  else camera.position.lerp(camPos, 1 - Math.exp(-7 * dt));
  camera.position.y = Math.max(camera.position.y, groundY(camera.position.x, camera.position.z) + 1.2);
  look.copy(p).addScaledVector(camDir, 4);
  look.y = p.y + 1.0;
  camera.lookAt(look);
  const fov = Math.min(66, 60 + speed * 0.22) * (camera.aspect < 1 ? 1.15 : 1);
  if (cameraSnap) { camera.fov = fov; camera.updateProjectionMatrix(); }
  else if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  cameraSnap = false;
}

function pickFrame(cameraInFront) {
  const speed = sk.vel.length();
  if (sk.crashed) return FRAMES.wipeout;
  if (phase === 'finished' && speed < 0.6) return FRAMES.celebrate;
  if (cameraInFront) return FRAMES.front;
  if (!sk.grounded && sk.airTime > 0.12) return FRAMES.air;
  if (sk.landT > 0) return FRAMES.land;
  if (sk.brake && speed > 1) return FRAMES.brake;
  if (sk.tuck) return FRAMES.tuck;
  if (sk.steer > 0.3) return FRAMES.carveR;
  if (sk.steer < -0.3) return FRAMES.carveL;
  return FRAMES.stand;
}

function updateSpray(p, dt) {
  const speed = sk.vel.length();
  const amount = sk.grounded && !sk.crashed ? Math.max(sk.brake ? 1 : 0, sk.skid * 1.5) : (sk.crashed && speed > 2 ? 0.8 : 0);
  if (amount > 0.15 && speed > 3) {
    spray.debt += amount * speed * 6 * dt;
    tmpA.set(Math.cos(sk.heading), 0, Math.sin(sk.heading));
    while (spray.debt >= 1) {
      spray.debt -= 1;
      const k = spray.next;
      spray.next = (spray.next + 1) % SPRAY_N;
      const side = (Math.random() - 0.5) * 1.2;
      spray.pos[k * 3] = p.x + tmpA.x * side;
      spray.pos[k * 3 + 1] = p.y + 0.1;
      spray.pos[k * 3 + 2] = p.z + tmpA.z * side;
      const out = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 2.5);
      spray.vel[k * 3] = sk.vel.x * 0.35 + tmpA.x * out;
      spray.vel[k * 3 + 1] = 1.5 + Math.random() * 2.5;
      spray.vel[k * 3 + 2] = sk.vel.z * 0.35 + tmpA.z * out;
      spray.life[k] = 0.4 + Math.random() * 0.4;
    }
  }
  for (let k = 0; k < SPRAY_N; k++) {
    if (spray.life[k] <= 0) continue;
    spray.life[k] -= dt;
    if (spray.life[k] <= 0) { spray.pos[k * 3 + 1] = -1e4; continue; }
    spray.vel[k * 3 + 1] -= 9 * dt;
    spray.pos[k * 3] += spray.vel[k * 3] * dt;
    spray.pos[k * 3 + 1] += spray.vel[k * 3 + 1] * dt;
    spray.pos[k * 3 + 2] += spray.vel[k * 3 + 2] * dt;
  }
  sprayPoints.geometry.attributes.position.needsUpdate = true;
}

function render(alpha, dt) {
  const p = view.copy(sk.prev).lerp(sk.pos, alpha);
  updateCamera(p, dt);
  farRing.position.set(camera.position.x, camera.position.y - 120, camera.position.z);

  // Sprite: turn to face the camera around the vertical axis only.
  skierMesh.position.copy(p);
  const yaw = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
  skierMesh.rotation.y = yaw;
  // Sun in the sprite's space: x along the sprite's right, z toward the camera.
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  skierMat.uniforms.sunLocal.value.set(SUN_DIR.x * cy - SUN_DIR.z * sy, SUN_DIR.y, SUN_DIR.x * sy + SUN_DIR.z * cy);
  tmpA.set(camera.position.x - p.x, 0, camera.position.z - p.z).normalize();
  const facing = tmpA.x * Math.sin(sk.heading) - tmpA.z * Math.cos(sk.heading);
  const frame = pickFrame(facing > 0.35);
  if (frame !== sk.frame) { skierMat.uniforms.frameOffset.value = frame / 10; sk.frame = frame; }

  const s = sample(p.x, p.z);
  normalFrom(s, tmpN);
  shadow.position.set(p.x, s.h + 0.06, p.z);
  shadow.quaternion.setFromUnitVectors(UP, tmpN).multiply(FLAT);
  const lift = Math.max(0, p.y - s.h);
  shadow.material.opacity = clamp(1 - lift / 8, 0.2, 1);
  shadow.scale.setScalar(1 + lift * 0.08);

  updateSpray(p, dt);
  updateClock();
  renderer.render(scene, camera);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
// A window dragged to a screen with a different pixel density may not fire resize.
(function watchDensity() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { resize(); watchDensity(); }, { once: true });
})();

// ---------- Main loop ----------
let manual = false, acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!manual) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { step(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
  }
  render(manual ? 1 : acc / STEP, dt);
}

async function boot() {
  // Give the display font a moment so the banners use it.
  try {
    await Promise.race([document.fonts.load('italic 60px "Bowlby One"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch { /* fall back to Arial Black */ }
  addGate(COURSE.startD, 'START', 7, 6);
  addGate(COURSE.finishD, 'FINISH', halfWidth(COURSE.finishD) + 1.5, 8);
  // Both sheets are read as raw values: the Snowlight math works on the sprite's own
  // colors, exactly as on the cast page, and writes them straight to the screen.
  const loader = new THREE.TextureLoader();
  const [colorSheet, normalSheet] = await Promise.all([
    loader.loadAsync(new URL('assets/goldie.png', import.meta.url).href),
    loader.loadAsync(new URL('assets/goldie_n.png', import.meta.url).href),
  ]);
  for (const t of [colorSheet, normalSheet]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
  }
  skierMat.uniforms.map.value = colorSheet;
  skierMat.uniforms.normalMap.value = normalSheet;
  sk.frame = FRAMES.stand;
  skierMat.uniforms.frameOffset.value = FRAMES.stand / 10;
  resetRun();
  requestAnimationFrame(frame);
}
boot();

// ---------- Test hooks ----------
window.__golden = {
  sk, input, keys, COURSE, sample, centerX, halfWidth, edgeDistance, trees,
  get phase() { return phase; },
  get runTime() { return runTime; },
  get finishTime() { return finishTime; },
  setManual(on) { manual = on; },
  // run n fixed steps; `hold` overrides input each step: { steer, tuck, brake, pole, jump }.
  // A jump in `hold` is a tap; add 'jump' to `keys` for a few steps first to load it.
  step(n, hold) {
    testHold = hold || null;
    for (let k = 0; k < n; k++) {
      if (hold && hold.jump && k === 0) input.jump = true;
      step();
    }
    testHold = null;
    if (n > 10) cameraSnap = true;
  },
  start() { wake(); },
  snapCamera() { cameraSnap = true; },
  retry,
};

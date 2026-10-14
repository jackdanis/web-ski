// Golden Ski: a shot-by-shot skiing game presented like an arcade golf cabinet.
// Each run is a "hole": push off from a stop, carve toward the finish gate, and
// cross between its wands in as few pushes as you can.
// World units are meters. +y is up, the run descends toward -z, +x is skier's right.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- Tuning ----------
const STEP = 1 / 120;          // physics step for real shots
const PRED_STEP = 1 / 60;      // coarser step for the aim preview
const FALL = 1.2;              // pull down the fall line (m/s²), always less than snow friction
const DRAG = 0.0025;           // quadratic drag
const AIR_G = 8;                // floaty arcade hang time
const SLOPE_VIS = 0.28;        // how steep the run looks
const GATE_HALF = 1.2;         // half the gap between the finish wands
const GATE_SPEED = 7;          // faster than this through the wands is "too hot" and doesn't count
const CORRAL_R = 22;           // flat finish corral around the gate (the "green")
const TREE_GAP = 12;           // powder width between the groomed run and the trees
const NET_PAST = 26;           // B-net distance past the gate
const TIME_SCALE = 2.4;        // shots play faster than real time
const FAST_SCALE = 7;          // tap to fast forward
const MAX_OVER = 4;            // pick up at par + this
const WIND_AIR = 0.06;         // m/s² per mph while airborne
const WIND_GROUND = 0.008;     // m/s² per mph on snow, scaled by technique "sail"

// Techniques play the role of clubs: top speed off the push, how hard a curved
// swing carves, how wild a mishit gets, and how much the wind catches you.
const TECHS = [
  { id: 'tuck', name: 'TUCK', v: 26, k: 0.0016, spread: 0.035, sail: 1, crouch: 1 },
  { id: 'carve', name: 'CARVE', v: 20, k: 0.0028, spread: 0.022, sail: 0.6, crouch: 0.55 },
  { id: 'slide', name: 'SLIDE', v: 14, k: 0.006, spread: 0.014, sail: 0.3, crouch: 0.3 },
  { id: 'skate', name: 'SKATE', v: 9.5, k: 0.005, spread: 0.004, sail: 0, crouch: 0.1 },
];

// Snow surfaces play the role of lies.
const SURF = {
  groomed: { name: 'GROOMED', fric: 2.4, lie: 1, wild: 0, curve: 1 },
  ice: { name: 'ICE', fric: 1.6, lie: 1, wild: 0.05, curve: 1.6 },
  powder: { name: 'POWDER', fric: 5.2, lie: 0.75, wild: 0.12, curve: 0.8 },
  moguls: { name: 'MOGULS', fric: 6.5, lie: 0.55, wild: 0.25, curve: 0.7 },
  corral: { name: 'CORRAL', fric: 1.7, lie: 1, wild: 0, curve: 1 },
  kicker: { name: 'KICKER', fric: 2.4, lie: 1, wild: 0, curve: 1 },
};

// Golden Peak, nine runs. t values are fractions of the run length.
// ice: [t, offset m, radius x, radius z]; moguls: [t0, t1, from, to] as fractions of half width;
// kickers: [t, offset m]; creek bridge is a fraction of half width.
const HOLES = [
  { name: 'First Chair', par: 3, len: 165, w: 22, amp: 5, freq: 0.012, ph: 0.4, brk: 0.15 },
  { name: 'Corduroy Lane', par: 4, len: 345, w: 20, amp: 16, freq: 0.011, ph: 1.2, ice: [[0.45, -6, 7, 14]], brk: -0.25 },
  { name: 'Mogul Alley', par: 4, len: 360, w: 22, amp: 8, freq: 0.014, ph: 2.3, moguls: [[0.38, 0.56, -1, 0.45]], brk: 0.3 },
  { name: 'Frozen Creek', par: 4, len: 330, w: 20, amp: 10, freq: 0.02, ph: 0.2, creek: { t: 0.6, bridge: 0.6 }, kickers: [[0.58, -6]], brk: -0.2 },
  { name: 'Widowmaker', par: 5, len: 590, w: 18, amp: 34, freq: 0.0085, ph: 0, ice: [[0.3, 4, 6, 16], [0.7, -5, 5, 12]], moguls: [[0.5, 0.6, -0.2, 1]], brk: 0.35 },
  { name: 'Glade Run', par: 3, len: 185, w: 14, amp: 9, freq: 0.025, ph: 1, brk: -0.3 },
  { name: 'Big Air', par: 4, len: 385, w: 21, amp: 12, freq: 0.012, ph: 2.8, creek: { t: 0.5, bridge: -0.45 }, kickers: [[0.2, 3], [0.43, 0]], brk: 0.2 },
  { name: 'Ice Box', par: 4, len: 370, w: 20, amp: 20, freq: 0.013, ph: 4, ice: [[0.25, 0, 8, 18], [0.5, 6, 6, 14], [0.72, -4, 7, 16]], brk: -0.35 },
  { name: 'Golden Bowl', par: 5, len: 600, w: 22, amp: 26, freq: 0.009, ph: 3.3, moguls: [[0.2, 0.3, -1, 0]], creek: { t: 0.62, bridge: 0.5 }, kickers: [[0.6, -4]], ice: [[0.8, 3, 6, 14]], brk: 0.25 },
];

const COLORS = {
  skyTop: 0x1f63c9,
  skyHorizon: 0xcfe7fb,
  fog: 0xd7e9f8,
  groomed: 0xfbfdff,
  ice: 0xa6d5f3,
  moguls: 0xe7eef8,
  corral: 0xffffff,
  powder: 0xd5e2f0,
  treeSnow: 0xcbdaea,
  trunk: 0x6b4a33,
  pine: 0x2c6a45,
  pineDark: 0x1f5235,
  water: 0x2c6fb0,
  gold: 0xffc21a,
  wand: 0xe0261b,
  jacket: 0xffb000,
  pants: 0x1d2a44,
  helmet: 0xe0261b,
  skis: 0x111111,
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ui = {
  hud: $('hud'), holeNo: $('hole-no'), holePar: $('hole-par'), holeLen: $('hole-len'), holeName: $('hole-name'),
  shotNo: $('shot-no'), total: $('total'), map: $('map'), announce: $('announce'), hint: $('hint'),
  meter: $('meter'), meterFill: $('meter-fill'), meterPct: $('meter-pct'),
  aimL: $('aim-l'), aimR: $('aim-r'), windArrow: $('wind-arrow'), windMph: $('wind-mph'),
  tech: $('tech'), techName: $('tech-name'), techDist: $('tech-dist'),
  lieName: $('lie-name'), toPin: $('to-pin'),
  overlay: $('overlay'), cardBody: $('card-body'), go: $('go'),
};
const touchFirst = matchMedia('(pointer: coarse)').matches;
$('help-keys').hidden = touchFirst;
$('help-touch').hidden = !touchFirst;
$('loading').remove();

let best = 0;
try { best = Number(localStorage.getItem('goldenski-best')) || 0; } catch (e) { /* storage blocked */ }

// ---------- Random ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
function gauss() { return (rng() + rng() + rng() - 1.5) / 0.5; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- Hole geometry ----------
let H = null; // the current hole, built from a HOLES entry

function setupHole(def) {
  const len = def.len;
  const h = {
    def, len, par: def.par, w: def.w, amp: def.amp, freq: def.freq, ph: def.ph, brk: def.brk || 0,
    pinZ: -len, netZ: -len - NET_PAST,
    zA: -len + 55, zB: -len + CORRAL_R,
    kickers: [], ice: [], moguls: [], creek: null,
    wind: { mph: Math.round(rng() * 14), dir: rng() * Math.PI * 2 },
  };
  H = h;
  h.pinX = cx(h.pinZ);
  for (const [t, off, rx, rz] of def.ice || []) {
    const z = -t * len;
    h.ice.push({ x: cx(z) + off, z, rx, rz });
  }
  for (const [t0, t1, a, b] of def.moguls || []) h.moguls.push({ z0: -t0 * len, z1: -t1 * len, a, b });
  for (const [t, off] of def.kickers || []) {
    const lip = -t * len;
    h.kickers.push({ x: cx(lip) + off, lip, z0: lip + 8, w: 6, l: 8, h: 1.9 });
  }
  if (def.creek) {
    const z = -def.creek.t * len;
    h.creek = { z, half: 3.5, bx: cx(z) + def.creek.bridge * halfW(z), bw: 3.5 };
  }
  return h;
}

// Centerline of the groomed run. Straight past the gate so the corral is symmetric.
function cx(z) {
  const zc = Math.min(0, Math.max(z, -H.len));
  const s = -zc * H.freq + H.ph;
  return H.amp * (Math.sin(s) - Math.sin(H.ph)) + H.amp * 0.25 * (Math.sin(s * 2.3) - Math.sin(H.ph * 2.3));
}
function halfW(z) {
  let w = H.w * (1 + 0.12 * Math.sin(-z * 0.021 + H.ph));
  const dz = z - H.pinZ;
  if (Math.abs(dz) < CORRAL_R) w = Math.max(w, Math.sqrt(CORRAL_R * CORRAL_R - dz * dz) + 1.5);
  if (z < H.pinZ) w = Math.max(w, CORRAL_R * 0.7);
  return w;
}
// How much of the fall line still pulls (1 on the run, 0 in the flat corral).
function fallScale(z) { return clamp((z - H.zB) / (H.zA - H.zB), 0, 1); }
// Integral of fallScale, so the drawn slope matches the physics.
function fallHeight(z) {
  if (z >= H.zA) return z;
  if (z >= H.zB) return H.zA - (H.zA - z) * (H.zA - z) / (2 * (H.zA - H.zB));
  return H.zA - (H.zA - H.zB) / 2;
}

function onBridge(x, z) {
  const c = H.creek;
  return c && Math.abs(x - c.bx) < c.bw;
}
function inCreek(x, z) {
  const c = H.creek;
  return c && Math.abs(z - c.z) < c.half && !onBridge(x, z);
}

function surfaceAt(x, z) {
  if (z < H.netZ) return 'net';
  if (z > 30) return 'trees';
  const d = Math.abs(x - cx(z));
  const hw = halfW(z);
  if (d > hw + TREE_GAP) return 'trees';
  if (inCreek(x, z)) return 'creek';
  if (d > hw) return 'powder';
  if (z < H.pinZ || Math.hypot(x - H.pinX, z - H.pinZ) < CORRAL_R) return 'corral';
  for (const k of H.kickers) if (Math.abs(x - k.x) < k.w / 2 && z <= k.z0 && z >= k.lip) return 'kicker';
  for (const m of H.moguls) {
    if (z <= m.z0 && z >= m.z1) {
      const u = (x - cx(z)) / hw;
      if (u >= m.a && u <= m.b) return 'moguls';
    }
  }
  for (const e of H.ice) {
    const qx = (x - e.x) / e.rx, qz = (z - e.z) / e.rz;
    if (qx * qx + qz * qz < 1) return 'ice';
  }
  return 'groomed';
}

function rampHeight(x, z) {
  for (const k of H.kickers) {
    if (z <= k.z0 && z >= k.lip && Math.abs(x - k.x) <= k.w / 2) {
      const t = (k.z0 - z) / k.l;
      return k.h * t * t;
    }
  }
  return 0;
}

function baseHeight(x, z) {
  const c = cx(z);
  const d = Math.abs(x - c);
  const hw = halfW(z);
  const fs = fallScale(z);
  let y = SLOPE_VIS * fallHeight(z);
  y += 0.9 * Math.sin(z * 0.05 + H.ph) * Math.cos(x * 0.04) * fs;
  // Bowl: powder and trees rise away from the groomed run.
  const out = Math.max(0, d - hw);
  y += Math.min(out, 40) * 0.09 + Math.min(out * out, 400) * 0.006;
  // Break in the corral, a gentle cross slope you have to read like a green.
  y += -H.brk * 0.5 * (x - H.pinX) * (1 - fs) * 0.6;
  for (const m of H.moguls) {
    if (z <= m.z0 + 2 && z >= m.z1 - 2) {
      const u = (x - c) / hw;
      if (u >= m.a - 0.05 && u <= m.b + 0.05) {
        const edge = Math.min(1, (m.z0 + 2 - z) / 3, (z - m.z1 + 2) / 3);
        y += 0.5 * Math.max(0, edge) * (Math.sin(x * 1.15) * Math.sin(z * 1.05) + 0.4);
      }
    }
  }
  const c2 = H.creek;
  if (c2) {
    const dz = (z - c2.z) / 3.2;
    let dip = 1.8 * Math.exp(-dz * dz);
    const bd = Math.abs(x - c2.bx) - c2.bw;
    if (bd < 2) dip *= clamp(bd / 2, 0, 1);
    y -= dip;
  }
  return y;
}
function height(x, z) { return baseHeight(x, z) + rampHeight(x, z); }

function gravityAt(z) {
  const fs = fallScale(z);
  return { x: H.brk * (1 - fs), z: -FALL * fs };
}
function windVec() {
  const w = H.wind;
  return { x: Math.sin(w.dir) * w.mph, z: -Math.cos(w.dir) * w.mph };
}

// ---------- Shot simulation ----------
// One sim drives both the aim preview (no wind, no mishit) and the real shot.
function newSim(x, z, heading, v0, k, wind, sail) {
  return {
    x, z, y: height(x, z), vx: Math.sin(heading) * v0, vz: -Math.cos(heading) * v0, vy: 0,
    k, wind, sail, air: false, t: 0, done: false, result: null, airTime: 0, maxAir: 0, jumps: 0,
    lastGood: { x, z }, landed: false,
  };
}

function simStep(s, dt) {
  const px = s.x, pz = s.z;
  if (s.air) {
    if (s.wind) { s.vx += s.wind.x * WIND_AIR * dt; s.vz += s.wind.z * WIND_AIR * dt; }
    s.vy -= AIR_G * dt;
    s.x += s.vx * dt; s.z += s.vz * dt; s.y += s.vy * dt;
    s.airTime += dt;
    const gy = height(s.x, s.z);
    s.maxAir = Math.max(s.maxAir, s.y - gy);
    if (s.z < H.netZ) return finish(s, 'net');
    if (s.y <= gy && s.vy < 0) {
      s.air = false;
      s.y = gy;
      s.vx *= 0.8; s.vz *= 0.8;
      s.landed = true;
      const surf = surfaceAt(s.x, s.z);
      if (surf === 'trees' || surf === 'creek') return finish(s, surf);
    } else {
      return null;
    }
  } else {
    const surf = surfaceAt(s.x, s.z);
    if (surf === 'trees' || surf === 'creek' || surf === 'net') return finish(s, surf);
    if (surf !== 'powder') s.lastGood = { x: s.x, z: s.z };
    const S = SURF[surf];
    let v = Math.hypot(s.vx, s.vz);
    if (v < 1e-4) return finish(s, 'stop');
    // Carve: rotate the velocity, positive k bends right.
    const a = s.k * S.curve * v * dt;
    const ca = Math.cos(a), sa = Math.sin(a);
    const nvx = s.vx * ca - s.vz * sa, nvz = s.vz * ca + s.vx * sa;
    s.vx = nvx; s.vz = nvz;
    const ux = s.vx / v, uz = s.vz / v;
    const g = gravityAt(s.z);
    let ax = g.x, az = g.z;
    if (s.wind && s.sail) { ax += s.wind.x * WIND_GROUND * s.sail; az += s.wind.z * WIND_GROUND * s.sail; }
    const fr = S.fric + DRAG * v * v;
    const ox = s.vx, oz = s.vz;
    s.vx += (ax - ux * fr) * dt;
    s.vz += (az - uz * fr) * dt;
    // Friction can stop you but never push you backwards.
    if (s.vx * ox + s.vz * oz <= 0 || (Math.hypot(s.vx, s.vz) < 0.12 && Math.hypot(ax, az) < S.fric)) {
      s.vx = 0; s.vz = 0;
      s.y = height(s.x, s.z);
      checkGate(s, px, pz);
      return s.done ? s.result : finish(s, 'stop');
    }
    s.x += s.vx * dt; s.z += s.vz * dt;
    s.y = height(s.x, s.z);
    v = Math.hypot(s.vx, s.vz);
    for (const k of H.kickers) {
      if (pz >= k.lip && s.z < k.lip && Math.abs(s.x - k.x) < k.w / 2 && v > 5) {
        s.air = true;
        s.vy = Math.min(v * 0.5, 8);
        s.y = baseHeight(s.x, k.lip) + k.h;
        s.jumps++;
        break;
      }
    }
  }
  s.t += dt;
  if (!s.air) checkGate(s, px, pz);
  if (!s.done && s.t > 40) finish(s, 'stop');
  return s.done ? s.result : null;
}

function checkGate(s, px, pz) {
  if (s.done) return;
  const a = pz - H.pinZ, b = s.z - H.pinZ;
  if (a === b || a * b > 0) return;
  const f = a / (a - b);
  const xc = px + (s.x - px) * f;
  if (Math.abs(xc - H.pinX) <= GATE_HALF) {
    if (Math.hypot(s.vx, s.vz) > GATE_SPEED) { s.hot = true; return; }
    s.x = xc; s.z = H.pinZ; s.y = height(s.x, s.z);
    finish(s, 'holed');
  }
}

function finish(s, result) {
  if (!s.done) { s.done = true; s.result = result; }
  return s.result;
}

function predict(x, z, heading, techIdx, power = 1) {
  const tech = TECHS[techIdx];
  const lie = SURF[surfaceAt(x, z)] || SURF.groomed;
  const s = newSim(x, z, heading, tech.v * Math.sqrt(power) * lie.lie, 0, null, 0);
  const path = [{ x, z }];
  let n = 0;
  while (!s.done) {
    simStep(s, PRED_STEP);
    if (++n % 12 === 0) path.push({ x: s.x, z: s.z });
  }
  path.push({ x: s.x, z: s.z });
  return { x: s.x, z: s.z, result: s.result, path, dist: Math.hypot(s.x - x, s.z - z) };
}

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.skyHorizon);
scene.fog = new THREE.Fog(COLORS.fog, 160, 620);
const camera = new THREE.PerspectiveCamera(55, 1, 0.2, 3000);

const hemi = new THREE.HemisphereLight(0xeaf3ff, 0x6f87a8, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 68 : 52;
  camera.updateProjectionMatrix();
  sizeMap();
}
window.addEventListener('resize', resize);

// Sky dome with a vivid arcade gradient, and far peaks that ignore the fog.
{
  const g = new THREE.SphereGeometry(2400, 32, 16);
  const col = [];
  const top = new THREE.Color(COLORS.skyTop), hor = new THREE.Color(COLORS.skyHorizon), c = new THREE.Color();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getY(i) / 2400, 0, 1);
    c.copy(hor).lerp(top, Math.pow(t, 0.55));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);
}
const backdrop = new THREE.Group();
scene.add(backdrop);
{
  const peakMat = new THREE.MeshLambertMaterial({ color: 0xe9f1fb, flatShading: true, fog: false });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8aa0bd, flatShading: true, fog: false });
  const r = mulberry32(7);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + r() * 0.2;
    const dist = 1100 + r() * 500;
    const hgt = 200 + r() * 300;
    const rad = 260 + r() * 260;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(rad, hgt, 5 + Math.floor(r() * 3)), r() < 0.35 ? rockMat : peakMat);
    peak.position.set(Math.sin(a) * dist, hgt / 2 - 260, -Math.cos(a) * dist);
    peak.rotation.y = r() * 3;
    backdrop.add(peak);
  }
  // A few soft clouds.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const cg = cv.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const gx = 30 + r() * 68, gy = 50 + r() * 30, gr = 22 + r() * 22;
    const grad = cg.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grad.addColorStop(0, 'rgba(255,255,255,.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = grad;
    cg.fillRect(0, 0, 128, 128);
  }
  const ctex = new THREE.CanvasTexture(cv);
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, fog: false, depthWrite: false, opacity: 0.85, transparent: true }));
    const a = r() * Math.PI * 2, dist = 900 + r() * 600;
    s.position.set(Math.sin(a) * dist, 260 + r() * 260, -Math.cos(a) * dist);
    s.scale.set(520 + r() * 300, 220 + r() * 100, 1);
    backdrop.add(s);
  }
}

// Corduroy: fine grooming lines running down the fall line.
const cordTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 4;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 4);
  for (let i = 0; i < 32; i += 4) { g.fillStyle = 'rgba(140,168,204,.5)'; g.fillRect(i, 0, 1, 4); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
})();

const mat = {
  terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
  ribbon: new THREE.MeshLambertMaterial({ vertexColors: true, map: cordTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  trunk: new THREE.MeshLambertMaterial({ color: COLORS.trunk }),
  pine: new THREE.MeshLambertMaterial({ color: COLORS.pine, flatShading: true }),
  pineDark: new THREE.MeshLambertMaterial({ color: COLORS.pineDark, flatShading: true }),
  snowCap: new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true }),
  ramp: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  water: new THREE.MeshLambertMaterial({ color: COLORS.water, transparent: true, opacity: 0.92 }),
  wand: new THREE.MeshLambertMaterial({ color: COLORS.wand }),
  gold: new THREE.MeshLambertMaterial({ color: COLORS.gold, emissive: 0x4a3000, side: THREE.DoubleSide }),
  post: new THREE.MeshLambertMaterial({ color: 0x24427e }),
  net: new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  fence: new THREE.MeshLambertMaterial({ color: 0xff6a1a }),
  grid: new THREE.LineBasicMaterial({ color: 0xc89b1c, transparent: true, opacity: 0.45 }),
};

const holeGroup = new THREE.Group();
scene.add(holeGroup);
const dummy = new THREE.Object3D();
const tmpC = new THREE.Color();

function surfColor(s, x, z) {
  switch (s) {
    case 'ice': return tmpC.set(COLORS.ice);
    case 'moguls': return tmpC.set(COLORS.moguls);
    case 'corral': return tmpC.set(COLORS.corral);
    case 'powder': return tmpC.set(COLORS.powder);
    case 'trees': case 'net': return tmpC.set(COLORS.treeSnow);
    case 'creek': return tmpC.set(0x9fbcd6);
    default: return tmpC.set(COLORS.groomed);
  }
}

function buildTerrain() {
  // Wide, coarse base: powder and the tree bowl.
  const z0 = 60, z1 = H.netZ - 70, dz = 3, dx = 3;
  let minX = 0, maxX = 0;
  for (let z = z0; z >= z1; z -= 10) { minX = Math.min(minX, cx(z)); maxX = Math.max(maxX, cx(z)); }
  const x0 = minX - 130, x1 = maxX + 130;
  const nx = Math.ceil((x1 - x0) / dx) + 1, nz = Math.ceil((z0 - z1) / dz) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const idx = [];
  const nr = mulberry32(11);
  for (let j = 0; j < nz; j++) {
    const z = z0 - j * dz;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * dx, o = (j * nx + i) * 3;
      pos[o] = x; pos[o + 1] = baseHeight(x, z) - 0.05; pos[o + 2] = z;
      const s = surfaceAt(x, z);
      const c = surfColor(s === 'groomed' || s === 'ice' || s === 'moguls' || s === 'corral' || s === 'kicker' ? 'powder' : s, x, z);
      const n = 1 - nr() * 0.04;
      col[o] = c.r * n; col[o + 1] = c.g * n; col[o + 2] = c.b * n;
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.terrain);
  m.receiveShadow = true;
  holeGroup.add(m);

  // Fine groomed ribbon on top, with corduroy and per-surface tint.
  const rz0 = 14, rz1 = H.netZ - 2, rdz = 1.25, cols = 28;
  const rows = Math.ceil((rz0 - rz1) / rdz) + 1;
  const rp = new Float32Array(rows * (cols + 1) * 3), rc = new Float32Array(rows * (cols + 1) * 3), ruv = new Float32Array(rows * (cols + 1) * 2);
  const ridx = [];
  for (let j = 0; j < rows; j++) {
    const z = rz0 - j * rdz, c = cx(z), hw = halfW(z);
    for (let i = 0; i <= cols; i++) {
      const u = -1 + (2 * i) / cols;
      const x = c + u * hw, o = j * (cols + 1) + i;
      const s = surfaceAt(x, z);
      rp[o * 3] = x; rp[o * 3 + 1] = height(x, z) + 0.04; rp[o * 3 + 2] = z;
      const col2 = surfColor(s === 'creek' ? 'creek' : s, x, z);
      rc[o * 3] = col2.r; rc[o * 3 + 1] = col2.g; rc[o * 3 + 2] = col2.b;
      ruv[o * 2] = (u * hw) / 1.6; ruv[o * 2 + 1] = z / 4;
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      ridx.push(a, c, b, b, c, d);
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rg.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
  rg.setIndex(ridx);
  rg.computeVertexNormals();
  const rm = new THREE.Mesh(rg, mat.ribbon);
  rm.receiveShadow = true;
  holeGroup.add(rm);
}

function buildCorralGrid() {
  const pts = [];
  const R = CORRAL_R - 1, step = 2;
  const y = (x, z) => height(x, z) + 0.09;
  for (let a = -R; a <= R; a += step) {
    for (let b = -R; b < R; b += step / 2) {
      // lines along z and along x, clipped to the circle
      for (const [x1, z1, x2, z2] of [[a, b, a, b + step / 2], [b, a, b + step / 2, a]]) {
        if (x1 * x1 + z1 * z1 > R * R || x2 * x2 + z2 * z2 > R * R) continue;
        const X1 = H.pinX + x1, Z1 = H.pinZ + z1, X2 = H.pinX + x2, Z2 = H.pinZ + z2;
        pts.push(X1, y(X1, Z1), Z1, X2, y(X2, Z2), Z2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  holeGroup.add(new THREE.LineSegments(g, mat.grid));
}

function instanced(geometry, material, items, place, shadow = true) {
  const m = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  m.count = items.length;
  items.forEach((it, i) => { place(it, dummy); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function buildTrees() {
  const r = mulberry32(1000 + HOLES.indexOf(H.def));
  const trees = [];
  for (let z = 50; z > H.netZ - 60; z -= 2.4) {
    const c = cx(z), hw = halfW(z);
    for (const side of [-1, 1]) {
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const off = hw + TREE_GAP + 0.8 + Math.pow(r(), 1.7) * 70;
        const x = c + side * off;
        const zz = z + (r() - 0.5) * 2.4;
        if (surfaceAt(x, zz) !== 'trees') continue;
        trees.push({ x, z: zz, s: 0.75 + r() * 0.9, rot: r() * 6, dark: r() < 0.4 });
      }
    }
    // Close the top of the run behind the start.
    if (z > 30) for (let x = c - hw - 10; x < c + hw + 10; x += 5) if (r() < 0.5) trees.push({ x: x + r() * 3, z, s: 0.8 + r() * 0.7, rot: r() * 6, dark: r() < 0.4 });
  }
  const place = (yOff, sy) => (t, o) => {
    o.position.set(t.x, baseHeight(t.x, t.z) + yOff * t.s, t.z);
    o.rotation.set(0, t.rot, 0);
    o.scale.set(t.s, t.s * sy, t.s);
  };
  const trunkG = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 5);
  const lowG = new THREE.ConeGeometry(2.3, 4.2, 7);
  const highG = new THREE.ConeGeometry(1.6, 3.4, 7);
  const capG = new THREE.ConeGeometry(0.75, 1.2, 7);
  const light = trees.filter((t) => !t.dark), dark = trees.filter((t) => t.dark);
  holeGroup.add(instanced(trunkG, mat.trunk, trees, place(0.8, 1), false));
  holeGroup.add(instanced(lowG, mat.pine, light, place(3.4, 1)));
  holeGroup.add(instanced(lowG, mat.pineDark, dark, place(3.4, 1)));
  holeGroup.add(instanced(highG, mat.pine, light, place(5.6, 1)));
  holeGroup.add(instanced(highG, mat.pineDark, dark, place(5.6, 1)));
  holeGroup.add(instanced(capG, mat.snowCap, trees, place(7.1, 1), false));
}

function buildKicker(k) {
  const pos = [], col = [];
  const top = new THREE.Color(0xf2f8ff), side = new THREE.Color(0x9cc0de), lip = new THREE.Color(0xff6a1a);
  const quad = (a, b, c, d, color) => {
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
    for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
  };
  const segs = 10, xl = k.x - k.w / 2, xr = k.x + k.w / 2;
  const P = (x, z, up) => [x, up ? height(x, z) + 0.05 : baseHeight(x, z) - 0.3, z];
  for (let s = 0; s < segs; s++) {
    const za = k.z0 - (s / segs) * k.l, zb = k.z0 - ((s + 1) / segs) * k.l;
    quad(P(xl, za, true), P(xl, zb, true), P(xr, zb, true), P(xr, za, true), s === segs - 1 ? lip : top);
    quad(P(xl, za, false), P(xl, zb, false), P(xl, zb, true), P(xl, za, true), side);
    quad(P(xr, za, true), P(xr, zb, true), P(xr, zb, false), P(xr, za, false), side);
  }
  const zl = k.lip + 0.001;
  quad(P(xl, zl, true), P(xl, zl, false), P(xr, zl, false), P(xr, zl, true), side);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.ramp);
  m.castShadow = m.receiveShadow = true;
  holeGroup.add(m);
}

function buildCreek() {
  const c = H.creek;
  const x0 = cx(c.z) - halfW(c.z) - TREE_GAP - 4, x1 = cx(c.z) + halfW(c.z) + TREE_GAP + 4;
  const pts = [], idx = [];
  const n = Math.ceil((x1 - x0) / 2);
  for (let i = 0; i <= n; i++) {
    const x = x0 + (i / n) * (x1 - x0);
    const yw = SLOPE_VIS * fallHeight(c.z) - 1.15;
    pts.push(x, yw, c.z + c.half + 0.6, x, yw, c.z - c.half - 0.6);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const water = new THREE.Mesh(g, mat.water);
  water.receiveShadow = true;
  holeGroup.add(water);
  // Orange rope fence on both sides of the snow bridge.
  for (const sx of [-1, 1]) {
    for (let dz = -c.half - 2; dz <= c.half + 2; dz += 1.5) {
      const x = c.bx + sx * c.bw, z = c.z + dz;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 5), mat.fence);
      post.position.set(x, height(x, z) + 0.5, z);
      holeGroup.add(post);
    }
  }
}

function textTexture(text, w, h, bg) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#ffd23f'; g.lineWidth = h * 0.08; g.strokeRect(0, 0, w, h);
  g.font = `italic 900 ${Math.floor(h * 0.62)}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const tg = g.createLinearGradient(0, h * 0.2, 0, h * 0.8);
  tg.addColorStop(0, '#fff6c2'); tg.addColorStop(0.5, '#ffd23f'); tg.addColorStop(0.55, '#d98a00'); tg.addColorStop(1, '#ffd23f');
  g.lineWidth = h * 0.06; g.strokeStyle = '#3a1d00';
  g.strokeText(text, w / 2, h / 2);
  g.fillStyle = tg; g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const bannerTex = textTexture('GOLDEN SKI', 512, 96, ['#24427e', '#0b1630']);
const finishTex = textTexture('FINISH', 256, 64, ['#b3200b', '#5a0d02']);

function buildFinish() {
  const y = height(H.pinX, H.pinZ);
  // Wands: the "cup". Pass between them on snow to hole out.
  for (const sx of [-1, 1]) {
    const x = H.pinX + sx * GATE_HALF;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2, 6), mat.wand);
    w.position.set(x, y + 1, H.pinZ);
    w.castShadow = true;
    holeGroup.add(w);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.5), mat.gold);
    flag.position.set(x + sx * 0.38, y + 1.7, H.pinZ);
    holeGroup.add(flag);
  }
  const line = new THREE.Mesh(new THREE.BoxGeometry(GATE_HALF * 2, 0.02, 0.18), new THREE.MeshBasicMaterial({ color: 0xe0261b }));
  line.position.set(H.pinX, y + 0.08, H.pinZ);
  holeGroup.add(line);
  // Finish arch with the cabinet banner.
  const span = 9;
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5.4, 0.5), mat.post);
    post.position.set(H.pinX + sx * span / 2, y + 2.7, H.pinZ - 1.5);
    post.castShadow = true;
    holeGroup.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(span + 0.5, 1.2, 0.3), [mat.post, mat.post, mat.post, mat.post,
    new THREE.MeshBasicMaterial({ map: bannerTex }), new THREE.MeshBasicMaterial({ map: finishTex })]);
  banner.position.set(H.pinX, y + 5.6, H.pinZ - 1.5);
  banner.castShadow = true;
  holeGroup.add(banner);
  // B-net across the run past the corral.
  const c = cx(H.netZ), hw = halfW(H.netZ) + TREE_GAP;
  const netG = new THREE.PlaneGeometry(hw * 2, 2.4, 1, 1);
  const net = new THREE.Mesh(netG, mat.net);
  net.position.set(c, baseHeight(c, H.netZ) + 1.2, H.netZ);
  holeGroup.add(net);
  for (let x = c - hw; x <= c + hw; x += 4) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), mat.fence);
    p.position.set(x, baseHeight(x, H.netZ) + 1.3, H.netZ);
    holeGroup.add(p);
  }
}

function buildStart() {
  // Gold tee markers either side of the start, plus a little start hut.
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 14, 10), mat.gold);
    m.position.set(sx * 4, height(sx * 4, 0) + 0.2, 0);
    m.castShadow = true;
    holeGroup.add(m);
  }
  const hut = new THREE.Group();
  const walls = new THREE.Mesh(new THREE.BoxGeometry(4, 2.6, 3), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }));
  walls.position.y = 1.3;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.6, 4), mat.snowCap);
  roof.position.y = 3.4; roof.rotation.y = Math.PI / 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64), new THREE.MeshBasicMaterial({ map: bannerTex }));
  sign.position.set(0, 2.1, -1.52); sign.rotation.y = Math.PI;
  hut.add(walls, roof, sign);
  hut.traverse((o) => { o.castShadow = true; });
  hut.position.set(-9, height(-9, 6), 6);
  hut.rotation.y = Math.PI;
  holeGroup.add(hut);
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  g.clear();
}

function buildHole() {
  disposeGroup(holeGroup);
  buildTerrain();
  buildCorralGrid();
  buildTrees();
  for (const k of H.kickers) buildKicker(k);
  if (H.creek) buildCreek();
  buildFinish();
  buildStart();
  backdrop.position.set(cx(H.pinZ / 2), SLOPE_VIS * H.pinZ / 2, H.pinZ / 2);
  holeGroup.add(trail.mesh);
  resetTrail();
  buildMapBase();
}

// ---------- Skier ----------
function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}
const skier = new THREE.Group();
skier.rotation.order = 'YXZ';
const body = new THREE.Group();
body.position.y = 0.9;
skier.add(body);
const legs = new THREE.Group();
body.add(legs);
const upper = new THREE.Group();
upper.position.y = -0.05;
body.add(upper);
const legParts = [];
for (const sx of [-0.16, 0.16]) {
  const leg = new THREE.Group();
  const ski = box(0.11, 0.04, 1.75, COLORS.skis);
  ski.position.set(0, -0.88, -0.12);
  const tip = box(0.11, 0.04, 0.2, COLORS.skis);
  tip.position.set(0, -0.83, -1.02);
  tip.rotation.x = 0.5;
  const shin = box(0.15, 0.85, 0.18, COLORS.pants);
  shin.position.set(0, -0.45, 0);
  const boot = box(0.16, 0.16, 0.28, 0x30363d);
  boot.position.set(0, -0.8, -0.03);
  leg.add(ski, tip, shin, boot);
  leg.position.x = sx;
  legs.add(leg);
  legParts.push(leg);
}
const torso = box(0.46, 0.62, 0.28, COLORS.jacket);
torso.position.y = 0.33;
const stripe = box(0.47, 0.1, 0.29, 0xffffff);
stripe.position.y = 0.42;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshLambertMaterial({ color: COLORS.helmet }));
head.position.set(0, 0.8, -0.02);
head.castShadow = true;
const goggles = box(0.26, 0.08, 0.06, 0xffc21a);
goggles.position.set(0, 0.8, -0.16);
upper.add(torso, stripe, head, goggles);
const arms = [];
for (const sx of [-1, 1]) {
  const arm = new THREE.Group();
  arm.position.set(sx * 0.3, 0.55, -0.02);
  const sleeve = box(0.12, 0.55, 0.14, COLORS.jacket);
  sleeve.position.y = -0.25;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.25, 4), new THREE.MeshLambertMaterial({ color: 0xd8dde3 }));
  pole.position.set(sx * 0.04, -0.75, 0.15);
  pole.rotation.x = 0.35;
  arm.add(sleeve, pole);
  arm.rotation.x = -0.4;
  upper.add(arm);
  arms.push(arm);
}
scene.add(skier);

// Shot tracks: a flat ribbon following every push on this run.
const TRAIL_MAX = 3000;
const trail = (() => {
  const pos = new Float32Array(TRAIL_MAX * 2 * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x9db8d6, transparent: true, opacity: 0.6, depthWrite: false }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { pos, g, mesh, n: 0, lastX: 0, lastZ: 0, breakNext: true };
})();
function resetTrail() { trail.n = 0; trail.breakNext = true; trail.g.setDrawRange(0, 0); }
function pushTrail(x, z, heading, on) {
  if (!on) { trail.breakNext = true; return; }
  if (!trail.breakNext && Math.hypot(x - trail.lastX, z - trail.lastZ) < 0.6) return;
  if (trail.n >= TRAIL_MAX - 2) return;
  const add = (w) => {
    const cxh = Math.cos(heading) * w, czh = Math.sin(heading) * w;
    const o = trail.n * 6;
    trail.pos[o] = x - cxh; trail.pos[o + 1] = height(x - cxh, z - czh) + 0.07; trail.pos[o + 2] = z - czh;
    trail.pos[o + 3] = x + cxh; trail.pos[o + 4] = height(x + cxh, z + czh) + 0.07; trail.pos[o + 5] = z + czh;
    trail.n++;
  };
  // A degenerate pair splits the ribbon between pushes.
  if (trail.breakNext && trail.n > 0) { add(0); add(0); }
  add(0.22);
  trail.breakNext = false;
  trail.lastX = x; trail.lastZ = z;
  trail.g.attributes.position.needsUpdate = true;
  trail.g.setDrawRange(0, Math.max(0, (trail.n - 1) * 6));
}

// Snow spray.
const SPRAY_N = 220;
const sprayPos = new Float32Array(SPRAY_N * 3).fill(-9999);
const sprayVel = new Float32Array(SPRAY_N * 3);
const sprayLife = new Float32Array(SPRAY_N);
let sprayNext = 0;
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.24, transparent: true, opacity: 0.95, depthWrite: false }));
spray.frustumCulled = false;
scene.add(spray);
function emitSpray(n, x, y, z, dirx, dirz, power) {
  for (let i = 0; i < n; i++) {
    const k = sprayNext++ % SPRAY_N;
    sprayPos[k * 3] = x + (Math.random() - 0.5) * 0.6;
    sprayPos[k * 3 + 1] = y + 0.1;
    sprayPos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
    sprayVel[k * 3] = dirx * power * (0.5 + Math.random()) + (Math.random() - 0.5) * 2;
    sprayVel[k * 3 + 1] = 1.5 + Math.random() * 3;
    sprayVel[k * 3 + 2] = dirz * power * (0.5 + Math.random()) + (Math.random() - 0.5) * 2;
    sprayLife[k] = 0.6 + Math.random() * 0.5;
  }
}
function updateSpray(dt) {
  for (let k = 0; k < SPRAY_N; k++) {
    if (sprayLife[k] <= 0) continue;
    sprayLife[k] -= dt;
    sprayVel[k * 3 + 1] -= 9 * dt;
    sprayPos[k * 3] += sprayVel[k * 3] * dt;
    sprayPos[k * 3 + 1] += sprayVel[k * 3 + 1] * dt;
    sprayPos[k * 3 + 2] += sprayVel[k * 3 + 2] * dt;
    if (sprayLife[k] <= 0) sprayPos[k * 3 + 1] = -9999;
  }
  sprayGeo.attributes.position.needsUpdate = true;
}

// Aim reticle and dotted line, the target cursor of an arcade golf game.
const reticle = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.75, 40), new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.35, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, side: THREE.DoubleSide }));
  dot.rotation.x = -Math.PI / 2;
  const cross = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.3, 40, 1, 0, Math.PI * 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  cross.rotation.x = -Math.PI / 2;
  reticle.add(ring, dot, cross);
  reticle.renderOrder = 3;
  scene.add(reticle);
}
const AIM_DOTS = 160;
const aimDotPos = new Float32Array(AIM_DOTS * 3).fill(-9999);
const aimDotGeo = new THREE.BufferGeometry();
aimDotGeo.setAttribute('position', new THREE.BufferAttribute(aimDotPos, 3));
const aimDots = new THREE.Points(aimDotGeo, new THREE.PointsMaterial({ color: COLORS.gold, size: 0.45, transparent: true, depthWrite: false }));
aimDots.frustumCulled = false;
aimDots.renderOrder = 3;
scene.add(aimDots);

// ---------- Game state ----------
const TOTAL_PAR = HOLES.reduce((a, h) => a + h.par, 0);
let state = 'title';
let holeIdx = 0;
let scores = [];
let strokes = 0;
const player = { x: 0, z: 0, y: 0, heading: 0, crouch: 0, lean: 0, pitch: 0, stopSpin: 0, anim: 0 };
let aim = 0;
let techIdx = 0;
let lie = 'groomed';
let pred = null, predDirty = true;
let sim = null, simTech = null, fast = false, simWall = 0;
let shots = [];        // [{x0,z0,x1,z1}] for the map
let timer = 0, flyT = 0;
let lastShotInfo = '';

function startRound() {
  holeIdx = 0;
  scores = [];
  rng = mulberry32((Date.now() ^ 0x9e3779b9) >>> 0);
  ui.overlay.classList.remove('show');
  ui.hud.hidden = false;
  loadHole(0);
}

function loadHole(i) {
  holeIdx = i;
  setupHole(HOLES[i]);
  buildHole();
  strokes = 0;
  shots = [];
  player.x = 0; player.z = 0; player.y = height(0, 0);
  player.stopSpin = 0;
  lie = 'groomed';
  autoTech();
  ui.holeNo.textContent = i + 1;
  ui.holePar.textContent = `PAR ${H.par}`;
  ui.holeLen.textContent = `${Math.round(Math.hypot(H.pinX, H.pinZ))} M`;
  ui.holeName.textContent = H.def.name;
  state = 'flyover';
  flyT = 0;
  setHint(touchFirst ? 'TAP TO SKIP FLYOVER' : 'CLICK OR PRESS ENTER TO SKIP');
  updateHud();
}

function aimAtPin() {
  aim = Math.atan2(H.pinX - player.x, -(H.pinZ - player.z));
  predDirty = true;
}

// Caddie: like the arcade auto-target, pick a technique and a line that stays
// out of the trees and water and finishes nearest the gate at full power.
function autoTech() {
  aimAtPin();
  const direct = aim;
  const d = Math.hypot(H.pinX - player.x, H.pinZ - player.z);
  let best = null;
  for (let i = TECHS.length - 1; i >= 0; i--) {
    let mine = null;
    for (let k = 0; k <= 32; k++) {
      const da = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05;
      const p = predict(player.x, player.z, direct + da, i);
      if (p.result === 'trees' || p.result === 'creek' || p.result === 'net') continue;
      const lieEnd = surfaceAt(p.x, p.z);
      const miss = Math.hypot(H.pinX - p.x, H.pinZ - p.z) * (lieEnd === 'powder' ? 1.4 : lieEnd === 'moguls' ? 1.6 : 1);
      const score = miss + Math.abs(da) * 4;
      if (!mine || score < mine.score) mine = { score, i, a: direct + da, dist: p.dist };
    }
    if (!mine) continue;
    // The shortest technique that can reach, with a little to spare, wins.
    if (mine.dist >= d * 0.92) { best = mine; break; }
    if (!best || mine.score < best.score) best = mine;
  }
  if (best) { techIdx = best.i; aim = best.a; } else techIdx = 0;
  predDirty = true;
}

function beginAim() {
  state = 'aim';
  setHint(touchFirst ? 'PULL BACK, THEN FLICK UP' : 'PULL BACK AND FLICK UP, OR HOLD SPACE');
  updateHud();
}

function shoot(power, curve) {
  if (state !== 'aim') return;
  power = clamp(power, 0, 1.15);
  if (power < 0.03) { announce('WHIFF!', 'Swing a little harder', true); return; }
  curve = clamp(curve, -1, 1);
  const tech = TECHS[techIdx];
  const S = SURF[lie] || SURF.groomed;
  const over = Math.max(0, power - 1) * 4;
  const wild = S.wild + over * 0.08;
  const heading = aim + gauss() * (tech.spread * (0.4 + over) + wild * 0.12);
  const k = (curve + gauss() * wild) * tech.k;
  const v0 = tech.v * Math.sqrt(power) * S.lie;
  strokes++;
  sim = newSim(player.x, player.z, heading, v0, k, windVec(), tech.sail);
  simTech = tech;
  sim.x0 = player.x; sim.z0 = player.z;
  fast = false;
  simWall = 0;
  const curveWord = Math.abs(curve) < 0.12 ? 'STRAIGHT' : curve < 0 ? 'CARVE LEFT' : 'CARVE RIGHT';
  lastShotInfo = `${Math.round(power * 100)}% ${curveWord}`;
  state = 'shot';
  setHint(`${lastShotInfo} · ${touchFirst ? 'TAP' : 'CLICK'} TO FAST FORWARD`);
  emitSpray(14, player.x, player.y, player.z, Math.sin(heading), -Math.cos(heading), -2);
  meterShow(power, curve);
  updateHud();
}

function shotDone(result) {
  const s = sim;
  sim = null;
  lastSim = s;
  setHint('');
  shots.push({ x0: s.x0, z0: s.z0, x1: s.x, z1: s.z, result });
  const dist = Math.round(Math.hypot(s.x - s.x0, s.z - s.z0));
  let penalty = false;
  player.x = s.x; player.z = s.z; player.y = height(s.x, s.z);
  if (result === 'holed') {
    holeOut(s);
    return;
  }
  if (result === 'trees') {
    strokes++;
    penalty = true;
    const c = cx(s.z), side = Math.sign(s.x - c) || 1;
    player.x = c + side * (halfW(s.z) + 3);
    announce('TIMBER!', '+1 stroke · drop in the powder', true);
  } else if (result === 'creek') {
    strokes++;
    penalty = true;
    const c = H.creek;
    const z = c.z + c.half + 6;
    const cc = cx(z), hw = halfW(z);
    player.z = z;
    player.x = cc + clamp(s.x - cc, -hw + 2, hw - 2);
    announce('IN THE CREEK!', '+1 stroke · drop above the water', true);
  } else if (result === 'net') {
    player.z = H.netZ + 1;
    announce(s.hot ? 'TOO HOT!' : 'INTO THE B-NET', 'Skate it back up to the wands', true);
  } else {
    const surf = surfaceAt(s.x, s.z);
    const pin = Math.hypot(H.pinX - s.x, H.pinZ - s.z);
    if (pin < 1.0) {
      strokes++;
      shots.push({ x0: s.x, z0: s.z, x1: H.pinX, z1: H.pinZ, result: 'holed' });
      player.x = H.pinX; player.z = H.pinZ; player.y = height(H.pinX, H.pinZ);
      holeOut(s, true);
      return;
    }
    const msg = {
      groomed: dist > 150 ? ['MONSTER TUCK!', `${dist} M down the corduroy`] : ['ON THE CORDUROY', `${dist} M`],
      ice: ['ON THE ICE', 'Slick lie, watch the carve'],
      powder: ['IN THE POW', 'Deep lie, power drops'],
      moguls: ['MOGUL TRAP!', 'Rough lie, hard to control'],
      corral: [pin < 4 ? 'STICKED IT!' : 'IN THE CORRAL', `${pin.toFixed(1)} M to the gate`],
      kicker: ['ON THE KICKER', `${dist} M`],
    }[surf] || ['NICE', `${dist} M`];
    if (s.hot && pin > 1) { msg[0] = 'TOO HOT!'; msg[1] = 'Through the wands too fast'; }
    if (s.jumps && s.maxAir > 1.5 && surf !== 'powder' && surf !== 'moguls') { msg[0] = 'BIG AIR!'; msg[1] = `${s.airTime.toFixed(1)}s hang time · ${dist} M`; }
    announce(msg[0], msg[1], surf === 'powder' || surf === 'moguls' || s.hot);
    emitSpray(30, s.x, s.y, s.z, Math.sin(player.heading + 1.4), -Math.cos(player.heading + 1.4), 5);
    player.stopSpin = 1.3;
  }
  player.y = height(player.x, player.z);
  lie = surfaceAt(player.x, player.z);
  if (!SURF[lie]) lie = 'powder';
  if (strokes >= H.par + MAX_OVER) {
    state = 'pause';
    timer = 1.6;
    pendingPickup = true;
    return;
  }
  state = 'pause';
  timer = penalty ? 1.8 : 1.3;
  autoTech();
}
let pendingPickup = false;
let lastSim = null;

const SCORE_NAMES = { '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', 0: 'PAR', 1: 'BOGEY', 2: 'DOUBLE BOGEY', 3: 'TRIPLE BOGEY' };
function holeOut(s, tapIn) {
  const diff = strokes - H.par;
  const name = strokes === 1 ? 'HOLE IN ONE!' : SCORE_NAMES[diff] || `+${diff}`;
  const sub = tapIn ? 'Tap in' : `${strokes} ${strokes === 1 ? 'push' : 'pushes'}`;
  announce(name, sub, diff > 0);
  emitSpray(60, s.x, s.y, s.z, 0, -1, 4);
  scores[holeIdx] = strokes;
  state = 'holed';
  timer = 3.2;
  player.stopSpin = 1.3;
  updateHud();
}

function pickUp() {
  pendingPickup = false;
  scores[holeIdx] = H.par + MAX_OVER;
  announce('PICKED UP', `Max score ${H.par + MAX_OVER}`, true);
  state = 'holed';
  timer = 2.4;
  updateHud();
}

function showCard() {
  state = 'card';
  const last = holeIdx === HOLES.length - 1;
  const played = scores.filter((v) => v != null);
  const total = played.reduce((a, b) => a + b, 0);
  const parSoFar = HOLES.slice(0, played.length).reduce((a, h) => a + h.par, 0);
  let html = `<h2 class="gold">${last ? 'FINAL CARD' : `RUN ${holeIdx + 1} COMPLETE`}</h2>`;
  html += scorecard();
  if (last) {
    const diff = total - TOTAL_PAR;
    const isBest = !best || total < best;
    if (isBest) { best = total; try { localStorage.setItem('goldenski-best', String(best)); } catch (e) { /* ignore */ } }
    html += `<div class="big gold">${total} <small style="font-size:22px">(${fmtDiff(diff)})</small></div>`;
    html += `<p id="best">${isBest ? 'New course record!' : `Course record ${best} (${fmtDiff(best - TOTAL_PAR)})`}</p>`;
    ui.go.textContent = 'Play Again';
  } else {
    html += `<p id="best">Total ${total} · ${fmtDiff(total - parSoFar)} through ${played.length}</p>`;
    ui.go.textContent = 'Next Run';
  }
  ui.cardBody.innerHTML = html;
  ui.overlay.classList.add('show');
  ui.go.focus({ preventScroll: true });
}

function fmtDiff(d) { return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`; }

function scorecard() {
  const cell = (s, par) => {
    if (s == null) return '';
    const d = s - par;
    const cls = d <= -2 ? 'eagle' : d === -1 ? 'under' : d === 1 ? 'over' : d >= 2 ? 'dbl' : '';
    return `<span class="sc ${cls}">${s}</span>`;
  };
  let h = '<table class="scorecard"><thead><tr><th>RUN</th>';
  HOLES.forEach((_, i) => { h += `<th>${i + 1}</th>`; });
  h += '<th class="tot">TOT</th></tr></thead><tbody><tr><td>PAR</td>';
  HOLES.forEach((d) => { h += `<td>${d.par}</td>`; });
  h += `<td class="tot">${TOTAL_PAR}</td></tr><tr><td>YOU</td>`;
  let tot = 0;
  HOLES.forEach((d, i) => { const s = scores[i]; if (s != null) tot += s; h += `<td class="${i === holeIdx ? 'cur' : ''}">${cell(s, d.par)}</td>`; });
  h += `<td class="tot">${tot || ''}</td></tr></tbody></table>`;
  return h;
}

function next() {
  if (state === 'title') { startRound(); return; }
  if (state !== 'card') return;
  ui.overlay.classList.remove('show');
  if (holeIdx === HOLES.length - 1) startRound();
  else loadHole(holeIdx + 1);
}
ui.go.addEventListener('click', next);

// ---------- Announcer & HUD ----------
let announceTimer = 0;
function announce(text, sub, bad) {
  ui.announce.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'shout' + (bad ? ' bad' : '');
  el.textContent = text;
  if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
  ui.announce.appendChild(el);
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { if (el.parentNode) el.remove(); }, 2100);
}
function setHint(t) { ui.hint.textContent = t; }

function meterShow(power, curve) {
  ui.meterFill.style.height = `${Math.round((clamp(power, 0, 1.15) / 1.15) * 100)}%`;
  ui.meterPct.textContent = power > 0 ? `${Math.round(power * 100)}%` : '';
  ui.meterFill.style.transform = `skewX(${-(curve || 0) * 20}deg)`;
}

function updateHud() {
  if (!H) return;
  ui.shotNo.textContent = state === 'aim' || state === 'flyover' || state === 'pause' ? strokes + 1 : strokes;
  const played = scores.slice(0, holeIdx + 1).filter((v) => v != null);
  const parSoFar = HOLES.slice(0, played.length).reduce((a, h) => a + h.par, 0);
  ui.total.textContent = fmtDiff(played.reduce((a, b) => a + b, 0) - parSoFar);
  const tech = TECHS[techIdx];
  ui.techName.textContent = tech.name;
  ui.techDist.textContent = pred ? `${Math.round(pred.dist)} M` : '';
  const S = SURF[lie] || SURF.groomed;
  ui.lieName.textContent = `${S.name} ${Math.round(S.lie * 100)}%`;
  ui.toPin.textContent = `${Math.round(Math.hypot(H.pinX - player.x, H.pinZ - player.z))} M`;
  ui.windMph.textContent = H.wind.mph;
  const rel = ((H.wind.dir - aim) * 180) / Math.PI;
  ui.windArrow.style.transform = `rotate(${rel}deg)`;
  const showAim = state === 'aim';
  ui.aimL.hidden = ui.aimR.hidden = !showAim;
  ui.tech.disabled = !showAim;
}

// ---------- Overhead map ----------
const mapBase = document.createElement('canvas');
let mapScale = 1, mapW = 120, mapH = 180, mapMidX = 0, mapZTop = 0, mapZBot = 0;
function sizeMap() {
  const r = ui.map.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  mapW = Math.max(60, Math.round(r.width)); mapH = Math.max(90, Math.round(r.height));
  ui.map.width = mapW * dpr; ui.map.height = mapH * dpr;
  mapBase.width = ui.map.width; mapBase.height = ui.map.height;
  if (H) buildMapBase();
}
function toMap(x, z) {
  return [mapW / 2 + (x - mapMidX) * mapScale, mapH - 8 - (mapZBot - z) * mapScale];
}
function buildMapBase() {
  if (!H) return;
  const dpr = mapBase.width / mapW;
  const g = mapBase.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  mapZBot = 12; mapZTop = H.netZ - 4;
  let lo = Infinity, hi = -Infinity;
  for (let z = mapZBot; z >= mapZTop; z -= 5) { lo = Math.min(lo, cx(z) - halfW(z)); hi = Math.max(hi, cx(z) + halfW(z)); }
  mapMidX = (lo + hi) / 2;
  mapScale = Math.min((mapH - 16) / (mapZBot - mapZTop), (mapW - 16) / (hi - lo + TREE_GAP * 2));
  g.clearRect(0, 0, mapW, mapH);
  // trees
  g.fillStyle = '#1d4a35';
  g.fillRect(0, 0, mapW, mapH);
  g.fillStyle = 'rgba(255,255,255,.07)';
  for (let i = 0; i < 160; i++) g.fillRect((i * 37) % mapW, (i * 53) % mapH, 2, 2);
  const band = (extra, color) => {
    g.beginPath();
    for (let z = mapZBot; z >= mapZTop; z -= 2) { const [px, py] = toMap(cx(z) - halfW(z) - extra, z); z === mapZBot ? g.moveTo(px, py) : g.lineTo(px, py); }
    for (let z = mapZTop; z <= mapZBot; z += 2) { const [px, py] = toMap(cx(z) + halfW(z) + extra, z); g.lineTo(px, py); }
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  band(TREE_GAP, '#b9cde3');
  band(0, '#f5f9ff');
  // features
  for (const e of H.ice) {
    const [px, py] = toMap(e.x, e.z);
    g.fillStyle = '#8fc9ee';
    g.beginPath(); g.ellipse(px, py, e.rx * mapScale, e.rz * mapScale, 0, 0, Math.PI * 2); g.fill();
  }
  for (const m of H.moguls) {
    g.fillStyle = '#8d9db3';
    for (let z = m.z0; z >= m.z1; z -= 3) {
      for (let u = m.a; u <= m.b; u += 0.12) {
        const [px, py] = toMap(cx(z) + u * halfW(z), z);
        g.fillRect(px - 0.6, py - 0.6, 1.2, 1.2);
      }
    }
  }
  if (H.creek) {
    const c = H.creek;
    g.fillStyle = '#2c6fb0';
    const [ax, ay] = toMap(0, c.z + c.half);
    g.fillRect(0, ay, mapW, Math.max(2, c.half * 2 * mapScale));
    const [bx] = toMap(c.bx, c.z);
    g.fillStyle = '#f5f9ff';
    g.fillRect(bx - c.bw * mapScale, ay, c.bw * 2 * mapScale, Math.max(2, c.half * 2 * mapScale));
    void ax;
  }
  for (const k of H.kickers) {
    const [px, py] = toMap(k.x, k.lip);
    g.fillStyle = '#ff6a1a';
    g.fillRect(px - k.w / 2 * mapScale, py, k.w * mapScale, Math.max(2, k.l * mapScale));
  }
  // corral
  const [qx, qy] = toMap(H.pinX, H.pinZ);
  g.fillStyle = '#fffbe6';
  g.beginPath(); g.arc(qx, qy, CORRAL_R * mapScale, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffc21a'; g.lineWidth = 1.2; g.stroke();
  // net
  const [n1x, n1y] = toMap(cx(H.netZ) - halfW(H.netZ) - TREE_GAP, H.netZ);
  const [n2x] = toMap(cx(H.netZ) + halfW(H.netZ) + TREE_GAP, H.netZ);
  g.strokeStyle = '#ff6a1a'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(n1x, n1y); g.lineTo(n2x, n1y); g.stroke();
}
function drawMap() {
  if (!H) return;
  const dpr = ui.map.width / mapW;
  const g = ui.map.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, ui.map.width, ui.map.height);
  g.drawImage(mapBase, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // previous pushes
  g.strokeStyle = 'rgba(30,50,90,.8)'; g.lineWidth = 1; g.setLineDash([2, 2]);
  for (const s of shots) {
    const [a, b] = toMap(s.x0, s.z0), [c, d] = toMap(s.x1, s.z1);
    g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
  }
  g.setLineDash([]);
  // aim
  if (pred && (state === 'aim' || state === 'pause')) {
    g.strokeStyle = '#ffc21a'; g.lineWidth = 1.4; g.setLineDash([3, 2]);
    g.beginPath();
    pred.path.forEach((p, i) => { const [px, py] = toMap(p.x, p.z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke(); g.setLineDash([]);
    const [rx, ry] = toMap(pred.x, pred.z);
    g.beginPath(); g.arc(rx, ry, 3, 0, Math.PI * 2); g.stroke();
  }
  // flag
  const [fx, fy] = toMap(H.pinX, H.pinZ);
  g.strokeStyle = '#fff'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 10); g.stroke();
  g.fillStyle = '#e0261b';
  g.beginPath(); g.moveTo(fx, fy - 10); g.lineTo(fx + 7, fy - 7.5); g.lineTo(fx, fy - 5); g.fill();
  // skier
  const px = sim ? sim.x : player.x, pz = sim ? sim.z : player.z;
  const [sx, sy] = toMap(px, pz);
  g.fillStyle = '#e0261b'; g.strokeStyle = '#ffd23f'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(sx, sy, 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
}

// ---------- Input ----------
const keys = new Set();
let aimHold = 0, aimHoldT = 0;
let charge = null; // keyboard swing { t, curve }
let swing = null;  // pointer swing gesture

function changeTech(d) {
  if (state !== 'aim') return;
  techIdx = (techIdx + d + TECHS.length) % TECHS.length;
  predDirty = true;
  updateHud();
}
ui.tech.addEventListener('click', (e) => { e.stopPropagation(); changeTech(1); });

function bindAim(btn, dir) {
  const on = (e) => { e.preventDefault(); e.stopPropagation(); aimHold = dir; aimHoldT = 0; };
  const off = () => { if (aimHold === dir) aimHold = 0; };
  btn.addEventListener('pointerdown', on);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, off);
}
bindAim(ui.aimL, -1);
bindAim(ui.aimR, 1);

function skipOrFast() {
  if (state === 'flyover') { beginAim(); return true; }
  if (state === 'shot') { fast = true; return true; }
  if (state === 'pause' || state === 'holed') { timer = Math.min(timer, 0.15); return true; }
  return false;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (skipOrFast()) return;
  if (state !== 'aim' || charge) return;
  renderer.domElement.setPointerCapture?.(e.pointerId);
  swing = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, mode: 'idle', maxY: e.clientY, maxX: e.clientX, top: null, samples: [] };
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!swing || e.pointerId !== swing.id || state !== 'aim') return;
  const H2 = window.innerHeight;
  const dx = e.clientX - swing.x0, dy = e.clientY - swing.y0;
  const now = performance.now();
  if (swing.mode === 'idle') {
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) swing.mode = 'aim';
    else if (dy > 12) swing.mode = 'back';
  }
  if (swing.mode === 'aim') {
    const fine = lie === 'corral' ? 0.0012 : 0.003;
    aim += (e.clientX - swing.lx) * fine;
    predDirty = true;
  } else if (swing.mode === 'back') {
    if (e.clientY >= swing.maxY) { swing.maxY = e.clientY; swing.maxX = e.clientX; swing.top = now; }
    else if (swing.maxY - e.clientY > 8) { swing.mode = 'fwd'; swing.samples = [{ x: swing.maxX, y: swing.maxY, t: swing.top || now }]; }
    meterShow(0, 0);
    ui.meterPct.textContent = `${Math.round(clamp((swing.maxY - swing.y0) / (H2 * 0.22), 0, 1) * 100)}% BACK`;
  }
  if (swing.mode === 'fwd') {
    if (e.clientY > swing.maxY) { swing.mode = 'back'; swing.maxY = e.clientY; swing.top = now; }
    else {
      swing.samples.push({ x: e.clientX, y: e.clientY, t: now });
      const p = swingPower(swing, e.clientX, e.clientY, now);
      meterShow(p.power, p.curve);
      if (e.clientY < swing.y0 - H2 * 0.04) releaseSwing(e.clientX, e.clientY, now);
    }
  }
  swing && (swing.lx = e.clientX);
});
function swingPower(sw, x, y, now) {
  const H2 = window.innerHeight;
  const s0 = sw.samples[0];
  const dist = s0.y - y;
  const dt = Math.max(16, now - s0.t);
  const speed = dist / dt;                        // px per ms
  const power = clamp(speed / (H2 * 0.0016), 0, 1.15);
  const curve = clamp(((x - s0.x) / Math.max(30, dist)) * 1.6, -1, 1);
  return { power, curve };
}
function releaseSwing(x, y, now) {
  const sw = swing;
  swing = null;
  if (!sw || sw.mode !== 'fwd') return;
  const travel = sw.samples[0].y - y;
  if (travel < window.innerHeight * 0.05) { meterShow(0, 0); return; }
  const p = swingPower(sw, x, y, now);
  shoot(p.power, p.curve);
}
for (const ev of ['pointerup', 'pointercancel']) {
  renderer.domElement.addEventListener(ev, (e) => {
    if (!swing || e.pointerId !== swing.id) return;
    if (swing.mode === 'fwd' && ev === 'pointerup') releaseSwing(e.clientX, e.clientY, performance.now());
    else { if (swing.mode === 'back') setHint('FLICK UP TO PUSH OFF'); swing = null; meterShow(0, 0); }
  });
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.key);
  if (e.key === 'Enter') {
    if (ui.overlay.classList.contains('show')) { if (document.activeElement !== ui.go) next(); return; }
    skipOrFast();
    return;
  }
  if (e.key === ' ') {
    if (skipOrFast()) return;
    if (state === 'aim' && !swing) charge = { t: 0, curve: 0 };
    return;
  }
  if (state !== 'aim') return;
  if (e.key === 'ArrowUp' || e.key === 'w') changeTech(-1);
  if (e.key === 'ArrowDown' || e.key === 's') changeTech(1);
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.key);
  if (e.key === ' ' && charge) {
    const p = chargePower(charge.t);
    const c = charge.curve;
    charge = null;
    shoot(p, c);
  }
});
function chargePower(t) {
  // Ping-pong meter: up to 115% and back down, so holding too long costs power.
  const period = 2.2;
  const ph = (t % period) / period;
  return 1.15 * (ph < 0.5 ? ph * 2 : 2 - ph * 2);
}

// ---------- Camera ----------
const cam = { pos: new THREE.Vector3(0, 30, 40), look: new THREE.Vector3(0, 0, -40) };
const tPos = new THREE.Vector3(), tLook = new THREE.Vector3();
function cameraTarget() {
  const portrait = camera.aspect < 1;
  if (state === 'flyover') {
    const t = smooth(clamp(flyT / 4.2, 0, 1));
    const z = lerp(20, H.pinZ + 30, t);
    const x = cx(z);
    tPos.set(x, height(x, z) + 34 - t * 14, z + 34);
    const lz = z - 70 * (1 - t) - 30;
    tLook.set(cx(lz), height(cx(lz), lz), lz);
    return;
  }
  if (state === 'holed' || state === 'card') {
    const a = performance.now() / 2600;
    tPos.set(player.x + Math.sin(a) * 13, player.y + 6, player.z + Math.cos(a) * 13);
    tLook.set(player.x, player.y + 1, player.z);
    return;
  }
  let hx, hz, px, py, pz;
  if (sim) {
    const v = Math.hypot(sim.vx, sim.vz);
    const h = v > 0.5 ? Math.atan2(sim.vx, -sim.vz) : player.heading;
    hx = Math.sin(h); hz = -Math.cos(h);
    px = sim.x; pz = sim.z; py = sim.air ? sim.y * 0.5 + height(sim.x, sim.z) * 0.5 : sim.y;
    const back = portrait ? 10 : 8.5;
    tPos.set(px - hx * back, py + (portrait ? 5 : 4.2), pz - hz * back);
    tLook.set(px + hx * 14, py - 1, pz + hz * 14);
    return;
  }
  hx = Math.sin(aim); hz = -Math.cos(aim);
  px = player.x; pz = player.z; py = player.y;
  const putt = lie === 'corral';
  const reach = pred ? clamp(pred.dist, 8, 140) : 40;
  const back = putt ? 9 : portrait ? 14 : 12;
  const up = putt ? 7.5 : portrait ? 8 : 6.5;
  tPos.set(px - hx * back, py + up, pz - hz * back);
  const lx = px + hx * reach * 0.55, lz = pz + hz * reach * 0.55;
  tLook.set(lx, height(lx, lz), lz);
}
function updateCamera(dt, snap) {
  cameraTarget();
  if (snap || state === 'flyover') { cam.pos.copy(tPos); cam.look.copy(tLook); }
  else {
    const k = Math.min(1, dt * (sim ? 5 : 3.2));
    cam.pos.lerp(tPos, k);
    cam.look.lerp(tLook, Math.min(1, dt * (sim ? 7 : 4)));
  }
  cam.pos.y = Math.max(cam.pos.y, height(cam.pos.x, cam.pos.z) + 1.5);
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
}

// ---------- Per-frame sync ----------
function updateAimGraphics() {
  const show = state === 'aim' && pred;
  reticle.visible = !!show;
  aimDots.visible = !!show;
  if (!show) return;
  const pulse = 1 + Math.sin(performance.now() / 180) * 0.08;
  const sc = (0.7 + clamp(pred.dist / 90, 0, 1.6)) * pulse;
  reticle.position.set(pred.x, height(pred.x, pred.z) + 0.15, pred.z);
  reticle.scale.setScalar(sc);
  // dots evenly along the predicted path
  let n = 0, acc = 0;
  const gap = clamp(pred.dist / 40, 0.8, 4);
  for (let i = 1; i < pred.path.length && n < AIM_DOTS; i++) {
    const a = pred.path[i - 1], b = pred.path[i];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    while (acc <= seg && n < AIM_DOTS) {
      const f = seg ? acc / seg : 0;
      const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
      aimDotPos[n * 3] = x; aimDotPos[n * 3 + 1] = height(x, z) + 0.25; aimDotPos[n * 3 + 2] = z;
      n++;
      acc += gap;
    }
    acc -= seg;
  }
  for (let i = n; i < AIM_DOTS; i++) aimDotPos[i * 3 + 1] = -9999;
  aimDotGeo.attributes.position.needsUpdate = true;
}

function syncSkier(dt) {
  const p = player;
  let x = p.x, y = p.y, z = p.z, heading = aim, crouch = 0, lean = 0, air = false;
  if (sim) {
    x = sim.x; y = sim.y; z = sim.z;
    const v = Math.hypot(sim.vx, sim.vz);
    heading = v > 0.3 ? Math.atan2(sim.vx, -sim.vz) : p.heading;
    crouch = simTech.crouch;
    lean = clamp(sim.k * v * v * 0.25, -0.6, 0.6);
    air = sim.air;
    if (simTech.id === 'skate' || simTech.id === 'slide') p.anim += dt * v * 1.2;
  } else if (state === 'flyover' || state === 'aim' || state === 'title') {
    heading = aim;
  } else {
    heading = p.heading;
  }
  p.heading = heading;
  p.crouch += ((air ? 0.4 : crouch) - p.crouch) * Math.min(1, dt * 6);
  p.lean += (lean - p.lean) * Math.min(1, dt * 5);
  p.stopSpin = Math.max(0, p.stopSpin - dt * 1.5);
  skier.position.set(x, y, z);
  const hockey = p.stopSpin > 0 ? Math.sin(Math.min(1, p.stopSpin) * Math.PI) * 1.1 : 0;
  skier.rotation.y = -heading - hockey;
  const dx = Math.sin(heading), dz = -Math.cos(heading);
  const slope = (height(x + dx, z + dz) - height(x - dx, z - dz)) / 2;
  p.pitch += ((air ? -0.15 : Math.atan(slope)) - p.pitch) * Math.min(1, dt * 10);
  skier.rotation.x = p.pitch;
  skier.rotation.z = -p.lean;
  body.position.y = 0.9 - p.crouch * 0.24;
  upper.rotation.x = -p.crouch * 0.6;
  const stride = sim && (simTech.id === 'skate') ? Math.sin(p.anim) * 0.35 : 0;
  legParts[0].rotation.y = stride; legParts[1].rotation.y = -stride;
  for (const [i, a] of arms.entries()) {
    const target = air ? -1.8 : sim ? -0.4 - p.crouch * 0.6 : state === 'aim' ? -0.25 + (i ? 0.05 : 0) : -0.4;
    a.rotation.x += (target - a.rotation.x) * Math.min(1, dt * 8);
    a.rotation.z = air ? (i ? -0.6 : 0.6) : 0;
  }
  sun.position.set(x - 45, y + 60, z + 20);
  sun.target.position.set(x, y, z - 10);
}

// ---------- Loop ----------
let last = performance.now(), acc = 0, trailAcc = 0;
const test = { manual: false };

function tick(dt) {
  if (state === 'flyover') {
    flyT += dt;
    if (flyT > 4.6) beginAim();
  } else if (state === 'aim') {
    if (aimHold) {
      aimHoldT += dt;
      const rate = (lie === 'corral' ? 0.08 : 0.2) + Math.min(aimHoldT, 1.2) * (lie === 'corral' ? 0.25 : 0.6);
      aim += aimHold * rate * dt;
      predDirty = true;
    }
    const kl = keys.has('ArrowLeft') || keys.has('a'), kr = keys.has('ArrowRight') || keys.has('d');
    if (charge) {
      charge.t += dt;
      if (kl) charge.curve = Math.max(-1, charge.curve - dt * 2);
      if (kr) charge.curve = Math.min(1, charge.curve + dt * 2);
      meterShow(chargePower(charge.t), charge.curve);
    } else if (kl || kr) {
      aim += (kr - kl) * (lie === 'corral' ? 0.25 : 0.7) * dt;
      predDirty = true;
    }
  } else if (state === 'shot' && sim && !test.manual) {
    acc += dt * (fast ? FAST_SCALE : TIME_SCALE);
    while (acc >= STEP && sim) {
      acc -= STEP;
      const r = simStep(sim, STEP);
      if (r) { acc = 0; shotDone(r); break; }
    }
  } else if (state === 'pause') {
    timer -= dt;
    if (timer <= 0) { if (pendingPickup) pickUp(); else beginAim(); }
  } else if (state === 'holed') {
    timer -= dt;
    if (timer <= 0) showCard();
  }
  if (predDirty && H && state !== 'shot') {
    predDirty = false;
    pred = predict(player.x, player.z, aim, techIdx);
    updateHud();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (H) tick(dt);
  if (sim) {
    trailAcc += dt;
    if (trailAcc > 0.03) {
      trailAcc = 0;
      const v = Math.hypot(sim.vx, sim.vz);
      if (v > 0.3) {
        pushTrail(sim.x, sim.z, Math.atan2(sim.vx, -sim.vz), !sim.air);
        const S = surfaceAt(sim.x, sim.z);
        if ((S === 'powder' || S === 'moguls') && !sim.air) emitSpray(2, sim.x, sim.y, sim.z, -sim.vx / v, -sim.vz / v, 2);
      }
    }
  } else if (trail.n) trail.breakNext = true;
  if (H) {
    syncSkier(dt);
    updateAimGraphics();
    updateSpray(dt);
    updateCamera(dt, false);
    drawMap();
  }
  renderer.render(scene, camera);
}

document.addEventListener('visibilitychange', () => { last = performance.now(); acc = 0; keys.clear(); aimHold = 0; charge = null; swing = null; });

// Title screen: show the first run behind the card.
setupHole(HOLES[0]);
buildHole();
player.y = height(0, 0);
aimAtPin();
resize();
state = 'title';
flyT = 1.5;
{
  // A fixed establishing shot down the first run.
  cam.pos.set(-6, height(0, 0) + 9, 16);
  cam.look.set(cx(-90), height(cx(-90), -90), -90);
}
reticle.visible = aimDots.visible = false;
ui.go.focus({ preventScroll: true });
requestAnimationFrame(frame);

// Hook for automated tests: drive shots deterministically.
window.__golden = {
  HOLES, TECHS, SURF, test, player, predict, surfaceAt, height, cx, halfW,
  get state() { return state; }, get hole() { return H; }, get sim() { return sim; },
  get strokes() { return strokes; }, get scores() { return scores; }, get aim() { return aim; },
  set aim(v) { aim = v; predDirty = true; }, get techIdx() { return techIdx; }, set techIdx(v) { techIdx = v; predDirty = true; },
  get pred() { return pred; }, get lie() { return lie; }, get lastSim() { return lastSim; },
  seed(n) { rng = mulberry32(n); },
  start: startRound, load: loadHole, skip: skipOrFast, next, shoot, beginAim,
  // Run the current shot to completion instantly.
  finishShot() { while (sim) { const r = simStep(sim, STEP); if (r) { shotDone(r); break; } } },
  settle() { if (state === 'pause') { timer = 0; tick(0.016); } },
};

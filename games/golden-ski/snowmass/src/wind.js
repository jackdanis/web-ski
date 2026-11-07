// Wind (2026-11-03): a steady breeze with gusts that blows snow about. One wind for the whole mountain: its heading
// wanders slowly, its strength follows the weather (cloudier days blow harder, storms hardest), and gusts come and go
// every few seconds. Snow streams off crests that face into it (ridges, cornices, wind lips, roof edges show the
// same shape), and low drift snakes across the slopes near the camera; both only in ZONE below. The wind sound follows the gusts (audio.js).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { sample } from './world.js';
import { BOUNCE, SKY_COLOR, camera, renderer, scene } from './scene.js';

export const WIND = { x: 1, z: 0, speed: 4, gust: 0, crests: 0, alive: 0 };   // heading (unit), m/s, 0..1 how much of a gust is blowing
let t = 0;
const gs = { h: 0, gx: 0, gz: 0 };
const groundY = (x, z) => sample(x, z, gs).h;
// Where the blowing snow shows (Jack 2026-11-05): only the open top of Big Burn / Sheer Bliss at the foot of the
// Cirque, round the two lift tops and the Cirque T-Bar bottom; nowhere else on the mountain for now.
const ZONE = { x: -120, z: -1010, r: 300, edge: 60 };
const inZone = (x, z) => Math.min(1, Math.max(0, (ZONE.r - Math.hypot(x - ZONE.x, z - ZONE.z)) / ZONE.edge));
// smooth 0..1 noise from a few sines that never line up
const wave = (s, a, b, c) => 0.5 + 0.22 * Math.sin(s * a) + 0.17 * Math.sin(s * b + 1.3) + 0.11 * Math.sin(s * c + 4.1);

// ---------- Particles: one pool, each a soft square of snow; plumes off crests and drift along the ground ----------
const N = 3000;
const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), age = new Float32Array(N);
const kind = new Uint8Array(N);              // 0 free, 1 plume, 2 ground drift
const size = new Float32Array(N), alpha = new Float32Array(N), lift = new Float32Array(N);
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
const mat = new THREE.ShaderMaterial({
  uniforms: { uLight: { value: BOUNCE }, uSky: { value: SKY_COLOR }, uPx: { value: 1 } },
  vertexShader: `attribute float aSize, aAlpha; varying float vA; uniform float uPx;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(floor(aSize * uPx / -mv.z + 0.5), 1.0, 2.0); vA = aAlpha; }`,
  // Jack 2026-11-07: super subtle, most of it one white pixel (a near few are 2). Alpha cut by a 4x4 ordered dither
  // so it stays hard pixels, like the rest of the retro look.
  fragmentShader: `uniform vec3 uLight, uSky; varying float vA;
    void main() {
      vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
      float d = mod(q.x * 4.0 + q.y * 9.0 + floor(q.x / 2.0) * 3.0, 16.0) / 16.0 + 0.03;
      if (vA < d) discard;
      gl_FragColor = vec4(min(uLight * 1.25 + 0.08, vec3(1.0)), 1.0);
      #include <colorspace_fragment>
    }`,
  depthWrite: false,
});
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
scene.add(points);
let next = 0;
function spawn(k, x, y, z, vx, vy, vz, l, s, up) {
  for (let n = 0; n < N; n++) {
    const i = (next + n) % N;
    if (kind[i]) continue;
    next = (i + 1) % N;
    kind[i] = k; age[i] = 0; life[i] = l; size[i] = s; lift[i] = up;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    return;
  }
}

// ---------- Crests: points near the camera where the snow tops out across the wind ----------
// rescanned every second on a 12 m grid within 220 m: a crest is higher than the snow
// 15 m up- and downwind and drops away on the lee side, so that is where snow blows off.
export const crests = [];
let scanT = 0;
function scanCrests() {
  crests.length = 0;
  const cx = camera.position.x, cz = camera.position.z, R = 220, S = 12, wx = WIND.x, wz = WIND.z;
  for (let a = -R; a <= R; a += S) for (let b = -R; b <= R; b += S) {
    if (a * a + b * b > R * R) continue;
    const x = cx + a + ((b * 7) % 5), z = cz + b + ((a * 3) % 5);
    const h = groundY(x, z), up = groundY(x - wx * 15, z - wz * 15), lee = groundY(x + wx * 15, z + wz * 15);
    const rise = h - up, drop = h - lee;
    if (rise > -1.5 && drop > 2 && 2 * h - up - lee > 1.2 && inZone(x, z) > Math.random()) crests.push({ x, z, h, k: Math.min(1, (drop - 2) / 5) });
  }
  WIND.crests = crests.length;
}

export function updateWind(dt, cloudy, storm) {
  t += dt;
  const head = 0.9 + 0.6 * Math.sin(t / 240) + 0.25 * Math.sin(t / 77);
  WIND.x = Math.cos(head); WIND.z = Math.sin(head);
  WIND.gust = Math.pow(wave(t, 0.41, 0.97, 2.3), 2.2) * 1.6;
  const base = storm ? 11 : 2.5 + 3.5 * Math.min(1, cloudy);
  WIND.speed = base * (0.55 + 0.9 * WIND.gust);
  mat.uniforms.uPx.value = renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];   // pixels per metre at 1 m

  const near = Math.hypot(camera.position.x - ZONE.x, camera.position.z - ZONE.z) < ZONE.r + 220;
  if ((scanT -= dt) <= 0) { scanT = 1; if (near) scanCrests(); else { crests.length = 0; WIND.crests = 0; } }
  const g = Math.max(0, WIND.gust - 0.25) / 0.75, w = WIND.speed, wx = WIND.x, wz = WIND.z;
  // plumes: off a few crests each frame, more in a gust
  if (crests.length) {
    const want = g * g * 700 * dt * (storm ? 2 : 1);
    for (let n = 0; n < want || (Math.random() < want - n); n++) {
      const c = crests[(Math.random() * crests.length) | 0];
      const j = (Math.random() - 0.5) * 10, s = 0.05 + Math.random() * 0.03;
      spawn(1, c.x - wz * j, c.h + 0.2, c.z + wx * j, wx * w * (0.7 + 0.5 * Math.random()), 0.6 + 1.4 * Math.random() * (0.5 + c.k),
        wz * w * (0.7 + 0.5 * Math.random()), 2 + 2.5 * Math.random(), s, 0);
    }
  }
  // ground drift: thin snakes of snow skimming the slope round the camera, in strings along the wind
  const dw = near ? (0.1 + g) * 22 * dt * (storm ? 1.6 : 1) : 0;
  for (let n = 0; n < dw; n++) {
    const a = Math.random() * 6.283, r = 8 + Math.random() * 70;
    const x0 = camera.position.x + Math.cos(a) * r, z0 = camera.position.z + Math.sin(a) * r;
    if (inZone(x0, z0) <= Math.random()) continue;
    const y0 = groundY(x0, z0) + 0.05;
    for (let k = 0; k < 10; k++) {
      const x = x0 - wx * k * 0.35 + (Math.random() - 0.5) * 0.2, z = z0 - wz * k * 0.35 + (Math.random() - 0.5) * 0.2;
      spawn(2, x, y0, z, wx * w * 0.9, 0, wz * w * 0.9, 2.5 + Math.random() * 2, 0.04 + Math.random() * 0.02, 0.08 + Math.random() * 0.4);
    }
  }
  for (let i = 0; i < N; i++) {
    if (!kind[i]) { if (alpha[i]) alpha[i] = 0; continue; }
    age[i] += dt;
    const f = age[i] / life[i];
    if (f >= 1) { kind[i] = 0; alpha[i] = 0; continue; }
    const j = i * 3;
    // the gusts push everything along the wind; plumes billow up then settle, drift hugs the snow
    vel[j] += (wx * w - vel[j]) * dt * 1.5; vel[j + 2] += (wz * w - vel[j + 2]) * dt * 1.5;
    if (kind[i] === 1) vel[j + 1] -= 0.35 * dt;
    pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
    if (kind[i] === 2 && (i + (t * 60 | 0)) % 4 === 0) {
      const gy = groundY(pos[j], pos[j + 2]) + lift[i] * Math.sin(f * 3.1416);
      pos[j + 1] += (gy - pos[j + 1]) * 0.6;
    }
    const fade = Math.min(f / 0.15, 1, (1 - f) / 0.35);
    alpha[i] = (kind[i] === 1 ? 0.6 : 0.45) * fade * (kind[i] === 1 ? 1 - 0.4 * f : 1);
  }
  WIND.alive = kind.reduce((a, k) => a + (k ? 1 : 0), 0);
  geo.attributes.position.needsUpdate = true; geo.attributes.aAlpha.needsUpdate = true; geo.attributes.aSize.needsUpdate = true;
}

// Lamps, painted shadows, storm snowfall, time of day and the pixel look.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { CELL, PAGE, X0, Z0 } from './world.js';
import { BOUNCE, FOG, LIGHT, SH_PX, SH_SIZE, SKIES, SKY_COLOR, SNOW_ALBEDO, SUN_COLOR, SUN_DIR, TIMES, camera, canvas, renderer, scene, sky } from './scene.js';
import { casters, lampList } from './buildings.js';
import { atlas, pages, treeMat } from './trees.js';
import { kickMatMat, kickSnowMat } from './lifts.js';
import { placeCarriers } from './ride.js';

export let timeOfDay = 'noon';

// ---------- Lamps: one per terminal hut, lit at night ----------
const bulbMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a });
{
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), bulbMat, Math.max(1, lampList.length));
  lampList.forEach((p, n) => m.setMatrixAt(n, new THREE.Matrix4().setPosition(p.x, p.y + 0.3, p.z)));
  scene.add(m);
}
function updateLamps() {
  const cpos = camera.position;
  const near = lampList.slice().sort((a, b) => a.distanceToSquared(cpos) - b.distanceToSquared(cpos));
  for (let i = 0; i < 4; i++) LIGHT.uLamps.value[i].copy(near[i] || new THREE.Vector3(0, -1e5, 0));
}

// ---------- Shadows: trees, rocks and towers painted top down around the camera ----------
const shCanvas = document.createElement('canvas');
shCanvas.width = shCanvas.height = SH_PX;
const shCtx = shCanvas.getContext('2d');
const shTex = new THREE.CanvasTexture(shCanvas);
shTex.magFilter = shTex.minFilter = THREE.NearestFilter; shTex.generateMipmaps = false;
LIGHT.uShadow.value = shTex;
let shLast = 0;
// a caster's shadow: an ellipse along the sun, as painted; shadowGeo() is shared with sunAt
function shadowGeo() {
  const s = SUN_DIR, flat = Math.hypot(s.x, s.z) || 1e-3, ang = Math.atan2(s.x, -s.z);
  return { s, flat, dx: -s.x / flat, dz: -s.z / flat, ang, ca: Math.cos(ang), sa: Math.sin(ang) };
}
const shadowLen = (G, h) => Math.min(h * 4, h * G.flat / Math.max(0.15, G.s.y));
// the tree pages a shadow pass reads: only built ones; a page built later marks the canvas for a repaint
function forPages(x0, z0, x1, z1, fn) {
  const P = PAGE * CELL;
  for (let b = Math.floor((z0 - Z0) / P); b <= Math.floor((z1 - Z0) / P); b++) for (let a = Math.floor((x0 - X0) / P); a <= Math.floor((x1 - X0) / P); a++) {
    const pg = pages.get(a * 1000 + b);
    if (pg) fn(pg);
  }
}
function paintShadows(force) {
  const cx = camera.position.x, cz = camera.position.z, now = performance.now();
  const moved = !state.shAt || Math.hypot(cx - state.shAt.x, cz - state.shAt.z) >= SH_SIZE * 0.18;
  if (!force && !moved && !(state.shDirty && now - shLast > 500)) return;
  if (moved || force) state.shAt = { x: cx, z: cz };
  state.shDirty = false; shLast = now;
  const ox = Math.round((state.shAt.x - SH_SIZE / 2) / 8) * 8, oz = Math.round((state.shAt.z - SH_SIZE / 2) / 8) * 8;
  LIGHT.uShO.value.set(ox, oz);
  const g = shCtx, k = SH_PX / SH_SIZE, G = shadowGeo();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, SH_PX, SH_PX); g.fillStyle = '#fff';
  const one = (x, z, h, w) => {
    const len = shadowLen(G, h);
    const px = (x + G.dx * len / 2 - ox) * k, pz = (z + G.dz * len / 2 - oz) * k, r = (len / 2 + w * 0.3) * k;
    if (px < -r || pz < -r || px > SH_PX + r || pz > SH_PX + r) return;
    g.setTransform(1, 0, 0, 1, px, pz); g.rotate(G.ang);
    g.beginPath(); g.ellipse(0, 0, Math.max(0.6, w * k), r, 0, 0, Math.PI * 2); g.fill();
  };
  forPages(ox - 60, oz - 60, ox + SH_SIZE + 60, oz + SH_SIZE + 60, (pg) => {
    for (const t of pg.list) one(t.x, t.z, t.height, t.height * atlas.rects[t.kind].aspect * 0.32);
    for (const r of pg.rocks) one(r.x, r.z, r.height, r.s * 0.8);
  });
  for (const c of casters) one(c.x, c.z, c.h, c.w);
  g.setTransform(1, 0, 0, 1, 0, 0);
  shTex.needsUpdate = true;
}
// sun reaching a point, for Goldie: the same ellipses tested directly, so the canvas is never read back
export function sunAt(x, z) {
  if (!state.shAt) return 1;
  const G = shadowGeo(), W0 = 0.6 * SH_SIZE / SH_PX;
  const hit = (cx, cz, h, w) => {
    const len = shadowLen(G, h), R = len / 2 + w * 0.3, W = Math.max(W0, w);
    const ex = x - (cx + G.dx * len / 2), ez = z - (cz + G.dz * len / 2);
    if (Math.abs(ex) > R + W || Math.abs(ez) > R + W) return false;
    const lx = ex * G.ca + ez * G.sa, ly = -ex * G.sa + ez * G.ca;
    return (lx / W) * (lx / W) + (ly / R) * (ly / R) <= 1;
  };
  let lit = 1;
  forPages(x - 120, z - 120, x + 120, z + 120, (pg) => {
    if (!lit) return;
    for (const t of pg.list) if (hit(t.x, t.z, t.height, t.height * atlas.rects[t.kind].aspect * 0.32)) { lit = 0; return; }
    for (const r of pg.rocks) if (hit(r.x, r.z, r.height, r.s * 0.8)) { lit = 0; return; }
  });
  if (lit) for (const c of casters) if (hit(c.x, c.z, c.h, c.w)) return 0;
  return lit;
}

// ---------- Storm snowfall: flakes in a box that rides with the camera ----------
const FLAKES = 2200, FLAKE_BOX = 70;
const flakePos = new Float32Array(FLAKES * 3);
for (let i = 0; i < FLAKES * 3; i++) flakePos[i] = (Math.random() - 0.5) * FLAKE_BOX;
const flakes = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(flakePos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf4f7ff, size: 1.5, sizeAttenuation: false }));
  p.frustumCulled = false; p.visible = false;
  scene.add(p);
  return p;
})();
let flakeT = 0;
function updateFlakes(dt) {
  if (!flakes.visible) return;
  flakeT += dt;
  const c = camera.position, H2 = FLAKE_BOX / 2;
  const wrap = (v, o) => ((((v - o + H2) % FLAKE_BOX) + FLAKE_BOX) % FLAKE_BOX) - H2 + o;
  for (let i = 0; i < FLAKES; i++) {
    const j = i * 3;
    flakePos[j] = wrap(flakePos[j] + (1.6 + Math.sin(flakeT * 0.7 + i) * 0.8) * dt, c.x);
    flakePos[j + 1] = wrap(flakePos[j + 1] - (2.2 + (i % 7) * 0.15) * dt, c.y);
    flakePos[j + 2] = wrap(flakePos[j + 2] + 0.6 * dt, c.z);
  }
  flakes.geometry.attributes.position.needsUpdate = true;
}

// ---------- Time of day and the pixel look ----------
export let pixelLook = false;           // 320x180 look is a Tab toggle
export function applyTime(key) {
  timeOfDay = key;
  const T = TIMES[key];
  SUN_DIR.set(...T.sun).normalize();
  SUN_COLOR.set(...T.sunC); SKY_COLOR.set(...T.sky); SNOW_ALBEDO.set(...T.snow);
  FOG.set(T.fogC[0] / 255, T.fogC[1] / 255, T.fogC[2] / 255);
  LIGHT.uFogNear.value = T.fog[0]; LIGHT.uFogFar.value = T.fog[1];
  BOUNCE.copy(SUN_COLOR).multiplyScalar(Math.max(0, SUN_DIR.y)).addScaledVector(SKY_COLOR, 0.6).multiply(SNOW_ALBEDO);
  LIGHT.uLampC.value.set(...T.lamp);
  sky.material.map = SKIES[key]; sky.material.needsUpdate = true;
  scene.background.setRGB(FOG.x, FOG.y, FOG.z, THREE.SRGBColorSpace);
  treeMat.uniforms.uA.value = key === 'storm' ? atlas.stormMap : atlas.map;
  treeMat.uniforms.uN.value = key === 'storm' ? atlas.stormNormal : atlas.normal;
  bulbMat.color.set(key === 'night' ? 0xffe9a8 : 0x2a2a2a);
  flakes.visible = key === 'storm';
  setLamps(key === 'night');
  paintShadows(true);
}
// every Snowlight material, in the scene or not yet (run and kicker meshes), recompiled with or without LAMPS
function setLamps(on) {
  const mats = new Set([state.PATCH && state.PATCH.mat, kickSnowMat, kickMatMat]);
  scene.traverse((o) => { if (o.material) mats.add(o.material); });
  for (const m of mats) {
    if (!m || !m.isShaderMaterial || !m.fragmentShader.includes('lamps(') || !!(m.defines && m.defines.LAMPS) === on) continue;
    m.defines = Object.assign({}, m.defines);
    if (on) m.defines.LAMPS = 1; else delete m.defines.LAMPS;
    m.needsUpdate = true;
  }
}
export function setPixelLook(on) {
  pixelLook = on;
  resize();
}
export function updateWorld(dt) {
  placeCarriers(performance.now() / 1000);
  paintShadows(false);
  updateLamps();
  updateFlakes(dt);
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  // pixel look: short side at 180 px, upscaled without smoothing
  renderer.setPixelRatio(pixelLook ? 180 / Math.min(w, h) : Math.min(window.devicePixelRatio || 1, 2));
  canvas.style.imageRendering = pixelLook ? 'pixelated' : 'auto';
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Input, the Tab menu and freecam, and the simulation: skiing, jumps, collisions and bails.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { ASSIST, BAIL, BODY, BRAKE, CV, FLAT, G, HARD_IMPACT, MO, POP_COOLDOWN, PUSH, REAL_AIR, SKID, SKIER_R, STEP, STOP_TIME, TAKEOFF_MARGIN, TUCK_GRIP, cellKey, clamp, physics, wrapAngle } from './config.js';
import { CELL, META, NX, NZ, PAGE, SOLIDS, X0, Z0, groundY, normalFrom, offMap, sample, solidsAt, surfaceAt, treeCells } from './world.js';
import { TIMES, camera, canvas, fadeEl } from './scene.js';
import { makePage } from './trees.js';
import { STARTS, runStream, setPatch } from './slopes.js';
import { RIDES, RING_R, carrierAt, ride } from './ride.js';
import { applyTime, pixelLook, setPixelLook, timeOfDay } from './atmosphere.js';
import { FRAMES } from './goldie.js';

// ---------- Input ----------
// Keys: Left/Right or A/D steer, Up/W poles, Down/S brakes, Shift tucks, Space jumps (hold to load an ollie).
// Touch: drag to steer, rest to tuck, swipe down to pole, swipe up to brake, tap to jump. The newest finger steers.
export const input = { steer: 0, tuck: false, brake: false, pole: false, jump: false };
export const keys = new Set();
let keySteer = 0;
const STEER_PX = 70;
const ptr = { id: null, x0: 0, x: 0, y: 0, t0: 0, travel: 0, lastMove: 0, steer: 0, woke: false, hist: [], passive: false, topY: 0 };
const touches = new Map();      // finger id -> [x, y]
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'pole', KeyW: 'pole', ArrowDown: 'brake', KeyS: 'brake', ShiftLeft: 'tuck', ShiftRight: 'tuck', Space: 'jump' };
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;   // typing a note
  if (debugKey(e)) return;
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (state.phase === 'ride') { if (k === 'jump') skipRide(); return; }
  if (state.phase === 'ready') wake();
});
window.addEventListener('keyup', (e) => {
  if (FREE_KEYS[e.code]) free.keys.delete(FREE_KEYS[e.code]);
  const k = KEYMAP[e.code]; if (k) keys.delete(k);
  if (k === 'jump' && state.phase === 'skiing') input.jump = true;
});
window.addEventListener('blur', () => { keys.clear(); touches.clear(); ptr.id = null; ptr.steer = 0; state.hockeyStop = false; state.poleSwipe = false; free.keys.clear(); free.drag = false; });
function anchor(id, x, y, handedOver) {
  ptr.id = id;
  ptr.x0 = ptr.x = x; ptr.y = y;
  ptr.t0 = ptr.lastMove = performance.now();
  ptr.travel = handedOver ? Infinity : 0;  // a finger already down can't tap
  ptr.passive = handedOver;                // ...or tuck until it moves
  ptr.steer = 0;
  ptr.hist = [[ptr.t0, x, y]];
  ptr.topY = y;
}
canvas.addEventListener('pointerdown', (e) => {
  if (free.on) { if (e.button === 0) { free.drag = true; lockPointer(); } return; }
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  anchor(e.pointerId, e.clientX, e.clientY, false);
  state.hockeyStop = false;
  ptr.woke = state.phase === 'ready';
  canvas.setPointerCapture?.(e.pointerId);
  if (state.phase === 'ride') skipRide();
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
  // Hockey stop: a quick upward flick (40 px within 0.25 s); pulling back down cancels it.
  ptr.hist.push([now, ptr.x, ptr.y]);
  while (now - ptr.hist[0][0] > 250) ptr.hist.shift();
  const up = ptr.hist[0][2] - ptr.y, side = Math.abs(ptr.x - ptr.hist[0][1]);
  if (dy < 0 && up > 40 && up > 1.5 * side) { state.hockeyStop = true; ptr.topY = ptr.y; }
  ptr.topY = Math.min(ptr.topY, ptr.y);
  if (state.hockeyStop && ptr.y - ptr.topY > 20) state.hockeyStop = false;
  // Poles: a quick downward flick, one push each.
  const down = ptr.y - ptr.hist[0][2];
  if (dy > 0 && down > 40 && down > 1.5 * side) { state.poleSwipe = true; ptr.hist = [[now, ptr.x, ptr.y]]; }
  // keep the anchor within one full steer of the thumb so reversing is instant
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
    // Another finger still down takes over steering.
    const [id, [x, y]] = rest[rest.length - 1];
    anchor(id, x, y, true);
  } else {
    ptr.id = null; ptr.steer = 0;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Debug menu (Tab) ----------
// Freecam: WASD flies where you look, mouse looks, Shift is faster; Goldie holds still.
export const debugEl = document.getElementById('debug');
export const free = { on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set(), drag: false };
export const FREE_SPEED = 30;          // m/s
export const FREE_FAST = 10;           // Shift multiplier
const FREE_LOOK = 0.0022;       // rad per pixel
const FREE_KEYS = { KeyW: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right', ShiftLeft: 'fast', ShiftRight: 'fast' };
// on for testing; Tab turns it off
export const speedEl = Object.assign(document.createElement('div'), { hidden: false });
speedEl.style.cssText = 'position:fixed;top:12px;right:14px;font:600 15px ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 1px 2px #13244d;pointer-events:none';
document.body.append(speedEl);
const DEBUG_ITEMS = [
  { name: 'Freecam', get: () => free.on, set: (on) => setFreecam(on) },
  { name: 'Crashes: Steep-style bails', get: () => physics.crashes, set: (on) => { physics.crashes = on; } },
  { name: 'Show collision shapes', get: () => physics.shapes, set: (on) => { physics.shapes = on; } },
  { name: 'Speed readout', get: () => !speedEl.hidden, set: (on) => { speedEl.hidden = !on; } },
  { name: 'Perf stats (triangles, draws, frame ms)', get: () => perf.on, set: (on) => { perf.on = on; } },
  { name: 'Pixel look (320x180)', get: () => pixelLook, set: (on) => setPixelLook(on) },
  { name: 'Detailed runs (2 m)', get: () => state.patchOn, set: (on) => setPatch(on) },
  ...Object.keys(TIMES).map((k) => ({ name: TIMES[k].name, radio: true, get: () => timeOfDay === k, set: (on) => { if (on) applyTime(k); } })),
  ...STARTS.map((st) => ({ name: st.label, radio: true, get: () => META.start.x === st.x && META.start.z === st.z,
    set: (on) => { if (on) { Object.assign(META.start, st); if (free.on) setFreecam(false); toSummit(); } } })),
];
let menuSel = 0;
const menuRows = DEBUG_ITEMS.map((item, k) => {
  const li = document.createElement('li');
  li.setAttribute('role', item.radio ? 'menuitemradio' : 'menuitemcheckbox');
  li.innerHTML = `<span class="box${item.radio ? ' dot' : ''}"></span>${item.name}`;
  li.addEventListener('click', () => { menuSel = k; toggleItem(k); });
  debugEl.firstElementChild.append(li);
  return li;
});
function drawMenu() {
  menuRows.forEach((li, k) => {
    li.setAttribute('aria-checked', String(DEBUG_ITEMS[k].get()));
    li.classList.toggle('sel', k === menuSel);
  });
}
function openMenu(open) {
  debugEl.hidden = !open;
  if (open && document.pointerLockElement) document.exitPointerLock();
  drawMenu();
}
// Toggling a setting closes the menu, so freecam starts flying at once.
function toggleItem(k) {
  DEBUG_ITEMS[k].set(!DEBUG_ITEMS[k].get());
  openMenu(false);
}
// Keys the menu and freecam claim before the skier.
function debugKey(e) {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (!e.repeat) openMenu(debugEl.hidden);
    return true;
  }
  // With the menu open, Enter toggles the highlighted row.
  if (!debugEl.hidden && e.code === 'Enter') {
    e.preventDefault();
    if (!e.repeat) toggleItem(menuSel);
    return true;
  }
  if (!free.on) return false;
  const f = FREE_KEYS[e.code];
  if (f) { e.preventDefault(); free.keys.add(f); }
  return true;
}
// Phones: a three-finger tap toggles the menu.
canvas.addEventListener('touchstart', (e) => { if (e.touches.length === 3) openMenu(debugEl.hidden); }, { passive: true });
function lockPointer() {
  // Without pointer lock, drag with the button held to look.
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* drag to look */ }
}
export function setFreecam(on) {
  if (on === free.on) return;
  free.on = on;
  free.keys.clear(); free.vel.set(0, 0, 0); free.drag = false;
  if (on) {
    if (state.phase === 'back') toSummit();
    keys.clear(); keySteer = 0; touches.clear(); ptr.id = null; ptr.steer = 0; state.hockeyStop = false;
    free.pos.copy(camera.position);
    const d = camera.getWorldDirection(new THREE.Vector3());
    free.yaw = Math.atan2(d.x, -d.z);
    free.pitch = Math.asin(clamp(d.y, -1, 1));
    lockPointer();
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
    camera.near = 0.5; camera.updateProjectionMatrix();
    state.cameraSnap = true;
  }
}
document.addEventListener('mousemove', (e) => {
  if (!free.on || !debugEl.hidden) return;
  if (document.pointerLockElement !== canvas && !free.drag) return;
  free.yaw = wrapAngle(free.yaw + e.movementX * FREE_LOOK);
  free.pitch = clamp(free.pitch - e.movementY * FREE_LOOK, -1.55, 1.55);
});
window.addEventListener('pointerup', () => { free.drag = false; });
function readInput(dt) {
  if (state.testHold) {
    input.steer = clamp(state.testHold.steer || 0, -1, 1);
    input.tuck = !!state.testHold.tuck && !state.testHold.brake;
    input.brake = !!state.testHold.brake;
    input.pole = !!state.testHold.pole;
    return;
  }
  const target = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
  keySteer += clamp(target - keySteer, -7 * dt, 7 * dt);
  if (!target && Math.abs(keySteer) < 0.02) keySteer = 0;
  const now = performance.now();
  const held = ptr.id !== null;
  const still = held && !ptr.passive && now - ptr.lastMove > 200 && now - ptr.t0 > 200 && Math.abs(ptr.steer) < 0.25;
  input.steer = clamp(keySteer + (held ? ptr.steer : 0), -1, 1);
  input.brake = keys.has('brake') || state.hockeyStop;
  input.pole = keys.has('pole') || state.poleSwipe;
  input.tuck = !input.brake && (keys.has('tuck') || still);
}

// ---------- Simulation ----------
export const sk = {
  pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
  heading: 0, grounded: true, airTime: 0, airMax: 0, popCD: 0,
  crashed: false, crashT: 0, landT: 0, landQ: '', skid: 0, tuck: false, brake: false, steer: 0, frame: FRAMES.stand,
  stopT: 0,
  edge: 0, spin: 0, yawRate: 0, charge: 0, poleCD: 0, poleT: 0, pole: false,
  edgeA: 0, latA: 0, roll: 0, kappa: 0, lean: 0,
};
export let backT = 0, trips = 0;
export const tmpN = new THREE.Vector3(), tmpF = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
export const UP = new THREE.Vector3(0, 1, 0);
export const FLAT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export function placeSkier(x, z, heading, speed) {
  sk.pos.set(x, groundY(x, z), z);
  sk.prev.copy(sk.pos);
  sk.heading = heading;
  const s = sample(x, z);
  normalFrom(s, tmpN);
  skiDir(tmpN, tmpA);
  sk.vel.copy(tmpA).multiplyScalar(speed);
  sk.grounded = true; sk.airTime = 0; sk.airMax = 0; sk.popCD = 0;
  sk.crashed = false; sk.crashT = 0; sk.landT = 0; sk.skid = 0; sk.stopT = 0;
  sk.edge = 0; sk.spin = 0; sk.yawRate = 0; sk.charge = 0; sk.poleCD = 0;
  sk.edgeA = 0; sk.latA = 0; sk.roll = 0; sk.kappa = 0; sk.lean = 0;
  state.cameraSnap = true;
}
export function toSummit(at = META.start) {
  state.phase = 'ready';
  if (at === META.start) fadeEl.classList.remove('black');
  placeSkier(at.x, at.z, at.heading, 0);
  state.hockeyStop = false;
  // a start whose run tiles aren't loaded waits behind the fade
  const loads = runStream ? runStream(at.x, at.z, true) : [];
  if (!loads.length) { fadeEl.classList.remove('on'); return; }
  fadeEl.classList.add('on');
  Promise.all(loads).then(() => {
    if (state.phase === 'ready' && sk.pos.x === at.x && sk.pos.z === at.z) placeSkier(at.x, at.z, sk.heading, 0);
    fadeEl.classList.remove('on');
  });
}
// Lift ride: fade, ride (the camera follows her chair), fade, stand at the top.
// ride.t counts up from -FADE while the screen goes black, then through the ride.
const FADE = 0.45;
export function startRide(R) {
  state.phase = 'ride';
  Object.assign(ride, { lp: null, chair: null, R, t: -FADE, d: R.d0 });
  sk.vel.set(0, 0, 0);
  sk.edgeA = sk.lean = 0;
  state.hockeyStop = false;
  fadeEl.classList.add('black', 'on');
}
export function skipRide() {
  if (state.phase !== 'ride' || ride.t < 0) return;
  state.phase = 'unload';
  backT = 0;
  fadeEl.classList.add('on');
}
function rideStep(dt) {
  const R = ride.R;
  if (state.phase === 'unload') {
    if ((backT += dt) <= FADE) return;
    ride.lp = ride.chair = null;
    toSummit(R.top);
    return;
  }
  const was = ride.t;
  ride.t += dt;
  if (was < 0 && ride.t >= 0) {
    // black: seat her at the loading spot and fade in
    ride.lp = R.lp; ride.chair = R.chair;
    fadeEl.classList.remove('on');
    state.cameraSnap = true;
  }
  if (ride.t < 0) return;
  ride.d = Math.min(R.d1, R.d0 + ride.t * R.lp.speed);
  carrierAt(R.lp, ride.d, rideAt);
  sk.prev.copy(sk.pos);
  sk.pos.set(rideAt.x, rideAt.y, rideAt.z);
  sk.heading = Math.atan2(rideAt.fx, -rideAt.fz);
  if (ride.d >= R.d1 - R.lp.speed * FADE) skipRide();
}
const rideAt = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fx: 0, fz: 0 };
export function wake() {
  if (state.phase === 'ready') {
    state.phase = 'skiing';
    placeSkier(sk.pos.x, sk.pos.z, sk.heading, PUSH);
    input.jump = false;
  }
}
// The trip back up: fade out, then stand at the summit again.
function sendBack() {
  if (state.phase !== 'skiing') return;
  state.phase = 'back';
  backT = 0;
  trips++;
  fadeEl.classList.add('on');
}

export function skiDir(n, out) {
  out.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  out.addScaledVector(n, -out.dot(n));
  return out.normalize();
}

// ---------- Skiing: carve turns on Momentum ----------
const travelYaw = () => Math.atan2(sk.vel.x, -sk.vel.z);

function groundStep(dt) {
  const A = ASSIST;
  const s0 = sample(sk.pos.x, sk.pos.z);
  const n = normalFrom(s0, tmpN);
  const surf = surfaceAt(sk.pos.x, sk.pos.z);
  const nAcc = G * n.y;
  let speed = sk.vel.length();
  const yaw0 = travelYaw();

  // Steering asks for a share of the tightest clean turn at this speed: 7 m slow, wider with v^2.
  const latMax = surf.grip * CV.LAT_GRIP * (A.grip > 1 ? 1.1 : 1) * (sk.tuck ? TUCK_GRIP : 1) * nAcc;
  const kMax = Math.min(1 / CV.R_MIN, (CV.CLEAN * latMax) / Math.max(speed * speed, 1)) * (sk.tuck ? CV.TUCK_TURN : 1);
  // Edge changes take a moment.
  // The stick sets the wanted lean; the body follows with a lag. The lean bends the ski: radius = v^2 / (g tan lean),
  // so a held lean tightens as the turn climbs and slows: the turn finishes itself.
  const leanMax = Math.atan2(kMax * speed * speed, nAcc);
  sk.lean += (clamp(sk.steer, -1, 1) * leanMax - sk.lean) * (1 - Math.exp(-dt / CV.LEAN_T));
  const kHold = Math.tan(sk.lean) * nAcc / Math.max(speed * speed, 1);
  sk.kappa = clamp(kHold, -1.15 / CV.R_MIN, 1.15 / CV.R_MIN);
  let skiRate = sk.kappa * speed;
  // Slow, the skis pivot instead; brake + steer throws them sideways.
  skiRate += sk.steer * CV.PIVOT / (1 + speed / CV.PIVOT_V);
  const skidTurn = sk.brake && Math.abs(sk.steer) > 0.2;
  if (skidTurn) skiRate += sk.steer * CV.SKID_TURN;
  sk.heading = wrapAngle(sk.heading + skiRate * dt);
  // Lean that balances the turn (sprite and camera).
  sk.edgeA = Math.atan2(sk.kappa * speed * speed, nAcc);
  sk.edge = Math.min(1, Math.abs(sk.edgeA) / 1.1);
  const f = skiDir(n, tmpF);

  sk.vel.x += nAcc * n.x * dt;
  sk.vel.y += (-G + nAcc * n.y) * dt;
  sk.vel.z += nAcc * n.z * dt;
  sk.vel.addScaledVector(n, -sk.vel.dot(n));

  speed = sk.vel.length();
  sk.skid = 0;
  if (speed < 0.3) {
    const along = sk.vel.dot(f);
    sk.vel.copy(f).multiplyScalar(Math.max(0, along));
    speed = sk.vel.length();
  } else {
    // The edge pushes sideways up to the snow's grip (about 1.6 g groomed); past it the rest is a skid.
    tmpA.copy(sk.vel).divideScalar(speed);
    const alpha = Math.atan2(tmpB.crossVectors(tmpA, f).dot(n), tmpA.dot(f));
    const omega = latMax / Math.max(speed, 1.5);
    const turn = clamp(alpha, -omega * dt, omega * dt);
    tmpB.crossVectors(n, sk.vel);
    sk.vel.multiplyScalar(Math.cos(turn)).addScaledVector(tmpB, Math.sin(turn));
    const rest = Math.abs(alpha - turn);
    sk.skid = rest > Math.PI / 2 ? 1 : Math.sin(rest);
  }

  if (speed > 0) {
    const air = Math.exp(-sk.pos.y / CV.AIR_SCALE);
    const drag = (sk.tuck ? CV.TUCK_DRAG : CV.DRAG) * air * speed * speed + (speed > A.cap ? A.capDrag * (speed - A.cap) ** 2 : 0);
    let fric = surf.friction * (0.6 + 0.6 / (1 + speed / CV.GLIDE)) * nAcc;
    if (speed < 2) fric = Math.min(fric, 0.8 * G * Math.hypot(n.x, n.z));
    const brake = sk.brake ? (skidTurn ? CV.SKID_BRAKE : BRAKE) : 0;
    // A clean carve costs only the extra friction from the load (1.5 g sideways presses 1.8x harder). Skids scrub the real speed.
    const lat = Math.abs(sk.kappa) * speed * speed;
    const carveCost = (fric / nAcc) * (Math.hypot(nAcc, lat) - nAcc);
    const decel = fric + drag + SKID * sk.skid * nAcc + brake + carveCost;
    const next = Math.max(0, speed - decel * dt);
    sk.vel.multiplyScalar(next / speed);
    speed = next;
  }

  sk.poleCD = Math.max(0, sk.poleCD - dt);
  if (sk.pole && sk.poleCD === 0 && speed < MO.POLE_MAX) {
    sk.vel.addScaledVector(f, MO.POLE * (1 - speed / MO.POLE_MAX));
    sk.poleCD = MO.POLE_EVERY;
    sk.poleT = 0.22;
  }

  // Path turn rate and sideways g: spin for jumps, bank for the camera.
  sk.yawRate += (wrapAngle(travelYaw() - yaw0) / dt - sk.yawRate) * 0.3;
  sk.latA = sk.yawRate * speed;

  sk.popCD = Math.max(0, sk.popCD - dt);
  let popped = false;
  if (input.jump && sk.popCD === 0) {
    const pop = MO.OLLIE_MIN + (MO.OLLIE_MAX - MO.OLLIE_MIN) * clamp(sk.charge / MO.OLLIE_CHARGE, 0, 1);
    sk.vel.addScaledVector(n, pop * (1 - MO.OLLIE_UP)).addScaledVector(UP, pop * MO.OLLIE_UP);
    sk.popCD = POP_COOLDOWN;
    popped = true;
    sk.charge = 0;
  }

  sk.pos.addScaledVector(sk.vel, dt);
  const s1 = sample(sk.pos.x, sk.pos.z);
  const gap = sk.pos.y - s1.h;
  if (popped || gap > 0.5 * nAcc * dt * dt + TAKEOFF_MARGIN) {
    sk.grounded = false;
    sk.airTime = 0;
    sk.airMax = Math.max(0, gap);
    sk.spin = sk.yawRate;
    sk.latA = 0;
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
  const A = ASSIST;
  // Air steering torques the spin; let go and it carries on.
  if (sk.steer) sk.spin += sk.steer * MO.SPIN_IN * dt;
  else {
    sk.spin *= Math.max(0, 1 - MO.SPIN_DAMP * dt);
    // Assist: with nothing held and little spin, the skis drift back in line with travel.
    if (A.align && Math.abs(sk.spin) < 2) {
      sk.spin *= Math.max(0, 1 - 3 * dt);
      sk.heading += clamp(wrapAngle(travelYaw() - sk.heading), -A.align * dt, A.align * dt);
    }
  }
  sk.heading = wrapAngle(sk.heading + sk.spin * (sk.tuck ? MO.SPIN_TUCK : 1) * dt);
  const speed = sk.vel.length();
  sk.vel.y -= G * A.airG * dt;
  if (speed > 0) sk.vel.multiplyScalar(Math.max(0, 1 - (sk.tuck ? MO.TUCK_DRAG : MO.DRAG) * speed * dt));
  sk.pos.addScaledVector(sk.vel, dt);
  sk.airTime += dt;
  const s = sample(sk.pos.x, sk.pos.z);
  sk.airMax = Math.max(sk.airMax, sk.pos.y - s.h);
  if (sk.pos.y <= s.h) land(s);
}

// Landing keeps the momentum along the slope and absorbs only the part into the snow:
// steep landings keep speed, flat ones from high up hurt.
function land(s) {
  const A = ASSIST;
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
  if (physics.crashes && (miss > BAIL.MISS * Math.PI / 180 || impact > BAIL.IMPACT)) {
    startBail(null, impact);
  } else if (miss > A.clean * Math.PI / 180 || impact > HARD_IMPACT) {
    // The skis scrub off speed that isn't along them.
    sk.vel.multiplyScalar(Math.max(0.4, Math.cos(miss)));
    sk.landT = 0.45; sk.landQ = 'sloppy';
  } else {
    sk.landT = 0.25; sk.landQ = 'clean';
  }
}

// ---------- The pill, the plate and the bail box ----------
export const bail = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), still: 0 };
const BAIL_I = new THREE.Vector3((BAIL.T ** 2 + BAIL.L ** 2) / 12, (BAIL.W ** 2 + BAIL.L ** 2) / 12, (BAIL.W ** 2 + BAIL.T ** 2) / 12);
const BOX_C = [];
for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) BOX_C.push(new THREE.Vector3(a * BAIL.W / 2, b * BAIL.T / 2, c * BAIL.L / 2));
const bodyAxis = new THREE.Vector3(), bodyHit = new THREE.Vector3(), bodyP = new THREE.Vector3(), bodyN = new THREE.Vector3();
const bqi = new THREE.Quaternion(), bQ = new THREE.Quaternion(), bR = new THREE.Vector3(), bP = new THREE.Vector3(), bV = new THREE.Vector3();
export const bN = new THREE.Vector3(), bT = new THREE.Vector3(), bA = new THREE.Vector3(), bJ = new THREE.Vector3(), bM = new THREE.Vector3();
export const bS = { h: 0, gx: 0, gz: 0 }, bMat = new THREE.Matrix4();
// the pill's up axis, tipped by her lean
export function leanAxis(out) {
  const L = sk.grounded ? (sk.lean || sk.edgeA) : 0;
  return out.set(Math.cos(sk.heading) * Math.sin(L), Math.cos(L), Math.sin(sk.heading) * Math.sin(L));
}
// deepest ball overlap with any solid box: depth (0 for none), push-out direction in n
function ballVsSolids(px, py, pz, r, n) {
  let best = 0;
  for (const b of solidsAt(px, pz)) {
    // quick reject: hx + hz reaches past any corner
    if (Math.abs(px - b.x) > b.hx + b.hz + r || Math.abs(pz - b.z) > b.hx + b.hz + r) continue;
    const dx = px - b.x, dz = pz - b.z, u = b.c * dx - b.s * dz, v = b.s * dx + b.c * dz, y = py - b.y;
    let eu = u - clamp(u, -b.hx, b.hx), ey = y - clamp(y, -b.hy, b.hy), ev = v - clamp(v, -b.hz, b.hz), depth;
    const d = Math.hypot(eu, ey, ev);
    if (d > 1e-6) {
      if (d >= r) continue;
      depth = r - d; eu /= d; ey /= d; ev /= d;
    } else {                    // centre inside: out through the nearest face
      const fu = b.hx - Math.abs(u), fy = b.hy - Math.abs(y), fv = b.hz - Math.abs(v);
      eu = ey = ev = 0;
      if (fu <= fy && fu <= fv) { eu = Math.sign(u) || 1; depth = fu + r; }
      else if (fy <= fv) { ey = Math.sign(y) || 1; depth = fy + r; }
      else { ev = Math.sign(v) || 1; depth = fv + r; }
    }
    if (depth > best) { best = depth; n.set(b.c * eu + b.s * ev, ey, -b.s * eu + b.c * ev); }
  }
  return best;
}
// The pill against walls and boxes, swept along the step so fast skiers can't tunnel. Glancing hits slide; square fast hits bail.
function solidCollide() {
  if (!SOLIDS.length || sk.crashed) return;
  leanAxis(bodyAxis);
  const n = Math.max(1, Math.ceil(sk.prev.distanceTo(sk.pos) / 0.15));
  for (let k = 1; k <= n; k++) {
    bodyP.lerpVectors(sk.prev, sk.pos, k / n);
    let depth = 0;
    for (let t = 0; t <= 1; t += 0.5) {
      const h = BODY.R + t * (BODY.H - 2 * BODY.R);
      const d = ballVsSolids(bodyP.x + bodyAxis.x * h, bodyP.y + bodyAxis.y * h, bodyP.z + bodyAxis.z * h, BODY.R, bodyN);
      if (d > depth && Math.abs(bodyN.y) < 0.7) { depth = d; bodyHit.copy(bodyN); }
    }
    if (!depth) continue;
    bodyHit.y = 0;
    if (bodyHit.lengthSq() < 0.09) return;
    bodyHit.normalize();
    sk.pos.copy(bodyP).addScaledVector(bodyHit, depth);
    if (sk.grounded) sk.pos.y = groundY(sk.pos.x, sk.pos.z);
    const into = sk.vel.dot(bodyHit);
    if (into >= 0) return;
    if (physics.crashes && -into > BAIL.HIT) { startBail(bodyHit, -into); return; }
    sk.vel.addScaledVector(bodyHit, -into);
    const along = sk.vel.length();
    sk.vel.multiplyScalar(1 - 0.5 * (-into / (along - into)));   // square hits scrub more
    // pinned on a slope: ease along the downhill side
    if (sk.grounded && Math.hypot(sk.vel.x, sk.vel.z) < 1) {
      const s = sample(sk.pos.x, sk.pos.z);
      const side = (-bodyHit.z * -s.gx + bodyHit.x * -s.gz) >= 0 ? 1 : -1;
      sk.vel.x = -bodyHit.z * side * 1.2;
      sk.vel.z = bodyHit.x * side * 1.2;
    }
    return;
  }
}
// Bail: the pill and plate become one flat box, keeping her speed. A wall hit (n = outward face normal) bounces
// and flips her backward; a bad landing pitches her forward and rolls her toward her slide.
function startBail(n, hit) {
  leanAxis(bodyAxis);
  bA.set(Math.cos(sk.heading), 0, Math.sin(sk.heading));
  bA.addScaledVector(bodyAxis, -bA.dot(bodyAxis)).normalize();
  bJ.crossVectors(bodyAxis, bA);
  bail.q.setFromRotationMatrix(bMat.makeBasis(bA, bJ, bodyAxis));
  bail.pos.copy(sk.pos).addScaledVector(bodyAxis, BAIL.L / 2 + 0.05);
  bail.vel.copy(sk.vel);
  const speed = Math.hypot(sk.vel.x, sk.vel.z);
  if (n) {
    bail.vel.addScaledVector(n, -1.25 * bail.vel.dot(n)).multiplyScalar(0.6);
    bail.w.crossVectors(UP, n).multiplyScalar(clamp(hit * 0.45, 2, 9));
  } else {
    bM.set(sk.vel.x, 0, sk.vel.z).normalize();
    bail.w.crossVectors(UP, bM).multiplyScalar(clamp(speed * 0.35, 2, 8));
    const side = Math.sign(bM.x * Math.cos(sk.heading) + bM.z * Math.sin(sk.heading)) || 1;
    bail.w.addScaledVector(bM, -side * clamp(speed * 0.2, 0.5, 5));
  }
  bail.w.y += (Math.random() - 0.5) * 2;
  bail.still = 0;
  sk.crashed = true; sk.crashT = 0; sk.landT = 0; sk.grounded = false;
  sk.pos.copy(bail.pos); sk.vel.copy(bail.vel);
}
function invInertia(v, out) {
  out.copy(v).applyQuaternion(bqi);
  out.set(out.x / BAIL_I.x, out.y / BAIL_I.y, out.z / BAIL_I.z);
  return out.applyQuaternion(bail.q);
}
// speed change along d at r (from the centre) per unit impulse along d
function pointMass(r, d) {
  invInertia(bA.crossVectors(r, d), bA);
  return 1 + d.dot(bA.cross(r));
}
function push(r, J) {
  bail.vel.add(J);
  bail.w.add(invInertia(bA.crossVectors(r, J), bA));
}
// The bail box as a rigid body: eight corners hit snow and box tops with bounce and friction.
function bailStep(dt) {
  sk.crashT += dt;
  const SUB = 3, h = dt / SUB;
  let contact = false;
  for (let k = 0; k < SUB; k++) {
    bail.vel.y -= G * h;
    bail.pos.addScaledVector(bail.vel, h);
    const wl = bail.w.length();
    if (wl > 1e-6) bail.q.premultiply(bQ.setFromAxisAngle(bA.copy(bail.w).divideScalar(wl), wl * h)).normalize();
    bail.w.multiplyScalar(1 - 0.3 * h);
    bqi.copy(bail.q).invert();
    let deep = 0;
    for (let it = 0; it < 2; it++) {
      for (const c of BOX_C) {
        bR.copy(c).applyQuaternion(bail.q);
        bP.copy(bail.pos).add(bR);
        state.solidY = bP.y + 0.3;
        sample(bP.x, bP.z, bS);
        const pen = bS.h - bP.y;
        if (pen <= 0) continue;
        contact = true;
        normalFrom(bS, bN);
        if (it === 0 && pen > deep) { deep = pen; bM.copy(bN); }
        bV.crossVectors(bail.w, bR).add(bail.vel);
        const vn = bV.dot(bN);
        if (vn >= 0) continue;
        const jn = -(1 + (it === 0 ? BAIL.E : 0)) * vn / pointMass(bR, bN);
        push(bR, bJ.copy(bN).multiplyScalar(jn));
        bV.crossVectors(bail.w, bR).add(bail.vel);
        bT.copy(bV).addScaledVector(bN, -bV.dot(bN));
        const vt = bT.length();
        if (vt > 1e-4) {
          bT.divideScalar(vt);
          push(bR, bJ.copy(bT).multiplyScalar(-Math.min(vt / pointMass(bR, bT), BAIL.MU * jn)));
        }
      }
    }
    if (deep > 0) bail.pos.addScaledVector(bM, deep * 0.8);
    // walls and box sides
    const d = ballVsSolids(bail.pos.x, bail.pos.y, bail.pos.z, 0.35, bN);
    if (d) {
      bail.pos.addScaledVector(bN, d);
      const vn = bail.vel.dot(bN);
      if (vn < 0) bail.vel.addScaledVector(bN, -1.2 * vn);
    }
  }
  if (contact) bail.w.multiplyScalar(1 - 1.2 * dt);
  sk.pos.copy(bail.pos); sk.vel.copy(bail.vel);
  bail.still = contact && bail.vel.length() < 0.6 && bail.w.length() < 1 ? bail.still + dt : 0;
  if ((bail.still > 0.5 && sk.crashT > 1) || sk.crashT > BAIL.MAX) {
    state.solidY = bail.pos.y;
    const s = sample(bail.pos.x, bail.pos.z);
    placeSkier(bail.pos.x, bail.pos.z, Math.atan2(-s.gx, s.gz), PUSH);
  }
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
        if (!sk.crashed && physics.crashes && -into > BAIL.HIT) {
          startBail(tmpB.set(nx, 0, nz), -into);
        } else {
          // Brushing a trunk: lose the speed into it and slide round; a real knock is a hard stop.
          sk.vel.x -= into * nx;
          sk.vel.z -= into * nz;
          if (-into > 1) sk.vel.multiplyScalar(0.3);
          // stopped dead against it: ease round on the downhill side
          if (!sk.crashed && sk.grounded && Math.hypot(sk.vel.x, sk.vel.z) < 1) {
            const s = sample(sk.pos.x, sk.pos.z);
            const side = (-nz * -s.gx + nx * -s.gz) >= 0 ? 1 : -1;
            sk.vel.x = -nz * side * 1.2;
            sk.vel.z = nx * side * 1.2;
          }
        }
      }
    }
  }
}
// Collisions need the trees around the skier before the camera draws them.
function ensureTreesNear(x, z) {
  const P = PAGE * CELL;
  const pi = Math.floor((x - X0) / P), pj = Math.floor((z - Z0) / P);
  for (let b = pj - 1; b <= pj + 1; b++) for (let a = pi - 1; a <= pi + 1; a++) {
    if (a >= 0 && b >= 0 && a * PAGE < NX && b * PAGE < NZ) makePage(a, b);
  }
}

export function step() {
  const dt = STEP;
  readInput(dt);
  const jumpPressed = input.jump;
  input.jump = false;
  if (state.phase === 'back') {
    if ((backT += dt) > 0.45) toSummit();
    return;
  }
  if (state.phase === 'ride' || state.phase === 'unload') { rideStep(dt); return; }
  if (state.phase === 'ready') {
    sk.prev.copy(sk.pos);
    return;
  }
  sk.steer = input.steer;
  sk.tuck = input.tuck;
  sk.brake = input.brake;
  sk.pole = input.pole && !sk.brake;
  if (keys.has('jump') && sk.grounded && !sk.crashed) { sk.charge += dt; sk.tuck = true; }
  else if (!jumpPressed) sk.charge = 0;
  sk.poleT = Math.max(0, sk.poleT - dt);
  input.jump = jumpPressed && sk.grounded && !sk.crashed;

  sk.prev.copy(sk.pos);
  state.solidY = sk.pos.y;
  if (sk.crashed) bailStep(dt);
  else if (sk.grounded) groundStep(dt);
  else airStep(dt);
  input.jump = false;
  if (state.hockeyStop && (sk.vel.length() < 1 || sk.crashed || !sk.grounded)) state.hockeyStop = false;
  // a swipe's push waits out the pole cooldown, not a fall or jump
  if (state.poleSwipe && (sk.poleT > 0 || sk.crashed || !sk.grounded)) state.poleSwipe = false;
  sk.landT = Math.max(0, sk.landT - dt);
  ensureTreesNear(sk.pos.x, sk.pos.z);
  state.solidY = sk.pos.y;
  treeCollide();
  if (sk.crashed) { bail.pos.x = sk.pos.x; bail.pos.z = sk.pos.z; bail.vel.copy(sk.vel); }
  solidCollide();
  // FreePlay never dead-ends: stalled on flat ground or off the map edge, you go back to the summit.
  // Stopped on a slope never counts: you can point downhill and go.
  const under = sample(sk.pos.x, sk.pos.z);
  if (!sk.crashed && sk.grounded && sk.vel.length() < 1.5 && Math.hypot(under.gx, under.gz) < FLAT && !sk.pole) sk.stopT += dt;
  else sk.stopT = 0;
  if (sk.stopT > STOP_TIME || offMap(sk.pos.x, sk.pos.z)) sendBack();
  state.solidY = null;
  // into a lift's ring: ride it up
  if (state.phase === 'skiing' && !sk.crashed) for (const R of RIDES) {
    if (Math.hypot(sk.pos.x - R.ring.x, sk.pos.z - R.ring.z) < RING_R - 0.3 && Math.abs(sk.pos.y - R.ring.y) < 2) { startRide(R); break; }
  }
}
export const perf = { on: false, tris: 0, calls: 0, ms: 0 };   // Tab: Perf stats; ms is the game's own work per frame, smoothed

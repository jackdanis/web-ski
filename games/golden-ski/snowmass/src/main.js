// Rendering, the main loop and the test hooks. index.html loads this file.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { ASSIST, BAIL, BODY, CV, G, MO, STEP, clamp, physics, wrapAngle } from './config.js';
import { H, KICKERS, META, PCELL, POWDER, SOLIDS, aspen, cellAt, conifer, groundY, isRock, normalFrom, patchEdge, sample, sampleBase, samplePatch, surfaceAt } from './world.js';
import { GOLDIE, GOLDIE_AIR, GOLDIE_POLE, SUN_DIR, camera, goldieAirN, goldieAirT, goldieN, goldiePoleN, goldiePoleT, goldieT, renderer, runWork, scene, sky, updateTerrain, work } from './scene.js';
import { addBuilding, ringed, updateRings } from './buildings.js';
import { clumpGeo, fillGeo, pages, treeGeo, updateTrees } from './trees.js';
import { carriers, liftPaths, updateKickers } from './lifts.js';
import { PATCH_STEP, RUNS, STARTS, meshY, runStream, setPatch, signSpots, updatePatch } from './slopes.js';
import { LOAD, RIDES, carrierAt, ride, ringMat } from './ride.js';
import { applyTime, resize, setPixelLook, sunAt, updateWorld } from './atmosphere.js';
import { AIR_ELEVS, CARVE_EDGES, FLIP_SKIS, FRAMES, POLE_FRAMES, SHEET_H, SHEET_PX, SHEET_W, SHEET_YAWS, SKIER_LIT, SPRAY_N, shadow, skiUp, skierMat, skierMesh, skis, spray, sprayPoints } from './goldie.js';
import { FLAT_Q, FREE_FAST, FREE_SPEED, UP, bA, bMat, bail, debugEl, free, input, keys, leanAxis, perf, placeSkier, POLE_PHASES, setFreecam, sk, skiDir, skipRide, speedEl, startRide, step, tmpA, tmpN, toSummit, trips, wake } from './play.js';
import { drawMiniMap, hudMap, setFullMap, updateHudMap } from './hudmap.js';
import { notes, updateNotes } from './notes.js';

// ---------- Rendering ----------
const view = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, -1), camPos = new THREE.Vector3(), look = new THREE.Vector3();
const tmpC = new THREE.Vector3();
function updateCamera(p, dt) {
  const speed = sk.vel.length();
  tmpC.set(sk.vel.x, 0, sk.vel.z);
  if (sk.crashed || tmpC.lengthSq() < 4) tmpC.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  tmpC.normalize();
  if (state.cameraSnap) camDir.copy(tmpC);
  else camDir.lerp(tmpC, 1 - Math.exp(-2.5 * dt)).normalize();
  const back = 4.0 + speed * 0.025, up = 1.85 + speed * 0.01;
  camPos.copy(p).addScaledVector(camDir, -back);
  camPos.y = p.y + up;
  camPos.y = Math.max(camPos.y, groundY(camPos.x, camPos.z) + 1.5);
  if (state.cameraSnap) camera.position.copy(camPos);
  else camera.position.lerp(camPos, 1 - Math.exp(-7 * dt));
  camera.position.y = Math.max(camera.position.y, groundY(camera.position.x, camera.position.z) + 1.2);
  look.copy(p).addScaledVector(camDir, 4);
  look.y = p.y + 1.0;
  camera.lookAt(look);
  // Motion feel: the camera tilts with her lean (up to 6 degrees), easing in.
  const bankTo = sk.grounded && !sk.crashed ? clamp((sk.lean || sk.edgeA) * 0.11, -0.105, 0.105) : 0;
  sk.roll += (bankTo - sk.roll) * (state.cameraSnap ? 1 : 1 - Math.exp(-2 * dt));
  camera.rotateZ(-sk.roll);
  const fov = Math.min(78, 60 + speed * 0.4) * (camera.aspect < 1 ? 1.15 : 1);
  if (state.cameraSnap) { camera.fov = fov; camera.updateProjectionMatrix(); }
  else if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); }
  state.cameraSnap = false;
}

// On the chair or in the cabin: camera behind and above, looking up the line. R.seat is her sprite's base below the cable.
const rideLook = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fx: 0, fz: 0 };
function rideCamera(p) {
  const fx = Math.sin(sk.heading), fz = -Math.cos(sk.heading);
  const R = ride.R, ahead = Math.min(ride.d + 30, R.d1 + LOAD);
  carrierAt(R.lp, ahead, rideLook);
  camera.position.set(p.x - fx * 4.5, p.y - 1.5, p.z - fz * 4.5);
  // the sky is a band: don't tip up far enough to show its top edge
  const dist = Math.hypot(rideLook.x - camera.position.x, rideLook.z - camera.position.z);
  camera.lookAt(rideLook.x, Math.min(rideLook.y - 1.9, camera.position.y - dist * 0.02), rideLook.z);
  if (Math.abs(camera.fov - 60) > 0.05) { camera.fov = 60; camera.updateProjectionMatrix(); }
}
function pickFrame() {
  const speed = sk.vel.length();
  if (sk.crashed) return FRAMES.wipeout;
  // in the air: tucked while she flips, arms out otherwise
  if (!sk.grounded && sk.airTime > 0.12) return sk.flipIn || Math.abs(wrapAngle(sk.flip)) > 0.25 || Math.abs(sk.flipRate) > 1 ? FRAMES.flip : FRAMES.air;
  if (sk.landT > 0) return FRAMES.land;
  if (sk.brake && speed > 1) return FRAMES.brake;
  if (sk.tuck) return FRAMES.tuck;
  if (sk.poleP >= 0) {
    let i = 0, a = POLE_PHASES[0];
    while (sk.poleP >= a && i < 3) a += POLE_PHASES[++i];
    return POLE_FRAMES[i];
  }
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

const freeF = new THREE.Vector3(), freeR = new THREE.Vector3(), freeWant = new THREE.Vector3();
function updateFreecam(dt) {
  const cp = Math.cos(free.pitch);
  freeF.set(Math.sin(free.yaw) * cp, Math.sin(free.pitch), -Math.cos(free.yaw) * cp);
  freeR.set(Math.cos(free.yaw), 0, Math.sin(free.yaw));
  const k = free.keys;
  freeWant.copy(freeF).multiplyScalar((k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0))
    .addScaledVector(freeR, (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0));
  if (freeWant.lengthSq() > 0) freeWant.normalize().multiplyScalar(FREE_SPEED * (k.has('fast') ? FREE_FAST : 1));
  free.vel.lerp(freeWant, 1 - Math.exp(-10 * dt));
  free.pos.addScaledVector(free.vel, dt);
  camera.position.copy(free.pos);
  camera.lookAt(look.copy(free.pos).add(freeF));
  // high up, push the near plane out for depth precision
  const near = clamp((free.pos.y - groundY(free.pos.x, free.pos.z)) * 0.05, 0.5, 25);
  if (Math.abs(near - camera.near) > 0.02 * camera.near) { camera.near = near; camera.updateProjectionMatrix(); }
}

// The snow as drawn: flat triangles through the 2 m run points at the detail level showing (or the 10 m ground),
// while physics rides a smooth curve through the same points. The gap reaches tens of cm on bumps, so her card,
// skis and shadow sit on the drawn triangles. Stations, kickers, bridges and roofs are drawn where physics has them.
const drawnA = { h: 0, gx: 0, gz: 0 }, drawnB = { h: 0, gx: 0, gz: 0 };
let drawnG = null;
function drawnSnowDY(x, z) {
  const h = sampleBase(x, z, drawnA).h;
  if (Math.abs(sample(x, z, drawnB).h - h) > 0.01) return 0;
  const P = state.PATCH;
  if (!(state.patchOn && P && samplePatch(P, x, z, drawnB))) return clamp(meshY(x, z) - h, -0.6, 0.6);
  const g = drawnG && x >= drawnG.x0 && x < drawnG.x1 && z >= drawnG.z0 && z < drawnG.z1 ? drawnG
    : (drawnG = P.groups.find((q) => x >= q.x0 && x < q.x1 && z >= q.z0 && z < q.z1) || null);
  if (!g || g.level < 0) return 0;
  const st = PATCH_STEP[g.level], fx = (x - P.x0) / (PCELL * st), fz = (z - P.z0) / (PCELL * st);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, a = i * st, b = j * st;
  const c00 = P.at(a, b), c10 = P.at(a + st, b), c01 = P.at(a, b + st), c11 = P.at(a + st, b + st);
  if (c00 < 0 || c10 < 0 || c01 < 0 || c11 < 0) return 0;
  const h00 = P.hr[c00], h10 = P.hr[c10], h01 = P.hr[c01], h11 = P.hr[c11];
  // same diagonals as buildGroupMesh
  const t = (i + j) & 1
    ? (tx + tz <= 1 ? h00 + tx * (h10 - h00) + tz * (h01 - h00) : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11))
    : (tx >= tz ? h00 + tx * (h10 - h00) + tz * (h11 - h10) : h00 + tz * (h01 - h00) + tx * (h11 - h01));
  return clamp(t - h, -0.6, 0.6);
}
// Her frame: pose from the controls, angle and tilt from where the camera sits in her body's frame. Her body stands
// square to the slope while moving (upright when stopped, in the air or celebrating). The carve frames carry most of
// her lean; the skis roll onto their edges with the physics.
const bodyU = new THREE.Vector3(), bodyF = new THREE.Vector3(), bodyR = new THREE.Vector3(), camD = new THREE.Vector3();
const cardR = new THREE.Vector3(), cardU = new THREE.Vector3(), cardZ = new THREE.Vector3(), foot = new THREE.Vector3();
const cardM = new THREE.Matrix4(), skiN = new THREE.Vector3(), skiF = new THREE.Vector3(), skiR = new THREE.Vector3();
const DEG = 180 / Math.PI;
// Mid-flip: her body frame turned forward by sk.flip about her right side, round a point low on her back. The frame
// is the one drawn from the camera's direction in that body frame; the card turns in the screen to match the drawing's
// up, and the ski board turns with her.
const flipC = new THREE.Vector3(), flipUp = new THREE.Vector3();
function drawFlip(p) {
  sk.frame = FRAMES.flip;
  bodyF.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  bodyR.crossVectors(bodyF, UP);
  // the turning point sits where it is in the tuck when she is upright, so the skis start on her feet
  flipC.set(p.x, p.y, p.z).addScaledVector(UP, -FLIP_SKIS[0]).addScaledVector(bodyF, -FLIP_SKIS[1]);
  const c = Math.cos(sk.flip), s = Math.sin(sk.flip);
  bodyU.copy(UP).multiplyScalar(c).addScaledVector(bodyF, s);
  bodyF.multiplyScalar(c).addScaledVector(UP, -s);
  skierMat.uniforms.nudge.value = 0.5;
  camera.updateMatrixWorld();
  cardZ.setFromMatrixColumn(camera.matrixWorld, 2);
  camD.copy(camera.position).sub(flipC).normalize();
  const side = camD.dot(bodyR), mirror = side < 0;
  const yi = Math.round(Math.atan2(Math.abs(side), -camD.dot(bodyF)) * DEG / 22.5);
  const ei = Math.round((Math.asin(clamp(camD.dot(bodyU), -1, 1)) * DEG + 90) / 22.5);
  const yaw = SHEET_YAWS[yi], elev = AIR_ELEVS[ei];
  const [fx, fy, fw, fh, ax, ay] = GOLDIE_AIR.frames.flip[elev][yaw];
  const U = skierMat.uniforms, [AW, AH] = GOLDIE_AIR.size;
  U.map.value = goldieAirT; U.normalMap.value = goldieAirN;
  U.rect.value.set(fx / AW, fy / AH, fw / AW, fh / AH);
  U.mirror.value = mirror ? 1 : 0;
  // the drawing's up: her up tipped toward the camera by its elevation, round the side the camera is on
  const y = yaw / DEG, e = elev / DEG;
  flipUp.copy(bodyU).multiplyScalar(Math.cos(e)).addScaledVector(bodyF, Math.cos(y) * Math.sin(e)).addScaledVector(bodyR, (mirror ? 1 : -1) * Math.sin(y) * Math.sin(e));
  cardU.copy(flipUp).addScaledVector(cardZ, -flipUp.dot(cardZ));
  if (cardU.lengthSq() < 1e-6) cardU.setFromMatrixColumn(camera.matrixWorld, 1);
  cardU.normalize();
  cardR.crossVectors(cardU, cardZ).normalize();
  skierMesh.position.copy(flipC).addScaledVector(cardR, -(mirror ? fw - ax : ax) / SHEET_PX).addScaledVector(cardU, -(fh - ay) / SHEET_PX);
  skierMesh.quaternion.setFromRotationMatrix(cardM.makeBasis(cardR, cardU, cardZ));
  skierMesh.scale.set(fw / SHEET_PX, fh / SHEET_PX, 1);
  U.sunLocal.value.set(SUN_DIR.dot(cardR), SUN_DIR.dot(cardU), SUN_DIR.dot(cardZ));
  skis.visible = true;
  skiUp.copy(bodyU);
  skiR.crossVectors(bodyF, bodyU).normalize();
  skis.quaternion.setFromRotationMatrix(cardM.makeBasis(skiR, bodyF, bodyU));
  skis.position.copy(flipC).addScaledVector(bodyU, FLIP_SKIS[0]).addScaledVector(bodyF, FLIP_SKIS[1]);
}
function drawSkier(p, riding, dY) {
  let pose = riding ? FRAMES.sit : pickFrame();
  if (pose === FRAMES.flip) { drawFlip(p); return; }
  const crashed = sk.crashed && !riding;
  const n = normalFrom(sample(p.x, p.z), skiN);
  const moving = !riding && !crashed && sk.grounded && sk.vel.length() > 0.5 && pose !== FRAMES.air && pose !== FRAMES.celebrate;
  const e = sk.grounded && !crashed && !riding ? (sk.lean || sk.edgeA) : 0;
  // Moving, she carves: the frame drawn nearest the skis' edge angle, and the card turned by the rest so her legs
  // line up with the skis. Turning on the spot keeps the stand-still lean frames.
  let L = clamp(e * 0.25, -0.17, 0.17);
  if (moving && (pose === FRAMES.stand || pose === FRAMES.carveL || pose === FRAMES.carveR)) {
    const deg = Math.abs(e) * DEG;
    if (deg < CARVE_EDGES[0] / 2) pose = FRAMES.stand;
    else {
      const lvl = CARVE_EDGES.reduce((a, b) => (Math.abs(b - deg) < Math.abs(a - deg) ? b : a));
      pose = `carve${lvl}_${e > 0 ? 'r' : 'l'}`;
      L = clamp(e - Math.sign(e) * lvl / DEG, -0.17, 0.17);
    }
  }
  sk.frame = pose;
  bodyU.copy(moving ? n : UP);
  bodyF.set(Math.sin(sk.heading), 0, -Math.cos(sk.heading));
  if (e) {
    // motion feel: a little extra lean with her edges, on top of the lean drawn into the frames
    bodyR.crossVectors(bodyF, bodyU).normalize();
    bodyU.multiplyScalar(Math.cos(L)).addScaledVector(bodyR, Math.sin(L));
  }
  bodyF.addScaledVector(bodyU, -bodyF.dot(bodyU)).normalize();
  bodyR.crossVectors(bodyF, bodyU).normalize();
  foot.set(p.x, p.y + (riding ? ride.R.seat : dY), p.z);
  skierMat.uniforms.nudge.value = riding ? 0 : 0.5;
  camera.updateMatrixWorld();
  cardZ.setFromMatrixColumn(camera.matrixWorld, 2);
  camD.copy(camera.position).sub(foot).addScaledVector(bodyU, -0.9).normalize();
  const side = camD.dot(bodyR), mirror = !crashed && side < 0;
  const yi = Math.round(Math.atan2(Math.abs(side), -camD.dot(bodyF)) * DEG / 22.5);
  const elev = Math.asin(clamp(camD.dot(bodyU), -1, 1)) * DEG;
  let tilt = elev < 6 ? 0 : elev < 28.5 ? 12 : 45, yaw = SHEET_YAWS[yi];
  if (mirror) pose = pose.replace(/_([lr])$/, (_, s) => (s === 'l' ? '_r' : '_l'));
  if (crashed) { tilt = 12; yaw = 0; }
  const poling = pose.startsWith('pole_'), sheet = poling ? GOLDIE_POLE : GOLDIE, [SW, SH] = sheet.size;
  const [fx, fy, fw, fh, ax, ay] = sheet.frames[pose][tilt][yaw];
  const U = skierMat.uniforms;
  U.map.value = poling ? goldiePoleT : goldieT; U.normalMap.value = poling ? goldiePoleN : goldieN;
  U.rect.value.set(fx / SW, fy / SH, fw / SW, fh / SH);
  U.mirror.value = mirror ? 1 : 0;
  const w = fw / SHEET_PX;
  let hgt = fh / SHEET_PX;
  if (crashed) {
    // wipeout frame turned in the screen to lie along the bail box, centred on it
    bA.set(0, 0, 1).applyQuaternion(bail.q).transformDirection(camera.matrixWorldInverse);
    const th = Math.atan2(-bA.x, bA.y) - Math.PI, c = Math.cos(th), sn = Math.sin(th);
    cardR.setFromMatrixColumn(camera.matrixWorld, 0); cardU.setFromMatrixColumn(camera.matrixWorld, 1);
    bodyR.copy(cardR);
    cardR.multiplyScalar(c).addScaledVector(cardU, sn);
    cardU.multiplyScalar(c).addScaledVector(bodyR, -sn);
    skierMesh.position.copy(p).addScaledVector(cardR, -w / 2).addScaledVector(cardU, -hgt / 2);
  } else {
    // a frame drawn from higher up is squashed by cos(tilt): stretch it to the real camera height so her size holds
    const k = Math.cos(clamp(elev, 0, 60) / DEG) / Math.cos(tilt / DEG);
    hgt *= k;
    // the card faces the camera and turns in the screen so its up follows her body's up
    cardU.copy(bodyU).addScaledVector(cardZ, -bodyU.dot(cardZ));
    if (cardU.lengthSq() < 1e-6) cardU.setFromMatrixColumn(camera.matrixWorld, 1);
    cardU.normalize();
    cardR.crossVectors(cardU, cardZ).normalize();
    skierMesh.position.copy(foot).addScaledVector(cardR, -(mirror ? fw - ax : ax) / SHEET_PX).addScaledVector(cardU, -(fh - ay) / SHEET_PX * k);
  }
  skierMesh.quaternion.setFromRotationMatrix(cardM.makeBasis(cardR, cardU, cardZ));
  skierMesh.scale.set(w, hgt, 1);
  U.sunLocal.value.set(SUN_DIR.dot(cardR), SUN_DIR.dot(cardU), SUN_DIR.dot(cardZ));
  // skis on the ski plate, rolled onto their edges; the lower edge rests on the snow
  skis.visible = !riding && !crashed;
  if (skis.visible) {
    if (!sk.grounded) n.copy(UP);
    skiDir(n, skiF);
    skiR.crossVectors(skiF, n).normalize();
    skiUp.copy(n).multiplyScalar(Math.cos(e)).addScaledVector(skiR, Math.sin(e));
    skiR.crossVectors(skiF, skiUp).normalize();
    skis.quaternion.setFromRotationMatrix(cardM.makeBasis(skiR, skiF, skiUp));
    skis.position.copy(foot).addScaledVector(n, 0.012 + 0.15 * Math.sin(Math.abs(e)));
  }
}
function render(alpha, dt) {
  const p = view.copy(sk.prev).lerp(sk.pos, alpha);
  const snap = state.cameraSnap;
  state.workAll = snap;
  const riding = state.phase === 'ride' || state.phase === 'unload';
  if (free.on) updateFreecam(dt);
  else if (riding) rideCamera(p);
  else updateCamera(p, dt);
  updateTerrain();
  updatePatch();
  updateKickers();
  updateRings();
  updateTrees(snap);
  sky.position.set(camera.position.x, camera.position.y + sky.userData.h * 0.36, camera.position.z);

  const dY = riding ? 0 : drawnSnowDY(p.x, p.z);
  drawSkier(p, riding, dY);
  updateShapes(p);

  const s = sample(p.x, p.z);
  normalFrom(s, tmpN);
  shadow.position.set(p.x, s.h + dY + 0.06, p.z);
  shadow.quaternion.setFromUnitVectors(UP, tmpN).multiply(FLAT_Q);
  const lift = Math.max(0, p.y - s.h);
  shadow.material.opacity = clamp(1 - lift / 8, 0.2, 1);
  shadow.scale.setScalar(1 + lift * 0.08);

  shadow.visible = !riding;
  if (!riding) updateSpray(p, dt);
  ringMat.uniforms.time.value = performance.now() / 1000;
  if (!speedEl.hidden) speedEl.textContent = `${Math.round(sk.vel.length() * 2.23694)} mph · ${(Math.abs(sk.latA) / G).toFixed(1)} g · ${fps} fps${perf.on ? ` · ${Math.round(perf.tris / 1000)}k tris · ${perf.calls} draws · ${perf.ms.toFixed(1)} ms` : ''}`;
  updateWorld(dt);
  SKIER_LIT.uLit.value = sunAt(p.x, p.z);
  runWork();
  state.workAll = false;
  updateNotes();
  renderer.render(scene, camera);
  perf.tris = renderer.info.render.triangles; perf.calls = renderer.info.render.calls;
  updateHudMap();
}

// Collision shapes as wireframes (Tab: Show collision shapes)
const wire = (geo, color) => {
  const m = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
  m.renderOrder = 10; m.frustumCulled = false; m.visible = false; scene.add(m);
  return m;
};
const pillWire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.CapsuleGeometry(BODY.R, BODY.H - 2 * BODY.R, 3, 10)),
  new THREE.LineBasicMaterial({ color: 0x4fe3ff, depthTest: false, transparent: true, opacity: 0.8 }));
pillWire.renderOrder = 10; pillWire.frustumCulled = false; scene.add(pillWire);
const plateWire = wire(new THREE.BoxGeometry(BODY.PLATE_W, 0.04, BODY.PLATE_L), 0xffd23f);
const boxWire = wire(new THREE.BoxGeometry(BAIL.W, BAIL.T, BAIL.L), 0xff4d4d);
const shapeF = new THREE.Vector3(), shapeR = new THREE.Vector3(), shapeU = new THREE.Vector3();
function updateShapes(p) {
  const on = physics.shapes;
  pillWire.visible = plateWire.visible = on && !sk.crashed;
  boxWire.visible = on && sk.crashed;
  if (!on) return;
  if (sk.crashed) { boxWire.position.copy(p); boxWire.quaternion.copy(bail.q); return; }
  leanAxis(shapeU);
  pillWire.position.copy(p).addScaledVector(shapeU, BODY.H / 2);
  pillWire.quaternion.setFromUnitVectors(UP, shapeU);
  // plate on the snow along her skis, rolled by her lean
  normalFrom(sample(p.x, p.z), shapeU);
  skiDir(shapeU, shapeF);
  shapeR.crossVectors(shapeF, shapeU).normalize();
  const e = sk.grounded ? (sk.lean || sk.edgeA) : 0;
  shapeU.multiplyScalar(Math.cos(e)).addScaledVector(shapeR, Math.sin(e));
  shapeR.crossVectors(shapeF, shapeU).normalize();
  plateWire.quaternion.setFromRotationMatrix(bMat.makeBasis(shapeR, shapeU, shapeF.negate()));
  plateWire.position.copy(p).addScaledVector(shapeU, 0.03);
}
window.addEventListener('resize', resize);
// A window moved to another pixel density may not fire resize.
(function watchDensity() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { resize(); watchDensity(); }, { once: true });
})();

// ---------- Main loop ----------
let manual = false, acc = 0, last = performance.now();
let fps = 0, fpsN = 0, fpsT = 0;             // counted over half a second
function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  fpsN++; fpsT += now - last;
  if (fpsT >= 500) { fps = Math.round(fpsN * 1000 / fpsT); fpsN = 0; fpsT = 0; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!manual && !free.on) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { step(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
  }
  render(manual ? 1 : acc / STEP, dt);
  perf.ms += (performance.now() - t0 - perf.ms) * 0.1;
}
resize();
applyTime('noon');
toSummit();
requestAnimationFrame(frame);

// ---------- Test hooks ----------
window.__golden = {
  sk, input, META, physics, MO, ASSIST, CV, keys, sample, surfaceAt, renderer, camera, pages, scene,
  cover: (x, z) => { const k = cellAt(x, z); return { conifer: conifer(k), aspen: aspen(k), rock: isRock(k), powder: POWDER[k], h: H[k] }; },
  get phase() { return state.phase; },
  get trips() { return trips; },
  get trees() { return treeGeo.instanceCount + fillGeo.instanceCount; },
  get clumps() { return clumpGeo.instanceCount; },
  setManual(on) { manual = on; },
  get free() { return free; },
  get menuOpen() { return !debugEl.hidden; },
  freecam(on) { setFreecam(on); },
  // run n fixed steps; hold overrides input: { steer, flip, tuck, brake, jump }
  step(n, hold) {
    state.testHold = hold || null;
    for (let k = 0; k < n; k++) {
      if (hold && hold.jump && k === 0) input.jump = true;
      step();
    }
    state.testHold = null;
    if (n > 10) state.cameraSnap = true;
  },
  start() { wake(); },
  place(x, z, heading = META.start.heading, speed = 0) { state.phase = 'skiing'; placeSkier(x, z, heading, speed); },
  snapCamera() { state.cameraSnap = true; },
  frame(dt = 1 / 60) { render(1, dt); },
  time(k) { applyTime(k); },
  pixel(on) { setPixelLook(on); },
  lifts: liftPaths, carriers, runs: RUNS, signs: signSpots,
  map: { get ready() { return !!hudMap.plain; }, get paintMs() { return hudMap.paintMs; }, setFull: setFullMap, drawMini: drawMiniMap },
  get patch() { return state.PATCH; }, patchEdge, setPatch, groundY, starts: STARTS, get fps() { return fps; },
  streamTo: (x, z) => Promise.all(runStream ? runStream(x, z, true) : []),
  solids: SOLIDS, bail, BAIL, kickers: KICKERS,
  get work() { return work.size; }, perf, ringed, addBuilding, rides: RIDES, ride, startRide, skipRide, notes,
};

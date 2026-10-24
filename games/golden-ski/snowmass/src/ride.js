// The chairlift ride cutscene, and the chair and cabin models.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { UP_Y, clamp } from './config.js';
import { camera, scene } from './scene.js';
import { groundY } from './world.js';
import { DARK, STEEL, TILES, cablePts, merge, modelMat, part } from './buildings.js';
import { carriers, liftPaths } from './lifts.js';
import { STARTS } from './slopes.js';

// ---------- The lift ride ----------
// A ring of light on every chairlift's loading deck: ski in, fade, ride a chair up at the lift's real speed, fade,
// stand on the unload deck. Tap or Space skips to the last fade. The Tab menu's lift-top starts use the same spot.
// Gondolas: a ring where Jack pinned it outside the bottom station, a ride in a cabin, out at the top start.
export const RING_R = 2.5, LOAD = 4.5;      // m across the ring / 2; m from the wheel to load and unload
const CHAIR_SEAT = -3.05, CABIN_SEAT = -3.93; // her sprite's base below the cable: feet off the seat, on the cabin floor
const GONDOLA_RINGS = { 'Elk Camp Gondola': [1776.6, -5245.4] };
export const RIDES = [];
for (const lp of liftPaths) {
  const pin = lp.kind === 'gondola' && GONDOLA_RINGS[lp.name];
  if (pin) {
    const N = lp.pts.length, b = lp.g[0] <= lp.g[N - 1] ? 0 : N - 1;
    const top = STARTS.find((q) => q.label === `Start: ${lp.name} top`);
    if (!top) continue;
    const d0 = (b ? lp.L : 0) + LOAD, d1 = (b ? lp.L : 0) + lp.L - LOAD;
    RIDES.push({ lp, ring: { x: pin[0], z: pin[1], y: groundY(pin[0], pin[1]) }, top, d0, d1,
      chair: carriers.cabin.find((c) => c.lp === lp), seat: CABIN_SEAT, cabin: true });
    continue;
  }
  if (lp.kind !== 'chair_lift') continue;
  const N = lp.pts.length, b = lp.g[0] <= lp.g[N - 1] ? 0 : N - 1, t = N - 1 - b;
  const sb = lp.stn[b], st = lp.stn[t];
  if (!sb || !st) continue;
  // uphill along the line at each end; loaded chairs ride on its right
  const along = (i, j) => { const dx = lp.pts[j][0] - lp.pts[i][0], dz = lp.pts[j][1] - lp.pts[i][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const [bx, bz] = along(b, b ? b - 1 : 1), [tx, tz] = along(t ? t - 1 : 1, t);
  const ring = { x: sb.x + bx * LOAD + bz * lp.arm, z: sb.z + bz * LOAD - bx * lp.arm, y: sb.y };
  const top = { x: st.x - tx * LOAD + tz * lp.arm, z: st.z - tz * LOAD - tx * lp.arm };
  // off the chair she faces down the run
  const old = STARTS.find((q) => q.label === `Start: ${lp.name} top`);
  top.heading = old ? Math.atan2(old.x - top.x, -(old.z - top.z)) : Math.atan2(tx, -tz);
  if (old) Object.assign(old, top);
  // the ride in carrier distance: load spot to unload spot
  const d0 = (b ? lp.L : 0) + LOAD, d1 = (b ? lp.L : 0) + lp.L - LOAD;
  RIDES.push({ lp, ring, top, d0, d1, chair: carriers.chair.find((c) => c.lp === lp), seat: CHAIR_SEAT });
}
// ring: green wisps around a soft cyan glow on the deck
export const ringMat = new THREE.ShaderMaterial({
  uniforms: { time: { value: 0 } },
  transparent: true, depthWrite: false,
  vertexShader: `
    varying vec2 vP;
    void main() { vP = (uv - 0.5) * ${((RING_R + 0.8) * 2).toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float time;
    varying vec2 vP;
    void main() {
      float r = length(vP), a = atan(vP.y, vP.x), R = ${RING_R.toFixed(1)};
      // the soft cyan band, in patches that drift round
      float glow = exp(-pow((r - R) / 0.42, 2.0)) * (0.6 + 0.4 * sin(a * 3.0 + time * 0.7) * sin(a * 5.0 - time * 0.4));
      // green strands twisting round each other across it
      float w = 0.0;
      for (int k = 0; k < 9; k++) {
        float fk = float(k);
        float off = R + 0.26 * sin(a * (2.0 + fk) + time * (0.5 + 0.2 * fk) + fk * 1.7) + 0.08 * sin(a * (7.0 + 2.0 * fk) - time * 1.3);
        w += exp(-pow((r - off) / 0.05, 2.0)) * (0.55 + 0.45 * sin(a * (4.0 + fk) - time * (1.0 + 0.3 * fk)));
      }
      w = min(w, 1.0);
      vec3 col = mix(vec3(0.0, 0.78, 0.92), vec3(0.15, 0.95, 0.3), w);
      col = mix(col, vec3(0.8, 1.0, 0.8), w * w * 0.5);
      float alpha = clamp(glow * 0.85 + w, 0.0, 1.0);
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(col, alpha);
    }`,
});
for (const R of RIDES) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry((RING_R + 0.8) * 2, (RING_R + 0.8) * 2).rotateX(-Math.PI / 2), ringMat);
  m.position.set(R.ring.x, R.ring.y + 0.12, R.ring.z);
  m.renderOrder = 2;
  scene.add(m);
}
export const ride = { lp: null, chair: null, d: 0, t: 0, R: null };

// Physics lab start: Powderhorn
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cablePts), 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1a1c24 }));
  lines.frustumCulled = false;
  scene.add(lines);
}
// carriers: chairs, cabins and T-bar hangers, one instanced mesh each, hanging below the cable
// square tube from a to b, for the chair frame
function tube(a, b, r, col) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  const g = new THREE.BoxGeometry(r, d.length(), r);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP_Y, d.clone().normalize()));
  return part(g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2), col);
}
// Detachable quad chair: grip, hanger, frame, four cushions, back, armrests, bar raised. Faces +z; cable at y = 0.
const FRAME = [0.62, 0.64, 0.68], CUSH = [0.17, 0.18, 0.21];
const CHAIR_NEAR = 200, CHAIR_FAR = 2500;           // m: full model, then plain, then none
// frame side: down from the top bar, bowing out, to the seat end and under it to the back
const chairSide = (sx) => [
  tube([sx * 0.98, -1.2, -0.34], [sx * 1.16, -1.3, -0.34], 0.09, FRAME),
  tube([sx * 1.16, -1.3, -0.34], [sx * 1.25, -1.75, -0.36], 0.08, FRAME),
  tube([sx * 1.25, -1.75, -0.36], [sx * 1.24, -2.25, -0.34], 0.08, FRAME),
  tube([sx * 1.24, -2.25, -0.34], [sx * 1.2, -2.66, -0.1], 0.08, FRAME),
  tube([sx * 1.22, -2.3, -0.2], [sx * 1.22, -2.3, 0.38], 0.06, FRAME),                 // armrest
  tube([sx * 1.16, -1.3, -0.34], [sx * 1.14, -1.42, 0.3], 0.06, FRAME),                 // safety bar, raised
];
// Snowmass cabin: rounded, black below the belt, tinted glass above, logo on both sides, grey sill, curved hanger.
// Faces +z; cable at y = 0.
function roundRing(a, b, r, y, seg = 3) {
  const out = [];
  for (const [cx, cz, t0] of [[a - r, b - r, 0], [-(a - r), b - r, 0.5], [-(a - r), -(b - r), 1], [a - r, -(b - r), 1.5]])
    for (let k = 0; k <= seg; k++) { const t = (t0 + 0.5 * k / seg) * Math.PI; out.push([cx + r * Math.cos(t), y, cz + r * Math.sin(t)]); }
  return out;
}
// pick: 'all' for the instanced cabins; 'body' and 'glass' for the ride cabin, whose glass you see her through
function cabinGeo(pick = 'all') {
  const rings = [[0.86, 0.8, 0.35, -3.95], [1.0, 0.93, 0.45, -3.7], [1.06, 0.99, 0.5, -2.95], [1.0, 0.93, 0.45, -2.0], [0.86, 0.8, 0.38, -1.8], [0.6, 0.55, 0.3, -1.68]]
    .map(([a, b, r, y]) => roundRing(a, b, r, y));
  const pos = [], col = [], tt = [], BODY = [0.06, 0.065, 0.075], TINT = [0.1, 0.13, 0.18], yF = -3.95, yT = -1.85;
  const tri = (A, B, C) => {
    const n = new THREE.Vector3(...B).sub(new THREE.Vector3(...A)).cross(new THREE.Vector3(...C).sub(new THREE.Vector3(...A))).normalize();
    const yc = (A[1] + B[1] + C[1]) / 3, side = Math.abs(n.x) > 0.75 && yc < -1.9;
    const glass = !side && yc > -2.95 && yc < -1.95;
    if ((pick === 'body' && glass) || (pick === 'glass' && !glass)) return;
    for (const P of [A, B, C]) {
      pos.push(...P);
      if (side) {   // logo tile once across the side, top at the roof line
        col.push(1, 1, 1);
        tt.push(clamp(0.5 - Math.sign(n.x) * P[2] / 2.0, 0.002, 0.998), clamp((P[1] - yF) / (yT - yF), 0.002, 0.998), TILES.cabin + 1);
      } else { col.push(...(yc > -2.95 && yc < -1.95 ? TINT : BODY)); tt.push(0, 0, 0); }
    }
  };
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1], n = A.length;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; tri(A[i], B[j], A[j]); tri(A[i], B[i], B[j]); }
  }
  for (const [Rg, up] of [[rings[rings.length - 1], true], [rings[0], false]]) {
    const f = THREE.ShapeUtils.triangulateShape(Rg.map((v) => new THREE.Vector2(v[0], v[2])), []);
    for (const [a, b, c] of f) up ? tri(Rg[a], Rg[c], Rg[b]) : tri(Rg[a], Rg[b], Rg[c]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (pick === 'glass') return g;
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(pos.filter((_, k) => k % 3 === 1), 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 3));
  return merge([
    g,
    part(new THREE.BoxGeometry(0.28, 0.32, 0.62).translate(0, -0.12, 0), DARK),                   // grip
    tube([0, -0.28, 0], [0.42, -0.75, 0], 0.1, FRAME), tube([0.42, -0.75, 0], [0.38, -1.35, 0], 0.1, FRAME),
    tube([0.38, -1.35, 0], [0, -1.66, 0], 0.1, FRAME),                                            // hanger
    part(new THREE.BoxGeometry(1.5, 0.12, 1.4).translate(0, -4.02, 0), [0.42, 0.43, 0.46]),        // sill
  ]);
}
const CARRIER_GEO = {
  chair: merge([
    part(new THREE.BoxGeometry(0.26, 0.3, 0.5).translate(0, -0.15, 0), DARK),
    tube([0, -0.3, 0], [0, -1.15, -0.32], 0.11, FRAME),
    tube([-0.98, -1.2, -0.34], [0.98, -1.2, -0.34], 0.09, FRAME),
    ...chairSide(-1), ...chairSide(1),
    part(new THREE.BoxGeometry(2.42, 0.07, 0.55).translate(0, -2.72, 0.1), FRAME),
    ...[-0.9, -0.3, 0.3, 0.9].map((x) => part(new THREE.BoxGeometry(0.56, 0.13, 0.52).translate(x, -2.62, 0.12), CUSH)),
    part(new THREE.BoxGeometry(2.3, 0.5, 0.11).rotateX(-0.18).translate(0, -2.26, -0.24), CUSH),
    tube([-1.14, -1.42, 0.3], [1.14, -1.42, 0.3], 0.06, FRAME),                                  // raised bar
    tube([-0.35, -1.42, 0.3], [-0.38, -1.95, 0.5], 0.05, FRAME), tube([0.35, -1.42, 0.3], [0.38, -1.95, 0.5], 0.05, FRAME),
    tube([-0.72, -1.95, 0.5], [0.72, -1.95, 0.5], 0.06, FRAME),                                  // footrest
  ]),
  // past CHAIR_NEAR: hanger, seat and back only
  chairFar: merge([
    part(new THREE.BoxGeometry(0.14, 2.5, 0.14).translate(0, -1.3, -0.3), FRAME),
    part(new THREE.BoxGeometry(2.4, 0.2, 0.55).translate(0, -2.64, 0.12), CUSH),
    part(new THREE.BoxGeometry(2.3, 0.5, 0.12).translate(0, -2.26, -0.24), CUSH),
  ]),
  cabin: cabinGeo(),
  cabinFar: merge([
    part(new THREE.BoxGeometry(0.14, 1.7, 0.14).translate(0, -0.85, 0), FRAME),
    part(new THREE.BoxGeometry(2.0, 1.2, 1.86).translate(0, -3.4, 0), [0.06, 0.065, 0.075]),
    part(new THREE.BoxGeometry(1.9, 1.0, 1.76).translate(0, -2.3, 0), [0.1, 0.13, 0.18]),
  ]),
  bar: merge([
    part(new THREE.BoxGeometry(0.1, 3.6, 0.1).translate(0, -1.8, 0), STEEL),
    part(new THREE.BoxGeometry(1.1, 0.12, 0.12).translate(0, -3.6, 0), DARK),
  ]),
};
// the ride cabin: drawn in place of its instance, with see-through tinted glass
const rideCabin = new THREE.Group();
rideCabin.add(new THREE.Mesh(cabinGeo('body'), modelMat),
  new THREE.Mesh(cabinGeo('glass'), new THREE.MeshBasicMaterial({ color: 0x1a2230, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })));
rideCabin.visible = false;
rideCabin.matrixAutoUpdate = false;
scene.add(rideCabin);
const FAR_OF = { chair: 'chairFar', cabin: 'cabinFar' };
const carrierMeshes = {};
for (const k of [...Object.keys(carriers), ...Object.values(FAR_OF)]) {
  const own = Object.keys(FAR_OF).find((n) => FAR_OF[n] === k) || k;
  const m = new THREE.InstancedMesh(CARRIER_GEO[k], modelMat, Math.max(1, carriers[own].length));
  m.frustumCulled = false;
  scene.add(m);
  carrierMeshes[k] = m;
}
function pathAt(lp, d, out) {
  const s = lp.s;
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= d) lo = mid; else hi = mid; }
  const f = (d - s[lo]) / ((s[hi] - s[lo]) || 1), a = lp.path[lo], b = lp.path[hi];
  out.x = a[0] + (b[0] - a[0]) * f; out.y = a[1] + (b[1] - a[1]) * f; out.z = a[2] + (b[2] - a[2]) * f;
  out.dx = b[0] - a[0]; out.dz = b[2] - a[2];
  return out;
}
// carrier at d along the loop (0..L up, L..2L back): its spot beside the cable and its facing
export function carrierAt(lp, d, out) {
  const up = d < lp.L;
  pathAt(lp, up ? d : 2 * lp.L - d, out);
  const len = Math.hypot(out.dx, out.dz) || 1, ux = out.dx / len, uz = out.dz / len;
  const side = up ? 1 : -1;
  out.fx = ux * side; out.fz = uz * side;   // riders face the way they travel
  out.x += uz * lp.arm * side; out.z -= ux * lp.arm * side;
  return out;
}
const cp = { x: 0, y: 0, z: 0, dx: 0, dz: 0, fx: 0, fz: 0 };
export function placeCarriers(t) {
  const cx = camera.position.x, cz = camera.position.z;
  // the ride chair: shift its lift's chairs so one is where the ride is
  if (ride.lp && ride.chair) ride.lp.shift = ride.d - (ride.chair.s0 + t * ride.lp.speed);
  rideCabin.visible = false;
  for (const k of Object.keys(carriers)) {
    const m = carrierMeshes[k], e = m.instanceMatrix.array, fm = FAR_OF[k] && carrierMeshes[FAR_OF[k]], fe = fm && fm.instanceMatrix.array;
    let nNear = 0, nFar = 0;
    // lifts wholly past CHAIR_FAR place no chairs or cabins
    const far = new Set();
    if (fm) for (const lp of liftPaths) if (Math.hypot(Math.max(lp.box[0] - cx, 0, cx - lp.box[1]), Math.max(lp.box[2] - cz, 0, cz - lp.box[3])) > CHAIR_FAR) far.add(lp);
    carriers[k].forEach((c) => {
      if (far.has(c.lp)) return;
      const lp = c.lp, d = (((c.s0 + t * lp.speed + lp.shift) % (2 * lp.L)) + 2 * lp.L) % (2 * lp.L);
      carrierAt(lp, d, cp);
      const x = cp.x, z = cp.z, fx = cp.fx, fz = cp.fz;
      let out = e, n = nNear;
      if (fm) {
        const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
        if (d2 > CHAIR_FAR * CHAIR_FAR) return;
        if (d2 > CHAIR_NEAR * CHAIR_NEAR) { out = fe; n = nFar++; } else nNear++;
      } else nNear++;
      // rotation about y taking local +z to (fx, fz)
      if (c === ride.chair && k === 'cabin') {
        rideCabin.matrix.set(fz, 0, fx, x, 0, 1, 0, cp.y, -fx, 0, fz, z, 0, 0, 0, 1);
        rideCabin.matrixWorldNeedsUpdate = true;
        rideCabin.visible = true;
        if (out === e) nNear--; else nFar--;
        return;
      }
      out.set([fz, 0, -fx, 0, 0, 1, 0, 0, fx, 0, fz, 0, x, cp.y, z, 1], n * 16);
    });
    m.count = nNear;
    m.instanceMatrix.needsUpdate = true;
    if (fm) { fm.count = nFar; fm.instanceMatrix.needsUpdate = true; }
  }
}

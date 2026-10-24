// The 18 lifts on their real lines: towers, cable, chairs, cabins and bars; kicker meshes.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from '../data/mountain.js';
import { state } from './state.js';
import { clamp } from './config.js';
import { CELL, KICKERS, KICK_LIP, LIFT_CUT, NX, NZ, SOLIDS, STATIONS, X0, Z0, addObstacle, deckDist, groundY, kickH, sampleBase, samplePatch } from './world.js';
import { camera, scene, terrainMat } from './scene.js';
import { CONC, DARK, GLASS, GW, RING_FAR, SNOWCAP, STEEL, TILES, W, WALL, apron, apronGeos, cablePts, casters, chairTerminal, deckRect, gondolaDeck, gondolaStation, gondolaTerminal, gondolaTower, lampList, liftParts, merge, modelMat, part, placeM, placed } from './buildings.js';
import './trees.js'; // load order: runs after trees.js

// ---------- Lifts on the real lines (OpenStreetMap) ----------
// OSM points are towers where mapped; long gaps get one about every 110 m. Towers grow until the chairs clear the snow.
const LIFT_STYLE = {
  chair_lift: { arm: 3.0, tower: 11, term: 5, clear: 7, carrier: 'chair', gap: 24, speed: 5 },
  gondola: { arm: 3.2, tower: 14, term: 6, clear: 8, carrier: 'cabin', gap: 42, speed: 5.5 },
  't-bar': { arm: 1.3, tower: 7.5, term: 4, clear: 4.5, carrier: 'bar', gap: 14, speed: 3 },
  platter: { arm: 1.1, tower: 6.5, term: 3.5, clear: 4, carrier: 'bar', gap: 12, speed: 2.8 },
};
const MAX_SPAN = 115;
export const LIFTS = MAP.lifts || [];
export const carriers = { chair: [], cabin: [], bar: [] };
export const liftPaths = [];
const LIFT_ENDS = LIFTS.flatMap((l) => [l.points[0], l.points[l.points.length - 1]].map((p) => ({ lift: l, x: p[0], z: p[1] })));
for (const lift of LIFTS) {
  lift.partsFrom = liftParts.length;
  const st = LIFT_STYLE[lift.kind] || LIFT_STYLE.chair_lift;
  // terminals at the ends, towers between; drop points bunched near a terminal
  const raw = lift.points.map((p) => [p[0], p[1]]);
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = pts[pts.length - 1], d = Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]);
    const end = raw[raw.length - 1], toEnd = Math.hypot(raw[i][0] - end[0], raw[i][1] - end[1]);
    if (i < raw.length - 1 && (d < 25 || toEnd < 25)) continue;
    const n = Math.ceil(d / MAX_SPAN) - 1;
    for (let k = 1; k <= n; k++) {
      const f = k / (n + 1);
      pts.push([last[0] + (raw[i][0] - last[0]) * f, last[1] + (raw[i][1] - last[1]) * f]);
    }
    pts.push(raw[i]);
  }
  const N = pts.length;
  const g = pts.map(([x, z]) => groundY(x, z));
  const c = g.map((y, i) => y + (i === 0 || i === N - 1 ? st.term : st.tower));
  // deck at the highest snow under it; cable 3.15 m above the deck so seats clear it by about half a meter
  const stn = {};
  const isGondola = lift.kind === 'gondola';
  if (lift.kind === 'chair_lift' || isGondola || !LIFT_STYLE[lift.kind]) for (const i of [0, N - 1]) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]) + (i === 0 ? Math.PI : 0), cs = Math.cos(yaw), sn = Math.sin(yaw);
    // hut goes away from any other lift's end within 20 m
    const hut = LIFT_ENDS.some((q) => q.lift !== lift && Math.hypot(q.x - pts[i][0], q.z - pts[i][1]) < 20 && cs * (q.x - pts[i][0]) - sn * (q.z - pts[i][1]) > 0) ? -1 : 1;
    const [u0, u1, v0, v1] = isGondola ? gondolaDeck(st.arm) : deckRect(st.arm, hut);
    let hi = -1e9, lo = 1e9;
    for (let v = v0; v <= v1 + 0.01; v += 1.5) for (let u = u0; u <= u1 + 0.01; u += 1.5) {
      const h = groundY(pts[i][0] + cs * u + sn * v, pts[i][1] - sn * u + cs * v);
      hi = Math.max(hi, h); lo = Math.min(lo, h);
    }
    const y = hi + 0.1, A = clamp((y - lo) * 3 + 4, 6, 18);
    const R = Math.hypot(Math.max(-u0, u1), Math.max(-v0, v1)) + A;
    const sd = { x: pts[i][0], z: pts[i][1], c: cs, s: sn, yaw, u0, u1, v0, v1, y, lo, A, hut,
      bx0: pts[i][0] - R, bx1: pts[i][0] + R, bz0: pts[i][1] - R, bz1: pts[i][1] + R };
    stn[i] = sd;
    c[i] = y + (isGondola ? 4.45 : 3.15);
  }
  const sagOf = (i) => Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) * 0.012;
  const cableAt = (i, f) => c[i] + (c[i + 1] - c[i]) * f - sagOf(i) * Math.sin(Math.PI * f);
  // raise towers until every span clears the snow
  for (let pass = 0; pass < 8; pass++) {
    let ok = true;
    for (let i = 0; i < N - 1; i++) {
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      let worst = 0, wf = 0.5;
      for (let s = 5; s < len; s += 8) {
        const f = s / len, x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
        const d = groundY(x, z) + st.clear - cableAt(i, f);
        if (d > worst) { worst = d; wf = f; }
      }
      if (worst <= 0.1) continue;
      ok = false;
      // lift each end by how close the low spot is to it; terminals stay put
      const ia = i, ib = i + 1, ta = ia === 0, tb = ib === N - 1;
      const wa = ta ? 0 : tb ? 1 : 1 - wf, wb = tb ? 0 : ta ? 1 : wf;
      const scale = worst / Math.max(0.25, wa * (1 - wf) + wb * wf);
      c[ia] += wa * scale * 1.05; c[ib] += wb * scale * 1.05;
    }
    if (ok) break;
  }
  for (let i = 1; i < N - 1; i++) c[i] = Math.min(c[i], g[i] + 32);
  const dirAt = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  };
  for (let i = 1; i < N - 1; i++) {
    const th = c[i] - g[i] - 0.55, arm = st.arm, yaw = dirAt(i);
    const parts = isGondola ? gondolaTower(th, arm) : [
      part(new THREE.BoxGeometry(2.2, 1.2, 2.2).translate(0, 0.3, 0), W, null, TILES.concrete),
      part(new THREE.CylinderGeometry(0.4, 0.68, th, 6).translate(0, th / 2, 0), W, null, TILES.steel),
      part(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 8).translate(0, 1.9, 0), W, null, TILES.pad),
      part(new THREE.BoxGeometry(arm * 2 + 1.4, 0.45, 0.5).translate(0, th, 0), W, null, TILES.steel),
      part(new THREE.BoxGeometry(1.2, 0.35, 2.4).translate(-arm, th + 0.35, 0), DARK),
      part(new THREE.BoxGeometry(1.2, 0.35, 2.4).translate(arm, th + 0.35, 0), DARK),
      part(new THREE.BoxGeometry(0.22, th - 2, 0.22).translate(0.55, th / 2, 0.3), DARK),
    ];
    liftParts.push(...placed(parts, placeM(pts[i][0], g[i] - 0.4, pts[i][1], yaw)));
    casters.push({ x: pts[i][0], z: pts[i][1], h: th, w: 0.8 });
    addObstacle({ x: pts[i][0], z: pts[i][1], y: g[i], r: 1.1, height: th, what: 'lift tower' });
  }
  for (const i of [0, N - 1]) {
    const sd = stn[i], yaw = sd ? sd.yaw : dirAt(i) + (i === 0 ? Math.PI : 0), arm = st.arm;
    const base = sd ? sd.y - 0.5 : g[i] - 0.3, hh = c[i] - base;
    const neu = !!sd;
    const parts = neu && isGondola ? gondolaTerminal(hh, arm, sd.y - sd.lo + 0.6) : neu ? chairTerminal(hh, arm, sd.y - sd.lo + 0.6, sd.hut) : [
      part(new THREE.BoxGeometry(arm * 2 + 4, 0.6, 9).translate(0, 0.0, 1.5), CONC),
      part(new THREE.BoxGeometry(0.7, hh - 0.6, 0.7).translate(-1.2, (hh - 0.6) / 2, 0), STEEL),
      part(new THREE.BoxGeometry(0.7, hh - 0.6, 0.7).translate(1.2, (hh - 0.6) / 2, 0), STEEL),
      part(new THREE.BoxGeometry(arm * 2 + 1.2, 1.1, 3.4).translate(0, hh - 0.2, 0.8), STEEL),
      part(new THREE.CylinderGeometry(arm, arm, 0.3, 14).translate(0, hh + 0.45, 0), DARK),
      part(new THREE.BoxGeometry(3.2, 2.6, 3.2).translate(arm + 3.6, 1.3, -3), WALL),
      part(new THREE.BoxGeometry(2.2, 0.9, 0.1).translate(arm + 3.6, 1.7, -1.35), GLASS),
      part(new THREE.ConeGeometry(2.7, 1.5, 4, 1).rotateY(Math.PI / 4).translate(arm + 3.6, 3.35, -3), SNOWCAP),
      part(new THREE.BoxGeometry(0.2, 5.5, 0.2).translate(arm + 1.6, 2.75, -1.2), DARK),
    ];
    const m = placeM(pts[i][0], base, pts[i][1], yaw);
    liftParts.push(...placed(parts, m));
    if (sd && isGondola) gondolaStation(sd, arm, hh, base, m, lift.name === 'Elk Camp Gondola' && g[i] >= Math.max(g[0], g[N - 1]));
    else if (sd) {
      apronGeos.push(apron(sd, base));
      STATIONS.push(sd);
      // post, legs and hut are solid; deck and apron are snow
      const L = 7, toW = (u, v) => [sd.x + sd.c * u + sd.s * v, sd.z - sd.s * u + sd.c * v];
      for (const [u, v, r] of [[0, 0, 0.6], [-(arm + 1.55), 1.2, 0.2], [arm + 1.55, 1.2, 0.2], [-(arm + 1.55), -L + 0.9, 0.2], [arm + 1.55, -L + 0.9, 0.2]]) {
        const [x, z] = toW(u, v);
        addObstacle({ x, z, y: sd.y, r, height: hh, what: 'station post' });
      }
      // hut: solid 3 x 3 x 2.6 m box
      const [hutX, hutZ] = toW(sd.hut * (arm + 3.4), -L + 3.2);
      SOLIDS.push({ x: hutX, z: hutZ, y: sd.y + 1.0, hx: 1.5, hy: 1.6, hz: 1.5, c: sd.c, s: sd.s, what: 'lift hut' });
      // no trees on the station or apron
      for (let jj = Math.floor((sd.bz0 - Z0) / CELL); jj <= Math.ceil((sd.bz1 - Z0) / CELL); jj++)
        for (let ii = Math.floor((sd.bx0 - X0) / CELL); ii <= Math.ceil((sd.bx1 - X0) / CELL); ii++)
          if (ii >= 0 && jj >= 0 && ii < NX && jj < NZ && deckDist(sd, X0 + ii * CELL, Z0 + jj * CELL) < sd.A + 4) LIFT_CUT[jj * NX + ii] = 1;
    }
    if (!isGondola) casters.push({ x: pts[i][0], z: pts[i][1], h: hh, w: arm + 1 });
    lampList.push((neu && isGondola ? new THREE.Vector3(GW(arm) + 1.2, 4.9, -19.6) : neu ? new THREE.Vector3(sd.hut * (arm + 3.4 - 1.6), 4.9, -7 + 3.2 - 1.6) : new THREE.Vector3(arm + 1.6, 5.6, -1.2)).applyMatrix4(m));
  }
  // cable: dense sagging path along the tower tops, with distance along it
  const path = [];
  for (let i = 0; i < N - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]), n = Math.max(2, Math.ceil(len / 6));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      path.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, cableAt(i, f), pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
    }
  }
  path.push([pts[N - 1][0], c[N - 1], pts[N - 1][1]]);
  const s = [0];
  for (let k = 1; k < path.length; k++) s.push(s[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][2] - path[k - 1][2]));
  const L = s[s.length - 1];
  const lp = { path, s, L, arm: st.arm, speed: st.speed, shift: 0, name: lift.name, kind: lift.kind, pts, g, stn };
  const xs = path.map((q) => q[0]), zs = path.map((q) => q[2]);
  lp.box = [Math.min(...xs) - st.arm, Math.max(...xs) + st.arm, Math.min(...zs) - st.arm, Math.max(...zs) + st.arm];
  liftPaths.push(lp);
  for (let k = 0; k < path.length - 1; k++) {
    const dx = path[k + 1][0] - path[k][0], dz = path[k + 1][2] - path[k][2], d = Math.hypot(dx, dz) || 1;
    const px = dz / d * st.arm, pz = -dx / d * st.arm;   // perpendicular: + is the up side
    for (const side of [1, -1]) cablePts.push(path[k][0] + px * side, path[k][1] + 0.1, path[k][2] + pz * side, path[k + 1][0] + px * side, path[k + 1][1] + 0.1, path[k + 1][2] + pz * side);
    // clear the forest under the line
    for (let t = 0; t < d; t += 3) {
      const x = path[k][0] + dx * t / d, z = path[k][2] + dz * t / d;
      const ci = Math.round((x - X0) / CELL), cj = Math.round((z - Z0) / CELL);
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const ii = ci + a, jj = cj + b;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
        if (Math.hypot(X0 + ii * CELL - x, Z0 + jj * CELL - z) < st.arm + 6) LIFT_CUT[jj * NX + ii] = 1;
      }
    }
  }
  for (let d = 0; d < 2 * L; d += st.gap) carriers[st.carrier].push({ lp, s0: d });
}
// one mesh per lift, so the camera skips lifts out of view
LIFTS.forEach((lift, n) => {
  const parts = liftParts.slice(lift.partsFrom, n + 1 < LIFTS.length ? LIFTS[n + 1].partsFrom : liftParts.length);
  if (parts.length) scene.add(new THREE.Mesh(merge(parts), modelMat));
});
// station aprons: groomed snow, drawn just in front of the ground
if (apronGeos.length) {
  const n = apronGeos.reduce((a, g) => a + g.attributes.position.count, 0), p = new Float32Array(n * 3), cov = new Float32Array(n * 4);
  let o = 0;
  for (const g of apronGeos) { p.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
  for (let k = 0; k < n; k++) cov[k * 4] = -5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, terrainMat.uniforms, { uPFar: { value: 1e9 } }), vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
    defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  scene.add(new THREE.Mesh(geo, mat));
}
// Kicker snow and lip mats, rebuilt when the 2 m tiles under them load or drop so they sit on the snow the skier rides.
export const kickSnowMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({}, terrainMat.uniforms, { uPFar: { value: 1e9 } }), vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
  defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
});
// mats drawn in front of the kicker snow
export const kickMatMat = modelMat.clone();
Object.assign(kickMatMat, { uniforms: modelMat.uniforms, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
const KICK_RED = [0.78, 0.12, 0.1], KICK_WHITE = [0.95, 0.96, 1.0];
function buildKicker(k) {
  const kB = { h: 0, gx: 0, gz: 0 }, step = 0.5, side = k.hw + k.h + step, y0 = sampleBase(k.x, k.z, kB).h;
  const toW = (u, v) => [k.x + k.fx * u - k.fz * v, k.z + k.fz * u + k.fx * v];
  const ground = (u, v) => { const [x, z] = toW(u, v); return [x, sampleBase(x, z, kB).h, z]; };
  // snow grid over the footprint, unlifted cells left out
  const pos = [], us = [], vs = [];
  for (let u = 0; u < k.end + step; u += step) us.push(Math.min(u, k.end));
  for (let v = -side; v <= side + 1e-6; v += step) vs.push(v);
  const grid = vs.map((v) => us.map((u) => {
    const [x, y, z] = ground(u, v), lift = kickH(k, x, z);
    return [x - k.x, y + lift + 0.03 - y0, z - k.z, lift];
  }));
  const tri = (a, b, c) => {
    // face up
    const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
    if (uz * wx - ux * wz < 0) pos.push(...a.slice(0, 3), ...c.slice(0, 3), ...b.slice(0, 3));
    else pos.push(...a.slice(0, 3), ...b.slice(0, 3), ...c.slice(0, 3));
  };
  for (let b = 0; b < vs.length - 1; b++) for (let a = 0; a < us.length - 1; a++) {
    const p = grid[b][a], q = grid[b][a + 1], r = grid[b + 1][a + 1], t = grid[b + 1][a];
    if (p[3] <= 0 && q[3] <= 0 && r[3] <= 0 && t[3] <= 0) continue;
    tri(p, q, r); tri(p, r, t);
  }
  const n = pos.length / 3, cov = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) cov[i * 4] = -5;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(cov, 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, kickSnowMat));
  // lip mats: red panels over the last KICK_LIP m, each with a white chevron
  const mats = [], panels = Math.max(2, Math.round(k.hw * 2 / 1.4)), pw = k.hw * 2 / panels, u0 = k.L - KICK_LIP;
  const at = (u, v, lift) => { const [x, y, z] = ground(u, v); return [x - k.x, y + k.prof(u) + lift - y0, z - k.z]; };
  const poly = (pts, col) => {
    const P = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[0], b = pts[i], c = pts[i + 1];
      const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
      P.push(...a, ...(uz * wx - ux * wz < 0 ? [...c, ...b] : [...b, ...c]));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    mats.push(part(g, col));
  };
  for (let i = 0; i < panels; i++) {
    const va = -k.hw + i * pw + pw * 0.04, vb = -k.hw + (i + 1) * pw - pw * 0.04, vm = (va + vb) / 2, q = (vb - va) * 0.42;
    const U = (f) => u0 + KICK_LIP * f;
    // red panel in strips that follow the curve
    for (let s = 0; s < 4; s++) poly([at(U(s / 4), va, 0.06), at(U((s + 1) / 4), va, 0.06), at(U((s + 1) / 4), vb, 0.06), at(U(s / 4), vb, 0.06)], KICK_RED);
    // chevron arms
    for (const sgn of [-1, 1]) poly([at(U(0.35), vm + sgn * q, 0.09), at(U(0.95), vm, 0.09), at(U(0.65), vm, 0.09), at(U(0.05), vm + sgn * q, 0.09)], KICK_WHITE);
  }
  group.add(new THREE.Mesh(merge(mats), kickMatMat));
  group.position.set(k.x, y0, k.z);
  return group;
}
// 1 where 2 m tiles cover the kicker, 0 on the 10 m ground
function kickGround(k) {
  if (!state.PATCH || !state.patchOn) return 0;
  const t = { h: 0, gx: 0, gz: 0 }, s = k.hw + k.h;
  for (const [u, v] of [[0, -s], [0, s], [k.end, -s], [k.end, s], [k.end / 2, 0]]) {
    if (!samplePatch(state.PATCH, k.x + k.fx * u - k.fz * v, k.z + k.fz * u + k.fx * v, t)) return 0;
  }
  return 1;
}
export function updateKickers() {
  for (const k of KICKERS) {
    const mode = kickGround(k);
    if (mode !== k.mode) {
      if (k.mesh) { scene.remove(k.mesh); k.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      k.mesh = buildKicker(k); k.mode = mode;
      scene.add(k.mesh);
    }
    k.mesh.visible = Math.hypot(k.x - camera.position.x, k.z - camera.position.z) < RING_FAR;
  }
}

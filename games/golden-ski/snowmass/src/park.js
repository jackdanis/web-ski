// The terrain park down Cabin (Jack's laser notes batch 4, 2026-10-28): boxes and rails in two lanes down Cabin, a jump
// line beside it (kickers in world.js KICK_AT), the snow updrift between the park and Lunchline (Upper), and the snow
// bridge that carries the park over Lunchline's culvert toward the large kicker. The fence is in runs.js.
// Snow shapes are KICKERS with their own lift; boxes, rails and the snow over the culvert are ground only from above.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { GROUND_ADD, KICKERS, SOLIDS, sampleBase, samplePatch } from './world.js';
import { camera, scene } from './scene.js';
import { DARK, RING_FAR, SNOWCAP, STEEL, merge, modelMat, part } from './buildings.js';

const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const bB = { h: 0, gx: 0, gz: 0 };
const base = (x, z) => sampleBase(x, z, bB).h;
// fall line averaged over 20 m
function fall(x, z) {
  let gx = 0, gz = 0;
  for (let a = -10; a <= 10; a += 5) for (let b = -10; b <= 10; b += 5) { sampleBase(x + a, z + b, bB); gx += bB.gx; gz += bB.gz; }
  const g = Math.hypot(gx, gz) || 1;
  return [-gx / g, -gz / g];
}

// ---------- layout ----------
// Makaha's spec (Jack picked 2026-10-28): a progressive line of three midsized jumps (KICK_AT), about 15 jibs of
// all shapes in two lanes down Cabin, and transition features. Jibs: start, length, half width the skis hold, shape
// of the top over a straight line between the snow at both ends, box or rail (tube: a fat rail)
const JIBS = [
  { at: [362.5, -3280.0], len: 8, hw: 0.6, shape: 'down', kind: 'box' },     // lane on Cabin's line
  { at: [378.8, -3299.0], len: 10, hw: 0.3, shape: 'down', kind: 'rail' },
  { at: [397.6, -3315.5], len: 10, hw: 0.3, shape: 'rainbow', kind: 'rail' },
  { at: [416.4, -3332.0], len: 12, hw: 0.6, shape: 'aframe', kind: 'box' },
  { at: [436.5, -3346.7], len: 12, hw: 0.3, shape: 'kink', kind: 'rail' },
  { at: [457.5, -3360.2], len: 10, hw: 0.9, shape: 'down', kind: 'box' },
  { at: [478.5, -3373.8], len: 10, hw: 0.4, shape: 'down', kind: 'tube' },
  { at: [499.5, -3387.3], len: 14, hw: 0.3, shape: 'flat', kind: 'rail' },
  { at: [361.1, -3298.4], len: 7, hw: 0.3, shape: 'down', kind: 'rail' },     // lane on the right
  { at: [380.0, -3317.4], len: 12, hw: 0.6, shape: 'flat', kind: 'box' },
  { at: [398.8, -3333.9], len: 12, hw: 0.6, shape: 'kink', kind: 'box' },
  { at: [419.4, -3351.1], len: 10, hw: 0.6, shape: 'rainbow', kind: 'box' },
  { at: [440.4, -3364.7], len: 10, hw: 0.3, shape: 'down', kind: 'rail' },
  { at: [461.4, -3378.2], len: 12, hw: 0.3, shape: 'aframe', kind: 'rail' },
  { at: [482.4, -3391.8], len: 10, hw: 0.4, shape: 'flat', kind: 'tube' },
];
const RAIL_START = 0.15;                     // m over the snow where a jib starts, so skis ride on
// m over the straight snow line at u (0..1 along)
const SHAPES = {
  down: (u) => 0.15 + 0.6 * u,                                       // rises off the slope, the top falling less steeply
  flat: (u) => 0.15 + 1.0 * u,                                       // nearly level
  rainbow: (u) => 0.2 + 0.1 * u + 0.8 * Math.sin(Math.PI * u),
  aframe: (u) => u < 0.35 ? 0.15 + 0.85 * u / 0.35 : u < 0.65 ? 1.0 + 0.3 * (u - 0.35) / 0.3 : 1.3 - 0.9 * (u - 0.65) / 0.35,
  kink: (u) => u < 0.45 ? 0.15 + 1.0 * u / 0.45 : 1.15 - 0.4 * (u - 0.45) / 0.55,
};
// transition features: three rollers before the jump line, a spine near the bottom of the lanes
const ROLLERS = { pts: [[372.8, -3258.2], [389.0, -3277.2]], n: 3, h: 1.2, w: 6 };
const SPINE = { at: [510.9, -3406.6], half: 7, h: 1.6, w: 4.5 };
// the updrift (pin 5) between the park and Lunchline: polyline, height, half width at the base, ends eased over
const BERM = { pts: [[550, -3385], [556, -3430], [545, -3470], [532, -3492]], h: 2.5, w: 7.5, ends: 12 };
// the bridge (pin 6): Lunchline (Upper) runs through a corrugated metal half-circle culvert set into the snow, and the
// park rides over it on one bank of packed snow: up from below Cabin's medium kicker, keeping right, over the culvert,
// then down toward the large kicker. over: the bank point above the culvert; top: half width of the bank's flat top;
// side: m the bank's sides drop per m
const BANK = { pts: [[530, -3448], [511, -3478], [520, -3524], [545.5, -3568.2]], over: 2, top: 8, side: 0.5 };
// along Lunchline; m of snow over the crown; a0..a1 m along the axis from c, set below to the bank's whole footprint, so
// the snow bridge is one piece from portal to portal
const CULVERT = { c: [520, -3524], ax: [-0.625, -0.781], r: 4, a0: 0, a1: 0, cover: 2.5 };

// nearest point on a polyline: s along it, d away
function polyline(pts) {
  const segs = [];
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], l = Math.hypot(bx - ax, bz - az);
    segs.push({ ax, az, dx: (bx - ax) / l, dz: (bz - az) / l, len: l, s0: len });
    len += l;
  }
  const at = [0];
  for (const g of segs) at.push(g.s0 + g.len);
  const near = (x, z, out) => {
    let best = 1e9, s = 0;
    for (const g of segs) {
      const t = Math.min(g.len, Math.max(0, (x - g.ax) * g.dx + (z - g.az) * g.dz)), d = Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t);
      if (d < best) { best = d; s = g.s0 + t; }
    }
    out[0] = s; out[1] = best;
    return out;
  };
  return { len, at, near };
}
const bankLine = polyline(BANK.pts), sOver = bankLine.at[BANK.over];
const bank = { y0: 0, yC: 0, yE: 0 };
function bankHeights() {
  const [p, c, e] = [BANK.pts[0], CULVERT.c, BANK.pts[BANK.pts.length - 1]];
  bank.y0 = base(p[0], p[1]); bank.yC = base(c[0], c[1]) + CULVERT.r + CULVERT.cover; bank.yE = base(e[0], e[1]);
}
bankHeights();
const bankTop = (s) => s <= sOver ? bank.y0 + (bank.yC - bank.y0) * s / sOver : bank.yC + (bank.yE - bank.yC) * (s - sOver) / (bankLine.len - sOver);
const sd = [0, 0];
// the bank's snow surface at a point, culvert or not
function bankY(x, z) {
  bankLine.near(x, z, sd);
  return bankTop(sd[0]) - Math.max(0, sd[1] - BANK.top) * BANK.side;
}
// the culvert runs on until the bank's sides are down to the snow on both its edges, plus a little metal showing
{
  const C = CULVERT, deep = (a) => [-C.r, 0, C.r].some((t) => {
    const x = C.c[0] + C.ax[0] * a - C.ax[1] * t, z = C.c[1] + C.ax[1] * a + C.ax[0] * t;
    return bankY(x, z) - base(x, z) > 0.3;
  });
  for (const sg of [-1, 1]) {
    let a = 0;
    while (deep(a + sg) && Math.abs(a) < 80) a += sg;
    C[sg < 0 ? 'a0' : 'a1'] = a + sg * 1.5;
  }
}
// the snow over the culvert: the bank's surface, never below the metal
function capY(x, z) {
  const C = CULVERT, dx = x - C.c[0], dz = z - C.c[1], a = dx * C.ax[0] + dz * C.ax[1], t = dz * C.ax[0] - dx * C.ax[1];
  const arch = base(C.c[0] + C.ax[0] * a, C.c[1] + C.ax[1] * a) - 0.3 + Math.sqrt(Math.max(0, C.r * C.r - t * t));
  return Math.max(bankY(x, z), arch + 0.2);
}
// under the arch
function inCulvert(x, z) {
  const dx = x - CULVERT.c[0], dz = z - CULVERT.c[1], a = dx * CULVERT.ax[0] + dz * CULVERT.ax[1], t = dz * CULVERT.ax[0] - dx * CULVERT.ax[1];
  return a >= CULVERT.a0 && a <= CULVERT.a1 && Math.abs(t) < CULVERT.r;
}

// ---------- snow shapes ----------
// a lift that follows a polyline: f(s along, d to the line, x, z) m of snow
function pathFeature(pts, reach, f) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    segs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, s0: total });
    total += len;
  }
  const [px, pz] = pts[0], [qx, qz] = pts[pts.length - 1], L = Math.hypot(qx - px, qz - pz), fx = (qx - px) / L, fz = (qz - pz) / L;
  // the snow grid is drawn across the chord, so it has to reach past the line's widest bend
  const bend = Math.max(...pts.map(([x, z]) => Math.abs((z - pz) * fx - (x - px) * fz)));
  const k = { x: px - fx * reach, z: pz - fz * reach, fx, fz, hw: reach + bend, h: 0, L: 0, end: L + 2 * reach, prof: () => 0, size: 'park', plain: true, mode: -1, mesh: null, len: total };
  k.hAt = (u, v) => {
    const x = k.x + fx * u - fz * v, z = k.z + fz * u + fx * v;
    let best = 1e9, s = 0;
    for (const g of segs) {
      const t = Math.min(g.len, Math.max(0, (x - g.ax) * g.dx + (z - g.az) * g.dz)), ex = x - g.ax - g.dx * t, ez = z - g.az - g.dz * t, d = Math.hypot(ex, ez);
      if (d < best) { best = d; s = g.s0 + t; }
    }
    return best >= reach ? 0 : Math.max(0, f(s, best, x, z));
  };
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  Object.assign(k, { bx0: Math.min(...xs) - reach, bx1: Math.max(...xs) + reach, bz0: Math.min(...zs) - reach, bz1: Math.max(...zs) + reach });
  KICKERS.push(k);
  return k;
}
// updrift: a rounded snow ridge
const bermK = pathFeature(BERM.pts, BERM.w + 1, (s, d) => {
  if (d >= BERM.w) return 0;
  const c = Math.cos(d / BERM.w * Math.PI / 2);
  return BERM.h * ease(Math.min(s, bermK.len - s) / BERM.ends) * c * c;
});
// rollers: smooth humps one after another down the line, eased in at the sides
const rollK = pathFeature(ROLLERS.pts, ROLLERS.w + 1, (s, d) => {
  if (d >= ROLLERS.w) return 0;
  const p = Math.sin(Math.PI * ROLLERS.n * s / rollK.len);
  return ROLLERS.h * p * p * ease((ROLLERS.w - d) / 3);
});
// spine: a rounded snow ridge across the fall line
const spineK = (() => {
  const [fx, fz] = fall(SPINE.at[0], SPINE.at[1]), [x, z] = SPINE.at;
  return pathFeature([[x + fz * SPINE.half, z - fx * SPINE.half], [x - fz * SPINE.half, z + fx * SPINE.half]], SPINE.w + 1, (s, d) => {
    if (d >= SPINE.w) return 0;
    const c = Math.cos(d / SPINE.w * Math.PI / 2);
    return SPINE.h * c * c * ease(Math.min(s, 2 * SPINE.half - s) / 2.5);
  });
})();
// the bank: open where the culvert runs through it, so Lunchline skiers ride the snow inside
const bankK = pathFeature(BANK.pts, BANK.top + 28, (s, d, x, z) => inCulvert(x, z) ? 0 : bankTop(s) - Math.max(0, d - BANK.top) * BANK.side - base(x, z));
// ---------- boxes, rails and the snow over the culvert: ground only from above ----------
// each: start x z, unit dir, length, half width, top y at both ends (set when the snow under them is known)
const tops = [];
for (const r of JIBS) {
  const [fx, fz] = fall(r.at[0], r.at[1]);
  r.top = { x: r.at[0], z: r.at[1], fx, fz, len: r.len, hw: r.hw, y0: 0, y1: 0, rise: SHAPES[r.shape] };
  tops.push(r.top);
}
function setTops() {
  for (const r of JIBS) {
    const t = r.top;
    t.y0 = base(t.x, t.z); t.y1 = base(t.x + t.fx * t.len, t.z + t.fz * t.len);
  }
}
setTops();
const topY = (t, u) => t.y0 + (t.y1 - t.y0) * u / t.len + t.rise(u / t.len);
const tB = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
const cR = Math.max(-CULVERT.a0, CULVERT.a1) + CULVERT.r;
for (const p of [[CULVERT.c[0] - cR, CULVERT.c[1] - cR], [CULVERT.c[0] + cR, CULVERT.c[1] + cR]]) {
  tB.x0 = Math.min(tB.x0, p[0]); tB.x1 = Math.max(tB.x1, p[0]); tB.z0 = Math.min(tB.z0, p[1]); tB.z1 = Math.max(tB.z1, p[1]);
}
for (const t of tops) for (const [x, z] of [[t.x, t.z], [t.x + t.fx * t.len, t.z + t.fz * t.len]]) {
  tB.x0 = Math.min(tB.x0, x - 5); tB.x1 = Math.max(tB.x1, x + 5); tB.z0 = Math.min(tB.z0, z - 5); tB.z1 = Math.max(tB.z1, z + 5);
}
GROUND_ADD.push((x, z, out) => {
  if (state.solidY === null || x < tB.x0 || x > tB.x1 || z < tB.z0 || z > tB.z1) return;
  for (const t of tops) {
    const dx = x - t.x, dz = z - t.z, u = dx * t.fx + dz * t.fz, v = dz * t.fx - dx * t.fz;
    if (u < 0 || u > t.len || Math.abs(v) > t.hw) continue;
    const y = topY(t, u), g = (topY(t, Math.min(t.len, u + 0.2)) - topY(t, Math.max(0, u - 0.2))) / 0.4;
    if (y <= out.h || state.solidY < y - 0.5) continue;
    out.h = y; out.gx = t.fx * g; out.gz = t.fz * g;
  }
  if (inCulvert(x, z)) {
    const y = capY(x, z), E = 0.3;
    if (y <= out.h || state.solidY < y - 0.5) return;
    out.h = y; out.gx = (capY(x + E, z) - y) / E; out.gz = (capY(x, z + E) - y) / E;
  }
});

// ---------- meshes ----------
const CULV = [[0.62, 0.64, 0.68], [0.5, 0.52, 0.56]], BOX_TOP = [0.78, 0.8, 0.84], TUBE = [0.25, 0.42, 0.62];   // corrugation: light and dark rings
const ex = new THREE.Vector3(), ey = new THREE.Vector3(), ez = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4();
// a box from a to b (its centre line), w wide, h tall, local origin o
function beam(a, b, w, h, col, o) {
  ex.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = ex.length();
  ex.normalize(); ez.crossVectors(ex, UP).normalize(); ey.crossVectors(ez, ex);
  M.makeBasis(ex, ey, ez).setPosition((a[0] + b[0]) / 2 - o[0], (a[1] + b[1]) / 2 - o[1], (a[2] + b[2]) / 2 - o[2]);
  return part(new THREE.BoxGeometry(len, h, w), col, M);
}
const along = (t, u, v, dy = 0) => [t.x + t.fx * u - t.fz * v, topY(t, u) + dy, t.z + t.fz * u + t.fx * v];
function buildMesh() {
  const o = [CULVERT.c[0], bank.yC, CULVERT.c[1]], P = [], C = CULVERT, SEG = 16, STEP = 0.5;
  // culvert: a half circle on the snow along its axis, rings of light and dark for the corrugation, seen from both sides
  for (let a = C.a0, i = 0; a < C.a1 - 1e-6; a += STEP, i++) {
    const pos = [];
    const ring = (aa) => {
      const cx = C.c[0] + C.ax[0] * aa, cz = C.c[1] + C.ax[1] * aa, y = base(cx, cz) - 0.3, R = [];
      for (let k = 0; k <= SEG; k++) {
        const th = Math.PI * k / SEG, t = C.r * Math.cos(th);
        R.push([cx - C.ax[1] * t - o[0], y + C.r * Math.sin(th) - o[1], cz + C.ax[0] * t - o[2]]);
      }
      return R;
    };
    const r0 = ring(a), r1 = ring(a + STEP);
    for (let k = 0; k < SEG; k++) {
      const p = r0[k], q = r0[k + 1], r = r1[k + 1], t = r1[k];
      pos.push(...p, ...q, ...r, ...p, ...r, ...t, ...p, ...r, ...q, ...p, ...t, ...r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    P.push(part(g, CULV[i & 1]));
  }
  // the snow packed over it: the bank's surface, never below the metal, closed at both ends down to the arch
  const at = (a, t) => {
    const cx = C.c[0] + C.ax[0] * a, cz = C.c[1] + C.ax[1] * a, x = cx - C.ax[1] * t, z = cz + C.ax[0] * t;
    const arch = base(cx, cz) - 0.3 + Math.sqrt(Math.max(0, C.r * C.r - t * t));
    return [x - o[0], capY(x, z) + 0.05 - o[1], z - o[2], arch - o[1]];
  };
  // a little wider than the arch so it laps over the stepped edge of the bank's snow grid
  const W = C.r + 0.75, cap = [], N = Math.round(2 * W / STEP);
  for (let a = C.a0; a < C.a1 - 1e-6; a += STEP) for (let k = 0; k < N; k++) {
    const t0 = -W + k * STEP, p = at(a, t0), q = at(a + STEP, t0), r = at(a + STEP, t0 + STEP), t = at(a, t0 + STEP);
    cap.push(...p.slice(0, 3), ...r.slice(0, 3), ...q.slice(0, 3), ...p.slice(0, 3), ...t.slice(0, 3), ...r.slice(0, 3));
    cap.push(...p.slice(0, 3), ...q.slice(0, 3), ...r.slice(0, 3), ...p.slice(0, 3), ...r.slice(0, 3), ...t.slice(0, 3));
  }
  for (const a of [C.a0, C.a1]) for (let k = 0; k < N; k++) {
    const t0 = -W + k * STEP, p = at(a, t0), q = at(a, t0 + STEP);
    const pl = [p[0], p[3], p[2]], ql = [q[0], q[3], q[2]];
    cap.push(...pl, ...q.slice(0, 3), ...p.slice(0, 3), ...pl, ...ql, ...q.slice(0, 3), ...pl, ...p.slice(0, 3), ...q.slice(0, 3), ...pl, ...q.slice(0, 3), ...ql);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
  P.push(part(cg, SNOWCAP));
  // boxes: a light top on dark sides down into the snow; rails and tubes: a steel bar on dark legs; in 0.5 m pieces
  for (const r of JIBS) {
    const q = r.top, sink = 0.6, n = Math.round(q.len / 0.5);
    for (let i = 0; i < n; i++) {
      const u0 = i * q.len / n, u1 = (i + 1) * q.len / n;
      if (r.kind === 'box') {
        P.push(beam(along(q, u0, 0, -0.03), along(q, u1, 0, -0.03), 2 * r.hw, 0.06, BOX_TOP, o));
        const p0 = along(q, u0, 0), p1 = along(q, u1, 0), g = Math.min(base(p0[0], p0[2]), base(p1[0], p1[2])) - sink, mid = (p0[1] + p1[1]) / 2 - 0.06;
        P.push(beam([p0[0], (g + mid) / 2, p0[2]], [p1[0], (g + mid) / 2, p1[2]], 2 * r.hw, mid - g, DARK, o));
      } else {
        const t = r.kind === 'tube' ? 0.45 : 0.1;
        P.push(beam(along(q, u0, 0, -t / 2), along(q, u1, 0, -t / 2), t, t, r.kind === 'tube' ? TUBE : STEEL, o));
      }
    }
    if (r.kind !== 'box') for (let u = 0.4; u < q.len; u += Math.max(2.5, (q.len - 0.8) / 3)) {
      const top = along(q, u, 0, -0.1), g = base(top[0], top[2]) - sink;
      P.push(beam([top[0], g, top[2]], top, 0.12, 0.12, DARK, o));
    }
  }
  const mesh = new THREE.Mesh(merge(P), modelMat);
  mesh.position.set(o[0], o[1], o[2]);
  return mesh;
}
// the culvert's sides keep Lunchline skiers inside it, in short pieces along the axis
const culvertWalls = [];
{
  const C = CULVERT, yaw = Math.atan2(C.ax[1], C.ax[0]), n = Math.round((C.a1 - C.a0) / 2), hx = (C.a1 - C.a0) / n / 2;
  for (const sg of [-1, 1]) for (let i = 0; i < n; i++) {
    const a = C.a0 + (2 * i + 1) * hx, t = sg * (C.r - 0.3);
    const w = { x: C.c[0] + C.ax[0] * a - C.ax[1] * t, z: C.c[1] + C.ax[1] * a + C.ax[0] * t, y: 0, hx, hy: 1.2, hz: 0.15, c: Math.cos(yaw), s: Math.sin(yaw), what: 'culvert' };
    culvertWalls.push(w);
    SOLIDS.push(w);
  }
}
const placeWalls = () => { for (const w of culvertWalls) w.y = base(w.x, w.z) + 1.0; };
placeWalls();

// rebuild when the 2 m tiles under the park load or drop, so everything sits on the snow the skier rides
let mode = -1, mesh = null;
const pT = { h: 0, gx: 0, gz: 0 };
function parkGround() {
  if (!state.PATCH || !state.patchOn) return 0;
  for (const p of [...BANK.pts, ...JIBS.map((r) => r.at)]) if (!samplePatch(state.PATCH, p[0], p[1], pT)) return 0;
  return 1;
}
export function updatePark() {
  const m = parkGround();
  if (m !== mode) {
    mode = m;
    bankHeights(); setTops(); placeWalls();
    for (const k of [bermK, rollK, spineK, bankK]) k.mode = -1;     // lifts.js remeshes the snow
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    mesh = buildMesh();
    scene.add(mesh);
  }
  mesh.visible = Math.hypot(CULVERT.c[0] - camera.position.x, CULVERT.c[1] - camera.position.z) < RING_FAR;
}

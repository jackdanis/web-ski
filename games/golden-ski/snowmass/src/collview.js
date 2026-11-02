// World collision view (Tab: Show world collision). Shows what physics hits around the camera:
// light turquoise is the ground Goldie rides on, drawn at the exact height sample() returns (snow, kickers, decks,
// roofs, bridges), and dark purple is every wall: solid boxes and the upright circles of trunks, rocks, towers and posts.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { state } from './state.js';
import { cellKey, physics } from './config.js';
import { SOLIDS, sample, solidsAt, treeCells } from './world.js';
import { camera, scene } from './scene.js';

const GROUND_R = 96;                     // m of ground grid around the camera
const WALL_R = 140;                      // m of walls around the camera
const TILE = 16, STEP = 1, N = TILE / STEP + 1;
const TILES_PER_FRAME = 6;
const GROUND = 0x7ff5e6, WALL = 0x4a1f7a;

// ---------- Ground: 16 m tiles of the collision height, built a few a frame ----------
const groundMat = new THREE.ShaderMaterial({
  uniforms: { uC: { value: new THREE.Vector2() }, uR: { value: GROUND_R }, uCol: { value: new THREE.Color(GROUND) } },
  vertexShader: `varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform vec2 uC; uniform float uR; uniform vec3 uCol; varying vec3 vW;
    void main() {
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      if (abs(n.y) < 0.3) discard;          // the jump up onto a box top is a step in the height, not ground
      vec2 g = abs(fract(vW.xz / 2.0 - 0.5) - 0.5) / fwidth(vW.xz / 2.0);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float fade = 1.0 - smoothstep(uR * 0.75, uR, distance(vW.xz, uC));
      gl_FragColor = vec4(uCol, mix(0.22, 0.8, line) * fade);
    }`,
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
});
const tileIndex = (() => {
  const idx = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i;
    idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
  }
  return idx;
})();
const tiles = new Map();
const ss = { h: 0, gx: 0, gz: 0 };
function buildTile(ti, tj) {
  const pos = new Float32Array(N * N * 3), x0 = ti * TILE, z0 = tj * TILE;
  const keep = state.solidY;
  state.solidY = 1e9;                     // every box top and bridge deck counts as ground from above
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = (j * N + i) * 3, x = x0 + i * STEP, z = z0 + j * STEP;
    pos[k] = x; pos[k + 1] = sample(x, z, ss).h + 0.04; pos[k + 2] = z;
  }
  state.solidY = keep;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(tileIndex);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, groundMat);
  m.renderOrder = 9;
  scene.add(m);
  return m;
}
function updateGround(cx, cz, on) {
  groundMat.uniforms.uC.value.set(cx, cz);
  const need = new Set();
  if (on) {
    const r = Math.ceil(GROUND_R / TILE), ci = Math.floor(cx / TILE), cj = Math.floor(cz / TILE), want = [];
    for (let b = cj - r; b <= cj + r; b++) for (let a = ci - r; a <= ci + r; a++) {
      const dx = Math.max(0, Math.abs((a + 0.5) * TILE - cx) - TILE / 2), dz = Math.max(0, Math.abs((b + 0.5) * TILE - cz) - TILE / 2);
      if (dx * dx + dz * dz > GROUND_R * GROUND_R) continue;
      const key = a + ',' + b;
      need.add(key);
      if (!tiles.has(key)) want.push([dx * dx + dz * dz, a, b, key]);
    }
    want.sort((p, q) => p[0] - q[0]);
    for (const [, a, b, key] of want.slice(0, TILES_PER_FRAME)) tiles.set(key, buildTile(a, b));
  }
  for (const [key, m] of tiles) {
    if (need.has(key)) continue;
    scene.remove(m); m.geometry.dispose(); tiles.delete(key);
  }
}

// ---------- Walls: instanced boxes and upright cylinders ----------
const shade = (geo) => {                  // faces lit from above-left so the shapes read without scene lights
  const n = geo.attributes.normal, col = new Float32Array(n.count * 3), L = new THREE.Vector3(-0.4, 0.8, 0.45).normalize();
  for (let k = 0; k < n.count; k++) {
    const b = 0.6 + 0.4 * Math.max(0, n.getX(k) * L.x + n.getY(k) * L.y + n.getZ(k) * L.z);
    col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
};
const wallMat = new THREE.MeshBasicMaterial({ color: WALL, vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
const MAX_BOX = 3000, MAX_CYL = 6000;
const boxes = new THREE.InstancedMesh(shade(new THREE.BoxGeometry(2, 2, 2)), wallMat, MAX_BOX);
const cyls = new THREE.InstancedMesh(shade(new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0)), wallMat, MAX_CYL);
for (const m of [boxes, cyls]) { m.frustumCulled = false; m.renderOrder = 11; m.count = 0; m.visible = false; scene.add(m); }
const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
const seen = new Set();
let lastX = Infinity, lastZ = Infinity, lastN = -1, lastT = 0;
function updateWalls(cx, cz) {
  const now = performance.now();
  if (Math.hypot(cx - lastX, cz - lastZ) < 4 && SOLIDS.length === lastN && now - lastT < 1000) return;
  lastX = cx; lastZ = cz; lastN = SOLIDS.length; lastT = now;
  // boxes: the 32 m solid cells in reach
  let nb = 0;
  seen.clear();
  for (let z = cz - WALL_R; z <= cz + WALL_R + 32; z += 32) for (let x = cx - WALL_R; x <= cx + WALL_R + 32; x += 32) {
    for (const b of solidsAt(x, z)) {
      if (seen.has(b) || nb >= MAX_BOX) continue;
      seen.add(b);
      if (Math.hypot(b.x - cx, b.z - cz) > WALL_R + b.hx + b.hz) continue;
      q.setFromAxisAngle(Y, Math.atan2(b.s, b.c));
      boxes.setMatrixAt(nb++, mtx.compose(p.set(b.x, b.y, b.z), q, s.set(b.hx, b.hy, b.hz)));
    }
  }
  boxes.count = nb;
  boxes.instanceMatrix.needsUpdate = true;
  // circles: the 8 m obstacle cells in reach; each only stops her below 80% of its height
  let nc = 0;
  const r = Math.ceil(WALL_R / 8), ci = Math.floor(cx / 8), cj = Math.floor(cz / 8);
  q.identity();
  for (let b = cj - r; b <= cj + r; b++) for (let a = ci - r; a <= ci + r; a++) {
    const list = treeCells.get(cellKey(a, b));
    if (!list) continue;
    for (const t of list) {
      if (!(t.r > 0) || nc >= MAX_CYL) continue;
      if (Math.hypot(t.x - cx, t.z - cz) > WALL_R) continue;
      cyls.setMatrixAt(nc++, mtx.compose(p.set(t.x, t.y, t.z), q, s.set(t.r, t.height * 0.8, t.r)));
    }
  }
  cyls.count = nc;
  cyls.instanceMatrix.needsUpdate = true;
}

export function updateWorldCollision() {
  const on = !!physics.world, cx = camera.position.x, cz = camera.position.z;
  boxes.visible = cyls.visible = on;
  updateGround(cx, cz, on);
  if (on) updateWalls(cx, cz);
  else lastX = Infinity;
}

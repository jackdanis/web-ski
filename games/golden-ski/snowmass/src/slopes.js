// Run props (signs, ropes, fence, roads), the 2 m run meshes and their streaming, and the start points.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from '../data/mountain.js';
import { RUN_DATA } from '../data/runs.js';
import { state } from './state.js';
import { clamp } from './config.js';
import { BERM_W, BLEND, BRIDGES, CELL, H, META, NX, NZ, PCELL, POWDER, RUNF, SOLIDS, STATIONS, X0, Z0, addObstacle, aspen, cellAt, conifer, gridH, groundY, inflate, isRock, nearSolid, offMap, patchEdge, sample, sampleBase, sampleGrid, stationAt } from './world.js';
import { LIGHT, LIGHT_GLSL, camera, queueWork, renderer, scene, terrainMat, workKey } from './scene.js';
import { SNOWCAP, TILES, addBase, addBuilding, addIndustrial, addMapStand, addSamsKnob, addUp4Pizza, addByPage, addRinged, bucket, casters, flushBuildings, merge, mergeAny, modelMat, part, placeM, placed } from './buildings.js';
import { KIND, TREE_R, addProp } from './trees.js';
import { LIFTS } from './lifts.js';

// ---------- Run props: trail signs, rope lines, fence ----------
export const RUNS = MAP.runs || [];
// Named buildings from Jack's laser notes batch 2 (2026-10-27), by stand-in block centre; SKIP blocks go
const SPECIAL = [[2027.7, -5583.5, 'base'], [-390.8, -2971.7, 'sams'], [-158.7, -1013.2, 'up4'], [-342.3, -2936.9, 'map']];
const SKIP = [[-338.6, -2933.0]];                     // a shed footprint inside the trail-map stand
// Stand-in blocks drawn as industrial buildings, by centre: the maintenance buildings at Max Park (Jack's pin 4)
const INDUSTRIAL = [[-350.8, -2846.4], [-383.6, -2840.6], [-358.8, -2826.2], [-332.5, -2854.8], [-334.8, -2866.2], [-338, -2874.4]];
function nearestRunPoint(x, z) {
  let best = Infinity, at = [x, z + 1];
  for (const r of RUNS) for (const [px, pz] of r.points) {
    const d = Math.hypot(px - x, pz - z);
    if (d < best) { best = d; at = [px, pz]; }
  }
  return at;
}
// point and direction some distance down a run
function alongRun(run, dist) {
  const p = run.points;
  let left = dist;
  for (let i = 0; i < p.length - 1; i++) {
    const dx = p[i + 1][0] - p[i][0], dz = p[i + 1][1] - p[i][1], len = Math.hypot(dx, dz) || 1;
    if (left <= len || i === p.length - 2) {
      const f = Math.min(1, left / len);
      return { x: p[i][0] + dx * f, z: p[i][1] + dz * f, ux: dx / len, uz: dz / len, end: left > len };
    }
    left -= len;
  }
}
// ---------- The runs on a 2 m grid ----------
// Every run is a 2 m height grid shaped offline from the traced outlines. Physics samples it; a fine mesh draws it,
// blending back to the 10 m mountain over BLEND m past the edge, with the 10 m ground cut away underneath.
// 64 x 64-point tiles (128 m) only where runs reach, meshed 2 x 2 tiles at a time: 2 m cells within PATCH_NEAR,
// 4 m to PATCH_MID, 8 m to PATCH_FAR, then the 10 m ground draws the runs. Physics always uses the 2 m grid.
const TILE_BITS = 6, TILE = 1 << TILE_BITS, TT = TILE * TILE, MESH_TILES = 2, PATCH_NEAR = 250, PATCH_MID = 400, PATCH_FAR = 800;
export const PATCH_STEP = [1, 2, 4];    // cell size per level, in 2 m points
const PATCH_AHEAD = 120;         // m: meshes are built this far ahead of where they show
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// the 10 m mesh's own surface: the same two triangles per cell buildChunk draws
export function meshY(x, z) {
  const fx = clamp((x - X0) / CELL, 0, NX - 1.001), fz = clamp((z - Z0) / CELL, 0, NZ - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const h00 = gridH(i, j), h10 = gridH(i + 1, j), h01 = gridH(i, j + 1), h11 = gridH(i + 1, j + 1);
  if ((i + j) & 1) return tx + tz <= 1 ? h00 + tx * (h10 - h00) + tz * (h01 - h00) : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  return tx >= tz ? h00 + tx * (h10 - h00) + tz * (h11 - h10) : h00 + tz * (h01 - h00) + tx * (h11 - h01);
}
// runs.js: index, edge trees, stand-in blocks and two 10 m fields. runs/<ca>_<cj>.json: 4 x 4 tiles each, streamed by
// distance, holding per point the height change from the 10 m surface (mm, row deltas) and int8 distances to the
// groomed edge and any run's edge. Physics heights rebuild on load; mesh heights and blend weights per tile on demand.
const RUN_LOAD = 1200, RUN_DROP = 1700;          // m: load nearer than this, drop farther than that
export let runStream = null;
if (RUN_DATA) {
  const B = RUN_DATA, x0 = B.x0, z0 = B.z0, tx = B.nx / TILE, tz = B.nz / TILE, CH = B.chunk, step = B.edge_step;
  const P = { x0, z0, cell: PCELL, nx: B.nx, nz: B.nz, key: 'runs', tiles: [], baked: true, nodes: B.tiles.length / 2 * TT };
  // a grid point's slot in the loaded tiles, or -1
  const tileOf = new Int32Array(tx * tz).fill(-1);
  P.at = (a, j) => {
    if (a < 0 || j < 0 || a >= P.nx || j >= P.nz) return -1;
    const t = tileOf[(j >> TILE_BITS) * tx + (a >> TILE_BITS)];
    return t < 0 ? -1 : t * TT + ((j & (TILE - 1)) << TILE_BITS) + (a & (TILE - 1));
  };
  // tile slots, grown as needed
  let cap = 0;
  const free = [], slotTile = [];
  const grow = (n) => {
    const fit = (A, T) => { const b = new T(n * TT); if (A) b.set(A); return b; };
    P.hp = fit(P.hp, Float32Array); P.edge = fit(P.edge, Float32Array); P.aedge = fit(P.aedge, Int8Array);
    P.hr = fit(P.hr, Float32Array); P.wmin = fit(P.wmin, Float32Array);
    const d = new Uint8Array(n); if (P.done) d.set(P.done); P.done = d;
    for (let t = n - 1; t >= cap; t--) free.push(t);
    cap = n;
  };
  grow(64);
  // mesh heights and blend weights: shaped snow near runs, the 10 m mesh where blended back
  const base = { h: 0, gx: 0, gz: 0 };
  const fill = (t) => {
    if (P.done[t]) return;
    P.done[t] = 1;
    const tl = slotTile[t];
    for (let q = 0; q < TT; q++) {
      const c = t * TT + q, x = x0 + (tl.a0 + (q & (TILE - 1))) * PCELL, z = z0 + (tl.j0 + (q >> TILE_BITS)) * PCELL;
      const w = smoothstep(BERM_W, BLEND, P.aedge[c] * step);
      P.wmin[c] = w;
      P.hr[c] = P.hp[c] + w * (meshY(x, z) - sampleGrid(H, NX, NZ, X0, Z0, CELL, x, z, base).h);
    }
  };
  // a group's tiles and their neighbors (skirts read one point past the border)
  P.ready = (g) => {
    for (const tl of g.tiles) for (let dj = -1; dj <= 1; dj++) for (let da = -1; da <= 1; da++) {
      const c = P.at(tl.a0 + da * TILE, tl.j0 + dj * TILE);
      if (c >= 0) fill((c / TT) | 0);
    }
  };
  // files, and the 2 x 2 tile groups meshes are built for
  const chunks = new Map(), side = TILE * CH * PCELL;
  for (const [ca, cj] of B.chunks) {
    chunks.set(ca * 1000 + cj, { ca, cj, x0: x0 + ca * side, z0: z0 + cj * side, x1: x0 + (ca + 1) * side, z1: z0 + (cj + 1) * side, state: 0, tiles: [], groups: [] });
  }
  const around = (ch) => {
    const out = [];
    for (let dj = -1; dj <= 1; dj++) for (let da = -1; da <= 1; da++) if (da || dj) out.push(chunks.get((ch.ca + da) * 1000 + ch.cj + dj));
    return out;
  };
  // edge cells read the next tile, so a group builds once its file and its neighbors are in
  const inAround = (ch) => ch.state === 2 && around(ch).every((n) => !n || n.state === 2);
  P.groupOk = (g) => inAround(g.chunk);
  const groups = new Map();
  for (let k = 0; k < B.tiles.length; k += 2) {
    const tl = { a0: B.tiles[k], j0: B.tiles[k + 1] };
    P.tiles.push(tl);
    const ga = Math.floor(tl.a0 / (TILE * MESH_TILES)), gj = Math.floor(tl.j0 / (TILE * MESH_TILES));
    if (!groups.has(ga * 10000 + gj)) {
      const a0 = ga * TILE * MESH_TILES, j0 = gj * TILE * MESH_TILES, gs = TILE * MESH_TILES * PCELL;
      const chunk = chunks.get(Math.floor(tl.a0 / (TILE * CH)) * 1000 + Math.floor(tl.j0 / (TILE * CH)));
      const g = { tiles: [], a0, j0, x0: x0 + a0 * PCELL, z0: z0 + j0 * PCELL, x1: x0 + a0 * PCELL + gs, z1: z0 + j0 * PCELL + gs, meshes: [null, null, null], level: -1, chunk };
      groups.set(ga * 10000 + gj, g);
      chunk.groups.push(g);
    }
    groups.get(ga * 10000 + gj).tiles.push(tl);
  }
  P.groups = [...groups.values()];
  const dropMeshes = (g) => {
    for (let l = 0; l < g.meshes.length; l++) if (g.meshes[l]) { scene.remove(g.meshes[l]); g.meshes[l].geometry.dispose(); g.meshes[l] = null; }
    g.level = -1;
  };
  // The 10 m ground is cut away in 4 m blocks the fine mesh fully covers.
  const mw = P.nx / 2, mh = P.nz / 2, mask = new Uint8Array(mw * mh);
  const tex = new THREE.DataTexture(mask, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  const covered = (a, j) => { const c = P.at(a, j); return c >= 0 && P.aedge[c] * step < BLEND; };
  // only the changed rows are uploaded once the texture is on the GPU (the whole mask is about 8 MB)
  const uploadMask = (r0, r1) => {
    const gl = renderer.getContext(), tp = renderer.properties.get(tex);
    if (!tp.__webglTexture || tp.__version !== tex.version) { tex.needsUpdate = true; return; }
    renderer.state.bindTexture(gl.TEXTURE_2D, tp.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, mw, r1 - r0, gl.RED, gl.UNSIGNED_BYTE, mask, r0 * mw);
  };
  const maskTiles = (list) => {
    if (!list.length) return;
    let r0 = mh, r1 = 0;
    for (const tl of list) {
      r0 = Math.min(r0, tl.j0 / 2); r1 = Math.max(r1, (tl.j0 + TILE) / 2);
      for (let bj = tl.j0 / 2; bj < (tl.j0 + TILE) / 2; bj++) {
        for (let bi = tl.a0 / 2; bi < (tl.a0 + TILE) / 2; bi++) {
          let all = true;
          for (let j = 2 * bj; j <= 2 * bj + 2 && all; j++) for (let a = 2 * bi; a <= 2 * bi + 2 && all; a++) all = covered(a, j);
          mask[bj * mw + bi] = all ? 255 : 0;
        }
      }
    }
    uploadMask(r0, Math.min(r1, mh));
  };
  const crw = (t, w, o) => {
    const t2 = t * t, t3 = t2 * t;
    w[o] = 0.5 * (-t + 2 * t2 - t3); w[o + 1] = 0.5 * (2 - 5 * t2 + 3 * t3); w[o + 2] = 0.5 * (t + 4 * t2 - 3 * t3); w[o + 3] = 0.5 * (t3 - t2);
  };
  const wx = new Float32Array(TILE * 4), ix = new Int32Array(TILE), wz = new Float32Array(4);
  async function loadChunk(ch) {
    ch.state = 1;
    let J, bytes;
    try {
      J = await (await fetch(new URL(`../data/runs/${ch.ca}_${ch.cj}.json`, import.meta.url))).json();
      bytes = await inflate(J.data);
    } catch (e) { console.warn('Golden Ski: run tiles failed to load', ch.ca, ch.cj, e); ch.state = 0; return; }
    if (ch.state !== 1) return;                     // dropped while loading
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), n = J.tiles.length / 2, N = n * TT;
    const dh = new Int16Array(buf, 0, N), e8 = new Int8Array(buf, N * 2, N), a8 = new Int8Array(buf, N * 3, N);
    if (free.length < n) grow(cap + Math.max(n, 64));
    for (let k = 0; k < n; k++) {
      const tl = { a0: J.tiles[2 * k], j0: J.tiles[2 * k + 1] }, t = free.pop();
      tl.slot = t; slotTile[t] = tl; ch.tiles.push(tl); P.done[t] = 0;
      // sampleGrid's surface at the tile's points, column weights once per tile
      for (let a = 0; a < TILE; a++) {
        const f = clamp((x0 + (tl.a0 + a) * PCELL - X0) / CELL, 0, NX - 1.001), i = Math.floor(f);
        ix[a] = i; crw(f - i, wx, a * 4);
      }
      for (let j = 0; j < TILE; j++) {
        const f = clamp((z0 + (tl.j0 + j) * PCELL - Z0) / CELL, 0, NZ - 1.001), jj = Math.floor(f);
        crw(f - jj, wz, 0);
        const o = k * TT + j * TILE, oo = t * TT + j * TILE;
        let q = 0;
        for (let a = 0; a < TILE; a++) {
          let h = 0;
          for (let m = 0; m < 4; m++) {
            const row = clamp(jj - 1 + m, 0, NZ - 1) * NX, i = ix[a];
            h += wz[m] * (wx[a * 4] * H[row + clamp(i - 1, 0, NX - 1)] + wx[a * 4 + 1] * H[row + clamp(i, 0, NX - 1)]
              + wx[a * 4 + 2] * H[row + clamp(i + 1, 0, NX - 1)] + wx[a * 4 + 3] * H[row + clamp(i + 2, 0, NX - 1)]);
          }
          q += dh[o + a];
          P.hp[oo + a] = h + q / 1000;
          P.edge[oo + a] = e8[o + a] * step;
          P.aedge[oo + a] = a8[o + a];
        }
      }
      tileOf[(tl.j0 >> TILE_BITS) * tx + (tl.a0 >> TILE_BITS)] = t;
    }
    ch.state = 2;
    const near = around(ch).filter((c) => c && c.state === 2);
    maskTiles([ch, ...near].flatMap((c) => c.tiles));
    // neighbor meshes were built without these edge points: rebuild them
    for (const c of near) for (const g of c.groups) dropMeshes(g);
  }
  function unloadChunk(ch) {
    for (const g of ch.groups) dropMeshes(g);
    for (const tl of ch.tiles) { tileOf[(tl.j0 >> TILE_BITS) * tx + (tl.a0 >> TILE_BITS)] = -1; free.push(tl.slot); }
    const was = ch.state === 2, old = ch.tiles;
    ch.state = 0; ch.tiles = [];
    if (was) maskTiles([...old, ...around(ch).filter((c) => c && c.state === 2).flatMap((c) => c.tiles)]);
  }
  const dist = (ch, x, z) => Math.hypot(Math.max(ch.x0 - x, 0, x - ch.x1), Math.max(ch.z0 - z, 0, z - ch.z1));
  let at = null;
  runStream = (x, z, force) => {
    if (!force && at && Math.hypot(x - at.x, z - at.z) < 40) return [];
    at = { x, z };
    const loads = [];
    for (const ch of chunks.values()) {
      const d = dist(ch, x, z);
      if (d < RUN_LOAD && ch.state === 0) loads.push(ch.loading = loadChunk(ch));
      else if (d < RUN_LOAD && ch.state === 1 && force) loads.push(ch.loading);   // already on its way: wait for it too
      else if (d > RUN_DROP && ch.state === 2) unloadChunk(ch);
      else if (d > RUN_DROP && ch.state === 1) ch.state = 0;
    }
    return loads;
  };
  P.mat = new THREE.ShaderMaterial({
    uniforms: terrainMat.uniforms, vertexShader: terrainMat.vertexShader, fragmentShader: terrainMat.fragmentShader,
    defines: { PATCH: 1 }, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  });
  terrainMat.uniforms.uPMask.value = tex;
  terrainMat.uniforms.uPMin.value.set(x0, z0);
  terrainMat.uniforms.uPSize.value.set(mw * 2 * PCELL, mh * 2 * PCELL);
  terrainMat.uniforms.uPFar.value = PATCH_FAR;
  terrainMat.uniforms.uPOn.value = 1;
  state.PATCH = P;
  // the 10 m ground draws the same groomed edges where no tiles are loaded
  const [runfB, areaB, treeB] = await Promise.all([inflate(B.runf), inflate(B.area), inflate(B.trees)]);
  for (let k = 0; k < RUNF.length; k++) { RUNF[k] = (runfB[k] << 24) >> 24; POWDER[k] = RUNF[k] < 0 ? 0 : 1; }
  // Run area (the generated forest keeps clear) and the real edge and island trees from the 1 m canopy map.
  // The packed fill (kind + 128) draws only within FILL_NEAR; every tree is solid.
  state.RUN_AREA = new Int8Array(areaB.buffer, areaB.byteOffset, areaB.length);
  const dv = new DataView(treeB.buffer, treeB.byteOffset, treeB.length);
  for (let n = 0; n < B.ntrees; n++) {
    const o = n * 8, x = dv.getInt16(o, true) / 2, z = dv.getInt16(o + 2, true) / 2, height = dv.getUint8(o + 4) / 10, kind = dv.getUint8(o + 5) & 127;
    const ground = STATIONS.length && stationAt(x, z) ? groundY(x, z) : dv.getUint16(o + 6, true) / 10;
    const t = { x, z, y: ground - (kind === KIND.snowghost ? 0.5 : 0.3), height, r: TREE_R[kind] * height, kind, fill: dv.getUint8(o + 5) >> 7 };
    addProp(t);
    addObstacle(t);
  }
  // Stand-in blocks on building footprints until real buildings exist; skipped where they overlap a station or solid.
  // INDUSTRIAL blocks get the industrial building instead, SPECIAL blocks their named building.
  for (const [x, z, w, l, yawD, h, y0, y1] of B.blocks) {
    if (nearSolid(x, z, Math.max(w, l) / 2) || (STATIONS.length && stationAt(x, z))) continue;
    if (SKIP.some(([ix, iz]) => Math.hypot(ix - x, iz - z) < 1)) continue;
    const special = SPECIAL.find(([ix, iz]) => Math.hypot(ix - x, iz - z) < 1);
    if (special) {
      const yaw = yawD * Math.PI / 180, [rx, rz] = nearestRunPoint(x, z);
      const lz = Math.sin(yaw) * (rx - x) + Math.cos(yaw) * (rz - z), lx = Math.cos(yaw) * (rx - x) - Math.sin(yaw) * (rz - z);
      const b = { x, z, yaw, w, l, bot: y0 - 1, ground: y1, front: Math.sign(w >= l ? lz : lx) || 1 };
      if (special[2] === 'base') addBase(b);
      else if (special[2] === 'sams') addSamsKnob(b);
      else if (special[2] === 'map') addMapStand(b);
      else {
        const g = sampleBase(x, z, { h: 0, gx: 0, gz: 0 }), n = Math.hypot(g.gx, g.gz) || 1;
        addUp4Pizza(b, [g.gx / n, g.gz / n]);
      }
      continue;
    }
    if (INDUSTRIAL.some(([ix, iz]) => Math.hypot(ix - x, iz - z) < 1)) {
      const yaw = yawD * Math.PI / 180, [rx, rz] = nearestRunPoint(x, z);
      // local z in the world, as placeM turns it: the door side faces the run
      const lz = Math.sin(yaw) * (rx - x) + Math.cos(yaw) * (rz - z), lx = Math.cos(yaw) * (rx - x) - Math.sin(yaw) * (rz - z);
      addIndustrial({ x, z, yaw, w, l, bot: y0 - 1, ground: y1, front: Math.sign(w >= l ? lz : lx) || 1 });
      continue;
    }
    addBuilding({ x, z, yaw: yawD * Math.PI / 180, w, l, bot: y0 - 1, top: y1 + h, what: 'stand-in building' });
  }
  flushBuildings();
}
function buildGroupMesh(P, g, level) {
  if (P.ready) P.ready(g);
  const s = PATCH_STEP[level], side = TILE * MESH_TILES, { hr, edge, wmin } = P;
  const vert = new Map(), pos = [], cov = [], nrm = [], idx = [];
  const h = (a, j) => { const c = P.at(a, j); return c < 0 ? null : hr[c]; };
  const v = (a, j, drop) => {
    const key = (j * P.nx + a) * 3 + (drop === undefined ? 0 : drop ? 2 : 1);   // surface, skirt top, skirt foot
    let n = vert.get(key);
    if (n === undefined) {
      const c = P.at(a, j), x = P.x0 + a * PCELL, z = P.z0 + j * PCELL, k = cellAt(x, z);
      n = pos.length / 3;
      vert.set(key, n);
      pos.push(x, hr[c] - (drop ? 1.5 * s : 0), z);
      cov.push(edge[c], isRock(k) && edge[c] > 3 ? 1 : 0, conifer(k), aspen(k));
      if (drop === undefined) nrm.push(0, 0, 0);
      else {
        // skirt normals match the run beside them
        const hl = h(a - 1, j) ?? hr[c], hx = h(a + 1, j) ?? hr[c], hu = h(a, j - 1) ?? hr[c], hd = h(a, j + 1) ?? hr[c];
        nrm.push(-(hx - hl) / (2 * PCELL), 1, -(hd - hu) / (2 * PCELL));
      }
    }
    return n;
  };
  const skirt = (a1, j1, a2, j2) => {
    const p = v(a1, j1, false), q = v(a2, j2, false), p2 = v(a1, j1, true), q2 = v(a2, j2, true);
    idx.push(p, p2, q, q, p2, q2, p, q, p2, q, q2, p2);   // both windings
  };
  for (const tl of g.tiles) {
    for (let j = tl.j0; j < tl.j0 + TILE; j += s) {
      for (let a = tl.a0; a < tl.a0 + TILE; a += s) {
        let any = false, ok = true;
        for (let jj = j; jj <= j + s && ok; jj++) for (let aa = a; aa <= a + s && ok; aa++) {
          const c = P.at(aa, jj);
          if (c < 0) ok = false; else if (wmin[c] < 1) any = true;
        }
        if (!ok || !any) continue;
        const k00 = v(a, j), k10 = v(a + s, j), k01 = v(a, j + s), k11 = v(a + s, j + s);
        if (((a + j) / s) & 1) idx.push(k00, k01, k10, k10, k01, k11);
        else idx.push(k00, k01, k11, k00, k11, k10);
        if (a === g.a0) skirt(a, j, a, j + s);
        if (a + s === g.a0 + side) skirt(a + s, j, a + s, j + s);
        if (j === g.j0) skirt(a, j, a + s, j);
        if (j + s === g.j0 + side) skirt(a, j + s, a + s, j + s);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aCov', new THREE.BufferAttribute(new Float32Array(cov), 4));
  geo.setAttribute('aN', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, P.mat);
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.userData.tris = idx.length / 3;
  scene.add(mesh);
  return mesh;
}
// Levels by distance (none past PATCH_FAR, where the shaders cut). The level a group will need PATCH_AHEAD m sooner
// is built in the work queue; one that has nothing showing yet builds at once. Finer meshes are freed once well away.
const patchLevel = (d) => d >= PATCH_FAR ? -1 : d < PATCH_NEAR ? 0 : d < PATCH_MID ? 1 : 2;
export function updatePatch() {
  if (!state.PATCH) return;
  const cx = camera.position.x, cz = camera.position.z;
  if (runStream) runStream(cx, cz);
  for (const g of state.PATCH.groups) {
    const d = Math.hypot(Math.max(g.x0 - cx, 0, cx - g.x1), Math.max(g.z0 - cz, 0, cz - g.z1));
    const off = !state.patchOn || (state.PATCH.groupOk && !state.PATCH.groupOk(g));
    const level = off ? -1 : patchLevel(d), ahead = off ? -1 : patchLevel(Math.max(0, d - PATCH_AHEAD));
    if (ahead >= 0 && ahead !== level && !g.meshes[ahead] && !state.workAll) {
      queueWork(workKey(g, ahead), d, () => { if (!g.meshes[ahead] && state.PATCH.groupOk(g)) g.meshes[ahead] = buildGroupMesh(state.PATCH, g, ahead); });
    }
    if (level === g.level) continue;
    if (level >= 0 && !g.meshes[level]) {
      if (g.level >= 0 && !state.workAll) {
        queueWork(workKey(g, level), d, () => { if (!g.meshes[level] && state.PATCH.groupOk(g)) g.meshes[level] = buildGroupMesh(state.PATCH, g, level); });
        continue;
      }
      g.meshes[level] = buildGroupMesh(state.PATCH, g, level);
    }
    g.meshes.forEach((m, l) => { if (m) m.visible = l === level; });
    for (let l = 0; l < g.meshes.length; l++) {
      if (g.meshes[l] && (level < 0 ? l < 2 : l < level - 1)) { scene.remove(g.meshes[l]); g.meshes[l].geometry.dispose(); g.meshes[l] = null; }
    }
    g.level = level;
  }
}
export function setPatch(on) {
  state.patchOn = on;
  updatePatch();
  terrainMat.uniforms.uPOn.value = on && state.PATCH ? 1 : 0;
}
const onGroomed = (x, z) => { const e = patchEdge(x, z); return e === undefined ? RUNF[cellAt(x, z)] < 0 : e < 0; };
// Sign boards on one canvas: difficulty symbol on a light patch, name on dark wood. Boards grow to fit the name
// up to SIGN_MAX px; only longer names shrink.
const SIGN_W = 256, SIGN_H = 32, SIGN_COLS = 4, SIGN_MIN = 120, SIGN_MAX = 181, SIGN_M = 0.6 / SIGN_H;   // m per px
const SIGNS = (RUN_DATA && RUN_DATA.signs) || [];
const signCanvas = document.createElement('canvas');
signCanvas.width = SIGN_W * SIGN_COLS; signCanvas.height = SIGN_H * Math.max(1, Math.ceil(SIGNS.length / SIGN_COLS));
const signPx = [];                             // board length in px
{
  const g = signCanvas.getContext('2d'), P = SIGN_H, pad = 3;
  SIGNS.forEach(([name, diff], n) => {
    const x = (n % SIGN_COLS) * SIGN_W, y = Math.floor(n / SIGN_COLS) * SIGN_H;
    let size = 20;
    do { g.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`; size--; } while (g.measureText(name).width > SIGN_MAX - P - 14 && size > 8);
    const w = clamp(Math.ceil(P + 6 + g.measureText(name).width + 8), SIGN_MIN, SIGN_MAX);
    signPx.push(w);
    g.fillStyle = '#3b2717'; g.fillRect(x, y, w, SIGN_H);
    g.fillStyle = '#5a3b22'; g.fillRect(x, y + SIGN_H / 2 - 1, w, 2);
    g.strokeStyle = '#1c120a'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, SIGN_H - 2);
    g.fillStyle = '#f1e6c8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, x + P + 3 + (w - P - 3) / 2, y + SIGN_H / 2 + 1);
    const cx = x + P / 2 + 1, cy = y + SIGN_H / 2;
    g.fillStyle = '#f1e6c8'; g.fillRect(x + pad + 1, y + pad, P - 2 * pad, SIGN_H - 2 * pad);
    const diamond = (dx, r) => { g.beginPath(); g.moveTo(cx + dx, cy - r); g.lineTo(cx + dx + r, cy); g.lineTo(cx + dx, cy + r); g.lineTo(cx + dx - r, cy); g.closePath(); g.fill(); };
    if (diff === 'green') { g.fillStyle = '#1f8a3a'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill(); }
    else if (diff === 'blue') { g.fillStyle = '#1b55b5'; g.fillRect(cx - 8.5, cy - 8.5, 17, 17); }
    else if (diff === 'black') { g.fillStyle = '#111111'; diamond(0, 10); }
    else if (diff === 'expert') { g.fillStyle = '#111111'; diamond(-6, 6); diamond(6, 6); }
  });
}
const signTex = new THREE.CanvasTexture(signCanvas);
signTex.magFilter = THREE.NearestFilter; signTex.minFilter = THREE.LinearMipmapLinearFilter;
signTex.colorSpace = THREE.NoColorSpace;
const signMat = new THREE.ShaderMaterial({
  uniforms: Object.assign({ uMap: { value: signTex } }, LIGHT),
  vertexShader: /* glsl */ `
    attribute vec3 aNrm;
    varying vec2 vUv; varying vec3 vP; varying float vD; varying vec3 vNrm;
    void main() {
      vUv = uv; vNrm = aNrm;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vP = w.xyz;
      vec4 mv = viewMatrix * w;
      vD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${LIGHT_GLSL}
    uniform sampler2D uMap;
    varying vec2 vUv; varying vec3 vP; varying float vD; varying vec3 vNrm;
    void main() {
      vec3 n = normalize(vNrm), alb = texture2D(uMap, vUv).rgb;
      float lit = 1.0 - shade(vP) * 0.8;
      vec3 l = uSunC * band(max(0.0, dot(n, uSun))) * lit + uSky * (0.45 + 0.35 * n.y) + uBounce * 0.35 + lamps(vP, n) * 1.2 + 0.05;
      gl_FragColor = vec4(finish(alb, l, vD, 1.25), 1.0);
    }`,
});
const WOOD = [0.36, 0.25, 0.15], WOOD_DARK = [0.24, 0.16, 0.1];
export const runParts = new Map(), signFaces = new Map(), signSpots = [];
// each name's highest mapped line piece (for starts)
const signRuns = new Map();
for (const r of RUNS) {
  if (!r.name || r.area || r.points.length < 2) continue;
  const h = groundY(r.points[0][0], r.points[0][1]), best = signRuns.get(r.name);
  if (!best || h > best.h) signRuns.set(r.name, { run: r, h });
}
// Signs stand where each run begins (tools/runs/signs.py), facing arriving skiers,
// at the first candidate spot clear of huts and stand-in blocks.
SIGNS.forEach(([name, , spots], n) => {
  const spot = spots.find(([x, z]) => !nearSolid(x, z, 1.5));
  if (!spot) return;
  const [x, z, yawD, gy] = spot, yaw = yawD * Math.PI / 180;
  const y = STATIONS.length && stationAt(x, z) ? groundY(x, z) : gy;
  const w = signPx[n] * SIGN_M, post = w / 2 - 0.25;
  signSpots.push({ x, z, name, yaw });
  const m = placeM(x, y - 0.3, z, yaw);
  bucket(runParts, x, z, ...placed([
    // posts behind the board
    part(new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(-post, 1.15, -0.12), WOOD_DARK),
    part(new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(post, 1.15, -0.12), WOOD_DARK),
    part(new THREE.BoxGeometry(w + 0.1, 0.68, 0.08).translate(0, 1.95, 0), WOOD),
  ], m));
  const u0 = (n % SIGN_COLS) * SIGN_W / signCanvas.width, u1 = u0 + signPx[n] / signCanvas.width;
  const v1 = 1 - Math.floor(n / SIGN_COLS) * SIGN_H / signCanvas.height, v0 = v1 - SIGN_H / signCanvas.height;
  const face = new THREE.PlaneGeometry(w, 0.6).translate(0, 1.95, 0.05).applyMatrix4(m);
  const fp = face.attributes.position, fuv = [[u0, v1], [u1, v1], [u0, v0], [u1, v0]], nrm = [Math.sin(yaw), 0, Math.cos(yaw)];
  const pos = [], uv = [], nr = [];
  for (const idx of face.index.array) {
    pos.push(fp.getX(idx), fp.getY(idx), fp.getZ(idx));
    uv.push(...fuv[idx]);
    nr.push(...nrm);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aNrm', new THREE.BufferAttribute(new Float32Array(nr), 3));
  bucket(signFaces, x, z, g);
  casters.push({ x, z, h: 2.3, w: w / 2 });
});
addByPage(signFaces, signMat, mergeAny);
// rope lines down both edges of the first 170 m of Sunnyside and Max Park, and above the buildings below Fanny Hill
// (shared folder: source-data/runs/ropes.json). Each span is a thin solid wall up to the rope, so skiers glance off it.
const ropePts = [];
for (const line of (RUN_DATA && RUN_DATA.ropes) || []) {
  for (let k = 0; k < line.length; k += 3) {
    const [x, z, y] = [line[k], line[k + 1], line[k + 2]];
    addProp({ x, z, y: y - 0.15, height: 1.7, r: 0, kind: KIND.pole });
    if (!k) continue;
    const [px, pz, py] = [line[k - 3], line[k - 2], line[k - 1]], len = Math.hypot(x - px, z - pz) || 1;
    ropePts.push(px, py + 1.25, pz, x, y + 1.25, z);
    SOLIDS.push({ x: (px + x) / 2, z: (pz + z) / 2, y: (py + y) / 2 + 0.6, hx: 0.12, hy: 0.7 + Math.abs(y - py) / 2, hz: len / 2,
      c: (z - pz) / len, s: (x - px) / len, what: 'rope' });
  }
}
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ropePts), 3));
  if (ropePts.length) addRinged(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8261c })));
}
// rail fences: behind the Village Express top terminal, and where Jack's laser notes close the way into building
// areas (shared folder: source-data/runs/fences.json). Posts about 3 m apart with two rails; the laser-note fences
// are thin solid walls, like the ropes.
function railFence(posts, solid) {
  let last = null;
  for (const [x, y, z] of posts) {
    bucket(runParts, x, z, part(new THREE.BoxGeometry(0.18, 1.3, 0.18).translate(0, 0.65, 0), WOOD_DARK, new THREE.Matrix4().setPosition(x, y, z)));
    if (last) {
      const mx = (x + last[0]) / 2, mz = (z + last[2]) / 2, my = (y + last[1]) / 2, l = Math.hypot(x - last[0], z - last[2]);
      const tilt = Math.atan2(y - last[1], l), yaw = Math.atan2(x - last[0], z - last[2]);
      for (const h of [0.55, 1.05]) {
        const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(-tilt)).setPosition(mx, my + h, mz);
        bucket(runParts, x, z, part(new THREE.BoxGeometry(0.1, 0.12, l + 0.2), WOOD, m));
      }
      if (solid) {
        SOLIDS.push({ x: mx, z: mz, y: my + 0.6, hx: 0.12, hy: 0.7 + Math.abs(y - last[1]) / 2, hz: l / 2,
          c: (z - last[2]) / l, s: (x - last[0]) / l, what: 'fence' });
      }
    }
    last = [x, y, z];
    casters.push({ x, z, h: 1.3, w: 0.2 });
  }
}
{
  const ve = LIFTS.find((l) => l.name === 'Village Express');
  if (ve) {
    const p = ve.points, a = p[p.length - 2], b = p[p.length - 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const cx = b[0] + ux * 16, cz = b[1] + uz * 16, posts = [];
    for (let s = -18; s <= 18; s += 3) {
      const x = cx + uz * s, z = cz - ux * s;
      posts.push([x, groundY(x, z) - 0.2, z]);
    }
    railFence(posts, false);
  }
  for (const line of (RUN_DATA && RUN_DATA.fences) || []) {
    const posts = [];
    for (let k = 0; k < line.length; k += 3) posts.push([line[k], line[k + 2] - 0.2, line[k + 1]]);
    railFence(posts, true);
  }
}
// Wood Rd from the bridge to Base Village in concrete (runs.js roads), and the stone ski bridge over it
{
  const shared = { vertexColors: true, uniforms: modelMat.uniforms, vertexShader: modelMat.vertexShader, fragmentShader: modelMat.fragmentShader, side: THREE.DoubleSide };
  const roadMat = new THREE.ShaderMaterial({ ...shared, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const bridgeMat = new THREE.ShaderMaterial(shared);
  const strip = (pos) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); return g; };
  const quad = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  for (const [q, hw] of (RUN_DATA && RUN_DATA.roads) || []) {
    const pos = [];
    for (let k = 0; k + 5 < q.length; k += 3) {
      const [ax, az, ay, bx, bz, by] = q.slice(k, k + 6), L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
      pos.push(...quad([ax - nx, ay + 0.1, az - nz], [ax + nx, ay + 0.1, az + nz], [bx + nx, by + 0.1, bz + nz], [bx - nx, by + 0.1, bz - nz]));
    }
    const g = part(strip(pos), [1, 1, 1], null, TILES.concrete);
    addRinged(new THREE.Mesh(g, roadMat));
  }
  const PARAPET = 1.0, PW = 0.5, STONE = [1, 1, 1];
  for (const b of BRIDGES) {
    const { P, hw, t, kx, arch } = b, top = [], stone = [], n = P.length;
    // arch: the walls' and soffit's underside over the road, a half ellipse from the road up to just under the deck
    const S = [0]; for (let k = 1; k < n; k++) S.push(S[k - 1] + Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z));
    const roadY = P[kx].g, crown = P[kx].y - t - 0.4;
    const under = (k) => {
      const u = (S[k] - S[kx]) / arch;
      return Math.abs(u) < 1 ? roadY + (crown - roadY) * Math.sqrt(1 - u * u) : Math.min(P[k].g - 0.5, P[k].y - t);
    };
    const side = (k) => {
      const a = P[Math.max(0, k - 1)], c = P[Math.min(n - 1, k + 1)], L = Math.hypot(c.x - a.x, c.z - a.z);
      return [-(c.z - a.z) / L, (c.x - a.x) / L];
    };
    for (let k = 0; k < n - 1; k++) {
      const p = P[k], q = P[k + 1], [pnx, pnz] = side(k), [qnx, qnz] = side(k + 1);
      const at = (r, o, dy) => [r.x + (r === p ? pnx : qnx) * o, r.y + dy, r.z + (r === p ? pnz : qnz) * o];
      const lo0 = under(k), lo1 = under(k + 1);
      top.push(...quad(at(p, -hw + PW, 0), at(p, hw - PW, 0), at(q, hw - PW, 0), at(q, -hw + PW, 0)));
      for (const sg of [-1, 1]) {
        const o = sg * hw, i = sg * (hw - PW);
        const wl = (r, y) => [r.x + (r === p ? pnx : qnx) * o, y, r.z + (r === p ? pnz : qnz) * o];
        const wi = (r, y) => [r.x + (r === p ? pnx : qnx) * i, y, r.z + (r === p ? pnz : qnz) * i];
        stone.push(...quad(wl(p, lo0), wl(q, lo1), wl(q, q.y + PARAPET), wl(p, p.y + PARAPET)));          // outer wall and parapet
        stone.push(...quad(wi(p, p.y), wi(q, q.y), wi(q, q.y + PARAPET), wi(p, p.y + PARAPET)));          // parapet inside
        stone.push(...quad(wl(p, p.y + PARAPET), wl(q, q.y + PARAPET), wi(q, q.y + PARAPET), wi(p, p.y + PARAPET)));   // coping
        const yaw = Math.atan2(q.x - p.x, q.z - p.z), c = (sg * (hw - PW / 2));
        SOLIDS.push({ x: (p.x + q.x) / 2 + (pnx + qnx) / 2 * c, z: (p.z + q.z) / 2 + (pnz + qnz) / 2 * c, y: (p.y + q.y) / 2 + PARAPET / 2,
          hx: PW / 2, hy: PARAPET / 2 + Math.abs(q.y - p.y) / 2, hz: Math.hypot(q.x - p.x, q.z - p.z) / 2 + 0.05, c: Math.cos(yaw), s: Math.sin(yaw), what: 'bridge wall' });
      }
      // soffit: the deck's underside, following the arch over the road
      stone.push(...quad(at(p, hw, lo0 - p.y), at(p, -hw, lo0 - p.y), at(q, -hw, lo1 - q.y), at(q, hw, lo1 - q.y)));
    }
    addRinged(new THREE.Mesh(merge([part(strip(top), SNOWCAP), part(strip(stone), STONE, null, TILES.stone)]), bridgeMat));
  }
}
addByPage(runParts, modelMat);
// FreePlay starts a little way down Sunnyside from the Village Express top. The Tab menu moves the start to any lift top or bottom.
export const STARTS = [];
{
  const run = signRuns.get('Sunnyside')?.run;
  if (run) {
    const p = alongRun(run, 3), q = alongRun(run, 45);
    Object.assign(META.start, { x: p.x, z: p.z, heading: Math.atan2(q.x - p.x, -(q.z - p.z)), name: 'Village Express, top' });
  }
}
// run tiles around the start before the first frame
if (runStream) await Promise.all(runStream(META.start.x, META.start.z, true));
// every lift top: a little way down the groomed run leaving it, else beside the terminal facing down the fall line
const fallAt = (x, z, r) => {
  let gx = 0, gz = 0;
  for (let k = 0; k < 8; k++) { const s = sample(x + r * Math.cos(k * Math.PI / 4), z + r * Math.sin(k * Math.PI / 4)); gx += s.gx / 8; gz += s.gz / 8; }
  return { gx, gz, slope: Math.hypot(gx, gz) };
};
// run line from the top down, as [x, z, distance]
function downLine(run) {
  let p = run.points;
  if (groundY(...p[0]) < groundY(...p[p.length - 1])) p = p.slice().reverse();
  let s = 0;
  return p.map((q, i) => [q[0], q[1], i ? (s += Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1])) : 0]);
}
const lineAt = (L, s) => {
  for (let i = 1; i < L.length; i++) if (L[i][2] >= s) { const f = (s - L[i - 1][2]) / ((L[i][2] - L[i - 1][2]) || 1); return [L[i - 1][0] + (L[i][0] - L[i - 1][0]) * f, L[i - 1][1] + (L[i][1] - L[i - 1][1]) * f]; }
  return L[L.length - 1];
};
for (const lift of [...LIFTS].sort((a, b) => a.name.localeCompare(b.name))) {
  const p = lift.points, up = p[0][2] > p[p.length - 1][2], top = up ? p[0] : p[p.length - 1], prev = up ? p[1] : p[p.length - 2];
  let run = null;
  for (const r of RUNS) {
    if (r.area || r.kind !== 'groomed' || r.points.length < 2) continue;
    const L = downLine(r);
    if (L[L.length - 1][2] < 80) continue;
    let best = 1e9, s0 = 0;
    for (const q of L) { const d = Math.hypot(q[0] - top[0], q[1] - top[1]); if (d < best) { best = d; s0 = q[2]; } }
    // the run that starts nearest the top
    if (best < 70 && s0 < 120 && (!run || best < run.best)) run = { L, s0, best };
  }
  if (run) {
    let o = 12;                                     // clear of station buildings
    while (o < 120 && nearSolid(...lineAt(run.L, run.s0 + o), 5)) o += 6;
    const a = lineAt(run.L, run.s0 + o), b = lineAt(run.L, run.s0 + o + 33);
    STARTS.push({ label: `Start: ${lift.name} top`, x: a[0], z: a[1], heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])) });
  } else besideTerminal(top, prev, `Start: ${lift.name} top`);
  // and beside the bottom terminal
  besideTerminal(up ? p[p.length - 1] : p[0], up ? p[p.length - 2] : p[1], `Start: ${lift.name} bottom`);
}
// beside a terminal (end, prev = next lift point) where the snow falls away most; clear of buildings,
// not facing the terminal or the forest
function besideTerminal(end, prev, label) {
  const d = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1, ux = (end[0] - prev[0]) / d, uz = (end[1] - prev[1]) / d;
  let pick = null;
  for (const side of [1, -1]) for (const along of [-10, 5, 20]) for (const lat of [25, 40]) {
    const x = end[0] + ux * along - uz * lat * side, z = end[1] + uz * along + ux * lat * side;
    if (offMap(x, z) || nearSolid(x, z, 5)) continue;
    const f = fallAt(x, z, 10), k = cellAt(x, z), tx = end[0] - x, tz = end[1] - z, tl = Math.hypot(tx, tz);
    if ((-f.gx * tx - f.gz * tz) / (f.slope * tl || 1) > 0.7) continue;     // not facing the terminal
    let ahead = 0;                                                         // or the forest
    for (let m = 15; m <= 75; m += 15) { const q = cellAt(x - f.gx / (f.slope || 1) * m, z - f.gz / (f.slope || 1) * m); ahead += (conifer(q) + aspen(q)) / 5; }
    const score = f.slope + (onGroomed(x, z) ? 0.15 : 0) - (conifer(k) + aspen(k)) * 0.5 - ahead * 0.5;
    if (!pick || score > pick.score) pick = { x, z, f, score };
  }
  if (pick) STARTS.push({ label, x: pick.x, z: pick.z, heading: Math.atan2(-pick.f.gx, pick.f.gz) });
}

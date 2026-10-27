// The HUD map: minimap and full map in the trail-map style.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { MAP } from '../data/mountain.js';
import { RUN_DATA } from '../data/runs.js';
import { clamp } from './config.js';
import { CELL, COVER, H, NX, NZ, X0, Z0, inflate } from './world.js';
import { camera } from './scene.js';
import { mapBoards } from './buildings.js';
import { free, sk } from './play.js';

// ---------- HUD map: minimap and full map in the trail-map style ----------
// One image painted at load, north up (x right, z down). The minimap turns it heading-up; the full map (M, or
// a two-finger tap) shows it summit-up.
const HUDMAP = {
  MPP: 4,                       // m per image pixel
  MINI_SPAN: 1500,              // m across the minimap
  MINI_PX: 160,                 // px (116 on small screens)
  RUN: { green: '#2e9e48', blue: '#1f7fd6', black: '#141414', expert: '#141414', none: '#7c8794' },
  LIFT: '#d8202f',              // chairs and gondolas
  SURFACE: '#6a3fb5',           // T-bar and platters
  // trail map labels and elevations (ft, m); lift top unless marked bottom
  PEAKS: [['CIRQUE T-BAR', 'Cirque T-Bar', 12510, 3813], ['HIGH ALPINE', 'High Alpine', 11880, 3612], ['BIG BURN', 'Big Burn', 11835, 3607],
    ["SAM'S KNOB", "Sam's Knob", 10630, 3240], ['ELK CAMP', 'Elk Camp', 11325, 3452], ['BASE VILLAGE', 'Village Express', 8400, 2560, 'bottom'],
    ['VILLAGE MALL', 'Sky Cab', 8606, 2623], ['TWO CREEKS', 'Two Creeks', 8110, 2472, 'bottom'], ['CAMPGROUND', 'Campground', 8235, 2510, 'bottom']],
};
export const hudMap = { base: null, x0: 0, z0: 0, full: false, frame: 0 };
const surfaceLift = (l) => l.kind === 't-bar' || l.kind === 'platter';
const runDiff = MAP.runs.map((r, i) => (RUN_DATA.runs.find((q) => q.i === i) || {}).difficulty || 'none');
const miniEl = Object.assign(document.createElement('canvas'), { className: 'hudmap-mini' });
const fullEl = Object.assign(document.createElement('div'), { className: 'hudmap-full', hidden: true });
const fullMap = document.createElement('canvas'), fullMe = document.createElement('canvas');
fullEl.append(fullMap, fullMe);
document.body.append(miniEl, fullEl);
const mapFont = (px, w = 700, it = '') => `${it}${w} ${px}px "Helvetica Neue",Arial,sans-serif`;

// Painted a band of rows at a time so skiing doesn't stutter.
(async function paintHudMap() {
  const t0 = performance.now(), areaB = await inflate(RUN_DATA.area);
  const AREA = new Int8Array(areaB.buffer, areaB.byteOffset, areaB.length);   // half meters to the nearest run, < 0 on it
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const r of [...MAP.runs, ...MAP.lifts]) for (const [x, z] of r.points) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  x0 -= 400; z0 -= 300; x1 += 400; z1 += 600;   // room above the summit for its label
  const M = HUDMAP.MPP, W = Math.ceil((x1 - x0) / M), Hp = Math.ceil((z1 - z0) / M);
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: Hp }), g = cv.getContext('2d');
  const img = g.createImageData(W, Hp), px = img.data;
  const bil = (a, fx, fz) => {
    const i = clamp(Math.floor(fx), 0, NX - 2), j = clamp(Math.floor(fz), 0, NZ - 2), tx = fx - i, tz = fz - j, k = j * NX + i;
    return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + NX] * (1 - tx) + a[k + NX + 1] * tx) * tz;
  };
  const hash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // light from the summit-up view's top left, 40 degrees up; slopes slightly exaggerated
  const LX = 0.54, LY = 0.64, LZ = 0.54, EX = 1.5;
  const SNOW_D = [118, 150, 196], SNOW_L = [250, 252, 255], TREE_D = [10, 38, 30], TREE_L = [52, 98, 66], ASP_D = [96, 98, 104], ASP_L = [176, 174, 168], ROCK = [120, 118, 122];
  for (let j = 0; j < Hp; j++) {
    if (j % 32 === 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < W; i++) {
      const fx = (x0 + i * M - X0) / CELL, fz = (z0 + j * M - Z0) / CELL;
      const gx = (bil(H, fx + 0.5, fz) - bil(H, fx - 0.5, fz)) / CELL * EX, gz = (bil(H, fx, fz + 0.5) - bil(H, fx, fz - 0.5)) / CELL * EX;
      const lit = Math.max(0, (-gx * LX + LY - gz * LZ) / Math.hypot(gx, 1, gz)), t = clamp((lit - 0.25) / 0.75, 0, 1);
      let c = mix(SNOW_D, SNOW_L, t);
      if (bil(AREA, fx, fz) > 4) {
        // tree stipple, denser in thicker forest, none on runs
        const k = clamp(Math.round(fz), 0, NZ - 1) * NX + clamp(Math.round(fx), 0, NX - 1), cov = COVER[k];
        const con = (cov & 15) / 15, asp = ((cov >> 4) & 7) / 7, r = hash(i, j), r2 = hash(i >> 1, j >> 1);
        if (cov >> 7) c = mix(c, ROCK, 0.45);
        if (con > 0.05 && r2 < con * 1.1) c = mix(TREE_D, TREE_L, t * 0.8 + r * 0.25);
        else if (asp > 0.1 && r2 < asp * 0.9) c = mix(ASP_D, ASP_L, t * 0.8 + r * 0.2);
      }
      const o = (j * W + i) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // minimap copy with runs and lifts painted at minimap width
  hudMap.x0 = x0; hudMap.z0 = z0;
  drawMapLines(g, HUDMAP.MINI_PX / (HUDMAP.MINI_SPAN / M), 2.2);
  hudMap.base = cv;
  // the full map draws its own lines on a plain copy
  hudMap.plain = document.createElement('canvas');
  hudMap.plain.width = W; hudMap.plain.height = Hp;
  hudMap.plain.getContext('2d').putImageData(img, 0, 0);
  paintMapBoards(img, W, Hp);
  hudMap.paintMs = Math.round(performance.now() - t0);
  if (hudMap.full) drawFullMap();
})();

// The same map on the trail-map stands, summit-up with its runs and lifts, fitted onto each board's face.
function paintMapBoards(img, W, Hp) {
  if (!mapBoards.length) return;
  const north = Object.assign(document.createElement('canvas'), { width: W, height: Hp }), g = north.getContext('2d');
  g.putImageData(img, 0, 0);
  drawMapLines(g, 1, 3);
  for (const face of mapBoards) {
    const a = face.userData.aspect, cw = 2048, ch = Math.round(cw / a);
    const cv = Object.assign(document.createElement('canvas'), { width: cw, height: ch }), c = cv.getContext('2d');
    c.fillStyle = '#eef1f5'; c.fillRect(0, 0, cw, ch);
    // just the runs and lifts with a little room around them
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const r of [...MAP.runs, ...MAP.lifts]) for (const [x, z] of r.points) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const M = HUDMAP.MPP, sx = (x0 - 150 - hudMap.x0) / M, sz = (z0 - 150 - hudMap.z0) / M, sw = (x1 - x0 + 300) / M, sh = (z1 - z0 + 300) / M;
    const k = Math.min(cw / sw, ch / sh);
    c.translate(cw / 2, ch / 2); c.rotate(Math.PI); c.drawImage(north, sx, sz, sw, sh, -sw * k / 2, -sh * k / 2, sw * k, sh * k);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    face.material.map = t; face.material.color.set(0xffffff); face.material.needsUpdate = true;
  }
}

// Runs as colored lines with a white casing, lifts red (purple for surface lifts) with end dots.
// g is in image px; k is screen px per image px, so lw stays in screen px.
function drawMapLines(g, k, lw) {
  const P = (x, z) => [(x - hudMap.x0) / HUDMAP.MPP, (z - hudMap.z0) / HUDMAP.MPP];
  const line = (pts) => { g.beginPath(); pts.forEach(([x, z], n) => { const p = P(x, z); g[n ? 'lineTo' : 'moveTo'](p[0], p[1]); }); };
  g.lineJoin = g.lineCap = 'round';
  for (const pass of [0, 1]) MAP.runs.forEach((r, i) => {
    line(r.points);
    g.strokeStyle = pass ? HUDMAP.RUN[runDiff[i]] : 'rgba(255,255,255,0.85)';
    g.lineWidth = (pass ? lw : lw + 1.6) / k;
    g.stroke();
  });
  for (const l of MAP.lifts) {
    const col = surfaceLift(l) ? HUDMAP.SURFACE : HUDMAP.LIFT;
    line(l.points);
    g.strokeStyle = '#fff'; g.lineWidth = (lw + 2.2) / k; g.stroke();
    g.strokeStyle = col; g.lineWidth = lw / k; g.stroke();
    g.fillStyle = col; g.lineWidth = 1 / k;
    for (const [x, z] of [l.points[0], l.points[l.points.length - 1]]) {
      const p = P(x, z);
      g.beginPath(); g.arc(p[0], p[1], lw * 1.6 / k, 0, 7); g.fill(); g.stroke();
    }
  }
}
// Goldie: a gold arrow pointing where she (or the freecam) faces.
function mapArrow(g, s) {
  g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.62, s * 0.7); g.lineTo(0, s * 0.35); g.lineTo(-s * 0.62, s * 0.7); g.closePath();
  g.fillStyle = '#f4c542'; g.fill(); g.lineWidth = 1.8; g.strokeStyle = '#13244d'; g.stroke();
}
const mapWhere = () => {
  const p = free.on ? free.pos : sk.pos, e = camera.matrixWorld.elements;
  return { x: p.x, z: p.z, yaw: Math.atan2(-e[8], e[10]) };   // yaw 0 = north (-z), clockwise
};
function sizeHudMap() {
  const S = Math.min(innerWidth, innerHeight) < 500 ? 116 : HUDMAP.MINI_PX, d = Math.min(window.devicePixelRatio || 1, 2);
  miniEl.width = miniEl.height = Math.round(S * d);
  miniEl.style.width = miniEl.style.height = `${S}px`;
  hudMap.mini = S; hudMap.dpr = d;
  if (hudMap.full) drawFullMap();
}
export function drawMiniMap() {
  if (!hudMap.base || hudMap.full) return;
  const S = hudMap.mini, R = S / 2, g = miniEl.getContext('2d'), w = mapWhere();
  const k = S / (HUDMAP.MINI_SPAN / HUDMAP.MPP);
  g.setTransform(hudMap.dpr, 0, 0, hudMap.dpr, 0, 0);
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.clip();
  g.translate(R, R); g.rotate(-w.yaw); g.scale(k, k);
  g.translate(-(w.x - hudMap.x0) / HUDMAP.MPP, -(w.z - hudMap.z0) / HUDMAP.MPP);
  g.drawImage(hudMap.base, 0, 0);
  g.restore();
  g.beginPath(); g.arc(R, R, R - 1.5, 0, 7); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
  g.beginPath(); g.arc(R, R, R - 0.5, 0, 7); g.lineWidth = 1; g.strokeStyle = 'rgba(19,36,77,.8)'; g.stroke();
  g.translate(R, R); mapArrow(g, 8);
}
// Full map: whole mountain, summit up, with labels. Drawn when it opens or the window resizes; only the arrow redraws.
function drawFullMap() {
  if (!hudMap.plain) return;
  const B = hudMap.plain, d = hudMap.dpr, small = Math.min(innerWidth, innerHeight) < 500, m = small ? 8 : 16;
  const s = Math.min((innerWidth - 2 * m) / B.width, (innerHeight - 2 * m) / B.height), w = B.width * s, h = B.height * s;
  for (const c of [fullMap, fullMe]) {
    c.width = Math.round(w * d); c.height = Math.round(h * d);
    Object.assign(c.style, { width: `${w}px`, height: `${h}px`, left: `${(innerWidth - w) / 2}px`, top: `${(innerHeight - h) / 2}px` });
  }
  const g = fullMap.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.save(); g.translate(w, h); g.rotate(Math.PI); g.scale(s, s); g.drawImage(B, 0, 0); drawMapLines(g, s, 2); g.restore();
  const S = (x, z) => [w - (x - hudMap.x0) / HUDMAP.MPP * s, h - (z - hudMap.z0) / HUDMAP.MPP * s];
  hudMap.toScreen = S;
  const fs = small ? 8 : 11, nfs = small ? 6 : 8;
  const ends = HUDMAP.PEAKS.map(([name, lift, ft, me, end]) => {
    const l = MAP.lifts.find((q) => q.name === lift), p = end === 'bottom' ? l.points[0] : l.points[l.points.length - 1];
    return [name, ft, me, ...S(p[0], p[1]), end === 'bottom'];
  });
  // peak and base labels draw last but claim room first; bases label below, peaks above
  const placed = ends.map(([, , , x, y, low]) => (low ? [x - 50, y, x + 50, y + fs * 2.2 + 8] : [x - 50, y - fs * 2.2 - 8, x + 50, y]));
  const tag = (label, pts, fill, font) => {
    const n = pts.length >> 1, a = S(...pts[n - 1]), b = S(...pts[n + 1]), mid = S(...pts[n]);
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    g.font = font;
    const tw = g.measureText(label).width + 6, th = nfs + 4;
    const ex = Math.abs(Math.cos(ang)) * tw / 2 + Math.abs(Math.sin(ang)) * th / 2, ey = Math.abs(Math.sin(ang)) * tw / 2 + Math.abs(Math.cos(ang)) * th / 2;
    const box = [mid[0] - ex, mid[1] - ey, mid[0] + ex, mid[1] + ey];
    if (placed.some((q) => q[0] < box[2] && box[0] < q[2] && q[1] < box[3] && box[1] < q[3])) return;   // no overlaps
    placed.push(box);
    g.save(); g.translate(mid[0], mid[1]); g.rotate(ang);
    g.fillStyle = fill; g.fillRect(-tw / 2, -th / 2, tw, th);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 0, 0.5);
    g.restore();
  };
  for (const l of MAP.lifts) {
    // two-point lift lines get a midpoint for the label
    const [a, b] = [l.points[0], l.points[l.points.length - 1]];
    const pts = l.points.length > 2 ? l.points : [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b];
    tag(l.name, pts, surfaceLift(l) ? HUDMAP.SURFACE : HUDMAP.LIFT, mapFont(nfs + 1, 700, 'italic '));
  }
  MAP.runs.forEach((r, i) => { if (r.name && r.points.length >= 3) tag(r.name.toUpperCase(), r.points, HUDMAP.RUN[runDiff[i]], mapFont(nfs)); });
  for (const [name, ft, me, x, y, low] of ends) {
    const t2 = `${ft.toLocaleString('en-US')} FT | ${me.toLocaleString('en-US')} M`;
    g.font = mapFont(fs); const w1 = g.measureText(name).width;
    g.font = mapFont(fs * 0.8, 600); const w2 = g.measureText(t2).width;
    const bw = Math.max(w1, w2) + 10, bh = fs * 2.2, bx = x - bw / 2, by = low ? y + 8 : y - bh - 8;
    g.fillStyle = 'rgba(255,255,255,.95)'; g.strokeStyle = '#13244d'; g.lineWidth = 1;
    g.beginPath(); g.roundRect(bx, by, bw, bh, 3); g.fill(); g.stroke();
    g.fillStyle = '#13244d'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = mapFont(fs); g.fillText(name, x, by + 3);
    g.font = mapFont(fs * 0.8, 600); g.fillText(t2, x, by + 3 + fs * 1.1);
  }
}
function drawFullMe() {
  if (!hudMap.toScreen) return;
  const g = fullMe.getContext('2d'), w = mapWhere(), [x, y] = hudMap.toScreen(w.x, w.z);
  g.setTransform(hudMap.dpr, 0, 0, hudMap.dpr, 0, 0);
  g.clearRect(0, 0, fullMe.width, fullMe.height);
  g.translate(x, y); g.rotate(w.yaw + Math.PI); mapArrow(g, 10);
}
export function setFullMap(on) {
  hudMap.full = on;
  fullEl.hidden = !on;
  miniEl.hidden = on;
  if (on) drawFullMap();
}
// minimap every other frame, full-map arrow every frame
export function updateHudMap() {
  if (hudMap.full) drawFullMe();
  else if (hudMap.frame++ & 1) drawMiniMap();
}
window.addEventListener('resize', sizeHudMap);
sizeHudMap();
// M toggles the full map; on phones, a two-finger tap.
window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat) setFullMap(!hudMap.full); });
{
  let t0 = 0, most = 0;
  window.addEventListener('touchstart', (e) => {
    if (most === 0) t0 = performance.now();
    most = Math.max(most, e.touches.length);
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (e.touches.length) return;
    if (most === 2 && performance.now() - t0 < 300) setFullMap(!hudMap.full);
    most = 0;
  }, { passive: true });
}

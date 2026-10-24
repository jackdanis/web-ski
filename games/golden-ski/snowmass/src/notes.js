// Laser notes (freecam, desktop): a red dot where the screen centre meets the snow or a collision shape.
// E or a click drops a numbered pin there with a short note; the panel copies every note as text to hand to Claude.
// The laser hits what physics hits: the snow, solid boxes and trunk circles, so a pin also shows where those
// shapes miss the drawn model. Pins are kept in this browser (localStorage).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { cellKey } from './config.js';
import { SOLIDS, groundY, treeCells } from './world.js';
import { camera, canvas, scene } from './scene.js';
import { KIND } from './trees.js';
import { RUNS } from './slopes.js';
import { liftPaths } from './lifts.js';
import { debugEl, free } from './play.js';

const MAX_T = 4000;                    // m: the laser's reach
const STORE = 'golden-ski-notes';
const TREE_NAMES = { [KIND.spruce]: 'spruce', [KIND.fir]: 'fir', [KIND.aspen]: 'aspen', [KIND.snowghost]: 'snow ghost' };

// ---------- The laser ----------
const hit = { on: false, t: 0, p: new THREE.Vector3(), what: '', obj: null };
const rayO = new THREE.Vector3(), rayD = new THREE.Vector3();
// the snow: march with steps that grow with distance, then halve down onto the surface
function castSnow(o, d) {
  if (o.y < groundY(o.x, o.z)) return Infinity;
  let a = 0, t = 0.3;
  while (t < MAX_T) {
    const y = o.y + d.y * t;
    if (y > 4500 && d.y >= 0) return Infinity;
    if (y < groundY(o.x + d.x * t, o.z + d.z * t)) {
      for (let k = 0; k < 18; k++) {
        const m = (a + t) / 2;
        if (o.y + d.y * m < groundY(o.x + d.x * m, o.z + d.z * m)) t = m; else a = m;
      }
      return t;
    }
    a = t; t += 0.5 + t * 0.015;
  }
  return Infinity;
}
// a solid box (centre, half sizes, yaw as c, s): slab test in its own frame
function castBox(o, d, b, best) {
  const dx = o.x - b.x, dy = o.y - b.y, dz = o.z - b.z;
  const ou = b.c * dx - b.s * dz, ov = b.s * dx + b.c * dz, du = b.c * d.x - b.s * d.z, dv = b.s * d.x + b.c * d.z;
  let t0 = 0, t1 = best;
  for (const [p, q, h] of [[ou, du, b.hx], [dy, d.y, b.hy], [ov, dv, b.hz]]) {
    if (Math.abs(q) < 1e-9) { if (Math.abs(p) > h) return Infinity; continue; }
    let ta = (-h - p) / q, tb = (h - p) / q;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  return t0 > 0.01 ? t0 : Infinity;
}
// a trunk circle: an upright cylinder from y to y + height
function castTrunk(o, d, c, best) {
  if (!(c.r > 0)) return Infinity;
  const fx = o.x - c.x, fz = o.z - c.z, top = c.y + c.height;
  const a = d.x * d.x + d.z * d.z, b = fx * d.x + fz * d.z, k = fx * fx + fz * fz - c.r * c.r;
  if (k <= 0) {                        // above or below it: only the top cap
    const t = d.y < 0 && o.y > top ? (top - o.y) / d.y : Infinity;
    return t < best ? t : Infinity;
  }
  const disc = b * b - a * k;
  if (a < 1e-9 || disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t <= 0 || t >= best) return Infinity;
  const y = o.y + d.y * t;
  if (y >= c.y && y <= top) return t;
  if (y > top && d.y < 0) {             // passes over the side, may drop onto the cap
    const tc = (top - o.y) / d.y, cx = fx + d.x * tc, cz = fz + d.z * tc;
    if (tc < best && cx * cx + cz * cz <= c.r * c.r) return tc;
  }
  return Infinity;
}
// trunks live in 8 m cells: walk the cells under the ray, each with its ring of neighbours
const seen = new Set();
function castTrunks(o, d, best, out) {
  seen.clear();
  best = Math.min(best, MAX_T);
  const h = Math.hypot(d.x, d.z), reach = h * best;
  const n = Math.ceil(reach / 4) + 1;
  for (let s = 0; s <= n; s++) {
    const f = Math.min(best, (s * 4) / Math.max(h, 1e-6));
    const ix = Math.floor((o.x + d.x * f) / 8), iz = Math.floor((o.z + d.z * f) / 8);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const key = cellKey(ix + a, iz + b);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = treeCells.get(key);
      if (!list) continue;
      for (const c of list) {
        const t = castTrunk(o, d, c, best);
        if (t < best) { best = t; out.obj = c; }
      }
    }
    if (f >= best) break;
  }
  return best;
}
function castLaser() {
  camera.getWorldPosition(rayO);
  camera.getWorldDirection(rayD);
  let best = castSnow(rayO, rayD), what = 'snow', obj = null;
  for (const b of SOLIDS) {
    const t = castBox(rayO, rayD, b, best);
    if (t < best) { best = t; what = b.what || 'box'; obj = b; }
  }
  const tr = { obj: null };
  const t = castTrunks(rayO, rayD, best, tr);
  if (tr.obj) { best = t; obj = tr.obj; what = obj.what || `${TREE_NAMES[obj.kind] || 'tree'} trunk`; }
  hit.on = best < MAX_T;
  if (!hit.on) return;
  hit.t = best; hit.what = what; hit.obj = obj;
  hit.p.copy(rayO).addScaledVector(rayD, best);
}

// ---------- Where a point is: nearest named run and lift ----------
function nearestRun(x, z) {
  let best = Infinity, name = '';
  for (const r of RUNS) {
    if (!r.name || !r.points || r.points.length < 2) continue;
    const P = r.points;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][1], bx = P[i + 1][0] - ax, bz = P[i + 1][1] - az;
      const L = bx * bx + bz * bz, f = L ? Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / L)) : 0;
      const dd = Math.hypot(x - ax - bx * f, z - az - bz * f);
      if (dd < best) { best = dd; name = r.name; }
    }
  }
  return { name, d: best };
}
function nearestLift(x, z) {
  let best = Infinity, name = '';
  for (const lp of liftPaths) for (const [px, pz] of lp.pts) {
    const dd = Math.hypot(x - px, z - pz);
    if (dd < best) { best = dd; name = lp.name; }
  }
  return { name, d: best };
}

// ---------- Pins ----------
let pins = [];
try { pins = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (err) { pins = []; }
function save() { try { localStorage.setItem(STORE, JSON.stringify(pins)); } catch (err) { /* kept for this visit only */ } }
const pinGroup = new THREE.Group();
scene.add(pinGroup);
// a red map pin with its number, the same size on screen at any distance, its tip on the point
function pinTexture(n) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#e8262b'; g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.arc(32, 32, 26, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(32, 92); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = `700 ${n > 99 ? 22 : 28}px ui-monospace, Menlo, monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function drawPins() {
  for (const s of pinGroup.children) { s.material.map.dispose(); s.material.dispose(); }
  pinGroup.clear();
  pins.forEach((q, k) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTexture(k + 1), sizeAttenuation: false, fog: false, depthWrite: false }));
    s.center.set(0.5, 0);
    s.scale.set(0.028, 0.042, 1);
    s.position.set(q.x, q.y, q.z);
    s.renderOrder = 11;
    pinGroup.add(s);
  });
  drawList();
}

// ---------- Screen: the dot, the note box and the panel ----------
const dotEl = Object.assign(document.createElement('div'), { className: 'laser-dot', hidden: true });
const readEl = Object.assign(document.createElement('div'), { className: 'laser-read', hidden: true });
const boxEl = Object.assign(document.createElement('form'), { className: 'note-box', hidden: true });
boxEl.innerHTML = '<label></label><input type="text" maxlength="300" autocomplete="off" spellcheck="true" placeholder="What should change here?"><small>Enter saves · Esc cancels</small>';
const boxLabel = boxEl.querySelector('label'), boxInput = boxEl.querySelector('input');
const panelEl = Object.assign(document.createElement('div'), { className: 'notes-panel', hidden: true });
panelEl.innerHTML = '<div class="notes-head"><b></b><button type="button" data-act="copy">Copy all notes</button><button type="button" data-act="clear">Clear</button></div>'
  + '<ol></ol><small>E or click: drop a pin · Esc: free the mouse</small>';
const headEl = panelEl.querySelector('b'), listEl = panelEl.querySelector('ol'), copyBtn = panelEl.querySelector('[data-act="copy"]');
document.body.append(dotEl, readEl, boxEl, panelEl);

function drawList() {
  headEl.textContent = `Notes (${pins.length})`;
  listEl.replaceChildren(...pins.map((q, k) => {
    const li = document.createElement('li');
    const span = Object.assign(document.createElement('span'), { textContent: q.text || '(no text)' });
    const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: `Delete note ${k + 1}` });
    del.addEventListener('click', () => { pins.splice(k, 1); save(); drawPins(); });
    li.append(span, del);
    return li;
  }));
}

let draft = null;
function lockPointer() {
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* drag to look */ }
}
function dropPin() {
  if (draft || !free.on || !debugEl.hidden) return;
  castLaser();
  if (!hit.on) return;
  const run = nearestRun(hit.p.x, hit.p.z), lift = nearestLift(hit.p.x, hit.p.z);
  draft = {
    x: +hit.p.x.toFixed(1), y: +hit.p.y.toFixed(1), z: +hit.p.z.toFixed(1), what: hit.what,
    run: run.name, runD: Math.round(run.d), lift: lift.name, liftD: Math.round(lift.d),
    cam: { x: +free.pos.x.toFixed(1), y: +free.pos.y.toFixed(1), z: +free.pos.z.toFixed(1),
      yaw: Math.round(free.yaw * 180 / Math.PI), pitch: Math.round(free.pitch * 180 / Math.PI) },
    dist: Math.round(hit.t), text: '', t: Date.now(),
  };
  free.keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
  boxLabel.textContent = `Pin ${pins.length + 1} · ${draft.what}${draft.run ? ` · ${draft.run}` : ''}`;
  boxInput.value = '';
  boxEl.hidden = false;
  boxInput.focus();
}
function closeBox(keep) {
  if (!draft) return;
  if (keep) { draft.text = boxInput.value.trim(); pins.push(draft); save(); drawPins(); }
  draft = null;
  boxEl.hidden = true;
  boxInput.blur();
  if (free.on) lockPointer();
}
boxEl.addEventListener('submit', (e) => { e.preventDefault(); closeBox(true); });
boxInput.addEventListener('keydown', (e) => { if (e.code === 'Escape') { e.preventDefault(); closeBox(false); } });
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || e.repeat || e.target instanceof HTMLInputElement) return;
  if (free.on) { e.preventDefault(); dropPin(); }
});
// a click while the mouse is captured drops a pin (the first click captures it)
canvas.addEventListener('pointerdown', (e) => {
  if (free.on && e.button === 0 && document.pointerLockElement === canvas) dropPin();
});

// the text block handed to Claude: one entry per pin, game coordinates in meters
function noteText() {
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
  const lines = [`Golden Ski laser notes · ${pins.length} pin${pins.length === 1 ? '' : 's'} · ${when} CT`, 'Coordinates are game meters (x, height y, z).', ''];
  pins.forEach((q, k) => {
    const near = [q.run && `run ${q.run} (${q.runD} m)`, q.lift && q.liftD < 150 && `lift ${q.lift} (${q.liftD} m)`].filter(Boolean).join(', ');
    lines.push(`${k + 1}. ${q.text || '(no text)'}`);
    lines.push(`   hit ${q.what} at x ${q.x}, y ${q.y}, z ${q.z}${near ? ` · near ${near}` : ''}`);
    lines.push(`   camera x ${q.cam.x}, y ${q.cam.y}, z ${q.cam.z}, yaw ${q.cam.yaw}°, pitch ${q.cam.pitch}° · ${q.dist} m away`);
  });
  return lines.join('\n');
}
async function copyNotes() {
  const text = noteText();
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (err) {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (err2) { ok = false; }
    ta.remove();
  }
  copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { copyBtn.textContent = 'Copy all notes'; }, 1500);
}
panelEl.addEventListener('click', (e) => {
  const act = e.target.dataset && e.target.dataset.act;
  if (act === 'copy') copyNotes();
  if (act === 'clear' && pins.length && confirm(`Delete all ${pins.length} notes?`)) { pins = []; save(); drawPins(); }
});
drawPins();

// ---------- Each frame (from render) ----------
let wasOn = false;
export function updateNotes() {
  const on = free.on;
  if (on !== wasOn) { panelEl.hidden = !on; pinGroup.visible = on; if (!on) closeBox(false); wasOn = on; }
  if (!on || draft) { dotEl.hidden = readEl.hidden = true; return; }
  castLaser();
  dotEl.hidden = readEl.hidden = !hit.on;
  if (hit.on) readEl.textContent = `${hit.what} · ${Math.round(hit.t)} m`;
}
// test hooks
export const notes = { get pins() { return pins; }, hit, cast: castLaser, dropPin, closeBox, noteText, input: boxInput };

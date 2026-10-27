// Ski tracks: two grooves painted top down around Goldie; Snowlight shades them from the sun.
// The canvas holds groove depth in red and lip height in green, both drawn with 'lighten' (the max), so
// segments can be added one at a time in any order. A new segment uploads only its own rectangle.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { LIGHT, renderer } from './scene.js';
import { sk } from './play.js';

export const TR_PX = 1024, TR_SIZE = 96;     // 9.4 cm per pixel, read by trackH() in scene.js
const FADE = 300;                             // m of track behind her before it is gone
const GAP = 0.42, SKI_W = 0.3, SKI_L = 1.7;  // groove spacing and width, a little wider than real so they read at 320x180
const SOFT = 0.3;                             // groove depth in a gentle turn; a hard carve cuts to full depth
const canvas = document.createElement('canvas');
canvas.width = canvas.height = TR_PX;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const tex = new THREE.CanvasTexture(canvas);
tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
LIGHT.uTrack.value = tex;

// track points: position, ski right vector, groove width, depth (0..1), distance skied when laid
const pts = [];
let skied = 0, origin = null, painted = 0;

export function recordTrack() {
  const on = sk.grounded && !sk.crashed && sk.vel.lengthSq() > 1;
  const last = pts[pts.length - 1];
  if (!on) { if (last) last.cut = true; return; }
  const x = sk.pos.x, z = sk.pos.z;
  const d = last && !last.cut ? Math.hypot(x - last.x, z - last.z) : 0;
  if (last && !last.cut && d < 0.4) return;
  skied += d;
  // skidding turns the skis across the path: each groove smears wider and shallower until the two run together
  // (a carve always slips a little, so the first 0.2 doesn't count)
  const across = Math.max(0, Math.abs(Math.sin(sk.heading - Math.atan2(sk.vel.x, -sk.vel.z))) - 0.2) / 0.8;
  const carve = SOFT + (1 - SOFT) * THREE.MathUtils.smoothstep(Math.abs(sk.edgeA), 0.35, 1.0);
  pts.push({ x, z, rx: Math.cos(sk.heading), rz: Math.sin(sk.heading), w: SKI_W + across * SKI_L * 0.45, a: across, d: carve / (1 + across * 3), s: skied });
  while (pts.length && skied - pts[0].s > FADE) { pts.shift(); painted = Math.max(0, painted - 1); }
}

// groove profile: a raised lip, then the cut stepping down to its floor ([width x, red depth or green lip])
const LAYERS = [[1.9, 0, 1], [1.0, 0.43, 0], [0.7, 0.77, 0], [0.4, 1, 0]];
// strokes points i0..i1 for both skis; returns the touched pixel box
function stroke(i0, i1, fade) {
  const k = TR_PX / TR_SIZE, g = ctx, b = pts[i1];
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [wm, dr, lg] of LAYERS) {
    const v = Math.round(255 * fade * b.d);
    g.strokeStyle = `rgb(${Math.round(v * dr)},${v * lg},0)`;
    g.lineWidth = Math.max(1, b.w * wm * k);
    for (const side of [-0.5, 0.5]) {
      g.beginPath();
      for (let i = i0; i <= i1; i++) {
        const q = pts[i], x = (q.x + q.rx * GAP * side - origin.x) * k, z = (q.z + q.rz * GAP * side - origin.z) * k;
        if (i === i0) g.moveTo(x, z); else g.lineTo(x, z);
        x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
      }
      g.stroke();
    }
  }
  const r = b.w * 1.9 * k / 2 + 2;
  return [x0 - r, z0 - r, x1 + r, z1 + r];
}

// whole repaint when the canvas recenters, oldest first, faded by how long ago she skied it
function repaint() {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TR_PX, TR_PX);
  ctx.globalCompositeOperation = 'lighten';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // one segment at a time: depth and width change along a turn, and 'lighten' keeps the joints clean
  for (let i = 1; i < pts.length; i++) if (!pts[i - 1].cut) stroke(i - 1, i, 1 - (skied - pts[i].s) / FADE);
  painted = pts.length;
  tex.needsUpdate = true;
}

// upload one rectangle of the canvas into the texture already on the GPU (CanvasTexture flips Y)
function upload([x0, z0, x1, z1]) {
  const props = renderer.properties.get(tex);
  if (!props.__webglTexture) { tex.needsUpdate = true; return; }
  x0 = Math.max(0, Math.floor(x0)); z0 = Math.max(0, Math.floor(z0));
  x1 = Math.min(TR_PX, Math.ceil(x1)); z1 = Math.min(TR_PX, Math.ceil(z1));
  if (x1 <= x0 || z1 <= z0) return;
  const gl = renderer.getContext(), img = ctx.getImageData(x0, z0, x1 - x0, z1 - z0);
  renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, TR_PX - z1, gl.RGBA, gl.UNSIGNED_BYTE, img);
}

export function paintTracks(cx, cz) {
  if (!origin || Math.abs(cx - origin.x - TR_SIZE / 2) > TR_SIZE * 0.2 || Math.abs(cz - origin.z - TR_SIZE / 2) > TR_SIZE * 0.2) {
    origin = { x: Math.round(cx - TR_SIZE / 2), z: Math.round(cz - TR_SIZE / 2) };
    LIGHT.uTrO.value.set(origin.x, origin.z);
    repaint();
    return;
  }
  if (painted >= pts.length) return;
  const i0 = Math.max(0, painted - 1);
  painted = pts.length;
  if (pts.length - i0 < 2) return;
  ctx.globalCompositeOperation = 'lighten';
  const box = [1e9, 1e9, -1e9, -1e9];
  for (let i = i0 + 1; i < pts.length; i++) {
    if (pts[i - 1].cut) continue;
    const b = stroke(i - 1, i, 1);
    box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]);
  }
  upload(box);
}

export const tracks = { pts, canvas, record: recordTrack, paint: paintTracks, clear() { pts.length = 0; skied = 0; origin = null; } };

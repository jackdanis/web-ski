// Goldie: her sprite sheet, skis, shadow and snow spray.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { BODY } from './config.js';
import { BOUNCE, GOLDIE, SKY_COLOR, SUN_COLOR, SUN_DIR, goldieN, goldieT, scene } from './scene.js';
import './atmosphere.js'; // load order: runs after atmosphere.js

// ---------- The skier: Goldie as a camera-facing card from her sheet, on a pair of skis, plus a blob shadow ----------
// Sheet (goldie_body.json): per pose, camera tilt (0, 12, 45 degrees above her horizon) and angle round her (0 behind,
// 90 her right, 180 in front, in 22.5 degree steps; her left side mirrored), the frame's rect and its foot point, 64 px per m.
// The frames are her body only; the skis are drawn on the physics ski plate. Wipeout and sit keep their own skis.
// Lit per pixel from the normal map by sun, sky and snow bounce, snapped to four bands.
export const FRAMES = { stand: 'stand', carveL: 'carve_l', carveR: 'carve_r', tuck: 'tuck', brake: 'brake', air: 'air', land: 'land', wipeout: 'wipeout', celebrate: 'celebrate', sit: 'sit' };
export const SHEET_PX = GOLDIE.pxPerM, [SHEET_W, SHEET_H] = GOLDIE.size;
export const SHEET_YAWS = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5, 180];
export const SKIER_LIT = { sunColor: { value: SUN_COLOR }, skyColor: { value: SKY_COLOR }, bounce: { value: BOUNCE }, uLit: { value: 1 } };
const SNOWLIGHT_GLSL = `
    uniform vec3 sunColor, skyColor, bounce;
    uniform float uLit;
    float band(float v) { return max(0.12, floor(v * 4.0 + 0.5) / 4.0); }
    vec3 snowlight(vec3 n, vec3 s) {
      vec3 l = sunColor * band(max(0.0, dot(n, s))) * uLit;
      l += skyColor * (0.35 + 0.35 * n.y);
      l += bounce * band(max(0.0, 0.15 - 0.8 * n.y)) * 0.55;
      l += 0.06;
      float m = max(max(l.r, l.g), max(l.b, 1e-3));
      return l * band(min(1.25, m)) / m;
    }`;
// Drawn a little toward the camera so the snow right around her feet never covers her (0.5 m) or her skis (0.3 m);
// she stays ahead of her skis' middle, so her boots sit on them.
const nudged = (m) => `vec4 mv = modelViewMatrix * vec4(position, 1.0);
      mv.xyz += normalize(-mv.xyz) * ${typeof m === 'string' ? m : m.toFixed(2)};
      gl_Position = projectionMatrix * mv;`;
export const skierMat = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: goldieT },
    normalMap: { value: goldieN },
    rect: { value: new THREE.Vector4() },
    mirror: { value: 0 },
    nudge: { value: 0.5 },             // 0 on a lift: the seat back and cabin walls cover her as they should
    sunLocal: { value: new THREE.Vector3(0, 1, 0) },
    ...SKIER_LIT,
  },
  vertexShader: `
    uniform vec4 rect;
    uniform float mirror;
    uniform float nudge;
    varying vec2 vUv;
    void main() {
      float u = mix(uv.x, 1.0 - uv.x, mirror);
      vUv = vec2(rect.x + u * rect.z, rect.y + (1.0 - uv.y) * rect.w);
      ${nudged('nudge')}
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform sampler2D normalMap;
    uniform vec3 sunLocal;
    uniform float mirror;
    varying vec2 vUv;
    ${SNOWLIGHT_GLSL}
    void main() {
      vec4 albedo = texture2D(map, vUv);
      if (albedo.a < 0.5) discard;
      vec3 n = normalize(texture2D(normalMap, vUv).rgb * 2.0 - 1.0);
      if (mirror > 0.5) n.x = -n.x;
      gl_FragColor = vec4(min(albedo.rgb * snowlight(n, sunLocal) * 1.15, 1.0), 1.0);
    }`,
  side: THREE.DoubleSide,
});
// unit card with its origin at the lower left; scaled and placed per frame so the foot point lands on her skis
export const skierMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), skierMat);
scene.add(skierMesh);
// Her skis: two thin boxes on the 0.3 x 1.7 m ski plate. The top faces carry the ski art at 1 px per cm, tips at the
// top of the canvas; edges and bases are dark so an edged ski seen side-on still reads as a line.
const skiTex = (() => {
  const c = document.createElement('canvas');
  c.width = 30; c.height = 170;
  const x = c.getContext('2d');
  x.fillStyle = '#7a1b20'; x.fillRect(0, 0, 30, 170);   // opaque everywhere, so far mip levels never fade the skis out
  for (const x0 of [1, 21]) {
    x.fillStyle = '#a3262b'; x.fillRect(x0, 4, 8, 164);
    x.fillRect(x0 + 1, 2, 6, 2); x.fillRect(x0 + 2, 0, 4, 2);                     // rounded tip
    x.fillStyle = '#7a1b20'; x.fillRect(x0, 4, 1, 164); x.fillRect(x0 + 7, 4, 1, 164);
    x.fillStyle = '#26272c'; x.fillRect(x0, 152, 8, 16);                            // tail band
    x.fillStyle = '#e9e1cf'; x.fillRect(x0, 150, 8, 2); x.fillRect(x0 + 3, 40, 2, 110);
    x.fillStyle = '#26272c'; x.fillRect(x0, 16, 8, 18);                             // tip panel
    x.fillStyle = '#e9e1cf'; x.fillRect(x0 + 2, 21, 4, 7);
    x.fillStyle = '#7d828c'; x.fillRect(x0 + 1, 70, 6, 36);                         // binding plate
    x.fillStyle = '#2a2c33'; x.fillRect(x0 + 1, 68, 6, 6); x.fillRect(x0 + 1, 100, 6, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapNearestFilter;
  return t;
})();
export const skiUp = new THREE.Vector3(0, 1, 0);
const skiTopMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: skiTex }, up: { value: skiUp }, sun: { value: SUN_DIR }, ...SKIER_LIT },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; ${nudged(0.3)} }`,
  fragmentShader: `uniform sampler2D map; uniform vec3 up, sun; varying vec2 vUv; ${SNOWLIGHT_GLSL}
    void main() { gl_FragColor = vec4(min(texture2D(map, vUv).rgb * snowlight(up, sun) * 1.15, 1.0), 1.0); }`,
});
const skiEdgeMat = new THREE.ShaderMaterial({
  uniforms: { up: { value: skiUp }, sun: { value: SUN_DIR }, ...SKIER_LIT },
  vertexShader: `void main() { ${nudged(0.3)} }`,
  fragmentShader: `uniform vec3 up, sun; ${SNOWLIGHT_GLSL} void main() { gl_FragColor = vec4(vec3(0.17, 0.17, 0.19) * snowlight(up, sun), 1.0); }`,
});
export const skis = new THREE.Group();
for (const x0 of [1, 21]) {
  // box faces +x, -x, +y, -y, +z, -z; in the skis' frame +x is her right, +y toward the tips, +z up
  const g = new THREE.BoxGeometry(0.08, BODY.PLATE_L, 0.025), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (x0 + uv.getX(i) * 8) / 30);
  const ski = new THREE.Mesh(g, [skiEdgeMat, skiEdgeMat, skiEdgeMat, skiEdgeMat, skiTopMat, skiEdgeMat]);
  ski.position.set((x0 + 4 - 15) / 100, 0, 0.0125);
  skis.add(ski);
}
scene.add(skis);
export const shadow = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(20,36,77,0.55)'); grad.addColorStop(1, 'rgba(20,36,77,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  scene.add(m);
  return m;
})();

// Snow spray when the skis skid or brake.
export const SPRAY_N = 260;
export const spray = { pos: new Float32Array(SPRAY_N * 3), vel: new Float32Array(SPRAY_N * 3), life: new Float32Array(SPRAY_N), next: 0, debt: 0 };
export const sprayPoints = (() => {
  spray.pos.fill(-1e4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(spray.pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.24, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.9, depthWrite: false }));
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

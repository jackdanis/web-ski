// Endless Skier: a Line Rider-styled endless downhill skier.
// Plain canvas, no dependencies. World units are pixels with y pointing down.
(() => {
  'use strict';

  // ---------- Tuning ----------
  const STEP = 1 / 120;          // fixed physics step
  const G = 1150;                // gravity
  const DRAG = 0.00048;          // air/snow drag (quadratic)
  const FRICTION = 25;           // constant snow friction
  const MIN_SPEED = 260;
  const MAX_SPEED = 1250;
  const JUMP = 470;              // jump impulse along the slope normal
  const ROT_SPEED = 7.6;         // rad/s while holding a flip
  const ROT_ACCEL = 40;          // how fast a flip spins up
  const SPIN_DAMP = 13;          // how fast spin dies after release
  const AUTO_LEVEL = 2.4;        // rad/s assist toward the slope when not flipping
  const PERFECT = 0.14;          // landing angle tolerances (radians)
  const CLEAN = 0.34;
  const SLOPPY = 0.62;           // anything worse is a wipeout
  const BUFFER = 0.13;           // jump input buffer
  const COYOTE = 0.1;            // grace after rolling off a lip
  const PX_PER_M = 30;
  const START_SAFE = 1100;

  const COLORS = {
    paper: '#ffffff',
    ink: '#111111',
    faint: '#c9d2da',
    track: '#1a1a1a',
    scenery: '#2fa84f',
    blue: '#1e63d6',
    red: '#d4232b',
    gray: '#8a949c',
  };
  const FONT = 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, -apple-system, sans-serif';

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, scale = 1;
  const anchor = { x: 0.32, y: 0.42 };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    scale = clamp(Math.min(W / 1000, H / 640), W < H ? 0.64 : 0.55, 1.35);
    anchor.x = W < H ? 0.28 : 0.32;
    anchor.y = W < H ? 0.45 : 0.42;
  }
  window.addEventListener('resize', resize);

  // ---------- Math helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapAngle(a) {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  }
  function approach(v, target, maxDelta) {
    return v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
  }
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Seeded 1D value noise in [-1, 1].
  let noiseSeed = 1;
  function hash(i, ch) {
    let h = (i * 374761393 + ch * 668265263 + noiseSeed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  }
  function noise(x, ch) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(hash(i, ch), hash(i + 1, ch), u);
  }

  // ---------- World ----------
  let rng = Math.random;
  const world = {
    ramps: [],   // { x0, len, h }
    rocks: [],   // { x, w, h, shape }
    cliffs: [],  // { x, drop }
    trees: [],   // { x, s, kind }
    cliffBase: 0,
    nextX: 0,
    nextTreeX: 0,
  };

  // Smooth part of the hill: long downhill trend plus rolling noise.
  function baseY(x) {
    const ease = clamp(x / 900, 0, 1); // gentle start
    return x * 0.36 + ease * (150 * noise(x / 760, 1) + 46 * noise(x / 240, 2) + 9 * noise(x / 70, 3));
  }
  function rampBump(x) {
    for (const r of world.ramps) {
      if (x >= r.x0 && x < r.x0 + r.len) {
        const t = (x - r.x0) / r.len;
        return r.h * t * t;
      }
    }
    return 0;
  }
  function cliffOffset(x) {
    let off = world.cliffBase;
    for (const c of world.cliffs) {
      if (x >= c.x) off += c.drop; else break;
    }
    return off;
  }
  // Ground without the step discontinuities (used for slope and curvature).
  function smoothY(x) { return baseY(x) - rampBump(x); }
  function ground(x) { return smoothY(x) + cliffOffset(x); }
  function slopeAngle(x) {
    const d = 1.5;
    let dy = (baseY(x + d) - baseY(x - d)) / (2 * d);
    for (const r of world.ramps) {
      if (x >= r.x0 && x < r.x0 + r.len) dy -= 2 * r.h * (x - r.x0) / (r.len * r.len);
    }
    return Math.atan(dy);
  }
  function curvature(x) {
    const d = 5;
    const y0 = smoothY(x - d), y1 = smoothY(x), y2 = smoothY(x + d);
    const dy = (y2 - y0) / (2 * d);
    const ddy = (y2 - 2 * y1 + y0) / (d * d);
    return ddy / Math.pow(1 + dy * dy, 1.5);
  }

  function rand(a, b) { return a + (b - a) * rng(); }

  function makeRock(x, w, h) {
    const n = 7;
    const shape = [];
    for (let i = 0; i <= n; i++) {
      const th = Math.PI + (Math.PI * i) / n;
      const r = i === 0 || i === n ? 1 : 1 + (rng() - 0.5) * 0.35;
      shape.push({ dx: Math.cos(th) * (w / 2) * r, k: Math.sin(th) * r });
    }
    const crack = { a: rand(-0.3, 0.1), b: rand(0.2, 0.5) };
    world.rocks.push({ x, w, h, shape, crack });
  }

  function spawnFeature() {
    const x = world.nextX;
    const diff = clamp(x / 60000, 0, 1); // ramps up over ~2 km
    const r = rng();
    if (r < 0.3) {
      const len = rand(150, 270);
      const h = len * rand(0.28, 0.42);
      world.ramps.push({ x0: x, len, h });
      world.nextX = x + len + rand(700, 1050);
    } else if (r < 0.58) {
      makeRock(x, rand(30, 52), rand(20, 34) + diff * 8);
      world.nextX = x + rand(420, 760) - diff * 160;
    } else if (r < 0.7) {
      makeRock(x, rand(28, 40), rand(18, 26));
      makeRock(x + rand(110, 170), rand(28, 40), rand(18, 28));
      world.nextX = x + rand(650, 900) - diff * 120;
    } else if (r < 0.88) {
      world.cliffs.push({ x, drop: rand(70, 190) + diff * 70 });
      world.nextX = x + rand(650, 950);
    } else {
      // Rock then a kicker: hop the rock, then hit the ramp.
      makeRock(x, rand(28, 38), rand(18, 26));
      const rx = x + rand(380, 520);
      const len = rand(160, 230);
      world.ramps.push({ x0: rx, len, h: len * rand(0.3, 0.4) });
      world.nextX = rx + len + rand(750, 1050);
    }
  }

  function generate(untilX) {
    while (world.nextX < untilX) spawnFeature();
    while (world.nextTreeX < untilX) {
      const x = world.nextTreeX;
      const nearCliff = world.cliffs.some(c => Math.abs(c.x - x) < 40);
      const nearRamp = world.ramps.some(r => x > r.x0 - 20 && x < r.x0 + r.len + 20);
      if (!nearCliff && !nearRamp) {
        world.trees.push({ x, s: rand(0.7, 1.35), kind: rng() < 0.8 ? 0 : 1, back: rand(4, 26) });
      }
      world.nextTreeX = x + (rng() < 0.3 ? rand(30, 70) : rand(160, 620));
    }
  }

  function prune(beforeX) {
    world.ramps = world.ramps.filter(r => r.x0 + r.len > beforeX);
    world.rocks = world.rocks.filter(r => r.x + r.w > beforeX);
    world.trees = world.trees.filter(t => t.x > beforeX);
    while (world.cliffs.length && world.cliffs[0].x < beforeX) {
      world.cliffBase += world.cliffs.shift().drop;
    }
  }

  function rockTop(rock, x) {
    const u = (x - rock.x) / (rock.w / 2);
    if (Math.abs(u) >= 1) return Infinity;
    return ground(x) - rock.h * Math.sqrt(1 - u * u);
  }

  // ---------- Player ----------
  const player = {};
  const cam = { x: 0, y: 0 };
  const input = { held: false, dir: -1, buffer: 0, holdTime: 0 };
  let particles = [];
  let popups = [];
  let ragdoll = [];
  let state = 'title';
  let stateTime = 0;
  let score = 0, trickScore = 0, best = 0, combo = 0, boostTime = 0, lastBest = false;
  let deathReason = '';
  let time = 0;

  try { best = parseInt(localStorage.getItem('endless-skier-best') || '0', 10) || 0; } catch (e) { best = 0; }

  function resetWorld() {
    noiseSeed = (Math.random() * 1e9) | 0;
    rng = mulberry32(noiseSeed ^ 0x9e3779b9);
    world.ramps = []; world.rocks = []; world.cliffs = []; world.trees = [];
    world.cliffBase = 0;
    world.nextX = START_SAFE;
    world.nextTreeX = -600;
    generate(3500);
    Object.assign(player, {
      x: 120, y: ground(120), vx: 0, vy: 0,
      speed: MIN_SPEED, angle: slopeAngle(120), angVel: 0,
      grounded: true, airTime: 0, totalRot: 0, coyote: 0, jumped: false,
      tuck: 0, squash: 0, maxHeight: 0, startX: 120, takeoffRel: 0, lipLaunch: false,
    });
    cam.x = player.x + 120; cam.y = player.y;
    particles = []; popups = []; ragdoll = [];
    score = 0; trickScore = 0; combo = 0; boostTime = 0; lastBest = false;
  }

  function setState(s) { state = s; stateTime = 0; }

  function startRun() {
    resetWorld();
    // A tap or key that started this run must not also jump or flip.
    input.held = false; input.buffer = 0; input.holdTime = 0;
    keysDown.clear();
    updateCamera(0, true);
    setState('play');
    popup('Go!', COLORS.blue, 1.0);
  }

  function popup(text, color, life = 1.4, big = false) {
    if (window.__skierLog) window.__skierLog.push(text);
    popups.push({ text, color, t: 0, life, big, x: player.x, y: player.y - px(80) - popups.length * px(26) });
  }

  function doJump(a) {
    const nx = Math.sin(a), ny = -Math.cos(a);
    player.vx += nx * JUMP;
    player.vy += ny * JUMP;
    player.vx = Math.max(player.vx, 120);
    player.jumped = true;
    player.lipLaunch = false;
    input.buffer = 0;
    leaveGround(a);
    puff(player.x, player.y, 10, 1);
  }

  function leaveGround(a) {
    // Remember the ski angle relative to the snow we left, so flips count against the slope.
    if (player.grounded) player.takeoffRel = player.angle - a;
    player.grounded = false;
    player.airTime = 0;
    player.totalRot = 0;
    player.coyote = player.jumped ? 0 : COYOTE;
    player.takeoffY = player.y;
    player.maxHeight = 0;
  }

  function updatePlayer(dt) {
    const p = player;
    input.buffer = Math.max(0, input.buffer - dt);
    if (input.held) input.holdTime += dt;
    p.squash = Math.max(0, p.squash - dt * 4);
    boostTime = Math.max(0, boostTime - dt);

    if (p.grounded) {
      const a = slopeAngle(p.x);
      let s = p.speed;
      s += G * Math.sin(a) * dt;
      s -= (DRAG * s * s + FRICTION) * dt;
      s = clamp(s, MIN_SPEED, MAX_SPEED);
      p.speed = s;
      p.vx = s * Math.cos(a);
      p.vy = s * Math.sin(a);
      p.angle = a + approach(wrapAngle(p.angle - a), 0, 18 * dt);
      p.angVel = 0;
      p.tuck = approach(p.tuck, clamp((s - 300) / 900, 0, 0.45), dt * 2);

      if (input.buffer > 0) {
        p.jumped = false;
        doJump(a);
      } else {
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const gy = ground(nx);
        const k = curvature(nx);
        if (ny < gy - 2 || s * s * k > G * Math.cos(a) * 1.05) {
          // The snow fell away (lip, cliff, or a crest taken fast).
          p.lipLaunch = ny < gy - 2;
          p.x = nx; p.y = ny;
          p.jumped = false;
          leaveGround(a);
        } else {
          p.x = nx; p.y = gy;
        }
      }
      if (p.grounded && s > 380 && rng() < s / 1400) spray(p);
    } else {
      p.airTime += dt;
      p.coyote = Math.max(0, p.coyote - dt);
      if (p.coyote > 0 && input.buffer > 0 && !p.jumped) {
        // Late jump right off a lip: the ollie stacks with the kicker.
        const lip = p.lipLaunch;
        doJump(slopeAngle(p.x - p.vx * 0.05));
        if (lip) popup('Pop!', COLORS.blue, 0.8);
      }
      p.vy += G * dt;
      p.vx *= 1 - 0.00012 * Math.abs(p.vx) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.maxHeight = Math.max(p.maxHeight, ground(p.x) - p.y);

      const flipping = input.held && input.holdTime > 0.09;
      if (flipping) {
        p.angVel = approach(p.angVel, input.dir * ROT_SPEED, ROT_ACCEL * dt);
        p.tuck = approach(p.tuck, 1, dt * 7);
      } else {
        p.angVel *= Math.exp(-SPIN_DAMP * dt);
        p.tuck = approach(p.tuck, 0.25, dt * 4);
        if (Math.abs(p.angVel) < 2.5) {
          let lx = p.x, ly = p.y, lvy = p.vy;
          for (let i = 0; i < 120 && ly < ground(lx); i++) {
            lvy += G / 60; lx += p.vx / 60; ly += lvy / 60;
          }
          const target = slopeAngle(lx);
          const d = wrapAngle(target - p.angle);
          p.angle += clamp(d, -AUTO_LEVEL * dt, AUTO_LEVEL * dt);
        }
      }
      p.angle += p.angVel * dt;
      p.totalRot += p.angVel * dt;

      const gy = ground(p.x);
      if (p.y >= gy) {
        p.y = gy;
        land();
      }
    }

    if (state === 'play') checkRocks();
  }

  function land() {
    const p = player;
    const a = slopeAngle(p.x);
    const diff = Math.abs(wrapAngle(p.angle - a));
    const spin = Math.abs(p.angVel);
    const rel = (p.angle - a) - (p.takeoffRel || 0);
    const flips = Math.round(Math.abs(rel) / (Math.PI * 2));
    const tangential = p.vx * Math.cos(a) + p.vy * Math.sin(a);
    const impact = -p.vx * Math.sin(a) + p.vy * Math.cos(a);

    if (diff > SLOPPY || (spin > 5 && diff > CLEAN)) {
      crash(Math.abs(rel) > Math.PI ? 'Over-rotated the landing' : 'Caught an edge');
      return;
    }

    p.grounded = true;
    p.angle = a + wrapAngle(p.angle - a);
    p.speed = clamp(tangential, MIN_SPEED, MAX_SPEED);
    p.squash = clamp(impact / 900, 0.2, 1);
    puff(p.x, p.y, 8 + Math.min(20, impact / 60), 1.4);

    const real = p.airTime > 0.35 || flips > 0;
    if (!real) return;

    let pts = 0;
    let label = '';
    if (flips > 0) {
      const name = rel < 0 ? 'Backflip' : 'Frontflip';
      const mult = flips === 1 ? '' : (['', '', 'Double ', 'Triple ', 'Quad '][flips] || flips + 'x ');
      label = mult + name;
      pts = 300 * flips * flips;
    }
    if (p.airTime > 1.35) {
      pts += 150;
      if (!label) label = 'Big air';
    }

    const trick = flips > 0 || p.airTime > 1.35;
    if (diff <= PERFECT && spin < 3) {
      if (!trick) return;
      if (flips > 0) combo++;
      pts *= 2;
      p.speed = Math.min(MAX_SPEED, p.speed + 150);
      boostTime = 1.1;
      if (label) popup(label, COLORS.ink, 1.6, true);
      popup('Perfect landing!', COLORS.blue, 1.5);
    } else if (diff <= CLEAN) {
      if (!trick) return;
      if (flips > 0) combo++;
      if (label) popup(label, COLORS.ink, 1.5, true);
      if (flips > 0 || p.airTime > 1.35) popup('Clean', COLORS.gray, 1.1);
    } else {
      combo = 0;
      pts = Math.round(pts * 0.5);
      p.speed *= 0.78;
      if (label) popup(label, COLORS.ink, 1.3, true);
      popup('Sloppy...', COLORS.red, 1.2);
    }
    if (pts > 0) {
      const m = Math.max(1, combo);
      pts *= m;
      trickScore += pts;
      popup('+' + pts + (m > 1 ? '  (x' + m + ' combo)' : ''), COLORS.blue, 1.4);
    }
  }

  function checkRocks() {
    const p = player;
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    for (const r of world.rocks) {
      if (Math.abs(r.x - p.x) > r.w + 40) continue;
      // Skis count fully on the snow; in the air only the boots do, so a close hop still clears.
      const probes = p.grounded ? [-18, 0, 20] : [-10, 0, 10];
      const margin = p.grounded ? 4 : 7;
      for (const k of probes) {
        const x = p.x + ca * k;
        const y = p.y + sa * k;
        if (y > rockTop(r, x) + margin) {
          crash('Hit a rock');
          return;
        }
      }
    }
  }

  function crash(reason) {
    if (state !== 'play') return;
    deathReason = reason;
    combo = 0;
    buildRagdoll();
    setState('crashed');
    puff(player.x, player.y, 26, 2);
    const total = currentScore();
    if (total > best) {
      best = total; lastBest = true;
      try { localStorage.setItem('endless-skier-best', String(best)); } catch (e) { /* storage unavailable */ }
    }
  }

  function distance() { return Math.max(0, Math.floor((player.x - player.startX) / PX_PER_M)); }
  function currentScore() { return distance() * 10 + trickScore; }

  // ---------- Ragdoll ----------
  function buildRagdoll() {
    const p = player;
    const pose = poseFor(p.tuck);
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    const toWorld = (lx, ly) => ({ x: p.x + lx * ca - ly * sa, y: p.y + lx * sa + ly * ca });
    const parts = [
      { kind: 'head', at: pose.head, r: 6.5 },
      { kind: 'body', at: pose.hip, r: 10 },
      { kind: 'ski', at: { x: 0, y: -2 }, r: 2 },
      { kind: 'ski', at: { x: 3, y: -4 }, r: 2 },
      { kind: 'pole', at: pose.hand, r: 2 },
    ];
    ragdoll = parts.map(pt => {
      const w = toWorld(pt.at.x, pt.at.y);
      return {
        kind: pt.kind, r: pt.r, x: w.x, y: w.y,
        vx: p.vx * rand(0.45, 0.8) + rand(-60, 60),
        vy: p.vy * 0.5 - rand(150, 420),
        a: p.angle + rand(-0.4, 0.4), va: rand(-12, 12),
      };
    });
    p.vx *= 0.3;
  }

  function updateRagdoll(dt) {
    for (const b of ragdoll) {
      b.vy += G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.va * dt;
      const gy = ground(b.x) - b.r;
      if (b.y > gy) {
        b.y = gy;
        const a = slopeAngle(b.x);
        // Bounce off the slope: split velocity into normal and tangent.
        const tx = Math.cos(a), ty = Math.sin(a);
        const vt = b.vx * tx + b.vy * ty;
        const vn = -b.vx * ty + b.vy * tx;
        const nvt = vt * 0.86, nvn = vn > 0 ? -vn * 0.32 : vn;
        b.vx = nvt * tx - nvn * ty;
        b.vy = nvt * ty + nvn * tx;
        b.va *= 0.75;
        if (b.kind === 'ski') b.a = lerp(b.a, a, 0.2);
        else if (b.kind === 'pole') b.a = lerp(b.a, a + Math.round((b.a - a) / Math.PI) * Math.PI, 0.2);
        else if (b.kind === 'body') b.a = lerp(b.a, a - Math.PI / 2 + Math.round((b.a - a + Math.PI / 2) / (2 * Math.PI)) * 2 * Math.PI, 0.2);
      }
    }
  }

  // ---------- Particles ----------
  function spray(p) {
    const a = p.angle;
    particles.push({
      x: p.x - Math.cos(a) * 20, y: p.y - Math.sin(a) * 20,
      vx: -p.vx * rand(0.05, 0.25) + rand(-30, 30),
      vy: -rand(60, 200),
      t: 0, life: rand(0.25, 0.5),
    });
  }
  function puff(x, y, n, power) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: x + rand(-14, 14), y: y - 2,
        vx: rand(-160, 160) * power, vy: -rand(40, 240) * power,
        t: 0, life: rand(0.3, 0.7),
      });
    }
  }
  function updateParticles(dt) {
    for (const q of particles) {
      q.t += dt;
      q.vy += G * 0.5 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    particles = particles.filter(q => q.t < q.life);
    for (const u of popups) {
      u.t += dt;
      u.y -= 30 * dt;
      if (state === 'play') { u.x += player.vx * dt; u.y += player.vy * dt; }
    }
    popups = popups.filter(u => u.t < u.life);
  }

  // ---------- Camera ----------
  function updateCamera(dt, snap) {
    const p = player;
    const lead = clamp(p.vx * 0.18, 0, Math.min(220, (W * 0.18) / scale));
    const tx = p.x + lead;
    const ty = p.grounded ? p.y : lerp(p.y, ground(p.x), 0.35);
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    const kx = snap ? 1 : 1 - Math.exp(-dt * 10);
    cam.x = lerp(cam.x, tx, kx);
    cam.y = lerp(cam.y, ty, k);
  }

  // ---------- Update loop ----------
  function update(dt) {
    time += dt;
    stateTime += dt;
    if (state === 'play') {
      updatePlayer(dt);
      score = currentScore();
    } else if (state === 'crashed') {
      updateRagdoll(dt);
      if (stateTime > 1.5) setState('over');
    } else if (state === 'over') {
      updateRagdoll(dt);
    } else if (state === 'title') {
      // Idle: the skier waits at the top of the hill.
      player.tuck = 0.15 + Math.sin(time * 2) * 0.05;
    }
    if (state !== 'paused') {
      updateParticles(dt);
      const focus = state === 'crashed' || state === 'over';
      if (!focus) updateCamera(dt, false);
      else if (ragdoll[0]) {
        const k = 1 - Math.exp(-dt * 3);
        cam.x = lerp(cam.x, ragdoll[1].x + 60, k);
        cam.y = lerp(cam.y, ragdoll[1].y, k);
      }
      const viewRight = cam.x + (W * (1 - anchor.x)) / scale;
      const viewLeft = cam.x - (W * anchor.x) / scale;
      generate(viewRight + 1800);
      prune(viewLeft - 1500);
    }
  }

  // ---------- Drawing ----------
  function px(n) { return n / scale; } // constant screen-pixel line widths

  function poseFor(t) {
    return {
      knee: { x: 7 - t * 1, y: -14 + t * 5 },
      knee2: { x: 2 - t * 1, y: -13 + t * 5 },
      hip: { x: -3 - t * 4, y: -27 + t * 10 },
      shoulder: { x: 3 + t * 6, y: -45 + t * 15 },
      head: { x: 7 + t * 9, y: -53 + t * 16 },
      hand: { x: 15 + t * 2, y: -32 + t * 12 },
      hand2: { x: 11 + t * 4, y: -30 + t * 13 },
    };
  }

  function drawSkis(c) {
    c.beginPath();
    c.moveTo(-24, 0);
    c.lineTo(21, 0);
    c.quadraticCurveTo(28, 0, 30, -6);
    c.stroke();
  }

  function drawSkier(p) {
    const t = clamp(p.tuck + p.squash * 0.35, 0, 1);
    const pose = poseFor(t);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.ink;

    // Poles trail behind the hands.
    ctx.lineWidth = px(1.3);
    ctx.beginPath();
    ctx.moveTo(pose.hand2.x, pose.hand2.y);
    ctx.lineTo(pose.hand2.x - 30, pose.hand2.y + 18);
    ctx.moveTo(pose.hand.x, pose.hand.y);
    ctx.lineTo(pose.hand.x - 32, pose.hand.y + 22);
    ctx.stroke();

    ctx.lineWidth = px(2.2);
    drawSkis(ctx);

    // Back leg, then body, front leg, arms.
    ctx.beginPath();
    ctx.moveTo(-4, -1);
    ctx.lineTo(pose.knee2.x, pose.knee2.y);
    ctx.lineTo(pose.hip.x, pose.hip.y);
    ctx.lineTo(pose.shoulder.x, pose.shoulder.y);
    ctx.moveTo(2, -1);
    ctx.lineTo(pose.knee.x, pose.knee.y);
    ctx.lineTo(pose.hip.x, pose.hip.y);
    ctx.moveTo(pose.shoulder.x, pose.shoulder.y);
    ctx.lineTo(lerp(pose.shoulder.x, pose.hand.x, 0.55) + 2, lerp(pose.shoulder.y, pose.hand.y, 0.55) + 3);
    ctx.lineTo(pose.hand.x, pose.hand.y);
    ctx.moveTo(pose.shoulder.x, pose.shoulder.y);
    ctx.lineTo(pose.hand2.x, pose.hand2.y);
    ctx.stroke();

    // Head with a little beanie.
    ctx.fillStyle = COLORS.paper;
    ctx.beginPath();
    ctx.arc(pose.head.x, pose.head.y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.red;
    ctx.beginPath();
    ctx.arc(pose.head.x, pose.head.y - 1, 6.8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pose.head.x - 1, pose.head.y - 9.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    // Eye
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(pose.head.x + 3.2, pose.head.y + 0.5, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Scarf, in world space so it streams opposite to travel.
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    const nl = { x: pose.shoulder.x - 1, y: pose.shoulder.y - 3 };
    const neck = { x: p.x + nl.x * ca - nl.y * sa, y: p.y + nl.x * sa + nl.y * ca };
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const dx = -p.vx / sp, dy = -p.vy / sp;
    const amp = clamp(sp / 260, 0.6, 3.5);
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = px(3.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    for (let i = 1; i <= 5; i++) {
      const w = Math.sin(time * 22 - i * 1.3) * amp * (i / 5) * 2.2;
      ctx.lineTo(neck.x + dx * i * 6 - dy * w, neck.y + dy * i * 6 + dx * w + i * 0.6);
    }
    ctx.stroke();
  }

  function drawRagdoll() {
    ctx.lineCap = 'round';
    for (const b of ragdoll) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = px(2.2);
      if (b.kind === 'head') {
        ctx.fillStyle = COLORS.paper;
        ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = COLORS.red;
        ctx.beginPath(); ctx.arc(0, -1, 6.8, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
      } else if (b.kind === 'body') {
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(10, -16);
        ctx.moveTo(0, 0); ctx.lineTo(-6, 13); ctx.lineTo(2, 22);
        ctx.moveTo(0, 0); ctx.lineTo(8, 12); ctx.lineTo(16, 18);
        ctx.moveTo(10, -16); ctx.lineTo(20, -6);
        ctx.stroke();
        ctx.strokeStyle = COLORS.red; ctx.lineWidth = px(3.2);
        ctx.beginPath(); ctx.moveTo(10, -16); ctx.lineTo(0, -20); ctx.lineTo(-10, -18); ctx.stroke();
      } else if (b.kind === 'ski') {
        ctx.translate(-3, 0);
        drawSkis(ctx);
      } else {
        ctx.lineWidth = px(1.3);
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(18, 0); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawMountains(viewLeft, viewRight) {
    // Far ridge, parallax, drawn in screen space.
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.strokeStyle = COLORS.faint;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const base = H * 0.34;
    for (let sx = -10; sx <= W + 10; sx += 6) {
      const wx = cam.x * 0.12 + sx;
      const y = base + 70 * noise(wx / 260, 7) + 26 * Math.abs(noise(wx / 70, 8)) - 30 * Math.abs(noise(wx / 140, 9));
      if (sx === -10) ctx.moveTo(sx, y); else ctx.lineTo(sx, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawTree(t) {
    const gx = t.x, gy = ground(t.x) - t.back * 0.15;
    const s = t.s;
    ctx.beginPath();
    if (t.kind === 0) {
      // Pine: trunk plus three stacked tiers.
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, gy - 10 * s);
      for (let i = 0; i < 3; i++) {
        const by = gy - (10 + i * 15) * s;
        const hw = (20 - i * 5) * s;
        ctx.moveTo(gx - hw, by);
        ctx.lineTo(gx, by - 24 * s);
        ctx.lineTo(gx + hw, by);
        ctx.closePath();
      }
    } else {
      // Bare birch: a few branches.
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx, gy - 52 * s);
      ctx.moveTo(gx, gy - 22 * s); ctx.lineTo(gx - 12 * s, gy - 36 * s);
      ctx.moveTo(gx, gy - 30 * s); ctx.lineTo(gx + 13 * s, gy - 44 * s);
      ctx.moveTo(gx, gy - 40 * s); ctx.lineTo(gx - 8 * s, gy - 52 * s);
    }
    ctx.stroke();
  }

  function drawRock(r) {
    const gy0 = ground(r.x);
    ctx.beginPath();
    r.shape.forEach((pt, i) => {
      const x = r.x + pt.dx;
      const y = ground(x) + pt.k * r.h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r.x + r.w * r.crack.a, gy0 - r.h * 0.85);
    ctx.lineTo(r.x + r.w * (r.crack.a + 0.08), gy0 - r.h * 0.5);
    ctx.lineTo(r.x + r.w * r.crack.b * 0.6, gy0 - r.h * 0.3);
    ctx.stroke();
  }

  function drawTerrain(viewLeft, viewRight) {
    const xs = [];
    const step = 6;
    for (let x = Math.floor(viewLeft / step) * step; x <= viewRight + step; x += step) xs.push(x);
    for (const r of world.ramps) {
      const e = r.x0 + r.len;
      if (e > viewLeft && e < viewRight) xs.push(e - 0.01, e);
    }
    for (const c of world.cliffs) {
      if (c.x > viewLeft && c.x < viewRight) xs.push(c.x - 0.01, c.x);
    }
    xs.sort((a, b) => a - b);
    const vb = cam.y + (H * (1 - anchor.y)) / scale + 10;
    ctx.beginPath();
    xs.forEach((x, i) => {
      const y = ground(x);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xs[xs.length - 1], vb);
    ctx.lineTo(xs[0], vb);
    ctx.closePath();
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
    ctx.strokeStyle = COLORS.track;
    ctx.lineWidth = px(2.4);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    xs.forEach((x, i) => {
      const y = ground(x);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Line Rider-style blue accent on the face of each kicker.
    ctx.strokeStyle = COLORS.blue;
    ctx.lineWidth = px(2.4);
    for (const r of world.ramps) {
      if (r.x0 + r.len < viewLeft || r.x0 > viewRight) continue;
      ctx.beginPath();
      for (let x = r.x0 + r.len * 0.35; x < r.x0 + r.len; x += 5) {
        const y = ground(x);
        if (x === r.x0 + r.len * 0.35) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineTo(r.x0 + r.len - 0.01, ground(r.x0 + r.len - 0.01));
      ctx.stroke();
    }
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W, H);

    const viewLeft = cam.x - (W * anchor.x) / scale;
    const viewRight = cam.x + (W * (1 - anchor.x)) / scale;
    drawMountains(viewLeft, viewRight);

    // Speed lines while boosted.
    if (boostTime > 0 && state === 'play') {
      ctx.strokeStyle = COLORS.faint;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        const y = (H * (0.15 + i * 0.09) + time * 37 * (i + 3)) % H;
        const x = ((time * 1900 * (1 + (i % 3) * 0.3)) + i * 157) % (W + 300);
        ctx.globalAlpha = boostTime;
        ctx.beginPath(); ctx.moveTo(W - x, y); ctx.lineTo(W - x + 80, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (W * anchor.x - cam.x * scale), DPR * (H * anchor.y - cam.y * scale));

    ctx.strokeStyle = COLORS.scenery;
    ctx.lineWidth = px(1.6);
    ctx.lineJoin = 'round';
    for (const t of world.trees) if (t.x > viewLeft - 60 && t.x < viewRight + 60) drawTree(t);

    drawTerrain(viewLeft, viewRight);

    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = px(1.8);
    for (const r of world.rocks) if (r.x > viewLeft - 60 && r.x < viewRight + 60) drawRock(r);

    // Snow
    ctx.strokeStyle = COLORS.gray;
    ctx.lineWidth = px(1.2);
    ctx.beginPath();
    for (const q of particles) {
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.vx * 0.012, q.y - q.vy * 0.012);
    }
    ctx.stroke();

    if (state === 'crashed' || state === 'over') drawRagdoll();
    else drawSkier(player);

    // Popups (world-anchored text)
    for (const u of popups) {
      const a = 1 - Math.pow(u.t / u.life, 3);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = u.color;
      ctx.font = `${u.big ? 700 : 600} ${px(u.big ? 22 : 16)}px ${FONT}`;
      ctx.textAlign = 'center';
      const hw = ctx.measureText(u.text).width / 2;
      const minX = cam.x + (hw + 8 - W * anchor.x) / scale;
      const maxX = cam.x + (W * (1 - anchor.x) - hw - 8) / scale;
      ctx.fillText(u.text, clamp(u.x, minX, maxX), u.y);
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawHud();
  }

  function drawHud() {
    const pad = 16;
    const top = 14 + safeTop();
    ctx.textBaseline = 'top';
    if (state === 'play' || state === 'crashed' || state === 'paused') {
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'left';
      ctx.font = `700 26px ${FONT}`;
      ctx.fillText(distance() + ' m', pad, top);
      ctx.font = `600 15px ${FONT}`;
      ctx.fillStyle = COLORS.gray;
      ctx.fillText('Score ' + currentScore().toLocaleString(), pad, top + 32);
      if (combo > 1) {
        ctx.fillStyle = COLORS.blue;
        ctx.fillText('Combo x' + combo, pad, top + 52);
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.gray;
      ctx.fillText('Best ' + best.toLocaleString(), W - pad, top + 4);
      if (state === 'play') {
        const kmh = Math.round(Math.hypot(player.vx, player.vy) / PX_PER_M * 3.6);
        ctx.fillText(kmh + ' km/h', W - pad, top + 24);
      }
    }

    if (state === 'title') {
      panel(
        'Endless Skier',
        [
          isTouch ? 'Tap to jump.' : 'Space or ↑ to jump.',
          isTouch ? 'Hold in the air to backflip.' : 'Hold in the air to backflip, → for frontflips.',
          'Land with your skis flat on the snow.',
          'Jump the rocks. Hit the kickers.',
        ],
        isTouch ? 'Tap to drop in' : 'Press space or click to drop in'
      );
    } else if (state === 'over') {
      const lines = [
        deathReason + '.',
        distance() + ' m  ·  ' + currentScore().toLocaleString() + ' points',
        lastBest ? 'New best!' : 'Best ' + best.toLocaleString(),
      ];
      panel('Wipeout!', lines, stateTime > 0.5 ? (isTouch ? 'Tap to ski again' : 'Press space to ski again') : '');
    } else if (state === 'paused') {
      panel('Paused', ['Take a breather.'], isTouch ? 'Tap to keep skiing' : 'Press space to keep skiing');
    }
  }

  function safeTop() {
    return 0;
  }

  function fitFont(text, weight, size, maxW) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    while (size > 11 && ctx.measureText(text).width > maxW) {
      size--;
      ctx.font = `${weight} ${size}px ${FONT}`;
    }
  }

  function panel(title, lines, cta) {
    let w = Math.min(W - 32, 420);
    const lh = 24;
    const h = 92 + lines.length * lh + 44;
    let x = (W - w) / 2;
    // Sit below the skier so the hill stays visible; on short screens sit beside it.
    let y = H * anchor.y + 70;
    if (y + h > H - 16) {
      const left = W * anchor.x + 60;
      if (W - left - 16 >= 260) {
        w = Math.min(420, W - left - 16);
        x = W - w - 16;
        y = Math.max(16, (H - h) / 2);
      } else {
        y = Math.max(16, H - h - 16);
      }
    }
    const cx = x + w / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.ink;
    ctx.font = `800 ${W < 380 ? 30 : 36}px ${FONT}`;
    ctx.fillText(title, cx, y + 22);
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 40, y + 68); ctx.lineTo(cx + 40, y + 68);
    ctx.stroke();
    ctx.fillStyle = '#333';
    lines.forEach((l, i) => {
      fitFont(l, 500, 16, w - 24);
      ctx.fillText(l, cx, y + 82 + i * lh);
    });
    if (cta) {
      const pulse = 0.65 + 0.35 * Math.sin(time * 4);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = COLORS.blue;
      fitFont(cta, 700, 17, w - 24);
      ctx.fillText(cta, cx, y + 90 + lines.length * lh);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Input ----------
  let isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  let pointers = 0;
  const keysDown = new Map(); // key code -> flip direction

  function press(dir) {
    if (state === 'title') { startRun(); return; }
    if (state === 'over') { if (stateTime > 0.5) startRun(); return; }
    if (state === 'paused') { setState('play'); return; }
    if (state !== 'play') return;
    if (!input.held) input.holdTime = 0;
    input.held = true;
    input.dir = dir;
    input.buffer = BUFFER;
  }
  function release() {
    input.held = false;
  }
  function releaseAll() {
    pointers = 0;
    keysDown.clear();
    release();
    input.buffer = 0;
  }
  function pause() {
    if (state !== 'play') return;
    setState('paused');
    releaseAll();
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch') isTouch = true;
    else if (e.pointerType === 'mouse') isTouch = false;
    pointers++;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    press(-1);
  });
  const up = e => {
    pointers = Math.max(0, pointers - 1);
    if (pointers === 0 && keysDown.size === 0) release();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  const BACK_KEYS = new Set(['Space', 'ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA', 'Enter']);
  const FRONT_KEYS = new Set(['ArrowRight', 'KeyD']);
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'play') pause();
      else if (state === 'paused') setState('play');
      return;
    }
    const back = BACK_KEYS.has(e.code), front = FRONT_KEYS.has(e.code);
    if (!back && !front) return;
    e.preventDefault();
    isTouch = false;
    if (e.repeat) return;
    const dir = front ? 1 : -1;
    keysDown.set(e.code, dir);
    press(dir);
  });
  window.addEventListener('keyup', e => {
    if (!keysDown.has(e.code)) return;
    keysDown.delete(e.code);
    if (keysDown.size) input.dir = [...keysDown.values()].pop();
    else if (pointers === 0) release();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); releaseAll(); }
  });
  window.addEventListener('blur', () => { pause(); releaseAll(); });

  // ---------- Main loop ----------
  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  resetWorld();
  updateCamera(0, true);
  requestAnimationFrame(frame);

  // Small hook for automated tests and tinkering in the console.
  window.__skier = { player, world, input, get state() { return state; }, press, release, ground, slopeAngle };
})();

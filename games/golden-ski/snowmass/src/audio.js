// Sound effects, all synthesized with Web Audio (no recorded files): ski hiss on the snow, wind that rises with speed,
// pole plants and the landing thump. Phones only allow sound after a touch, so it starts on the first tap or key.
import { state } from './state.js';
import { clamp } from './config.js';
import { surfaceAt } from './world.js';
import { POLE_PHASES, sk } from './play.js';

const V_TOP = 30;                     // m/s (67 mph): the hiss and wind are at full here
const PLANT = POLE_PHASES[0];         // where in a double-pole push the poles hit the snow
const VOLUME = 0.7;                   // master level: pole plants and thumps play at this
const SNOW_VOL = 0.15;                // ski hiss and skid scrape, kept quiet under it (Jack: snow was deafening)

let ctx = null, master, noise;
let hiss, scrape, wind;
let was = { grounded: true, crashed: false, poleP: -1, air: 0 };

function noiseBuffer() {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// A looping noise source through one filter into a gain that starts silent.
function loop(type, freq, q, offset) {
  const src = ctx.createBufferSource();
  src.buffer = noise; src.loop = true;
  const filter = Object.assign(ctx.createBiquadFilter(), { type });
  filter.frequency.value = freq; filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(gain).connect(master);
  src.start(0, offset);
  return { filter, gain };
}
function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = VOLUME;
  master.connect(ctx.destination);
  noise = noiseBuffer();
  hiss = loop('bandpass', 2500, 0.6, 0);
  scrape = loop('bandpass', 700, 1.4, 0.5);
  wind = loop('lowpass', 400, 0.9, 1.1);
}
for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, start, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});

const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, ctx.currentTime, tc);

// One short burst of filtered noise, for crunches and thuds.
function burst(type, freq, q, vol, len, at = 0) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = Object.assign(ctx.createBiquadFilter(), { type });
  filter.frequency.value = freq; filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(filter).connect(gain).connect(master);
  src.start(t, Math.random() * 1.5, len + 0.05);
}
// Both poles bite the snow a few ms apart: two dry crunches.
function polePlant() {
  burst('bandpass', 3200, 1.2, 0.35, 0.05);
  burst('bandpass', 2600, 1.2, 0.28, 0.06, 0.018);
}
// Skis slapping down: a low drop in pitch under a puff of snow. k is 0..1 from how hard she came down.
function thump(k, sloppy) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(110, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25 + 0.55 * k, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(gain).connect(master);
  osc.start(t); osc.stop(t + 0.25);
  burst('lowpass', 900, 0.7, 0.2 + 0.4 * k, 0.25);
  if (sloppy) burst('bandpass', 800, 1.0, 0.3 + 0.3 * k, 0.4, 0.03);
}

// Called once per rendered frame.
export function updateAudio() {
  if (!ctx) return;
  set(master.gain, state.sound ? VOLUME : 0, 0.03);
  const skiing = state.phase === 'skiing';
  const speed = skiing ? sk.vel.length() : 0;
  const v = clamp(speed / V_TOP, 0, 1.3);
  const onSnow = skiing && sk.grounded && !sk.crashed;
  const powder = onSnow && surfaceAt(sk.pos.x, sk.pos.z).friction > 0.1;

  // Ski hiss: louder and brighter with speed, sharper on a hard edge, muffled in powder.
  const hv = onSnow ? SNOW_VOL * Math.min(1, speed / 3) * (0.12 + 0.3 * v) * (powder ? 0.7 : 1) : 0;
  set(hiss.gain.gain, hv);
  set(hiss.filter.frequency, (powder ? 1100 : 1800) + 2200 * v + 1500 * sk.edge);
  // Skid: a rougher, lower scrape while the skis slide sideways or brake.
  set(scrape.gain.gain, onSnow ? clamp(sk.skid, 0, 1) * Math.min(1, speed / 4) * 0.45 * SNOW_VOL : 0);
  // Wind: grows with speed squared, a slow gust on top, and stays on through the air.
  const gust = 0.75 + 0.25 * Math.sin(ctx.currentTime * 0.7) * Math.sin(ctx.currentTime * 1.9);
  set(wind.gain.gain, skiing ? 0.65 * v * v * gust : 0, 0.15);
  set(wind.filter.frequency, 250 + 900 * v);

  if (skiing) {
    const p = sk.poleP;
    if (p >= PLANT && (was.poleP < PLANT || p < was.poleP)) polePlant();
    if (!sk.grounded && !sk.crashed) was.air = Math.max(was.air, sk.airMax);
    if (sk.grounded && !was.grounded && !sk.crashed && sk.landT > 0) thump(clamp(was.air / 4, 0, 1), sk.landQ === 'sloppy');
    if (sk.crashed && !was.crashed) thump(1, true);
    if (sk.grounded || sk.crashed) was.air = 0;
  }
  was.grounded = sk.grounded; was.crashed = sk.crashed; was.poleP = sk.poleP;
}

// Wind (2026-11-03): a steady breeze with gusts. One wind for the whole mountain: its heading wanders slowly, its
// strength follows the weather (cloudier days blow harder, storms hardest), and gusts come and go every few seconds.
// The wind sound follows the gusts (audio.js) and the storm flakes drift with it (atmosphere.js).
// The blowing-snow particles were cut for good (Jack 2026-11-09); snow effects get revisited later.

export const WIND = { x: 1, z: 0, speed: 4, gust: 0 };   // heading (unit), m/s, 0..1 how much of a gust is blowing
let t = 0;
// smooth 0..1 noise from a few sines that never line up
const wave = (s, a, b, c) => 0.5 + 0.22 * Math.sin(s * a) + 0.17 * Math.sin(s * b + 1.3) + 0.11 * Math.sin(s * c + 4.1);

export function updateWind(dt, cloudy, storm) {
  t += dt;
  const head = 0.9 + 0.6 * Math.sin(t / 240) + 0.25 * Math.sin(t / 77);
  WIND.x = Math.cos(head); WIND.z = Math.sin(head);
  WIND.gust = Math.pow(wave(t, 0.41, 0.97, 2.3), 2.2) * 1.6;
  const base = storm ? 11 : 2.5 + 3.5 * Math.min(1, cloudy);
  WIND.speed = base * (0.55 + 0.9 * WIND.gust);
}

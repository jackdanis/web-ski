// node run3.js body.glb poses yaws pitches outdir [optsJSON] : body-only renders (skis hidden) at several camera tilts
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const [bodyGlb, poses, yaws, pitches, outdir, optj] = [process.argv[2], process.argv[3].split(','), process.argv[4].split(',').map(Number), process.argv[5].split(',').map(Number), process.argv[6], process.argv[7] || '{}'];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); p.on('pageerror', e => console.error(String(e)));
  await p.goto('file://' + path.join(__dirname, 'pose2.html'));
  const u = f => 'data:model/gltf-binary;base64,' + fs.readFileSync(f).toString('base64');
  await p.evaluate(x => setup(x), u(path.join(__dirname, 'Michelle.glb')));
  await p.evaluate(([x, o]) => attachBody(x, o), [u(bodyGlb), JSON.parse(optj)]);
  // board mode: the skis are drawn by the game on the ski plate, so every pose stands square on straight skis
  // (the diagonal carve/brake look comes from the board and the camera angle, not the drawing)
  if (!process.env.SKIS) await p.evaluate(() => {
    for (const k in POSES) { POSES[k].skiYaw = [0, 0]; POSES[k].skiPitch = 0; }
    Object.assign(POSES.carve_l, { rot: { yaw: 0, roll: 28, pitch: 0 }, look: -15 });
    Object.assign(POSES.brake, { rot: { yaw: 0, roll: 0, pitch: 0 }, look: 80 });
    POSES.carve_r = mirror(POSES.carve_l);
    setSkis(false);
  });
  fs.mkdirSync(outdir, { recursive: true });
  for (const name of poses) {
    await p.evaluate(n => pose(n), name);
    for (const t of pitches) for (const y of yaws) {
      const r = await p.evaluate(([y, t]) => shoot(y, t, 320, 2.5, 2.2), [y, t]);
      for (const k of ['albedo', 'normal']) fs.writeFileSync(path.join(outdir, `${name}_t${t}_y${y}_${k}.png`), Buffer.from(r[k].split(',')[1], 'base64'));
    }
  }
  await b.close();
})();

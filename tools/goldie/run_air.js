// node run_air.js body.glb poses yaws elevs outdir : body-only renders centred on her pivot, camera from any elevation
// (-90 below her .. 90 above), for the air flip frames. Prints where the skis sit relative to the pivot.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const [bodyGlb, poses, yaws, elevs, outdir] = [process.argv[2], process.argv[3].split(','), process.argv[4].split(',').map(Number), process.argv[5].split(',').map(Number), process.argv[6]];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); p.on('pageerror', e => console.error(String(e)));
  await p.goto('file://' + path.join(__dirname, 'pose2.html'));
  const u = f => 'data:model/gltf-binary;base64,' + fs.readFileSync(f).toString('base64');
  await p.evaluate(x => setup(x), u(path.join(__dirname, 'Michelle.glb')));
  await p.evaluate(([x]) => attachBody(x, {}), [u(bodyGlb)]);
  await p.evaluate(() => setSkis(false));
  fs.mkdirSync(outdir, { recursive: true });
  for (const name of poses) {
    await p.evaluate(n => pose(n), name);
    console.log(name, 'skis from pivot', await p.evaluate(() => skiOffset().map(v => +v.toFixed(3))));
    for (const t of elevs) for (const y of yaws) {
      const r = await p.evaluate(([y, t]) => shootPivot(y, t, 320, 3.2), [y, t]);
      for (const k of ['albedo', 'normal']) fs.writeFileSync(path.join(outdir, `${name}_t${t}_y${y}_${k}.png`), Buffer.from(r[k].split(',')[1], 'base64'));
    }
  }
  await b.close();
})();

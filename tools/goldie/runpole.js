// node runpole.js body.glb poses yaws pitches outdir : like run3.js (board mode, skis hidden unless SKIS=1) with the pole poses
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const [bodyGlb, poses, yaws, pitches, outdir] = [process.argv[2], process.argv[3].split(','), process.argv[4].split(',').map(Number), process.argv[5].split(',').map(Number), process.argv[6]];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); p.on('pageerror', e => console.error(String(e)));
  await p.goto('file://' + path.join(__dirname, 'pose2.html'));
  const u = f => 'data:model/gltf-binary;base64,' + fs.readFileSync(f).toString('base64');
  await p.evaluate(x => setup(x), u(path.join(__dirname, 'Michelle.glb')));
  await p.evaluate(([x]) => attachBody(x, {}), [u(bodyGlb)]);
  await p.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'polepose.js'), 'utf8') });
  if (!process.env.SKIS) await p.evaluate(() => setSkis(false));
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

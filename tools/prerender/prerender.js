// node prerender.js model.glb outdir [--yaws 0,45,90] [--pitch 10] [--size 1024]
// node prerender.js --test-tree out.glb   (writes a procedural test model)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const args = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage(); p.on('pageerror', e => console.error(String(e)));
  await p.goto('file://' + path.join(__dirname, 'page.html'));
  if (args[0] === '--test-tree') { fs.writeFileSync(args[1], Buffer.from(await p.evaluate(() => makeTestTree()), 'base64')); console.log('wrote', args[1]); await b.close(); return; }
  const [glb, outdir] = args; const opt = k => { const i = args.indexOf('--' + k); return i > 0 ? args[i + 1] : null; };
  const yaws = (opt('yaws') || '0').split(',').map(Number), pitch = +(opt('pitch') || 10), size = +(opt('size') || 1024);
  const url = 'data:model/gltf-binary;base64,' + fs.readFileSync(glb).toString('base64');
  const res = await p.evaluate(([u, o]) => renderPasses(u, o), [url, { yaws, pitch, size }]);
  fs.mkdirSync(outdir, { recursive: true });
  const name = path.basename(glb, path.extname(glb));
  for (const r of res) for (const k of ['albedo', 'normal']) fs.writeFileSync(path.join(outdir, `${name}_y${r.yaw}_${k}.png`), Buffer.from(r[k].split(',')[1], 'base64'));
  console.log('rendered', res.length, 'angles to', outdir); await b.close();
})();

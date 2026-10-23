# Model-to-sprite pre-render

Turns a GLB model (for example from TRELLIS) into Golden Ski sprites with true normal maps.

1. `NODE_PATH=$(npm root -g) node prerender.js model.glb hi --yaws 0,45,90,135,180 --pitch 10 --size 1024`
   renders hi-res albedo and view-space normal passes (OpenGL convention) per angle, using headless Chromium + Three.js r128.
2. `python3 shrink.py hi/model_y0_albedo.png hi/model_y0_normal.png 128 out/model`
   shrinks to a 128 px tall sprite with its own palette, plus `out/model_n.png`.

`node prerender.js --test-tree test.glb` writes a procedural test model.

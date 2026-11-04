# Back-of-knee crease and calf highlight for the absorb frames seen from behind (Jack 2026-11-04: from behind her folded
# legs were one flat navy block and read far too short). Paints onto the raw albedo renders before sheet3.py, using the
# knee/ankle points runpole.js writes with KNEES=1.  python kneeline.py RAWDIR [pose] [maxyaw]
import sys, json, glob, re, numpy as np
from PIL import Image
D = sys.argv[1]; POSE = sys.argv[2] if len(sys.argv) > 2 else 'absorb'; MAXYAW = float(sys.argv[3]) if len(sys.argv) > 3 else 67.5
LIGHT = np.array([78, 92, 150.])          # lit navy, a step up from the pants' base colour
for f in glob.glob(f'{D}/{POSE}_t*_y*_albedo.png'):
    t, y = re.search(r'_t(-?[\d.]+)_y([\d.]+)_albedo', f).groups()
    if float(y) > MAXYAW: continue
    im = np.asarray(Image.open(f).convert('RGBA')).astype(float); rgb = im[..., :3]
    pants = (im[..., 3] > 128) & (rgb.sum(2) < 330) & (rgb[..., 2] > rgb[..., 0] * 1.4 + 4)
    for leg in json.load(open(f.replace('_albedo.png', '_knees.json'))):
        (kx, ky), (ax, ay) = leg['knee'], leg['ankle']
        ky = int(ky + 12)
        def run(row, x):   # the pants run on this row that holds x
            x = int(round(x)); r = pants[row]
            if not r[x]:
                near = np.where(r[max(0, x - 15):x + 16])[0]
                if not len(near): return None
                x = max(0, x - 15) + near[np.argmin(abs(near - 15))]
            a = x; b = x
            while a > 0 and r[a - 1]: a -= 1
            while b < len(r) - 1 and r[b + 1]: b += 1
            return a, b
        # crease: a soft light band curving up at the sides, across the middle of the leg
        for dy in range(-10, 7):
            row = ky + dy; s = run(row, kx)
            if not s: continue
            a, b = s; w = b - a
            for x in range(a + int(w * 0.18), b - int(w * 0.18) + 1):
                u = (x - (a + b) / 2) / (w / 2 + 1e-6)
                if abs(dy + 7 * u * u) > 4 or not pants[row, x]: continue
                rgb[row, x] = LIGHT
        # calf: a highlight down the centre of the shin, fading out toward the boot
        y0, y1 = ky + 12, int(ky + 0.62 * (ay - ky))
        for row in range(y0, y1):
            fx = kx + (ax - kx) * (row - ky) / max(1, ay - ky); s = run(row, fx)
            if not s: continue
            a, b = s; c = (a + b) / 2 + (b - a) * 0.08; hw = (b - a) * 0.13
            k = min(1, (row - y0) / 8, (y1 - row) / 25) * 0.8
            for x in range(int(c - hw), int(c + hw) + 1):
                if pants[row, x]: rgb[row, x] = rgb[row, x] * (1 - k) + LIGHT * k
    im[..., :3] = rgb; Image.fromarray(im.astype(np.uint8)).save(f)
    print('creased', f.split('/')[-1])

# Body-only Goldie atlas: 64 px/m frames with the OG finish (punch, shared 22-colour palette, despeckle, outline),
# trimmed to their pixels and shelf-packed. JSON: per pose/tilt/yaw the rect in the atlas and the foot point inside it.
import numpy as np, json, sys, colorsys, glob, re, os
from PIL import Image
SRC, OUT, W = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 2048
CENTER = bool(os.environ.get('CENTER'))  # frames from run_air.js: the anchor is the frame's centre (her pivot), not her feet
F = 5; NCOL = 22; OUTLINE = np.array([18, 16, 46.])
keys = sorted({re.match(r'(.+)_t(-?[\d.]+)_y([\d.]+)_albedo', f.split('/')[-1]).groups() for f in glob.glob(f'{SRC}/*_albedo.png')})
def pool(x):
    h, w = x.shape[0] // F * F, x.shape[1] // F * F; x = x[x.shape[0] - h:, :w]
    return x.reshape(h // F, F, w // F, F, x.shape[2]).sum((1, 3))
def punch(rgb):
    out = np.empty_like(rgb)
    for i, (r, g, b) in enumerate(rgb):
        h, l, s = colorsys.rgb_to_hls(r, g, b); s = min(1, s * 1.25); l = min(1, max(0, (l - 0.5) * 1.12 + 0.5)); out[i] = colorsys.hls_to_rgb(h, l, s)
    return out
frames = {}
for k in keys:
    A = np.asarray(Image.open(f'{SRC}/{k[0]}_t{k[1]}_y{k[2]}_albedo.png').convert('RGBA')).astype(float) / 255
    N = np.asarray(Image.open(f'{SRC}/{k[0]}_t{k[1]}_y{k[2]}_normal.png').convert('RGBA')).astype(float) / 255
    a = A[..., 3:4]; s = pool(np.dstack([A[..., :3] * a, a])); cov = s[..., 3] / (F * F)
    rgb = s[..., :3] / np.maximum(s[..., 3:4], 1e-6)
    n = pool((N[..., :3] * 2 - 1) * a); n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    frames[k] = (rgb, cov > 0.35, n)
allpx = punch(np.concatenate([f[0][f[1]] for f in frames.values()])[::3])
side = int(np.ceil(np.sqrt(len(allpx)))); pad = np.zeros((side * side, 3)); pad[:len(allpx)] = allpx; pad[len(allpx):] = allpx[0]
if os.environ.get('PAL'):  # reuse another sheet's palette: the colours deep inside its frames (outlines excluded)
    ref = np.asarray(Image.open(os.environ['PAL']).convert('RGBA')); m = ref[..., 3] > 0
    for _ in range(2): m[1:-1, 1:-1] = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
    u, c = np.unique(ref[m][:, :3], axis=0, return_counts=True); pal = u[c > 0.05 * c.max()].astype(float)
else: pal = np.array(Image.fromarray((pad.reshape(side, side, 3) * 255).astype(np.uint8)).quantize(colors=NCOL, method=Image.MEDIANCUT, dither=Image.NONE).getpalette()[:NCOL * 3]).reshape(-1, 3).astype(float)
def finish(rgb, m, n):
    lab = -np.ones(m.shape, int); lab[m] = ((punch(rgb[m])[:, None, :] * 255 - pal[None]) ** 2).sum(2).argmin(1)
    Hh, Ww = m.shape
    for _ in range(2):
        new = lab.copy()
        for y, x in zip(*np.where(lab >= 0)):
            nb = [v for v in lab[max(0, y - 1):y + 2, max(0, x - 1):x + 2].ravel() if v >= 0]; nb.remove(lab[y, x])
            if len(nb) >= 3 and lab[y, x] not in nb: new[y, x] = max(set(nb), key=nb.count)
        lab = new
    out = np.zeros((Hh, Ww, 4)); nout = np.zeros((Hh, Ww, 4)); f = lab >= 0
    out[f, :3] = pal[lab[f]]; out[f, 3] = 255; nout[f, :3] = (n[f] * 0.5 + 0.5) * 255; nout[f, 3] = 255
    for y, x in zip(*np.where(~f)):
        best = None
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            xx, yy = x + dx, y + dy
            if 0 <= xx < Ww and 0 <= yy < Hh and f[yy, xx]:
                lit = dx > 0 or dy > 0; oc = out[yy, xx, :3] * (0.45 if lit else 0.22) + OUTLINE * (0.55 if lit else 0.78)
                if best is None or oc.sum() < best[0].sum(): best = (oc, nout[yy, xx])
        if best is not None: out[y, x, :3] = best[0]; out[y, x, 3] = 255; nout[y, x] = best[1]
    return out, nout
fin = {}
for k, v in frames.items():
    o, no = finish(*v); ys, xs = np.where(o[..., 3] > 0); x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    fh, fw = o.shape[:2]; fin[k] = (o[y0:y1, x0:x1], no[y0:y1, x0:x1], fw / 2 - x0, (fh / 2 if CENTER else fh - 0.04 * 64) - y0)
# shelf pack, tallest first
order = sorted(fin, key=lambda k: -fin[k][0].shape[0]); x = y = sh = 0; rects = {}
for k in order:
    h, w = fin[k][0].shape[:2]
    if x + w > W: x, y, sh = 0, y + sh + 1, 0
    rects[k] = (x, y, w, h); x += w + 1; sh = max(sh, h)
H = 1 << int(np.ceil(np.log2(y + sh)))
atlas = np.zeros((H, W, 4)); natlas = np.zeros((H, W, 4)); meta = {}
for k, (x, y, w, h) in rects.items():
    atlas[y:y + h, x:x + w] = fin[k][0]; natlas[y:y + h, x:x + w] = fin[k][1]
    meta.setdefault(k[0], {}).setdefault(k[1], {})[k[2]] = [int(x), int(y), int(w), int(h), round(float(fin[k][2]), 2), round(float(fin[k][3]), 2)]
NAME = sys.argv[4] if len(sys.argv) > 4 else 'goldie_body'
Image.fromarray(atlas.astype(np.uint8)).save(f'{OUT}/{NAME}.png'); Image.fromarray(natlas.astype(np.uint8)).save(f'{OUT}/{NAME}_n.png')
json.dump({'pxPerM': 64, 'size': [W, H], 'frames': meta}, open(f'{OUT}/{NAME}.json', 'w'))
print('atlas', W, H, 'frames', len(rects))

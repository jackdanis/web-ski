"""Shrink hi-res albedo + normal passes to a pixel sprite.
python3 shrink.py albedo.png normal.png HEIGHT out_prefix [COLORS]
Albedo: alpha-weighted box average, alpha cut at 50%, own palette. Normal: averaged vectors, renormalised."""
import sys, numpy as np
from PIL import Image
a_p, n_p, H, pre = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
ncol = int(sys.argv[5]) if len(sys.argv) > 5 else 14
A = np.asarray(Image.open(a_p).convert("RGBA")).astype(float) / 255
N = np.asarray(Image.open(n_p).convert("RGBA")).astype(float) / 255
ys, xs = np.where(A[..., 3] > 0.5); A = A[ys.min():ys.max() + 1, xs.min():xs.max() + 1]; N = N[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
f = A.shape[0] / H; W = max(1, round(A.shape[1] / f))
def pool(img):
    h2, w2 = H, W; out = np.zeros((h2, w2, img.shape[2]))
    for y in range(h2):
        for x in range(w2):
            out[y, x] = img[int(y * f):max(int(y * f) + 1, int((y + 1) * f)), int(x * A.shape[1] / W):max(int(x * A.shape[1] / W) + 1, int((x + 1) * A.shape[1] / W))].reshape(-1, img.shape[2]).sum(0)
    return out
al = A[..., 3:4]
sa = pool(np.dstack([A[..., :3] * al, al])); cov = sa[..., 3] / (f * A.shape[1] / W)
rgb = sa[..., :3] / np.maximum(sa[..., 3:4], 1e-6)
mask = cov > 0.5
img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).quantize(colors=ncol, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGBA")
px = np.asarray(img).copy(); px[..., 3] = mask * 255
Image.fromarray(px).save(pre + ".png")
nv = pool(np.dstack([(N[..., :3] * 2 - 1) * al, al]))[..., :3]
nv /= np.maximum(np.linalg.norm(nv, axis=2, keepdims=True), 1e-6)
npx = np.dstack([(nv * 0.5 + 0.5) * 255, mask * 255]).astype(np.uint8)
Image.fromarray(npx).save(pre + "_n.png")
print(pre, W, "x", H)

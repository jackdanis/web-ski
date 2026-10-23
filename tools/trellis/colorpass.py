"""Colour pass for TRELLIS renders: TRELLIS textures come back desaturated, so tint the
dark (non-snow) foliage toward a target hue while leaving snow and the trunk alone.
python3 colorpass.py albedo.png out.png [R G B]   (target ratio, default Engelmann blue-green)"""
import sys, numpy as np
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
tint = np.array([float(v) for v in sys.argv[3:6]]) if len(sys.argv) > 5 else np.array([0.80, 1.16, 1.0])
a = np.asarray(Image.open(src).convert("RGBA")).astype(float) / 255
rgb, al = a[..., :3], a[..., 3] > 0.5
L = rgb.mean(2)
def ss(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)
w = 1 - ss(0.38, 0.7, L)                        # foliage = dark; snow = bright
# trunk: bottom rows where the silhouette is narrow; keep its colour
width = al.sum(1); rows = np.where(width > 0)[0]
trunk = np.zeros_like(al)
wide = np.where(width > 0.3 * width.max())[0]   # canopy rows; everything below the lowest is trunk
trunk[wide.max() + 1:] = True
w *= ~trunk
out = rgb * (1 - w[..., None]) + np.clip(L[..., None] * tint, 0, 1) * w[..., None]
Image.fromarray((np.dstack([out, a[..., 3]]) * 255).astype(np.uint8)).save(dst)
print(dst, "trunk rows", int(trunk.any(1).sum()))

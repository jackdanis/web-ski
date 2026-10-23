"""Match a render's colours to its reference photo: histogram-match L, a and b (CIELAB) of the
render's opaque pixels to the reference's object pixels (chroma green keyed out).
python3 colormatch.py render_albedo.png reference.png out.png"""
import sys, numpy as np
from PIL import Image

def to_lab(rgb):
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

def to_rgb(lab):
    fy = (lab[..., 0] + 16) / 116; fx = fy + lab[..., 1] / 500; fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787) * np.array([0.95047, 1.0, 1.08883])
    Mi = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    c = np.clip(xyz @ Mi.T, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055)

def match(src, ref):  # map src values so their distribution matches ref's
    s_idx = np.argsort(src); q = np.linspace(0, 1, len(src))
    out = np.empty_like(src); out[s_idx] = np.quantile(ref, q); return out

r = np.asarray(Image.open(sys.argv[1]).convert('RGBA')).astype(float) / 255
p = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(float) / 255
key = (p[..., 1] > 0.47) & (p[..., 1] > 2.2 * p[..., 0] / 1.0 * 0.5 + p[..., 0]) & (p[..., 1] > p[..., 2] * 1.6)
ref = to_lab(p[~key])
m = r[..., 3] > 0.5
lab = to_lab(r[..., :3])
for ch in range(3): lab[..., ch][m] = match(lab[..., ch][m], ref[:, ch])
out = r.copy(); out[..., :3][m] = to_rgb(lab[m])
Image.fromarray((out * 255).round().astype(np.uint8)).save(sys.argv[3])
print(sys.argv[3], 'ref px', len(ref), 'render px', int(m.sum()))

# Station atlas, photo pass: recolour tiles 0-5 from FLUX photo swatches (flux/*.webp) and the World Kit powder photo.
# Shapes stay the code-drawn ones from ../make_textures.py: the normal map is not touched, and the seams, plank gaps,
# battens and window frames are re-drawn here from the same rules, so color and normal line up pixel for pixel.
# Each tile is cut to 64 px (16 px per meter), made seamless, and reduced to a few colors so it stays pixel art.
#   python3 make_flux_atlas.py [keep|photo]   keep = photo grain on the current tile colors (default), photo = the photo's own colors
import sys, pathlib
import numpy as np
from PIL import Image
FILES = pathlib.Path('/mnt/project-files/golden-ski')
SRC = pathlib.Path('.')                            # run in the folder holding make_textures.py's station_atlas.png
FLUX = FILES / 'art/textures/flux'                 # the FLUX photo swatches
POWDER = FILES / 'references/world/powder.png'
MODE = sys.argv[1] if len(sys.argv) > 1 else 'keep'
T = 64
Y, X = np.mgrid[0:T, 0:T]

def load(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(float) / 255

def down(a, w, h):
    return np.asarray(Image.fromarray((a.clip(0, 1) * 255 + 0.5).astype(np.uint8)).resize((w, h), Image.BOX)).astype(float) / 255

def seamless(a, axis=(0, 1)):
    # cross-fade with a half-offset copy, weighted to the middle (as world2pixel's tile mode does)
    s = a.copy(); m = np.ones(a.shape[:2])
    for ax in axis:
        s = np.roll(s, a.shape[ax] // 2, ax)
        t = np.abs(np.linspace(-1, 1, a.shape[ax]))
        m = m * (np.clip(1 - t, 0, 1) ** 0.7 if ax == 1 else (np.clip(1 - t, 0, 1) ** 0.7)[:, None])
    return a * m[..., None] + s * (1 - m[..., None])

def quant(a, n):
    im = Image.fromarray((a.clip(0, 1) * 255 + 0.5).astype(np.uint8))
    return np.asarray(im.quantize(colors=n, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')).astype(float) / 255

def toward(a, target, strength=1.0):
    # keep: move the tile's mean color onto the current tile's (per channel gain), keeping the photo's variation
    g = np.array(target) / a.reshape(-1, 3).mean(0)
    return a * (1 + (g - 1) * strength)

def strips(photo, n, length, axis, seed, gap_rows):
    # boards: one strip per board, cut from a random spot inside one photo plank (between its gaps), resized to
    # 4 px across and `length` along, seamless along its length. axis 0 = boards run left-right, 1 = up-down.
    rng = np.random.default_rng(seed); out = []
    planks = [(a + 3, b - 3) for a, b in zip(gap_rows[:-1], gap_rows[1:]) if b - a > 20]
    for _ in range(n):
        a, b = planks[rng.integers(len(planks))]
        h = rng.integers(10, max(11, (b - a) // 2)); y0 = rng.integers(a, max(a + 1, b - h))
        x0 = rng.integers(0, photo.shape[1] // 3)
        s = photo[y0:y0 + h, x0:x0 + photo.shape[1] * 2 // 3]
        if rng.random() < 0.5: s = s[:, ::-1]
        s = down(s, length, 4)
        s = seamless(s, axis=(1,))
        out.append(s if axis == 0 else s.transpose(1, 0, 2))
    return out

def plank_gaps(photo):
    # rows where the photo's planks meet: dark minima in the row brightness
    r = photo.mean((1, 2)); r = np.convolve(r, np.ones(5) / 5, 'same')
    g = [i for i in range(3, len(r) - 3) if r[i] == r[i - 3:i + 4].min() and r[i] < np.median(r) - 0.04]
    return [0] + g + [len(r)]

before = load(SRC / 'station_atlas.png')
tile = lambda k: before[(k // 8) * T:(k // 8 + 1) * T, (k % 8) * T:(k % 8 + 1) * T]
OLD_AVG = [tile(k).reshape(-1, 3).mean(0) for k in range(6)]
keep = MODE == 'keep'
new = {}

# 0 hood: painted sheet metal photo, seams every 2 m as before (lighter seam, shadow on its far side)
p = load(FLUX / 'hood_7.webp')
c = seamless(down(p, T, T))
c = c.mean((0, 1)) + (c - c.mean((0, 1))) * 1.6      # the paint is very even; lift its scuffs a little
c = toward(c, OLD_AVG[0]) if keep else c
seam = (X % 32 == 0)
c = c * (1 - 0.18 * (X % 32 == 31))[..., None]
c[seam] = c[seam] * 1.25 + 0.04
new[0] = quant(c, 8)

# 1 deck: each 4 px plank its own strip of the deck photo, dark gaps, snow packed into some gaps (same rule as before)
deck = load(FLUX / 'deck_7.webp'); gaps = plank_gaps(deck)
c = np.zeros((T, T, 3)); gap = (Y % 5 == 4)
for k, s in enumerate(strips(deck, T // 5 + 1, T, 0, 11, gaps)):
    c[k * 5:k * 5 + 4] = s[:min(4, T - k * 5)]
if keep: c = toward(c, OLD_AVG[1] / 0.94)          # planks only; the gaps pull the tile mean down again
gapc = np.array([0.16, 0.12, 0.09]) if keep else deck[[g for g in gaps[1:-1]]].reshape(-1, 3).mean(0) * 0.7
c[gap] = gapc
c = quant(c, 7)
from_code = (Y % 5 == 4)
snowgap = from_code & (np.asarray(Image.open(SRC / 'station_atlas.png').convert('RGB'))[0:T, T:2 * T].mean(-1) > 150)
c[snowgap] = np.array([0.72, 0.76, 0.84])
new[1] = c

# 2 siding: its own photo (vertical boards, turned flat to cut strips), a batten every 5 px, lighter, as before
side = load(FLUX / 'siding_7.webp').transpose(1, 0, 2); sgaps = plank_gaps(side)
c = np.zeros((T, T, 3))
for k, s in enumerate(strips(side, T // 5 + 1, T, 1, 31, sgaps)):
    w = min(5, T - k * 5); c[:, k * 5:k * 5 + w] = np.concatenate([s, s[:, :1]], 1)[:, :w]
if keep: c = toward(c, OLD_AVG[2] / 1.01)
else: c = c * 0.82                                 # a darker stain than the deck
bat = (X % 5 == 0); c[bat] *= 1.08
new[2] = quant(c, 7)

# 3 windows: wooden frames from the siding photo, the glass kept as drawn (dark, sky glint)
c = tile(3).copy(); frame = (X % 16 < 2) | (Y % 16 < 2)
wood = np.zeros((T, T, 3))
for k, s in enumerate(strips(side, T // 4, T, 0, 41, sgaps)): wood[k * 4:k * 4 + 4] = s
woodv = wood.transpose(1, 0, 2)
fr = np.where((X % 16 < 2)[..., None], woodv, wood)
fr = toward(fr, [0.6, 0.45, 0.3]) if keep else fr * 0.9
c[frame] = quant(fr, 5)[frame]
new[3] = c

# 4 roof snow: detail from the powder photo, its mean set to the roof's white, faint blue kept in the hollows
p = load(POWDER)
s = min(p.shape[:2]); p = p[(p.shape[0] - s) // 2:(p.shape[0] + s) // 2, (p.shape[1] - s) // 2:(p.shape[1] + s) // 2]
c = seamless(down(p, T, T))
c = c - c.reshape(-1, 3).mean(0) + OLD_AVG[4]
new[4] = quant(c.clip(0, 1), 5)

# 5 concrete: board-formed, grain and stains from its photo, the form lines and pits as before
p = load(FLUX / 'concrete_7.webp')
c = seamless(down(p, T, T))
c = toward(c, OLD_AVG[5] / 0.99) if keep else c
c = c * (1 - 0.08 * (Y % 5 == 0))[..., None]
pits = np.random.default_rng(62).random((T, T)) > 0.97; c[pits] *= 0.8
new[5] = quant(c, 6)

after = before.copy()
for k, c in new.items():
    after[(k // 8) * T:(k // 8 + 1) * T, (k % 8) * T:(k % 8 + 1) * T] = c.clip(0, 1)
tag = '' if keep else '_photo'
Image.fromarray((after * 255 + 0.5).astype(np.uint8)).save(f'station_atlas{tag}.png')
print('avg', [[round(float(v), 3) for v in after[(k // 8) * T:(k // 8 + 1) * T, (k % 8) * T:(k % 8 + 1) * T].reshape(-1, 3).mean(0)] for k in range(17)])

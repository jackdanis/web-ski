# Station texture atlas for the Snowlight model shader: 8 x 4 tiles (was 4 x 2) of 64 px, each 4 m of surface (16 px per meter).
# Every tile is drawn in code: a height map for the shapes (seams, plank gaps, battens, form lines, snow lumps), from
# which the normal map is made, and a color map. Colors are the game's raw colors (no sRGB step), as the vertex colors are.
# Tiles: 0 hood panels, 1 deck planks, 2 hut siding, 3 hut windows, 4 roof snow, 5 board-formed concrete.
import numpy as np
from PIL import Image
T, rng = 64, np.random.default_rng(7)
Y, X = np.mgrid[0:T, 0:T]

def tnoise(scale, seed):
    # tileable value noise: a coarse random grid wrapped round, smoothly upsampled
    r = np.random.default_rng(seed).random((scale, scale))
    fx, fy = X * scale / T, Y * scale / T
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a, b = r[y0 % scale, x0 % scale], r[y0 % scale, (x0 + 1) % scale]
    c, d = r[(y0 + 1) % scale, x0 % scale], r[(y0 + 1) % scale, (x0 + 1) % scale]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty

def fbm(seed, oct=(4, 8, 16, 32), w=(0.5, 0.25, 0.15, 0.1)):
    return sum(wi * tnoise(o, seed + i) for i, (o, wi) in enumerate(zip(oct, w)))

def col(rgb, shade):
    return np.clip(np.array(rgb)[None, None, :] * shade[..., None], 0, 1)

tiles = []
# 0 hood: painted sheet metal, standing seams every 2 m (32 px), scuffs and faint vertical streaks
h = np.zeros((T, T)); seam = (X % 32 == 0)
h[seam] = 1.0; h[(X % 32 == 1)] = 0.5
streak = tnoise(16, 3)[0][None, :].repeat(T, 0) if False else np.tile(tnoise(16, 3)[:1, :], (T, 1))
shade = 0.94 + 0.08 * fbm(1) + 0.04 * (streak - 0.5) - 0.18 * (X % 32 == 31)
c = col([0.14, 0.28, 0.6], shade); c[seam] = np.array([0.24, 0.38, 0.7])
tiles.append((c, h, 1.6))
# 1 deck: planks 4 px wide across, 1 px gaps, each plank its own tone, grain along it, snow packed into some gaps
h = np.ones((T, T)); gap = (Y % 5 == 4); h[gap] = 0.0
plank = Y // 5
tone = np.random.default_rng(11).random(T // 5 + 2)[plank]
grain = tnoise(32, 21)
grain = np.tile(np.random.default_rng(12).random((T, 1)), (1, T)) * 0.5 + tnoise(8, 22) * 0.5
shade = 0.82 + 0.2 * tone + 0.12 * (grain - 0.5)
c = col([0.42, 0.31, 0.21], shade); c[gap] = np.array([0.16, 0.12, 0.09])
snowgap = gap & (tnoise(8, 23) > 0.68)
c[snowgap] = np.array([0.72, 0.76, 0.84]); h[snowgap] = 0.6
tiles.append((c, h, 2.0))
# 2 hut siding: vertical boards with a raised batten every 5 px, grain running up
h = np.full((T, T), 0.4); bat = (X % 5 == 0); h[bat] = 1.0
shade = 0.86 + 0.12 * np.random.default_rng(31).random(T // 5 + 2)[X // 5] + 0.1 * (tnoise(32, 32) - 0.5) + 0.08 * bat
c = col([0.5, 0.36, 0.24], shade)
tiles.append((c, h, 1.8))
# 3 hut windows: dark glass, wooden frames and mullions every 0.8 m (13 px), a sky glint across the panes
h = np.full((T, T), 0.2); frame = (X % 16 < 2) | (Y % 16 < 2)
h[frame] = 1.0
glint = ((X + Y) % 16 < 3) & ~frame
c = col([0.15, 0.2, 0.3], 0.9 + 0.1 * fbm(41))
c[glint] = np.array([0.42, 0.52, 0.68]); c[frame] = np.array([0.6, 0.45, 0.3])
tiles.append((c, h, 1.6))
# 4 roof snow: soft lumps and wind ripples, faint blue in the hollows
lump = fbm(51, (4, 8, 16, 32), (0.55, 0.3, 0.1, 0.05))
h = lump
c = np.stack([0.9 + 0.08 * lump, 0.93 + 0.06 * lump, 1.0 + 0 * lump], -1).clip(0, 1)
tiles.append((c, h, 3.0))
# 5 concrete: board-formed, a form line every 5 px, small pits, water stains running down
h = 0.6 + 0.2 * tnoise(32, 61); form = (Y % 5 == 0); h[form] = 0.2
pits = np.random.default_rng(62).random((T, T)) > 0.97; h[pits] = 0.0
stain = np.tile(tnoise(16, 63)[:1, :], (T, 1)) * (0.5 + 0.5 * Y / T)
shade = 0.95 + 0.08 * fbm(64) - 0.18 * (stain - 0.4).clip(0) - 0.08 * form
c = col([0.62, 0.6, 0.56], shade)
tiles.append((c, h, 1.4))

# ---- tiles 6+ (2026-10-21, second batch): gondola cabin, towers, Elk Camp top buildings, posters ----
import pathlib
GOLDIE = pathlib.Path('/mnt/project-files/golden-ski/art/textures/goldie-og.png')   # the first Goldie sprite sheet, for the posters
# a 3 x 5 pixel font for the cabin logo and the posters
FONT = {
    'A': ['010', '101', '111', '101', '101'], 'C': ['011', '100', '100', '100', '011'], 'E': ['111', '100', '110', '100', '111'],
    'G': ['011', '100', '101', '101', '011'], 'H': ['101', '101', '111', '101', '101'], 'I': ['111', '010', '010', '010', '111'],
    'K': ['101', '101', '110', '101', '101'], 'L': ['100', '100', '100', '100', '111'], 'M': ['101', '111', '101', '101', '101'],
    'N': ['101', '111', '111', '111', '101'], 'O': ['010', '101', '101', '101', '010'], 'P': ['110', '101', '110', '100', '100'],
    'R': ['110', '101', '110', '101', '101'], 'S': ['011', '100', '010', '001', '110'], 'T': ['111', '010', '010', '010', '010'],
    'W': ['101', '101', '101', '111', '101'], 'D': ['110', '101', '101', '101', '110'], 'U': ['101', '101', '101', '101', '111'],
    ' ': ['000', '000', '000', '000', '000'],
}
def text_w(t, sp=1): return len(t) * (3 + sp) - sp
def draw_text(img, t, x, y, color, sy=1, sp=1, grad=None):
    # pixel text into an (H, W, 3) array; sy stretches it tall like the poster lettering; grad darkens toward the bottom
    for k, ch in enumerate(t):
        g = FONT[ch]
        for r in range(5 * sy):
            for q in range(3):
                if g[r // sy][q] == '1':
                    yy, xx = y + r, x + k * (3 + sp) + q
                    if 0 <= yy < img.shape[0] and 0 <= xx < img.shape[1]:
                        f = 1.0 if grad is None else 1.0 - grad * r / (5 * sy - 1)
                        img[yy, xx] = np.array(color) * f
def grad_v(h, w, top, bot):
    t = np.linspace(0, 1, h)[:, None, None]
    return np.tile(np.array(top) * (1 - t) + np.array(bot) * t, (1, w, 1))
def goldie(frame, height):
    from PIL import Image as I
    im = I.open(GOLDIE).convert('RGBA').crop((frame * 96, 0, frame * 96 + 96, 128))
    im = im.crop(im.getbbox())
    w = max(1, round(im.width * height / im.height))
    im = im.resize((w, height), I.BOX)
    a = np.asarray(im).astype(float) / 255
    return a[..., :3], a[..., 3] > 0.45
def paste(img, rgb, mask, x, y):
    h, w = mask.shape
    for r in range(h):
        for q in range(w):
            if mask[r, q] and 0 <= y + r < img.shape[0] and 0 <= x + q < img.shape[1]:
                img[y + r, x + q] = rgb[r, q]

# 6 gondola cabin side, mapped once over a whole side (1.9 m x 2.1 m): tinted glass over a black body,
# the white teardrop swoosh and SNOWMASS in white, the way Snowmass's cabins look
c = np.zeros((T, T, 3)); h = np.full((T, T), 0.5)
belt = 30                                         # rows above are glass (the image's top is the cabin's top)
c[:] = np.array([0.07, 0.075, 0.085]) * (0.9 + 0.15 * fbm(71))[..., None]
glass = Y < belt
c[glass] = (np.array([0.1, 0.13, 0.18])[None, :] * (0.9 + 0.2 * fbm(72)[glass])[:, None])
glint = glass & (((X - Y * 0.6) % 22) < 3)
c[glint] = np.array([0.35, 0.42, 0.55])
h[glass] = 0.35
c[belt - 1:belt + 1] = np.array([0.03, 0.03, 0.035]); h[belt - 1:belt + 1] = 0.9
c[:, 31:33][Y[:, 31:33] < belt] = np.array([0.03, 0.03, 0.035])
c[2:4] = np.array([0.03, 0.03, 0.035])
# swoosh: a teardrop outline, point up, toward the front of the side
cx, cy = 18, 30
tt = np.linspace(0, 2 * np.pi, 400)
for th in tt:
    rr = 9 * (1 - np.sin(th)) ** 0.9 / 1.6
    x = cx + rr * np.cos(th) * 0.7; y = cy - 8 + 9 * np.sin(th) * -1.6 * 0.6 + 6
    for d in (0, 0.6):
        xi, yi = int(round(x + d)), int(round(y))
        if 0 <= xi < T and 0 <= yi < T: c[yi, xi] = np.array([0.95, 0.95, 0.95]); h[yi, xi] = 0.6
draw_text(c, 'SNOWMASS', 30, 40, [0.95, 0.95, 0.95])
c[T - 3:] = np.array([0.32, 0.33, 0.35])          # the grey sill along the floor
tiles.append((c, h, 1.2))
# 7 galvanized steel: light zinc grey, spangle mottling, a weld seam and bolt rows
h = 0.5 + 0.15 * tnoise(32, 81); seam = (X % 32 == 16); h[seam] = 0.9
bolt = ((Y % 16 == 8) & (X % 8 == 4)); h[bolt] = 1.0
c = col([0.66, 0.68, 0.71], 0.9 + 0.14 * fbm(82) + 0.05 * (np.random.default_rng(83).random((T, T)) - 0.5))
c[seam] = np.array([0.56, 0.58, 0.6]); c[bolt] = np.array([0.5, 0.5, 0.52])
tiles.append((c, h, 1.2))
# 8 tower pad: red foam wrapped round the pole, a fold every 8 px, a darker crease in each
fold = (X % 8) / 8.0
h = 0.5 + 0.5 * np.sin(fold * np.pi)
c = col([0.78, 0.12, 0.1], 0.75 + 0.3 * np.sin(fold * np.pi) + 0.05 * fbm(91))
c[(Y % 32 == 0)] = np.array([0.5, 0.08, 0.07])    # the straps
tiles.append((c, h, 2.0))
# 9 metal roof: dark standing seam every 1 m (16 px)
h = np.full((T, T), 0.4); sm = (X % 16 == 0); h[sm] = 1.0; h[X % 16 == 1] = 0.7
c = col([0.27, 0.28, 0.3], 0.92 + 0.1 * fbm(101)); c[sm] = np.array([0.38, 0.39, 0.42])
tiles.append((c, h, 1.6))
# 10 dark steel wall panels: charcoal, a horizontal joint every 1 m and a vertical one every 2 m
h = np.full((T, T), 0.6); jn = (Y % 16 == 0) | (X % 32 == 0); h[jn] = 0.1
c = col([0.16, 0.165, 0.18], 0.92 + 0.1 * fbm(111)); c[jn] = np.array([0.08, 0.08, 0.09])
tiles.append((c, h, 1.4))
# 11 cedar cladding: warm horizontal boards 4 px with a 1 px shadow gap, each board its own tone
h = np.ones((T, T)); gp = (Y % 5 == 4); h[gp] = 0.1
tone = np.random.default_rng(121).random(T // 5 + 2)[Y // 5]
c = col([0.7, 0.46, 0.26], 0.82 + 0.22 * tone + 0.1 * (tnoise(16, 122) - 0.5)); c[gp] = np.array([0.3, 0.19, 0.11])
tiles.append((c, h, 1.6))
# 12 stone foundation: stacked stones of mixed grey and tan, dark mortar
rng12 = np.random.default_rng(131)
c = np.zeros((T, T, 3)); h = np.zeros((T, T)); row = 0
while row < T:
    rh = int(rng12.integers(5, 9)); x = -int(rng12.integers(0, 8))
    while x < T:
        sw = int(rng12.integers(7, 15)); tint = rng12.random()
        base = np.array([0.55, 0.53, 0.5]) * (0.75 + 0.35 * tint) + np.array([0.06, 0.03, 0.0]) * (rng12.random() > 0.5)
        for yy in range(row, min(T, row + rh)):
            for xx in range(max(0, x), min(T, x + sw)):
                edge = yy in (row, row + rh - 1) or xx in (x, x + sw - 1)
                c[yy, xx] = np.array([0.25, 0.24, 0.23]) if edge else base
                h[yy, xx] = 0.0 if edge else 0.7 + 0.3 * rng12.random() * 0.3
        x += sw
    row += rh
c *= (0.92 + 0.12 * fbm(132))[..., None]
tiles.append((c.clip(0, 1), h, 1.8))
# 13 curtain glass: tall panes 1.5 m wide (24 px), thin dark mullions, sky and trees caught in the glass
h = np.full((T, T), 0.3); mul = (X % 24 < 1) | (Y % 32 == 0); h[mul] = 1.0
sky = grad_v(T, T, [0.45, 0.55, 0.7], [0.12, 0.16, 0.22])
trees = (Y > 34 + 6 * tnoise(8, 141)[0][None, :].repeat(T, 0) * 0 + 10 * tnoise(8, 142)) 
c = sky.copy(); c[trees] = np.array([0.09, 0.12, 0.12])
c[((X - Y) % 24 < 4) & ~mul] *= 1.4
c[mul] = np.array([0.06, 0.06, 0.07])
tiles.append((c.clip(0, 1), h, 1.0))

# 14-16 the après posters, 42 x 64 inside their tiles (columns 11-52), vintage resort posters with Goldie
NAVY, PALE, WHITE = [0.1, 0.16, 0.38], [0.86, 0.9, 0.92], [0.96, 0.97, 1.0]
def poster_tile(img):
    t = np.zeros((T, T, 3)); t[:] = np.array([0.2, 0.2, 0.22]); t[:, 11:53] = img
    hh = np.full((T, T), 0.6); hh[:, 11] = hh[:, 52] = 0.9
    return (t, hh, 0.6)
posters = []
# A: THIS WINTER / SNOWMASS, after the Sun Valley poster: Goldie skiing out of powder in front of the mountains
P = np.zeros((64, 42, 3)); P[:] = PALE
P[13:52, 3:39] = grad_v(39, 36, [0.55, 0.72, 0.88], [0.8, 0.88, 0.94])
for q in range(36):                               # a white peak behind her
    top = int(26 + abs(q - 12) * 0.6)
    P[top:52, 3 + q] = np.array([0.93, 0.95, 0.98]) - 0.08 * (q > 12)
rgb, m = goldie(8, 34); paste(P, rgb, m, 21 - m.shape[1] // 2 + 2, 15)
for q in range(36):                               # the powder spray over her boots
    top = int(44 + 3 * np.sin(q * 0.7) + (q < 10) * 2)
    P[top:52, 3 + q] = np.array(WHITE)
draw_text(P, 'THIS', 1, 3, NAVY, sp=1); draw_text(P, 'WINTER', 19, 3, NAVY, sp=1)
draw_text(P, 'SNOWMASS', 5, 53, NAVY, sy=2, sp=1)
posters.append(P)
# B: ELK CAMP GONDOLA at golden hour: dark ridges, a black Snowmass cabin on its cable
P = grad_v(64, 42, [0.95, 0.62, 0.3], [0.32, 0.42, 0.7])
for q in range(42):
    a = int(30 + 8 * np.sin(q * 0.18) + 3 * np.sin(q * 0.53)); P[a:, q] = np.array([0.36, 0.28, 0.4])
    b = int(40 + 5 * np.sin(q * 0.11 + 1) + 2 * np.sin(q * 0.7)); P[b:, q] = np.array([0.2, 0.16, 0.26])
for q in range(42):                               # the cable, down to the left
    y = int(8 + q * 0.42); P[y, q] = np.array([0.08, 0.08, 0.1])
gx, gy = 24, int(8 + 24 * 0.42)
P[gy:gy + 5, gx] = np.array([0.5, 0.5, 0.52])     # hanger
for r in range(13):                               # the cabin: rounded, glass above, black below, the swoosh
    w = 6 - (r == 0) * 2 - (r == 12) * 2 - (r == 1 or r == 11)
    P[gy + 5 + r, gx - w:gx + w + 1] = np.array([0.18, 0.24, 0.34]) if r < 6 else np.array([0.05, 0.05, 0.06])
P[gy + 9:gy + 14, gx - 3] = np.array(WHITE); P[gy + 8, gx - 2] = np.array(WHITE)
P[52:64] = np.array(NAVY)
draw_text(P, 'ELK CAMP', 5, 3, WHITE, sy=2)
draw_text(P, 'GONDOLA', 7, 55, [0.98, 0.78, 0.3])
posters.append(P)
# C: APRES SKI: a pink evening sky, a snowy chalet with its sun deck, Goldie with her arms up
P = grad_v(64, 42, [0.95, 0.55, 0.5], [0.98, 0.85, 0.7])
P[40:] = np.array([0.93, 0.94, 0.98])
for q in range(16):                               # chalet roof, snow on it, wooden front, deck rail
    P[27 + abs(q - 8) // 2: 30 + abs(q - 8) // 2, 2 + q] = np.array(WHITE)
P[31:41, 4:16] = np.array([0.5, 0.33, 0.2]); P[33:36, 6:14] = np.array([1.0, 0.82, 0.4])
P[41:43, 1:20] = np.array([0.45, 0.3, 0.18]); P[43:45, 1:20:2] = np.array([0.45, 0.3, 0.18])
rgb, m = goldie(9, 30); paste(P, rgb, m, 27 - m.shape[1] // 2, 18)
draw_text(P, 'APRES', 2, 3, NAVY, sy=2, sp=1)
P[0:2, 15:17] = np.array(NAVY)                    # the accent on the E (APRES -> APRÈS)
draw_text(P, 'SNOWMASS', 5, 56, NAVY)
posters.append(P)
for P in posters: tiles.append(poster_tile(P.clip(0, 1)))
for k, P in enumerate(posters):                   # big copies to look at
    Image.fromarray((P.clip(0, 1) * 255 + 0.5).astype(np.uint8)).resize((42 * 8, 64 * 8), Image.NEAREST).save(f'poster_{"abc"[k]}.png')

def normals(h, k):
    # wrapped central differences; tangent space with u to the right and v up (rows run down, so dv flips)
    du = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * k
    dv = -(np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * k
    n = np.stack([-du, -dv, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)

atlas = np.zeros((4 * T, 8 * T, 3)); natl = np.tile(np.array([0.5, 0.5, 1.0]), (4 * T, 8 * T, 1))
avg = []
for t, (c, h, k) in enumerate(tiles):
    ty, tx = divmod(t, 8)
    atlas[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T] = c
    natl[ty * T:(ty + 1) * T, tx * T:(tx + 1) * T] = normals(h, k) * 0.5 + 0.5
    avg.append([round(float(v), 3) for v in c.reshape(-1, 3).mean(0)])
Image.fromarray((atlas * 255 + 0.5).astype(np.uint8)).save('station_atlas.png')
Image.fromarray((natl * 255 + 0.5).astype(np.uint8)).save('station_atlas_n.png')
print('avg', avg)

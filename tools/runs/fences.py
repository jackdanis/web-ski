"""Wooden rail fences from Jack's laser-note pins (batch 2): python3 fences.py <bake work dir> <fences.json>.

The work dir needs labels.npy, bld2m.npy and trees.npy (run bake_runs.sh, or base, labels, shape and trees, first).
From each pin, walk the run edge both ways while the ground just outside is open (no canopy, building or edge tree),
4 more steps into the trees, then set posts every ~3 m, OFF m outside the edge. MANUAL lines are drawn by hand.
Copy the result to source-data/runs/fences.json and run export.py.
"""
import sys, json, numpy as np, cv2
from load import RM
from scipy import ndimage as ndi
import grid
d = sys.argv[1]
lab = np.load(f'{d}/labels.npy', mmap_mode='r'); bld = np.load(f'{d}/bld2m.npy', mmap_mode='r')
C = np.load(RM + 'chm_1m.npy', mmap_mode='r')
T = np.load(f'{d}/trees.npy')
MANUAL = {6: [[2230, -5466], [2228, -5450], [2229, -5435], [2233, -5419]], 13: [[2722, -4616], [2737, -4611], [2753, -4606]],
          18: [[3308, -4846], [3336, -4846], [3366, -4844]]}
PINS = {1: (1678.1, -4268.1, 80), 2: (1651.8, -4368.9, 80), 3: (1629.8, -4786.6, 60), 6: (2236, -5433.9, 80), 12: (2602.8, -4602.3, 120),
        13: (2728.9, -4599.5, 60), 14: (2786.3, -4625.9, 80), 18: (3336, -4844.8, 70), 23: (-432.1, -1242.3, 400)}
OFF = 2.5; W = 260
out = []
for n, (px, pz, reach) in PINS.items():
    if n in MANUAL:
        M = np.array(MANUAL[n], float); s_ = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(M, axis=0).T))]); t = np.linspace(0, s_[-1], max(2, int(round(s_[-1] / 3)) + 1))
        pts = [[round(float(np.interp(v, s_, M[:, 0])), 1), round(float(np.interp(v, s_, M[:, 1])), 1)] for v in t]
        out.append(dict(pin=n, note=f"Jack's laser notes batch 2 (2026-10-27), pin {n}", length_m=round(float(s_[-1])), points=pts)); print(n, 'manual', round(float(s_[-1]))); continue
    r0, c0 = [int(v) - W for v in grid.rc(px, pz)]
    L = np.asarray(lab[r0:r0 + 2 * W, c0:c0 + 2 * W]) > 0
    B = np.asarray(bld[r0:r0 + 2 * W, c0:c0 + 2 * W]) > 0
    ch = np.asarray(C[2 * r0:2 * (r0 + 2 * W), 2 * c0:2 * (c0 + 2 * W)]).reshape(2 * W, 2, 2 * W, 2).max(axis=(1, 3)) >= 3
    # edge trees too (the game's trees near runs)
    tm = np.zeros_like(ch)
    sel = (abs(T[:, 0] - px) < 2 * W) & (abs(T[:, 1] - pz) < 2 * W)
    rr, cc = grid.rc(T[sel, 0], T[sel, 1]); rr = np.round(rr).astype(int) - r0; cc = np.round(cc).astype(int) - c0
    ok = (rr >= 0) & (rr < 2 * W) & (cc >= 0) & (cc < 2 * W); tm[rr[ok], cc[ok]] = True
    blocked = ndi.binary_dilation(ch | B | tm, iterations=1) & ~L
    cs, _ = cv2.findContours(L.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    best = None
    pr, pc = W, W
    for ci, c in enumerate(cs):
        c = c[:, 0, :]; dd = np.hypot(c[:, 0] - pc, c[:, 1] - pr); k = int(dd.argmin())
        if best is None or dd[k] < best[0]: best = (dd[k], ci, k)
    c = cs[best[1]][:, 0, :]; k0 = best[2]; N = len(c)
    # outward normal from the smoothed distance field
    sd = ndi.gaussian_filter(ndi.distance_transform_edt(~L) - ndi.distance_transform_edt(L), 2.0)
    gy, gx = np.gradient(sd)
    def open_at(k):
        x, y = c[k % N]; g = np.hypot(gx[y, x], gy[y, x]) + 1e-9
        hits = 0
        for s in (1.5, 2.5, 3.5):
            yy = int(round(y + gy[y, x] / g * s)); xx = int(round(x + gx[y, x] / g * s))
            if 0 <= yy < 2 * W and 0 <= xx < 2 * W and blocked[yy, xx]: hits += 1
        return hits == 0
    steps = int(reach / grid.PC)
    ends = []
    for sgn in (-1, 1):
        k, shut = k0, 0
        for _ in range(steps):
            k += sgn
            shut = 0 if open_at(k) else shut + 1
            if shut >= 3: k -= sgn * 3; break
        ends.append(k + sgn * 4)                       # into the trees a little, so no gap is left at the ends
    ks = np.arange(ends[0], ends[1] + 1)
    P = c[ks % N].astype(float)
    nx = np.array([gx[int(y), int(x)] for x, y in P]); ny = np.array([gy[int(y), int(x)] for x, y in P]); g = np.hypot(nx, ny) + 1e-9
    P[:, 0] += nx / g * OFF / grid.PC; P[:, 1] += ny / g * OFF / grid.PC
    P[:, 0] = ndi.gaussian_filter1d(P[:, 0], 2, mode='nearest'); P[:, 1] = ndi.gaussian_filter1d(P[:, 1], 2, mode='nearest')
    X, Z = grid.xz(P[:, 1] + r0, P[:, 0] + c0)
    s = np.concatenate([[0], np.cumsum(np.hypot(np.diff(X), np.diff(Z)))])
    m = max(2, int(round(s[-1] / 3)) + 1); t = np.linspace(0, s[-1], m)
    pts = [[round(float(np.interp(v, s, X)), 1), round(float(np.interp(v, s, Z)), 1)] for v in t]
    out.append(dict(pin=n, note=f"Jack's laser notes batch 2 (2026-10-27), pin {n}", length_m=round(float(s[-1])), points=pts))
    print(n, 'length', round(float(s[-1])), 'm', 'posts', len(pts))
json.dump(dict(note="Wooden rail fences (2 rails on posts, like the one behind the Village Express top) that close the way from a run into building areas; they collide. Points x, z in m; export.py adds ground y.", fences=out),
          open(sys.argv[2], 'w'), indent=1)

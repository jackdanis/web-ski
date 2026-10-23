"""Trees along the run edges from the 1 m tree-height map (Meta/WRI canopy height, CC BY 4.0), Jack's choice 2.

Within NEAR m of a run (and in the tree islands inside runs) the forest is as dense as the map shows: every tree top
the map finds stands where the real one does, and the rest of the ground under canopy is filled with trees packed
as tight as they can be while staying separate, so dense cover can still be skied through (Jack: "tightly packed but
separate"). Two trees keep GAP m clear between their trunk-and-branch circles (game.js TREE_R, what the skier hits),
and a tree's circle stays EDGE_GAP m off the run. The game's own forest is left out within NEAR m of a run.
Heights: the canopy map reads tall conifers low (median 9-14 m, against 15-30 m for real spruce and fir), so trees
over 8 m are spread onto the forest's 15-24 m; younger trees keep their mapped height.
Kinds follow the game's rules: snow ghosts high up, aspen where the forest map says aspen, spruce or fir by height.
Writes trees.npy: rows of x, z, height, kind (0 spruce, 1 fir, 2 aspen, 3 snow ghost), fill (1 for the packed fill, 0 for a
mapped tree top).
"""
import sys, numpy as np
from scipy import ndimage as ndi
from load import load_map, RM
import grid

NEAR = 25.0
GAP = 1.3            # m clear between two trees' circles: the skier (2 x 0.35 m) with a little room to steer
EDGE_GAP = 0.5       # m between a tree's circle and the run
FILL = 2.5           # m: spacing of the candidate spots where the map has canopy
TREE_R = np.array([0.11, 0.11, 0.07, 0.3])   # game.js: trunk-and-branches radius as a share of height


def hash2(i, j):
    i = np.asarray(i, np.int64) & 0xFFFFFFFF; j = np.asarray(j, np.int64) & 0xFFFFFFFF
    m = lambda a, b: (a * b) & 0xFFFFFFFF
    h = (m(i, 374761393) + m(j, 668265263)) & 0xFFFFFFFF
    h = m(h ^ (h >> 13), 1274126177); h ^= h >> 16
    return h / 4294967296.0


def main(d):
    meta, H, cov, _ = load_map()
    lab = np.load(f'{d}/labels.npy'); run = lab > 0
    near = ndi.distance_transform_edt(~run) * grid.PC <= NEAR          # 2 m cells within NEAR m of a run (or on it)
    C = np.load(RM + 'chm_1m.npy', mmap_mode='r')
    out = []
    B = 500                                                             # work in 1 km blocks of the 1 m map
    for r0 in range(0, C.shape[0], 2 * B):
        for c0 in range(0, C.shape[1], 2 * B):
            nr = near[r0 // 2:(r0 + 2 * B) // 2, c0 // 2:(c0 + 2 * B) // 2]
            if not nr.any(): continue
            pad = 4
            a0, b0 = max(0, r0 - pad), max(0, c0 - pad)
            c = np.asarray(C[a0:r0 + 2 * B + pad, b0:c0 + 2 * B + pad]).astype(np.float32)
            cs = ndi.gaussian_filter(c, 1.0)
            tops = (cs == ndi.maximum_filter(cs, size=5)) & (c >= 3)
            tall = (cs == ndi.maximum_filter(cs, size=7)) | (c < 15)        # wider crowns on tall trees
            tops &= tall
            rr, cc = np.nonzero(tops)
            R, Cc = rr + a0, cc + b0                                         # 1 m cells: x = Cc - 3985 + 0.5
            keep = (R >= r0) & (R < r0 + 2 * B) & (Cc >= c0) & (Cc < c0 + 2 * B)
            R, Cc, hh = R[keep], Cc[keep], c[rr[keep], cc[keep]]
            r2, c2 = np.minimum(R // 2, lab.shape[0] - 1), np.minimum(Cc // 2, lab.shape[1] - 1)
            keep = near[r2, c2] & ~run[r2, c2]
            R, Cc, hh = R[keep], Cc[keep], hh[keep]
            if not len(R): continue
            x = Cc - 3985.0 + 0.5; z = R - 8525.0 + 0.5
            out.append(np.stack([x, z, hh], 1))
    T = np.concatenate(out)
    ntops = len(T)
    # candidate spots wherever the map has canopy: a jittered grid, each with the crown top's height around it
    dist = ndi.distance_transform_edt(~run) * grid.PC
    c2 = np.zeros(lab.shape, np.uint8)
    for r0 in range(0, lab.shape[0], 500):
        blk = np.asarray(C[2 * r0:2 * (r0 + 500), :2 * lab.shape[1]])
        c2[r0:r0 + blk.shape[0] // 2] = blk.reshape(blk.shape[0] // 2, 2, lab.shape[1], 2).max(axis=(1, 3))
    top = ndi.maximum_filter(c2, size=3)                   # the crown's top height, not its sloping margin
    rr, cc = np.nonzero(~run & (dist <= NEAR) & (c2 >= 3))
    X, Z = grid.xz(rr, cc)
    gi, gj = np.floor((X + 4000) / FILL).astype(np.int64), np.floor((Z + 8600) / FILL).astype(np.int64)
    key = np.unique(gi * 100000 + gj); gi, gj = key // 100000, key % 100000
    xf = gi * FILL - 4000 + hash2(gi + 1013, gj) * FILL; zf = gj * FILL - 8600 + hash2(gi, gj + 1013) * FILL
    r_, c_ = np.round(grid.rc(xf, zf)).astype(int)
    ok = (r_ >= 0) & (r_ < lab.shape[0]) & (c_ >= 0) & (c_ < lab.shape[1])
    xf, zf, r_, c_ = xf[ok], zf[ok], r_[ok], c_[ok]
    ok = ~run[r_, c_] & (dist[r_, c_] <= NEAR) & (c2[r_, c_] >= 3)
    T = np.concatenate([T, np.stack([xf[ok], zf[ok], top[r_[ok], c_[ok]].astype(np.float32)], 1)])
    x, z, ch = T[:, 0], T[:, 1], T[:, 2]
    # forest map cell for aspen vs conifer, ground height for snow ghosts
    i = np.clip(np.round((x - meta['near']['x0']) / 10).astype(int), 0, meta['near']['nx'] - 1)
    j = np.clip(np.round((z - meta['near']['z0']) / 10).astype(int), 0, meta['near']['nz'] - 1)
    con, asp = (cov[j, i] & 15) / 15, ((cov[j, i] >> 4) & 7) / 7
    g = H[j, i]
    xi, zi = np.round(x * 2).astype(np.int64), np.round(z * 2).astype(np.int64)
    r1, r2 = hash2(xi + 31337, zi), hash2(xi, zi + 7919)
    kind = np.where(r2 < np.where(g < 3000, 0.7, np.where(g < 3350, 0.5, 0.3)), 0, 1)
    kind = np.where((asp > con) & (g < 3150) & (r1 < asp / (asp + con + 1e-6)), 2, kind)
    kind = np.where((g > 3380) & (r1 < 0.35), 3, kind)
    h = np.where(ch >= 8, 15 + 9 * np.clip((ch - 8) / 14, 0, 1) + (r1 - 0.5) * 2, ch * 1.15)
    h = np.where(kind == 2, np.minimum(h, 10 + 5 * np.clip((ch - 6) / 12, 0, 1)), h)
    h = np.where(kind == 3, 2.2 + 1.6 * np.clip(ch / 10, 0, 1), h)
    rad = TREE_R[kind] * h
    # off the run by the tree's circle, then packed: mapped tops first (tallest first), then the fill in a fixed
    # shuffled order, each kept only if it stays GAP clear of every tree already kept
    rc_ = np.round(grid.rc(x, z)).astype(int)
    clear = dist[np.clip(rc_[0], 0, lab.shape[0] - 1), np.clip(rc_[1], 0, lab.shape[1] - 1)] - grid.PC / 2 >= rad + EDGE_GAP
    idx = np.arange(len(T))
    order = np.concatenate([idx[:ntops][np.argsort(-h[:ntops])], idx[ntops:][np.argsort(hash2(xi[ntops:] + 77, zi[ntops:] + 99))]])
    order = order[clear[order]]
    CELLM = 7.0
    cells = {}
    keep = []
    for n in order:
        px, pz, pr = x[n], z[n], rad[n]
        ci, cj = int(px // CELLM), int(pz // CELLM)
        good = True
        for a_ in (ci - 1, ci, ci + 1):
            for b_ in (cj - 1, cj, cj + 1):
                for m_ in cells.get((a_, b_), ()):
                    need = pr + rad[m_] + GAP
                    if (px - x[m_]) ** 2 + (pz - z[m_]) ** 2 < need * need: good = False; break
                if not good: break
            if not good: break
        if good:
            cells.setdefault((ci, cj), []).append(n); keep.append(n)
    keep = np.array(sorted(keep))
    ntop_kept = int((keep < ntops).sum())
    x, z, h, kind = x[keep], z[keep], h[keep], kind[keep]
    T = np.stack([x, z, h, kind, keep >= ntops], 1).astype(np.float32)      # the last column: 1 for a fill tree
    np.save(f'{d}/trees.npy', T)
    print(f'{len(T)} edge trees within {NEAR:.0f} m of runs ({ntop_kept} of {ntops} mapped tops, {len(T) - ntop_kept} fill); kinds', np.bincount(kind.astype(int), minlength=4).tolist(),
          'height pct 10/50/90', np.percentile(h, [10, 50, 90]).round(1).tolist())


if __name__ == '__main__':
    main(sys.argv[1])

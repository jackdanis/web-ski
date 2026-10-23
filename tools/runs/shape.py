"""Shape the groomed snow of every run on the 2 m grid (Jack's choice 1: shape the area).

Inside each groomed outline the real hill is groomed rather than replaced:
- smoothed (SMOOTH m) so the 10 m mountain's small bumps go, while rolls and crowns on wide runs stay
- the side slope is flattened only where a run is narrow (70% kept up to WIDE0 m wide, all of it past WIDE1 m),
  and cat tracks are cut as a near-level bench (TRACK_KEEP)
- narrow runs and cat tracks get a long profile that keeps dropping (MIN_GRADE), cutting bumps and filling dips
- runs blend into each other at junctions (the changes are smoothed across run borders), and back into the
  mountain over BLEND m past the groomed edge
- what still can't drain is filled (up to FILL_CAP m) and tilted toward where it spills, so groomed snow never climbs
- a windrow berm just off every groomed edge
Writes shaped.npz: hp (physics heights), hr (mesh heights), edge (m to the groomed edge, negative inside), aedge (m to
the edge of any run, expert runs included), w (blend).
"""
import json, os, sys, numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from load import load_runs, load_kit_runs, RM, IN
import grid
from labels import drain_fill, lift_outlets, GAP

SMOOTH = 8.0                # m, sigma of the groomer's smoothing
JOIN = 6.0                  # m, sigma the changes are smoothed with across run borders
BLEND, BERM, BERM_W = 18.0, 0.35, 1.6
SIDE_KEEP, TRACK_KEEP, WIDE0, WIDE1 = 0.7, 0.1, 40.0, 90.0
MIN_GRADE, PROFILE_W0, PROFILE_W1 = 0.04, 45.0, 70.0
FILL_CAP, FILL_TILT = 3.0, 0.01
EDGE_SMOOTH = 1.5           # cells: rounds the 2 m staircase of the outline
SPLIT_RISE = 3.0            # m: a line whose tail climbs back more than this is split at its low point


def smoothstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


def gauss1(a, sigma):
    return ndi.gaussian_filter1d(np.asarray(a, float), sigma, mode='nearest')


def downhill_fit(h, s):
    """closest profile to h that keeps dropping at least MIN_GRADE (pool-adjacent violators), as in game.js"""
    blocks = []
    for v, si in zip(h, s):
        blocks.append([v + MIN_GRADE * si, 1])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            m2, n2 = blocks.pop(); b = blocks[-1]
            b[0] = (b[0] * b[1] + m2 * n2) / (b[1] + n2); b[1] += n2
    out = []
    for m, n in blocks:
        for _ in range(n): out.append(m - MIN_GRADE * s[len(out)])
    return np.array(out)


def dense_line(points):
    p = np.asarray(points, float)
    out = []
    for a, b in zip(p[:-1], p[1:]):
        n = max(1, int(round(np.hypot(*(b - a)) / grid.PC)))
        for k in range(n): out.append(a + (b - a) * k / n)
    out.append(p[-1]); out = np.array(out)
    return np.stack([gauss1(out[:, 0], 5), gauss1(out[:, 1], 5)], 1)


def sample(arr, x, z):
    r, c = grid.rc(x, z)
    return ndi.map_coordinates(arr, [np.atleast_1d(r), np.atleast_1d(c)], order=1, mode='nearest')


def main(d):
    h0 = np.load(f'{d}/h0.npy'); hm = np.load(f'{d}/hm.npy'); lab = np.load(f'{d}/labels.npy')
    runs = {r['i']: r for r in load_runs()}
    lines = load_kit_runs() + json.load(open(IN + 'extra_runs.json'))
    n = lab.max() + 1
    groomed_id = np.zeros(n, bool); cat_id = np.zeros(n, bool)
    for i, r in runs.items():
        groomed_id[i + 1] = r['difficulty'] != 'expert'; cat_id[i + 1] = r['cat_track']
    G = groomed_id[lab]
    # signed metres to the groomed edge, its staircase rounded off
    din = ndi.distance_transform_edt(G) * grid.PC; dout = ndi.distance_transform_edt(~G) * grid.PC
    edge = np.where(G, -(din - 1), dout - 1).astype(np.float32)
    edge = ndi.gaussian_filter(edge, EDGE_SMOOTH)
    # the same to the edge of any run, experts included: they are on the 2 m grid as natural snow (Jack's choice 7)
    A = lab > 0
    aedge = np.where(A, -(ndi.distance_transform_edt(A) * grid.PC - 1), ndi.distance_transform_edt(~A) * grid.PC - 1).astype(np.float32)
    aedge = ndi.gaussian_filter(aedge, EDGE_SMOOTH)
    # local width: twice the deepest point within 40 m
    T = 2 * ndi.maximum_filter(din, size=41)
    hs = ndi.gaussian_filter(h0, SMOOTH / grid.PC)
    delta = np.where(G, hs - h0, 0).astype(np.float32)
    stats = []
    # per run: bench across narrow parts, long profile along narrow runs and cat tracks. A run's line is split at its
    # low point when its tail climbs back up (A-Line's tail into Long Shot): each part is shaped downhill to that point.
    # Narrow trails mapped apart from the line (round 4: Slider, Eddy Out) are parts of their own.
    trails = json.load(open(RM + 'trails_round4.json')) if os.path.exists(RM + 'trails_round4.json') else {}
    for i, r in sorted(runs.items()):
        if not groomed_id[i + 1] or i >= len(lines) or len(lines[i]['points']) < 2: continue
        m = lab == i + 1
        if not m.any(): continue
        parts = []
        for pts in [lines[i]['points']] + ([trails[r['name']]] if r['name'] in trails else []):
            L = dense_line(pts)
            C = sample(hs, L[:, 0], L[:, 1])
            if C[0] < C[-1]: L, C = L[::-1], C[::-1]
            lo = int(np.argmin(C))
            if lo < len(L) - 1 and C[lo:].max() - C[lo] > SPLIT_RISE:
                parts += [L[:lo + 1], L[lo:][::-1]]
            else:
                parts.append(L)
        parts = [P for P in parts if len(P) >= 2]
        rr, cc = np.nonzero(m); X, Z = grid.xz(rr, cc)
        allp = np.concatenate(parts); pid = np.concatenate([np.full(len(P), n) for n, P in enumerate(parts)])
        _, near = cKDTree(allp).query(np.stack([X, Z], 1))
        owner = pid[near]
        Tc_all = T[rr, cc]
        bench_max, cut = 0.0, 0.0
        for n, L in enumerate(parts):
            sel = owner == n
            if not sel.any(): continue
            S = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(L, axis=0).T))])
            t = np.gradient(L, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
            nv = np.stack([t[:, 1], -t[:, 0]], 1)
            C = sample(hs, L[:, 0], L[:, 1])
            K = gauss1((sample(hs, L[:, 0] + nv[:, 0] * 12, L[:, 1] + nv[:, 1] * 12) - sample(hs, L[:, 0] - nv[:, 0] * 12, L[:, 1] - nv[:, 1] * 12)) / 24, 10)
            _, k = cKDTree(L).query(np.stack([X[sel], Z[sel]], 1))
            u = (X[sel] - L[k, 0]) * nv[k, 0] + (Z[sel] - L[k, 1]) * nv[k, 1]
            Tc = Tc_all[sel]
            keep = np.full(len(k), TRACK_KEEP) if cat_id[i + 1] else SIDE_KEEP + (1 - SIDE_KEEP) * smoothstep(WIDE0, WIDE1, Tc)
            bench = -(1 - keep) * K[k] * np.clip(u, -Tc / 2, Tc / 2)
            # long profile where the run is narrow: the line's stations decide it
            TL = sample(T.astype(np.float32), L[:, 0], L[:, 1])
            wl = np.ones(len(L)) if cat_id[i + 1] else 1 - smoothstep(PROFILE_W0, PROFILE_W1, gauss1(TL, 15))
            prof = np.zeros(len(L))
            if wl.max() > 0.01 and len(L) > 3:
                Gp = gauss1(downhill_fit(gauss1(C, 6), S), 4)
                prof = (Gp - C) * wl; cut = max(cut, float(np.abs(prof).max()))
            delta[rr[sel], cc[sel]] += (bench + prof[k]).astype(np.float32)
            bench_max = max(bench_max, float(np.abs(bench).max()))
        stats.append(dict(run=r['name'], i=i, parts=len(parts), bench=round(bench_max, 2), profile_cut=round(cut, 2)))
    # junctions: smooth the changes across run borders (groomed cells only), then carry them out over the blend
    wG = ndi.gaussian_filter(G.astype(np.float32), JOIN / grid.PC)
    dj = ndi.gaussian_filter(delta * G, JOIN / grid.PC) / np.maximum(wG, 1e-3)
    dj = np.where(G, dj, 0)
    _, (ir, ic) = ndi.distance_transform_edt(~G, return_indices=True)
    dj = dj[ir, ic]
    w = smoothstep(BERM_W, BLEND, edge).astype(np.float32)
    hp = (h0 + (1 - w) * dj).astype(np.float32)
    # nothing groomed climbs: fill what can't drain (all run snow and narrow tree gaps count as the way out)
    run = lab > 0
    dom = run | ndi.binary_closing(run, structure=np.ones((3, 3)), iterations=GAP // 4 + 1)
    depth, _ = drain_fill(hp, dom, lift_outlets(run.shape, dom, hp))
    fillm = G & (depth > 0.005) & (depth <= FILL_CAP)
    deep = G & (depth > FILL_CAP)
    fl, fn = ndi.label(fillm, structure=np.ones((3, 3)))
    tilt = np.zeros_like(hp)
    for k_, sl in enumerate(ndi.find_objects(fl)):
        sl = tuple(slice(max(0, s.start - 1), s.stop + 1) for s in sl)
        reg = fl[sl] == k_ + 1
        lip = ndi.binary_dilation(reg) & ~reg & dom[sl] & (depth[sl] <= 0.005)
        if not lip.any(): continue
        dist = ndi.distance_transform_edt(~lip) * grid.PC
        tilt[sl][reg] = FILL_TILT * dist[reg]
    hp = np.where(fillm, hp + depth + tilt, hp).astype(np.float32)
    # the windrow just off the corduroy
    berm = np.where((edge > 0) & (edge < BERM_W), BERM * np.sin(np.pi * np.clip(edge, 0, BERM_W) / BERM_W), 0)
    hp = (hp + berm).astype(np.float32)
    hr = (hp + w * (hm - h0)).astype(np.float32)
    np.savez(f'{d}/shaped.npz', hp=hp, hr=hr, edge=edge.astype(np.float32), aedge=aedge, w=w, G=G)
    json.dump(stats, open(f'{d}/shape_stats.json', 'w'), indent=0)
    print(f'groomed {G.sum() * 4 / 1e6:.2f} km2; filled {fillm.sum() * 4} m2 (max {float(depth[fillm].max()) if fillm.any() else 0:.2f} m); '
          f'still undrained deeper than {FILL_CAP} m: {deep.sum() * 4} m2; max change {float(np.abs(hp - h0)[w < 1].max()):.2f} m')
    big = sorted(stats, key=lambda s: -s['profile_cut'])[:12]
    print('largest profile cuts:', [(s['run'], s['profile_cut']) for s in big])


if __name__ == '__main__':
    main(sys.argv[1])

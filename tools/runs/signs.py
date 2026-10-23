"""Trail signs: one per named run, where it begins (Jack's choice 6).

A run begins where its mapped line, followed downhill, first reaches the run's own snow: at the lift top, or where
it splits from the run above. The sign stands just off the snow there, in the tip of the trees between the two runs
where there is one (the fork), otherwise at the run's own edge, turned to face skiers arriving from above.
Where a name has several pieces, the sign goes at the highest one's start.
Signs keep clear of trees, buildings, lift ends and each other. Up to three spots are kept per sign, best first, so the
game can skip one that lands on a station hut.
Writes signs.json: [{name, difficulty, spots: [[x, z, yaw in degrees, ground y], ...]}], highest start first.
"""
import json, sys, numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from load import load_runs, load_lifts, load_kit_runs, RM, IN
from shape import dense_line, sample, smoothstep, BERM_W, BLEND
import grid

REACH = 50.0       # m around the start a sign may stand
OFF = 1.2          # m past the edge of any run at least
TOUCH = 4.0        # m: within this of the run's snow
FORK = 5.0         # m: within this of another run's snow too, it is in the fork
AHEAD = 6.0        # m down the line from the start, the ideal spot
LIFT_CLEAR = 14.0  # m from a lift's end
SIGN_GAP = 8.0     # m between signs
CLEAR = 1.8        # m from the sign a tree's circle has to stay (half the widest board)
ON_SNOW = 20.0     # m a spot on the snow counts as further than one off it
DEBUG = '-v' in sys.argv
TREE_R = np.array([0.11, 0.11, 0.07, 0.3])


def main(d):
    lab = np.load(f'{d}/labels.npy', mmap_mode='r')
    S = np.load(f'{d}/shaped.npz'); hp, aedge = S['hp'], S['aedge']
    h0 = np.load(f'{d}/h0.npy', mmap_mode='r'); hm = np.load(f'{d}/hm.npy', mmap_mode='r'); bld = np.load(f'{d}/bld2m.npy', mmap_mode='r')
    T = np.load(f'{d}/trees.npy'); tk = cKDTree(T[:, :2]); trad = TREE_R[T[:, 3].astype(int)] * T[:, 2]
    ends = np.array([p for l in load_lifts() for p in (l['points'][0][:2], l['points'][-1][:2])])
    runs = {r['i']: r for r in load_runs()}
    lines = load_kit_runs() + json.load(open(IN + 'extra_runs.json'))
    hs = ndi.gaussian_filter(np.asarray(h0), 2)
    # where each named run begins, highest piece of a name first
    starts = {}
    for i, r in sorted(runs.items()):
        if not r['name'] or i >= len(lines) or len(lines[i]['points']) < 2: continue
        L = dense_line(lines[i]['points']); C = sample(hs, L[:, 0], L[:, 1])
        if C[0] < C[-1]: L, C = L[::-1], C[::-1]
        rr, cc = np.round(grid.rc(L[:, 0], L[:, 1])).astype(int)
        ok = (rr >= 0) & (rr < lab.shape[0]) & (cc >= 0) & (cc < lab.shape[1])
        own = np.zeros(len(L), bool); own[ok] = lab[rr[ok], cc[ok]] == i + 1
        # where the line stays on the run's own snow for 10 m (not a stray cell of it further up)
        held = np.convolve(own, np.ones(5), 'full')[4:] >= 5 if len(own) >= 5 else own
        if not held.any(): held = own
        if not held.any(): continue
        k0 = int(np.argmax(held)); k1 = min(len(L) - 1, k0 + 12)
        D = L[k1] - L[k0]; D /= np.linalg.norm(D) + 1e-9
        if r['name'] not in starts or C[k0] > starts[r['name']]['h']:
            starts[r['name']] = dict(i=i, p=L[k0], D=D, h=float(C[k0]), run=r)
    out, placed, kinds = [], [], {'fork': 0, 'edge': 0, 'snow': 0, 'none': 0}
    pad = int(REACH / grid.PC) + 4
    for name, st in sorted(starts.items(), key=lambda kv: -kv[1]['h']):
        i, (px, pz), D = st['i'], st['p'], st['D']
        r, c = np.round(grid.rc(px, pz)).astype(int)
        sl = (slice(max(0, r - pad), r + pad + 1), slice(max(0, c - pad), c + pad + 1))
        L_ = np.asarray(lab[sl]); A = np.asarray(aedge[sl])
        d_own = ndi.distance_transform_edt(L_ != i + 1) * grid.PC
        d_oth = ndi.distance_transform_edt(~((L_ > 0) & (L_ != i + 1))) * grid.PC
        b = ndi.binary_dilation(np.asarray(bld[sl]) > 0, iterations=1)
        # just off the snow beside the run (in the fork if there is one), or where there is no edge near (open snow),
        # on the border with the run it splits from
        off = (A >= OFF) & (d_own <= TOUCH) & ~b
        split = (L_ == i + 1) & (d_oth <= 2.5) & ~b
        cand = off | split
        Xg, Zg = grid.xz(np.arange(L_.shape[0])[:, None] + sl[0].start, np.arange(L_.shape[1])[None, :] + sl[1].start)
        ideal = np.hypot(Xg - px - AHEAD * D[0], Zg - pz - AHEAD * D[1]) <= REACH
        if not (cand & ideal).any(): cand = (L_ == i + 1) & ~b       # nothing beside it: on its own snow at the start
        rr, cc = np.nonzero(cand)
        X, Z = grid.xz(rr + sl[0].start, cc + sl[1].start)
        dist = np.hypot(X - px - AHEAD * D[0], Z - pz - AHEAD * D[1])
        fork = d_oth[rr, cc] <= FORK
        on_snow = ~off[rr, cc]
        keep = dist <= REACH
        keep &= np.min(np.hypot(X[:, None] - ends[None, :, 0], Z[:, None] - ends[None, :, 1]), axis=1) > LIFT_CLEAR
        if placed: keep &= cKDTree(placed).query(np.stack([X, Z], 1))[0] > SIGN_GAP
        if not keep.any():
            kinds['none'] += 1
            if DEBUG: print(name, 'NO SPOT', round(px), round(pz), len(X), int((dist <= REACH).sum()), int((np.min(np.hypot(X[:, None] - ends[None, :, 0], Z[:, None] - ends[None, :, 1]), axis=1) > LIFT_CLEAR).sum()), round(float(dist.min()), 1) if len(X) else None)
            continue
        # trees the board would stand in are taken out (export.py): a few cost a little, a thicket a lot
        ntree = np.zeros(len(X))
        for n in np.nonzero(keep)[0]:
            near = tk.query_ball_point([X[n], Z[n]], 6.0)
            if near: ntree[n] = np.count_nonzero(np.hypot(T[near, 0] - X[n], T[near, 1] - Z[n]) < trad[near] + CLEAR)
        score = dist - 8.0 * fork + 3.0 * ntree + ON_SNOW * on_snow
        order = np.nonzero(keep)[0][np.argsort(score[keep])]
        if DEBUG:
            ko = keep & ~on_snow
            bo = np.nonzero(ko)[0][np.argsort(score[ko])][:1]
            print(name, 'best off', [(round(dist[n]), int(ntree[n]), bool(fork[n])) for n in bo], 'best', round(dist[order[0]]), int(ntree[order[0]]), bool(on_snow[order[0]]))
        spots = []
        for n in order:
            if any(np.hypot(X[n] - s[0], Z[n] - s[1]) < 4 for s in spots): continue
            # face skiers arriving: toward a point up the line from the start
            fx, fz = px - 25 * D[0] - X[n], pz - 25 * D[1] - Z[n]
            yaw = np.degrees(np.arctan2(fx, fz))
            rc = grid.rc(np.array([X[n]]), np.array([Z[n]]))
            w = smoothstep(BERM_W, BLEND, ndi.map_coordinates(aedge, rc, order=1))
            y = ndi.map_coordinates(hp, rc, order=1) + w * (ndi.map_coordinates(hm, rc, order=1) - ndi.map_coordinates(h0, rc, order=1))
            spots.append([round(float(X[n]), 1), round(float(Z[n]), 1), round(float(yaw), 1), round(float(y[0]), 2)])
            if len(spots) == 3: break
        n0 = order[0]
        kinds['snow' if on_snow[n0] else 'fork' if fork[n0] else 'edge'] += 1
        placed.append(spots[0][:2])
        out.append(dict(name=name, difficulty=st['run']['difficulty'], spots=spots))
    json.dump(out, open(f'{d}/signs.json', 'w'))
    print(f'{len(out)} signs of {len(starts)} named runs: {kinds["fork"]} in a fork, {kinds["edge"]} at a run edge, {kinds["snow"]} on open snow at the split, {kinds["none"]} with no spot')


if __name__ == '__main__':
    main(sys.argv[1])

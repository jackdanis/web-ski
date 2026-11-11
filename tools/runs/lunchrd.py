"""Lunchline (Upper) as a road along the park fence (Jack's laser notes batch 6 pin 4; inputs/lunchline_road.json).

The sidehill is cut into a road: a band `half` m either side of the line keeps only `keep` of the hill's sideways tilt
(not dead flat), the uphill side rises from the road's edge as a cut bank, and the downhill side falls back to the hill
as a fill. The bank is steep where the cut is shallow and eases off as the cut gets deeper (Jack: "as the height
difference increases, make it a more gradual and less steep change"). Both meet the hill on a soft corner, and the road
eases in and out over `ends` m. Only the snow moves: the edge trees keep their places (Jack: keep all existing trees).
"""
import json, numpy as np
from scipy import ndimage as ndi
from shape import smoothstep
from woodrd import dense, seg_frame
from load import IN
import grid


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def apply(hp):
    R_ = json.load(open(IN + 'lunchline_road.json'))
    L = dense(R_['line'], 1.0); half, keep, B = R_['half'], R_['keep'], R_['bank']
    S = np.r_[0, np.cumsum(np.hypot(*np.diff(L, axis=0).T))]
    t = np.gradient(L, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True)
    nv = np.stack([t[:, 1], -t[:, 0]], 1)                       # seg_frame's + across side
    hs = ndi.gaussian_filter(hp, 1.5)
    at = lambda x, z: ndi.map_coordinates(hs, grid.rc(np.atleast_1d(x), np.atleast_1d(z)), order=1, mode='nearest')
    g1 = lambda a, s: ndi.gaussian_filter1d(a, s, mode='nearest')
    C = g1(at(L[:, 0], L[:, 1]), 5)
    K = g1((at(L[:, 0] + nv[:, 0] * 8, L[:, 1] + nv[:, 1] * 8) - at(L[:, 0] - nv[:, 0] * 8, L[:, 1] - nv[:, 1] * 8)) / 16, 8)   # rise per m toward +across
    pad = half + 30
    x0, x1 = L[:, 0].min() - pad, L[:, 0].max() + pad; z0, z1 = L[:, 1].min() - pad, L[:, 1].max() + pad
    r0, c0 = [int(v) for v in grid.rc(x0, z0)]; r1, c1 = [int(v) + 1 for v in grid.rc(x1, z1)]
    Rr, Cc = np.mgrid[r0:r1, c0:c1]; X, Z = grid.xz(Rr, Cc)
    along, u, dist = [a.reshape(X.shape) for a in seg_frame(L, X.ravel(), Z.ravel())]
    k = np.clip(np.searchsorted(S, along), 0, len(S) - 1)
    Ck, Kk = C[k], K[k]
    h = hp[r0:r1, c0:c1].astype(np.float64)
    road = Ck + keep * Kk * np.clip(u, -half, half)              # the road, carried flat-ish out to its edges
    e = np.maximum(0, np.abs(u) - half)
    up = np.sign(u) == np.sign(Kk)
    # the cut at the road's uphill edge: how far the hill stands above the road there
    cut = (1 - keep) * np.abs(Kk) * half
    sb = B['steep'] + (B['gentle'] - B['steep']) * smoothstep(B['d0'], B['d1'], cut)
    bank = road + np.where(up, 1, -1) * e * np.where(up, sb, R_['fill'])
    new = np.where(up, smin(h, bank, 0.8), -smin(-h, -bank, 0.8))
    new = np.where(dist <= half, road, new)
    # only within reach of the line, eased in and out along it
    w = smoothstep(0, R_['ends'], along) * smoothstep(0, R_['ends'], S[-1] - along) * (1 - smoothstep(half + 22, half + 28, dist))
    d = (new - h) * w
    d = ndi.gaussian_filter(d, 0.8)
    out = hp.copy(); out[r0:r1, c0:c1] = (h + d).astype(np.float32)
    print(f'lunchline road: {S[-1]:.0f} m, tilt kept {keep}, cut up to {float(np.maximum(0, -d).max()):.2f} m, fill up to {float(np.maximum(0, d).max()):.2f} m')
    return out

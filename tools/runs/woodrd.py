"""Wood Rd and its ski bridge at the Elk Camp Gondola (Jack 2026-10-22; inputs/wood_rd.json).

The road is cut into the snow under the bridge: CUT m deep for CUT_LEN m along the road each side of the crossing,
easing out over CUT_RAMP m, with banks BANK m wide, so the deck (which keeps the snow's height from before the cut)
clears the road. The game gets:
- bridges: [[x, z, y, g, ...] deck centreline every 1 m (y = deck top, g = cut snow under it), half width, thickness,
  index of the point over the road, half the arch's span]
- roads: [[x, z, y, ...] centreline every 2 m on the cut snow, half width]
"""
import json, numpy as np
from scipy import ndimage as ndi
from shape import smoothstep, BERM_W, BLEND
from load import IN
import grid


def dense(pts, step):
    P = np.asarray(pts, float); out = [P[0]]
    for a, b in zip(P[:-1], P[1:]):
        n = max(1, int(np.ceil(np.hypot(*(b - a)) / step))); out += list(a + (b - a) * (np.arange(1, n + 1) / n)[:, None])
    return np.array(out)


def seg_frame(L, x, z):
    """per point: distance along L, signed distance across it (nearest segment)"""
    S = np.r_[0, np.cumsum(np.hypot(*np.diff(L, axis=0).T))]
    best = np.full(x.shape, 1e9); along = np.zeros(x.shape); across = np.zeros(x.shape)
    for k in range(len(L) - 1):
        a, b = L[k], L[k + 1]; d = b - a; ln = np.hypot(*d); t = np.clip(((x - a[0]) * d[0] + (z - a[1]) * d[1]) / ln ** 2, 0, 1)
        px, pz = a[0] + t * d[0], a[1] + t * d[1]; dist = np.hypot(x - px, z - pz)
        m = dist < best; best[m] = dist[m]; along[m] = S[k] + t[m] * ln
        across[m] = ((x - a[0]) * d[1] - (z - a[1]) * d[0])[m] / ln
    return along, across, best


def apply(d, hp, h0, aedge):
    W = json.load(open(IN + 'wood_rd.json'))
    hm = np.load(f'{d}/hm.npy', mmap_mode='r')
    def drawn(h, x, z):
        r_, c_ = grid.rc(np.atleast_1d(x), np.atleast_1d(z)); rc_ = [r_, c_]
        w = smoothstep(BERM_W, BLEND, ndi.map_coordinates(aedge, rc_, order=1, mode='nearest'))
        return ndi.map_coordinates(h, rc_, order=1, mode='nearest') + w * (ndi.map_coordinates(hm, rc_, order=1, mode='nearest') - ndi.map_coordinates(h0, rc_, order=1, mode='nearest'))
    road = dense(W['road'], 1.0); deck = dense(W['bridge'], 1.0)
    # where the deck crosses the road
    ra, rx, rd = seg_frame(road, deck[:, 0], deck[:, 1]); kx = int(np.argmin(rd)); s_x = ra[kx]
    # deck: the snow as drawn before the cut, smoothed along it
    ydeck = ndi.gaussian_filter1d(drawn(hp, deck[:, 0], deck[:, 1]), 2.0, mode='nearest') + 0.05
    # road starts road_start_before m west of the crossing
    road = road[road_S(road) >= s_x - W['road_start_before']]
    # cut
    half = W['road_w'] / 2 + 1.5
    x0, x1 = road[:, 0].min() - 20, road[:, 0].max() + 20; z0, z1 = road[:, 1].min() - 20, road[:, 1].max() + 20
    r0, c0 = [int(v) for v in grid.rc(x0, z0)]; r1, c1 = [int(v) + 1 for v in grid.rc(x1, z1)]
    R, C = np.mgrid[r0:r1, c0:c1]; X, Z = grid.xz(R, C)
    along, across, dist = seg_frame(road, X.ravel(), Z.ravel())
    along = along.reshape(X.shape) + (s_x - W['road_start_before']); dist = dist.reshape(X.shape)
    wa = 1 - smoothstep(W['cut_len'], W['cut_len'] + W['cut_ramp'], np.abs(along - s_x))
    wc = 1 - smoothstep(half, half + W['bank'], dist)
    cut = W['cut'] * wa * wc
    hp = hp.copy(); hp[r0:r1, c0:c1] -= cut.astype(np.float32)
    # road on the cut snow
    R2 = dense(road, 2.0); yr = drawn(hp, R2[:, 0], R2[:, 1]) + 0.04
    yroad_x = float(drawn(hp, deck[kx:kx + 1, 0], deck[kx:kx + 1, 1])[0])
    print(f'wood rd: deck {len(deck)} m, crossing at {deck[kx].round(1).tolist()}, deck top {ydeck[kx]:.2f}, road {yroad_x:.2f}, '
          f'clear {ydeck[kx] - W["deck_t"] - yroad_x:.2f} m; road {len(R2) * 2} m, cut {float(cut.max()):.2f} m max')
    gdeck = drawn(hp, deck[:, 0], deck[:, 1])          # the cut snow under the deck's centre
    bridges = [[[round(float(v), 2) for p, y, g in zip(deck, ydeck, gdeck) for v in (p[0], p[1], y, g)], W['deck_w'] / 2, W['deck_t'], kx, W['road_w'] / 2 + 1.5]]
    roads = [[[round(float(v), 2) for p, y in zip(R2, yr) for v in (p[0], p[1], y)], W['road_w'] / 2]]
    return hp, bridges, roads


def road_S(L):
    return np.r_[0, np.cumsum(np.hypot(*np.diff(L, axis=0).T))]

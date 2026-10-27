"""Clean the traced run owner raster for the game.

1. drop specks (pieces of a run under 100 m2 cut off from the rest of it)
2. carry cat tracks across the expert runs they cross (the trace gives the crossing to the expert run, which
   left the track's groomed snow broken where it meets a glade). Runs keep stopping short of buildings: each
   footprint gets a stand-in block in the game (Jack's choice 4).
3. trim pockets: run snow that can only drain by climbing more than TRIM m (the trace grew over ridges and ribs);
   it becomes off-piste snow. Narrow tracks and runs whose mapped line climbs are left for the line fit instead.
Writes labels.npy (int16, 0 = no run) and pockets.json.
"""
import json, sys, numpy as np, cv2
from scipy import ndimage as ndi
from skimage.morphology import reconstruction
from load import load_owner, load_runs, load_lifts, load_kit_runs, fill_mask, RM, IN
import grid

TRIM = 3.0        # m: deeper pockets come off the run
GAP = 10          # m: tree bands up to this wide count as passable when judging where snow drains
LINE_FIX = {"Funnel Bypass", "Trestle", "Possible", "Green Cabin (Upper)", "Rock Island", "A-Line"}


def lift_outlets(shape, dom, h0, radius=20):
    seed = np.full(shape, 1e4, np.float32)
    for l in load_lifts():
        p = l['points']; lo = p[0] if p[0][2] < p[-1][2] else p[-1]
        r, c = grid.rc(lo[0], lo[1]); r, c = int(round(float(r))), int(round(float(c)))
        rr, cc = np.ogrid[-radius:radius + 1, -radius:radius + 1]; m = rr * rr + cc * cc <= radius * radius
        sl = (slice(r - radius, r + radius + 1), slice(c - radius, c + radius + 1))
        seed[sl] = np.where(m & dom[sl], h0[sl], seed[sl])
    return seed


def drain_fill(h, dom, seed):
    """lowest level each domain point must be raised to so that it drains to an outlet"""
    mask = np.where(dom, h, 1e4).astype(np.float32)
    f = reconstruction(np.minimum(seed, 1e4), mask, method='erosion')
    return np.where(dom & (f < 9e3), f - h, 0).astype(np.float32), dom & (f >= 9e3)


def main(out_dir):
    O = np.asarray(load_owner()).astype(np.int16)
    runs = {r['i']: r for r in load_runs()}
    h0 = np.load(f'{out_dir}/h0.npy')
    lab = O.copy()
    # extra lines marked paint (no traced outline) get their width (and ring, if any) painted where no run is; forest fills are not run
    from shape import dense_line
    lines = load_kit_runs() + json.load(open(IN + 'extra_runs.json'))
    for i, ln in enumerate(lines):
        if not ln.get('paint'): continue
        L = dense_line(ln['points']); half = ln['width'] / 2
        rr, cc = np.round(grid.rc(L[:, 0], L[:, 1])).astype(int); pad = int(half / grid.PC) + 2
        r0, c0 = max(0, rr.min() - pad), max(0, cc.min() - pad)
        sl = (slice(r0, rr.max() + pad + 1), slice(c0, cc.max() + pad + 1))
        on = np.zeros(lab[sl].shape, bool); on[rr - r0, cc - c0] = True
        lab[sl][(ndi.distance_transform_edt(~on) * grid.PC <= half) & (lab[sl] == 0)] = i + 1
        if ln.get('ring'):                                              # and a painted area, where one is given
            m = np.zeros(lab.shape, np.uint8); r_, c_ = grid.rc(*np.asarray(ln['ring'], float).T)
            cv2.fillPoly(m, [np.round(np.stack([c_, r_], 1)).astype(np.int32)], 1)
            lab[(m > 0) & (lab == 0)] = i + 1
    lab[fill_mask(lab.shape)] = 0
    # 1. specks
    nspeck = 0
    for i in np.unique(lab[lab > 0]):
        m = lab == i
        cl, n = ndi.label(m, structure=np.ones((3, 3)))
        if n > 1:
            sizes = ndi.sum(m, cl, range(1, n + 1))
            small = np.isin(cl, 1 + np.nonzero(sizes * 4 < 100)[0])
            lab[small] = 0; nspeck += int(small.sum())
    # cat tracks across expert runs: expert snow within half the track's width of its line becomes track
    from shape import dense_line
    lines = load_kit_runs() + json.load(open(IN + 'extra_runs.json'))
    expert = np.zeros(max(lab.max(), len(lines)) + 1, bool)
    for i, r in runs.items(): expert[i + 1] = r['difficulty'] == 'expert'
    ncross = 0
    for i, r in runs.items():
        if not r['cat_track'] or i >= len(lines) or len(lines[i]['points']) < 2: continue
        L = dense_line(lines[i]['points']); half = max(8.0, (r['mean_width_m'] or 16) / 2)
        rr, cc = np.round(grid.rc(L[:, 0], L[:, 1])).astype(int); pad = int(half / grid.PC) + 2
        r0, c0 = max(0, rr.min() - pad), max(0, cc.min() - pad)
        sl = (slice(r0, rr.max() + pad + 1), slice(c0, cc.max() + pad + 1))
        on = np.zeros(lab[sl].shape, bool); on[rr - r0, cc - c0] = True
        near = ndi.distance_transform_edt(~on) * grid.PC <= half
        m = near & expert[lab[sl]]
        lab[sl][m] = i + 1; ncross += int(m.sum())
    # 3. pockets
    run = lab > 0
    dom = run | ndi.binary_closing(run, structure=np.ones((3, 3)), iterations=GAP // 4 + 1)
    depth, unreached = drain_fill(h0, dom, lift_outlets(run.shape, dom, h0))
    keep_names = np.zeros(lab.max() + 1, bool)
    for i, r in runs.items():
        # batch 2 laser-note paths and areas were placed by hand on ground checked to drain
        keep_names[i + 1] = r['cat_track'] or r['name'] in LINE_FIX or r['osm'] == 'jack-laser-2026-10-27'
    trim = run & (depth > TRIM) & ~keep_names[lab]
    pockets = []
    pl, pn = ndi.label(trim, structure=np.ones((3, 3)))
    for k, sl in enumerate(ndi.find_objects(pl)):
        m = pl[sl] == k + 1; rr, cc = np.nonzero(m); d = depth[sl][m]
        o = np.bincount(lab[sl][m]).argmax() - 1
        x, z = grid.xz(sl[0].start + rr[d.argmax()], sl[1].start + cc[d.argmax()])
        pockets.append(dict(run=runs[o]['name'], i=int(o), depth=round(float(d.max()), 1), area=int(m.sum() * 4), x=round(float(x)), z=round(float(z))))
    lab[trim] = 0
    # what is left after trimming may leave specks again
    for i in np.unique(lab[lab > 0]):
        m = lab == i
        cl, n = ndi.label(m, structure=np.ones((3, 3)))
        if n > 1:
            sizes = ndi.sum(m, cl, range(1, n + 1))
            small = np.isin(cl, 1 + np.nonzero(sizes * 4 < 100)[0])
            lab[small] = 0
    lab[fill_mask(lab.shape)] = 0
    np.save(f'{out_dir}/labels.npy', lab)
    json.dump(sorted(pockets, key=lambda p: -p['depth']), open(f'{out_dir}/pockets.json', 'w'), indent=0)
    print(f'specks {nspeck * 4} m2, cat tracks across experts {ncross * 4} m2, pockets trimmed {len(pockets)} ({int(trim.sum()) * 4} m2), '
          f'unreached {int((unreached & run).sum()) * 4} m2, run area {int((lab > 0).sum()) * 4 / 1e6:.2f} km2')


if __name__ == '__main__':
    main(sys.argv[1])

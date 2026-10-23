"""Pack the shaped runs for game.js: runs.js with RUN_DATA = { tiles, chunks, trees, area, runf, blocks }, and the
run tiles themselves in runs/<ca>_<cj>.json, one file per CHUNK x CHUNK tiles (512 m), which the game loads by
distance (Jack's choice 8).

- tiles: the 128 m tiles (64 x 64 points of the 2 m grid) the groomed snow reaches, as [a0, j0] point offsets from
  the grid origin. Each chunk file holds its tiles ([a0, j0, ...]) and data (v 3), for every point of every tile in
  order: the shaped height's change from the 10 m
  mountain's smooth surface (hp - h0) in mm as int16 steps along each row, then the signed distance to the groomed
  edge and to the edge of any run (expert runs included) in EDGE_STEP m as int8 (clipped at 19 m, past the blend).
  The game adds the change back onto its own smooth surface, and works out the blend weight and the mesh heights
  (hr = hp + w (mesh - smooth)) from the distance to any run, so expert runs show the smooth 2 m surface too.
- trees: the run-edge trees (trees.py), int16 x, z in half metres, uint8 height in 10 cm, uint8 kind (+128 for the packed
  fill, which the game draws only near the camera), uint16 ground
  height in 10 cm (the shaped snow as the mesh draws it, so trees stand right before their tiles load). Trees a
  trail sign would stand in are left out.
- dh: the shaped height's change on the 10 m grid (cm, int16), which the game adds to its 10 m ground wherever no
  tiles are loaded, so what is built at load (lift towers, stations) stands on the shaped snow to within a few cm.
- signs: one per named run where it begins (signs.py), [name, difficulty, [[x, z, yaw in degrees, ground y], ...]],
  the spots best first.
- ropes: the rope lines kept from kit v18 at the tops of Sunnyside and Max Park (source-data/runs/ropes.json), one
  [x, z, ground y, x, z, ground y, ...] list of pole spots per line.
- area: signed metres to the nearest run of any kind on the 10 m grid, in half metres (int8), for the game's own
  forest to stay clear of the runs and their edge trees.
- runf: the same to the groomed edge, which the 10 m ground draws the runs with wherever no tiles are loaded.
- blocks: plain stand-in blocks for the buildings (Jack's choice 4) until real ones are made: each footprint's
  smallest enclosing rectangle as [x, z, width, length, yaw in degrees, height, ground low, ground high] (ground
  under the footprint, shaped). Heights are a guess from the
  footprint (5 m plus a quarter of its square root, 6 to 16 m); the footprints carry no heights.
"""
import base64, json, os, sys, zlib, numpy as np, cv2
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from load import load_map, load_runs, RM, IN
from shape import smoothstep, BERM_W, BLEND
from signs import CLEAR, TREE_R
import grid

TILE = 64
KEEP = 24.0          # m past a run's edge a tile still has to reach to be kept (BLEND + 6)
CHUNK = 4            # tiles a side in each file the game loads
EDGE_STEP = 0.15     # m per int8 step of the edge field


def enc_tiles(dh, edges, tiles):
    """dh and the edge fields: (NZP, NXP) arrays padded to whole tiles; returns the v 2 bytes and the largest step"""
    T = len(tiles)
    q = np.stack([np.round(dh[j0:j0 + TILE, a0:a0 + TILE].astype(np.float64) * 1000).astype(np.int64) for a0, j0 in tiles])
    d = np.diff(q, axis=2, prepend=0)
    worst = int(np.abs(d).max())
    assert worst < 32768, worst
    out = d.astype('<i2').tobytes()
    for edge in edges:
        e = np.stack([edge[j0:j0 + TILE, a0:a0 + TILE] for a0, j0 in tiles])
        out += np.clip(np.round(e / EDGE_STEP), -127, 127).astype(np.int8).tobytes()
    return out, worst


def main(d):
    meta, H, cov, _ = load_map()
    S = np.load(f'{d}/shaped.npz'); hp, edge, aedge = S['hp'], S['edge'], S['aedge']
    h0 = np.load(f'{d}/h0.npy')
    import woodrd
    hp, bridges, roads = woodrd.apply(d, hp, h0, aedge) if os.path.exists(IN + 'wood_rd.json') else (hp, [], [])
    nz, nx = hp.shape
    tz, tx = -(-nz // TILE), -(-nx // TILE)
    pad = lambda a, v: np.pad(a, ((0, tz * TILE - nz), (0, tx * TILE - nx)), constant_values=v)
    dh_, edge_, aedge_ = pad(hp - h0, 0), pad(edge, 60), pad(aedge, 60)
    need = (aedge_ < KEEP).reshape(tz, TILE, tx, TILE).any(axis=(1, 3))
    tiles = [(int(a * TILE), int(j * TILE)) for j, a in zip(*np.nonzero(need))]
    os.makedirs(f'{d}/runs', exist_ok=True)
    for f in os.listdir(f'{d}/runs'): os.remove(f'{d}/runs/{f}')
    by = {}
    for t in tiles: by.setdefault((t[0] // (TILE * CHUNK), t[1] // (TILE * CHUNK)), []).append(t)
    chunks, worst, size = [], 0, 0
    for (ca, cj), ts in sorted(by.items()):
        raw, w_ = enc_tiles(dh_, [edge_, aedge_], ts); worst = max(worst, w_)
        body = json.dumps(dict(tiles=[v for t in ts for v in t], data=base64.b64encode(zlib.compress(raw, 9)).decode()), separators=(',', ':'))
        open(f'{d}/runs/{ca}_{cj}.json', 'w').write(body); size += len(body)
        chunks.append([ca, cj, len(ts)])
    # edge trees, less the ones a sign stands in
    T = np.load(f'{d}/trees.npy')
    hm = np.load(f'{d}/hm.npy', mmap_mode='r')
    signs = json.load(open(f'{d}/signs.json'))
    spots = np.array([p[:2] for s_ in signs for p in s_['spots']])
    if len(spots):
        gone = cKDTree(spots).query(T[:, :2])[0] < TREE_R[T[:, 3].astype(int)] * T[:, 2] + CLEAR
        T = T[~gone]
    # the village (Jack's 4a): no trees inside it, and the game's own forest kept out by marking it as run area below
    zone = np.asarray(json.load(open(IN + 'village_zone.json'))['ring'] if os.path.exists(IN + 'village_zone.json') else [[-1e6, -1e6], [-1e6, -1e6 + 1], [-1e6 + 1, -1e6]], np.float32)
    in_zone = lambda x, z: np.array([cv2.pointPolygonTest(zone, (float(a), float(b)), False) >= 0 for a, b in zip(np.ravel(x), np.ravel(z))]).reshape(np.shape(x))
    zx0, zz0 = zone.min(0); zx1, zz1 = zone.max(0)
    near_zone = (T[:, 0] >= zx0) & (T[:, 0] <= zx1) & (T[:, 1] >= zz0) & (T[:, 1] <= zz1)
    drop = np.zeros(len(T), bool); drop[near_zone] = in_zone(T[near_zone, 0], T[near_zone, 1])
    T = T[~drop]
    # nothing standing on Wood Rd or the bridge deck
    for pts, n, hw in [(r[0], 3, r[1] + 1.5) for r in roads] + [(b[0], 4, b[1] + 1.0) for b in bridges]:
        P = np.asarray(pts).reshape(-1, n)[:, :2]
        if n == 4:                                  # and the way on and off the deck, 15 m past each end
            e0 = (P[0] - P[3]) / np.linalg.norm(P[0] - P[3]); e1 = (P[-1] - P[-4]) / np.linalg.norm(P[-1] - P[-4])
            P = np.vstack([P[0] + e0 * np.arange(15, 0, -1)[:, None], P, P[-1] + e1 * np.arange(1, 16)[:, None]])
        T = T[cKDTree(P).query(T[:, :2])[0] > hw]
    def at(x, z):                                   # the shaped ground (bilinear on the 2 m grid)
        r_, c_ = grid.rc(np.atleast_1d(x), np.atleast_1d(z))
        return ndi.map_coordinates(hp, [r_, c_], order=1, mode='nearest')
    def drawn(x, z):                                # the snow as the mesh draws it: hp + w (mesh - smooth)
        r_, c_ = grid.rc(np.atleast_1d(x), np.atleast_1d(z)); rc_ = [r_, c_]
        w = smoothstep(BERM_W, BLEND, ndi.map_coordinates(aedge, rc_, order=1, mode='nearest'))
        return ndi.map_coordinates(hp, rc_, order=1, mode='nearest') + w * (ndi.map_coordinates(hm, rc_, order=1, mode='nearest') - ndi.map_coordinates(h0, rc_, order=1, mode='nearest'))
    tr = np.zeros(len(T), dtype=[('x', '<i2'), ('z', '<i2'), ('h', 'u1'), ('k', 'u1'), ('y', '<u2')])
    tr['x'] = np.round(T[:, 0] * 2); tr['z'] = np.round(T[:, 1] * 2); tr['h'] = np.clip(np.round(T[:, 2] * 10), 0, 255); tr['k'] = T[:, 3].astype(int) | (T[:, 4].astype(int) << 7)
    tr['y'] = np.round(drawn(T[:, 0], T[:, 1]) * 10)
    trees = base64.b64encode(zlib.compress(tr.tobytes(), 9)).decode()
    # 10 m run area field
    lab = np.load(f'{d}/labels.npy'); run = lab > 0
    sd = (ndi.distance_transform_edt(~run) - ndi.distance_transform_edt(run)) * grid.PC
    m = meta['near']
    X = m['x0'] + 10 * np.arange(m['nx']); Z = m['z0'] + 10 * np.arange(m['nz'])
    r, c = grid.rc(X[None, :], Z[:, None])
    a = ndi.map_coordinates(sd.astype(np.float32), [np.broadcast_to(r, (m['nz'], m['nx'])).ravel(), np.broadcast_to(c, (m['nz'], m['nx'])).ravel()], order=1, mode='nearest')
    area = np.clip(np.round(a * 2), -127, 127).astype(np.int8)
    XX, ZZ = np.meshgrid(X, Z); zb = (XX >= zx0 - 10) & (XX <= zx1 + 10) & (ZZ >= zz0 - 10) & (ZZ <= zz1 + 10)
    area.reshape(m['nz'], m['nx'])[zb] = np.where(in_zone(XX[zb], ZZ[zb]), -127, area.reshape(m['nz'], m['nx'])[zb])
    area_b = base64.b64encode(zlib.compress(area.tobytes(), 9)).decode()
    rows, cols = np.broadcast_to(r, (m['nz'], m['nx'])).ravel(), np.broadcast_to(c, (m['nz'], m['nx'])).ravel()
    e10 = ndi.map_coordinates(edge.astype(np.float32), [rows, cols], order=1, mode='nearest', cval=60)
    inside = (rows >= 0) & (rows <= nz - 1) & (cols >= 0) & (cols <= nx - 1)
    runf = np.where(inside, np.clip(np.round(e10 * 2), -127, 127), 127).astype(np.int8)
    runf_b = base64.b64encode(zlib.compress(runf.tobytes(), 9)).decode()
    dh10 = ndi.map_coordinates((hp - h0).astype(np.float32), [rows, cols], order=1, mode='nearest')
    dh10 = np.where(inside, np.clip(np.round(dh10 * 100), -32767, 32767), 0).astype('<i2')
    dh_b = base64.b64encode(zlib.compress(dh10.tobytes(), 9)).decode()
    runs = [dict(i=r_['i'], name=r_['name'], difficulty=r_['difficulty'], cat=r_['cat_track']) for r_ in load_runs()]
    ropes = []
    for rp in json.load(open(IN + 'ropes.json'))['ropes']:
        P = np.array(rp['points'], np.float64); y = drawn(P[:, 0], P[:, 1])
        ropes.append([round(float(v), 2) for p_, y_ in zip(P, y) for v in (p_[0], p_[1], y_)])
    blocks = []
    for b in json.load(open(RM + 'buildings_game.json'))['buildings']:
        ring = np.asarray(b['ring'], np.float32)
        if len(ring) < 3: continue
        (cx, cz), (bw, bl), ang = cv2.minAreaRect(ring)
        if min(bw, bl) < 2: continue
        hgt = float(np.clip(5 + np.sqrt(abs(cv2.contourArea(ring))) / 4, 6, 16))
        # cv2's angle turns the rectangle's width (x) axis toward z; the game's yaw turns local x the other way
        gy = at(ring[:, 0], ring[:, 1]); gc = at(np.array([cx]), np.array([cz]))
        blocks.append([round(float(cx), 1), round(float(cz), 1), round(float(bw), 1), round(float(bl), 1), round(-float(ang), 1), round(hgt, 1),
                       round(float(min(gy.min(), gc[0])), 1), round(float(max(gy.max(), gc[0])), 1)])
    out = dict(v=3, edge_step=EDGE_STEP, x0=grid.GX0, z0=grid.GZ0, cell=grid.PC, nx=tx * TILE, nz=tz * TILE, tile=TILE, chunk=CHUNK,
               tiles=[v for t in tiles for v in t], chunks=chunks, trees=trees, ntrees=len(T), area=area_b, runf=runf_b, dh=dh_b, runs=runs, blocks=blocks,
               signs=[[s_['name'], s_['difficulty'], s_['spots']] for s_ in signs], ropes=ropes, bridges=bridges, roads=roads)
    js = '// Whole-mountain runs built ahead of time by tools/runs (bake_runs.sh). Rebuild when the outlines change.\n'
    js += 'export const RUN_DATA = ' + json.dumps(out, separators=(',', ':')) + ';\n'
    open(f'{d}/runs.js', 'w').write(js)
    print(f'tiles {len(tiles)} in {len(chunks)} chunk files ({size / 1e6:.1f} MB), points {len(tiles) * TILE * TILE / 1e6:.2f} M, largest step {worst} (int16 limit 32767), '
          f'runs.js {len(js) / 1e6:.2f} MB (trees {len(trees) / 1e3:.0f} KB, area {len(area_b) / 1e3:.0f} KB, runf {len(runf_b) / 1e3:.0f} KB, dh {len(dh_b) / 1e3:.0f} KB), {len(blocks)} stand-in blocks, {len(signs)} signs, {len(ropes)} rope lines, {int(gone.sum()) if len(spots) else 0} trees cleared for signs')


if __name__ == '__main__':
    main(sys.argv[1])

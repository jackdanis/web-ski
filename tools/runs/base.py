"""The inputs the other steps share, on the 2 m run grid: h0.npy (the kit's physics ground, sampleGrid), hm.npy (its
10 m mesh, meshY) and bld2m.npy (building footprints from buildings_game.json, 1 = building)."""
import json, sys, numpy as np, cv2
from load import load_map, RM
import grid


def main(d):
    meta, H, _, _ = load_map()
    np.save(f'{d}/h0.npy', grid.smooth(H, meta))
    np.save(f'{d}/hm.npy', grid.mesh(H, meta))
    bld = np.zeros((grid.NZP, grid.NXP), np.uint8)
    for b in json.load(open(RM + 'buildings_game.json'))['buildings']:
        ring = np.asarray(b['ring'], float)
        r, c = grid.rc(ring[:, 0], ring[:, 1])
        cv2.fillPoly(bld, [np.round(np.stack([c, r], 1)).astype(np.int32)], 1)
    np.save(f'{d}/bld2m.npy', bld)
    print('h0, hm, bld2m written;', int(bld.sum()) * 4, 'm2 of buildings')


if __name__ == '__main__':
    main(sys.argv[1])

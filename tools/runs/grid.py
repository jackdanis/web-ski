"""The kit's 10 m mountain evaluated on the 2 m run grid, exactly as game.js does it.

Grid points sit at x = GX0 + 2 c, z = GZ0 + 2 r: the cell centres of the run-mapping owner raster.
- smooth(): sampleGrid's Catmull-Rom surface (what the physics rides off the runs, groundY)
- mesh(): meshY, the 10 m triangles buildChunk draws up close
"""
import numpy as np

GX0, GZ0, PC = -3985.0, -8525.0, 2.0      # first point, spacing (m)
NXP, NZP = 5000, 6250                     # points across, down


def _cr_weights(t):
    t2, t3 = t * t, t * t * t
    return [0.5 * (-t + 2 * t2 - t3), 0.5 * (2 - 5 * t2 + 3 * t3), 0.5 * (t + 4 * t2 - 3 * t3), 0.5 * (-t2 + t3)]


def _axis(n_pts, g0, first, cell, n_grid):
    """index i and fraction t of each point along one axis (sampleGrid's clamp to n - 1.001)"""
    f = np.clip((g0 + PC * np.arange(n_pts) - first) / cell, 0, n_grid - 1.001)
    i = np.floor(f).astype(np.int64)
    return i, f - i


def smooth(H, meta):
    m = meta['near']; nx, nz, cell = m['nx'], m['nz'], m['cell']
    ix, tx = _axis(NXP, GX0, m['x0'], cell, nx)
    iz, tz = _axis(NZP, GZ0, m['z0'], cell, nz)
    wx = _cr_weights(tx); wz = _cr_weights(tz)
    H = H.astype(np.float64)
    A = np.zeros((nz, NXP))
    for n in range(4):
        A += H[:, np.clip(ix - 1 + n, 0, nx - 1)] * wx[n][None, :]
    out = np.zeros((NZP, NXP))
    for n in range(4):
        out += A[np.clip(iz - 1 + n, 0, nz - 1), :] * wz[n][:, None]
    return out.astype(np.float32)


def mesh(H, meta):
    m = meta['near']; nx, nz, cell = m['nx'], m['nz'], m['cell']
    i, tx = _axis(NXP, GX0, m['x0'], cell, nx)
    j, tz = _axis(NZP, GZ0, m['z0'], cell, nz)
    I, J = np.meshgrid(i, j); TX, TZ = np.meshgrid(tx, tz)
    g = lambda a, b: H[np.clip(b, 0, nz - 1), np.clip(a, 0, nx - 1)].astype(np.float64)
    h00, h10, h01, h11 = g(I, J), g(I + 1, J), g(I, J + 1), g(I + 1, J + 1)
    odd = ((I + J) & 1) == 1
    a = np.where(TX + TZ <= 1, h00 + TX * (h10 - h00) + TZ * (h01 - h00), h11 + (1 - TX) * (h01 - h11) + (1 - TZ) * (h10 - h11))
    b = np.where(TX >= TZ, h00 + TX * (h10 - h00) + TZ * (h11 - h10), h00 + TZ * (h01 - h00) + TX * (h11 - h01))
    return np.where(odd, a, b).astype(np.float32)


def xz(r, c):
    return GX0 + PC * np.asarray(c), GZ0 + PC * np.asarray(r)


def rc(x, z):
    return (np.asarray(z) - GZ0) / PC, (np.asarray(x) - GX0) / PC

# Shared loaders: the 10 m mountain the runs were baked on (mountain-input.js), the 2 m run owner raster and traced runs.
# Inputs live in the project's shared folder, source-data/runs/ (GOLDEN_SKI_RUNS overrides it).
import json, re, base64, zlib, os, numpy as np
IN = os.environ.get('GOLDEN_SKI_RUNS', '/mnt/project-files/golden-ski/source-data/runs/')
RM = IN
def _field(s, name):
    i = s.find('"%s": "' % name); j = s.find('"', i + len(name) + 5)
    return zlib.decompress(base64.b64decode(s[i + len(name) + 5:j]))
def load_map():
    s = open(IN + 'mountain-input.js').read()
    meta = json.loads(re.search(r'"meta": (\{.*?"credit": "[^"]*"\})', s).group(1))
    nm = meta['near']; nx, nz = nm['nx'], nm['nz']
    b = _field(s, 'near')
    first = np.frombuffer(b, np.uint16, nz).astype(np.int64)
    diff = np.frombuffer(b, np.int16, nx * nz, nz * 2).reshape(nz, nx).astype(np.int64)
    diff[:, 0] = 0
    H = (first[:, None] + np.cumsum(diff, axis=1)) / 10.0
    cov = np.frombuffer(_field(s, 'cover'), np.uint8).reshape(nz, nx)
    i = s.find("MAP.runField = \"") + 16; runf = np.frombuffer(zlib.decompress(base64.b64decode(s[i:s.find("\"", i)])), np.int8).reshape(nz, nx)
    return meta, H, cov, runf
def load_owner():
    return np.load(IN + 'owner_2m.npy', mmap_mode='r')   # (row, col): x = col*2-3985, z = row*2-8525
def load_runs():
    return json.load(open(IN + 'runs_traced.json'))['runs']
def load_lifts():
    s = open(IN + 'mountain-input.js').read(); i = s.find('MAP.lifts = ') + 12
    return json.JSONDecoder().raw_decode(s[i:])[0]
def load_kit_runs():
    return json.load(open(IN + 'runs.json'))['runs']
def load_fills():
    # forest fill rings (x, z in m): ground that is forest, not run, whatever the traced runs say (Jack's laser notes)
    p = IN + 'forest_fill.json'
    return [np.asarray(f['ring'], np.float64) for f in json.load(open(p))['fills']] if os.path.exists(p) else []
def fill_mask(shape):
    # the fill rings on the 2 m grid (row, col)
    import cv2, grid
    m = np.zeros(shape, np.uint8)
    for ring in load_fills():
        r, c = grid.rc(ring[:, 0], ring[:, 1])
        cv2.fillPoly(m, [np.round(np.stack([c, r], 1)).astype(np.int32)], 1)
    return m.astype(bool)

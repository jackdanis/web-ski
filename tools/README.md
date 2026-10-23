# Golden Ski tools

Scripts that build the game's data and art. They read their big inputs from the project's shared folder,
`/mnt/project-files/golden-ski/`, and write into the folder you run them in. Copy results into
`games/golden-ski/snowmass/` by hand.

| Folder | Builds | Inputs (shared folder) |
| --- | --- | --- |
| `runs/` | `data/runs.js` and `data/runs/` (the 2 m runs, edge trees, signs, ropes, roads, stand-in blocks) | `source-data/runs/` |
| `goldie/` | Goldie's sprite sheet (`assets/sprites/goldie_body*`) | `art/goldie/` model |
| `textures/` | The station atlas (`assets/textures/station_atlas*`) and the apr&egrave;s posters | `art/textures/` |
| `prerender/` | Tree and prop sprites with normal maps from a GLB model | a GLB from `art/` |
| `trellis/` | TRELLIS image-to-3D models and FLUX reference images (Hugging Face) | a reference image |
| `vendor/` | three.js r128 for the headless renders in `goldie/` and `prerender/` | |

## Runs

```sh
mkdir -p /tmp/runs && sh tools/runs/bake_runs.sh /tmp/runs
cp /tmp/runs/runs.js games/golden-ski/snowmass/data/runs.js
cp -r /tmp/runs/runs/. games/golden-ski/snowmass/data/runs/
```

Needs numpy, scipy and opencv. `GOLDEN_SKI_RUNS` points at a different input folder.

## Goldie

1. `node goldie/run3.js <model.glb> <poses> <yaws> <tilts> <outdir>` renders body-only albedo and normal passes
   (Playwright with Chromium). It poses the model on the stock three.js Michelle rig: put `Michelle.glb` from the
   three.js examples next to `run3.js` first.
2. `python3 goldie/sheet3.py <outdir> <sheet name>` packs them into the atlas and JSON the game reads.

## Textures

Run in an empty folder: `python3 make_textures.py` (procedural atlas and posters), then
`python3 make_flux_atlas.py` (photo grain from the FLUX swatches). `flux_swatches.py` makes new swatches.

## TRELLIS and FLUX

`python3 trellis/run.py <image> <out.glb> [seed]` and `python3 trellis/flux.py "<prompt>" <out.png>` need a
Hugging Face token in `HF_TOKEN` (or `token`). `colormatch.py` and `colorpass.py` fix TRELLIS's pale textures.
Big models run on Jack's PC with TRELLIS v1.

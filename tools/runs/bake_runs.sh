#!/bin/sh
# Rebuild runs.js for the Snowmass kit from the traced runs: bake_runs.sh <work dir>
# (base grids, cleanup, shaping, edge trees, trail signs, export). Copy <work dir>/runs.js next to the kit's game.js.
set -e
cd "$(dirname "$0")"
python3 base.py "$1"
python3 labels.py "$1"
python3 shape.py "$1"
python3 trees.py "$1"
python3 signs.py "$1"
python3 export.py "$1"

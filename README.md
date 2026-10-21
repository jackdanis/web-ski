# Web Ski

Golden Ski: real-time skiing on a true-size Snowmass, for desktop and mobile browsers. Plain HTML, CSS and JavaScript
with no build step.

The game lives in [`games/golden-ski/snowmass`](games/golden-ski/snowmass) (see its README). The root `index.html`
opens it straight away, so the GitHub Pages link plays the game.

## Running

Open `index.html` in a browser, or serve the repo so phones on your network can reach it:

```sh
python3 -m http.server 8000
# then visit http://<your-computer-ip>:8000 on your phone
```

## Old prototypes

Endless Skier, Downhill 3D, the Golden Ski Milestone 1 test slope, Jump Lab and the race-routes page were removed on
2026-10-21. They are all in commit `e9bcf5a`; restore one with `git checkout e9bcf5a -- games/<folder>`.

# Web Ski

Quick skiing game prototypes that run in a desktop or mobile browser. Each game is plain HTML, CSS and JavaScript with no build step.

## Games

| Game | Folder | Idea |
| --- | --- | --- |
| Endless Skier | [`games/endless-skier`](games/endless-skier) | Alto's Adventure / SkiFree style endless run, drawn like Line Rider. Jump, flip, dodge rocks, land clean. |
| Downhill 3D | [`games/downhill-3d`](games/downhill-3d) | Third-person 3D endless run in Three.js. Carve through trees, hit kickers, spin and flip, stick the landing. |
| Golden Ski | [`games/golden-ski`](games/golden-ski) | Real-time skiing with Golden Tee's art style: sprite skiers on a low-poly N64-style mountain. Milestone 1: ski feel on a test slope, against the clock. |
| Golden Ski: Snowmass | [`games/golden-ski/snowmass`](games/golden-ski/snowmass) | Golden Ski's real mountain: true-size Snowmass with Momentum physics, real lifts, and every run shaped on a 2 m grid with run-edge forest and trail signs. FreePlay from the Village Express top. |
| Golden Ski: Jump Lab | [`games/golden-ski/jumplab`](games/golden-ski/jumplab) | Physics mockup: collision shapes, a test wall and block on Powderhorn, and Steep-style bails. |

## Running

Open `index.html` (or any game's `index.html`) directly in a browser, or serve the repo so phones on your network can reach it:

```sh
python3 -m http.server 8000
# then visit http://<your-computer-ip>:8000 on your phone
```

## Adding a prototype

Make a new folder under `games/` with its own `index.html`, then add a row to the table above and a link in the root `index.html`.

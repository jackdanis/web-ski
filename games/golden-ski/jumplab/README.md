# Golden Ski: Jump Lab (proposal)

Physics mockup for sign-off, not the game. A copy of `../snowmass/game.js` that starts on Powderhorn and adds:

- Collision shapes: Goldie is a pill (capsule, 1.7 m tall) standing on a thin ski plate. The pill leans with her and hits walls and boxes; the plate meets the snow.
- A test wall (12 m wide, 3 m tall, square across Powderhorn about 140 m down) and a test block (3 x 3 m, 1.2 m tall, off to one side about 230 m down).
- Steep-style bails: only big mistakes knock her down: a square hit on a wall or trunk faster than about 32 km/h, landing more than 70 degrees off, or a huge drop. Glancing hits slide her along.
- A bail swaps her shapes for one flat box (spread-eagle, skis on) that tumbles until it settles, then she gets up.
- Tab menu: "Crashes: Steep-style bails" (on here) and "Show collision shapes".

It shares data, textures and styles with `../snowmass/`.

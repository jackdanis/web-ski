// Ollie charge and rail grind poses (2026-11-11, Jack D1 and B1).
// charge_1..3: she sinks from standing into a deep crouch over the 0.5 s load, hands kept forward; charge_3 is deeper
// than absorb. grind: skis across the rail (the game turns her 90 degrees to it), soft knees, hips square to the skis,
// arms out wide for balance like the rainbow-box photo. All drawn from behind, symmetric.
{
  const mix = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  const S = POSES.stand, D = {
    torso: V(0, 1, 1.0), head: V(0, 1, 0.45),
    thigh: [V(0.12, -0.35, 1), V(-0.12, -0.35, 1)], shin: [V(0.03, -1, -0.85), V(-0.03, -1, -0.85)],
    arm: [V(0.45, -0.75, 0.8), V(-0.45, -0.75, 0.8)], fore: [V(0.2, -0.1, 1), V(-0.2, -0.1, 1)],
    pole: [V(0.35, -1, -0.45), V(-0.35, -1, -0.45)],
  };
  const at = (t) => ({
    rot: { yaw: 0, roll: 0, pitch: 0 }, torso: mix(S.torso, D.torso, t), head: mix(S.head, D.head, t),
    thigh: [0, 1].map((i) => mix(S.thigh[i], D.thigh[i], t)), shin: [0, 1].map((i) => mix(S.shin[i], D.shin[i], t)),
    arm: [0, 1].map((i) => mix(S.arm[i], D.arm[i], t)), fore: [0, 1].map((i) => mix(S.fore[i], D.fore[i], t)),
    pole: [0, 1].map((i) => mix(S.pole[i], D.pole[i], t)), skiYaw: [0, 0],
  });
  Object.assign(POSES, {
    charge_1: at(0.35), charge_2: at(0.7), charge_3: at(1),
    grind: {
      rot: { yaw: 0, roll: 0, pitch: 0 }, torso: V(0, 1, 0.55), head: V(0, 1, 0.3),
      thigh: [V(0.14, -0.55, 0.9), V(-0.14, -0.55, 0.9)], shin: [V(0.03, -1, -0.65), V(-0.03, -1, -0.65)],
      arm: [V(1, -0.6, 0.3), V(-1, -0.6, 0.3)], fore: [V(1, -0.3, 0.55), V(-1, -0.3, 0.55)],
      pole: [V(0.45, -1, -0.35), V(-0.45, -1, -0.35)], skiYaw: [0, 0],
    },
  });
}

// Double-pole cycle (reach, plant, crunch, push). `plant` = where the basket sits on the snow, [x left, z forward] m from
// between her boots: the pole is aimed from the glove to that point. Poles without one use `pole` as usual.
// Everything given in her upright frame; the hips (whole body) pitch forward by `pitch` so the lower back folds too.
function folded(pitch, p) {
  const rot = { yaw: 0, roll: 0, pitch }, U = w => upright(rot, 0, w);
  const q = { rot, skiYaw: [0, 0], skiPitch: pitch, plant: p.plant, torso: U(p.torso), head: U(p.head) };
  for (const k of ['thigh', 'shin', 'arm', 'fore', 'pole']) if (p[k]) q[k] = p[k].map(U);
  return q;
}
const DP = {
  pole_reach: { // tall, arms swung forward to head height, baskets just off the snow ahead of the boots
    rot: { yaw: 0, roll: 0, pitch: 0 }, torso: V(0, 1, 0.15), head: V(0, 1, 0.05),
    thigh: [V(0.08, -1, 0.12), V(-0.08, -1, 0.12)], shin: [V(0, -1, -0.2), V(0, -1, -0.2)],
    arm: [V(0.25, -0.45, 1), V(-0.25, -0.45, 1)], fore: [V(0.08, -0.05, 1), V(-0.08, -0.05, 1)],
    plant: [[0.34, 0.45, 0.18], [-0.34, 0.45, 0.18]], skiYaw: [0, 0],
  },
  pole_plant: { // baskets bite beside the toes, hips start to fold, arms still high and forward
    rot: { yaw: 0, roll: 0, pitch: 0 }, torso: V(0, 1, 0.5), head: V(0, 1, 0.2),
    thigh: [V(0.08, -1, 0.25), V(-0.08, -1, 0.25)], shin: [V(0, -1, -0.3), V(0, -1, -0.3)],
    arm: [V(0.22, -0.35, 1), V(-0.22, -0.35, 1)], fore: [V(0.05, -0.15, 1), V(-0.05, -0.15, 1)],
    plant: [[0.32, 0.2, 0], [-0.32, 0.2, 0]], skiYaw: [0, 0],
  },
  // the push: hips fold so the trunk lies over the poles, arms drive down past the knees, baskets now behind the boots
  pole_crunch: folded(35, {
    torso: V(0, 0.45, 1), head: V(0, 0.9, 1),
    thigh: [V(0.1, -1, 0.6), V(-0.1, -1, 0.6)], shin: [V(0, -1, -0.5), V(0, -1, -0.5)],
    arm: [V(0.2, -1, 0.05), V(-0.2, -1, 0.05)], fore: [V(0.12, -1, -0.35), V(-0.12, -1, -0.35)],
    plant: [[0.3, -0.4, 0], [-0.3, -0.4, 0]],
  }),
  // follow-through (Jack's Steep refs): still folded, arms straight back and out, poles off the snow behind
  pole_push: folded(30, {
    torso: V(0, 0.4, 1), head: V(0, 0.9, 1),
    thigh: [V(0.1, -1, 0.45), V(-0.1, -1, 0.45)], shin: [V(0, -1, -0.45), V(0, -1, -0.45)],
    arm: [V(0.45, -0.7, -0.75), V(-0.45, -0.7, -0.75)], fore: [V(0.35, -0.4, -1), V(-0.35, -0.4, -1)],
    pole: [V(0.35, -0.65, -1), V(-0.35, -0.65, -1)],
  }),
};
Object.assign(POSES, DP);
const _pose = window.pose;
window.pose = function (name) {
  const p = POSES[name];
  if (!p.plant) return _pose(name);
  p.pole = p.pole || [V(0, -1, 0), V(0, -1, 0)];
  _pose(name);   // once to find the gloves and the snow line, then aim the poles and pose again
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3(); skis.forEach(g => box.expandByObject(g));
  const fl = bones.LeftFoot.getWorldPosition(new THREE.Vector3()), fr = bones.RightFoot.getWorldPosition(new THREE.Vector3());
  const c = fl.add(fr).multiplyScalar(0.5);
  p.pole = ['Left', 'Right'].map((s, i) => {
    const a = bones[s + 'Hand'].getWorldPosition(new THREE.Vector3()).lerp(bones[s + 'HandMiddle1'].getWorldPosition(new THREE.Vector3()), 0.7);
    const [x, z, h] = p.plant[i];
    return upright(p.rot, 0, new THREE.Vector3(c.x + x, box.min.y + (h || 0), c.z + z).sub(a).normalize());  // world -> her pitched frame
  });
  _pose(name);
};

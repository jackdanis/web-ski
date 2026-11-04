// Transition poses (2026-11-03, C1): the in-between frames the physics flashes for a fraction of a second.
// absorb: knees fold under her over a mogul or while she loads an ollie, hands kept forward like a bumps skier.
// pop: just off the lip, legs driving straight and arms swung forward and up. unweight: tall and light between
// edges, knees nearly straight, hands forward ready for the next turn. All drawn from behind, symmetric.
Object.assign(POSES, {
  absorb: {
    rot: { yaw: 0, roll: 0, pitch: 0 }, torso: V(0, 1, 0.75), head: V(0, 1, 0.35),
    thigh: [V(0.1, -0.55, 1), V(-0.1, -0.55, 1)], shin: [V(0.02, -1, -0.65), V(-0.02, -1, -0.65)],
    arm: [V(0.45, -0.8, 0.7), V(-0.45, -0.8, 0.7)], fore: [V(0.2, -0.2, 1), V(-0.2, -0.2, 1)],
    pole: [V(0.3, -1, -0.35), V(-0.3, -1, -0.35)], skiYaw: [0, 0],
  },
  pop: {
    rot: { yaw: 0, roll: 0, pitch: 0 }, torso: V(0, 1, 0.4), head: V(0, 1, 0.2),
    thigh: [V(0.07, -1, -0.02), V(-0.07, -1, -0.02)], shin: [V(0.01, -1, -0.08), V(-0.01, -1, -0.08)],
    arm: [V(0.3, -0.7, 1), V(-0.3, -0.7, 1)], fore: [V(0.15, -0.1, 1), V(-0.15, -0.1, 1)],
    pole: [V(0.4, -1, -0.7), V(-0.4, -1, -0.7)], skiYaw: [0, 0],
  },
  unweight: {
    rot: { yaw: 0, roll: 0, pitch: 0 }, torso: V(0, 1, 0.18), head: V(0, 1, 0.05),
    thigh: [V(0.08, -1, 0.1), V(-0.08, -1, 0.1)], shin: [V(0, -1, -0.1), V(0, -1, -0.1)],
    arm: [V(0.4, -1, 0.45), V(-0.4, -1, 0.45)], fore: [V(0.2, -0.35, 1), V(-0.2, -0.35, 1)],
    pole: [V(0.25, -1, -0.2), V(-0.25, -1, -0.2)], skiYaw: [0, 0],
  },
});
// Where her knees and ankles land in a shoot() frame (px from the top left), for the back-of-knee crease (kneeline.py).
window.kneeScreen = function (camYaw, pitch, pxPerM, Wm, Hm) {
  const deg = Math.PI / 180, p = pitch * deg, y = camYaw * deg;
  const back = new THREE.Vector3(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  const up = new THREE.Vector3(Math.sin(y) * Math.sin(p), Math.cos(p), Math.cos(y) * Math.sin(p));
  const tgt = up.clone().multiplyScalar(Hm / 2 - 0.04);
  const cam = new THREE.OrthographicCamera(-Wm / 2, Wm / 2, Hm / 2, -Hm / 2, 0.01, 100);
  cam.position.copy(tgt).addScaledVector(back, 20); cam.up.copy(up); cam.lookAt(tgt); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  scene.updateMatrixWorld(true);
  const px = v => { const q = v.project(cam); return [(q.x + 1) / 2 * Wm * pxPerM, (1 - q.y) / 2 * Hm * pxPerM]; };
  return ['Left', 'Right'].map(s => ({ knee: px(bones[s + 'Leg'].getWorldPosition(new THREE.Vector3())), ankle: px(bones[s + 'Foot'].getWorldPosition(new THREE.Vector3())), hip: px(bones[s + 'UpLeg'].getWorldPosition(new THREE.Vector3())) }));
};

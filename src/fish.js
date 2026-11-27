// A fish that now and then jumps out of the pond in an arc and falls back in, with the skipping
// stones' rings and drops (src/stones.js). When and where comes only from the room's clock, so
// everyone sees the same jump with no message.
import * as THREE from "three";

const EVERY_MS = 6000; // one jump in each stretch this long
const JUMP_MS = 900;
const ARC = 1.8; // how high it goes at the middle
const SIZE = 1.1; // scale of the sprite
const MARGIN = 1.5; // from the pond's box, so it doesn't jump out of the edge stones

// side view, 12x6 at the trainers' own pixel size; two frames, the tail up and down
const PX = 5 / 32;
const COLORS = { o: "#1b1b24", b: "#f08a3c", d: "#c25a22", l: "#ffd9a8", e: "#1b1b24", w: "#fff6e0" };
const FRAMES = [
  ["....oooo....", "..oobbbboo.o", ".obbbbbbdboo", "owebbbbbbddo", ".olllllldoo.", "..oooooo...."],
  ["....oooo....", "..oobbbboo..", ".obbbbbbdboo", "owebbbbbbddo", ".olllllldboo", "..oooooo...o"],
];
const geometry = new THREE.PlaneGeometry(FRAMES[0][0].length * PX, FRAMES[0].length * PX);
const materials = FRAMES.map((rows) => {
  const cv = Object.assign(document.createElement("canvas"), { width: rows[0].length, height: rows.length });
  const c = cv.getContext("2d");
  rows.forEach((row, y) => [...row].forEach((k, x) => COLORS[k] && ((c.fillStyle = COLORS[k]), c.fillRect(x, y, 1, 1))));
  const map = new THREE.CanvasTexture(cv);
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.colorSpace = THREE.SRGBColorSpace;
  // glows a little, like the stone, to stay readable at night
  return new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.4, alphaTest: 0.5, side: THREE.DoubleSide });
});

/**
 * @param {THREE.Scene} scene
 * @param {{ camera: THREE.Camera, hash: (a: number, b: number) => number, waterY: (x: number, z: number) => number | null, splash: (x: number, y: number, z: number, big: boolean) => void }} deps
 */
export function createJumpingFish(scene, { camera, hash, waterY, splash }) {
  const mesh = new THREE.Mesh(geometry, materials[0]);
  mesh.scale.setScalar(SIZE);
  mesh.visible = false;
  scene.add(mesh);

  // the jump in stretch k: where it leaves and lands, or null if no try lands on water both ends
  let planned = { k: null, jump: null };
  function jumpOf(k, box) {
    if (planned.k === k) return planned.jump;
    let jump = null;
    for (let i = 0; i < 4 && !jump; i++) {
      const h = (n) => hash(k * 8 + i, n) / 4294967296;
      const x = box.min.x + MARGIN + h(1) * (box.max.x - box.min.x - 2 * MARGIN),
        z = box.min.z + MARGIN + h(2) * (box.max.z - box.min.z - 2 * MARGIN);
      const a = h(3) * Math.PI * 2,
        d = 1.5 + h(4) * 1.5;
      const tx = x + Math.cos(a) * d,
        tz = z + Math.sin(a) * d;
      const y0 = waterY(x, z),
        y1 = waterY(tx, tz);
      if (y0 !== null && y1 !== null)
        jump = { start: k * EVERY_MS + (hash(k, 9) % 3000), a: new THREE.Vector3(x, y0, z), b: new THREE.Vector3(tx, y1, tz) };
    }
    planned = { k, jump };
    return jump;
  }

  const _dir = new THREE.Vector3(),
    _toView = new THREE.Quaternion();
  let lastT = null; // splashes only for moments passed while the tab is open
  return {
    /** @param {number} t room time @param {THREE.Box3} box the pond's box */
    update(t, box) {
      const prev = lastT ?? t;
      lastT = t;
      const jump = jumpOf(Math.floor(t / EVERY_MS), box);
      if (!jump) return void (mesh.visible = false);
      const { start, a, b } = jump,
        end = start + JUMP_MS;
      if (prev < start && t >= start) splash(a.x, a.y, a.z, false);
      if (prev < end && t >= end) splash(b.x, b.y, b.z, true);
      const u = (t - start) / JUMP_MS;
      mesh.visible = u >= 0 && u < 1;
      if (!mesh.visible) return;
      mesh.position.lerpVectors(a, b, u);
      mesh.position.y += 4 * ARC * u * (1 - u);
      // the sprite looks left: flipped when it jumps right on screen; nose up on the way out, down on the way back
      const right = _dir.subVectors(b, a).applyQuaternion(_toView.copy(camera.quaternion).invert()).x >= 0;
      mesh.scale.x = right ? -SIZE : SIZE;
      const tilt = Math.atan2(4 * ARC * (1 - 2 * u), 2.2);
      mesh.rotation.set(camera.rotation.x * 0.5, 0, right ? tilt : -tilt);
      mesh.material = materials[Math.floor(t / 120) % 2];
    },
  };
}

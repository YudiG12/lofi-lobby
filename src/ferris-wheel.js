// Ferris wheel: on the grass east of the pond, where the pines were taken out for it, the carousel's
// mirror across the water (src/carousel.js). Built in code, no new art. It faces the camera, so it
// reads as a wheel, and turns by the room's clock like the carousel: every player sees the same
// gondola at the same height without one message more. Its gondolas are seats 24..31, kept by the
// server like the bench seats (MAX_SEATS in worker/index.js).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const WHEEL = {
  x: 19, // center, on the flat grass the pines leave
  z: 39,
  clear: { x0: 10, x1: 28, z0: 28, z1: 50 }, // a pine whose center falls in here is taken out
  seats: 8,
  firstSeat: 24, // after the bench seats (0..15) and the carousel horses (16..23)
  radius: 6, // from the axle to where a gondola hangs
  axle: 7.8, // axle height over the ground: the lowest gondola clears the platform
  turnMs: 60000, // one turn: slower than the carousel, it is a long way up
  // the footprint nobody walks into: the legs and the gondolas going by at the bottom
  halfWidth: 7.4,
  halfDepth: 2,
};
const TAU = Math.PI * 2;
const HANG = 1.3; // from the rim to a gondola's floor
const FLOOR_TO_FEET = 0.25; // a rider's sprite origin (the feet) over the gondola's floor: sitting on its bench
const BOARD_ANGLE = 0.45; // a gondola can be boarded within this angle (radians) of the bottom
const RIDER_FORWARD = 0.35; // riders sit at the front of the gondola, toward the camera

/** @returns {boolean} the point is where the wheel's pines are taken out */
export const inWheelClearing = (x, z) => {
  const c = WHEEL.clear;
  return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
};
/** @returns {boolean} the point is under the wheel, or within `r` of it */
export const onWheel = (x, z, r = 0) => Math.abs(x - WHEEL.x) < WHEEL.halfWidth + r && Math.abs(z - WHEEL.z) < WHEEL.halfDepth + r;
/** @returns {boolean} that seat id is one of the gondolas */
export const isWheelSeat = (id) => id >= WHEEL.firstSeat && id < WHEEL.firstSeat + WHEEL.seats;

// the turn at room time t (ms), in radians
const turnAt = (t) => (((t % WHEEL.turnMs) + WHEEL.turnMs) % WHEEL.turnMs / WHEEL.turnMs) * TAU;
// Where gondola i hangs from at that turn. The wheel is in the x-y plane; at angle b a point is
// at (sin b, cos b) times the radius from the axle, so b = 0 is the top and b = PI the bottom.
// rotation.z = turn carries a point at angle p to p - turn.
const angleOf = (i, turn) => (i / WHEEL.seats) * TAU - turn;

/**
 * Where gondola i's rider is at room time t. Riders face the camera; `board` is whether it is
 * near enough the bottom to get in.
 * @param {number} i gondola 0..7 @param {number} t room time in ms @param {number} groundY the wheel's ground
 * @returns {{x: number, y: number, z: number, dir: string, board: boolean}}
 */
export function wheelSeat(i, t, groundY) {
  const b = angleOf(i, turnAt(t));
  const fromBottom = Math.abs(((b % TAU) + TAU) % TAU - Math.PI);
  return {
    x: WHEEL.x + WHEEL.radius * Math.sin(b),
    z: WHEEL.z + RIDER_FORWARD,
    y: groundY + WHEEL.axle + WHEEL.radius * Math.cos(b) - HANG + FLOOR_TO_FEET,
    dir: "down",
    board: fromBottom < BOARD_ANGLE,
  };
}

// ---- Model ----
// Primitives moved into place, painted with vertex colours and merged, as in the carousel:
// a dozen draw calls (legs, wheel, 8 gondolas, lights).
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
function part(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  const col = new Float32Array(g.attributes.position.count * 3);
  _c.set(color);
  for (let v = 0; v < g.attributes.position.count; v++) _c.toArray(col, v * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
// a beam from (x0, y0) to (x1, y1) at depth z
function beam(x0, y0, x1, y1, z, thick, color) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return part(new THREE.BoxGeometry(thick, len, thick), color, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z, rz: -Math.atan2(x1 - x0, y1 - y0) });
}
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const WHITE = "#efe9dc",
  RED = "#c8312d",
  IRON = "#2f3b45",
  GREEN = "#2f7d3a";
const CABINS = [RED, GREEN, "#2f6fb5", "#d9a92e"];

function gondolaGeometry(color) {
  // open toward the camera (+z): floor, back, sides, a bench, a roof and the hanger
  return mergeGeometries([
    part(new THREE.BoxGeometry(1.7, 0.12, 1.1), color, { y: 0 }),
    part(new THREE.BoxGeometry(1.7, 1.1, 0.1), color, { y: 0.55, z: -0.5 }),
    part(new THREE.BoxGeometry(0.1, 0.7, 1.1), color, { x: -0.8, y: 0.35 }),
    part(new THREE.BoxGeometry(0.1, 0.7, 1.1), color, { x: 0.8, y: 0.35 }),
    part(new THREE.BoxGeometry(1.5, 0.12, 0.45), WHITE, { y: 0.5, z: -0.25 }),
    part(new THREE.BoxGeometry(1.9, 0.14, 1.3), WHITE, { y: 1.15 }),
    part(new THREE.BoxGeometry(0.1, HANG - 1.15, 0.1), IRON, { y: 1.15 + (HANG - 1.15) / 2 }),
  ]);
}

/**
 * The wheel: `root` goes in the scene at the ground height, `update(t, day)` turns it.
 * @returns {{root: THREE.Group, update: (t: number, day: number) => void}}
 */
export function createFerrisWheel() {
  const root = new THREE.Group();
  root.name = "FerrisWheel";
  root.position.set(WHEEL.x, 0, WHEEL.z);
  const A = WHEEL.axle;

  // still: an A of legs on each side of the wheel, the axle, a platform and a ticket booth
  const legs = [];
  for (const z of [-1.4, 1.4]) {
    legs.push(beam(-3.6, 0, 0, A, z, 0.35, WHITE), beam(3.6, 0, 0, A, z, 0.35, WHITE), beam(-2.2, A * 0.4, 2.2, A * 0.4, z, 0.22, WHITE));
  }
  legs.push(
    part(new THREE.CylinderGeometry(0.3, 0.3, 3.2, 8), IRON, { y: A, rx: Math.PI / 2 }),
    part(new THREE.BoxGeometry(4.4, 0.3, 3.6), "#cdbb9c", { y: 0.15 }),
    part(new THREE.BoxGeometry(4.5, 0.1, 3.7), RED, { y: 0.32 }),
    part(new THREE.BoxGeometry(1.4, 1.8, 1.2), RED, { x: -5.6, y: 0.9, z: 1 }),
    part(new THREE.BoxGeometry(1.7, 0.2, 1.5), WHITE, { x: -5.6, y: 1.9, z: 1 }),
  );
  const still = new THREE.Mesh(mergeGeometries(legs), material);
  still.castShadow = still.receiveShadow = true; // never moves: the lamp shadows can keep it
  root.add(still);

  // turning: two rims, the spokes between rim and hub, and bulbs along the rims. Nothing that
  // turns casts a shadow, so no lamp has to redraw its shadow passes every frame.
  const wheel = new THREE.Group();
  wheel.position.y = A;
  root.add(wheel);
  const R = WHEEL.radius;
  const rim = [];
  for (const z of [-0.6, 0.6]) {
    rim.push(part(new THREE.TorusGeometry(R, 0.12, 4, 48), WHITE, { z }));
    rim.push(part(new THREE.TorusGeometry(R * 0.55, 0.08, 4, 32), RED, { z }));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      rim.push(beam(0, 0, Math.sin(a) * R, Math.cos(a) * R, z, 0.09, WHITE));
    }
  }
  rim.push(part(new THREE.CylinderGeometry(0.6, 0.6, 1.5, 12), RED, { rx: Math.PI / 2 })); // hub
  for (let i = 0; i < WHEEL.seats; i++) {
    const a = (i / WHEEL.seats) * TAU;
    rim.push(part(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6), IRON, { x: Math.sin(a) * R, y: Math.cos(a) * R, rx: Math.PI / 2 })); // gondola pin
  }
  const frame = new THREE.Mesh(mergeGeometries(rim), material);
  frame.castShadow = false;
  frame.receiveShadow = true;
  wheel.add(frame);

  const lights = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const BULBS = 48;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 6, 4), lights, BULBS);
  const tints = ["#ffd66b", "#ff5a4e", "#7dff8a", "#ffffff", "#6bb8ff"];
  for (let i = 0; i < BULBS; i++) {
    const a = (i / (BULBS / 2)) * TAU;
    const z = i % 2 ? 0.75 : -0.75;
    _m.compose(new THREE.Vector3(Math.sin(a) * (R + 0.2), Math.cos(a) * (R + 0.2), z), _q.identity(), new THREE.Vector3(1, 1, 1));
    bulbs.setMatrixAt(i, _m);
    bulbs.setColorAt(i, _c.set(tints[i % tints.length]));
  }
  bulbs.castShadow = false;
  wheel.add(bulbs);

  // gondolas hang from the rim and stay upright: placed each frame, not turned with the wheel
  const gondolas = [];
  for (let i = 0; i < WHEEL.seats; i++) {
    const g = new THREE.Mesh(gondolaGeometry(CABINS[i % CABINS.length]), material);
    g.castShadow = false;
    g.receiveShadow = true;
    root.add(g);
    gondolas.push(g);
  }

  return {
    root,
    /** @param {number} t room time in ms @param {number} day 0 night .. 1 day */
    update(t, day) {
      const turn = turnAt(t);
      wheel.rotation.z = turn;
      gondolas.forEach((g, i) => {
        const b = angleOf(i, turn);
        g.position.set(R * Math.sin(b), A + R * Math.cos(b) - HANG, 0);
      });
      lights.color.setScalar(1 - 0.35 * day); // they shine at night and are only coloured glass by day
    },
  };
}

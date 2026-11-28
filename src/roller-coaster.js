// Roller coaster: its station on the grass below the pond, between the carousel and the Ferris wheel,
// where the pines were taken out for it. A chain lift on the east side, a drop and a low curve over
// the water, a spiral on the west side and back to the station. Built in code, no new art.
//
// It runs in cycles by the room's clock, the same for every player: the train waits at the station
// for BOARD_MS (press E to take a seat), rides for RIDE_MS and is back at the station for the next
// cycle, where its riders get off. Its 5 seats (one per car) are 32..36; the server refuses one outside the
// boarding time (worker/index.js), so a late or forged sit can't put someone on a moving train.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const COASTER = {
  firstSeat: 32, // after the benches (0..15), the carousel (16..23) and the Ferris wheel (24..31)
  seats: 5, // one per car of the train
  boardMs: 12000, // the train waits at the station
  rideMs: 30000, // then rides the track
  clear: { x0: -10, x1: 10, z0: 37.5, z1: 50 }, // a pine whose center falls in here is taken out
  // the station: its deck nobody walks into, and where riders get off (north of it)
  station: { x0: -6.5, x1: 4.5, z0: 43.8, z1: 46.4 },
  exitZ: 42.4,
};
const CYCLE_MS = COASTER.boardMs + COASTER.rideMs;
// the client stops offering a seat this long before the doors close, so the server's "no" (it
// allows a little lateness for the trip) never has to stand someone up again
const BOARD_MARGIN_MS = 800;

// The track's centre line, relative to the station's ground: x, height, z. The train's first car
// stops at the first point, heading east (+x), the others behind it on the same straight, level
// stretch. Low (about 3) over the water, so the track doesn't hide the people on the pond's
// benches from the camera, which looks down from the south.
const TRACK = [
  [2, 1.2, 45], // station: the first car stops here
  [4.4, 1.3, 45],
  [6.3, 2.1, 44.2],
  [7, 3.4, 42.6], // the chain lift, up the east side
  [7.5, 6, 40.2],
  [7.5, 8.5, 37.6], // the top
  [7, 8.1, 35.6],
  [6, 5, 32.6], // the drop, over the water
  [4.5, 3.4, 29.6],
  [2, 3, 28.2], // a low curve along the north of the pond
  [-1, 4.2, 28.4],
  [-5, 5.6, 29.2], // the spiral, two turns down on the west side
  [-8.2, 5, 32.4],
  [-5, 4.4, 35.4],
  [-1.8, 3.6, 32.2],
  [-5, 2.1, 29.6],
  [-8.4, 1.8, 32.8],
  [-7.6, 1.8, 37], // out over the pond's edge
  [-7.4, 1.3, 41.8], // brakes, round into the station
  [-6.4, 1.2, 44.4],
  [-4.2, 1.2, 45],
  [-1, 1.2, 45],
];
const curve = new THREE.CatmullRomCurve3(
  TRACK.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  "centripetal",
);

// Time along the ride -> place along the track (0..1). Sampled once: the lift at a steady pace up to
// the top, then gravity (faster the lower it is), and the brakes before the station. The whole is
// scaled to last exactly RIDE_MS, so every browser finds the train at the same place.
const SAMPLES = 800;
const rideTable = (() => {
  const ys = [];
  for (let i = 0; i <= SAMPLES; i++) ys.push(curve.getPointAt(i / SAMPLES).y);
  const crest = ys.indexOf(Math.max(...ys));
  const top = ys[crest];
  const speed = (i) => {
    if (i <= crest) return 3; // the chain lift
    const v = Math.max(2.2, Math.sqrt(2 * 9.8 * (top - ys[i])) * 1.2);
    const left = (SAMPLES - i) / SAMPLES; // the brakes, over the last stretch
    return left < 0.06 ? Math.min(v, 1 + left * 30) : v;
  };
  const t = [0];
  for (let i = 1; i <= SAMPLES; i++) t.push(t[i - 1] + 1 / ((speed(i - 1) + speed(i)) / 2));
  return t.map((v) => v / t[SAMPLES]); // 0..1 of the ride time at each sample
})();
const placeAt = (rideT) => {
  // the sample pair around that time, and how far between them
  let lo = 0,
    hi = SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rideTable[mid] <= rideT) lo = mid;
    else hi = mid;
  }
  const f = (rideT - rideTable[lo]) / (rideTable[hi] - rideTable[lo] || 1);
  return (lo + f) / SAMPLES;
};

const phaseOf = (t) => ((t % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
/** @returns {number} which cycle room time t is in: a rider gets off when it moves on */
export const coasterCycle = (t) => Math.floor(t / CYCLE_MS);
/** @returns {boolean} the train is at the station, taking riders */
export const coasterBoarding = (t) => phaseOf(t) < COASTER.boardMs - BOARD_MARGIN_MS;
/** @returns {boolean} the train is out on the track: nobody gets on or off */
export const coasterRiding = (t) => phaseOf(t) >= COASTER.boardMs;
/** @returns {number} where the first car is on the track (0..1) at room time t */
const coasterU = (t) => {
  const p = phaseOf(t);
  return p < COASTER.boardMs ? 0 : placeAt((p - COASTER.boardMs) / COASTER.rideMs);
};
/** @returns {number} seconds left to board, or 0 while the train is out (for the countdown) */
export const coasterBoardLeft = (t) => (coasterBoarding(t) ? Math.ceil((COASTER.boardMs - BOARD_MARGIN_MS - phaseOf(t)) / 1000) : 0);
/** @returns {number} seconds until the train is back at the station (0 while it waits there) */
export const coasterBackIn = (t) => (coasterRiding(t) ? Math.ceil((CYCLE_MS - phaseOf(t)) / 1000) : 0);
const TRACK_LENGTH = curve.getLength();
const CAR_GAP = 1.75; // from one car's centre to the next, along the track
// car k (0 = the first) sits CAR_GAP * k behind the first one, along the track
const carU = (u, k) => (((u - (CAR_GAP * k) / TRACK_LENGTH) % 1) + 1) % 1;

/** @returns {boolean} the point is where the coaster's pines are taken out */
export const inCoasterClearing = (x, z) => {
  const c = COASTER.clear;
  return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
};
/** @returns {boolean} that seat id is one of the train's */
export const isCoasterSeat = (id) => id >= COASTER.firstSeat && id < COASTER.firstSeat + COASTER.seats;

// the sprite direction closest to the way something moves
const facing = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up");
const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const RIDER_LIFT = 0.45; // a rider's sprite origin (the feet) over the track: sitting in the car

/**
 * Where seat i's rider is at room time t, and which way they look (the way the train goes).
 * Seat i is car i, the rider in its middle.
 * @param {number} i seat 0..4 @param {number} t room time in ms @param {number} groundY the station's ground
 * @returns {{x: number, y: number, z: number, dir: string, board: boolean}}
 */
export function coasterSeat(i, t, groundY) {
  const u = carU(coasterU(t), i);
  curve.getPointAt(u, _p);
  curve.getTangentAt(u, _t);
  return {
    x: _p.x,
    z: _p.z,
    y: groundY + _p.y + RIDER_LIFT,
    dir: facing(_t.x, _t.z),
    board: coasterBoarding(t),
  };
}

// ---- Collision ----
// Only the station's deck. The track's posts block nobody: thin as they are, they left only narrow
// gaps on the grass below the pond, so trainers walk through them.
/** @returns {boolean} the point is on the station's deck, or within `r` of it */
export function onCoaster(x, z, r = 0) {
  const s = COASTER.station;
  return x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r;
}

// ---- Model ----
// Primitives moved into place, painted with vertex colours and merged, as in the carousel: the track
// and its posts, the station and the bulbs are one draw call each, and each of the 5 cars one more.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new Float32Array(g.attributes.position.count * 3);
  _c.set(color);
  for (let v = 0; v < g.attributes.position.count; v++) _c.toArray(col, v * 3);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
function box(w, h, d, color, x, y, z, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(_m.makeRotationY(ry).setPosition(x, y, z));
  return paint(g, color);
}
// a box from a to b (its long side), thick x thick
function strut(a, b, thick, color) {
  const g = new THREE.BoxGeometry(thick, a.distanceTo(b), thick);
  _q.setFromUnitVectors(UP, _s.subVectors(b, a).normalize());
  g.applyMatrix4(_m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1)));
  return paint(g, color);
}
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const RED = "#c8312d",
  WHITE = "#efe9dc",
  WOOD = "#8a5a34",
  IRON = "#2f3b45",
  GOLD = "#d9a92e",
  GREEN = "#2f7d3a";
const GAUGE = 0.45; // half the distance between the rails

/**
 * The coaster: `root` goes in the scene at the station's ground height, `update(t, day)` moves the train.
 * @returns {{root: THREE.Group, update: (t: number, day: number) => void}}
 */
export function createCoaster() {
  const root = new THREE.Group();
  root.name = "RollerCoaster";

  // the track: two rails (tubes along the curve, set off to each side), ties and posts
  const parts = [];
  const N = 360;
  const left = [],
    right = [];
  const p = new THREE.Vector3(),
    t = new THREE.Vector3(),
    s = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const u = i / N;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    s.crossVectors(t, UP).normalize();
    left.push(p.clone().addScaledVector(s, -GAUGE));
    right.push(p.clone().addScaledVector(s, GAUGE));
    if (i % 3 === 0) {
      // a tie across the rails, just under them
      parts.push(strut(left[i].clone().setY(left[i].y - 0.12), right[i].clone().setY(right[i].y - 0.12), 0.14, WOOD));
    }
    if (i % 12 === 0 && p.y > 1.4) {
      // a post down to the ground (or the pond's bed), and a cross beam under the ties
      const foot = p.clone().setY(-1.5);
      parts.push(strut(foot, p.clone().setY(p.y - 0.2), 0.24, WHITE));
      parts.push(strut(left[i].clone().setY(p.y - 0.25), right[i].clone().setY(p.y - 0.25), 0.18, WHITE));
    }
  }
  for (const rail of [left, right]) {
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail, true, "centripetal"), N * 2, 0.08, 5, true);
    parts.push(paint(tube, RED));
  }
  const track = new THREE.Mesh(mergeGeometries(parts), material);
  track.castShadow = track.receiveShadow = true; // it never moves: the lamp shadows can keep it
  root.add(track);

  // the station: a wooden deck with a red edge, candy-cane posts at its ends with a garland and
  // a wreath between them, and presents by the rail
  const S = COASTER.station;
  const cx = (S.x0 + S.x1) / 2,
    cz = (S.z0 + S.z1) / 2;
  const st = [
    box(S.x1 - S.x0, 0.9, S.z1 - S.z0, "#cdbb9c", cx, 0.45, cz),
    box(S.x1 - S.x0 + 0.1, 0.12, S.z1 - S.z0 + 0.1, RED, cx, 0.92, cz),
    box(S.x1 - S.x0, 0.08, 0.08, GOLD, cx, 2, S.z1 - 0.1), // the back rail
  ];
  for (const x of [S.x0 + 0.2, S.x1 - 0.2]) {
    for (let k = 0; k < 8; k++) st.push(box(0.26, 0.5, 0.26, k % 2 ? RED : WHITE, x, 1.15 + k * 0.5, S.z1 - 0.2)); // candy cane
    st.push(box(0.5, 0.5, 0.2, GREEN, x, 5.2, S.z1 - 0.2)); // its bow of pine
  }
  st.push(box(S.x1 - S.x0, 0.22, 0.3, GREEN, cx, 5.05, S.z1 - 0.2)); // the garland across
  for (const [x, c] of [[-4.8, "#2f6fb5"], [-4, RED], [3.6, GREEN]]) st.push(box(0.55, 0.55, 0.55, c, x, 1.25, S.z1 - 0.55, 0.4));
  const station = new THREE.Mesh(mergeGeometries(st), material);
  station.castShadow = station.receiveShadow = true;
  root.add(station);

  // bulbs: along the garland and every so often along the track, unlit by the scene so they glow at night
  const lights = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const spots = [];
  for (let k = 0; k <= 16; k++) spots.push([S.x0 + ((S.x1 - S.x0) * k) / 16, 4.85, S.z1 - 0.02]);
  for (let i = 0; i < N; i += 9) spots.push([left[i].x, left[i].y + 0.12, left[i].z], [right[i].x, right[i].y + 0.12, right[i].z]);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 4), lights, spots.length);
  const tints = ["#ffd66b", "#ff5a4e", "#7dff8a", "#ffffff", "#6bb8ff"];
  spots.forEach(([x, y, z], k) => {
    bulbs.setMatrixAt(k, _m.makeTranslation(x, y, z));
    bulbs.setColorAt(k, _c.set(tints[k % tints.length]));
  });
  bulbs.castShadow = false;
  root.add(bulbs);

  // The train: 5 cars, one rider each, red and green in turn, with snow-white trim, gold wheels and
  // a cushion. The first has a tall curled front with a wreath, a bell and a lamp. Each car follows
  // the track on its own and stays level (it only turns): tilted with the slopes, the cars looked
  // wrong under riders whose sprites always stand up. A car's front is +z.
  const wheel = (x, z) => {
    const g = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10);
    g.applyMatrix4(_m.makeRotationZ(Math.PI / 2).setPosition(x, 0.22, z));
    return paint(g, GOLD);
  };
  const carGeometry = (body, first) => {
    const g = [
      box(1.5, 0.55, 1.5, body, 0, 0.62, 0), // body
      box(1.58, 0.14, 1.58, WHITE, 0, 0.95, 0), // snow trim
      box(1.2, 0.16, 0.9, WHITE, 0, 0.98, -0.1), // cushion
      box(1.5, 0.55, 0.16, body, 0, 1.15, -0.72), // back rest
      box(1.56, 0.12, 0.2, GOLD, 0, 1.46, -0.72),
      box(0.12, 0.5, 0.12, IRON, 0, 0.45, -0.85), // coupler to the next car
      wheel(-0.78, 0.45),
      wheel(0.78, 0.45),
      wheel(-0.78, -0.45),
      wheel(0.78, -0.45),
    ];
    if (first)
      g.push(
        box(1.5, 1.1, 0.22, body, 0, 1.0, 0.72), // the tall front
        box(1.5, 0.24, 0.5, GOLD, 0, 1.62, 0.82), // its curl
        box(0.7, 0.7, 0.12, GREEN, 0, 1.0, 0.86), // wreath
        box(0.32, 0.2, 0.14, RED, 0, 1.3, 0.9), // its bow
        box(0.24, 0.3, 0.24, GOLD, 0.55, 1.85, 0.82), // bell
        box(0.3, 0.22, 0.12, "#fff3b0", -0.5, 0.75, 0.86), // lamp
      );
    else g.push(box(1.5, 0.75, 0.16, body, 0, 0.95, 0.72)); // a lower front
    return mergeGeometries(g);
  };
  const cars = [];
  for (let k = 0; k < COASTER.seats; k++) {
    const car = new THREE.Mesh(carGeometry(k % 2 ? GREEN : RED, k === 0), material);
    car.castShadow = false; // it moves: no lamp should redraw its shadow passes for it
    car.receiveShadow = true;
    root.add(car);
    cars.push(car);
  }

  return {
    root,
    /** @param {number} time room time in ms @param {number} day 0 night .. 1 day */
    update(time, day) {
      const u = coasterU(time);
      cars.forEach((car, k) => {
        const cu = carU(u, k);
        curve.getPointAt(cu, p);
        curve.getTangentAt(cu, t);
        car.position.copy(p).y -= 0.15; // the wheels on the rails
        car.rotation.set(0, Math.atan2(t.x, t.z), 0); // level, turned the way it goes
      });
      lights.color.setScalar(1 - 0.35 * day); // they shine at night and are only coloured glass by day
    },
  };
}

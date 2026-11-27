// Roller coaster: its station on the grass below the pond, between the carousel and the Ferris wheel.
// From there the track runs between the pond and the wheel to the east edge of the town, climbs a chain lift
// over the pines, drops into the forest and through a loop, crosses the north edge (a second loop at
// the road's way out), comes down the west edge over a row of hills, and back across the pond, close
// to the water, to the station. It keeps to the inner row of pines along the edges, so the outer row
// still hides the end of the town; where it runs low, the pines in its way are taken out as the town
// loads. Built in code, no new art.
//
// Three trains of 5 cars run by the room's clock, the same for every player, a third of a cycle apart:
// each waits at the station for BOARD_MS (press E to take a seat), rides for RIDE_MS and is back at
// the station for its next cycle, where its riders get off. While one waits the other two are out, so
// there is never more than one at the station. Their 15 seats (one per car) are 32..46, train by
// train; the server refuses one outside its train's boarding time (worker/index.js), so a late or
// forged sit can't put someone on a moving train.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const COASTER = {
  firstSeat: 32, // after the benches (0..15), the carousel (16..23) and the Ferris wheel (24..31)
  trains: 3,
  cars: 5, // per train, one rider each
  seats: 15, // trains * cars
  boardMs: 7000, // the train waits at the station: shorter than a third of a cycle, minus the ~2.7 s a train needs to come in (or the next one runs into it)
  rideMs: 22000, // then rides the track, about 1.7 times its gravity pace (NATURAL_RIDE_S); also in worker/index.js
  clear: { x0: -10, x1: 10, z0: 37.5, z1: 50 }, // the station's grass: a pine whose center falls in here is taken out
  // the station: its deck nobody walks into, and where riders get off (north of it)
  station: { x0: -6.5, x1: 4.5, z0: 43.8, z1: 46.4 },
  exitZ: 42.4,
};
const CYCLE_MS = COASTER.boardMs + COASTER.rideMs;
// the client stops offering a seat this long before the doors close, so the server's "no" (it
// allows a little lateness for the trip) never has to stand someone up again
const BOARD_MARGIN_MS = 800;

// ---- The track ----
// Its centre line, relative to the station's ground: x, height, z. The pines stand about 10.5 high;
// where the track is lower than PINE_TOP the pines near it are taken out, so it runs through a cut
// in the forest. The train's first car stops at the first point, heading east (+x).
const PINE_TOP = 12.5;
const P = [];
const at = (x, y, z) => P.push([x, y, z]) - 1;
const loops = []; // { from, to: the points before and after it, side: its sideways axis }: there the train turns upside down
// A vertical loop: from `e`, going `d` (unit, flat), up and over and back down, shifted `shift`
// sideways along `s` so the way out passes beside the way in.
function loop(e, d, s, r, shift) {
  const n = 12;
  const first = P.length;
  for (let k = 1; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    at(
      e[0] + d[0] * r * Math.sin(a) + s[0] * shift * (k / n),
      e[1] + r * (1 - Math.cos(a)),
      e[2] + d[2] * r * Math.sin(a) + s[2] * shift * (k / n),
    );
  }
  loops.push({ from: first - 1, to: P.length, side: s }); // from the way in to the way out, both level
}
// the station, heading east, then north between the pond and the Ferris wheel, high enough to walk
// under (the wheel's west side is a way through)
at(2, 1.2, 45);
at(4.6, 1.25, 45.4);
at(8, 1.5, 45.6);
at(10.8, 2.8, 43.6);
at(12, 4.5, 40);
at(12.6, 5, 36);
// the chain lift: east past the wheel's north side, then north along the inner row of the east edge's
// pines (the outer row stays, hiding the end of the town), out over their tops
at(15, 5.2, 32.6);
at(20, 5.8, 31.4);
at(24.6, 7.5, 29.6);
at(26.9, 10, 24);
at(26.9, 13.5, 19);
at(26.9, 16.5, 14);
const LIFT_TOP = at(26.9, 18, 8);
// the drop into the forest, and the first loop (shifted toward the town)
at(26.9, 15, 2);
at(26.9, 8, -4);
at(26.9, 3.2, -10);
at(26.9, 2.6, -15);
loop([26.9, 2.6, -15], [0, 0, -1], [-1, 0, 0], 4.2, 3.4);
at(23.5, 2.6, -15);
at(23.6, 3.4, -22);
// round the north-east corner, over the pines and down to the road's way out, the second loop there
at(25.2, 6.5, -32);
at(22, 10, -38.5);
at(16, 13.5, -41);
at(9, 8, -41);
at(4, 4, -41);
at(-1, 3, -41);
loop([-1, 3, -41], [-1, 0, 0], [0, 0, 1], 4.2, 3.4);
at(-1, 3, -37.6);
at(-7, 4, -37.8);
at(-13, 9, -39.5);
at(-19, 13.5, -41);
at(-24, 10, -40);
// south along the inner row of the west edge's pines, over a row of hills
at(-26.9, 7, -35);
at(-26.9, 4, -28);
at(-26.9, 8.5, -18);
at(-26.9, 3.5, -8);
at(-26.9, 8.5, 2);
at(-26.9, 3.5, 12);
at(-26.5, 5, 19);
at(-25.5, 4, 25);
// east, past the carousel, and across the pond close to the water
at(-24, 3, 29);
at(-17, 2.8, 31.6);
at(-10, 2, 31.5);
at(-5, 0.9, 31);
at(1, 0.9, 30.8);
at(6, 2.2, 31.5);
// the brakes, round into the station
const BRAKES = at(8.5, 2.6, 35);
at(7.5, 2.2, 39.5);
at(4, 1.6, 41.6);
at(-1, 1.4, 41.8);
at(-6, 1.4, 41.9);
at(-7.4, 1.3, 43.2);
at(-6.2, 1.2, 44.7);
at(-4.2, 1.2, 45);
at(-1, 1.2, 45);

const curve = new THREE.CatmullRomCurve3(
  P.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  "centripetal",
);
curve.arcLengthDivisions = 6000; // a long track: finer, so equal steps of u are equal lengths

// ---- Frames ----
// Every SAMPLES of the track: where it is, which way it goes, and which way is "up" for the cars.
// Off the loops, up is the world's up (tilted with the slopes, never rolled sideways). In a loop it
// is square to the loop's plane: the way the track goes crossed with the loop's sideways axis, which
// is the world's up on the way in and out and straight down at the top.
const SAMPLES = 3000;
const POS = [],
  TAN = [],
  UPV = [];
const UP = new THREE.Vector3(0, 1, 0);
const nearestSample = (i) => {
  const [x, y, z] = P[i];
  let best = 0,
    bestD = Infinity;
  for (let k = 0; k < SAMPLES; k++) {
    const d = (POS[k].x - x) ** 2 + (POS[k].y - y) ** 2 + (POS[k].z - z) ** 2;
    if (d < bestD) (best = k), (bestD = d);
  }
  return best;
};
for (let k = 0; k < SAMPLES; k++) {
  POS.push(curve.getPointAt(k / SAMPLES));
  TAN.push(curve.getTangentAt(k / SAMPLES));
}
const LOOP_SAMPLES = loops.map((l) => ({ a: nearestSample(l.from), b: nearestSample(l.to), side: new THREE.Vector3(...l.side) }));
{
  const BLEND = 24; // samples at each end of a loop where its up and the world's are blended
  for (let k = 0; k < SAMPLES; k++) {
    const t = TAN[k];
    const up = UP.clone().addScaledVector(t, -UP.dot(t)).normalize();
    for (const { a, b, side } of LOOP_SAMPLES) {
      if (k <= a - BLEND || k >= b + BLEND) continue;
      const inLoopUp = new THREE.Vector3().crossVectors(t, side).normalize();
      // 1 well inside the loop, easing to 0 just outside its ends
      const w = Math.min(1, (k - (a - BLEND)) / (2 * BLEND), ((b + BLEND) - k) / (2 * BLEND));
      up.lerp(inLoopUp, w * w * (3 - 2 * w));
    }
    up.addScaledVector(t, -up.dot(t)).normalize(); // square with the track
    UPV.push(up);
  }
}
const LIFT_END = nearestSample(LIFT_TOP);
const BRAKES_START = nearestSample(BRAKES);
export const TRACK_LENGTH = curve.getLength();

// frame at u (0..1): position, tangent and up, between the two samples around it
const _a = new THREE.Vector3();
function frameAt(u, pos, tan, up) {
  const f = (((u % 1) + 1) % 1) * SAMPLES;
  const k = Math.floor(f) % SAMPLES,
    k2 = (k + 1) % SAMPLES,
    w = f - Math.floor(f);
  pos.lerpVectors(POS[k], POS[k2], w);
  tan.lerpVectors(TAN[k], TAN[k2], w).normalize();
  up.lerpVectors(UPV[k], UPV[k2], w);
  up.addScaledVector(tan, -up.dot(tan)).normalize();
}

// ---- Speed ----
// Time along the ride -> place along the track (0..1). Sampled once: a steady push out of the
// station and up the chain lift, then gravity (faster the lower it is, from the top of the lift),
// and the brakes into the station. The whole is scaled to last exactly RIDE_MS, so every browser
// finds the train at the same place.
const G = 9.8;
const speedAt = (k) => {
  if (k <= LIFT_END) return k < LIFT_END * 0.4 ? 6 : 4.5; // out of the station, then the chain lift
  const v = Math.max(4, Math.sqrt(4.5 ** 2 + 2 * G * Math.max(0, POS[LIFT_END].y - POS[k].y)));
  if (k < BRAKES_START) return v;
  const left = (SAMPLES - k) / (SAMPLES - BRAKES_START); // 1 at the brakes' start .. 0 at the station
  return Math.min(v, 1.2 + 9 * left);
};
const rideTable = (() => {
  const t = [0];
  const step = TRACK_LENGTH / SAMPLES;
  for (let k = 1; k <= SAMPLES; k++) t.push(t[k - 1] + step / ((speedAt(k - 1) + speedAt(k % SAMPLES === 0 ? SAMPLES - 1 : k)) / 2));
  return t.map((v) => v / t[SAMPLES]); // 0..1 of the ride time at each sample
})();
/** the ride's length in seconds at the speeds above, before scaling to RIDE_MS (for tuning) */
export const NATURAL_RIDE_S = (() => {
  let s = 0;
  const step = TRACK_LENGTH / SAMPLES;
  for (let k = 0; k < SAMPLES; k++) s += step / speedAt(k);
  return s;
})();
const placeAt = (rideT) => {
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

// ---- Cycles ----
// Train n runs n thirds of a cycle after train 0. Times below are a train's own: room time minus its offset.
const trainOf = (seat) => Math.floor((seat - COASTER.firstSeat) / COASTER.cars);
const offsetOf = (train) => (train * CYCLE_MS) / COASTER.trains;
const phaseOf = (t, train = 0) => ((((t - offsetOf(train)) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS);
/** @returns {number} which cycle of seat's train room time t is in: a rider gets off when it moves on */
export const coasterCycle = (t, seat) => Math.floor((t - offsetOf(trainOf(seat))) / CYCLE_MS);
const boardingTrain = (t, train) => phaseOf(t, train) < COASTER.boardMs - BOARD_MARGIN_MS;
/** @returns {boolean} seat's train is out on the track: nobody gets on or off */
export const coasterRiding = (t, seat) => phaseOf(t, trainOf(seat)) >= COASTER.boardMs;
/** @returns {number} where train's first car is on the track (0..1) at room time t */
const coasterU = (t, train) => {
  const p = phaseOf(t, train);
  return p < COASTER.boardMs ? 0 : placeAt((p - COASTER.boardMs) / COASTER.rideMs);
};
/**
 * For the countdown over the station: the seconds left to board the train that waits there, or
 * (none waits) the seconds until the next one starts taking riders.
 * @returns {{board: number, next: number}}
 */
export function coasterCountdown(t) {
  let next = Infinity;
  for (let n = 0; n < COASTER.trains; n++) {
    const p = phaseOf(t, n);
    if (p < COASTER.boardMs - BOARD_MARGIN_MS) return { board: Math.ceil((COASTER.boardMs - BOARD_MARGIN_MS - p) / 1000), next: 0 };
    next = Math.min(next, CYCLE_MS - p);
  }
  return { board: 0, next: Math.ceil(next / 1000) };
}
const CAR_GAP = 1.75; // from one car's centre to the next, along the track
// car k (0 = the first) sits CAR_GAP * k behind the first one, along the track
const carU = (u, k) => (((u - (CAR_GAP * k) / TRACK_LENGTH) % 1) + 1) % 1;

// ---- Where the pines come out ----
// The samples where the track runs lower than the pines' tops, a few apart (enough to find them)
const LOW = POS.filter((p, k) => k % 4 === 0 && p.y < PINE_TOP);
const PINE_GAP = 4.6; // a pine's crown is about 3.5 wide each side, and a car about 0.8
/** @returns {boolean} a pine at (x, z) is taken out: on the station's grass, or in the track's way */
export const inCoasterClearing = (x, z) => {
  const c = COASTER.clear;
  if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
  return LOW.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < PINE_GAP * PINE_GAP);
};
/** @returns {boolean} that seat id is one of the train's */
export const isCoasterSeat = (id) => id >= COASTER.firstSeat && id < COASTER.firstSeat + COASTER.seats;

// the sprite direction closest to the way something moves
const facing = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up");
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const RIDER_LIFT = 0.45; // a rider's sprite origin (the feet) over the track, along the car's up

/**
 * Where seat i's rider is at room time t, which way they look (the way the train goes), and the
 * car's frame: `up` (for drawing the rider turned with the car, and the first-person view) and
 * `fwd` (the way it goes). Seat i is a car of a train, the rider in its middle.
 * @param {number} i seat 0..14 (train i / 5, car i % 5) @param {number} t room time in ms @param {number} groundY the station's ground
 * @returns {{x: number, y: number, z: number, dir: string, board: boolean, up: number[], fwd: number[], train: number}}
 */
export function coasterSeat(i, t, groundY) {
  const train = Math.floor(i / COASTER.cars);
  frameAt(carU(coasterU(t, train), i % COASTER.cars), _p, _t, _u);
  return {
    x: _p.x + _u.x * RIDER_LIFT,
    z: _p.z + _u.z * RIDER_LIFT,
    y: groundY + _p.y + _u.y * RIDER_LIFT,
    dir: facing(_t.x, _t.z),
    board: boardingTrain(t, train),
    up: [_u.x, _u.y, _u.z],
    fwd: [_t.x, _t.y, _t.z],
    train,
  };
}

// ---- Collision ----
// Only the station's deck. The track's posts block nobody: thin as they are, they would leave only
// narrow gaps, so trainers walk through them.
/** @returns {boolean} the point is on the station's deck, or within `r` of it */
export function onCoaster(x, z, r = 0) {
  const s = COASTER.station;
  return x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r;
}

// ---- Model ----
// Primitives moved into place, painted with vertex colours and merged: the track and its posts, the
// station and the bulbs are one draw call each, and each of the 15 cars one more.
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _s = new THREE.Vector3();
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

// Light along the ride, at night: the track runs through the forest at the town's edges, far from
// the lamp posts. Real lights cost every lit surface a little each frame (and a shadowed one 6
// shadow passes), so: a warm headlight on each train, a few lamps (none with a shadow) where the
// track is darkest, and soft halos around the track's bulbs, which only glow and light nothing.
const LAMP_AT = [
  [26.9, -15], // the first loop
  [-3, -41], // the second loop, where the road leaves town
  [-26.9, -15], // the hills down the west edge
  [-26.9, 10],
];
const HEADLIGHT = 60,
  LAMP = 45;
let halo = null; // a soft round glow, drawn once
function haloTexture() {
  if (halo || typeof document === "undefined") return halo;
  const cv = document.createElement("canvas");
  if (!cv.getContext) return null; // not a browser (tests)
  cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (halo = new THREE.CanvasTexture(cv));
}

/**
 * The coaster: `root` goes in the scene at the station's ground height, `update(t, day)` moves the trains.
 * @param {{lamps?: boolean}} [o] lamps: the fixed lamps along the track (left out on phones: each light costs every lit surface)
 * @returns {{root: THREE.Group, update: (t: number, day: number) => void}}
 */
export function createCoaster({ lamps = true } = {}) {
  const root = new THREE.Group();
  root.name = "RollerCoaster";

  // the track: two rails (tubes along the curve, set off to each side of the cars' frame), ties and posts
  const parts = [];
  const left = [],
    right = [];
  const side = new THREE.Vector3();
  const RAIL_STEP = 2; // samples between rail points
  const postEvery = Math.round(3.2 / (TRACK_LENGTH / SAMPLES)); // a post about every 3.2
  for (let k = 0; k < SAMPLES; k += RAIL_STEP) {
    const p = POS[k],
      up = UPV[k];
    side.crossVectors(TAN[k], up).normalize();
    const l = p.clone().addScaledVector(side, -GAUGE),
      r = p.clone().addScaledVector(side, GAUGE);
    left.push(l);
    right.push(r);
    if ((k / RAIL_STEP) % 2 === 0) parts.push(strut(l.clone().addScaledVector(up, -0.12), r.clone().addScaledVector(up, -0.12), 0.14, WOOD)); // a tie
    // a post down to the ground (or the pond's bed), where the track is right way up
    if (k % postEvery < RAIL_STEP && p.y > 1.4 && up.y > 0.85) {
      parts.push(strut(new THREE.Vector3(p.x, -1.5, p.z), p.clone().addScaledVector(up, -0.2), 0.24, WHITE));
      parts.push(strut(l.clone().addScaledVector(up, -0.25), r.clone().addScaledVector(up, -0.25), 0.18, WHITE));
    }
  }
  for (const rail of [left, right]) {
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rail, true, "centripetal"), rail.length, 0.08, 4, true);
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
  for (let k = 0; k <= 16; k++) spots.push(new THREE.Vector3(S.x0 + ((S.x1 - S.x0) * k) / 16, 4.85, S.z1 - 0.02));
  const bulbEvery = Math.max(1, Math.round(2.4 / ((TRACK_LENGTH / SAMPLES) * RAIL_STEP))); // one about every 2.4
  for (let k = 0; k < left.length; k += bulbEvery) {
    const up = UPV[k * RAIL_STEP];
    spots.push(left[k].clone().addScaledVector(up, 0.12), right[k].clone().addScaledVector(up, 0.12));
  }
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 6, 4), lights, spots.length);
  const tints = ["#ffd66b", "#ff5a4e", "#7dff8a", "#ffffff", "#6bb8ff"];
  spots.forEach((v, k) => {
    bulbs.setMatrixAt(k, _m.makeTranslation(v.x, v.y, v.z));
    bulbs.setColorAt(k, _c.set(tints[k % tints.length]));
  });
  bulbs.castShadow = false;
  root.add(bulbs);
  // their halos at night: one point sprite on every other bulb, added to what is behind it
  const haloMap = haloTexture();
  let halos = null;
  if (haloMap) {
    const hp = new Float32Array(Math.ceil(spots.length / 2) * 3);
    spots.forEach((v, k) => k % 2 === 0 && v.toArray(hp, (k / 2) * 3));
    const hg = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(hp, 3));
    halos = new THREE.Points(hg, new THREE.PointsMaterial({ map: haloMap, color: "#ffd88a", size: 1.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    root.add(halos);
  }
  // the lamps, a little over the track where it is darkest
  const fixed = [];
  if (lamps)
    for (const [lx, lz] of LAMP_AT) {
      let best = 0,
        bestD = Infinity;
      POS.forEach((q, k) => {
        const d = (q.x - lx) ** 2 + (q.z - lz) ** 2;
        if (d < bestD) (best = k), (bestD = d);
      });
      const light = new THREE.PointLight("#ffd28a", 0, 18, 1.6);
      light.position.copy(POS[best]).y += 2.5;
      root.add(light);
      fixed.push(light);
    }
  // a headlight on each train's first car, a little ahead of it
  const headlights = [];
  for (let n = 0; n < COASTER.trains; n++) {
    const light = new THREE.PointLight("#ffe2a8", 0, 16, 1.6);
    root.add(light);
    headlights.push(light);
  }

  // The train: 5 cars, one rider each, red and green in turn, with snow-white trim, gold wheels and
  // a cushion. The first has a tall curled front with a wreath, a bell and a lamp. Each car follows
  // the track on its own frame: level off the loops (it never rolls sideways), over the top in them.
  // A car's front is +z, its up +y.
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
  const cars = []; // train by train
  for (let k = 0; k < COASTER.seats; k++) {
    const car = new THREE.Mesh(carGeometry(k % 2 ? GREEN : RED, k % COASTER.cars === 0), material);
    car.castShadow = false; // it moves: no lamp should redraw its shadow passes for it
    car.receiveShadow = true;
    car.matrixAutoUpdate = false; // placed by its frame every frame
    root.add(car);
    cars.push(car);
  }
  const p = new THREE.Vector3(),
    t = new THREE.Vector3(),
    up = new THREE.Vector3(),
    x = new THREE.Vector3();

  return {
    root,
    /** @param {number} time room time in ms @param {number} day 0 night .. 1 day */
    update(time, day) {
      cars.forEach((car, k) => {
        frameAt(carU(coasterU(time, Math.floor(k / COASTER.cars)), k % COASTER.cars), p, t, up);
        x.crossVectors(up, t); // the car's x, so that x, up, front make a right-handed frame
        car.matrix.makeBasis(x, up, t).setPosition(p.addScaledVector(up, -0.15)); // the wheels on the rails
        if (k % COASTER.cars === 0) headlights[k / COASTER.cars].position.copy(p).addScaledVector(t, 2).addScaledVector(up, 1.6);
      });
      lights.color.setScalar(1 - 0.35 * day); // they shine at night and are only coloured glass by day
      const night = Math.max(0, 1 - day * 1.6); // out a little before full day
      for (const l of headlights) l.intensity = HEADLIGHT * night;
      for (const l of fixed) l.intensity = LAMP * night;
      if (halos) (halos.visible = night > 0.02), (halos.material.opacity = 0.85 * night);
    },
  };
}

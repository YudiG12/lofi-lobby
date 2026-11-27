// Christmas carousel: a merry-go-round on the grass south of the sand path, where the pines were
// taken out for it (src/main.js removes them as the town loads). Built in code in the town's
// low-poly look, no new art. It turns by the room's clock, so every player sees the same horse in
// the same place without one message more; its horses are seats 16..23, kept by the server like
// the bench seats (MAX_SEATS in worker/index.js).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const CAROUSEL = {
  x: -19, // center, on the flat grass the pines leave
  z: 39,
  clear: { x0: -28, x1: -10, z0: 28, z1: 50 }, // a pine whose center falls in here is taken out
  seats: 8,
  firstSeat: 16, // right after the 16 bench seats
  ring: 3, // the horses' distance from the pole
  base: 4.6, // radius of the round base nobody walks into
  turnMs: 40000, // one turn: slow, so names and chat bubbles stay readable
};
const TAU = Math.PI * 2;
const SADDLE = 2; // saddle height over the ground
// a sitter's sprite origin (the feet) under the saddle: the same 0.65 from feet to hips as on a bench
const SIT_DROP = 0.65;
const BOB = 0.25; // how far a horse goes up and down
const TOP = 6.4; // height of the ring the horse poles hang from

/** @returns {boolean} the point is where the carousel's pines are taken out */
export const inClearing = (x, z) => {
  const c = CAROUSEL.clear;
  return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
};
/** @returns {boolean} the point is on the base, or within `r` of it */
export const onCarousel = (x, z, r = 0) => Math.hypot(x - CAROUSEL.x, z - CAROUSEL.z) < CAROUSEL.base + r;
/** @returns {boolean} that seat id is one of the horses */
export const isCarouselSeat = (id) => id >= CAROUSEL.firstSeat && id < CAROUSEL.firstSeat + CAROUSEL.seats;

// the turn at room time t (ms), in radians
const turnAt = (t) => (((t % CAROUSEL.turnMs) + CAROUSEL.turnMs) % CAROUSEL.turnMs / CAROUSEL.turnMs) * TAU;
// horse i's height over its rest, up and down a few times per turn, each horse out of step with the next
const bobAt = (turn, i) => BOB * Math.sin(turn * 6 + i * 2.4);
// the sprite direction closest to the way something moves
const facing = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "right" : "left") : dz > 0 ? "down" : "up");

/**
 * Where horse i is at room time t, and which way its rider looks (the way it goes).
 * A horse at angle a stands at (sin a, cos a) times the ring: that is where rotation.y = a puts it.
 * @param {number} i horse 0..7 @param {number} t room time in ms @param {number} groundY the base's ground
 * @returns {{x: number, y: number, z: number, dir: string}}
 */
export function carouselSeat(i, t, groundY) {
  const turn = turnAt(t);
  const a = turn + (i / CAROUSEL.seats) * TAU;
  const s = Math.sin(a),
    c = Math.cos(a);
  return {
    x: CAROUSEL.x + CAROUSEL.ring * s,
    z: CAROUSEL.z + CAROUSEL.ring * c,
    y: groundY + SADDLE - SIT_DROP + bobAt(turn, i),
    dir: facing(c, -s), // turning toward a larger angle moves along (cos a, -sin a)
  };
}

// ---- Model ----
// Each part is a primitive moved into place and painted with vertex colours, and the parts are merged:
// the whole carousel is a dozen draw calls (base, top, 8 horses, lights, star).
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();
/**
 * @param {THREE.BufferGeometry} geo
 * @param {string | ((x: number, y: number, z: number) => string)} paint a colour, or one per triangle from its center
 */
function part(geo, paint, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.applyMatrix4(_m.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let v = 0; v < p.count; v += 3) {
    // flat shading: one colour per triangle, picked at its center
    const cx = (p.getX(v) + p.getX(v + 1) + p.getX(v + 2)) / 3,
      cy = (p.getY(v) + p.getY(v + 1) + p.getY(v + 2)) / 3,
      cz = (p.getZ(v) + p.getZ(v + 1) + p.getZ(v + 2)) / 3;
    _c.set(typeof paint === "function" ? paint(cx, cy, cz) : paint);
    for (let k = 0; k < 3; k++) _c.toArray(col, (v + k) * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
const RED = "#c8312d",
  WHITE = "#f4eee2",
  GOLD = "#d9a92e",
  GREEN = "#2f7d3a",
  DARK_GREEN = "#1f5a2b";
// stripes around an axis: n of them, red and white
const stripes = (n, a = RED, b = WHITE) => (x, y, z) => (Math.floor(((Math.atan2(x, z) + Math.PI) / TAU) * n) % 2 ? a : b);
const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// A horse, its front toward +x (the way the carousel carries it), the saddle on top at SADDLE
function horseGeometry(coat, mane) {
  const y = SADDLE;
  const parts = [
    part(new THREE.BoxGeometry(1.5, 0.55, 0.45), coat, { y: y - 0.35 }), // body
    part(new THREE.BoxGeometry(0.3, 0.7, 0.32), coat, { x: 0.62, y: y + 0.05, rz: -0.45 }), // neck
    part(new THREE.BoxGeometry(0.6, 0.3, 0.3), coat, { x: 0.92, y: y + 0.38, rz: 0.25 }), // head
    part(new THREE.BoxGeometry(0.14, 0.62, 0.36), mane, { x: 0.52, y: y + 0.2, rz: -0.45 }), // mane
    part(new THREE.BoxGeometry(0.4, 0.14, 0.14), mane, { x: -0.86, y: y - 0.3, rz: 0.7 }), // tail
    part(new THREE.BoxGeometry(0.55, 0.1, 0.5), RED, { y: y - 0.04 }), // saddle
    part(new THREE.BoxGeometry(0.57, 0.04, 0.52), GOLD, { y: y - 0.1 }), // its trim
  ];
  // legs, mid-gallop: front ones reaching forward, back ones kicked back
  for (const [lx, tilt] of [[0.55, 0.55], [-0.55, -0.5]])
    for (const lz of [-0.15, 0.15]) parts.push(part(new THREE.BoxGeometry(0.13, 0.62, 0.13), coat, { x: lx, y: y - 0.85, z: lz, rz: tilt }));
  return mergeGeometries(parts);
}

/**
 * The carousel: `root` goes in the scene at the base's ground height, `update(t, day)` turns it.
 * @returns {{root: THREE.Group, update: (t: number, day: number) => void}}
 */
export function createCarousel() {
  const root = new THREE.Group();
  root.name = "Carousel";
  root.position.set(CAROUSEL.x, 0, CAROUSEL.z);

  // still: the round base, its red trim and presents on its rim
  const base = [
    part(new THREE.CylinderGeometry(CAROUSEL.base, CAROUSEL.base + 0.1, 0.45, 24), "#cdbb9c", { y: 0.225 }),
    part(new THREE.CylinderGeometry(CAROUSEL.base + 0.12, CAROUSEL.base + 0.12, 0.12, 24), RED, { y: 0.4 }),
  ];
  for (const [a, size, box, ribbon] of [
    [0.4, 0.55, "#2f6fb5", GOLD],
    [0.75, 0.42, RED, WHITE],
    [2.6, 0.5, GREEN, RED],
    [3.9, 0.6, RED, GOLD],
    [4.25, 0.4, "#7a3fa0", WHITE],
    [5.6, 0.48, GREEN, GOLD],
  ]) {
    const x = Math.sin(a) * (CAROUSEL.base - 0.4),
      z = Math.cos(a) * (CAROUSEL.base - 0.4);
    const y = 0.45 + size / 2;
    base.push(
      part(new THREE.BoxGeometry(size, size, size), box, { x, y, z, ry: a }),
      part(new THREE.BoxGeometry(size + 0.02, size + 0.02, 0.1), ribbon, { x, y, z, ry: a }),
      part(new THREE.BoxGeometry(0.1, size + 0.02, size + 0.02), ribbon, { x, y, z, ry: a }),
    );
  }
  const still = new THREE.Mesh(mergeGeometries(base), material);
  still.castShadow = still.receiveShadow = true; // it never moves: the lamp shadows can keep it
  root.add(still);

  // turning: floor, candy-cane pole, striped canopy with a garland, the ring and the horses' poles.
  // Nothing that turns casts a shadow: a lamp would have to redraw its 6 shadow passes every frame.
  const spinner = new THREE.Group();
  root.add(spinner);
  const top = [
    part(new THREE.CylinderGeometry(CAROUSEL.ring + 0.8, CAROUSEL.ring + 0.8, 0.25, 24), stripes(16, "#e9d9b4", "#d7c093"), { y: 0.58 }),
    part(new THREE.CylinderGeometry(0.32, 0.32, TOP + 0.3, 12, 16), (x, y, z) => (Math.floor(y * 2.2 + (Math.atan2(x, z) / TAU) * 2 + 4) % 2 ? RED : WHITE), { y: (TOP + 0.3) / 2 + 0.5 }),
    // the canopy only covers the pole: a full roof would hide the riders from the camera, which looks down from the south
    part(new THREE.ConeGeometry(1.9, 1.3, 16), stripes(16), { y: TOP + 0.95 }),
    part(new THREE.TorusGeometry(1.9, 0.18, 6, 24), DARK_GREEN, { y: TOP + 0.3, rx: Math.PI / 2 }),
    part(new THREE.TorusGeometry(CAROUSEL.ring, 0.07, 4, 32), GOLD, { y: TOP, rx: Math.PI / 2 }),
  ];
  for (let i = 0; i < CAROUSEL.seats; i++) {
    const a = (i / CAROUSEL.seats) * TAU;
    const [x, z] = [Math.sin(a) * CAROUSEL.ring, Math.cos(a) * CAROUSEL.ring];
    top.push(
      part(new THREE.CylinderGeometry(0.05, 0.05, TOP - 0.7, 6), GOLD, { x, y: (TOP + 0.7) / 2, z }), // the horse's pole
      part(new THREE.BoxGeometry(CAROUSEL.ring, 0.08, 0.08), GOLD, { x: x / 2, y: TOP, z: z / 2, ry: a - Math.PI / 2 }), // spoke
    );
  }
  const frame = new THREE.Mesh(mergeGeometries(top), material);
  frame.castShadow = false;
  frame.receiveShadow = true;
  spinner.add(frame);

  const COATS = [["#f4f1ea", "#c9a24a"], ["#8a5a34", "#3b2618"], ["#d9d2c5", "#7a7268"], ["#5b3b2a", "#e8dcc4"]];
  const horses = [];
  for (let i = 0; i < CAROUSEL.seats; i++) {
    const a = (i / CAROUSEL.seats) * TAU;
    const h = new THREE.Mesh(horseGeometry(...COATS[i % COATS.length]), material);
    h.position.set(Math.sin(a) * CAROUSEL.ring, 0, Math.cos(a) * CAROUSEL.ring);
    h.rotation.y = a; // its +x along the way it is carried
    h.castShadow = false;
    h.receiveShadow = true;
    spinner.add(h);
    horses.push(h);
  }

  // lights: bulbs along the ring and baubles on the garland, unlit by the scene so they glow at night
  const lights = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const BULBS = 24,
    BAUBLES = 12;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), lights, BULBS + BAUBLES);
  const tints = ["#ffd66b", "#ff5a4e", "#7dff8a", "#ffffff", "#6bb8ff"];
  for (let i = 0; i < BULBS + BAUBLES; i++) {
    const bauble = i >= BULBS;
    const a = ((bauble ? i - BULBS : i) / (bauble ? BAUBLES : BULBS)) * TAU + (bauble ? 0.13 : 0);
    const r = bauble ? 1.9 : CAROUSEL.ring;
    const y = bauble ? TOP + 0.05 : TOP - 0.13;
    _m.compose(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r), _q.identity(), new THREE.Vector3().setScalar(bauble ? 1.4 : 1));
    bulbs.setMatrixAt(i, _m);
    bulbs.setColorAt(i, _c.set(tints[i % tints.length]));
  }
  bulbs.castShadow = false;
  spinner.add(bulbs);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: "#ffd23f" }));
  star.position.y = TOP + 1.85;
  star.scale.set(1, 1.3, 0.45);
  star.castShadow = false;
  spinner.add(star);

  return {
    root,
    /** @param {number} t room time in ms @param {number} day 0 night .. 1 day */
    update(t, day) {
      const turn = turnAt(t);
      spinner.rotation.y = turn;
      horses.forEach((h, i) => (h.position.y = bobAt(turn, i)));
      // the lights shine at night and are only coloured glass by day
      lights.color.setScalar(1 - 0.35 * day);
      star.rotation.y = -turn * 3; // it spins on its own, the other way
    },
  };
}

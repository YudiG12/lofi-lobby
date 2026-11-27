// Water lilies on the pond and a frog that hops between them. Where the frog is comes only from the
// room's clock (main.js passes roomNow()), so everyone sees it on the same pad, with no message.
import * as THREE from "three";

// ---- Lily pads ----
const padMat = new THREE.MeshLambertMaterial({ color: "#4f8a3a", flatShading: true, side: THREE.DoubleSide });
const rimMat = new THREE.MeshLambertMaterial({ color: "#8a3b3b", flatShading: true, side: THREE.DoubleSide });
const petalMat = new THREE.MeshLambertMaterial({ color: "#f3c1d3", flatShading: true });
const heartMat = new THREE.MeshLambertMaterial({ color: "#f5d36b", flatShading: true });
const NOTCH = 0.35; // the slit every pad has, in radians

/** A giant water lily: a flat pad with a slit and its rim turned up, its origin on the water. */
export function createLilyPad(r, flower = false) {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 20, NOTCH / 2, Math.PI * 2 - NOTCH).rotateX(-Math.PI / 2), padMat);
  pad.position.y = 0.02;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.97, 0.14, 20, 1, true, Math.PI / 2 + NOTCH / 2, Math.PI * 2 - NOTCH), rimMat);
  rim.position.y = 0.07;
  g.add(pad, rim);
  if (flower) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), petalMat);
      petal.scale.set(1, 0.6, 1.8);
      petal.position.set(Math.cos(a) * 0.18, 0.14, Math.sin(a) * 0.18);
      petal.rotation.y = -a + Math.PI / 2;
      g.add(petal);
    }
    const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), heartMat);
    heart.position.y = 0.2;
    g.add(heart);
  }
  g.traverse((o) => o.isMesh && (o.receiveShadow = true));
  g.rotation.y = r * 7.3; // the slits don't all point the same way
  return g;
}

// ---- Frog ----
// 3 frames side by side, 16x12 logical pixels each, drawn at 2x: 0 sitting, 1 blink, 2 jumping
const W = 16,
  H = 12,
  P = 2,
  FRAMES = 3;
const C = { body: "#5fae3e", dark: "#3d7d2a", belly: "#c9e08a", eye: "#f5f0c8", pupil: "#1b1b24", mouth: "#2a5a1e", outline: "#1b1b24" };
export const HOP_MS = 3500; // a hop to another pad this often
const JUMP_MS = 600; // how long a hop is in the air
const ARC = 1.4; // how high it goes at the middle of a hop

function drawFrame(c, f) {
  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const fill = (x, y, col) => x >= 0 && x < W && y >= 0 && y < H && (grid[y][x] = col);
  const jumping = f === 2;
  const top = jumping ? 2 : 4; // stretched up while in the air
  // body: a wide, low dome, belly lighter
  for (let y = top; y < H - 1; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - 7.5) / 6,
        dy = (y - (H - 1)) / (H - 1 - top);
      if (dx * dx + dy * dy > 1) continue;
      const bx = (x - 7.5) / 3.2,
        by = (y - (H - 1)) / ((H - 1 - top) * 0.6);
      fill(x, y, bx * bx + by * by <= 1 ? C.belly : C.body);
    }
  // spots on the back
  fill(4, top + 3, C.dark), fill(11, top + 2, C.dark), fill(10, top + 4, C.dark);
  // the eyes bulging on top
  for (const ex of [4, 10]) {
    for (let y = top - 2; y < top + 1; y++) for (let x = ex; x < ex + 2; x++) fill(x, y, C.body);
    if (f === 1) fill(ex, top - 1, C.dark), fill(ex + 1, top - 1, C.dark);
    else fill(ex, top - 1, C.eye), fill(ex + 1, top - 1, C.eye), fill(ex === 4 ? ex + 1 : ex, top - 1, C.pupil); // looking at the middle
  }
  // the mouth, a wide line
  for (let x = 5; x < 11; x++) fill(x, top + 2, C.mouth);
  if (jumping) {
    // legs stretched down and out
    for (let i = 0; i < 3; i++) fill(3 - i, H - 2 + (i > 1 ? 1 : 0), C.dark), fill(12 + i, H - 2 + (i > 1 ? 1 : 0), C.dark);
  } else {
    // folded legs at the sides and the front feet
    for (let y = H - 4; y < H - 1; y++) fill(1, y, C.dark), fill(14, y, C.dark);
    fill(0, H - 1, C.dark), fill(1, H - 1, C.dark), fill(14, H - 1, C.dark), fill(15, H - 1, C.dark);
    fill(5, H - 1, C.dark), fill(10, H - 1, C.dark);
  }
  // outline: every empty pixel touching the frog
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (!grid[y][x] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => grid[y + b]?.[x + a]))
        out[y][x] = C.outline;
  const x0 = f * W * P;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (out[y][x]) {
        c.fillStyle = out[y][x];
        c.fillRect(x0 + x * P, y * P, P, P);
      }
}

/**
 * @param {(a: number, b: number) => number} hash the room's shared hash (catHash), so every tab picks the same pad
 */
export function createFrog(hash) {
  const cv = Object.assign(document.createElement("canvas"), { width: W * P * FRAMES, height: H * P });
  const c = cv.getContext("2d");
  for (let f = 0; f < FRAMES; f++) drawFrame(c, f);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / FRAMES, 1);
  const geo = new THREE.PlaneGeometry(1, H / W);
  geo.translate(0, H / W / 2, 0); // feet at the origin
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.45, alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  mesh.castShadow = true;
  mesh.scale.set(2.2, 2.2, 1);
  mesh.visible = false; // until there are pads

  const setFrame = (f) => (tex.offset.x = f / FRAMES);
  // The way it goes, worked out once from the pads: a walk where each hop is to one of the two
  // pads nearest the one it is on (or a pad that has it among its two nearest), and then the same
  // walk back, so it ends where it began and loops. Hop k is tour[k % length]: the same for everyone.
  let tour = [];
  const makeTour = (pads) => {
    const near = pads.map(() => new Set());
    pads.forEach((p, i) => {
      const byDistance = pads.map((q, j) => j).filter((j) => j !== i).sort((a, b) => p.distanceTo(pads[a]) - p.distanceTo(pads[b]));
      for (const j of byDistance.slice(0, 2)) near[i].add(j), near[j].add(i);
    });
    const walk = [0];
    for (let s = 1; s < 40; s++) {
      const at = walk[s - 1];
      const options = [...near[at]].filter((j) => j !== walk[s - 2]); // not straight back, if it can help it
      const pick = options.length ? options : [...near[at]];
      walk.push(pick[hash(5, s) % pick.length]);
    }
    tour = [...walk, ...walk.slice(1, -1).reverse()];
  };
  return {
    mesh,
    /** @param {number} t room time @param {THREE.Vector3[]} pads where each pad's middle is */
    update(t, pads) {
      if (pads.length < 2) return;
      if (!tour.length) makeTour(pads);
      mesh.visible = true;
      const k = Math.floor(t / HOP_MS);
      const from = pads[tour[(k - 1) % tour.length]],
        to = pads[tour[k % tour.length]];
      const u = Math.min(1, (t - k * HOP_MS) / JUMP_MS);
      mesh.position.lerpVectors(from, to, u);
      mesh.position.y += Math.sin(Math.PI * u) * ARC;
      if (u < 1) setFrame(2);
      else setFrame(t % 4000 < 150 ? 1 : 0); // blinks now and then
    },
  };
}

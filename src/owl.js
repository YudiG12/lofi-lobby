// Owls: pixel-art billboards that fly to wherever main.js points them (a perch picked by the room's
// clock, or a player's head the room picked), so everyone sees them in the same place.
import * as THREE from "three";

// 4 frames side by side, 16x16 logical pixels each, drawn at 2x like the trainers:
// 0 perched, 1 blink, 2-3 flying (wings up, wings down)
const W = 16,
  H = 16,
  P = 2,
  FRAMES = 4;
// ids match OWL_IDS in worker/index.js
export const OWLS = [
  {
    id: "brown",
    palette: { body: "#7a5230", dark: "#5e3c20", belly: "#c9a77a", speck: "#8a6640", disc: "#d8bf94", eye: "#ffcc33", pupil: "#1b1b24", beak: "#e0a030", outline: "#1b1b24" },
  },
  {
    id: "snowy",
    palette: { body: "#d9dde3", dark: "#9aa3ad", belly: "#f4f5f7", speck: "#aab2bc", disc: "#ffffff", eye: "#ffcc33", pupil: "#1b1b24", beak: "#4a4a55", outline: "#1b1b24" },
  },
];
const SPEED = 10; // units per second in the air
const ARC = 2; // how much higher than a straight line it flies, at the middle of the way

function drawFrame(c, f, C) {
  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const fill = (x, y, col) => x >= 0 && x < W && y >= 0 && y < H && (grid[y][x] = col);
  const flying = f >= 2;
  // body: a round egg, belly lighter and speckled
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - 7.5) / 4.6,
        dy = (y - 8.5) / 6;
      if (dx * dx + dy * dy > 1) continue;
      const bx = (x - 7.5) / 2.6,
        by = (y - 10.5) / 3.4;
      fill(x, y, bx * bx + by * by <= 1 ? ((x + y) % 3 ? C.belly : C.speck) : C.body);
    }
  // ear tufts
  fill(4, 2, C.dark), fill(3, 1, C.dark), fill(11, 2, C.dark), fill(12, 1, C.dark);
  // facial disc around the big eyes, and the beak between them
  for (const ex of [5.5, 9.5])
    for (let y = 3; y < 8; y++)
      for (let x = 3; x < 13; x++) if (Math.hypot(x - ex, y - 5) < 2) fill(x, y, C.disc);
  if (f === 1) for (const x of [5, 6, 9, 10]) fill(x, 5, C.dark);
  else
    for (const ex of [5, 9]) {
      fill(ex, 4, C.eye), fill(ex + 1, 4, C.eye), fill(ex, 5, C.eye), fill(ex + 1, 5, C.eye);
      fill(ex === 5 ? 6 : 9, 5, C.pupil);
    }
  fill(7, 6, C.beak), fill(8, 6, C.beak), fill(7, 7, C.beak);
  if (flying) {
    // wings spread out to the sides, raised or lowered
    const up = f === 2;
    for (let i = 0; i < 4; i++)
      for (let t = 0; t < 2; t++) {
        const y = up ? 8 - i + t : 8 + i + t;
        fill(3 - i, y, C.dark), fill(12 + i, y, C.dark);
      }
  } else {
    // folded wings along the sides, and the feet
    for (let y = 7; y < 13; y++) fill(3, y, C.dark), fill(12, y, C.dark);
    for (const x of [5, 6, 9, 10]) fill(x, 15, C.beak);
  }
  // outline: every empty pixel touching the owl
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

export function createOwl(palette) {
  const cv = Object.assign(document.createElement("canvas"), { width: W * P * FRAMES, height: H * P });
  const c = cv.getContext("2d");
  for (let f = 0; f < FRAMES; f++) drawFrame(c, f, palette);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / FRAMES, 1);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0); // feet at the origin, so it stands on its perch
  // a little light of its own: on a lamp's cap the bulb is below it, and it would be only a silhouette
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ map: tex, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking });
  mesh.castShadow = true;
  mesh.scale.set(2.5, 2.5, 1); // same pixel size as a trainer (5 units per 32px)
  mesh.visible = false; // until it has somewhere to go

  let key = null, // where it is going: main.js names it ("p3" a perch, "h<id>" a head)
    flight = null; // { from, start, time }
  const blink = Math.random() * 5000; // the owls don't blink together
  const setFrame = (f) => (tex.offset.x = f / FRAMES);
  return {
    mesh,
    // target: where its feet go, read again every frame (a head moves). A new key starts a flight
    // from where it is; the first one puts it there at once. Returns true while it flies.
    update(now, to, target) {
      if (key === null) (key = to), mesh.position.copy(target), (mesh.visible = true);
      else if (to !== key) {
        key = to;
        const from = mesh.position.clone();
        flight = { from, start: now, time: Math.max(1200, (from.distanceTo(target) / SPEED) * 1000) };
      }
      if (flight) {
        const t = Math.min(1, (now - flight.start) / flight.time);
        mesh.position.lerpVectors(flight.from, target, t);
        mesh.position.y += Math.sin(Math.PI * t) * ARC;
        setFrame(2 + (Math.floor(now / 120) % 2));
        if (t === 1) flight = null;
        return true;
      }
      setFrame((now + blink) % 5000 < 150 ? 1 : 0); // blinks every 5 s
      mesh.position.copy(target);
      return false;
    },
  };
}

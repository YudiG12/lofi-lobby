// Owl: a pixel-art billboard perched on the message wall's roof. Every so often, or when you walk
// up to its perch, it flies to another perch (the wall or the tops of the two nearest lamp posts).
// Only for you: nothing goes to the server.
import * as THREE from "three";

// 4 frames side by side, 16x16 logical pixels each, drawn at 2x like the trainers:
// 0 perched, 1 blink, 2-3 flying (wings up, wings down)
const W = 16,
  H = 16,
  P = 2,
  FRAMES = 4;
const C = {
  body: "#7a5230",
  dark: "#5e3c20",
  belly: "#c9a77a",
  speck: "#8a6640",
  disc: "#d8bf94",
  eye: "#ffcc33",
  pupil: "#1b1b24",
  beak: "#e0a030",
  outline: "#1b1b24",
};
const NEAR = 6; // walk this close to its perch and it flies off (the wall is 8 wide)
const SPEED = 10; // units per second in the air
const ARC = 2; // how much higher than a straight line it flies, at the middle of the way

function drawFrame(c, f) {
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

export function createOwl() {
  const cv = Object.assign(document.createElement("canvas"), { width: W * P * FRAMES, height: H * P });
  const c = cv.getContext("2d");
  for (let f = 0; f < FRAMES; f++) drawFrame(c, f);
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
  mesh.visible = false; // until it has somewhere to perch

  let perches = [],
    at = 0, // the perch it sits on (or flies to)
    nextAt = 0, // when it flies off on its own
    flight = null, // { from, to, start, time }
    calm = false; // landed next to you: it stays until you walk away and come back
  const rest = (now) => (nextAt = now + 20000 + Math.random() * 20000);
  const setFrame = (f) => (tex.offset.x = f / FRAMES);
  const near = (p, player) => Math.hypot(player.x - p.x, player.z - p.z) < NEAR;
  function flyOff(now, player) {
    const from = mesh.position.clone();
    const others = perches.map((_, i) => i).filter((i) => i !== at);
    // away from you if it can
    const away = others.filter((i) => !near(perches[i], player));
    const choices = away.length ? away : others;
    at = choices[Math.floor(Math.random() * choices.length)];
    const to = perches[at];
    flight = { from, to, start: now, time: Math.max(1200, (from.distanceTo(to) / SPEED) * 1000) };
  }
  return {
    mesh,
    // where it can sit (THREE.Vector3, feet position); it starts on the first one
    setPerches(points, now) {
      perches = points;
      at = 0;
      flight = null;
      mesh.position.copy(perches[0]);
      mesh.visible = true;
      rest(now);
    },
    // player: where you are, so it flies off when you come close
    update(now, player) {
      if (perches.length < 2) return;
      if (flight) {
        const t = Math.min(1, (now - flight.start) / flight.time);
        mesh.position.lerpVectors(flight.from, flight.to, t);
        mesh.position.y += Math.sin(Math.PI * t) * ARC;
        setFrame(2 + (Math.floor(now / 120) % 2));
        if (t === 1) (calm = near(flight.to, player)), (flight = null), rest(now);
        return;
      }
      setFrame(now % 5000 < 150 ? 1 : 0); // blinks every 5 s
      const close = near(perches[at], player);
      if (!close) calm = false;
      if (now > nextAt || (close && !calm)) flyOff(now, player);
    },
  };
}

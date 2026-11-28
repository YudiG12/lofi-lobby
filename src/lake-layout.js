// The Lago: a lake under a cliff with two waterfalls, a wooden pier, the notice board and a lamp by
// the landing, a swing up the path, picnic tables on the shore. Laid out on the same tile grid as the
// town (16 px atlas tiles, 3.2 units each), so the ground is built from the town's own tiles.
// Pure data (no three.js): src/lake.js builds it, the tests check it.

export const T = 3.2; // one ground tile, in world units (the town's tiles are this size)
// C cliff   ~ water   = pier (over water, walkable)   g grass   d dirt
// north is row 0; the path comes in at the bottom (from the top of the town)
export const MAP = [
  "CCCCCCCCCCCCCggggggggg",
  "CCCCCCCCCCCCCggggggggg",
  "~~~~~~~~~~~~~ggggggggg",
  "~~~~~~~~~~~~~ggddddddg",
  "~~~~~~~~~~~~gggddddddg",
  "~~~~~~~~~~~~gggddggggg",
  "~~~~~~~~~~~~gggddggggg",
  "~~~~~~~~~~~~gggddggggg",
  "~~~~~~~~~~~~gggddggggg",
  "~~~~~~~=====dddddggggg",
  "~~~~~~~=====dddddggggg",
  "~~~~~~~~~~~~gggddggggg",
  "~~~~~~~~~~gggggddggggg",
  "~~~~~~~~~~gggggddggggg",
  "~~~~~~~~gggggggddggggg",
  "~~~~~~~ggggggggddggggg",
  "~~~~~ggggggggggddggggg",
  "~~~ggggggggggggddggggg",
  "gggggggggggggggddggggg",
  "gggggggggggggggddggggg",
  "gggggggggggggggddggggg",
  "gggggggggggggggddggggg",
  "gggggggggggggggddggggg",
  "gggggggggggggggddggggg",
  "gggggggggggggggddggggg",
];
export const COLS = MAP[0].length;
export const ROWS = MAP.length;
export const BOUNDS = { minX: (-COLS * T) / 2, maxX: (COLS * T) / 2, minZ: (-ROWS * T) / 2, maxZ: (ROWS * T) / 2 };
export const WATER_Y = -0.9; // the water sits a little below the grass, behind a dirt bank
export const PIER_Y = 0.25;
export const CLIFF_H = 7;

// tile centre in world units
export const cx = (c) => BOUNDS.minX + (c + 0.5) * T;
export const cz = (r) => BOUNDS.minZ + (r + 0.5) * T;
export const cellAt = (x, z) => {
  const c = Math.floor((x - BOUNDS.minX) / T),
    r = Math.floor((z - BOUNDS.minZ) / T);
  return r >= 0 && r < ROWS && c >= 0 && c < COLS ? MAP[r][c] : null;
};
export const kind = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? MAP[r][c] : null);

// Atlas tiles (column, row) of the town's 256 px texture: 16 px tiles every 18 px from (3, 3)
export const ATLAS = {
  grass: [0, 0],
  dirt: [1, 4],
  // a grass tile with dirt along one side (named by the dirt's side)
  edgeS: [1, 0],
  edgeW: [1, 1],
  edgeE: [1, 2],
  edgeN: [1, 3],
  // dirt along two sides
  cornerSE: [2, 0],
  cornerSW: [2, 1],
  cornerNE: [2, 2],
  cornerNW: [2, 3],
  // a speck of dirt in one corner (the dirt is only diagonal)
  nookSW: [2, 4],
  nookNW: [2, 5],
  nookNE: [2, 6],
  nookSE: [2, 7],
  planks: [9, 3],
  plankLight: [10, 3],
  bark: [12, 1],
  stone: [11, 2],
  stoneLight: [12, 6],
  stoneDark: [13, 6],
  roofRed: [10, 13],
  red: [9, 13],
  lily: [10, 12],
  flowerWhite: [9, 11],
  flowerBlue: [10, 11],
  bank: [1, 13], // the brown earth wall (two tiles wide in the atlas): pond banks and the cliff
};
// the ground tile for a land cell: grass with the town's dirt edges where the path is next to it
export function groundTile(c, r) {
  const k = kind(c, r);
  if (k === "d") return ATLAS.dirt;
  const dirt = (dc, dr) => kind(c + dc, r + dr) === "d";
  const n = dirt(0, -1),
    s = dirt(0, 1),
    e = dirt(1, 0),
    w = dirt(-1, 0);
  if ((n && s) || (e && w) || n + s + e + w > 2) return ATLAS.dirt; // a sliver of grass: just dirt
  if (s && e) return ATLAS.cornerSE;
  if (s && w) return ATLAS.cornerSW;
  if (n && e) return ATLAS.cornerNE;
  if (n && w) return ATLAS.cornerNW;
  if (s) return ATLAS.edgeS;
  if (w) return ATLAS.edgeW;
  if (e) return ATLAS.edgeE;
  if (n) return ATLAS.edgeN;
  if (dirt(-1, 1)) return ATLAS.nookSW;
  if (dirt(-1, -1)) return ATLAS.nookNW;
  if (dirt(1, -1)) return ATLAS.nookNE;
  if (dirt(1, 1)) return ATLAS.nookSE;
  return ATLAS.grass;
}

// small seeded random (mulberry32): the same lake for everyone
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isWet = (k) => k === "~" || k === "=";
const isLand = (k) => k === "g" || k === "d";
// a land cell touching the water (rocks and cattails grow there)
const shore = (c, r) => kind(c, r) === "g" && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => kind(c + a, r + b) === "~");

// the waterfalls: [first column, last column] of cliff they pour down
export const FALLS = [
  [1, 3],
  [5, 8],
];
export const TABLE_BENCH = 1.6; // from a table's middle to the middle of each of its benches
export const PORTAL_COLS = [15, 16]; // the path's columns at the bottom edge

export function lakeLayout(seed = 20261127) {
  const rnd = random(seed);
  const at = (c, r, dx = 0, dz = 0) => ({ x: cx(c) + dx, z: cz(r) + dz });
  // the things that come from the town
  const board = { ...at(13, 8, -0.6, -0.4), w: 7.6, d: 1 }; // the notice board, by the pier's landing
  const lamp = at(14, 11, 0, -0.4); // and a lamp post on the landing's other side
  // the new things
  // the swing and the tables are the size of the town's benches (a 4.5 wide seat, 1.5 high)
  const swing = { ...at(18.5, 3, 0, 0.3), w: 6.6, d: 2 };
  const tables = [at(5, 18.5), at(10.5, 18.5)].map((p) => ({ ...p, w: 4.8, d: 4.4 }));
  // two benches like the town's beside the path, looking at it
  const benches = [
    { x: cx(14) + 0.9, z: cz(18), face: "right", w: 1.7, d: 4.8 },
    { x: cx(17) - 0.9, z: cz(13), face: "left", w: 1.7, d: 4.8 },
  ];
  // Where people sit, as the town's benches do it: each entry is two seats side by side, and the
  // sitter is drawn 1.05 in front of it (main.js, seatSpot). The swing, the benches, and the two
  // long sides of each table.
  const seats = [
    { x: swing.x, z: swing.z, face: "down" },
    ...benches.map(({ x, z, face }) => ({ x, z, face })),
    ...tables.flatMap((t) => [
      { x: t.x, z: t.z - TABLE_BENCH - 1.05, face: "down" }, // the far side, facing the camera
      { x: t.x, z: t.z + TABLE_BENCH + 1.05, face: "up" }, // the near side, back to the camera
    ]),
  ];
  const crates = [at(9, 9, -0.6, 0.4), at(9, 9, 0.6, 0.4), at(9, 9, 0, 0.3)].map((p, i) => ({ ...p, y: i === 2 ? 1 : 0 }));
  const roundTrees = [at(12, 15), at(19, 17, 0.5), at(3, 22, 0.4), at(18.5, 9.5)].map((p) => ({ ...p, s: 0.9 + rnd() * 0.3, r: 1.6 }));
  // pines like the town's close the edges (the south, the east, the top right corner behind the
  // swing), and go on past them so the world never ends on screen; a few gaps, never a way through
  const pines = [];
  // (the south row starts lower down: trees there stand between the camera and everything north of them)
  const edge = (c, r) => r >= 23 || (c <= 0 && r >= 19) || c >= 20 || (r <= 1 && c >= 13);
  for (let r = -4; r < ROWS + 4; r++)
    for (let c = -4; c < COLS + 4; c++) {
      const inside = r < ROWS && c >= 0 && c < COLS;
      if (inside && !edge(c, r)) continue;
      if (!inside && (c < 0 ? r < 17 : r < 0 && c < 13)) continue; // west is the lake, north the cliff
      if (c >= PORTAL_COLS[0] - 1 && c <= PORTAL_COLS[1] + 1 && r >= 17) continue; // the path in
      if (inside && kind(c, r) !== "g") continue;
      if (inside && rnd() < 0.08) continue;
      pines.push({ x: cx(c) + (rnd() - 0.5) * 1.2, z: cz(r) + (rnd() - 0.5) * 1.2, s: 0.95 + rnd() * 0.3, rot: rnd() * Math.PI * 2, r: 1.4 });
    }
  // rocks: on the shore, and a few in the water under the cliff
  const rocks = [];
  const lilies = [];
  const cattails = [];
  const flowers = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = kind(c, r);
      if (shore(c, r)) {
        if (rnd() < 0.35) rocks.push({ ...at(c, r, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 1.6), s: 0.6 + rnd() * 0.6, rot: rnd() * 6, r: 0.9 });
        const n = Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) cattails.push({ ...at(c, r, (rnd() - 0.5) * 2.6, (rnd() - 0.5) * 2.6), h: 1.4 + rnd() * 0.8 });
      } else if (k === "~") {
        const nearPier = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([a, b]) => kind(c + a, r + b) === "=");
        if (r === 2 && rnd() < 0.3 && !FALLS.some(([a, b]) => c >= a && c <= b)) rocks.push({ ...at(c, r, 0, -0.8), s: 1 + rnd() * 0.5, rot: rnd() * 6, r: 0, wet: true });
        if (r > 3 && !nearPier && rnd() < 0.16) lilies.push({ ...at(c, r, (rnd() - 0.5) * 2, (rnd() - 0.5) * 2), s: 0.7 + rnd() * 0.5, rot: rnd() * 6 });
      } else if (k === "g" && r > 1 && rnd() < 0.3) {
        flowers.push({ ...at(c, r, (rnd() - 0.5) * 2.4, (rnd() - 0.5) * 2.4), tint: Math.floor(rnd() * 3) });
      }
    }
  return { board, lamp, swing, tables, benches, seats, crates, roundTrees, pines, rocks, lilies, cattails, flowers };
}

// Collision without raycasts: the tile under you (water and cliff are walls, the pier is floor),
// then circles and boxes for the things standing on the grass, kept in a coarse grid.
export function createBlocker(layout, cell = 8) {
  const grid = new Map();
  const add = (o) => {
    const key = `${Math.floor(o.x / cell)},${Math.floor(o.z / cell)}`;
    (grid.get(key) || grid.set(key, []).get(key)).push(o);
  };
  for (const list of [layout.pines, layout.roundTrees]) list.forEach(add);
  layout.rocks.filter((r) => r.r > 0).forEach(add);
  add({ x: layout.lamp.x, z: layout.lamp.z, r: 0.9 });
  for (const b of [layout.board, layout.swing, ...layout.tables, ...layout.benches]) add({ ...b, box: true });
  const hits = (o, x, z, rad) =>
    o.box ? Math.abs(x - o.x) < o.w / 2 + rad && Math.abs(z - o.z) < o.d / 2 + rad : Math.hypot(o.x - x, o.z - z) < o.r + rad;
  return (x, z, rad) => {
    if (x - rad < BOUNDS.minX || x + rad > BOUNDS.maxX || z - rad < BOUNDS.minZ || z > BOUNDS.maxZ) return true;
    // the body's edge, all around, must be on land or pier
    for (const [a, b] of [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]]) {
      const k = cellAt(x + a, z + b);
      if (k === "~" || k === "C") return true;
    }
    const gx = Math.floor(x / cell),
      gz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const o of grid.get(`${gx + i},${gz + j}`) || []) if (hits(o, x, z, rad)) return true;
    return false;
  };
}

export { isWet, isLand };

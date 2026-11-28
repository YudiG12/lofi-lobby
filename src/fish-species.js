export const FISH_W = 24;
export const FISH_H = 12;
export const OUTLINE = "#1b1b24";

export const SPECIES = [
  { id: "perch", name: "pond perch", label: "a pond perch", hint: "" },
  { id: "koi", name: "golden koi", label: "a golden koi", hint: "25+ min" },
  { id: "moonfish", name: "moonfish", label: "a moonfish", hint: "at night" },
  { id: "sunfish", name: "sunfish", label: "a sunfish", hint: "by day" },
  { id: "raincat", name: "rain catfish", label: "a rain catfish", hint: "in the rain" },
  { id: "trout", name: "lake trout", label: "a lake trout", hint: "at the Lago" },
  { id: "boot", name: "old boot", label: "an old boot", hint: "rare" },
];

const BY_ID = new Map(SPECIES.map((s) => [s.id, s]));

/** @param {string} id @returns {typeof SPECIES[number]} */
export const speciesById = (id) => BY_ID.get(id) || SPECIES[0];

function weightFor(id, { minutes, night, raining, scene }) {
  switch (id) {
    case "perch":
      return 5;
    case "koi":
      return minutes >= 50 ? 6 : minutes >= 25 ? 4 : 0;
    case "moonfish":
      return night ? 4 : 0;
    case "sunfish":
      return night ? 0 : 4;
    case "raincat":
      return raining ? 5 : 0;
    case "trout":
      return scene === "lago" ? 5 : 0;
    case "boot":
      return minutes < 50 ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Species eligible in the given context, with their relative weights.
 * @param {{minutes?: number, night?: boolean, raining?: boolean, scene?: string}} [ctx]
 * @returns {{species: typeof SPECIES[number], weight: number}[]}
 */
export function eligibleSpecies(ctx = {}) {
  const norm = {
    minutes: Number(ctx.minutes) || 0,
    night: ctx.night ?? true,
    raining: !!ctx.raining,
    scene: ctx.scene || "lobby",
  };
  return SPECIES.map((species) => ({ species, weight: weightFor(species.id, norm) })).filter((e) => e.weight > 0);
}

/**
 * Picks a catch weighted by the current focus duration, time of day, weather and scene.
 * @param {{minutes?: number, night?: boolean, raining?: boolean, scene?: string}} [ctx]
 * @param {() => number} [rand]
 * @returns {typeof SPECIES[number]}
 */
export function pickCatch(ctx = {}, rand = Math.random) {
  const pool = eligibleSpecies(ctx);
  if (!pool.length) return SPECIES[0];
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  const raw = Number(rand());
  const r = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1 - 1e-12) : 0;
  let roll = r * total;
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll < 0) return entry.species;
  }
  return pool[pool.length - 1].species;
}

function blankGrid() {
  return Array.from({ length: FISH_H }, () => Array(FISH_W).fill(null));
}

function addOutline(g) {
  const out = blankGrid();
  for (let y = 0; y < FISH_H; y++) {
    for (let x = 0; x < FISH_W; x++) {
      if (g[y][x]) out[y][x] = g[y][x];
      else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => g[y + b]?.[x + a])) out[y][x] = OUTLINE;
    }
  }
  return out;
}

function paintRows(rows, palette) {
  const g = blankGrid();
  const top = Math.floor((FISH_H - rows.length) / 2);
  const left = Math.floor((FISH_W - rows[0].length) / 2);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (palette[ch]) g[top + y][left + x] = palette[ch];
    });
  });
  return g;
}

function drawPerch() {
  const C = { back: "#55666f", side: "#8496a2", belly: "#c9d2d8", bars: "#46525c", fin: "#9a5a5a" };
  const g = blankGrid();
  const set = (x, y, col) => x >= 0 && x < FISH_W && y >= 0 && y < FISH_H && (g[y][x] = col);
  const x0 = 2,
    len = 15,
    h = 8,
    cy = (FISH_H - 1) / 2;
  const half = (x) => (h / 2) * Math.sqrt(Math.max(0, 1 - (((x - x0) / (len - 1) - 0.42) / 0.6) ** 2));
  for (let x = x0; x < x0 + len; x++) {
    for (let y = 0; y < FISH_H; y++) {
      const d = (y - cy) / Math.max(half(x), 0.5);
      if (Math.abs(y - cy) > half(x)) continue;
      const bar = d < 0.45 && x - x0 > 3 && x - x0 < 13 && (x - x0) % 4 === 2;
      set(x, y, bar ? C.bars : d < -0.35 ? C.back : d > 0.4 ? C.belly : C.side);
    }
  }
  const xt = x0 + len - 1;
  for (let i = 1; i <= 5; i++) {
    const spread = 1 + i * 0.85;
    for (let y = 0; y < FISH_H; y++) {
      const d = Math.abs(y - cy);
      if (d <= spread && !(i > 3 && d < spread - 2)) set(xt + i, y, C.fin);
    }
  }
  for (let x = x0 + 5; x <= x0 + 9; x++) set(x, Math.ceil(cy - half(x)) - 1, C.fin);
  set(x0 + 2, Math.round(cy - 1), OUTLINE);
  set(x0, Math.round(cy + 1), OUTLINE);
  return g;
}

const ART = {
  // Golden koi: plump orange-gold body with white & red patches and a flowing forked tail
  koi: () =>
    paintRows(
      [
        ".......fff............",
        "....ooowwwrroo........",
        "..ooorrwwwooooor....tt",
        ".ookooooooooooooor.ttt",
        ".koooooooooowwwoootttt",
        ".bboooooowwwwwwooo.ttt",
        "..bboowwwwwwwoooor..tt",
        "....bbboooofff........",
        "........fff...........",
      ],
      {
        o: "#f3a833",
        b: "#f7e4b4",
        r: "#e24a33",
        w: "#faf6ee",
        f: "#d97c1c",
        t: "#f5c26b",
        k: OUTLINE,
      },
    ),

  // Moonfish: tall disc-like silver-blue silhouette with sweeping crescent fins
  moonfish: () =>
    paintRows(
      [
        ".........ffff.........",
        ".......ddmmmfff.......",
        ".....ddmmhmmmmdd......",
        "...ddmmhmmmmmmmmd..tt.",
        "..dmkmhhmmmmmmmmd.ttt.",
        "..dmmmmmmmmmmmmmdtttt.",
        "..dmmmmmmmmmmmmmd.ttt.",
        "...llmmmmmmmmmmll..tt.",
        ".....llmmffffll.......",
        ".......ffffff.........",
      ],
      {
        d: "#5a7cb8",
        m: "#a9c8f5",
        h: "#ffffff",
        l: "#dcebff",
        f: "#7fa7e0",
        t: "#b9d7ff",
        k: OUTLINE,
      },
    ),

  // Sunfish: round warm honey-gold body with coral fins and a blue gill spot
  sunfish: () =>
    paintRows(
      [
        "......fffff...........",
        "....ddgggggdd.........",
        "..ddgggggggggdd....tt.",
        ".dggkggggbgggggd..ttt.",
        ".kgggggggbgggggd.tttt.",
        ".llggggggggggggd..ttt.",
        "..llggggggggffdd...tt.",
        "....llllffff..........",
        ".......ffff...........",
      ],
      {
        d: "#d88a22",
        g: "#f7c948",
        l: "#ffeaa0",
        f: "#e86f48",
        t: "#f28c5c",
        b: "#3d85c6",
        k: OUTLINE,
      },
    ),

  // Rain catfish: long slate-green body with front whiskers and pale speckles
  raincat: () =>
    paintRows(
      [
        ".......dddd...........",
        "...ddddsspsssddd......",
        ".wddsksspsssssssdd.tt.",
        "w.ddsssssssspssssdttt.",
        ".kssssssssssssssstttt.",
        "w.llsssssssssssd..ttt.",
        "...llllffffffd.....tt.",
        "........fff...........",
      ],
      {
        d: "#364a4d",
        s: "#526b6d",
        l: "#9ab0ad",
        p: "#7a9696",
        f: "#45585a",
        t: "#607c7e",
        w: "#b8c7c4",
        k: OUTLINE,
      },
    ),

  // Lake trout: sleek olive body with a rose lateral stripe and dark speckles
  trout: () =>
    paintRows(
      [
        "........fff...........",
        "....ddppdddppd........",
        "..ddsspsssspsssd...tt.",
        ".dskrrrrrrrrrrrrd.ttt.",
        ".kssrrrrrrrrrrrrdtttt.",
        "..llsssssssssssd..ttt.",
        "....llllllffff.....tt.",
        "..........ff..........",
      ],
      {
        d: "#5a6d49",
        s: "#98ab8a",
        r: "#d97b82",
        l: "#dce2d5",
        p: "#3a4632",
        f: "#6e7f5a",
        t: "#85966f",
        k: OUTLINE,
      },
    ),

  // Old boot: leather boot facing left with cuff and thick treaded sole
  boot: () =>
    paintRows(
      [
        ".........cccccc.......",
        ".........bllllb.......",
        "........dbbbbbd.......",
        "........dbbhbbd.......",
        "......ddbbbbbbd.......",
        "..ddhhbbbbbbbbd.......",
        ".dhhbbbbbbbbbbd.......",
        ".dbbbbbbbbbbbbd.......",
        ".ssssssssssssss.......",
        ".s.ss.ss.ss.ss........",
      ],
      {
        c: "#9a6a42",
        l: "#b58458",
        b: "#7d4e2d",
        h: "#a86e44",
        d: "#59351c",
        s: "#332825",
      },
    ),
};

/**
 * Generates a 24x12 pixel-art grid for a species (with 4-neighbor dark outline).
 * @param {string} id
 * @returns {(string | null)[][]}
 */
export function fishGrid(id) {
  const raw = id && ART[id] ? ART[id]() : drawPerch();
  return addOutline(raw);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP, COLS, ROWS, T, BOUNDS, ATLAS, PORTAL_COLS, FALLS, TABLE_BENCH, kind, cx, cz, cellAt, groundTile, lakeLayout, createBlocker } from "../src/lake-layout.js";
import { SCENES } from "../src/scenes.js";

const layout = lakeLayout();
const blocked = createBlocker(layout);
const BODY = 0.72; // the trainer's collision radius in main.js (BODY_RADIUS * 0.8)

test("the map is a full rectangle of known tiles, on the town's tile size", () => {
  assert.equal(T, 3.2);
  for (const row of MAP) {
    assert.equal(row.length, COLS);
    assert.match(row, /^[C~=gd]+$/);
  }
  assert.equal(BOUNDS.maxX - BOUNDS.minX, COLS * T);
  assert.equal(BOUNDS.maxZ - BOUNDS.minZ, ROWS * T);
});

test("it has a lake, a pier on it, a cliff behind it and a path", () => {
  const count = (ch) => MAP.join("").split(ch).length - 1;
  assert.ok(count("~") > 100);
  assert.ok(count("=") >= 4);
  assert.ok(count("C") > 10);
  assert.ok(count("d") > 30);
  // every pier tile is over water, next to water
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (kind(c, r) === "=") assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => kind(c + a, r + b) === "~"));
  // the waterfalls pour down cliff into water
  for (const [a, b] of FALLS) for (let c = a; c <= b; c++) assert.equal(kind(c, 1), "C"), assert.equal(kind(c, 2), "~");
  // the path reaches the bottom edge where the portal is
  for (const c of PORTAL_COLS) assert.equal(kind(c, ROWS - 1), "d");
});

test("ground tiles: grass, dirt and the town's dirt edges on the right sides", () => {
  // find a grass tile with dirt only to the east, one with dirt to the south and east...
  const cases = { edgeE: [1, 0], edgeW: [-1, 0], edgeS: [0, 1], edgeN: [0, -1] };
  let checked = 0;
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++) {
      if (kind(c, r) !== "g") continue;
      const d = (a, b) => kind(c + a, r + b) === "d";
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => d(a, b));
      if (sides.length !== 1) continue;
      const [name] = Object.entries(cases).find(([, v]) => v[0] === sides[0][0] && v[1] === sides[0][1]);
      assert.deepEqual(groundTile(c, r), ATLAS[name], `${c},${r}`);
      checked++;
    }
  assert.ok(checked > 10);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) if (kind(c, r) === "d") assert.deepEqual(groundTile(c, r), ATLAS.dirt);
  // grass with no dirt anywhere around is plain grass
  assert.deepEqual(groundTile(19, 20), ATLAS.grass);
});

test("atlas tiles are inside the 256 px texture's 14 x 14 grid", () => {
  for (const [name, [c, r]] of Object.entries(ATLAS)) assert.ok(c >= 0 && c < 14 && r >= 0 && r < 14, name);
});

test("the same seed gives everyone the same lake", () => {
  assert.deepEqual(lakeLayout(), lakeLayout());
});

test("nothing stands on the path, the pier or in the water (the swing stands on its dirt patch)", () => {
  const solid = [...layout.pines, ...layout.roundTrees, ...layout.tables, ...layout.benches, layout.swing, layout.board, layout.lamp, ...layout.rocks.filter((r) => !r.wet)];
  for (const o of solid) {
    const k = cellAt(o.x, o.z);
    if (k === null) continue; // past the edge, to fill the view
    assert.ok(k === "g" || (o === layout.swing && k === "d"), `${k} at ${o.x.toFixed(1)},${o.z.toFixed(1)}`);
  }
  for (const l of layout.lilies) assert.equal(cellAt(l.x, l.z), "~");
});

test("water and cliff are walls; the pier is floor", () => {
  assert.equal(blocked(cx(4), cz(8), BODY), true); // the lake
  assert.equal(blocked(cx(4), cz(0.5), BODY), true); // the cliff
  assert.equal(blocked(cx(9.5), cz(9.5), BODY), false); // on the pier
  assert.equal(blocked(cx(9.5), cz(8.2), BODY), true); // off its side, into the water
  assert.equal(blocked(cx(6.6), cz(9.5), BODY), true); // off its end
});

test("the pier lines up with the path's landing and is 5 tiles long", () => {
  const rows = (ch) => [...new Set(MAP.flatMap((row, r) => (row.includes(ch) ? [r] : [])))];
  const pierRows = rows("=");
  assert.equal(MAP[pierRows[0]].split("=").length - 1, 5);
  for (const r of pierRows) {
    const end = MAP[r].lastIndexOf("=");
    assert.equal(kind(end + 1, r), "d", `row ${r}: the pier runs into the dirt`);
  }
});

// where someone on seat `id` of these entries is (the same maths as main.js's seatSpot)
const FACING = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
function seatSpot(id) {
  const b = layout.seats[id >> 1];
  const [fx, fz] = FACING[b.face];
  const side = id & 1 ? 1 : -1;
  const fwd = fz ? 1.05 : 0.2;
  return { x: b.x - fz * side * 1.1 + fx * fwd, z: b.z + fx * side * 1.1 + fz * fwd };
}

test("seats: the swing, two benches and both sides of each table, within the room's 16", () => {
  assert.equal(layout.seats.length, 1 + 2 + 2 * layout.tables.length);
  assert.ok(layout.seats.length * 2 <= 16);
  // the swing's two seats are on its seat
  for (const id of [0, 1]) {
    const s = seatSpot(id);
    assert.ok(Math.abs(s.x - layout.swing.x) < 2.3 && Math.abs(s.z - layout.swing.z - 1.05) < 0.01);
  }
  // each table seat sits on one of its benches, not in the table
  for (let id = 6; id < layout.seats.length * 2; id++) {
    const s = seatSpot(id);
    const t = layout.tables.find((t) => Math.abs(t.x - s.x) < 3 && Math.abs(t.z - s.z) < 3);
    assert.ok(t, `seat ${id} has no table`);
    assert.ok(Math.abs(Math.abs(s.z - t.z) - TABLE_BENCH) < 0.01, `seat ${id} is on a bench`);
  }
});

test("the edges are walls, except the way back", () => {
  assert.equal(blocked(BOUNDS.minX - 0.5, cz(20), BODY), true);
  assert.equal(blocked(BOUNDS.maxX + 0.5, cz(20), BODY), true);
  assert.equal(blocked(cx(15.5), BOUNDS.minZ - 0.5, BODY), true);
  const back = SCENES.lago.portals.find((p) => p.to === "lobby").box;
  assert.ok(back.minZ < BOUNDS.maxZ - BODY, "the portal can be walked into");
  assert.equal(blocked(cx(15.5), back.minZ + 0.5, BODY), false);
});

// walk the map on a fine grid from where you arrive, like a trainer would
function reachable(from) {
  const step = 0.5;
  const key = (x, z) => `${Math.round(x / step)},${Math.round(z / step)}`;
  const seen = new Set([key(from.x, from.z)]);
  const queue = [[from.x, from.z]];
  while (queue.length) {
    const [x, z] = queue.shift();
    for (const [a, b] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = x + a, nz = z + b;
      const k = key(nx, nz);
      if (seen.has(k) || blocked(nx, nz, BODY)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return (x, z) => seen.has(key(x, z));
}

test("from where you arrive you can walk to the pier's end, the board, the swing, the tables and back out", () => {
  const arrive = SCENES.lobby.portals.find((p) => p.to === "lago").arrive;
  assert.equal(blocked(arrive.x, arrive.z, BODY), false, "arrival spot");
  const can = reachable(arrive);
  const snap = (v) => Math.round(v * 2) / 2;
  const spots = {
    "pier's end": [cx(8.3), cz(9.5)],
    "board": [layout.board.x, layout.board.z + 2],
    "swing": [layout.swing.x, layout.swing.z + 2.2],
    "picnic table": [layout.tables[0].x, layout.tables[0].z - 3.4],
    "other picnic table": [layout.tables[1].x, layout.tables[1].z - 3.4],
    "the way out": [cx(15.5), 38.5],
  };
  for (const [name, [x, z]] of Object.entries(spots)) assert.ok(can(snap(x), snap(z)), `can't reach the ${name}`);
  // every seat has a free spot within sitting range (3.6, main.js SIT_RANGE) that you can walk to
  for (let id = 0; id < layout.seats.length * 2; id++) {
    const s = seatSpot(id);
    let ok = false;
    for (let dx = -3.5; dx <= 3.5 && !ok; dx += 0.5)
      for (let dz = -3.5; dz <= 3.5 && !ok; dz += 0.5)
        if (Math.hypot(dx, dz) < 3.4 && can(snap(s.x + dx), snap(s.z + dz))) ok = true;
    assert.ok(ok, `seat ${id} can't be reached`);
  }
});

test("an instancing budget: few kinds of thing, each drawn once", () => {
  assert.ok(layout.pines.length < 400);
  assert.ok(layout.flowers.length + layout.cattails.length < 600);
});

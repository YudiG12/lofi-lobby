import { test } from "node:test";
import assert from "node:assert/strict";
import { FISH_W, FISH_H, OUTLINE, SPECIES, speciesById, eligibleSpecies, pickCatch, fishGrid } from "../src/fish-species.js";

test("every species has metadata and a valid, distinct 24x12 pixel grid with outline", () => {
  const signatures = new Set();
  for (const s of SPECIES) {
    assert.ok(s.id && s.name && s.label, s.id);
    assert.equal(speciesById(s.id).id, s.id);
    const grid = fishGrid(s.id);
    assert.equal(grid.length, FISH_H, `${s.id} height`);
    let filled = 0;
    let outlined = 0;
    for (const row of grid) {
      assert.equal(row.length, FISH_W, `${s.id} width`);
      for (const cell of row) {
        if (cell === null) continue;
        assert.match(cell, /^#[0-9a-f]{6}$/i, `${s.id} color`);
        filled++;
        if (cell === OUTLINE) outlined++;
      }
    }
    assert.ok(filled > 10, `${s.id} has art`);
    assert.ok(outlined > 0, `${s.id} has outline`);
    signatures.add(JSON.stringify(grid));
  }
  assert.equal(signatures.size, SPECIES.length, "each species has a distinct sprite");
  assert.equal(speciesById("unknown").id, SPECIES[0].id);
});

test("eligibility responds to duration, time of day, rain and scene", () => {
  const ids = (ctx) => new Set(eligibleSpecies(ctx).map((e) => e.species.id));
  const weight = (ctx, id) => eligibleSpecies(ctx).find((e) => e.species.id === id)?.weight ?? 0;

  // Short dry night in town: perch, moonfish, boot
  assert.deepEqual(ids({ minutes: 15, night: true, raining: false, scene: "lobby" }), new Set(["perch", "moonfish", "boot"]));
  // Short dry day in town: perch, sunfish, boot
  assert.deepEqual(ids({ minutes: 15, night: false, raining: false, scene: "lobby" }), new Set(["perch", "sunfish", "boot"]));
  // Rain adds raincat
  assert.ok(ids({ minutes: 15, night: true, raining: true, scene: "lobby" }).has("raincat"));
  // Lago adds trout
  assert.ok(ids({ minutes: 15, night: true, raining: false, scene: "lago" }).has("trout"));
  // 25+ min unlocks koi; 50+ min increases koi weight and drops old boot
  assert.equal(weight({ minutes: 15 }, "koi"), 0);
  assert.equal(weight({ minutes: 25 }, "koi"), 4);
  assert.equal(weight({ minutes: 50 }, "koi"), 6);
  assert.equal(weight({ minutes: 50 }, "boot"), 0);
});

test("pickCatch selects across the weighted pool and handles edge inputs", () => {
  const ctx = { minutes: 25, night: true, raining: true, scene: "lago" };
  const pool = eligibleSpecies(ctx);
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  const seen = new Set();
  let acc = 0;
  for (const entry of pool) {
    const picked = pickCatch(ctx, () => (acc + 0.5) / total);
    assert.equal(picked.id, entry.species.id);
    seen.add(picked.id);
    acc += entry.weight;
  }
  assert.equal(seen.size, pool.length);

  for (const r of [0, 0.999999, 1, -1, NaN]) {
    const picked = pickCatch({}, () => r);
    assert.ok(SPECIES.some((s) => s.id === picked.id));
  }
});

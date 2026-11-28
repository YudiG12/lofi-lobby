import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENES, HOME, ROOM_IDS, isScene, portalAt } from "../src/scenes.js";

const within = ({ box: b }, x, z) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;

test("the town is a scene and is home", () => {
  assert.equal(HOME, "lobby");
  assert.ok(isScene(HOME));
  assert.deepEqual(ROOM_IDS, Object.keys(SCENES));
});

test("isScene only accepts real scenes", () => {
  assert.ok(isScene("lago"));
  for (const bad of ["", "nope", "__proto__", "constructor", "toString", undefined, null, 3]) assert.equal(isScene(bad), false);
});

test("every scene has a name, a spawn and portals to real scenes", () => {
  for (const [id, s] of Object.entries(SCENES)) {
    assert.ok(s.name, id);
    assert.ok(Number.isFinite(s.spawn.x) && Number.isFinite(s.spawn.z), id);
    for (const p of s.portals) {
      assert.ok(isScene(p.to), `${id} -> ${p.to}`);
      assert.notEqual(p.to, id, "a portal leads somewhere else");
      assert.ok(["up", "down", "left", "right"].includes(p.arrive.dir));
      assert.ok(p.box.minX < p.box.maxX && p.box.minZ < p.box.maxZ);
    }
  }
});

test("every portal has a way back", () => {
  for (const [id, s] of Object.entries(SCENES))
    for (const p of s.portals) assert.ok(SCENES[p.to].portals.some((q) => q.to === id), `${p.to} has no way back to ${id}`);
});

test("you never arrive inside a portal (no bouncing back and forth)", () => {
  for (const s of Object.values(SCENES))
    for (const p of s.portals) {
      const { x, z } = p.arrive;
      assert.equal(portalAt(p.to, x, z), null, `arriving in ${p.to} at ${x},${z}`);
      // nor at a step's reach from one
      for (const [dx, dz] of [[0, 2], [0, -2], [2, 0], [-2, 0]]) assert.equal(portalAt(p.to, x + dx, z + dz), null);
    }
});

test("spawns are not inside portals", () => {
  for (const [id, s] of Object.entries(SCENES)) assert.equal(portalAt(id, s.spawn.x, s.spawn.z), null, id);
});

test("portalAt finds the town's top path and nothing in the middle of town", () => {
  assert.equal(portalAt("lobby", 0, -48)?.to, "lago");
  assert.equal(portalAt("lobby", 0, 0), null);
  assert.equal(portalAt("lobby", 10, -48), null); // the pines beside the path
  assert.equal(portalAt("lago", 16, 38)?.to, "lobby");
  assert.equal(portalAt("nowhere", 0, -48), null);
  for (const s of Object.values(SCENES)) for (const p of s.portals) assert.ok(within(p, p.box.minX, p.box.minZ));
});

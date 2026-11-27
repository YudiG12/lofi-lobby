import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFT_PHRASES, sayAt, CAT_HOLD_MS, CAT_LIFT_REST_MS, CAT_THROW_DIST, CAT_THROW_MAX, clampThrow, heldBy, liftRefusal, throwArc, throwTarget } from "../src/cat-carry.js";

const now = 1_000_000;

test("a free cat can be lifted", () => {
  assert.equal(liftRefusal({ now }), null);
  assert.equal(liftRefusal({ now, ride: { playerId: null, at: 0, until: now - 1 }, fed: { at: 0, until: now - 1 } }), null);
});

test("no lift with full hands, seated, while it eats, rides or is dizzy", () => {
  assert.equal(liftRefusal({ now, holding: true }), "hands full");
  assert.equal(liftRefusal({ now, seated: true }), "seated");
  assert.equal(liftRefusal({ now, ride: { playerId: "p2", at: now - 5, until: now + 5 } }), "taken");
  assert.equal(liftRefusal({ now, fed: { at: now - 5, until: now + 5 } }), "eating");
  assert.equal(liftRefusal({ now, ride: { playerId: null, until: now - 1, thrownAt: now - 10 } }), "dizzy");
  assert.equal(liftRefusal({ now, ride: { playerId: null, until: now - 1, thrownAt: now - CAT_LIFT_REST_MS } }), null);
});

test("heldBy finds only a held cat that is still in the hands", () => {
  const rides = {
    black: { playerId: "a", at: now - 10, until: now + 10 }, // on the head (the room's lottery), not held
    orange: { playerId: "a", at: now - 10, until: now + 10, held: true },
    calico: { playerId: "b", at: now - 10, until: now + 10, held: true },
  };
  assert.equal(heldBy(rides, "a", now), "orange");
  assert.equal(heldBy(rides, "a", now + CAT_HOLD_MS), null);
  assert.equal(heldBy(null, "a", now), null);
});

test("a throw lands ahead, the way you face", () => {
  assert.deepEqual(throwTarget(0, 0, "up"), { x: 0, z: -CAT_THROW_DIST });
  assert.deepEqual(throwTarget(1, 2, "right"), { x: 1 + CAT_THROW_DIST, z: 2 });
  assert.deepEqual(throwTarget(0, 0, "nonsense"), { x: 0, z: CAT_THROW_DIST });
});

test("the room keeps a landing spot near the thrower", () => {
  assert.deepEqual(clampThrow({ x: 0, z: 0 }, { x: 3, z: 4 }), { x: 3, z: 4 });
  assert.deepEqual(clampThrow({ x: 0, z: 0 }, { x: 300, z: 0 }), { x: CAT_THROW_MAX, z: 0 });
  assert.deepEqual(clampThrow({ x: 5, z: 5 }, { x: NaN, z: "x" }), { x: 5, z: 5 });
});

test("the arc starts and ends on its points, peaks halfway and lands facing down", () => {
  const from = { x: 0, y: 4, z: 0 }, to = { x: 6, y: 0, z: 0 };
  assert.deepEqual(throwArc(0, from, to), { x: 0, y: 4, z: 0, dir: "down" });
  assert.deepEqual(throwArc(1, from, to), { x: 6, y: 0, z: 0, dir: "down" });
  const mid = throwArc(0.5, from, to, 4);
  assert.equal(mid.x, 3);
  assert.equal(mid.y, 2 + 4);
  assert.equal(throwArc(2, from, to).x, 6); // clamped
});

test("everyone picks the same line, and the next one is a different line", () => {
  assert.equal(sayAt(7, 0), sayAt(7, 0));
  assert.ok(LIFT_PHRASES.includes(sayAt(999, 3)));
  assert.notEqual(sayAt(7, 0), sayAt(7, 1));
  assert.ok(LIFT_PHRASES.includes(sayAt(undefined, 0)));
});

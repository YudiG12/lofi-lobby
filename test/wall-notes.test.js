import { test } from "node:test";
import assert from "node:assert/strict";
import { renamedNotes, wallName } from "../worker/notes.js";

const notes = () => new Map([
  ["note:1", { name: "Ana", gender: "female", text: "oi", owner: "a" }],
  ["note:2", { name: "Bia", gender: "female", text: "olá", owner: "b" }],
  ["note:3", { name: "Ana", gender: "female", text: "sem dono" }],
  ["note:4", { name: "Ana2", gender: "female", text: "de novo", owner: "a", likes: 3 }],
]);

test("only the owner's notes take the new name, keeping everything else", () => {
  const out = renamedNotes(notes(), "a", "Carol", "female");
  assert.deepEqual([...out.keys()], ["note:1", "note:4"]);
  assert.deepEqual(out.get("note:4"), { name: "Carol", gender: "female", text: "de novo", owner: "a", likes: 3 });
});

test("notes already signed with that name are not written again", () => {
  assert.deepEqual([...renamedNotes(notes(), "a", "Ana", "female").keys()], ["note:4"]);
});

test("no owner, no rename (notes from before wall keys stay as they are)", () => {
  assert.equal(renamedNotes(notes(), null, "X", "male").size, 0);
});

test("the new name gets the same cleaning as a new note", () => {
  assert.equal(wallName("  Carol \u200b  Silva  "), "Carol Silva");
  assert.equal(wallName("a".repeat(30)), "a".repeat(16));
  assert.equal(wallName(""), "trainer");
  assert.equal(wallName(null), "trainer");
  assert.equal(wallName("Admin"), "trainer");
});

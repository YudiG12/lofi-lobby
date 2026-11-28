import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOMS, HOME, roomOfPath } from "../worker/rooms.js";
import { ROOM_IDS } from "../src/scenes.js";

test("the server accepts exactly the scenes as rooms", () => {
  assert.deepEqual(ROOMS, ROOM_IDS);
  assert.ok(ROOMS.includes("lobby") && ROOMS.includes("lago"));
});

test("roomOfPath: scenes, unknown rooms and other paths", () => {
  assert.equal(roomOfPath("/ws/lobby"), "lobby");
  assert.equal(roomOfPath("/ws/LOBBY"), "lobby");
  assert.equal(roomOfPath("/ws/lago"), "lago");
  assert.equal(roomOfPath("/ws/other"), null);
  assert.equal(roomOfPath("/ws/" + "a".repeat(33)), "");
  assert.equal(roomOfPath("/ws/lobby/x"), "");
  assert.equal(roomOfPath("/ws/../lobby"), "");
  assert.equal(roomOfPath("/"), "");
  assert.equal(roomOfPath("/index.html"), "");
});

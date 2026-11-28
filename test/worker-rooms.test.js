import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOMS, HOME, GLOBAL, historyKey, roomOfPath } from "../worker/rooms.js";
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

test("historyKey: the town keeps its old key, each scene and the global chat have their own", () => {
  assert.equal(historyKey(HOME), "chat");
  assert.equal(historyKey("lago"), "chat:lago");
  assert.equal(historyKey(GLOBAL), "chat-global");
  assert.equal(roomOfPath("/ws/" + GLOBAL), "", "the global chat is not a room anyone can join");
  const keys = [...ROOMS, GLOBAL].map(historyKey);
  assert.equal(new Set(keys).size, keys.length);
});

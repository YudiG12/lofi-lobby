// Which room a request is for. The rooms are the scenes (src/scenes.js): any other name is refused,
// so nobody can spin up extra rooms (and extra cost). Kept apart from index.js so the tests can
// import it without the Workers runtime.
import { ROOM_IDS, HOME } from "../src/scenes.js";

export const ROOMS = ROOM_IDS;
export { HOME };

// /ws/<room> -> the room's name, "" if it isn't a WebSocket path, null if the room doesn't exist
export function roomOfPath(pathname) {
  const m = /^\/ws\/([a-z0-9-]{1,32})$/i.exec(pathname);
  if (!m) return "";
  const room = m[1].toLowerCase();
  return ROOMS.includes(room) ? room : null;
}

// The chats' histories in storage: each scene's local chat ("chat" is the town's, as before there were
// scenes), and the global one, under GLOBAL, which is not a scene name (those are [a-z0-9-]).
export const GLOBAL = "*";
export const historyKey = (room) => (room === GLOBAL ? "chat-global" : room === HOME ? "chat" : "chat:" + room);

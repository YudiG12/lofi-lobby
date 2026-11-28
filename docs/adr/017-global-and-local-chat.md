# ADR 017: A global chat and a local chat

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-28 |
| **Deciders** | ryanfurt12 |

## Context

With the Lago ([ADR 016](016-scenes-share-one-durable-object.md)), each scene got its own chat. The
game has few players at a time, and they ended up split: someone at the lake talked to nobody while
the town was busy, and nobody in the town knew they were there.

## Decision

The chat panel has **two room chats**, as tabs before the private chats
([ADR 014](014-accounts-friends-and-private-chat.md)):

- **global**, the main one and the tab open on arrival: it reaches every scene.
- **local**: only the scene you are in, as the chat was before.

- **Protocol:** `{ t: "chat", text, scope }`. `scope: "local"` stays in the sender's scene; anything
  else goes to every scene, so a client that sends no scope talks in the global chat. Every chat
  message from the server carries its `scope`.
- **History:** each scene keeps its local history under its old key (`chat` for the town,
  `chat:<scene>`), and the global one is under `chat-global`. On join the server sends both, as two
  `history` messages with their `scope`, even when one is empty, so a reconnect starts each list clean.
  A ban takes the player's lines out of all of them.
- **Limits:** the same cleaning, word filter, spam mute and chat budget per IP, whichever chat a line
  goes to. A global line costs the same as a local one.
- **Bubbles** over the head stay with the scene: a player sees the bubble of whoever is in their
  scene, whichever chat it was said in.
- **Time:** every line (room chats and private chats) shows the time it was said, in the reader's
  locale, right-aligned on the name line.
- **Unread:** each room tab counts what arrived while it was not on screen (on a phone, while the
  chat sheet is closed too).
- The box talks to the room tab open last; with a private chat open, it goes to that friend.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **One chat for the whole game, each line tagged with its scene** | Simplest, and with few players nothing gets split. But a scene loses its own conversation, and as the game grows the town's chat would drown the lake's. |
| **Keep the chat per scene** | What split the players in the first place. |
| **Local as the default tab** | Keeps the old behaviour on arrival, but most people never switch tabs, and the point is that they meet. |

## Consequences

- People in different scenes talk to each other by default; the local tab is there for a scene's
  own talk.
- One more history key in the room's storage and one more `history` message on each join.
- A global line goes to every socket in the object, at most the 100 players.
- If the global chat becomes too busy, the default tab can go back to local without touching the
  server.

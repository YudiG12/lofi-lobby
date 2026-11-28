# ADR 016: Scenes share one Durable Object

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-28 |
| **Deciders** | Yudi Ganeko |

## Context

The game got a second scene, the Lago, reached by a portal at the top of the town. The first version
gave each scene its own Durable Object, as [ADR 001](001-one-durable-object-per-room.md) does for
rooms. Much of what the room keeps is not about a place, though, and it broke in two:

- **Friends and private chat** ([ADR 014](014-accounts-friends-and-private-chat.md)) are kept in the
  object's storage and delivered to the sockets of that object. In the lake a player had an empty
  friends list, and a friend in the town showed as offline and could not be messaged.
- **Limits per IP** (connections, the chat rate, the spam mute, the admin lockout) are counted per
  object, so each one doubled, and a muted player could walk through the portal and talk.
- **A kick** closed the sockets of one object only.
- **The wall** is the town's, so a new note did not reach the lake live.

## Decision

A scene is **not a room**. Every scene is served by the same Durable Object (the one named `lobby`);
`/ws/<scene>` only says which scene a connection is in, and the object keeps it on the socket
(`room` in `serializeAttachment`).

- **Per scene:** who you see (`state`, `joined`, `left`, `pos` and every other message about a
  player), the chat and its history (`chat` for the town, `chat:<scene>` for the others) and the
  seats (a seat number is taken or free within its scene; the lake has its own count).
- **For the whole game:** accounts, friends, private chat and presence, bans and kicks, every limit
  per IP, the 100 players, the wall and the radio.
- **The town's animals stay in the town:** feeding the capybara or a cat is refused from another
  scene, and the cats only climb on someone who is in the town. Stones and fishing lines are relayed
  within the scene they happen in.
- A portal still closes the socket and opens one for the next scene: the client did not change.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **One object per scene, friends and private chat moved to D1** | Storage would be shared, but delivery would not: a message to a friend in another object needs object-to-object calls for every message, presence change and unread count. |
| **One object per scene, everything social routed through the town's object** | The same calls, plus a second place to keep limits and bans in step. The first version did this for bans only, and it was already the most intricate part. |
| **A "scene" message on the same socket instead of a new connection** | Fewer connections, but the client's reconnect, history and player list are built around joining; a new socket reuses all of it. |

## Consequences

- Friends, private chat, moderation and limits behave the same wherever a player stands.
- The 100 players are for the whole game, not per scene.
- One object does the work of every scene. It is one busy object instead of two; if the game
  outgrows it, the split to make is by *room* (a copy of the whole game), which ADR 001 still
  describes, not by scene.
- A scene costs the server a seat count and an entry in `src/scenes.js`.

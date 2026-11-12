# ADR 001: One Durable Object per room

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-09 |
| **Deciders** | Yudi Ganeko |

## Context

Everyone in a room has to see the same people walking, get the same chat and hear the same song. That needs one place that holds the room's state and fans out every message, with no server of our own to run.

## Decision

Each room is **one Durable Object**, addressed by name (`idFromName(room)`), reached through `/ws/<room>` on the Worker.

- **WebSocket Hibernation API.** The object accepts sockets with `state.acceptWebSocket` and can be evicted from memory while they stay open; idle rooms cost nothing.
- **Player state lives in the socket** (`serializeAttachment`): name, trainer, position. It survives hibernation without a write to storage on every step.
- **Only the radio command is stored** (`storage.put("radio")`), because it must outlive every connection.
- **The server relays, it doesn't simulate.** Clients send their position about 15 times a second; others smooth it.
- **A room holds at most 100 players.** More people means more rooms.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **A Node server with socket.io** | One more thing to host, scale and pay for while idle. |
| **Supabase Realtime / a managed pub-sub** | Fine for chat, but the radio and the player cap need logic next to the state. |
| **One object for every room** | A single hot object for everyone, no isolation between rooms. |
| **Authoritative movement on the server** | Needs the town's collision on the server; nothing in a lobby is worth cheating for. |

## Consequences

- No server to run; deploy is one `wrangler deploy`.
- A modified client can teleport or spam within the rate limits ([SECURITY.md](../../SECURITY.md)).
- Chat isn't kept: a player who joins late doesn't see older messages.

# ADR 006: Reliable disconnect and stale-socket cleanup

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-26 |
| **Deciders** | Yudi Ganeko |

## Context

Closing the browser window directly left a player's trainer visible in the lobby (still occupying bench seats and `MAX_PLAYERS` / `MAX_PER_IP` slots) for minutes or indefinitely:

- **Incomplete close handshake and unfiltered socket lists.** With `compatibility_date = "2025-06-01"`, incoming WebSocket close frames left sockets in `CLOSING` until `ws.close()` ran, while `webSocketClose` and `webSocketError` never closed the socket and `state.getWebSockets()` was queried without filtering `readyState === OPEN` or failed `broadcast()` writes.
- **Half-open TCP connections on abrupt browser exit.** When the whole browser process terminates, `ws.close()` is often cut off before reaching the Cloudflare edge, leaving the hibernated socket open until an OS/edge TCP timeout expires.
- **Idle players look identical to dead connections.** Lofi Lobby is designed to stay open in the background while studying or working, so clients send `pos` only when moving; without a heartbeat, the Durable Object cannot tell a quiet listener from a crashed browser.
- **Duplicate `state` + `joined` meshes.** Pre-`hello` sockets appeared in `players()`, and `createOther` added a new mesh without removing an existing one for the same `id`.

## Decision

Combine four layers that preserve WebSocket Hibernation ([ADR 001](001-one-durable-object-per-room.md)) and zero-trust validation:

- **Complete server socket lifecycle.** Enable `web_socket_auto_reply_to_close` in `wrangler.toml`, close sockets safely in an idempotent `Room.leave()` (`safeClose` avoids reserved codes `1005`/`1006`/`1015`), filter every room query through `openSockets()`, and evict sockets whose `send()` throws in `broadcast()`.
- **Immediate browser-close notification (`pagehide` + `POST /api/leave`).** On `pagehide`, the client calls `ws.close(1000, "pagehide")` and fires `navigator.sendBeacon("/api/leave", { id, token })`. Each connection receives a random `leaveToken` in `you` (kept only in the socket attachment, never in `public(p)`), and `/api/leave` verifies `Origin` and constant-time token match before calling `leave()`. On `pageshow` (`persisted`), the client reconnects cleanly from bfcache.
- **Zero-wake heartbeat + Durable Object `alarm()`.** Register `setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))` in `Room` so client pings every 25s (plus one on `visibilitychange` back to `"visible"`) are answered at the edge without waking the Durable Object. While at least one open socket exists, a DO alarm runs every 60s (`deleteAlarm()` when empty) and disconnects any socket whose `getWebSocketAutoResponseTimestamp` (falling back to `connectedAt`) is older than 120s — safely above browser background-tab timer throttling (60s).
- **Idempotent player creation.** `Room.players()` excludes pre-`hello` sockets, duplicate `hello` messages on the same socket are ignored, and `createOther` removes any existing entry with the same `id` before adding a mesh.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **`setInterval` inside the Durable Object** | Keeps the object pinned in memory, defeating hibernation and burning Free Plan duration. |
| **Heartbeat timeout under 60 s** | Chromium/Edge throttle background-tab timers to 1/min; a shorter timeout would kick idle listeners. |
| **Unauthenticated `POST /api/leave` by `id`** | Public player IDs are broadcast to everyone, so anyone could disconnect other players. |
| **Client `pagehide` `ws.close()` only** | Unreliable when closing the entire browser window, and cannot handle crashes or network drops. |

## Consequences

- Normal tab closes and direct browser-window closes remove the trainer within ~1 second.
- Crashes, mobile app kills, and network drops are bounded to at most ~2 minutes without waking the Durable Object on pings, and alarms incur zero requests when the room is empty (~1,440/day max when continuously occupied on the 100,000/day Free Plan).
- Muted background tabs left open for music remain connected indefinitely.

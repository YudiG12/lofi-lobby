# ADR 009: Free-roaming town cats and server-driven head-perching

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-27 |
| **Deciders** | Yudi Ganeko, Daniel |

## Context

Lofi Lobby already has a wandering NPC companion by the pond (`capy` on the grass patch), synced deterministically with the room clock. Adding multiple cats that roam the entire Twinleaf town, can be fed by any player, and occasionally hop onto a player's head introduces three constraints:

- **Whole-town navigation without baked navmeshes.** Cats must cover streets and open ground across the FBX town without walking through buildings, fences, water, lamps, or the message wall, and without clipping when terrain elevation changes.
- **Zero-traffic multiplayer synchronization.** Broadcasting per-cat positions every frame or second would wake the room Durable Object continuously and break WebSocket Hibernation ([ADR 001](001-one-durable-object-per-room.md)).
- **Shared head-perching without client authority.** Having a cat pick a random online player to perch on must agree across all browsers, handle sitting and direction changes smoothly, prevent stacking two cats on the same head, and clean up immediately if the rider disconnects ([ADR 006](006-reliable-disconnect-and-stale-socket-cleanup.md)).

## Decision

Combine deterministic client-side town navigation with lightweight Durable Object coordination in `src/cat.js`, `src/main.js`, and `worker/index.js`:

- **Five procedural pixel-art cats (`src/cat.js`).** `CATS` defines five default cats (`black`, `orange` tabby, `calico`, `tuxedo`, `siamese`) generated as `10×4` sprite sheets (`24×24` logical pixels at `2×` resolution) with `4`-direction walk cycles, blinking idle poses, fish-eating animation, and `4`-direction head-perched loaf poses. Each cat renders as a lit sprite taking the depth of its feet ([ADR 003](003-sprites-take-the-depth-of-the-feet.md)) with lamp shadows.
- **Whole-town BFS NavGrid built at town load (`buildCatNavGrid`).** On town mesh readiness, the client flood-fills walkable nodes spaced by `CAT_NAV_STEP` (`2` world units) starting from `(0, 0)`, reusing the player's collision rules (`insideSolid`, `inPond`, message wall, lamp posts, `MAX_STEP`) and caching raycast `groundY` per cell. `findCatPath()` prefers straight corridors over zigzags so paths follow town streets naturally.
- **Clock-synced wandering with pass-through interaction.** Cats pick deterministic `CAT_LEG_MS` (`26 s`) legs via `catHash(seed, slot)` over `roomNow()`, pausing at the end of each leg (`CAT_MIN_SIT_MS = 4500`). Cats never block trainer movement (`isFree()` ignores them) and share the unified `E` interaction loop (`eAction()` / `doE()` / `#cat-prompt`). Feeding emits `{ t: "cat", id }`, validated server-side with `CAT_SIT_MS = 6000` + `CAT_REST_MS = 3000` cooldown and blocked while a cat is riding someone's head.
- **Server-driven head-perching lottery (`maybeStartCatRide`).** Piggybacking on the existing `60 s` Durable Object `alarm()` heartbeat ([ADR 006](006-reliable-disconnect-and-stale-socket-cleanup.md)), `Room` rolls at most one idle cat per tick (`CAT_RIDE_EVERY_MS = 90_000`, `CAT_RIDE_CHANCE = 0.65`, `CAT_RIDE_MS = 18_000`) onto an online player who is not already carrying a cat, persists `"cat-rides"` in storage (replayed on join), and clears active rides immediately via `clearCatRideFor()` inside `Room.leave()`.
- **Four-phase client ride choreography (`walkCat`).** When a `cat-ride` event arrives, the client animates an approach trot (`CAT_APPROACH_SPEED = 8.5`, capped at `CAT_APPROACH_MAX_MS = 2800`), a `450 ms` parabolic hop-on, perched tracking matching the rider's 4-way facing and ground-sit height drop (`CAT_HEAD_OFFSET_Y = 3.85`, `-0.47` seated, `+2.2` `headCatLift()` for name tags and bubbles, `+0.05` depth nudge with `renderOrder = 12`), a `450 ms` parabolic hop-off, and a snap-free `afterRide` transition back to the NavGrid.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Stream cat coordinates from the Durable Object** | Requires periodic `setInterval` ticks in the DO, preventing hibernation ([ADR 001](001-one-durable-object-per-room.md)) and inflating WebSocket messages per player. |
| **Bake a static waypoint file in `public/assets/`** | Any adjustment to obstacles, pond bounds, or the FBX town would silently desync waypoints; deriving the NavGrid from the live collision primitives keeps walkability guaranteed to match the player's rules. |
| **Let clients trigger random head rides locally or vote on riders** | Desynchronizes which player a cat rides across browsers and opens the door to spoofed ride messages; running the lottery inside `Room.alarm()` keeps all clients in agreement with zero extra alarms. |

## Consequences

- Five distinct cats roam every walkable street and yard in sync across all connected clients with zero steady-state WebSocket traffic.
- Per-cat Durable Object storage stays tiny (two small maps: `"cats"` for feeding timestamps and `"cat-rides"` for active rides) and produces no extra DO alarms beyond the existing heartbeat.
- Adding another cat coat or NPC cat only requires adding an entry to `CATS` / `CAT_PALETTES` in `src/cat.js` and its ID to `CAT_IDS` in `worker/index.js`.

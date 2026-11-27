# ADR 007: Fishing pomodoro, a private timer with a shared line

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-27 |
| **Deciders** | Yudi Ganeko |

## Context

Lofi Lobby is a place where people hang out while they study or work. A Pomodoro timer at the pond's edge gives them a calm ritual: cast a line, focus for a chosen number of minutes, pull a fish in when the time is up. It should not turn the room into a game the server has to referee, nor make the room object store and wake for everyone's timers.

Yet someone fishing is part of the shared scene: the others should see the rod, the line and the bobber on the water, also whoever walks in later.

## Decision

**The timer is the fisher's alone; the room only knows that a line is out and where its bobber floats.**

1. **Timer and persistence on the client (`createFishing` in `src/fishing.js`).**
   - At the pond's edge, facing the water, `E` (or the note, or the fish button on a pond bench) opens a picker: `15`, `25`, `50` minutes or any number up to `MAX_MINUTES` (180). The last choice is remembered.
   - The line that is out (`end`, `minutes`, the spot, the bobber's `target`) is kept in `localStorage`, so it survives a reload.
   - A `setInterval` tick (not the render loop) runs the timer, so it keeps going with the tab hidden: at `end` the fish bites, a plop plays every `PLOP_EVERY` (4 s), and the fisher has `PULL_WINDOW` (60 s) to press `E`, or the fish gets away. Walking more than `FISH_LEAVE` from the spot (or standing up) reels the line in; reeling in on purpose takes a second press within `CONFIRM_MS`.
   - The server never sees the minutes, the time left, the bite or the catch.

2. **One drawing for every trainer (`createFishingGear` in `src/fishing.js`).**
   - Rod, line, bobber, the landing splash and the ripple are made in code (pixel textures with `NearestFilter`, a line of `THREE.Points` snapped to the screen's pixel grid), at the scale of the 32 px trainers.
   - The rod follows each trainer's body on its frame (`bodyShape`; cached per direction and per sheet, since a trainer can change) and takes the trainer's feet depth (`useFeetDepth`, [ADR 003](003-sprites-take-the-depth-of-the-feet.md)), so benches, trees and other trainers hide it the same way they hide the trainer.
   - `createFishing` uses one gear for you (with sound and the bite's tug); `src/main.js` makes one per other player the first time their line is out, and disposes it when they leave.

3. **The line over the WebSocket (`worker/index.js`, `src/main.js`).**
   - Every change of the line (cast, catch, reel-in by hand, by walking away or by timeout) calls `onChange`, which sends `fish`. A reconnect (or reload) with a line out sends it again after `hello`.
   - The room keeps the line on the player's socket attachment, like `hold` and `ground`: no storage write, nothing to wake for. It is part of `public()`, so a player who joins later sees it.
   - Only `x` and `z` travel. Each client finds the bobber's height by casting a ray onto its own water meshes (`waterY`); a point that isn't on the water is never drawn. The room only checks that they are numbers inside the town (`number()`).
   - `fish` has its **own rate bucket per connection** (`RATES.fish`), not the shared per-IP `other` one: many players behind one office network, or a few stones skipped right before, would otherwise drop a "line's in" and leave a line on everyone else's screen that isn't there.
   - The others see the throw when the message arrives with their tab visible; a line already out (on joining, or with the tab hidden) appears in the water. They always see it as waiting: the bite is the fisher's.

## Protocol

```
client → server:  { t: "fish", on: true, x, z }    the line is out, the bobber at (x, z)
                  { t: "fish", on: false }          the line is back in
server → others:  { t: "fish", id, fish }           fish: [x, z], or null when it is in
public player:    fish: [x, z] | null
```

## Consequences

- Everyone sees who is fishing, live and on joining, with no storage writes and no timers on the server.
- Focus times, the bite sound and the catch card stay in each player's browser; a modified client can only fake a bobber on the water, which is harmless.
- If the fisher's browser stops without closing the socket, the line stays out for the others until the heartbeat drops that socket ([ADR 006](006-reliable-disconnect-and-stale-socket-cleanup.md)).
- The art is all code: no sprite files to version (unlike the town and the trainers, [ADR 005](005-version-and-deploy-game-assets.md)).

# ADR 013: Roller coaster over the pond, in cycles by the room's clock

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-27 |
| **Deciders** | Gabriel Strapasson |

## Context

ADR 011 and ADR 012 put a carousel and a Ferris wheel on each side of the pond. Between them, below
the pond, six pines are left (x -5.1, 0, 5.1 at z 41 and 46.2), on the same flat grass. A roller
coaster that starts there, goes up, crosses the pond and comes back fits the fair. Unlike the other
two rides it can't just turn forever: it has to stop at its station and let its riders off, so
others can go.

## Decision

- **Same base as the other rides** (`src/roller-coaster.js`): the pines in `COASTER.clear` come out in
  `prepareTown`, everything is built in code (track, posts, station, bulbs and a train of 5 cars:
  8 draw calls), and where the train is comes from the room's clock (`roomNow()`), so riding sends
  no messages.
- **It runs in cycles.** `phase = roomNow() % 42 s`: for the first 12 s the train waits at the
  station and its 5 seats (one per car, 32..36, `MAX_SEATS` 32 → 37) can be taken with E; for the
  next 30 s it rides.
  When the next cycle starts, each rider's browser stands them up onto the grass north of the station
  (`leaveFinishedRide`, also on a 1 s timer, since a tab in the background draws no frames).
- **The server checks the boarding time.** A sit for seats 32..36 is refused (`seatReply`) unless the
  train is at the station by the server's own clock, with 1.5 s of slack for the trip; the client
  stops offering the seat 0.8 s before the doors close, so in practice nobody is refused. The server
  only needs `Date.now()`: no new state, no timers.
- **Strapped in during the ride.** Move keys and E do nothing while the train is out
  (`strappedIn()`); only the respawn button still gets you off, at the station.
- **The ride**: a closed centripetal Catmull-Rom curve. A chain lift up the east side (to 8.5 over the
  ground), a drop over the water, a low curve along the north of the pond and a two-turn spiral down on
  the west side (at least 2.5 between the turns), then brakes into the station. The time along the ride
  maps to a place on the track through a table sampled once: steady on the lift, faster the lower it is
  after the top (gravity), slow on the brakes, the whole scaled to last exactly 30 s, so every browser
  finds the train at the same place.
- **Low over the water** (about 2 to 5 over the ground, except the lift by the pond's south-east
  corner), so the track doesn't hide the people on the pond's benches from the camera above.
- **A train of 5 cars, each level.** Each car follows the track on its own, 1.75 behind the one in
  front, and only turns (yaw); a car tilted with the slopes looked wrong under riders whose sprites
  always stand up. At the station the 5 riders sit side by side, facing the camera's side. Riders
  face the way their car goes (the nearest of the four sprite directions); the track spirals but has
  no upside-down loop.
- **A countdown over the station** (`#coaster-sign`), for whoever is near it or riding: the seconds left
  to board, then the seconds until the train is back.
- **Collision**: only the station's deck (`onCoaster`). The track's posts block nobody: they left
  only narrow gaps on the grass below the pond. Cats and the placement searches avoid the deck too
  (`onRide`).
- As with the other rides, what moves casts no shadow and riders are not lamp shadow movers.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Run only when someone boards** | Needs the start time kept and shared by the server, and rules for who starts it. Fixed cycles need nothing kept. |
| **A vertical loop** | Sprites always stand up and face the camera, so riders would slide upright around it. |
| **Let riders off anywhere, like the Ferris wheel** | Off a fast train high over the pond; and the ride is meant to end at the station. |
| **Trusting the client for the boarding time** | A late or forged sit would put someone on a moving train. The server's clock check costs one line. |
| **One sleigh with two rows, tilted along the track** | Tried first: it leaned with every slope under upright sprites, and a rigid car cuts the curves. Separate level cars follow the track. |
| **A high track over the water** | It would hide the pond's benches, where most people sit, from the camera. |

## Consequences

- Seats 32..36 are taken.
- Boarding is possible 11 s of every 42 s; someone who misses it waits at most half a minute.
- The cycle constants live in both `src/roller-coaster.js` (`COASTER`) and `worker/index.js`
  (`COASTER_*`): change them together.

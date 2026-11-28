# ADR 014: The roller coaster goes round the town, with loops, three trains and a first-person view

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-28 |
| **Deciders** | Gabriel Strapasson |

Supersedes the track, the ride's length and the single train of [ADR 013](013-roller-coaster-in-cycles.md);
its cycles, the server's boarding check and the station stay as they are.

## Context

The coaster of ADR 013 stays on the grass below the pond, takes 5 riders and is seen from the town's
camera, far above. To make the ride exciting it should be longer, go through loops and around the town,
take more people, and be seen from the seat. The track's new stretches run through the forest at the
town's edges, far from the lamp posts. And a first-person view is worth having in the whole town, not
only on the ride.

## Decision

- **Round the town, along the inner row of pines.** From the station the track runs north between the
  pond and the Ferris wheel (4.5 up, so trainers walk under it on the wheel's west side), east past the
  wheel's north side, up a chain lift to 18 over the east edge's pines, drops into the forest and
  through a loop, crosses the north edge (a second loop where the road leaves town), comes down the
  west edge over a row of hills, and back across the pond close to the water. About 366 long. It keeps
  to the inner row of the edge's pines (x ±26.9, z -41), so the outer row still hides the end of the
  town, and never passes over the houses or the road, where it would hide trainers from the town's
  camera. It keeps at least 2 from the Ferris wheel and its gondolas, and 3.6 from every lamp post
  (two of the wheel's posts moved for it).
- **A cut through the forest.** Where the track is lower than the pines' tops (12.5), the pines whose
  centre is within 4.6 of it are taken out as the town loads (`inCoasterClearing`): 52 of 122, all from
  the inner rows. No kept pine touches the track.
- **The cars' frame.** Off the loops, a car's up is the world's up, square to the track: it pitches
  with the slopes and never rolls sideways. In a loop, up is the track's direction crossed with the
  loop's sideways axis: the world's up on the way in and out, straight down at the top. The two are
  blended over a few samples at each end of a loop. Frames are computed once, 3000 along the track.
- **Three trains of five.** They share the cycle a third of it apart (`offsetOf`), so while one waits
  at the station the other two are out: never two at the station, and the next train is at most
  ~10 s away. Their 15 seats are 32..46, train by train (`MAX_SEATS` 37 → 47); the server checks each
  seat against its own train's boarding time. The countdown over the station says how long the waiting
  train stays, or when the next one comes. The closest two trains ever get is 3, on parallel tracks
  by the station.
- **Ride length.** At the pace of the speed table (gravity from the lift's top) the ride takes about
  38 s; it is played 1.7 times faster, `rideMs` 22 s, which feels like a real coaster (gravity alone,
  at this town's scale, is slow). Boarding is 7 s (was 12): with three trains, a train stays at the
  station less than a third of a cycle minus the ~2.7 s the next one needs to come in along the
  station's straight, or it runs into the one still boarding. A cycle is 29 s, a train leaves every
  ~10 s. The server's `COASTER_BOARD_MS` and `COASTER_CYCLE_MS` match.
- **Light along the ride, at night.** A warm headlight on each train's first car, four lamps a little
  over the track where it is darkest (the two loops and the west hills; left out on phones), and soft
  halos on the track's bulbs (one `Points`, additive). None of these lights casts a shadow: a shadowed
  point light is 6 shadow passes each time something moves near it. They fade out by day.
- **First person, everywhere.** V, or the eye button in the top card, switches between the town's
  camera and your own eyes (field of view 75; the town's is 30). Each place keeps its own choice,
  remembered: the town starts in the town's view, the coaster in first person.
  - Walking: drag the mouse to turn; W/S walk the way you look, A/D step sideways; on a phone the stick
    drives like a tank (forward and back walk, sideways turns). The others see you face the way you walk.
  - On the coaster: the camera sits in your seat, looks the way the car goes and turns with it, over
    the top in the loops. Drag to look around; while the train is out the move keys and the stick turn
    your head too. Let go and the view eases back to the front. The riders of your own train, right in
    front of your eyes, are hidden.
  - While you ride the coaster a note at the bottom of the screen says how to switch the view (V, or
    the eye button on phones) and the eye button glows, since first person is new to most players.
  - Your own trainer, name tag, shadow and held item are hidden in first person; billboards (trainers,
    cats, the capybara, the owl) face the camera fully (`faceCamera`), since it can look anywhere.
- **Riders turn with their car.** In the town's view a rider is drawn turned by the car's roll as that
  camera sees it (`rollOf`), so a rider in a loop goes over upside down, name tag over their head.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Over the middle of the town** | The track would hide trainers and houses from the town's camera, and its posts would stand on the road. |
| **Along the outer row of pines** | It would take out the row that hides the end of the town (84 pines instead of 52). |
| **Up the east edge right by the Ferris wheel** | The wheel (moved to x 20.8) reaches x 26.8; its gondolas would sweep the track. |
| **Carrying the cars' up along the whole track (parallel transport)** | It builds up a sideways roll on climbing turns; out of a loop the train came out tilted 35°–45°. |
| **One longer train** | Its tail would hang out of the station, and only one group could ride at a time. |
| **Boarding for 8 s or more with the faster ride** | The next train comes in along the station's straight while the last cars of the one boarding are still on it. |
| **Shadowed lights along the track** | 6 shadow passes per light whenever a train or trainer moves near it. |
| **Pointer lock to look around** | No such thing on phones, and it needs a click to start and Esc to leave. |
| **One view setting for the whole game** | Most people want the town's view to walk about and their own eyes on the coaster; one switch for both would flip back and forth at every ride. |

## Consequences

- 52 pines are gone from the inner rows of the east, north and west edges.
- A cycle is 29 s for each of the three trains (7 s to board, 22 s to ride); the constants live in `src/roller-coaster.js` and
  `worker/index.js`.
- 7 more point lights at night (3 on phones), none with a shadow.
- In first person the town's edge can show past the outer pines where the road leaves town.

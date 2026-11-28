# ADR 011: Christmas carousel, turned by the room's clock

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-27 |
| **Deciders** | Gabriel Strapasson |

## Context

The town has benches, the ground, the pond and the capybara, but nothing to ride. A merry-go-round
fits the cozy, lofi mood and can reuse what is already there: the bench seats (a seat number is all
the server keeps), the room's clock (`roomNow()`, which already walks the capybara the same way for
everyone) and the town's low-poly look built in code.

The grass south of the sand path, left of the pond, is full of pines (`Mesh_TreePine*` in the FBX,
in a 5.15-unit grid). It is the only open-looking spot big enough, and the camera, which looks down
from the south, sees it well.

## Decision

- **The pines come out in code, the FBX stays as it is.** In `prepareTown` (`src/main.js`), every
  mesh named `/tree/i` whose center falls in `CAROUSEL.clear` (x -28..-10, z 28..50) is removed from
  the town: 16 pines in the FBX, none in the code-built fallback town. It happens after the scaling
  and `townBox` (those pines stand on the town's edge: earlier, the town would come out with another
  size and place) and before `townMeshes` (rays ignore visibility, so a hidden pine would still block
  the way). Under them is flat grass, so no ground is added.
- **Built in code** (`src/carousel.js`): round base with presents, striped floor, candy-cane pole,
  a small striped canopy with a garland and a star, a ring of bulbs and 8 horses. Parts are merged
  with vertex colours: 12 draw calls in all. No new files under `public/assets/` (ADR 005).
- **Seats 16..23 are the horses.** `MAX_SEATS` goes from 16 to 24 in `worker/index.js`; the server
  checks them exactly like the bench seats (an integer in range, one player per seat).
- **It turns by the room's clock.** The turn is `roomNow()` modulo 40 s, so every browser computes
  the same angle, and `seatSpot(id)` for a horse is where it is right now. Other riders were already
  moved to `seatSpot(o.seat)` every frame; your own trainer now follows its horse every frame too,
  facing the way it goes (the nearest of the four sprite directions). No new messages: a rider sends
  no positions while it turns.
- **The canopy only covers the pole.** A full roof would hide the riders from the camera above.
- **What turns casts no shadow, and riders are not lamp shadow movers.** The lamp at the pond's left
  end reaches the carousel, and a shadow going round would make it redraw its 6 shadow passes every
  frame, all night (lamp shadows are drawn on demand, see `updateLampShadows`).
- The base is solid as a circle (`onCarousel` in `isFree`), and the placement searches for lamps and
  benches (`isOpen`) keep clear of it. Getting off puts you on the grass just outside the base, next
  to where your horse is.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **A new clearing outside the town (extend `townBox`)** | Needs new ground and a new edge, and the spot would be off-screen. Taking out pines gives a spot people already see. |
| **Editing the FBX to remove the pines** | The town file is a versioned asset (ADR 005); removing by name and place in code keeps it untouched and also works for the fallback town. |
| **Turning only while someone rides** | Needs a synced start/stop state on the server and edge cases (joining mid-turn, a rider who disconnects). Always turning needs none. |
| **A full cone roof** | Hides the riders from the camera, which looks down from the south. |

## Consequences

- Seats 16..23 are taken; bench seats stay under 16 (8 benches at most).
- The carousel's place and size are constants in `CAROUSEL` (`src/carousel.js`); moving it means
  moving `clear` with it.
- Riders cast no shadow while they ride.

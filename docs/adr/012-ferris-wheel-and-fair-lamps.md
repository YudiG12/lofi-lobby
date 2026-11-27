# ADR 012: Ferris wheel and lamps around the rides

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-11-27 |
| **Deciders** | Gabriel Strapasson |

## Context

ADR 011 put a carousel on the grass left of the pond, where pines were taken out. The grass right of
the pond is the same: a grid of pines on flat ground (x 10..28, z 28..50), the carousel's mirror
across the water. A Ferris wheel there makes a small fair on both sides of the pond. At night the
area was dark: the only lamps are the two at the pond's ends.

## Decision

- **Same pattern as the carousel** (`src/ferris-wheel.js`): the pines in `WHEEL.clear` come out in
  `prepareTown`, the wheel is built in code (legs, rims, spokes, bulbs, 8 gondolas; 11 draw calls),
  and it turns by the room's clock (60 s a turn). Seats 24..31 are the gondolas; `MAX_SEATS` goes
  from 24 to 32.
- **It faces the camera** (the wheel is in the x-y plane), so it reads as a wheel, and it stands on
  the same line as the carousel (z = 39), not south of it, where a tall wheel would hide things.
- **Gondolas stay upright** and riders face the camera. They are placed every frame from the clock,
  not turned with the wheel.
- **A gondola is boarded only near the bottom** (`board` in `wheelSeat`, within ~26°); with 8
  gondolas one is always there. Getting off works anywhere: you land on the grass in front of the
  wheel, below your gondola.
- **The footprint is a rectangle** (`onWheel`: the legs, the booth and the gondolas at the bottom).
- **Four lamps around the rides** (`FAIR_POSTS` in `src/main.js`), their arm toward the ride. They
  join `lampPosts` (they light up at dusk, nobody walks through them) but `placeLampPairs` still
  moves only the road's pairs. **Their light casts no shadow**: a shadowed point light is 6 shadow
  passes each time something moves near it, and the rides already glow.
- As with the carousel, what turns casts no shadow and riders are not lamp shadow movers.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **The wheel south of the carousel** | A tall wheel between the camera and the carousel would hide it. |
| **The wheel side-on to the camera** | It would read as a thin line from above. |
| **Boarding any gondola within reach** | Would let you board one at the top of the wheel. |
| **Shadowed lights on the new lamps** | 6 shadow passes per lamp whenever someone walks near; four more of them would be more than all the town's other draw calls. |
| **Lamps placed in mirrored pairs along the road** (`placeLampPairs`) | The fair's lamps belong around the rides, not by the road. |

## Consequences

- Seats 24..31 are taken.
- The new lamps light the ground but cast no shadows.

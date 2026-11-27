# ADR 015: Single-floor GLB interiors for the four town houses

|              |                   |
| ------------ | ----------------- |
| **Status**   | Accepted          |
| **Date**     | 2026-11-27        |
| **Deciders** | Victor S. Heshiki |

## Context

The four town doors need to open indoor spaces where players can walk around furniture, sit
together and use their existing held items. An early plan used flat PNG layouts with separate
collision and occlusion layers. The two supplied GLB models provide geometry for both movement
and rendering, and match the single-floor layouts chosen for the houses.

## Decision

- **Use two GLB layouts for four distinct interiors.** The front-right house uses
  `center_scene.glb`, and the other three use `players_room.glb`. Both assets ship from
  `public/assets/indoor_houses/`. Each door has its own area ID and entry on the indoor mat.
- **Reuse the town camera and trainer sprites.** The client checks floor clearance against the
  model geometry and uses the depth of the trainer's feet for furniture occlusion, following ADR 003. The shared layout defines door approaches, entry mats and individual seating positions.
- **Keep areas in the same room Durable Object.** The client loads the GLB before requesting
  entry. The server checks the player's current area and proximity to the door, then sets the
  destination. On exit, the player returns to the street position saved at entry. The client
  checks for a walkable spot there and looks nearby if needed.
- **Keep presence local and conversation shared.** Trainers and their speech bubbles are visible
  within the current area. Animal bubbles are shown on the street. Room chat and radio continue
  across all areas on the same connection.
- **Reuse the seating and held-item controls indoors.** Chairs, sofa places and poufs each allow
  one player per place in the current house. The Durable Object resolves competing requests.
  Seated players can use the existing laptop control. The server clears cigarettes on entry and
  rejects indoor requests to equip them.

## Consequences

- Houses that share a model also share its collision geometry and seating coordinates. Their
  occupants and reservations remain independent.
- Changing a model's geometry may require recalibrating its entry mat and seat positions.
- A failed model load leaves the player on the street. A reload or reconnection returns the
  player to the street and releases the prior seat.
- The Worker checks door and seat proximity against the latest reported position. Movement
  collision remains client-side.

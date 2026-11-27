# ADR 016: See-through around your trainer

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-27 |
| **Deciders** | ryanfurt12 |

## Context

The camera looks down on the town from the front. Walking behind a house, a tree or a bench hides your trainer and everything around it, so you can't see where you are going. Making the whole object transparent would make the town look hollow, and only the part around you matters.

## Decision

The part of an object **in front of you and inside a circle around you** is drawn about **half see-through, fading out to the circle's edge** (`src/see-through.js`).

- It is done in the shaders of the scene's materials (`onBeforeCompile`, composed with any shader change a material already has, such as the wet look), not with real transparency. Inside the circle a fragment is dropped on a 4x4 ordered-dither pattern: half of the pixels in the middle, all of them at the edge. This is screen-door transparency, so the merged town needs no sorting and the pixel look stays pixel.
- Only fragments **nearer the camera than you** (world `z` past your feet, since the camera looks down `-z`) and **above your feet** are cut. The ground you walk on and whatever stands behind you are never cut.
- The circle follows your trainer only: one set of uniforms (screen center and radius, your `z` and feet height), updated once a frame before drawing.
- The trainers and animals (drawn at their feet's depth, [ADR 003](003-sprites-take-the-depth-of-the-feet.md)) are marked `userData.noSeeThrough` and left alone, as are transparent materials (water, glows).
- Benches are left alone too (their own materials, marked the same way): they are low and hide nobody, and whoever sits on one stays whole.
- Shadows use their own depth materials, so they stay whole.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Fade the whole occluding object** | The town is merged into a few big meshes, so "the object" is a whole stretch of town. A house would also look hollow when only the part over you needs to go. |
| **Real alpha blending in the circle** | Transparent merged meshes need sorting against each other and against the sprites, and draw their own back faces through themselves. |
| **Raycast to find occluders and hide them** | Same problem as fading: hides whole merged meshes, and misses partly covered trainers. |

## Consequences

- Things the town merges after loading (the wet materials) must get the patch again: `prepareWet` calls `seeThrough` on the meshes it changes.
- A material added to the scene after the town loads has no circle until `seeThrough` is run on it.
- Other players are not see-through for you, only your own trainer: one circle, one set of uniforms.

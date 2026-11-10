# ADR 003: Sprites take the depth of their feet

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-09 |
| **Deciders** | Yudi Ganeko |

## Context

Trainers are flat pixel-art sprites standing in a 3D town seen from above. With normal depth testing, a sprite standing in front of a wall still gets its head cut by the wall behind it, because the top of the sprite is "inside" the geometry. A raycast from the camera to the body fixed some cases and missed others (the head of a lamp post).

## Decision

In the sprite's vertex shader, **every vertex takes the clip-space depth of the feet**, pulled toward the camera by a fixed margin (2.4 units, enough to cover the body's height seen from above).

- Anything closer to the camera than the feet covers the **whole** sprite.
- Nothing behind the feet can cut it.
- Sprites are **lit planes** (`MeshLambertMaterial`) with `customDepthMaterial` and `customDistanceMaterial` using the same texture and `alphaTest`, so they receive light and cast a shadow shaped like the character from every lamp.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Raycast from the camera, toggle `depthTest`** | Misses tall objects whose top is in front (lamp heads). |
| **Sort by y and draw sprites last** | Doesn't work against 3D geometry, only against other sprites. |
| **Real 3D characters** | Loses the pixel-art look that is the point. |

## Consequences

- One margin to tune: too small and objects right behind cut the head; too large and the sprite draws over things right in front of it.

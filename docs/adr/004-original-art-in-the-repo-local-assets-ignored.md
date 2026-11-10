# ADR 004: Original art in the repo, local assets ignored

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-09 |
| **Deciders** | Yudi Ganeko |

## Context

The look is inspired by handheld RPG towns. During development the scene was tested with local models and sprite sheets that we don't have the rights to publish. The repo is public and the site is live.

## Decision

- **The repo and the live site ship only original art generated in code**: the town (houses, roads, fences, trees, pond) and the two trainers.
- **`public/assets/` is local only**: ignored by Git (`.gitignore`) and by the production build (`publicDir` is off in `vite build`).
- **The code falls back automatically**: if the local town model or a configured sprite sheet doesn't load, it uses the original town and trainers.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Commit the local assets** | Publishes art we don't own. |
| **Free asset packs** | Possible later; each one needs its license checked and credited. |

## Consequences

- Anyone can clone and run it with no setup beyond `npm ci`.
- The original art is simpler; better art can come from licensed packs or our own pixel art.

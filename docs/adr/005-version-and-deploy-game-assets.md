# ADR 005: Version and deploy the game assets

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-10 |
| **Deciders** | Yudi Ganeko |

## Context

ADR 004 excluded the town model, its textures and the trainer sheets from Git and production builds. That made the live site fall back to the simpler code-generated town and trainers instead of the assets used during development. The README artwork also showed those fallbacks rather than the actual game.

## Decision

- Restore and version the five game files in `public/assets/`: two trainer sheets, one FBX town model and two town textures.
- Include `public/` in production builds and deploys.
- Keep the code-generated town and trainers as fallbacks for asset load failures.
- Use a real gameplay screenshot in the README artwork and describe the binary assets in the architecture documentation.

This supersedes [ADR 004](004-original-art-in-the-repo-local-assets-ignored.md).

## Consequences

- A fresh clone and the production site render the same town and trainers used in development.
- The repository and deploy include approximately 5.7 MB of binary game assets.
- The owner is responsible for the continued use and attribution of third-party art; new assets must be reviewed before being added.

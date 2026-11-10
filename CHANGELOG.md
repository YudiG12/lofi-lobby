# Changelog

## v1 (2026-11-09)

Built in one evening, from a Paper mockup to a live multiplayer lobby. Decisions in [ADR 001](docs/adr/001-one-durable-object-per-room.md) to [ADR 004](docs/adr/004-original-art-in-the-repo-local-assets-ignored.md); design in [spec v1](docs/spec/v1.md).

### Added
- **2.5D town at night** in three.js: lamp posts that light the scene and cast dynamic shadows, animated water, collision with houses, fences, mailboxes and the pond.
- **Sprites that take the depth of their feet**, so objects in front cover the whole trainer and nothing behind cuts the head ([ADR 003](docs/adr/003-sprites-take-the-depth-of-the-feet.md)).
- **Original town and trainers** (male and female) generated in code; switch trainer any time with G.
- **Multiplayer**: one Durable Object per room with hibernating WebSockets ([ADR 001](docs/adr/001-one-durable-object-per-room.md)); name tags over every trainer.
- **Chat** with a bubble over the speaker; change your name in the game.
- **Synced radio**: everyone hears the same second of the same YouTube video; admin can restart or skip for the whole room ([ADR 002](docs/adr/002-radio-synced-by-the-clock.md)).
- **Security**: rate and size limits, origin check, player cap, constant-time admin password with few tries, cleaned input ([SECURITY.md](SECURITY.md)).

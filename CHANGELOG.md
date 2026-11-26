# Changelog

## Unreleased

### Added
- **Fireflies**: at night, little lights blink and drift around the pond. They fade out by day and in the rain. Only for you.
- **Open tabs follow the deploy**: after a new deploy, a tab that reconnects to the room reloads itself to get the new version (it waits while you are writing a note or a chat message).
- **Benches**: park benches around the town (wooden slats on iron ends, like the lamp posts), two seats each, some facing the camera and some sideways along the paths. Walk up and a "press E to sit" note shows over the seat; press **E** (or tap the note) to sit, and any move key stands you up. Everyone sees you sitting, a seat holds one player, and a bench hides whoever stands behind it. Two of them face the pond, between the lamp posts at its ends, with a few candles on the grass. While sitting, **Q** (or the cup button) puts a laptop on your lap, a coffee in your hand or an open book (its pages turn now and then), and everyone sees it. You get up toward the side you walked off, and the camera glides instead of jumping.
- **Message wall**: a cork board by the lamp posts, in front of the lower-left house. Walk up and press E (or tap the note, or B) to read the notes people left and pin your own: up to 2,000 characters, six paper colours (a new note starts on a random one), one note a minute, no links. Notes are kept forever, appear live for everyone in the room, and the board in town shows the latest ones. You can edit or delete your own notes (deleting asks first; an edited note says so), and the admin can delete any note.
- **Stats** for the admin at `/stats.html`: online now, visitors per day, peak online, time in the room, busiest hours, countries and chat volume (Workers Analytics Engine; no IP, name or chat text is stored). `scripts/stats-token.sh` gives it read access. Each finished day is archived in the room's storage by a daily cron, so history outlives the 3 months of Analytics Engine, and a Cloudflare-measured connections-per-day chart goes back to launch.
- Cleaner HUD: the top card buttons are icons with an instant label on hover and their key in the corner, the shortcut bar became a "?" list (shown once on the first visit), the player count reads "N online", the radio TV is smaller, and respawn asks for a second click.
- **Full screen**: a button in the top card (and the F key) enters or leaves full screen, handy for leaving the lobby open next to your work. Only for you; hidden where the browser doesn't support it.
- **Respawn** button in the top card: sends your trainer back to the spawn if you got stuck.
- Everyone sees who the admin is: an **ADMIN** badge over the name and a highlighted line in the chat. Names with "admin", "moderador", "moderator" or "staff" are refused so nobody can pose as one.
- **Rain**: a button in the top card (and the R key) turns on rain with a short fade: thin drops that stop on roofs, splash rings on the ground and the pond, shiny wet ground and a little fog; by day the sky also turns grey. Only for you, and remembered.
- The HUD panels are more opaque with lighter grey text, and the shortcut bar sits between the radio and the chat instead of over the radio.
- Admin menu shows who a player is: a short tag of their IP (never the IP), who else is online with it, and the names it used in the last 6 hours.
- **Chat history**: whoever joins sees the last 30 messages from the last 2 hours.
- **Moderation**: bad names are refused, bad chat words become `***`, and the admin can kick or ban by clicking a player's name (`/unban` in the chat lifts bans).
- **Day and night**: a button in the top card (and the N key) switches the town to daytime and back, with a short fade. Only for you, and remembered.
- **Mute** button next to "now playing" (and the M key): only for you, remembered, and the radio keeps playing in sync underneath.
- **Volume** slider next to the mute button: only for you and remembered; moving it while muted unmutes.
- Chat **send** button (on phones it keeps the keyboard open).
- Play on phones: drag anywhere to walk (floating joystick, push to the edge to run), compact HUD, chat as a sheet behind a button with an unread dot, pause button, lighter shadows on touch devices.
- Name and trainer live together: a name field on the enter/pause screen, and "you: <name> ✎" moved from the chat header to the top card.
- Anti-flood per IP: at most 3 connections, chat budget shared across tabs, admin locked for 15 min after 5 wrong passwords (counted per IP, survives reconnects).
- Browser icon: the town's lamp post (`public/favicon.svg`).
- Progressive mute for chat spam (rate exceeded, or the same text 4+ times in a row): warning, then 15 s, 1 min, 5 min, 30 min.

### Changed
- Two trainers standing close: the one in front now covers the other from head to toe (the feet of the one behind used to show through). Every trainer is drawn at the depth of its feet, not only yours.
- Admin login: type `/admin` in the chat and then the password in its own login box instead of `?admin=` in the URL; `/logout` leaves. Admin lock is looser: 20 tries, then 1 minute.
- You come back where you were: the position is remembered in the browser and sent when you (re)connect, so others see you in the right spot even if you stand still.
- The chat box stays open after sending, so you can keep talking; Esc or Enter on an empty box goes back to walking.
- Room limit raised from 40 to 100 players.
- A single room, `lobby`: `?room=` is gone and the server refuses other room names, so nobody can open extra rooms to run up the bill.

### Fixed
- Chat history scrolls to older messages; new messages only pull you down if you were already at the bottom.
- Long words without spaces now wrap in the chat bubble and history.

### Restored
- The original Twinleaf FBX town, its textures and the male/female trainer sheets are versioned and included in production again ([ADR 005](docs/adr/005-version-and-deploy-game-assets.md)).
- README artwork now uses a real gameplay screenshot and the architecture docs describe the bundled assets.

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
